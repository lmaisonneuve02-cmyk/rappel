#!/usr/bin/env node
// Contrôle des données d'un dossier rappel/ (dépôt etudes) : schémas, identifiants, barèmes,
// micro-fiches, QCM et plan. Ne modifie rien.
// Usage : node outils/verifier-donnees.mjs <dossier rappel> [--exiger-baremes] [--json]
// Code de sortie : 0 sans erreur, 1 s'il y a des erreurs, 2 si la commande est mal écrite.
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { refText, clozeAnswers, creerIdf } from '../js/texte.js';
import { corrigerLocal, verifierBareme } from '../js/correcteur.js';

const TYPES_CARTE = ['fait', 'cloze', 'raisonnement'];
const SOURCES_QCM = ['annale', 'claude', 'gemini'];
const STATUTS_QCM = ['valide', 'brouillon', 'signale'];
const LETTRES = ['A', 'B', 'C', 'D', 'E'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DETAILS = 20;
export const SANS_BAREME = 'pas de barème : la correction de l\'appareil déduit les idées de la réponse attendue';

const USAGE = `Usage : node outils/verifier-donnees.mjs <dossier rappel> [--exiger-baremes] [--json]
  --exiger-baremes  une carte sans barème est une erreur (sinon un avertissement)
  --json            rapport au format JSON {erreurs, avertissements, stats}`;

const estObjet = x => !!x && typeof x === 'object' && !Array.isArray(x);
const nonVide = x => typeof x === 'string' && x.trim() !== '';
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// --- Lecture -------------------------------------------------------------------------------

async function lireJson(dossier, chemin, note) {
  let texte;
  try { texte = await readFile(join(dossier, chemin), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return undefined;
    note.erreur(chemin, null, `lecture impossible : ${e.message}`);
    return undefined;
  }
  try { return JSON.parse(texte); }
  catch (e) { note.erreur(chemin, null, `JSON illisible : ${e.message}`); return undefined; }
}

async function listerJson(dossier, sous) {
  try {
    return (await readdir(join(dossier, sous), { withFileTypes: true }))
      .filter(e => e.isFile() && e.name.endsWith('.json'))
      .map(e => e.name)
      .sort();
  } catch { return []; }
}

function creerNotes() {
  const erreurs = [], avertissements = [];
  const entree = (fichier, carte, message) => (carte ? { fichier, carte, message } : { fichier, message });
  return {
    erreurs, avertissements,
    erreur: (fichier, carte, message) => erreurs.push(entree(fichier, carte, message)),
    avertir: (fichier, carte, message) => avertissements.push(entree(fichier, carte, message)),
  };
}

// --- Micro-fiches --------------------------------------------------------------------------

function verifierFiche(f, fichier, id, note) {
  const err = m => note.erreur(fichier, null, m);
  if (!estObjet(f)) { err('la micro-fiche doit être un objet'); return; }
  if (f.id !== id) err(`identifiant « ${f.id} » différent du nom du fichier (${id})`);
  if (!nonVide(f.title)) err('titre « title » manquant');
  if (typeof f.why !== 'string') err('« why » doit être un texte');
  if (!Number.isFinite(f.order)) err('« order » doit être un nombre');
  if (!Array.isArray(f.blocks) || !f.blocks.length) { err('« blocks » doit être une liste non vide'); return; }
  const texte = x => typeof x === 'string' || typeof x === 'number';
  f.blocks.forEach((b, n) => {
    const nom = `bloc ${n + 1}`;
    if (!estObjet(b)) { err(`${nom} : doit être un objet`); return; }
    switch (b.k) {
      case 'h': case 'p':
        if (!nonVide(b.t)) err(`${nom} (${b.k}) : texte « t » manquant`);
        break;
      case 'pin':
        if (b.title != null && typeof b.title !== 'string') err(`${nom} (pin) : « title » doit être un texte`);
        if (!Array.isArray(b.lines) || !b.lines.length || !b.lines.every(nonVide)) err(`${nom} (pin) : « lines » doit être une liste de textes`);
        break;
      case 'nums':
        if (!Array.isArray(b.items) || !b.items.length || !b.items.every(i => estObjet(i) && texte(i.v) && nonVide(i.l))) {
          err(`${nom} (nums) : « items » doit être une liste de {v, l}`);
        }
        break;
      case 'table': {
        if (!Array.isArray(b.head) || !b.head.every(h => typeof h === 'string')) err(`${nom} (table) : « head » doit être une liste de textes`);
        if (!Array.isArray(b.rows) || !b.rows.length) { err(`${nom} (table) : « rows » doit être une liste non vide`); break; }
        b.rows.forEach((r, i) => {
          if (!Array.isArray(r) || !r.every(c => estObjet(c) && texte(c.t) && (c.s == null || typeof c.s === 'string'))) {
            err(`${nom} (table), ligne ${i + 1} : chaque cellule doit être {t, s?}`);
          } else if (Array.isArray(b.head) && r.length !== b.head.length) {
            note.avertir(fichier, null, `${nom} (table), ligne ${i + 1} : ${pluriel(r.length, 'cellule')} pour ${pluriel(b.head.length, 'colonne')}`);
          }
        });
        break;
      }
      default:
        err(`${nom} : type « ${b.k} » inconnu (h, p, pin, nums ou table)`);
    }
  });
}

// --- Paquets et cartes ---------------------------------------------------------------------

function verifierEntetePaquet(p, fichier, id, note) {
  const err = m => note.erreur(fichier, null, m);
  if (!estObjet(p)) { err('le paquet doit être un objet'); return false; }
  if (p.id !== id) err(`identifiant « ${p.id} » différent du nom du fichier (${id})`);
  if (!nonVide(p.nom)) err('nom « nom » manquant');
  if (!nonVide(p.ue)) err('UE « ue » manquante');
  if (p.ordre != null && !Number.isFinite(p.ordre)) err('« ordre » doit être un nombre');
  if (p.source != null && typeof p.source !== 'string') err('« source » doit être un texte');
  if (!Array.isArray(p.cartes) || !p.cartes.length) { err('« cartes » doit être une liste non vide'); return false; }
  return true;
}

function verifierCarte(c, n, fichier, ctx) {
  const { note } = ctx;
  const id = estObjet(c) && nonVide(c.id) ? c.id : null;
  const nom = id || `carte n° ${n + 1}`;
  const err = m => note.erreur(fichier, nom, m);
  const avert = m => note.avertir(fichier, nom, m);
  if (!estObjet(c)) { err('la carte doit être un objet'); return { avecBareme: false }; }

  if (!id) err('identifiant « id » manquant');
  else if (ctx.ids.has(id)) err(`identifiant en double (déjà dans ${ctx.ids.get(id)})`);
  else ctx.ids.set(id, fichier);

  if (!TYPES_CARTE.includes(c.type)) err(`type « ${c.type} » inconnu (fait, cloze ou raisonnement)`);
  if (!nonVide(c.q)) err('question « q » manquante');
  const trous = c.type === 'cloze' && nonVide(c.q) ? clozeAnswers(c.q).length : 0;
  if (c.type === 'cloze') {
    if (nonVide(c.q) && !trous) err('texte à trous sans trou {{…}} dans la question');
    if (c.a != null) avert('« a » est ignoré pour un texte à trous');
  } else {
    if (!nonVide(c.a)) err('réponse attendue « a » manquante');
    if (nonVide(c.q) && /\{\{.+?\}\}/.test(c.q)) avert('la question contient des {{…}} mais la carte n\'est pas un texte à trous');
  }

  if (c.fiche != null) {
    if (!nonVide(c.fiche)) err('« fiche » doit être un identifiant de micro-fiche');
    else if (!ctx.fiches.has(c.fiche)) {
      // Regroupé par fiche absente (un seul avertissement par paquet et par fiche).
      const cle = `${fichier}\n${c.fiche}`;
      if (!ctx.fichesAbsentes.has(cle)) ctx.fichesAbsentes.set(cle, { fichier, fiche: c.fiche, cartes: [] });
      ctx.fichesAbsentes.get(cle).cartes.push(nom);
    }
  }
  if (c.svg != null) {
    if (typeof c.svg !== 'string') err('« svg » doit être un texte');
    else if (!/^\s*<svg[\s>]/.test(c.svg)) avert('« svg » ne commence pas par <svg');
  }

  const avecBareme = c.bareme != null;
  if (avecBareme) for (const m of verifierBareme(c)) err(m);
  else if (ctx.exigerBaremes) err('pas de barème');
  else avert(SANS_BAREME);

  // Exigence centrale : la réponse attendue doit être jugée juste par la correction de l'appareil.
  const corrigeable = nonVide(c.q) && (c.type === 'cloze' ? trous > 0 : nonVide(c.a));
  if (corrigeable) {
    const r = corrigerLocal(c, refText(c), { idf: ctx.idf });
    if (r.verdict !== 'juste') {
      const details = [];
      if (r.idees_manquantes.length) details.push(`il manque : ${r.idees_manquantes.map(t => `« ${t} »`).join(', ')}`);
      if (r.erreurs.length) details.push(`erreur : ${r.erreurs.join(' ; ')}`);
      if (!details.length) details.push(r.explication);
      err(`la réponse attendue est jugée « ${r.verdict} » par la correction de l'appareil${details.length ? ` (${details.join(' ; ')})` : ''}`);
    }
  }
  return { avecBareme };
}

// --- QCM ------------------------------------------------------------------------------------

function verifierFichierQcm(f, fichier, cours, ctx) {
  const { note } = ctx;
  const err = (m, q) => note.erreur(fichier, q || null, m);
  if (!estObjet(f)) { err('le fichier doit être un objet {cours, ue, qcm}'); return 0; }
  if (f.cours !== cours) err(`« cours » vaut « ${f.cours} », le nom du fichier annonce « ${cours} »`);
  if (!nonVide(f.ue)) err('UE « ue » manquante');
  if (!ctx.coursConnus.has(cours)) err(`cours « ${cours} » inconnu (${ctx.plan ? 'absent du plan' : 'aucun paquet de ce nom'})`);
  if (!Array.isArray(f.qcm)) { err('« qcm » doit être une liste'); return 0; }

  f.qcm.forEach((q, n) => {
    const id = estObjet(q) && nonVide(q.id) ? q.id : null;
    const nom = id || `QCM n° ${n + 1}`;
    const e = m => err(m, nom);
    if (!estObjet(q)) { e('le QCM doit être un objet'); return; }
    if (!id) e('identifiant « id » manquant');
    else if (ctx.idsQcm.has(id)) e(`identifiant en double (déjà dans ${ctx.idsQcm.get(id)})`);
    else ctx.idsQcm.set(id, fichier);
    if (q.cours !== cours) e(`« cours » vaut « ${q.cours} » au lieu de « ${cours} »`);
    if (!nonVide(q.ue)) e('UE « ue » manquante');
    else if (nonVide(f.ue) && q.ue !== f.ue) note.avertir(fichier, nom, `UE « ${q.ue} » différente de celle du fichier (« ${f.ue} »)`);
    if (!SOURCES_QCM.includes(q.source)) e(`source « ${q.source} » inconnue (annale, claude ou gemini)`);
    if (!STATUTS_QCM.includes(q.statut)) e(`statut « ${q.statut} » inconnu (valide, brouillon ou signale)`);
    if (!Number.isFinite(q.maj)) e('« maj » doit être un nombre (ms)');
    if (q.verifie != null && typeof q.verifie !== 'boolean') e('« verifie » doit valoir true ou false');
    if (!nonVide(q.enonce)) e('énoncé « enonce » manquant');
    const props = Array.isArray(q.propositions) ? q.propositions : null;
    if (!props || props.length !== 5) e(`il faut 5 propositions, de A à E (${props ? props.length : 0} ici)`);
    (props || []).forEach((p, i) => {
      const l = estObjet(p) ? p.l : undefined;
      const pnom = `proposition ${LETTRES[i] || i + 1}`;
      if (!estObjet(p)) { e(`${pnom} : doit être un objet {l, t, vrai, expl}`); return; }
      if (l !== LETTRES[i]) e(`${pnom} : lettre « ${l} » au lieu de « ${LETTRES[i] || '?'} »`);
      if (!nonVide(p.t)) e(`${pnom} : texte « t » manquant`);
      if (typeof p.vrai !== 'boolean') e(`${pnom} : « vrai » doit valoir true ou false`);
      if (!nonVide(p.expl)) e(`${pnom} : explication « expl » manquante`);
    });
    if (props && !props.some(p => estObjet(p) && p.vrai === true)) e('aucune proposition vraie');
    if (q.cartes != null) {
      if (!Array.isArray(q.cartes) || !q.cartes.every(nonVide)) e('« cartes » doit être une liste d\'identifiants');
      else for (const c of q.cartes) if (!ctx.ids.has(c)) note.avertir(fichier, nom, `carte « ${c} » introuvable`);
    }
  });
  return f.qcm.length;
}

// --- Plan ----------------------------------------------------------------------------------

function verifierPlan(plan, ctx) {
  const { note } = ctx;
  const F = 'plan.json';
  const err = m => note.erreur(F, null, m);
  if (!estObjet(plan)) { err('le plan doit être un objet'); return 0; }
  if (!nonVide(plan.semestre)) err('« semestre » manquant');
  if (plan.maj != null && !(typeof plan.maj === 'string' && DATE.test(plan.maj))) err('« maj » doit être une date AAAA-MM-JJ');
  if (plan.partiels != null && !(Array.isArray(plan.partiels) && plan.partiels.every(d => typeof d === 'string' && DATE.test(d)))) {
    err('« partiels » doit être une liste de dates AAAA-MM-JJ');
  }
  if (plan.manquant != null && !(Array.isArray(plan.manquant) && plan.manquant.every(x => typeof x === 'string'))) {
    err('« manquant » doit être une liste de textes');
  }
  if (!Array.isArray(plan.ues) || !plan.ues.length) { err('« ues » doit être une liste non vide'); return 0; }
  const idsUe = new Set(), idsCours = new Set();
  let n = 0;
  plan.ues.forEach((ue, i) => {
    const nomUe = estObjet(ue) && nonVide(ue.id) ? `UE « ${ue.id} »` : `UE n° ${i + 1}`;
    if (!estObjet(ue)) { err(`${nomUe} : doit être un objet {id, nom, cours}`); return; }
    if (!nonVide(ue.id)) err(`${nomUe} : identifiant « id » manquant`);
    else if (idsUe.has(ue.id)) err(`${nomUe} : identifiant en double`);
    else idsUe.add(ue.id);
    if (!nonVide(ue.nom)) err(`${nomUe} : nom « nom » manquant`);
    if (!Array.isArray(ue.cours)) { err(`${nomUe} : « cours » doit être une liste`); return; }
    ue.cours.forEach((c, j) => {
      const nom = estObjet(c) && nonVide(c.id) ? `cours « ${c.id} »` : `${nomUe}, cours n° ${j + 1}`;
      if (!estObjet(c)) { err(`${nom} : doit être un objet`); return; }
      n++;
      if (!nonVide(c.id)) err(`${nom} : identifiant « id » manquant`);
      else if (idsCours.has(c.id)) err(`${nom} : identifiant en double`);
      else idsCours.add(c.id);
      if (!nonVide(c.titre)) err(`${nom} : titre « titre » manquant`);
      if (c.date != null && !(typeof c.date === 'string' && DATE.test(c.date))) err(`${nom} : « date » doit être une date AAAA-MM-JJ`);
      if (c.sources != null && !(Array.isArray(c.sources) && c.sources.every(estObjet))) err(`${nom} : « sources » doit être une liste d'objets`);
      if (c.paquet != null) {
        if (!nonVide(c.paquet)) err(`${nom} : « paquet » doit être un identifiant ou null`);
        else if (!ctx.paquets.has(c.paquet)) err(`${nom} : paquet « ${c.paquet} » introuvable (paquets/${c.paquet}.json) ; mettre null s'il n'est pas encore fait`);
      }
      if (c.fiche != null) {
        if (!nonVide(c.fiche)) err(`${nom} : « fiche » doit être un identifiant ou null`);
        else if (!ctx.fiches.has(c.fiche)) note.avertir(F, null, `${nom} : micro-fiche « ${c.fiche} » introuvable (fiches/${c.fiche}.json)`);
      }
    });
  });
  return n;
}

// --- Vérification d'un dossier -------------------------------------------------------------

export async function verifierDossier(dossier, { exigerBaremes = false } = {}) {
  const note = creerNotes();
  const stats = {
    plan: false, paquets: 0, cartes: 0, cartesAvecBareme: 0, cartesSansBareme: 0,
    fiches: 0, fichiersQcm: 0, qcm: 0, coursPlan: 0, parPaquet: [],
  };
  try { await readdir(dossier); }
  catch { note.erreur('.', null, `dossier introuvable : ${dossier}`); return { erreurs: note.erreurs, avertissements: note.avertissements, stats }; }

  // Micro-fiches d'abord : les cartes et le plan y renvoient.
  const fiches = new Set();
  for (const nomFichier of await listerJson(dossier, 'fiches')) {
    const id = nomFichier.slice(0, -5), chemin = `fiches/${nomFichier}`;
    const f = await lireJson(dossier, chemin, note);
    if (f === undefined) continue;
    fiches.add(id);
    stats.fiches++;
    verifierFiche(f, chemin, id, note);
  }

  // Paquets : lecture, puis idf sur toutes les cartes du dossier, puis contrôle des cartes.
  const paquets = new Map();
  for (const nomFichier of await listerJson(dossier, 'paquets')) {
    const id = nomFichier.slice(0, -5), chemin = `paquets/${nomFichier}`;
    const p = await lireJson(dossier, chemin, note);
    // Fichier illisible : gardé dans le décompte pour que son erreur apparaisse avec les paquets.
    paquets.set(id, { p, chemin, ok: p !== undefined && verifierEntetePaquet(p, chemin, id, note) });
  }
  if (!paquets.size) note.erreur('paquets/', null, 'aucun paquet trouvé : est-ce bien le dossier rappel/ ?');
  const toutes = [...paquets.values()].filter(x => x.ok).flatMap(x => x.p.cartes.filter(estObjet));
  const ctx = { note, exigerBaremes, fiches, paquets, ids: new Map(), idsQcm: new Map(), fichesAbsentes: new Map(), idf: creerIdf(toutes) };
  for (const [id, { p, chemin, ok }] of paquets) {
    stats.paquets++;
    const ligne = { id, fichier: chemin, cartes: 0, avecBareme: 0, erreurs: 0 };
    if (ok) {
      p.cartes.forEach((c, n) => {
        ligne.cartes++;
        if (verifierCarte(c, n, chemin, ctx).avecBareme) ligne.avecBareme++;
      });
    }
    stats.cartes += ligne.cartes;
    stats.cartesAvecBareme += ligne.avecBareme;
    stats.parPaquet.push(ligne);
  }
  stats.cartesSansBareme = stats.cartes - stats.cartesAvecBareme;
  for (const { fichier, fiche, cartes } of ctx.fichesAbsentes.values()) {
    const message = `micro-fiche « ${fiche} » introuvable (fiches/${fiche}.json)`;
    if (cartes.length === 1) note.avertir(fichier, cartes[0], message);
    else note.avertir(fichier, null, `${message}, citée par ${cartes.length} cartes : ${cartes.join(', ')}`);
  }

  // Plan (facultatif), puis QCM (le plan dit quels cours existent).
  const plan = await lireJson(dossier, 'plan.json', note);
  ctx.plan = plan !== undefined;
  stats.plan = ctx.plan;
  if (ctx.plan) stats.coursPlan = verifierPlan(plan, ctx);
  ctx.coursConnus = new Set(ctx.plan && estObjet(plan) && Array.isArray(plan.ues)
    ? plan.ues.filter(estObjet).flatMap(u => (Array.isArray(u.cours) ? u.cours : []).filter(estObjet).map(c => c.id))
    : paquets.keys());
  for (const nomFichier of await listerJson(dossier, 'qcm')) {
    const chemin = `qcm/${nomFichier}`;
    const f = await lireJson(dossier, chemin, note);
    if (f === undefined) continue;
    stats.fichiersQcm++;
    stats.qcm += verifierFichierQcm(f, chemin, nomFichier.slice(0, -5), ctx);
  }

  for (const l of stats.parPaquet) l.erreurs = note.erreurs.filter(e => e.fichier === l.fichier).length;
  return { erreurs: note.erreurs, avertissements: note.avertissements, stats };
}

// --- Sortie lisible ------------------------------------------------------------------------

const ligneNote = e => (e.carte ? `${e.carte} : ${e.message}` : e.message);

function details(liste, retrait) {
  const out = liste.slice(0, MAX_DETAILS).map(e => `${retrait}- ${ligneNote(e)}`);
  if (liste.length > MAX_DETAILS) out.push(`${retrait}… et ${liste.length - MAX_DETAILS} autres`);
  return out;
}

export function formaterRapport(rapport, dossier = '') {
  const { erreurs, avertissements, stats } = rapport;
  const L = [`Vérification des données${dossier ? ` : ${dossier}` : ''}`, ''];
  const parFichier = f => erreurs.filter(e => e.fichier === f);
  const sansBaremeDe = f => avertissements.filter(a => a.fichier === f && a.message === SANS_BAREME).length;

  L.push(`Paquets : ${pluriel(stats.paquets, 'fichier')}, ${pluriel(stats.cartes, 'carte')} (${stats.cartesAvecBareme} avec barème)`);
  for (const p of stats.parPaquet) {
    const sb = sansBaremeDe(p.fichier);
    L.push(`  ${p.erreurs ? '✗' : '✓'} ${p.id} : ${pluriel(p.cartes, 'carte')}, ${pluriel(p.erreurs, 'erreur')}${sb ? `, ${sb} sans barème` : ''}`);
    L.push(...details(parFichier(p.fichier), '      '));
  }

  const autres = [...new Set(erreurs.map(e => e.fichier))].filter(f => !stats.parPaquet.some(p => p.fichier === f));
  const groupe = (titre, prefixe, absent) => {
    const fichiers = autres.filter(f => f.startsWith(prefixe));
    const n = fichiers.reduce((s, f) => s + parFichier(f).length, 0);
    L.push('', `${titre} : ${absent && !n ? 'absent' : pluriel(n, 'erreur')}`);
    for (const f of fichiers) { L.push(`  ✗ ${f}`); L.push(...details(parFichier(f), '      ')); }
  };
  groupe(`Micro-fiches (${stats.fiches})`, 'fiches/', false);
  groupe(`QCM (${stats.qcm} dans ${pluriel(stats.fichiersQcm, 'fichier')})`, 'qcm/', false);
  groupe('Plan (plan.json)', 'plan.json', !stats.plan);
  const divers = autres.filter(f => !/^(fiches\/|qcm\/|plan\.json)/.test(f));
  if (divers.length) { L.push('', 'Autres erreurs'); for (const f of divers) L.push(...details(parFichier(f).map(e => ({ ...e, message: `${f} : ${e.message}` })), '  ')); }

  if (avertissements.length) {
    L.push('', `Avertissements (${avertissements.length})`);
    const nSans = avertissements.filter(a => a.message === SANS_BAREME).length;
    if (nSans) L.push(`  - ${pluriel(nSans, 'carte')} sans barème : la correction de l'appareil déduit les idées de la réponse attendue`);
    const reste = avertissements.filter(a => a.message !== SANS_BAREME).map(a => ({ ...a, carte: null, message: `${a.fichier}${a.carte ? `, ${a.carte}` : ''} : ${a.message}` }));
    L.push(...details(reste, '  '));
  }

  L.push('', erreurs.length
    ? `Résultat : ${pluriel(erreurs.length, 'erreur')} à corriger.`
    : `Résultat : aucune erreur${avertissements.length ? ` (${pluriel(avertissements.length, 'avertissement')})` : ''}. Les données sont prêtes.`);
  return L.join('\n');
}

// --- Ligne de commande ---------------------------------------------------------------------

export async function principal(args, sortie = process.stdout, erreurs = process.stderr) {
  const options = args.filter(a => a.startsWith('--'));
  const dossiers = args.filter(a => !a.startsWith('--'));
  if (options.includes('--aide') || options.includes('--help')) { sortie.write(USAGE + '\n'); return 0; }
  const inconnues = options.filter(o => !['--exiger-baremes', '--json'].includes(o));
  if (dossiers.length !== 1 || inconnues.length) {
    erreurs.write((inconnues.length ? `Option inconnue : ${inconnues.join(', ')}\n` : '') + USAGE + '\n');
    return 2;
  }
  const dossier = resolve(dossiers[0]);
  const rapport = await verifierDossier(dossier, { exigerBaremes: options.includes('--exiger-baremes') });
  sortie.write(options.includes('--json') ? JSON.stringify(rapport, null, 1) + '\n' : formaterRapport(rapport, dossier) + '\n');
  return rapport.erreurs.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await principal(process.argv.slice(2));
}
