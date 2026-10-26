// Mains libres : reconnaissance et synthèse vocales simulées ; une carte lue, réponse dictée, verdict dit, envoi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { jourParis } from '../../js/temps.js';
import { demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, CARTES, fichiersDepot, attendre, texte, dont } from './harnais.mjs';

let serveur, navigateur;
before(async () => { serveur = await demarrerServeur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur?.close(); await serveur?.fermer(); });

// Ce que « l'étudiant » dit pour chaque question (jamais la réponse attendue mot pour mot : Gemini corrige).
const DICTEES = { 'for-01': 'il en a six', 'for-02': 'il est équilatéral' };
const VOIX = Object.fromEntries(Object.entries(DICTEES).map(([id, r]) => [CARTES[id].q, r]));

test('mains libres : la question est lue, la réponse dictée est corrigée, le verdict est dit', async () => {
  const o = await ouvrir(navigateur, serveur.base, { voix: VOIX });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    await page.getByText('Je lis les questions, tu réponds à voix haute.').waitFor();
    await clic(page, 'Mains libres');
    await page.getByRole('heading', { name: 'Mains libres' }).waitFor();
    await verifierEcran(page, 'mains-libres-intro');
    await clic(page, 'Démarrer');

    // La première question est lue (après la présentation), puis j'écoute.
    await page.locator('.ml-etat--ecoute').waitFor({ timeout: 10000 });
    const texteQuestion = (await texte(page.locator('.ml-question'))).trim();
    const id = Object.keys(DICTEES).find(k => CARTES[k].q === texteQuestion);
    assert.ok(id, `question inattendue : ${texteQuestion}`);
    const dits = () => page.evaluate(() => window.__dits.slice());
    assert.ok((await dits()).join(' ').includes(texteQuestion), 'la question est dite à voix haute');
    assert.match(await texte(page.locator('.seance-haut__position')), /^Carte 1 sur 5$/);
    assert.equal(await texte(page.locator('.ml-commandes')), 'Tu peux dire : je ne sais pas · répète · indice · explique · suivant · pause · je conteste · stop');
    await verifierEcran(page, 'mains-libres-ecoute');

    // Réponse dictée → correction → verdict dit.
    await attendre(async () => (await dits()).includes('Juste.'), { message: 'verdict dit à voix haute' });
    await page.locator('.ml-verdict .verdict__mot', { hasText: 'Juste' }).waitFor();
    assert.equal(await texte(page.locator('.ml-reponse')), `« ${DICTEES[id]} »`);
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');
    assert.ok(o.requetesGemini.some(r => r.genre === 'correction'));
    await verifierEcran(page, 'mains-libres-verdict');

    // Pause : le micro est coupé, l'aide dit quoi toucher.
    await clic(page, 'Pause');
    await page.locator('.ml-commandes', { hasText: 'Micro coupé : touche « Reprendre ».' }).waitFor();
    await verifierEcran(page, 'mains-libres-pause');

    // Arrêter (deux appuis) : bilan, envoi.
    await page.locator('.seance-haut .btn').first().click();
    await page.locator('.seance-haut .btn', { hasText: 'Touche encore' }).waitFor();
    await page.locator('.seance-haut .btn').first().click();
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    assert.equal(await texte(page.locator('.grand-compteur__chiffre')), '1/30');
    assert.match(await texte(page.locator('.chiffres--doux')), /^1 réponse · 1 juste$/);
    // Comme la fin de séance écrite : ce qui manque pour l'objectif (pas de ✓).
    assert.equal(await texte(page.locator('.objectif-ligne')), `Encore 4 cartes${dont('1 révision')} pour l'objectif.`);
    assert.equal(await page.locator('.grand-compteur--atteint').count(), 0);
    await verifierEcran(page, 'mains-libres-fin');
    await attendre(() => faux.commits().length === 2, { message: 'envoi de fin de séance' });
    const lignes = fichiersDepot(faux)[`rappel/progres/reponses/${jourParis(Date.now()).slice(0, 7)}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.reponse, l.verdict, l.correcteur, l.nouvelle]), [[id, DICTEES[id], 'juste', 'gemini', false]]);

    await clic(page, 'Retour');
    await page.locator('.page--aujourdhui').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nuit')), false, 'le thème de nuit est retiré');
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});
