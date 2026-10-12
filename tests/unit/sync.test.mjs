import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchro } from '../../js/sync.js';
import { ClientGitHub } from '../../js/github.js';
import { ouvrirStockage } from '../../js/stockage.js';
import { serialiser, analyser } from '../../js/depot.js';
import { creerFauxGitHub } from '../fixtures/faux-github.mjs';

const T = Date.UTC(2026, 9, 12, 12, 0); // 12 oct. 2026, 14 h à Paris
const R = 'rappel/';
const SRS = R + 'progres/srs/p1.json';
const REP = R + 'progres/reponses/2026-10.jsonl';

const etat = (last, reps = 1, s = 3.7) => ({ s, d: 5.2, due: last + 3 * 864e5, last, reps, lapses: 0 });
const ligne = (appareil, ts, carte) => ({ id: `${appareil}-${ts}`, ts, appareil, paquet: 'p1', carte, reponse: 'élément', verdict: 'juste', correcteur: 'local', note: 3, nouvelle: false, duree: 1000 });

// Dépôt synthétique : quelques fichiers utiles, d'autres à ignorer.
function depotTest() {
  return {
    [R + 'plan.json']: serialiser('plan.json', { semestre: 'S5', ues: [{ id: 'ue', nom: 'UE', cours: [{ id: 'p1', paquet: 'p1' }] }] }),
    [R + 'paquets/p1.json']: serialiser('p1.json', { id: 'p1', nom: 'Paquet « un »', ue: 'ue', ordre: 1, cartes: [
      { id: 'p1-01', type: 'fait', q: 'Question un ?', a: 'Réponse un.' },
      { id: 'p1-02', type: 'fait', q: 'Question deux ?', a: 'Réponse deux.' },
      { id: 'p1-03', type: 'cloze', q: 'Le {{cœur}} bat.' }] }),
    [R + 'fiches/p1.json']: serialiser('p1.json', { id: 'p1', title: 'Fiche un', blocks: [] }),
    [SRS]: serialiser(SRS, { cards: { 'p1-01': etat(T - 864e5) } }),
    [REP]: serialiser(REP, [ligne('pc', T - 864e5, 'p1-01')]),
    [R + 'progres/reglages.json']: serialiser('r.json', { nouvellesParJour: 20, maj: 1 }),
    [R + 'v1/index.html']: '<!doctype html>',
    'docs/methode.md': '# Méthode\n',
  };
}

const UTILES = 6;

function creer(gh, { stockage, jeton = 'jeton-test', maintenant = () => T, delaiEnvoi = 60_000 } = {}) {
  return new Synchro({
    stockage,
    creerClient: cfg => new ClientGitHub({ ...cfg, fetch: gh.fetch }),
    config: () => ({ jeton, proprietaire: 'moi', depot: 'etudes', branche: 'main', racine: R }),
    maintenant,
    delaiEnvoi,
  });
}

const blobsLus = gh => gh.requetes().filter(r => r.chemin.includes('/git/blobs/')).length;
const arbresLus = gh => gh.requetes().filter(r => r.chemin.includes('/git/trees/') && r.methode === 'GET').length;

// Attend un état donné (ou échoue au bout de 2 s).
function attendreEtat(s, mode) {
  if (s.etat.mode === mode) return Promise.resolve(s.etat);
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error(`état ${mode} jamais atteint (reste ${s.etat.mode})`)), 2000);
    s.addEventListener('etat', function f(e) {
      if (e.detail.mode !== mode) return;
      clearTimeout(t);
      s.removeEventListener('etat', f);
      ok(e.detail);
    });
  });
}

const reponse = (s, appareil, ts, carte, reps = 1) => {
  s.ajouter({ type: 'srs', paquet: 'p1', carte, etat: etat(ts, reps) });
  return s.ajouter({ type: 'reponse', ligne: ligne(appareil, ts, carte) });
};

// --- Stockage (Node n'a pas IndexedDB : repli en mémoire) ---

