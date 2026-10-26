// Démarrage de l'appli : synchro, en-tête (compteur, état d'enregistrement), onglets, écrans.
import { CLES, DEPOT_DEFAUT, VERSION, OBJECTIF_DEFAUT } from './config.js';
import { Synchro } from './sync.js';
import { ouvrirStockage } from './stockage.js';
import { objectifDuJour, semaineEnCours } from './seance.js';
import { creerIdf } from './texte.js';
import { Ecoute } from './voix.js';
import { EcouteGemini, ecouteGeminiDisponible } from './ecoutegemini.js';
import { transcrireGemini } from './gemini.js';
import { opErreur } from './correction.js';
import { jourParis } from './temps.js';
import { h, $, vider, icone, toast, lireLocal, ecrireLocal, lireJson, estTactile, ouvrirFeuille, bouton, nb } from './ui/commun.js';
import * as accueil from './ui/accueil.js';
import * as aujourdhui from './ui/aujourdhui.js';
import * as seance from './ui/seance.js';
import * as qcm from './ui/qcm.js';
import * as suivi from './ui/suivi.js';
import * as reglages from './ui/reglages.js';
import * as mainslibres from './ui/mainslibres.js';

const VUES = { accueil, aujourdhui, seance, qcm, suivi, reglages, mainslibres };
const ONGLETS = [
  ['aujourdhui', "Aujourd'hui", 'soleil'],
  ['qcm', 'QCM', 'qcm'],
  ['suivi', 'Suivi', 'suivi'],
  ['reglages', 'Réglages', 'reglages'],
];

// ---------- Réglages de l'appareil ----------

function depotCourant() {
  const d = lireJson(CLES.depot, null);
  return { ...DEPOT_DEFAUT, ...(d && typeof d === 'object' ? d : {}) };
}

function nomAuto() {
  const tel = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || estTactile();
  let suffixe = '';
  try {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    suffixe = [...a].map(x => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
  } catch { suffixe = Math.random().toString(36).slice(2, 6); }
  return `${tel ? 'tel' : 'pc'}-${suffixe}`;
}

function appareil() {
  let a = lireLocal(CLES.appareil);
  if (!a) { a = nomAuto(); ecrireLocal(CLES.appareil, a); }
  return a;
}

export function appliquerTheme(valeur = lireLocal(CLES.theme, 'auto')) {
  const r = document.documentElement;
  if (valeur === 'clair') r.setAttribute('data-theme', 'light');
  else if (valeur === 'sombre') r.setAttribute('data-theme', 'dark');
  else r.removeAttribute('data-theme');
}

// ---------- Clavier virtuel : la barre d'action reste au-dessus ----------

function suivreClavier() {
  const vv = window.visualViewport;
  const racine = document.documentElement;
  if (vv) {
    const maj = () => {
      const bas = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      // Propriété CSS posée par le CSSOM (autorisé par la CSP), pas d'attribut style écrit à la main.
      racine.style.setProperty('--clavier', bas > 80 ? `${bas}px` : '0px');
      racine.classList.toggle('clavier', bas > 80);
    };
    vv.addEventListener('resize', maj);
    vv.addEventListener('scroll', maj);
  }
  // Sur téléphone, la barre d'onglets se cache pendant la saisie.
  document.addEventListener('focusin', e => {
    if (estTactile() && e.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]), select')) racine.classList.add('saisie');
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.('textarea, input, select')) racine.classList.remove('saisie');
  }, 50));
}

// ---------- Démarrage ----------

