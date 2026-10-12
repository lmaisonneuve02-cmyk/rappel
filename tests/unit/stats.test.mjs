// Suivi : contestations appliquées, chiffres par jour, par UE, contestations par semaine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parJour, parUE, contestationsParSemaine, lignesEffectives } from '../../js/stats.js';
import { acquisesDuJour } from '../../js/seance.js';
import { review } from '../../js/fsrs.js';
import { MIN, HEURE, JOUR, isoParis } from '../../js/temps.js';

const z = s => Date.parse(s);
const T = z('2026-10-12T10:00:00Z');   // lundi 12 oct. 2026, 12:00 à Paris

let compteur = 0;
const ligne = (carte, ts, extra = {}) => ({
  id: `test-${ts}-${compteur++}`, ts, t: isoParis(ts), appareil: 'test', paquet: 'p1', carte,
  reponse: '…', verdict: 'juste', correcteur: 'local', note: 3, nouvelle: false, ...extra,
});
const contestation = (visee, ts, verdict = 'juste', extra = {}) => ({
  ...ligne(visee.carte, ts, { paquet: visee.paquet, nouvelle: visee.nouvelle }),
  correcteur: 'contestation', remplace: visee.id, verdict, note: { juste: 3, partiel: 2, faux: 1 }[verdict], ...extra,
});
const tentative = (ts, points, extra = {}) => ({
  id: `qcm-${ts}-${compteur++}`, ts, t: isoParis(ts), appareil: 'test', qcm: 'q1', cours: 'p1', ue: 'ue1',
  cochees: ['A'], points, discordances: 0, duree: 20000, ...extra,
});

function donneesDe({ reponses = [], qcmJournal = [], srs = {}, historique = { days: {} }, plan = null, paquets = {}, aRevoir = { cas: [] } } = {}) {
  return {
    plan, paquets, ordre: Object.keys(paquets), fiches: {}, qcm: {}, srs, reponses, qcmJournal,
    carnet: { abreviations: {}, cartes: {} }, aRevoir, reglages: { nouvellesParJour: 15, objectifJour: 30 },
    exceptions: { jours: {} }, historique, cartes: {},
  };
}

// --- lignesEffectives ---

test('lignesEffectives : sans contestation, lignes triées et sans doublon', () => {
  const a = ligne('a', T + MIN), b = ligne('b', T), c = ligne('c', T + 2 * MIN);
  const entree = [a, b, c, a];
  const copie = structuredClone(entree);
  assert.deepStrictEqual(lignesEffectives(entree), [b, a, c]);
  assert.deepStrictEqual(entree, copie);
  assert.deepStrictEqual(lignesEffectives([]), []);
  assert.deepStrictEqual(lignesEffectives(undefined), []);
});

test('lignesEffectives : une contestation acceptée remplace le verdict de la ligne visée', () => {
  const l1 = ligne('a', T, { verdict: 'faux', note: 1, nouvelle: true, duree: 9000 });
  const autre = ligne('b', T + MIN);
  const c1 = contestation(l1, T + 2 * MIN, 'juste');
  const r = lignesEffectives([l1, autre, c1]);
  assert.equal(r.length, 2);
  assert.deepStrictEqual(r[0], { ...l1, verdict: 'juste', note: 3, contestation: c1.id });
  assert.equal(r[0].ts, l1.ts);          // la réponse garde son heure
  assert.equal(r[0].nouvelle, true);
  assert.deepStrictEqual(r[1], autre);
});

