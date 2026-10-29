// Contrôle du jour dans l'appli (décision du 29 oct. 2026) : les contrôles préparés (mercredi : 30
// questions ; lundi et vendredi : 10) se passaient avec Claude, qui manque parfois de jetons. L'appli
// charge seulement le contrôle du jour, le corrige au barème des partiels et écrit le résultat dans
// controles/AAAA-MM-JJ.json (Claude le vérifie et applique l'objectif ensuite).
// Module pur : aucun accès au DOM.
import { jourParis, isoParis } from './temps.js';

export const BAREME = [1, 0.5, 0.2, 0];   // 0 erreur, 1, 2, 3 ou plus
export const SEUIL_BLOCAGE = 10;
export const SEUIL_OBJECTIF = 15;

// Contrôle préparé pour ce jour : {date, prepare, resultat} ou null s'il n'y en a pas.
export function controleDuJour(donnees, maintenant) {
  const date = jourParis(maintenant);
  const prepare = donnees.prepares?.[date];
  if (!prepare || !Array.isArray(prepare.questions) || !prepare.questions.length) return null;
  return { date, prepare, resultat: donnees.controles?.[date] || null };
}

const lettresVraies = q => q.propositions.filter(p => p.vrai).map(p => p.l);

// reponses : {num: ['A', 'C']} ; une question sans réponse = aucune case cochée.
export function corrigerControle(prepare, reponses, { maintenant, appareil = 'inconnu' }) {
  const bareme = Array.isArray(prepare.bareme) && prepare.bareme.length === 4 ? prepare.bareme : BAREME;
  let points = 0;
  const questions = prepare.questions.map(q => {
    const cochees = new Set((reponses[q.num] || []).filter(l => q.propositions.some(p => p.l === l)));
    const vraies = new Set(lettresVraies(q));
    const erreurs = q.propositions.filter(p => cochees.has(p.l) !== vraies.has(p.l)).length;
    const pts = bareme[Math.min(erreurs, 3)];
    points += pts;
    return { ...q, reponse: [...cochees].sort().join(''), erreurs, points: pts };
  });
  points = Math.round(points * 100) / 100;
  const note = Math.round((points / questions.length) * 20 * 100) / 100;
  const mini = prepare.type === 'mini';
  return {
    date: prepare.date, type: prepare.type || 'mercredi', nb_questions: questions.length,
    bareme: '0 erreur = 1, 1 = 0,5, 2 = 0,2, 3 ou plus = 0 ; total ramené sur 20',
    points, note, seuil: SEUIL_OBJECTIF, bloque: note < SEUIL_BLOCAGE,
    passe_dans: 'rappel2', passe_le: isoParis(maintenant), appareil,
    remarques: `Passé dans Rappel 2.${mini ? ' Mini-contrôle : ne change pas l\'objectif.' : ' Objectif ensuite : à appliquer par Claude (règle du mercredi).'}${note < SEUIL_BLOCAGE ? ' Sous 10 : bloqué jusqu\'au rattrapage avec Claude.' : ''}`,
    questions,
  };
}

export function opControle(resultat) {
  return { type: 'fichier', path: `controles/${resultat.date}.json`, texte: JSON.stringify(resultat, null, 1) + '\n' };
}
