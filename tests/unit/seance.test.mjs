// Séance : compteurs du jour, file (révisions puis nouvelles), fiche, pause, notes, bilan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nouvellesDuJour, cartesDuJour, revisionsRestantes, objectifDuJour, aReviser, nouvellesPossibles, apportDuFiltre, revisionsEnAvance,
  JOURS_TOTAL_SEUL, Seance, QCM_MAX, qcmRestants,
} from '../../js/seance.js';
import { review } from '../../js/fsrs.js';
import { MIN, HEURE, JOUR, isoParis } from '../../js/temps.js';

const z = s => Date.parse(s);
const T = z('2026-10-12T10:00:00Z');   // lundi 12 oct. 2026, 12:00 à Paris

// --- Données synthétiques (forme Donnees de depot.js) ---
const carte = (id, extra = {}) => ({ id, type: 'fait', q: `Question ${id} ?`, a: `Réponse ${id}.`, ...extra });
const paquet = (id, cartes, extra = {}) => ({ id, nom: `Paquet ${id}`, ue: 'ue1', ordre: 1, cartes, ...extra });
const fiche = id => ({ id, title: `Fiche ${id}`, why: 'Pour tester.', order: 1, blocks: [] });
const etat = (last, due, extra = {}) => ({ s: 4, d: 5, due, last, reps: 1, lapses: 0, ...extra });
const du = (k = 0) => etat(T - 4 * JOUR - k, T - HEURE - k);      // à réviser maintenant
const futur = (jours = 3) => etat(T - JOUR, T + jours * JOUR);     // pas encore dû

function donneesDe({ paquets = [], srs = {}, reponses = [], fiches = {}, reglages = {}, ordre } = {}) {
  const p = {}, cartes = {};
  for (const x of paquets) {
    p[x.id] = x;
    for (const c of x.cartes) cartes[c.id] = { paquet: x.id, carte: c };
  }
  return {
    plan: null, paquets: p, ordre: ordre ?? paquets.map(x => x.id), fiches, qcm: {}, srs, reponses, qcmJournal: [],
    carnet: { abreviations: {}, cartes: {} }, aRevoir: { cas: [] },
    reglages: { nouvellesParJour: 15, objectifJour: 30, pauseToutes: 30, ordrePaquets: [], ...reglages },
    exceptions: { jours: {} }, historique: { days: {} }, cartes,
  };
}

const ligne = (carteId, ts, extra = {}) => ({
  id: `test-${ts}-${carteId}`, ts, t: isoParis(ts), appareil: 'test', paquet: 'p1', carte: carteId,
  reponse: '…', verdict: 'juste', correcteur: 'local', note: 3, nouvelle: true, ...extra,
});

