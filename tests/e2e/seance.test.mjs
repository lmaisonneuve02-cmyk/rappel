// Séance : révisions, micro-fiche, nouvelles cartes ; Gemini simulé (juste, partiel), « je ne sais pas »,
// compteur de cartes du jour, envoi groupé en un commit ; Gemini en erreur (429) ; contestation acceptée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { estAcquise } from '../../js/fsrs.js';
import { jourParis } from '../../js/temps.js';
import { refText } from '../../js/texte.js';
import { indice } from '../../js/correcteur.js';
import {
  demarrerServeur, lancerNavigateur, ouvrir, verifierEcran, clic, compteur, carteDeQuestion, geminiSimule,
  fichiersDepot, attendre, texte, lireDonnees, dont } from './harnais.mjs';

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

const question = async page => carteDeQuestion(await texte(page.locator('.page--seance h1.question')));
const position = page => texte(page.locator('.seance-haut__position'));

async function repondre(page, reponse) {
  await page.fill('#reponse', reponse);
  const principal = page.locator('.barre-action .btn--principal');
  assert.equal(await texte(principal), 'Corriger');
  await principal.click();
  await page.locator('.page--seance .verdict').waitFor();
}

const mot = page => texte(page.locator('.page--seance .verdict__mot'));
const effet = page => texte(page.locator('.page--seance .verdict__effet'));
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
    assert.equal(await effet(page), '+1 carte : 1/30');
    await page.locator('.badge', { hasText: 'Corrigé par Gemini' }).waitFor();
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');
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
    assert.equal(await effet(page), '+1 carte : 2/30');
    await page.getByRole('heading', { name: 'Ce qui manquait' }).waitFor();
    await page.getByRole('button', { name: 'Je conteste' }).waitFor();
    assert.equal(await compteur(page), 'Cartes : 2/30');
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
    assert.equal(await texte(page.locator('.page--seance .verdict__ligne')), 'Pas grave. Revient un peu plus loin dans la séance.');
    await page.locator('.attendue', { hasText: 'Le vert.' }).waitFor();
    // « Je ne sais pas » : la carte est répondue, elle compte (une fois, même quand elle revient).
    assert.equal(await effet(page), '+1 carte : 3/30');
    assert.equal(await compteur(page), 'Cartes : 3/30');
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    await verifierEcran(page, nom('verdict-nsp'));
    await suivant(page);

    // 5) et 6) Nouvelles cartes justes ; après la dernière, plus rien à proposer : objectif atteint.
    for (const [id, rang, total, n] of [['col-02', 4, 6, 4], ['col-03', 5, 6, 5]]) {
      await page.locator('#reponse').waitFor();
      assert.equal(await position(page), `Carte ${rang} sur ${total}`);
      assert.equal((await question(page)).id, id);
      await repondre(page, REPONSES[id]);
      assert.equal(await mot(page), 'Juste');
      assert.equal(await effet(page), `+1 carte : ${n}/30`);
      // Plus rien à compter (la carte ratée qui revient est déjà comptée) : objectif atteint à 5/30.
      if (id === 'col-03') await page.getByText("Objectif du jour atteint : toutes tes cartes du jour sont faites. Tu peux t'arrêter ou continuer.").waitFor();
      await suivant(page);
    }

    // 7) La carte ratée revient
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 6 sur 6');
    await page.locator('.puce', { hasText: 'Encore une fois' }).waitFor();
    assert.equal((await question(page)).id, 'col-01');
    await repondre(page, REPONSES['col-01']);
    assert.equal(await effet(page), "Déjà comptée aujourd'hui : 5/30");
    assert.equal(await compteur(page), 'Cartes : 5/30 ✓');
    assert.equal(faux.commits().length, 1, 'rien ne part avant la fin de la séance');
    await suivant(page);

    // Fin : bilan et un seul commit
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    assert.equal(await texte(page.locator('.grand-compteur__chiffre')), '5/30');
    assert.match(await texte(page.locator('.chiffres--doux')), /^6 réponses · 4 justes · 1 partielle · 1 fausse · \d+ min$/);
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

    // Un seul bouton principal selon la situation (objectif atteint : les QCM), puis retour à l'écran du jour.
    await page.getByText("Objectif du jour atteint. Tu peux t'arrêter là.").waitFor();
    assert.equal(await texte(page.locator('.barre-action .btn--principal')), 'Faire 3 QCM');
    await page.getByRole('button', { name: 'Retour' }).waitFor();
    await page.locator('.onglet[data-vue="aujourdhui"]').waitFor({ state: 'hidden' });
    await page.goBack();
    await page.locator('.page--aujourdhui').waitFor();
    await page.getByText("Tout est fait pour aujourd'hui").waitFor();
    await page.getByText('Les 3 nouvelles cartes du jour sont faites. Tu peux en demander plus dans Réglages.').waitFor();
    await page.getByText("Objectif du jour atteint : toutes tes cartes du jour sont faites. Tu peux t'arrêter ou continuer.").waitFor();
    assert.equal(await compteur(page), 'Cartes : 5/30 ✓');
    // Toutes les cartes vues ont été répondues aujourd'hui : rien en avance, les QCM seulement.
    assert.equal(await page.getByRole('button', { name: 'Réviser en avance' }).count(), 0);
    assert.equal(await texte(page.locator('.barre-action .btn--principal')), 'Faire des QCM');
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
    // Un seul message, bref, sans « Réessaie dans 20 s », qui ne cache pas la barre « Terminer · Carte n sur N ».
    const toast = page.locator('#toast', { hasText: "Gemini est saturé pour l'instant : correction faite sur ton appareil." });
    await toast.waitFor();
    assert.equal(await page.locator('.note-correcteur').count(), 0, 'pas de doublon dans le verdict');
    assert.doesNotMatch(await texte(page.locator('#toast')), /Réessaie/);
    const [boiteToast, barre] = [await toast.boundingBox(), await page.locator('.seance-haut').boundingBox()];
    assert.ok(boiteToast.y >= barre.y + barre.height, `le message (haut ${boiteToast.y}) passe sous la barre de séance (bas ${barre.y + barre.height})`);
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');
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
    assert.equal(await effet(page), '+1 carte : 1/30');   // répondue : elle compte, même fausse
    assert.equal(await texte(page.locator('.page--seance .verdict__ligne')), 'Revient un peu plus loin dans la séance.');
    await clic(page, 'Je conteste');
    await page.fill('#raison', 'même sens : tous les côtés égaux');
    await verifierEcran(page, 'contestation-raison');
    await clic(page, 'Demander un second avis');
    await page.getByText('Tu avais raison : verdict corrigé en « Juste ».').waitFor();
    assert.equal(await mot(page), 'Juste');
    await page.locator('.badge', { hasText: 'Corrigé après un second avis' }).waitFor();
    assert.equal(await effet(page), '+1 carte : 1/30');   // la contestation ne compte pas en plus
    assert.equal(await compteur(page), 'Cartes : 1/30 · Révisions : 1');
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    await verifierEcran(page, 'contestation-acceptee');
    assert.deepEqual(o.requetesGemini.map(r => r.genre), ['correction', 'contestation']);

    await suivant(page);
    await page.locator('#reponse').waitFor();
    assert.equal(await position(page), 'Carte 2 sur 5', 'la reprise de la carte contestée a disparu');
    await terminerSeance(page);
    assert.match(await texte(page.locator('.chiffres--doux')), /^1 réponse · 1 juste · \d+ min$/);
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

