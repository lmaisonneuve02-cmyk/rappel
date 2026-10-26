// Feuille blanche (décision du 26 oct. 2026) : il choisit un cours, écrit ou dicte pendant 10 minutes
// tout ce qu'il en sait ; Gemini compare à la liste d'idées du cours et la complète. Les cartes des
// idées oubliées passent en premier dans la séance qui suit ; celles des idées bien écrites, déjà vues,
// sont espacées (révision « juste », sans compter dans l'objectif). 10 feuilles par semaine au moins.
// Module pur : aucun accès au DOM ; horloge injectée.
import { review, noteDe } from './fsrs.js';
import { isoParis, jourParis, decalerJour } from './temps.js';
import { plainQ, refText } from './texte.js';
import { debutSemaine } from './seance.js';

export const DUREE = 10 * 60 * 1000;     // 10 minutes
export const DUREE_MIN = 5 * 60 * 1000;  // une feuille compte pour la semaine à partir de 5 minutes d'écriture
export const STATUTS = ['presente', 'partielle', 'absente'];

const tableau = x => (Array.isArray(x) ? x : []);
const court = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Idées du cours : la liste écrite par Claude (idees/<cours>.json) si elle existe, sinon une idée par carte.
// Chaque idée : {id, texte, cartes: [ids], importance}. Les cartes sont celles du paquet du cours.
export function ideesDuCours(donnees, cours) {
  const paquet = donnees.paquets?.[cours];
  const ids = new Set(tableau(paquet?.cartes).map(c => c?.id).filter(Boolean));
  const liste = donnees.idees?.[cours];
  if (liste && tableau(liste.idees).length) {
    return {
      source: 'liste', titre: liste.titre || paquet?.nom || cours,
      idees: tableau(liste.idees).filter(i => i && i.id && i.texte).map(i => ({
        id: String(i.id), texte: String(i.texte), importance: i.importance === 'utile' ? 'utile' : 'essentiel',
        cartes: tableau(i.cartes).filter(c => ids.has(c)),
      })),
    };
  }
  return {
    source: 'cartes', titre: paquet?.nom || cours,
    idees: tableau(paquet?.cartes).filter(c => c?.id).map(c => ({
      id: c.id, texte: court(`${plainQ(c)} → ${refText(c)}`, 300), importance: 'essentiel', cartes: [c.id],
    })),
  };
}

// Statut d'une carte : le moins bon des statuts des idées qui la citent.
function statutsCartes(idees, statuts) {
  const rang = { absente: 0, partielle: 1, presente: 2 };
  const parCarte = new Map();
  for (const i of idees) {
    const s = statuts[i.id];
    if (!STATUTS.includes(s)) continue;
    for (const c of i.cartes) if (!parCarte.has(c) || rang[s] < rang[parCarte.get(c)]) parCarte.set(c, s);
  }
  return parCarte;
}

// Conséquences d'une feuille corrigée :
// - priorite : cartes des idées absentes puis partielles (la séance qui suit commence par elles) ;
// - ops : les cartes déjà vues dont toutes les idées sont présentes reçoivent une révision « juste »
//   (espacées ; aucune ligne de réponse : elles ne comptent pas dans l'objectif).
export function appliquerFeuille({ donnees, cours, idees, statuts, maintenant }) {
  const parCarte = statutsCartes(idees, statuts);
  const etats = donnees.srs?.[cours] || {};
  const priorite = [];
  const ops = [];
  for (const statut of ['absente', 'partielle']) {
    for (const [carte, s] of parCarte) if (s === statut) priorite.push({ paquet: cours, carteId: carte });
  }
  for (const [carte, s] of parCarte) {
    const etat = etats[carte];
    if (s !== 'presente' || !etat || etat.last >= maintenant) continue;
    ops.push({ type: 'srs', paquet: cours, carte, etat: review(etat, noteDe('juste'), maintenant) });
  }
  const compte = s => idees.filter(i => statuts[i.id] === s).length;
  return { priorite, ops, presentes: compte('presente'), partielles: compte('partielle'), absentes: compte('absente'), total: idees.length };
}

// Ligne du journal progres/feuilles/AAAA-MM.jsonl.
export function ligneFeuille({ cours, texte, duree, resultat, maintenant, appareil = 'inconnu', source }) {
  return {
    id: `${appareil}-${maintenant}`, ts: maintenant, t: isoParis(maintenant), appareil, cours, source,
    duree: Math.max(0, Math.round(duree)), mots: String(texte || '').split(/\s+/).filter(Boolean).length,
    texte: String(texte || '').slice(0, 20000),
    statuts: resultat.statuts, hors_liste: tableau(resultat.hors_liste), ajouts: tableau(resultat.ajouts),
    erreurs: tableau(resultat.erreurs), presentes: resultat.presentes, partielles: resultat.partielles,
    absentes: resultat.absentes, total: resultat.total,
  };
}

// Feuilles de la semaine en cours (mercredi → mardi) qui comptent : 5 minutes d'écriture au moins.
export function feuillesDeLaSemaine(donnees, maintenant, objectif = 10) {
  const debut = debutSemaine(maintenant), fin = decalerJour(debut, 6);
  const faites = tableau(donnees.feuilles).filter(l => {
    const jour = l?.ts ? jourParis(l.ts) : '';
    return jour >= debut && jour <= fin && (l.duree || 0) >= DUREE_MIN;
  });
  return { faites: faites.length, objectif, atteinte: faites.length >= objectif, debut, fin };
}

// Dernière feuille de chaque cours (pour proposer ceux qui n'en ont pas eu depuis longtemps).
export function dernieresFeuilles(donnees) {
  const m = new Map();
  for (const l of tableau(donnees.feuilles)) if (l?.cours && (!m.has(l.cours) || l.ts > m.get(l.cours).ts)) m.set(l.cours, l);
  return m;
}
