// Contrôle des données : dossiers synthétiques créés dans un répertoire temporaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifierDossier, formaterRapport, principal, SANS_BAREME } from '../../outils/verifier-donnees.mjs';

const OUTIL = join(dirname(fileURLToPath(import.meta.url)), '../../outils/verifier-donnees.mjs');
let racine;

async function ecrireDossier(nom, fichiers) {
  const dossier = join(racine, nom);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    await mkdir(dirname(join(dossier, chemin)), { recursive: true });
    await writeFile(join(dossier, chemin), typeof contenu === 'string' ? contenu : JSON.stringify(contenu, null, 1) + '\n');
  }
  return dossier;
}

const fiche = id => ({ id, title: 'Souffles du cœur', why: 'Pour ne plus confondre.', order: 1, blocks: [
  { k: 'h', t: 'Repères' },
  { k: 'p', t: 'Un souffle systolique est entendu entre B1 et B2.' },
  { k: 'pin', title: 'À retenir', lines: ['RAo : foyer aortique'] },
  { k: 'nums', items: [{ v: '140', l: 'mmHg : seuil au cabinet' }] },
  { k: 'table', head: ['Souffle', 'Temps'], rows: [[{ t: 'RAo', s: 'key' }, { t: 'systolique' }]] },
] });

const carteVg = {
  id: 'p1-01', type: 'fait', q: 'Quel ventricule s\'hypertrophie dans le rétrécissement aortique ?', a: 'Le ventricule gauche.', fiche: 'f-ok',
  bareme: { idees: [{ id: 'k1', texte: 'ventricule gauche', formulations: ['VG', 'cavité ventriculaire gauche'], obligatoire: true }],
    pieges: [{ si: 'droit', sauf: '', pourquoi: 'Le ventricule droit lutte contre la pression pulmonaire, pas aortique.' }] },
};
const carteTrou = {
  id: 'p1-02', type: 'cloze', q: 'Le souffle du rétrécissement aortique est {{systolique}}.', fiche: 'f-ok',
  bareme: { idees: [{ id: 't1', formulations: ['systole', 'pendant la systole'], obligatoire: true }] },
};
const qcm = (id, cours, autres = {}) => ({
  id, ue: 'cv', cours, source: 'claude', statut: 'valide', maj: 0, verifie: true, cartes: ['p1-01'],
  enonce: 'À propos du rétrécissement aortique :',
  propositions: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ l, t: `Proposition ${l}`, vrai: i === 0, expl: `Explication ${l}.` })),
  ...autres,
});
const plan = paquet => ({
  semestre: 'S5 test', maj: '2026-10-12', partiels: ['2026-12-14', '2026-12-16'], manquant: [],
  ues: [{ id: 'cv', nom: 'Cardio-vasculaire', cours: [
    { id: 'p1', titre: 'Valvulopathies', type: 'CM', num: '1', date: '2026-09-28', sources: [], paquet: 'p1', fiche: 'f-ok' },
    { id: 'c-futur', titre: 'Cours à venir', type: 'CM', num: '2', date: null, sources: [], paquet, fiche: 'f-absente-plan' },
  ] }],
});

const PROPRE = {
  'plan.json': { ...plan(null), ues: [{ ...plan(null).ues[0], cours: [plan(null).ues[0].cours[0]] }] },
  'fiches/f-ok.json': fiche('f-ok'),
  'paquets/p1.json': { id: 'p1', nom: 'CV · Valvulopathies', ue: 'cv', ordre: 1, source: 'synthétique', cartes: [carteVg, carteTrou] },
  'qcm/p1.json': { cours: 'p1', ue: 'cv', qcm: [qcm('p1-q01', 'p1')] },
};

