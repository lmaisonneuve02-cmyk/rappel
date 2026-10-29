// Réponse « cocher les idées » (décision du 29 oct. 2026) : Gemini était lent (environ 10 s par carte) et
// jugeait mal des réponses justes dites autrement ; écrire ou parler coûtait trop. Il répond dans sa tête,
// retourne la carte (pas avant DELAI_RETOURNER), puis coche les idées attendues qu'il avait, présentées
// dans un ordre mélangé. L'appli en tire le verdict : il ne choisit pas sa note. Garde-fous : contrôles
// du lundi, du mercredi et du vendredi, feuilles blanches.
// Module pur : aucun accès au DOM.
import { ideesDe } from './correcteur.js';

export const DELAI_RETOURNER = 3000;   // ms avant de pouvoir retourner la carte : chercher vraiment

// Idées à cocher, dans un ordre mélangé (on ne retient pas une position). Vide : la carte s'écrit.
export function ideesACocher(carte, rnd = Math.random) {
  const idees = ideesDe(carte).filter(i => i.texte).map(i => ({ id: i.id, texte: i.texte, obligatoire: i.obligatoire }));
  for (let i = idees.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idees[i], idees[j]] = [idees[j], idees[i]];
  }
  return idees;
}

// Verdict : toutes les idées obligatoires cochées → juste ; une partie → partiel ; aucune → faux.
// « J'ai aussi dit une erreur » retire le « juste ». Les idées facultatives ne changent rien au verdict.
export function resultatCoche(idees, cochees, { erreur = false } = {}) {
  const aucuneObligatoire = !idees.some(i => i.obligatoire);
  const compte = i => aucuneObligatoire || i.obligatoire;
  const avait = i => cochees.has(i.id);
  const trouvees = idees.filter(avait).map(i => i.texte);
  const manquantes = idees.filter(i => compte(i) && !avait(i)).map(i => i.texte);
  const total = idees.filter(compte).length;
  const n = idees.filter(i => compte(i) && avait(i)).length;
  let verdict = n === 0 ? 'faux' : n === total ? 'juste' : 'partiel';
  if (erreur && verdict === 'juste') verdict = 'partiel';
  const explication = verdict === 'juste' ? 'Tu avais toutes les idées attendues.'
    : verdict === 'partiel' ? (n === total ? 'Toutes les idées, mais avec une erreur : compté partiel.' : `Tu avais ${n} idée${n > 1 ? 's' : ''} sur ${total}.`)
      : "Aucune des idées attendues : la carte revient un peu plus loin.";
  return {
    verdict, idees_trouvees: trouvees, idees_manquantes: manquantes,
    erreurs: erreur ? ['Tu as signalé une erreur dans ta réponse.'] : [], confiance: 1, explication, correcteur: 'coche',
  };
}
