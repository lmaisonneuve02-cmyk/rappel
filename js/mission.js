// Mode Mission : manche 1 « Éclair » (QCM chronométrés, format partiel) et manche 2 « Consignes
// piège » (une proposition seule : vraie ou fausse ?). Trois niveaux. Annales comprises.
// Module pur : aucun accès au DOM ; horloge et aléa sont injectés.
import { qcmProposables, coursVus, etatQcm, melangerPropositions } from './qcm.js';
import { finJourParis, isoParis, jourParis, decalerJour } from './temps.js';

// Chronos en secondes. Diamant : pas de rattrapage des pièges ratés en fin de manche.
export const NIVEAUX = {
  bronze: { id: 'bronze', nom: 'Bronze', qcm: 6, vf: 15, chronoQcm: 120, chronoVf: 20, rattrapage: true },
  or: { id: 'or', nom: 'Or', qcm: 10, vf: 25, chronoQcm: 90, chronoVf: 15, rattrapage: true },
  diamant: { id: 'diamant', nom: 'Diamant', qcm: 20, vf: 40, chronoQcm: 60, chronoVf: 10, rattrapage: false },
};
export const BONUS_DOSSIER = 30;   // secondes de plus pour lire le cas d'un dossier progressif
const PART_FAUSSES = 0.6;          // les pièges : surtout des propositions fausses

