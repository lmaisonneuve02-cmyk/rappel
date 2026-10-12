// Mains libres : machine à états avec séance, correction, voix et enregistrement simulés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MainsLibres, texteVerdict, texteQcm } from '../../js/mainslibres.js';
import { scorer } from '../../js/qcm.js';
import { Seance } from '../../js/seance.js';

const T = Date.parse('2026-10-12T10:00:00Z');

const carte = (id, q, a) => ({ id, type: 'fait', q, a });
const C1 = carte('c1', 'Quel nerf innerve le diaphragme ?', 'Le nerf phrénique.');
const C2 = carte('c2', "Quelle valve sépare l'oreillette gauche du ventricule gauche ?", 'La valve mitrale.');
const etapeCarte = (c, rang = 1, total = 2) => ({ type: 'carte', paquet: 'p1', carte: c, etat: null, nouvelle: true, rang, total, restantes: total - rang + 1 });
const FIN = 'Séance terminée. ';

// Séance simulée : une liste d'étapes parcourue dans l'ordre.
class FausseSeance {
  constructor(etapes) {
    Object.assign(this, { etapes, i: 0, notes: [], passees: [], fichesVues: 0, reprises: 0 });
  }
  etape() { return this.etapes[this.i] ?? { type: 'fin', bilan: this.bilan }; }
  ficheVue() { this.fichesVues++; this.i++; }
  continuer() { this.reprises++; this.i++; }
  passer() { this.passees.push(this.etape().carte.id); this.i++; }
  noter(n) {
    const id = this.etape().carte.id;
    this.notes.push({ carte: id, ...n });
    this.i++;
    return { etatAvant: null, etatApres: {}, ligne: { id: `l-${id}` }, ops: [{ type: 'reponse', carte: id, verdict: n.verdict }] };
  }
  get bilan() { return { faites: this.notes.length }; }
}

class FausseParole {
  constructor() { this.dits = []; this.arrets = 0; }
  async dire(t) { this.dits.push(t); }
  arreter() { this.arrets++; }
}

// Écoute simulée : chaque demarrer() consomme une entrée du script (texte, {erreur: code} ou fonction).
class FausseEcoute extends EventTarget {
  constructor(script) {
    super();
    Object.assign(this, { script: [...script], appels: [], erreur: null, annulations: 0, surVide: null });
  }
  demarrer(options) {
    this.appels.push(options);
    this.erreur = null;
    if (!this.script.length) { this.surVide?.(); return Promise.resolve(''); }
    let x = this.script.shift();
    if (typeof x === 'function') x = x();
    if (x && typeof x === 'object') {
      this.erreur = { code: x.erreur, message: `Problème ${x.erreur}.` };
      return Promise.resolve('');
    }
    if (x) this.dispatchEvent(new CustomEvent('partiel', { detail: x }));
    return Promise.resolve(x);
  }
  annuler() { this.annulations++; }
}

// Correction simulée : juste si la réponse est exactement celle prévue.
function correcteur(justes) {
  const appels = [];
  const f = async ({ carte: c, reponse }) => {
    appels.push({ carte: c.id, reponse });
    const ok = justes[c.id] === reponse;
    return {
      resultat: { verdict: ok ? 'juste' : 'faux', idees_trouvees: [], idees_manquantes: ok ? [] : [c.a], erreurs: [],
        confiance: 0.9, explication: ok ? 'Bien.' : "Ce n'est pas la bonne valve.", correcteur: 'gemini' },
      ops: [{ type: 'carnet', carte: c.id }],
    };
  };
  f.appels = appels;
  return f;
}

function monter({ etapes = [], script = [], seance, ...options } = {}) {
  const s = seance === null ? null : new FausseSeance(etapes);
  const parole = new FausseParole();
  const ecoute = new FausseEcoute(script);
  const enregistres = [];
  const delais = [];
  const horloge = { setTimeout: (f, ms) => { delais.push(ms); queueMicrotask(f); return 0; }, clearTimeout: () => {} };
  const corriger = correcteur({ c1: 'le nerf phrénique', c2: 'la mitrale' });
  const ml = new MainsLibres({
    seance: s, corriger, parole, ecoute, enregistrer: async ops => { enregistres.push(...ops); },
    intro: false, maintenant: () => T, appareil: 'test', horloge, ...options,
  });
  const etats = [];
  ml.addEventListener('etat', e => etats.push(e.detail));
  ecoute.surVide = () => ml.arreter();   // script épuisé : on arrête (évite une attente sans fin)
  return { ml, seance: s, parole, ecoute, enregistres, corriger, etats, delais, phases: () => etats.map(e => e.phase) };
}

