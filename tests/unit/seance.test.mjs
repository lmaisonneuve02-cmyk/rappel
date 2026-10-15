// Séance : compteurs du jour, file (révisions puis nouvelles), fiche, pause, notes, bilan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvellesDuJour, acquisesDuJour, aReviser, nouvellesPossibles, Seance } from '../../js/seance.js';
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

test('acquisesDuJour : dernière réponse du jour juste ou partielle, tous paquets', () => {
  const d = donneesDe({
    srs: {
      p1: { a: review(null, 3, T), b: review(null, 2, T), c: review(null, 1, T) },
      p2: { d: review(null, 3, T - JOUR), e: review(review(null, 1, T - HEURE), 3, T) },
      p3: {},
    },
  });
  assert.equal(acquisesDuJour(d, T), 3);              // a, b, e
  assert.equal(acquisesDuJour(d, T - JOUR), 1);       // d, la veille
  assert.equal(acquisesDuJour(donneesDe(), T), 0);
  assert.equal(acquisesDuJour({}, T), 0);
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
  const r2 = s.noter({ verdict: 'partiel', correcteur: 'auto', maintenant: t + MIN, appareil: 'pc' });
  assert.equal(r2.etatAvant, null);
  assert.deepStrictEqual(r2.etatApres, review(null, 2, t + MIN));
  assert.equal(r2.ligne.nouvelle, true);
  assert.equal(r2.ligne.note, 2);
  assert.equal(r2.ligne.reponse, '');
  assert.equal('duree' in r2.ligne, false);
  assert.equal('confiance' in r2.ligne, false);
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

test('revisionsRestantes et nouvellesDAbord (règle du 15/10)', async () => {
  const { Seance, revisionsRestantes } = await import('../../js/seance.js');
  const now = Date.parse('2026-10-15T20:00:00+02:00');
  const hier = now - 86400000;
  const donnees = {
    paquets: { p: { id: 'p', nom: 'p', cartes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }, ordre: ['p'],
    srs: { p: { a: { last: hier - 86400000, due: hier, reps: 1, s: 1, d: 5, lapses: 0 }, b: { last: now - 3600000, due: now + 86400000, reps: 1, s: 1, d: 5, lapses: 0 } } },
    reglages: { nouvellesParJour: 5 }, reponses: [], cartes: {},
  };
  assert.equal(revisionsRestantes(donnees, now), 1);
  const s = new Seance({ donnees, maintenant: now, nouvellesDAbord: true, rnd: () => 0 });
  assert.deepEqual(s.file.map(x => x.carteId), ['c', 'a']);
});
