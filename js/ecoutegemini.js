// Écoute par Gemini (décision du 26 oct. 2026) : la reconnaissance de Chrome Android coupait, doublait
// et écorchait les termes médicaux. Ici, l'appli enregistre elle-même (WAV 16 kHz mono), détecte la
// voix et le silence, puis Gemini transcrit avec le contexte de la carte.
// Même interface que Ecoute (voix.js) : demarrer() → texte, arreter(), annuler(), active, erreur ;
// événements 'niveau' (0 à 1), 'debut' (voix détectée), 'transcription', 'erreur'.
// pendantParole : l'écoute commence pendant que l'appli parle (seuil plus haut, l'attente ne court
// qu'après finParole()) ; 'debut' permet alors de couper la voix de synthèse.
import { messageEcoute } from './voix.js';

const HORLOGE = {
  setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
  clearTimeout: id => globalThis.clearTimeout(id),
};

export const FREQUENCE = 16000;        // Hz : suffisant pour la voix, 32 ko par seconde
const AVANT_DEBUT = 400;               // ms gardées avant la voix détectée
const DEMARRAGE_MAX = 4000;            // ms sans aucun son du micro : il n'a pas démarré

// ---------- Détection de la voix (pur) ----------

// Reçoit le niveau (RMS) de chaque tranche de son et l'instant (ms, temps du son).
// Renvoie 'debut', 'fin' (silence après la voix), 'rien' (attente dépassée sans voix), 'max' ou null.
export class DetecteurVoix {
  constructor({ silence = 2500, attente = 8000, max = 120000, seuilMin = 0.012, facteur = 3, dureeMin = 200, pendantParole = false } = {}) {
    Object.assign(this, { silence, attente, max, seuilMin, facteur, dureeMin, pendantParole });
    this.bruit = null;         // niveau du bruit de fond (moyenne glissante, hors voix)
    this.aParle = false;
    this.candidat = null;      // début possible de la voix
    this.debut = null;         // instant où la voix a commencé
    this.dernierSon = 0;
    this.t0 = null;            // début de l'écoute
    this.t0Attente = null;     // départ de l'attente (après la parole de l'appli)
  }

  seuil() {
    const base = Math.max(this.seuilMin, (this.bruit ?? this.seuilMin) * this.facteur);
    return this.pendantParole ? base * 2.5 : base;    // la voix de synthèse ne doit pas déclencher
  }

  finParole(t) {
    this.pendantParole = false;
    this.t0Attente = t;
  }

  traiter(rms, t) {
    if (this.t0 === null) { this.t0 = t; if (!this.pendantParole) this.t0Attente = t; }
    const fort = rms > this.seuil();
    if (fort) {
      this.dernierSon = t;
      if (!this.aParle) {
        if (this.candidat === null) this.candidat = t;
        const duree = this.pendantParole ? Math.max(this.dureeMin, 400) : this.dureeMin;
        if (t - this.candidat >= duree) {
          this.aParle = true;
          this.debut = this.candidat;
          return 'debut';
        }
      }
    } else {
      this.candidat = null;
      if (!this.aParle) this.bruit = this.bruit === null ? rms : this.bruit * 0.9 + rms * 0.1;
    }
    if (this.aParle && t - this.dernierSon >= this.silence) return 'fin';
    if (!this.aParle && this.t0Attente !== null && t - this.t0Attente >= this.attente) return 'rien';
    if (t - this.t0 >= this.max) return 'max';
    return null;
  }
}

// ---------- Son (pur) ----------

export function rms(echantillons) {
  let s = 0;
  for (let i = 0; i < echantillons.length; i++) s += echantillons[i] * echantillons[i];
  return echantillons.length ? Math.sqrt(s / echantillons.length) : 0;
}

// Moyenne par paquets : de la fréquence du micro (souvent 48 kHz) à 16 kHz.
export function sousEchantillonner(echantillons, depuis, vers = FREQUENCE) {
  if (depuis === vers) return Float32Array.from(echantillons);
  const ratio = depuis / vers;
  const n = Math.floor(echantillons.length / ratio);
  const sortie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(echantillons.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += echantillons[k];
    sortie[i] = b > a ? s / (b - a) : 0;
  }
  return sortie;
}