test('stockage : repli en mémoire, copies indépendantes', async () => {
  const st = await ouvrirStockage();
  assert.equal(st.enMemoire, true);
  const v = { a: [1, 2], texte: 'é' };
  await st.ecrire('cle', v);
  v.a.push(3);
  assert.deepEqual(await st.lire('cle'), { a: [1, 2], texte: 'é' });
  (await st.lire('cle')).a.push(9);
  assert.deepEqual((await st.lire('cle')).a, [1, 2]);
  await st.ecrire('autre', 5);
  assert.deepEqual(await st.tout(), { cle: { a: [1, 2], texte: 'é' }, autre: 5 });
  await st.effacer('cle');
  assert.equal(await st.lire('cle'), undefined);
  await st.vider();
  assert.deepEqual(await st.tout(), {});
});

test('stockage : IndexedDB qui échoue à l\'ouverture → mémoire, sans erreur', async () => {
  const idbCasse = { open() { throw new Error('SecurityError'); } };
  const st = await ouvrirStockage('rappel2', { indexedDB: idbCasse });
  assert.equal(st.enMemoire, true);
  await st.ecrire('x', 1);
  assert.equal(await st.lire('x'), 1);
});

// --- Synchro ---

test('chargement initial : seuls les fichiers utiles sont lus', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const stockage = await ouvrirStockage();
  const s = creer(gh, { stockage });
  const evenements = [];
  s.addEventListener('donnees', () => evenements.push('donnees'));
  s.addEventListener('etat', e => evenements.push(e.detail.mode));
  await s.demarrer();
  const d = s.donnees();
  assert.equal(d.paquets.p1.nom, 'Paquet « un »');
  assert.equal(d.fiches.p1.title, 'Fiche un');
  assert.equal(d.srs.p1['p1-01'].reps, 1);
  assert.equal(d.reponses.length, 1);
  assert.equal(d.reglages.nouvellesParJour, 20);
  assert.deepEqual(d.ordre, ['p1']);
  assert.equal(blobsLus(gh), UTILES);
  assert.ok(!gh.requetes().some(r => r.chemin.includes('v1') || r.chemin.includes('docs')));
  assert.deepEqual(s.etat, { mode: 'a-jour', attente: 0, message: 'Enregistré', derniereSynchro: T, code: null });
  assert.deepEqual(evenements, ['donnees', 'chargement', 'donnees', 'a-jour']);
  assert.equal(Object.keys(await stockage.lire('sync.fichiers')).length, UTILES);
  s.arreter();
});

test('cache réutilisé : aucun blob relu si les sha sont identiques', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const stockage = await ouvrirStockage();
  await creer(gh, { stockage }).demarrer();
  gh.viderRequetes();

  // Réouverture de l'appli : même tête → ni arbre ni blob.
  const s = creer(gh, { stockage });
  let premieres = null;
  s.addEventListener('donnees', e => { premieres ??= e.detail; });
  await s.demarrer();
  assert.equal(premieres.paquets.p1.nom, 'Paquet « un »'); // affiché depuis le cache, avant le réseau
  assert.equal(arbresLus(gh), 0);
  assert.equal(blobsLus(gh), 0);

  // Un fichier inutile change : arbre relu, aucun blob.
  gh.forcerCommitConcurrent({ 'docs/methode.md': '# Autre\n', 'rappel/v1/index.html': 'x' });
  gh.viderRequetes();
  await s.rafraichir();
  assert.equal(arbresLus(gh), 1);
  assert.equal(blobsLus(gh), 0);

  // Un fichier utile change : un seul blob relu.
  gh.forcerCommitConcurrent({ [R + 'fiches/p1.json']: serialiser('f.json', { id: 'p1', title: 'Fiche modifiée', blocks: [] }) });
  gh.viderRequetes();
  await s.rafraichir();
  assert.equal(blobsLus(gh), 1);
  assert.equal(s.donnees().fiches.p1.title, 'Fiche modifiée');

  // Un fichier supprimé disparaît des données.
  gh.forcerCommitConcurrent({ [R + 'fiches/p1.json']: null });
  await s.rafraichir();
  assert.equal(s.donnees().fiches.p1, undefined);
  s.arreter();
});

