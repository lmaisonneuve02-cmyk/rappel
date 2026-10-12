// Fusion des fichiers de progression entre appareils.
// Aucune fonction ne modifie ses arguments : chacune renvoie un nouvel objet.
import { normaliser } from './texte.js';

const MAX_LISTE = 20;

const estObjet = x => !!x && typeof x === 'object' && !Array.isArray(x);
const objet = x => (estObjet(x) ? x : {});
const tableau = x => (Array.isArray(x) ? x : []);

// L'état x est-il plus récent que y ? (last, puis reps)
function plusRecent(x, y) {
  const lx = x?.last || 0, ly = y?.last || 0;
  if (lx !== ly) return lx > ly;
  return (x?.reps || 0) > (y?.reps || 0);
}

// {cards} : par carte, l'état au last le plus récent gagne (égalité : reps le plus grand, puis a).
export function fusionSrs(a, b) {
  const cards = { ...objet(objet(a).cards) };
  for (const [id, etat] of Object.entries(objet(objet(b).cards))) {
    if (!(id in cards) || plusRecent(etat, cards[id])) cards[id] = etat;
  }
  return { ...objet(b), ...objet(a), cards };
}

const cleLigne = l => (l && l.id != null ? 'id:' + l.id : 'json:' + JSON.stringify(l));

const parTs = (x, y) => (x.ts || 0) - (y.ts || 0) || String(x.id ?? '').localeCompare(String(y.id ?? ''));

// Union par id (a gagne si même id), triée par ts.
function unionParId(a, b, fusionner = x => x) {
  const vus = new Map();
  for (const l of tableau(a)) if (estObjet(l) && !vus.has(cleLigne(l))) vus.set(cleLigne(l), l);
  for (const l of tableau(b)) {
    if (!estObjet(l)) continue;
    const k = cleLigne(l);
    vus.set(k, vus.has(k) ? fusionner(vus.get(k), l) : l);
  }
  return [...vus.values()].sort(parTs);
}

// Lignes de journal (.jsonl) : union par id, triée par ts.
export function fusionLignes(a, b) {
  return unionParId(a, b);
}

// Liste du carnet : a puis les nouveautés de b, sans doublon (après normaliser), 20 dernières gardées.
function fusionListe(a, b) {
  const vus = new Set();
  const sortie = [];
  for (const s of [...tableau(a), ...tableau(b)]) {
    if (typeof s !== 'string') continue;
    const n = normaliser(s);
    if (!n || vus.has(n)) continue;
    vus.add(n);
    sortie.push(s);
  }
  return sortie.slice(-MAX_LISTE);
}

// Carnet : abréviations (a prioritaire), listes acceptées / refusées par carte.
export function fusionCarnet(a, b) {
  const ca = objet(a), cb = objet(b);
  const abreviations = { ...objet(cb.abreviations), ...objet(ca.abreviations) };
  const cartes = {};
  const ids = new Set([...Object.keys(objet(ca.cartes)), ...Object.keys(objet(cb.cartes))]);
  for (const id of ids) {
    const x = objet(objet(ca.cartes)[id]), y = objet(objet(cb.cartes)[id]);
    cartes[id] = { ...y, ...x, acceptees: fusionListe(x.acceptees, y.acceptees), refusees: fusionListe(x.refusees, y.refusees) };
  }
  return { ...cb, ...ca, abreviations, cartes };
}

// Cas à revoir : union par id (même id : champs de a prioritaires, complétés par b), triée par ts.
export function fusionARevoir(a, b) {
  const cas = unionParId(objet(a).cas, objet(b).cas, (x, y) => ({ ...y, ...x }));
  return { ...objet(b), ...objet(a), cas };
}

// Fichier qcm/<cours>.json : union par id ; même id : maj la plus récente gagne (égalité : a).
export function fusionQcmFichier(a, b) {
  const qa = objet(a), qb = objet(b);
  const liste = [];
  const index = new Map();
  for (const q of [...tableau(qa.qcm), ...tableau(qb.qcm)]) {
    if (!estObjet(q)) continue;
    if (!index.has(q.id)) { index.set(q.id, liste.length); liste.push(q); continue; }
    const i = index.get(q.id);
    if ((q.maj || 0) > (liste[i].maj || 0)) liste[i] = q;
  }
  return { ...qb, ...qa, qcm: liste };
}

// Réglages : la modification la plus récente (maj) gagne, objet entier (égalité : a).
export function fusionReglages(a, b) {
  if (!estObjet(a)) return estObjet(b) ? b : a;
  if (!estObjet(b)) return a;
  return (b.maj || 0) > (a.maj || 0) ? b : a;
}

// Une ligne JSON par entrée ; lignes vides ou illisibles ignorées.
export function analyserJsonl(texte) {
  const lignes = [];
  for (const brut of String(texte || '').split('\n')) {
    const l = brut.trim();
    if (!l) continue;
    try {
      const o = JSON.parse(l);
      if (estObjet(o)) lignes.push(o);
    } catch { /* ligne abîmée : ignorée */ }
  }
  return lignes;
}

export function versJsonl(lignes) {
  return tableau(lignes).map(l => JSON.stringify(l) + '\n').join('');
}
