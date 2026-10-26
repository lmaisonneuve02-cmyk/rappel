// Séance : fiche avant les nouvelles cartes, carte, correction, verdict, contestation, pause, fin.
import { Seance, apportDuFiltre, revisionsEnAvance, qcmRestants } from '../seance.js';
import { propositionsCarte, resultatQcmCarte } from '../qcmcartes.js';
import { corriger, contester, opErreur } from '../correction.js';
import { expliquerGemini } from '../gemini.js';
import { corrigerLocal, indice, plafonnerIndice } from '../correcteur.js';
import { delaiTexte } from '../fsrs.js';
import { clozeParts, refText, plainQ } from '../texte.js';
import { choisirQcm } from '../qcm.js';
import { reconnaissanceDisponible, messageEcoute } from '../voix.js';
import { ecouteGeminiDisponible, libererMicro } from '../ecoutegemini.js';
import {
  h, vider, bouton, boutonConfirme, icone, toast, annoncer, ouvrirFiche, ficheNoeud, titreFiche,
  verdictNoeud, VERDICTS, BADGES, imageSvg, nb, estTactile, aideVue, compterAide, empiler, depiler, bandeau, texteEncore, texteAtteint,
} from './commun.js';

const CONSIGNES = {
  fait: 'Une réponse précise.',
  raisonnement: 'Explique le mécanisme, en quelques phrases.',
};
const DELAI_ENTREE = 600;        // protège le verdict d'une touche Entrée répétée
const DELAI_MAX = 25000;         // au-delà, correction sur l'appareil quoi qu'il arrive

const majuscule = t => (t ? t[0].toUpperCase() + t.slice(1) : t);

function consigne(carte) {
  if (carte.type === 'cloze') {
    const n = clozeParts(carte.q).filter(p => typeof p !== 'string').length;
    return n > 1 ? 'Complète les blancs, dans l\'ordre, séparés par des virgules.' : 'Complète le blanc.';
  }
  return CONSIGNES[carte.type] || CONSIGNES.fait;
}

// Question en grand ; texte à trous : blancs numérotés s'il y en a plusieurs.
function questionNoeud(carte, { petite = false } = {}) {
  const classe = ['question', petite && 'question--petite'];
  if (carte.type !== 'cloze') return h('h1', { class: classe, tabindex: '-1', text: carte.q });
  const parts = clozeParts(carte.q);
  const trous = parts.filter(p => typeof p !== 'string').length;
  let i = 0;
  return h('h1', { class: classe, tabindex: '-1' }, parts.map(p => {
    if (typeof p === 'string') return p;
    i++;
    return h('span', { class: 'blanc', 'aria-label': trous > 1 ? `blanc ${i}` : 'blanc' }, trous > 1 ? h('span', { class: 'blanc__n', text: String(i) }) : null);
  }));
}

// Réponse attendue : phrase complète pour un texte à trous (trous en gras), sinon la réponse.
function reponseAttendue(carte) {
  if (carte.type === 'cloze') {
    return h('p', { class: 'attendue' }, clozeParts(carte.q).map(p => (typeof p === 'string' ? p : h('strong', { class: 'trou-rempli', text: p.ans }))));
  }
  return h('p', { class: 'attendue', text: refText(carte) });
}

function liste(titre, items, classe) {
  const l = (items || []).map(x => String(x || '').trim()).filter(Boolean);
  if (!l.length) return null;
  return h('section', { class: ['bloc-liste', classe] }, h('h3', { class: 'petit-titre', text: titre }), h('ul', null, l.map(x => h('li', { text: x }))));
}

// Commentaire de la carte (le pourquoi) et moyen mnémotechnique : après la réponse, quel que soit le verdict.
function pourComprendre(carte) {
  const texte = x => (typeof x === 'string' ? x.trim() : '');
  const commentaire = texte(carte?.commentaire), mnemo = texte(carte?.mnemo);
  if (!commentaire && !mnemo) return null;
  return h('section', { class: 'bloc-liste bloc-liste--comprendre' },
    commentaire ? [h('h3', { class: 'petit-titre', text: 'Pour comprendre' }), h('p', { class: 'commentaire', text: commentaire })] : null,
    mnemo ? [h('h3', { class: 'petit-titre', text: 'Pour retenir' }), h('p', { class: 'mnemo', text: mnemo })] : null);
}

function ficheDe(donnees, carte, paquet) {
  if (carte?.fiche && donnees.fiches?.[carte.fiche]) return donnees.fiches[carte.fiche];
  return donnees.fiches?.[paquet] || null;
}

