// Fichiers du dossier rappel/ ↔ données de l'appli, et opérations de synchro.
import { OBJECTIF_DEFAUT } from './config.js';
import { moisParis, jourParis } from './temps.js';
import { normaliser } from './texte.js';
import {
  fusionSrs, fusionLignes, fusionCarnet, fusionARevoir, fusionQcmFichier, fusionReglages,
  analyserJsonl, versJsonl,
} from './fusion.js';

export const REGLAGES_DEFAUT = gelerProfond({
  nouvellesParJour: 15, objectifJour: OBJECTIF_DEFAUT, nouvellesObjectif: 0, objectifSemaine: 0, nouvellesSemaine: 0, feuillesSemaine: 0, ordrePaquets: [], baremeQcm: [1, 0.5, 0.2, 0],
  qcmParSeance: 8, pauseToutes: 30, modeles: { correction: '', contestation: '' },
  voix: { vitesse: 1, silence: 2.5 }, maj: 0,
});

function gelerProfond(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') gelerProfond(v);
  return Object.freeze(o);
}

const estObjet = x => !!x && typeof x === 'object' && !Array.isArray(x);
const objet = x => (estObjet(x) ? x : {});
const tableau = x => (Array.isArray(x) ? x : []);
const compare = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Racine toujours terminée par « / » (ou vide = racine du dépôt).
function racineNette(racine) {
  const r = String(racine ?? 'rappel/');
  return r && !r.endsWith('/') ? r + '/' : r;
}

// Chemin relatif à la racine, ou null s'il est en dehors.
function relatif(path, racine) {
  const r = racineNette(racine);
  return typeof path === 'string' && path.startsWith(r) ? path.slice(r.length) : null;
}

// Identifiant utilisable dans un nom de fichier (pas de « / » ni de « .. »).
const idSur = id => typeof id === 'string' && /^[\w.-]+$/.test(id) && !/^\.+$/.test(id);

const UTILE = /^(plan\.json|(paquets|fiches|qcm|idees)\/[^/]+\.json|progres\/.+\.jsonl?|controles\/\d{4}-\d{2}-\d{2}\.json)$/;
const PREPARE = /^controles\/prepares\/(\d{4}-\d{2}-\d{2})\.json$/;

// Contrôles préparés (29 oct.) : seulement celui du jour, pour ne pas voir les suivants.
export function cheminUtile(path, racine = 'rappel/', jour = null) {
  const r = relatif(path, racine);
  if (r === null) return false;
  const m = r.match(PREPARE);
  if (m) return m[1] === (jour ?? jourParis(Date.now()));
  return UTILE.test(r);
}

export function analyser(path, texte) {
  if (String(path).endsWith('.jsonl')) return analyserJsonl(texte);
  return JSON.parse(texte); // lève une erreur si le fichier est abîmé
}

export function serialiser(path, objet) {
  if (String(path).endsWith('.jsonl')) return versJsonl(objet);
  return JSON.stringify(objet, null, 1) + '\n';
}

const nombreOu = (v, defaut) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : defaut);

// Réglages du fichier complétés par les valeurs par défaut.
function avecDefauts(fichier) {
  const f = objet(fichier), D = REGLAGES_DEFAUT;
  const bareme = tableau(f.baremeQcm);
  return {
    ...D, ...f,
    nouvellesParJour: nombreOu(f.nouvellesParJour, D.nouvellesParJour),
    objectifJour: nombreOu(f.objectifJour, D.objectifJour),
    nouvellesObjectif: nombreOu(f.nouvellesObjectif, D.nouvellesObjectif),
    objectifSemaine: nombreOu(f.objectifSemaine, D.objectifSemaine),
    nouvellesSemaine: nombreOu(f.nouvellesSemaine, D.nouvellesSemaine),
    feuillesSemaine: nombreOu(f.feuillesSemaine, D.feuillesSemaine),
    qcmParSeance: nombreOu(f.qcmParSeance, D.qcmParSeance),
    pauseToutes: nombreOu(f.pauseToutes, D.pauseToutes),
    ordrePaquets: tableau(f.ordrePaquets).filter(x => typeof x === 'string'),
    baremeQcm: bareme.length === 4 && bareme.every(x => typeof x === 'number') ? [...bareme] : [...D.baremeQcm],
    modeles: { ...D.modeles, ...objet(f.modeles) },
    voix: { ...D.voix, ...objet(f.voix) },
    maj: nombreOu(f.maj, 0),
  };
}

