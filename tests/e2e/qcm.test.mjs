// QCM : série « Mélange des cours vus », cases cochées, points selon le barème des réglages, journal envoyé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { jourParis } from '../../js/temps.js';
import { demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, QCM, fichiersDepot, attendre, texte } from './harnais.mjs';

let serveur, navigateur;
before(async () => { serveur = await demarrerServeur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur?.close(); await serveur?.fermer(); });

// Barème des réglages de test : [1, 0.4, 0.1, 0]. Cases cochées → erreurs attendues.
const PLAN = {
  'ess-formes-q01': { cochees: ['A', 'C', 'E'], points: 1, erreurs: 0, titre: '1 point · sans faute', retour: 'Acquis : il ne reviendra plus.' },
  'ess-formes-q02': { cochees: ['A', 'B'], points: 0.4, erreurs: 1, titre: '0,4 point · 1 erreur', retour: 'Revient dans 2 jours.' },
  'ess-formes-q03': { cochees: ['A', 'B', 'C', 'D', 'E'], points: 0.1, erreurs: 2, titre: '0,1 point · 2 erreurs', retour: 'Revient dans 2 jours.' },
};

test('QCM : cocher, valider, points selon le barème, journal envoyé', async () => {
  const o = await ouvrir(navigateur, serveur.base);
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    await page.locator('.onglet[data-vue="qcm"]').click();
    await page.getByRole('heading', { name: 'QCM', exact: true }).waitFor();
    await page.getByText('Ils ne comptent pas dans tes cartes acquises', { exact: false }).waitFor();
    await page.getByText('3 questions · environ 3 min').waitFor();
    await page.getByText(/^Barème\s: 0 erreur = 1 point · 1 = 0,4 · 2 = 0,1 · 3 ou plus = 0\./).waitFor();
    await verifierEcran(page, 'qcm-accueil');

    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 3 QCM' }).click();
    const faits = [];
    for (let i = 1; i <= 3; i++) {
      await page.locator('.proposition').first().waitFor();
      assert.equal(await texte(page.locator('.seance-haut__position')), `QCM ${i} sur 3`);
      const enonce = await texte(page.locator('.page--qcm h1.question'));
      const q = QCM.find(x => x.enonce === enonce);
      assert.ok(q, `QCM inconnu : ${enonce}`);
      assert.equal(await page.locator('.proposition').count(), 5);
      const plan = PLAN[q.id];
      for (const l of plan.cochees) await page.locator(`label.proposition[for="prop-${l}"]`).click();
      for (const l of ['A', 'B', 'C', 'D', 'E']) {
        assert.equal(await page.locator(`#prop-${l}`).isChecked(), plan.cochees.includes(l), `case ${l} de ${q.id}`);
      }
      if (i === 1) await verifierEcran(page, 'qcm-question');
      await clic(page, 'Valider');
      await page.locator('.corr-prop').first().waitFor();
      assert.equal(await texte(page.locator('.page--qcm .verdict__mot')), plan.titre);
      assert.equal(await texte(page.locator('.page--qcm .verdict__ligne')), plan.retour);
      assert.equal(await page.locator('.corr-prop').count(), 5);
      assert.equal(await page.locator('.corr-prop--ko').count(), plan.erreurs);
      for (const p of q.propositions) await page.locator('.corr-prop__expl', { hasText: p.expl }).first().waitFor();
      if (i === 1) await verifierEcran(page, 'qcm-correction');
      faits.push(q.id);
      await clic(page, i < 3 ? 'Suivant' : 'Voir le bilan');
    }
    assert.deepEqual([...faits].sort(), Object.keys(PLAN));

    await page.getByRole('heading', { name: 'Série terminée' }).waitFor();
    assert.equal(await texte(page.locator('.grand-compteur__chiffre')), '1,5 / 3');
    await page.getByText('2 QCM ratés : ils reviendront dans 2 jours.').waitFor();
    await verifierEcran(page, 'qcm-bilan');
    await attendre(() => faux.commits().length === 2, { message: 'envoi du journal des QCM' });
    assert.equal(await compteur(page), 'Acquises : 0/30');

    const commit = faux.commits()[1];
    assert.match(commit.message, /^Rappel : mise à jour du \d\d\/\d\d$/);
    const mois = jourParis(Date.now()).slice(0, 7);
    assert.deepEqual(commit.chemins, [`rappel/progres/qcm/${mois}.jsonl`]);
    const lignes = fichiersDepot(faux)[`rappel/progres/qcm/${mois}.jsonl`];
    assert.deepEqual(lignes.map(l => l.qcm), faits);
    for (const l of lignes) {
      const plan = PLAN[l.qcm];
      assert.deepEqual([l.cours, l.ue, l.cochees, l.points, l.discordances, l.appareil], ['ess-formes', 'ess', plan.cochees, plan.points, plan.erreurs, 'tel-essai']);
      assert.ok(l.duree >= 0);
    }

    await clic(page, 'Retour');
    await page.getByRole('heading', { name: 'QCM', exact: true }).waitFor();
    // Plus rien de dû ni de jamais fait : pas de nouvelle série (le QCM acquis ne revient pas de lui-même).
    await page.getByText('Tous tes QCM du moment sont faits. D\'autres arriveront avec les prochains cours.').waitFor();
    assert.equal(await page.locator('.barre-action .btn--principal').count(), 0);
    if (!(await page.locator('details.choix-cours').evaluate(d => d.open))) await page.locator('details.choix-cours summary').click();
    await page.locator('.cours', { hasText: 'Essai · Les formes' }).getByText('3 QCM · moy. 0,5').waitFor();
    await verifierEcran(page, 'qcm-accueil-apres');

    // À la demande : refaire les QCM déjà réussis (ici, le seul acquis).
    await clic(page, 'Refaire des QCM déjà réussis');
    await page.locator('.proposition').first().waitFor();
    assert.equal(await texte(page.locator('.seance-haut__position')), 'QCM 1 sur 1');
    assert.equal(await texte(page.locator('.page--qcm h1.question')), QCM.find(q => q.id === 'ess-formes-q01').enonce);
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});
