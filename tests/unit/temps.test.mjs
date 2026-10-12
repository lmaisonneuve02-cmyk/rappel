// Heure de Paris : jours, mois, changements d'heure (29 mars et 25 oct. 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  MIN, HEURE, JOUR, jourParis, moisParis, debutJourParis, finJourParis, decalerJour, isoParis, heureParis,
} from '../../js/temps.js';

const z = s => Date.parse(s);

test('constantes de durée', () => {
  assert.equal(MIN, 60_000);
  assert.equal(HEURE, 3_600_000);
  assert.equal(JOUR, 86_400_000);
});

test('jourParis : le jour change à minuit à Paris, été comme hiver', () => {
  assert.equal(jourParis(z('2026-10-12T21:59:59.999Z')), '2026-10-12');
  assert.equal(jourParis(z('2026-10-12T22:00:00Z')), '2026-10-13');
  assert.equal(jourParis(z('2026-12-14T22:59:59Z')), '2026-12-14');
  assert.equal(jourParis(z('2026-12-14T23:00:00Z')), '2026-12-15');
});

test('jourParis : nuits des changements d\'heure', () => {
  assert.equal(jourParis(z('2026-03-28T22:59:59Z')), '2026-03-28');
  assert.equal(jourParis(z('2026-03-28T23:00:00Z')), '2026-03-29');
  assert.equal(jourParis(z('2026-03-29T21:59:59Z')), '2026-03-29');
  assert.equal(jourParis(z('2026-03-29T22:00:00Z')), '2026-03-30');
  assert.equal(jourParis(z('2026-10-24T21:59:59Z')), '2026-10-24');
  assert.equal(jourParis(z('2026-10-24T22:00:00Z')), '2026-10-25');
  assert.equal(jourParis(z('2026-10-25T22:59:59Z')), '2026-10-25');
  assert.equal(jourParis(z('2026-10-25T23:00:00Z')), '2026-10-26');
});

test('moisParis : fin de mois et fin d\'année à Paris', () => {
  assert.equal(moisParis(z('2026-09-30T21:59:59Z')), '2026-09');
  assert.equal(moisParis(z('2026-09-30T22:00:00Z')), '2026-10');
  assert.equal(moisParis(z('2026-10-31T22:59:59Z')), '2026-10');
  assert.equal(moisParis(z('2026-10-31T23:00:00Z')), '2026-11');
  assert.equal(moisParis(z('2026-12-31T22:59:59Z')), '2026-12');
  assert.equal(moisParis(z('2026-12-31T23:00:00Z')), '2027-01');
});

test('debutJourParis et finJourParis : jour ordinaire de 24 h', () => {
  const debut = z('2026-10-11T22:00:00Z'), fin = z('2026-10-12T22:00:00Z');
  for (const t of [debut, z('2026-10-12T10:00:00Z'), fin - 1]) {
    assert.equal(debutJourParis(t), debut);
    assert.equal(finJourParis(t), fin);
  }
  assert.equal(finJourParis(fin), z('2026-10-13T22:00:00Z'));
  assert.equal(fin - debut, 24 * HEURE);
});

test('29 mars 2026 : jour de 23 h', () => {
  const debut = z('2026-03-28T23:00:00Z'), fin = z('2026-03-29T22:00:00Z');
  // 00:00, 01:59:59 (heure d'hiver), 03:00 (heure d'été), 23:59:59
  for (const t of [debut, z('2026-03-29T00:59:59Z'), z('2026-03-29T01:00:00Z'), fin - 1]) {
    assert.equal(debutJourParis(t), debut);
    assert.equal(finJourParis(t), fin);
  }
  assert.equal(fin - debut, 23 * HEURE);
  assert.equal(finJourParis(debut - 1) - debutJourParis(debut - 1), 24 * HEURE);
  assert.equal(finJourParis(fin) - debutJourParis(fin), 24 * HEURE);
});

test('25 oct. 2026 : jour de 25 h', () => {
  const debut = z('2026-10-24T22:00:00Z'), fin = z('2026-10-25T23:00:00Z');
  // 00:00, 02:30 (été), 02:30 (hiver, l'heure répétée), 23:59:59
  for (const t of [debut, z('2026-10-25T00:30:00Z'), z('2026-10-25T01:30:00Z'), fin - 1]) {
    assert.equal(debutJourParis(t), debut);
    assert.equal(finJourParis(t), fin);
  }
  assert.equal(fin - debut, 25 * HEURE);
  assert.equal(finJourParis(debut - 1) - debutJourParis(debut - 1), 24 * HEURE);
  assert.equal(finJourParis(fin) - debutJourParis(fin), 24 * HEURE);
});

