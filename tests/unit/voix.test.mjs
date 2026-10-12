// Voix : commandes orales, lettres de QCM, écoute (reconnaissance simulée), parole (synthèse simulée), écran allumé.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconnaissanceDisponible, Ecoute, Parole, commande, lettresQcm, verrouEcran,
  fusionner, choisirVoix, decouperPhrases, dureeMax, messageEcoute,
} from '../../js/voix.js';

const vider = () => new Promise(r => setImmediate(r));

// Minuteries simulées : avancer(ms) déclenche dans l'ordre celles qui arrivent à échéance.
function fausseHorloge() {
  let t = 0, n = 0;
  const minuteries = new Map();
  return {
    setTimeout(f, ms) { minuteries.set(++n, { f, quand: t + (ms || 0) }); return n; },
    clearTimeout(id) { minuteries.delete(id); },
    avancer(ms) {
      const fin = t + ms;
      for (;;) {
        let prochain = null;
        for (const [id, m] of minuteries) if (m.quand <= fin && (!prochain || m.quand < prochain[1].quand)) prochain = [id, m];
        if (!prochain) break;
        minuteries.delete(prochain[0]);
        t = prochain[1].quand;
        prochain[1].f();
      }
      t = fin;
    },
  };
}

// Faux SpeechRecognition : chaque instance est gardée ; le test « parle » à sa place.
function fabriqueReco() {
  const instances = [];
  class FausseReco {
    constructor() { instances.push(this); this.demarree = false; }
    start() { this.demarree = true; }
    stop() { this.arretee = true; queueMicrotask(() => this.onend?.()); }
    abort() { this.annulee = true; queueMicrotask(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); }); }
    // segments : [texte, final?] ; reconstruits depuis results[0] comme dans Chrome
    dire(...segments) {
      const results = segments.map(([t, f]) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: !!f }));
      this.onresult?.({ results, resultIndex: 0 });
    }
    erreur(code) { this.onerror?.({ error: code }); this.onend?.(); }
    finir() { this.onend?.(); }
  }
  return { FausseReco, instances, derniere: () => instances[instances.length - 1] };
}

function ecouteSimulee(options = {}) {
  const horloge = fausseHorloge();
  const { FausseReco, instances, derniere } = fabriqueReco();
  const ecoute = new Ecoute({ Reco: FausseReco, horloge, ...options });
  const evts = [];
  for (const type of ['partiel', 'fin', 'erreur']) ecoute.addEventListener(type, e => evts.push([type, e.detail]));
  return { ecoute, horloge, instances, derniere, evts };
}

// --- reconnaissanceDisponible ---

test('reconnaissanceDisponible : standard, préfixe webkit, absente (Firefox)', () => {
  class A {}
  class B {}
  assert.equal(reconnaissanceDisponible({ SpeechRecognition: A, webkitSpeechRecognition: B }), A);
  assert.equal(reconnaissanceDisponible({ webkitSpeechRecognition: B }), B);
  assert.equal(reconnaissanceDisponible({}), null);
});

// --- commande ---

test('commande : énoncés entiers reconnus, avec hésitations et politesse', () => {
  const cas = {
    'Je ne sais pas': 'je-ne-sais-pas', "j'sais pas": 'je-ne-sais-pas', 'Aucune idée.': 'je-ne-sais-pas', 'je passe': 'je-ne-sais-pas',
    'Répète': 'repete', "Tu peux répéter s'il te plaît ?": 'repete', 'euh, répète la question': 'repete',
    'Suivant': 'suivant', 'question suivante': 'suivant', 'on passe à la suite': 'suivant',
    'Pause': 'pause', 'fais une pause': 'pause', 'attends': 'pause',
    'Reprendre': 'reprendre', 'on continue': 'reprendre',
    'Je conteste': 'conteste', "je ne suis pas d'accord": 'conteste',
    'Stop': 'stop', 'stop stop': 'stop', 'on arrête': 'stop',
  };
  for (const [texte, attendu] of Object.entries(cas)) assert.equal(commande(texte), attendu, texte);
});

test('commande : une réponse qui contient une commande n\'en est pas une', () => {
  for (const texte of ["je ne sais pas mais je dirais l'aorte", "l'aorte", 'la suite de Fibonacci', 'pause compensatoire',
    'je conteste le diagnostic de péricardite', '', '   ']) {
    assert.equal(commande(texte), null, texte);
  }
});

// --- lettresQcm ---

