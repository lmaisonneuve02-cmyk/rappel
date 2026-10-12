// QCM : mélange des cours vus, choix d'un cours, question, correction par proposition, bilan,
// génération par Gemini (vérifiée par un second passage).
import { choisirQcm, qcmProposables, scorer, etatQcm, ligneQcm } from '../qcm.js';
import { genererQcm, repondreQcm } from '../gemini.js';
import { MODELES_DEFAUT } from '../config.js';
import { finJourParis } from '../temps.js';
import {
  h, vider, bouton, boutonConfirme, icone, toast, annoncer, nb, virgule, points, empiler, depiler, bandeau,
} from './commun.js';

const LETTRES = ['A', 'B', 'C', 'D', 'E'];
const generations = new Map();   // cours → {etat: 'en-cours'|'fini'|'erreur', texte, prets} (survit au changement d'écran)

function baremeTexte(b) {
  const x = (b && b.length === 4 ? b : [1, 0.5, 0.2, 0]).map(virgule);
  return `Barème : 0 erreur = ${x[0]} point · 1 = ${x[1]} · 2 = ${x[2]} · 3 ou plus = ${x[3]}. Une erreur : une case cochée à tort ou oubliée.`;
}

// Cours connus : paquets dans l'ordre, puis cours qui n'ont que des QCM.
function listeCours(d) {
  const ids = [...d.ordre];
  for (const q of Object.values(d.qcm)) if (q.cours && !ids.includes(q.cours)) ids.push(q.cours);
  const titrePlan = new Map();
  for (const ue of d.plan?.ues || []) for (const c of ue.cours || []) if (c?.id) titrePlan.set(c.paquet || c.id, c.titre);
  return ids.map(id => ({ id, nom: d.paquets[id]?.nom || titrePlan.get(id) || id, ue: d.paquets[id]?.ue }));
}

function nomCours(d, id) {
  return d.paquets[id]?.nom || id;
}