// Aléa reproductible.
function graine(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Déroule une séance : lit la fiche, reprend après la pause, note chaque carte.
function parcourir(seance, verdictDe = () => 'juste', debut = T) {
  const etapes = [];
  let t = debut;
  for (let garde = 0; garde < 500; garde++) {
    const e = seance.etape();
    etapes.push(e);
    if (e.type === 'fin') return etapes;
    if (e.type === 'fiche') seance.ficheVue();
    else if (e.type === 'pause') seance.continuer();
    else {
      t += MIN;
      seance.noter({ verdict: verdictDe(e), correcteur: 'local', reponse: 'r', maintenant: t, appareil: 'test' });
    }
  }
  throw new Error('séance sans fin');
}
const idsCartes = etapes => etapes.filter(e => e.type === 'carte').map(e => e.carte.id);
const resume = etapes => etapes.map(e => e.type === 'carte' ? e.carte.id : e.type === 'fiche' ? `fiche:${e.ficheId}` : e.type);

// --- Compteurs du jour ---

test('nouvellesDuJour : cartes distinctes vues pour la 1re fois aujourd\'hui (Paris)', () => {
  const minuit = z('2026-10-11T22:00:00Z');   // 00:00 le 12 à Paris
  const d = donneesDe({
    reponses: [
      ligne('c1', minuit),                                   // dès minuit
      ligne('c1', T + MIN, { nouvelle: false }),
      ligne('c2', T + 2 * MIN),
      ligne('c2', T + 3 * MIN),                              // même carte : compte une fois
      ligne('c3', T + 4 * MIN, { nouvelle: false }),         // révision
      ligne('c4', minuit - 1),                               // 23:59:59 la veille
      ligne('c5', z('2026-10-12T22:00:00Z')),                // le lendemain
    ],
  });
  assert.equal(nouvellesDuJour(d, T), 2);
  assert.equal(nouvellesDuJour(d, minuit - 1), 1);
  assert.equal(nouvellesDuJour(donneesDe(), T), 0);
  assert.equal(nouvellesDuJour({}, T), 0);
});

test('nouvellesDuJour : une contestation ne change pas le compte', () => {
  const l1 = ligne('c1', T, { verdict: 'faux', note: 1 });
  const contestation = ligne('c1', T + MIN, { correcteur: 'contestation', remplace: l1.id, verdict: 'juste', note: 3 });
  const d = donneesDe({ reponses: [l1, contestation, ligne('c2', T + 2 * MIN)] });
  assert.equal(nouvellesDuJour(d, T), 2);
  // contestation seule (ligne visée absente) : ne crée pas de nouvelle carte
  const seule = ligne('c9', T, { correcteur: 'contestation', remplace: 'ailleurs', nouvelle: true });
  assert.equal(nouvellesDuJour(donneesDe({ reponses: [seule] }), T), 0);
});

test('nouvellesDuJour : jour de bascule, les nouvelles de v1 (historique) comptent', () => {
  const d = donneesDe({ reponses: [ligne('c1', T), ligne('c2', T + MIN)] });
  d.historique = { source: 'v1', days: { '2026-10-12': { n: 30, judged: 30, right: 20, nw: 12 }, '2026-10-11': { nw: 40 } } };
  assert.equal(nouvellesDuJour(d, T), 14);
  assert.equal(nouvellesDuJour({ historique: d.historique }, T), 12);
  d.historique.days['2026-10-12'].nw = 'x';
  assert.equal(nouvellesDuJour(d, T), 2);
  // la limite de nouvelles cartes en tient compte
  const p = paquet('p1', Array.from({ length: 20 }, (_, i) => carte(`n${i}`)));
  const d2 = donneesDe({ paquets: [p], reglages: { nouvellesParJour: 15 } });
  d2.historique = { days: { '2026-10-12': { nw: 10 } } };
  assert.equal(nouvellesPossibles(d2, T, 'tout').length, 5);
  d2.historique.days['2026-10-12'].nw = 20;
  assert.equal(nouvellesPossibles(d2, T, 'tout').length, 0);
});

test('cartesDuJour : cartes distinctes du jour, retour à +10 min compté une fois, contestation exclue', () => {
  const minuit = z('2026-10-11T22:00:00Z');   // 00:00 le 12 à Paris
  const rate = ligne('c1', T, { verdict: 'faux', note: 1 });
  const d = donneesDe({
    reponses: [
      rate,                                                          // nouvelle, ratée…
      ligne('c1', T + 10 * MIN, { nouvelle: false }),                // … revient à +10 min : une seule carte
      ligne('r1', minuit, { nouvelle: false }),                       // révision dès minuit
      ligne('r2', T + MIN, { nouvelle: false, verdict: 'faux', note: 1 }),   // révision ratée : compte aussi
      ligne('r2', T + 12 * MIN, { nouvelle: false }),
      ligne('r3', T + 2 * MIN, { nouvelle: false, paquet: 'p2' }),    // révision en avance (autre paquet)
      ligne('c1', T + 20 * MIN, { correcteur: 'contestation', remplace: rate.id }),   // contestation : exclue
      ligne('c9', T + 3 * MIN, { correcteur: 'contestation', remplace: 'ailleurs' }), // contestation seule : exclue
      ligne('x1', minuit - 1, { nouvelle: false }),                   // la veille
      ligne('x2', z('2026-10-12T22:00:00Z')),                         // le lendemain
    ],
  });
  assert.deepEqual(cartesDuJour(d, T), { cartes: 4, nouvelles: 1, revisions: 3, qcm: 0, qcmComptees: 0 });
  assert.deepEqual(cartesDuJour(donneesDe(), T), { cartes: 0, nouvelles: 0, revisions: 0, qcm: 0, qcmComptees: 0 });
  assert.deepEqual(cartesDuJour({}, T), { cartes: 0, nouvelles: 0, revisions: 0, qcm: 0, qcmComptees: 0 });
  // même identifiant dans deux paquets : deux cartes
  const d2 = donneesDe({ reponses: [ligne('a', T), ligne('a', T + MIN, { paquet: 'p2' })] });
  assert.equal(cartesDuJour(d2, T).cartes, 2);
});

test('cartesDuJour : QCM des cartes comptés au plus 20 par jour, révisions d\'abord', () => {
  const qcm = (id, i, extra = {}) => ligne(id, T + i * 1000, { mode: 'qcm', verdict: 'partiel', note: 2, correcteur: 'qcm', ...extra });
  const rev = { nouvelle: false };
  const d = donneesDe({ reponses: [
    ...Array.from({ length: 25 }, (_, i) => qcm(`r${i}`, i, rev)),         // 25 révisions en QCM
    ...Array.from({ length: 5 }, (_, i) => qcm(`n${i}`, 30 + i)),           // 5 nouvelles en QCM
    ...['e1', 'e2', 'e3'].map((id, i) => ligne(id, T + (40 + i) * 1000, rev)),   // 3 révisions écrites
    qcm('m1', 50, rev), ligne('m1', T + 51000, rev),                        // QCM puis écrite : compte comme écrite
  ] });
  assert.deepEqual(cartesDuJour(d, T), { cartes: 24, nouvelles: 0, revisions: 24, qcm: 30, qcmComptees: 20 });
  assert.equal(qcmRestants(d, T), 0);
  // Peu de révisions en QCM : les nouvelles complètent jusqu'à 20.
  const d2 = donneesDe({ reponses: [
    ...Array.from({ length: 3 }, (_, i) => qcm(`r${i}`, i, rev)),
    ...Array.from({ length: 30 }, (_, i) => qcm(`n${i}`, 10 + i)),
  ] });
  assert.deepEqual(cartesDuJour(d2, T), { cartes: 20, nouvelles: 17, revisions: 3, qcm: 33, qcmComptees: 20 });
  // L'objectif ne s'atteint pas avec des QCM seulement.
  const p = paquet('p1', Array.from({ length: 40 }, (_, i) => carte(`n${i}`)));
  const d3 = donneesDe({ paquets: [p], reglages: { nouvellesParJour: 100 }, reponses: Array.from({ length: 35 }, (_, i) => qcm(`n${i}`, i)) });
  const o = objectifDuJour(d3, T, 30);
  assert.deepEqual([o.cartes, o.atteint, o.encore], [20, false, 10]);
  assert.equal(qcmRestants(donneesDe(), T), QCM_MAX);
  assert.equal(qcmRestants(d2, T), 0);
});

test('Seance en mode QCM : au plus `max` cartes, lignes marquées mode « qcm »', () => {
  const p = paquet('p1', Array.from({ length: 8 }, (_, i) => carte(`c${i}`)));
  const d = donneesDe({ paquets: [p], reglages: { nouvellesParJour: 20 } });
  const s = new Seance({ donnees: d, maintenant: T, mode: 'qcm', max: 3, rnd: graine(1) });
  assert.equal(s.restantes(), 3);
  const r = s.noter({ verdict: 'partiel', correcteur: 'qcm', reponse: 'Réponse c0.', maintenant: T + 1000, appareil: 'pc' });
  assert.equal(r.ligne.mode, 'qcm');
  const e = new Seance({ donnees: d, maintenant: T, rnd: graine(1) });
  assert.equal(e.restantes(), 8);
  assert.equal('mode' in e.noter({ verdict: 'juste', correcteur: 'local', maintenant: T + 1000 }).ligne, false);
});

test('aReviser : cartes disponibles (dû dès minuit, +10 min après une erreur), filtre', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a'), carte('b'), carte('c'), carte('d'), carte('e')]), paquet('p2', [carte('f')])],
    srs: {
      p1: {
        a: etat(T - 4 * JOUR, z('2026-10-12T18:00:00Z')),   // dû ce soir à 20 h : proposé
        b: etat(T - 4 * JOUR, z('2026-10-13T06:00:00Z')),   // demain : non
        c: etat(T - 5 * MIN, T + 5 * MIN),                  // raté il y a 5 min : non
        d: etat(T - 15 * MIN, T - 5 * MIN),                 // raté il y a 15 min : oui
        orpheline: du(),                                    // plus dans le paquet : ignorée
      },
      p2: { f: du() },
    },
  });
  assert.deepEqual(aReviser(d, T), [{ paquet: 'p1', carteId: 'a' }, { paquet: 'p1', carteId: 'd' }, { paquet: 'p2', carteId: 'f' }]);
  assert.deepEqual(aReviser(d, T, 'tout'), aReviser(d, T));
  assert.deepEqual(aReviser(d, T, 'p2'), [{ paquet: 'p2', carteId: 'f' }]);
  assert.deepEqual(aReviser(d, T, 'inconnu'), []);
  assert.deepEqual(aReviser(donneesDe(), T), []);
});