// Ordre des paquets : réglages, puis plan (UE puis cours), puis champ « ordre », puis identifiant.
function ordrePaquets(paquets, plan, reglages) {
  const ordre = [];
  const pris = new Set();
  const prendre = id => { if (id in paquets && !pris.has(id)) { pris.add(id); ordre.push(id); } };
  reglages.ordrePaquets.forEach(prendre);
  for (const ue of tableau(objet(plan).ues)) for (const c of tableau(objet(ue).cours)) if (c && c.paquet) prendre(c.paquet);
  const reste = Object.keys(paquets).filter(id => !pris.has(id));
  const rang = id => (typeof paquets[id].ordre === 'number' ? paquets[id].ordre : Infinity);
  reste.sort((x, y) => (rang(x) - rang(y)) || compare(x, y)).forEach(prendre);
  return ordre;
}

// Données de l'appli à partir des fichiers analysés {path: objet}.
export function vue(objets, racine = 'rappel/') {
  const d = {
    plan: null, paquets: {}, ordre: [], fiches: {}, qcm: {}, srs: {}, reponses: [], qcmJournal: [], idees: {}, feuilles: [],
    controles: {}, prepares: {},
    carnet: { abreviations: {}, cartes: {} }, aRevoir: { cas: [] }, reglages: null,
    exceptions: { jours: {} }, historique: { days: {} }, cartes: {}, calibration: null,
  };
  let reglages = null;
  let m;
  for (const [path, o] of Object.entries(objets || {})) {
    const r = relatif(path, racine);
    if (r === null || o == null) continue;
    if (r === 'plan.json') d.plan = o;
    else if ((m = r.match(/^paquets\/([^/]+)\.json$/))) { if (estObjet(o)) d.paquets[m[1]] = o; }
    else if ((m = r.match(/^fiches\/([^/]+)\.json$/))) { if (estObjet(o)) d.fiches[m[1]] = o; }
    else if ((m = r.match(/^idees\/([^/]+)\.json$/))) { if (estObjet(o)) d.idees[m[1]] = o; }
    else if ((m = r.match(PREPARE))) { if (estObjet(o)) d.prepares[m[1]] = o; }
    else if ((m = r.match(/^controles\/(\d{4}-\d{2}-\d{2})\.json$/))) { if (estObjet(o)) d.controles[m[1]] = o; }
    else if ((m = r.match(/^qcm\/([^/]+)\.json$/))) {
      for (const q of tableau(objet(o).qcm)) {
        if (estObjet(q) && q.id != null) d.qcm[q.id] = { ...q, cours: q.cours ?? o.cours ?? m[1], ue: q.ue ?? o.ue };
      }
    }
    else if ((m = r.match(/^progres\/srs\/([^/]+)\.json$/))) d.srs[m[1]] = { ...objet(objet(o).cards) };
    else if (/^progres\/reponses\/[^/]+\.jsonl$/.test(r)) d.reponses.push(...tableau(o));
    else if (/^progres\/qcm\/[^/]+\.jsonl$/.test(r)) d.qcmJournal.push(...tableau(o));
    else if (/^progres\/feuilles\/[^/]+\.jsonl$/.test(r)) d.feuilles.push(...tableau(o));
    else if (r === 'progres/carnet.json') d.carnet = { abreviations: {}, cartes: {}, ...objet(o) };
    else if (r === 'progres/a-revoir.json') d.aRevoir = { ...objet(o), cas: tableau(objet(o).cas) };
    else if (r === 'progres/reglages.json') reglages = o;
    else if (r === 'progres/exceptions.json') d.exceptions = { jours: {}, ...objet(o) };
    else if (r === 'progres/historique-v1.json') d.historique = { days: {}, ...objet(o) };
    else if (r === 'progres/calibration/cas.json') d.calibration = o;
  }
  const parTs = (x, y) => (x.ts || 0) - (y.ts || 0) || compare(String(x.id ?? ''), String(y.id ?? ''));
  d.reponses.sort(parTs);
  d.qcmJournal.sort(parTs);
  d.feuilles.sort(parTs);
  d.reglages = avecDefauts(reglages);
  d.ordre = ordrePaquets(d.paquets, d.plan, d.reglages);
  for (const pid of d.ordre) {
    for (const carte of tableau(d.paquets[pid].cartes)) {
      if (estObjet(carte) && carte.id != null && !(carte.id in d.cartes)) d.cartes[carte.id] = { paquet: pid, carte };
    }
  }
  return d;
}

// Chemin du fichier modifié par une opération (relatif à la racine), ou null.
function cible(op) {
  switch (op?.type) {
    case 'srs': return idSur(op.paquet) ? `progres/srs/${op.paquet}.json` : null;
    case 'reponse': return Number.isFinite(op.ligne?.ts) ? `progres/reponses/${moisParis(op.ligne.ts)}.jsonl` : null;
    case 'qcm-reponse': return Number.isFinite(op.ligne?.ts) ? `progres/qcm/${moisParis(op.ligne.ts)}.jsonl` : null;
    case 'erreur': return Number.isFinite(op.ligne?.ts) ? `progres/erreurs/${moisParis(op.ligne.ts)}.jsonl` : null;
    case 'feuille': return Number.isFinite(op.ligne?.ts) ? `progres/feuilles/${moisParis(op.ligne.ts)}.jsonl` : null;
    case 'carnet': return 'progres/carnet.json';
    case 'a-revoir': return 'progres/a-revoir.json';
    case 'reglages': return 'progres/reglages.json';
    case 'qcm-ajout': case 'qcm-statut': return idSur(op.cours) ? `qcm/${op.cours}.json` : null;
    default: return null;
  }
}

