// Orchestration de la correction : « je ne sais pas », réponse déjà connue, Gemini, sinon l'appareil.
// Renvoie le résultat et les opérations de synchro à ajouter (carnet, a-revoir, srs, reponse).
// Module pur : fetch et horloge sont injectés.
import { estJeNeSaisPas, normaliser } from './texte.js';
import { ideesDe, correspondanceDirecte, corrigerLocal } from './correcteur.js';
import { corrigerGemini, contesterGemini, ErreurGemini } from './gemini.js';
import { MODELES_DEFAUT } from './config.js';
import { review, noteDe } from './fsrs.js';
import { isoParis } from './temps.js';

const SEUIL_INCERTAIN = 0.7;   // en dessous : cas à revoir
const SEUIL_REFUS = 0.9;       // faux et sûr : réponse retenue comme refusée
const MAX_REFUSEE = 200;

const instant = m => (typeof m === 'function' ? m() : m ?? Date.now());
const sansVide = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function contexte(carte, donnees) {
  const carnet = donnees?.carnet || {};
  return { carnetCarte: carnet.cartes?.[carte.id] ?? null, abreviations: carnet.abreviations || {} };
}

function modeleDe(gemini, donnees, usage) {
  return gemini?.modele || donnees?.reglages?.modeles?.[usage] || MODELES_DEFAUT[usage];
}

// « Je ne sais pas » ou réponse vide : faux, avec toutes les idées obligatoires à revoir.
function jeNeSaisPas(carte) {
  const idees = ideesDe(carte);
  const obligatoires = idees.some(i => i.obligatoire) ? idees.filter(i => i.obligatoire) : idees;
  return {
    verdict: 'faux', idees_trouvees: [], idees_manquantes: obligatoires.map(i => i.texte), erreurs: [],
    confiance: 1, explication: 'Pas grave : lis la réponse, la carte reviendra bientôt.', correcteur: 'je-ne-sais-pas',
  };
}

// Opérations tirées d'une correction de Gemini.
function opsGemini(r, { carte, paquet, reponse, t, appareil }) {
  const ops = [];
  if (r.confiance < SEUIL_INCERTAIN) {
    ops.push({ type: 'a-revoir', cas: {
      id: `${appareil}-${t}`, ts: t, type: 'incertain', paquet, carte: carte.id, reponse,
      verdict: r.verdict, confiance: r.confiance, explication: r.explication,
    } });
  }
  const formulation = r.apprendre?.formulation;
  if (r.verdict === 'juste' && formulation) ops.push({ type: 'carnet', carte: carte.id, acceptee: formulation });
  const abreviations = r.apprendre?.abreviations || [];
  if (abreviations.length) {
    ops.push({ type: 'carnet', abreviations: Object.fromEntries(abreviations.map(a => [a.abr, a.sens])) });
  }
  if (r.verdict === 'faux' && r.confiance >= SEUIL_REFUS && normaliser(reponse)) {
    ops.push({ type: 'carnet', carte: carte.id, refusee: reponse.slice(0, MAX_REFUSEE) });
  }
  return ops;
}

export async function corriger({ carte, paquet, reponse, donnees, gemini = {}, enLigne = true, idf, maintenant, appareil = 'inconnu' }) {
  const texte = String(reponse ?? '').trim();
  if (!normaliser(texte) || estJeNeSaisPas(texte)) return { resultat: jeNeSaisPas(carte), ops: [] };

  const ctx = contexte(carte, donnees);
  const direct = correspondanceDirecte(carte, texte, ctx.carnetCarte);
  if (direct) return { resultat: direct, ops: [] };

  const { cle, fetch } = gemini || {};
  const local = correcteur => ({ ...corrigerLocal(carte, texte, { idf, abreviations: ctx.abreviations }), correcteur });
  if (!cle) return { resultat: local('local'), ops: [] };
  if (!enLigne) return { resultat: local('hors-ligne'), ops: [] };

  try {
    const r = await corrigerGemini(carte, texte, ctx, { cle, modele: modeleDe(gemini, donnees, 'correction'), fetch });
    return { resultat: r, ops: opsGemini(r, { carte, paquet, reponse: texte, t: instant(maintenant), appareil }) };
  } catch (e) {
    if (!(e instanceof ErreurGemini)) throw e;
    return { resultat: { ...local('hors-ligne'), erreurGemini: { code: e.code, message: e.message } }, ops: [] };
  }
}

// Second avis de Gemini. Acceptée : nouvel état de la carte, ligne « contestation » qui remplace
// la ligne contestée, formulation au carnet. Dans tous les cas : un cas « à revoir ».
// Les erreurs de Gemini (ErreurGemini, message prêt à afficher) remontent à l'appelant.
export async function contester({
  carte, paquet, reponse, resultat, raison = '', etatAvant = null, donnees, gemini = {}, enLigne = true,
  maintenant, appareil = 'inconnu', ligneId,
}) {
  const { cle, fetch } = gemini || {};
  if (!cle || !enLigne) throw new Error('La contestation demande une connexion et la clé Gemini.');
  const texte = String(reponse ?? '').trim();
  const avis = await contesterGemini(carte, texte, resultat, raison, contexte(carte, donnees),
    { cle, modele: modeleDe(gemini, donnees, 'contestation'), fetch });
  const t = instant(maintenant);
  const cas = issue => ({ type: 'a-revoir', cas: sansVide({
    id: `${appareil}-${t}`, ts: t, type: 'contestation', paquet, carte: carte.id, reponse: texte,
    verdict: avis.verdict, raison: raison || undefined, avis: avis.analyse, explication: avis.explication, issue,
  }) });

  if (!avis.etudiant_a_raison) {
    return { resultat: { ...resultat, explication: avis.explication || resultat?.explication }, accepte: false, avis, ops: [cas('refuse')] };
  }

  const note = noteDe(avis.verdict);
  const etatApres = review(etatAvant, note, t);
  const ligne = sansVide({
    id: `${appareil}-${t}`, ts: t, t: isoParis(t), appareil, paquet, carte: carte.id, reponse: texte,
    verdict: avis.verdict, correcteur: 'contestation', note, nouvelle: !etatAvant, remplace: ligneId,
  });
  const ops = [{ type: 'srs', paquet, carte: carte.id, etat: etatApres }, { type: 'reponse', ligne }];
  if (avis.formulation) ops.push({ type: 'carnet', carte: carte.id, acceptee: avis.formulation });
  ops.push(cas('accepte'));

  const juste = avis.verdict === 'juste';
  const nouveau = {
    ...resultat, verdict: avis.verdict, explication: avis.explication, correcteur: 'contestation',
    ...(juste ? { idees_manquantes: [], erreurs: [] } : {}),
  };
  return { resultat: nouveau, accepte: true, avis, etatApres, ops };
}
