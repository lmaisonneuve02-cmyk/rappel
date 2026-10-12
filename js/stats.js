// Chiffres du suivi : par jour, par UE, contestations par semaine.
// Module pur : aucun accès au DOM.
import { noteDe } from './fsrs.js';
import { HEURE, JOUR, jourParis, debutJourParis, finJourParis, decalerJour } from './temps.js';
import { acquisesDuJour, nouvellesDuJour } from './seance.js';

const estContestation = l => l.correcteur === 'contestation' || l.remplace != null;
const reussie = l => l.verdict === 'juste' || l.verdict === 'partiel';
const arrondi = (x, k = 1000) => Math.round(x * k) / k;
const entier = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// jourParis mémorisé par heure : à Paris, minuit tombe toujours sur une heure pile en UTC.
function memoJour() {
  const memo = new Map();
  return ts => {
    const h = Math.floor(ts / HEURE);
    if (!memo.has(h)) memo.set(h, jourParis(ts));
    return memo.get(h);
  };
}

// Semaine ISO (lundi → dimanche) d'un jour 'AAAA-MM-JJ' : 'AAAA-Snn'.
function semaineIso(jour) {
  const [y, m, d] = jour.split('-').map(Number);
  const date = Date.UTC(y, m - 1, d);
  const rang = (new Date(date).getUTCDay() + 6) % 7;   // lundi = 0
  const jeudi = date + (3 - rang) * JOUR;
  const annee = new Date(jeudi).getUTCFullYear();
  const num = Math.floor((jeudi - Date.UTC(annee, 0, 1)) / (7 * JOUR)) + 1;
  return `${annee}-S${String(num).padStart(2, '0')}`;
}

// Applique les contestations acceptées : la ligne contestée prend le nouveau verdict et la nouvelle note,
// et la ligne de contestation ne compte pas en plus. Une contestation dont la ligne visée est introuvable
// est gardée telle quelle (c'est la seule trace de la réponse).
export function lignesEffectives(reponses) {
  const parId = new Map();
  for (const l of reponses || []) if (l && !parId.has(l.id)) parId.set(l.id, l);
  const lignes = [...parId.values()].sort((a, b) => a.ts - b.ts);

  // Ligne d'origine visée par une contestation (en remontant les contestations de contestations).
  const cible = c => {
    let cur = c;
    const vus = new Set([c.id]);
    for (;;) {
      const visee = parId.get(cur.remplace);
      if (!visee || vus.has(visee.id)) return cur === c ? null : cur.id;
      if (!estContestation(visee)) return visee.id;
      vus.add(visee.id);
      cur = visee;
    }
  };
  const remplacement = new Map();
  const gardees = new Set();
  for (const l of lignes) {
    if (!estContestation(l)) continue;
    const id = cible(l);
    if (id == null) gardees.add(l.id);
    else remplacement.set(id, l);   // ordre chronologique : la plus récente gagne
  }
  return lignes
    .filter(l => !estContestation(l) || gardees.has(l.id))
    .map(l => {
      const c = remplacement.get(l.id);
      return c ? { ...l, verdict: c.verdict, note: c.note ?? noteDe(c.verdict), contestation: c.id } : l;
    });
}

// Cartes dont la dernière réponse du jour est juste ou partielle (lignes déjà triées par ts).
function acquisesDesLignes(lignes) {
  const derniere = new Map();
  for (const l of lignes) derniere.set(l.paquet + '/' + l.carte, l);
  let n = 0;
  for (const l of derniere.values()) if (reussie(l)) n++;
  return n;
}

export function parJour(donnees, maintenant, n = 14) {
  const lignes = lignesEffectives(donnees.reponses);
  const journalQcm = donnees.qcmJournal || [];
  const histo = donnees.historique?.days || {};
  const res = [];
  let t = maintenant;
  for (let k = 0; k < n; k++) {
    const debut = debutJourParis(t), fin = finJourParis(t), jour = jourParis(t);
    const duJour = lignes.filter(l => l.ts >= debut && l.ts < fin);
    const qcm = journalQcm.filter(l => l.ts >= debut && l.ts < fin);
    const entree = {
      jour, acquises: 0, reponses: 0, justes: 0, nouvelles: 0,
      qcm: qcm.length, pointsQcm: arrondi(qcm.reduce((s, l) => s + (Number(l.points) || 0), 0)),
    };
    if (duJour.length) {
      entree.reponses = duJour.length;
      entree.justes = duJour.filter(l => l.verdict === 'juste').length;
      entree.acquises = acquisesDesLignes(duJour);
    } else if (histo[jour]) {
      entree.acquises = null;   // jour de Rappel v1 seul : pas de détail par carte
    }
    // Jour de bascule : v1 (historique) et v2 (journal) s'additionnent.
    const h = histo[jour];
    if (h) {
      entree.reponses += entier(h.n);
      entree.justes += entier(h.right);
    }
    entree.nouvelles = nouvellesDuJour(donnees, t);   // journal + historique (nw)
    if (k === 0) entree.acquises = acquisesDuJour(donnees, maintenant);
    res.push(entree);
    t = debut - 1;   // un instant de la veille
  }
  return res;
}

