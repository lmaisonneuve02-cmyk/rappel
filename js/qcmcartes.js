// QCM des cartes (décision du 26 oct. 2026) : pour les jours sans élan, la réponse d'une carte à
// reconnaître parmi des réponses d'autres cartes. Ordre tiré à chaque affichage (pas de « c'est la B »
// à retenir). Une bonne réponse vaut « partiel » ; QCM_MAX cartes par jour au plus (seance.js).
// Module pur : aléa injecté.
import { refText, normaliser } from './texte.js';

export const NB_PROPOSITIONS = 4;
const VOISINES = 8;   // leurres tirés parmi les réponses de longueur la plus proche (pas d'intrus évident)

function melanger(liste, rnd) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Propositions [{texte, juste}] dans un ordre aléatoire, ou null si aucun leurre n'est possible.
// Leurres : réponses des cartes du même paquet et du même genre (texte à trous ou non), puis de la même UE,
// puis du reste ; jamais deux fois la même réponse (après normalisation).
export function propositionsCarte(carte, paquet, donnees, { rnd = Math.random, n = NB_PROPOSITIONS } = {}) {
  const bonne = refText(carte || {}).trim();
  if (!bonne) return null;
  const paquets = donnees?.paquets || {};
  const ue = paquets[paquet]?.ue;
  const trous = carte.type === 'cloze';
  const vues = new Set([normaliser(bonne)]);
  const niveaux = [[], [], []];
  for (const pid of [paquet, ...Object.keys(paquets).filter(id => id !== paquet)]) {
    const p = paquets[pid];
    for (const c of p?.cartes || []) {
      if (!c || (pid === paquet && c.id === carte.id)) continue;
      const texte = refText(c).trim();
      const k = normaliser(texte);
      if (!k || vues.has(k)) continue;
      vues.add(k);
      const memeGenre = (c.type === 'cloze') === trous;
      niveaux[!memeGenre ? 2 : pid === paquet ? 0 : p.ue === ue ? 1 : 2].push(texte);
    }
  }
  const leurres = [];
  for (const niveau of niveaux) {
    const manque = n - 1 - leurres.length;
    if (manque <= 0) break;
    const proches = niveau.sort((a, b) => Math.abs(a.length - bonne.length) - Math.abs(b.length - bonne.length)).slice(0, VOISINES);
    leurres.push(...melanger(proches, rnd).slice(0, manque));
  }
  if (!leurres.length) return null;
  return melanger([{ texte: bonne, juste: true }, ...leurres.map(texte => ({ texte, juste: false }))], rnd);
}

// Résultat de correction d'un choix (même forme que corrigerLocal).
export function resultatQcmCarte(proposition) {
  const juste = !!proposition?.juste;
  return {
    verdict: juste ? 'partiel' : 'faux', idees_trouvees: [], idees_manquantes: [], erreurs: [], confiance: 1,
    explication: juste ? "Bonne réponse. En QCM, elle compte « partiel » : la carte reviendra plus tôt qu'en l'écrivant."
      : "Ce n'était pas ça : relis la réponse attendue.",
    correcteur: 'qcm',
  };
}