const ABIME = {
  'plan.json': plan('p-absent'),
  'fiches/f-ok.json': fiche('f-ok'),
  'fiches/f-mal.json': { id: 'autre', title: '', why: 'x', order: 'un', blocks: [{ k: 'x' }, { k: 'pin', lines: [] }, { k: 'table', head: ['a', 'b'], rows: [[{ t: 'seul' }]] }] },
  'paquets/p1.json': { id: 'p1', nom: 'CV · Valvulopathies', ue: 'cv', ordre: 1, cartes: [carteVg, carteTrou] },
  'paquets/p2.json': { id: 'p2', nom: 'Cartes abîmées', ue: 'cv', ordre: 2, cartes: [
    { ...carteVg },                                                   // id en double
    { id: 'p2-02', type: 'autre', q: 'Question ?', a: 'Réponse.' },
    { id: 'p2-03', type: 'fait', q: 'Question sans réponse ?' },
    { id: 'p2-04', type: 'fait', q: 'Quel foyer pour le RAo ?', a: 'Foyer aortique.', fiche: 'f-absente' },
    { id: 'p2-05', type: 'fait', q: 'Quel ventricule s\'hypertrophie dans le RAo ?', a: 'Le ventricule gauche.',
      bareme: { idees: [{ id: 'k1', texte: 'oreillette droite', formulations: ['OD', 'atrium droit'], obligatoire: true }] } },
    { id: 'p2-06', type: 'fait', q: 'Quel bruit ?', a: 'B2 aboli.',
      bareme: { idees: [{ id: 'k1', texte: 'B2 aboli', formulations: ['B2 absent'], obligatoire: true }] } },
    { id: 'p2-07', type: 'cloze', q: 'Texte sans trou.' },
  ] },
  'paquets/casse.json': '{"id": "casse", ',
  'qcm/p1.json': { cours: 'p1', ue: 'cv', qcm: [
    qcm('p1-q01', 'p1'),
    qcm('p1-q01', 'p1', { cartes: ['p9-99'] }),
    qcm('p1-q03', 'p1', {
      source: 'internet', statut: 'publie', enonce: '',
      propositions: [{ l: 'A', t: 'x', vrai: false, expl: '' }, { l: 'C', t: 'y', vrai: false, expl: 'z' }],
    }),
  ] },
  'qcm/inconnu.json': { cours: 'inconnu', ue: 'cv', qcm: [] },
};

before(async () => { racine = await mkdtemp(join(tmpdir(), 'rappel-verif-')); });
after(async () => { await rm(racine, { recursive: true, force: true }); });

const messages = (liste, fichier, carte) => liste.filter(e => e.fichier === fichier && (carte === undefined || e.carte === carte)).map(e => e.message);

test('dossier propre : aucune erreur ni avertissement', async () => {
  const dossier = await ecrireDossier('propre', PROPRE);
  const r = await verifierDossier(dossier);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements, []);
  assert.equal(r.stats.paquets, 1);
  assert.equal(r.stats.cartes, 2);
  assert.equal(r.stats.cartesAvecBareme, 2);
  assert.equal(r.stats.qcm, 1);
  assert.equal(r.stats.coursPlan, 1);
  assert.equal(r.stats.plan, true);
  assert.match(formaterRapport(r, dossier), /Résultat : aucune erreur\. Les données sont prêtes\./);
});

