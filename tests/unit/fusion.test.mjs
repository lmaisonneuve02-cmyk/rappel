import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fusionSrs, fusionLignes, fusionCarnet, fusionARevoir, fusionQcmFichier, fusionReglages, analyserJsonl, versJsonl,
} from '../../js/fusion.js';

const etat = (last, reps = 1, extra = {}) => ({ s: 1, d: 5, due: last + 864e5, last, reps, lapses: 0, ...extra });

test('fusionSrs : le last le plus récent gagne, carte par carte', () => {
  const a = { cards: { c1: etat(100), c2: etat(500) } };
  const b = { cards: { c1: etat(200), c2: etat(400), c3: etat(50) } };
  const f = fusionSrs(a, b);
  assert.equal(f.cards.c1.last, 200);
  assert.equal(f.cards.c2.last, 500);
  assert.equal(f.cards.c3.last, 50);
  assert.deepEqual(Object.keys(f.cards), ['c1', 'c2', 'c3']);
});

test('fusionSrs : égalité de last → reps le plus grand, puis a', () => {
  const a = { cards: { c1: etat(100, 2, { s: 'a' }), c2: etat(100, 1, { s: 'a' }) } };
  const b = { cards: { c1: etat(100, 3, { s: 'b' }), c2: etat(100, 1, { s: 'b' }) } };
  const f = fusionSrs(a, b);
  assert.equal(f.cards.c1.s, 'b');
  assert.equal(f.cards.c2.s, 'a');
});

test('fusionSrs : ne modifie pas ses arguments et tolère les absents', () => {
  const a = { cards: { c1: etat(1) } };
  const copie = structuredClone(a);
  fusionSrs(a, { cards: { c1: etat(2) } });
  assert.deepEqual(a, copie);
  assert.deepEqual(fusionSrs(null, undefined), { cards: {} });
});

test('fusionLignes : union par id, triée par ts, a gagne', () => {
  const a = [{ id: 'x-3', ts: 3, v: 'a' }, { id: 'x-1', ts: 1 }];
  const b = [{ id: 'x-2', ts: 2 }, { id: 'x-3', ts: 3, v: 'b' }];
  const f = fusionLignes(a, b);
  assert.deepEqual(f.map(l => l.id), ['x-1', 'x-2', 'x-3']);
  assert.equal(f[2].v, 'a');
  assert.deepEqual(fusionLignes(f, f), f);
});

test('fusionCarnet : abréviations (a prioritaire) et listes sans doublon', () => {
  const a = { abreviations: { rao: 'rétrécissement aortique' }, cartes: { c1: { acceptees: ['Les capillaires'], refusees: [] } } };
  const b = { abreviations: { rao: 'autre sens', ic: 'insuffisance cardiaque' }, cartes: { c1: { acceptees: ['les capillaires !', 'Capillaires'], refusees: ['veines'] }, c2: { acceptees: ['oui'] } } };
  const f = fusionCarnet(a, b);
  assert.deepEqual(f.abreviations, { rao: 'rétrécissement aortique', ic: 'insuffisance cardiaque' });
  assert.deepEqual(f.cartes.c1.acceptees, ['Les capillaires', 'Capillaires']);
  assert.deepEqual(f.cartes.c1.refusees, ['veines']);
  assert.deepEqual(f.cartes.c2, { acceptees: ['oui'], refusees: [] });
});

test('fusionCarnet : 20 entrées au plus, les plus récentes gardées', () => {
  const a = { cartes: { c1: { acceptees: Array.from({ length: 20 }, (_, i) => `réponse ${i}`) } } };
  const f = fusionCarnet(a, { cartes: { c1: { acceptees: ['réponse neuve'] } } });
  assert.equal(f.cartes.c1.acceptees.length, 20);
  assert.equal(f.cartes.c1.acceptees[0], 'réponse 1');
  assert.equal(f.cartes.c1.acceptees.at(-1), 'réponse neuve');
});

test('fusionARevoir : union par id triée par ts ; a complété par b', () => {
  const a = { cas: [{ id: 'p-5', ts: 5, type: 'incertain', issue: 'accepte' }] };
  const b = { cas: [{ id: 'p-5', ts: 5, type: 'incertain', raison: 'doute' }, { id: 'p-2', ts: 2, type: 'contestation' }] };
  const f = fusionARevoir(a, b);
  assert.deepEqual(f.cas.map(c => c.id), ['p-2', 'p-5']);
  assert.equal(f.cas[1].issue, 'accepte');
  assert.equal(f.cas[1].raison, 'doute');
});

test('fusionQcmFichier : union par id, maj la plus récente gagne', () => {
  const a = { cours: 'ue-cm01', ue: 'ue', qcm: [{ id: 'q1', statut: 'valide', maj: 10 }, { id: 'q2', statut: 'brouillon', maj: 5 }] };
  const b = { cours: 'ue-cm01', ue: 'ue', qcm: [{ id: 'q2', statut: 'signale', maj: 8 }, { id: 'q1', statut: 'signale', maj: 10 }, { id: 'q3', maj: 0 }] };
  const f = fusionQcmFichier(a, b);
  assert.deepEqual(f.qcm.map(q => [q.id, q.statut]), [['q1', 'valide'], ['q2', 'signale'], ['q3', undefined]]);
  assert.equal(f.cours, 'ue-cm01');
});

test('fusionReglages : maj la plus récente gagne (objet entier)', () => {
  const a = { nouvellesParJour: 10, maj: 5 };
  const b = { nouvellesParJour: 20, maj: 7 };
  assert.equal(fusionReglages(a, b), b);
  assert.equal(fusionReglages(b, a), b);
  assert.equal(fusionReglages(a, { ...a, nouvellesParJour: 1 }), a);
  assert.equal(fusionReglages(null, b), b);
});

test('analyserJsonl / versJsonl : aller-retour, lignes vides et abîmées ignorées', () => {
  const lignes = [{ id: 'a', ts: 1, reponse: 'élément « accentué »' }, { id: 'b', ts: 2 }];
  const texte = versJsonl(lignes);
  assert.equal(texte, '{"id":"a","ts":1,"reponse":"élément « accentué »"}\n{"id":"b","ts":2}\n');
  assert.deepEqual(analyserJsonl(texte), lignes);
  assert.deepEqual(analyserJsonl('{"id":"a"}\r\n\n{abîmé\n42\n  {"id":"b"}  \n'), [{ id: 'a' }, { id: 'b' }]);
  assert.equal(versJsonl([]), '');
  assert.deepEqual(analyserJsonl(''), []);
});
