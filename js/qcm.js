// QCM façon fac : barème par discordances, retours espacés (2 j puis 7 j), choix d'une série.
// Module pur : aucun accès au DOM ; horloge et aléa sont injectés.
import { JOUR, finJourParis, isoParis } from './temps.js';

const BAREME = [1, 0.5, 0.2, 0];
const QCM_PAR_SEANCE = 8;

const lettre = l => String(l ?? '').trim().toUpperCase();
const LETTRES = 'ABCDEFGHIJ';

function melanger(liste, rnd) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Propositions dans un ordre tiré à chaque série (demande du 26 oct. 2026 : ne pas retenir « c'est A et C »).
// Les lettres suivent l'ordre affiché ; `origine` garde la lettre du fichier (journal, explications).
export function melangerPropositions(qcm, rnd = Math.random) {
  const props = melanger((qcm.propositions || []).filter(Boolean), rnd);
  return { ...qcm, propositions: props.map((p, i) => ({ ...p, l: LETTRES[i], origine: p.origine ?? p.l })) };
}

// Une discordance = une proposition cochée à tort ou oubliée.
export function scorer(qcm, cochees, bareme = BAREME) {
  const choix = new Set((cochees || []).map(lettre));
  const b = Array.isArray(bareme) && bareme.length ? bareme : BAREME;
  const detail = (qcm.propositions || []).map(p => {
    const vrai = !!p.vrai, cochee = choix.has(lettre(p.l));
    return { l: p.l, vrai, cochee, ok: vrai === cochee };
  });
  const discordances = detail.filter(d => !d.ok).length;
  const points = Number(b[Math.min(discordances, b.length - 1)]) || 0;
  return { points, discordances, detail };
}

// Étapes : 0 jamais fait ; 1 raté (revient à +2 j) ; 2 réussi après un échec (revient à +7 j) ; 'fini'.
// derniere : dernière ligne du journal pour ce QCM (ts, points…), ou null.
export function etatQcm(qcmId, journal) {
  const lignes = (journal || []).filter(l => l.qcm === qcmId).sort((a, b) => a.ts - b.ts);
  let etape = 0, due = null;
  for (const l of lignes) {
    if (!(l.points >= 1)) { etape = 1; due = l.ts + 2 * JOUR; }
    else if (etape === 1) { etape = 2; due = l.ts + 7 * JOUR; }
    else { etape = 'fini'; due = null; }
  }
  return { tentatives: lignes.length, derniere: lignes.at(-1) ?? null, etape, due };
}

// donnees.qcm : {qcmId: qcm} (forme de depot.js) ; accepte aussi {cours: fichier qcm/<cours>.json}.
function tousLesQcm(donnees) {
  const parId = new Map();
  const ajouter = (q, fichier) => {
    if (!q || q.id == null || parId.has(q.id)) return;
    parId.set(q.id, q.cours != null || !fichier ? q : { ...q, cours: fichier.cours, ue: q.ue ?? fichier.ue });
  };
  for (const v of Object.values(donnees.qcm || {})) {
    if (Array.isArray(v?.qcm)) v.qcm.forEach(q => ajouter(q, v));
    else ajouter(v, null);
  }
  return [...parId.values()];
}

const bienForme = q => Array.isArray(q.propositions) && q.propositions.some(p => p && p.vrai);

export function qcmProposables(donnees) {
  return tousLesQcm(donnees).filter(q =>
    (q.statut === 'valide' || (q.statut === 'brouillon' && q.verifie === true)) && bienForme(q));
}

// Un cours = un paquet ; il est « vu » dès qu'une de ses cartes a un état.
export function coursVus(donnees) {
  const srs = donnees.srs || {};
  const vus = Object.keys(srs).filter(p => {
    const etats = srs[p] || {};
    const cartes = donnees.paquets?.[p]?.cartes;
    return cartes ? cartes.some(c => c && etats[c.id]) : Object.keys(etats).length > 0;
  });
  const rang = new Map((donnees.ordre || []).map((id, i) => [id, i]));
  return vus.sort((a, b) => (rang.get(a) ?? Infinity) - (rang.get(b) ?? Infinity) || a.localeCompare(b));
}

// Priorité : QCM dus (dès minuit), puis jamais faits des cours vus, puis les plus anciens ; série mélangée.
// Avec un cours choisi, ses QCM jamais faits sont proposés même si aucune carte n'a été vue.
// choix : 'tout' (défaut) ; 'a-faire' : dus et jamais faits seulement (un QCM acquis ne revient pas) ;
// 'reussis' : QCM acquis, les plus anciens d'abord (pour les refaire à la demande).
export function choisirQcm(donnees, maintenant, { n, cours = null, choix = 'tout', rnd = Math.random } = {}) {
  const nb = n ?? donnees.reglages?.qcmParSeance ?? QCM_PAR_SEANCE;
  const fin = finJourParis(maintenant);
  const vus = new Set(coursVus(donnees));
  const journal = new Map();
  for (const l of donnees.qcmJournal || []) {
    if (!journal.has(l.qcm)) journal.set(l.qcm, []);
    journal.get(l.qcm).push(l);
  }
  const dus = [], jamais = [], anciens = [];
  for (const q of qcmProposables(donnees)) {
    if (cours && q.cours !== cours) continue;
    const e = etatQcm(q.id, journal.get(q.id));
    if (e.due != null && e.due < fin) dus.push(q);
    else if (!e.tentatives) { if (cours || vus.has(q.cours)) jamais.push(q); }
    else anciens.push({ q, ts: e.derniere.ts, fini: e.etape === 'fini' });
  }
  anciens.sort((a, b) => a.ts - b.ts);
  const liste = choix === 'reussis' ? anciens.filter(x => x.fini).map(x => x.q)
    : [...melanger(dus, rnd), ...melanger(jamais, rnd), ...(choix === 'a-faire' ? [] : anciens.map(x => x.q))];
  return melanger(liste.slice(0, Math.max(0, nb)), rnd).map(q => melangerPropositions(q, rnd));
}

// Lettres du fichier dans le journal (cochées), et l'ordre affiché quand il a été mélangé.
export function ligneQcm({ qcm, cochees, resultat, duree, maintenant, appareil = 'inconnu' }) {
  const props = qcm.propositions || [];
  const origine = new Map(props.map(p => [lettre(p.l), lettre(p.origine ?? p.l)]));
  const ordre = props.map(p => lettre(p.origine ?? p.l)).join('');
  const ligne = {
    id: `${appareil}-${maintenant}`, ts: maintenant, t: isoParis(maintenant), appareil,
    qcm: qcm.id, cours: qcm.cours, ue: qcm.ue,
    cochees: [...new Set((cochees || []).map(lettre).map(x => origine.get(x) ?? x))].sort(),
    ordre: props.some(p => p.origine != null && lettre(p.origine) !== lettre(p.l)) ? ordre : undefined,
    points: resultat.points, discordances: resultat.discordances, duree,
  };
  for (const k of Object.keys(ligne)) if (ligne[k] === undefined) delete ligne[k];
  return ligne;
}
