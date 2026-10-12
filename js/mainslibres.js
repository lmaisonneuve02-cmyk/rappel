// Mains libres : je lis la question, tu réponds à voix haute, je corrige et je dis le verdict.
// Machine à états sans DOM : séance, correction, voix et enregistrement sont injectés.
// L'interface suit l'événement 'etat' (detail : {phase, texte, carte, resultat, message, partiel, micro, …}).
import { texteOral, plainQ, refText } from './texte.js';
import { commande, lettresQcm, estAccord } from './voix.js';

const HORLOGE = {
  setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
  clearTimeout: id => globalThis.clearTimeout(id),
};

// Ce que l'appli dit à voix haute (sans guillemets : la synthèse les lit mal).
const ORAL = {
  intro: 'Je lis chaque question, tu réponds à voix haute. Si besoin, dis : répète, je ne sais pas, suivant, ou pause. ',
  rienEntendu: "Je n'ai rien entendu. Réponds, ou dis : je ne sais pas.",
  pauseSilence: "Je n'entends rien : je mets en pause. Touche Reprendre quand tu veux.",
  pauseVoix: 'Pause. Touche Reprendre pour continuer.',
  pauseFiche: 'Prends ton temps. Touche Reprendre quand tu as lu la fiche.',
  micro: "Je ne peux plus t'écouter : regarde l'écran.",
  passe: 'On passe.',
  contesteTot: "Réponds d'abord. Tu pourras contester après la correction.",
  correctionImpossible: "Je n'ai pas pu corriger cette réponse. On passe à la suivante.",
  pourquoi: 'Pourquoi ?',
  contestationImpossible: "Je n'ai pas pu vérifier ta contestation. Tu pourras la refaire depuis l'écran normal.",
  ficheRappel: 'Dis suivant quand tu as lu la fiche.',
  lettresIncomprises: "Je n'ai pas compris, répète les lettres.",
  lettresAbandon: "Je n'ai toujours pas compris. On passe à la suite.",
  rienEntenduQcm: "Je n'ai rien entendu. Dis les lettres, par exemple : A et C.",
};

// Ce que l'écran affiche en grand (état en cours, ce qu'on attend de toi).
const MESSAGES = {
  question: 'Je lis la question…',
  ecoute: "Je t'écoute…",
  rienEntendu: "Je n'ai rien entendu.",
  correction: 'Correction…',
  passe: 'Carte passée : elle reviendra plus tard.',
  apresVerdict: 'Dis « répète » pour réentendre, ou attends la suite.',
  apresVerdictConteste: 'Dis « je conteste » si tu n\'es pas d\'accord, ou attends la suite.',
  pourquoi: 'Dis pourquoi tu contestes…',
  verification: 'Je vérifie ta contestation…',
  fiche: 'Nouvelle fiche : lis-la à l\'écran.',
  ficheEcoute: 'Lis la fiche, puis dis « suivant ».',
  geste: 'Touche le bouton pour que je t\'écoute.',
  pause: 'En pause. Touche « Reprendre » pour continuer.',
  pauseSilence: 'Je n\'entendais rien, alors j\'ai mis en pause. Touche « Reprendre » pour continuer.',
  pauseFiche: 'Prends le temps de lire la fiche. Touche « Reprendre » quand tu as fini.',
  pauseConseillee: 'Petite pause conseillée. Dis « reprendre » ou touche « Reprendre ».',
  pauseConseilleeAttente: 'Petite pause conseillée. Touche « Reprendre » quand tu veux.',
  reessayer: 'Touche « Reprendre » pour réessayer.',
  qcm: 'Je lis le QCM…',
  lettres: 'Dis les lettres justes, par exemple « A et C ».',
  lettresIncomprises: 'Je n\'ai pas compris les lettres.',
  fin: 'Séance terminée.',
  inattendu: 'Un problème inattendu a arrêté le mode mains libres. Tes réponses déjà données sont enregistrées.',
};