test('toujours répondre : pas d\'auto-évaluation, « Indice » plafonné à « partiel »', async () => {
  const o = await ouvrir(navigateur, serveur.base);
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.barre-action .btn--principal', { hasText: 'Commencer · 5 cartes' }).click();
    await page.locator('#reponse').waitFor();
    const c = await question(page);
    const principal = page.locator('.barre-action .btn--principal');
    assert.equal(await texte(principal), 'Corriger');
    assert.equal(await page.getByRole('button', { name: 'Voir la réponse' }).count(), 0);
    // Champ vide : ni Entrée ni « Corriger » ne dévoilent la réponse.
    await page.locator('#reponse').press('Enter');
    await page.getByText('Écris ta réponse, ou touche « Je ne sais pas ».').waitFor();
    await principal.click();
    assert.equal(await page.locator('.page--seance .verdict').count(), 0);
    assert.equal(await texte(principal), 'Corriger', 'le libellé ne change pas avec le champ');
    // Indice : la première idée en initiales.
    await clic(page, 'Indice');
    assert.equal(await texte(page.locator('.indice__mots')), indice(c));
    await page.getByText("Avec l'indice, une réponse juste compte « partiel ».").waitFor();
    await verifierEcran(page, 'indice');
    // Réponse attendue mot pour mot, mais après l'indice : partiel, sans « Je conteste ».
    await repondre(page, refText(c));
    assert.equal(await mot(page), 'Partiel');
    await page.getByText("Juste, mais avec l'indice : compté partiel.").waitFor();
    assert.equal(await page.getByRole('button', { name: 'Je conteste' }).count(), 0);
    await suivant(page);
    // Carte suivante : l'indice est oublié, une réponse juste reste juste.
    await page.locator('#reponse').waitFor();
    assert.equal(await page.locator('.indice__mots').count(), 0);
    const c2 = await question(page);
    await repondre(page, refText(c2));
    assert.equal(await mot(page), 'Juste');
    await terminerSeance(page);
    await attendre(() => faux.commits().length === 2, { message: 'envoi de fin de séance' });
    const lignes = fichiersDepot(faux)[`rappel/progres/reponses/${MOIS()}.jsonl`];
    assert.deepEqual(lignes.map(l => [l.carte, l.verdict, l.indice]), [[c.id, 'partiel', true], [c2.id, 'juste', undefined]]);
    assert.equal(o.requetesGemini.length, 0);
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});


