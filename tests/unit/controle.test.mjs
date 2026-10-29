import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controleDuJour, corrigerControle, opControle } from '../../js/controle.js';
import { cheminUtile, vue } from '../../js/depot.js';

const q = (num, vraies) => ({ num, cartes: ['c' + num], paquet: 'p', enonce: 'Énoncé ' + num,
  propositions: 'ABCDE'.split('').map(l => ({ l, t: 'Prop ' + l, vrai: vraies.includes(l), expl: (vraies.includes(l) ? 'Vrai' : 'Faux') + ' : car.' })) });
const prepare = { date: '2026-10-30', type: 'mini', nb_questions: 4, bareme: [1, 0.5, 0.2, 0], questions: [q(1, 'AB'), q(2, 'C'), q(3, 'DE'), q(4, 'A')] };
const T = Date.parse('2026-10-30T10:00:00+01:00');

test('contrôle du jour : seul le préparé du jour est chargé, résultat et préparé dans la vue', () => {
  assert.equal(cheminUtile('rappel/controles/prepares/2026-10-30.json', 'rappel/', '2026-10-30'), true);
  assert.equal(cheminUtile('rappel/controles/prepares/2026-11-02.json', 'rappel/', '2026-10-30'), false, 'pas les suivants');
  assert.equal(cheminUtile('rappel/controles/2026-10-28.json', 'rappel/', '2026-10-30'), true);
  const d = vue({ 'rappel/controles/prepares/2026-10-30.json': prepare, 'rappel/controles/2026-10-28.json': { note: 16.4 } });
  assert.equal(controleDuJour(d, T).prepare, prepare);
  assert.equal(controleDuJour(d, T).resultat, null);
  assert.equal(controleDuJour(d, T + 3 * 864e5), null);
  assert.equal(d.controles['2026-10-28'].note, 16.4);
});

test('correction au barème : 0 erreur = 1, 1 = 0,5, 2 = 0,2, 3 ou plus = 0 ; note sur 20 ; blocage sous 10', () => {
  // q1 juste, q2 1 erreur (A en trop), q3 2 erreurs (rien coché), q4 3 erreurs.
  const r = corrigerControle(prepare, { 1: ['B', 'A'], 2: ['A', 'C'], 4: ['B', 'C'] }, { maintenant: T, appareil: 'tel' });
  assert.deepEqual(r.questions.map(x => [x.reponse, x.erreurs, x.points]), [['AB', 0, 1], ['AC', 1, 0.5], ['', 2, 0.2], ['BC', 3, 0]]);
  assert.equal(r.points, 1.7);
  assert.equal(r.note, 8.5);
  assert.equal(r.bloque, true);
  assert.equal(r.type, 'mini');
  assert.match(r.remarques, /ne change pas l'objectif/);
  assert.equal(r.passe_dans, 'rappel2');
  const op = opControle(r);
  assert.equal(op.type, 'fichier');
  assert.equal(op.path, 'controles/2026-10-30.json');
  assert.equal(JSON.parse(op.texte).note, 8.5);
  const d = vue({ 'rappel/controles/prepares/2026-10-30.json': prepare, 'rappel/controles/2026-10-30.json': r });
  assert.equal(controleDuJour(d, T).resultat.note, 8.5);
});
