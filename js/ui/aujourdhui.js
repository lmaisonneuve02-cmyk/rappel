// Aujourd'hui : ta séance du jour (révisions puis nouvelles cartes), un seul grand bouton.
import { aReviser, nouvellesPossibles, nouvellesDuJour } from '../seance.js';
import { qcmProposables } from '../qcm.js';
import { estDisponible } from '../fsrs.js';
import { jourParis, finJourParis } from '../temps.js';
import { reconnaissanceDisponible } from '../voix.js';
import { h, vider, bouton, icone, bandeau, pastilles, nb, dateFr, aideVue } from './commun.js';

const MIN_PAR_CARTE = 0.6;
let filtreMemo = { jour: '', filtre: 'tout' };   // le choix d'un paquet vaut jusqu'à minuit

const CODES_CLES = new Set(['jeton', 'droits', 'introuvable']);

function mainsLibresPossible() {
  return !!reconnaissanceDisponible(window) && 'speechSynthesis' in window;
}

// Ce que propose la journée, pour un filtre donné.
function resume(d, now, filtre) {
  const revisions = aReviser(d, now, filtre).length;
  const nouvelles = nouvellesPossibles(d, now, filtre).length;
  return { revisions, nouvelles, total: revisions + nouvelles };
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

export function creer(ctx) {
  const page = h('div', { class: 'page page--aujourdhui' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'aujourdhui' }, page, barre);
  let signature = '';
  let minuterieLent = null;
  let lent = false;

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
    const acquises = ctx.acquises();
    const objectif = ctx.objectif();
    const sig = JSON.stringify([!!cles.jeton, aDesCartes, r, filtre, acquises, objectif, etat.mode, etat.code, lent, d.ordre.length, ctx.enLigne()]);
    if (!force && sig === signature) return;
    signature = sig;
    const defile = page.querySelector('.pastilles')?.scrollLeft || 0;

    // Sans jeton : rien à proposer, on explique pourquoi.
    if (!cles.jeton) {
      vider(page,
        h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
        h('p', { class: 'chapeau', text: `Rappel lit tes cartes et garde tes progrès dans ton dépôt « ${cles.depot.depot} ». Sans jeton d'accès, il n'a rien à te proposer.` }));
      vider(barre, bouton('Relier mes cartes', { principal: true, onClick: () => ctx.aller('accueil') }));
      return;
    }

    // Pas encore de cartes sur l'appareil.
    if (!aDesCartes) {
      const reessayer = bouton('Réessayer', { principal: true, onClick: () => ctx.sync.rafraichir('manuel') });
      if (etat.mode === 'hors-ligne') {
        vider(page, h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
          bandeau("Pas de connexion, et tes cartes ne sont pas encore sur cet appareil. Connecte-toi une fois : ensuite, Rappel marchera aussi hors ligne.", { type: 'horsligne' }));
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
      blocs.push(bandeau(`${etat.message} En attendant, tu peux réviser : tes réponses partiront dès que ça marchera.`, {
        type: 'erreur', action: bouton('Ouvrir Réglages', { onClick: () => ctx.aller('reglages', { section: 'cles' }) }) }));
    }
    if (acquises >= objectif) {
      blocs.push(bandeau(`${acquises} cartes acquises : objectif du jour atteint. Tu peux t'arrêter ou continuer.`, { type: 'reussite' }));
    }

    const paquetNom = filtre === 'tout' ? null : (d.paquets[filtre]?.nom || filtre);
    const reste = Math.max(0, objectif - acquises);
    const enLigne = ctx.enLigne() && etat.mode !== 'hors-ligne';

    if (r.total > 0) {
      const minutes = Math.max(1, Math.round(r.total * MIN_PAR_CARTE));
      const chiffres = [r.revisions ? nb(r.revisions, 'révision') : null, r.nouvelles ? nb(r.nouvelles, 'nouvelle carte', 'nouvelles cartes') : null].filter(Boolean).join(' · ');
      blocs.push(h('section', { class: 'bloc-seance' },
        h('p', { class: 'surtitre', text: dateFr(jourParis(now)) }),
        h('h1', { class: 'titre-page', text: 'Ta séance du jour' }),
        h('p', { class: 'chiffres', text: chiffres }),
        h('p', { class: 'chiffres chiffres--doux', text: `environ ${minutes} min${r.revisions && r.nouvelles ? ' · révisions d\'abord' : ''}` }),
        reste > 0 ? h('p', { class: 'objectif-ligne' }, h('strong', { text: `Objectif : encore ${reste}. ` }),
          r.total >= reste ? 'Cette séance peut suffire.' : `Cette séance en donne au plus ${r.total} : ensuite, tu pourras réviser en avance.`) : null));
    } else {
      const total = resume(d, now, 'tout');
      const prochaines = demain(d, now);
      blocs.push(h('section', { class: 'bloc-seance' },
        h('p', { class: 'surtitre', text: dateFr(jourParis(now)) }),
        h('h1', { class: 'titre-page titre-page--icone' }, icone('juste', { classe: 'icone--reussite' }), h('span', { text: paquetNom ? 'Rien à faire dans ce paquet' : "Tout est fait pour aujourd'hui" })),
        paquetNom && total.total ? h('p', { class: 'chapeau', text: `Il reste ${nb(total.total, 'carte')} dans les autres paquets.` }) : null,
        reste > 0 ? h('p', { class: 'objectif-ligne' }, h('strong', { text: `Encore ${reste} pour l'objectif. ` }), 'Révise en avance : elles comptent dans tes acquises.') : null,
        prochaines ? h('p', { class: 'aide', text: `Prochaines révisions : demain, ${nb(prochaines, 'carte')}.` }) : null));
    }

    // Limite de nouvelles cartes atteinte (et il en reste à découvrir).
    const limite = Number(d.reglages.nouvellesParJour) || 0;
    const jamaisVues = cartesRestantesJamaisVues(d);
    if (filtre === 'tout' && r.nouvelles === 0 && jamaisVues > 0 && nouvellesDuJour(d, now) >= limite) {
      blocs.push(h('div', { class: 'bloc' },
        h('p', { class: 'aide', text: limite > 0 ? `Les ${limite} nouvelles cartes du jour sont faites. Tu peux en demander plus dans Réglages.` : 'Nouvelles cartes : 0 par jour pour le moment. Tu peux en demander dans Réglages.' }),
        h('button', { type: 'button', class: 'lien', onclick: () => ctx.aller('reglages', { section: 'rythme' }), text: 'Réglages › Rythme' })));
    } else if (filtre === 'tout' && jamaisVues === 0) {
      blocs.push(h('p', { class: 'aide', text: 'Tu as vu toutes les cartes des cours préparés. Les prochains paquets arriveront avec de nouveaux cours.' }));
    }

    if (!enLigne) blocs.push(bandeau("Hors ligne : correction sur l'appareil. Tout est gardé et partira au retour du réseau.", { type: 'horsligne' }));

    // Pastilles : un seul paquet ? (seulement si au moins deux paquets ont des cartes aujourd'hui)
    const options = [];
    for (const id of d.ordre) {
      const n = resume(d, now, id).total;
      if (n > 0 || id === filtre) options.push({ id, libelle: d.paquets[id]?.nom || id, n });
    }
    if (options.length >= 2 || filtre !== 'tout') {
      const tout = resume(d, now, 'tout').total;
      const groupe = pastilles([{ id: 'tout', libelle: 'Tout', n: tout }, ...options], filtre, id => {
        filtreMemo = { jour: jourParis(ctx.maintenant()), filtre: id };
        afficher(true);
      }, { etiquette: 'Choisir un paquet' });
      blocs.push(h('div', { class: 'choix-paquet' }, h('p', { class: 'petit-titre', text: 'Un seul paquet ? (facultatif)' }), groupe));
      requestAnimationFrame(() => { groupe.scrollLeft = defile; });
    }

    // Mains libres (si la voix est disponible), sinon l'astuce du clavier.
    if (r.total > 0) {
      if (mainsLibresPossible()) {
        blocs.push(h('div', { class: 'mains-libres-entree' },
          bouton('Mains libres', { icone: 'casque', classe: 'btn--large', onClick: () => ctx.aller('mainslibres', { filtre, direct: aideVue('mainslibres') }) }),
          h('p', { class: 'aide', text: 'Je lis les questions, tu réponds à voix haute.' })));
      } else {
        blocs.push(h('p', { class: 'aide aide--ligne' }, icone('micro'), 'Astuce : le micro de ton clavier permet de dicter tes réponses.'));
      }
    }
    vider(page, blocs);

    // Zone du pouce : une seule action principale.
    const qcm = qcmProposables(d).length > 0;
    if (r.total > 0) {
      const libelle = paquetNom ? `Commencer · ${paquetNom} (${r.total})` : `Commencer · ${nb(r.total, 'carte')}`;
      vider(barre, bouton(libelle, { principal: true, onClick: () => ctx.aller('seance', { filtre }) }));
    } else {
      const enAvance = bouton('Réviser en avance', { principal: reste > 0, onClick: () => ctx.aller('seance', { filtre, enAvance: true }) });
      const faireQcm = qcm ? bouton('Faire des QCM', { principal: reste === 0, onClick: () => ctx.aller('qcm') }) : null;
      vider(barre, h('div', { class: 'barre-action__rang' }, reste > 0 ? [faireQcm, enAvance] : [enAvance, faireQcm]));
    }
  }

  afficher(true);
  return {
    noeud, titre: "Aujourd'hui",
    surDonnees: () => afficher(),
    surEtat: () => afficher(),
    quitter: () => clearTimeout(minuterieLent),
  };
}
