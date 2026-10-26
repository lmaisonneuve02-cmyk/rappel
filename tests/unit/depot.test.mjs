import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGLAGES_DEFAUT, cheminUtile, analyser, serialiser, vue, cheminsTouches, appliquerOp,
} from '../../js/depot.js';

const R = 'rappel/';
const TS = Date.UTC(2026, 9, 12, 12, 0); // 12 oct. 2026, 14 h à Paris
const etat = (last, reps = 1) => ({ s: 3.7, d: 5.2, due: last + 3 * 864e5, last, reps, lapses: 0 });

// Petit dossier synthétique, déjà analysé.
function objetsTest() {
  return {
    'rappel/plan.json': { semestre: 'S5', ues: [
      { id: 'ue-b', nom: 'UE B', cours: [{ id: 'b-cm02', paquet: 'b-cm02' }, { id: 'b-cm01', paquet: 'b-cm01' }] },
      { id: 'ue-a', nom: 'UE A', cours: [{ id: 'a-cm01', paquet: null }] }] },
    'rappel/paquets/b-cm01.json': { id: 'b-cm01', ue: 'ue-b', ordre: 2, cartes: [{ id: 'b1-01', type: 'fait', q: 'Q ?', a: 'R.' }] },
    'rappel/paquets/b-cm02.json': { id: 'b-cm02', ue: 'ue-b', ordre: 1, cartes: [{ id: 'b2-01', type: 'cloze', q: 'Le {{cœur}}.' }] },
    'rappel/paquets/sem-y.json': { id: 'sem-y', ordre: 5, cartes: [{ id: 'y-01', type: 'fait', q: 'Y ?', a: 'Y.' }] },
    'rappel/paquets/sem-x.json': { id: 'sem-x', ordre: 5, cartes: [{ id: 'x-01', type: 'fait', q: 'X ?', a: 'X.' }, { id: 'b1-01', q: 'doublon' }] },
    'rappel/fiches/b-cm01.json': { id: 'b-cm01', title: 'Fiche', blocks: [] },
    'rappel/qcm/b-cm01.json': { cours: 'b-cm01', ue: 'ue-b', qcm: [{ id: 'b-cm01-q01', statut: 'valide', maj: 0 }, { id: 'b-cm01-q02', cours: 'b-cm01', ue: 'ue-b', statut: 'brouillon' }] },
    'rappel/progres/srs/b-cm01.json': { cards: { 'b1-01': etat(TS - 864e5) } },
    'rappel/progres/reponses/2026-10.jsonl': [{ id: 'tel-3', ts: 3 }, { id: 'tel-1', ts: 1 }],
    'rappel/progres/reponses/2026-09.jsonl': [{ id: 'tel-2', ts: 2 }],
    'rappel/progres/qcm/2026-10.jsonl': [{ id: 'pc-9', ts: 9 }],
    'rappel/progres/carnet.json': { abreviations: { rao: 'rétrécissement aortique' }, cartes: {} },
    'rappel/progres/reglages.json': { nouvellesParJour: 64, ordrePaquets: ['sem-y'], modeles: {}, voix: { vitesse: 1.2 }, maj: 3 },
    'rappel/progres/exceptions.json': { jours: { '2026-10-01': 'malade' } },
    'rappel/progres/historique-v1.json': { source: 'v1', days: { '2026-10-07': { n: 36 } } },
    'docs/autre.json': { ignore: true },
  };
}

test('REGLAGES_DEFAUT : valeurs de la conception, gelées', () => {
  assert.deepEqual(REGLAGES_DEFAUT, {
    nouvellesParJour: 15, objectifJour: 60, nouvellesObjectif: 0, objectifSemaine: 0, nouvellesSemaine: 0, feuillesSemaine: 0, ordrePaquets: [], baremeQcm: [1, 0.5, 0.2, 0],
    qcmParSeance: 8, pauseToutes: 30, modeles: { correction: '', contestation: '' },
    voix: { vitesse: 1, silence: 2.5 }, maj: 0,
  });
  assert.ok(Object.isFrozen(REGLAGES_DEFAUT) && Object.isFrozen(REGLAGES_DEFAUT.voix));
});

