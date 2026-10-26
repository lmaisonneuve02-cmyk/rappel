// Feuille blanche : choix du cours, 10 minutes pour écrire ou dicter, correction par Gemini,
// puis séance qui commence par les cartes des idées oubliées.
import { DUREE, DUREE_MIN, ideesDuCours, appliquerFeuille, ligneFeuille, feuillesDeLaSemaine, dernieresFeuilles } from '../feuille.js';
import { corrigerFeuille } from '../gemini.js';
import { opErreur } from '../correction.js';
import { libererMicro } from '../ecoutegemini.js';
import { messageEcoute } from '../voix.js';
import { h, vider, bouton, boutonConfirme, icone, nb, lireLocal, ecrireLocal, empiler, depiler } from './commun.js';

const BROUILLON = 'rappel.feuille.brouillon';   // texte en cours, gardé sur l'appareil (rechargement)
const JOUR = 864e5;

const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function creer(ctx, params = {}) {
  const page = h('div', { class: 'page page--feuille' });
  const barre = h('div', { class: 'barre-action' });
  const noeud = h('div', { class: 'feuille-blanche' }, page, barre);
  const vue = { noeud, titre: 'Feuille blanche', onglet: 'aujourdhui', barreHaut: null, plein: false };
  let minuterie = null, ecoute = null, entree = null, fini = false;

  function arreterTout() {
    clearInterval(minuterie);
    minuterie = null;
    try { ecoute?.annuler(); } catch { /* rien */ }
    ecoute = null;
  }

  // ---------- Choix du cours ----------
  function choix() {
    arreterTout();
    const d = ctx.donnees();
    const objectif = Number(d.reglages?.feuillesSemaine) || 10;
    const semaine = feuillesDeLaSemaine(d, ctx.maintenant(), objectif);
    const dernieres = dernieresFeuilles(d);
    const parUe = new Map();
    for (const id of d.ordre) {
      const p = d.paquets[id];
      if (!p) continue;
      if (!parUe.has(p.ue)) parUe.set(p.ue, []);
      parUe.get(p.ue).push({ id, p });
    }
    const quand = id => {
      const l = dernieres.get(id);
      if (!l) return 'jamais faite';
      const j = Math.floor((ctx.maintenant() - l.ts) / JOUR);
      return `${j ? `il y a ${nb(j, 'jour')}` : "aujourd'hui"} · ${l.presentes}/${l.total} idées`;
    };
    vider(page,
      h('h1', { class: 'titre-page', tabindex: '-1', text: 'Feuille blanche' }),
      h('p', { class: 'chapeau', text: '10 minutes pour écrire ou dicter tout ce que tu sais d\'un cours, sans rien regarder. Ensuite, la séance commence par ce que tu as oublié.' }),
      h('p', { class: ['objectif-ligne', semaine.atteinte && 'objectif-ligne--ok'], text: `Cette semaine : ${semaine.faites}/${semaine.objectif} feuilles${semaine.atteinte ? ' ✓' : ''}.` }),
      [...parUe.entries()].map(([ue, cours]) => h('section', { class: 'bloc-liste' },
        h('h2', { class: 'petit-titre', text: d.plan?.ues?.find(u => u.id === ue)?.nom || ue }),
        h('div', { class: 'liste-cours' }, cours.map(({ id, p }) => h('button', { type: 'button', class: 'cours-choix', onclick: () => ecrire(id) },
          h('span', { class: 'cours-choix__nom', text: p.nom || id }),
          h('span', { class: 'cours-choix__info', text: `${quand(id)}${d.idees?.[id] ? '' : ' · d\'après les cartes'}` })))))));
    vider(barre, bouton('Retour', { onClick: () => ctx.aller('aujourdhui') }));
    page.querySelector('h1').focus({ preventScroll: true });
  }

  // ---------- Écriture ----------
  function ecrire(cours) {
    arreterTout();
    const d = ctx.donnees();
    const { titre } = ideesDuCours(d, cours);
    const brouillon = (() => { try { const b = JSON.parse(lireLocal(BROUILLON, 'null')); return b?.cours === cours ? b : null; } catch { return null; } })();
    const debut = ctx.maintenant() - (brouillon?.ecoule || 0);
    const champ = h('textarea', { id: 'feuille-texte', class: 'reponse reponse--feuille', rows: '12', placeholder: 'Écris ou dicte tout ce que tu sais : définitions, mécanismes, chiffres, signes, traitements…', spellcheck: 'false' });
    champ.value = brouillon?.texte || '';
    const temps = h('p', { class: 'chrono', 'aria-live': 'off' });
    const statut = h('p', { class: 'statut-micro', 'aria-live': 'polite' });
    const garder = () => ecrireLocal(BROUILLON, JSON.stringify({ cours, texte: champ.value, ecoule: ctx.maintenant() - debut }));
    champ.addEventListener('input', garder);

    const micro = h('button', { type: 'button', class: 'micro micro--feuille', 'aria-label': 'Dicter' }, icone('micro'));
    micro.addEventListener('click', async () => {
      if (ecoute?.active) { ecoute.arreter(); return; }
      const e = ecoute = ctx.creerEcoute({ silence: 4000 });
      if ('contexte' in e) e.contexte = { question: `Feuille blanche sur le cours : ${titre}` };
      e.addEventListener('niveau', ev => micro.style.setProperty('--niveau', ev.detail.toFixed(2)));
      e.addEventListener('transcription', () => { statut.textContent = 'Transcription…'; });
      micro.classList.add('actif');
      statut.className = 'statut-micro statut-micro--actif';
      statut.textContent = "J'écoute… je m'arrête après un silence, ou touche le micro.";
      const t = await e.demarrer({ attente: 15000 });
      micro.classList.remove('actif');
      statut.className = 'statut-micro';
      if (e.erreur && e.erreur.code !== 'no-speech') { statut.textContent = e.erreur.message || messageEcoute(e.erreur.code); statut.classList.add('statut-micro--erreur'); }
      else statut.textContent = '';
      if (t) { champ.value = [champ.value.trim(), t].filter(Boolean).join('\n'); garder(); }
      if (ecoute === e) ecoute = null;
    });

    const terminer = () => corriger(cours, champ.value, ctx.maintenant() - debut);
    const finirTot = boutonConfirme("J'ai fini", 'Moins de 5 min : elle ne comptera pas. Touche encore', terminer, {});
    const finir = bouton("J'ai fini", { principal: true, onClick: terminer });
    const tick = () => {
      const reste = DUREE - (ctx.maintenant() - debut);
      temps.textContent = reste > 0 ? mmss(reste) : 'Temps écoulé';
      temps.classList.toggle('chrono--fin', reste < 60000);
      const tot = ctx.maintenant() - debut < DUREE_MIN;
      finirTot.hidden = !tot;
      finir.hidden = tot;
      if (reste <= 0) { clearInterval(minuterie); minuterie = null; terminer(); }
    };
    vider(page,
      h('p', { class: 'surtitre surtitre--veineux', text: 'Feuille blanche' }),
      h('h1', { class: 'titre-page', tabindex: '-1', text: titre }),
      temps,
      h('div', { class: 'champ-reponse champ-reponse--micro' }, champ, micro),
      statut,
      h('p', { class: 'aide', text: 'Sans regarder tes cours. Mots-clés, phrases, listes : tout compte.' }));
    vider(barre, h('div', { class: 'barre-action__rang' }, bouton('Abandonner', { onClick: () => { ecrireLocal(BROUILLON, ''); choix(); } }), finirTot, finir));
    tick();
    minuterie = setInterval(tick, 500);
    champ.focus({ preventScroll: true });
  }

  // ---------- Correction ----------
  async function corriger(cours, texte, duree) {
    arreterTout();
    const d = ctx.donnees();
    const { titre, idees, source } = ideesDuCours(d, cours);
    const g = ctx.gemini();
    const message = h('p', { class: 'chapeau', 'aria-live': 'polite', text: 'Gemini compare ta feuille aux idées du cours…' });
    vider(page, h('h1', { class: 'titre-page', tabindex: '-1', text: titre }), message);
    vider(barre);
    if (!texte.trim()) { ecrireLocal(BROUILLON, ''); choix(); return; }
    if (!g.cle || !ctx.enLigne()) {
      message.textContent = "La correction demande la clé Gemini et le réseau. Ta feuille reste gardée sur l'appareil : réessaie plus tard.";
      vider(barre, h('div', { class: 'barre-action__rang' }, bouton('Retour', { onClick: choix }), bouton('Réessayer', { principal: true, onClick: () => corriger(cours, texte, duree) })));
      return;
    }
    let r;
    try {
      r = await corrigerFeuille(texte, { titre, idees }, { cle: g.cle, fetch: g.fetch, modele: d.reglages?.modeles?.contestation || undefined });
    } catch (e) {
      if (e?.name === 'ErreurGemini') ctx.sync.ajouter(opErreur(e, { contexte: 'feuille', maintenant: ctx.maintenant(), appareil: ctx.appareil }));
      if (fini) return;
      message.textContent = `${e?.message || 'La correction a échoué.'} Ta feuille reste gardée : réessaie.`;
      vider(barre, h('div', { class: 'barre-action__rang' }, bouton('Retour', { onClick: choix }), bouton('Réessayer', { principal: true, onClick: () => corriger(cours, texte, duree) })));
      return;
    }
    const t = ctx.maintenant();
    const effet = appliquerFeuille({ donnees: d, cours, idees, statuts: r.statuts, maintenant: t });
    const resultat = { ...r, ...effet };
    ctx.sync.ajouter({ type: 'feuille', ligne: ligneFeuille({ cours, texte, duree, resultat, maintenant: t, appareil: ctx.appareil, source }) });
    for (const op of effet.ops) ctx.sync.ajouter(op);
    ctx.sync.pousser('feuille').catch(() => {});
    ecrireLocal(BROUILLON, '');
    if (!fini) bilan(cours, titre, idees, resultat, duree);
  }

  function bilan(cours, titre, idees, r, duree) {
    const texteIdee = i => i.texte;
    const groupe = (statut, titreBloc, classe, ouvert = true) => {
      const l = idees.filter(i => r.statuts[i.id] === statut);
      if (!l.length) return null;
      const liste = h('ul', null, l.map(i => h('li', { text: texteIdee(i) })));
      return ouvert ? h('section', { class: ['bloc-liste', classe] }, h('h3', { class: 'petit-titre', text: `${titreBloc} (${l.length})` }), liste)
        : h('details', { class: 'details' }, h('summary', { text: `${titreBloc} (${l.length})` }), liste);
    };
    const simple = (titreBloc, items, classe) => (items?.length ? h('section', { class: ['bloc-liste', classe] }, h('h3', { class: 'petit-titre', text: titreBloc }), h('ul', null, items.map(x => h('li', { text: x })))) : null);
    const compte = duree >= DUREE_MIN;
    vider(page,
      h('p', { class: 'surtitre surtitre--veineux', text: 'Feuille blanche' }),
      h('h1', { class: 'titre-page', tabindex: '-1', text: titre }),
      h('p', { class: 'grand-compteur__chiffre', text: `${r.presentes}/${r.total}` }),
      h('p', { class: 'chiffres chiffres--doux', text: `idées bien écrites · ${r.partielles} en partie · ${r.absentes} oubliées${compte ? '' : ' · moins de 5 min : ne compte pas pour la semaine'}` }),
      r.bilan ? h('p', { class: 'explication', text: r.bilan }) : null,
      simple('Erreurs', r.erreurs, 'bloc-liste--erreur'),
      groupe('absente', 'À revoir en premier', 'bloc-liste--manque'),
      groupe('partielle', 'En partie', 'bloc-liste--manque'),
      groupe('presente', 'Bien écrites', 'bloc-liste--juste', false),
      simple('Juste, et en plus de la liste', r.hors_liste, 'bloc-liste--juste'),
      simple('Gemini ajoute à la liste du cours (noté pour Claude)', r.ajouts, 'bloc-liste--doux'));
    const n = r.priorite.length;
    vider(barre, h('div', { class: 'barre-action__rang' },
      bouton('Terminer', { onClick: () => ctx.aller('aujourdhui') }),
      n ? bouton(`Réviser ces cartes (${n})`, { principal: true, onClick: () => ctx.aller('seance', { filtre: cours, priorite: r.priorite }) }) : null));
    page.querySelector('h1').focus({ preventScroll: true });
  }

  function surRetour() {
    entree = null;
    ctx.aller('aujourdhui');
  }

  if (params.cours && ctx.donnees().paquets[params.cours]) ecrire(params.cours);
  else choix();

  return {
    ...vue,
    apres: () => { entree = empiler(surRetour); },
    quitter: () => {
      fini = true;
      arreterTout();
      libererMicro();
      if (entree) { const e = entree; entree = null; depiler(e); }
    },
  };
}
