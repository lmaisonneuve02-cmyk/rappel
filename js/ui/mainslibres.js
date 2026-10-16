// Mains libres : écran sombre et calme, piloté par la machine à états MainsLibres (événement 'etat').
import { Seance } from '../seance.js';
import { MainsLibres } from '../mainslibres.js';
import { Ecoute, Parole, verrouEcran } from '../voix.js';
import { corriger, contester } from '../correction.js';
import { CLES } from '../config.js';
import { plainQ } from '../texte.js';
import {
  h, vider, bouton, libeller, boutonConfirme, icone, ficheNoeud, VERDICTS, nb, lireLocal, aideVue, compterAide, empiler, depiler, annoncer,
  texteEncore,
} from './commun.js';

const COMMANDES = ['je ne sais pas', 'répète', 'suivant', 'pause', 'je conteste', 'stop'];

function onde() {
  return h('div', { class: 'onde', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map(() => h('span')));
}

export function creer(ctx, params = {}) {
  const contenu = h('div', { class: 'page page--mainslibres' });
  const barre = h('div', { class: 'barre-action barre-action--ml' });
  const noeud = h('div', { class: 'mainslibres' }, contenu, barre);
  const position = h('p', { class: 'seance-haut__position' });
  let ml = null, parole = null, ecoute = null, liberer = null;
  let entree = null;
  let fini = false;
  const arreter = boutonConfirme('Arrêter', 'Touche encore', () => ml?.arreter(), { discret: true, classe: 'btn--petit' });
  const barreHaut = h('div', { class: 'seance-haut' }, h('div', { class: 'seance-haut__in' }, arreter, position));
  // « je conteste » seulement avec une clé Gemini : sans elle, la commande n'a aucun effet.
  const avecCle = !!ctx.cles().gemini;
  const commandes = COMMANDES.filter(c => avecCle || c !== 'je conteste');
  const aideCommandes = h('p', { class: 'ml-commandes' });
  // Ce qu'on peut faire maintenant : micro coupé → le bouton ; sinon les mots à dire.
  function majAide(d) {
    const titre = t => h('span', { class: 'ml-commandes__titre', text: t });
    if (!d.micro && ['pause', 'erreur', 'attente-geste'].includes(d.phase)) {
      vider(aideCommandes, titre('Micro coupé : '), d.phase === 'attente-geste' ? 'touche le bouton pour répondre.' : 'touche « Reprendre ».');
    } else vider(aideCommandes, titre('Tu peux dire : '), d.phase === 'pause' ? 'reprendre · stop' : commandes.join(' · '));
  }
  majAide({});

  // Éléments de l'écran (mis à jour à chaque état).
  const zoneEtat = h('div', { class: 'ml-etat', 'aria-live': 'polite' });
  const zoneQuestion = h('p', { class: 'ml-question' });
  const zoneReponse = h('p', { class: 'ml-reponse' });
  const zoneVerdict = h('div', { class: 'ml-verdict' });
  const zoneFiche = h('div', { class: 'ml-fiche' });
  const btnPause = bouton('Pause', { icone: 'pause', classe: 'btn--geant btn--calme', onClick: () => basculer() });

  let phase = '';
  function basculer() {
    if (!ml) return;
    if (phase === 'attente-geste') ml.geste();
    else if (phase === 'pause' || phase === 'erreur') ml.reprendre();
    else ml.pause();
  }

  function rendre(d) {
    phase = d.phase;
    position.textContent = d.rang && d.total ? `Carte ${d.rang} sur ${d.total}` : d.phase === 'fin' ? 'Séance terminée' : '';
    // État en très grand.
    const micro = !!d.micro;
    vider(zoneEtat, micro ? onde() : null, h('p', { class: 'ml-etat__message', text: d.message || '' }));
    zoneEtat.classList.toggle('ml-etat--ecoute', micro);

    // Question, réponse en direct, verdict.
    const verdict = (d.phase === 'verdict' || d.phase === 'attente-commande') && d.resultat?.verdict ? d.resultat : null;
    zoneQuestion.textContent = d.phase === 'fin' ? '' : d.carte ? plainQ(d.carte) : d.qcm ? d.qcm.enonce || '' : (verdict ? '' : d.texte || '');
    if (verdict) {
      const v = VERDICTS[verdict.verdict] || VERDICTS.faux;
      const nsp = verdict.correcteur === 'je-ne-sais-pas';
      vider(zoneVerdict, h('div', { class: ['verdict', `verdict--${nsp ? 'nsp' : verdict.verdict}`] },
        h('div', { class: 'verdict__tete' }, icone(nsp ? 'fiche' : v.icone, { classe: 'verdict__icone' }), h('p', { class: 'verdict__mot', text: nsp ? 'Voici la réponse' : v.mot })),
        d.texte ? h('p', { class: 'verdict__ligne', text: d.texte }) : null));
    } else vider(zoneVerdict);
    const rep = d.partiel || d.reponse || '';
    zoneReponse.textContent = rep && d.phase !== 'fin' ? `« ${rep} »` : '';

    // Fiche à lire.
    if (d.phase === 'lecture-fiche' && d.fiche) {
      if (zoneFiche.dataset.id !== d.ficheId) { vider(zoneFiche, ficheNoeud(d.fiche)); zoneFiche.dataset.id = d.ficheId || ''; }
    } else if (zoneFiche.dataset.id) { vider(zoneFiche); zoneFiche.dataset.id = ''; }

    // Bouton principal selon la phase.
    if (d.phase === 'fin' || (d.phase === 'erreur' && d.recuperable === false)) {
      terminer(d);
      return;
    }
    if (d.phase === 'attente-geste') { libeller(btnPause, 'Touche pour répondre'); btnPause.querySelector('svg')?.replaceWith(icone('micro')); }
    else if (d.phase === 'pause' || d.phase === 'erreur') { libeller(btnPause, 'Reprendre'); btnPause.querySelector('svg')?.replaceWith(icone('lecture')); }
    else { libeller(btnPause, 'Pause'); btnPause.querySelector('svg')?.replaceWith(icone('pause')); }
    majAide(d);
  }

  function terminer(d) {
    if (fini) return;
    fini = true;
    arreter.hidden = true;
    liberer?.().catch?.(() => {});
    liberer = null;
    ctx.sync.pousser('fin-seance').catch(() => {});
    const b = d.bilan || {};
    const jour = ctx.jour();   // comme la fin de séance écrite : compteur, ✓, ce qui manque
    vider(contenu,
      h('h1', { class: 'titre-page', tabindex: '-1', text: d.phase === 'erreur' ? 'Mains libres arrêté' : 'Séance terminée' }),
      d.phase === 'erreur' ? h('p', { class: 'chapeau', text: d.message }) : null,
      h('div', { class: ['grand-compteur', jour.atteint && 'grand-compteur--atteint'] },
        h('p', { class: 'grand-compteur__chiffre' }, `${jour.cartes}/${jour.objectif}`, jour.atteint ? icone('juste') : null),
        h('p', { class: 'grand-compteur__texte', text: "cartes aujourd'hui" })),
      h('p', { class: 'chiffres chiffres--doux', text: [nb(b.reponses || b.faites || 0, 'réponse'), b.justes && nb(b.justes, 'juste'),
        b.partielles && nb(b.partielles, 'partielle'), b.fausses && nb(b.fausses, 'fausse')].filter(Boolean).join(' · ') }),
      h('p', { class: 'objectif-ligne', text: jour.atteint ? "Objectif du jour atteint. Tu peux t'arrêter là."
        : `${texteEncore(jour).replace(/^e/, 'E')} pour l'objectif.` }));
    vider(barre, bouton('Retour', { principal: true, onClick: () => ctx.aller('aujourdhui', { filtre: params.filtre || 'tout' }) }));
    contenu.querySelector('h1').focus({ preventScroll: true });
    annoncer('Séance terminée.');
  }

  // Démarrage (dans le geste de l'utilisateur : exigé pour la voix sur iPhone).
  function lancer() {
    compterAide('mainslibres');
    const donnees = ctx.donnees();
    const r = ctx.reglages();
    const seance = new Seance({ donnees, maintenant: () => ctx.maintenant(), filtre: params.filtre || 'tout' });
    parole = new Parole({ vitesse: Number(r.voix?.vitesse) || 1, voixNom: lireLocal(CLES.voixNom, '') });
    ecoute = new Ecoute({ silence: Math.round((Number(r.voix?.silence) || 2.5) * 1000) });
    ml = new MainsLibres({
      seance, parole, ecoute, fiches: donnees.fiches, appareil: ctx.appareil, maintenant: () => ctx.maintenant(),
      intro: !aideVue('mainslibres-intro'),
      corriger: ({ carte, paquet, reponse, maintenant, appareil }) => corriger({
        carte, paquet, reponse, donnees: ctx.donnees(), gemini: ctx.gemini(), enLigne: ctx.enLigne(), idf: ctx.idf(), maintenant, appareil }),
      contester: avecCle ? args => contester({ ...args, donnees: ctx.donnees(), gemini: ctx.gemini(), enLigne: ctx.enLigne() }) : null,
      enregistrer: ops => { for (const op of ops || []) ctx.sync.ajouter(op); seance.majDonnees(ctx.sync.donnees()); },
    });
    compterAide('mainslibres-intro');
    ml.addEventListener('etat', e => { try { rendre(e.detail); } catch (err) { console.warn(err); } });
    vider(contenu, zoneEtat, zoneQuestion, zoneReponse, zoneVerdict, zoneFiche);
    vider(barre, aideCommandes, btnPause);
    ml.demarrer();
    verrouEcran().then(f => { if (fini) f(); else liberer = f; }).catch(() => {});
  }

  // Première fois : présentation, puis « Démarrer ».
  if (!params.direct) {
    vider(contenu,
      h('h1', { class: 'titre-page', tabindex: '-1', text: 'Mains libres' }),
      h('ul', { class: 'liste-etapes' },
        h('li', null, icone('casque'), h('span', { text: 'Je lis la question. Tu réponds à voix haute.' })),
        h('li', null, icone('juste'), h('span', { text: 'Je corrige et je te dis le verdict.' })),
        h('li', null, icone('fiche'), h('span', { text: 'Avant de nouvelles cartes, je te laisse lire la fiche à l\'écran.' }))),
      h('p', { class: 'petit-titre', text: 'À tout moment, tu peux dire' }),
      h('p', { class: 'ml-commandes ml-commandes--grand', text: commandes.join(' · ') }),
      h('p', { class: 'aide', text: 'Garde l\'appli à l\'écran : elle reste allumée. Ton navigateur va demander le micro : touche « Autoriser ».' }));
    vider(barre, bouton('Démarrer', { principal: true, icone: 'micro', onClick: lancer }));
  } else {
    vider(contenu, zoneEtat);
    lancer();
  }

  // Appli en arrière-plan : pause (le micro ne marche plus de toute façon).
  const visibilite = () => { if (document.visibilityState === 'hidden' && ml && !fini) ml.pause(); };
  document.addEventListener('visibilitychange', visibilite);
  const clavier = ev => {
    if (ev.key === 'Escape' && !fini) { ev.preventDefault(); arreter.armer(); }
    else if ((ev.key === ' ' || ev.key === 'Enter') && ev.target === document.body && ml && !fini) { ev.preventDefault(); basculer(); }
  };
  document.addEventListener('keydown', clavier);

  function surRetour() {
    entree = null;
    if (fini || !ml) { ctx.aller('aujourdhui'); return; }
    if (arreter.classList.contains('arme')) arreter.click(); else arreter.armer();
    entree = empiler(surRetour);
  }

  return {
    noeud, barreHaut, titre: 'Mains libres', plein: true, onglet: 'aujourdhui',
    apres: () => { document.documentElement.classList.add('nuit'); entree = empiler(surRetour); },
    quitter: () => {
      document.documentElement.classList.remove('nuit');
      document.removeEventListener('visibilitychange', visibilite);
      document.removeEventListener('keydown', clavier);
      try { ml?.arreter(); } catch { /* rien */ }
      try { parole?.arreter(); } catch { /* rien */ }
      try { ecoute?.annuler(); } catch { /* rien */ }
      liberer?.().catch?.(() => {});
      if (entree) { const e = entree; entree = null; depiler(e); }
      if (!fini) ctx.sync.pousser('fin-seance').catch(() => {});
    },
  };
}