test('op srs + réponse → un seul commit, bons fichiers, bon message', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  await reponse(s, 'tel', T + 1000, 'p1-02');
  assert.equal(s.donnees().srs.p1['p1-02'].last, T + 1000); // visible tout de suite
  assert.deepEqual([s.etat.mode, s.etat.attente, s.etat.message], ['attente', 1, "1 réponse en attente d'envoi"]);
  assert.equal(gh.commits().length, 1); // rien d'envoyé avant la minuterie ou la fin de séance

  gh.viderRequetes();
  await s.pousser('fin-seance');
  const commits = gh.commits();
  assert.equal(commits.length, 2);
  assert.equal(commits[1].message, 'Rappel : séance du 12/10 (1 réponse)');
  assert.deepEqual(commits[1].chemins, [REP, SRS]);
  const fichiers = gh.fichiers();
  assert.equal(fichiers[SRS], serialiser(SRS, { cards: { 'p1-01': etat(T - 864e5), 'p1-02': etat(T + 1000) } }));
  assert.deepEqual(analyser(REP, fichiers[REP]).map(l => l.id), [`pc-${T - 864e5}`, `tel-${T + 1000}`]);
  assert.equal(blobsLus(gh), 0); // les fichiers écrits ne sont pas relus
  assert.deepEqual([s.etat.mode, s.etat.attente], ['a-jour', 0]);
  assert.deepEqual(s._ops, []);

  // Plusieurs réponses : pluriel ; et rien de relu au rafraîchissement suivant.
  await reponse(s, 'tel', T + 2000, 'p1-03');
  await reponse(s, 'tel', T + 3000, 'p1-01', 2);
  await s.pousser('fin-seance');
  assert.equal(gh.commits().at(-1).message, 'Rappel : séance du 12/10 (2 réponses)');
  gh.viderRequetes();
  await s.rafraichir();
  assert.equal(blobsLus(gh), 0);
  assert.equal(arbresLus(gh), 0);
  s.arreter();
});

test('op sans réponse → « mise à jour » ; op déjà présente → aucun commit', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  s.ajouter({ type: 'reglages', reglages: { nouvellesParJour: 30, maj: T } });
  assert.equal(s.etat.message, "1 modification en attente d'envoi");
  await s.pousser('manuel');
  assert.equal(gh.commits().at(-1).message, 'Rappel : mise à jour du 12/10');
  // Rejouer une réponse déjà dans le dépôt : rien ne change, les ops sont retirées.
  s.ajouter({ type: 'srs', paquet: 'p1', carte: 'p1-01', etat: etat(T - 864e5) });
  s.ajouter({ type: 'reponse', ligne: ligne('pc', T - 864e5, 'p1-01') });
  await s.pousser('manuel');
  assert.equal(gh.commits().length, 2);
  assert.equal(s.etat.mode, 'a-jour');
  s.arreter();
});

test('deux appareils : cartes différentes et même carte → dernier last gagne, journal = union', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const tel = creer(gh, { stockage: await ouvrirStockage() });
  const pc = creer(gh, { stockage: await ouvrirStockage() });
  await tel.demarrer();
  await pc.demarrer();

  await reponse(tel, 'tel', T + 1000, 'p1-01', 2); // même carte, plus ancien
  await reponse(pc, 'pc', T + 2000, 'p1-02');       // autre carte
  await reponse(pc, 'pc', T + 3000, 'p1-01', 2);    // même carte, plus récent
  await tel.pousser('fin-seance');
  await pc.pousser('fin-seance'); // tête périmée : relit, fusionne, écrit
  assert.equal(gh.commits().length, 3);

  let srs = analyser(SRS, gh.fichiers()[SRS]).cards;
  assert.equal(srs['p1-01'].last, T + 3000);
  assert.equal(srs['p1-02'].last, T + 2000);
  let journal = analyser(REP, gh.fichiers()[REP]).map(l => l.id);
  assert.deepEqual(journal, [`pc-${T - 864e5}`, `tel-${T + 1000}`, `pc-${T + 2000}`, `pc-${T + 3000}`]);

  // Le téléphone envoie une réponse plus ancienne sur la même carte (faite hors ligne) : elle ne gagne pas.
  await reponse(tel, 'tel', T + 2500, 'p1-01', 3);
  await tel.pousser('fin-seance');
  srs = analyser(SRS, gh.fichiers()[SRS]).cards;
  assert.equal(srs['p1-01'].last, T + 3000);
  journal = analyser(REP, gh.fichiers()[REP]);
  assert.equal(journal.length, 5);
  assert.deepEqual(journal.map(l => l.ts), [...journal.map(l => l.ts)].sort((a, b) => a - b));

  // Chaque appareil voit la même chose après rafraîchissement.
  await pc.rafraichir();
  assert.deepEqual(tel.donnees().srs, pc.donnees().srs);
  assert.equal(pc.donnees().reponses.length, 5);
  tel.arreter();
  pc.arreter();
});