test('dossier abîmé : cartes, barèmes, fiches', async () => {
  const dossier = await ecrireDossier('abime', ABIME);
  const { erreurs, avertissements } = await verifierDossier(dossier);
  const p2 = c => messages(erreurs, 'paquets/p2.json', c).join('\n');
  assert.match(p2('p1-01'), /identifiant en double \(déjà dans paquets\/p1\.json\)/);
  assert.match(p2('p2-02'), /type « autre » inconnu/);
  assert.match(p2('p2-03'), /réponse attendue « a » manquante/);
  assert.match(p2('p2-05'), /la réponse attendue est jugée « faux » par la correction de l'appareil \(il manque : « oreillette droite » ; erreur : .*droite.*/);
  assert.match(p2('p2-06'), /idée k1 : il faut au moins 2 formulations \(1 ici\)/);
  assert.match(p2('p2-07'), /texte à trous sans trou/);
  assert.match(messages(avertissements, 'paquets/p2.json', 'p2-04').join('\n'), /micro-fiche « f-absente » introuvable/);
  assert.ok(avertissements.some(a => a.carte === 'p2-04' && a.message === SANS_BAREME));
  assert.match(messages(erreurs, 'paquets/casse.json').join('\n'), /JSON illisible/);

  const fm = messages(erreurs, 'fiches/f-mal.json').join('\n');
  assert.match(fm, /identifiant « autre » différent du nom du fichier \(f-mal\)/);
  assert.match(fm, /titre « title » manquant/);
  assert.match(fm, /« order » doit être un nombre/);
  assert.match(fm, /bloc 1 : type « x » inconnu/);
  assert.match(fm, /bloc 2 \(pin\) : « lines »/);
  assert.match(messages(avertissements, 'fiches/f-mal.json').join('\n'), /ligne 1 : 1 cellule pour 2 colonnes/);
  assert.deepEqual(messages(erreurs, 'fiches/f-ok.json'), []);
  assert.deepEqual(messages(erreurs, 'paquets/p1.json'), []);
});

test('commentaire et moyen mnémotechnique : facultatifs, texte brut, longueur', async () => {
  const bon = { ...carteVg, commentaire: 'Le VG pousse contre l\'obstacle aortique : surcharge de pression, donc hypertrophie concentrique.', mnemo: 'RAo : le VG fait de la muscu.' };
  const mauvais = [
    { ...carteVg, id: 'p1-11', commentaire: '' },
    { ...carteVg, id: 'p1-12', mnemo: 42 },
    { ...carteVg, id: 'p1-13', commentaire: '<b>gras</b>' },
    { ...carteVg, id: 'p1-14', commentaire: 'x'.repeat(701) },
    { ...carteVg, id: 'p1-15', mnemo: 'Le ventricule gauche.' },
  ];
  const dossier = await ecrireDossier('commentaires', { ...PROPRE, 'paquets/p1.json': { ...PROPRE['paquets/p1.json'], cartes: [bon, carteTrou, ...mauvais] } });
  const { erreurs, avertissements } = await verifierDossier(dossier);
  const e = c => messages(erreurs, 'paquets/p1.json', c).join('\n');
  const a = c => messages(avertissements, 'paquets/p1.json', c).join('\n');
  assert.equal(e('p1-01') + a('p1-01'), '');
  assert.match(e('p1-11'), /« commentaire » doit être un texte non vide/);
  assert.match(e('p1-12'), /« mnemo » doit être un texte non vide/);
  assert.match(e('p1-13'), /« commentaire » : texte brut attendu, sans balise/);
  assert.match(a('p1-14'), /« commentaire » trop long \(701 caractères, 700 au plus\)/);
  assert.match(a('p1-15'), /« mnemo » répète la réponse attendue/);
});

test('listes d\'idées des feuilles blanches : identifiants, cartes du paquet, trous signalés', async () => {
  const dossier = await ecrireDossier('idees', { ...PROPRE,
    'idees/p1.json': { titre: 'Valvulopathies', idees: [
      { id: 'i1', texte: 'Le VG s\'hypertrophie', cartes: ['p1-01'] },
      { id: 'i1', texte: 'Doublon', cartes: [] },
      { id: 'i3', texte: '', cartes: ['p9-99'], importance: 'capital' },
    ] },
    'idees/inconnu.json': { idees: [{ id: 'i1', texte: 'x', cartes: [] }] },
  });
  const { erreurs, avertissements, stats } = await verifierDossier(dossier);
  const e = messages(erreurs, 'idees/p1.json').join('\n');
  assert.match(e, /idée i1 : identifiant en double/);
  assert.match(e, /idée i3 : « texte » manquant/);
  assert.match(e, /idée i3 : « importance » vaut essentiel ou utile/);
  assert.match(e, /idée i3 : carte « p9-99 » absente du paquet p1/);
  assert.match(messages(erreurs, 'idees/inconnu.json').join('\n'), /aucun paquet « inconnu »/);
  const a = messages(avertissements, 'idees/p1.json').join('\n');
  assert.match(a, /1 carte rattachée à aucune idée : p1-02/);
  assert.match(a, /1 idée sans carte \(trous à combler\)/);
  assert.equal(stats.idees, 2);
});

test('dossier abîmé : QCM et plan', async () => {
  const dossier = join(racine, 'abime');
  const { erreurs, avertissements, stats } = await verifierDossier(dossier);
  const q = c => messages(erreurs, 'qcm/p1.json', c).join('\n');
  assert.match(q('p1-q01'), /identifiant en double/);
  assert.match(messages(avertissements, 'qcm/p1.json', 'p1-q01').join('\n'), /carte « p9-99 » introuvable/);
  const q3 = q('p1-q03');
  for (const m of [/source « internet » inconnue/, /statut « publie » inconnu/, /énoncé « enonce » manquant/,
    /il faut 5 propositions, de A à E \(2 ici\)/, /proposition B : lettre « C » au lieu de « B »/,
    /proposition A : explication « expl » manquante/, /aucune proposition vraie/]) assert.match(q3, m);
  assert.match(messages(erreurs, 'qcm/inconnu.json').join('\n'), /cours « inconnu » inconnu \(absent du plan\)/);
  assert.match(messages(erreurs, 'plan.json').join('\n'), /cours « c-futur » : paquet « p-absent » introuvable/);
  assert.match(messages(avertissements, 'plan.json').join('\n'), /micro-fiche « f-absente-plan » introuvable/);
  assert.equal(stats.coursPlan, 2);
  assert.equal(stats.fichiersQcm, 2);
  const p2 = stats.parPaquet.find(p => p.id === 'p2');
  assert.equal(p2.cartes, 7);
  assert.equal(p2.erreurs, erreurs.filter(e => e.fichier === 'paquets/p2.json').length);
});

test('--exiger-baremes : une carte sans barème devient une erreur', async () => {
  const dossier = join(racine, 'abime');
  const souple = await verifierDossier(dossier);
  const strict = await verifierDossier(dossier, { exigerBaremes: true });
  assert.ok(!souple.erreurs.some(e => e.message === 'pas de barème'));
  assert.ok(strict.erreurs.some(e => e.carte === 'p2-04' && e.message === 'pas de barème'));
  assert.ok(!strict.avertissements.some(a => a.message === SANS_BAREME));
});

test('sans plan : les QCM se rattachent aux paquets', async () => {
  const { 'plan.json': _, ...sansPlan } = PROPRE;
  const dossier = await ecrireDossier('sans-plan', { ...sansPlan, 'qcm/p9.json': { cours: 'p9', ue: 'cv', qcm: [] } });
  const r = await verifierDossier(dossier);
  assert.equal(r.stats.plan, false);
  assert.deepEqual(r.erreurs.map(e => e.message), ['cours « p9 » inconnu (aucun paquet de ce nom)']);
  assert.match(formaterRapport(r), /Plan \(plan\.json\) : absent/);
});

test('sortie lisible : au plus 20 erreurs détaillées par paquet', async () => {
  const cartes = Array.from({ length: 25 }, (_, i) => ({ id: `m-${i}`, type: 'fait', q: 'Question ?' }));
  const dossier = await ecrireDossier('nombreuses', { 'paquets/m.json': { id: 'm', nom: 'Beaucoup', ue: 'cv', cartes } });
  const texte = formaterRapport(await verifierDossier(dossier), dossier);
  assert.match(texte, /✗ m : 25 cartes, 25 erreurs, 25 sans barème/);
  assert.equal((texte.match(/réponse attendue « a » manquante/g) || []).length, 20);
  assert.match(texte, /… et 5 autres/);
  assert.match(texte, /Résultat : 25 erreurs à corriger\./);
});

test('dossier introuvable ou vide', async () => {
  const r = await verifierDossier(join(racine, 'nulle-part'));
  assert.match(r.erreurs[0].message, /dossier introuvable/);
  const vide = await ecrireDossier('vide', { 'notes.txt': 'rien' });
  assert.match((await verifierDossier(vide)).erreurs[0].message, /aucun paquet trouvé/);
});

test('ligne de commande : codes de sortie, --json', async () => {
  const lancer = (...args) => spawnSync(process.execPath, [OUTIL, ...args], { encoding: 'utf8' });
  const propre = lancer(join(racine, 'propre'));
  assert.equal(propre.status, 0, propre.stderr);
  assert.match(propre.stdout, /✓ p1 : 2 cartes, 0 erreur/);

  const abime = lancer(join(racine, 'abime'));
  assert.equal(abime.status, 1);
  assert.match(abime.stdout, /✗ p2 : 7 cartes/);

  const json = lancer(join(racine, 'abime'), '--json');
  assert.equal(json.status, 1);
  const r = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(r), ['erreurs', 'avertissements', 'stats']);
  assert.ok(r.erreurs.every(e => typeof e.fichier === 'string' && typeof e.message === 'string'));
  assert.ok(r.erreurs.some(e => e.carte === 'p2-05'));

  assert.equal(lancer().status, 2);
  assert.equal(lancer(join(racine, 'propre'), '--inconnue').status, 2);
});

test('principal : écrit dans la sortie fournie', async () => {
  let sortie = '', erreurs = '';
  const code = await principal([join(racine, 'propre'), '--json'], { write: s => { sortie += s; } }, { write: s => { erreurs += s; } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(sortie).erreurs.length, 0);
  assert.equal(erreurs, '');
});