test('lettresQcm : lettres dites de plusieurs façons', () => {
  const cas = {
    'A et C': ['A', 'C'], 'a, c': ['A', 'C'], 'réponses B D': ['B', 'D'], 'bé et dé': ['B', 'D'], 'cé': ['C'],
    'A B C': ['A', 'B', 'C'], 'C et A': ['A', 'C'], 'toutes': ['A', 'B', 'C', 'D', 'E'], 'toutes sauf B': ['A', 'C', 'D', 'E'],
    "c'est A et E": ['A', 'E'], 'la réponse D': ['D'], 'A, A et B': ['A', 'B'],
  };
  for (const [texte, attendu] of Object.entries(cas)) assert.deepStrictEqual(lettresQcm(texte), attendu, texte);
});

test('lettresQcm : rien de clair → null', () => {
  for (const texte of ["l'aorte", 'je pense au ventricule', '', 'bonjour', 'A et le ventricule']) assert.equal(lettresQcm(texte), null, texte);
});

// --- fusion des segments (doublon de Chrome Android) ---

test('fusionner : segment cumulé remplacé, doublon ignoré, segment nouveau ajouté', () => {
  assert.equal(fusionner('le cœur', 'le cœur bat vite'), 'le cœur bat vite');
  assert.equal(fusionner('Le cœur', 'le cœur, bat vite'), 'le cœur, bat vite');
  assert.equal(fusionner('le cœur ba', 'le cœur bat vite'), 'le cœur bat vite');
  assert.equal(fusionner('le cœur bat vite', 'bat vite'), 'le cœur bat vite');
  assert.equal(fusionner('le cœur', 'le cœur'), 'le cœur');
  assert.equal(fusionner('le cœur', 'bat vite'), 'le cœur bat vite');
  assert.equal(fusionner('le ventricule gauche', 'le ventricule droit aussi'), 'le ventricule gauche le ventricule droit aussi');
  assert.equal(fusionner('', 'oui'), 'oui');
  assert.equal(fusionner('oui', ''), 'oui');
});

// --- Ecoute ---

test('Ecoute : continuous=false, interimResults=true, français, texte partiel en direct', async () => {
  const { ecoute, derniere, evts } = ecouteSimulee();
  ecoute.demarrer();
  const r = derniere();
  assert.equal(r.lang, 'fr-FR');
  assert.equal(r.continuous, false);
  assert.equal(r.interimResults, true);
  assert.ok(r.demarree);
  r.dire(['le cœur', false]);
  assert.deepStrictEqual(evts.at(-1), ['partiel', 'le cœur']);
  assert.ok(ecoute.active);
  ecoute.annuler();
});

test('Ecoute : relance tant que l\'on parle, arrêt après le silence, texte final accumulé', async () => {
  const { ecoute, horloge, instances, derniere, evts } = ecouteSimulee({ silence: 2500 });
  let fini = null;
  const p = ecoute.demarrer().then(t => { fini = t; });
  derniere().dire(['le cœur', false]);
  derniere().dire(['le cœur bat', true]);
  derniere().finir();                       // fin du cycle : relance automatique
  assert.equal(instances.length, 2);
  assert.ok(instances[1].demarree);
  derniere().dire(['vite', false]);
  derniere().dire(['vite', true]);
  horloge.avancer(2499);
  await vider();
  assert.equal(fini, null);
  horloge.avancer(1);                       // 2,5 s sans nouveau résultat
  await p;
  assert.equal(fini, 'le cœur bat vite');
  assert.ok(instances[1].arretee);
  assert.deepStrictEqual(evts.at(-1), ['fin', 'le cœur bat vite']);
  assert.equal(ecoute.erreur, null);
});

test('Ecoute : doublon de Chrome Android (segment final qui reprend le texte déjà acquis)', async () => {
  const { ecoute, horloge, derniere } = ecouteSimulee();
  const p = ecoute.demarrer();
  derniere().dire(['le cœur', true]);
  derniere().finir();
  derniere().dire(['le cœur bat vite', true]);   // Chrome Android renvoie tout depuis le début
  derniere().finir();
  derniere().dire(['bat vite', true]);           // simple répétition de la fin
  derniere().finir();
  // dans un même événement, résultats cumulés
  derniere().dire(['et fort', true], ['et fort la nuit', true]);
  horloge.avancer(2500);
  assert.equal(await p, 'le cœur bat vite et fort la nuit');
});

test('Ecoute : 8 s sans rien entendre → erreur no-speech, texte vide', async () => {
  const { ecoute, horloge, derniere, evts } = ecouteSimulee();
  let fini = null;
  const p = ecoute.demarrer().then(t => { fini = t; });
  horloge.avancer(5000);
  derniere().erreur('no-speech');            // le navigateur abandonne : on relance
  assert.equal(ecoute.active, true);
  horloge.avancer(2999);
  await vider();
  assert.equal(fini, null);
  horloge.avancer(1);
  await p;
  assert.equal(fini, '');
  assert.equal(ecoute.erreur.code, 'no-speech');
  assert.deepStrictEqual(evts.at(-1)[0], 'erreur');
  assert.match(evts.at(-1)[1].message, /rien entendu/);
});