test('lignesEffectives : note absente, contestations successives, contestation orpheline', () => {
  const l1 = ligne('a', T, { verdict: 'faux', note: 1 });
  const sansNote = contestation(l1, T + MIN, 'partiel', { note: undefined });
  assert.equal(lignesEffectives([l1, sansNote])[0].note, 2);

  // deux contestations de la même ligne : la plus récente gagne
  const c1 = contestation(l1, T + MIN, 'partiel'), c2 = contestation(l1, T + 2 * MIN, 'juste');
  assert.deepEqual(lignesEffectives([c2, l1, c1]).map(l => [l.id, l.verdict]), [[l1.id, 'juste']]);

  // contestation d'une contestation : on remonte à la réponse d'origine
  const cc = contestation(c1, T + 3 * MIN, 'faux');
  assert.deepEqual(lignesEffectives([l1, c1, cc]).map(l => [l.id, l.verdict, l.note]), [[l1.id, 'faux', 1]]);

  // ligne visée introuvable : la contestation reste la seule trace de la réponse
  const orpheline = contestation({ id: 'ailleurs', carte: 'z', paquet: 'p1', nouvelle: false }, T, 'juste');
  assert.deepStrictEqual(lignesEffectives([orpheline]), [orpheline]);
  const suite = contestation(orpheline, T + MIN, 'faux');
  assert.deepEqual(lignesEffectives([orpheline, suite]).map(l => [l.id, l.verdict]), [[orpheline.id, 'faux']]);
});

// --- parJour ---

function journalType() {
  const hier = T - JOUR;
  const b2 = ligne('b2', hier + 2 * MIN, { verdict: 'faux', note: 1 });
  const reponses = [
    // aujourd'hui
    ligne('a1', T - 3 * HEURE, { verdict: 'faux', note: 1, nouvelle: true }),
    ligne('a1', T - 3 * HEURE + 15 * MIN),
    ligne('a2', T - 2 * HEURE, { nouvelle: true }),
    ligne('a3', T - HEURE, { verdict: 'partiel', note: 2 }),
    ligne('a4', z('2026-10-11T22:01:00Z'), { verdict: 'faux', note: 1 }),   // 00:01 le 12
    // hier
    ligne('b1', hier + MIN),
    b2,
    ligne('b3', hier + 3 * MIN, { verdict: 'partiel', note: 2, nouvelle: true }),
    ligne('b3', hier + 4 * MIN, { verdict: 'faux', note: 1 }),              // dernière réponse fausse
    ligne('b4', hier + 5 * MIN, { verdict: 'faux', note: 1 }),
    ligne('b4', hier + 6 * MIN),                                            // dernière réponse juste
    ligne('b5', z('2026-10-11T21:59:00Z'), { verdict: 'partiel', note: 2 }), // 23:59 le 11
  ];
  const srs = {
    p1: {
      a1: review(review(null, 1, T - 3 * HEURE), 3, T - 3 * HEURE + 15 * MIN),
      a2: review(null, 3, T - 2 * HEURE),
      a3: review(review(null, 3, T - 5 * JOUR), 2, T - HEURE),
      a4: review(review(null, 3, T - 5 * JOUR), 1, z('2026-10-11T22:01:00Z')),
      v1: review(null, 3, T - 4 * HEURE),   // répondue dans v1 ce matin : pas de ligne
    },
  };
  return { reponses, srs, b2 };
}

test('parJour : aujourd\'hui, hier (journal), jour de v1, jour vide', () => {
  const { reponses, srs } = journalType();
  const d = donneesDe({
    reponses, srs,
    qcmJournal: [tentative(T - HEURE, 1), tentative(T - 30 * MIN, 0.2), tentative(T - JOUR, 0.5)],
    historique: { source: 'v1', days: { '2026-10-10': { n: 82, judged: 72, right: 19, nw: 0 }, '2026-10-11': { n: 5, judged: 5, right: 5, nw: 5 } } },
  });
  const r = parJour(d, T, 4);
  assert.deepStrictEqual(r, [
    { jour: '2026-10-12', acquises: 4, reponses: 5, justes: 2, nouvelles: 2, qcm: 2, pointsQcm: 1.2 },
    { jour: '2026-10-11', acquises: 3, reponses: 7, justes: 2, nouvelles: 1, qcm: 1, pointsQcm: 0.5 },
    { jour: '2026-10-10', acquises: null, reponses: 82, justes: 19, nouvelles: 0, qcm: 0, pointsQcm: 0 },
    { jour: '2026-10-09', acquises: 0, reponses: 0, justes: 0, nouvelles: 0, qcm: 0, pointsQcm: 0 },
  ]);
  assert.equal(r[0].acquises, acquisesDuJour(d, T));   // aujourd'hui : la règle de déblocage
});