// WAV PCM 16 bits mono.
export function encoderWav(echantillons, frequence = FREQUENCE) {
  const tampon = new ArrayBuffer(44 + echantillons.length * 2);
  const v = new DataView(tampon);
  const ecrire = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ecrire(0, 'RIFF'); v.setUint32(4, 36 + echantillons.length * 2, true); ecrire(8, 'WAVE');
  ecrire(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, frequence, true); v.setUint32(28, frequence * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ecrire(36, 'data'); v.setUint32(40, echantillons.length * 2, true);
  for (let i = 0; i < echantillons.length; i++) {
    const x = Math.max(-1, Math.min(1, echantillons[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(tampon);
}

export function enBase64(octets) {
  let bin = '';
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- Micro partagé (une autorisation, ouvert pendant la séance) ----------

let partage = null;   // { flux, ctx, source }

export function ecouteGeminiDisponible(win = globalThis) {
  return !!(win?.navigator?.mediaDevices?.getUserMedia && (win.AudioContext || win.webkitAudioContext));
}

async function ouvrirMicro(win) {
  if (partage && partage.flux.getAudioTracks().some(p => p.readyState === 'live')) return partage;
  libererMicro();
  const flux = await win.navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const Ctx = win.AudioContext || win.webkitAudioContext;
  const ctx = new Ctx();
  partage = { flux, ctx, source: ctx.createMediaStreamSource(flux) };
  return partage;
}

// À la fin de la séance : le voyant du micro s'éteint.
export function libererMicro() {
  if (!partage) return;
  try { partage.flux.getTracks().forEach(p => p.stop()); } catch { /* déjà arrêté */ }
  try { partage.ctx.close(); } catch { /* déjà fermé */ }
  partage = null;
}

const codeErreurMicro = e => (e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'not-allowed'
  : e?.name === 'NotFoundError' || e?.name === 'NotReadableError' ? 'audio-capture' : 'demarrage');

// ---------- Écoute ----------

export class EcouteGemini extends EventTarget {
  // transcrire(base64Wav) → Promise<texte> (Gemini) ; win : fenêtre (micro, AudioContext).
  constructor({ transcrire, silence = 2500, attente = 8000, max = 120000, win = globalThis, horloge = HORLOGE } = {}) {
    super();
    Object.assign(this, { transcrire, silence, attente, max, win, horloge });
    this.contexte = {};        // {question} : donné à transcrire (vocabulaire de la carte)
    this.erreur = null;
    this._s = null;
  }

  get active() { return !!this._s; }

  demarrer({ attente, pendantParole = false } = {}) {
    if (this._s) return this._s.promesse;
    this.erreur = null;
    let resoudre;
    const promesse = new Promise(r => { resoudre = r; });
    const s = this._s = {
      promesse, resoudre, morceaux: [], frequence: 0, temps: 0, fin: false, noeuds: [], garde: null,
      detecteur: new DetecteurVoix({ silence: this.silence, attente: attente ?? this.attente, max: this.max, pendantParole }),
    };
    this._lancer(s).catch(e => this._echec(s, codeErreurMicro(e)));
    return promesse;
  }

  // La voix de l'appli s'est tue : l'attente commence ; sans voix détectée, on repart d'un enregistrement vide.
  finParole() {
    const s = this._s;
    if (!s || s.fin || !s.detecteur.pendantParole) return;
    if (!s.detecteur.aParle) s.morceaux = [];
    s.detecteur.finParole(s.temps);
  }

  arreter() {
    const s = this._s;
    if (s && !s.fin) this._terminer(s, s.detecteur.aParle ? 'fin' : 'rien');
  }

  annuler() {
    const s = this._s;
    if (!s) return;
    s.fin = true;
    this._debrancher(s);
    this._conclure(s, '');
  }

  async _lancer(s) {
    const { ctx, source } = await ouvrirMicro(this.win);
    if (s.fin) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    s.frequence = ctx.sampleRate;
    const traitement = ctx.createScriptProcessor(4096, 1, 1);
    const muet = ctx.createGain();
    muet.gain.value = 0;
    traitement.onaudioprocess = ev => this._son(s, ev.inputBuffer.getChannelData(0));
    source.connect(traitement);
    traitement.connect(muet);
    muet.connect(ctx.destination);
    s.noeuds = [traitement, muet, source];
    s.garde = this.horloge.setTimeout(() => { if (!s.temps && !s.fin) this._echec(s, 'demarrage'); }, DEMARRAGE_MAX);
  }

  _son(s, donnees) {
    if (s.fin || this._s !== s) return;
    const tranche = Float32Array.from(donnees);
    const niveau = rms(tranche);
    s.temps += (tranche.length / s.frequence) * 1000;
    s.morceaux.push({ t: s.temps, tranche });
    this.dispatchEvent(new CustomEvent('niveau', { detail: Math.min(1, niveau * 8) }));
    const ev = s.detecteur.traiter(niveau, s.temps);
    if (ev === 'debut') this.dispatchEvent(new Event('debut'));
    else if (ev) this._terminer(s, ev);
  }

  _debrancher(s) {
    this.horloge.clearTimeout(s.garde);
    for (const n of s.noeuds) { try { n.disconnect(); } catch { /* déjà débranché */ } }
    if (s.noeuds[0]) s.noeuds[0].onaudioprocess = null;
    s.noeuds = [];
  }

  async _terminer(s, raison) {
    if (s.fin) return;
    s.fin = true;
    this._debrancher(s);
    if (raison === 'rien' || !s.detecteur.aParle) return this._echec(s, 'no-speech');
    // Garde le son à partir d'un peu avant la voix.
    const depuis = (s.detecteur.debut ?? 0) - AVANT_DEBUT;
    const gardes = s.morceaux.filter(m => m.t >= depuis).map(m => m.tranche);
    const total = gardes.reduce((n, x) => n + x.length, 0);
    const tout = new Float32Array(total);
    let o = 0;
    for (const x of gardes) { tout.set(x, o); o += x.length; }
    this.dispatchEvent(new Event('transcription'));
    try {
      const texte = await this.transcrire(enBase64(encoderWav(sousEchantillonner(tout, s.frequence))), this.contexte);
      this._conclure(s, String(texte || '').trim());
    } catch (e) {
      this.erreur = { code: 'transcription', message: e?.message || 'La transcription a échoué.', cause: e };
      this.dispatchEvent(new CustomEvent('erreur', { detail: this.erreur }));
      this._conclure(s, '');
    }
  }

  _echec(s, code) {
    s.fin = true;
    this._debrancher(s);
    this.erreur = { code, message: messageEcoute(code) };
    this.dispatchEvent(new CustomEvent('erreur', { detail: this.erreur }));
    this._conclure(s, '');
  }

  _conclure(s, texte) {
    if (this._s === s) this._s = null;
    s.resoudre(texte);
  }
}