test('Ecoute : attente du début réglable (3 s après un verdict)', async () => {
  const { ecoute, horloge } = ecouteSimulee();
  const p = ecoute.demarrer({ attente: 3000 });
  horloge.avancer(3000);
  assert.equal(await p, '');
  assert.equal(ecoute.erreur.code, 'no-speech');
});

test('Ecoute : erreurs du micro → événement erreur avec code et message simple', async () => {
  for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'aborted']) {
    const { ecoute, derniere, evts } = ecouteSimulee();
    const p = ecoute.demarrer();
    derniere().erreur(code);
    assert.equal(await p, '', code);
    const [type, detail] = evts.at(-1);
    assert.equal(type, 'erreur', code);
    assert.equal(detail.code, code);
    assert.equal(detail.message, messageEcoute(code));
    assert.notEqual(detail.message, messageEcoute('inconnu'), code);
    assert.deepStrictEqual(ecoute.erreur, detail);
    assert.equal(ecoute.active, false);
  }
});

test('Ecoute : arreter garde le texte, annuler l\'efface, pas de reconnaissance → indisponible', async () => {
  let s = ecouteSimulee();
  let p = s.ecoute.demarrer();
  s.derniere().dire(['bonjour', false]);
  s.ecoute.arreter();
  assert.equal(await p, 'bonjour');
  assert.equal(s.ecoute.erreur, null);

  s = ecouteSimulee();
  p = s.ecoute.demarrer();
  s.derniere().dire(['bonjour', true]);
  s.ecoute.annuler();
  assert.equal(await p, '');

  const sans = new Ecoute({ Reco: null });
  assert.equal(await sans.demarrer(), '');
  assert.equal(sans.erreur.code, 'indisponible');
});

// --- Parole ---

function fausseSynth({ voix = [], auto = true } = {}) {
  const s = new EventTarget();
  Object.assign(s, { voix, journal: [], enonces: [], speaking: false, pending: false });
  s.getVoices = () => s.voix;
  s.speak = u => {
    s.enonces.push(u);
    s.journal.push('speak');
    if (auto) queueMicrotask(() => { u.onstart?.(); queueMicrotask(() => u.onend?.()); });
  };
  s.cancel = () => { s.journal.push('cancel'); };
  return s;
}
class FausseUtterance { constructor(t) { this.text = t; } }

const VOIX = [
  { name: 'Samantha', lang: 'en-US', localService: true, default: true },
  { name: 'Google français', lang: 'fr-FR', localService: false },
  { name: 'Amélie', lang: 'fr-CA', localService: true },
  { name: 'Thomas', lang: 'fr_FR', localService: true },
];

test('choisirVoix : par nom, sinon fr-FR locale, sinon fr-FR, sinon fr', () => {
  assert.equal(choisirVoix(VOIX, 'Google français').name, 'Google français');
  assert.equal(choisirVoix(VOIX, 'Inconnue').name, 'Thomas');
  assert.equal(choisirVoix(VOIX.filter(v => v.name !== 'Thomas')).name, 'Google français');
  assert.equal(choisirVoix(VOIX.filter(v => !/^fr.FR$/.test(v.lang))).name, 'Amélie');
  assert.equal(choisirVoix([VOIX[0]]), null);
});

test('Parole.voixFrancaises : attend voiceschanged, fr-FR et locales d\'abord', async () => {
  const synth = fausseSynth();
  const parole = new Parole({ synth, Utterance: FausseUtterance, horloge: fausseHorloge() });
  const p = parole.voixFrancaises();
  synth.voix = VOIX;
  synth.dispatchEvent(new Event('voiceschanged'));
  assert.deepStrictEqual(await p, [
    { nom: 'Thomas', lang: 'fr-FR', locale: true },
    { nom: 'Google français', lang: 'fr-FR', locale: false },
    { nom: 'Amélie', lang: 'fr-CA', locale: true },
  ]);
});

test('decouperPhrases : énoncés courts, texte conservé', () => {
  const phrase = 'Le ventricule gauche éjecte le sang dans l\'aorte pendant la systole, puis se relâche pendant la diastole';
  const texte = `${phrase}. ${phrase}, ${phrase}! Court. ${'mot '.repeat(80).trim()}.`;
  const morceaux = decouperPhrases(texte, 160);
  assert.ok(morceaux.length >= 4);
  for (const m of morceaux) assert.ok(m.length <= 160, m);
  assert.equal(morceaux.join(' '), texte.replace(/\s+/g, ' '));
  assert.deepStrictEqual(decouperPhrases('Juste. Bien.'), ['Juste. Bien.']);
  assert.deepStrictEqual(decouperPhrases('  '), []);
});

