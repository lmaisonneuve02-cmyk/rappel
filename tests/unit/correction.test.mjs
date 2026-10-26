// Orchestration de la correction, avec un fetch simulé (aucun appel réseau, cartes synthétiques).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { corriger, contester } from '../../js/correction.js';
import { review, noteDe } from '../../js/fsrs.js';
import { isoParis, JOUR } from '../../js/temps.js';

const CLE = 'AQ.cle-de-test-123';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const T = Date.parse('2026-10-12T10:00:00Z');

const carte = {
  id: 'syn-01', type: 'fait', q: 'Quel système ralentit le cœur ?', a: 'Le système parasympathique.',
  bareme: {
    idees: [
      { id: 'k1', texte: 'parasympathique', formulations: ['système vagal', 'nerf vague'], obligatoire: true },
      { id: 'k2', texte: 'acétylcholine', formulations: ['ACh', 'médiateur cholinergique'], obligatoire: false },
    ],
    pieges: [{ si: 'sympathique', sauf: 'parasympathique', pourquoi: 'Le sympathique accélère le cœur.' }],
  },
};

function donneesDe({ carnet, modeles } = {}) {
  return {
    carnet: carnet ?? { abreviations: { snp: 'système nerveux parasympathique' }, cartes: { 'syn-01': { acceptees: ['le vague'], refusees: [] } } },
    reglages: { modeles: { correction: '', contestation: '', ...modeles } },
  };
}

// fetch simulé : rejoue les réponses données (la dernière se répète) et garde les appels.
function fauxFetch(...reponses) {
  const appels = [];
  const f = async (url, options) => {
    appels.push({ url, options, corps: JSON.parse(options.body) });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
    if (r instanceof Error) throw r;
    const texte = typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps);
    return new Response(texte, { status: r.status || 200 });
  };
  f.appels = appels;
  return f;
}
const succes = obj => ({ status: 200, corps: { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] } });
const erreur = (status, etat, message) => ({ status, corps: { error: { code: status, message, status: etat, details: [] } } });
const correction = (verdict, confiance, apprendre = {}) => ({
  idees_trouvees: [], idees_manquantes: [], erreurs: [], verdict, confiance, explication: 'Explication.',
  apprendre: { formulation: '', abreviations: [], ...apprendre },
});
const pasDeReseau = Object.assign(async () => { throw new Error('fetch ne doit pas être appelé'); }, { appels: [] });

const args = (reponse, extra = {}) => ({
  carte, paquet: 'p1', reponse, donnees: donneesDe(), gemini: { cle: CLE, fetch: pasDeReseau }, enLigne: true,
  maintenant: T, appareil: 'tel-x', ...extra,
});

describe('corriger : sans appel à Gemini', () => {
  test('« je ne sais pas » et réponse vide : faux, idées obligatoires manquantes', async () => {
    for (const reponse of ['Je ne sais pas', 'aucune idée', '   ', '', null]) {
      const { resultat, ops } = await corriger(args(reponse));
      assert.equal(resultat.verdict, 'faux');
      assert.equal(resultat.correcteur, 'je-ne-sais-pas');
      assert.deepEqual(resultat.idees_manquantes, ['parasympathique']);
      assert.deepEqual(ops, []);
    }
  });

  test('réponse attendue mot pour mot : exact', async () => {
    const { resultat, ops } = await corriger(args('le systeme PARASYMPATHIQUE !'));
    assert.equal(resultat.correcteur, 'exact');
    assert.equal(resultat.verdict, 'juste');
    assert.deepEqual(ops, []);
  });

  test('réponse déjà acceptée au carnet : carnet', async () => {
    const { resultat } = await corriger(args('Le Vague'));
    assert.equal(resultat.correcteur, 'carnet');
    assert.equal(resultat.verdict, 'juste');
  });

  test('sans clé : correction de l\'appareil (local), abréviations du carnet utilisées', async () => {
    const { resultat, ops } = await corriger(args('le SNP', { gemini: { cle: '', fetch: pasDeReseau } }));
    assert.equal(resultat.correcteur, 'local');
    assert.equal(resultat.verdict, 'juste');
    assert.equal(resultat.erreurGemini, undefined);
    assert.deepEqual(ops, []);
    const sansGemini = await corriger({ ...args('nerf vague'), gemini: undefined });
    assert.equal(sansGemini.resultat.correcteur, 'local');
  });

  test('clé mais hors ligne : hors-ligne, sans appel réseau', async () => {
    const { resultat, ops } = await corriger(args('le sympathique', { enLigne: false }));
    assert.equal(resultat.correcteur, 'hors-ligne');
    assert.equal(resultat.verdict, 'faux');
    assert.deepEqual(resultat.erreurs, ['Le sympathique accélère le cœur.']);
    assert.equal(resultat.erreurGemini, undefined);
    assert.deepEqual(ops, []);
  });
});