export function creer(ctx, params = {}) {
  // Micro : reconnaissance du navigateur, ou enregistrement transcrit par Gemini (ctx.creerEcoute).
  const micro = !!reconnaissanceDisponible(window) || (ecouteGeminiDisponible(window) && !!ctx.cles().gemini);
  let donnees = ctx.donnees();
  const modeQcm = params.mode === 'qcm';
  const seance = new Seance({
    donnees, maintenant: () => ctx.maintenant(), filtre: params.filtre || 'tout', enAvance: !!params.enAvance,
    mode: modeQcm ? 'qcm' : 'ecrit', max: modeQcm ? qcmRestants(donnees, ctx.maintenant()) : Infinity,
  });
  const objectifAuDepart = ctx.atteint();
  let objectifAnnonce = objectifAuDepart;
  const geminiPrevenu = new Set();   // codes d'erreur de Gemini déjà signalés dans cette séance
  let etat = 'debut';
  let actionEntree = null;    // ce que fait la touche Entrée dans l'état courant
  let debutCarte = 0;
  let ecoute = null;
  let clavierOuvert = false;
  let rang0 = 0, total0 = 0;
  const ratees = new Set();
  let entree = null;
  let correctionEnCours = false;   // une réponse part à la correction (Gemini) : elle comptera même après « Terminer »
  let verdictAffiche = null;       // verdict à l'écran (une contestation qui aboutit plus tard ne le réaffiche que s'il y est encore)
  let quitte = false;

  // --- Barre du haut : Terminer, position, progression ---
  const position = h('p', { class: 'seance-haut__position', 'aria-live': 'off' });
  const progression = h('progress', { class: 'barre barre--seance', max: '1', value: '0', 'aria-label': 'Progression de la séance' });
  const terminer = boutonConfirme('Terminer', 'Touche encore', () => afficherFin(), { discret: true, classe: 'btn--petit' });
  const barreHaut = h('div', { class: 'seance-haut' }, h('div', { class: 'seance-haut__in' }, terminer, position), progression);

  const contenu = h('div', { class: 'page page--seance' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'seance' }, contenu, barre);

  function majHaut(rang, total) {
    if (rang) { rang0 = rang; total0 = total; }
    position.textContent = etat === 'fin' ? '' : etat === 'fiche' ? 'Micro-fiche' : total0 ? `Carte ${Math.min(rang0, total0)} sur ${total0}` : '';
    progression.max = Math.max(1, total0);
    progression.value = etat === 'fin' ? progression.max : Math.max(0, rang0 - 1);
    terminer.hidden = etat === 'fin';
  }

  function arreterMicro() {
    if (ecoute?.active) { try { ecoute.annuler(); } catch { /* rien */ } }
    ecoute = null;
  }

  function suivant() {
    arreterMicro();
    actionEntree = null;
    donnees = ctx.donnees();
    seance.majDonnees(donnees);
    const e = seance.etape();
    if (e.type === 'fiche') afficherFicheEtape(e);
    else if (e.type === 'pause') afficherPause(e);
    else if (e.type === 'carte') afficherCarte(e);
    else afficherFin();
    window.scrollTo(0, 0);
  }

  // Bouton micro dans un champ : texte en direct, ajouté à ce qui est déjà écrit.
  function brancherMicro(champ, statut, apres, carte = null) {
    if (!micro) return null;
    const btn = h('button', { type: 'button', class: 'micro', 'aria-label': 'Répondre à voix haute', 'aria-pressed': 'false' }, icone('micro'));
    btn.addEventListener('click', async () => {
      if (ecoute?.active) { ecoute.arreter(); return; }
      const silence = Math.round((Number(ctx.reglages().voix?.silence) || 2.5) * 1000);
      const e = ecoute = ctx.creerEcoute({ silence });
      e.contexte = { question: carte ? plainQ(carte) : '' };
      const parGemini = 'contexte' in e && 'finParole' in e;
      e.addEventListener('niveau', ev => btn.style.setProperty('--niveau', ev.detail.toFixed(2)));
      e.addEventListener('transcription', () => { statut.textContent = 'Transcription…'; });
      const base = champ.value.trim();
      const joindre = t => [base, String(t || '').trim()].filter(Boolean).join(base && /[.,;:!?]$/.test(base) ? ' ' : ' ');
      e.addEventListener('partiel', ev => { champ.value = joindre(ev.detail); champ.dispatchEvent(new Event('input')); });
      btn.classList.add('actif');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', "Arrêter l'écoute");
      statut.textContent = parGemini ? "J'écoute… parle normalement ; je m'arrête après un silence, ou touche le micro." : "J'écoute… touche le micro pour arrêter.";
      statut.className = 'statut-micro statut-micro--actif';
      const texte = await e.demarrer();
      if (ecoute !== e && ecoute !== null) return;
      btn.classList.remove('actif');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Répondre à voix haute');
      statut.className = 'statut-micro';
      if (e.erreur) {
        statut.textContent = e.erreur.code === 'no-speech' ? "Je n'ai rien entendu. Réessaie, plus près du micro." : (e.erreur.message || messageEcoute(e.erreur.code));
        statut.classList.add('statut-micro--erreur');
      } else {
        statut.textContent = '';
        if (texte) { champ.value = joindre(texte); champ.dispatchEvent(new Event('input')); }
        apres?.();
      }
      if (ecoute === e) ecoute = null;
    });
    return btn;
  }

  // --- Étape : micro-fiche avant les nouvelles cartes ---
  function afficherFicheEtape(e) {
    etat = 'fiche';
    const fiche = donnees.fiches[e.ficheId];
    const ensuite = seance.nouvellesDeFiche(e.ficheId);
    majHaut();
    vider(contenu,
      h('p', { class: 'surtitre surtitre--veineux', text: 'Avant les nouvelles cartes' }),
      h('div', { class: 'feuille-fiche' }, ficheNoeud(fiche)),
      ensuite ? h('p', { class: 'aide', text: `Ensuite : ${nb(ensuite, 'nouvelle carte', 'nouvelles cartes')} de ce cours.` }) : null);
    const lu = () => { seance.ficheVue(); suivant(); };
    vider(barre, bouton("J'ai lu, on y va", { principal: true, onClick: lu }));
    actionEntree = lu;
    contenu.querySelector('h2')?.setAttribute('tabindex', '-1');
    contenu.querySelector('h2')?.focus({ preventScroll: true });
  }

  // --- Étape : pause conseillée ---
  function afficherPause(e) {
    etat = 'pause';
    majHaut();
    vider(contenu,
      h('h1', { class: 'titre-page', tabindex: '-1', text: `${e.faites} cartes faites. Une pause ?` }),
      h('p', { class: 'chiffres', text: `${e.minutes} min · ${compteDuJour()}` }),
      h('p', { class: 'chapeau', text: 'Ton attention baisse avant que tu la sentes baisser. Cinq minutes loin de l\'écran, puis tu reprends. Ou tu t\'arrêtes là : les cartes restantes attendront.' }));
    const continuer = () => { seance.continuer(); suivant(); };
    vider(barre, h('div', { class: 'barre-action__rang' },
      bouton("M'arrêter là", { onClick: () => afficherFin() }),
      bouton('Continuer', { principal: true, onClick: continuer })));
    actionEntree = continuer;
    contenu.querySelector('h1').focus({ preventScroll: true });
  }

  // --- Étape : une carte ---
  function afficherCarte(e) {
    // Séance QCM : propositions tirées à chaque affichage ; sans leurre possible, la carte s'écrit.
    e.qcm = modeQcm ? propositionsCarte(e.carte, e.paquet, donnees) : null;
    if (e.qcm) { afficherCarteQcm(e); return; }
    etat = 'carte';
    const { carte, paquet, nouvelle, rang, total } = e;
    majHaut(rang, total);
    debutCarte = ctx.maintenant();
    const paquetNom = donnees.paquets[paquet]?.nom || paquet;
    const encore = ratees.has(paquet + '/' + carte.id);
    const champ = h('textarea', {
      id: 'reponse', class: ['reponse', carte.type === 'raisonnement' && 'reponse--haute'], rows: carte.type === 'raisonnement' ? '5' : '3',
      placeholder: micro ? 'Écris ou dicte ta réponse…' : 'Écris ta réponse…', 'aria-label': 'Ta réponse',
      autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'send',
    });
    const statut = h('p', { class: 'statut-micro', 'aria-live': 'polite' });
    // Toujours répondre avant de voir la correction : champ vide, « Corriger » le rappelle.
    const demanderReponse = () => { statut.textContent = 'Écris ta réponse, ou touche « Je ne sais pas ».'; statut.className = 'statut-micro'; };
    const principal = bouton('Corriger', { principal: true, onClick: () => (champ.value.trim() ? corrigerCarte(e, champ.value) : demanderReponse()) });
    const nsp = bouton('Je ne sais pas', { onClick: () => corrigerCarte(e, '', true) });
    // Indice : début de la première idée ; la réponse vaudra au mieux « partiel ».
    e.indice = false;
    const texteIndice = indice(carte);
    const zoneIndice = h('div', { class: 'indice', 'aria-live': 'polite' });
    if (texteIndice) {
      vider(zoneIndice, h('button', { type: 'button', class: 'lien lien--indice', onclick: () => {
        e.indice = true;
        vider(zoneIndice, h('p', { class: 'indice__texte' }, h('span', { class: 'indice__titre', text: 'Indice : ' }), h('span', { class: 'indice__mots', text: texteIndice })),
          h('p', { class: 'aide', text: "Avec l'indice, une réponse juste compte « partiel »." }));
        champ.focus({ preventScroll: true });
      } }, 'Indice'));
    }
    champ.addEventListener('input', () => {
      if (!ecoute?.active && statut.textContent && !statut.classList.contains('statut-micro--erreur')) statut.textContent = '';
    });
    const btnMicro = brancherMicro(champ, statut, () => principal.focus({ preventScroll: true }), carte);

    const montrerAide = !aideVue('premiere-carte', 3);
    if (montrerAide) compterAide('premiere-carte');
    vider(contenu,
      h('p', { class: 'etiquette-carte' },
        h('span', { class: ['puce', nouvelle && !encore ? 'puce--nouvelle' : 'puce--revision'] }, icone(nouvelle && !encore ? 'etoile' : 'boucle'),
          encore ? 'Encore une fois' : nouvelle ? 'Nouvelle' : 'Révision'),
        h('span', { class: 'etiquette-carte__paquet', text: paquetNom })),
      questionNoeud(carte),
      h('p', { class: 'consigne', text: consigne(carte) }),
      imageSvg(carte.svg),
      h('div', { class: ['champ-reponse', btnMicro && 'champ-reponse--micro'] }, champ, btnMicro),
      statut,
      zoneIndice,
      montrerAide ? h('p', { class: 'aide', text: 'Quelques mots suffisent, même incomplet. Tu bloques ? « Indice ». Tu découvres la carte ? « Je ne sais pas ».' }) : null,
      !micro && montrerAide ? h('p', { class: 'aide aide--ligne' }, icone('micro'), 'Astuce : le micro de ton clavier permet de dicter.') : null,
      h('p', { class: 'aide aide--pc', text: 'Entrée : corriger · Maj+Entrée : à la ligne' }));
    vider(barre, h('div', { class: 'barre-action__rang barre-action__rang--carte' }, nsp, principal));

    actionEntree = () => {
      if (champ.value.trim()) corrigerCarte(e, champ.value);
      else demanderReponse();
    };
    // Sur PC le champ prend le focus ; sur téléphone, seulement si le clavier était ouvert (pas sur la 1re carte).
    if (!estTactile() || clavierOuvert) champ.focus({ preventScroll: true });
    else contenu.querySelector('h1')?.focus({ preventScroll: true });
  }

  // --- Étape : une carte en QCM (jour sans élan) ---
  function afficherCarteQcm(e) {
    etat = 'carte';
    const { carte, paquet, nouvelle, rang, total } = e;
    majHaut(rang, total);
    debutCarte = ctx.maintenant();
    arreterMicro();
    const encore = ratees.has(paquet + '/' + carte.id);
    const choisir = p => {
      if (etat !== 'carte') return;
      etat = 'correction';
      actionEntree = null;
      noter(e, resultatQcmCarte(p), p.texte, [], true);
    };
    const lettres = 'ABCDEFGH';
    vider(contenu,
      h('p', { class: 'etiquette-carte' },
        h('span', { class: ['puce', nouvelle && !encore ? 'puce--nouvelle' : 'puce--revision'] }, icone(nouvelle && !encore ? 'etoile' : 'boucle'),
          encore ? 'Encore une fois' : nouvelle ? 'Nouvelle' : 'Révision'),
        h('span', { class: 'etiquette-carte__paquet', text: donnees.paquets[paquet]?.nom || paquet }),
        h('span', { class: 'etiquette-carte__mode', text: 'QCM' })),
      questionNoeud(carte),
      h('p', { class: 'consigne', text: 'Choisis la bonne réponse.' }),
      imageSvg(carte.svg),
      h('div', { class: 'choix-qcm', role: 'group', 'aria-label': 'Propositions' }, e.qcm.map((p, i) =>
        h('button', { type: 'button', class: 'choix-qcm__btn', onclick: () => choisir(p) },
          h('span', { class: 'choix-qcm__lettre', 'aria-hidden': 'true', text: lettres[i] }),
          h('span', { class: 'choix-qcm__texte', text: p.texte })))),
      h('p', { class: 'aide', text: "Une bonne réponse compte « partiel ». L'ordre change à chaque fois." }));
    vider(barre, h('div', { class: 'barre-action__rang barre-action__rang--carte' },
      bouton('Je ne sais pas', { onClick: () => corrigerCarte(e, '', true) })));
    contenu.querySelector('h1')?.focus({ preventScroll: true });
  }

  // --- Correction ---
  async function corrigerCarte(e, texte, jeNeSaisPas = false) {
    if (etat !== 'carte') return;
    etat = 'correction';
    correctionEnCours = true;
    actionEntree = null;
    arreterMicro();
    const { carte, paquet } = e;
    const reponse = jeNeSaisPas ? '' : String(texte || '').trim();
    clavierOuvert = estTactile() && document.activeElement?.id === 'reponse';
    const champ = contenu.querySelector('#reponse');
    if (champ) champ.readOnly = true;
    const attente = bouton('Correction…', { principal: true, classe: 'btn--attente', attrs: { disabled: true } });
    const lent = h('p', { class: 'aide aide--centre', 'aria-live': 'polite' });
    vider(barre, h('div', { class: 'barre-action__pile' }, lent, attente));
    const t1 = setTimeout(() => { lent.textContent = 'Gemini prend son temps…'; }, 6000);
    let res;
    const d = ctx.donnees();
    const local = code => ({
      resultat: { ...corrigerLocal(carte, reponse, { idf: ctx.idf(), abreviations: d.carnet?.abreviations || {} }), correcteur: 'hors-ligne', erreurGemini: { code, message: 'Gemini a mis trop de temps à répondre.' } },
      ops: [],
    });
    try {
      let minuterie;
      const garde = new Promise(ok => { minuterie = setTimeout(() => ok(local('delai')), DELAI_MAX); });
      res = await Promise.race([
        corriger({ carte, paquet, reponse, donnees: d, gemini: ctx.gemini(), enLigne: ctx.enLigne(), idf: ctx.idf(), maintenant: ctx.maintenant(), appareil: ctx.appareil }),
        garde,
      ]);
      clearTimeout(minuterie);
    } catch (err) {
      console.warn('Correction', err);
      res = local('format');
      res.resultat.erreurGemini = null;
      res.resultat.correcteur = 'local';
    }
    clearTimeout(t1);
    correctionEnCours = false;
    // « Terminer » (ou un autre écran) pendant la correction : la réponse compte, sans réafficher le verdict.
    const visible = etat === 'correction' && !quitte;
    noter(e, e.indice ? plafonnerIndice(res.resultat) : res.resultat, reponse, res.ops || [], visible);
    if (etat === 'fin') rendreFin();
    else if (quitte) ctx.sync.pousser('fin-seance').catch(() => {});
  }

  // Note la carte, enregistre les opérations, puis affiche le verdict (ou passe à la suite).
  function noter(e, resultat, reponse, opsCorrection, montrer) {
    const t = ctx.maintenant();
    const avant = ctx.cartes();
    const note = seance.noter({
      verdict: resultat.verdict, correcteur: resultat.correcteur, reponse, duree: Math.max(0, t - debutCarte),
      confiance: resultat.confiance, indice: !!e.indice, mode: e.qcm ? 'qcm' : 'ecrit', maintenant: t, appareil: ctx.appareil,
    });
    for (const op of [...opsCorrection, ...note.ops]) ctx.sync.ajouter(op);
    donnees = ctx.donnees();
    seance.majDonnees(donnees);
    if (resultat.verdict === 'faux') ratees.add(e.paquet + '/' + e.carte.id);
    const apres = ctx.cartes();
    const v = { e, resultat, reponse, note, etatApres: note.etatApres, avant, apres, conteste: false, issue: null };
    if (montrer) afficherVerdict(v);
    return v;
  }

  // Quand la carte revient : ratée, 4 cartes plus loin dans cette séance (pas « dans 10 min »).
  function quandRevient(v, maintenant) {
    return v.resultat.verdict === 'faux' ? 'revient un peu plus loin dans la séance' : delaiTexte(v.etatApres, maintenant);
  }

  // Cartes du jour et révisions restantes, comme l'en-tête.
  function compteDuJour() {
    const j = ctx.jour();
    return `cartes : ${j.cartes}/${j.objectif}${j.revisionsRestantes ? ` · révisions : ${j.revisionsRestantes}` : ''}`;
  }

  // Ce que la réponse change au compteur, dit en clair (une carte compte une fois par jour).
  function effet(v) {
    const obj = ctx.objectif();
    const n = ctx.cartes();
    if (n > v.avant) return `+1 carte : ${n}/${obj}`;
    return `Déjà comptée aujourd'hui : ${n}/${obj}`;
  }

  // Ajuste la séance après une contestation acceptée (la carte ratée ne doit plus revenir).
  function corrigerSeance(v, ancien, nouveau) {
    seance.corrigerVerdict(v.e.paquet, v.e.carte.id, ancien, nouveau);
    if (nouveau !== 'faux') ratees.delete(v.e.paquet + '/' + v.e.carte.id);
  }

  // --- Verdict ---
  function afficherVerdict(v) {
    etat = 'verdict';
    verdictAffiche = v;
    const { carte, paquet } = v.e;
    const r = v.resultat;
    const nsp = r.correcteur === 'je-ne-sais-pas';
    const maintenant = ctx.maintenant();
    const delai = majuscule(quandRevient(v, maintenant)) + '.';
    const ligneEffet = effet(v);
    const fiche = ficheDe(donnees, carte, paquet);
    const cles = ctx.cles();
    const peutContester = !v.conteste && (r.verdict === 'partiel' || r.verdict === 'faux')
      && !['je-ne-sais-pas', 'contestation', 'qcm'].includes(r.correcteur) && !v.e.qcm && !!cles.gemini && ctx.enLigne()
      && !(v.e.indice && r.verdict === 'partiel'); // après un indice, « partiel » est le plafond

    const bandeauVerdict = verdictNoeud(r, { lignes: [nsp ? `Pas grave. ${delai}` : delai, h('p', { class: 'verdict__effet', text: ligneEffet })] });
    const attendue = h('section', { class: 'bloc-liste' }, h('h3', { class: 'petit-titre', text: 'Réponse attendue' }), reponseAttendue(carte));
    const taReponse = v.reponse ? h('section', { class: 'bloc-liste bloc-liste--doux' }, h('h3', { class: 'petit-titre', text: 'Ta réponse' }), h('p', { class: 'ta-reponse', text: `« ${v.reponse} »` })) : null;
    const trouvees = liste('Ce que tu as dit de juste', r.idees_trouvees, 'bloc-liste--juste');
    const manque = nsp ? null : liste('Ce qui manquait', r.idees_manquantes, 'bloc-liste--manque');
    const erreurs = liste('Erreur', r.erreurs, 'bloc-liste--erreur');
    const explication = r.explication ? h('p', { class: 'explication', text: r.explication }) : null;

    let corps;
    if (r.verdict === 'juste') {
      corps = [explication, h('details', { class: 'details' }, h('summary', { text: 'Détails' }), trouvees, attendue, taReponse)];
    } else if (r.verdict === 'partiel') {
      corps = [manque, erreurs, explication, attendue, trouvees, taReponse];
    } else {
      corps = [attendue, manque, erreurs, nsp ? null : explication, taReponse];
    }

    const zoneExplication = h('div', { class: 'explication-gemini', 'aria-live': 'polite' });
    const lienExplique = cles.gemini && ctx.enLigne() ? h('button', { type: 'button', class: 'lien', text: 'Explique-moi',
      onclick: () => ouvrirExplication(v, zoneExplication, lienExplique) }) : null;
    const zoneContestation = h('div', { class: 'contestation' });
    const lienConteste = peutContester ? h('button', { type: 'button', class: 'lien', text: 'Je conteste',
      onclick: () => ouvrirContestation(v, zoneContestation, lienConteste) }) : null;
    const badge = BADGES[r.correcteur] || '';
    const pied = (badge || lienConteste || lienExplique) ? h('div', { class: 'pied-verdict' }, badge ? h('span', { class: 'badge', text: badge }) : null, lienExplique, lienConteste) : null;

    const notes = [];
    // Gemini indisponible : un seul message bref (le badge du verdict dit déjà qui a corrigé).
    if (r.erreurGemini && !geminiPrevenu.has(r.erreurGemini.code)) {
      geminiPrevenu.add(r.erreurGemini.code);
      toast(r.erreurGemini.code === 'quota' ? 'Gemini est saturé pour l\'instant : correction faite sur ton appareil.'
        : `${(r.erreurGemini.message || 'Gemini ne répond pas.').replace(/\s*$/, '')} Je corrige sur ton appareil.`, { duree: 5000 });
    }
    if (v.issue) notes.push(h('p', { class: ['issue', v.issue.ok ? 'issue--ok' : 'issue--non'], role: 'status' }, icone(v.issue.ok ? 'juste' : 'info'), v.issue.texte));
    let terminerIci = null;
    if (!objectifAnnonce && ctx.atteint()) {
      objectifAnnonce = true;
      terminerIci = h('button', { type: 'button', class: 'lien', text: "M'arrêter là", onclick: () => afficherFin() });
      notes.push(bandeau(texteAtteint(ctx.jour()), { type: 'reussite', action: terminerIci }));
    }

    vider(contenu,
      questionNoeud(carte, { petite: true }),
      bandeauVerdict,
      notes,
      corps,
      pourComprendre(carte),
      fiche ? h('button', { type: 'button', class: 'lien lien--fiche', onclick: () => ouvrirFiche(fiche) }, icone('fiche'), `Voir la fiche : ${titreFiche(fiche)}`) : null,
      pied,
      zoneExplication,
      zoneContestation);

    const affiche = Date.now();
    const continuer = () => suivant();
    const btnSuivant = bouton('Suivant', { principal: true, onClick: continuer });
    vider(barre, btnSuivant);
    actionEntree = () => { if (Date.now() - affiche > DELAI_ENTREE) continuer(); };
    const mot = nsp ? 'Voici la réponse' : VERDICTS[r.verdict]?.mot || 'Faux';
    annoncer(`${mot}. ${delai} ${ligneEffet}`);
    if (estTactile()) bandeauVerdict.focus({ preventScroll: true });
    else btnSuivant.focus({ preventScroll: true });
  }

  // « Explique-moi » : explication de Gemini sur demande, avec une question facultative.
  function ouvrirExplication(v, zone, lien) {
    lien.hidden = true;
    const question = h('textarea', { id: 'question-gemini', class: 'reponse', rows: '2', placeholder: 'Une question précise ? (facultatif)', autocomplete: 'off', spellcheck: 'false' });
    const statut = h('p', { class: 'statut-micro', 'aria-live': 'polite' });
    const demander = bouton('Demander', { onClick: () => envoyer() });
    vider(zone, h('div', { class: 'bloc-liste' }, h('h3', { class: 'petit-titre', text: 'Explique-moi' }), question, statut, demander));
    question.focus({ preventScroll: true });
    async function envoyer() {
      demander.disabled = true;
      question.readOnly = true;
      statut.className = 'statut-micro';
      statut.textContent = 'Gemini réfléchit…';
      const g = ctx.gemini();
      try {
        const r = await expliquerGemini(v.e.carte, { reponse: v.reponse, verdict: v.resultat.verdict, question: question.value.trim() },
          { cle: g.cle, fetch: g.fetch, modele: ctx.donnees().reglages?.modeles?.contestation || undefined });
        if (!zone.isConnected) return;
        vider(zone, h('section', { class: 'bloc-liste bloc-liste--comprendre' },
          h('h3', { class: 'petit-titre', text: 'Explication de Gemini' }),
          question.value.trim() ? h('p', { class: 'aide', text: `« ${question.value.trim()} »` }) : null,
          h('p', { class: 'commentaire', text: r.explication }),
          r.mnemo ? h('p', { class: 'mnemo', text: r.mnemo }) : null));
      } catch (err) {
        if (err?.name === 'ErreurGemini') ctx.sync.ajouter(opErreur(err, { contexte: 'explication', maintenant: ctx.maintenant(), appareil: ctx.appareil }));
        if (!zone.isConnected) return;
        statut.className = 'statut-micro statut-micro--erreur';
        statut.textContent = err?.name === 'ErreurGemini' ? err.message : "Pas d'explication possible maintenant. Réessaie plus tard.";
        demander.disabled = false;
        question.readOnly = false;
      }
    }
  }

  function ouvrirContestation(v, zone, lien) {
    lien.hidden = true;
    const raison = h('textarea', { id: 'raison', class: 'reponse', rows: '2', placeholder: 'Ex. : RAo = rétrécissement aortique', autocomplete: 'off', spellcheck: 'false' });
    const statut = h('p', { class: 'statut-micro', 'aria-live': 'polite' });
    const btnMicro = brancherMicro(raison, statut);
    const envoyer = bouton('Demander un second avis', { classe: 'btn--plein', onClick: lancer });
    const annuler = bouton('Annuler', { discret: true, onClick: () => { vider(zone); lien.hidden = false; arreterMicro(); } });
    raison.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); lancer(); } });
    vider(zone,
      h('label', { for: 'raison', class: 'champ__libelle', text: 'Pourquoi ta réponse est juste ? (facultatif)' }),
      h('div', { class: ['champ-reponse', btnMicro && 'champ-reponse--micro'] }, raison, btnMicro),
      statut,
      h('div', { class: 'rang-boutons' }, annuler, envoyer));
    raison.focus({ preventScroll: false });

    async function lancer() {
      arreterMicro();
      envoyer.disabled = true;
      annuler.disabled = true;
      raison.readOnly = true;
      statut.textContent = 'Je demande un second avis…';
      statut.className = 'statut-micro statut-micro--actif';
      const ancien = v.resultat.verdict;
      try {
        const c = await contester({
          carte: v.e.carte, paquet: v.e.paquet, reponse: v.reponse, resultat: v.resultat, raison: raison.value.trim(),
          etatAvant: v.note.etatAvant, donnees: ctx.donnees(), gemini: ctx.gemini(), enLigne: ctx.enLigne(),
          maintenant: ctx.maintenant(), appareil: ctx.appareil, ligneId: v.note.ligne.id, indice: !!v.e.indice,
        });
        for (const op of c.ops || []) ctx.sync.ajouter(op);
        donnees = ctx.donnees();
        seance.majDonnees(donnees);
        v.conteste = true;
        const mot = VERDICTS[c.accepte ? c.resultat.verdict : ancien]?.mot || (c.accepte ? c.resultat.verdict : ancien);
        if (c.accepte) {
          corrigerSeance(v, ancien, c.resultat.verdict);
          v.resultat = c.resultat;
          if (c.etatApres) v.etatApres = c.etatApres;
          v.issue = { ok: true, texte: `Tu avais raison : verdict corrigé en « ${mot} ».` };
        } else {
          const expl = c.resultat?.explication || c.avis?.explication || '';
          v.issue = { ok: false, texte: `Le second avis maintient « ${mot} ».${expl ? ' ' + expl : ''}` };
        }
        if (etat === 'verdict' && verdictAffiche === v && !quitte) afficherVerdict(v);
        else {
          // Il est déjà passé à la suite : l'issue est signalée sans le ramener en arrière.
          toast(c.accepte ? `Second avis : tu avais raison, verdict corrigé en « ${mot} ».` : `Second avis : « ${mot} » est maintenu.`, { duree: 5000 });
          if (etat === 'fin' && !quitte) rendreFin();
          else if (etat === 'carte' && c.accepte) {
            const suite = seance.etape();   // la reprise a pu disparaître : « Carte 2 sur 5 » au lieu de « sur 6 »
            if (suite.type === 'carte') majHaut(suite.rang, suite.total);
          }
        }
      } catch (err) {
        for (const op of err?.ops || []) ctx.sync.ajouter(op);
        const message = err?.name === 'ErreurGemini' ? `${err.message}${/Réessaie/.test(err.message) ? '' : ' Réessaie plus tard.'}` : 'Pas de second avis possible maintenant. Réessaie plus tard.';
        if (!(etat === 'verdict' && verdictAffiche === v) || quitte) { toast(`Second avis : ${message}`, { duree: 5000 }); return; }
        statut.className = 'statut-micro statut-micro--erreur';
        statut.textContent = message;
        envoyer.disabled = false;
        annuler.disabled = false;
        raison.readOnly = false;
      }
    }
  }

  // --- Fin ---
  const ligneSynchro = h('p', { class: 'etat-envoi', 'aria-live': 'polite' });
  function majLigneSynchro() {
    const s = ctx.sync.etat;
    ligneSynchro.dataset.mode = s.mode;
    ligneSynchro.textContent = s.mode === 'a-jour' ? 'Tout est enregistré.' : ctx.messageEtat?.(s) ?? s.message ?? '';
  }

  function afficherFin() {
    if (etat === 'fin') return;
    etat = 'fin';
    verdictAffiche = null;
    arreterMicro();
    libererMicro();
    actionEntree = null;
    majHaut();
    rendreFin();
  }

  // Bilan de fin (rejoué si une correction en cours aboutit après « Terminer »).
  function rendreFin() {
    if (quitte) return;
    ctx.sync.pousser('fin-seance').catch(() => {});
    majLigneSynchro();
    const interrompue = seance.etape().type !== 'fin';
    const b = seance.bilan;
    const jour = ctx.jour();
    const { objectif: obj, cartes: n, atteint } = jour;
    const filtre = params.filtre || 'tout';
    // Séance sur un paquet, finie, objectif pas atteint : ce qui manque est dans les autres paquets.
    const tout = apportDuFiltre(ctx.donnees(), ctx.maintenant(), 'tout');
    const nTout = tout.revisions + tout.reprises + tout.nouvelles;
    const versTout = !atteint && filtre !== 'tout' && nTout > 0;
    // La carte en cours de correction ne compte plus parmi les restantes : sa réponse est donnée.
    const restantes = interrompue ? Math.max(0, seance.restantes() - (correctionEnCours ? 1 : 0)) : 0;
    const fiches = (b.fichesARelire || []).map(id => donnees.fiches[id]).filter(Boolean);
    // Même série que « Mélange » dans QCM : dus et jamais faits.
    const nQcm = choisirQcm(ctx.donnees(), ctx.maintenant(), { n: Number(ctx.reglages().qcmParSeance) || 8, choix: 'a-faire' }).length;
    // Compteurs à zéro omis (« 0 partielle · 0 fausse » n'apprend rien).
    const detail = [nb(b.faites, 'réponse'), b.justes && nb(b.justes, 'juste'), b.partielles && nb(b.partielles, 'partielle'),
      b.fausses && nb(b.fausses, 'fausse'), `${b.minutes} min`].filter(Boolean).join(' · ');

    vider(contenu,
      h('h1', { class: 'titre-page', tabindex: '-1', text: 'Séance terminée' }),
      h('div', { class: ['grand-compteur', atteint && 'grand-compteur--atteint'] },
        h('p', { class: 'grand-compteur__chiffre' }, `${n}/${obj}`, atteint ? icone('juste') : null),
        h('p', { class: 'grand-compteur__texte', text: "cartes aujourd'hui" }),
        h('progress', { class: 'barre barre--grande', max: String(obj), value: String(Math.min(n, obj)), 'aria-hidden': 'true' })),
      h('p', { class: 'chiffres chiffres--doux', text: detail }),
      !atteint ? h('p', { class: 'objectif-ligne', text: `${majuscule(texteEncore(jour))} pour l'objectif.${versTout && !restantes ? ' Il en reste dans les autres paquets.' : ''}` })
        : h('p', { class: 'objectif-ligne', text: "Objectif du jour atteint. Tu peux t'arrêter là." }),
      fiches.length ? h('section', { class: 'a-relire' }, h('h2', { class: 'petit-titre', text: 'Fiches à relire' }),
        h('div', { class: 'pastilles pastilles--enveloppe' }, fiches.map(f => h('button', { type: 'button', class: 'pastille', onclick: () => ouvrirFiche(f) }, icone('fiche'), h('span', { text: titreFiche(f) }))))) : null,
      correctionEnCours ? h('p', { class: 'aide', 'aria-live': 'polite', text: 'Je finis de corriger ta dernière réponse…' }) : null,
      ligneSynchro);

    // Un seul bouton principal, selon la situation.
    const boutons = [];
    const retour = () => ctx.aller('aujourdhui', { filtre });
    if (restantes > 0 && !atteint) {
      boutons.push(bouton('Retour', { onClick: retour }));
      boutons.push(bouton(`Continuer · ${nb(restantes, 'carte')}`, { principal: true, attrs: { disabled: correctionEnCours }, onClick: () => {
        if (correctionEnCours) return;
        etat = 'reprise';
        if (seance.etape().type === 'pause') seance.continuer();
        suivant();
      } }));
    } else if (versTout) {
      // Révisions d'abord : elles sont dans les autres paquets (pas de révision en avance sur celui-ci).
      boutons.push(bouton('Retour', { onClick: retour }));
      boutons.push(bouton(`Continuer · Tout (${nTout})`, { principal: true, onClick: () => ctx.aller('seance', { filtre: 'tout' }) }));
    } else if (!atteint && revisionsEnAvance(ctx.donnees(), ctx.maintenant(), filtre).length) {
      boutons.push(nQcm ? bouton(`Faire ${nQcm} QCM`, { onClick: () => ctx.aller('qcm', { demarrer: true }) }) : bouton('Retour', { onClick: retour }));
      boutons.push(bouton('Réviser en avance', { principal: true, onClick: () => ctx.aller('seance', { filtre, enAvance: true }) }));
    } else if (nQcm) {
      boutons.push(bouton('Retour', { onClick: retour }));
      boutons.push(bouton(`Faire ${nQcm} QCM`, { principal: true, onClick: () => ctx.aller('qcm', { demarrer: true }) }));
    } else {
      boutons.push(bouton('Retour', { principal: true, onClick: retour }));
    }
    vider(barre, h('div', { class: 'barre-action__rang' }, boutons));
    if (noeud.isConnected) {
      contenu.querySelector('h1').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  // --- Clavier ---
  function clavier(ev) {
    if (!document.getElementById('surimpression')?.hidden) return;
    if (ev.isComposing || ev.repeat) return;
    const cible = ev.target;
    if (ev.key === 'Escape' && etat !== 'fin') { ev.preventDefault(); terminer.armer(); return; }
    if (ev.key !== 'Enter') return;
    if (cible.id === 'raison' || cible.id === 'question-gemini') return;
    if (cible.id === 'reponse') {
      if (ev.shiftKey && !(ev.ctrlKey || ev.metaKey)) return;   // Maj+Entrée : à la ligne
      ev.preventDefault();
      actionEntree?.();
      return;
    }
    if (cible.matches?.('button, a, summary, input, select, textarea')) return;   // Entrée sur un bouton : son propre clic
    if (actionEntree) { ev.preventDefault(); actionEntree(); }
  }
  document.addEventListener('keydown', clavier);

  // Retour du téléphone : comme « Terminer » (deux fois pour confirmer).
  function surRetour() {
    entree = null;
    if (etat === 'fin') { ctx.aller('aujourdhui'); return; }
    if (terminer.classList.contains('arme')) terminer.click(); else terminer.armer();
    entree = empiler(surRetour);
  }

  suivant();
  if (etat === 'fin' && seance.bilan.faites === 0) {
    // Rien à faire (données changées entre-temps) : retour à l'écran du jour.
    vider(contenu, h('h1', { class: 'titre-page', text: 'Rien à réviser pour le moment' }), h('p', { class: 'chapeau', text: "Tout est fait. Reviens plus tard, ou fais des QCM." }));
    vider(barre, bouton('Retour', { principal: true, onClick: () => ctx.aller('aujourdhui') }));
  }

  return {
    noeud, barreHaut, titre: 'Séance', plein: true, onglet: 'aujourdhui',
    apres: () => { entree = empiler(surRetour); },
    focus: () => (!estTactile() && contenu.querySelector('#reponse')) || contenu.querySelector('h1, h2'),
    surDonnees: d => { donnees = d; seance.majDonnees(d); },
    surEtat: () => { if (etat === 'fin') majLigneSynchro(); },
    quitter: () => {
      quitte = true;
      document.removeEventListener('keydown', clavier);
      arreterMicro();
      libererMicro();
      if (entree) { const e = entree; entree = null; depiler(e); }
      if (etat !== 'fin' && seance.bilan.faites > 0) ctx.sync.pousser('fin-seance').catch(() => {});
    },
  };
}
