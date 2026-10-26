// Outils d'interface partagés : construction du DOM sans HTML en chaîne, icônes, toasts,
// surimpressions (fiche, feuilles), verdicts, pastilles, retour du téléphone.
import { CLES } from '../config.js';

// ---------- Construction du DOM ----------

// Attributs posés tels quels (en plus de aria-* et data-*). Jamais « style » ni HTML brut.
const ATTRIBUTS = new Set(['type', 'for', 'id', 'role', 'tabindex', 'placeholder', 'href', 'target', 'rel', 'src', 'alt',
  'title', 'name', 'min', 'max', 'step', 'autocomplete', 'autocapitalize', 'spellcheck', 'enterkeyhint', 'inputmode',
  'rows', 'maxlength', 'lang', 'readonly', 'width', 'height', 'loading', 'decoding', 'colspan', 'scope', 'aria-label',
  'datetime', 'pattern', 'required', 'size', 'accept', 'translate', 'dir']);
const PROPRIETES = new Set(['value', 'checked', 'disabled', 'hidden', 'open', 'selected', 'indeterminate']);

// Liens et images : seulement des adresses sûres (pas de « javascript: »).
const LIEN_SUR = /^(https:\/\/|#|\.\/|\.\.\/|mailto:|[a-z0-9_-]+(\/[a-z0-9_.-]+)*\.(html|json|svg|png)$)/i;
const IMAGE_SURE = /^(data:image\/svg\+xml;charset=utf-8,|data:image\/(png|jpeg|webp);base64,|\.\/|icons\/)/i;

export function h(tag, attrs, ...enfants) {
  const e = document.createElement(tag);
  const plus_tard = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') { const c = Array.isArray(v) ? v.filter(Boolean).join(' ') : v; if (c) e.className = c; }
    else if (k === 'text') e.textContent = String(v);
    else if (/^on[A-Za-z]+$/.test(k)) { if (typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v); }
    else if (PROPRIETES.has(k)) plus_tard.push([k, v]);
    else if (v === false) continue;
    else if (k.startsWith('aria-') || k.startsWith('data-') || ATTRIBUTS.has(k)) {
      if (k === 'href' && !LIEN_SUR.test(String(v))) continue;
      if (k === 'src' && !IMAGE_SURE.test(String(v))) continue;
      e.setAttribute(k, v === true ? '' : String(v));
    }
    // tout le reste (style, innerHTML…) est ignoré
  }
  ajouter(e, enfants);
  for (const [k, v] of plus_tard) e[k] = v;   // value d'un <select> après ses options
  return e;
}

