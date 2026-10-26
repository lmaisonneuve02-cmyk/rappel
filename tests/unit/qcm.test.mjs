// QCM : barème par discordances, échéances 2 j / 7 j, QCM proposables, choix d'une série, journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scorer, etatQcm, qcmProposables, coursVus, choisirQcm, ligneQcm, melangerPropositions } from '../../js/qcm.js';
import { MIN, HEURE, JOUR, isoParis } from '../../js/temps.js';

const z = s => Date.parse(s);
const T = z('2026-10-12T10:00:00Z');   // lundi 12 oct. 2026, 12:00 à Paris

const qcm = (id, vrais, extra = {}) => ({
  id, ue: 'ue1', cours: 'p1', source: 'claude', statut: 'valide', maj: 0, enonce: `Énoncé ${id}`,
  propositions: ['A', 'B', 'C', 'D', 'E'].map(l => ({ l, t: `Proposition ${l}`, vrai: vrais.includes(l), expl: 'Parce que.' })),
  verifie: true, cartes: [], ...extra,
});
const tentative = (q, ts, points) => ({ id: `test-${ts}`, ts, t: isoParis(ts), appareil: 'test', qcm: q, cours: 'p1', ue: 'ue1', cochees: [], points, discordances: points === 1 ? 0 : 1, duree: 30000 });

