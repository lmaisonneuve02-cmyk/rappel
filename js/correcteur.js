// Correction sur l'appareil, sans réseau. Une carte = des idées (barème, ou déduites de la
// réponse attendue comme dans v1). Chaque idée est cherchée dans la réponse avec la mesure de v1 :
// racines pondérées par leur rareté (idf), tolérance aux fautes, abréviations, synonymes,
// garde-fous hypo/hyper et tachy/brady, nombres exacts. S'y ajoutent les pièges du barème
// et les contresens (gauche/droite, augmente/diminue…). Module pur.
import { norm, analyze, hasStem, ANTS, splitRef, clozeAnswers, refText, normaliser } from './texte.js';

const CONFIANCE_LOCALE = 0.6;

// --- Outils ------------------------------------------------------------------------------

const texteDe = x => (typeof x === 'string' ? x.trim() : '');
const estObjet = x => !!x && typeof x === 'object' && !Array.isArray(x);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// Textes non vides, sans doublon (après normaliser), sans ceux de `exclus`.
function textesUniques(liste, exclus = []) {
  const vus = new Set(exclus.map(normaliser));
  const out = [];
  for (const x of liste) {
    const t = texteDe(x);
    const k = normaliser(t);
    if (!k || vus.has(k)) continue;
    vus.add(k);
    out.push(t);
  }
  return out;
}

// Expression (un ou plusieurs mots entiers) présente dans un texte déjà passé par norm et
// entouré d'espaces.
function contient(entoure, expression) {
  const e = norm(expression);
  return !!e && entoure.includes(` ${e} `);
}

// --- Idées d'une carte -------------------------------------------------------------------

export function ideesDe(carte) {
  if (!carte) return [];
  if (carte.type === 'cloze') return ideesTrous(carte);
  const bareme = estObjet(carte.bareme) && Array.isArray(carte.bareme.idees) ? carte.bareme.idees : [];
  const idees = [];
  bareme.filter(estObjet).forEach((i, n) => {
    const formulations = Array.isArray(i.formulations) ? textesUniques(i.formulations, [texteDe(i.texte)]) : [];
    const texte = texteDe(i.texte) || formulations.shift() || '';
    if (!texte) return;
    idees.push({ id: texteDe(String(i.id ?? '')) || `k${n + 1}`, texte, formulations, obligatoire: i.obligatoire !== false });
  });
  return idees.length ? idees : ideesDeduites(carte);
}

// Texte à trous : un trou = une idée obligatoire ; le barème peut donner ses formulations
// (identifiants t1, t2… ; à défaut, dans l'ordre des trous).
function ideesTrous(carte) {
  const bareme = estObjet(carte.bareme) && Array.isArray(carte.bareme.idees) ? carte.bareme.idees.filter(estObjet) : [];
  const parId = bareme.some(i => /^t\d+$/.test(String(i.id)));
  return clozeAnswers(carte.q || '').map((reponse, n) => {
    const id = `t${n + 1}`;
    const b = parId ? bareme.find(i => String(i.id) === id) : bareme[n];
    const autres = b ? [texteDe(b.texte), ...(Array.isArray(b.formulations) ? b.formulations : [])] : [];
    return { id, texte: reponse.trim(), formulations: textesUniques(autres, [reponse]), obligatoire: true };
  });
}

// Sans barème : découpage de la réponse attendue (elementsOf de v1). Les mots de la question
// ne comptent pas ; les éléments facultatifs (« parfois », parenthèses…) ne sont pas obligatoires.
function ideesDeduites(carte, avecQuestion = true) {
  const Q = avecQuestion ? analyze(carte.q || '') : null;
  const vues = new Set();
  const elements = [];
  for (const p of splitRef(carte)) {
    const an = analyze(p.text);
    let racines = an.arr;
    if (Q) {
      const gardees = racines.filter(s => !Q.set.has(s));
      if (gardees.length) racines = gardees;
      else if (!an.nums.size) continue;
    }
    if (!racines.length && !an.nums.size) continue;
    const cle = racines.join(' ') + '#' + [...an.nums].join(',');
    if (vues.has(cle)) continue;
    vues.add(cle);
    elements.push({ texte: p.text, facultatif: !!p.opt, etiquette: !!p.label, racines });
  }
  // Une étiquette (« Mécanisme : … ») part si le corps de la réponse en reprend déjà les mots.
  const corps = new Set(elements.filter(e => !e.etiquette).flatMap(e => e.racines));
  const B = { set: corps, arr: [...corps] };
  const gardes = elements.filter(e => !(e.etiquette && e.racines.length && e.racines.every(s => hasStem(B, s))));
  if (!gardes.some(e => !e.facultatif)) gardes.forEach(e => { e.facultatif = false; });
  // Réponse entièrement faite de mots de la question (« systolique ou diastolique ? ») :
  // on garde ses mots plutôt que de tout accepter.
  if (!gardes.length && avecQuestion) return ideesDeduites(carte, false);
  return gardes.map((e, n) => ({ id: `e${n + 1}`, texte: e.texte, formulations: [], obligatoire: !e.facultatif }));
}