test('Parole.dire : annule d\'abord, découpe par phrases, voix française, vitesse', async () => {
  const synth = fausseSynth({ voix: VOIX });
  const parole = new Parole({ synth, Utterance: FausseUtterance, vitesse: 1.2, horloge: fausseHorloge() });
  const long = Array.from({ length: 4 }, (_, i) => `Phrase numéro ${i + 1} assez longue pour remplir une bonne partie de l'énoncé, avec des détails.`).join(' ');
  await parole.dire(long);
  assert.equal(synth.journal[0], 'cancel');
  assert.ok(synth.enonces.length >= 2);
  assert.equal(synth.enonces.map(u => u.text).join(' '), long);
  for (const u of synth.enonces) {
    assert.equal(u.voice.name, 'Thomas');
    assert.equal(u.lang, 'fr-FR');
    assert.equal(u.rate, 1.2);
  }
});

test('Parole.dire : garde-fou si onend ne vient jamais', async () => {
  const horloge = fausseHorloge();
  const synth = fausseSynth({ voix: VOIX, auto: false });
  const parole = new Parole({ synth, Utterance: FausseUtterance, horloge });
  let fini = false;
  const p = parole.dire('Bonjour.').then(() => { fini = true; });
  await vider();
  synth.enonces[0].onstart();                 // la voix démarre mais onend se perd
  horloge.avancer(dureeMax('Bonjour.') - 1);
  await vider();
  assert.equal(fini, false);
  horloge.avancer(1);
  await p;
  assert.equal(fini, true);
  assert.equal(synth.journal.at(-1), 'cancel');
});

test('Parole.dire : garde-fou aussi si la voix ne démarre jamais ; arreter() résout tout de suite', async () => {
  const horloge = fausseHorloge();
  const synth = fausseSynth({ auto: false });
  const parole = new Parole({ synth, Utterance: FausseUtterance, horloge });
  const p = parole.dire('Bonjour.');
  horloge.avancer(dureeMax('Bonjour.') + 1500);
  await p;

  let fini = false;
  const longue = 'Une phrase assez longue pour ne pas être regroupée avec la suivante, avec quelques détails en plus.';
  const q = parole.dire(`${longue} ${longue}`).then(() => { fini = true; });
  await vider();
  parole.arreter();
  await q;
  assert.equal(fini, true);
  assert.equal(synth.enonces.length, 2);     // « Bonjour. » puis la 1re phrase : la 2e n'est jamais lue
});

test('Parole.dire : une nouvelle lecture coupe la précédente', async () => {
  const synth = fausseSynth({ auto: false });
  const parole = new Parole({ synth, Utterance: FausseUtterance, horloge: fausseHorloge() });
  const p1 = parole.dire('Ancienne phrase. Suite.');
  await vider();
  const p2 = parole.dire('Nouvelle.');
  await p1;                                   // résolue sans attendre le garde-fou
  await vider();
  assert.deepStrictEqual(synth.enonces.map(u => u.text), ['Ancienne phrase. Suite.', 'Nouvelle.']);
  assert.deepStrictEqual(synth.journal, ['cancel', 'speak', 'cancel', 'speak']);
  synth.enonces.at(-1).onend();
  await p2;
});

test('Parole sans synthèse : dire() résout sans erreur', async () => {
  const parole = new Parole({ synth: null, Utterance: null });
  assert.equal(parole.disponible, false);
  await parole.dire('Bonjour.');
  assert.deepStrictEqual(await parole.voixFrancaises(), []);
});

// --- Écran allumé ---

test('verrouEcran : pris, ré-acquis au retour au premier plan, libéré', async () => {
  const verrous = [];
  const nav = {
    wakeLock: {
      async request(type) {
        assert.equal(type, 'screen');
        const v = new EventTarget();
        v.release = async () => { v.libere = true; v.dispatchEvent(new Event('release')); };
        verrous.push(v);
        return v;
      },
    },
  };
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const liberer = await verrouEcran(nav, doc);
  assert.equal(verrous.length, 1);

  doc.visibilityState = 'hidden';            // le navigateur libère le verrou quand la page est cachée
  await verrous[0].release();
  doc.dispatchEvent(new Event('visibilitychange'));
  await vider();
  assert.equal(verrous.length, 1);

  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await vider();
  assert.equal(verrous.length, 2);

  await liberer();
  assert.equal(verrous[1].libere, true);
  doc.dispatchEvent(new Event('visibilitychange'));
  await vider();
  assert.equal(verrous.length, 2);
});

test('verrouEcran : sans Wake Lock ou refusé, rien ne casse', async () => {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const l1 = await verrouEcran({}, doc);
  await l1();
  const l2 = await verrouEcran({ wakeLock: { request: async () => { throw new Error('NotAllowedError'); } } }, doc);
  await l2();
});