test('nouvellesPossibles : ordre des paquets puis du fichier, limite du jour', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a1'), carte('a2'), carte('a3')]), paquet('p2', [carte('b1'), carte('b2')])],
    ordre: ['p2', 'p1'],
    srs: { p1: { a2: futur() } },
    reglages: { nouvellesParJour: 15 },
  });
  const ids = r => r.map(x => `${x.paquet}/${x.carteId}`);
  assert.deepEqual(ids(nouvellesPossibles(d, T)), ['p2/b1', 'p2/b2', 'p1/a1', 'p1/a3']);
  assert.deepEqual(ids(nouvellesPossibles(d, T, 'p1')), ['p1/a1', 'p1/a3']);

  d.reglages.nouvellesParJour = 5;
  d.reponses = [ligne('x1', T - HEURE), ligne('x2', T - HEURE), ligne('x2', T - MIN), ligne('x3', T - JOUR)];
  assert.deepEqual(ids(nouvellesPossibles(d, T)), ['p2/b1', 'p2/b2', 'p1/a1']);   // 5 - 2 aujourd'hui
  assert.deepEqual(ids(nouvellesPossibles(d, T, 'p1')), ['p1/a1', 'p1/a3']);     // limite commune, filtre ensuite

  d.reglages.nouvellesParJour = 1;
  assert.deepEqual(nouvellesPossibles(d, T), []);                                  // jamais négatif
  d.reglages.nouvellesParJour = 0;
  d.reponses = [];
  assert.deepEqual(nouvellesPossibles(d, T), []);
});

test('nouvellesPossibles : paquets absents de l\'ordre pris ensuite, réglage absent → 15', () => {
  const cartes = Array.from({ length: 20 }, (_, i) => carte(`n${String(i).padStart(2, '0')}`));
  const d = donneesDe({ paquets: [paquet('zz', cartes.slice(0, 2)), paquet('aa', cartes.slice(2))], ordre: ['zz'] });
  delete d.reglages.nouvellesParJour;
  const r = nouvellesPossibles(d, T);
  assert.equal(r.length, 15);
  assert.deepEqual(r.slice(0, 3).map(x => x.paquet), ['zz', 'zz', 'aa']);
});

// --- File de la séance ---

test('Seance : révisions d\'abord, puis nouvelles cartes paquet par paquet', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a1'), carte('a2'), carte('a3')]), paquet('p2', [carte('b1'), carte('b2')])],
    ordre: ['p2', 'p1'],
    srs: { p1: { a1: du() }, p2: { b1: du() } },
  });
  const etapes = parcourir(new Seance({ donnees: d, maintenant: T, rnd: graine(7) }));
  const ids = idsCartes(etapes);
  assert.deepEqual(ids.slice(0, 2).sort(), ['a1', 'b1']);
  assert.deepEqual(ids.slice(2), ['b2', 'a2', 'a3']);
  const cartes = etapes.filter(e => e.type === 'carte');
  assert.deepEqual(cartes.map(e => e.nouvelle), [false, false, true, true, true]);
  assert.deepEqual(cartes.map(e => e.rang), [1, 2, 3, 4, 5]);
  assert.deepEqual(cartes.map(e => e.total), [5, 5, 5, 5, 5]);
  assert.deepEqual(cartes.map(e => e.restantes), [5, 4, 3, 2, 1]);
  assert.equal(cartes[0].etat, d.srs[cartes[0].paquet][cartes[0].carte.id]);
  assert.equal(cartes[2].etat, null);
});

test('Seance : révisions mélangées entre paquets avec l\'aléa fourni', () => {
  const p1 = Array.from({ length: 6 }, (_, i) => carte(`a${i}`));
  const p2 = Array.from({ length: 6 }, (_, i) => carte(`b${i}`));
  const srs = { p1: Object.fromEntries(p1.map(c => [c.id, du()])), p2: Object.fromEntries(p2.map(c => [c.id, du()])) };
  const ordre = s => {
    const d = donneesDe({ paquets: [paquet('p1', p1), paquet('p2', p2)], srs: structuredClone(srs) });
    return idsCartes(parcourir(new Seance({ donnees: d, maintenant: T, rnd: graine(s) })));
  };
  assert.deepEqual(ordre(3), ordre(3));
  const ordres = new Set([1, 2, 3, 4, 5, 6].map(s => ordre(s).join()));
  assert.ok(ordres.size > 1, 'l\'aléa change l\'ordre');
  for (const s of [1, 2, 3, 4, 5, 6]) {
    const ids = ordre(s);
    assert.equal(ids.length, 12);
    assert.notDeepEqual(ids, [...p1, ...p2].map(c => c.id));   // pas paquet après paquet
    for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i][0], ids[i - 1][0], `graine ${s} : ${ids}`);
  }
});

test('Seance : deux révisions de la même fiche ne se suivent pas quand c\'est évitable', () => {
  const cartes = [
    ...Array.from({ length: 4 }, (_, i) => carte(`fa${i}`, { fiche: 'fa' })),
    ...Array.from({ length: 4 }, (_, i) => carte(`fb${i}`, { fiche: 'fb' })),
  ];
  for (let s = 1; s <= 30; s++) {
    const d = donneesDe({ paquets: [paquet('p1', cartes)], srs: { p1: Object.fromEntries(cartes.map(c => [c.id, du()])) } });
    const fiches = parcourir(new Seance({ donnees: d, maintenant: T, rnd: graine(s) }))
      .filter(e => e.type === 'carte').map(e => e.carte.fiche);
    assert.equal(fiches.length, 8);
    for (let i = 1; i < fiches.length; i++) assert.notEqual(fiches[i], fiches[i - 1], `graine ${s} : ${fiches}`);
  }
  // inévitable (5 contre 1) : toutes les cartes restent dans la file
  const inegal = [...Array.from({ length: 5 }, (_, i) => carte(`x${i}`, { fiche: 'fx' })), carte('y0', { fiche: 'fy' })];
  const d = donneesDe({ paquets: [paquet('p1', inegal)], srs: { p1: Object.fromEntries(inegal.map(c => [c.id, du()])) } });
  assert.deepEqual(idsCartes(parcourir(new Seance({ donnees: d, maintenant: T, rnd: graine(2) }))).sort(), inegal.map(c => c.id).sort());
});

test('Seance : limite de nouvelles cartes et filtre par paquet', () => {
  const d = donneesDe({
    paquets: [paquet('p1', Array.from({ length: 8 }, (_, i) => carte(`a${i}`))), paquet('p2', [carte('b0'), carte('b1')])],
    srs: { p2: { b0: du() } },
    reglages: { nouvellesParJour: 5 },
    reponses: [ligne('x1', T - HEURE), ligne('x2', T - HEURE)],
  });
  assert.deepEqual(idsCartes(parcourir(new Seance({ donnees: structuredClone(d), maintenant: T }))), ['b0', 'a0', 'a1', 'a2']);
  assert.deepEqual(idsCartes(parcourir(new Seance({ donnees: structuredClone(d), maintenant: T, filtre: 'p2' }))), ['b0', 'b1']);
});

test('Seance : micro-fiche avant la 1re nouvelle carte de chaque fiche', () => {
  const d = donneesDe({
    paquets: [
      paquet('p1', [carte('r1', { fiche: 'fa' }), carte('n1', { fiche: 'fa' }), carte('n2', { fiche: 'fa' }), carte('n3', { fiche: 'absente' })]),
      paquet('p2', [carte('m1'), carte('m2', { fiche: 'absente' }), carte('m3', { fiche: 'fa' })]),
    ],
    fiches: { fa: fiche('fa'), p2: fiche('p2') },
    srs: { p1: { r1: du() } },
  });
  const etapes = parcourir(new Seance({ donnees: d, maintenant: T }));
  // r1 : révision, pas de fiche ; n3 : ni sa fiche ni celle du paquet n'existent ;
  // m1, m2 : fiche du paquet ; m3 : fiche fa déjà montrée dans la séance
  assert.deepEqual(resume(etapes), ['r1', 'fiche:fa', 'n1', 'n2', 'n3', 'fiche:p2', 'm1', 'm2', 'm3', 'fin']);
  assert.deepEqual(etapes[1], { type: 'fiche', ficheId: 'fa', paquet: 'p1' });
  assert.deepEqual(etapes[5], { type: 'fiche', ficheId: 'p2', paquet: 'p2' });
});