// --- Mesure d'une phrase dans la réponse (gradeLocal de v1) --------------------------------

// Unités : facultatives dans une phrase qui contient un nombre (« 140 » vaut « 140 mmHg »).
const UNITES = ['mmhg', 'mm', 'cm', 'm', 'ml', 'l', 'mg', 'g', 'kg', 's', 'ms', 'min', 'h', 'j', 'jours', 'ans',
  'pourcent', 'bpm', 'cmh2o', 'kpa', 'mmol', 'meq', 'ui'];
const RE_UNITES = new RegExp(`(?<!\\p{L})(?:${UNITES.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

// Racines de la phrase hors mots de la question (toutes si elle n'a que des mots de la question).
function analyserPhrase(texte, Q, abreviations) {
  const brut = analyze(texte, abreviations);
  const an = brut.nums.size ? analyze(texte.replace(RE_UNITES, ' '), abreviations) : brut;
  let racines = an.arr;
  if (Q) {
    const gardees = racines.filter(s => !Q.set.has(s));
    if (gardees.length) racines = gardees;
  }
  // Phrase faite seulement de mots vides (« Type ») : cherchée telle quelle, en mot entier.
  const litteral = !racines.length && !an.nums.size && norm(texte) ? texte : null;
  return { texte, racines, nombres: [...an.nums], mots: an.words, paires: an.pairs, litteral };
}

function phraseTrouvee(P, A, idf, entoure) {
  if (P.litteral) return contient(entoure, P.litteral);
  const jointes = new Set();
  for (const [a, b, j] of P.paires) if (A.set.has(j)) { jointes.add(a); jointes.add(b); }
  const total = P.racines.reduce((s, x) => s + idf(x), 0) || 1;
  const touche = P.racines.reduce((s, x) => s + (jointes.has(x) || hasStem(A, x) ? idf(x) : 0), 0);
  const score = P.racines.length ? touche / total : 1;
  const nombresOk = P.nombres.every(n => A.nums.has(n));
  const seuil = P.racines.length <= 1 ? 0.99 : P.racines.length <= 3 ? 0.6 : 0.5;
  return nombresOk && score >= seuil;
}

// Contresens (v1) : la réponse contient le contraire d'un mot attendu, et pas le mot attendu.
// Chaque mot contraire n'est signalé qu'une fois (`signales`), même s'il revient dans les formulations.
function contresens(idee, A, attendues, signales) {
  const out = [];
  for (const P of idee.phrases) {
    for (const s of P.racines) {
      const o = ANTS.get(s);
      if (o && !signales.has(o) && !attendues.has(o) && !hasStem(A, s) && A.set.has(o)) {
        signales.add(o);
        out.push(`Tu as écrit « ${A.words.get(o) || o} », la réponse attend « ${P.mots.get(s) || s} ».`);
      }
    }
  }
  return out;
}

// Nombre faux (v1) : un nombre attendu manque et la réponse en donne un autre.
function chiffreInexact(idee, A, permis) {
  if (!A.nums.size) return null;
  const P = idee.phrases.find(p => p.nombres.some(n => !A.nums.has(n)));
  if (!P) return null;
  const virgules = l => l.join(', ').replace(/\./g, ',');
  const manque = P.nombres.filter(n => !A.nums.has(n));
  const autres = [...A.nums].filter(n => !permis.has(n));
  if (!autres.length) return null;
  return `Chiffre inexact : la réponse attend ${virgules(manque)}, tu as écrit ${virgules(autres)}.`;
}

// Pièges du barème : « si » présent en mots entiers et « sauf » absent.
function piegesDeclenches(carte, reponse) {
  const pieges = estObjet(carte.bareme) && Array.isArray(carte.bareme.pieges) ? carte.bareme.pieges : [];
  const R = ` ${norm(reponse)} `;
  return pieges
    .filter(p => estObjet(p) && contient(R, p.si) && !(texteDe(p.sauf) && contient(R, p.sauf)))
    .map(p => texteDe(p.pourquoi) || `« ${texteDe(p.si)} » ne convient pas ici.`);
}

function expliquer(verdict, trouvees, total, erreurs, vide) {
  if (vide) return "Tu n'as rien écrit.";
  if (verdict === 'juste') return total > 1 ? `Tout y est : tu as donné les ${total} idées attendues.` : "C'est la bonne réponse.";
  if (verdict === 'partiel') {
    if (trouvees === total) return erreurs > 1 ? "L'essentiel y est, mais il y a des erreurs." : "L'essentiel y est, mais il y a une erreur.";
    return `Tu as donné ${pluriel(trouvees, 'idée')} sur ${total}${erreurs ? ', avec une erreur' : ''} : regarde ce qui manquait.`;
  }
  if (erreurs) return "Ta réponse contient une erreur et il manque l'essentiel.";
  return total > 1 ? 'Je ne retrouve aucune des idées attendues.' : "Je ne retrouve pas l'idée attendue.";
}

const resultat = (verdict, trouvees, manquantes, erreurs, confiance, explication, correcteur) =>
  ({ verdict, idees_trouvees: trouvees, idees_manquantes: manquantes, erreurs, confiance, explication, correcteur });

// --- API -----------------------------------------------------------------------------------

export function correspondanceDirecte(carte, reponse, carnetCarte) {
  const r = normaliser(reponse);
  if (!r || !carte) return null;
  const idees = ideesDe(carte).filter(i => i.obligatoire).map(i => i.texte);
  // Texte à trous : refText joint les trous par « · », que normaliser efface.
  if (r === normaliser(refText(carte))) {
    return resultat('juste', idees, [], [], 1, "C'est exactement la réponse attendue.", 'exact');
  }
  const acceptees = carnetCarte && Array.isArray(carnetCarte.acceptees) ? carnetCarte.acceptees : [];
  if (acceptees.some(x => normaliser(x) === r)) {
    return resultat('juste', idees, [], [], 0.95, 'Cette réponse a déjà été acceptée pour cette carte.', 'carnet');
  }
  return null;
}

export function corrigerLocal(carte, reponse, { idf, abreviations } = {}) {
  const poids = typeof idf === 'function' ? idf : () => 1;
  const texte = String(reponse ?? '');
  const A = analyze(texte, abreviations);
  const entoure = ` ${norm(texte)} `;
  // Comme v1 : pas de retrait des mots de la question pour un texte à trous (elle contient les réponses).
  const Q = carte.type === 'cloze' ? null : analyze(carte.q || '', abreviations);

  const idees = ideesDe(carte)
    .map(i => ({
      ...i,
      phrases: [i.texte, ...i.formulations]
        .map(t => analyserPhrase(t, Q, abreviations))
        .filter(P => P.racines.length || P.nombres.length || P.litteral),
    }))
    .filter(i => i.phrases.length);
  if (!idees.length) {
    return resultat('faux', [], [], [], 0, "Je ne peux pas corriger cette carte sur l'appareil : la réponse attendue est vide ou trop courte.", 'local');
  }
  // Barème sans idée obligatoire (donnée mal formée) : toutes comptent.
  const aucuneObligatoire = !idees.some(i => i.obligatoire);
  const obligatoire = i => aucuneObligatoire || i.obligatoire;

  const attendues = new Set(idees.filter(obligatoire).flatMap(i => i.phrases.flatMap(P => P.racines)));
  const permis = new Set([...idees.flatMap(i => i.phrases.flatMap(P => P.nombres)), ...(Q ? Q.nums : [])]);

  const trouvees = [], manquantes = [], erreurs = piegesDeclenches(carte, texte), signales = new Set();
  let total = 0, nTrouvees = 0;
  for (const i of idees) {
    const ok = i.phrases.some(P => phraseTrouvee(P, A, poids, entoure));
    if (obligatoire(i)) { total++; if (ok) nTrouvees++; }
    if (ok) { trouvees.push(i.texte); continue; }
    if (!obligatoire(i)) continue;
    manquantes.push(i.texte);
    erreurs.push(...contresens(i, A, attendues, signales));
    const e = chiffreInexact(i, A, permis);
    if (e) erreurs.push(e);
  }
  const uniques = [...new Set(erreurs)];
  const verdict = nTrouvees === total && !uniques.length ? 'juste' : nTrouvees > 0 ? 'partiel' : 'faux';
  const explication = expliquer(verdict, nTrouvees, total, uniques.length, !normaliser(texte));
  return resultat(verdict, trouvees, manquantes, uniques, CONFIANCE_LOCALE, explication, 'local');
}

// Contrôle d'un barème : messages en français, liste vide si tout va bien (ou sans barème).
export function verifierBareme(carte) {
  const m = [];
  const b = carte && carte.bareme;
  if (b == null) return m;
  if (!estObjet(b)) return ['barème : doit être un objet {idees, pieges}'];
  const trou = carte.type === 'cloze';
  const nTrous = trou ? clozeAnswers(carte.q || '').length : 0;
  if (trou && !nTrous) m.push('barème : la question ne contient aucun trou {{…}}');

  const idees = Array.isArray(b.idees) ? b.idees : [];
  if (!idees.length) m.push('barème : la liste « idees » est vide ou absente');
  const ids = new Set();
  const phrasesObligatoires = [];
  idees.forEach((i, n) => {
    const nom = `idée ${estObjet(i) && texteDe(String(i.id ?? '')) ? i.id : n + 1}`;
    if (!estObjet(i)) { m.push(`barème, ${nom} : doit être un objet`); return; }
    const id = typeof i.id === 'string' ? i.id.trim() : '';
    if (!id) m.push(`barème, ${nom} : identifiant « id » manquant`);
    else if (ids.has(id)) m.push(`barème, ${nom} : identifiant en double`);
    else ids.add(id);
    if (trou) {
      const k = /^t(\d+)$/.exec(id);
      if (id && (!k || +k[1] < 1 || +k[1] > nTrous)) m.push(`barème, ${nom} : pour un texte à trous, les identifiants vont de t1 à t${nTrous}`);
      if (i.texte != null && typeof i.texte !== 'string') m.push(`barème, ${nom} : « texte » doit être un texte`);
      if (i.obligatoire === false) m.push(`barème, ${nom} : chaque trou est une idée obligatoire`);
    } else if (!texteDe(i.texte)) {
      m.push(`barème, ${nom} : « texte » manquant`);
    }
    let formulations = [];
    if (!Array.isArray(i.formulations)) {
      m.push(`barème, ${nom} : « formulations » doit être une liste`);
    } else {
      const vues = new Set();
      for (const f of i.formulations) {
        const k = typeof f === 'string' ? normaliser(f) : '';
        if (!k) { m.push(`barème, ${nom} : formulation vide ou qui n'est pas un texte`); continue; }
        if (vues.has(k)) { m.push(`barème, ${nom} : formulation en double « ${f} »`); continue; }
        vues.add(k);
        formulations.push(f);
      }
      if (formulations.length < 2) m.push(`barème, ${nom} : il faut au moins 2 formulations (${formulations.length} ici)`);
    }
    if (typeof i.obligatoire !== 'boolean') m.push(`barème, ${nom} : « obligatoire » doit valoir true ou false`);
    const phrases = [texteDe(i.texte), ...formulations].filter(Boolean);
    const lisible = phrases.some(t => { const an = analyze(t); return an.arr.length || an.nums.size; });
    if (phrases.length && !lisible) m.push(`barème, ${nom} : aucun mot reconnaissable`);
    if (i.obligatoire !== false) phrasesObligatoires.push(...phrases);
  });
  if (!trou && idees.length && !idees.some(i => estObjet(i) && i.obligatoire === true)) m.push('barème : aucune idée obligatoire');

  if (b.pieges != null && !Array.isArray(b.pieges)) m.push('barème : « pieges » doit être une liste');
  const pieges = Array.isArray(b.pieges) ? b.pieges : [];
  pieges.forEach((p, n) => {
    const nom = `piège ${n + 1}`;
    if (!estObjet(p)) { m.push(`barème, ${nom} : doit être un objet {si, sauf, pourquoi}`); return; }
    const siOk = typeof p.si === 'string' && !!norm(p.si);
    if (!siOk) m.push(`barème, ${nom} : « si » manquant`);
    // « sauf » vide = pas d'exception.
    if (p.sauf != null && typeof p.sauf !== 'string') m.push(`barème, ${nom} : « sauf » doit être un texte (vide s'il n'y a pas d'exception)`);
    else if (typeof p.sauf === 'string' && p.sauf.trim() && !norm(p.sauf)) m.push(`barème, ${nom} : « sauf » ne contient aucun mot`);
    if (!texteDe(p.pourquoi)) m.push(`barème, ${nom} : « pourquoi » manquant (c'est le message montré en cas d'erreur)`);
    if (!siOk) return;
    // Un piège ne doit pas refuser la réponse attendue ni une formulation correcte.
    const sauf = typeof p.sauf === 'string' ? p.sauf : '';
    for (const t of [refText(carte), ...phrasesObligatoires]) {
      const R = ` ${norm(t)} `;
      if (contient(R, p.si) && !(sauf && contient(R, sauf))) {
        m.push(`barème, piège « ${p.si} » : se déclenche sur « ${t} »`);
        break;
      }
    }
  });
  return m;
}
