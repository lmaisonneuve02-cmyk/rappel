// Séance : révisions, micro-fiche, nouvelles cartes ; Gemini simulé (juste, partiel), « je ne sais pas »,
// compteur d'acquises, envoi groupé en un commit ; Gemini en erreur (429) ; contestation acceptée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { estAcquise } from '../../js/fsrs.js';
import { jourParis } from '../../js/temps.js';
import {
  demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, carteDeQuestion, geminiSimule,
  fichiersDepot, attendre,
} from './harnais.mjs';

let serveur, navigateur;
before(async () => { serveur = await demarrerServeur(); navigateur = await lancerNavigateur(); });
after(async () => { await navigateur?.close(); await serveur?.fermer(); });

const PARTIEL = 'une partie seulement';
const FAUX_CONTESTE = 'les côtés sont tous pareils';
// Réponses jugées justes par Gemini simulé (aucune n'est la réponse attendue mot pour mot).
const REPONSES = {
  'for-01': 'il en a 6', 'for-02': 'il est équilatéral',
  'col-01': 'ça donne du vert', 'col-02': 'rouge, jaune et bleu', 'col-03': 'le vert',
};
const MOIS = () => jourParis(Date.now()).slice(0, 7);

const question = async page => carteDeQuestion(await page.locator('.page--seance h1.question').textContent());
const position = page => page.locator('.seance-haut__position').textContent();

async function repondre(page, texte) {
  await page.fill('#reponse', texte);
  const principal = page.locator('.barre-action .btn--principal');
  assert.equal(await principal.textContent(), 'Corriger');
  await principal.click();
  await page.locator('.page--seance .verdict').waitFor();
}

const mot = page => page.locator('.page--seance .verdict__mot').textContent();
const effet = page => page.locator('.page--seance .verdict__effet').textContent();
const suivant = page => clic(page, 'Suivant');

async function terminerSeance(page) {
  await page.locator('.seance-haut .btn').first().click();
  await page.locator('.seance-haut .btn', { hasText: 'Touche encore' }).waitFor();
  await page.locator('.seance-haut .btn').first().click();
  await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
}

