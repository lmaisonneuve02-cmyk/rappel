// Correction sur l'appareil : cartes synthétiques (aucune carte réelle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ideesDe, correspondanceDirecte, corrigerLocal, verifierBareme } from '../../js/correcteur.js';
import { refText, creerIdf, lev } from '../../js/texte.js';

const C = {
  vg: {
    id: 'x-vg', type: 'fait', q: "Quel ventricule s'hypertrophie dans le rétrécissement aortique serré ?", a: 'Le ventricule gauche.',
    bareme: { idees: [{ id: 'k1', texte: 'ventricule gauche', formulations: ['VG', 'cavité ventriculaire gauche'], obligatoire: true }] },
  },
  para: {
    id: 'x-para', type: 'fait', q: 'Quel système nerveux autonome ralentit la fréquence cardiaque ?', a: 'Le système parasympathique, par le nerf vague.',
    bareme: {
      idees: [{ id: 'k1', texte: 'parasympathique', formulations: ['système vagal', 'nerf vague'], obligatoire: true }],
      pieges: [{ si: 'sympathique', sauf: 'parasympathique', pourquoi: "Le sympathique accélère le cœur ; c'est le parasympathique qui le ralentit." }],
    },
  },
  effort: {
    id: 'x-effort', type: 'fait', q: 'Comment varie la fréquence cardiaque pendant un effort ?', a: 'Elle augmente.',
    bareme: { idees: [{ id: 'k1', texte: 'augmente', formulations: ['accélère', 'tachycardie'], obligatoire: true }] },
  },
  angor: {
    id: 'x-angor', type: 'fait', q: "Quel est le mécanisme de l'angor stable ?",
    a: "Une inadéquation entre les apports et les besoins en oxygène du myocarde, à l'effort.",
    bareme: {
      idees: [
        { id: 'k1', texte: 'inadéquation entre apports et besoins en oxygène du myocarde', obligatoire: true,
          formulations: ['déséquilibre entre apport et demande en O2', 'les besoins en oxygène du cœur dépassent les apports'] },
        { id: 'k2', texte: "à l'effort", formulations: ['pendant un exercice', 'quand le cœur travaille plus'], obligatoire: true },
        { id: 'k3', texte: 'cède au repos', formulations: ['disparaît au repos', 'calmée par le repos'], obligatoire: false },
      ],
    },
  },
  seuil: { id: 'x-seuil', type: 'fait', q: "Quel seuil de pression systolique définit l'hypertension au cabinet ?", a: '140 mmHg.' },
  souffle: { id: 'x-souffle', type: 'cloze', q: 'Le souffle du rétrécissement aortique est {{systolique}}, maximal au {{2e espace intercostal droit}}.' },
  idm: { id: 'x-idm', type: 'fait', q: 'Quelle complication redouter en cas de thrombose coronaire complète ?', a: 'Un infarctus du myocarde.' },
  fevg: { id: 'x-fevg', type: 'fait', q: 'Quel paramètre échographique mesure la fonction systolique ?', a: "La fraction d'éjection du ventricule gauche." },
  choc: { id: 'x-choc', type: 'fait', q: 'De quel côté bat le choc de pointe normal ?', a: 'À gauche.' },
  hta: { id: 'x-hta', type: 'fait', q: "Quelle maladie chronique est le premier facteur de risque d'AVC ?", a: "L'hypertension artérielle." },
  signes: { id: 'x-signes', type: 'fait', q: 'Signes cliniques de la thrombose veineuse profonde du mollet ?', a: 'Douleur du mollet, œdème unilatéral, chaleur locale (parfois fébricule).' },
};
const idf = creerIdf(Object.values(C));
const corr = (k, reponse, extra = {}) => corrigerLocal(C[k], reponse, { idf, ...extra });

test('la réponse attendue est jugée juste pour chaque carte', () => {
  for (const c of Object.values(C)) {
    const r = corrigerLocal(c, refText(c), { idf });
    assert.equal(r.verdict, 'juste', `${c.id} : ${JSON.stringify(r)}`);
    assert.deepEqual(r.erreurs, []);
  }
});