function graine(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// --- scorer ---

test('scorer : 0 discordance = 1 point, 1 = 0,5, 2 = 0,2, 3 ou plus = 0', () => {
  const q = qcm('q', ['A', 'C']);
  const r = scorer(q, ['A', 'C']);
  assert.deepStrictEqual(r, {
    points: 1, discordances: 0,
    detail: [
      { l: 'A', vrai: true, cochee: true, ok: true }, { l: 'B', vrai: false, cochee: false, ok: true },
      { l: 'C', vrai: true, cochee: true, ok: true }, { l: 'D', vrai: false, cochee: false, ok: true },
      { l: 'E', vrai: false, cochee: false, ok: true },
    ],
  });
  assert.deepEqual([scorer(q, ['A']).points, scorer(q, ['A']).discordances], [0.5, 1]);            // oubli
  assert.deepEqual([scorer(q, ['A', 'C', 'D']).points, scorer(q, ['A', 'C', 'D']).discordances], [0.5, 1]); // en trop
  assert.deepEqual([scorer(q, ['A', 'B']).points, scorer(q, ['A', 'B']).discordances], [0.2, 2]);
  assert.deepEqual([scorer(q, ['B', 'D']).points, scorer(q, ['B', 'D']).discordances], [0, 4]);
  assert.deepEqual([scorer(q, ['B', 'D', 'E']).points, scorer(q, ['B', 'D', 'E']).discordances], [0, 5]);
  assert.deepEqual([scorer(q, ['C', 'D', 'E']).points, scorer(q, ['C', 'D', 'E']).discordances], [0, 3]);
});

test('scorer : rien coché, ordre, minuscules et doublons', () => {
  const q = qcm('q', ['A', 'C']);
  assert.deepEqual([scorer(q, []).points, scorer(q, []).discordances], [0.2, 2]);
  assert.deepEqual([scorer(q, undefined).points, scorer(q, undefined).discordances], [0.2, 2]);
  assert.equal(scorer(q, ['C', 'A']).points, 1);
  assert.equal(scorer(q, ['a', ' c ']).points, 1);
  assert.equal(scorer(q, ['A', 'A', 'C']).points, 1);
  const r = scorer(q, ['b']);
  assert.deepEqual(r.detail.find(d => d.l === 'B'), { l: 'B', vrai: false, cochee: true, ok: false });
});

test('scorer : barème des réglages', () => {
  const q = qcm('q', ['B']);
  assert.equal(scorer(q, ['A', 'B'], [1, 0]).points, 0);
  assert.equal(scorer(q, ['B'], [1, 0]).points, 1);
  assert.equal(scorer(q, ['A', 'B'], [1, 0.6, 0.3, 0.1, 0]).points, 0.6);
  assert.equal(scorer(q, ['A', 'B', 'C', 'D'], [1, 0.6, 0.3, 0.1, 0]).points, 0.1);
  assert.equal(scorer(q, ['A', 'B'], []).points, 0.5);        // barème vide → barème par défaut
  assert.equal(scorer(q, ['A', 'B'], null).points, 0.5);
});

// --- etatQcm ---

test('etatQcm : jamais fait', () => {
  assert.deepStrictEqual(etatQcm('q1', []), { tentatives: 0, derniere: null, etape: 0, due: null });
  assert.deepStrictEqual(etatQcm('q1', undefined), { tentatives: 0, derniere: null, etape: 0, due: null });
  assert.deepStrictEqual(etatQcm('q1', [tentative('q2', T, 0)]), { tentatives: 0, derniere: null, etape: 0, due: null });
});

test('etatQcm : réussi d\'emblée → fini', () => {
  const l = tentative('q1', T, 1);
  assert.deepStrictEqual(etatQcm('q1', [l]), { tentatives: 1, derniere: l, etape: 'fini', due: null });
});

test('etatQcm : raté → +2 j, réussi → +7 j, réussi → fini', () => {
  const l1 = tentative('q1', T, 0.5);
  assert.deepEqual(etatQcm('q1', [l1]), { tentatives: 1, derniere: l1, etape: 1, due: T + 2 * JOUR });
  const l2 = tentative('q1', T + 2 * JOUR, 1);
  assert.deepEqual(etatQcm('q1', [l1, l2]), { tentatives: 2, derniere: l2, etape: 2, due: T + 9 * JOUR });
  const l3 = tentative('q1', T + 9 * JOUR, 1);
  assert.deepEqual(etatQcm('q1', [l1, l2, l3]), { tentatives: 3, derniere: l3, etape: 'fini', due: null });
  const l4 = tentative('q1', T + 30 * JOUR, 1);
  assert.equal(etatQcm('q1', [l1, l2, l3, l4]).etape, 'fini');
});

test('etatQcm : raté à n\'importe quelle étape → étape 1', () => {
  const l1 = tentative('q1', T, 0.2), l2 = tentative('q1', T + 2 * JOUR, 1), l3 = tentative('q1', T + 9 * JOUR, 0);
  assert.deepEqual(etatQcm('q1', [l1, l2, l3]), { tentatives: 3, derniere: l3, etape: 1, due: T + 11 * JOUR });
  const fini = tentative('q1', T, 1), rate = tentative('q1', T + 20 * JOUR, 0.5);
  assert.deepEqual(etatQcm('q1', [fini, rate]), { tentatives: 2, derniere: rate, etape: 1, due: T + 22 * JOUR });
  const r1 = tentative('q1', T, 0), r2 = tentative('q1', T + 2 * JOUR, 0.5);
  assert.deepEqual(etatQcm('q1', [r1, r2]), { tentatives: 2, derniere: r2, etape: 1, due: T + 4 * JOUR });
});

test('etatQcm : journal dans le désordre, autres QCM ignorés', () => {
  const l1 = tentative('q1', T, 0.5), l2 = tentative('q1', T + 2 * JOUR, 1);
  const e = etatQcm('q1', [l2, tentative('q2', T + JOUR, 0), l1]);
  assert.deepEqual(e, { tentatives: 2, derniere: l2, etape: 2, due: T + 9 * JOUR });
});

// --- QCM proposables, cours vus ---

const lot = () => [
  qcm('v', ['A']),
  qcm('b-ok', ['A'], { statut: 'brouillon', verifie: true, source: 'gemini' }),
  qcm('b-non', ['A'], { statut: 'brouillon', verifie: false, source: 'gemini' }),
  qcm('s', ['A'], { statut: 'signale' }),
  qcm('s-verifie', ['A'], { statut: 'signale', verifie: true }),
  qcm('sans-vrai', []),
];

test('qcmProposables : valides et brouillons vérifiés, jamais signalés (forme de depot.js)', () => {
  const d = { qcm: Object.fromEntries(lot().map(q => [q.id, q])) };
  assert.deepEqual(qcmProposables(d).map(q => q.id), ['v', 'b-ok']);
  assert.deepEqual(qcmProposables({}), []);
  assert.deepEqual(qcmProposables({ qcm: {} }), []);
});

test('qcmProposables : accepte aussi les fichiers par cours', () => {
  const sansCours = qcm('x', ['B']);
  delete sansCours.cours;
  delete sansCours.ue;
  const d = { qcm: { p1: { cours: 'p1', ue: 'ue1', qcm: lot() }, p2: { cours: 'p2', ue: 'ue2', qcm: [sansCours] } } };
  const r = qcmProposables(d);
  assert.deepEqual(r.map(q => q.id), ['v', 'b-ok', 'x']);
  assert.equal(r[2].cours, 'p2');
  assert.equal(r[2].ue, 'ue2');
});

test('coursVus : un cours = un paquet dont une carte a un état', () => {
  const d = {
    ordre: ['p3', 'p1', 'p2'],
    paquets: {
      p1: { id: 'p1', cartes: [{ id: 'a' }, { id: 'b' }] },
      p2: { id: 'p2', cartes: [{ id: 'c' }] },
      p3: { id: 'p3', cartes: [{ id: 'd' }] },
      p5: { id: 'p5', cartes: [{ id: 'e' }] },
    },
    srs: {
      p1: { b: { s: 1, d: 5, due: T, last: T, reps: 1, lapses: 0 } },
      p2: {},
      p3: { d: { s: 1, d: 5, due: T, last: T, reps: 1, lapses: 0 } },
      p4: { z: { s: 1, d: 5, due: T, last: T, reps: 1, lapses: 0 } },   // paquet non chargé
      p5: { autre: { s: 1, d: 5, due: T, last: T, reps: 1, lapses: 0 } },   // carte qui n'est plus dans le paquet
    },
  };
  assert.deepEqual(coursVus(d), ['p3', 'p1', 'p4']);
  assert.deepEqual(coursVus({}), []);
});

// --- choisirQcm ---

function donneesQcm() {
  const etat = { s: 1, d: 5, due: T, last: T - JOUR, reps: 1, lapses: 0 };
  const liste = [
    qcm('q1', ['A'], { cours: 'p1' }),   // raté le 10 à 20 h → dû le 12 à 20 h : dû dès minuit
    qcm('q2', ['A'], { cours: 'p1' }),   // raté ce matin → revient le 14
    qcm('q3', ['A'], { cours: 'p1' }),   // jamais fait, cours vu
    qcm('q4', ['A'], { cours: 'p3' }),   // jamais fait, cours pas encore vu
    qcm('q5', ['A'], { cours: 'p2' }),   // fini il y a 10 jours
    qcm('q6', ['A'], { cours: 'p2', statut: 'signale' }),
    qcm('q7', ['A'], { cours: 'p2', statut: 'brouillon', verifie: false }),
    qcm('q8', ['A'], { cours: 'p2' }),   // raté puis réussi il y a 8 jours → dû depuis hier
    qcm('q9', ['A'], { cours: 'p2', statut: 'brouillon', verifie: true }),   // jamais fait
  ];
  return {
    ordre: ['p1', 'p2', 'p3'],
    paquets: { p1: { id: 'p1', cartes: [{ id: 'a' }] }, p2: { id: 'p2', cartes: [{ id: 'b' }] }, p3: { id: 'p3', cartes: [{ id: 'c' }] } },
    srs: { p1: { a: etat }, p2: { b: etat } },
    qcm: Object.fromEntries(liste.map(q => [q.id, q])),
    qcmJournal: [
      tentative('q1', z('2026-10-10T18:00:00Z'), 0.5),
      tentative('q2', T - 2 * HEURE, 0),
      tentative('q5', T - 10 * JOUR, 1),
      tentative('q8', T - 10 * JOUR, 0),
      tentative('q8', T - 8 * JOUR, 1),
      tentative('q6', T - 20 * JOUR, 0),
    ],
    reglages: { qcmParSeance: 4 },
  };
}
const ids = l => l.map(q => q.id).sort();

test('choisirQcm : dus d\'abord, puis jamais faits des cours vus, puis les plus anciens', () => {
  const d = donneesQcm();
  assert.deepEqual(ids(choisirQcm(d, T, { n: 2, rnd: graine(1) })), ['q1', 'q8']);
  const trois = ids(choisirQcm(d, T, { n: 3, rnd: graine(1) }));
  assert.ok(trois.includes('q1') && trois.includes('q8'));
  assert.ok(trois.includes('q3') || trois.includes('q9'));
  assert.deepEqual(ids(choisirQcm(d, T, { n: 5, rnd: graine(2) })), ['q1', 'q3', 'q5', 'q8', 'q9']);
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, rnd: graine(3) })), ['q1', 'q2', 'q3', 'q5', 'q8', 'q9']);
});

