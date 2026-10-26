// Feuille blanche : idées du cours, effets sur la séance et le SRS, journal, compte de la semaine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ideesDuCours, appliquerFeuille, ligneFeuille, feuillesDeLaSemaine, dernieresFeuilles, DUREE_MIN } from '../../js/feuille.js';
import { review, noteDe } from '../../js/fsrs.js';

const z = s => Date.parse(s);
const T = z('2026-10-29T10:00:00Z');   // jeudi
const carte = (id, q, a) => ({ id, type: 'fait', q, a });
const paquet = { id: 'p1', nom: 'Peau · CM1', ue: 'peau', cartes: [carte('c1', 'Couches de la peau ?', 'Épiderme, derme, hypoderme.'), carte('c2', 'Cellule majoritaire ?', 'Kératinocyte.'), carte('c3', 'Rôle des mélanocytes ?', 'Synthèse de mélanine.')] };
const etat = review(null, noteDe('juste'), T - 5 * 864e5);

test('idées : liste écrite par Claude si elle existe (cartes inconnues écartées), sinon une idée par carte', () => {
  const sans = ideesDuCours({ paquets: { p1: paquet } }, 'p1');
  assert.equal(sans.source, 'cartes');
  assert.deepEqual(sans.idees.map(i => [i.id, i.cartes]), [['c1', ['c1']], ['c2', ['c2']], ['c3', ['c3']]]);
  assert.equal(sans.idees[0].texte, 'Couches de la peau ? → Épiderme, derme, hypoderme.');
  const liste = { titre: 'La peau normale', idees: [
    { id: 'i1', texte: 'Trois couches', cartes: ['c1'] }, { id: 'i2', texte: 'Kératinocytes et mélanocytes', cartes: ['c2', 'c3', 'zz'], importance: 'utile' },
    { id: 'i3', texte: 'Annexes : poils, glandes', cartes: [] }, { texte: 'sans id' },
  ] };
  const avec = ideesDuCours({ paquets: { p1: paquet }, idees: { p1: liste } }, 'p1');
  assert.equal(avec.source, 'liste');
  assert.equal(avec.titre, 'La peau normale');
  assert.deepEqual(avec.idees.map(i => [i.id, i.cartes, i.importance]), [['i1', ['c1'], 'essentiel'], ['i2', ['c2', 'c3'], 'utile'], ['i3', [], 'essentiel']]);
});

test('effets : oubliées puis partielles en tête ; bien écrites déjà vues espacées, sans ligne de réponse', () => {
  const d = { paquets: { p1: paquet }, srs: { p1: { c1: etat, c3: etat } } };
  const idees = [{ id: 'i1', cartes: ['c1'] }, { id: 'i2', cartes: ['c2', 'c3'] }, { id: 'i3', cartes: ['c3'] }];
  const r = appliquerFeuille({ donnees: d, cours: 'p1', idees, statuts: { i1: 'presente', i2: 'absente', i3: 'partielle' }, maintenant: T });
  // c3 : le moins bon de ses idées (absente) ; c1 présente et déjà vue : révision « juste ».
  assert.deepEqual(r.priorite, [{ paquet: 'p1', carteId: 'c2' }, { paquet: 'p1', carteId: 'c3' }]);
  assert.deepEqual(r.ops, [{ type: 'srs', paquet: 'p1', carte: 'c1', etat: review(etat, noteDe('juste'), T) }]);
  assert.deepEqual([r.presentes, r.partielles, r.absentes, r.total], [1, 1, 1, 3]);
  // Carte présente jamais vue : rien (elle viendra comme nouvelle).
  const r2 = appliquerFeuille({ donnees: { paquets: { p1: paquet }, srs: {} }, cours: 'p1', idees, statuts: { i1: 'presente' }, maintenant: T });
  assert.deepEqual(r2.ops, []);
});

test('journal et semaine : mercredi → mardi, 5 minutes au moins', () => {
  const resultat = { statuts: { i1: 'presente' }, hors_liste: ['x'], ajouts: [], erreurs: [], presentes: 1, partielles: 0, absentes: 0, total: 1 };
  const l = ligneFeuille({ cours: 'p1', texte: 'trois couches  épiderme', duree: 600000.4, resultat, maintenant: T, appareil: 'tel', source: 'cartes' });
  assert.deepEqual([l.id, l.cours, l.duree, l.mots, l.presentes, l.source], [`tel-${T}`, 'p1', 600000, 3, 1, 'cartes']);
  const f = (iso, duree) => ({ ts: z(iso), duree, cours: 'p1', presentes: 1, total: 2 });
  const d = { feuilles: [
    f('2026-10-27T10:00:00Z', DUREE_MIN),        // mardi : semaine d'avant
    f('2026-10-28T08:00:00Z', DUREE_MIN),        // mercredi
    f('2026-10-29T08:00:00Z', DUREE_MIN - 1),    // trop courte
    f('2026-11-03T22:30:00Z', 600000),           // mardi 23 h 30 à Paris
    f('2026-11-03T23:30:00Z', 600000),           // mercredi suivant à Paris
  ] };
  assert.deepEqual(feuillesDeLaSemaine(d, T), { faites: 2, objectif: 10, atteinte: false, debut: '2026-10-28', fin: '2026-11-03' });
  assert.equal(feuillesDeLaSemaine(d, T, 2).atteinte, true);
  assert.equal(dernieresFeuilles(d).get('p1').ts, z('2026-11-03T23:30:00Z'));
});