// Réagit à une phase (ex. touche « Reprendre » quand la pause s'affiche).
function quand(ml, phase, action) {
  ml.addEventListener('etat', e => { if (e.detail.phase === phase && e.detail.phase !== 'fin') setImmediate(() => action(e.detail)); });
}

// --- Textes ---

test('texteVerdict : juste, partiel (1re idée manquante), faux tronqué, hors ligne', () => {
  assert.equal(texteVerdict({ verdict: 'juste', correcteur: 'gemini' }, C1), 'Juste.');
  assert.equal(texteVerdict({ verdict: 'partiel', idees_manquantes: ['Le nerf phrénique.', 'C4'] }, C1), 'Partiel : il manquait le nerf phrénique.');
  assert.equal(texteVerdict({ verdict: 'faux', correcteur: 'local' }, C2), 'Faux. La réponse était : La valve mitrale.');
  assert.equal(texteVerdict({ verdict: 'juste', correcteur: 'hors-ligne' }, C1), 'Juste. Correction hors ligne.');
  const longue = carte('c3', 'Q ?', Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' '));
  const t = texteVerdict({ verdict: 'faux' }, longue);
  assert.match(t, /^Faux\. La réponse était : mot0 .* mot24…$/);
  assert.ok(t.split(' ').length <= 31);
});

test('texteQcm : points et bonnes lettres', () => {
  const q = { propositions: ['A', 'B', 'C', 'D', 'E'].map(l => ({ l, vrai: l === 'A' || l === 'C' })) };
  assert.equal(texteQcm({ points: 1, cochees: ['A', 'C'] }, q), "Tu as dit A et C : 1 point, c'est tout juste.");
  assert.equal(texteQcm({ points: 0.5, cochees: ['A'] }, q), 'Tu as dit A : 0,5 point. Les bonnes réponses : A et C.');
});

// --- Déroulé ---

test('deux cartes : juste puis faux ; micro ouvert 250 ms après la voix ; écoute de 3 s après le verdict', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1), etapeCarte(C2, 2)], script: ['le nerf phrénique', '', 'la tricuspide', ''] });
  const bilan = await m.ml.demarrer();
  assert.deepStrictEqual(m.parole.dits, [
    C1.q, 'Juste.', C2.q, 'Faux. La réponse était : La valve mitrale.', FIN + '2 réponses, dont 1 juste.',
  ]);
  assert.deepStrictEqual(m.seance.notes.map(n => [n.carte, n.verdict, n.correcteur, n.reponse]), [
    ['c1', 'juste', 'gemini', 'le nerf phrénique'], ['c2', 'faux', 'gemini', 'la tricuspide'],
  ]);
  assert.deepStrictEqual(m.ecoute.appels, [undefined, { attente: 3000 }, undefined, { attente: 3000 }]);
  assert.deepStrictEqual(m.delais, [250, 250, 250, 250]);
  assert.deepStrictEqual(m.enregistres.map(o => o.type), ['carnet', 'reponse', 'carnet', 'reponse']);
  const phases = m.phases();
  for (const p of ['question', 'ecoute', 'correction', 'verdict', 'attente-commande']) assert.ok(phases.includes(p), p);
  assert.equal(phases.at(-1), 'fin');
  assert.equal(phases.indexOf('question') < phases.indexOf('ecoute'), true);
  assert.equal(phases.indexOf('correction') < phases.indexOf('verdict'), true);
  assert.equal(bilan.reponses, 2);
  assert.equal(bilan.justes, 1);
  assert.equal(bilan.fausses, 1);
  // texte reconnu en direct pendant l'écoute
  assert.ok(m.etats.some(e => e.phase === 'ecoute' && e.partiel === 'le nerf phrénique'));
  // le verdict affiché porte le résultat et la carte
  const verdict = m.etats.find(e => e.phase === 'verdict' && e.carte?.id === 'c2');
  assert.equal(verdict.resultat.verdict, 'faux');
  assert.equal(verdict.reponse, 'la tricuspide');
});