test('choisirQcm : un QCM dû à 20 h est proposé dès minuit', () => {
  const d = donneesQcm();
  const veille = z('2026-10-11T21:59:00Z');   // le 11 à 23:59 : q1 pas encore dû
  const r = choisirQcm(d, veille, { n: 1, rnd: graine(1) });
  assert.deepEqual(ids(r), ['q8']);
  assert.ok(choisirQcm(d, z('2026-10-11T22:00:00Z'), { n: 2, rnd: graine(1) }).some(q => q.id === 'q1'));
});

test('choisirQcm : nombre par défaut, cours choisi, série mélangée', () => {
  const d = donneesQcm();
  assert.equal(choisirQcm(d, T, { rnd: graine(1) }).length, 4);              // reglages.qcmParSeance
  delete d.reglages;
  assert.equal(choisirQcm(d, T, { rnd: graine(1) }).length, 6);              // 8 par défaut, 6 disponibles
  assert.deepEqual(ids(choisirQcm(d, T, { n: 10, cours: 'p3', rnd: graine(1) })), ['q4']);   // cours choisi : même pas vu
  assert.deepEqual(ids(choisirQcm(d, T, { n: 10, cours: 'p2', rnd: graine(1) })), ['q5', 'q8', 'q9']);
  assert.deepEqual(choisirQcm(d, T, { n: 0, rnd: graine(1) }), []);
  assert.deepEqual(choisirQcm(d, T, { n: 6, rnd: graine(5) }).map(q => q.id), choisirQcm(d, T, { n: 6, rnd: graine(5) }).map(q => q.id));
  const ordres = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => choisirQcm(d, T, { n: 6, rnd: graine(s) }).map(q => q.id).join()));
  assert.ok(ordres.size > 1);
});