test('format commun du résultat', () => {
  const r = corr('vg', 'ventricule gauche');
  assert.deepEqual(Object.keys(r).sort(), ['confiance', 'correcteur', 'erreurs', 'explication', 'idees_manquantes', 'idees_trouvees', 'verdict']);
  assert.equal(r.correcteur, 'local');
  assert.equal(r.confiance, 0.6);
  assert.deepEqual(r.idees_trouvees, ['ventricule gauche']);
  assert.ok(r.explication.length > 0 && !/[{}<>]/.test(r.explication));
});

test('fautes de frappe et accents tolérés', () => {
  assert.equal(corr('vg', 'VENTRICULE GÀUCHÉ').verdict, 'juste');
  assert.equal(corr('vg', 'ventriculle gauhe').verdict, 'juste');
  assert.equal(corr('effort', 'elle augmnte').verdict, 'juste');
  assert.equal(corr('para', 'parasympatique').verdict, 'juste');
  assert.equal(corr('hta', 'hypertention arterielle').verdict, 'juste');
});

test('abréviations courantes (VG, IDM, HTA, EIC)', () => {
  assert.equal(corr('vg', 'le VG').verdict, 'juste');
  assert.equal(corr('idm', 'IDM').verdict, 'juste');
  assert.equal(corr('hta', 'HTA').verdict, 'juste');
  assert.equal(corr('souffle', 'systolique, 2e EIC droit').verdict, 'juste');
});

test('abréviations du carnet', () => {
  assert.equal(corr('fevg', 'FEVG').verdict, 'faux');
  const abreviations = { FEVG: "fraction d'éjection du ventricule gauche" };
  assert.equal(corr('fevg', 'FEVG', { abreviations }).verdict, 'juste');
});

test('paraphrase prévue par les formulations du barème', () => {
  const reponse = "déséquilibre entre offre et demande en O2 lors de l'exercice";
  assert.equal(corr('angor', reponse).verdict, 'juste');
  // Sans les formulations, la même paraphrase n'est pas reconnue.
  const nu = structuredClone(C.angor);
  for (const i of nu.bareme.idees) i.formulations = [];
  assert.notEqual(corrigerLocal(nu, reponse, { idf }).verdict, 'juste');
});

test('ordre différent accepté', () => {
  assert.equal(corr('angor', "à l'effort, les besoins en oxygène du myocarde dépassent les apports").verdict, 'juste');
  assert.equal(corr('signes', 'chaleur locale, œdème unilatéral et douleur du mollet').verdict, 'juste');
});

test('idée obligatoire manquante → partiel ; idée facultative non exigée', () => {
  const r = corr('angor', "à l'effort");
  assert.equal(r.verdict, 'partiel');
  assert.deepEqual(r.idees_trouvees, ["à l'effort"]);
  assert.deepEqual(r.idees_manquantes, ['inadéquation entre apports et besoins en oxygène du myocarde']);
  // k3 (facultative) absente : la réponse reste juste.
  assert.equal(corr('angor', "inadéquation apports besoins en oxygène du myocarde à l'effort").verdict, 'juste');
  // Trouvée, elle apparaît dans ce qui est juste.
  assert.ok(corr('angor', "inadéquation apports besoins en oxygène du myocarde à l'effort, cède au repos").idees_trouvees.includes('cède au repos'));
});

test('sans barème : idées déduites de la réponse attendue (parenthèses facultatives)', () => {
  const idees = ideesDe(C.signes);
  assert.deepEqual(idees.map(i => [i.texte, i.obligatoire]), [
    ['Douleur du mollet', true], ['œdème unilatéral', true], ['chaleur locale', true], ['parfois fébricule', false],
  ]);
  assert.equal(corr('signes', 'douleur du mollet, œdème unilatéral').verdict, 'partiel');
});

test('rien, ou sans rapport → faux', () => {
  const vide = corr('vg', '');
  assert.equal(vide.verdict, 'faux');
  assert.equal(vide.explication, "Tu n'as rien écrit.");
  assert.equal(corr('vg', '   ').verdict, 'faux');
  assert.equal(corr('angor', 'une valvulopathie').verdict, 'faux');
});

test('les mots de la question ne comptent pas', () => {
  // « ventricule » est dans la question : seul « gauche » départage.
  assert.equal(corr('vg', 'gauche').verdict, 'juste');
  assert.notEqual(corr('vg', 'le ventricule').verdict, 'juste');
});