test('Seance : l\'étape fiche reste affichée tant qu\'elle n\'est pas lue', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('n1', { fiche: 'fa' })])], fiches: { fa: fiche('fa') } });
  const s = new Seance({ donnees: d, maintenant: T });
  assert.equal(s.etape().type, 'fiche');
  assert.equal(s.etape().type, 'fiche');
  s.ficheVue();
  assert.equal(s.etape().type, 'carte');
});

test('Seance : pause toutes les N cartes faites', () => {
  const d = donneesDe({ paquets: [paquet('p1', Array.from({ length: 5 }, (_, i) => carte(`c${i}`)))], reglages: { pauseToutes: 2 } });
  const etapes = parcourir(new Seance({ donnees: d, maintenant: T }));
  assert.deepEqual(resume(etapes), ['c0', 'c1', 'pause', 'c2', 'c3', 'pause', 'c4', 'fin']);
  assert.deepEqual(etapes[2], { type: 'pause', faites: 2, minutes: 2 });
  assert.deepEqual(etapes[5], { type: 'pause', faites: 4, minutes: 4 });
  // pause présente tant qu'on ne continue pas
  const s = new Seance({ donnees: donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])], reglages: { pauseToutes: 1 } }), maintenant: T });
  s.noter({ verdict: 'juste', maintenant: T + MIN, appareil: 'test' });
  assert.equal(s.etape().type, 'pause');
  assert.equal(s.etape().type, 'pause');
  s.continuer();
  assert.equal(s.etape().type, 'carte');
});

test('Seance : pauseToutes à 0 → pas de pause ; réglage absent → 30', () => {
  const cartes = Array.from({ length: 35 }, (_, i) => carte(`c${i}`));
  const sans = donneesDe({ paquets: [paquet('p1', cartes)], reglages: { pauseToutes: 0, nouvellesParJour: 50 } });
  assert.ok(!resume(parcourir(new Seance({ donnees: sans, maintenant: T }))).includes('pause'));
  const defaut = donneesDe({ paquets: [paquet('p1', cartes)], reglages: { nouvellesParJour: 50 } });
  delete defaut.reglages.pauseToutes;
  const etapes = parcourir(new Seance({ donnees: defaut, maintenant: T }));
  assert.equal(resume(etapes).indexOf('pause'), 30);
});

// --- Noter ---

test('noter : état relu au moment de noter, ligne au format du journal, opérations', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])], srs: { p1: { a: du() } } });
  const s = new Seance({ donnees: d, maintenant: T });
  // un autre appareil a répondu entre-temps : la séance doit partir de cet état-là
  const plusRecent = etat(T - 10 * MIN, T - 5 * MIN, { s: 2.5, d: 6, reps: 3, lapses: 1 });
  d.srs.p1.a = plusRecent;
  const t = T + MIN;
  const r = s.noter({ verdict: 'juste', correcteur: 'gemini', reponse: 'ma réponse', duree: 18400, confiance: 0.92, maintenant: t, appareil: 'tel-x7k2' });
  assert.equal(r.etatAvant, plusRecent);
  assert.deepStrictEqual(r.etatApres, review(plusRecent, 3, t));
  assert.deepStrictEqual(r.ligne, {
    id: `tel-x7k2-${t}`, ts: t, t: '2026-10-12T12:01:00+02:00', appareil: 'tel-x7k2', paquet: 'p1', carte: 'a',
    reponse: 'ma réponse', verdict: 'juste', correcteur: 'gemini', note: 3, nouvelle: false, duree: 18400, confiance: 0.92,
  });
  assert.deepEqual(Object.keys(r.ligne), ['id', 'ts', 't', 'appareil', 'paquet', 'carte', 'reponse', 'verdict', 'correcteur', 'note', 'nouvelle', 'duree', 'confiance']);
  assert.deepStrictEqual(r.ops, [{ type: 'srs', paquet: 'p1', carte: 'a', etat: r.etatApres }, { type: 'reponse', ligne: r.ligne }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.ligne)), r.ligne);

  // nouvelle carte, partiel, sans durée ni confiance
  const r2 = s.noter({ verdict: 'partiel', correcteur: 'local', indice: true, maintenant: t + MIN, appareil: 'pc' });
  assert.equal(r2.etatAvant, null);
  assert.deepStrictEqual(r2.etatApres, review(null, 2, t + MIN));
  assert.equal(r2.ligne.nouvelle, true);
  assert.equal(r2.ligne.note, 2);
  assert.equal(r2.ligne.reponse, '');
  assert.equal('duree' in r2.ligne, false);
  assert.equal('confiance' in r2.ligne, false);
  assert.equal(r2.ligne.indice, true, 'réponse donnée après un indice');
  assert.equal(s.etape().type, 'fin');
  assert.throws(() => s.noter({ verdict: 'juste', maintenant: t + 2 * MIN, appareil: 'pc' }), /terminée/);
});

test('noter : la séance ne modifie pas les données reçues', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])], srs: { p1: { a: du() } } });
  const avant = structuredClone(d);
  const s = new Seance({ donnees: d, maintenant: T });
  const vues = new Set();
  parcourir(s, e => (vues.has(e.carte.id) ? 'juste' : (vues.add(e.carte.id), 'faux')));
  assert.equal(s.bilan.faites, 4);
  assert.deepStrictEqual(d, avant);
});

test('faux : la carte revient 4 positions plus loin, avec son nouvel état', () => {
  const d = donneesDe({ paquets: [paquet('p1', Array.from({ length: 6 }, (_, i) => carte(`c${i + 1}`)))] });
  const s = new Seance({ donnees: d, maintenant: T });
  const premier = s.noter({ verdict: 'faux', correcteur: 'local', maintenant: T + MIN, appareil: 'test' });
  assert.equal(premier.ligne.nouvelle, true);
  assert.equal(s.etape().total, 7);
  const suite = [];
  let retour = null;
  for (let e = s.etape(), t = T + 2 * MIN; e.type === 'carte'; e = s.etape(), t += MIN) {
    suite.push(e.carte.id);
    if (e.carte.id === 'c1') {
      // pas de majDonnees : la séance garde l'état qu'elle vient de calculer
      assert.equal(e.nouvelle, false);
      assert.deepStrictEqual(e.etat, premier.etatApres);
      retour = s.noter({ verdict: 'juste', correcteur: 'local', maintenant: t, appareil: 'test' });
    } else s.noter({ verdict: 'juste', correcteur: 'local', maintenant: t, appareil: 'test' });
  }
  assert.deepEqual(suite, ['c2', 'c3', 'c4', 'c1', 'c5', 'c6']);
  assert.deepStrictEqual(retour.etatAvant, premier.etatApres);
  assert.equal(retour.ligne.nouvelle, false);
  assert.deepStrictEqual(retour.etatApres, review(premier.etatApres, 3, T + 5 * MIN));
});

