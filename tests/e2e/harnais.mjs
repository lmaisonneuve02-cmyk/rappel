// Harnais des tests de bout en bout : serveur statique local, Chromium (Playwright), faux GitHub en mémoire
// chargé avec les données synthétiques de tests/fixtures/donnees/, Gemini simulé, voix simulée,
// polices Google servies vides. Chaque écran vérifié : aucun débordement horizontal, capture.
import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { creerFauxGitHub } from '../fixtures/faux-github.mjs';
import { DEPOT_DEFAUT } from '../../js/config.js';

// Requêtes du service worker visibles par context.route (polices, fichiers de l'appli).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const { chromium } = await import('playwright');

export const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const DONNEES = fileURLToPath(new URL('../fixtures/donnees/', import.meta.url));
export const CAPTURES = fileURLToPath(new URL('./captures/', import.meta.url));
mkdirSync(CAPTURES, { recursive: true });

// ---------- Données synthétiques : {'rappel/<chemin>': texte} ----------

export function lireDonnees() {
  const sortie = {};
  const parcourir = dossier => {
    for (const nom of readdirSync(dossier)) {
      const f = join(dossier, nom);
      if (statSync(f).isDirectory()) parcourir(f);
      else if (/\.jsonl?$/.test(nom)) sortie[DEPOT_DEFAUT.racine + relative(DONNEES, f).split(sep).join('/')] = readFileSync(f, 'utf8');
    }
  };
  parcourir(DONNEES);
  return sortie;
}

export const PAQUETS = Object.fromEntries(Object.entries(lireDonnees())
  .filter(([k]) => k.includes('/paquets/')).map(([, t]) => { const p = JSON.parse(t); return [p.id, p]; }));
export const CARTES = Object.fromEntries(Object.values(PAQUETS).flatMap(p => p.cartes.map(c => [c.id, { ...c, paquet: p.id }])));
export const QCM = JSON.parse(lireDonnees()['rappel/qcm/ess-formes.json']).qcm;

// Carte affichée (question en grand, blancs compris) → carte du jeu de données.
const net = t => String(t || '').replace(/\{\{[^}]*\}\}/g, '').replace(/[_\s]+/g, '');
export function carteDeQuestion(texte) {
  const c = Object.values(CARTES).find(x => net(x.q) === net(texte));
  assert.ok(c, `carte introuvable pour la question « ${texte} »`);
  return c;
}

// ---------- Serveur statique ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

// L'appli est servie sous un sous-chemin, comme sur GitHub Pages (https://<compte>.github.io/rappel/) :
// un chemin absolu (« /js/… ») tomberait hors de l'appli et répondrait 404.
export const SOUS_CHEMIN = '/rappel/';

