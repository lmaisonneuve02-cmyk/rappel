// Synchronisation avec le dépôt GitHub : cache local, opérations en attente, envoi groupé en un commit.
import { ClientGitHub } from './github.js';
import { DEPOT_DEFAUT } from './config.js';
import { jourParis } from './temps.js';
import { cheminUtile, analyser, serialiser, vue, cheminsTouches, appliquerOp } from './depot.js';

const CLES = { depot: 'sync.depot', fichiers: 'sync.fichiers', tete: 'sync.tete', ops: 'sync.ops', derniere: 'sync.derniere' };
const ESSAIS = 5;
const PARALLELE = 6;

const MESSAGES = {
  'sans-jeton': 'Sans lien avec tes données',
  chargement: 'Chargement de tes cartes…',
  'a-jour': 'Enregistré',
  'hors-ligne': "Hors ligne : tout est gardé sur l'appareil",
  'hors-ligne-vide': 'Hors ligne : connecte-toi pour charger tes cartes.',
  conflit: 'Un autre appareil envoie en même temps : nouvel essai dans un instant.',
  inconnu: "Problème inattendu pendant l'envoi. Tes réponses restent gardées sur l'appareil.",
};

// Erreurs après lesquelles un nouvel essai automatique a un sens.
const PASSAGERES = new Set(['reseau', 'serveur', 'limite', 'conflit']);