test('cheminUtile : plan, paquets, fiches, qcm, progres seulement', () => {
  for (const p of ['plan.json', 'paquets/cv-cm06.json', 'fiches/cv-cm06.json', 'qcm/cv-cm06.json',
    'progres/srs/cv-cm06.json', 'progres/reponses/2026-10.jsonl', 'progres/calibration/cas.json', 'progres/carnet.json']) {
    assert.equal(cheminUtile(R + p), true, p);
  }
  for (const p of ['rappel/v1/index.html', 'rappel/bilans/x.json', 'rappel/README.md', 'rappel/paquets/notes.md',
    'rappel/paquets/sous/x.json', 'docs/plan.json', 'plan.json', 'autre/rappel/plan.json']) {
    assert.equal(cheminUtile(p), false, p);
  }
  assert.equal(cheminUtile('donnees/plan.json', 'donnees'), true);
  assert.equal(cheminUtile('plan.json', ''), true);
});

test('analyser / serialiser : format de la conception', () => {
  const o = { id: 'é', n: [1, 2] };
  const t = serialiser('rappel/paquets/x.json', o);
  assert.equal(t, '{\n "id": "é",\n "n": [\n  1,\n  2\n ]\n}\n');
  assert.deepEqual(analyser('rappel/paquets/x.json', t), o);
  const l = [{ id: 'a', ts: 1 }, { id: 'b', ts: 2 }];
  assert.equal(serialiser('rappel/progres/reponses/2026-10.jsonl', l), '{"id":"a","ts":1}\n{"id":"b","ts":2}\n');
  assert.deepEqual(analyser('rappel/progres/reponses/2026-10.jsonl', '{"id":"a","ts":1}\n\nabîmé\n{"id":"b","ts":2}\n'), l);
  assert.throws(() => analyser('rappel/plan.json', '{abîmé'));
});

test('vue : paquets, ordre, cartes, qcm aplatis, journaux triés, défauts', () => {
  const d = vue(objetsTest(), R);
  assert.deepEqual(Object.keys(d.paquets).sort(), ['b-cm01', 'b-cm02', 'sem-x', 'sem-y']);
  // réglages, puis plan (UE puis cours), puis champ ordre, puis identifiant
  assert.deepEqual(d.ordre, ['sem-y', 'b-cm02', 'b-cm01', 'sem-x']);
  assert.deepEqual(d.cartes['b1-01'], { paquet: 'b-cm01', carte: d.paquets['b-cm01'].cartes[0] });
  assert.equal(d.cartes['x-01'].paquet, 'sem-x');
  assert.equal(Object.keys(d.cartes).length, 4);
  assert.deepEqual(Object.keys(d.qcm), ['b-cm01-q01', 'b-cm01-q02']);
  assert.equal(d.qcm['b-cm01-q01'].cours, 'b-cm01');
  assert.equal(d.qcm['b-cm01-q01'].ue, 'ue-b');
  assert.equal(d.srs['b-cm01']['b1-01'].reps, 1);
  assert.deepEqual(d.reponses.map(l => l.id), ['tel-1', 'tel-2', 'tel-3']);
  assert.deepEqual(d.qcmJournal.map(l => l.id), ['pc-9']);
  assert.equal(d.fiches['b-cm01'].title, 'Fiche');
  assert.equal(d.carnet.abreviations.rao, 'rétrécissement aortique');
  assert.deepEqual(d.aRevoir, { cas: [] });
  assert.equal(d.reglages.nouvellesParJour, 64);
  assert.equal(d.reglages.qcmParSeance, 8);
  assert.deepEqual(d.reglages.modeles, { correction: '', contestation: '' });
  assert.deepEqual(d.reglages.voix, { vitesse: 1.2, silence: 2.5 });
  assert.deepEqual(d.exceptions.jours, { '2026-10-01': 'malade' });
  assert.equal(d.historique.days['2026-10-07'].n, 36);
  assert.equal(d.plan.semestre, 'S5');
});