test('« répète » relit la question, puis relit le verdict', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: ['répète', 'le nerf phrénique', 'répète', ''] });
  await m.ml.demarrer();
  assert.deepStrictEqual(m.parole.dits, [C1.q, C1.q, 'Juste.', 'Juste.', FIN + '1 réponse, dont 1 juste.']);
  assert.equal(m.corriger.appels.length, 1);
});

test('« je ne sais pas » : faux sans appel au correcteur, la réponse est dite', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: ['je ne sais pas', ''] });
  await m.ml.demarrer();
  assert.equal(m.corriger.appels.length, 0);
  assert.deepStrictEqual(m.seance.notes.map(n => [n.verdict, n.correcteur]), [['faux', 'je-ne-sais-pas']]);
  assert.equal(m.parole.dits[1], 'La réponse était : Le nerf phrénique.');
});

test('« suivant » passe la carte sans la noter', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 2), etapeCarte(C2, 2, 2)], script: ['suivant', 'la mitrale', ''] });
  await m.ml.demarrer();
  assert.deepStrictEqual(m.seance.passees, ['c1']);
  assert.deepStrictEqual(m.seance.notes.map(n => n.carte), ['c2']);
  assert.deepStrictEqual(m.parole.dits.slice(0, 4), [C1.q, 'On passe.', C2.q, 'Juste.']);
});

test('pause au bouton puis reprendre : la question est relue', async () => {
  let m;
  m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: [() => { m.ml.pause(); return ''; }, 'le nerf phrénique', ''] });
  const reprises = [];
  quand(m.ml, 'pause', d => { if (d.recuperable) { reprises.push(d.message); m.ml.reprendre(); } });
  await m.ml.demarrer();
  assert.equal(reprises.length, 1);
  assert.ok(m.ecoute.annulations >= 1);
  assert.deepStrictEqual(m.parole.dits, [C1.q, C1.q, 'Juste.', FIN + '1 réponse, dont 1 juste.']);
  assert.equal(m.seance.notes.length, 1);
});

test('« pause » à voix haute : annonce, attente de Reprendre, puis reprise', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: ['pause', 'le nerf phrénique', ''] });
  quand(m.ml, 'pause', d => { if (d.recuperable) m.ml.reprendre(); });
  await m.ml.demarrer();
  assert.ok(m.parole.dits.includes('Pause. Touche Reprendre pour continuer.'));
  assert.deepStrictEqual(m.seance.notes.map(n => n.verdict), ['juste']);
});

test('contestation acceptée : « Pourquoi ? », raison transmise, verdict corrigé', async () => {
  const appels = [];
  const contester = async args => {
    appels.push(args);
    return { accepte: true, resultat: { verdict: 'juste', correcteur: 'contestation', idees_manquantes: [], erreurs: [] },
      ops: [{ type: 'reponse', ligne: { correcteur: 'contestation', remplace: args.ligneId } }] };
  };
  const m = monter({ etapes: [etapeCarte(C2, 1, 1)], contester,
    script: ['la valve auriculo-ventriculaire gauche', 'je conteste', "c'est le nom de la mitrale"] });
  const bilan = await m.ml.demarrer();
  assert.deepStrictEqual(m.parole.dits.slice(1), [
    'Faux. La réponse était : La valve mitrale.', 'Pourquoi ?', 'Tu avais raison, je corrige.', FIN + '1 réponse, dont 1 juste.',
  ]);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].raison, "c'est le nom de la mitrale");
  assert.equal(appels[0].ligneId, 'l-c2');
  assert.equal(appels[0].resultat.verdict, 'faux');
  assert.equal(appels[0].reponse, 'la valve auriculo-ventriculaire gauche');
  assert.ok(m.enregistres.some(o => o.ligne?.correcteur === 'contestation'));
  assert.equal(bilan.justes, 1);
  assert.equal(bilan.fausses, 0);
});

