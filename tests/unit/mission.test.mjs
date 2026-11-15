// Mode Mission : choix des QCM (Éclair), des pièges (vrai/faux), journal, série de jours, bilan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { choisirEclair, choisirPieges, lignePiege, serieJours, bilanMission, entrelacer, estNegatif, idPiege, NIVEAUX } from '../../js/mission.js';
import { JOUR, isoParis } from '../../js/temps.js';
import { vue, appliquerOp } from '../../js/depot.js';

const T = Date.parse('2026-11-16T09:00:00Z');   // lundi 16 nov. 2026, 10:00 à Paris

function graine(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const qcm = (id, ue, cours, vrais, extra = {}) => ({
  id, ue, cours, source: 'claude', statut: 'valide', maj: 0, verifie: true, enonce: `Concernant ${id} :`,
  propositions: ['A', 'B', 'C', 'D', 'E'].map(l => ({ l, t: `${id} ${l}`, vrai: vrais.includes(l), expl: '' })), ...extra,
});
const annale = (id, ue, vrais, extra = {}) => qcm(id, ue, `annales-${ue}`, vrais, { source: 'annale', ...extra });

function donnees({ qcms, qcmJournal = [], vfJournal = [] }) {
  return {
    paquets: { 'ai-cm01': { ue: 'ai', cartes: [{ id: 'c1' }] }, 'bmq-cm01': { ue: 'bmq', cartes: [{ id: 'c2' }] } },
    ordre: ['ai-cm01', 'bmq-cm01'],
    srs: { 'ai-cm01': { c1: { due: 0 } } },   // seul le cours d'AI est commencé
    qcm: Object.fromEntries(qcms.map(q => [q.id, q])), qcmJournal, vfJournal, reglages: {},
  };
}

test('Éclair : cours commencés et annales de leurs UE seulement, dus en premier', () => {
  const qs = [qcm('ai1', 'ai', 'ai-cm01', ['A']), annale('ann-ai', 'ai', ['B']), annale('ann-bmq', 'bmq', ['C']), qcm('bmq1', 'bmq', 'bmq-cm01', ['A'])];
  const rate = { id: 'x', ts: T - 3 * JOUR, qcm: 'bmq1', cochees: [], points: 0 };
  const choix = choisirEclair(donnees({ qcms: qs, qcmJournal: [rate] }), T, { n: 10, rnd: graine(3) });
  assert.equal(choix[0].id, 'bmq1');   // dû (raté il y a 3 jours) même hors des cours commencés
  assert.deepEqual(choix.slice(1).map(q => q.id).sort(), ['ai1', 'ann-ai']);
});

test('Éclair : aucune UE commencée → toutes les annales', () => {
  const d = donnees({ qcms: [annale('a1', 'ai', ['A']), annale('b1', 'bmq', ['A'])] });
  d.srs = {};
  assert.equal(choisirEclair(d, T, { n: 5, rnd: graine(1) }).length, 2);
});

test('entrelacer : les UE alternent', () => {
  const l = ['a', 'a', 'a', 'b', 'b', 'b'].map((ue, i) => ({ ue, i }));
  const s = entrelacer(l, graine(7)).map(x => x.ue);
  for (let i = 1; i < s.length; i++) assert.notEqual(s[i], s[i - 1]);
});

test('estNegatif : énoncés à la forme négative écartés des pièges', () => {
  assert.ok(estNegatif('Quelle proposition est fausse ?'));
  assert.ok(estNegatif('Toutes sont exactes sauf :'));
  assert.ok(estNegatif('Lequel ne provoque pas de fièvre ?'));
  assert.ok(estNegatif('Indiquez la réponse erronée'));
  assert.ok(!estNegatif('Concernant le nez et les fosses nasales :'));
});

test('Pièges : un par QCM, surtout des fausses, QCM exclus et dossiers écartés', () => {
  const qs = [];
  for (let i = 0; i < 30; i++) qs.push(annale(`q${i}`, 'ai', ['A', 'B']));
  qs.push(annale('dp', 'ai', ['A'], { contexte: 'Un homme de 40 ans…' }));
  qs.push(annale('neg', 'ai', ['A'], { enonce: 'Laquelle est fausse ?' }));
  const p = choisirPieges(donnees({ qcms: qs }), T, { n: 20, exclure: ['q0'], rnd: graine(5) });
  assert.equal(p.length, 20);
  assert.equal(new Set(p.map(x => x.qcm)).size, 20);
  assert.ok(!p.some(x => ['q0', 'dp', 'neg'].includes(x.qcm)));
  assert.equal(p.filter(x => !x.vrai).length, 12);
  assert.equal(p[0].id, idPiege(p[0].qcm, p[0].l));
});

test('Pièges : ratés d\'hier et propositions ratées en QCM d\'abord ; ratés du jour et réussis non repris', () => {
  const qs = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => annale(x, 'ai', ['A']));
  const vf = [
    { item: 'a:B', ts: T - JOUR, ok: false },   // raté hier → revient
    { item: 'b:C', ts: T - 60000, ok: false },  // raté ce matin → pas encore
    { item: 'c:A', ts: T - JOUR, ok: true },    // réussi → ne revient pas
  ];
  const qj = [{ qcm: 'd', ts: T - JOUR, cochees: ['A', 'E'], points: 0.5 }];   // E cochée à tort
  const p = choisirPieges(donnees({ qcms: qs, vfJournal: vf, qcmJournal: qj }), T, { n: 2, rnd: graine(2) });
  assert.deepEqual(p.map(x => x.id).sort(), ['a:B', 'd:E']);
});