async function demarrer() {
  appliquerTheme();
  suivreClavier();
  const stockage = await ouvrirStockage('rappel2');
  const sync = new Synchro({
    stockage,
    config: () => ({ jeton: lireLocal(CLES.jeton), ...depotCourant() }),
  });

  let idfMemo = null, idfCle = '';
  let vueCourante = null, nomCourant = '';
  let dernierCompte = null;
  let jourAffiche = jourParis(Date.now());

  const ctx = {
    sync, stockage, version: VERSION,
    get appareil() { return appareil(); },
    donnees: () => sync.donnees(),
    reglages: () => sync.donnees().reglages,
    maintenant: () => Date.now(),
    enLigne: () => navigator.onLine !== false,
    fetch: (url, options) => fetch(url, options),
    toast,
    cles: () => ({ jeton: lireLocal(CLES.jeton, ''), gemini: lireLocal(CLES.gemini, ''), depot: depotCourant() }),
    // Clés et dépôt : gardés sur l'appareil ; un changement de jeton ou de dépôt relance le chargement.
    definirCles({ jeton, gemini, depot } = {}) {
      let recharger = false;
      if (jeton !== undefined) { ecrireLocal(CLES.jeton, jeton ? String(jeton).trim() : ''); recharger = true; }
      if (gemini !== undefined) ecrireLocal(CLES.gemini, gemini ? String(gemini).trim() : '');
      if (depot !== undefined) { ecrireLocal(CLES.depot, depot ? JSON.stringify(depot) : ''); recharger = true; }
      if (recharger) sync.rafraichir('ouverture').catch(() => {});
      majEntete();
    },
    definirAppareil(nom) { ecrireLocal(CLES.appareil, String(nom || '').trim() || nomAuto()); },
    // Gemini pour la correction : clé de l'appareil, fetch du navigateur.
    gemini: () => ({ cle: lireLocal(CLES.gemini, ''), fetch: (url, options) => fetch(url, options) }),
    // Écoute (26 oct.) : Gemini transcrit quand la clé et le réseau sont là ; sinon la reconnaissance du navigateur.
    // silence : au moins 2,5 s (il réfléchit en parlant) ; ecoute.contexte = {question} avant chaque carte.
    creerEcoute: ({ silence = 2500 } = {}) => {
      const g = ctx.gemini();
      const navigateur = lireLocal(CLES.ecoute, 'gemini') === 'navigateur';
      if (navigateur || !g.cle || !ctx.enLigne() || !ecouteGeminiDisponible()) return new Ecoute({ silence });
      const modele = sync.donnees().reglages?.modeles?.correction || undefined;
      return new EcouteGemini({
        silence: Math.max(2500, silence),
        transcrire: (wav, contexte) => transcrireGemini(wav, contexte, { cle: g.cle, fetch: g.fetch, modele }).catch(e => {
          if (e?.name === 'ErreurGemini') sync.ajouter(opErreur(e, { contexte: 'transcription', modele, maintenant: Date.now(), appareil: ctx.appareil }));
          throw e;
        }),
      });
    },
    idf() {
      const d = sync.donnees();
      const cle = d.ordre.join(',') + ':' + Object.keys(d.cartes).length;
      if (!idfMemo || cle !== idfCle) { idfMemo = creerIdf(Object.values(d.cartes).map(x => x.carte)); idfCle = cle; }
      return idfMemo;
    },
    objectif: () => Number(sync.donnees().reglages?.objectifJour) || OBJECTIF_DEFAUT,
    // Nouvelles imposées dans l'objectif du jour (règle du 26/10 : 60 dont 18) ; 0 = révisions d'abord.
    nouvellesObjectif: () => Number(sync.donnees().reglages?.nouvellesObjectif) || 0,
    // Objectif du jour (règles du 16/10 et du 26/10) : `objectifJour` cartes dont `nouvellesObjectif` nouvelles
    // (objectifDuJour, seance.js).
    jour: () => objectifDuJour(sync.donnees(), Date.now(), ctx.objectif(), ctx.nouvellesObjectif()),
    // Semaine du mercredi au mardi (règle du 26/10 : 840 cartes dont 252 nouvelles) ; null sans objectif de semaine.
    semaine: () => {
      const r = sync.donnees().reglages || {};
      return Number(r.objectifSemaine) > 0 ? semaineEnCours(sync.donnees(), Date.now(), Number(r.objectifSemaine), Number(r.nouvellesSemaine) || 0) : null;
    },
    cartes: () => ctx.jour().cartes,
    atteint: () => ctx.jour().atteint,
    aller,
    majEntete: () => majEntete(),
    appliquerTheme,
    async effacerAppareil() {
      try { await stockage.vider(); } catch { /* rien */ }
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('rappel.')) localStorage.removeItem(k); } catch { /* rien */ }
      try { const regs = await navigator.serviceWorker?.getRegistrations?.(); for (const r of regs || []) await r.unregister(); } catch { /* rien */ }
      try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* rien */ }
      location.reload();
    },
  };

  // --- En-tête ---
  const compteurTexte = $('compteur-texte');
  const compteurBarre = $('compteur-barre');
  const compteur = $('compteur');

  function majEntete() {
    const sansJeton = !lireLocal(CLES.jeton);
    const objectif = ctx.objectif();
    const j = sansJeton ? null : ctx.jour();
    const n = j ? j.cartes : 0;
    const rev = j ? j.revisionsRestantes : 0;
    const atteint = !!j?.atteint;
    // « Cartes : n/objectif ✓ · Révisions : r » ; sur téléphone, les révisions passent sous les cartes.
    const sem = j ? ctx.semaine() : null;
    vider(compteurTexte, h('span', { text: `Cartes : ${n}/${objectif}${atteint ? ' ✓' : ''}` }),
      rev ? [h('span', { class: 'compteur__sep', text: ' · ' }), h('span', { class: 'compteur__rev', text: `Révisions : ${rev}` })] : null,
      sem ? [h('span', { class: 'compteur__sep', text: ' · ' }), h('span', { class: 'compteur__rev', text: `Semaine : ${sem.cartes}/${sem.objectif}${sem.atteinte ? ' ✓' : ''}` })] : null);
    compteurBarre.max = objectif;
    compteurBarre.value = Math.min(n, objectif);
    compteur.classList.toggle('compteur--atteint', atteint);
    compteur.setAttribute('aria-label', `${nb(n, 'carte')} sur ${objectif} aujourd'hui${rev ? `, ${nb(rev, 'révision')} à faire` : ''}${atteint ? ', objectif atteint' : ''}. Comment on compte ?`);
    if (dernierCompte != null && n > dernierCompte) {
      compteur.classList.remove('monte');
      void compteur.offsetWidth;
      compteur.classList.add('monte');
    }
    dernierCompte = n;
  }

  // Stockage en mémoire (navigation privée, IndexedDB indisponible) : rien ne survit à la fermeture,
  // l'état d'envoi ne promet donc pas que tout est gardé sur l'appareil.
  function messageEtat(etat = sync.etat) {
    const m = etat.message || '';
    if (!stockage.enMemoire) return m;
    if (etat.mode === 'hors-ligne' && /gardé/.test(m)) return 'Hors ligne : envoi au retour du réseau';
    return m.replace(/\s*Tes réponses restent gardées sur l'appareil\./, '');
  }
  ctx.messageEtat = messageEtat;

  function majSynchro(etat = sync.etat) {
    const zone = $('etat-synchro');
    const message = messageEtat(etat);
    $('synchro-texte').textContent = message;
    zone.dataset.mode = etat.mode;
    zone.title = message;
    zone.setAttribute('aria-label', `${message}. Voir le détail.`);
  }

  compteur.addEventListener('click', () => {
    const objectif = ctx.objectif();
    const { cartes: n, revisionsRestantes: rev } = ctx.jour();
    ouvrirFeuille({
      titre: `Aujourd'hui : ${nb(n, 'carte')} sur ${objectif}${rev ? `, ${nb(rev, 'révision')} à faire` : ''}`, surtitre: 'Comment on compte', classe: 'feuille--courte', libelleFermer: 'Compris',
      contenu: h('ul', { class: 'liste-simple' },
        h('li', { text: ctx.nouvellesObjectif()
          ? `Chaque jour : au moins ${objectif} cartes, dont ${ctx.nouvellesObjectif()} nouvelles (mêlées aux révisions dès le début).`
          : `Objectif : ${objectif} cartes par jour (révisions d'abord, puis des nouvelles pour compléter).` }),
        ctx.semaine() ? h('li', { text: `Chaque semaine, du mercredi au mardi : ${ctx.semaine().objectif} cartes, dont ${ctx.semaine().nouvellesObjectif} nouvelles. Les jours à ${objectif} se rattrapent dans la semaine.` }) : null,
        h('li', { text: 'Une carte compte une fois, même si elle revient après une erreur.' }),
        h('li', { text: 'Les révisions en avance comptent.' }),
        h('li', { text: 'QCM rapide : 20 cartes par jour au plus. Les QCM de la fac ne comptent pas.' }),
        h('li', { text: 'Le compte repart à zéro à minuit.' }),
        h('li', { text: 'Au-delà, rien n\'est exigé : tu peux continuer.' })),
    });
  });
  // Pendant une séance, une série de QCM ou le mode mains libres : une feuille, sans quitter l'écran.
  function feuilleSynchro() {
    const detail = h('p', { class: 'etat-synchro-detail', 'aria-live': 'polite' });
    const envoyer = bouton('Envoyer maintenant', { onClick: async () => {
      envoyer.disabled = true;
      try { await sync.pousser('manuel'); } finally { envoyer.disabled = false; maj(); }
    } });
    const maj = () => {
      const s = sync.etat;
      const derniere = reglages.texteDernierEchange(s.derniereSynchro, Date.now());
      vider(detail, h('strong', { text: messageEtat(s) }), derniere ? h('span', { class: 'aide', text: ' ' + derniere }) : null);
      detail.dataset.mode = s.mode;
      envoyer.hidden = !s.attente || s.mode === 'sans-jeton';
      if (s.mode === 'envoi') envoyer.disabled = true;
    };
    maj();
    const suivre = () => { if (detail.isConnected) maj(); else sync.removeEventListener('etat', suivre); };
    sync.addEventListener('etat', suivre);
    ouvrirFeuille({
      titre: 'Enregistrement de tes réponses', classe: 'feuille--courte', actions: sync.etat.attente && sync.etat.mode !== 'sans-jeton' ? envoyer : null,
      contenu: [detail, h('p', { class: 'aide', text: stockage.enMemoire ? 'Tes réponses partent dans ton dépôt dès qu\'il y a du réseau. Le détail est dans Réglages, après la séance.'
        : 'Tout est gardé sur l\'appareil, puis envoyé dans ton dépôt. Le détail est dans Réglages, après la séance.' })],
    });
  }
  $('etat-synchro').addEventListener('click', () => {
    if (document.documentElement.classList.contains('plein')) feuilleSynchro();
    else if (sync.etat.mode === 'sans-jeton') aller('accueil');
    else aller('reglages', { section: 'donnees' });
  });

  // --- Onglets ---
  const nav = $('onglets');
  vider(nav, ONGLETS.map(([id, libelle, ic]) => h('a', {
    href: `#${id}`, class: 'onglet', 'data-vue': id,
    onclick: e => { e.preventDefault(); aller(id); },
  }, icone(ic), h('span', { text: libelle }))));

  function aller(nom, params = {}) {
    const module = VUES[nom] || aujourdhui;
    if (!VUES[nom]) nom = 'aujourdhui';
    let vue;
    try { vue = module.creer(ctx, params); } catch (e) {
      console.warn('Écran impossible à afficher', e);
      vue = { noeud: h('div', { class: 'page' }, h('h1', { text: 'Oups' }), h('p', { text: "Cet écran n'a pas pu s'afficher. Recharge la page." }), bouton("Retour à Aujourd'hui", { principal: true, onClick: () => aller('aujourdhui') })) };
    }
    vueCourante?.quitter?.();
    vueCourante = vue;
    nomCourant = nom;
    const racine = document.documentElement;
    racine.dataset.vue = nom;
    racine.classList.toggle('plein', !!vue.plein);
    racine.classList.toggle('sans-entete', !!vue.sansEntete);
    vider($('sous-entete'), vue.barreHaut || null);
    vider($('vue'), vue.noeud);
    for (const a of nav.querySelectorAll('.onglet')) {
      if (a.dataset.vue === (vue.onglet || nom)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    document.title = vue.titre ? `${vue.titre} · Rappel` : 'Rappel';
    window.scrollTo(0, 0);
    const cible = vue.focus?.() || vue.noeud.querySelector('h1');
    if (cible && aller.deja) { if (!cible.hasAttribute('tabindex')) cible.setAttribute('tabindex', '-1'); cible.focus({ preventScroll: true }); }
    aller.deja = true;
    try { history.replaceState(history.state, '', `#${nom}`); } catch { /* rien */ }
    vue.apres?.();
  }

  // --- Événements de la synchro ---
  sync.addEventListener('donnees', e => {
    majEntete();
    try { vueCourante?.surDonnees?.(e.detail); } catch (err) { console.warn(err); }
  });
  sync.addEventListener('etat', e => {
    majSynchro(e.detail);
    try { vueCourante?.surEtat?.(e.detail); } catch (err) { console.warn(err); }
  });
  sync.brancherNavigateur(window, document);

  // Changement de jour, appli ouverte.
  setInterval(() => {
    const j = jourParis(Date.now());
    if (j === jourAffiche) return;
    jourAffiche = j;
    dernierCompte = null;
    majEntete();
    if (nomCourant === 'aujourdhui' || nomCourant === 'suivi') vueCourante?.surDonnees?.(sync.donnees());
    toast('Nouvelle journée : compteur remis à zéro.');
  }, 60000);

  // Premier écran : sans jeton, les premiers pas.
  const depart = location.hash.slice(1);
  if (!lireLocal(CLES.jeton)) aller('accueil');
  else aller(['qcm', 'suivi', 'reglages'].includes(depart) ? depart : 'aujourdhui');
  majEntete();
  majSynchro();
  document.documentElement.classList.add('pret');

  await sync.demarrer().catch(e => console.warn('Synchro', e));

  // Hors ligne : service worker (cache de la coquille).
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const avant = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (avant) toast('Rappel a été mis à jour.'); });
    navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(VERSION)}`).catch(() => { /* hors ligne indisponible */ });
  }
}

demarrer().catch(e => {
  console.error(e);
  const vue = $('vue');
  if (vue) vider(vue, h('div', { class: 'page' }, h('h1', { text: "Rappel n'a pas pu démarrer" }), h('p', { text: 'Recharge la page. Si ça recommence, ferme et rouvre le navigateur.' })));
});
