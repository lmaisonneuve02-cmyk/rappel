// Aujourd'hui : ta séance du jour (révisions puis nouvelles cartes), un seul grand bouton.
import { apportDuFiltre, revisionsEnAvance, nouvellesDuJour, qcmRestants, QCM_MAX } from '../seance.js';
import { qcmProposables } from '../qcm.js';
import { feuillesDeLaSemaine } from '../feuille.js';
import { controleDuJour } from '../controle.js';
import { estDisponible } from '../fsrs.js';
import { jourParis, finJourParis } from '../temps.js';
import { reconnaissanceDisponible } from '../voix.js';
import { ecouteGeminiDisponible } from '../ecoutegemini.js';
import { h, vider, bouton, icone, bandeau, pastilles, nb, dateFr, aideVue, texteEncore, texteAtteint, texteSemaine } from './commun.js';

const MIN_PAR_CARTE = 0.6;
let filtreMemo = { jour: '', filtre: 'tout' };   // le choix d'un paquet vaut jusqu'à minuit

const CODES_CLES = new Set(['jeton', 'droits', 'introuvable']);

function mainsLibresPossible(ctx) {
  const ecoute = !!reconnaissanceDisponible(window) || (ecouteGeminiDisponible(window) && !!ctx.cles().gemini);
  return ecoute && 'speechSynthesis' in window;
}

// Ce que propose la journée, pour un filtre donné : révisions (pas encore répondues aujourd'hui),
// cartes ratées qui reviennent (déjà comptées) et nouvelles cartes.
function resume(d, now, filtre) {
  const { revisions, reprises, nouvelles } = apportDuFiltre(d, now, filtre);
  return { revisions, reprises, nouvelles, total: revisions + reprises + nouvelles };
}

function cartesRestantesJamaisVues(d) {
  let n = 0;
  for (const [id, p] of Object.entries(d.paquets)) for (const c of p.cartes || []) if (c && !d.srs[id]?.[c.id]) n++;
  return n;
}

function demain(d, now) {
  const t = finJourParis(now) + 1;
  let n = 0;
  for (const cartes of Object.values(d.srs || {})) for (const st of Object.values(cartes || {})) if (estDisponible(st, t)) n++;
  return n;
}