describe('corriger : avec Gemini', () => {
  test('modèle des réglages, contexte du carnet, formulation et abréviations apprises', async () => {
    const f = fauxFetch(succes(correction('juste', 0.95, {
      formulation: 'le nerf X ralentit le cœur', abreviations: [{ abr: 'nX', sens: 'nerf vague' }],
    })));
    const d = donneesDe({ modeles: { correction: 'gemini-2.5-flash-lite' } });
    const { resultat, ops } = await corriger(args('le nX ralentit le coeur', { donnees: d, gemini: { cle: CLE, fetch: f } }));
    assert.equal(f.appels.length, 1);
    assert.equal(f.appels[0].url, BASE + 'gemini-2.5-flash-lite:generateContent');
    const envoye = f.appels[0].corps.contents[0].parts[0].text;
    assert.ok(envoye.includes('« le vague »'), 'les réponses déjà acceptées partent avec la requête');
    assert.equal(resultat.correcteur, 'gemini');
    assert.equal(resultat.verdict, 'juste');
    assert.deepEqual(ops, [
      { type: 'carnet', carte: 'syn-01', acceptee: 'le nerf X ralentit le cœur' },
      { type: 'carnet', abreviations: { nX: 'nerf vague' } },
    ]);
  });

  test('modèle par défaut si le réglage est vide', async () => {
    const f = fauxFetch(succes(correction('juste', 0.9)));
    const { ops } = await corriger(args('le nerf vague freine', { gemini: { cle: CLE, fetch: f } }));
    assert.equal(f.appels[0].url, BASE + 'gemini-3.5-flash-lite:generateContent');
    assert.deepEqual(ops, []);   // juste sans formulation ni abréviation : rien à retenir
  });

  test('confiance basse : cas « incertain » à revoir', async () => {
    const f = fauxFetch(succes(correction('partiel', 0.5)));
    const { resultat, ops } = await corriger(args('le vague, je crois', { gemini: { cle: CLE, fetch: f } }));
    assert.equal(resultat.verdict, 'partiel');
    assert.deepEqual(ops, [{ type: 'a-revoir', cas: {
      id: `tel-x-${T}`, ts: T, type: 'incertain', paquet: 'p1', carte: 'syn-01', reponse: 'le vague, je crois',
      verdict: 'partiel', confiance: 0.5, explication: 'Explication.',
    } }]);
  });

  test('faux et sûr : réponse refusée au carnet (200 caractères au plus)', async () => {
    const longue = 'le sympathique ' + 'x'.repeat(300);
    const f = fauxFetch(succes(correction('faux', 0.95)));
    const { ops } = await corriger(args(longue, { gemini: { cle: CLE, fetch: f } }));
    assert.deepEqual(ops, [{ type: 'carnet', carte: 'syn-01', refusee: longue.slice(0, 200) }]);
    // faux mais peu sûr : pas au carnet
    const g = fauxFetch(succes(correction('faux', 0.8)));
    assert.deepEqual((await corriger(args('le sympathique', { gemini: { cle: CLE, fetch: g } }))).ops, []);
  });

  test('horloge injectée sous forme de fonction', async () => {
    const f = fauxFetch(succes(correction('faux', 0.2)));
    const { ops } = await corriger(args('autre chose', { gemini: { cle: CLE, fetch: f }, maintenant: () => T + 5 }));
    assert.equal(ops[0].cas.ts, T + 5);
    assert.equal(ops[0].cas.id, `tel-x-${T + 5}`);
  });

  test('erreur de Gemini : correction hors ligne et erreurGemini {code, message}', async () => {
    const f = fauxFetch(erreur(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'));
    const { resultat, ops } = await corriger(args('le sympathique', { gemini: { cle: CLE, fetch: f } }));
    assert.equal(resultat.correcteur, 'hors-ligne');
    assert.equal(resultat.verdict, 'faux');
    assert.equal(resultat.erreurGemini.code, 'quota');
    assert.equal(typeof resultat.erreurGemini.message, 'string');
    assert.ok(resultat.erreurGemini.message.length > 0);
    assert.deepEqual(ops, []);
    const reseau = fauxFetch(new TypeError('Failed to fetch'));
    const r2 = await corriger(args('nerf vague', { gemini: { cle: CLE, fetch: reseau } }));
    assert.deepEqual([r2.resultat.correcteur, r2.resultat.verdict, r2.resultat.erreurGemini.code], ['hors-ligne', 'juste', 'reseau']);
  });
});

describe('contester', () => {
  const premier = { verdict: 'faux', idees_trouvees: [], idees_manquantes: ['parasympathique'], erreurs: ['x'], confiance: 0.8, explication: 'Non.', correcteur: 'gemini' };
  const etatAvant = review(null, 3, T - 3 * JOUR);
  const base = (extra = {}) => ({
    carte, paquet: 'p1', reponse: 'le frein vagal', resultat: premier, raison: 'Le vague, c\'est le parasympathique.',
    etatAvant, donnees: donneesDe(), maintenant: T, appareil: 'tel-x', ligneId: 'tel-x-111', ...extra,
  });
  const avis = (etudiant_a_raison, verdict, formulation = '') => succes({
    analyse: 'Analyse détaillée.', etudiant_a_raison, verdict, explication: 'Second avis.', formulation,
  });

  test('sans clé ou hors ligne : erreur claire, sans appel réseau', async () => {
    const message = /La contestation demande une connexion et la clé Gemini\./;
    await assert.rejects(contester(base({ gemini: { cle: '', fetch: pasDeReseau } })), message);
    await assert.rejects(contester(base({ gemini: undefined })), message);
    await assert.rejects(contester(base({ gemini: { cle: CLE, fetch: pasDeReseau }, enLigne: false })), message);
  });

  test('après un indice : acceptée « juste », mais notée « partiel »', async () => {
    const f = fauxFetch(avis(true, 'juste', 'le frein vagal ralentit le cœur'));
    const r = await contester(base({ gemini: { cle: CLE, fetch: f }, indice: true }));
    assert.equal(r.accepte, true);
    assert.equal(r.resultat.verdict, 'partiel');
    assert.deepEqual(r.etatApres, review(etatAvant, noteDe('partiel'), T));
    const ligne = r.ops.find(o => o.type === 'reponse').ligne;
    assert.deepEqual([ligne.verdict, ligne.note, ligne.indice], ['partiel', noteDe('partiel'), true]);
  });

  test('acceptée : état recalculé, ligne de contestation, carnet, cas « accepte »', async () => {
    const f = fauxFetch(avis(true, 'juste', 'le frein vagal ralentit le cœur'));
    const r = await contester(base({ gemini: { cle: CLE, fetch: f }, donnees: donneesDe({ modeles: { contestation: 'gemini-3.8-pro' } }) }));
    assert.equal(f.appels[0].url, BASE + 'gemini-3.8-pro:generateContent');
    assert.equal(r.accepte, true);
    const etatApres = review(etatAvant, noteDe('juste'), T);
    assert.deepEqual(r.etatApres, etatApres);
    assert.equal(r.resultat.verdict, 'juste');
    assert.equal(r.resultat.correcteur, 'contestation');
    assert.deepEqual([r.resultat.idees_manquantes, r.resultat.erreurs], [[], []]);
    assert.deepEqual(r.ops, [
      { type: 'srs', paquet: 'p1', carte: 'syn-01', etat: etatApres },
      { type: 'reponse', ligne: {
        id: `tel-x-${T}`, ts: T, t: isoParis(T), appareil: 'tel-x', paquet: 'p1', carte: 'syn-01', reponse: 'le frein vagal',
        verdict: 'juste', correcteur: 'contestation', note: 3, nouvelle: false, remplace: 'tel-x-111',
      } },
      { type: 'carnet', carte: 'syn-01', acceptee: 'le frein vagal ralentit le cœur' },
      { type: 'a-revoir', cas: {
        id: `tel-x-${T}`, ts: T, type: 'contestation', paquet: 'p1', carte: 'syn-01', reponse: 'le frein vagal',
        verdict: 'juste', raison: 'Le vague, c\'est le parasympathique.', avis: 'Analyse détaillée.', explication: 'Second avis.', issue: 'accepte',
      } },
    ]);
  });

  test('acceptée vers « partiel », carte nouvelle : pas de formulation, nouvelle: true', async () => {
    const f = fauxFetch(avis(true, 'partiel', 'ignorée'));
    const r = await contester(base({ gemini: { cle: CLE, fetch: f }, etatAvant: null, raison: '' }));
    assert.equal(f.appels[0].url, BASE + 'gemini-3.8-flash:generateContent');
    assert.equal(r.accepte, true);
    assert.deepEqual(r.etatApres, review(null, 2, T));
    assert.deepEqual(r.resultat.idees_manquantes, ['parasympathique']);
    assert.deepEqual(r.ops.map(o => o.type), ['srs', 'reponse', 'a-revoir']);
    assert.equal(r.ops[1].ligne.nouvelle, true);
    assert.equal(r.ops[1].ligne.note, 2);
    assert.equal('raison' in r.ops[2].cas, false);
  });

  test('refusée : seulement un cas « refuse », verdict inchangé', async () => {
    const f = fauxFetch(avis(false, 'faux'));
    const r = await contester(base({ gemini: { cle: CLE, fetch: f } }));
    assert.equal(r.accepte, false);
    assert.equal(r.resultat.verdict, 'faux');
    assert.equal(r.resultat.explication, 'Second avis.');
    assert.equal(r.etatApres, undefined);
    assert.deepEqual(r.ops, [{ type: 'a-revoir', cas: {
      id: `tel-x-${T}`, ts: T, type: 'contestation', paquet: 'p1', carte: 'syn-01', reponse: 'le frein vagal',
      verdict: 'faux', raison: 'Le vague, c\'est le parasympathique.', avis: 'Analyse détaillée.', explication: 'Second avis.', issue: 'refuse',
    } }]);
  });

  test('erreur de Gemini : remonte avec son code', async () => {
    const f = fauxFetch(erreur(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'));
    await assert.rejects(contester(base({ gemini: { cle: CLE, fetch: f } })), e => e.name === 'ErreurGemini' && e.code === 'cle');
  });
});