test('lignePiege : juste, raté, temps écoulé', () => {
  const item = { id: 'q:A', qcm: 'q', l: 'A', cours: 'annales-ai', ue: 'ai', vrai: false };
  const l = lignePiege({ item, reponse: false, duree: 4000, maintenant: T, appareil: 'tel', niveau: 'or' });
  assert.deepEqual(l, { id: 'tel-' + T, ts: T, t: isoParis(T), appareil: 'tel', item: 'q:A', qcm: 'q', l: 'A', cours: 'annales-ai', ue: 'ai', reponse: false, vrai: false, ok: true, duree: 4000, niveau: 'or' });
  assert.equal(lignePiege({ item, reponse: null, duree: 0, maintenant: T }).ok, false);
});

test('serieJours : jours d\'affilée, aujourd\'hui ou jusqu\'à hier', () => {
  const j = [T - 2 * JOUR, T - JOUR, T - JOUR + 1000].map(ts => ({ ts }));
  assert.equal(serieJours(j, T), 2);
  assert.equal(serieJours([...j, { ts: T }], T), 3);
  assert.equal(serieJours([{ ts: T - 3 * JOUR }], T), 0);
});

test('bilanMission : taux, meilleure série, réussite à 60 %', () => {
  const b = bilanMission({ qcm: [{ ts: 1, points: 1 }, { ts: 2, points: 0.5 }], pieges: [{ ts: 3, ok: true }, { ts: 4, ok: true }, { ts: 5, ok: false }] });
  assert.equal(b.ptsQcm, 1.5);
  assert.equal(b.justes, 2);
  assert.equal(b.meilleure, 2);
  assert.equal(b.taux, 3.5 / 5);
  assert.ok(b.reussie);
  assert.ok(!bilanMission({}).reussie);
});

test('niveaux : de plus en plus de questions, de moins en moins de temps', () => {
  const [b, o, d] = [NIVEAUX.bronze, NIVEAUX.or, NIVEAUX.diamant];
  assert.ok(b.qcm < o.qcm && o.qcm < d.qcm && b.chronoQcm > o.chronoQcm && o.chronoQcm > d.chronoQcm);
  assert.ok(b.rattrapage && !d.rattrapage);
});

test('dépôt : vf-reponse va dans progres/vf/AAAA-MM.jsonl ; nom des fichiers QCM gardé', () => {
  const objets = { 'rappel/qcm/annales-ai.json': { cours: 'annales-ai', ue: 'ai', nom: 'Annales · Agents infectieux', qcm: [annale('a', 'ai', ['A'])] } };
  const ligne = lignePiege({ item: { id: 'a:A', qcm: 'a', l: 'A', cours: 'annales-ai', ue: 'ai', vrai: true }, reponse: true, duree: 1, maintenant: T, appareil: 'pc' });
  appliquerOp(objets, { type: 'vf-reponse', ligne });
  appliquerOp(objets, { type: 'vf-reponse', ligne });   // rejouée : rien de plus
  assert.deepEqual(objets['rappel/progres/vf/2026-11.jsonl'], [ligne]);
  const d = vue(objets);
  assert.equal(d.vfJournal.length, 1);
  assert.equal(d.nomsQcm['annales-ai'], 'Annales · Agents infectieux');
});
