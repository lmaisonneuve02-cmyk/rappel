import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ideesACocher, resultatCoche, DELAI_RETOURNER } from '../../js/coche.js';

const carte = {
  id: 'c1', type: 'fait', q: 'Quels nerfs ?', a: 'Le vague et le phrénique, parfois le récurrent.',
  bareme: { idees: [
    { id: 'i1', texte: 'Le vague', formulations: ['nerf X', 'pneumogastrique'], obligatoire: true },
    { id: 'i2', texte: 'Le phrénique', formulations: ['nerf phrénique', 'C4'], obligatoire: true },
    { id: 'i3', texte: 'Le récurrent', formulations: ['laryngé inférieur', 'récurrent'], obligatoire: false },
  ] },
};

test('idées à cocher : toutes, ordre mélangé par le tirage, sans les formulations', () => {
  assert.equal(DELAI_RETOURNER, 3000);
  const a = ideesACocher(carte, () => 0);
  assert.deepEqual(a.map(i => i.id).sort(), ['i1', 'i2', 'i3']);
  assert.notDeepEqual(a.map(i => i.id), ['i1', 'i2', 'i3']);
  assert.deepEqual(Object.keys(a[0]).sort(), ['id', 'obligatoire', 'texte']);
  assert.deepEqual(ideesACocher({ id: 'x', q: 'Q', a: '' }), []);
});

test('verdict : toutes les obligatoires → juste ; une partie → partiel ; aucune → faux ; erreur signalée → pas juste', () => {
  const idees = ideesACocher(carte);
  const r = c => resultatCoche(idees, new Set(c));
  assert.equal(r(['i1', 'i2']).verdict, 'juste');
  assert.equal(r(['i1', 'i2', 'i3']).correcteur, 'coche');
  assert.equal(r(['i1']).verdict, 'partiel');
  assert.deepEqual(r(['i1']).idees_manquantes, ['Le phrénique']);
  assert.equal(r(['i3']).verdict, 'faux', 'une idée facultative seule ne suffit pas');
  assert.equal(r([]).verdict, 'faux');
  const e = resultatCoche(idees, new Set(['i1', 'i2']), { erreur: true });
  assert.equal(e.verdict, 'partiel');
  assert.equal(e.erreurs.length, 1);
  assert.equal(resultatCoche(idees, new Set(['i1']), { erreur: true }).verdict, 'partiel');
});