async function seanceComplete(theme) {
  const o = await ouvrir(navigateur, serveur.base, { theme, gemini: geminiSimule({ verdicts: { [PARTIEL]: 'partiel' } }) });
  const { page, faux } = o;
  const nom = n => `seance-${theme}-${n}`;
  try {
    await page.goto(serveur.base);
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    await page.getByText('2 révisions · 3 nouvelles cartes').waitFor();
    const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const clair = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
    assert.equal(clair, theme === 'clair');
    const [r, g, b] = fond.match(/\d+/g).map(Number);
    assert.ok(theme === 'clair' ? r + g + b > 600 : r + g + b < 150, `fond ${fond} inattendu en thème ${theme}`);
    await verifierEcran(page, nom('aujourdhui'));
    assert.equal(faux.commits().length, 1);

    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();

    // 1) Révision, juste (Gemini)
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 1 sur 5');
    await page.locator('.puce', { hasText: 'Révision' }).waitFor();
    const r1 = await question(page);
    assert.equal(r1.paquet, 'ess-formes');
    await verifierEcran(page, nom('carte'));
    await repondre(page, REPONSES[r1.id]);
    assert.equal(await mot(page), 'Juste');
    assert.equal(await effet(page), '+1 acquise : 1/30');
    await page.locator('.badge', { hasText: 'Corrigé par Gemini' }).waitFor();
    assert.equal(await compteur(page), 'Acquises : 1/30');
    await verifierEcran(page, nom('verdict-juste'));
    if (theme === 'clair') {
      // « Rappel · … » dans l'en-tête : une feuille d'information, la séance continue.
      await page.locator('#etat-synchro').click();
      await page.getByRole('dialog', { name: 'Enregistrement de tes réponses' }).waitFor();
      await page.getByRole('dialog').getByText("1 réponse en attente d'envoi").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.vue), 'seance');
      await verifierEcran(page, nom('feuille-synchro'));
      await page.getByRole('dialog').getByRole('button', { name: 'Envoyer maintenant' }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await mot(page), 'Juste');
    }
    await suivant(page);

    // 2) Révision, partiel (Gemini)
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 2 sur 5');
    const r2 = await question(page);
    assert.notEqual(r2.id, r1.id);
    await repondre(page, PARTIEL);
    assert.equal(await mot(page), 'Partiel');
    assert.equal(await effet(page), '+1 acquise : 2/30');
    await page.getByRole('heading', { name: 'Ce qui manquait' }).waitFor();
    await page.getByRole('button', { name: 'Je conteste' }).waitFor();
    assert.equal(await compteur(page), 'Acquises : 2/30');
    await verifierEcran(page, nom('verdict-partiel'));
    await suivant(page);

    // 3) Micro-fiche avant les nouvelles cartes
    await page.getByText('Avant les nouvelles cartes').waitFor();
    assert.equal(await position(page), 'Micro-fiche');
    await page.locator('.feuille-fiche h2', { hasText: 'Les couleurs' }).waitFor();
    await page.getByText('Ensuite : 3 nouvelles cartes de ce cours.').waitFor();
    await verifierEcran(page, nom('fiche'));
    await clic(page, "J'ai lu, on y va");

    // 4) Nouvelle carte : « Je ne sais pas »
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 3 sur 5');
    await page.locator('.puce', { hasText: 'Nouvelle' }).waitFor();
    assert.equal((await question(page)).id, 'col-01');
    await clic(page, 'Je ne sais pas');
    await page.locator('.verdict--nsp').waitFor();
    assert.equal(await mot(page), 'Voici la réponse');
    await page.locator('.attendue', { hasText: 'Le vert.' }).waitFor();
    assert.equal(await compteur(page), 'Acquises : 2/30');
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    await verifierEcran(page, nom('verdict-nsp'));
    await suivant(page);

    // 5) et 6) Nouvelles cartes justes
    for (const [id, rang, total, n] of [['col-02', 4, 6, 3], ['col-03', 5, 6, 4]]) {
      await page.locator('#reponse').waitFor();
      assert.equal(await position(page), `Carte ${rang} sur ${total}`);
      assert.equal((await question(page)).id, id);
      await repondre(page, REPONSES[id]);
      assert.equal(await mot(page), 'Juste');
      assert.equal(await effet(page), `+1 acquise : ${n}/30`);
      await suivant(page);
    }

    // 7) La carte ratée revient
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 6 sur 6');
    await page.locator('.puce', { hasText: 'Encore une fois' }).waitFor();
    assert.equal((await question(page)).id, 'col-01');
    await repondre(page, REPONSES['col-01']);
    assert.equal(await effet(page), '+1 acquise : 5/30');
    assert.equal(await compteur(page), 'Acquises : 5/30');
    assert.equal(faux.commits().length, 1, 'rien ne part avant la fin de la séance');
    await suivant(page);

    // Fin : bilan et un seul commit
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    assert.equal(await page.locator('.grand-compteur__chiffre').textContent(), '5/30');
    assert.match(await page.locator('.chiffres--doux').textContent(), /^6 réponses · 4 justes · 1 partielle · 1 fausse · \d+ min$/);
    await page.locator('.etat-envoi', { hasText: 'Tout est enregistré.' }).waitFor();
    await page.locator('#synchro-texte', { hasText: 'Enregistré' }).waitFor();
    await verifierEcran(page, nom('fin'));
    const commits = faux.commits();
    assert.equal(commits.length, 2, 'un seul commit pour la séance');
    assert.match(commits[1].message, /^Rappel : séance du \d\d\/\d\d \(6 réponses\)$/);
    assert.deepEqual(commits[1].chemins, [
      `rappel/progres/reponses/${MOIS()}.jsonl`, 'rappel/progres/srs/ess-couleurs.json', 'rappel/progres/srs/ess-formes.json',
    ]);

    const f = fichiersDepot(faux);
    const lignes = f[`rappel/progres/reponses/${MOIS()}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.verdict, l.correcteur, l.nouvelle]), [
      [r1.id, 'juste', 'gemini', false], [r2.id, 'partiel', 'gemini', false], ['col-01', 'faux', 'je-ne-sais-pas', true],
      ['col-02', 'juste', 'gemini', true], ['col-03', 'juste', 'gemini', true], ['col-01', 'juste', 'gemini', false],
    ]);
    assert.deepEqual(lignes.map(l => l.reponse), [REPONSES[r1.id], PARTIEL, '', REPONSES['col-02'], REPONSES['col-03'], REPONSES['col-01']]);
    for (const l of lignes) {
      assert.equal(l.appareil, 'tel-essai');
      assert.equal(l.id, `tel-essai-${l.ts}`);
      assert.equal(l.note, { juste: 3, partiel: 2, faux: 1 }[l.verdict]);
    }
    const jour = jourParis(Date.now());
    const srs = { ...f['rappel/progres/srs/ess-formes.json'].cards, ...f['rappel/progres/srs/ess-couleurs.json'].cards };
    assert.deepEqual(Object.keys(srs).sort(), ['col-01', 'col-02', 'col-03', 'for-01', 'for-02']);
    assert.equal(Object.values(srs).filter(e => estAcquise(e, jour)).length, 5);
    assert.equal(srs['for-01'].reps, 2);
    assert.equal(srs['col-01'].reps, 2);
    assert.equal(srs['col-01'].lapses, 0);   // comme v1 : une nouvelle carte ratée n'est pas un oubli

    // Un seul bouton principal selon la situation, puis retour à l'écran du jour.
    assert.equal(await page.locator('.barre-action .btn--principal').textContent(), 'Réviser en avance');
    await page.getByRole('button', { name: 'Faire 3 QCM' }).waitFor();
    await page.locator('.onglet[data-vue="aujourdhui"]').waitFor({ state: 'hidden' });
    await page.goBack();
    await page.locator('.page--aujourdhui').waitFor();
    await page.getByText("Tout est fait pour aujourd'hui").waitFor();
    await page.getByText('Les 3 nouvelles cartes du jour sont faites. Tu peux en demander plus dans Réglages.').waitFor();
    assert.equal(await compteur(page), 'Acquises : 5/30');
    await verifierEcran(page, nom('apres'));
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
}

test('séance complète (thème clair) : révisions, fiche, nouvelles cartes, un commit', () => seanceComplete('clair'));
test('séance complète (thème sombre)', () => seanceComplete('sombre'));

test('Gemini en erreur (429) : correction sur l\'appareil, mention hors ligne', async () => {
  const quota = () => ({ status: 429, corps: { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } } });
  const o = await ouvrir(navigateur, serveur.base, { gemini: quota });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer' }).click();
    await page.locator('#reponse').waitFor();
    const r1 = await question(page);
    await repondre(page, REPONSES[r1.id]);
    assert.equal(await mot(page), 'Juste');
    await page.locator('.badge', { hasText: 'Corrigé hors ligne' }).waitFor();
    const note = await page.locator('.note-correcteur').textContent();
    assert.match(note, /Je corrige sur ton appareil\.$/);
    await page.locator('#toast', { hasText: 'Je corrige sur ton appareil.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    assert.equal(await compteur(page), 'Acquises : 1/30');
    await verifierEcran(page, 'gemini-429-verdict');
    assert.equal(o.requetesGemini.filter(r => r.genre === 'correction').length, 1, 'pas de nouvel essai sur un quota');

    await suivant(page);
    await page.locator('#reponse').waitFor();
    await terminerSeance(page);
    await attendre(() => faux.commits().length === 2, { message: 'envoi de fin de séance' });
    const lignes = fichiersDepot(faux)[`rappel/progres/reponses/${MOIS()}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.verdict, l.correcteur]), [[r1.id, 'juste', 'hors-ligne']]);
    o.verifierConsole([/status of 429/]);
  } finally {
    await o.fermer();
  }
});

