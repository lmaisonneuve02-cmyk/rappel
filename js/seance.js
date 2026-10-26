// Séance de révision : ce qu'il y a à faire aujourd'hui, file des cartes, étapes et notes.
// Module pur : aucun accès au DOM ; horloge et aléa sont injectés.
import { review, noteDe, estDisponible } from './fsrs.js';
import { MIN, jourParis, debutJourParis, finJourParis, isoParis, decalerJour } from './temps.js';

const NOUVELLES_DEFAUT = 15;
const PAUSE_DEFAUT = 30;
const EN_AVANCE = 20;   // révisions proposées en avance quand rien n'est dû
const RECUL_FAUX = 4;   // une carte fausse revient 4 positions plus loin (comme v1)
// Jour du changement de règle (16 oct. 2026, règle notée par l'utilisateur) : seul le total compte,
// car Rappel 2 lui avait servi les nouvelles cartes en premier ce jour-là.
export const JOURS_TOTAL_SEUL = new Set(['2026-10-16']);
// QCM des cartes (décision du 26 oct. 2026) : une carte répondue seulement en QCM ce jour-là compte
// dans l'objectif, mais au plus QCM_MAX par jour (révisions d'abord) ; l'appli n'en propose pas plus.
export const QCM_MAX = 20;

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

// Clé d'une carte dans le journal (identifiants uniques par paquet).
const cleLigne = l => `${l.paquet}/${l.carte}`;

// Lignes du journal d'aujourd'hui (heure de Paris), contestations exclues.
function lignesDuJour(donnees, maintenant) {
  const debut = debutJourParis(maintenant), fin = finJourParis(maintenant);
  return (donnees.reponses || []).filter(l => l && !estContestation(l) && l.ts >= debut && l.ts < fin);
}

// Nombre de cartes distinctes vues pour la première fois aujourd'hui (une contestation ne change rien),
// plus les nouvelles faites dans v1 ce jour-là (historique, jour de bascule).
export function nouvellesDuJour(donnees, maintenant) {
  const cartes = new Set();
  for (const l of lignesDuJour(donnees, maintenant)) if (l.nouvelle === true) cartes.add(cleLigne(l));
  const v1 = Number(donnees.historique?.days?.[jourParis(maintenant)]?.nw);
  return cartes.size + (Number.isFinite(v1) && v1 > 0 ? v1 : 0);
}

// Cartes du jour (règle du 16 oct. 2026) : cartes distinctes répondues aujourd'hui, nouvelles et révisions
// (en avance comprises). Une carte ratée qui revient compte une fois ; contestations et QCM de la fac exclus.
// revisions : cartes du jour qui ne sont pas des nouvelles du jour (aucune de leurs lignes du jour n'est nouvelle).
// QCM des cartes (26 oct.) : une carte dont toutes les lignes du jour sont `mode: 'qcm'` ne compte que dans
// la limite de QCM_MAX, révisions d'abord ; qcm = ces cartes (toutes), qcmComptees = celles qui comptent.
export function cartesDuJour(donnees, maintenant) {
  const toutes = new Set(), nouvelles = new Set(), ecrites = new Set();
  for (const l of lignesDuJour(donnees, maintenant)) {
    const k = cleLigne(l);
    toutes.add(k);
    if (l.nouvelle === true) nouvelles.add(k);
    if (l.mode !== 'qcm') ecrites.add(k);
  }
  const qcm = [...toutes].filter(k => !ecrites.has(k));
  const qcmNouvelles = qcm.filter(k => nouvelles.has(k)).length;
  const qcmRevisions = Math.min(QCM_MAX, qcm.length - qcmNouvelles);
  const qcmComptees = qcmRevisions + Math.min(QCM_MAX - qcmRevisions, qcmNouvelles);
  const nouvellesEcrites = [...ecrites].filter(k => nouvelles.has(k)).length;
  const revisions = ecrites.size - nouvellesEcrites + qcmRevisions;
  const cartes = ecrites.size + qcmComptees;
  return { cartes, nouvelles: cartes - revisions, revisions, qcm: qcm.length, qcmComptees };
}

// Semaine de cartes (règle du 26 oct. 2026, décision explicite de l'utilisateur) : du mercredi au mardi,
// comme le contrôle. Somme des cartes du jour (et des nouvelles du jour) de chaque jour de la semaine en cours.
// objectif / nouvelles : 840 dont 252 (7 × 120 dont 36). Vérifiée la nuit du mardi au mercredi.
const MERCREDI = 3;
export function debutSemaine(maintenant) {
  let jour = jourParis(maintenant);
  while (new Date(jour + 'T12:00:00Z').getUTCDay() !== MERCREDI) jour = decalerJour(jour, -1);
  return jour;
}