test('faux en fin de file : la carte revient tout de suite après les dernières', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('c1'), carte('c2')])] });
  const s = new Seance({ donnees: d, maintenant: T });
  s.noter({ verdict: 'faux', maintenant: T + MIN, appareil: 'test' });
  assert.deepEqual(idsCartes(parcourir(s, () => 'juste', T + MIN)), ['c2', 'c1']);
  // ratée deux fois : revient encore
  const s2 = new Seance({ donnees: donneesDe({ paquets: [paquet('p1', [carte('c1')])] }), maintenant: T });
  let n = 0;
  assert.deepEqual(idsCartes(parcourir(s2, () => (n++ < 2 ? 'faux' : 'juste'))), ['c1', 'c1', 'c1']);
});

test('majDonnees : la séance relit les nouvelles données', () => {
  const d1 = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b'), carte('c')])], srs: { p1: { a: du() } } });
  const s = new Seance({ donnees: d1, maintenant: T });
  const r = s.noter({ verdict: 'faux', maintenant: T + MIN, appareil: 'test' });
  // la synchro renvoie un nouvel objet : état appliqué, carte b retirée du paquet
  const d2 = structuredClone(d1);
  d2.srs.p1.a = r.etatApres;
  d2.paquets.p1.cartes = d2.paquets.p1.cartes.filter(c => c.id !== 'b');
  delete d2.cartes.b;
  s.majDonnees(d2);
  const e = s.etape();
  assert.equal(e.carte.id, 'c');
  assert.equal(e.total, 3);   // a, c, puis a qui revient (b a disparu)
  // un état plus récent venu d'ailleurs l'emporte sur celui calculé dans la séance
  const ailleurs = etat(T + 2 * MIN, T + 4 * JOUR, { reps: 5 });
  d2.srs.p1.a = ailleurs;
  s.noter({ verdict: 'juste', maintenant: T + 3 * MIN, appareil: 'test' });
  const ea = s.etape();
  assert.equal(ea.carte.id, 'a');
  assert.equal(ea.etat, ailleurs);
  assert.equal(s.noter({ verdict: 'juste', maintenant: T + 4 * MIN, appareil: 'test' }).etatAvant, ailleurs);
});

test('passer : la carte part en fin de file, sans note', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('c1'), carte('c2'), carte('c3')])] });
  const s = new Seance({ donnees: d, maintenant: T });
  s.passer();
  const e = s.etape();
  assert.equal(e.carte.id, 'c2');
  assert.equal(e.total, 3);
  assert.equal(s.bilan.faites, 0);
  assert.deepEqual(idsCartes(parcourir(s)), ['c2', 'c3', 'c1']);
  // dernière carte : elle reste
  const seule = new Seance({ donnees: donneesDe({ paquets: [paquet('p1', [carte('x')])] }), maintenant: T });
  seule.passer();
  assert.equal(seule.etape().carte.id, 'x');
  const fini = new Seance({ donnees: donneesDe(), maintenant: T });
  fini.passer();
  assert.equal(fini.etape().type, 'fin');
});

test('bilan : réponses, verdicts, minutes, fiches à relire', () => {
  const d = donneesDe({
    paquets: [
      paquet('p1', [carte('c1', { fiche: 'fa' }), carte('c2', { fiche: 'fb' }), carte('c3', { fiche: 'absente' }), carte('c4', { fiche: 'fb' })]),
      paquet('p2', [carte('c5')]),
    ],
    fiches: { fa: fiche('fa'), fb: fiche('fb'), p2: fiche('p2') },
  });
  const verdicts = { c1: ['juste'], c2: ['faux', 'juste'], c3: ['faux', 'partiel'], c4: ['faux', 'juste'], c5: ['faux', 'juste'] };
  const s = new Seance({ donnees: d, maintenant: T });
  const etapes = parcourir(s, e => verdicts[e.carte.id].shift());
  const fin = etapes.at(-1);
  assert.equal(fin.type, 'fin');
  assert.deepStrictEqual(fin.bilan, { faites: 9, justes: 4, partielles: 1, fausses: 4, minutes: 9, fichesARelire: ['fb', 'p2'] });
  assert.deepStrictEqual(s.bilan, fin.bilan);
});

test('bilan : séance vide', () => {
  const s = new Seance({ donnees: donneesDe(), maintenant: T });
  assert.deepStrictEqual(s.etape(), { type: 'fin', bilan: { faites: 0, justes: 0, partielles: 0, fausses: 0, minutes: 0, fichesARelire: [] } });
});

test('horloge injectée : durée de la séance', () => {
  let maintenant = T;
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])] });
  const s = new Seance({ donnees: d, maintenant: () => maintenant });
  maintenant = T + 3 * MIN;
  const r = s.noter({ verdict: 'juste', appareil: 'test' });
  assert.equal(r.ligne.ts, T + 3 * MIN);
  maintenant = T + 7 * MIN + 10_000;
  assert.equal(s.bilan.minutes, 7);
});

test('en avance : rien n\'est dû → les 20 révisions les plus proches', () => {
  const cartes = Array.from({ length: 25 }, (_, i) => carte(`c${i}`));
  const jours = [13, 2, 25, 7, 1, 19, 4, 22, 9, 16, 3, 11, 24, 6, 18, 5, 21, 8, 15, 10, 23, 12, 20, 14, 17];
  const srs = { p1: Object.fromEntries(cartes.map((c, i) => [c.id, futur(jours[i])])) };
  const d = donneesDe({ paquets: [paquet('p1', cartes)], srs, reglages: { nouvellesParJour: 0 } });

  const normale = new Seance({ donnees: d, maintenant: T });
  assert.equal(normale.etape().type, 'fin');
  assert.equal(normale.enAvance, false);

  const avance = new Seance({ donnees: d, maintenant: T, enAvance: true, rnd: graine(4) });
  assert.equal(avance.enAvance, true);
  const ids = idsCartes(parcourir(avance));
  const attendues = cartes.filter((_, i) => jours[i] <= 20).map(c => c.id);
  assert.equal(ids.length, 20);
  assert.deepEqual([...ids].sort(), [...attendues].sort());

  // s'il y a une révision due, « en avance » ne change rien
  d.srs.p1.c0 = du();
  const due = new Seance({ donnees: d, maintenant: T, enAvance: true });
  assert.equal(due.enAvance, false);
  assert.deepEqual(idsCartes(parcourir(due)), ['c0']);
});

test('en avance : filtre par paquet', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a')]), paquet('p2', [carte('b')])],
    srs: { p1: { a: futur(2) }, p2: { b: futur(1) } },
    reglages: { nouvellesParJour: 0 },
  });
  assert.deepEqual(idsCartes(parcourir(new Seance({ donnees: d, maintenant: T, enAvance: true, filtre: 'p1' }))), ['a']);
});