// fn sur chaque élément, au plus n à la fois ; résultats dans l'ordre.
async function enParallele(liste, n, fn) {
  const resultats = new Array(liste.length);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < liste.length) { const i = suivant++; resultats[i] = await fn(liste[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, ouvrier));
  return resultats;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// Ce qui attend, compté comme l'utilisateur le voit : les réponses, sinon les modifications.
function enAttente(ops) {
  const reponses = ops.filter(o => o.type === 'reponse' || o.type === 'qcm-reponse').length;
  if (reponses) return { n: reponses, texte: pluriel(reponses, 'réponse') };
  const autres = ops.filter(o => o.type !== 'srs').length || ops.length;
  return { n: autres, texte: pluriel(autres, 'modification') };
}

function messageCommit(ops, ms) {
  const [, mois, jour] = jourParis(ms).split('-');
  const n = ops.filter(o => o.type === 'reponse').length;
  return n ? `Rappel : séance du ${jour}/${mois} (${pluriel(n, 'réponse')})` : `Rappel : mise à jour du ${jour}/${mois}`;
}

function erreurIllisible(path, racine) {
  const nom = path.slice(racine.length);
  return Object.assign(new Error(`Le fichier ${nom} est abîmé dans le dépôt : demande à Claude de le réparer. Tes réponses restent gardées sur l'appareil.`), { code: 'illisible' });
}

export class Synchro extends EventTarget {
  constructor({ stockage, creerClient = cfg => new ClientGitHub(cfg), config, maintenant = Date.now, delaiEnvoi = 30000 }) {
    super();
    this._stockage = stockage;
    this._creerClient = creerClient;
    this._config = config || (() => ({}));
    this._maintenant = maintenant;
    this._delai = delaiEnvoi;
    this._fichiers = {};          // distant : {path: {sha, texte}} (chemins utiles)
    this._objets = {};            // distant analysé : {path: objet}
    this._illisibles = new Set(); // fichiers distants abîmés
    this._tete = null;            // {commit, arbre}
    this._ops = [];               // opérations en attente d'envoi
    this._locaux = {};            // distant + ops en attente
    this._donnees = null;
    this._derniere = 0;
    this._phase = null;           // 'chargement' | 'envoi' | null
    this._erreur = null;          // {mode, message, code}
    this._file = Promise.resolve();
    this._minuterie = null;
    this._debrancher = null;
    this._dernierEtat = '';
  }

  // --- Configuration ---
  _cfg() {
    const c = { ...DEPOT_DEFAUT, ...(this._config() || {}) };
    const racine = String(c.racine ?? 'rappel/');
    return { ...c, racine: racine && !racine.endsWith('/') ? racine + '/' : racine };
  }

  _sansJeton() { return !this._cfg().jeton; }

  _idDepot(c = this._cfg()) { return `${c.proprietaire}/${c.depot}@${c.branche}:${c.racine}`; }

  // --- Lecture ---
  donnees() {
    if (!this._donnees) this._donnees = vue(this._locaux, this._cfg().racine);
    return this._donnees;
  }

  get etat() {
    const c = enAttente(this._ops);
    const attente = this._ops.length ? c.n : 0;
    let mode, message, code = null;
    if (this._sansJeton()) mode = 'sans-jeton';
    else if (this._phase === 'envoi') { mode = 'envoi'; message = `Envoi de ${c.texte}…`; }
    else if (this._phase === 'chargement' && !this._tete) mode = 'chargement';
    else if (this._erreur) ({ mode, message, code } = this._erreur);
    else if (this._ops.length) { mode = 'attente'; message = `${c.texte} en attente d'envoi`; }
    else mode = 'a-jour';
    return { mode, attente, message: message || MESSAGES[mode], derniereSynchro: this._derniere, code };
  }

  // --- Événements ---
  _emettreDonnees() {
    this.dispatchEvent(new CustomEvent('donnees', { detail: this.donnees() }));
  }

  _emettreEtat() {
    const etat = this.etat;
    const cle = JSON.stringify(etat);
    if (cle === this._dernierEtat) return;
    this._dernierEtat = cle;
    this.dispatchEvent(new CustomEvent('etat', { detail: etat }));
  }

  // --- Cache local ---
  _recalculer() {
    const racine = this._cfg().racine;
    this._locaux = { ...this._objets };
    for (const op of this._ops) appliquerOp(this._locaux, op, racine);
    this._donnees = null;
  }

  _analyser(paths) {
    for (const p of paths) {
      const f = this._fichiers[p];
      this._illisibles.delete(p);
      delete this._objets[p];
      if (!f) continue;
      try { this._objets[p] = analyser(p, f.texte); } catch { this._illisibles.add(p); }
    }
  }

  async _sauverCache() {
    const s = this._stockage;
    await Promise.all([
      s.ecrire(CLES.depot, this._idDepot()),
      s.ecrire(CLES.fichiers, this._fichiers),
      s.ecrire(CLES.tete, this._tete),
      s.ecrire(CLES.derniere, this._derniere),
    ]);
  }

  _sauverOps() {
    return Promise.resolve(this._stockage.ecrire(CLES.ops, this._ops.slice())).catch(() => {});
  }

  // Travaux réseau un par un.
  _enFile(fn) {
    const p = this._file.then(fn);
    this._file = p.catch(() => {});
    return p;
  }

  // --- Démarrage ---
  async demarrer() {
    const s = this._stockage;
    const [depot, fichiers, tete, ops, derniere] = await Promise.all(
      [CLES.depot, CLES.fichiers, CLES.tete, CLES.ops, CLES.derniere].map(k => Promise.resolve(s.lire(k)).catch(() => undefined)));
    this._ops = [...(Array.isArray(ops) ? ops : []), ...this._ops];
    if (depot === this._idDepot() && fichiers && typeof fichiers === 'object') {
      this._fichiers = fichiers;
      this._tete = tete || null;
      this._derniere = derniere || 0;
    }
    this._analyser(Object.keys(this._fichiers));
    this._recalculer();
    this._phase = this._sansJeton() ? null : 'chargement';
    this._emettreDonnees();
    this._emettreEtat();
    await this.rafraichir('ouverture');
  }

  // Charge la tête donnée : arbre, puis seulement les blobs utiles dont le sha a changé.
  // `ecrits` : textes que l'on vient d'écrire (inutile de les relire). Renvoie true si quelque chose a changé.
  async _charger(client, tete, ecrits = null) {
    if (this._tete?.commit === tete.commit) return false;
    const racine = this._cfg().racine;
    const entrees = await client.arbre(tete.arbre);
    const utiles = entrees.filter(e => e.type === 'blob' && cheminUtile(e.path, racine));
    const connu = e => this._fichiers[e.path]?.sha === e.sha;
    const aLire = utiles.filter(e => !(ecrits && typeof ecrits[e.path] === 'string') && !connu(e));
    const textes = await enParallele(aLire, PARALLELE, e => client.blob(e.sha));
    const nouveaux = {};
    for (const e of utiles) {
      if (ecrits && typeof ecrits[e.path] === 'string') nouveaux[e.path] = { sha: e.sha, texte: ecrits[e.path] };
      else if (connu(e)) nouveaux[e.path] = this._fichiers[e.path];
    }
    aLire.forEach((e, i) => { nouveaux[e.path] = { sha: e.sha, texte: textes[i] }; });
    const changes = [...new Set([...Object.keys(this._fichiers), ...Object.keys(nouveaux)])]
      .filter(p => this._fichiers[p]?.sha !== nouveaux[p]?.sha);
    this._fichiers = nouveaux;
    this._tete = tete;
    this._analyser(changes);
    return true;
  }

  _noterErreur(e) {
    this.derniereErreur = e; // pour le diagnostic
    const code = e?.code || 'inconnu';
    if (code === 'reseau') this._erreur = { mode: 'hors-ligne', message: MESSAGES[this._tete ? 'hors-ligne' : 'hors-ligne-vide'], code };
    else if (code === 'conflit') this._erreur = { mode: 'erreur', message: MESSAGES.conflit, code };
    else this._erreur = { mode: 'erreur', message: e?.code ? e.message : MESSAGES.inconnu, code };
    // Nouvel essai automatique plus tard si l'erreur est passagère.
    if (this._ops.length && PASSAGERES.has(code)) this._programmer(Math.max(2 * this._delai, e?.attente || 0));
  }

  // --- Réseau ---
  async rafraichir(raison = 'ouverture') {
    if (this._sansJeton()) { this._emettreEtat(); return this.etat; }
    await this._enFile(async () => {
      this._phase = 'chargement';
      this._emettreEtat();
      let change = false;
      try {
        const client = this._creerClient(this._cfg());
        change = await this._charger(client, await client.tete());
        this._erreur = null;
        this._derniere = this._maintenant();
        if (change) await this._sauverCache();
        else await this._stockage.ecrire(CLES.derniere, this._derniere);
      } catch (e) {
        this._noterErreur(e);
      } finally {
        this._phase = null;
        if (change) { this._recalculer(); this._emettreDonnees(); }
        this._emettreEtat();
      }
    });
    if (this._ops.length && !this._erreur) await this.pousser(raison);
    return this.etat;
  }

  // raison : 'minuterie' | 'fin-seance' | 'arriere-plan' | 'manuel' | 'ouverture' | 'reseau'
  async pousser(raison = 'manuel') {
    this._annulerMinuterie();
    if (this._sansJeton()) { this._emettreEtat(); return this.etat; }
    await this._enFile(() => this._envoyer(raison));
    return this.etat;
  }

  async _envoyer() {
    if (!this._ops.length) return;
    const envoyees = this._ops.slice(); // celles ajoutées pendant l'envoi restent pour la fois suivante
    const cfg = this._cfg();
    const racine = cfg.racine;
    this._phase = 'envoi';
    this._emettreEtat();
    let change = false;
    try {
      const client = this._creerClient(cfg);
      const touches = [...new Set(envoyees.flatMap(op => cheminsTouches(op, racine)))];
      for (let essai = 1; ; essai++) {
        // Relire la tête et les fichiers modifiés depuis, puis rejouer les ops dessus.
        const tete = await client.tete();
        if (await this._charger(client, tete)) change = true;
        const abime = touches.find(p => this._illisibles.has(p));
        if (abime) throw erreurIllisible(abime, racine);
        const objets = {};
        for (const p of touches) if (p in this._objets) objets[p] = this._objets[p];
        for (const op of envoyees) appliquerOp(objets, op, racine);
        const fichiers = {};
        for (const p of touches) {
          const avant = p in this._objets ? serialiser(p, this._objets[p]) : null;
          const apres = p in objets ? serialiser(p, objets[p]) : null;
          if (apres !== avant && !(apres === null && !this._fichiers[p])) fichiers[p] = apres;
        }
        if (Object.keys(fichiers).length) {
          try {
            const nouvelle = await client.ecrire({ base: tete, fichiers, message: messageCommit(envoyees, this._maintenant()) });
            await this._charger(client, nouvelle, fichiers);
          } catch (e) {
            if (e?.code === 'conflit' && essai < ESSAIS) continue;
            throw e;
          }
        }
        // Envoyées (ou déjà présentes dans le dépôt) : on les retire.
        this._ops = this._ops.slice(envoyees.length);
        change = true;
        await this._sauverOps();
        break;
      }
      this._erreur = null;
      this._derniere = this._maintenant();
    } catch (e) {
      this._noterErreur(e);
    } finally {
      this._phase = null;
      if (change) {
        this._recalculer();
        await this._sauverCache().catch(() => {});
        this._emettreDonnees();
      }
      this._emettreEtat();
    }
  }

  // --- Opérations locales ---
  ajouter(op) {
    this._ops.push(op);
    appliquerOp(this._locaux, op, this._cfg().racine);
    this._donnees = null;
    const sauve = this._sauverOps();
    this._emettreDonnees();
    this._emettreEtat();
    if (!this._sansJeton()) this._programmer();
    return sauve;
  }

  // --- Minuterie et navigateur ---
  _programmer(ms = this._delai) {
    this._annulerMinuterie();
    this._minuterie = setTimeout(() => { this._minuterie = null; this.pousser('minuterie').catch(() => {}); }, ms);
  }

  _annulerMinuterie() {
    if (this._minuterie) clearTimeout(this._minuterie);
    this._minuterie = null;
  }

  // Envoi quand l'appli passe en arrière-plan ; nouvel essai au retour du réseau ou au premier plan.
  brancherNavigateur(win = globalThis.window, doc = globalThis.document) {
    this._debrancher?.();
    const rien = () => {};
    const enLigne = () => { this.rafraichir('reseau').catch(rien); };
    const cacher = () => { this.pousser('arriere-plan').catch(rien); };
    const visibilite = () => {
      if (doc.visibilityState === 'hidden') cacher();
      else this.rafraichir('ouverture').catch(rien);
    };
    win?.addEventListener?.('online', enLigne);
    win?.addEventListener?.('pagehide', cacher);
    doc?.addEventListener?.('visibilitychange', visibilite);
    this._debrancher = () => {
      win?.removeEventListener?.('online', enLigne);
      win?.removeEventListener?.('pagehide', cacher);
      doc?.removeEventListener?.('visibilitychange', visibilite);
      this._debrancher = null;
    };
    return this._debrancher;
  }

  // Arrête la minuterie et les écouteurs (fin d'utilisation, tests).
  arreter() {
    this._annulerMinuterie();
    this._debrancher?.();
  }
}
