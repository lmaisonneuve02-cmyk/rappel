// Suivi : aujourd'hui, 14 derniers jours, par UE, correction, « Comment ça marche ».
import { parJour, parUE, contestationsParSemaine } from '../stats.js';
import { jourParis } from '../temps.js';
import { h, vider, icone, nb, virgule, dateFr } from './commun.js';

const pourcent = x => (x == null ? '—' : `${Math.round(x * 100)} %`);

export function creer(ctx) {
  const page = h('div', { class: 'page page--suivi' });
  let signature = '';

  function afficher(force = false) {
    const d = ctx.donnees();
    const now = ctx.maintenant();
    const jours = parJour(d, now, 14);
    const ues = parUE(d, now);
    const sem = contestationsParSemaine(d);
    const objectif = ctx.objectif();
    const sig = JSON.stringify([jours, ues, sem[0], objectif]);
    if (!force && sig === signature) return;
    signature = sig;
    const auj = jours[0];
    const exceptions = d.exceptions?.jours || {};
    const max = Math.max(objectif, ...jours.map(j => (j.acquises ?? j.reponses) || 0));

    const ligneJour = j => {
      const v1 = j.acquises == null;
      const valeur = v1 ? j.reponses : j.acquises;
      const atteint = !v1 && j.acquises >= objectif;
      const motif = exceptions[j.jour];
      const texte = motif && !valeur ? `jour off : ${motif}` : v1 ? (j.reponses ? `${nb(j.reponses, 'réponse')} (ancienne appli)` : '—') : (valeur ? String(valeur) : '—');
      return h('li', { class: ['jour', v1 && 'jour--v1', atteint && 'jour--atteint'] },
        h('span', { class: 'jour__date', text: j.jour === jourParis(now) ? "auj." : dateFr(j.jour, true) }),
        h('progress', { class: ['barre', 'barre--jour', v1 && 'barre--v1', atteint && 'barre--atteinte'], max: String(max), value: String(valeur || 0), 'aria-hidden': 'true' }),
        h('span', { class: 'jour__valeur' }, texte, atteint ? icone('juste') : null));
    };

    const s0 = sem[0];
    vider(page,
      h('h1', { class: 'titre-page', text: 'Suivi' }),
      h('section', { class: 'bloc-seance' },
        h('h2', { class: 'sous-titre', text: "Aujourd'hui" }),
        h('div', { class: ['grand-compteur', auj.acquises >= objectif && 'grand-compteur--atteint'] },
          h('p', { class: 'grand-compteur__chiffre' }, `${auj.acquises}/${objectif}`, auj.acquises >= objectif ? icone('juste') : null),
          h('p', { class: 'grand-compteur__texte', text: 'cartes acquises' }),
          h('progress', { class: 'barre barre--grande', max: String(objectif), value: String(Math.min(auj.acquises, objectif)), 'aria-hidden': 'true' })),
        h('p', { class: 'chiffres chiffres--doux', text: [nb(auj.reponses, 'réponse'), nb(auj.justes, 'juste'), nb(auj.nouvelles, 'nouvelle', 'nouvelles'), auj.qcm ? `QCM : ${virgule(auj.pointsQcm)} pt sur ${auj.qcm}` : null].filter(Boolean).join(' · ') })),
      h('section', { class: 'bloc' },
        h('h2', { class: 'sous-titre', text: '14 derniers jours' }),
        h('p', { class: 'aide', text: `Cartes acquises par jour. Repère : ${objectif}.` }),
        h('ol', { class: 'jours' }, jours.map(ligneJour))),
      h('section', { class: 'bloc' },
        h('h2', { class: 'sous-titre', text: 'Par UE' }),
        ues.length ? h('ul', { class: 'liste-ue' }, ues.map(u => h('li', { class: 'ue' },
          h('p', { class: 'ue__nom', text: u.nom }),
          h('p', { class: 'ue__ligne', text: `${u.coursEnCartes} cours sur ${u.coursTotal} en cartes · ${u.cartesVues}/${u.cartes} cartes vues` }),
          h('p', { class: 'ue__ligne', text: `Révisions réussies (7 j) : ${pourcent(u.retention7j)} · QCM : ${u.moyenneQcm == null ? '—' : virgule(u.moyenneQcm) + ' pt en moyenne'}` }))))
          : h('p', { class: 'aide', text: 'Pas encore de données.' }),
        h('p', { class: 'aide', text: 'Révisions réussies : part des cartes déjà vues réussies (juste ou partiel) sur la semaine.' })),
      h('section', { class: 'bloc' },
        h('h2', { class: 'sous-titre', text: 'Correction' }),
        h('p', { text: s0 ? `Semaine ${s0.semaine.slice(-2)} : ${nb(s0.contestations, 'contestation')}, dont ${nb(s0.acceptees, 'acceptée')}, sur ${nb(s0.reponses, 'réponse')}.` : 'Aucune contestation pour le moment.' })),
      h('details', { class: 'details details--aide' },
        h('summary', null, 'Comment ça marche'),
        h('ol', { class: 'liste-simple' },
          h('li', { text: 'Tu cherches la réponse avant de la voir : c\'est cet effort qui fait retenir.' }),
          h('li', { text: 'Une carte réussie revient de plus en plus tard ; ratée, elle revient dans 10 min.' }),
          h('li', { text: 'Gemini juge le sens, pas l\'orthographe ; sans clé ou hors ligne, ton appareil corrige. Pas d\'accord ? « Je conteste ».' }),
          h('li', { text: `Une carte est acquise quand ta dernière réponse du jour est juste ou partielle ; objectif : ${objectif} par jour.` }),
          h('li', { text: 'En mains libres, je lis les questions et tu réponds à voix haute.' }),
          h('li', { text: 'Tes réponses sont gardées sur l\'appareil puis envoyées dans ton dépôt : tes autres appareils les retrouvent.' }))));
  }

  afficher(true);
  return { noeud: page, titre: 'Suivi', surDonnees: () => afficher() };
}