// UE de chaque paquet : celle du plan si un cours y renvoie, sinon le champ « ue » du paquet.
function uesEtPaquets(donnees) {
  const paquets = donnees.paquets || {};
  const ues = [];
  const ueDuPaquet = new Map();
  for (const ue of donnees.plan?.ues || []) {
    if (!ue || ue.id == null) continue;
    const cours = Array.isArray(ue.cours) ? ue.cours : [];
    ues.push({
      ue: ue.id, nom: ue.nom || ue.id, coursTotal: cours.length,
      coursEnCartes: cours.filter(c => c && c.paquet && paquets[c.paquet]).length,
    });
    for (const c of cours) if (c?.paquet && !ueDuPaquet.has(c.paquet)) ueDuPaquet.set(c.paquet, ue.id);
  }
  // UE absentes du plan (ou pas de plan) : un cours = un paquet.
  const connues = new Set(ues.map(u => u.ue));
  const autres = new Map();
  for (const [id, p] of Object.entries(paquets)) {
    if (!ueDuPaquet.has(id)) ueDuPaquet.set(id, p?.ue || 'autre');
    const ue = ueDuPaquet.get(id);
    if (!connues.has(ue)) autres.set(ue, (autres.get(ue) || 0) + 1);
  }
  for (const [ue, nb] of [...autres].sort((a, b) => a[0].localeCompare(b[0]))) {
    ues.push({ ue, nom: ue, coursTotal: nb, coursEnCartes: nb });
  }
  return { ues, ueDuPaquet };
}

export function parUE(donnees, maintenant) {
  const { ues, ueDuPaquet } = uesEtPaquets(donnees);
  const paquets = donnees.paquets || {};
  const srs = donnees.srs || {};

  const debut7 = decalerJour(jourParis(maintenant), -6);
  const jourDe = memoJour();
  const revisions = lignesEffectives(donnees.reponses)
    .filter(l => l.nouvelle !== true && l.ts <= maintenant && jourDe(l.ts) >= debut7);

  // UE d'une ligne de QCM : la sienne, sinon celle du paquet du cours.
  const qcm = (donnees.qcmJournal || []).map(l => ({ ue: l.ue ?? ueDuPaquet.get(l.cours), points: Number(l.points) || 0 }));

  return ues.map(u => {
    let cartes = 0, cartesVues = 0;
    for (const [id, p] of Object.entries(paquets)) {
      if (ueDuPaquet.get(id) !== u.ue) continue;
      for (const c of p?.cartes || []) {
        if (!c || c.id == null) continue;
        cartes++;
        if (srs[id]?.[c.id]) cartesVues++;
      }
    }
    const rev = revisions.filter(l => ueDuPaquet.get(l.paquet) === u.ue);
    const pts = qcm.filter(l => l.ue === u.ue);
    return {
      ...u, cartes, cartesVues,
      retention7j: rev.length ? arrondi(rev.filter(reussie).length / rev.length) : null,
      moyenneQcm: pts.length ? arrondi(pts.reduce((s, l) => s + l.points, 0) / pts.length) : null,
    };
  });
}

// Contestations par semaine ISO (heure de Paris), de la plus récente à la plus ancienne.
// Acceptées : lignes de contestation du journal. Les autres (refusées ou en attente) viennent
// de « à revoir » (type contestation, issue différente de « accepte »).
export function contestationsParSemaine(donnees) {
  const jourDe = memoJour();
  const semaines = new Map();
  const compter = (ts, ...champs) => {
    if (!Number.isFinite(ts)) return;
    const semaine = semaineIso(jourDe(ts));
    if (!semaines.has(semaine)) semaines.set(semaine, { semaine, contestations: 0, acceptees: 0, reponses: 0 });
    for (const c of champs) semaines.get(semaine)[c]++;
  };
  const vues = new Set();
  for (const l of donnees.reponses || []) {
    if (!l || vues.has(l.id)) continue;
    vues.add(l.id);
    if (estContestation(l)) compter(l.ts, 'contestations', 'acceptees');
    else compter(l.ts, 'reponses');
  }
  for (const c of donnees.aRevoir?.cas || []) {
    if (c?.type === 'contestation' && c.issue !== 'accepte') compter(c.ts, 'contestations');
  }
  return [...semaines.values()].sort((a, b) => b.semaine.localeCompare(a.semaine));
}
