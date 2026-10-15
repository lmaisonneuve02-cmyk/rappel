// Séance : fiche avant les nouvelles cartes, carte, correction, verdict, contestation, pause, fin.
import { Seance } from '../seance.js';
import { corriger, contester } from '../correction.js';
import { corrigerLocal } from '../correcteur.js';
import { delaiTexte } from '../fsrs.js';
import { clozeParts, refText } from '../texte.js';
import { choisirQcm } from '../qcm.js';
import { Ecoute, reconnaissanceDisponible, messageEcoute } from '../voix.js';
import {
  h, vider, bouton, libeller, boutonConfirme, icone, toast, annoncer, ouvrirFiche, ficheNoeud, titreFiche,
  verdictNoeud, VERDICTS, BADGES, imageSvg, nb, estTactile, aideVue, compterAide, empiler, depiler, bandeau,
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

function ficheDe(donnees, carte, paquet) {
  if (carte?.fiche && donnees.fiches?.[carte.fiche]) return donnees.fiches[carte.fiche];
  return donnees.fiches?.[paquet] || null;
}

export function creer(ctx, params = {}) {
  const micro = !!reconnaissanceDisponible(window);
  let donnees = ctx.donnees();
  const seance = new Seance({ donnees, maintenant: () => ctx.maintenant(), filtre: params.filtre || 'tout', enAvance: !!params.enAvance, nouvellesDAbord: true });
  const objectifAuDepart = ctx.atteint();
  let objectifAnnonce = objectifAuDepart;
  const geminiPrevenu = new Set();   // codes d'erreur de Gemini déjà signalés dans cette séance
  let etat = 'debut';
  let actionEntree = null;    // ce que fait la touche Entrée dans l'état courant
  let touches = null;         // raccourcis 1/2/3 de l'auto-évaluation
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
    touches = null;
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
  function brancherMicro(champ, statut, apres) {
    if (!micro) return null;
    const btn = h('button', { type: 'button', class: 'micro', 'aria-label': 'Répondre à voix haute', 'aria-pressed': 'false' }, icone('micro'));
    btn.addEventListener('click', async () => {
      if (ecoute?.active) { ecoute.arreter(); return; }
      const silence = Math.round((Number(ctx.reglages().voix?.silence) || 2.5) * 1000);
      const e = ecoute = new Ecoute({ silence });
      const base = champ.value.trim();
      const joindre = t => [base, String(t || '').trim()].filter(Boolean).join(base && /[.,;:!?]$/.test(base) ? ' ' : ' ');
      e.addEventListener('partiel', ev => { champ.value = joindre(ev.detail); champ.dispatchEvent(new Event('input')); });
      btn.classList.add('actif');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', "Arrêter l'écoute");
      statut.textContent = "J'écoute… touche le micro pour arrêter.";
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
      h('p', { class: 'chiffres', text: `${e.minutes} min · nouvelles : ${ctx.acquises()}/${ctx.objectif()} · révisions : ${ctx.revisions()}` }),
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
    const principal = bouton('Voir la réponse', { principal: true, onClick: () => (champ.value.trim() ? corrigerCarte(e, champ.value) : voirReponse(e)) });
    const nsp = bouton('Je ne sais pas', { onClick: () => corrigerCarte(e, '', true) });
    champ.addEventListener('input', () => {
      libeller(principal, champ.value.trim() ? 'Corriger' : 'Voir la réponse');
      if (!ecoute?.active && statut.textContent && !statut.classList.contains('statut-micro--erreur')) statut.textContent = '';
    });
    const btnMicro = brancherMicro(champ, statut, () => principal.focus({ preventScroll: true }));

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
      montrerAide ? h('p', { class: 'aide', text: 'Quelques mots suffisent, même incomplet. Réponse dans ta tête ? Champ vide, touche « Voir la réponse » et note-toi.' }) : null,
      !micro && montrerAide ? h('p', { class: 'aide aide--ligne' }, icone('micro'), 'Astuce : le micro de ton clavier permet de dicter.') : null,
      h('p', { class: 'aide aide--pc', text: 'Entrée : corriger · Maj+Entrée : à la ligne' }));
    vider(barre, h('div', { class: 'barre-action__rang barre-action__rang--carte' }, nsp, principal));

    actionEntree = () => {
      if (champ.value.trim()) corrigerCarte(e, champ.value);
      else { statut.textContent = 'Écris ta réponse, ou touche « Voir la réponse ».'; statut.className = 'statut-micro'; }
    };
    // Sur PC le champ prend le focus ; sur téléphone, seulement si le clavier était ouvert (pas sur la 1re carte).
    if (!estTactile() || clavierOuvert) champ.focus({ preventScroll: true });
    else contenu.querySelector('h1')?.focus({ preventScroll: true });
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
    noter(e, res.resultat, reponse, res.ops || [], visible);
    if (etat === 'fin') rendreFin();
    else if (quitte) ctx.sync.pousser('fin-seance').catch(() => {});
  }

  // Note la carte, enregistre les opérations, puis affiche le verdict (ou passe à la suite).
  function noter(e, resultat, reponse, opsCorrection, montrer) {
    const t = ctx.maintenant();
    const avant = ctx.acquises();
    const note = seance.noter({
      verdict: resultat.verdict, correcteur: resultat.correcteur, reponse, duree: Math.max(0, t - debutCarte),
      confiance: resultat.confiance, maintenant: t, appareil: ctx.appareil,
    });
    for (const op of [...opsCorrection, ...note.ops]) ctx.sync.ajouter(op);
    donnees = ctx.donnees();
    seance.majDonnees(donnees);
    if (resultat.verdict === 'faux') ratees.add(e.paquet + '/' + e.carte.id);
    const apres = ctx.acquises();
    const v = { e, resultat, reponse, note, etatApres: note.etatApres, avant, apres, conteste: false, issue: null };
    if (montrer) afficherVerdict(v);
    return v;
  }

  // Quand la carte revient : ratée, 4 cartes plus loin dans cette séance (pas « dans 10 min »).
  function quandRevient(v, maintenant) {
    return v.resultat.verdict === 'faux' ? 'revient un peu plus loin dans la séance' : delaiTexte(v.etatApres, maintenant);
  }

  // Ce que la réponse change au compteur, dit en clair.
  function effet(v) {
    const obj = ctx.objectif();
    const n = ctx.acquises();
    if (n > v.avant) return `+1 nouvelle : ${n}/${obj}`;
    return `Nouvelles : ${n}/${obj} · révisions restantes : ${ctx.revisions()}`;
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
      && !['auto', 'je-ne-sais-pas', 'contestation'].includes(r.correcteur) && !!cles.gemini && ctx.enLigne();

    const bandeauVerdict = verdictNoeud(r, { lignes: nsp
      ? [`Pas grave. ${delai}`, h('p', { class: 'verdict__effet', text: 'Réussis-la à ce moment-là : elle comptera.' })]
      : [delai, h('p', { class: 'verdict__effet', text: ligneEffet })] });
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

    const zoneContestation = h('div', { class: 'contestation' });
    const lienConteste = peutContester ? h('button', { type: 'button', class: 'lien', text: 'Je conteste',
      onclick: () => ouvrirContestation(v, zoneContestation, lienConteste) }) : null;
    const badge = BADGES[r.correcteur] || '';
    const pied = (badge || lienConteste) ? h('div', { class: 'pied-verdict' }, badge ? h('span', { class: 'badge', text: badge }) : null, lienConteste) : null;

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
      notes.push(bandeau(`Objectif du jour atteint : ${ctx.acquises()} nouvelles cartes et toutes les révisions. Tu peux t'arrêter ou continuer.`, { type: 'reussite', action: terminerIci }));
    }

    vider(contenu,
      questionNoeud(carte, { petite: true }),
      bandeauVerdict,
      notes,
      corps,
      fiche ? h('button', { type: 'button', class: 'lien lien--fiche', onclick: () => ouvrirFiche(fiche) }, icone('fiche'), `Voir la fiche : ${titreFiche(fiche)}`) : null,
      pied,
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
          maintenant: ctx.maintenant(), appareil: ctx.appareil, ligneId: v.note.ligne.id,
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

  // --- « Voir la réponse » : il se note lui-même ---
  function voirReponse(e) {
    etat = 'auto';
    arreterMicro();
    const { carte, paquet } = e;
    const fiche = ficheDe(donnees, carte, paquet);
    vider(contenu,
      questionNoeud(carte, { petite: true }),
      h('section', { class: 'bloc-liste bloc-liste--attendue' }, h('h2', { class: 'petit-titre', text: 'Réponse attendue', tabindex: '-1' }), reponseAttendue(carte)),
      fiche ? h('button', { type: 'button', class: 'lien lien--fiche', onclick: () => ouvrirFiche(fiche) }, icone('fiche'), `Voir la fiche : ${titreFiche(fiche)}`) : null,
      h('p', { class: 'question-auto', text: "Tu l'avais ?" }),
      h('p', { class: 'aide', text: 'Ta note règle quand la carte reviendra.' }),
      h('p', { class: 'aide aide--pc', text: 'Touches 1, 2, 3' }));
    const choisir = verdict => {
      if (etat !== 'auto') return;
      etat = 'note';
      const resultat = { verdict, idees_trouvees: [], idees_manquantes: [], erreurs: [], confiance: 1, explication: '', correcteur: 'auto' };
      const v = noter(e, resultat, '', [], false);
      const msg = `Noté : ${VERDICTS[verdict].mot.toLowerCase()} · ${quandRevient(v, ctx.maintenant())}. ${effet(v)}`;
      toast(msg, { duree: 2500 });
      annoncer(msg);
      suivant();
    };
    const choix = [['faux', 'Non', '1'], ['partiel', 'En partie', '2'], ['juste', "Je l'avais", '3']];
    vider(barre, h('div', { class: 'barre-action__rang barre-action__rang--trois' },
      choix.map(([verdict, libelle]) => bouton(libelle, { icone: VERDICTS[verdict].icone, classe: `btn--note btn--note-${verdict}`, onClick: () => choisir(verdict) }))));
    touches = k => { const c = choix.find(x => x[2] === k); if (c) choisir(c[0]); };
    contenu.querySelector('h2').focus({ preventScroll: true });
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
    actionEntree = null;
    touches = null;
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
    const obj = ctx.objectif();
    const n = ctx.acquises();
    const reste = Math.max(0, obj - n);
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
      h('div', { class: ['grand-compteur', reste === 0 && 'grand-compteur--atteint'] },
        h('p', { class: 'grand-compteur__chiffre' }, `${n}/${obj}`, reste === 0 ? icone('juste') : null),
        h('p', { class: 'grand-compteur__texte', text: "acquises aujourd'hui" }),
        h('progress', { class: 'barre barre--grande', max: String(obj), value: String(Math.min(n, obj)), 'aria-hidden': 'true' })),
      h('p', { class: 'chiffres chiffres--doux', text: detail }),
      reste > 0 ? h('p', { class: 'objectif-ligne', text: `Encore ${reste} pour l'objectif.` }) : h('p', { class: 'objectif-ligne', text: "Objectif du jour atteint. Tu peux t'arrêter là." }),
      fiches.length ? h('section', { class: 'a-relire' }, h('h2', { class: 'petit-titre', text: 'Fiches à relire' }),
        h('div', { class: 'pastilles pastilles--enveloppe' }, fiches.map(f => h('button', { type: 'button', class: 'pastille', onclick: () => ouvrirFiche(f) }, icone('fiche'), h('span', { text: titreFiche(f) }))))) : null,
      correctionEnCours ? h('p', { class: 'aide', 'aria-live': 'polite', text: 'Je finis de corriger ta dernière réponse…' }) : null,
      ligneSynchro);

    // Un seul bouton principal, selon la situation.
    const boutons = [];
    const retour = () => ctx.aller('aujourdhui');
    if (restantes > 0 && reste > 0) {
      boutons.push(bouton('Retour', { onClick: retour }));
      boutons.push(bouton(`Continuer · ${nb(restantes, 'carte')}`, { principal: true, attrs: { disabled: correctionEnCours }, onClick: () => {
        if (correctionEnCours) return;
        etat = 'reprise';
        if (seance.etape().type === 'pause') seance.continuer();
        suivant();
      } }));
    } else if (reste > 0) {
      boutons.push(nQcm ? bouton(`Faire ${nQcm} QCM`, { onClick: () => ctx.aller('qcm', { demarrer: true }) }) : bouton('Retour', { onClick: retour }));
      boutons.push(bouton('Réviser en avance', { principal: true, onClick: () => ctx.aller('seance', { filtre: params.filtre || 'tout', enAvance: true }) }));
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
    if (touches && /^[123]$/.test(ev.key) && !cible.matches?.('textarea, input')) { ev.preventDefault(); touches(ev.key); return; }
    if (ev.key !== 'Enter') return;
    if (cible.id === 'raison') return;
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
      if (entree) { const e = entree; entree = null; depiler(e); }
      if (etat !== 'fin' && seance.bilan.faites > 0) ctx.sync.pousser('fin-seance').catch(() => {});
    },
  };
}
