// Voix : écoute (reconnaissance vocale), parole (synthèse), commandes orales, lettres de QCM, écran allumé.
// Aucun accès au navigateur au chargement : les API passent par des paramètres injectables.
import { normaliser } from './texte.js';

// Minuteries par défaut, lues au moment de l'appel (remplaçables dans les tests).
const HORLOGE = {
  setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
  clearTimeout: id => globalThis.clearTimeout(id),
};

export function reconnaissanceDisponible(win = globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

// ---------- Messages d'erreur du micro (le problème et ce qu'il faut faire) ----------

export const MESSAGES_ECOUTE = {
  'not-allowed': "Le micro est bloqué pour ce site. Autorise-le dans les réglages du navigateur (icône à gauche de l'adresse). Sur iPhone, active aussi Siri et Dictée.",
  'service-not-allowed': "La reconnaissance vocale n'est pas disponible ici. Sur iPhone : active Dictée (Réglages › Général › Clavier) et Siri, ou ouvre Rappel dans Safari plutôt que depuis l'écran d'accueil.",
  'audio-capture': "Aucun micro trouvé. Vérifie qu'il est branché et qu'aucune autre appli ne l'utilise.",
  'network': "La reconnaissance vocale a besoin d'Internet, et la connexion ne passe pas.",
  'aborted': "L'écoute a été interrompue.",
  'language-not-supported': "Le français n'est pas disponible pour la reconnaissance vocale sur cet appareil.",
  'indisponible': "Ce navigateur ne reconnaît pas la voix. Utilise Chrome, Edge ou Safari, ou le micro de ton clavier.",
  'demarrage': "Le micro n'a pas pu démarrer.",
};

export function messageEcoute(code) {
  return MESSAGES_ECOUTE[code] || 'Le micro a eu un problème.';
}

// ---------- Assemblage du texte reconnu ----------

// Ajoute un segment au texte déjà reconnu. Chrome Android renvoie parfois des segments cumulés
// (« le cœur » puis « le cœur bat vite ») ou répétés : on remplace ou on ignore au lieu d'ajouter.
export function fusionner(base, ajout) {
  const a = String(base || '').trim(), b = String(ajout || '').trim();
  if (!b) return a;
  if (!a) return b;
  const na = normaliser(a), nb = normaliser(b);
  if (!nb) return a;
  if (na === nb || na.endsWith(' ' + nb)) return a;   // doublon
  const ma = na.split(' '), mb = nb.split(' ');
  if (mb.length >= ma.length) {
    let pareils = 0;
    for (let i = 0; i < ma.length; i++) if (ma[i] === mb[i]) pareils++;
    if (pareils >= Math.ceil(ma.length * 0.6)) return b;   // segment cumulé : il contient déjà le début
  }
  return a + ' ' + b;
}

// ---------- Écoute ----------

// Événements : 'partiel' (detail : texte en cours), 'fin' (detail : texte final),
// 'erreur' (detail : {code, message}). demarrer() résout toujours avec le texte (vide si rien ou erreur) ;
// après une erreur, ecoute.erreur vaut {code, message}.
export class Ecoute extends EventTarget {
  constructor({ lang = 'fr-FR', silence = 2500, attente = 8000, Reco, horloge = HORLOGE } = {}) {
    super();
    this.lang = lang;
    this.silence = silence;     // ms sans nouveau résultat avant d'arrêter
    this.attente = attente;     // ms d'attente tant que rien n'a été dit
    this.Reco = Reco === undefined ? reconnaissanceDisponible() : Reco;
    this.horloge = horloge;
    this.erreur = null;
    this._s = null;             // écoute en cours
  }

  get active() {
    return !!this._s;
  }

  // options : {attente} pour changer l'attente du début (ex. 3 s après un verdict).
  demarrer({ attente } = {}) {
    if (this._s) return this._s.promesse;
    this.erreur = null;
    let resoudre;
    const promesse = new Promise(r => { resoudre = r; });
    const s = this._s = { promesse, resoudre, acquis: '', final: '', provisoire: '', reco: null, minuterie: null, garde: null, fin: false, relances: 0 };
    if (!this.Reco) {
      this._conclure(s, 'indisponible');
      return promesse;
    }
    this._armer(s, attente ?? this.attente);
    this._lancer(s);
    return promesse;
  }

  // Bouton « stop » : garde ce qui a été dit.
  arreter() {
    const s = this._s;
    if (s && !s.fin) this._couper(s, !this._texte(s));
  }

  // Abandon : rien n'est gardé.
  annuler() {
    const s = this._s;
    if (!s) return;
    s.fin = true;
    s.acquis = s.final = s.provisoire = '';
    try { s.reco?.abort(); } catch { /* déjà arrêtée */ }
    this._conclure(s);
  }

  _texte(s) {
    return fusionner(fusionner(s.acquis, s.final), s.provisoire);
  }

  // Un cycle de reconnaissance (continuous = false) ; relancé tant que l'utilisateur parle.
  _lancer(s) {
    try {
      const reco = new this.Reco();
      reco.lang = this.lang;
      reco.continuous = false;
      reco.interimResults = true;
      reco.maxAlternatives = 1;
      reco.onresult = e => this._resultat(s, reco, e);
      reco.onerror = e => this._erreurReco(s, reco, e);
      reco.onend = () => this._finCycle(s, reco);
      s.reco = reco;
      reco.start();
    } catch {
      if (this._texte(s)) this._conclure(s);
      else this._echouer(s, 'demarrage');
    }
  }

  // Le texte est reconstruit depuis le début de event.results à chaque fois.
  _resultat(s, reco, e) {
    if (s !== this._s || reco !== s.reco) return;
    let final = '', provisoire = '';
    const res = e?.results || [];
    for (let i = 0; i < res.length; i++) {
      const t = String(res[i]?.[0]?.transcript || '').trim();
      if (!t) continue;
      if (res[i].isFinal) final = fusionner(final, t);
      else provisoire = fusionner(provisoire, t);
    }
    s.final = final;
    s.provisoire = provisoire;
    const texte = this._texte(s);
    if (texte && !s.fin) this._armer(s, this.silence);
    this.dispatchEvent(new CustomEvent('partiel', { detail: texte }));
  }

  _erreurReco(s, reco, e) {
    if (s !== this._s || reco !== s.reco) return;
    const code = e?.error || 'inconnue';
    if (code === 'no-speech') return;           // rien entendu : le cycle se relance, la minuterie décide
    if (code === 'aborted' && s.fin) return;    // arrêt demandé par nous
    this._echouer(s, code);
  }

  _finCycle(s, reco) {
    if (s !== this._s || reco !== s.reco) return;
    s.acquis = this._texte(s);
    s.final = s.provisoire = '';
    if (s.fin || ++s.relances > 60) return this._conclure(s);
    this._lancer(s);
  }

  _armer(s, ms) {
    this.horloge.clearTimeout(s.minuterie);
    s.minuterie = this.horloge.setTimeout(() => {
      if (s === this._s && !s.fin) this._couper(s, !this._texte(s));
    }, ms);
  }

  // Fin demandée (silence ou bouton). net : rien à garder, on coupe tout de suite.
  _couper(s, net) {
    s.fin = true;
    this.horloge.clearTimeout(s.minuterie);
    if (net) {
      try { s.reco?.abort(); } catch { /* déjà arrêtée */ }
      return this._conclure(s);
    }
    try { s.reco?.stop(); } catch { return this._conclure(s); }
    // Le dernier résultat arrive avec onend ; s'il manque, on conclut quand même.
    s.garde = this.horloge.setTimeout(() => this._conclure(s), 1500);
  }

  _echouer(s, code) {
    s.fin = true;
    try { s.reco?.abort(); } catch { /* déjà arrêtée */ }
    this._conclure(s, code);
  }

  _conclure(s, code) {
    if (s !== this._s) return;
    this._s = null;
    this.horloge.clearTimeout(s.minuterie);
    this.horloge.clearTimeout(s.garde);
    if (s.reco) s.reco.onresult = s.reco.onerror = s.reco.onend = null;
    const texte = this._texte(s);
    if (code) {
      this.erreur = { code, message: messageEcoute(code) };
      this.dispatchEvent(new CustomEvent('erreur', { detail: this.erreur }));
    } else {
      this.dispatchEvent(new CustomEvent('fin', { detail: texte }));
    }
    s.resoudre(texte);
  }
}

// ---------- Parole ----------

const estFr = v => /^fr\b/i.test(String(v?.lang || '').replace('_', '-'));
const estFrFr = v => /^fr-fr$/i.test(String(v?.lang || '').replace('_', '-'));

// Voix retenue : celle des réglages, sinon une voix locale fr-FR, sinon toute voix fr-FR, sinon toute voix fr.
export function choisirVoix(voix, nom = '') {
  const liste = Array.from(voix || []);
  if (nom) {
    const v = liste.find(x => x.name === nom);
    if (v) return v;
  }
  const parDefaut = (a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0);
  return liste.filter(v => estFrFr(v) && v.localService).sort(parDefaut)[0]
    || liste.filter(estFrFr).sort(parDefaut)[0]
    || liste.filter(estFr).sort(parDefaut)[0]
    || null;
}

// Découpe un texte en énoncés courts (Chrome coupe une lecture de plus de 15 s environ) :
// par phrases, puis par virgules, puis par mots ; les phrases courtes voisines sont regroupées.
export function decouperPhrases(texte, max = 160) {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim();
  if (!propre) return [];
  const morceaux = [];
  for (const phrase of propre.split(/(?<=[.!?…])\s+/)) {
    if (phrase.length <= max) { morceaux.push(phrase); continue; }
    for (const partie of phrase.split(/(?<=[,;:])\s+/)) {
      if (partie.length <= max) { morceaux.push(partie); continue; }
      let bloc = '';
      for (const mot of partie.split(' ')) {
        if (bloc && bloc.length + 1 + mot.length > max) { morceaux.push(bloc); bloc = mot; }
        else bloc = bloc ? bloc + ' ' + mot : mot;
      }
      if (bloc) morceaux.push(bloc);
    }
  }
  const sortie = [];
  for (const m of morceaux) {
    const dernier = sortie[sortie.length - 1];
    if (dernier && dernier.length + 1 + m.length <= max) sortie[sortie.length - 1] = dernier + ' ' + m;
    else sortie.push(m);
  }
  return sortie;
}

// Durée maximale d'un énoncé, au cas où onend ne viendrait pas (≈ 0,5 s + 90 ms par caractère).
export function dureeMax(texte, vitesse = 1) {
  return Math.round(500 + 90 * String(texte || '').length / Math.max(0.1, vitesse || 1));
}

const DEMARRAGE_MAX = 1500;   // marge si l'énoncé tarde à commencer (voix en ligne)

export class Parole {
  constructor({ vitesse = 1, voixNom = '', synth, Utterance, horloge = HORLOGE, lang = 'fr-FR' } = {}) {
    this.vitesse = vitesse;
    this.voixNom = voixNom;
    this.synth = synth === undefined ? globalThis.speechSynthesis ?? null : synth;
    this.Utterance = Utterance === undefined ? globalThis.SpeechSynthesisUtterance ?? null : Utterance;
    this.horloge = horloge;
    this.lang = lang;
    this._jeton = 0;
    this._fin = null;
    this._enCours = null;
  }

  get disponible() {
    return !!(this.synth && this.Utterance);
  }

  _voix() {
    try { return Array.from(this.synth?.getVoices?.() || []); } catch { return []; }
  }

  // Voix françaises [{nom, lang, locale}] ; attend le chargement des voix (voiceschanged) si besoin.
  async voixFrancaises(delai = 2000) {
    if (!this.synth) return [];
    let voix = this._voix();
    if (!voix.length) {
      await new Promise(resoudre => {
        let fini = false, minuterie = null;
        const fin = () => {
          if (fini) return;
          fini = true;
          this.horloge.clearTimeout(minuterie);
          try { this.synth.removeEventListener?.('voiceschanged', fin); } catch { /* rien */ }
          resoudre();
        };
        if (this.synth.addEventListener) this.synth.addEventListener('voiceschanged', fin);
        else this.synth.onvoiceschanged = fin;
        minuterie = this.horloge.setTimeout(fin, delai);
      });
      voix = this._voix();
    }
    return voix.filter(estFr)
      .sort((a, b) => (estFrFr(b) - estFrFr(a)) || ((b.localService ? 1 : 0) - (a.localService ? 1 : 0)) || String(a.name).localeCompare(String(b.name)))
      .map(v => ({ nom: v.name, lang: String(v.lang).replace('_', '-'), locale: !!v.localService }));
  }

  // iOS : la première lecture doit partir d'un geste. À appeler au tout début du gestionnaire du toucher.
  debloquer() {
    if (this._debloque || !this.disponible) return;
    this._debloque = true;
    try {
      const u = new this.Utterance(' ');
      u.volume = 0;
      u.lang = this.lang;
      this.synth.speak(u);
    } catch { /* sans conséquence */ }
  }

  // Lit le texte et résout à la fin (ou dès arreter()). Ne rejette jamais.
  async dire(texte) {
    const jeton = ++this._jeton;
    if (!this.disponible) return;
    const max = Math.max(60, Math.round(160 * Math.min(1, this.vitesse || 1)));
    const phrases = decouperPhrases(texte, max);
    if (!phrases.length) return;
    try { if (this.synth.speaking || this.synth.pending) this.synth.cancel(); } catch { /* rien */ }
    const voix = choisirVoix(this._voix(), this.voixNom);
    for (const phrase of phrases) {
      if (jeton !== this._jeton) return;
      await this._enonce(phrase, voix);
    }
  }

  _enonce(texte, voix) {
    return new Promise(resoudre => {
      let fini = false, minuterie = null;
      const finir = () => {
        if (fini) return;
        fini = true;
        this.horloge.clearTimeout(minuterie);
        if (this._fin === finir) this._fin = null;
        this._enCours = null;
        resoudre();
      };
      const armer = ms => {
        this.horloge.clearTimeout(minuterie);
        minuterie = this.horloge.setTimeout(() => {
          if (fini) return;
          try { this.synth.cancel(); } catch { /* rien */ }
          finir();
        }, ms);
      };
      let u;
      try {
        u = new this.Utterance(texte);
        u.lang = voix?.lang ? String(voix.lang).replace('_', '-') : this.lang;
        if (voix) u.voice = voix;
        u.rate = this.vitesse || 1;
        u.onstart = () => { if (!fini) armer(dureeMax(texte, this.vitesse)); };
        u.onend = finir;
        u.onerror = finir;
      } catch {
        return finir();
      }
      this._enCours = u;   // garde une référence : sinon Chrome peut perdre onend
      this._fin = finir;
      armer(dureeMax(texte, this.vitesse) + DEMARRAGE_MAX);
      try { this.synth.speak(u); } catch { finir(); }
    });
  }

  arreter() {
    this._jeton++;
    try { this.synth?.cancel(); } catch { /* rien */ }
    const fin = this._fin;
    this._fin = null;
    fin?.();
  }
}

// ---------- Commandes orales ----------

const COMMANDES = {
  'je-ne-sais-pas': ['je ne sais pas', 'je sais pas', 'sais pas', 'j sais pas', 'jsais pas', 'chais pas', 'je ne sais plus',
    'je sais plus', 'je ne sais pas du tout', 'je sais pas du tout', 'aucune idee', 'pas d idee', 'j en sais rien',
    'je n en sais rien', 'je passe', 'passe', 'joker', 'j ai oublie', 'je seche'],
  'repete': ['repete', 'repetes', 'repeter', 'repete la question', 'repete encore', 'repete encore une fois', 'tu peux repeter',
    'tu peux repeter la question', 'peux tu repeter', 'peux tu repeter la question', 'tu peux redire', 'encore',
    'encore une fois', 'redis', 'redis la question', 'relis', 'relis la question', 'pardon', 'comment', 'quoi'],
  'suivant': ['suivant', 'suivante', 'carte suivante', 'question suivante', 'on passe', 'au suivant', 'a la suivante',
    'la suivante', 'passe a la suivante', 'passe a la suite', 'on passe a la suite', 'on passe a la suivante', 'la suite', 'next'],
  'pause': ['pause', 'une pause', 'stop pause', 'fais une pause', 'on fait une pause', 'faire une pause', 'mets en pause',
    'met en pause', 'mettre en pause', 'attends', 'attend', 'attendez', 'attends un peu', 'attends une seconde',
    'attends une minute', 'une seconde', 'une minute'],
  'reprendre': ['reprendre', 'reprends', 'reprend', 'on reprend', 'reprise', 'continue', 'continuer', 'on continue', 'continuons',
    'c est reparti'],
  'conteste': ['je conteste', 'contestation', 'je ne suis pas d accord', 'je suis pas d accord', 'pas d accord', 'conteste',
    'contester', 'je veux contester'],
  'stop': ['arrete', 'arreter', 'arretes', 'stop', 'terminer', 'fin', 'on arrete', 'j arrete', 'je m arrete', 'on s arrete',
    'arrete tout', 'fin de la seance', 'terminer la seance', 'arreter la seance', 'quitter'],
};
const TABLE = new Map();
for (const [cmd, phrases] of Object.entries(COMMANDES)) for (const p of phrases) TABLE.set(p, cmd);

const AVANT = new Set(['euh', 'heu', 'hum', 'hm', 'hmm', 'bon', 'ben', 'bah', 'alors', 'ok', 'okay', 'oui', 'non', 'ah', 'oh', 'eh', 'et', 'mais', 'donc']);
const APRES = ['s il te plait', 's il vous plait', 'stp', 'svp', 'merci', 'please'];

// Énoncé normalisé sans mots de remplissage autour ni politesse ; « stop stop » → « stop ».
function nettoyer(texte) {
  let n = normaliser(texte);
  for (let change = true; change;) {
    change = false;
    const mots = n.split(' ');
    if (mots.length > 1 && AVANT.has(mots[0])) { n = mots.slice(1).join(' '); change = true; }
    for (const p of APRES) {
      if (n !== p && n.endsWith(' ' + p)) { n = n.slice(0, -p.length - 1); change = true; }
    }
  }
  const mots = n.split(' ');
  if (mots.length % 2 === 0 && mots.length > 1) {
    const moitie = mots.slice(0, mots.length / 2).join(' ');
    if (moitie === mots.slice(mots.length / 2).join(' ')) n = moitie;
  }
  return n;
}

// Commande si l'énoncé entier en est une ; une phrase qui contient aussi une réponse n'en est pas une.
export function commande(texte) {
  const n = nettoyer(texte);
  return n ? TABLE.get(n) ?? null : null;
}

// « OK, j'ai lu » : accord pour continuer (après une fiche ou une pause).
const ACCORDS = new Set(['ok', 'okay', 'd accord', 'c est bon', 'vas y', 'go', 'allez', 'allez y', 'on y va', 'c est parti',
  'j ai lu', 'lu', 'c est lu', 'j ai fini', 'fini', 'j ai termine', 'termine', 'je suis pret', 'je suis prete', 'pret', 'prete', 'oui']);
export function estAccord(texte) {
  const n = normaliser(texte);
  return ACCORDS.has(n) || ACCORDS.has(nettoyer(texte));
}

// ---------- Lettres de QCM ----------

const LETTRES = {
  a: 'A', ah: 'A', ha: 'A',
  b: 'B', be: 'B', bee: 'B',
  c: 'C', ce: 'C', ces: 'C', ses: 'C', sait: 'C', se: 'C',
  d: 'D', de: 'D', des: 'D',
  e: 'E', eu: 'E', euh: 'E', heu: 'E', eux: 'E',
};
const LIAISONS = new Set(['et', 'la', 'le', 'les', 'l', 'reponse', 'reponses', 'proposition', 'propositions', 'lettre', 'lettres',
  'item', 'items', 'je', 'dirais', 'dis', 'choisis', 'coche', 'cocher', 'prends', 'donc', 'alors', 'bon', 'ben', 'bah', 'hum',
  'ok', 'plus', 'aussi', 'avec', 'puis', 'virgule', 'point', 'sont', 'vraies', 'vraie', 'vrais', 'vrai', 'justes', 'juste',
  'ma', 'mes', 'mon', 'choix', 'seulement', 'uniquement', 'que']);
const TOUTES = new Set(['toutes', 'tout', 'toutes les reponses', 'toutes les propositions', 'toutes les lettres', 'tout est vrai',
  'toutes vraies', 'toutes sont vraies', 'les cinq', 'toutes les cinq', 'a b c d e']);

function lettresDe(mots) {
  const estLettre = x => !!LETTRES[x] || /^[a-e]{2,5}$/.test(x);
  const vues = [];
  for (let i = 0; i < mots.length; i++) {
    const m = mots[i];
    const suite = mots.slice(i + 1).some(estLettre);
    // « c'est A et C » : « c'est » en tête est un verbe ; seul ou après une lettre, c'est la lettre C.
    if ((m === 'c' || m === 's') && mots[i + 1] === 'est') {
      if (!(i === 0 && mots.slice(i + 2).some(estLettre))) vues.push('C');
      i++;
      continue;
    }
    if ((m === 'euh' || m === 'heu') && i === 0 && suite) continue;   // hésitation
    if (LETTRES[m]) { vues.push(LETTRES[m]); continue; }
    if (/^[a-e]{2,5}$/.test(m) && new Set(m).size === m.length) { vues.push(...m.toUpperCase()); continue; }
    if (LIAISONS.has(m)) continue;
    return null;   // mot inconnu : on ne devine pas
  }
  return vues;
}

// Lettres cochées, triées et uniques (['A','C']), ou null si rien de clair.
export function lettresQcm(texte) {
  const n = normaliser(texte).replace(/ c est tout$/, '');
  if (!n) return null;
  if (TOUTES.has(n)) return ['A', 'B', 'C', 'D', 'E'];
  const sauf = n.match(/^(?:toutes|tout) (?:les reponses |les propositions )?sauf (.+)$/);
  if (sauf) {
    const exclues = lettresDe(sauf[1].split(' '));
    if (!exclues?.length) return null;
    const reste = ['A', 'B', 'C', 'D', 'E'].filter(l => !exclues.includes(l));
    return reste.length ? reste : null;
  }
  const vues = lettresDe(n.split(' '));
  if (!vues?.length) return null;
  return [...new Set(vues)].sort();
}

// ---------- Écran allumé ----------

// Garde l'écran allumé (Wake Lock) ; le reprend au retour au premier plan. Renvoie la fonction de libération.
export async function verrouEcran(nav = globalThis.navigator, doc = globalThis.document) {
  let voulu = true, verrou = null, demande = null;
  const prendre = () => {
    if (!voulu || verrou || demande || !nav?.wakeLock?.request) return demande;
    if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return null;
    demande = (async () => {
      try {
        const v = await nav.wakeLock.request('screen');
        if (!voulu) { try { await v.release(); } catch { /* rien */ } return; }
        verrou = v;
        v.addEventListener?.('release', () => { if (verrou === v) verrou = null; });
      } catch {
        verrou = null;   // refusé (économie d'énergie, page cachée) : on réessaiera au retour
      } finally {
        demande = null;
      }
    })();
    return demande;
  };
  const surVisibilite = () => {
    if (doc?.visibilityState === 'visible') prendre();
  };
  doc?.addEventListener?.('visibilitychange', surVisibilite);
  await prendre();
  return async function liberer() {
    voulu = false;
    doc?.removeEventListener?.('visibilitychange', surVisibilite);
    const v = verrou;
    verrou = null;
    try { await v?.release(); } catch { /* déjà libéré */ }
  };
}
