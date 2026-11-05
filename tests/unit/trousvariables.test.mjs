import test from 'node:test';
import assert from 'node:assert/strict';
import { varianteTrous } from '../../js/trousvariables.js';
import { clozeParts } from '../../js/texte.js';

const idee = (id, t) => ({ id, texte: t, formulations: [t, t + 's'], obligatoire: true });
const carte = n => ({
  id: 'c1', type: 'cloze',
  q: 'A {{un}} B {{deux}} C {{trois}} D {{quatre}}'.split(' ').slice(0, 1 + 2 * n).join(' '),
  bareme: { idees: ['un', 'deux', 'trois', 'quatre'].slice(0, n).map((t, i) => idee('t' + (i + 1), t)), pieges: [] },
});

const rndSuite = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('varianteTrous : moins de 3 trous, la carte ne change pas', () => {
  const c = carte(2);
  assert.equal(varianteTrous(c, () => 0), c);
  const libre = { id: 'x', type: 'libre', q: 'Q ?' };
  assert.equal(varianteTrous(libre), libre);
});

test('varianteTrous : garde 2 à n trous, les autres passent en clair, barème renuméroté', () => {
  const c = carte(4);
  const v = varianteTrous(c, rndSuite(0, 0.9, 0.1, 0.5, 0.3));
  const trous = clozeParts(v.q).filter(p => typeof p !== 'string');
  assert.ok(trous.length >= 2 && trous.length < 4);
  assert.equal(v.bareme.idees.length, trous.length);
  v.bareme.idees.forEach((i, k) => assert.equal(i.id, 't' + (k + 1)));
  // chaque idée gardée correspond à la réponse du trou dans l'ordre
  v.bareme.idees.forEach((i, k) => assert.equal(i.texte, trous[k].ans));
  assert.equal(v.variante, true);
  // le texte complet reste le même (mots en clair)
  assert.equal(v.q.replace(/[{}]/g, ''), c.q.replace(/[{}]/g, ''));
  // la carte d'origine n'est pas modifiée
  assert.equal(c.bareme.idees.length, 4);
});

test('varianteTrous : rnd() proche de 1 garde tous les trous (carte inchangée)', () => {
  const c = carte(3);
  assert.equal(varianteTrous(c, () => 0.99), c);
});

test('varianteTrous : tous les tirages donnent 2 à n trous et un barème cohérent', () => {
  const c = carte(4);
  for (let s = 0; s < 200; s++) {
    const v = varianteTrous(c);
    const trous = clozeParts(v.q).filter(p => typeof p !== 'string');
    assert.ok(trous.length >= 2 && trous.length <= 4);
    assert.equal(v.bareme.idees.length, trous.length);
    v.bareme.idees.forEach((i, k) => assert.equal(i.texte, trous[k].ans));
  }
});

test('varianteTrous : barème sans ids tN, association par position', () => {
  const c = carte(3);
  c.bareme.idees = c.bareme.idees.map(i => ({ ...i, id: 'zz' + i.id }));
  const v = varianteTrous(c, () => 0);
  const trous = clozeParts(v.q).filter(p => typeof p !== 'string');
  assert.equal(trous.length, 2);
  v.bareme.idees.forEach((i, k) => assert.equal(i.texte, trous[k].ans));
});