test('choisirQcm « a-faire » : dus et jamais faits des cours vus, jamais un QCM acquis ni en attente', () => {
  const d = donneesQcm();
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, choix: 'a-faire', rnd: graine(1) })), ['q1', 'q3', 'q8', 'q9']);
  assert.deepEqual(ids(choisirQcm(d, T, { n: 2, choix: 'a-faire', rnd: graine(1) })), ['q1', 'q8']);   // dus d'abord
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, cours: 'p2', choix: 'a-faire', rnd: graine(1) })), ['q8', 'q9']);
  // Tout fait : rien à proposer (q1 et q8 refaits et réussis, q3 et q9 réussis d'emblée).
  for (const id of ['q1', 'q3', 'q8', 'q9']) d.qcmJournal.push(tentative(id, T + MIN, 1));
  assert.deepEqual(choisirQcm(d, T + HEURE, { n: 20, choix: 'a-faire', rnd: graine(1) }), []);
  assert.equal(choisirQcm(d, T + HEURE, { n: 20, rnd: graine(1) }).length, 6);   // 'tout' : les anciens reviennent
});

test('choisirQcm « reussis » : QCM acquis seulement, les plus anciens d\'abord', () => {
  const d = donneesQcm();
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, choix: 'reussis', rnd: graine(1) })), ['q5']);   // q2 raté, q8 dû : exclus
  d.qcmJournal.push(tentative('q3', T - 3 * JOUR, 1), tentative('q9', T - HEURE, 1));
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, choix: 'reussis', rnd: graine(1) })), ['q3', 'q5', 'q9']);
  assert.deepEqual(ids(choisirQcm(d, T, { n: 2, choix: 'reussis', rnd: graine(1) })), ['q3', 'q5']);   // q9, le plus récent, attend
  assert.deepEqual(ids(choisirQcm(d, T, { n: 20, cours: 'p1', choix: 'reussis', rnd: graine(1) })), ['q3']);
  assert.deepEqual(choisirQcm({}, T, { n: 5, choix: 'reussis', rnd: graine(1) }), []);
});