test('parJour : une contestation acceptée (faux → juste) change les acquises d\'un jour passé', () => {
  const { reponses, srs, b2 } = journalType();
  const avant = parJour(donneesDe({ reponses, srs }), T, 2)[1];
  assert.deepEqual([avant.acquises, avant.justes, avant.reponses], [3, 2, 7]);
  const apres = parJour(donneesDe({ reponses: [...reponses, contestation(b2, T - JOUR + 10 * MIN, 'juste')], srs }), T, 2)[1];
  assert.deepEqual([apres.acquises, apres.justes, apres.reponses, apres.nouvelles], [4, 3, 7, 1]);
  // contestation vers « partiel » : acquise aussi, mais pas juste
  const partiel = parJour(donneesDe({ reponses: [...reponses, contestation(b2, T - JOUR + 10 * MIN, 'partiel')], srs }), T, 2)[1];
  assert.deepEqual([partiel.acquises, partiel.justes], [4, 2]);
});

test('parJour : 14 jours par défaut, du plus récent au plus ancien, sans historique', () => {
  const r = parJour(donneesDe({ historique: undefined }), T);
  assert.equal(r.length, 14);
  assert.equal(r[0].jour, '2026-10-12');
  assert.equal(r[13].jour, '2026-09-29');
  for (const j of r) assert.deepEqual([j.acquises, j.reponses, j.qcm], [0, 0, 0]);
  const sansRien = { srs: {}, reponses: [], qcmJournal: [], historique: null };
  assert.equal(parJour(sansRien, T, 3).length, 3);
  assert.deepEqual(parJour(donneesDe(), T, 0), []);
});

test('parJour : jours de v1 avec historique incomplet', () => {
  const d = donneesDe({ historique: { days: { '2026-10-11': { judged: 3 } } } });
  assert.deepStrictEqual(parJour(d, T, 2)[1], { jour: '2026-10-11', acquises: null, reponses: 0, justes: 0, nouvelles: 0, qcm: 0, pointsQcm: 0 });
});

test('parJour : jours de 25 h et 23 h', () => {
  const lundi = z('2026-10-26T11:00:00Z');   // 26 oct., 12:00 (heure d'hiver)
  const reponses = [
    ligne('x', z('2026-10-24T21:30:00Z')),   // 24 oct., 23:30
    ligne('y', z('2026-10-24T22:30:00Z')),   // 25 oct., 00:30
    ligne('z', z('2026-10-25T01:30:00Z')),   // 25 oct., 02:30 (heure répétée)
    ligne('w', z('2026-10-25T22:30:00Z')),   // 25 oct., 23:30
    ligne('v', z('2026-10-25T23:30:00Z')),   // 26 oct., 00:30
  ];
  const r = parJour(donneesDe({ reponses }), lundi, 3);
  assert.deepEqual(r.map(j => [j.jour, j.reponses]), [['2026-10-26', 1], ['2026-10-25', 3], ['2026-10-24', 1]]);
  const printemps = [ligne('a', z('2026-03-28T22:30:00Z')), ligne('b', z('2026-03-28T23:30:00Z')), ligne('c', z('2026-03-29T21:30:00Z')), ligne('d', z('2026-03-29T22:30:00Z'))];
  const r2 = parJour(donneesDe({ reponses: printemps }), z('2026-03-30T10:00:00Z'), 3);
  assert.deepEqual(r2.map(j => [j.jour, j.reponses]), [['2026-03-30', 1], ['2026-03-29', 2], ['2026-03-28', 1]]);
});

// --- parUE ---