test('vue : dossier vide → données vides avec défauts', () => {
  const d = vue({}, R);
  assert.equal(d.plan, null);
  assert.deepEqual(d.ordre, []);
  assert.deepEqual(d.reponses, []);
  assert.deepEqual(d.carnet, { abreviations: {}, cartes: {} });
  assert.deepEqual(d.reglages, { ...REGLAGES_DEFAUT, ordrePaquets: [], baremeQcm: [1, 0.5, 0.2, 0], modeles: { correction: '', contestation: '' }, voix: { vitesse: 1, silence: 2.5 } });
  assert.deepEqual(d.historique, { days: {} });
  assert.deepEqual(d.exceptions, { jours: {} });
  assert.deepEqual([d.idees, d.feuilles], [{}, []]);
});

test('vue : listes d\'idées et journal des feuilles blanches (trié)', () => {
  const d = vue({
    [R + 'idees/p1.json']: { titre: 'Cours 1', idees: [{ id: 'i1', texte: 'Une idée', cartes: [] }] },
    [R + 'progres/feuilles/2026-10.jsonl']: [{ id: 'b', ts: 2 }, { id: 'a', ts: 1 }],
  }, R);
  assert.equal(d.idees.p1.titre, 'Cours 1');
  assert.deepEqual(d.feuilles.map(l => l.id), ['a', 'b']);
});

test('cheminsTouches : un fichier par opération', () => {
  const ligne = { id: 'tel-1', ts: TS };
  assert.deepEqual(cheminsTouches({ type: 'srs', paquet: 'b-cm01', carte: 'b1-01', etat: {} }, R), ['rappel/progres/srs/b-cm01.json']);
  assert.deepEqual(cheminsTouches({ type: 'reponse', ligne }, R), ['rappel/progres/reponses/2026-10.jsonl']);
  // 31 oct. 23 h 30 UTC = 1er nov. à Paris
  assert.deepEqual(cheminsTouches({ type: 'reponse', ligne: { ts: Date.UTC(2026, 9, 31, 23, 30) } }, R), ['rappel/progres/reponses/2026-11.jsonl']);
  assert.deepEqual(cheminsTouches({ type: 'qcm-reponse', ligne }, R), ['rappel/progres/qcm/2026-10.jsonl']);
  assert.deepEqual(cheminsTouches({ type: 'erreur', ligne }, R), ['rappel/progres/erreurs/2026-10.jsonl']);
  assert.deepEqual(cheminsTouches({ type: 'feuille', ligne }, R), ['rappel/progres/feuilles/2026-10.jsonl']);
  assert.deepEqual(cheminsTouches({ type: 'carnet', carte: 'x' }, R), ['rappel/progres/carnet.json']);
  assert.deepEqual(cheminsTouches({ type: 'a-revoir', cas: {} }, R), ['rappel/progres/a-revoir.json']);
  assert.deepEqual(cheminsTouches({ type: 'reglages', reglages: {} }, R), ['rappel/progres/reglages.json']);
  assert.deepEqual(cheminsTouches({ type: 'qcm-ajout', cours: 'b-cm01', qcm: [] }, R), ['rappel/qcm/b-cm01.json']);
  assert.deepEqual(cheminsTouches({ type: 'qcm-statut', cours: 'b-cm01', id: 'q' }, R), ['rappel/qcm/b-cm01.json']);
  assert.deepEqual(cheminsTouches({ type: 'fichier', path: 'progres/calibration/2026-10-12.json', texte: '{}' }, R), ['rappel/progres/calibration/2026-10-12.json']);
  assert.deepEqual(cheminsTouches({ type: 'fichier', path: 'rappel/progres/calibration/x.json', texte: '{}' }, R), ['rappel/progres/calibration/x.json']);
  // chemins dangereux ou op inconnue : rien
  assert.deepEqual(cheminsTouches({ type: 'srs', paquet: '../x' }, R), []);
  assert.deepEqual(cheminsTouches({ type: 'fichier', path: 'progres/../../secret.json' }, R), []);
  assert.deepEqual(cheminsTouches({ type: 'inconnue' }, R), []);
});