// --- Méthodes publiques pour l'interface ---

test('restantes : cartes encore à faire, carte affichée comprise', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('c1'), carte('c2'), carte('c3')])], reglages: { pauseToutes: 1 } });
  const s = new Seance({ donnees: d, maintenant: T });
  assert.equal(s.restantes(), 3);
  assert.equal(s.etape().restantes, 3);
  s.noter({ verdict: 'juste', maintenant: T + MIN, appareil: 'test' });
  assert.equal(s.etape().type, 'pause');
  assert.equal(s.restantes(), 2);                  // la pause ne change rien au compte
  s.continuer();
  s.noter({ verdict: 'faux', maintenant: T + 2 * MIN, appareil: 'test' });
  s.continuer();
  assert.equal(s.restantes(), 2);                  // c3, puis c2 qui revient
  assert.equal(s.etape().restantes, s.restantes());
  s.passer();
  assert.equal(s.restantes(), 2);
  parcourir(s, () => 'juste', T + 3 * MIN);
  assert.equal(s.restantes(), 0);
  assert.equal(new Seance({ donnees: donneesDe(), maintenant: T }).restantes(), 0);
});

test('restantes : une carte disparue des données ne compte plus quand elle arrive', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])] });
  const s = new Seance({ donnees: d, maintenant: T });
  const d2 = structuredClone(d);
  d2.paquets.p1.cartes = d2.paquets.p1.cartes.filter(c => c.id !== 'a');
  delete d2.cartes.a;
  s.majDonnees(d2);
  assert.equal(s.restantes(), 1);
});

test('nouvellesDeFiche : nouvelles cartes à venir rattachées à la fiche', () => {
  const d = donneesDe({
    paquets: [
      paquet('p1', [carte('r1', { fiche: 'fa' }), carte('n1', { fiche: 'fa' }), carte('n2', { fiche: 'fa' }), carte('n3')]),
      paquet('p2', [carte('m1'), carte('m2', { fiche: 'fa' })]),
    ],
    fiches: { fa: fiche('fa'), p1: fiche('p1') },
    srs: { p1: { r1: du() } },
  });
  const s = new Seance({ donnees: d, maintenant: T });
  // r1 est une révision ; n3 se rattache à la fiche du paquet ; m1 n'a pas de fiche ; m2 se rattache à fa
  assert.equal(s.nouvellesDeFiche('fa'), 3);
  assert.equal(s.nouvellesDeFiche('p1'), 1);
  assert.equal(s.nouvellesDeFiche('absente'), 0);
  assert.equal(s.nouvellesDeFiche(null), 0);
  s.noter({ verdict: 'juste', maintenant: T + MIN, appareil: 'test' });   // r1
  assert.deepEqual(s.etape(), { type: 'fiche', ficheId: 'fa', paquet: 'p1' });
  s.ficheVue();
  s.noter({ verdict: 'faux', maintenant: T + 2 * MIN, appareil: 'test' });   // n1 : plus nouvelle, revient plus loin
  assert.equal(s.nouvellesDeFiche('fa'), 2);
});

test('corrigerVerdict : faux contesté → la reprise disparaît, bilan et fiches à relire corrigés', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('c1', { fiche: 'fa' }), carte('c2'), carte('c3'), carte('c4'), carte('c5'), carte('c6')])],
    fiches: { fa: fiche('fa') },
  });
  const s = new Seance({ donnees: d, maintenant: T });
  s.ficheVue();
  s.noter({ verdict: 'faux', correcteur: 'gemini', maintenant: T + MIN, appareil: 'test' });
  assert.equal(s.restantes(), 6);
  assert.deepEqual(s.bilan.fichesARelire, ['fa']);
  assert.equal(s.corrigerVerdict('p1', 'c1', 'faux', 'juste'), true);
  assert.equal(s.restantes(), 5);
  assert.deepStrictEqual(s.bilan, { faites: 1, justes: 1, partielles: 0, fausses: 0, minutes: 1, fichesARelire: [] });
  assert.deepEqual(idsCartes(parcourir(s, () => 'juste', T + MIN)), ['c2', 'c3', 'c4', 'c5', 'c6']);
  assert.equal(s.bilan.justes, 6);
});

test('corrigerVerdict : partiel → juste ne touche qu\'au bilan ; même verdict : rien', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b'), carte('c')])] });
  const s = new Seance({ donnees: d, maintenant: T });
  s.noter({ verdict: 'partiel', maintenant: T + MIN, appareil: 'test' });
  assert.equal(s.corrigerVerdict('p1', 'a', 'partiel', 'partiel'), false);
  assert.equal(s.corrigerVerdict('p1', 'a', 'partiel', 'juste'), false);
  assert.equal(s.bilan.partielles, 0);
  assert.equal(s.bilan.justes, 1);
  assert.equal(s.restantes(), 2);
  // faux → partiel : la carte ne revient pas non plus
  s.noter({ verdict: 'faux', maintenant: T + 2 * MIN, appareil: 'test' });
  assert.equal(s.restantes(), 2);
  assert.equal(s.corrigerVerdict('p1', 'b', 'faux', 'partiel'), true);
  assert.deepStrictEqual([s.bilan.justes, s.bilan.partielles, s.bilan.fausses], [1, 1, 0]);
  assert.deepEqual(idsCartes(parcourir(s, () => 'juste', T + 2 * MIN)), ['c']);
});

test('corrigerVerdict : carte seule ratée (la reprise est la suivante) et carte ratée deux fois', () => {
  const s = new Seance({ donnees: donneesDe({ paquets: [paquet('p1', [carte('x')])] }), maintenant: T });
  s.noter({ verdict: 'faux', maintenant: T + MIN, appareil: 'test' });
  assert.equal(s.etape().carte.id, 'x');
  s.corrigerVerdict('p1', 'x', 'faux', 'juste');
  assert.equal(s.etape().type, 'fin');
  assert.deepStrictEqual([s.bilan.justes, s.bilan.fausses], [1, 0]);

  const d = donneesDe({ paquets: [paquet('p1', [carte('a', { fiche: 'fa' }), carte('b', { fiche: 'fa' })])], fiches: { fa: fiche('fa') } });
  const s2 = new Seance({ donnees: d, maintenant: T });
  s2.ficheVue();
  s2.noter({ verdict: 'faux', maintenant: T + MIN, appareil: 'test' });       // a
  s2.noter({ verdict: 'faux', maintenant: T + 2 * MIN, appareil: 'test' });   // b
  assert.deepEqual(s2.bilan.fichesARelire, ['fa']);
  s2.corrigerVerdict('p1', 'b', 'faux', 'juste');
  assert.deepEqual(s2.bilan.fichesARelire, ['fa']);   // a reste fausse : la fiche reste à relire
  assert.equal(s2.etape().carte.id, 'a');
  s2.noter({ verdict: 'faux', maintenant: T + 3 * MIN, appareil: 'test' });   // a, encore
  s2.corrigerVerdict('p1', 'a', 'faux', 'juste');
  assert.deepEqual(s2.bilan.fichesARelire, ['fa']);   // la première réponse fausse de a compte toujours
  assert.equal(s2.etape().type, 'fin');
  assert.deepStrictEqual([s2.bilan.faites, s2.bilan.justes, s2.bilan.fausses], [3, 2, 1]);
});

