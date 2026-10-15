// Séance de révision : ce qu'il y a à faire aujourd'hui, file des cartes, étapes et notes.
// Module pur : aucun accès au DOM ; horloge et aléa sont injectés.
import { review, noteDe, estDisponible, estAcquise } from './fsrs.js';
import { MIN, jourParis, debutJourParis, finJourParis, isoParis } from './temps.js';

const NOUVELLES_DEFAUT = 15;
const PAUSE_DEFAUT = 30;
const EN_AVANCE = 20;   // révisions proposées en avance quand rien n'est dû
const RECUL_FAUX = 4;   // une carte fausse revient 4 positions plus loin (comme v1)

const estContestation = l => l.correcteur === 'contestation' || l.remplace != null;
// Compteur du bilan qui correspond à un verdict (même règle que noter : par la note).
const compteurDe = verdict => { const n = noteDe(verdict); return n >= 3 ? 'justes' : n === 2 ? 'partielles' : 'fausses'; };
const dansFiltre = (filtre, paquet) => !filtre || filtre === 'tout' || filtre === paquet;
const etatStocke = (donnees, paquet, id) => donnees.srs?.[paquet]?.[id] ?? null;

function nombre(valeur, defaut) {
  const n = Number(valeur);
  return valeur != null && Number.isFinite(n) ? n : defaut;
}

// Paquets dans l'ordre de donnees.ordre, puis ceux qui n'y figurent pas (par identifiant).
function paquetsOrdonnes(donnees) {
  const paquets = donnees.paquets || {};
  const pris = new Set();
  for (const id of donnees.ordre || []) if (paquets[id]) pris.add(id);
  for (const id of Object.keys(paquets).sort()) pris.add(id);
  return [...pris];
}

// Toutes les cartes des paquets retenus par le filtre, dans l'ordre.
function* cartesDe(donnees, filtre) {
  for (const paquet of paquetsOrdonnes(donnees)) {
    if (!dansFiltre(filtre, paquet)) continue;
    for (const carte of donnees.paquets[paquet].cartes || []) {
      if (carte && carte.id != null) yield { paquet, carte };
    }
  }
}

// Micro-fiche d'une carte : la sienne si elle existe, sinon celle du paquet, sinon aucune.
function ficheDe(donnees, carte, paquet) {
  const fiches = donnees.fiches || {};
  if (carte?.fiche && fiches[carte.fiche]) return carte.fiche;
  if (fiches[paquet]) return paquet;
  return null;
}

function melanger(liste, rnd) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Comme v1 : évite deux cartes du même thème à la suite en échangeant avec la suivante d'un autre thème.
function espacer(file, cle) {
  for (let i = 1; i < file.length; i++) {
    if (cle(file[i]) !== cle(file[i - 1])) continue;
    const j = file.findIndex((y, k) => k > i && cle(y) !== cle(file[i - 1]));
    if (j > 0) [file[i], file[j]] = [file[j], file[i]];
  }
  return file;
}

// Nombre de cartes distinctes vues pour la première fois aujourd'hui (une contestation ne change rien),
// plus les nouvelles faites dans v1 ce jour-là (historique, jour de bascule).
export function nouvellesDuJour(donnees, maintenant) {
  const debut = debutJourParis(maintenant), fin = finJourParis(maintenant);
  const cartes = new Set();
  for (const l of donnees.reponses || []) {
    if (l.nouvelle === true && !estContestation(l) && l.ts >= debut && l.ts < fin) cartes.add(l.carte);
  }
  const v1 = Number(donnees.historique?.days?.[jourParis(maintenant)]?.nw);
  return cartes.size + (Number.isFinite(v1) && v1 > 0 ? v1 : 0);
}

// Règle de déblocage (depuis le 15 oct. 2026) : révisions du jour encore à faire = cartes dues au plus tard
// aujourd'hui et pas encore répondues aujourd'hui.
export function revisionsRestantes(donnees, maintenant) {
  const debut = debutJourParis(maintenant), fin = finJourParis(maintenant);
  let n = 0;
  for (const cartes of Object.values(donnees.srs || {})) {
    for (const etat of Object.values(cartes || {})) if (etat && etat.due < fin && etat.last < debut) n++;
  }
  return n;
}

// Ancienne règle (jusqu'au 14 oct.) : cartes dont la dernière réponse d'aujourd'hui est juste ou partielle.
export function acquisesDuJour(donnees, maintenant) {
  const jour = jourParis(maintenant);
  let n = 0;
  for (const cartes of Object.values(donnees.srs || {})) {
    for (const etat of Object.values(cartes || {})) if (estAcquise(etat, jour)) n++;
  }
  return n;
}

export function aReviser(donnees, maintenant, filtre = 'tout') {
  const res = [];
  for (const { paquet, carte } of cartesDe(donnees, filtre)) {
    if (estDisponible(etatStocke(donnees, paquet, carte.id), maintenant)) res.push({ paquet, carteId: carte.id });
  }
  return res;
}

