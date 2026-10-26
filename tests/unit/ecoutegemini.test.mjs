// Écoute par Gemini : détection de la voix, WAV, écoute complète avec un faux micro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DetecteurVoix, rms, sousEchantillonner, encoderWav, enBase64, EcouteGemini, libererMicro, FREQUENCE } from '../../js/ecoutegemini.js';

// Suite de niveaux par tranches de 100 ms : [niveau, durée en ms].
function rejouer(d, plan) {
  const evts = [];
  let t = 0;
  for (const [niveau, duree] of plan) {
    for (let k = 0; k < duree; k += 100) {
      t += 100;
      const e = d.traiter(niveau, t);
      if (e) { evts.push([e, t]); if (e !== 'debut') return evts; }
    }
  }
  return evts;
}

test('détecteur : voix après le bruit de fond, fin après le silence (pas avant)', () => {
  const d = new DetecteurVoix({ silence: 2500, attente: 8000 });
  const evts = rejouer(d, [[0.005, 1000], [0.1, 1500], [0.005, 2000], [0.1, 500], [0.005, 3000]]);
  // Une pause de 2 s au milieu ne coupe pas ; la fin vient 2,5 s après la dernière voix.
  assert.deepEqual(evts, [['debut', 1300], ['fin', 7500]]);
  assert.equal(d.debut, 1100);
});

test('détecteur : rien dit pendant l\'attente → « rien » ; un bruit bref ne compte pas', () => {
  assert.deepEqual(rejouer(new DetecteurVoix({ attente: 3000 }), [[0.005, 500], [0.2, 100], [0.005, 5000]]), [['rien', 3100]]);   // départ à la 1re tranche (100 ms)
  assert.deepEqual(rejouer(new DetecteurVoix({ max: 2000, attente: 99999 }), [[0.005, 5000]]), [['max', 2100]]);
});

test('détecteur pendant la parole de l\'appli : seuil plus haut, attente seulement après finParole', () => {
  const d = new DetecteurVoix({ attente: 2000, pendantParole: true });
  // La voix de synthèse (0,03) ne déclenche pas ; l'attente ne court pas.
  assert.deepEqual(rejouer(d, [[0.004, 500], [0.03, 4000]]), []);
  d.finParole(4500);
  let t = 4500, e = null;
  while (!e) { t += 100; e = d.traiter(0.004, t); }
  assert.deepEqual([e, t], ['rien', 6500]);
  // Il parle fort pendant la synthèse : coupure (debut).
  const d2 = new DetecteurVoix({ pendantParole: true });
  assert.deepEqual(rejouer(d2, [[0.004, 500], [0.2, 600]]), [['debut', 1000]]);
});

test('son : RMS, 48 kHz → 16 kHz, en-tête WAV, base64', () => {
  assert.equal(rms(new Float32Array([0.5, -0.5])), 0.5);
  assert.equal(rms(new Float32Array(0)), 0);
  const s = sousEchantillonner(Float32Array.from({ length: 4800 }, (_, i) => (i % 3 === 0 ? 0.3 : 0)), 48000);
  assert.equal(s.length, 1600);
  assert.ok(Math.abs(s[0] - 0.1) < 1e-6);
  const wav = encoderWav(new Float32Array([0, 1, -1, 2]));
  assert.equal(wav.length, 44 + 8);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), FREQUENCE);
  assert.deepEqual([v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [32767, -32768, 32767]);
  assert.equal(enBase64(new Uint8Array([77, 97, 110])), 'TWFu');
});

// Faux navigateur : getUserMedia, AudioContext ; on pousse le son à la main.
function fauxNavigateur({ refus = null } = {}) {
  let traitement = null;
  const ctx = {
    state: 'running', sampleRate: 16000, destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => (traitement = { connect() {}, disconnect() {}, onaudioprocess: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    resume: async () => {}, close() {},
  };
  const piste = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  const win = {
    navigator: { mediaDevices: { getUserMedia: async () => { if (refus) throw Object.assign(new Error('non'), { name: refus }); return { getAudioTracks: () => [piste], getTracks: () => [piste] }; } } },
    AudioContext: function () { return ctx; },
  };
  // Une tranche de 100 ms au niveau donné.
  const pousser = niveau => traitement?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(niveau) } });
  return { win, pousser, pret: () => !!traitement?.onaudioprocess };
}
const horloge = { setTimeout: () => 0, clearTimeout: () => {} };
const attendreQue = async cond => { for (let i = 0; i < 50 && !cond(); i++) await new Promise(r => setImmediate(r)); };

test('écoute complète : la voix est enregistrée puis transcrite, avec la question en contexte', async () => {
  libererMicro();
  const nav = fauxNavigateur();
  const envois = [];
  const e = new EcouteGemini({ win: nav.win, horloge, silence: 1000, transcrire: async (wav, contexte) => { envois.push({ wav, contexte }); return '  le ventricule gauche '; } });
  e.contexte = { question: 'Quel ventricule ?' };
  const evts = [];
  for (const n of ['debut', 'transcription']) e.addEventListener(n, () => evts.push(n));
  const p = e.demarrer();
  await attendreQue(nav.pret);
  assert.equal(e.active, true);
  for (const n of [0.004, 0.004, 0.2, 0.2, 0.2, 0.2, ...Array(12).fill(0.004)]) nav.pousser(n);
  assert.equal(await p, 'le ventricule gauche');
  assert.deepEqual(evts, ['debut', 'transcription']);
  assert.equal(envois[0].contexte.question, 'Quel ventricule ?');
  assert.ok(atob(envois[0].wav).startsWith('RIFF'));
  assert.equal(e.active, false);
  assert.equal(e.erreur, null);
  libererMicro();
});

test('écoute : rien entendu, micro refusé, échec de la transcription, annulation', async () => {
  libererMicro();
  let nav = fauxNavigateur();
  let e = new EcouteGemini({ win: nav.win, horloge, attente: 500, transcrire: async () => 'x' });
  let p = e.demarrer();
  await attendreQue(nav.pret);
  for (let i = 0; i < 6; i++) nav.pousser(0.004);
  assert.equal(await p, '');
  assert.equal(e.erreur.code, 'no-speech');
  libererMicro();

  nav = fauxNavigateur({ refus: 'NotAllowedError' });
  e = new EcouteGemini({ win: nav.win, horloge, transcrire: async () => 'x' });
  assert.equal(await e.demarrer(), '');
  assert.equal(e.erreur.code, 'not-allowed');
  libererMicro();

  nav = fauxNavigateur();
  e = new EcouteGemini({ win: nav.win, horloge, silence: 500, transcrire: async () => { throw new Error('Gemini est injoignable.'); } });
  p = e.demarrer();
  await attendreQue(nav.pret);
  for (const n of [0.004, 0.2, 0.2, 0.2, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004]) nav.pousser(n);
  assert.equal(await p, '');
  assert.deepEqual([e.erreur.code, e.erreur.message], ['transcription', 'Gemini est injoignable.']);

  e = new EcouteGemini({ win: nav.win, horloge, transcrire: async () => 'jamais' });
  p = e.demarrer();
  await attendreQue(nav.pret);
  nav.pousser(0.2); nav.pousser(0.2); nav.pousser(0.2);
  e.annuler();
  assert.equal(await p, '');
  libererMicro();
});