export function semaineEnCours(donnees, maintenant, objectif = 0, nouvelles = 0) {
  const debut = debutSemaine(maintenant), aujourdhui = jourParis(maintenant);
  let cartes = 0, faites = 0, jours = 0;
  for (let jour = debut; jour <= aujourdhui; jour = decalerJour(jour, 1)) {
    const c = cartesDuJour(donnees, Date.parse(jour + 'T12:00:00Z'));
    cartes += c.cartes;
    faites += c.nouvelles;
    jours++;
  }
  const o = Math.max(0, nombre(objectif, 0)), n = Math.max(0, nombre(nouvelles, 0));
  return {
    debut, fin: decalerJour(debut, 6), joursRestants: 7 - jours, cartes, nouvelles: faites, objectif: o, nouvellesObjectif: n,
    encore: Math.max(0, o - cartes), encoreNouvelles: Math.max(0, n - faites), atteinte: cartes >= o && faites >= n,
  };
}

// QCM des cartes encore possibles aujourd'hui (0 à QCM_MAX).
export const qcmRestants = (donnees, maintenant) => Math.max(0, QCM_MAX - cartesDuJour(donnees, maintenant).qcm);

// Révisions du jour encore à faire : cartes dues au plus tard aujourd'hui et pas encore répondues aujourd'hui.
export function revisionsRestantes(donnees, maintenant) {
  const debut = debutJourParis(maintenant), fin = finJourParis(maintenant);
  let n = 0;
  for (const cartes of Object.values(donnees.srs || {})) {
    for (const etat of Object.values(cartes || {})) if (etat && etat.due < fin && etat.last < debut) n++;
  }
  return n;
}