test('fichier de progression abîmé sur GitHub : envois bloqués, bandeau qui dit quoi faire', async () => {
  const o = await ouvrir(navigateur, serveur.base, { fichiers: { ...lireDonnees(), 'rappel/progres/srs/ess-couleurs.json': '{ abîmé' } });
  const { page, faux } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    await page.locator('.pastille', { hasText: 'Les couleurs' }).click();
    await clic(page, 'Ce paquet (3)');
    await clic(page, "J'ai lu, on y va");
    await page.locator('#reponse').waitFor();
    await clic(page, 'Je ne sais pas');
    await page.locator('.verdict--nsp').waitFor();
    await terminerSeance(page);
    await page.locator('#synchro-texte', { hasText: 'abîmé' }).waitFor();
    await clic(page, 'Retour');
    await page.getByText('Un fichier de progression est abîmé sur GitHub : les envois sont bloqués. Demande à Claude de le réparer.').waitFor();
    await verifierEcran(page, 'fichier-abime');
    assert.equal(faux.commits().length, 1, 'rien n\'est envoyé par-dessus le fichier abîmé');
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});

// Réponse attendue mot pour mot (reconnue sans Gemini), puis carte suivante.
async function bonneReponse(page) {
  await page.locator('#reponse').waitFor();
  await repondre(page, refText(await question(page)));
  assert.equal(await mot(page), 'Juste');
  await suivant(page);
}

test('un seul paquet : s\'il ne suffit pas pour l\'objectif, « Tout » passe en principal', async () => {
  const o = await ouvrir(navigateur, serveur.base);
  const { page } = o;
  try {
    await page.goto(serveur.base);
    await page.locator('.page--aujourdhui .bloc-seance').waitFor();
    // Les couleurs : 3 nouvelles cartes, mais les 2 révisions du jour sont dans Les formes (révisions d'abord).
    await page.locator('.pastille', { hasText: 'Les couleurs' }).click();
    await page.getByText('3 nouvelles cartes', { exact: true }).waitFor();
    assert.equal(await texte(page.locator('.objectif-ligne')), `Objectif : encore 5 cartes${dont('2 révisions')}. Ce paquet ne suffit pas : choisis « Tout ».`);
    assert.equal(await texte(page.locator('.barre-action .btn--principal')), 'Commencer · Tout (5)');
    await verifierEcran(page, 'un-paquet-aujourdhui');

    // Il garde son choix : ce paquet seulement.
    await clic(page, 'Ce paquet (3)');
    await clic(page, "J'ai lu, on y va");
    for (let i = 0; i < 3; i++) await bonneReponse(page);
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    assert.equal(await texte(page.locator('.grand-compteur__chiffre')), '3/30');
    assert.equal(await texte(page.locator('.objectif-ligne')), `Encore 2 cartes${dont('2 révisions')} pour l'objectif. Il en reste dans les autres paquets.`);
    // Pas de « Réviser en avance » sur ce paquet : ses cartes sont déjà comptées.
    assert.equal(await page.getByRole('button', { name: 'Réviser en avance' }).count(), 0);
    assert.equal(await texte(page.locator('.barre-action .btn--principal')), 'Continuer · Tout (2)');
    await verifierEcran(page, 'un-paquet-fin');

    // « Tout » : les 2 révisions ; plus rien à compter, objectif atteint.
    await clic(page, 'Continuer · Tout (2)');
    for (let i = 0; i < 2; i++) {
      await page.locator('.puce', { hasText: 'Révision' }).waitFor();
      assert.equal((await question(page)).paquet, 'ess-formes');
      await bonneReponse(page);
    }
    await page.getByRole('heading', { name: 'Séance terminée' }).waitFor();
    await page.getByText("Objectif du jour atteint. Tu peux t'arrêter là.").waitFor();
    assert.equal(await page.locator('.grand-compteur--atteint').count(), 1);
    assert.equal(await compteur(page), 'Cartes : 5/30 ✓');

    // Retour : l'écran du jour revient sur « Tout » (pas « Rien à faire dans ce paquet »).
    await clic(page, 'Retour');
    await page.getByText("Tout est fait pour aujourd'hui").waitFor();
    await page.getByText("Objectif du jour atteint : toutes tes cartes du jour sont faites. Tu peux t'arrêter ou continuer.").waitFor();

    // Suivi : même compteur, ✓ sur la ligne du jour.
    await page.locator('.onglet[data-vue="suivi"]').click();
    await page.getByRole('heading', { name: 'Suivi' }).waitFor();
    assert.equal(await texte(page.locator('.grand-compteur__chiffre')), '5/30');
    assert.equal(await texte(page.locator('.grand-compteur__texte')), "cartes aujourd'hui");
    assert.equal(await page.locator('.grand-compteur--atteint').count(), 1);
    await page.getByText('Cartes par jour (une carte compte une fois). Repère : 30.').waitFor();
    assert.equal(await page.locator('.jour--atteint').count(), 1);
    assert.match(await texte(page.locator('.jour').first().locator('.jour__valeur')), /^5/);
    await verifierEcran(page, 'un-paquet-suivi');
    o.verifierConsole();
  } finally {
    await o.fermer();
  }
});
