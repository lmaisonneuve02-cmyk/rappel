// Contrôle du jour (29 oct.) : toutes les questions sur une page, copie rendue d'un coup, note au barème.
import { controleDuJour, corrigerControle, opControle, SEUIL_BLOCAGE, SEUIL_OBJECTIF } from '../controle.js';
import { h, vider, bouton, boutonConfirme, lireLocal, ecrireLocal } from './commun.js';

const virgule = n => String(n).replace('.', ',');

export function creer(ctx) {
  const page = h('div', { class: 'page page--controle' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'controle' }, page, barre);
  const vue = { noeud, titre: 'Contrôle du jour', onglet: 'aujourdhui', barreHaut: null, plein: false };
  const retour = () => bouton('Retour', { onClick: () => ctx.aller('aujourdhui') });

  function lireBrouillon(date) {
    try { return JSON.parse(lireLocal(`rappel.controle.${date}`, '{}')) || {}; } catch { return {}; }
  }

  function copie(ctl) {
    const { date, prepare } = ctl;
    const reponses = lireBrouillon(date);
    const garder = () => ecrireLocal(`rappel.controle.${date}`, JSON.stringify(reponses));
    const questions = prepare.questions.map(q => h('section', { class: 'question-controle' },
      h('h2', { class: 'question-controle__enonce', text: `${q.num}. ${q.enonce}` }),
      h('div', { class: 'choix-qcm', role: 'group', 'aria-label': `Question ${q.num}` }, q.propositions.map(p => {
        const oui = () => (reponses[q.num] || []).includes(p.l);
        const b = h('button', { type: 'button', class: ['choix-qcm__btn', oui() && 'choix-qcm__btn--oui'], 'aria-pressed': String(oui()) },
          h('span', { class: 'choix-qcm__lettre', 'aria-hidden': 'true', text: p.l }),
          h('span', { class: 'choix-qcm__texte', text: p.t }));
        b.addEventListener('click', () => {
          const l = new Set(reponses[q.num] || []);
          if (l.has(p.l)) l.delete(p.l); else l.add(p.l);
          reponses[q.num] = [...l].sort();
          garder();
          b.setAttribute('aria-pressed', String(l.has(p.l)));
          b.classList.toggle('choix-qcm__btn--oui', l.has(p.l));
        });
        return b;
      }))));
    vider(page,
      h('h1', { class: 'titre-page', tabindex: '-1', text: prepare.type === 'mini' ? 'Mini-contrôle du jour' : 'Contrôle du mercredi' }),
      h('p', { class: 'chapeau', text: `${prepare.questions.length} questions. Coche les propositions vraies : plusieurs, une ou aucune. Barème des partiels : 1 erreur = 0,5 ; 2 = 0,2 ; 3 ou plus = 0.` }),
      h('p', { class: 'aide', text: 'Tes coches sont gardées sur cet appareil jusqu\'à ce que tu rendes ta copie.' }),
      questions);
    const rendre = () => {
      const res = corrigerControle(prepare, reponses, { maintenant: ctx.maintenant(), appareil: ctx.appareil });
      ctx.sync.ajouter(opControle(res));
      ctx.sync.pousser('controle').catch(() => {});
      ecrireLocal(`rappel.controle.${date}`, null);
      resultat(res);
    };
    vider(barre, h('div', { class: 'barre-action__rang' }, retour(), boutonConfirme('Rendre ma copie', 'Touche encore pour rendre', rendre)));
    page.querySelector('h1').focus({ preventScroll: true });
  }

  function resultat(res) {
    const consequences = res.note < SEUIL_BLOCAGE
      ? "Sous 10 : bloqué jusqu'au rattrapage. Dis « rattrapage » à Claude."
      : res.type !== 'mini' && res.note < SEUIL_OBJECTIF ? "Sous 15 : l'objectif monte (Claude l'appliquera)."
        : 'Au-dessus du seuil : rien ne change.';
    vider(page,
      h('h1', { class: 'titre-page', tabindex: '-1', text: `Note : ${virgule(res.note)}/20` }),
      h('p', { class: 'chiffres', text: `${virgule(res.points)} points sur ${res.nb_questions}` }),
      h('p', { class: ['objectif-ligne', res.note >= SEUIL_OBJECTIF && 'objectif-ligne--ok'], text: consequences }),
      res.questions.map(q => h('section', { class: ['question-controle', q.erreurs && 'question-controle--erreur'] },
        h('h2', { class: 'question-controle__enonce', text: `${q.num}. ${q.enonce}` }),
        h('p', { class: 'question-controle__score', text: q.erreurs ? `${q.erreurs} erreur${q.erreurs > 1 ? 's' : ''} · ${virgule(q.points)} point` : 'Juste · 1 point' }),
        h('ul', { class: 'corrige' }, q.propositions.map(p => {
          const coche = q.reponse.includes(p.l);
          const faux = coche !== !!p.vrai;
          return h('li', { class: ['corrige__ligne', faux && 'corrige__ligne--faux'] },
            h('span', { class: 'corrige__lettre', text: `${p.l} ${p.vrai ? 'vrai' : 'faux'}${coche ? ' · coché' : ''}` }),
            h('span', { class: 'corrige__texte', text: p.t }),
            faux && p.expl ? h('span', { class: 'corrige__expl', text: p.expl }) : null);
        })))));
    vider(barre, retour());
    page.querySelector('h1').focus({ preventScroll: true });
  }

  const ctl = controleDuJour(ctx.donnees(), ctx.maintenant());
  if (!ctl) {
    vider(page, h('h1', { class: 'titre-page', tabindex: '-1', text: 'Pas de contrôle aujourd\'hui' }),
      h('p', { class: 'chapeau', text: 'Les contrôles ont lieu le lundi, le mercredi et le vendredi.' }));
    vider(barre, retour());
  } else if (ctl.resultat) resultat(ctl.resultat);
  else copie(ctl);
  return vue;
}