test('contestation acceptée avec une vraie séance : la carte ne revient pas', async () => {
  const cartes = [C2, C1];
  const donnees = {
    paquets: { p1: { id: 'p1', nom: 'P1', cartes } }, ordre: ['p1'], fiches: {}, srs: {}, reponses: [],
    reglages: { nouvellesParJour: 15, pauseToutes: 30 }, historique: { days: {} },
    cartes: Object.fromEntries(cartes.map(c => [c.id, { paquet: 'p1', carte: c }])),
  };
  const seance = new Seance({ donnees, maintenant: T });
  const contester = async () => ({ accepte: true, resultat: { verdict: 'juste', correcteur: 'contestation', idees_manquantes: [], erreurs: [] }, ops: [] });
  const m = monter({ contester, script: ['la valve auriculo-ventriculaire gauche', 'je conteste', 'même sens', 'le nerf phrénique', ''] });
  m.ml.seance = seance;
  const bilan = await m.ml.demarrer();
  assert.deepStrictEqual(m.corriger.appels.map(a => a.carte), ['c2', 'c1']);   // c2 ne revient pas après c1
  assert.equal(seance.etape().type, 'fin');
  assert.deepStrictEqual([seance.bilan.justes, seance.bilan.fausses], [2, 0]);
  assert.deepStrictEqual([bilan.justes, bilan.fausses], [2, 0]);
});

test('contestation refusée : « Je maintiens : … »', async () => {
  const contester = async () => ({ accepte: false, resultat: { verdict: 'faux', explication: "La tricuspide est à droite." }, ops: [] });
  const m = monter({ etapes: [etapeCarte(C2, 1, 1)], contester, script: ['la tricuspide', 'je conteste', 'je pensais à gauche'] });
  await m.ml.demarrer();
  assert.ok(m.parole.dits.includes('Je maintiens : la tricuspide est à droite.'));
});

test('micro-fiche : annoncée avant la nouvelle carte, on attend « suivant »', async () => {
  const fiches = { f1: { id: 'f1', title: 'Nerfs du thorax' } };
  const m = monter({ etapes: [{ type: 'fiche', ficheId: 'f1', paquet: 'p1' }, etapeCarte(C1, 1, 1)], fiches,
    script: ['suivant', 'le nerf phrénique', ''] });
  await m.ml.demarrer();
  assert.equal(m.parole.dits[0], "Nouvelle fiche : Nerfs du thorax. Lis-la à l'écran, puis dis : suivant.");
  assert.equal(m.parole.dits[1], C1.q);
  assert.equal(m.phases()[0], 'lecture-fiche');
  assert.equal(m.seance.fichesVues, 1);
  assert.deepStrictEqual(m.ecoute.appels[0], { attente: 15000 });
  assert.equal(m.etats.find(e => e.phase === 'lecture-fiche').fiche.title, 'Nerfs du thorax');
});

test('micro refusé (not-allowed) → attente-geste, « Toucher pour répondre », puis la séance continue', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: [{ erreur: 'not-allowed' }, 'le nerf phrénique', ''] });
  const gestes = [];
  quand(m.ml, 'attente-geste', d => { gestes.push(d); m.ml.geste(); });
  await m.ml.demarrer();
  assert.equal(gestes.length, 1);
  assert.equal(gestes[0].bouton, 'Toucher pour répondre');
  assert.equal(gestes[0].code, 'not-allowed');
  assert.equal(gestes[0].carte.id, 'c1');
  assert.deepStrictEqual(m.seance.notes.map(n => n.verdict), ['juste']);
  const phases = m.phases();
  assert.equal(phases[phases.indexOf('attente-geste') + 1], 'ecoute');   // l'écoute reprend dans le geste
});