test('contestation acceptée : verdict corrigé, la carte ne revient pas, ligne de contestation envoyée', async () => {
  const o = await ouvrir(navigateur, serveur.base, { gemini: geminiSimule({ verdicts: { [FAUX_CONTESTE]: 'faux' } }) });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();
    await page.locator('#reponse').waitFor();
    const r1 = await question(page);
    await repondre(page, FAUX_CONTESTE);
    assert.equal(await mot(page), 'Faux');
    assert.equal(await effet(page), 'Ne compte pas encore : réussis-la quand elle revient.');
    await clic(page, 'Je conteste');
    await page.fill('#raison', 'même sens : tous les côtés égaux');
    await verifierEcran(page, 'contestation-raison');
    await clic(page, 'Demander un second avis');
    await page.getByText('Tu avais raison : verdict corrigé en « Juste ».').waitFor();
    assert.equal(await mot(page), 'Juste');
    await page.locator('.badge', { hasText: 'Corrigé après un second avis' }).waitFor();
    assert.equal(await effet(page), '+1 acquise : 1/30');
    assert.equal(await compteur(page), 'Acquises : 1/30');
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    await verifierEcran(page, 'contestation-acceptee');
    assert.deepEqual(o.requetesGemini.map(r => r.genre), ['correction', 'contestation']);

    await suivant(page);
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 2 sur 5', 'la reprise de la carte contestée a disparu');
    await terminerSeance(page);
    assert.match(await page.locator('.chiffres--doux').textContent(), /^1 réponse · 1 juste · 0 partielle · 0 fausse · /);
    await page.getByRole('button', { name: 'Continuer · 4 cartes' }).waitFor();
    await attendre(() => faux.commits().length === 2, { message: 'envoi de fin de séance' });
    await verifierEcran(page, 'contestation-fin');

    const f = fichiersDepot(faux);
    const [ligne, contestation, ...reste] = f[`rappel/progres/reponses/${MOIS()}.jsonl`];
    assert.equal(reste.length, 0);
    assert.deepEqual([ligne.carte, ligne.verdict, ligne.correcteur], [r1.id, 'faux', 'gemini']);
    assert.deepEqual([contestation.carte, contestation.verdict, contestation.correcteur, contestation.note, contestation.remplace],
      [r1.id, 'juste', 'contestation', 3, ligne.id]);
    const cas = f['rappel/progres/a-revoir.json'].cas;
    assert.deepEqual(cas.map(c => [c.type, c.issue, c.carte, c.raison]), [['contestation', 'accepte', r1.id, 'même sens : tous les côtés égaux']]);
    assert.ok(estAcquise(f['rappel/progres/srs/ess-formes.json'].cards[r1.id], jourParis(Date.now())));
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});