test('conflit pendant l\'envoi → nouvel essai réussi, rien de perdu', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  await reponse(s, 'tel', T + 1000, 'p1-02');

  // Juste avant l'avance de la branche, un autre appareil enregistre dans les mêmes fichiers.
  let patchs = 0;
  gh.intercepter(r => {
    if (r.methode !== 'PATCH') return;
    if (++patchs === 1) {
      gh.forcerCommitConcurrent({
        [SRS]: serialiser(SRS, { cards: { 'p1-01': etat(T - 864e5), 'p1-03': etat(T + 500) } }),
        [REP]: serialiser(REP, [ligne('pc', T - 864e5, 'p1-01'), ligne('pc', T + 500, 'p1-03')]),
      }, 'Autre appareil');
    }
  });
  await s.pousser('fin-seance');
  assert.equal(patchs, 2);
  assert.deepEqual(gh.commits().map(c => c.message), ['Premier commit', 'Autre appareil', 'Rappel : séance du 12/10 (1 réponse)']);
  const srs = analyser(SRS, gh.fichiers()[SRS]).cards;
  assert.deepEqual(Object.keys(srs).sort(), ['p1-01', 'p1-02', 'p1-03']);
  assert.equal(analyser(REP, gh.fichiers()[REP]).length, 3);
  assert.equal(s.etat.mode, 'a-jour');
  assert.equal(s.donnees().srs.p1['p1-03'].last, T + 500); // les données de l'autre appareil sont visibles
  s.arreter();
});

test('conflits répétés → erreur claire après 5 essais, ops gardées', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  await reponse(s, 'tel', T + 1000, 'p1-02');
  let patchs = 0;
  gh.intercepter(r => { if (r.methode === 'PATCH') { patchs++; gh.forcerCommitConcurrent({ 'docs/n.md': String(patchs) }); } });
  await s.pousser('manuel');
  assert.equal(patchs, 5);
  assert.equal(s.etat.mode, 'erreur');
  assert.equal(s.etat.code, 'conflit');
  assert.equal(s.etat.attente, 1);
  gh.intercepter(null);
  await s.pousser('manuel');
  assert.equal(s.etat.mode, 'a-jour');
  s.arreter();
});

test('ops ajoutées pendant l\'envoi : gardées pour l\'envoi suivant', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  await reponse(s, 'tel', T + 1000, 'p1-02');
  let fait = false;
  gh.intercepter(r => {
    if (r.methode === 'POST' && r.chemin.endsWith('/git/commits') && !fait) { fait = true; reponse(s, 'tel', T + 2000, 'p1-03'); }
  });
  await s.pousser('fin-seance');
  assert.deepEqual([s.etat.mode, s.etat.attente], ['attente', 1]);
  assert.equal(s._ops.length, 2);
  assert.equal(s.donnees().srs.p1['p1-03'].last, T + 2000); // toujours visible localement
  assert.equal(analyser(SRS, gh.fichiers()[SRS]).cards['p1-03'], undefined);
  await s.pousser('fin-seance');
  assert.equal(analyser(SRS, gh.fichiers()[SRS]).cards['p1-03'].last, T + 2000);
  assert.equal(s.etat.mode, 'a-jour');
  s.arreter();
});

test('hors ligne : ops gardées (même après fermeture), envoi au retour du réseau', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const stockage = await ouvrirStockage();
  const s = creer(gh, { stockage });
  await s.demarrer();
  gh.horsLigne(true);
  await reponse(s, 'tel', T + 1000, 'p1-02');
  await s.pousser('fin-seance');
  assert.deepEqual([s.etat.mode, s.etat.attente, s.etat.message], ['hors-ligne', 1, "Hors ligne : tout est gardé sur l'appareil"]);
  assert.equal((await stockage.lire('sync.ops')).length, 2);
  s.arreter();

  // L'appli est rouverte, toujours sans réseau : les réponses sont là.
  const s2 = creer(gh, { stockage });
  await s2.demarrer();
  assert.equal(s2.etat.mode, 'hors-ligne');
  assert.equal(s2.donnees().srs.p1['p1-02'].last, T + 1000);
  assert.equal(s2.donnees().reponses.length, 2);

  // Le réseau revient : l'événement « online » déclenche l'envoi.
  const fenetre = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  s2.brancherNavigateur(fenetre, doc);
  gh.horsLigne(false);
  const fini = attendreEtat(s2, 'a-jour');
  fenetre.dispatchEvent(new Event('online'));
  await fini;
  assert.equal(gh.commits().length, 2);
  assert.equal(analyser(SRS, gh.fichiers()[SRS]).cards['p1-02'].last, T + 1000);
  assert.deepEqual(await stockage.lire('sync.ops'), []);
  s2.arreter();
});