// Objectif du jour (règle du 16 oct. 2026, décision explicite de l'utilisateur) : `objectif` cartes,
// révisions d'abord. Atteint si cartes >= objectif et révisions faites >= min(objectif, révisions du jour),
// ou s'il ne reste plus rien à proposer (aucune révision restante, aucune nouvelle carte possible).
// Le 16 oct. (JOURS_TOTAL_SEUL), seul le total compte.
// Nouvelles imposées (règle du 26 oct. 2026, décision explicite de l'utilisateur) : `nouvelles` cartes
// jamais vues parmi l'objectif (60 dont 18) ; les révisions visées vont alors jusqu'à objectif − nouvelles.
// Les nouvelles visées ne dépassent pas ce qui peut être proposé (nouvelles du jour + possibles).
// encore / encoreRevisions / encoreNouvelles : ce qui manque (0 une fois atteint ; jamais plus que ce qui reste à proposer).
export function objectifDuJour(donnees, maintenant, objectif, nouvelles = 0) {
  const c = cartesDuJour(donnees, maintenant);
  const { cartes, revisions } = c;
  const restantes = revisionsRestantes(donnees, maintenant);
  const totalSeul = JOURS_TOTAL_SEUL.has(jourParis(maintenant));
  const possiblesTout = nouvellesPossibles(donnees, maintenant).length;
  const imposees = totalSeul ? 0 : Math.max(0, Math.min(nombre(nouvelles, 0), objectif));
  const nouvellesVisees = Math.min(imposees, c.nouvelles + possiblesTout);
  const revisionsVisees = totalSeul ? 0 : Math.min(objectif - imposees, revisions + restantes);
  const fait = cartes >= objectif && revisions >= revisionsVisees && c.nouvelles >= nouvellesVisees;
  // « Rien à proposer » suppose des cartes chargées : sans paquet, rien n'est atteint.
  const possibles = fait ? 0 : possiblesTout;
  const rien = !fait && restantes === 0 && possibles === 0 && Object.keys(donnees.paquets || {}).length > 0;
  const atteint = fait || rien;
  const encoreRevisions = atteint ? 0 : Math.max(0, revisionsVisees - revisions);
  const encoreNouvelles = atteint ? 0 : Math.max(0, nouvellesVisees - c.nouvelles);
  // Tout faire (révisions restantes et nouvelles possibles) mène à « rien à proposer » : c'est le plus exigé.
  const encore = atteint ? 0 : Math.min(Math.max(objectif - cartes, encoreRevisions + encoreNouvelles), restantes + possibles);
  return {
    objectif, cartes, revisionsFaites: revisions, revisionsRestantes: restantes, atteint, encore, encoreRevisions,
    nouvellesObjectif: imposees, nouvellesFaites: c.nouvelles, encoreNouvelles,
  };
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

// Ce qu'une séance sur ce filtre apporterait à l'objectif : révisions pas encore répondues aujourd'hui
// (une carte ratée qui revient est déjà comptée) et nouvelles cartes proposables.
export function apportDuFiltre(donnees, maintenant, filtre = 'tout') {
  const debut = debutJourParis(maintenant);
  const dues = aReviser(donnees, maintenant, filtre);
  const revisions = dues.filter(el => etatStocke(donnees, el.paquet, el.carteId).last < debut).length;
  return { revisions, reprises: dues.length - revisions, nouvelles: nouvellesPossibles(donnees, maintenant, filtre).length };
}

// « Réviser en avance » : les révisions les plus proches, sans les cartes déjà répondues aujourd'hui
// (elles sont déjà comptées et viennent d'être revues).
export function revisionsEnAvance(donnees, maintenant, filtre = 'tout', n = EN_AVANCE) {
  const debut = debutJourParis(maintenant);
  const res = [];
  for (const { paquet, carte } of cartesDe(donnees, filtre)) {
    const etat = etatStocke(donnees, paquet, carte.id);
    if (etat && etat.last < debut) res.push({ paquet, carteId: carte.id, due: etat.due });
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
  // mode 'qcm' : QCM des cartes, au plus `max` cartes (qcmRestants).
  // priorite : [{paquet, carteId}] placées en tête (feuille blanche : idées oubliées d'abord).
  constructor({ donnees, maintenant = Date.now(), filtre = 'tout', enAvance = false, mode = 'ecrit', max = Infinity, priorite = [], rnd = Math.random }) {
    this.donnees = donnees;
    this.mode = mode === 'qcm' ? 'qcm' : 'ecrit';
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
      revisions = revisionsEnAvance(donnees, t0, filtre);
      this.enAvance = revisions.length > 0;
    }
    const cle = el => this.carteDe(el)?.fiche || el.paquet;
    revisions = espacer(melanger(revisions, rnd), cle);
    const nouvelles = nouvellesPossibles(donnees, t0, filtre);
    // Nouvelles imposées (26 oct.) : mêlées aux révisions dès le début, dans la proportion de l'objectif
    // (18 sur 60 : 30 %) ; sans nouvelles imposées, révisions d'abord.
    const objectif = nombre(donnees.reglages?.objectifJour, 0);
    const part = objectif > 0 ? Math.min(1, Math.max(0, nombre(donnees.reglages?.nouvellesObjectif, 0) / objectif)) : 0;
    const file = [];
    let r = 0, n = 0;
    while (r < revisions.length || n < nouvelles.length) {
      const placerNouvelle = n < nouvelles.length && (r >= revisions.length || n < Math.floor((file.length + 1) * part));
      file.push(placerNouvelle ? nouvelles[n++] : revisions[r++]);
    }
    const cle2 = el => el.paquet + '/' + el.carteId;
    const enTete = [];
    const vus = new Set();
    for (const el of priorite || []) {
      if (!el || vus.has(cle2(el)) || !this.carteDe(el)) continue;
      vus.add(cle2(el));
      enTete.push({ paquet: el.paquet, carteId: el.carteId });
    }
    this.file = [...enTete, ...file.filter(el => !vus.has(cle2(el)))].slice(0, Math.max(0, max));
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

  // mode : celui de la séance par défaut ('ecrit' quand une carte sans leurre possible s'écrit en séance QCM).
  noter({ verdict, correcteur, reponse = '', duree, confiance, indice, mode = this.mode, maintenant, appareil = 'inconnu' }) {
    const el = this.courant();
    if (!el) throw new Error('La séance est terminée : plus aucune carte à noter.');
    const t = maintenant ?? (this.horloge ? this.horloge() : Date.now());
    const etatAvant = this.etatDe(el);
    const note = noteDe(verdict);
    const etatApres = review(etatAvant, note, t);
    this.locaux.set(el.paquet + '/' + el.carteId, etatApres);

    const ligne = sansVide({
      id: `${appareil}-${t}`, ts: t, t: isoParis(t), appareil, paquet: el.paquet, carte: el.carteId,
      reponse, verdict, correcteur, note, nouvelle: !etatAvant, duree, confiance, indice: indice || undefined,
      mode: mode === 'qcm' ? 'qcm' : undefined,
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