export function nouvellesPossibles(donnees, maintenant, filtre = 'tout') {
  const limite = nombre(donnees.reglages?.nouvellesParJour, NOUVELLES_DEFAUT);
  const reste = Math.max(0, limite - nouvellesDuJour(donnees, maintenant));
  const res = [];
  if (!reste) return res;
  for (const { paquet, carte } of cartesDe(donnees, filtre)) {
    if (etatStocke(donnees, paquet, carte.id)) continue;
    res.push({ paquet, carteId: carte.id });
    if (res.length >= reste) break;
  }
  return res;
}

// Les révisions les plus proches, pour « Réviser en avance ».
function plusProches(donnees, filtre, n) {
  const res = [];
  for (const { paquet, carte } of cartesDe(donnees, filtre)) {
    const etat = etatStocke(donnees, paquet, carte.id);
    if (etat) res.push({ paquet, carteId: carte.id, due: etat.due });
  }
  return res.sort((a, b) => a.due - b.due).slice(0, n).map(({ paquet, carteId }) => ({ paquet, carteId }));
}

// Retire les champs absents pour garder des lignes de journal compactes.
function sansVide(objet) {
  for (const k of Object.keys(objet)) if (objet[k] === undefined) delete objet[k];
  return objet;
}

export class Seance {
  // maintenant : ms, ou une fonction qui renvoie l'heure (horloge injectée).
  constructor({ donnees, maintenant = Date.now(), filtre = 'tout', enAvance = false, nouvellesDAbord = false, rnd = Math.random }) {
    this.donnees = donnees;
    this.horloge = typeof maintenant === 'function' ? maintenant : null;
    const t0 = this.horloge ? this.horloge() : maintenant;
    this.debut = t0;
    this.dernier = t0;
    this.filtre = filtre;
    this.faites = 0;
    this.justes = 0;
    this.partielles = 0;
    this.fausses = 0;
    this.i = 0;
    this.fichesMontrees = new Set();
    this.fichesRatees = [];
    this.ratesParFiche = new Map();   // ficheId → réponses fausses de la séance (pour les fiches à relire)
    this.locaux = new Map();   // états calculés ici, tant que donnees.srs ne les a pas encore
    this.pauseA = this.pas();

    let revisions = aReviser(donnees, t0, filtre);
    this.enAvance = false;
    if (!revisions.length && enAvance) {
      revisions = plusProches(donnees, filtre, EN_AVANCE);
      this.enAvance = revisions.length > 0;
    }
    const cle = el => this.carteDe(el)?.fiche || el.paquet;
    revisions = espacer(melanger(revisions, rnd), cle);
    const nouvelles = nouvellesPossibles(donnees, t0, filtre);
    this.file = nouvellesDAbord ? [...nouvelles, ...revisions] : [...revisions, ...nouvelles];   // l'appli : nouvelles d'abord (15/10)
  }

  // Nouvelles données (synchro) : la séance les relit à chaque étape.
  majDonnees(donnees) {
    this.donnees = donnees;
  }

  pas() {
    const n = nombre(this.donnees.reglages?.pauseToutes, PAUSE_DEFAUT);
    return n > 0 ? n : Infinity;
  }

  heure() {
    return this.horloge ? this.horloge() : this.dernier;
  }

  minutes() {
    const m = Math.round((this.heure() - this.debut) / MIN);
    return this.faites ? Math.max(1, m) : Math.max(0, m);
  }

  carteDe(el) {
    const entree = this.donnees.cartes?.[el.carteId];
    if (entree && entree.paquet === el.paquet && entree.carte) return entree.carte;
    return (this.donnees.paquets?.[el.paquet]?.cartes || []).find(c => c && c.id === el.carteId) ?? null;
  }

  // État le plus récent : celui des données, ou celui calculé dans la séance s'il est plus récent.
  etatDe(el) {
    const stocke = etatStocke(this.donnees, el.paquet, el.carteId);
    const local = this.locaux.get(el.paquet + '/' + el.carteId);
    if (!local) return stocke;
    if (!stocke) return local;
    return local.last > stocke.last ? local : stocke;
  }

  // Élément en cours, après avoir écarté les cartes disparues des données.
  courant() {
    while (this.i < this.file.length && !this.carteDe(this.file[this.i])) this.file.splice(this.i, 1);
    return this.file[this.i] ?? null;
  }

  etape() {
    const el = this.courant();
    if (!el) return { type: 'fin', bilan: this.bilan };
    if (this.faites >= this.pauseA) return { type: 'pause', faites: this.faites, minutes: this.minutes() };
    const carte = this.carteDe(el);
    const etat = this.etatDe(el);
    const nouvelle = !etat;
    if (nouvelle) {
      const ficheId = ficheDe(this.donnees, carte, el.paquet);
      if (ficheId && !this.fichesMontrees.has(ficheId)) return { type: 'fiche', ficheId, paquet: el.paquet };
    }
    const total = this.file.length;
    // restantes : cartes encore à faire, celle-ci comprise.
    return { type: 'carte', paquet: el.paquet, carte, etat, nouvelle, rang: this.i + 1, total, restantes: total - this.i };
  }