export function creer(ctx, params = {}) {
  // Retour d'une séance : son filtre devient celui de l'écran (« Tout » après une séance sur tout).
  if (params.filtre) filtreMemo = { jour: jourParis(ctx.maintenant()), filtre: params.filtre };
  const page = h('div', { class: 'page page--aujourdhui' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'aujourdhui' }, page, barre);
  let signature = '';
  let minuterieLent = null;
  let lent = false;
  let actionEntree = null;   // Entrée (focus hors champ) : « Commencer », s'il est proposé

  function filtreDuJour(d, now) {
    const jour = jourParis(now);
    if (filtreMemo.jour !== jour || (filtreMemo.filtre !== 'tout' && !d.paquets[filtreMemo.filtre])) filtreMemo = { jour, filtre: 'tout' };
    return filtreMemo.filtre;
  }

  function afficher(force = false) {
    const d = ctx.donnees();
    const now = ctx.maintenant();
    const etat = ctx.sync.etat;
    const cles = ctx.cles();
    const aDesCartes = Object.keys(d.paquets).length > 0;
    const filtre = filtreDuJour(d, now);
    const r = aDesCartes ? resume(d, now, filtre) : null;
    const total = filtre === 'tout' ? r : aDesCartes ? resume(d, now, 'tout') : null;
    const jour = ctx.jour();   // objectif du jour : cartes, révisions faites et restantes, atteint
    const sig = JSON.stringify([!!cles.jeton, aDesCartes, r, total, filtre, jour, etat.mode, etat.code, lent, d.ordre.length, ctx.enLigne()]);
    if (!force && sig === signature) return;
    signature = sig;
    actionEntree = null;
    const defile = page.querySelector('.pastilles')?.scrollLeft || 0;

    // Sans jeton : rien à proposer, on explique pourquoi.
    if (!cles.jeton) {
      vider(page,
        h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
        h('p', { class: 'chapeau', text: `Rappel lit tes cartes et garde tes progrès dans ton dépôt « ${cles.depot.depot} ». Sans jeton d'accès, il n'a rien à te proposer.` }));
      vider(barre, bouton('Relier mes cartes', { principal: true, onClick: () => ctx.aller('accueil') }));
      return;
    }

    // Pas encore de cartes sur l'appareil.
    if (!aDesCartes) {
      const reessayer = bouton('Réessayer', { principal: true, onClick: () => ctx.sync.rafraichir('manuel') });
      if (etat.mode === 'hors-ligne') {
        vider(page, h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
          bandeau("Pas de connexion, et tes cartes ne sont pas encore sur cet appareil. Connecte-toi une fois : ensuite, Rappel marchera aussi hors ligne.", { type: 'horsligne' }));
        vider(barre, reessayer);
      } else if (etat.mode === 'erreur') {
        vider(page, h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
          bandeau(etat.message, { type: 'erreur', action: CODES_CLES.has(etat.code) ? bouton('Ouvrir Réglages', { onClick: () => ctx.aller('reglages', { section: 'cles' }) }) : null }));
        vider(barre, reessayer);
      } else {
        vider(page, h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
          h('div', { class: 'squelette', 'aria-busy': 'true' }, h('p', { text: 'Je récupère tes cartes…' }), h('progress', { class: 'barre barre--attente' })),
          lent ? h('p', { class: 'aide', text: "C'est plus long que d'habitude. Vérifie ta connexion." }) : null);
        vider(barre, lent ? reessayer : null);
        if (!minuterieLent && !lent) minuterieLent = setTimeout(() => { lent = true; afficher(); }, 10000);
      }
      return;
    }

    const blocs = [];
    // Erreur qui demande d'agir (jeton expiré…) : la révision reste possible.
    if (etat.mode === 'erreur' && CODES_CLES.has(etat.code)) {
      blocs.push(bandeau(`${etat.message} En attendant, tu peux réviser : tes réponses partiront dès que ça marchera.`, {
        type: 'erreur', action: bouton('Ouvrir Réglages', { onClick: () => ctx.aller('reglages', { section: 'cles' }) }) }));
    } else if (etat.mode === 'erreur' && etat.code === 'illisible') {
      blocs.push(bandeau('Un fichier de progression est abîmé sur GitHub : les envois sont bloqués. Demande à Claude de le réparer.', { type: 'erreur' }));
    }
    if (jour.atteint) blocs.push(bandeau(texteAtteint(jour), { type: 'reussite' }));
    const semaine = ctx.semaine?.();
    const ligneSemaine = semaine ? h('p', { class: 'objectif-ligne objectif-ligne--semaine', text: texteSemaine(semaine) }) : null;

    const paquetNom = filtre === 'tout' ? null : (d.paquets[filtre]?.nom || filtre);
    const enLigne = ctx.enLigne() && etat.mode !== 'hors-ligne';
    // Ce paquet suffit-il pour l'objectif ? (les cartes ratées qui reviennent sont déjà comptées)
    // Sinon, révisions d'abord : elles sont dans les autres paquets, « Tout » devient l'action principale.
    const suffit = r.revisions >= jour.encoreRevisions && r.nouvelles >= (jour.encoreNouvelles || 0) && r.revisions + r.nouvelles >= jour.encore;
    const versTout = !jour.atteint && !!paquetNom && !suffit && total.total > r.total;
    const avance = !versTout && r.total === 0 && revisionsEnAvance(d, now, filtre).length > 0;

    if (r.total > 0) {
      const minutes = Math.max(1, Math.round(r.total * MIN_PAR_CARTE));
      const chiffres = [r.revisions && nb(r.revisions, 'révision'), r.reprises && nb(r.reprises, 'ratée à revoir', 'ratées à revoir'),
        r.nouvelles && nb(r.nouvelles, 'nouvelle carte', 'nouvelles cartes')].filter(Boolean).join(' · ');
      blocs.push(h('section', { class: 'bloc-seance' },
        h('p', { class: 'surtitre', text: dateFr(jourParis(now)) }),
        h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
        h('p', { class: 'chiffres', text: chiffres }),
        h('p', { class: 'chiffres chiffres--doux', text: `environ ${minutes} min${(r.revisions || r.reprises) && r.nouvelles ? (ctx.nouvellesObjectif?.() ? ' · nouvelles mêlées aux révisions' : ' · révisions d\'abord') : ''}` }),
        !jour.atteint ? h('p', { class: 'objectif-ligne' }, h('strong', { text: `Objectif : ${texteEncore(jour)}. ` }),
          suffit ? 'Cette séance peut suffire.' : versTout ? 'Ce paquet ne suffit pas : choisis « Tout ».' : 'Fais toute la séance.') : null,
        ligneSemaine));
    } else {
      const prochaines = demain(d, now);
      blocs.push(h('section', { class: 'bloc-seance' },
        h('p', { class: 'surtitre', text: dateFr(jourParis(now)) }),
        h('h1', { class: 'titre-page titre-page--icone' }, icone('juste', { classe: 'icone--reussite' }), h('span', { text: paquetNom ? 'Rien à faire dans ce paquet' : "Tout est fait pour aujourd'hui" })),
        paquetNom && total.total ? h('p', { class: 'chapeau', text: `Il reste ${nb(total.total, 'carte')} dans les autres paquets.` }) : null,
        !jour.atteint && (versTout || avance) ? h('p', { class: 'objectif-ligne' }, h('strong', { text: `Objectif : ${texteEncore(jour)}. ` }),
          versTout ? 'Choisis « Tout » pour continuer.' : 'Révise en avance pour compléter.') : null,
        prochaines ? h('p', { class: 'aide', text: `Prochaines révisions : demain, ${nb(prochaines, 'carte')}.` }) : null,
        ligneSemaine));
    }

    // Limite de nouvelles cartes atteinte (et il en reste à découvrir).
    const limite = Number(d.reglages.nouvellesParJour) || 0;
    const jamaisVues = cartesRestantesJamaisVues(d);
    if (filtre === 'tout' && r.nouvelles === 0 && jamaisVues > 0 && nouvellesDuJour(d, now) >= limite) {
      blocs.push(h('div', { class: 'bloc' },
        h('p', { class: 'aide', text: limite > 0 ? `Les ${limite} nouvelles cartes du jour sont faites. Tu peux en demander plus dans Réglages.` : 'Nouvelles cartes : 0 par jour pour le moment. Tu peux en demander dans Réglages.' }),
        h('button', { type: 'button', class: 'lien', onclick: () => ctx.aller('reglages', { section: 'rythme' }), text: 'Réglages › Rythme' })));
    } else if (filtre === 'tout' && jamaisVues === 0) {
      blocs.push(h('p', { class: 'aide', text: 'Tu as vu toutes les cartes des cours préparés. Les prochains paquets arriveront avec de nouveaux cours.' }));
    }

    // Stockage en mémoire (navigation privée, IndexedDB bloqué) : rien ne survit à la fermeture.
    const enMemoire = !!ctx.stockage?.enMemoire;
    if (!enLigne) {
      blocs.push(bandeau(enMemoire ? "Hors ligne : correction sur l'appareil. Tes réponses partiront au retour du réseau."
        : "Hors ligne : correction sur l'appareil. Tout est gardé et partira au retour du réseau.", { type: 'horsligne' }));
    }
    if (enMemoire) {
      blocs.push(bandeau("Ce navigateur ne garde rien après fermeture (navigation privée ?) : tes réponses partent dès qu'il y a du réseau.", { type: 'discret' }));
    }

    // Pastilles : un seul paquet ? (seulement si au moins deux paquets ont des cartes aujourd'hui)
    const options = [];
    for (const id of d.ordre) {
      const n = resume(d, now, id).total;
      if (n > 0 || id === filtre) options.push({ id, libelle: d.paquets[id]?.nom || id, n });
    }
    if (options.length >= 2 || filtre !== 'tout') {
      const groupe = pastilles([{ id: 'tout', libelle: 'Tout', n: total.total }, ...options], filtre, id => {
        filtreMemo = { jour: jourParis(ctx.maintenant()), filtre: id };
        afficher(true);
      }, { etiquette: 'Choisir un paquet' });
      blocs.push(h('div', { class: 'choix-paquet' }, h('p', { class: 'petit-titre', text: 'Un seul paquet ? (facultatif)' }), groupe));
      requestAnimationFrame(() => { groupe.scrollLeft = defile; });
    }

    // Mains libres (si la voix est disponible), sinon l'astuce du clavier.
    if (r.total > 0) {
      if (mainsLibresPossible(ctx)) {
        blocs.push(h('div', { class: 'mains-libres-entree' },
          bouton('Mains libres', { icone: 'casque', classe: 'btn--large', onClick: () => ctx.aller('mainslibres', { filtre, direct: aideVue('mainslibres') }) }),
          h('p', { class: 'aide', text: 'Je lis les questions, tu réponds à voix haute.' })));
      } else {
        blocs.push(h('p', { class: 'aide aide--ligne' }, icone('micro'), 'Astuce : le micro de ton clavier permet de dicter tes réponses.'));
      }
      // QCM des cartes (26 oct.) : pour les jours sans élan, QCM_MAX cartes au plus par jour dans l'objectif.
      const resteQcm = qcmRestants(d, now);
      blocs.push(h('div', { class: 'mains-libres-entree' },
        resteQcm > 0 ? bouton(`QCM rapide (${Math.min(resteQcm, r.total)})`, { icone: 'qcm', classe: 'btn--large', onClick: () => ctx.aller('seance', { filtre, mode: 'qcm' }) }) : null,
        h('p', { class: 'aide', text: resteQcm > 0
          ? `Jour sans élan ? Choisis parmi 4 réponses. Compte « partiel », ${QCM_MAX} cartes au plus par jour (encore ${resteQcm}).`
          : `QCM rapide : ${QCM_MAX} cartes aujourd'hui, c'est le plafond. La suite en écrivant.` })));
    }
    // Contrôle du jour (29 oct.) : lundi, mercredi, vendredi ; bloquant s'il n'est pas passé à minuit.
    const ctl = controleDuJour(d, now);
    if (ctl) {
      const fait = ctl.resultat;
      blocs.unshift(h('div', { class: 'mains-libres-entree' },
        bouton(fait ? `Contrôle du jour : ${String(fait.note).replace('.', ',')}/20` : `Contrôle du jour (${ctl.prepare.questions.length} questions)`,
          { icone: 'qcm', classe: 'btn--large', onClick: () => ctx.aller('controle') }),
        h('p', { class: 'aide', text: fait ? 'Rendu. Touche pour revoir le corrigé.' : 'À passer avant minuit, sinon tout est bloqué jusqu\'à ce que tu le passes.' })));
    }
    // Feuille blanche (26 oct.) : 10 par semaine au moins.
    const objFeuilles = Number(d.reglages.feuillesSemaine) || 0;
    const fs = feuillesDeLaSemaine(d, now, objFeuilles || 10);
    blocs.push(h('div', { class: 'mains-libres-entree' },
      bouton(`Feuille blanche${objFeuilles ? ` (${fs.faites}/${objFeuilles})` : ''}`, { icone: 'fiche', classe: 'btn--large', onClick: () => ctx.aller('feuille') }),
      h('p', { class: 'aide', text: objFeuilles && !fs.atteinte ? `10 minutes sur un cours, sans rien regarder. Encore ${nb(objFeuilles - fs.faites, 'feuille')} cette semaine.` : '10 minutes sur un cours, sans rien regarder ; la séance commence par ce que tu as oublié.' })));
    vider(page, blocs);

    // Zone du pouce : une seule action principale.
    const qcm = qcmProposables(d).length > 0;
    const faireQcm = principal => (qcm ? bouton('Faire des QCM', { principal, onClick: () => ctx.aller('qcm') }) : null);
    if (versTout) {
      // L'objectif attend des cartes des autres paquets : « Tout » en principal, ce paquet reste possible.
      actionEntree = () => { filtreMemo = { jour: jourParis(ctx.maintenant()), filtre: 'tout' }; ctx.aller('seance', { filtre: 'tout' }); };
      vider(barre, h('div', { class: 'barre-action__rang' },
        r.total > 0 ? bouton(`Ce paquet (${r.total})`, { onClick: () => ctx.aller('seance', { filtre }) }) : faireQcm(false),
        bouton(`Commencer · Tout (${total.total})`, { principal: true, onClick: actionEntree })));
    } else if (r.total > 0) {
      const libelle = paquetNom ? `Commencer · ${paquetNom} (${r.total})` : `Commencer · ${nb(r.total, 'carte')}`;
      actionEntree = () => ctx.aller('seance', { filtre });
      vider(barre, bouton(libelle, { principal: true, onClick: actionEntree }));
    } else {
      // Objectif atteint : rien n'est exigé de plus, les QCM passent devant.
      // « Réviser en avance » seulement s'il reste des cartes pas encore répondues aujourd'hui.
      const enAvance = avance ? bouton('Réviser en avance', { principal: !jour.atteint || !qcm, onClick: () => ctx.aller('seance', { filtre, enAvance: true }) }) : null;
      const qcmBouton = faireQcm(jour.atteint || !avance);
      vider(barre, h('div', { class: 'barre-action__rang' }, jour.atteint ? [enAvance, qcmBouton] : [qcmBouton, enAvance]));
    }
  }

  // Sur PC : Entrée lance la séance, sauf dans un champ, sur un bouton ou un lien, ou sous une feuille ouverte.
  function clavier(ev) {
    if (ev.key !== 'Enter' || !actionEntree || ev.repeat || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (!document.getElementById('surimpression')?.hidden) return;
    if (ev.target?.closest?.('input, textarea, select, button, a, summary, [contenteditable]')) return;
    ev.preventDefault();
    actionEntree();
  }
  document.addEventListener('keydown', clavier);

  afficher(true);
  return {
    noeud, titre: "Aujourd'hui",
    surDonnees: () => afficher(),
    surEtat: () => afficher(),
    quitter: () => { clearTimeout(minuterieLent); document.removeEventListener('keydown', clavier); },
  };
}