export async function demarrerServeur() {
  const introuvables = [];   // chemins demandés qui ont répondu 404
  const serveur = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === SOUS_CHEMIN.slice(0, -1)) { res.writeHead(301, { Location: SOUS_CHEMIN }); res.end(); return; }
    const f = p.startsWith(SOUS_CHEMIN) ? join(RACINE, p.slice(SOUS_CHEMIN.length) + (p.endsWith('/') ? 'index.html' : '')) : null;
    if (!f || !f.startsWith(RACINE) || /node_modules|\.git/.test(f) || !existsSync(f) || statSync(f).isDirectory()) {
      introuvables.push(p);
      res.writeHead(404); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(f));
  });
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${serveur.address().port}${SOUS_CHEMIN}`, introuvables, fermer: () => new Promise(r => serveur.close(r)) };
}

export const lancerNavigateur = () => chromium.launch();

// ---------- Gemini simulé ----------

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const enveloppe = objet => ({ candidates: [{ content: { parts: [{ text: typeof objet === 'string' ? objet : JSON.stringify(objet) }] }, finishReason: 'STOP' }] });

// Réponse de l'étudiant extraite de la requête de correction ou de contestation.
export function reponseDe(corps) {
  const texte = corps?.contents?.[0]?.parts?.map(p => p.text).join('\n') || '';
  return (texte.match(/<reponse_etudiant>\n([\s\S]*?)\n<\/reponse_etudiant>/) || [])[1] ?? null;
}
export function genreRequete(corps) {
  const props = corps?.generationConfig?.responseJsonSchema?.properties || {};
  if (props.etudiant_a_raison) return 'contestation';
  if (props.lettres) return 'reponse-qcm';
  if (props.qcm) return 'generation-qcm';
  if (props.verdict) return 'correction';
  return 'verification';
}

// Correction simulée : verdict choisi d'après la réponse (table), « juste » par défaut ;
// contestation : l'étudiant a raison (juste).
export function geminiSimule({ verdicts = {} } = {}) {
  return corps => {
    const genre = genreRequete(corps);
    if (genre === 'verification') return enveloppe('OK');
    if (genre === 'contestation') {
      return enveloppe({ analyse: 'Même sens que la réponse attendue.', etudiant_a_raison: true, verdict: 'juste',
        explication: 'Ta formulation dit la même chose.', formulation: '' });
    }
    if (genre === 'correction') {
      const reponse = reponseDe(corps);
      const verdict = verdicts[reponse] || 'juste';
      return enveloppe({
        verdict, idees_trouvees: verdict === 'faux' ? [] : ['L\'idée principale'],
        idees_manquantes: verdict === 'partiel' ? ['Un élément de la réponse attendue'] : verdict === 'faux' ? ['La réponse attendue'] : [],
        erreurs: [], confiance: 0.92,
        explication: verdict === 'juste' ? 'C\'est bien ça.' : verdict === 'partiel' ? 'Il manque un élément.' : 'Ce n\'est pas la bonne réponse.',
        apprendre: { formulation: '', abreviations: [] },
      });
    }
    return { status: 400, corps: { error: { code: 400, message: 'non simulé', status: 'INVALID_ARGUMENT' } } };
  };
}

// ---------- Voix simulée (reconnaissance et synthèse), injectée avant le chargement de la page ----------

function scriptVoix(reponses) {
  // Exécuté dans la page : pas de dépendance au module.
  return `(() => {
    const REPONSES = ${JSON.stringify(reponses)};
    const donnees = new Set();
    window.__dits = [];
    window.__ecoutes = 0;
    class FausseReco {
      constructor() { this.lang = 'fr-FR'; this.finie = false; }
      start() {
        window.__ecoutes++;
        const q = (document.querySelector('.ml-question')?.textContent || '').trim();
        const r = REPONSES[q];
        const enEcoute = document.querySelector('.ml-etat--ecoute');
        if (r && enEcoute && !donnees.has(q)) {
          donnees.add(q);
          setTimeout(() => {
            if (this.finie) return;
            const res = [Object.assign([{ transcript: r, confidence: 0.9 }], { isFinal: true })];
            this.onresult && this.onresult({ results: res, resultIndex: 0 });
          }, 150);
        }
      }
      stop() { this.finie = true; setTimeout(() => this.onend && this.onend(), 10); }
      abort() { this.finie = true; setTimeout(() => this.onend && this.onend(), 10); }
    }
    window.SpeechRecognition = FausseReco;
    window.webkitSpeechRecognition = FausseReco;
    const synth = {
      speaking: false, pending: false, paused: false,
      getVoices: () => [{ name: 'Voix essai', lang: 'fr-FR', localService: true, default: true, voiceURI: 'essai' }],
      speak(u) {
        window.__dits.push(u.text);
        setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 30); }, 5);
      },
      cancel() {}, pause() {}, resume() {},
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  })();`;
}

export const JETON = 'github_pat_essai';

// Messages de l'outil de test lui-même (pas de l'appli).
const TOUJOURS = [/Service Worker registration blocked by Playwright/];

// ---------- Ouverture d'une page ----------

// options : theme ('clair'|'sombre'), jeton (bool), gemini (fn(corps) → objet | {status, corps}), voix (table question → réponse dictée),
// sw (service worker autorisé), fichiers (dépôt initial), pc (vue PC).
// latence : délai de Gemini en ms, ou fonction (genre de requête) → ms.
export async function ouvrir(navigateur, base, { theme = 'clair', jeton = true, gemini = geminiSimule(), voix = null, sw = false, fichiers = lireDonnees(), pc = false, latence = 150 } = {}) {
  const ctx = await navigateur.newContext({
    viewport: pc ? { width: 1280, height: 800 } : { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: !pc, hasTouch: !pc,
    colorScheme: theme === 'sombre' ? 'dark' : 'light', locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: sw ? 'allow' : 'block',
  });
  // Le faux dépôt n'accepte que ce jeton (un autre reçoit 401, comme GitHub).
  const faux = creerFauxGitHub({ fichiers, proprietaire: DEPOT_DEFAUT.proprietaire, depot: DEPOT_DEFAUT.depot, jeton: JETON });
  if (jeton) {
    await ctx.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('essai.init')) {
          sessionStorage.setItem('essai.init', '1');
          localStorage.setItem('rappel.jeton', 'github_pat_essai');   // = JETON
          localStorage.setItem('rappel.gemini', 'AQ.essai');
          localStorage.setItem('rappel.appareil', 'tel-essai');
        }
      } catch { /* rien */ }
    });
  }
  if (voix) await ctx.addInitScript(scriptVoix(voix));

  const requetesGemini = [];
  // Hors ligne : les routes simulées coupent aussi (sinon elles répondraient malgré setOffline).
  let coupe = false;
  await ctx.route('https://api.github.com/**', async route => {
    const r = route.request();
    if (coupe) return route.abort('internetdisconnected');
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rep = await faux.fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postData() || undefined });
    const corps = Buffer.from(await rep.arrayBuffer());
    return route.fulfill({ status: rep.status, headers: { ...Object.fromEntries(rep.headers.entries()), ...CORS }, body: corps });
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const r = route.request();
    if (coupe) return route.abort('internetdisconnected');
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const corps = JSON.parse(r.postData() || '{}');
    const genre = genreRequete(corps);
    requetesGemini.push({ url: r.url(), corps, genre, cle: r.headers()['x-goog-api-key'] });
    await new Promise(ok => setTimeout(ok, typeof latence === 'function' ? latence(genre) : latence));
    let rep = gemini(corps);
    if (!(rep && 'status' in rep && 'corps' in rep)) rep = { status: 200, corps: rep };
    return route.fulfill({ status: rep.status, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(rep.corps) });
  });
  // Polices : feuille vide (aucun accès réseau extérieur, pas d'attente).
  await ctx.route('https://fonts.googleapis.com/**', route => coupe ? route.abort('internetdisconnected') : route.fulfill({ status: 200, headers: { 'content-type': 'text/css', ...CORS }, body: '/* polices de test */' }));
  await ctx.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 404, headers: CORS, body: '' }));

  const page = await ctx.newPage();
  const journal = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') journal.push(`console.${m.type()} : ${m.text()}`); });
  page.on('pageerror', e => journal.push(`exception : ${e.message}`));
  return {
    ctx, page, faux, requetesGemini, journal,
    // Coupe ou rétablit le réseau (navigateur et services simulés).
    async horsLigne(oui = true) { coupe = oui; await ctx.setOffline(oui); },
    // Aucune erreur ni avertissement dans la console, hors motifs attendus pour ce scénario.
    verifierConsole(attendus = []) {
      const restes = journal.filter(l => ![...attendus, ...TOUJOURS].some(re => re.test(l)));
      assert.deepEqual(restes, [], 'erreurs dans la console');
    },
    fermer: () => ctx.close(),
  };
}

// ---------- Vérifications d'écran ----------

export async function verifierEcran(page, nom) {
  await page.waitForTimeout(120);
  const { large, vue } = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: innerWidth }));
  assert.ok(large <= vue, `${nom} : débordement horizontal (${large} px pour ${vue} px)`);
  await page.screenshot({ path: join(CAPTURES, `${nom}.png`) });
}

export const clic = (page, nom) => page.getByRole('button', { name: nom, exact: true }).first().click();

// Texte d'un élément, espaces insécables (typographie française : « Cartes : », « … ») ramenées à des espaces.
export const texte = async cible => (await cible.textContent())?.replace(/\u00a0/g, ' ') ?? null;

// Texte de l'en-tête « Cartes : X/30 · Révisions : R ».
export const compteur = page => texte(page.locator('#compteur-texte'));

// Fichiers du faux dépôt (JSON / JSONL analysés).
export function fichiersDepot(faux) {
  const sortie = {};
  for (const [k, t] of Object.entries(faux.fichiers())) {
    sortie[k] = k.endsWith('.jsonl') ? t.split('\n').filter(Boolean).map(l => JSON.parse(l)) : JSON.parse(t);
  }
  return sortie;
}

// Attend une condition côté Node (faux dépôt…), sans sleep fixe.
export async function attendre(condition, { delai = 15000, pas = 100, message = 'condition non remplie' } = {}) {
  const fin = Date.now() + delai;
  for (;;) {
    const v = await condition();
    if (v) return v;
    if (Date.now() > fin) throw new Error(`Délai dépassé : ${message}`);
    await new Promise(r => setTimeout(r, pas));
  }
}