test('piège : sympathique au lieu de parasympathique est refusé', () => {
  const r = corr('para', 'le système sympathique');
  assert.equal(r.verdict, 'faux');
  assert.deepEqual(r.erreurs, ["Le sympathique accélère le cœur ; c'est le parasympathique qui le ralentit."]);
  // Mot entier : « parasympathique » ne déclenche pas le piège.
  assert.deepEqual(corr('para', 'parasympathique').erreurs, []);
  // Idée trouvée mais piège présent → partiel, jamais juste.
  assert.equal(corr('para', 'le nerf vague, comme le sympathique').verdict, 'partiel');
});

test('piège : expression de plusieurs mots et clause « sauf »', () => {
  const carte = {
    id: 'x-pg', type: 'fait', q: 'Où siège le foyer aortique ?', a: '2e espace intercostal droit.',
    bareme: {
      idees: [{ id: 'k1', texte: '2e espace intercostal droit', formulations: ['2e EIC droit', 'deuxième espace intercostal droit'], obligatoire: true }],
      pieges: [{ si: 'bord gauche', sauf: 'pas au bord gauche', pourquoi: 'Le bord gauche du sternum, c\'est le foyer pulmonaire.' }],
    },
  };
  assert.equal(corrigerLocal(carte, '2e EIC droit, au bord gauche du sternum').verdict, 'partiel');
  assert.equal(corrigerLocal(carte, '2e EIC droit, pas au bord gauche').verdict, 'juste');
  assert.equal(corrigerLocal(carte, '2e EIC droit, bordure gauche').verdict, 'juste');
});

test('contresens : gauche/droite, augmente/diminue, hyper/hypo, systolique/diastolique', () => {
  const choc = corr('choc', 'à droite');
  assert.equal(choc.verdict, 'faux');
  assert.deepEqual(choc.erreurs, ['Tu as écrit « droite », la réponse attend « gauche ».']);
  const vg = corr('vg', 'ventricule droit');
  assert.equal(vg.verdict, 'faux');
  assert.equal(vg.erreurs.length, 1, 'un même contresens n\'est signalé qu\'une fois');
  const effort = corr('effort', 'elle diminue');
  assert.equal(effort.verdict, 'faux');
  assert.match(effort.erreurs[0], /diminue.*augmente/);
  assert.equal(corr('effort', 'bradycardie').verdict, 'faux');
  assert.equal(corr('effort', 'tachycardie').verdict, 'juste');
  assert.equal(corr('hta', 'hypotension artérielle').verdict, 'faux');
  const souffle = corr('souffle', 'diastolique, 2e espace intercostal droit');
  assert.equal(souffle.verdict, 'partiel');
  assert.match(souffle.erreurs[0], /diastolique.*systolique/);
});

test('nombres exacts', () => {
  assert.equal(corr('seuil', '140 mmHg').verdict, 'juste');
  const r = corr('seuil', '130 mmHg');
  assert.equal(r.verdict, 'faux');
  assert.deepEqual(r.erreurs, ['Chiffre inexact : la réponse attend 140, tu as écrit 130.']);
  const trou = corr('souffle', 'systolique, 3e espace intercostal droit');
  assert.equal(trou.verdict, 'partiel');
  assert.match(trou.erreurs[0], /attend 2, tu as écrit 3/);
});

test('unités facultatives à côté d\'un nombre : « 140 » vaut « 140 mmHg »', () => {
  assert.equal(corr('seuil', '140').verdict, 'juste');
  assert.equal(corr('seuil', '140mmHg').verdict, 'juste');
  assert.equal(corr('seuil', '140 cmH2O').verdict, 'juste');
  assert.equal(corr('seuil', '130').verdict, 'faux');
  const debit = { id: 'x-debit', type: 'fait', q: 'Débit cardiaque normal au repos ?', a: '5 L/min.',
    bareme: { idees: [
      { id: 'k1', texte: '5 L/min', formulations: ['5 litres par minute', '5000 mL/min'], obligatoire: true },
      { id: 'k2', texte: 'FC 70 bpm', formulations: ['fréquence 70 bpm', '70 battements par minute'], obligatoire: true },
    ] } };
  assert.equal(corrigerLocal(debit, '5, avec une FC à 70', { idf }).verdict, 'juste');
  assert.equal(corrigerLocal(debit, '5 l et fc 70', { idf }).verdict, 'juste');
  // sans nombre dans la phrase, le mot reste exigé (« MS » = membre supérieur)
  const ms = { id: 'x-ms', type: 'fait', q: 'Quel membre est touché ?', a: 'MS.' };
  assert.equal(corrigerLocal(ms, 'le membre supérieur', { idf }).verdict, 'juste');
  assert.equal(corrigerLocal(ms, 'aucun', { idf }).verdict, 'faux');
});