// Applique deux fois et vérifie que le second passage ne change rien.
function deuxFois(objets, op) {
  appliquerOp(objets, op, R);
  const une = JSON.stringify(objets);
  appliquerOp(objets, op, R);
  assert.equal(JSON.stringify(objets), une, 'op non idempotente : ' + op.type);
  return objets;
}

test('appliquerOp srs : crée ou fusionne, idempotent, sans modifier les anciens objets', () => {
  const objets = objetsTest();
  const ancien = objets['rappel/progres/srs/b-cm01.json'];
  const copie = structuredClone(ancien);
  deuxFois(objets, { type: 'srs', paquet: 'b-cm01', carte: 'b1-01', etat: etat(TS, 2) });
  assert.equal(objets['rappel/progres/srs/b-cm01.json'].cards['b1-01'].last, TS);
  assert.deepEqual(ancien, copie);
  // un état plus ancien ne remplace pas le plus récent
  appliquerOp(objets, { type: 'srs', paquet: 'b-cm01', carte: 'b1-01', etat: etat(TS - 1e6, 9) }, R);
  assert.equal(objets['rappel/progres/srs/b-cm01.json'].cards['b1-01'].last, TS);
  deuxFois(objets, { type: 'srs', paquet: 'sem-x', carte: 'x-01', etat: etat(TS) });
  assert.deepEqual(Object.keys(objets['rappel/progres/srs/sem-x.json'].cards), ['x-01']);
});

test('appliquerOp reponse / qcm-reponse : ajout au bon mois, idempotent', () => {
  const objets = objetsTest();
  deuxFois(objets, { type: 'reponse', ligne: { id: 'tel-' + TS, ts: TS, carte: 'b1-01' } });
  assert.deepEqual(objets['rappel/progres/reponses/2026-10.jsonl'].map(l => l.id), ['tel-1', 'tel-3', 'tel-' + TS]);
  deuxFois(objets, { type: 'qcm-reponse', ligne: { id: 'tel-q', ts: Date.UTC(2026, 10, 2) } });
  assert.deepEqual(objets['rappel/progres/qcm/2026-11.jsonl'], [{ id: 'tel-q', ts: Date.UTC(2026, 10, 2) }]);
});

test('appliquerOp carnet : acceptée, refusée, abréviations ; la dernière décision gagne', () => {
  const objets = objetsTest();
  const p = 'rappel/progres/carnet.json';
  deuxFois(objets, { type: 'carnet', carte: 'b1-01', refusee: 'Les veines' });
  deuxFois(objets, { type: 'carnet', carte: 'b1-01', acceptee: 'Les capillaires', abreviations: { ' IC ': 'insuffisance cardiaque', rao: 'autre' } });
  assert.deepEqual(objets[p].cartes['b1-01'], { acceptees: ['Les capillaires'], refusees: ['Les veines'] });
  assert.equal(objets[p].abreviations.ic, 'insuffisance cardiaque');
  assert.equal(objets[p].abreviations.rao, 'rétrécissement aortique');
  // accepter une réponse refusée auparavant la retire des refusées
  deuxFois(objets, { type: 'carnet', carte: 'b1-01', acceptee: 'les veines' });
  assert.deepEqual(objets[p].cartes['b1-01'], { acceptees: ['Les capillaires', 'les veines'], refusees: [] });
  // carnet absent : créé
  const vide = {};
  deuxFois(vide, { type: 'carnet', abreviations: { hta: 'hypertension artérielle' } });
  assert.deepEqual(vide[p], { abreviations: { hta: 'hypertension artérielle' }, cartes: {} });
});

