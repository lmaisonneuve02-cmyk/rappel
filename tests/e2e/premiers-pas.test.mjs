// Premiers pas : sans jeton → jeton d'accès vérifié → clé Gemini → « C'est parti » → Aujourd'hui.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, JETON, texte } from './harnais.mjs';

let serveur, navigateur;
before(async () => { serveur = await demarrerServeur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur?.close(); await serveur?.fermer(); });

test('premiers pas : jeton, clé Gemini, puis la séance du jour', async () => {
  const o = await ouvrir(navigateur, serveur.base, { jeton: false });
  const { page } = o;
  try {
    await page.goto(serveur.base);
    await page.getByRole('heading', { name: 'Relier tes cartes' }).waitFor();
    await page.getByText('Étape 1 sur 3').waitFor();
    await verifierEcran(page, 'premiers-pas-1');

    // Champ vide : message qui dit quoi faire.
    await clic(page, 'Vérifier');
    await page.getByText("Colle d'abord le jeton dans le champ.").waitFor();

    // Jeton refusé par GitHub : le message dit quoi faire, rien n'est enregistré.
    await page.fill('#jeton', 'github_pat_mauvais');
    await clic(page, 'Vérifier');
    await page.getByText('GitHub refuse ce jeton. Recopie-le en entier : il commence par github_pat_.').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('rappel.jeton')), null);
    await verifierEcran(page, 'premiers-pas-1-refuse');

    await page.fill('#jeton', JETON);
    await page.getByText('GitHub refuse ce jeton.', { exact: false }).waitFor({ state: 'detached' });
    await clic(page, 'Vérifier');
    await page.getByText(/Jeton accepté\s: Rappel peut lire et enregistrer/).waitFor();
    await page.getByText('Trouvé : 2 paquets, 9 cartes.').waitFor();
    await verifierEcran(page, 'premiers-pas-1-ok');
    assert.equal(await page.evaluate(() => localStorage.getItem('rappel.jeton')), JETON);

    await clic(page, 'Continuer');
    await page.getByRole('heading', { name: 'Correction par Gemini' }).waitFor();
    await page.getByText('Étape 2 sur 3').waitFor();
    // Identifiant de projet collé par erreur : refusé sur place, sans appel réseau.
    await page.fill('#cle-gemini', 'gen-lang-client-0123456789');
    await clic(page, 'Vérifier');
    await page.getByText("Ce n'est pas une clé Gemini : elle commence par AQ.", { exact: false }).waitFor();
    assert.equal(o.requetesGemini.length, 0);
    await page.fill('#cle-gemini', 'AQ.essai');
    await clic(page, 'Vérifier');
    await page.getByText('Gemini répond : la correction intelligente est prête.').waitFor();
    await verifierEcran(page, 'premiers-pas-2-ok');
    assert.equal(o.requetesGemini.length, 1);
    assert.equal(o.requetesGemini[0].cle, 'AQ.essai', 'la clé part en en-tête');
    assert.ok(!o.requetesGemini[0].url.includes('AQ.essai'), 'la clé ne part jamais dans l\'adresse');

    await clic(page, 'Continuer');
    await page.getByRole('heading', { name: "C'est parti" }).waitFor();
    await page.getByText('Objectif : 30 cartes par jour : tes révisions d\'abord, puis des nouvelles pour compléter.').waitFor();
    await verifierEcran(page, 'premiers-pas-3');

    await clic(page, 'Voir ma séance du jour');
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    await page.getByRole('heading', { name: 'Ta séance du jour' }).waitFor();
    await page.getByText('2 révisions · 3 nouvelles cartes').waitFor();
    assert.equal(await texte(page.locator('.barre-action .btn--principal')), 'Commencer · 5 cartes');
    assert.equal(await compteur(page), 'Cartes : 0/30 · Révisions : 2');
    assert.equal(await page.locator('#compteur').getAttribute('aria-label'), "0 carte sur 30 aujourd'hui, 2 révisions à faire. Comment on compte\u00a0?");
    // Révisions d'abord ; pas plus exigé que ce qui reste à proposer (2 révisions + 3 nouvelles).
    await page.getByText("environ 3 min · révisions d'abord").waitFor();
    await page.getByText('Objectif : encore 5 cartes (dont 2 révisions). Cette séance peut suffire.').waitFor();
    await page.locator('#synchro-texte', { hasText: 'Enregistré' }).waitFor();
    await verifierEcran(page, 'premiers-pas-aujourdhui');

    // « Comment on compte » : la règle du jour en clair.
    await page.locator('#compteur').click();
    const feuille = page.getByRole('dialog');
    await feuille.getByText("Objectif : 30 cartes par jour (révisions d'abord, puis des nouvelles pour compléter).").waitFor();
    await feuille.getByText('Une carte compte une fois, même si elle revient après une erreur.').waitFor();
    await feuille.getByText('Les révisions en avance comptent.').waitFor();
    await feuille.getByText("Au-delà, rien n'est exigé : tu peux continuer.").waitFor();
    await verifierEcran(page, 'comment-on-compte');
    await feuille.getByRole('button', { name: 'Compris' }).click();
    await feuille.waitFor({ state: 'detached' });
    o.verifierConsole([/status of 401/]);
  } finally {
    await o.fermer();
  }
});