test('inversion de deux lettres voisines : une seule faute (« infractus »)', () => {
  assert.equal(lev('infarctu', 'infractu', 1), 1);
  assert.equal(lev('infarctu', 'infractu', 2), 1);
  assert.equal(lev('ab', 'ba', 1), 1);
  assert.equal(lev('abc', 'abc', 0), 0);
  assert.equal(lev('kitten', 'sitting', 3), 3);
  assert.equal(lev('abcdef', 'badcfe', 1), 2);   // arrêt anticipé : max + 1
  assert.equal(lev('abc', 'abcdef', 1), 2);
  assert.equal(lev('ca', 'abc', 3), 3);           // version restreinte : pas de modification après inversion
  assert.equal(corr('idm', 'un infractus du myocarde').verdict, 'juste');
  assert.equal(corr('idm', 'infarctus du myocrade').verdict, 'juste');
});

test('texte à trous : un trou = une idée obligatoire', () => {
  assert.deepEqual(ideesDe(C.souffle).map(i => [i.id, i.texte, i.obligatoire]), [
    ['t1', 'systolique', true], ['t2', '2e espace intercostal droit', true],
  ]);
  assert.equal(corr('souffle', 'systolique · 2e espace intercostal droit').verdict, 'juste');
  assert.equal(corr('souffle', '2e espace intercostal droit, systolique').verdict, 'juste');
  const r = corr('souffle', 'systolique');
  assert.equal(r.verdict, 'partiel');
  assert.deepEqual(r.idees_manquantes, ['2e espace intercostal droit']);
});

test('texte à trous : formulations du barème par trou', () => {
  const carte = {
    ...C.souffle,
    bareme: { idees: [
      { id: 't1', formulations: ['pendant la systole', 'systole'], obligatoire: true },
      { id: 't2', formulations: ['foyer aortique', '2e EIC droit'], obligatoire: true },
    ] },
  };
  assert.deepEqual(ideesDe(carte)[1].formulations, ['foyer aortique', '2e EIC droit']);
  assert.equal(corrigerLocal(carte, 'pendant la systole, au foyer aortique', { idf }).verdict, 'juste');
  assert.notEqual(corrigerLocal(C.souffle, 'pendant la systole, au foyer aortique', { idf }).verdict, 'juste');
});

test('idf facultatif ; « je ne sais pas » est traité ailleurs', () => {
  assert.equal(corrigerLocal(C.vg, 'ventricule gauche').verdict, 'juste');
  const r = corrigerLocal(C.vg, 'je ne sais pas');
  assert.equal(r.verdict, 'faux');
  assert.equal(r.correcteur, 'local');
});

test('carte sans réponse exploitable : faux, confiance nulle', () => {
  const r = corrigerLocal({ id: 'x-vide', type: 'fait', q: 'Question ?', a: '' }, 'quelque chose');
  assert.equal(r.verdict, 'faux');
  assert.equal(r.confiance, 0);
});

test('correspondanceDirecte : exact', () => {
  const r = correspondanceDirecte(C.vg, '  le Ventricule GAUCHE !');
  assert.equal(r.verdict, 'juste');
  assert.equal(r.correcteur, 'exact');
  assert.equal(r.confiance, 1);
  assert.deepEqual(r.idees_trouvees, ['ventricule gauche']);
  assert.deepEqual(r.idees_manquantes, []);
  // Texte à trous : réponses des trous jointes, séparateurs ignorés.
  assert.equal(correspondanceDirecte(C.souffle, 'Systolique · 2e espace intercostal droit').correcteur, 'exact');
  assert.equal(correspondanceDirecte(C.souffle, 'systolique, 2e espace intercostal droit').correcteur, 'exact');
  assert.equal(correspondanceDirecte(C.souffle, 'systolique 2e espace intercostal droit').correcteur, 'exact');
});