test('appliquerOp a-revoir et reglages', () => {
  const objets = objetsTest();
  deuxFois(objets, { type: 'a-revoir', cas: { id: 'tel-5', ts: 5, type: 'incertain', carte: 'b1-01' } });
  deuxFois(objets, { type: 'a-revoir', cas: { id: 'tel-2', ts: 2, type: 'contestation' } });
  assert.deepEqual(objets['rappel/progres/a-revoir.json'].cas.map(c => c.id), ['tel-2', 'tel-5']);
  const p = 'rappel/progres/reglages.json';
  deuxFois(objets, { type: 'reglages', reglages: { nouvellesParJour: 20, maj: 10 } });
  assert.equal(objets[p].nouvellesParJour, 20);
  appliquerOp(objets, { type: 'reglages', reglages: { nouvellesParJour: 5, maj: 4 } }, R);
  assert.equal(objets[p].nouvellesParJour, 20);
});

test('appliquerOp qcm-ajout et qcm-statut', () => {
  const objets = {};
  const p = 'rappel/qcm/b-cm01.json';
  const q = id => ({ id, source: 'gemini', statut: 'brouillon', verifie: false, maj: 0, enonce: '…', propositions: [] });
  deuxFois(objets, { type: 'qcm-ajout', cours: 'b-cm01', ue: 'ue-b', qcm: [q('g1'), q('g2')] });
  assert.equal(objets[p].cours, 'b-cm01');
  assert.deepEqual(objets[p].qcm.map(x => [x.id, x.cours, x.ue]), [['g1', 'b-cm01', 'ue-b'], ['g2', 'b-cm01', 'ue-b']]);
  deuxFois(objets, { type: 'qcm-ajout', cours: 'b-cm01', ue: 'ue-b', qcm: q('g3') });
  assert.equal(objets[p].qcm.length, 3);
  deuxFois(objets, { type: 'qcm-statut', cours: 'b-cm01', id: 'g2', statut: 'signale', maj: 50 });
  assert.equal(objets[p].qcm[1].statut, 'signale');
  // statut plus ancien que la dernière modification : ignoré
  appliquerOp(objets, { type: 'qcm-statut', cours: 'b-cm01', id: 'g2', statut: 'valide', maj: 40 }, R);
  assert.equal(objets[p].qcm[1].statut, 'signale');
  // fichier absent : rien
  appliquerOp(objets, { type: 'qcm-statut', cours: 'autre', id: 'g2', statut: 'valide', maj: 60 }, R);
  assert.equal(objets['rappel/qcm/autre.json'], undefined);
});

test('appliquerOp fichier : remplace (calibration), illisible ignoré', () => {
  const objets = {};
  deuxFois(objets, { type: 'fichier', path: 'progres/calibration/2026-10-12.json', texte: '{"accord": 0.9}' });
  assert.deepEqual(objets['rappel/progres/calibration/2026-10-12.json'], { accord: 0.9 });
  appliquerOp(objets, { type: 'fichier', path: 'progres/calibration/2026-10-12.json', texte: '{abîmé' }, R);
  assert.deepEqual(objets['rappel/progres/calibration/2026-10-12.json'], { accord: 0.9 });
});

test('appliquerOp puis vue : la donnée locale apparaît', () => {
  const objets = objetsTest();
  appliquerOp(objets, { type: 'srs', paquet: 'sem-x', carte: 'x-01', etat: etat(TS) }, R);
  appliquerOp(objets, { type: 'reponse', ligne: { id: 'tel-' + TS, ts: TS, carte: 'x-01' } }, R);
  const d = vue(objets, R);
  assert.equal(d.srs['sem-x']['x-01'].last, TS);
  assert.equal(d.reponses.at(-1).carte, 'x-01');
});
