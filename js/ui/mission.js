// Mode Mission : choix du niveau, manche 1 « Éclair » (QCM chronométrés), manche 2 « Consignes
// piège » (vrai ou faux ?), bilan. Les QCM vont au journal des QCM, les pièges à progres/vf/.
import { NIVEAUX, BONUS_DOSSIER, choisirEclair, choisirPieges, lignePiege, serieJours, bilanMission } from '../mission.js';
import { scorer, ligneQcm, etatQcm } from '../qcm.js';
import { h, vider, bouton, boutonConfirme, icone, annoncer, nb, virgule, points, empiler, depiler, lireLocal, ecrireLocal } from './commun.js';

const LETTRES = ['A', 'B', 'C', 'D', 'E'];
const CLE_NIVEAU = 'rappel.mission.niveau';

function baremeCourt(b) {
  const x = (Array.isArray(b) && b.length === 4 ? b : [1, 0.5, 0.2, 0]).map(virgule);
  return `${x[0]} / ${x[1]} / ${x[2]} / ${x[3]}`;
}

function nomCours(d, id) {
  return d.paquets[id]?.nom || d.nomsQcm?.[id] || id;
}

function origine(q) {
  if (!q.annale) return null;
  return h('p', { class: 'mission-source', text: `Annale · ${String(q.annale.titre || '').replace(/^Annale\s*[-:–]\s*/i, '')}` });
}