  ficheVue() {
    const el = this.courant();
    if (!el) return;
    const ficheId = ficheDe(this.donnees, this.carteDe(el), el.paquet);
    if (ficheId) this.fichesMontrees.add(ficheId);
  }

  continuer() {
    this.pauseA = Math.max(this.pauseA, this.faites) + this.pas();
  }

  noter({ verdict, correcteur, reponse = '', duree, confiance, maintenant, appareil = 'inconnu' }) {
    const el = this.courant();
    if (!el) throw new Error('La séance est terminée : plus aucune carte à noter.');
    const t = maintenant ?? (this.horloge ? this.horloge() : Date.now());
    const etatAvant = this.etatDe(el);
    const note = noteDe(verdict);
    const etatApres = review(etatAvant, note, t);
    this.locaux.set(el.paquet + '/' + el.carteId, etatApres);

    const ligne = sansVide({
      id: `${appareil}-${t}`, ts: t, t: isoParis(t), appareil, paquet: el.paquet, carte: el.carteId,
      reponse, verdict, correcteur, note, nouvelle: !etatAvant, duree, confiance,
    });
    const ops = [
      { type: 'srs', paquet: el.paquet, carte: el.carteId, etat: etatApres },
      { type: 'reponse', ligne },
    ];

    const compteur = compteurDe(verdict);
    this[compteur]++;
    if (compteur === 'fausses') {
      this.compterRatee(ficheDe(this.donnees, this.carteDe(el), el.paquet), 1);
      this.file.splice(Math.min(this.i + RECUL_FAUX, this.file.length), 0, { paquet: el.paquet, carteId: el.carteId });
    }
    this.i++;
    this.faites++;
    this.dernier = Math.max(this.dernier, t);
    return { etatAvant, etatApres, ligne, ops };
  }

  // Fiches à relire : une fiche y figure tant qu'une réponse fausse de la séance s'y rattache.
  compterRatee(ficheId, delta) {
    if (!ficheId) return;
    const n = Math.max(0, (this.ratesParFiche.get(ficheId) || 0) + delta);
    this.ratesParFiche.set(ficheId, n);
    const i = this.fichesRatees.indexOf(ficheId);
    if (n > 0 && i < 0) this.fichesRatees.push(ficheId);
    else if (n === 0 && i >= 0) this.fichesRatees.splice(i, 1);
  }

  // Cartes encore à faire, celle affichée comprise (0 quand la séance est finie).
  restantes() {
    return this.courant() ? this.file.length - this.i : 0;
  }

  // Nouvelles cartes encore à venir (celle affichée comprise) qui se rattachent à cette micro-fiche.
  nouvellesDeFiche(ficheId) {
    if (!ficheId) return 0;
    const vues = new Set();
    for (let k = this.i; k < this.file.length; k++) {
      const el = this.file[k];
      const cle = el.paquet + '/' + el.carteId;
      if (vues.has(cle)) continue;
      const carte = this.carteDe(el);
      if (carte && !this.etatDe(el) && ficheDe(this.donnees, carte, el.paquet) === ficheId) vues.add(cle);
    }
    return vues.size;
  }

  // Après une contestation acceptée : la réponse notée « ancien » vaut désormais « nouveau ».
  // Si elle n'est plus fausse, la reprise prévue plus loin est retirée (la carte ne revient pas)
  // et sa fiche quitte les fiches à relire ; le bilan est mis à jour. Renvoie true si une reprise a été retirée.
  corrigerVerdict(paquet, carteId, ancien, nouveau) {
    const avant = compteurDe(ancien), apres = compteurDe(nouveau);
    if (avant === apres) return false;
    let retiree = false;
    if (avant === 'fausses') {
      const j = this.file.findIndex((el, k) => k >= this.i && el.paquet === paquet && el.carteId === carteId);
      if (j >= 0) { this.file.splice(j, 1); retiree = true; }
    }
    this[avant] = Math.max(0, this[avant] - 1);
    this[apres]++;
    const carte = this.carteDe({ paquet, carteId });
    const ficheId = carte ? ficheDe(this.donnees, carte, paquet) : null;
    if (avant === 'fausses') this.compterRatee(ficheId, -1);
    else if (apres === 'fausses') this.compterRatee(ficheId, 1);
    return retiree;
  }

  // « Suivant » sans réponse : la carte part en fin de file, sans note.
  passer() {
    const el = this.courant();
    if (!el) return;
    this.file.splice(this.i, 1);
    this.file.push(el);
  }

  get bilan() {
    return {
      faites: this.faites, justes: this.justes, partielles: this.partielles, fausses: this.fausses,
      minutes: this.minutes(), fichesARelire: this.fichesRatees.slice(),
    };
  }
}
