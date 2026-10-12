// Planification des cartes : identique à v1, « dû dès minuit », retour à +10 min, acquises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  W, DECAY, FACTOR, RET, review, apercu, NOTES, noteDe, estDisponible, estAcquise, delaiTexte,
} from '../../js/fsrs.js';
import { MIN, HEURE, JOUR } from '../../js/temps.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/fsrs-v1.json', import.meta.url), 'utf8'));
const z = s => Date.parse(s);
const T = z('2026-10-12T10:00:00Z');   // lundi 12 oct. 2026, 12:00 à Paris

test('paramètres de v1', () => {
  assert.deepEqual(W, [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]);
  assert.equal(DECAY, -0.5);
  assert.equal(FACTOR, 19 / 81);
  assert.equal(RET, 0.9);
});

test('review : mêmes états que v1 sur toutes les séquences de référence', () => {
  assert.ok(fixture.sequences.length >= 10);
  for (const [k, sequence] of fixture.sequences.entries()) {
    let st = null;
    for (const [i, pas] of sequence.entries()) {
      const res = review(st, pas.g, pas.now);
      assert.deepStrictEqual(res, pas.st, `séquence ${k}, réponse ${i + 1}`);
      st = res;
    }
  }
});

test('review : ne modifie pas l\'état reçu', () => {
  const st = review(null, 3, T);
  const copie = structuredClone(st);
  review(st, 1, T + 5 * JOUR);
  assert.deepStrictEqual(st, copie);
});

test('review : une erreur sur une carte connue compte un oubli et revient à +10 min', () => {
  const st = review(null, 3, T);
  const rate = review(st, 1, T + 4 * JOUR);
  assert.equal(rate.lapses, 1);
  assert.equal(rate.reps, 2);
  assert.equal(rate.due - rate.last, 10 * MIN);
  assert.equal(review(null, 1, T).lapses, 0);   // première réponse fausse : pas un oubli
});

test('notes : juste 3, partiel 2, faux 1, sinon 1', () => {
  assert.deepEqual(NOTES, { juste: 3, partiel: 2, faux: 1 });
  assert.equal(noteDe('juste'), 3);
  assert.equal(noteDe('partiel'), 2);
  assert.equal(noteDe('faux'), 1);
  assert.equal(noteDe('autre'), 1);
  assert.equal(noteDe(undefined), 1);
});

test('apercu : comme preview de v1, avec l\'heure fournie', () => {
  assert.equal(apercu(null, 1, T), '10 min');
  assert.equal(apercu(null, 2, T), '1 j');
  assert.equal(apercu(null, 3, T), '4 j');
  assert.equal(apercu(null, 4, T), '14 j');
  const mur = { s: 60, d: 5, due: T, last: T - 60 * JOUR, reps: 4, lapses: 0 };
  const n = Math.round((review(mur, 3, T).due - T) / JOUR);
  assert.ok(n >= 30 && n < 365);
  assert.equal(apercu(mur, 3, T), `${Math.round(n / 30)} mois`);
  const roc = { s: 2000, d: 2, due: T, last: T - 300 * JOUR, reps: 9, lapses: 0 };
  assert.equal(apercu(roc, 3, T), '1 an');
});

test('estDisponible : sans état, rien à réviser', () => {
  assert.equal(estDisponible(null, T), false);
  assert.equal(estDisponible(undefined, T), false);
});

test('estDisponible : dû dès minuit (heure de Paris)', () => {
  const ceSoir = { s: 4, d: 5, last: T - 4 * JOUR, due: z('2026-10-12T18:00:00Z'), reps: 1, lapses: 0 };
  assert.equal(estDisponible(ceSoir, T), true);                             // dû à 20 h, proposé dès midi
  assert.equal(estDisponible(ceSoir, z('2026-10-11T22:00:00Z')), true);     // et dès minuit
  assert.equal(estDisponible(ceSoir, z('2026-10-11T21:59:59Z')), false);    // pas la veille au soir

  const demain = { s: 4, d: 5, last: T - 3 * JOUR, due: z('2026-10-13T06:00:00Z'), reps: 1, lapses: 0 };
  assert.equal(estDisponible(demain, T), false);
  assert.equal(estDisponible(demain, z('2026-10-12T21:59:59.999Z')), false); // 23:59:59 à Paris
  assert.equal(estDisponible(demain, z('2026-10-12T22:00:00Z')), true);      // 00:00 à Paris le 13

  const minuitPile = { s: 4, d: 5, last: T - 3 * JOUR, due: z('2026-10-12T22:00:00Z'), reps: 1, lapses: 0 };
  assert.equal(estDisponible(minuitPile, T), false);                         // dû le 13 à 00:00 : pas le 12
});