// Énoncés à la forme négative (« laquelle est fausse ? ») : une proposition seule y change de sens.
const NEGATIF = /(?<!\p{L})(fausses?|inexactes?|erron[ée]e?s?|incorrecte?s?|sauf|ne\s+\S+\s+pas|n['’]\S+\s+pas)(?!\p{L})/iu;
export const estNegatif = enonce => NEGATIF.test(enonce || '');

function melanger(liste, rnd) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Une UE après l'autre : la série mélange les matières (entrelacement).
export function entrelacer(liste, rnd = Math.random) {
  const parUe = new Map();
  for (const x of melanger(liste, rnd)) {
    const ue = x.ue ?? x.qcm?.ue ?? '?';
    if (!parUe.has(ue)) parUe.set(ue, []);
    parUe.get(ue).push(x);
  }
  const files = melanger([...parUe.values()], rnd);
  const sortie = [];
  while (files.some(f => f.length)) for (const f of files) if (f.length) sortie.push(f.shift());
  return sortie;
}

// UE dont au moins un cours a été commencé en cartes.
export function uesVues(donnees) {
  const ues = new Set();
  for (const p of coursVus(donnees)) {
    const ue = donnees.paquets?.[p]?.ue;
    if (ue) ues.add(ue);
  }
  return ues;
}

// QCM jamais faits que la mission peut proposer : cours vus, et annales des UE commencées
// (toutes les annales si aucune UE n'est commencée).
function dansLeChamp(donnees) {
  const vus = new Set(coursVus(donnees));
  const ues = uesVues(donnees);
  return q => vus.has(q.cours) || (q.source === 'annale' && (!ues.size || ues.has(q.ue)));
}

function journalParQcm(journal) {
  const m = new Map();
  for (const l of journal || []) {
    if (!m.has(l.qcm)) m.set(l.qcm, []);
    m.get(l.qcm).push(l);
  }
  return m;
}

// Manche 1 : QCM dus d'abord, puis jamais faits (UE en alternance), puis les plus anciens.
export function choisirEclair(donnees, maintenant, { n = NIVEAUX.bronze.qcm, rnd = Math.random } = {}) {
  const fin = finJourParis(maintenant);
  const champ = dansLeChamp(donnees);
  const journal = journalParQcm(donnees.qcmJournal);
  const dus = [], jamais = [], anciens = [];
  for (const q of qcmProposables(donnees)) {
    const e = etatQcm(q.id, journal.get(q.id));
    if (e.due != null && e.due < fin) dus.push(q);
    else if (!e.tentatives) { if (champ(q)) jamais.push(q); }
    else anciens.push({ q, ts: e.derniere.ts });
  }
  anciens.sort((a, b) => a.ts - b.ts);
  const liste = [...melanger(dus, rnd), ...entrelacer(jamais, rnd), ...anciens.map(x => x.q)];
  return liste.slice(0, Math.max(0, n)).map(q => melangerPropositions(q, rnd));
}

export const idPiege = (qcmId, lettre) => `${qcmId}:${lettre}`;

// Dernière réponse à chaque piège.
export function etatPieges(vfJournal) {
  const m = new Map();
  for (const l of vfJournal || []) {
    const avant = m.get(l.item);
    if (!avant || l.ts >= avant.ts) m.set(l.item, l);
  }
  return m;
}

// Propositions ratées dans les QCM (cochée à tort ou oubliée) : {item: ts de l'erreur}.
function ratesQcm(qcmJournal, parId) {
  const m = new Map();
  for (const l of qcmJournal || []) {
    const q = parId.get(l.qcm);
    if (!q || !Array.isArray(l.cochees)) continue;
    const cochees = new Set(l.cochees);
    for (const p of q.propositions || []) {
      if (!!p.vrai !== cochees.has(p.l)) m.set(idPiege(q.id, p.l), Math.max(m.get(idPiege(q.id, p.l)) || 0, l.ts));
    }
  }
  return m;
}

function piege(q, p) {
  return {
    id: idPiege(q.id, p.l), qcm: q.id, l: p.l, cours: q.cours, ue: q.ue, source: q.source,
    enonce: q.enonce, t: p.t, vrai: !!p.vrai, expl: p.expl || '', annale: q.annale || null,
  };
}

// Manche 2 : une proposition seule. D'abord les pièges ratés (dès le lendemain), puis les propositions
// ratées dans les QCM, puis des neuves (60 % de fausses). Un seul piège par QCM ; `exclure` : QCM de
// la manche 1 (leur correction donnerait la réponse). Ni dossier progressif, ni énoncé négatif.
export function choisirPieges(donnees, maintenant, { n = NIVEAUX.bronze.vf, exclure = [], rnd = Math.random } = {}) {
  const debut = finJourParis(maintenant) - 864e5;
  const exclus = new Set(exclure);
  const champ = dansLeChamp(donnees);
  const qcms = qcmProposables(donnees).filter(q => !exclus.has(q.id) && !q.contexte && !estNegatif(q.enonce));
  const parId = new Map(qcms.map(q => [q.id, q]));
  const etats = etatPieges(donnees.vfJournal);
  const rates = ratesQcm(donnees.qcmJournal, parId);
  const aRevoir = [], journal = [], neufs = [];
  for (const q of qcms) {
    for (const p of q.propositions || []) {
      if (!p || !String(p.t || '').trim()) continue;
      const id = idPiege(q.id, p.l);
      const e = etats.get(id);
      if (e) { if (!e.ok && e.ts < debut) aRevoir.push(piege(q, p)); continue; }
      if (rates.has(id)) journal.push(piege(q, p));
      else if (champ(q)) neufs.push(piege(q, p));
    }
  }
  const pris = [], qcmPris = new Set();
  const prendre = x => {
    if (pris.length >= n || qcmPris.has(x.qcm)) return false;
    pris.push(x); qcmPris.add(x.qcm); return true;
  };
  for (const x of melanger(aRevoir, rnd)) prendre(x);
  for (const x of melanger(journal, rnd)) prendre(x);
  const reste = Math.max(0, n - pris.length);
  const fausses = Math.round(reste * PART_FAUSSES);
  let f = 0, v = 0;
  for (const x of entrelacer(neufs, rnd)) {
    if (pris.length >= n) break;
    if (x.vrai ? v >= reste - fausses : f >= fausses) continue;
    if (prendre(x)) { if (x.vrai) v++; else f++; }
  }
  // Pas assez de l'une ou l'autre sorte : on complète sans tenir la proportion.
  for (const x of neufs) prendre(x);
  return melanger(pris, rnd);
}

// reponse : true (vrai), false (faux) ou null (temps écoulé).
export function lignePiege({ item, reponse, duree, maintenant, appareil = 'inconnu', niveau }) {
  const ligne = {
    id: `${appareil}-${maintenant}`, ts: maintenant, t: isoParis(maintenant), appareil,
    item: item.id, qcm: item.qcm, l: item.l, cours: item.cours, ue: item.ue,
    reponse, vrai: item.vrai, ok: reponse === item.vrai, duree, niveau,
  };
  if (reponse == null) ligne.reponse = null;
  return ligne;
}

// Jours de mission d'affilée (aujourd'hui compris s'il y a eu une manche Piège, sinon jusqu'à hier).
export function serieJours(vfJournal, maintenant) {
  const jours = new Set((vfJournal || []).map(l => jourParis(l.ts)));
  let j = jourParis(maintenant);
  if (!jours.has(j)) j = decalerJour(j, -1);
  let n = 0;
  while (jours.has(j)) { n++; j = decalerJour(j, -1); }
  return n;
}

// Bilan : points des QCM (barème du partiel) et pièges justes ; mission réussie à 60 % sur l'ensemble.
export function bilanMission({ qcm = [], pieges = [] }) {
  const ptsQcm = qcm.reduce((s, r) => s + (Number(r.points) || 0), 0);
  const justes = pieges.filter(r => r.ok).length;
  let serie = 0, meilleure = 0;
  for (const r of [...qcm.map(r => ({ ts: r.ts, ok: r.points >= 1 })), ...pieges].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    serie = r.ok ? serie + 1 : 0;
    meilleure = Math.max(meilleure, serie);
  }
  const total = qcm.length + pieges.length;
  const taux = total ? (ptsQcm + justes) / total : 0;
  return { ptsQcm, nQcm: qcm.length, justes, nPieges: pieges.length, meilleure, taux, reussie: total > 0 && taux >= 0.6 };
}