// Chemin complet d'une op « fichier » : relatif à la racine (ou déjà complet), jamais en dehors.
function cheminFichier(op, racine) {
  const r = racineNette(racine);
  if (typeof op.path !== 'string' || !op.path) return null;
  const complet = op.path.startsWith(r) ? op.path : r + op.path;
  const parties = complet.slice(r.length).split('/');
  return parties.every(idSur) ? complet : null;
}

export function cheminsTouches(op, racine = 'rappel/') {
  if (op?.type === 'fichier') { const p = cheminFichier(op, racine); return p ? [p] : []; }
  const c = cible(op);
  return c ? [racineNette(racine) + c] : [];
}

const CARNET_VIDE = { abreviations: {}, cartes: {} };

// Ajout au carnet : la décision la plus récente retire la réponse de la liste opposée.
function appliquerCarnet(fichier, op) {
  const abreviations = {};
  for (const [abr, sens] of Object.entries(objet(op.abreviations))) {
    const cle = String(abr).trim().toLowerCase();
    if (cle && typeof sens === 'string' && sens.trim()) abreviations[cle] = sens.trim();
  }
  const ajout = { abreviations, cartes: {} };
  const acceptee = typeof op.acceptee === 'string' && op.acceptee.trim() ? op.acceptee.trim() : null;
  const refusee = typeof op.refusee === 'string' && op.refusee.trim() ? op.refusee.trim() : null;
  if (op.carte != null && (acceptee || refusee)) {
    ajout.cartes[op.carte] = { acceptees: acceptee ? [acceptee] : [], refusees: refusee ? [refusee] : [] };
  }
  const carnet = fusionCarnet(fichier ?? CARNET_VIDE, ajout);
  const entree = carnet.cartes[op.carte];
  if (entree) {
    const sans = (liste, s) => (s ? liste.filter(x => normaliser(x) !== normaliser(s)) : liste);
    entree.acceptees = sans(entree.acceptees, refusee);
    entree.refusees = sans(entree.refusees, acceptee);
  }
  return carnet;
}

// Changement de statut d'un QCM, si la modification est au moins aussi récente.
function appliquerStatut(fichier, op) {
  if (!fichier) return fichier;
  const qcm = tableau(fichier.qcm).map(q => {
    if (!estObjet(q) || q.id !== op.id || (q.maj || 0) > (op.maj || 0)) return q;
    return { ...q, statut: op.statut, maj: op.maj ?? q.maj };
  });
  return { ...fichier, qcm };
}

// Applique l'opération aux fichiers analysés {path: objet}. Remplace les fichiers touchés
// par de nouveaux objets (ne modifie jamais les objets existants). Rejouer l'op ne change rien.
export function appliquerOp(objets, op, racine = 'rappel/') {
  const [path] = cheminsTouches(op, racine);
  if (!path) return objets;
  const actuel = objets[path] ?? null;
  switch (op.type) {
    case 'srs':
      if (op.carte == null || !estObjet(op.etat)) break;
      objets[path] = fusionSrs(actuel ?? { cards: {} }, { cards: { [op.carte]: op.etat } });
      break;
    case 'reponse':
    case 'qcm-reponse':
    case 'erreur':
    case 'feuille':
      objets[path] = fusionLignes(actuel ?? [], [op.ligne]);
      break;
    case 'carnet':
      objets[path] = appliquerCarnet(actuel, op);
      break;
    case 'a-revoir':
      if (!estObjet(op.cas)) break;
      objets[path] = fusionARevoir(actuel ?? { cas: [] }, { cas: [op.cas] });
      break;
    case 'reglages':
      if (!estObjet(op.reglages)) break;
      objets[path] = fusionReglages(actuel, op.reglages);
      break;
    case 'qcm-ajout': {
      const ajouts = [].concat(op.qcm ?? []).filter(estObjet).map(q => ({ ...q, cours: q.cours ?? op.cours, ue: q.ue ?? op.ue }));
      objets[path] = fusionQcmFichier(actuel ?? { cours: op.cours, ue: op.ue, qcm: [] }, { qcm: ajouts });
      break;
    }
    case 'qcm-statut':
      if (actuel) objets[path] = appliquerStatut(actuel, op);
      break;
    case 'fichier':
      if (op.texte === null) { delete objets[path]; break; }
      try { objets[path] = analyser(path, String(op.texte)); } catch { /* texte illisible : ignoré */ }
      break;
  }
  return objets;
}