function donneesUE() {
  const carte = id => ({ id, type: 'fait', q: '?', a: '!' });
  const paquets = {
    'cv-cm06': { id: 'cv-cm06', nom: 'CV 6', ue: 'cv', ordre: 1, cartes: [carte('a1'), carte('a2'), carte('a3')] },
    'cv-extra': { id: 'cv-extra', nom: 'CV +', ue: 'cv', ordre: 2, cartes: [carte('e1')] },
    'sem-cardio': { id: 'sem-cardio', nom: 'Sémio', ue: 'semio', ordre: 3, cartes: [carte('s1'), carte('s2')] },
  };
  const plan = {
    semestre: 'S5', ues: [
      { id: 'cv', nom: 'Cardio-vasculaire', cours: [
        { id: 'cv-cm06', titre: 'Artères', paquet: 'cv-cm06', fiche: 'cv-cm06' },
        { id: 'cv-cm07', titre: 'Veines', paquet: 'cv-cm07' },        // paquet pas encore écrit
        { id: 'cv-cm08', titre: 'Cœur', paquet: null },
      ] },
      { id: 'resp', nom: 'Respiratoire', cours: [] },
    ],
  };
  const etat = review(null, 3, T - 3 * JOUR);
  const srs = { 'cv-cm06': { a1: etat, a2: etat, fantome: etat }, 'sem-cardio': { s2: etat } };
  const faux = ligne('a2', T - 2 * HEURE, { paquet: 'cv-cm06', verdict: 'faux', note: 1 });
  const reponses = [
    ligne('a1', T - HEURE, { paquet: 'cv-cm06' }),
    ligne('a1', T - 2 * JOUR, { paquet: 'cv-cm06', verdict: 'partiel', note: 2 }),
    ligne('a3', z('2026-10-05T23:00:00Z'), { paquet: 'cv-cm06', verdict: 'faux', note: 1 }),   // 6 oct., 01:00 : compte
    faux,
    contestation(faux, T - 2 * HEURE + MIN, 'juste'),                                          // faux → juste
    ligne('a2', T - 3 * HEURE, { paquet: 'cv-cm06', verdict: 'faux', note: 1, nouvelle: true }), // nouvelle : hors rétention
    ligne('a3', z('2026-10-05T21:00:00Z'), { paquet: 'cv-cm06', verdict: 'faux', note: 1 }),   // 5 oct. : trop ancien
    ligne('a3', T + HEURE, { paquet: 'cv-cm06', verdict: 'faux', note: 1 }),                    // après maintenant
    ligne('s2', T - HEURE, { paquet: 'sem-cardio', verdict: 'faux', note: 1 }),
  ];
  const qcmJournal = [
    tentative(T - JOUR, 1, { ue: 'cv', cours: 'cv-cm06' }),
    tentative(T - 2 * JOUR, 0.5, { ue: 'cv', cours: 'cv-cm06' }),
    tentative(T - 20 * JOUR, 0.2, { ue: undefined, cours: 'cv-cm06' }),   // UE retrouvée par le cours
    tentative(T - JOUR, 0, { ue: 'semio', cours: 'sem-cardio' }),
  ];
  return { paquets, plan, srs, reponses, qcmJournal };
}

test('parUE : couverture du plan, cartes vues, rétention sur 7 jours, moyenne aux QCM', () => {
  const d = donneesDe(donneesUE());
  assert.deepStrictEqual(parUE(d, T), [
    { ue: 'cv', nom: 'Cardio-vasculaire', coursTotal: 3, coursEnCartes: 1, cartes: 4, cartesVues: 2, retention7j: 0.75, moyenneQcm: 0.567 },
    { ue: 'resp', nom: 'Respiratoire', coursTotal: 0, coursEnCartes: 0, cartes: 0, cartesVues: 0, retention7j: null, moyenneQcm: null },
    { ue: 'semio', nom: 'semio', coursTotal: 1, coursEnCartes: 1, cartes: 2, cartesVues: 1, retention7j: 0, moyenneQcm: 0 },
  ]);
});

test('parUE : sans contestation, la rétention baisse', () => {
  const brut = donneesUE();
  brut.reponses = brut.reponses.filter(l => l.correcteur !== 'contestation');
  assert.equal(parUE(donneesDe(brut), T)[0].retention7j, 0.5);
});