test('« Voir la réponse » : il se note lui-même (Je l\'avais / En partie / Non)', async () => {
  const o = await ouvrir(navigateur, serveur.base);
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();
    const vus = [];
    for (const [choix, verdict, compte] of [["Je l'avais", 'juste', 1], ['En partie', 'partiel', 2], ['Non', 'faux', 2]]) {
      await page.locator('#reponse').waitFor();
      const c = await question(page);
      vus.push([c.id, verdict]);
      const principal = page.locator('.barre-action .btn--principal');
      assert.equal(await principal.textContent(), 'Voir la réponse');
      // Entrée sur un champ vide ne dévoile pas la réponse.
      await page.locator('#reponse').press('Enter');
      await page.getByText('Écris ta réponse, ou touche « Voir la réponse ».').waitFor();
      await principal.click();
      await page.getByText("Tu l'avais ?").waitFor();
      await page.locator('.bloc-liste--attendue .attendue', { hasText: c.a || '' }).first().waitFor();
      if (vus.length === 1) await verifierEcran(page, 'auto-evaluation');
      await clic(page, choix);
      await page.locator('#toast', { hasText: `Noté : ${verdict === 'juste' ? 'juste' : verdict === 'partiel' ? 'partiel' : 'faux'}` }).waitFor();
      assert.equal(await compteur(page), `Acquises : ${compte}/30`);
      // Après les deux révisions vient la micro-fiche.
      if (vus.length === 2) await clic(page, "J'ai lu, on y va");
    }
    await page.locator('#reponse').waitFor();
    await terminerSeance(page);
    await attendre(() => faux.commits().length === 2, { message: 'envoi de fin de séance' });
    const lignes = fichiersDepot(faux)[`rappel/progres/reponses/${MOIS()}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.verdict, l.correcteur, l.reponse]), vus.map(([id, v]) => [id, v, 'auto', '']));
    assert.equal(o.requetesGemini.length, 0);
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});

test('« Terminer » pendant la correction : la séance reste terminée et la réponse compte', async () => {
  const o = await ouvrir(navigateur, serveur.base, { latence: 2000 });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();
    await page.locator('#reponse').waitFor();
    const r1 = await question(page);
    await page.fill('#reponse', REPONSES[r1.id]);
    await clic(page, 'Corriger');
    await page.locator('.btn--attente', { hasText: 'Correction…' }).waitFor();
    await terminerSeance(page);
    await attendre(() => o.requetesGemini.length === 1 && page.evaluate(() => !document.querySelector('.btn--attente')));
    await page.waitForTimeout(2500);   // la correction arrive après la fin demandée
    assert.equal(await page.getByRole('heading', { name: 'Séance terminée' }).count(), 1, 'l\'écran de fin reste affiché');
    assert.equal(await page.locator('.page--seance .verdict').count(), 0);
    await page.locator('.chiffres--doux', { hasText: /^1 réponse · 1 juste · / }).waitFor();
    await page.getByRole('button', { name: 'Continuer · 4 cartes' }).waitFor();
    assert.equal(await compteur(page), 'Acquises : 1/30');
    await attendre(() => {
      const l = fichiersDepot(faux)[`rappel/progres/reponses/${MOIS()}.jsonl`];
      return l?.length === 1 && l[0].carte === r1.id;
    }, { message: 'réponse envoyée après la fin' });
    await verifierEcran(page, 'terminer-pendant-correction');
    // Continuer reprend à la carte suivante.
    await clic(page, 'Continuer · 4 cartes');
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 2 sur 5');
    assert.notEqual((await question(page)).id, r1.id);
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});

test('« Suivant » pendant le second avis : on reste sur la carte suivante, l\'issue est signalée', async () => {
  const o = await ouvrir(navigateur, serveur.base, {
    gemini: geminiSimule({ verdicts: { [FAUX_CONTESTE]: 'faux' } }), latence: genre => (genre === 'contestation' ? 2000 : 150) });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();
    await page.locator('#reponse').waitFor();
    const r1 = await question(page);
    await repondre(page, FAUX_CONTESTE);
    await clic(page, 'Je conteste');
    await clic(page, 'Demander un second avis');
    await page.getByText('Je demande un second avis…').waitFor();
    await suivant(page);
    await page.locator('#reponse').waitFor();
    const r2 = await question(page);
    assert.notEqual(r2.id, r1.id);
    await page.locator('#toast', { hasText: 'tu avais raison' }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#reponse').count(), 1, 'la carte suivante reste affichée');
    assert.equal((await question(page)).id, r2.id);
    assert.equal(await position(page), 'Carte 2 sur 5');
    assert.equal(await compteur(page), 'Acquises : 1/30');
    await verifierEcran(page, 'suivant-pendant-second-avis');
    await terminerSeance(page);
    assert.match(await page.locator('.chiffres--doux').textContent(), /^1 réponse · 1 juste · 0 partielle · 0 fausse · /);
    await attendre(() => (fichiersDepot(faux)[`rappel/progres/reponses/${MOIS()}.jsonl`] || []).some(l => l.correcteur === 'contestation'),
      { message: 'ligne de contestation envoyée' });
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});