function ajouter(parent, enfants) {
  for (const c of enfants.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = id => document.getElementById(id);

export function vider(noeud, ...enfants) {
  noeud.replaceChildren();
  ajouter(noeud, enfants);
  return noeud;
}

// ---------- Icônes (SVG construits nœud par nœud) ----------

const SVG = 'http://www.w3.org/2000/svg';
const ICONES = {
  ecg: [['path', 'M2 13h4l2-5 3 10 3-14 2.5 9H22']],
  casque: [['path', 'M4 15v-3a8 8 0 0 1 16 0v3'], ['rect', 4, 14, 4, 6, 1.5], ['rect', 16, 14, 4, 6, 1.5]],
  micro: [['rect', 9, 3, 6, 11, 3], ['path', 'M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7']],
  stop: [['rect', 7, 7, 10, 10, 1.5]],
  juste: [['path', 'M5 12.5l4.5 4.5L19 7.5']],
  faux: [['path', 'M6.5 6.5l11 11M17.5 6.5l-11 11']],
  partiel: [['circle', 12, 12, 8], ['path', 'M12 4a8 8 0 0 1 0 16z', 'plein']],
  haut: [['path', 'M12 19V5M6 11l6-6 6 6']],
  bas: [['path', 'M12 5v14M6 13l6 6 6-6']],
  fermer: [['path', 'M6 6l12 12M18 6L6 18']],
  fiche: [['path', 'M7 3h7l5 5v13H7z'], ['path', 'M14 3v5h5M10 13h6M10 17h6']],
  soleil: [['circle', 12, 12, 4], ['path', 'M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8']],
  qcm: [['rect', 4, 4, 5, 5, 1], ['rect', 4, 15, 5, 5, 1], ['path', 'M12 6.5h8M12 17.5h8M5.5 17.5l1 1 2-2.5']],
  suivi: [['path', 'M4 20V4M4 20h16'], ['path', 'M8 16v-4M12 16V8M16 16v-6']],
  reglages: [['circle', 12, 12, 3], ['path', 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1']],
  boucle: [['path', 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3'], ['path', 'M18 3v4h-4M6 21v-4h4']],
  etoile: [['path', 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z']],
  pause: [['path', 'M9 5v14M15 5v14']],
  lecture: [['path', 'M8 5l11 7-11 7z']],
  oeil: [['path', 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'], ['circle', 12, 12, 3]],
  coller: [['rect', 6, 4, 12, 17, 2], ['path', 'M9 4V3h6v1M9 10h6M9 14h6']],
  lien: [['path', 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6']],
  info: [['circle', 12, 12, 9], ['path', 'M12 11v6M12 7.5v.5']],
  attention: [['path', 'M12 3l10 18H2z'], ['path', 'M12 10v5M12 18v.5']],
  nuage: [['path', 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z']],
};

export function icone(nom, { classe = '' } = {}) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', ['icone', classe].filter(Boolean).join(' '));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const [type, ...a] of ICONES[nom] || []) {
    const el = document.createElementNS(SVG, type);
    if (type === 'path') { el.setAttribute('d', a[0]); if (a[1] === 'plein') el.setAttribute('class', 'plein'); }
    else if (type === 'circle') { el.setAttribute('cx', a[0]); el.setAttribute('cy', a[1]); el.setAttribute('r', a[2]); }
    else if (type === 'rect') {
      el.setAttribute('x', a[0]); el.setAttribute('y', a[1]); el.setAttribute('width', a[2]); el.setAttribute('height', a[3]);
      if (a[4]) el.setAttribute('rx', a[4]);
    }
    s.append(el);
  }
  return s;
}

// ---------- Boutons ----------

export function bouton(libelle, { principal = false, discret = false, onClick, icone: ic, classe = '', type = 'button', attrs = {} } = {}) {
  return h('button', {
    type, class: ['btn', principal && 'btn--principal', discret && 'btn--discret', classe],
    onclick: onClick, ...attrs,
  }, ic ? icone(ic) : null, h('span', { class: 'btn__texte', text: libelle }));
}

// Change le libellé d'un bouton créé par bouton().
export function libeller(btn, texte) {
  const s = btn.querySelector('.btn__texte');
  if (s) s.textContent = texte; else btn.textContent = texte;
}

// Bouton à confirmer par un second appui (3 s pour confirmer).
// `confirmation` : texte, ou fonction qui le calcule au moment de l'appui.
export function boutonConfirme(libelle, confirmation, onConfirme, options = {}) {
  let arme = null;
  const b = bouton(libelle, {
    ...options,
    onClick: () => {
      if (arme) { clearTimeout(arme); arme = null; b.classList.remove('arme'); libeller(b, libelle); onConfirme(); return; }
      const texte = typeof confirmation === 'function' ? confirmation() : confirmation;
      b.classList.add('arme');
      libeller(b, texte);
      annoncer(texte);
      arme = setTimeout(() => { arme = null; b.classList.remove('arme'); libeller(b, libelle); }, 3000);
    },
  });
  b.armer = () => { if (!arme) b.click(); };
  return b;
}

// ---------- Messages ----------

let minuterieToast = null;
export function toast(message, { duree = 4000 } = {}) {
  const t = $('toast');
  if (!t) return;
  t.textContent = message;
  // Sous la barre de séance (« Terminer · Carte n sur N ») quand elle est là : elle ne doit pas être cachée.
  // Position posée par le CSSOM (autorisé par la CSP) ; sinon, celle de la feuille de style.
  const sous = $('sous-entete');
  const bas = sous?.childElementCount && !document.documentElement.classList.contains('sans-entete') ? sous.getBoundingClientRect().bottom : 0;
  t.style.top = bas > 0 ? `${Math.round(bas + 8)}px` : '';
  t.hidden = false;
  t.classList.add('visible');
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { t.classList.remove('visible'); t.hidden = true; t.textContent = ''; }, duree);
}

// Annonce pour les lecteurs d'écran seulement.
export function annoncer(message) {
  const a = $('annonce');
  if (!a) return;
  a.textContent = '';
  setTimeout(() => { a.textContent = message; }, 30);
}

// Bandeau qui reste (erreur qui demande d'agir) : texte et bouton facultatif.
export function bandeau(texte, { type = 'info', action = null, titre = null } = {}) {
  return h('div', { class: ['bandeau', `bandeau--${type}`], role: type === 'erreur' ? 'alert' : null },
    icone(type === 'reussite' ? 'juste' : type === 'erreur' ? 'attention' : type === 'horsligne' ? 'nuage' : 'info'),
    h('div', { class: 'bandeau__corps' }, titre ? h('strong', { text: titre }) : null, h('p', { text: texte }), action));
}

// ---------- Nombres et mots ----------

// « 1 carte », « 3 cartes » (0 et 1 au singulier, comme en français).
export function nb(n, mot, motPluriel) { return `${n} ${Math.abs(n) >= 2 ? (motPluriel || mot + 's') : mot}`; }
export const virgule = x => String(Math.round((Number(x) || 0) * 100) / 100).replace('.', ',');
export function points(x) { const v = Math.round((Number(x) || 0) * 100) / 100; return `${virgule(v)} point${v >= 2 ? 's' : ''}`; }

// Objectif du jour (objectifDuJour) : ce qui manque, « encore 12 cartes (dont 5 révisions) ».
export function texteEncore(jour) {
  return `encore ${nb(jour.encore, 'carte')}${jour.encoreRevisions ? ` (dont ${nb(jour.encoreRevisions, 'révision')})` : ''}`;
}
// Objectif atteint : même phrase sur Aujourd'hui et en séance (atteint aussi quand il ne reste rien à compter).
export function texteAtteint(jour) {
  return jour.cartes >= jour.objectif ? `Objectif du jour atteint : ${nb(jour.cartes, 'carte')} aujourd'hui. Tu peux t'arrêter ou continuer.`
    : "Objectif du jour atteint : toutes tes cartes du jour sont faites. Tu peux t'arrêter ou continuer.";
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// 'AAAA-MM-JJ' → « lundi 12 octobre » (ou « lun. 12 » en court).
export function dateFr(jour, court = false) {
  const [y, m, d] = jour.split('-').map(Number);
  const j = JOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return court ? `${j.slice(0, 3)}. ${d}` : `${j} ${d === 1 ? '1er' : d} ${MOIS[m - 1]}`;
}

// ---------- Stockage de l'appareil (localStorage, toujours protégé) ----------

export function lireLocal(cle, defaut = null) {
  try { const v = localStorage.getItem(cle); return v == null ? defaut : v; } catch { return defaut; }
}
export function ecrireLocal(cle, valeur) {
  try { if (valeur == null || valeur === '') localStorage.removeItem(cle); else localStorage.setItem(cle, String(valeur)); return true; } catch { return false; }
}
export function lireJson(cle, defaut = null) {
  try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; }
}

// Aides montrées un nombre limité de fois (mémorisées sur l'appareil).
export function aideVue(nom, fois = 1) {
  const n = Number(lireLocal(`rappel.aide.${nom}`, '0')) || 0;
  return n >= fois;
}
export function compterAide(nom) {
  const n = Number(lireLocal(`rappel.aide.${nom}`, '0')) || 0;
  ecrireLocal(`rappel.aide.${nom}`, n + 1);
}
export function oublierAides() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('rappel.aide.')) localStorage.removeItem(k); } catch { /* rien */ }
}

export { CLES };

// ---------- Retour du téléphone (historique) ----------

// Chaque surimpression ou écran plein ajoute une entrée ; « Retour » appelle sa fonction de fermeture.
const pile = [];
const enAttente = [];   // empilées pendant un retour pas encore fait (history.back() est asynchrone)
let popsIgnores = 0;
let pileBranchee = false;

function pousser() {
  try { history.pushState({ rappel: pile.length }, ''); } catch { /* rien */ }
}

function brancherPile() {
  if (pileBranchee) return;
  pileBranchee = true;
  window.addEventListener('popstate', () => {
    if (popsIgnores > 0) {
      popsIgnores--;
      // Retour fait : les entrées empilées entre-temps (séance → séance) ont enfin leur place.
      if (!popsIgnores) for (const _ of enAttente.splice(0)) pousser();
      return;
    }
    const entree = pile.pop();
    if (entree) entree.fermer({ parRetour: true });
  });
}

export function empiler(fermer) {
  brancherPile();
  const entree = { fermer };
  pile.push(entree);
  // Un pushState avant la fin d'un history.back() serait défait par ce retour : il attend.
  if (popsIgnores > 0) enAttente.push(entree); else pousser();
  return entree;
}

// Fermeture par un bouton de l'appli : on retire aussi l'entrée d'historique.
export function depiler(entree) {
  const i = pile.lastIndexOf(entree);
  if (i < 0) return;
  pile.splice(i, 1);
  const j = enAttente.indexOf(entree);
  if (j >= 0) { enAttente.splice(j, 1); return; }   // pas encore d'entrée d'historique
  popsIgnores++;
  try { history.back(); } catch { popsIgnores--; }
}

// ---------- Surimpressions (fiche, feuilles d'explication) ----------

const FOCUSABLES = 'a[href], button:not([disabled]), textarea, input, select, details > summary, [tabindex]:not([tabindex="-1"])';

// Feuille plein écran (ou en bas) : titre, contenu, bouton « Fermer » collé en bas.
export function ouvrirFeuille({ titre, surtitre = '', contenu, classe = '', libelleFermer = 'Fermer', actions = null }) {
  const racine = $('surimpression');
  const origine = document.activeElement;
  let entree = null;
  const fermer = ({ parRetour = false } = {}) => {
    document.removeEventListener('keydown', clavier, true);
    racine.hidden = true;
    racine.replaceChildren();
    document.documentElement.classList.remove('sans-defilement');
    if (!parRetour && entree) depiler(entree);
    entree = null;
    try { origine?.focus?.({ preventScroll: true }); } catch { /* rien */ }
  };
  const idTitre = 'feuille-titre';
  const feuille = h('div', { class: ['feuille', classe], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitre },
    h('div', { class: 'feuille__haut' },
      h('div', { class: 'feuille__titres' },
        surtitre ? h('p', { class: 'surtitre', text: surtitre }) : null,
        h('h2', { class: 'feuille__titre', id: idTitre, text: titre, tabindex: '-1' })),
      h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fermer', onclick: () => fermer() }, icone('fermer'))),
    h('div', { class: 'feuille__corps' }, contenu),
    h('div', { class: 'feuille__bas' }, actions, bouton(libelleFermer, { principal: !actions, onClick: () => fermer() })));
  const clavier = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); return; }
    if (e.key === 'Tab') {
      const f = [...feuille.querySelectorAll(FOCUSABLES)].filter(x => !x.closest('[hidden]'));
      if (!f.length) return;
      const premier = f[0], dernier = f[f.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    }
  };
  vider(racine, feuille);
  racine.hidden = false;
  document.documentElement.classList.add('sans-defilement');
  document.addEventListener('keydown', clavier, true);
  entree = empiler(fermer);
  feuille.querySelector('.feuille__corps').scrollTop = 0;
  feuille.querySelector(`#${idTitre}`).focus({ preventScroll: true });
  return { fermer, feuille };
}

// ---------- Micro-fiches (identité des pages de micro-fiches) ----------

// « CM6 · Artères et veines » → {label: 'CM6', nom: 'Artères et veines'}
export function decouperTitre(titre = '') {
  const i = titre.indexOf(' · ');
  return i < 0 ? { label: '', nom: titre } : { label: titre.slice(0, i), nom: titre.slice(i + 3) };
}

function blocNoeud(b) {
  switch (b?.k) {
    case 'h': return h('h3', { class: 'sub', text: b.t });
    case 'p': return h('p', { text: b.t });
    case 'pin': return h('div', { class: 'pin' }, h('h3', { text: b.title }), h('ul', null, (b.lines || []).map(l => h('li', { text: l }))));
    case 'nums': return h('div', { class: 'nums' }, (b.items || []).map(n => h('div', { class: 'num' }, h('b', { text: n.v }), h('span', { text: n.l }))));
    case 'table': return h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Tableau' },
      h('table', null,
        h('thead', null, h('tr', null, (b.head || []).map(x => h('th', { scope: 'col', text: x })))),
        h('tbody', null, (b.rows || []).map(r => h('tr', null, r.map(c => h('td', { class: c?.s === 'key' || c?.s === 'ok' ? c.s : null, text: c?.t ?? '' })))))));
    default: return null;
  }
}

export function ficheNoeud(fiche, { avecTitre = true } = {}) {
  const { label, nom } = decouperTitre(fiche?.title || '');
  return h('section', { class: 'fiche' },
    avecTitre ? h('header', null,
      label ? h('p', { class: 'eyebrow', text: label }) : null,
      h('h2', { text: nom || fiche?.id || 'Micro-fiche' }),
      fiche?.why ? h('p', { class: 'why', text: fiche.why }) : null) : null,
    (fiche?.blocks || []).map(blocNoeud));
}

export function ouvrirFiche(fiche) {
  if (!fiche) return null;
  const { label, nom } = decouperTitre(fiche.title || '');
  return ouvrirFeuille({
    titre: nom || 'Micro-fiche', surtitre: label ? `Micro-fiche · ${label}` : 'Micro-fiche', classe: 'feuille--fiche',
    contenu: [fiche.why ? h('p', { class: 'why', text: fiche.why }) : null, ficheNoeud(fiche, { avecTitre: false })],
  });
}

// Titre court d'une fiche pour un lien : « Artères et veines ».
export const titreFiche = f => decouperTitre(f?.title || '').nom || f?.id || '';

// ---------- Verdicts ----------

export const VERDICTS = {
  juste: { mot: 'Juste', icone: 'juste' },
  partiel: { mot: 'Partiel', icone: 'partiel' },
  faux: { mot: 'Faux', icone: 'faux' },
};

export const BADGES = {
  gemini: 'Corrigé par Gemini',
  local: "Corrigé sur l'appareil",
  'hors-ligne': 'Corrigé hors ligne',
  exact: 'Reconnu : réponse attendue',
  carnet: 'Reconnu (déjà accepté)',
  auto: 'Noté par toi',
  qcm: 'QCM des cartes',
  contestation: 'Corrigé après un second avis',
  'je-ne-sais-pas': '',
};

// Bandeau du verdict : icône + mot (jamais la couleur seule) et lignes d'information.
export function verdictNoeud(resultat, { lignes = [], titre = null } = {}) {
  const v = VERDICTS[resultat?.verdict] || VERDICTS.faux;
  const nsp = resultat?.correcteur === 'je-ne-sais-pas';
  return h('div', { class: ['verdict', `verdict--${nsp ? 'nsp' : resultat?.verdict || 'faux'}`], tabindex: '-1' },
    h('div', { class: 'verdict__tete' }, icone(nsp ? 'fiche' : v.icone, { classe: 'verdict__icone' }),
      h('h2', { class: 'verdict__mot', text: titre || (nsp ? 'Voici la réponse' : v.mot) })),
    lignes.filter(Boolean).map(l => (l instanceof Node ? l : h('p', { class: 'verdict__ligne', text: l }))));
}

// ---------- Pastilles (choix d'un paquet) ----------

export function pastilles(options, actif, onChoix, { etiquette = 'Paquets' } = {}) {
  const groupe = h('div', { class: 'pastilles', role: 'group', 'aria-label': etiquette });
  for (const o of options) {
    const choisie = o.id === actif;
    groupe.append(h('button', {
      type: 'button', class: ['pastille', choisie && 'pastille--active'], 'aria-pressed': choisie ? 'true' : 'false',
      onclick: () => onChoix(o.id),
    }, choisie ? icone('juste') : null, h('span', { text: o.libelle }), o.n != null ? h('span', { class: 'pastille__n', text: String(o.n) }) : null));
  }
  return groupe;
}

// ---------- Divers ----------

// Champ texte masqué (clé, jeton) avec bouton « Afficher ».
export function champSecret({ id, libelle, valeur = '', placeholder = '', aide = null }) {
  const input = h('input', { id, type: 'password', class: 'champ-texte', value: valeur, placeholder, autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', inputmode: 'text' });
  const oeil = h('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Afficher', 'aria-pressed': 'false',
    onclick: () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      oeil.setAttribute('aria-pressed', visible ? 'true' : 'false');
      oeil.setAttribute('aria-label', visible ? 'Masquer' : 'Afficher');
    } }, icone('oeil'));
  const peutColler = !!navigator.clipboard?.readText;
  const coller = peutColler ? h('button', { type: 'button', class: 'btn btn--petit', onclick: async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (t) { input.value = t; input.dispatchEvent(new Event('input')); } } catch { coller.hidden = true; }
  } }, h('span', { class: 'btn__texte', text: 'Coller' })) : null;
  const bloc = h('div', { class: 'champ' },
    h('label', { for: id, class: 'champ__libelle', text: libelle }),
    h('div', { class: 'champ__ligne' }, input, oeil, coller),
    aide ? h('p', { class: 'aide', text: aide }) : null);
  return { bloc, input };
}

// Image d'une carte (schéma SVG) : toujours en <img>, jamais injecté dans la page.
export function imageSvg(svg, alt = 'Schéma de la carte') {
  if (!svg || typeof svg !== 'string') return null;
  const img = h('img', { class: 'schema', alt, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), decoding: 'async' });
  return h('button', { type: 'button', class: 'schema-bouton', 'aria-label': 'Agrandir le schéma',
    onclick: e => e.currentTarget.classList.toggle('agrandi') }, img);
}

export const estTactile = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