test('finJourParis : chaque jour de l\'année s\'enchaîne sans trou', () => {
  let t = z('2026-01-01T12:00:00Z');
  let longs = 0, courts = 0;
  for (let k = 0; k < 365; k++) {
    const debut = debutJourParis(t), fin = finJourParis(t);
    assert.equal(jourParis(debut), jourParis(t));
    assert.equal(jourParis(fin - 1), jourParis(t));
    assert.notEqual(jourParis(fin), jourParis(t));
    assert.equal(debutJourParis(fin), fin);
    if (fin - debut === 25 * HEURE) longs++;
    else if (fin - debut === 23 * HEURE) courts++;
    else assert.equal(fin - debut, 24 * HEURE);
    t = fin + 12 * HEURE;
  }
  assert.equal(longs, 1);
  assert.equal(courts, 1);
});

test('decalerJour : jours calendaires', () => {
  assert.equal(decalerJour('2026-10-12', 0), '2026-10-12');
  assert.equal(decalerJour('2026-10-12', 1), '2026-10-13');
  assert.equal(decalerJour('2026-10-12', -12), '2026-09-30');
  assert.equal(decalerJour('2026-12-31', 1), '2027-01-01');
  assert.equal(decalerJour('2027-01-01', -1), '2026-12-31');
  assert.equal(decalerJour('2028-02-28', 1), '2028-02-29');
  assert.equal(decalerJour('2027-02-28', 1), '2027-03-01');
  assert.equal(decalerJour('2026-10-24', 1), '2026-10-25');
  assert.equal(decalerJour('2026-10-25', 1), '2026-10-26');
  assert.equal(decalerJour('2026-03-30', -1), '2026-03-29');
  assert.equal(decalerJour('2026-10-12', 365), '2027-10-12');
  assert.equal(decalerJour('2026-10-12', -13), '2026-09-29');
});

test('isoParis : décalage +02:00 l\'été, +01:00 l\'hiver', () => {
  assert.equal(isoParis(z('2026-10-12T12:03:11Z')), '2026-10-12T14:03:11+02:00');
  assert.equal(isoParis(z('2026-10-12T12:03:11.999Z')), '2026-10-12T14:03:11+02:00');
  assert.equal(isoParis(z('2026-12-14T08:00:00Z')), '2026-12-14T09:00:00+01:00');
  assert.equal(isoParis(z('2026-10-12T22:00:00Z')), '2026-10-13T00:00:00+02:00');
});

test('isoParis : autour des changements d\'heure', () => {
  assert.equal(isoParis(z('2026-10-25T00:59:59Z')), '2026-10-25T02:59:59+02:00');
  assert.equal(isoParis(z('2026-10-25T01:00:00Z')), '2026-10-25T02:00:00+01:00');
  assert.equal(isoParis(z('2026-03-29T00:59:59Z')), '2026-03-29T01:59:59+01:00');
  assert.equal(isoParis(z('2026-03-29T01:00:00Z')), '2026-03-29T03:00:00+02:00');
});

test('isoParis : se relit en le même instant (à la seconde)', () => {
  for (let t = z('2026-01-01T00:00:00Z'); t < z('2027-01-01T00:00:00Z'); t += 7 * HEURE + 1234) {
    assert.equal(Date.parse(isoParis(t)), Math.floor(t / 1000) * 1000);
  }
});

test('heureParis', () => {
  assert.equal(heureParis(z('2026-10-12T12:03:59Z')), '14:03');
  assert.equal(heureParis(z('2026-10-12T22:00:00Z')), '00:00');
  assert.equal(heureParis(z('2026-12-14T23:59:00Z')), '00:59');
});

test('le fuseau de l\'appareil ne change rien', () => {
  const url = new URL('../../js/temps.js', import.meta.url).href;
  const code = `import('${url}').then(m => console.log(JSON.stringify([
    m.jourParis(Date.parse('2026-10-25T22:30:00Z')), m.finJourParis(Date.parse('2026-10-25T12:00:00Z')),
    m.isoParis(Date.parse('2026-03-29T01:00:00Z'))])))`;
  for (const TZ of ['America/New_York', 'Pacific/Auckland', 'UTC']) {
    const sortie = execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(sortie), ['2026-10-25', z('2026-10-25T23:00:00Z'), '2026-03-29T03:00:00+02:00'], TZ);
  }
});
