// QCM des cartes : leurres tirés des autres cartes, ordre mélangé, bonne réponse = partiel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { propositionsCarte, resultatQcmCarte, NB_PROPOSITIONS } from '../../js/qcmcartes.js';
import { normaliser } from '../../js/texte.js';

function graine(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const carte = (id, a, extra = {}) => ({ id, type: 'fait', q: `Question ${id} ?`, a, ...extra });
const donnees = {
  paquets: {
    p1: { ue: 'cardio', cartes: [carte('a', 'Le ventricule gauche.'), carte('b', "L'oreillette droite."), carte('c', 'Le ventricule droit.'),
      carte('d', 'le ventricule gauche'), carte('t', '', { type: 'cloze', q: 'Le {{nœud sinusal}} donne le rythme.' })] },
    p2: { ue: 'cardio', cartes: [carte('e', "L'aorte."), carte('f', 'La veine cave.')] },
    p3: { ue: 'peau', cartes: [carte('g', 'Le derme.')] },
  },
};

test('propositions : la bonne réponse et 3 leurres distincts, même paquet puis même UE', () => {
  const props = propositionsCarte(donnees.paquets.p1.cartes[0], 'p1', donnees, { rnd: graine(1) });
  assert.equal(props.length, NB_PROPOSITIONS);
  assert.deepEqual(props.filter(p => p.juste).map(p => p.texte), ['Le ventricule gauche.']);
  const textes = props.map(p => normaliser(p.texte));
  assert.equal(new Set(textes).size, textes.length, 'aucun doublon');
  assert.ok(!props.some(p => !p.juste && normaliser(p.texte) === normaliser('Le ventricule gauche.')), 'même réponse écrite autrement : pas un leurre');
  assert.ok(!props.some(p => p.texte === 'Le derme.'), 'une autre UE ne sert qu\'en dernier recours');
  assert.ok(!props.some(p => p.texte === 'nœud sinusal'), 'texte à trous : pas mêlé aux réponses ordinaires tant qu\'il y a mieux');
});

test('propositions : ordre différent d\'un tirage à l\'autre', () => {
  const ordres = new Set();
  for (let g = 1; g <= 10; g++) {
    ordres.add(propositionsCarte(donnees.paquets.p1.cartes[1], 'p1', donnees, { rnd: graine(g) }).map(p => p.texte).join('|'));
  }
  assert.ok(ordres.size >= 5, `ordres variés (${ordres.size})`);
  const places = new Set();
  for (let g = 1; g <= 20; g++) places.add(propositionsCarte(donnees.paquets.p1.cartes[1], 'p1', donnees, { rnd: graine(g) }).findIndex(p => p.juste));
  assert.ok(places.size >= 3, 'la bonne réponse change de place');
});

test('propositions : texte à trous, leurres pris ailleurs si besoin ; aucune autre carte = null', () => {
  const t = donnees.paquets.p1.cartes[4];
  const props = propositionsCarte(t, 'p1', donnees, { rnd: graine(2) });
  assert.equal(props.find(p => p.juste).texte, 'nœud sinusal');
  assert.equal(props.length, NB_PROPOSITIONS);
  assert.equal(propositionsCarte(carte('x', 'Seule.'), 'p9', { paquets: { p9: { cartes: [carte('x', 'Seule.')] } } }), null);
  assert.equal(propositionsCarte(carte('y', ''), 'p1', donnees), null);
});

test('résultat : bonne réponse = partiel, sinon faux ; correcteur « qcm »', () => {
  assert.deepEqual([resultatQcmCarte({ juste: true }).verdict, resultatQcmCarte({ juste: false }).verdict, resultatQcmCarte(null).verdict], ['partiel', 'faux', 'faux']);
  assert.equal(resultatQcmCarte({ juste: true }).correcteur, 'qcm');
});