test('correspondanceDirecte : carnet, sinon null', () => {
  const carnet = { acceptees: ['Cavité ventriculaire gauche épaissie'], refusees: ['ventricule droit'] };
  const r = correspondanceDirecte(C.vg, 'cavite ventriculaire gauche epaissie', carnet);
  assert.equal(r.correcteur, 'carnet');
  assert.equal(r.verdict, 'juste');
  assert.equal(correspondanceDirecte(C.vg, 'ventricule droit', carnet), null);
  assert.equal(correspondanceDirecte(C.vg, 'gauche', carnet), null);
  assert.equal(correspondanceDirecte(C.vg, '', carnet), null);
  assert.equal(correspondanceDirecte(C.vg, 'gauche', undefined), null);
});

test('verifierBareme : barèmes corrects', () => {
  for (const k of ['vg', 'para', 'effort', 'angor']) assert.deepEqual(verifierBareme(C[k]), [], k);
  assert.deepEqual(verifierBareme(C.signes), [], 'sans barème : rien à vérifier');
});

test('verifierBareme : schéma, formulations, idée obligatoire', () => {
  const carte = {
    id: 'x-b', type: 'fait', q: 'Question ?', a: 'Réponse longue.',
    bareme: { idees: [
      { id: 'k1', texte: 'réponse longue', formulations: ['réponse étendue'], obligatoire: false },
      { id: 'k1', texte: '', formulations: ['a', 'A', 3], obligatoire: 'oui' },
      'pas un objet',
    ] },
  };
  const m = verifierBareme(carte).join('\n');
  assert.match(m, /idée k1 : il faut au moins 2 formulations \(1 ici\)/);
  assert.match(m, /identifiant en double/);
  assert.match(m, /« texte » manquant/);
  assert.match(m, /formulation en double/);
  assert.match(m, /formulation vide ou qui n'est pas un texte/);
  assert.match(m, /« obligatoire » doit valoir true ou false/);
  assert.match(m, /idée 3 : doit être un objet/);
  assert.match(m, /aucune idée obligatoire/);
  assert.deepEqual(verifierBareme({ ...carte, bareme: { idees: [] } }), ['barème : la liste « idees » est vide ou absente']);
  assert.deepEqual(verifierBareme({ ...carte, bareme: [] }), ['barème : doit être un objet {idees, pieges}']);
});

test('verifierBareme : pièges bien formés et compatibles avec la réponse attendue', () => {
  const base = structuredClone(C.para);
  base.bareme.pieges.push({ sauf: 'x' }, { si: 'vague', pourquoi: 'Contradictoire.' }, 'texte');
  const m = verifierBareme(base).join('\n');
  assert.match(m, /piège 2 : « si » manquant/);
  assert.match(m, /piège 2 : « pourquoi » manquant/);
  assert.match(m, /piège « vague » : se déclenche sur/);
  assert.match(m, /piège 4 : doit être un objet/);
  assert.doesNotMatch(m, /piège 1/);
});

test('piège avec « sauf » vide : pas d\'exception, barème valide', () => {
  const carte = structuredClone(C.vg);
  carte.bareme.pieges = [{ si: 'droit', sauf: '', pourquoi: 'Le ventricule droit lutte contre la pression pulmonaire.' }];
  assert.deepEqual(verifierBareme(carte), []);
  assert.deepEqual(corrigerLocal(carte, 'ventricule droit', { idf }).erreurs.slice(0, 1), ['Le ventricule droit lutte contre la pression pulmonaire.']);
  carte.bareme.pieges.push({ si: 'oreillette', sauf: 3, pourquoi: 'x' }, { si: 'aorte', sauf: ' !! ', pourquoi: 'x' });
  const m = verifierBareme(carte).join('\n');
  assert.match(m, /piège 2 : « sauf » doit être un texte \(vide s'il n'y a pas d'exception\)/);
  assert.match(m, /piège 3 : « sauf » ne contient aucun mot/);
});

test('verifierBareme : texte à trous', () => {
  const carte = { ...C.souffle, bareme: { idees: [
    { id: 't1', formulations: ['systole', 'pendant la systole'], obligatoire: true },
    { id: 't3', formulations: ['foyer aortique', '2e EIC droit'], obligatoire: false },
  ] } };
  const m = verifierBareme(carte).join('\n');
  assert.match(m, /idée t3 : pour un texte à trous, les identifiants vont de t1 à t2/);
  assert.match(m, /idée t3 : chaque trou est une idée obligatoire/);
  assert.doesNotMatch(m, /idée t1/);
});