test('choisirQcm : rien à proposer', () => {
  assert.deepEqual(choisirQcm({}, T, { n: 5, rnd: graine(1) }), []);
  const d = donneesQcm();
  d.srs = {};   // aucun cours vu : seuls les QCM déjà faits restent
  assert.deepEqual(ids(choisirQcm(d, T, { n: 10, rnd: graine(1) })), ['q1', 'q2', 'q5', 'q8']);
});

// --- ligneQcm ---

test('ligneQcm : ligne du journal au format prévu', () => {
  const q = qcm('cv-cm06-q01', ['A', 'C'], { cours: 'cv-cm06', ue: 'cv' });
  const resultat = scorer(q, ['c', 'A', 'D']);
  const t = T + 3 * MIN;
  const l = ligneQcm({ qcm: q, cochees: ['c', 'A', 'D'], resultat, duree: 30000, maintenant: t, appareil: 'tel-x7k2' });
  assert.deepStrictEqual(l, {
    id: `tel-x7k2-${t}`, ts: t, t: '2026-10-12T12:03:00+02:00', appareil: 'tel-x7k2', qcm: 'cv-cm06-q01', cours: 'cv-cm06', ue: 'cv',
    cochees: ['A', 'C', 'D'], points: 0.5, discordances: 1, duree: 30000,
  });
  assert.deepEqual(Object.keys(l), ['id', 'ts', 't', 'appareil', 'qcm', 'cours', 'ue', 'cochees', 'points', 'discordances', 'duree']);
  const sansDuree = ligneQcm({ qcm: q, cochees: [], resultat: scorer(q, []), maintenant: t, appareil: 'pc' });
  assert.equal('duree' in sansDuree, false);
  assert.deepEqual(sansDuree.cochees, []);
  assert.deepEqual(etatQcm('cv-cm06-q01', [l]).etape, 1);
});

// --- Ordre des propositions ---

test('melangerPropositions : ordre tiré, lettres A à E dans l\'ordre affiché, vrai/faux et lettre d\'origine gardés', () => {
  const q = qcm('q1', ['A', 'C']);
  const ordres = new Set();
  for (let g = 1; g <= 12; g++) {
    const m = melangerPropositions(q, graine(g));
    assert.deepEqual(m.propositions.map(p => p.l), ['A', 'B', 'C', 'D', 'E']);
    for (const p of m.propositions) assert.equal(p.t, `Proposition ${p.origine}`);
    assert.deepEqual(m.propositions.filter(p => p.vrai).map(p => p.origine).sort(), ['A', 'C']);
    ordres.add(m.propositions.map(p => p.origine).join(''));
  }
  assert.ok(ordres.size >= 8, `ordres variés (${ordres.size})`);
  assert.deepEqual(q.propositions.map(p => p.l), ['A', 'B', 'C', 'D', 'E'], 'QCM d\'origine intact');
  // Remélanger un QCM déjà mélangé garde la lettre du fichier.
  const deux = melangerPropositions(melangerPropositions(q, graine(3)), graine(4));
  for (const p of deux.propositions) assert.equal(p.t, `Proposition ${p.origine}`);
});

test('choisirQcm mélange les propositions ; points et journal en lettres du fichier', () => {
  const d = { paquets: { p1: { cartes: [] } }, qcm: { q1: qcm('q1', ['A', 'C']) }, srs: { p1: { x: {} } }, qcmJournal: [] };
  const [m] = choisirQcm(d, T, { n: 1, cours: 'p1', rnd: graine(7) });
  const vraies = m.propositions.filter(p => p.vrai).map(p => p.l);
  const r = scorer(m, vraies);
  assert.equal(r.points, 1);
  const l = ligneQcm({ qcm: m, cochees: vraies, resultat: r, maintenant: T });
  assert.deepEqual(l.cochees, ['A', 'C']);
  assert.equal(l.ordre, m.propositions.map(p => p.origine).join(''));
  assert.deepEqual(Object.keys(l), ['id', 'ts', 't', 'appareil', 'qcm', 'cours', 'ue', 'cochees', 'ordre', 'points', 'discordances']);
});