export function creer(ctx) {
  const page = h('div', { class: 'page page--mission' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'qcm mission' }, page, barre);
  const position = h('p', { class: 'seance-haut__position' });
  const progression = h('progress', { class: 'barre barre--seance', max: '1', value: '0', 'aria-hidden': 'true' });
  const chronoTexte = h('span', { class: 'chrono__texte' });
  const chronoBarre = h('progress', { class: 'barre chrono__barre', max: '1', value: '1', 'aria-hidden': 'true' });
  const chrono = h('div', { class: 'chrono', role: 'timer' }, icone('chrono', { classe: 'chrono__icone' }), chronoTexte, chronoBarre);
  const barreHaut = h('div', { class: 'seance-haut' });
  const vue = { noeud, titre: 'Mission', onglet: 'mission', barreHaut: null, plein: false };
  let mode = 'accueil';
  let signature = '';
  let m = null;          // mission en cours
  let minuteur = null;
  let terminer = null;
  let actionEntree = null;
  let touches = null;    // {lettre → action} pendant une question
  let entree = null;

  // ---------- Chrono ----------
  function arreterChrono() { if (minuteur) { clearInterval(minuteur); minuteur = null; } }
  function lancerChrono(secondes, auBout) {
    arreterChrono();
    const fin = Date.now() + secondes * 1000;
    const tic = () => {
      const reste = Math.max(0, fin - Date.now());
      const s = Math.ceil(reste / 1000);
      chronoTexte.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      chronoBarre.value = reste / (secondes * 1000);
      chrono.classList.toggle('chrono--fin', reste < 5000);
      if (reste <= 0) { arreterChrono(); auBout(); }
    };
    chrono.hidden = false;
    tic();
    minuteur = setInterval(tic, 250);
  }

  // ---------- Accueil ----------
  function accueil(force = false) {
    mode = 'accueil';
    const d = ctx.donnees();
    const now = ctx.maintenant();
    const niveau = NIVEAUX[lireLocal(CLE_NIVEAU)] ? lireLocal(CLE_NIVEAU) : 'bronze';
    const eclair = choisirEclair(d, now, { n: NIVEAUX.diamant.qcm, rnd: () => 0.5 });
    const pieges = choisirPieges(d, now, { n: NIVEAUX.diamant.vf, rnd: () => 0.5 });
    const jours = serieJours(d.vfJournal, now);
    const sig = JSON.stringify([niveau, eclair.length, pieges.length, jours, (d.qcmJournal || []).length, (d.vfJournal || []).length, d.reglages.baremeQcm]);
    if (!force && sig === signature) return;
    signature = sig;

    const cartes = Object.values(NIVEAUX).map(n => {
      const id = `niveau-${n.id}`;
      const radio = h('input', { type: 'radio', name: 'niveau', id, value: n.id, class: 'proposition__case', checked: n.id === niveau || null });
      radio.addEventListener('change', () => { ecrireLocal(CLE_NIVEAU, n.id); accueil(true); });
      const minutes = Math.round((n.qcm * n.chronoQcm * 0.6 + n.vf * n.chronoVf * 0.6) / 60);
      return h('label', { class: ['proposition', 'niveau', `niveau--${n.id}`], for: id }, radio,
        h('span', { class: 'proposition__lettre', 'aria-hidden': 'true' }, h('span', { text: n.nom[0] }), icone('juste')),
        h('span', { class: 'proposition__texte' },
          h('strong', { text: n.nom }), ` · ${n.qcm} QCM (${n.chronoQcm} s) + ${n.vf} pièges (${n.chronoVf} s)`,
          h('span', { class: 'niveau__detail', text: ` · environ ${minutes} min${n.rattrapage ? '' : ' · pièges ratés non repris'}` })));
    });

    vider(page,
      h('h1', { class: 'titre-page', text: 'Mission' }),
      h('p', { class: 'chapeau', text: 'Deux manches au format du partiel, chronométrées : QCM à 5 propositions, puis vrai ou faux sur une proposition seule. Annales comprises.' }),
      jours ? h('p', { class: 'chiffres', text: `${nb(jours, 'jour')} de mission d'affilée` }) : null,
      h('fieldset', { class: 'propositions' }, h('legend', { class: 'sous-titre', text: 'Niveau' }), cartes),
      h('section', { class: 'bloc-seance' },
        h('h2', { class: 'sous-titre', text: 'Manche 1 · Éclair' }),
        h('p', { class: 'aide', text: `QCM dus d'abord, puis neufs des cours commencés et des annales de leurs UE, une UE après l'autre. Temps écoulé : la réponse est validée telle quelle. Barème : ${baremeCourt(d.reglages.baremeQcm)}.` }),
        h('h2', { class: 'sous-titre', text: 'Manche 2 · Consignes piège' }),
        h('p', { class: 'aide', text: 'Une proposition, vraie ou fausse ? Surtout des fausses. Tes erreurs de QCM et de pièges reviennent ici.' })),
      !eclair.length && !pieges.length ? h('p', { class: 'aide', text: 'Rien à proposer : aucun QCM disponible pour les cours commencés.' }) : null);
    vider(barre, eclair.length || pieges.length ? bouton(`Lancer la mission ${NIVEAUX[niveau].nom}`, { principal: true, onClick: () => demarrer(niveau) }) : null);
    actionEntree = eclair.length || pieges.length ? () => demarrer(niveau) : null;
  }

  // ---------- Mission ----------
  function demarrer(id) {
    const niveau = NIVEAUX[id];
    const d = ctx.donnees();
    const now = ctx.maintenant();
    const eclair = choisirEclair(d, now, { n: niveau.qcm });
    m = { niveau, eclair, pieges: [], i: 0, manche: 1, resQcm: [], resPieges: [], rattrapage: [], serie: 0 };
    if (!eclair.length) return mancheDeux();
    entrerPlein();
    question();
  }

  function entrerPlein() {
    terminer = boutonConfirme('Terminer', 'Touche encore', () => bilan(), { discret: true, classe: 'btn--petit' });
    vider(barreHaut, h('div', { class: 'seance-haut__in' }, terminer, position, chrono), progression);
    vue.plein = true;
    document.documentElement.classList.add('plein');
    vider(document.getElementById('sous-entete'), barreHaut);
    if (!entree) entree = empiler(surRetour);
  }

  function majHaut() {
    const n = m.manche === 1 ? m.eclair.length : m.pieges.length + m.rattrapage.length;
    const libelle = m.manche === 1 ? 'Éclair' : m.i >= m.pieges.length ? 'Rattrapage' : 'Piège';
    position.textContent = mode === 'bilan' ? 'Mission terminée' : `${libelle} ${Math.min(m.i + 1, n)} / ${n}${m.serie >= 3 ? ` · série ${m.serie}` : ''}`;
    progression.max = Math.max(1, n);
    progression.value = mode === 'bilan' ? progression.max : Math.min(m.i, n);
    if (terminer) terminer.hidden = mode === 'bilan';
  }

  // Manche 1 : un QCM.
  function question() {
    mode = 'question';
    const q = m.eclair[m.i];
    const d = ctx.donnees();
    const cochees = new Set();
    const debut = ctx.maintenant();
    majHaut();
    touches = {};
    const lignes = (q.propositions || []).map(p => {
      const id = `prop-${p.l}`;
      const caseCocher = h('input', { type: 'checkbox', id, class: 'proposition__case', 'data-lettre': p.l });
      const ligne = h('label', { class: 'proposition', for: id });
      caseCocher.addEventListener('change', () => {
        if (caseCocher.checked) cochees.add(p.l); else cochees.delete(p.l);
      });
      touches[p.l] = () => caseCocher.click();
      return vider(ligne, caseCocher,
        h('span', { class: 'proposition__lettre', 'aria-hidden': 'true' }, h('span', { text: p.l }), icone('juste')),
        h('span', { class: 'proposition__texte' }, h('span', { class: 'lecteur-seul', text: `${p.l}. ` }), p.t));
    });
    vider(page,
      h('p', { class: 'etiquette-carte' }, h('span', { class: 'etiquette-carte__paquet', text: nomCours(d, q.cours) })),
      q.contexte ? h('details', { class: 'details mission-cas', open: true }, h('summary', { text: 'Dossier' }), h('p', { text: q.contexte })) : null,
      h('h1', { class: 'question', tabindex: '-1', text: q.enonce }),
      h('p', { class: 'consigne', text: 'Coche toutes les propositions vraies.' }),
      h('fieldset', { class: 'propositions' }, h('legend', { class: 'lecteur-seul', text: 'Propositions' }), lignes),
      h('p', { class: 'aide aide--pc', text: 'Touches A à E pour cocher · Entrée pour valider' }));
    let fait = false;
    const valider = () => { if (fait) return; fait = true; arreterChrono(); correction(q, [...cochees], debut); };
    vider(barre, bouton('Valider', { principal: true, onClick: valider }));
    actionEntree = valider;
    lancerChrono(m.niveau.chronoQcm + (q.contexte ? BONUS_DOSSIER : 0), valider);
    page.querySelector('h1').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function correction(q, cochees, debut) {
    mode = 'correction';
    touches = null;
    chrono.hidden = true;
    const d = ctx.donnees();
    const t = ctx.maintenant();
    const resultat = scorer(q, cochees, d.reglages.baremeQcm);
    ctx.sync.ajouter({ type: 'qcm-reponse', ligne: ligneQcm({ qcm: q, cochees, resultat, duree: Math.max(0, t - debut), maintenant: t, appareil: ctx.appareil }) });
    m.resQcm.push({ ts: t, points: resultat.points });
    m.serie = resultat.points >= 1 ? m.serie + 1 : 0;
    majHaut();
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
          h('strong', { text: x.vrai ? 'Vraie' : 'Fausse' }), ` · tu ${x.cochee ? "l'as cochée" : "ne l'as pas cochée"}`),
        p.expl ? h('p', { class: 'corr-prop__expl', text: p.expl }) : null);
    });
    vider(page,
      h('p', { class: 'question question--petite question--entiere', text: q.enonce }),
      h('div', { class: ['verdict', `verdict--${classe}`], tabindex: '-1' },
        h('div', { class: 'verdict__tete' }, icone(classe, { classe: 'verdict__icone' }), h('h2', { class: 'verdict__mot', text: titre })),
        h('p', { class: 'verdict__ligne', text: retour })),
      props, origine(q));
    const dernier = m.i >= m.eclair.length - 1;
    const suite = () => { if (dernier) mancheDeux(); else { m.i++; question(); } };
    vider(barre, bouton(dernier ? 'Manche 2 · Pièges' : 'Suivant', { principal: true, onClick: suite }));
    const affiche = Date.now();
    actionEntree = () => { if (Date.now() - affiche > 600) suite(); };
    annoncer(`${titre}. ${retour}`);
    page.querySelector('.verdict').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // Manche 2 : pièges (QCM de la manche 1 exclus : leur correction vient d'être vue).
  function mancheDeux() {
    const d = ctx.donnees();
    m.manche = 2;
    m.i = 0;
    m.pieges = choisirPieges(d, ctx.maintenant(), { n: m.niveau.vf, exclure: m.eclair.map(q => q.id) });
    if (!m.pieges.length) return bilan();
    if (!vue.plein) entrerPlein();
    piege();
  }

  function piege() {
    mode = 'piege';
    const rattrapage = m.i >= m.pieges.length;
    const item = rattrapage ? m.rattrapage[m.i - m.pieges.length] : m.pieges[m.i];
    const d = ctx.donnees();
    const debut = ctx.maintenant();
    majHaut();
    let fait = false;
    const repondre = reponse => { if (fait) return; fait = true; arreterChrono(); verdictPiege(item, reponse, debut, rattrapage); };
    vider(page,
      h('p', { class: 'etiquette-carte' }, h('span', { class: 'etiquette-carte__paquet', text: nomCours(d, item.cours) }),
        rattrapage ? h('span', { class: 'badge', text: 'rattrapage' }) : null),
      h('p', { class: 'mission-enonce', text: item.enonce }),
      h('h1', { class: 'question', tabindex: '-1', text: item.t }),
      h('p', { class: 'consigne', text: 'Vraie ou fausse ?' }),
      h('p', { class: 'aide aide--pc', text: 'Touche V ou F' }));
    vider(barre, h('div', { class: 'vf-boutons' },
      bouton('Vrai', { classe: 'btn--vrai', onClick: () => repondre(true) }),
      bouton('Faux', { classe: 'btn--faux', onClick: () => repondre(false) })));
    touches = { V: () => repondre(true), F: () => repondre(false) };
    actionEntree = null;
    lancerChrono(m.niveau.chronoVf, () => repondre(null));
    page.querySelector('h1').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function verdictPiege(item, reponse, debut, rattrapage) {
    mode = 'verdict-piege';
    touches = null;
    chrono.hidden = true;
    const t = ctx.maintenant();
    const ok = reponse === item.vrai;
    // Le rattrapage sert à corriger la trace, pas à gagner des points : il n'est pas journalisé.
    if (!rattrapage) {
      ctx.sync.ajouter({ type: 'vf-reponse', ligne: lignePiege({ item, reponse, duree: Math.max(0, t - debut), maintenant: t, appareil: ctx.appareil, niveau: m.niveau.id }) });
      m.resPieges.push({ ts: t, ok });
      if (!ok && m.niveau.rattrapage) m.rattrapage.push(item);
    }
    m.serie = ok ? m.serie + 1 : 0;
    majHaut();
    const mot = reponse == null ? 'Temps écoulé' : ok ? 'Juste' : 'Raté';
    const classe = ok ? 'juste' : 'faux';
    vider(page,
      h('p', { class: 'mission-enonce', text: item.enonce }),
      h('p', { class: 'question question--petite question--entiere', text: item.t }),
      h('div', { class: ['verdict', `verdict--${classe}`], tabindex: '-1' },
        h('div', { class: 'verdict__tete' }, icone(classe, { classe: 'verdict__icone' }), h('h2', { class: 'verdict__mot', text: mot })),
        h('p', { class: 'verdict__ligne', text: `Elle est ${item.vrai ? 'vraie' : 'fausse'}.${!ok && !rattrapage && m.niveau.rattrapage ? ' Elle revient en fin de manche.' : ''}` })),
      item.expl ? h('p', { class: 'corr-prop__expl', text: item.expl }) : null,
      origine(item));
    const total = m.pieges.length + m.rattrapage.length;
    const dernier = m.i >= total - 1;
    const suite = () => { if (dernier) bilan(); else { m.i++; piege(); } };
    vider(barre, bouton(dernier ? 'Voir le bilan' : 'Suivant', { principal: true, onClick: suite }));
    const affiche = Date.now();
    actionEntree = () => { if (Date.now() - affiche > 400) suite(); };
    annoncer(`${mot}. Elle est ${item.vrai ? 'vraie' : 'fausse'}.`);
    page.querySelector('.verdict').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function bilan() {
    arreterChrono();
    mode = 'bilan';
    touches = null;
    chrono.hidden = true;
    if (m) majHaut();
    const b = bilanMission({ qcm: m?.resQcm || [], pieges: m?.resPieges || [] });
    const jours = serieJours(ctx.donnees().vfJournal, ctx.maintenant());
    vider(page,
      h('h1', { class: 'titre-page', tabindex: '-1', text: b.reussie ? `Mission ${m.niveau.nom} réussie` : 'Mission terminée' }),
      h('div', { class: 'grand-compteur' },
        h('p', { class: 'grand-compteur__chiffre', text: `${Math.round(b.taux * 100)} %` }),
        h('p', { class: 'grand-compteur__texte', text: 'de réussite (60 % pour valider)' })),
      h('ul', { class: 'liste-ue' },
        b.nQcm ? h('li', { class: 'ue' }, h('p', { class: 'ue__nom', text: 'Éclair' }), h('p', { class: 'ue__ligne', text: `${virgule(b.ptsQcm)} / ${b.nQcm} points` })) : null,
        b.nPieges ? h('li', { class: 'ue' }, h('p', { class: 'ue__nom', text: 'Pièges' }), h('p', { class: 'ue__ligne', text: `${b.justes} / ${b.nPieges} justes` })) : null,
        h('li', { class: 'ue' }, h('p', { class: 'ue__nom', text: 'Meilleure série' }), h('p', { class: 'ue__ligne', text: `${nb(b.meilleure, 'bonne réponse', 'bonnes réponses')} d'affilée` }))),
      jours ? h('p', { class: 'chapeau', text: `${nb(jours, 'jour')} de mission d'affilée.` }) : null);
    vider(barre, bouton('Retour', { principal: true, onClick: fermer }));
    actionEntree = fermer;
    ctx.sync.pousser('fin-seance').catch(() => {});
    page.querySelector('h1').focus({ preventScroll: true });
  }

  function fermer() {
    arreterChrono();
    m = null;
    touches = null;
    vue.plein = false;
    document.documentElement.classList.remove('plein');
    vider(document.getElementById('sous-entete'));
    if (entree) { const e = entree; entree = null; depiler(e); }
    signature = '';
    accueil(true);
    window.scrollTo(0, 0);
  }

  function surRetour() {
    entree = null;
    if (mode === 'bilan' || !m) { fermer(); return; }
    if (terminer?.classList.contains('arme')) terminer.click(); else terminer?.armer();
    entree = empiler(surRetour);
  }

  function clavier(ev) {
    if (!document.getElementById('surimpression')?.hidden || ev.isComposing || ev.repeat) return;
    if (ev.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio])')) return;
    if (touches && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const k = ev.key.toUpperCase();
      const l = touches[k] ? k : LETTRES[['1', '2', '3', '4', '5'].indexOf(ev.key)];
      if (l && touches[l]) { ev.preventDefault(); touches[l](); return; }
    }
    if (ev.key === 'Escape' && m && mode !== 'bilan') { ev.preventDefault(); terminer?.armer(); return; }
    if (ev.key === 'Enter' && actionEntree && !ev.target.matches?.('button, a, summary')) { ev.preventDefault(); actionEntree(); }
  }
  document.addEventListener('keydown', clavier);

  accueil(true);

  return Object.assign(vue, {
    surDonnees: () => { if (mode === 'accueil') accueil(); },
    quitter: () => {
      arreterChrono();
      document.removeEventListener('keydown', clavier);
      if (entree) { const e = entree; entree = null; depiler(e); }
      document.documentElement.classList.remove('plein');
    },
  });
}