test('rien entendu (no-speech) : « Je n\'ai rien entendu », nouvelle écoute ; deux fois → pause', async () => {
  let m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: [{ erreur: 'no-speech' }, 'le nerf phrénique', ''] });
  await m.ml.demarrer();
  assert.match(m.parole.dits[1], /^Je n'ai rien entendu/);
  assert.deepStrictEqual(m.seance.notes.map(n => n.verdict), ['juste']);

  m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: ['', '', 'le nerf phrénique', ''] });
  const pauses = [];
  quand(m.ml, 'pause', d => { if (d.recuperable) { pauses.push(d.message); m.ml.reprendre(); } });
  await m.ml.demarrer();
  assert.equal(pauses.length, 1);
  assert.match(pauses[0], /mis en pause/);
  assert.deepStrictEqual(m.seance.notes.map(n => n.verdict), ['juste']);
});

test('micro en panne (audio-capture) : pause avec le message, puis réessai', async () => {
  const m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: [{ erreur: 'audio-capture' }, 'le nerf phrénique', ''] });
  const messages = [];
  quand(m.ml, 'pause', d => { if (d.recuperable) { messages.push(d.message); m.ml.reprendre(); } });
  await m.ml.demarrer();
  assert.match(messages[0], /Problème audio-capture/);
  assert.deepStrictEqual(m.seance.notes.map(n => n.verdict), ['juste']);
});

test('« stop » à voix haute et arreter() au bouton terminent la séance', async () => {
  let m = monter({ etapes: [etapeCarte(C1, 1, 1)], script: ['stop'] });
  await m.ml.demarrer();
  assert.equal(m.phases().at(-1), 'fin');
  assert.match(m.parole.dits.at(-1), /^D'accord, j'arrête\./);

  m = monter({ etapes: [etapeCarte(C1, 1, 2), etapeCarte(C2, 2, 2)], script: [() => { m.ml.arreter(); return ''; }] });
  const bilan = await m.ml.demarrer();
  assert.equal(m.phases().at(-1), 'fin');
  assert.deepStrictEqual(m.parole.dits, [C1.q]);   // rien de plus n'est dit après le bouton
  assert.equal(bilan.reponses, 0);
});

test('QCM à voix haute : énoncé et propositions lus, lettres comprises au 2e essai, points et bonnes lettres', async () => {
  const qcm = (id, vrais) => ({
    id, enonce: `Énoncé ${id}`, propositions: ['A', 'B', 'C', 'D', 'E'].map(l => ({ l, t: `proposition ${l}`, vrai: vrais.includes(l) })),
  });
  const q1 = qcm('q1', ['B', 'D']), q2 = qcm('q2', ['A', 'C']);
  const lignes = [];
  const m = monter({
    seance: null, script: ['bonjour', 'bé et dé', 'A'],
    qcm: { questions: [q1, q2], scorer, ligne: a => { lignes.push(a); return { qcm: a.qcm.id, cochees: a.cochees, points: a.resultat.points }; } },
  });
  const bilan = await m.ml.demarrer();
  const d = m.parole.dits;
  assert.match(d[0], /Énoncé q1\. A : proposition A\. B : proposition B\. .* E : proposition E\. Quelles lettres \?$/);
  assert.equal(d[1], "Je n'ai pas compris, répète les lettres.");
  assert.equal(d[2], "Tu as dit B et D : 1 point, c'est tout juste.");
  assert.match(d[3], /^Question 2 sur 2\. Énoncé q2\./);
  assert.equal(d[4], 'Tu as dit A : 0,5 point. Les bonnes réponses : A et C.');
  assert.deepStrictEqual(lignes.map(l => l.cochees), [['B', 'D'], ['A']]);
  assert.deepStrictEqual(m.enregistres.map(o => [o.type, o.ligne.points]), [['qcm-reponse', 1], ['qcm-reponse', 0.5]]);
  assert.equal(bilan.qcm, 2);
  assert.equal(bilan.points, 1.5);
});

test('QCM : deux essais incompris → on passe à la suite', async () => {
  const q = { id: 'q1', enonce: 'Énoncé', propositions: ['A', 'B', 'C', 'D', 'E'].map(l => ({ l, t: l, vrai: l === 'A' })) };
  const m = monter({ seance: null, script: ['bonjour', 'au revoir'], qcm: { questions: [q], scorer } });
  const bilan = await m.ml.demarrer();
  assert.ok(m.parole.dits.includes("Je n'ai toujours pas compris. On passe à la suite."));
  assert.equal(bilan.qcm, 0);
});