test('premier lancement hors ligne : message qui dit quoi faire', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  gh.horsLigne(true);
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  assert.equal(s.etat.mode, 'hors-ligne');
  assert.equal(s.etat.message, 'Hors ligne : connecte-toi pour charger tes cartes.');
  s.arreter();
});

test('arrière-plan (visibilitychange caché) → envoi', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  s.brancherNavigateur(new EventTarget(), doc);
  await reponse(s, 'tel', T + 1000, 'p1-02');
  const fini = attendreEtat(s, 'a-jour');
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await fini;
  assert.equal(gh.commits().length, 2);
  s.arreter();
});

test('minuterie : envoi groupé après le délai qui suit la dernière op', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const s = creer(gh, { stockage: await ouvrirStockage(), delaiEnvoi: 30 });
  await s.demarrer();
  await reponse(s, 'tel', T + 1000, 'p1-02');
  await new Promise(r => setTimeout(r, 15));
  await reponse(s, 'tel', T + 2000, 'p1-03');
  assert.equal(gh.commits().length, 1);
  await attendreEtat(s, 'a-jour');
  assert.equal(gh.commits().length, 2); // un seul commit pour les deux réponses
  assert.equal(gh.commits()[1].message, 'Rappel : séance du 12/10 (2 réponses)');
  s.arreter();
});

test('sans jeton : tout marche en local, rien n\'est envoyé', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest() });
  const stockage = await ouvrirStockage();
  const s = creer(gh, { stockage, jeton: '' });
  await s.demarrer();
  assert.deepEqual([s.etat.mode, s.etat.message], ['sans-jeton', 'Sans lien avec tes données']);
  await reponse(s, 'tel', T + 1000, 'p1-02');
  await s.pousser('manuel');
  assert.equal(s.donnees().srs.p1['p1-02'].last, T + 1000);
  assert.equal(s.etat.mode, 'sans-jeton');
  assert.equal(gh.requetes().length, 0);
  assert.equal((await stockage.lire('sync.ops')).length, 2);
  s.arreter();
});

test('jeton refusé → erreur avec message, ops gardées', async () => {
  const gh = creerFauxGitHub({ fichiers: depotTest(), jeton: 'bon' });
  const s = creer(gh, { stockage: await ouvrirStockage(), jeton: 'perime' });
  await s.demarrer();
  assert.equal(s.etat.mode, 'erreur');
  assert.equal(s.etat.code, 'jeton');
  assert.match(s.etat.message, /jeton/);
  await reponse(s, 'tel', T + 1000, 'p1-02');
  await s.pousser('manuel');
  assert.equal(s.etat.attente, 1);
  s.arreter();
});

test('fichier distant abîmé : jamais écrasé, message clair', async () => {
  const fichiers = { ...depotTest(), [SRS]: '{"cards": {abîmé' };
  const gh = creerFauxGitHub({ fichiers });
  const s = creer(gh, { stockage: await ouvrirStockage() });
  await s.demarrer();
  assert.equal(s.etat.mode, 'a-jour'); // le reste se charge
  assert.equal(s.donnees().paquets.p1.nom, 'Paquet « un »');
  await reponse(s, 'tel', T + 1000, 'p1-02');
  await s.pousser('fin-seance');
  assert.equal(s.etat.code, 'illisible');
  assert.match(s.etat.message, /progres\/srs\/p1\.json/);
  assert.equal(gh.commits().length, 1);
  assert.equal(gh.fichiers()[SRS], '{"cards": {abîmé');
  s.arreter();
});