// --- Objectif du jour (règle du 16/10) ---

// n révisions dues (r0…), n nouvelles cartes (n0…) ; faites : lignes du jour.
function journee({ dues = 0, nouvellesCartes = 0, revisionsFaites = 0, nouvellesFaites = 0, objectif = 60, plafond = 60, t = T }) {
  const cartes = [], srs = {}, reponses = [];
  for (let i = 0; i < dues; i++) { cartes.push(carte(`r${i}`)); srs[`r${i}`] = etat(t - 4 * JOUR - i, t - HEURE - i); }
  for (let i = 0; i < revisionsFaites; i++) {
    cartes.push(carte(`f${i}`));
    srs[`f${i}`] = etat(t - MIN, t + 3 * JOUR);
    reponses.push(ligne(`f${i}`, t - MIN, { nouvelle: false }));
  }
  for (let i = 0; i < nouvellesFaites; i++) {
    cartes.push(carte(`v${i}`));
    srs[`v${i}`] = etat(t - MIN, t + JOUR);
    reponses.push(ligne(`v${i}`, t - MIN));
  }
  for (let i = 0; i < nouvellesCartes; i++) cartes.push(carte(`n${i}`));
  return donneesDe({ paquets: [paquet('p1', cartes)], srs: { p1: srs }, reponses, reglages: { nouvellesParJour: plafond, objectifJour: objectif } });
}

test('objectifDuJour : 60 cartes dont des nouvelles alors que des révisions restent → pas atteint', () => {
  const d = journee({ dues: 20, nouvellesCartes: 50, revisionsFaites: 30, nouvellesFaites: 30 });
  const o = objectifDuJour(d, T, 60);
  assert.deepEqual([o.cartes, o.revisionsFaites, o.revisionsRestantes, o.atteint], [60, 30, 20, false]);
  // il faut toutes les révisions du jour (50 < 60) : encore 20 cartes, toutes des révisions
  assert.deepEqual([o.encore, o.encoreRevisions], [20, 20]);
});

test('objectifDuJour : 60 révisions faites et encore 20 dues → atteint', () => {
  const d = journee({ dues: 20, nouvellesCartes: 50, revisionsFaites: 60 });
  const o = objectifDuJour(d, T, 60);
  assert.deepEqual([o.cartes, o.revisionsFaites, o.revisionsRestantes, o.atteint, o.encore, o.encoreRevisions], [60, 60, 20, true, 0, 0]);
});