test('parUE : sans plan, une UE par champ « ue » des paquets', () => {
  const brut = donneesUE();
  brut.plan = null;
  brut.paquets.divers = { id: 'divers', nom: 'Divers', cartes: [{ id: 'x1' }] };   // sans UE
  const r = parUE(donneesDe(brut), T);
  assert.deepEqual(r.map(u => [u.ue, u.nom, u.coursTotal, u.coursEnCartes, u.cartes, u.cartesVues]), [
    ['autre', 'autre', 1, 1, 1, 0],
    ['cv', 'cv', 2, 2, 4, 2],
    ['semio', 'semio', 1, 1, 2, 1],
  ]);
  assert.equal(r[1].retention7j, 0.75);
});

test('parUE : données vides', () => {
  assert.deepStrictEqual(parUE(donneesDe(), T), []);
  assert.deepStrictEqual(parUE({}, T), []);
  const planSeul = donneesDe({ plan: { ues: [{ id: 'cv', nom: 'CV', cours: [{ id: 'c1', paquet: 'c1' }] }] } });
  assert.deepStrictEqual(parUE(planSeul, T), [
    { ue: 'cv', nom: 'CV', coursTotal: 1, coursEnCartes: 0, cartes: 0, cartesVues: 0, retention7j: null, moyenneQcm: null },
  ]);
});

// --- contestationsParSemaine ---

test('contestationsParSemaine : semaines ISO à l\'heure de Paris', () => {
  const l1 = ligne('a', T, { verdict: 'faux', note: 1 });
  const d = donneesDe({
    reponses: [
      l1, ligne('b', T + MIN), ligne('c', T + 2 * MIN),
      contestation(l1, T + 3 * MIN, 'juste'),
      ligne('d', z('2026-10-11T21:30:00Z')),   // dimanche 11, 23:30 : semaine 41
      ligne('e', z('2026-10-11T22:30:00Z')),   // lundi 12, 00:30 (encore dimanche en UTC) : semaine 42
      ligne('f', z('2026-10-05T08:00:00Z')),
    ],
    aRevoir: {
      cas: [
        { id: 'x-1', ts: T + 4 * MIN, type: 'contestation', paquet: 'p1', carte: 'b', issue: 'refuse' },
        { id: 'x-2', ts: T + 3 * MIN, type: 'contestation', paquet: 'p1', carte: 'a', issue: 'accepte' },   // déjà dans le journal
        { id: 'x-3', ts: z('2026-10-06T08:00:00Z'), type: 'contestation', paquet: 'p1', carte: 'f' },      // en attente
        { id: 'x-4', ts: T, type: 'incertain', paquet: 'p1', carte: 'c' },
      ],
    },
  });
  assert.deepStrictEqual(contestationsParSemaine(d), [
    { semaine: '2026-S42', contestations: 2, acceptees: 1, reponses: 4 },
    { semaine: '2026-S41', contestations: 1, acceptees: 0, reponses: 2 },
  ]);
});

test('contestationsParSemaine : passage d\'année (semaine 53 de 2026)', () => {
  const d = donneesDe({
    reponses: [
      ligne('a', z('2026-12-31T12:00:00Z')),   // jeudi 31 déc. : 2026-S53
      ligne('b', z('2027-01-03T12:00:00Z')),   // dimanche 3 janv. : encore 2026-S53
      ligne('c', z('2027-01-03T23:30:00Z')),   // lundi 4 janv., 00:30 à Paris : 2027-S01
      ligne('d', z('2025-12-29T12:00:00Z')),   // lundi 29 déc. 2025 : 2026-S01
    ],
  });
  assert.deepStrictEqual(contestationsParSemaine(d), [
    { semaine: '2027-S01', contestations: 0, acceptees: 0, reponses: 1 },
    { semaine: '2026-S53', contestations: 0, acceptees: 0, reponses: 2 },
    { semaine: '2026-S01', contestations: 0, acceptees: 0, reponses: 1 },
  ]);
});

test('contestationsParSemaine : rien du tout', () => {
  assert.deepStrictEqual(contestationsParSemaine(donneesDe()), []);
  assert.deepStrictEqual(contestationsParSemaine({}), []);
});