const CODES_GESTE = new Set(['not-allowed', 'service-not-allowed']);
const CODES_BLOQUANTS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'indisponible', 'bad-grammar']);

class Interruption extends Error {
  constructor() { super('interruption'); this.name = 'Interruption'; }
}
class ErreurMicro extends Error {
  constructor(err) { super(err?.message || 'micro'); this.name = 'ErreurMicro'; this.code = err?.code || 'inconnue'; }
}

// ---------- Textes dits ----------

// Nettoie un texte pour la synthèse : flèches, symboles, blancs, guillemets.
export function pourOral(texte) {
  return String(texte || '')
    .replace(/[«»"“”]/g, '')
    .replace(/\s*(→|⇒|->)\s*/g, ', ')
    .replace(/\s*≥\s*/g, ' supérieur ou égal à ').replace(/\s*≤\s*/g, ' inférieur ou égal à ')
    .replace(/\s*>\s*(?=\d)|\s>\s/g, ' supérieur à ').replace(/\s*<\s*(?=\d)|\s<\s/g, ' inférieur à ')
    .replace(/±/g, ' plus ou moins ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/_{2,}/g, ' blanc ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ').trim();
}

function tronquer(texte, n = 25) {
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean);
  if (mots.length <= n + 3) return mots.join(' ');
  return mots.slice(0, n).join(' ').replace(/[,;:.\s]+$/, '') + '…';
}

const sansPoint = t => String(t || '').trim().replace(/[.\s]+$/, '');
const minuscule = t => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const finPhrase = t => (/[.!?…]$/.test(t) ? t : t + '.');

// Verdict dit après la correction.
export function texteVerdict(resultat, carte) {
  const r = resultat || {};
  let t;
  if (r.verdict === 'juste') t = 'Juste.';
  else if (r.verdict === 'partiel') {
    const manque = sansPoint((r.idees_manquantes || [])[0]);
    const erreur = sansPoint((r.erreurs || [])[0]);
    t = manque ? `Partiel : il manquait ${minuscule(manque)}.` : erreur ? `Partiel : ${minuscule(erreur)}.` : 'Partiel.';
  } else {
    const ref = tronquer(String(refText(carte || {}) || '').replace(/\s*·\s*/g, ', '));
    const debut = r.correcteur === 'je-ne-sais-pas' ? '' : 'Faux. ';
    t = ref ? `${debut}La réponse était : ${finPhrase(ref)}` : 'Faux.';
  }
  if (r.correcteur === 'hors-ligne') t += ' Correction hors ligne.';
  return t;
}

function libelleVerdict(r) {
  if (r?.verdict === 'juste') return 'Juste';
  if (r?.verdict === 'partiel') return 'Partiel';
  return r?.correcteur === 'je-ne-sais-pas' ? 'La réponse' : 'Faux';
}

export function formatPoints(p) {
  const n = Math.round((Number(p) || 0) * 100) / 100;
  return `${String(n).replace('.', ',')} point${Math.abs(n) >= 2 ? 's' : ''}`;
}

export function lettresOral(lettres) {
  const l = [...(lettres || [])];
  if (!l.length) return 'aucune lettre';
  return l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}

function oralQcm(q, rang, total) {
  const props = (q.propositions || []).map(p => `${p.l} : ${sansPoint(pourOral(p.t))}.`).join(' ');
  return `Question ${rang} sur ${total}. ${finPhrase(sansPoint(pourOral(q.enonce)) || 'QCM')} ${props} Quelles lettres ?`;
}

export function texteQcm(res, q) {
  const dit = res.cochees?.length ? `Tu as dit ${lettresOral(res.cochees)}` : 'Sans réponse';
  if (res.points >= 1) return `${dit} : 1 point, c'est tout juste.`;
  const bonnes = (q.propositions || []).filter(p => p.vrai).map(p => p.l);
  return `${dit} : ${formatPoints(res.points)}. Les bonnes réponses : ${lettresOral(bonnes)}.`;
}

function resumeBilan(b) {
  const n = b.reponses || 0, j = b.justes || 0;
  let t = n ? `${n} réponse${n > 1 ? 's' : ''}, dont ${j} juste${j > 1 ? 's' : ''}.` : 'Aucune réponse cette fois.';
  if (b.qcm) t += ` QCM : ${formatPoints(b.points).replace(/ points?$/, '')} sur ${b.qcm}.`;
  return t;
}

const VIDE = { carte: null, paquet: null, nouvelle: null, rang: null, total: null, fiche: null, ficheId: null, qcm: null };

// ---------- Machine à états ----------

export class MainsLibres extends EventTarget {
  // corriger({carte, paquet, reponse, maintenant, appareil}) → {resultat, ops} (ou le résultat seul)
  // contester({carte, paquet, reponse, resultat, raison, etatAvant, ligneId, maintenant, appareil}) → {resultat, accepte, ops}
  // enregistrer(ops) ; qcm : {questions, scorer(qcm, cochees), ligne?({qcm, cochees, resultat, duree, maintenant, appareil})}
  // fiches : {id: fiche} pour dire le titre de la micro-fiche.
  constructor({ seance = null, corriger, parole, ecoute, enregistrer = () => {}, contester = null, qcm = null, fiches = {},
    maintenant = Date.now, appareil, horloge = HORLOGE, intro = true, delaiMicro = 250, ecouteVerdict = 3000,
    attenteFiche = 15000, attenteQcm = 10000 } = {}) {
    super();
    Object.assign(this, { seance, corriger, parole, ecoute, enregistrer, contester, qcm, fiches, maintenant, appareil, horloge,
      intro, delaiMicro, ecouteVerdict, attenteFiche, attenteQcm });
    this._ctx = { ...VIDE };
    this._dernier = null;
    this._gen = 0;
    this._c = { reponses: 0, justes: 0, partielles: 0, fausses: 0, qcm: 0, points: 0 };
    // Texte reconnu en direct pendant l'écoute.
    ecoute?.addEventListener?.('partiel', e => {
      if (this._dernier?.micro) this._emettre(this._dernier.phase, { ...this._dernier, partiel: String(e.detail || '') });
    });
  }

  get phase() {
    return this._dernier?.phase ?? null;
  }

  get etat() {
    return this._dernier;
  }

  // À appeler directement dans le gestionnaire du toucher (la première lecture part tout de suite).
  demarrer() {
    if (!this._promesse) {
      this._lance = true;
      this._promesse = this._boucle();
    }
    return this._promesse;
  }

  pause() {
    if (!this._lance || this._termine || this._stop || this._pauseDemandee || this._ecouteReprise) return;
    this._pause = { phase: 'pause', message: MESSAGES.pause };
    this._pauseDemandee = true;
    this._gen++;
    this._couper();
    this._emettre('pause', { texte: this._dernier?.texte ?? '', message: MESSAGES.pause, micro: false });
  }

  reprendre() {
    if (this._termine || this._stop) return;
    if (this._attenteGeste) return this.geste();
    if (this._ecouteReprise) {
      this._repriseDemandee = true;
      this._couper();
      return;
    }
    const attente = this._attente;
    this._pauseDemandee = false;
    this._pause = null;
    if (attente) {
      this._attente = null;
      try { this.parole.arreter(); } catch { /* rien */ }
      attente();
    }
  }

  // Bouton « Toucher pour répondre » : l'écoute démarre dans le geste (exigé par iOS).
  geste() {
    const a = this._attenteGeste;
    if (!a) return;
    this._attenteGeste = null;
    const promesse = this.ecoute.demarrer(a.options);
    this._emettre(a.detail.phase, a.detail);
    a.resoudre(promesse);
  }

  arreter() {
    if (this._termine) { try { this.parole.arreter(); } catch { /* rien */ } return; }
    if (this._stop) return;
    this._stop = true;
    this._gen++;
    this._couper();
    const attente = this._attente;
    this._attente = null;
    attente?.();
  }

  // ---------- Outils internes ----------

  _emettre(phase, extra = {}) {
    this._dernier = { phase, texte: '', carte: null, resultat: null, message: '', partiel: '', micro: false, reponse: '', ...this._ctx, ...extra, phase };
    this.dispatchEvent(new CustomEvent('etat', { detail: this._dernier }));
  }

  // Change de phase, sauf si une pause ou un arrêt est demandé.
  _phase(phase, extra) {
    if (this._stop || this._pauseDemandee) throw new Interruption();
    this._emettre(phase, extra);
  }

  _verifier(gen) {
    if (this._stop || this._pauseDemandee || gen !== this._gen) throw new Interruption();
  }

  _couper() {
    try { this.parole.arreter(); } catch { /* rien */ }
    try { this.ecoute.annuler(); } catch { /* rien */ }
    const a = this._attenteGeste;
    this._attenteGeste = null;
    a?.resoudre('');
  }

  _attendre(ms) {
    return ms > 0 ? new Promise(r => this.horloge.setTimeout(r, ms)) : Promise.resolve();
  }

  async _dire(phase, oral, extra) {
    this._phase(phase, extra);
    const gen = this._gen;
    await this.parole.dire(oral);
    this._verifier(gen);
  }

  // Écoute après la fin de la voix. facultatif : une erreur ou un refus donne simplement « rien entendu ».
  async _ecouter({ attente, facultatif = false } = {}) {
    const gen = this._gen;
    await this._attendre(this.delaiMicro);
    this._verifier(gen);
    const options = attente ? { attente } : undefined;
    let texte = await this.ecoute.demarrer(options);
    this._verifier(gen);
    let err = this.ecoute.erreur;
    if (err && CODES_GESTE.has(err.code)) {
      if (facultatif) return '';
      // iOS refuse parfois d'ouvrir le micro sans geste : on demande un toucher.
      const detail = this._dernier;
      texte = await new Promise(resoudre => {
        this._attenteGeste = { resoudre, options, detail };
        this._emettre('attente-geste', { texte: detail?.texte ?? '', message: MESSAGES.geste, micro: false });
      });
      this._verifier(gen);
      err = this.ecoute.erreur;
    }
    if (err) {
      if (facultatif) return '';
      throw new ErreurMicro(err);
    }
    return String(texte || '').trim();
  }

  _pauseVoix() {
    this._pause = { phase: 'pause', message: MESSAGES.pause, oral: ORAL.pauseVoix };
    this._pauseDemandee = true;
    return new Interruption();
  }

  _pauseAuto(message, oral) {
    this._pause = { phase: 'pause', message, oral };
    this._pauseDemandee = true;
    return new Interruption();
  }

  _stopVoix() {
    this._stop = true;
    this._stopParVoix = true;
    return new Interruption();
  }

  _prendreIntro() {
    const t = this.intro && !this._introDite ? ORAL.intro : '';
    this._introDite = true;
    return t;
  }

  _compter(verdict, d) {
    const k = { juste: 'justes', partiel: 'partielles', faux: 'fausses' }[verdict];
    if (k) this._c[k] += d;
  }

  _bilan() {
    return { ...(this.seance?.bilan || {}), ...this._c };
  }

  // Exécute une étape ; après une pause ou une erreur de micro, attend « Reprendre » et la rejoue.
  async _executer(ctx, etape) {
    for (;;) {
      try {
        return await etape(ctx);
      } catch (e) {
        if (e instanceof ErreurMicro) {
          const bloquant = CODES_BLOQUANTS.has(e.code);
          this._pause = { phase: bloquant ? 'erreur' : 'pause', message: `${e.message} ${MESSAGES.reessayer}`, oral: ORAL.micro, code: e.code };
          this._pauseDemandee = true;
        } else if (!(e instanceof Interruption)) throw e;
        if (this._stop) throw new Interruption();
        if (this._pauseDemandee) await this._attendreReprise();
      }
    }
  }

  async _attendreReprise() {
    const p = this._pause || { phase: 'pause', message: MESSAGES.pause };
    const attente = new Promise(r => { this._attente = r; });
    this._emettre(p.phase, { texte: this._dernier?.texte ?? '', message: p.message, micro: false, code: p.code, recuperable: true });
    if (p.oral) await this.parole.dire(p.oral);
    await attente;
    this._pause = null;
    this._pauseDemandee = false;
    if (this._stop) throw new Interruption();
  }

  // ---------- Déroulé ----------

  async _boucle() {
    try {
      if (this.seance) await this._cartes();
      if (this.qcm?.questions?.length && !this._stop) await this._qcms();
    } catch (e) {
      if (!(e instanceof Interruption)) {
        this._termine = true;
        this._couper();
        const bilan = this._bilan();
        this._emettre('erreur', { message: MESSAGES.inattendu, cause: String(e?.message || e), recuperable: false, bilan });
        return bilan;
      }
    }
    const bilan = this._bilan();
    const naturelle = !this._stop, parVoix = !!this._stopParVoix;
    this._termine = true;
    this._ctx = { ...VIDE };
    const resume = resumeBilan(bilan);
    this._emettre('fin', { texte: resume, message: MESSAGES.fin, bilan });
    if (naturelle || parVoix) await this.parole.dire((parVoix ? "D'accord, j'arrête. " : 'Séance terminée. ') + resume);
    return bilan;
  }

  async _cartes() {
    for (;;) {
      if (this._stop) throw new Interruption();
      const etape = this.seance.etape();
      if (!etape || etape.type === 'fin') return;
      const ctx = { etape, stade: 'debut' };
      if (etape.type === 'fiche') await this._executer(ctx, c => this._fiche(c));
      else if (etape.type === 'pause') await this._executer(ctx, c => this._pauseConseillee(c));
      else await this._executer(ctx, c => this._carte(c));
    }
  }

  // Micro-fiche avant les nouvelles cartes : on attend « suivant ».
  async _fiche(ctx) {
    const { ficheId, paquet } = ctx.etape;
    const fiche = this.fiches?.[ficheId] || null;
    this._ctx = { ...VIDE, paquet, fiche, ficheId, nouvelle: true };
    if (ctx.lue) {
      this.seance.ficheVue();
      ctx.stade = 'fini';
      return;
    }
    const titre = fiche?.title || fiche?.titre || '';
    const affiche = titre ? `Nouvelle fiche : ${titre}` : 'Nouvelle fiche';
    let lire = ctx.stade === 'debut' ? 'complet' : 'court';
    ctx.stade = 'fiche';
    let vides = 0;
    for (;;) {
      if (lire) {
        const oral = lire === 'complet' ? `${this._prendreIntro()}${pourOral(affiche)}. Lis-la à l'écran, puis dis : suivant.` : ORAL.ficheRappel;
        await this._dire('lecture-fiche', oral, { texte: affiche, message: MESSAGES.fiche });
        lire = null;
      }
      this._phase('lecture-fiche', { texte: affiche, message: MESSAGES.ficheEcoute, micro: true });
      const t = await this._ecouter({ attente: this.attenteFiche, facultatif: true });
      const cmd = commande(t);
      if (cmd === 'suivant' || cmd === 'reprendre' || (t && estAccord(t))) {
        this.seance.ficheVue();
        ctx.stade = 'fini';
        return;
      }
      if (cmd === 'repete') { lire = 'complet'; continue; }
      if (cmd === 'pause') throw this._pauseVoix();
      if (cmd === 'stop') throw this._stopVoix();
      if (!t) {
        if (++vides >= 2) {
          ctx.lue = true;   // à la reprise, on considère la fiche lue
          throw this._pauseAuto(MESSAGES.pauseFiche, ORAL.pauseFiche);
        }
        continue;
      }
      lire = 'court';
    }
  }

  // Pause conseillée par la séance (toutes les N cartes).
  async _pauseConseillee(ctx) {
    this._ctx = { ...VIDE };
    if (ctx.stade === 'debut') {
      ctx.stade = 'pause';
      const { faites, minutes } = ctx.etape;
      const texte = `${faites} cartes faites${minutes ? ` en ${minutes} min` : ''}. Petite pause conseillée.`;
      this._ecouteReprise = true;
      this._repriseDemandee = false;
      try {
        await this._dire('pause', `${texte} Dis reprendre pour continuer, ou stop pour t'arrêter.`, { texte, message: MESSAGES.pauseConseillee });
        if (!this._repriseDemandee) {
          this._phase('pause', { texte, message: MESSAGES.pauseConseillee, micro: true });
          const t = await this._ecouter({ attente: this.attenteQcm, facultatif: true });
          const cmd = commande(t);
          if (cmd === 'stop') throw this._stopVoix();
          if (cmd === 'reprendre' || cmd === 'suivant' || (t && estAccord(t))) this._repriseDemandee = true;
        }
      } finally {
        this._ecouteReprise = false;
      }
      if (!this._repriseDemandee) throw this._pauseAuto(MESSAGES.pauseConseilleeAttente, '');
    }
    this._repriseDemandee = false;
    this.seance.continuer();
    ctx.stade = 'fini';
  }

  async _carte(ctx) {
    const { carte, paquet, nouvelle, rang, total } = ctx.etape;
    this._ctx = { ...VIDE, carte, paquet, nouvelle, rang, total };
    if (ctx.stade === 'debut' || ctx.stade === 'question') await this._question(ctx);
    if (ctx.stade === 'verdict') await this._verdict(ctx);
    if (ctx.stade === 'issue') await this._issue(ctx);
  }

  async _question(ctx) {
    const { carte } = ctx.etape;
    const affiche = plainQ(carte);
    const oral = (carte.type === 'cloze' ? 'Complète. ' : '') + pourOral(texteOral(carte));
    ctx.stade = 'question';
    let lire = true, vides = 0;
    for (;;) {
      if (lire) {
        ctx.debut = this.maintenant();
        await this._dire('question', this._prendreIntro() + oral, { texte: affiche, message: MESSAGES.question });
        lire = false;
      }
      this._phase('ecoute', { texte: affiche, message: MESSAGES.ecoute, micro: true });
      const reponse = await this._ecouter();
      if (!reponse) {
        if (++vides >= 2) throw this._pauseAuto(MESSAGES.pauseSilence, ORAL.pauseSilence);
        await this._dire('ecoute', ORAL.rienEntendu, { texte: affiche, message: MESSAGES.rienEntendu });
        continue;
      }
      vides = 0;
      const cmd = commande(reponse);
      if (cmd === 'repete' || cmd === 'reprendre') { lire = true; continue; }
      if (cmd === 'pause') throw this._pauseVoix();
      if (cmd === 'stop') throw this._stopVoix();
      if (cmd === 'conteste') {
        await this._dire('ecoute', ORAL.contesteTot, { texte: affiche, reponse, message: MESSAGES.ecoute });
        continue;
      }
      if (cmd === 'suivant') {
        this.seance.passer();
        ctx.stade = 'fini';
        await this._dire('question', ORAL.passe, { texte: affiche, message: MESSAGES.passe });
        return;
      }
      await this._corriger(ctx, reponse, cmd === 'je-ne-sais-pas');
      return;
    }
  }

  // Correction puis note : une fois lancée, la réponse est enregistrée même si une pause arrive entre-temps.
  async _corriger(ctx, reponse, nsp) {
    const { carte, paquet } = ctx.etape;
    const affiche = plainQ(carte);
    const { corriger, enregistrer } = this;
    let resultat, ops = [];
    if (nsp) {
      resultat = { verdict: 'faux', idees_trouvees: [], idees_manquantes: [], erreurs: [], confiance: 1, explication: '', correcteur: 'je-ne-sais-pas' };
    } else {
      this._phase('correction', { texte: affiche, reponse, message: MESSAGES.correction });
      try {
        const r = await corriger({ carte, paquet, reponse, maintenant: this.maintenant(), appareil: this.appareil });
        resultat = r?.resultat ?? r;
        ops = r?.ops ?? [];
        if (!resultat?.verdict) throw new Error('correction vide');
      } catch {
        this.seance.passer();
        ctx.stade = 'fini';
        await this._dire('verdict', ORAL.correctionImpossible, { texte: affiche, reponse, message: ORAL.correctionImpossible });
        return;
      }
    }
    const t = this.maintenant();
    const note = this.seance.noter({
      verdict: resultat.verdict, correcteur: resultat.correcteur, reponse, duree: Math.max(0, t - (ctx.debut ?? t)),
      confiance: resultat.confiance, maintenant: t, appareil: this.appareil,
    });
    Object.assign(ctx, { resultat, reponse, note, stade: 'verdict' });
    this._c.reponses++;
    this._compter(resultat.verdict, 1);
    await enregistrer([...ops, ...(note?.ops || [])]);
  }

  async _verdict(ctx) {
    const { carte } = ctx.etape;
    for (;;) {
      const texte = texteVerdict(ctx.resultat, carte);
      const base = { texte, resultat: ctx.resultat, reponse: ctx.reponse };
      await this._dire('verdict', pourOral(texte), { ...base, message: libelleVerdict(ctx.resultat) });
      const peutContester = !!this.contester && !ctx.conteste && ctx.resultat.verdict !== 'juste'
        && ctx.resultat.correcteur !== 'je-ne-sais-pas';
      this._phase('attente-commande', { ...base, micro: true, message: peutContester ? MESSAGES.apresVerdictConteste : MESSAGES.apresVerdict });
      const t = await this._ecouter({ attente: this.ecouteVerdict, facultatif: true });
      const cmd = commande(t);
      if (cmd === 'repete') continue;
      ctx.stade = 'fini';
      if (cmd === 'pause') throw this._pauseVoix();
      if (cmd === 'stop') throw this._stopVoix();
      if (cmd === 'conteste' && peutContester) {
        ctx.stade = 'verdict';
        await this._contestation(ctx);
      }
      return;
    }
  }

  async _contestation(ctx) {
    const { carte, paquet } = ctx.etape;
    const { contester, enregistrer } = this;
    const base = { texte: texteVerdict(ctx.resultat, carte), resultat: ctx.resultat, reponse: ctx.reponse };
    await this._dire('attente-commande', ORAL.pourquoi, { ...base, message: MESSAGES.pourquoi });
    this._phase('ecoute', { ...base, micro: true, message: MESSAGES.pourquoi });
    const brute = await this._ecouter();
    const cmd = commande(brute);
    if (cmd === 'pause') throw this._pauseVoix();
    if (cmd === 'stop') { ctx.stade = 'fini'; throw this._stopVoix(); }
    if (cmd === 'suivant') { ctx.stade = 'fini'; return; }
    const raison = cmd ? '' : brute;
    this._phase('correction', { ...base, message: MESSAGES.verification });
    let c = null;
    try {
      c = await contester({
        carte, paquet, reponse: ctx.reponse, resultat: ctx.resultat, raison, etatAvant: ctx.note?.etatAvant ?? null,
        ligneId: ctx.note?.ligne?.id, maintenant: this.maintenant(), appareil: this.appareil,
      });
    } catch {
      c = null;
    }
    ctx.conteste = true;
    if (!c) ctx.issue = ORAL.contestationImpossible;
    else {
      if (c.ops?.length) await enregistrer(c.ops);
      if (c.accepte) {
        this._compter(ctx.resultat.verdict, -1);
        ctx.resultat = c.resultat || ctx.resultat;
        this._compter(ctx.resultat.verdict, 1);
        ctx.issue = 'Tu avais raison, je corrige.';
      } else {
        const pourquoi = sansPoint(c.resultat?.explication || c.explication || '');
        ctx.issue = pourquoi ? `Je maintiens : ${minuscule(pourquoi)}.` : 'Je maintiens ma correction.';
      }
    }
    ctx.stade = 'issue';
  }

  async _issue(ctx) {
    await this._dire('verdict', pourOral(ctx.issue), { texte: ctx.issue, resultat: ctx.resultat, reponse: ctx.reponse, message: libelleVerdict(ctx.resultat) });
    ctx.stade = 'fini';
  }

  // ---------- QCM à voix haute ----------

  async _qcms() {
    const qs = this.qcm.questions;
    const n = qs.length;
    const annonce = `${this.seance ? '' : this._prendreIntro()}Place aux QCM : ${n} question${n > 1 ? 's' : ''}. Pour répondre, dis les lettres, par exemple : A et C. `;
    for (let i = 0; i < n; i++) {
      if (this._stop) throw new Interruption();
      const ctx = { q: qs[i], rang: i + 1, total: n, stade: 'debut', annonce: i === 0 ? annonce : '' };
      await this._executer(ctx, c => this._unQcm(c));
    }
  }

  async _unQcm(ctx) {
    const { q, rang, total } = ctx;
    const { enregistrer } = this;
    this._ctx = { ...VIDE, qcm: q, rang, total };
    if (ctx.stade === 'debut' || ctx.stade === 'question') {
      ctx.stade = 'question';
      let lire = true, essais = 0, vides = 0;
      for (;;) {
        if (lire) {
          ctx.debut = this.maintenant();
          const annonce = ctx.annonce;
          ctx.annonce = '';
          await this._dire('question', annonce + oralQcm(q, rang, total), { texte: q.enonce, message: MESSAGES.qcm });
          lire = false;
        }
        this._phase('ecoute', { texte: q.enonce, micro: true, message: MESSAGES.lettres });
        const t = await this._ecouter({ attente: this.attenteQcm });
        if (!t) {
          if (++vides >= 2) throw this._pauseAuto(MESSAGES.pauseSilence, ORAL.pauseSilence);
          await this._dire('ecoute', ORAL.rienEntenduQcm, { texte: q.enonce, message: MESSAGES.rienEntendu });
          continue;
        }
        vides = 0;
        const cmd = commande(t);
        if (cmd === 'repete' || cmd === 'reprendre') { lire = true; continue; }
        if (cmd === 'pause') throw this._pauseVoix();
        if (cmd === 'stop') throw this._stopVoix();
        if (cmd === 'suivant') {
          ctx.stade = 'fini';
          await this._dire('question', ORAL.passe, { texte: q.enonce, message: MESSAGES.passe });
          return;
        }
        const lettres = cmd === 'je-ne-sais-pas' ? [] : lettresQcm(t);
        if (!lettres) {
          if (++essais < 2) {
            await this._dire('ecoute', ORAL.lettresIncomprises, { texte: q.enonce, reponse: t, message: MESSAGES.lettresIncomprises });
            continue;
          }
          ctx.stade = 'fini';
          await this._dire('verdict', ORAL.lettresAbandon, { texte: q.enonce, reponse: t, message: MESSAGES.lettresIncomprises });
          return;
        }
        const resultat = this.qcm.scorer(q, lettres);
        const fin = this.maintenant();
        ctx.res = { ...resultat, cochees: lettres };
        ctx.stade = 'verdict';
        this._c.qcm++;
        this._c.points += Number(resultat.points) || 0;
        const ligne = this.qcm.ligne?.({ qcm: q, cochees: lettres, resultat, duree: Math.max(0, fin - ctx.debut), maintenant: fin, appareil: this.appareil });
        if (ligne) await enregistrer([{ type: 'qcm-reponse', ligne }]);
        break;
      }
    }
    if (ctx.stade === 'verdict') {
      const texte = texteQcm(ctx.res, q);
      await this._dire('verdict', texte, { texte, resultat: ctx.res, reponse: lettresOral(ctx.res.cochees), message: formatPoints(ctx.res.points) });
      ctx.stade = 'fini';
    }
  }
}