test('objectifDuJour : peu de révisions dues → les nouvelles complètent', () => {
  // 10 révisions faites, aucune restante, 30 nouvelles : encore 20 cartes (aucune révision exigée)
  const d = journee({ nouvellesCartes: 50, revisionsFaites: 10, nouvellesFaites: 30 });
  assert.deepEqual(['cartes', 'atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(d, T, 60)[k]), [40, false, 20, 0]);
  const d2 = journee({ nouvellesCartes: 50, revisionsFaites: 10, nouvellesFaites: 50 });
  assert.equal(objectifDuJour(d2, T, 60).atteint, true);
  // au-delà de l'objectif, rien de plus n'est exigé
  const d3 = journee({ dues: 5, nouvellesCartes: 50, revisionsFaites: 70, nouvellesFaites: 10 });
  assert.equal(objectifDuJour(d3, T, 60).atteint, true);
  // pas assez de cartes, même avec toutes les révisions
  const d4 = journee({ nouvellesCartes: 50, revisionsFaites: 20 });
  assert.deepEqual(['atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(d4, T, 60)[k]), [false, 40, 0]);
});

test('objectifDuJour : rien à proposer → atteint', () => {
  // toutes les révisions faites, plafond de nouvelles atteint : 25 cartes suffisent
  const plafond = journee({ nouvellesCartes: 10, revisionsFaites: 10, nouvellesFaites: 15, plafond: 15 });
  assert.deepEqual(['cartes', 'atteint', 'encore'].map(k => objectifDuJour(plafond, T, 60)[k]), [25, true, 0]);
  // plus aucune carte jamais vue
  const tout = journee({ revisionsFaites: 5 });
  assert.equal(objectifDuJour(tout, T, 60).atteint, true);
  // une révision due : il reste quelque chose
  const reste = journee({ dues: 1, revisionsFaites: 5 });
  assert.deepEqual(['atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(reste, T, 60)[k]), [false, 1, 1]);   // pas plus que ce qui reste
  // deux nouvelles possibles : il reste quelque chose
  assert.deepEqual(['atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(journee({ nouvellesCartes: 2, revisionsFaites: 5 }), T, 60)[k]), [false, 2, 0]);
  // sans cartes chargées (démarrage) : rien n'est atteint
  assert.equal(objectifDuJour(donneesDe(), T, 60).atteint, false);
});

test('objectifDuJour : données réelles du 16 oct. (53 cartes dont 30 nouvelles, 61 révisions restantes)', () => {
  const d = journee({ dues: 61, nouvellesCartes: 40, revisionsFaites: 23, nouvellesFaites: 30, plafond: 64 });
  const o = objectifDuJour(d, T, 60);
  assert.deepEqual([o.cartes, o.revisionsFaites, o.revisionsRestantes, o.atteint], [53, 23, 61, false]);
  assert.deepEqual([o.encore, o.encoreRevisions], [37, 37]);   // 60 révisions dans la journée
});

test('objectifDuJour : le 16 oct. 2026, jour du changement de règle, seul le total compte', () => {
  const t16 = Date.parse('2026-10-16T20:00:00+02:00');
  assert.ok(JOURS_TOTAL_SEUL.has('2026-10-16'));
  // journal réel du 16 : 53 cartes dont 30 nouvelles, 61 révisions restantes → encore 7 cartes, aucune révision exigée
  const d = journee({ dues: 61, nouvellesCartes: 40, revisionsFaites: 23, nouvellesFaites: 30, t: t16 });
  assert.deepEqual(['cartes', 'atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(d, t16, 60)[k]), [53, false, 7, 0]);
  const d60 = journee({ dues: 61, nouvellesCartes: 40, revisionsFaites: 30, nouvellesFaites: 30, t: t16 });
  assert.equal(objectifDuJour(d60, t16, 60).atteint, true);
  // le lendemain, la règle complète s'applique
  const t17 = t16 + JOUR;
  const d17 = journee({ dues: 61, nouvellesCartes: 40, revisionsFaites: 30, nouvellesFaites: 30, t: t17 });
  assert.deepEqual(['atteint', 'encore', 'encoreRevisions'].map(k => objectifDuJour(d17, t17, 60)[k]), [false, 30, 30]);
});

test('apportDuFiltre : révisions qui comptent encore, cartes ratées qui reviennent (déjà comptées), nouvelles', () => {
  // p1 : une révision due, une carte ratée aujourd'hui revenue à +10 min, une nouvelle ; p2 : deux révisions dues
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a'), carte('b'), carte('c')]), paquet('p2', [carte('x'), carte('y')])],
    srs: { p1: { a: du(), b: etat(T - 20 * MIN, T - 10 * MIN) }, p2: { x: du(1), y: du(2) } },
    reponses: [ligne('b', T - 20 * MIN, { verdict: 'faux', note: 1, nouvelle: false })],
    reglages: { nouvellesParJour: 5 },
  });
  assert.equal(aReviser(d, T, 'p1').length, 2);
  assert.deepEqual(apportDuFiltre(d, T, 'p1'), { revisions: 1, reprises: 1, nouvelles: 1 });
  assert.deepEqual(apportDuFiltre(d, T, 'p2'), { revisions: 2, reprises: 0, nouvelles: 0 });
  assert.deepEqual(apportDuFiltre(d, T), { revisions: 3, reprises: 1, nouvelles: 1 });
  // l'en-tête compte les mêmes révisions (sans la reprise)
  assert.equal(revisionsRestantes(d, T), 3);
});

test('revisionsEnAvance : jamais une carte déjà répondue aujourd\'hui', () => {
  const d = donneesDe({
    paquets: [paquet('p1', [carte('a'), carte('b'), carte('c')])],
    // a et b répondues aujourd'hui (dues demain), c revue hier (due dans 3 jours)
    srs: { p1: { a: etat(T - HEURE, T + JOUR), b: etat(T - 2 * HEURE, T + JOUR), c: futur(3) } },
    reglages: { nouvellesParJour: 0 },
  });
  assert.deepEqual(revisionsEnAvance(d, T).map(x => x.carteId), ['c']);
  const s = new Seance({ donnees: d, maintenant: T, enAvance: true });
  assert.equal(s.enAvance, true);
  assert.deepEqual(idsCartes(parcourir(s)), ['c']);
  // tout a été répondu aujourd'hui : rien en avance
  d.srs.p1.c = etat(T - MIN, T + 2 * JOUR);
  assert.deepEqual(revisionsEnAvance(d, T), []);
  const vide = new Seance({ donnees: d, maintenant: T, enAvance: true });
  assert.equal(vide.enAvance, false);
  assert.equal(vide.etape().type, 'fin');
});

test('objectifDuJour : un paquet qui n\'a que des nouvelles ne suffit pas quand les révisions manquent ailleurs', () => {
  // p1 : 61 révisions dues ; p2 : 30 nouvelles ; 23 révisions et 30 nouvelles faites (objectif 60, plafond 90)
  const d = journee({ dues: 61, revisionsFaites: 23, nouvellesFaites: 30, plafond: 90 });
  d.paquets.p2 = paquet('p2', Array.from({ length: 30 }, (_, i) => carte(`m${i}`)));
  d.ordre = ['p2', 'p1'];
  for (const c of d.paquets.p2.cartes) d.cartes[c.id] = { paquet: 'p2', carte: c };
  const o = objectifDuJour(d, T, 60);
  assert.deepEqual([o.encore, o.encoreRevisions], [37, 37]);
  const p2 = apportDuFiltre(d, T, 'p2');
  assert.deepEqual(p2, { revisions: 0, reprises: 0, nouvelles: 30 });
  assert.ok(p2.revisions < o.encoreRevisions, 'la séance sur p2 seule ne suffit pas');
  const tout = apportDuFiltre(d, T);
  assert.ok(tout.revisions >= o.encoreRevisions && tout.revisions + tout.nouvelles >= o.encore, '« Tout » suffit');
});

test('revisionsRestantes : dues aujourd\'hui et pas encore répondues aujourd\'hui', () => {
  const now = Date.parse('2026-10-15T20:00:00+02:00');
  const hier = now - JOUR;
  const donnees = {
    srs: { p: {
      a: { last: hier - JOUR, due: hier },                     // en retard : due
      b: { last: now - HEURE, due: now + JOUR },               // répondue aujourd'hui
      c: { last: hier, due: now + 2 * HEURE },                 // due ce soir
      d: { last: hier, due: Date.parse('2026-10-16T08:00:00+02:00') },   // demain
      e: { last: now - 5 * MIN, due: now + 5 * MIN },          // ratée aujourd'hui : revient à +10 min
    } },
  };
  assert.equal(revisionsRestantes(donnees, now), 2);
  assert.equal(revisionsRestantes({}, now), 0);
});

test('Seance : révisions d\'abord, puis les nouvelles pour compléter, même si l\'objectif n\'est pas atteint', () => {
  const now = Date.parse('2026-10-15T20:00:00+02:00');
  const hier = now - JOUR;
  const donnees = {
    paquets: { p: { id: 'p', nom: 'p', cartes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] } }, ordre: ['p'],
    srs: { p: { a: { last: hier - JOUR, due: hier, reps: 1, s: 1, d: 5, lapses: 0 }, b: { last: now - HEURE, due: now + JOUR, reps: 1, s: 1, d: 5, lapses: 0 } } },
    reglages: { nouvellesParJour: 5, objectifJour: 60 }, reponses: [], cartes: {},
  };
  const s = new Seance({ donnees, maintenant: now, rnd: () => 0 });
  assert.deepEqual(s.file.map(x => x.carteId), ['a', 'c', 'd']);
  // l'ancienne option « nouvelles d'abord » n'existe plus : elle est ignorée
  const s2 = new Seance({ donnees, maintenant: now, nouvellesDAbord: true, rnd: () => 0 });
  assert.deepEqual(s2.file.map(x => x.carteId), ['a', 'c', 'd']);
  // nouvelles jusqu'au plafond seulement (nouvellesParJour), après les révisions
  const s3 = new Seance({ donnees: { ...donnees, reglages: { nouvellesParJour: 1, objectifJour: 60 } }, maintenant: now, rnd: () => 0 });
  assert.deepEqual(s3.file.map(x => x.carteId), ['a', 'c']);
});

test('Seance : une carte ratée revient dans la séance et ne compte qu\'une fois', () => {
  const d = donneesDe({ paquets: [paquet('p1', [carte('a'), carte('b')])], srs: { p1: { a: du() } }, reglages: { nouvellesParJour: 5 } });
  const s = new Seance({ donnees: d, maintenant: T, rnd: () => 0 });
  const verdicts = ['faux', 'juste', 'juste'];
  let t = T;
  const vus = [];
  for (const verdict of verdicts) {
    const e = s.etape();
    assert.equal(e.type, 'carte');
    vus.push(e.carte.id);
    t += MIN;
    const { ops } = s.noter({ verdict, correcteur: 'local', maintenant: t, appareil: 'test' });
    for (const op of ops) {
      if (op.type === 'reponse') d.reponses.push(op.ligne);
      else (d.srs[op.paquet] ??= {})[op.carte] = op.etat;
    }
  }
  assert.deepEqual(vus, ['a', 'b', 'a']);
  assert.equal(s.etape().type, 'fin');
  assert.deepEqual(cartesDuJour(d, t), { cartes: 2, nouvelles: 1, revisions: 1, qcm: 0, qcmComptees: 0 });
});
