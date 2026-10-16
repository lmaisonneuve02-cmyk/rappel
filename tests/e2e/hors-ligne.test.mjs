// Hors ligne : service worker actif, rechargement sans réseau → l'appli s'ouvre (cartes en cache),
// une réponse est gardée sur l'appareil, puis envoyée au retour du réseau.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { jourParis } from '../../js/temps.js';
import { VERSION } from '../../js/config.js';
import { demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, carteDeQuestion, fichiersDepot, attendre, texte } from './harnais.mjs';

let serveur, navigateur;
before(async () => { serveur = await demarrerServeur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur?.close(); await serveur?.fermer(); });

// Réponses que la correction de l'appareil juge justes.
const REPONSES = { 'for-01': 'il en a 6', 'for-02': 'il est équilatéral' };
const HORS_LIGNE = "Hors ligne : tout est gardé sur l'appareil";

test('hors ligne : l\'appli s\'ouvre sans réseau, la réponse est gardée puis envoyée', async () => {
  const o = await ouvrir(navigateur, serveur.base, { sw: true });
  const { page, faux } = o;
  const bloc = () => page.locator('.page--aujourdhui .bloc-seance').waitFor({ timeout: 10000 });
  try {
    await page.goto(serveur.base);
    await bloc();
    await page.locator('#synchro-texte', { hasText: 'Enregistré' }).waitFor();

    // Service worker installé, coquille en cache.
    await attendre(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { message: 'service worker actif' });
    await attendre(() => page.evaluate(async v => (await (await caches.open(`rappel-v${v}`)).keys()).length >= 30, VERSION),
      { message: 'coquille en cache' });

    // Servie sous /rappel/ (comme sur GitHub Pages) : portée du service worker, manifeste, icônes et coquille en cache.
    assert.match(serveur.base, /\/rappel\/$/);
    const pwa = await page.evaluate(async v => {
      const lien = document.querySelector('link[rel="manifest"]').href;
      const m = await (await fetch(lien)).json();
      const icones = [...m.icons.map(i => new URL(i.src, lien).href),
        ...[...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(l => l.href)];
      const cache = await caches.open(`rappel-v${v}`);
      return {
        portee: (await navigator.serviceWorker.getRegistration()).scope,
        start: new URL(m.start_url, lien).href, scope: new URL(m.scope, lien).href,
        icones: (await Promise.all(icones.map(async u => [u, (await fetch(u)).status]))).filter(([u, s]) => s !== 200 || !u.includes('/rappel/icons/')),
        horsAppli: (await cache.keys()).map(r => r.url).filter(u => !u.startsWith(location.origin + '/rappel/')),
      };
    }, VERSION);
    assert.deepEqual(pwa, { portee: serveur.base, start: serveur.base, scope: serveur.base, icones: [], horsAppli: [] });
    assert.deepEqual(serveur.introuvables, [], 'aucun fichier demandé hors de /rappel/ ni introuvable');
    // Un rechargement en ligne fait passer la feuille des polices par le service worker (mise en cache).
    await page.reload();
    await bloc();
    await attendre(() => page.evaluate(async () => (await (await caches.open('rappel-polices')).keys()).length >= 1), { message: 'polices en cache' });

    // Sans réseau : l'appli s'ouvre depuis le cache, avec les cartes gardées sur l'appareil.
    await o.horsLigne(true);
    await page.reload();
    await bloc();
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await page.getByText("Hors ligne : correction sur l'appareil. Tout est gardé et partira au retour du réseau.").waitFor();
    await page.locator('#synchro-texte', { hasText: HORS_LIGNE }).waitFor();
    await page.getByText('2 révisions · 3 nouvelles cartes').waitFor();
    await verifierEcran(page, 'hors-ligne-aujourdhui');

    // Une réponse, corrigée sur l'appareil.
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer' }).click();
    await page.locator('#reponse').waitFor();
    const carte = carteDeQuestion(await texte(page.locator('.page--seance h1.question')));
    await page.fill('#reponse', REPONSES[carte.id]);
    await clic(page, 'Corriger');
    await page.locator('.page--seance .verdict').waitFor();
    assert.equal(await texte(page.locator('.verdict__mot')), 'Juste');
    await page.locator('.badge', { hasText: 'Corrigé hors ligne' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    assert.equal(o.requetesGemini.length, 0, 'Gemini n\'est pas appelé hors ligne');
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');
    await verifierEcran(page, 'hors-ligne-verdict');

    await page.locator('.seance-haut .btn').first().click();
    await page.locator('.seance-haut .btn').first().click();
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    await page.locator('.etat-envoi', { hasText: HORS_LIGNE }).waitFor();
    await verifierEcran(page, 'hors-ligne-fin');
    assert.equal(faux.commits().length, 1, 'rien n\'est parti sans réseau');

    // L'appli fermée puis rouverte sans réseau : la réponse est toujours là.
    await page.reload();
    await bloc();
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');

    // Retour du réseau : envoi automatique.
    await o.horsLigne(false);
    await attendre(() => faux.commits().length === 2, { message: 'envoi au retour du réseau' });
    await page.locator('#synchro-texte', { hasText: 'Enregistré' }).waitFor();
    const lignes = fichiersDepot(faux)[`rappel/progres/reponses/${jourParis(Date.now()).slice(0, 7)}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.reponse, l.verdict, l.correcteur]), [[carte.id, REPONSES[carte.id], 'juste', 'hors-ligne']]);
    assert.ok(fichiersDepot(faux)['rappel/progres/srs/ess-formes.json'].cards[carte.id].reps === 2);
    o.verifierConsole([/ERR_INTERNET_DISCONNECTED/]);
  } finally {
    await o.fermer();
  }
});