test('estDisponible : une carte ratée ne revient que 10 min après', () => {
  const ratee = review(review(null, 3, T - 4 * JOUR), 1, T);
  assert.equal(ratee.due, T + 10 * MIN);
  assert.equal(estDisponible(ratee, T), false);
  assert.equal(estDisponible(ratee, T + 9 * MIN), false);
  assert.equal(estDisponible(ratee, T + 10 * MIN), true);
  // ratée à 23:55 : pas de « dû dès minuit » anticipé, elle attend ses 10 min
  const tard = review(null, 1, z('2026-10-12T21:55:00Z'));
  assert.equal(estDisponible(tard, z('2026-10-12T21:58:00Z')), false);
  assert.equal(estDisponible(tard, z('2026-10-12T22:05:00Z')), true);
});

test('estDisponible : autour du passage à l\'heure d\'hiver (25 oct. 2026)', () => {
  const now = z('2026-10-24T22:30:00Z');   // 25 oct., 00:30 (heure d'été)
  const tardLe25 = { s: 4, d: 5, last: now - 4 * JOUR, due: z('2026-10-25T22:30:00Z'), reps: 1, lapses: 0 }; // 23:30 (hiver)
  const le26 = { s: 4, d: 5, last: now - 4 * JOUR, due: z('2026-10-25T23:30:00Z'), reps: 1, lapses: 0 };     // 26 oct., 00:30
  assert.equal(estDisponible(tardLe25, now), true);
  assert.equal(estDisponible(le26, now), false);
  assert.equal(estDisponible(le26, z('2026-10-25T22:59:59Z')), false);   // 23:59:59 le 25
  assert.equal(estDisponible(le26, z('2026-10-25T23:00:00Z')), true);    // 00:00 le 26
});

test('estDisponible : autour du passage à l\'heure d\'été (29 mars 2026)', () => {
  const now = z('2026-03-28T23:30:00Z');   // 29 mars, 00:30 (heure d'hiver)
  const tardLe29 = { s: 4, d: 5, last: now - 4 * JOUR, due: z('2026-03-29T21:30:00Z'), reps: 1, lapses: 0 }; // 23:30 (été)
  const le30 = { s: 4, d: 5, last: now - 4 * JOUR, due: z('2026-03-29T22:30:00Z'), reps: 1, lapses: 0 };     // 30 mars, 00:30
  assert.equal(estDisponible(tardLe29, now), true);
  assert.equal(estDisponible(le30, now), false);
  assert.equal(estDisponible(le30, z('2026-03-29T22:00:00Z')), true);
});

test('estAcquise : dernière réponse du jour juste ou partielle', () => {
  const jour = '2026-10-12';
  assert.equal(estAcquise(review(null, 3, T), jour), true);    // juste
  assert.equal(estAcquise(review(null, 2, T), jour), true);    // partiel
  assert.equal(estAcquise(review(null, 1, T), jour), false);   // faux : revient dans 10 min
  assert.equal(estAcquise(null, jour), false);
  // faux puis juste le même jour : acquise ; juste puis faux : plus acquise
  assert.equal(estAcquise(review(review(null, 1, T), 3, T + 15 * MIN), jour), true);
  assert.equal(estAcquise(review(review(null, 3, T), 1, T + HEURE), jour), false);
});

test('estAcquise : hier ne compte pas aujourd\'hui (minuit à Paris)', () => {
  const hier = review(null, 3, T - JOUR);
  assert.equal(estAcquise(hier, '2026-10-12'), false);
  assert.equal(estAcquise(hier, '2026-10-11'), true);
  assert.equal(estAcquise(review(null, 3, z('2026-10-12T21:59:00Z')), '2026-10-12'), true);   // 23:59
  assert.equal(estAcquise(review(null, 3, z('2026-10-12T22:01:00Z')), '2026-10-12'), false);  // 00:01 le 13
});

test('delaiTexte : phrases courtes', () => {
  assert.equal(delaiTexte(null, T), '');
  const ratee = review(null, 1, T);
  assert.equal(delaiTexte(ratee, T), 'revient dans 10 min');
  assert.equal(delaiTexte(ratee, T + 6 * MIN), 'revient dans 4 min');
  assert.equal(delaiTexte(ratee, T + 11 * MIN), 'revient dans 1 min');
  assert.equal(delaiTexte(review(null, 2, T), T), 'revient demain');
  assert.equal(delaiTexte(review(null, 3, T), T), 'revient dans 4 jours');
  assert.equal(delaiTexte(review(null, 4, T), T), 'revient dans 14 jours');
  const dans = j => ({ s: j, d: 5, last: T, due: T + j * JOUR, reps: 3, lapses: 0 });
  assert.equal(delaiTexte(dans(29), T), 'revient dans 29 jours');
  assert.equal(delaiTexte(dans(60), T), 'revient dans 2 mois');
  assert.equal(delaiTexte(dans(365), T), 'revient dans un an');
});