export function creer(ctx, params = {}) {
  const page = h('div', { class: 'page page--qcm' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'qcm' }, page, barre);
  const position = h('p', { class: 'seance-haut__position' });
  const progression = h('progress', { class: 'barre barre--seance', max: '1', value: '0', 'aria-hidden': 'true' });
  let terminer = null;
  const barreHaut = h('div', { class: 'seance-haut' });
  const vue = { noeud, titre: 'QCM', onglet: 'qcm', barreHaut: null, plein: false };
  let mode = 'accueil';
  let signature = '';
  let serie = null;
  let actionEntree = null;
  let entree = null;

  // ---------- Accueil ----------
  function accueil(force = false) {
    mode = 'accueil';
    const d = ctx.donnees();
    const now = ctx.maintenant();
    const r = d.reglages;
    const n = Number(r.qcmParSeance) || 8;
    const melange = choisirQcm(d, now, { n });
    const fin = finJourParis(now);
    const journal = d.qcmJournal || [];
    const proposables = qcmProposables(d);
    const dus = proposables.filter(q => { const e = etatQcm(q.id, journal); return e.due != null && e.due < fin; }).length;
    const cle = !!ctx.cles().gemini;
    const cours = listeCours(d);
    const sig = JSON.stringify([melange.length, dus, proposables.length, journal.length, cle, cours.length, [...generations.entries()], r.baremeQcm, n]);
    if (!force && sig === signature) return;
    signature = sig;
    const ouvert = page.querySelector('details.choix-cours')?.open;

    const parCours = new Map();
    for (const q of proposables) parCours.set(q.cours, (parCours.get(q.cours) || 0) + 1);
    const moyennes = new Map();
    for (const l of journal) {
      const m = moyennes.get(l.cours) || { s: 0, n: 0 };
      m.s += Number(l.points) || 0; m.n++;
      moyennes.set(l.cours, m);
    }

    const lignes = cours.map(c => {
      const nq = parCours.get(c.id) || 0;
      const m = moyennes.get(c.id);
      const g = generations.get(c.id);
      const infos = [nq ? nb(nq, 'QCM', 'QCM') : 'aucun QCM', m ? `moy. ${virgule(m.s / m.n)}` : null].filter(Boolean).join(' · ');
      const peutGenerer = cle && d.paquets[c.id] && g?.etat !== 'en-cours';
      return h('li', { class: 'cours' },
        h('div', { class: 'cours__infos' }, h('p', { class: 'cours__nom', text: c.nom }), h('p', { class: 'cours__chiffres', text: infos }),
          g ? h('p', { class: ['cours__generation', g.etat === 'erreur' && 'cours__generation--erreur'], role: 'status', text: g.texte }) : null),
        h('div', { class: 'cours__actions' },
          nq ? bouton('Faire', { classe: 'btn--petit', onClick: () => demarrerSerie({ cours: c.id }) }) : null,
          peutGenerer ? bouton('Générer 5 QCM', { classe: 'btn--petit', onClick: () => generer(c.id) }) : null));
    });

    vider(page,
      h('h1', { class: 'titre-page', text: 'QCM' }),
      h('p', { class: 'chapeau', text: 'Format fac : 5 propositions, une ou plusieurs vraies. Ils ne comptent pas dans tes cartes acquises.' }),
      h('section', { class: 'bloc-seance' },
        h('h2', { class: 'sous-titre', text: 'Mélange des cours vus' }),
        melange.length
          ? h('p', { class: 'chiffres', text: `${nb(melange.length, 'question')} · environ ${melange.length} min${dus ? ` · dont ${dus} à refaire aujourd'hui` : ''}` })
          : h('p', { class: 'aide', text: proposables.length ? 'Rien de neuf dans les cours que tu as commencés. Choisis un cours ci-dessous.' : 'Pas encore de QCM. Ils arrivent pour les cours commencés en cartes.' }),
        h('p', { class: 'aide', text: baremeTexte(r.baremeQcm) })),
      h('details', { class: 'details choix-cours', open: !!ouvert || !melange.length },
        h('summary', null, `Choisir un cours (${cours.length})`),
        cle ? h('p', { class: 'aide', text: '« Générer 5 QCM » : Gemini les écrit à partir de tes cartes et de la fiche, puis un second passage les vérifie (environ 30 s).' })
          : h('p', { class: 'aide' }, 'Pour générer des QCM : ajoute ta clé Gemini dans ', h('button', { type: 'button', class: 'lien', text: 'Réglages', onclick: () => ctx.aller('reglages', { section: 'cles' }) }), '.'),
        h('ul', { class: 'liste-cours' }, lignes)));
    vider(barre, melange.length ? bouton(`Commencer · ${nb(melange.length, 'QCM', 'QCM')}`, { principal: true, onClick: () => demarrerSerie({}) }) : null);
    actionEntree = melange.length ? () => demarrerSerie({}) : null;
  }

  async function generer(cours) {
    const d = ctx.donnees();
    const paquet = d.paquets[cours];
    if (!paquet) return;
    const g = ctx.gemini();
    const modele = d.reglages.modeles?.contestation || MODELES_DEFAUT.contestation;
    const ue = paquet.ue || null;
    const fiche = d.fiches[cours] || d.fiches[paquet.cartes?.[0]?.fiche] || null;
    const etat = (e, texte, prets = 0) => { generations.set(cours, { etat: e, texte, prets }); if (mode === 'accueil') accueil(); };
    etat('en-cours', 'Je prépare 5 QCM… (environ 30 s)');
    try {
      const brouillons = await genererQcm({ cours, ue, cartes: paquet.cartes || [], fiche, n: 5 }, { cle: g.cle, modele, fetch: g.fetch, delai: 60000 });
      let prets = 0, ecartes = 0;
      for (const [i, q] of brouillons.entries()) {
        etat('en-cours', `Je vérifie ${i + 1} sur ${brouillons.length}…`);
        let lettres = null;
        try { lettres = await repondreQcm(q, { cle: g.cle, modele, fetch: g.fetch }); } catch (e) { if (e?.code === 'quota' || e?.code === 'cle') throw e; }
        const attendu = q.propositions.filter(p => p.vrai).map(p => p.l).sort().join(',');
        const t = ctx.maintenant() + i;
        if (lettres && lettres.join(',') === attendu) {
          ctx.sync.ajouter({ type: 'qcm-ajout', cours, ue, qcm: { ...q, verifie: true } });
          prets++;
        } else {
          ctx.sync.ajouter({ type: 'a-revoir', cas: {
            id: `${ctx.appareil}-${t}`, ts: t, type: 'qcm-rejete', qcm: q.id, cours,
            raison: lettres ? `Second passage : ${lettres.join(', ') || 'aucune'} ; clé : ${attendu}.` : 'Second passage impossible.',
            explication: `${q.enonce} | ${q.propositions.map(p => `${p.l}${p.vrai ? '*' : ''} ${p.t}`).join(' | ')}`,
          } });
          ecartes++;
        }
      }
      const texte = prets ? `${nb(prets, 'QCM prêt', 'QCM prêts')}${ecartes ? ` (${ecartes} écarté${ecartes > 1 ? 's' : ''} au contrôle)` : ''}.` : 'Aucun QCM n\'a passé le contrôle. Réessaie plus tard.';
      etat('fini', texte, prets);
      toast(`${nomCours(d, cours)} : ${texte}`);
    } catch (e) {
      etat('erreur', `${e?.message || 'Gemini n\'a pas pu préparer les QCM.'} Réessaie plus tard.`);
    }
  }

  // ---------- Série ----------
  function demarrerSerie({ cours = null }) {
    const d = ctx.donnees();
    const n = Number(d.reglages.qcmParSeance) || 8;
    const questions = choisirQcm(d, ctx.maintenant(), { n, cours });
    if (!questions.length) { toast('Pas de QCM à faire pour le moment.'); return; }
    serie = { questions, i: 0, resultats: [], cours };
    mode = 'serie';
    terminer = boutonConfirme('Terminer', 'Touche encore', () => bilan(), { discret: true, classe: 'btn--petit' });
    vider(barreHaut, h('div', { class: 'seance-haut__in' }, terminer, position), progression);
    vue.plein = true;
    document.documentElement.classList.add('plein');
    vider(document.getElementById('sous-entete'), barreHaut);
    if (!entree) entree = empiler(surRetour);
    question();
  }

  function majHaut() {
    position.textContent = mode === 'bilan' ? 'Série terminée' : `QCM ${serie.i + 1} sur ${serie.questions.length}`;
    progression.max = serie.questions.length;
    progression.value = mode === 'bilan' ? serie.questions.length : serie.i;
    if (terminer) terminer.hidden = mode === 'bilan';
  }

  function question() {
    mode = 'question';
    const q = serie.questions[serie.i];
    const d = ctx.donnees();
    const cochees = new Set();
    const debut = ctx.maintenant();
    majHaut();
    const genere = q.source === 'gemini' || q.statut === 'brouillon';
    const lignes = (q.propositions || []).map(p => {
      const id = `prop-${p.l}`;
      const caseCocher = h('input', { type: 'checkbox', id, class: 'proposition__case', 'data-lettre': p.l });
      const ligne = h('label', { class: 'proposition', for: id });
      caseCocher.addEventListener('change', () => {
        if (caseCocher.checked) cochees.add(p.l); else cochees.delete(p.l);
        ligne.classList.toggle('cochee', caseCocher.checked);
      });
      return vider(ligne, caseCocher,
        h('span', { class: 'proposition__lettre', 'aria-hidden': 'true' }, h('span', { text: p.l }), icone('juste')),
        h('span', { class: 'proposition__texte' }, h('span', { class: 'lecteur-seul', text: `${p.l}. ` }), p.t));
    });
    vider(page,
      h('p', { class: 'etiquette-carte' }, h('span', { class: 'etiquette-carte__paquet', text: nomCours(d, q.cours) }),
        genere ? h('span', { class: 'badge', title: 'Écrit par Gemini à partir de tes cartes, vérifié par un second passage. Signale-le s\'il est faux.', text: 'généré' }) : null),
      h('h1', { class: 'question', tabindex: '-1', text: q.enonce }),
      h('p', { class: 'consigne', text: 'Coche toutes les propositions vraies.' }),
      h('fieldset', { class: 'propositions' }, h('legend', { class: 'lecteur-seul', text: 'Propositions' }), lignes),
      h('p', { class: 'aide aide--pc', text: 'Touches A à E pour cocher · Entrée pour valider' }));
    const valider = () => correction(q, [...cochees], debut);
    vider(barre, bouton('Valider', { principal: true, onClick: valider }));
    actionEntree = valider;
    page.querySelector('h1').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function correction(q, cochees, debut) {
    mode = 'correction';
    const d = ctx.donnees();
    const t = ctx.maintenant();
    const resultat = scorer(q, cochees, d.reglages.baremeQcm);
    const ligne = ligneQcm({ qcm: q, cochees, resultat, duree: Math.max(0, t - debut), maintenant: t, appareil: ctx.appareil });
    ctx.sync.ajouter({ type: 'qcm-reponse', ligne });
    serie.resultats.push({ q, resultat });
    const e = etatQcm(q.id, ctx.donnees().qcmJournal);
    const retour = e.etape === 'fini' ? 'Acquis : il ne reviendra plus.' : e.etape === 2 ? 'Revient dans 7 jours.' : 'Revient dans 2 jours.';
    const classe = resultat.points >= 1 ? 'juste' : resultat.points > 0 ? 'partiel' : 'faux';
    const titre = `${points(resultat.points)} · ${resultat.discordances === 0 ? 'sans faute' : nb(resultat.discordances, 'erreur')}`;
    const parLettre = new Map((q.propositions || []).map(p => [p.l, p]));

    const props = resultat.detail.map(x => {
      const p = parLettre.get(x.l) || {};
      return h('div', { class: ['corr-prop', x.ok ? 'corr-prop--ok' : 'corr-prop--ko'] },
        h('div', { class: 'corr-prop__tete' },
          h('span', { class: ['corr-prop__case', x.cochee && 'cochee'], 'aria-hidden': 'true', text: x.l }),
          h('p', { class: 'corr-prop__texte', text: p.t })),
        h('p', { class: 'corr-prop__etat' }, icone(x.ok ? 'juste' : 'faux'),
          h('strong', { text: x.vrai ? 'À cocher' : 'À ne pas cocher' }),
          ` · tu ${x.cochee ? "l'as cochée" : "ne l'as pas cochée"}`),
        p.expl ? h('p', { class: 'corr-prop__expl', text: p.expl }) : null);
    });

    const zoneSignal = h('div', { class: 'contestation' });
    const lienSignal = h('button', { type: 'button', class: 'lien', text: 'Signaler une erreur', onclick: () => signaler(q, zoneSignal, lienSignal) });
    vider(page,
      h('p', { class: 'question question--petite', text: q.enonce }),
      h('div', { class: ['verdict', `verdict--${classe}`], tabindex: '-1' },
        h('div', { class: 'verdict__tete' }, icone(classe === 'juste' ? 'juste' : classe === 'partiel' ? 'partiel' : 'faux', { classe: 'verdict__icone' }),
          h('h2', { class: 'verdict__mot', text: titre })),
        h('p', { class: 'verdict__ligne', text: retour })),
      props,
      h('div', { class: 'pied-verdict' }, lienSignal),
      zoneSignal);
    const dernier = serie.i >= serie.questions.length - 1;
    const suite = () => { if (dernier) bilan(); else { serie.i++; question(); } };
    vider(barre, bouton(dernier ? 'Voir le bilan' : 'Suivant', { principal: true, onClick: suite }));
    const affiche = Date.now();
    actionEntree = () => { if (Date.now() - affiche > 600) suite(); };
    annoncer(`${titre}. ${retour}`);
    page.querySelector('.verdict').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function signaler(q, zone, lien) {
    lien.hidden = true;
    const raison = h('textarea', { id: 'raison-qcm', class: 'reponse', rows: '2', placeholder: 'Ex. : la B est vraie d\'après la fiche', spellcheck: 'false' });
    const envoyer = bouton('Envoyer', { classe: 'btn--plein', onClick: () => {
      const t = ctx.maintenant();
      ctx.sync.ajouter({ type: 'a-revoir', cas: { id: `${ctx.appareil}-${t}`, ts: t, type: 'qcm-signale', qcm: q.id, cours: q.cours, raison: raison.value.trim() || undefined } });
      ctx.sync.ajouter({ type: 'qcm-statut', cours: q.cours, id: q.id, statut: 'signale', maj: t });
      vider(zone, h('p', { class: 'issue issue--ok', role: 'status' }, icone('juste'), 'Merci : ce QCM est mis de côté. Claude le vérifiera.'));
    } });
    vider(zone,
      h('label', { for: 'raison-qcm', class: 'champ__libelle', text: "Qu'est-ce qui ne va pas ? (facultatif)" }),
      raison,
      h('div', { class: 'rang-boutons' }, bouton('Annuler', { discret: true, onClick: () => { vider(zone); lien.hidden = false; } }), envoyer));
    raison.focus();
  }

  function bilan() {
    mode = 'bilan';
    majHaut();
    const total = serie.resultats.reduce((s, r) => s + (Number(r.resultat.points) || 0), 0);
    const rates = serie.resultats.filter(r => r.resultat.points < 1).length;
    vider(page,
      h('h1', { class: 'titre-page', tabindex: '-1', text: 'Série terminée' }),
      h('div', { class: 'grand-compteur' },
        h('p', { class: 'grand-compteur__chiffre', text: `${virgule(total)} / ${serie.resultats.length}` }),
        h('p', { class: 'grand-compteur__texte', text: `points sur ${nb(serie.resultats.length, 'QCM', 'QCM')}` })),
      rates ? h('p', { class: 'chapeau', text: `${nb(rates, 'QCM raté', 'QCM ratés')} : ${rates > 1 ? 'ils reviendront' : 'il reviendra'} dans 2 jours.` })
        : serie.resultats.length ? h('p', { class: 'chapeau', text: 'Sans faute sur toute la série.' }) : null);
    vider(barre, bouton('Retour', { principal: true, onClick: fermerSerie }));
    actionEntree = fermerSerie;
    ctx.sync.pousser('fin-seance').catch(() => {});
    page.querySelector('h1').focus({ preventScroll: true });
  }

  function fermerSerie() {
    serie = null;
    vue.plein = false;
    document.documentElement.classList.remove('plein');
    vider(document.getElementById('sous-entete'));
    if (entree) { const e = entree; entree = null; depiler(e); }
    signature = '';
    accueil(true);
    page.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function surRetour() {
    entree = null;
    if (mode === 'bilan' || !serie) { fermerSerie(); return; }
    if (terminer?.classList.contains('arme')) terminer.click(); else terminer?.armer();
    entree = empiler(surRetour);
  }

  function clavier(ev) {
    if (!document.getElementById('surimpression')?.hidden || ev.isComposing || ev.repeat) return;
    const cible = ev.target;
    if (cible.matches?.('textarea, input:not([type=checkbox])')) return;
    if (mode === 'question') {
      const k = ev.key.toUpperCase();
      const i = LETTRES.indexOf(k) >= 0 ? LETTRES.indexOf(k) : ['1', '2', '3', '4', '5'].indexOf(ev.key);
      if (i >= 0 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const c = page.querySelector(`input[data-lettre="${LETTRES[i]}"]`);
        if (c) { ev.preventDefault(); c.click(); }
        return;
      }
    }
    if (ev.key === 'Escape' && serie && mode !== 'bilan') { ev.preventDefault(); terminer?.armer(); return; }
    if (ev.key === 'Enter' && actionEntree && !cible.matches?.('button, a, summary')) { ev.preventDefault(); actionEntree(); }
  }
  document.addEventListener('keydown', clavier);

  if (params.demarrer) {
    accueil(true);
    vue.apres = () => demarrerSerie({ cours: params.cours || null });
  } else accueil(true);

  return Object.assign(vue, {
    surDonnees: () => { if (mode === 'accueil') accueil(); },
    quitter: () => {
      document.removeEventListener('keydown', clavier);
      if (entree) { const e = entree; entree = null; depiler(e); }
      document.documentElement.classList.remove('plein');
    },
  });
}
