# Rappel 2 — conception technique

Document de référence pour construire l'appli. Chaque module a un contrat précis : respecte les noms, signatures et formats ci-dessous à la lettre, pour que les modules écrits en parallèle s'emboîtent.

## 0. Principes

- **Ergonomie d'abord** (exigence explicite de l'utilisateur) : clair, facile à comprendre, facile à prendre en main. Un seul geste principal par écran (grand bouton en bas, à portée de pouce). Mots simples, phrases courtes, aucun jargon à l'écran (jamais « FSRS », « SRS », « cloze », « token », « API », « JSON » : on dit « texte à trous », « clé », « jeton d'accès », etc.). Toujours montrer où l'on en est et ce qui va se passer. Messages d'erreur qui disent quoi faire. Zones de toucher de 48 px minimum. Utilisable à une main sur téléphone, confortable au clavier sur PC (Entrée / Ctrl+Entrée).
- Appli statique, **sans étape de compilation** : modules ES natifs (`<script type="module">`), aucune dépendance externe hormis Google Fonts.
- Les modules « purs » (sans DOM) sont importables par Node 22 pour les tests : `temps.js`, `fsrs.js`, `texte.js`, `correcteur.js`, `gemini.js`, `github.js`, `fusion.js`, `depot.js`, `seance.js`, `qcm.js`, `stats.js`, `correction.js`, `voix.js` (parties pures), `mainslibres.js` (dépendances injectées). Ils n'accèdent ni à `document` ni à `window` au chargement ; `fetch`, horloge et aléa sont injectables.
- **Sécurité** : jamais d'`innerHTML`, `outerHTML`, `insertAdjacentHTML` ni `document.write` ; tout le DOM se construit avec `h()` (textContent). Les SVG des cartes s'affichent via `<img src="data:image/svg+xml;charset=utf-8,...">`. Les clés restent dans `localStorage` de l'appareil et ne partent que vers leur service (jeton → `api.github.com`, clé Gemini → `generativelanguage.googleapis.com`, en en-tête, jamais dans l'URL). CSP en `<meta>` dans `index.html`.
- Langue : tout le texte visible est en français ; identifiants de code en français sans accents (comme ci-dessous).
- Fuseau : toutes les notions de « jour » sont en heure de Paris (`Europe/Paris`), quel que soit l'appareil.

## 1. Arborescence du dépôt `rappel` (public)

```
index.html               coquille : en-tête, <main>, barre d'onglets, CSP, polices, <script type="module" src="js/app.js">
style.css                identité visuelle (papier d'ECG, rouge artériel, bleu veineux), thèmes clair et sombre
sw.js                    service worker (hors ligne)
manifest.webmanifest     installation (écran d'accueil)
icons/                   icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180)
js/config.js             constantes (dépôt par défaut, modèles, clés localStorage)
js/temps.js  js/fsrs.js  js/texte.js  js/correcteur.js  js/gemini.js  js/correction.js
js/github.js js/fusion.js js/depot.js js/stockage.js js/sync.js
js/seance.js js/qcm.js   js/stats.js  js/voix.js js/mainslibres.js
js/ui/commun.js          h(), toast, composants partagés, rendu des fiches
js/ui/aujourdhui.js js/ui/seance.js js/ui/qcm.js js/ui/suivi.js js/ui/reglages.js js/ui/accueil.js js/ui/mainslibres.js
js/app.js                démarrage, onglets, en-tête (compteur, état de synchro), contexte partagé
outils/verifier-donnees.mjs   contrôle des données (barèmes, QCM, plan) d'un dossier `rappel/`
tests/unit/*.test.mjs    node --test
tests/e2e/*.test.mjs     Playwright (bibliothèque `playwright`) + node --test
tests/fixtures/          données de test synthétiques (aucune donnée personnelle)
package.json             {"type":"module"}, scripts test / test:e2e, devDependencies: playwright 1.56.1
```

## 2. Données (dépôt privé `etudes`, dossier `rappel/`)

Formats exacts. Les fichiers JSON s'écrivent avec `JSON.stringify(obj, null, 1) + "\n"` ; les `.jsonl` avec une ligne JSON compacte par entrée, terminée par `\n`.

### `plan.json`
```json
{"semestre": "S5 2026-2027", "maj": "2026-10-12", "partiels": ["2026-12-14", "2026-12-16"],
 "ues": [{"id": "cv", "nom": "Cardio-vasculaire", "cours": [
   {"id": "cv-cm06", "titre": "Artères et veines", "type": "CM", "num": "6", "date": "2026-09-28",
    "sources": [{"type": "roneo", "drive": "<id Drive>", "nom": "<nom du fichier>"}],
    "paquet": "cv-cm06", "fiche": "cv-cm06"}]}],
 "manquant": ["…"]}
```
Un cours est « en cartes » si `paquet` est non nul et que `paquets/<paquet>.json` existe.

### `paquets/<id>.json`
```json
{"id": "cv-cm06", "nom": "CV · CM6 Artères et veines", "ue": "cv", "ordre": 3, "source": "…",
 "cartes": [{"id": "cv6-01", "type": "fait", "q": "…", "a": "…", "fiche": "cv-cm06", "svg": "<svg…> (rare)",
             "bareme": {"idees": [{"id": "k1", "texte": "…", "formulations": ["…", "…"], "obligatoire": true}],
                        "pieges": [{"si": "sympathique", "sauf": "parasympathique", "pourquoi": "…"}]}}]}
```
- `type` : `fait` | `cloze` | `raisonnement`. Pour `cloze`, la question contient les trous `{{réponse}}` et `a` est absent ; chaque trou est une idée obligatoire (le barème peut préciser leurs formulations, dans l'ordre des trous, ids `t1`, `t2`…).
- Identifiants de cartes uniques dans tout le dossier.
- `bareme` peut manquer sur une carte : le correcteur en déduit alors un à partir de `a` (méthode de v1, `splitRef`).

### `fiches/<id>.json`
`{"id", "title", "why", "order", "blocks": [...]}` ; blocs : `{"k":"h","t"}`, `{"k":"p","t"}`, `{"k":"pin","title","lines":[...]}`, `{"k":"nums","items":[{"v","l"}]}`, `{"k":"table","head":[...],"rows":[[{"t","s"?}]]}` (`s: "key"` = cellule mise en avant). Identique à v1.

### `qcm/<cours>.json` (un fichier par cours, tableau de QCM)
```json
{"cours": "cv-cm06", "ue": "cv", "qcm": [
 {"id": "cv-cm06-q01", "ue": "cv", "cours": "cv-cm06", "source": "claude", "statut": "valide", "maj": 0,
  "enonce": "…", "propositions": [{"l": "A", "t": "…", "vrai": true, "expl": "…"}, … 5 en tout, A à E],
  "verifie": true, "cartes": ["cv6-01"]}]}
```
`source` : `annale` | `claude` | `gemini`. `statut` : `valide` | `brouillon` | `signale`. Un QCM est proposé si `statut === "valide"`, ou `statut === "brouillon" && verifie === true` (badge « généré »). Au moins une proposition vraie.

### `progres/srs/<paquet>.json`
`{"cards": {"<carteId>": {"s", "d", "due", "last", "reps", "lapses"}}}` — format de v1 inchangé (ms epoch).

### `progres/reponses/AAAA-MM.jsonl` (mois de Paris de `ts`)
```json
{"id":"<appareil>-<ts>","ts":1791900000000,"t":"2026-10-12T14:03:11+02:00","appareil":"tel-x7k2","paquet":"cv-cm06","carte":"cv6-01","reponse":"…","verdict":"juste","correcteur":"gemini","note":3,"nouvelle":false,"duree":18400,"confiance":0.92}
```
- `correcteur` : `exact` | `carnet` | `gemini` | `local` | `hors-ligne` | `je-ne-sais-pas` | `auto` (il s'est noté lui-même) | `contestation`.
- Une contestation acceptée ajoute une ligne `correcteur: "contestation"` avec `remplace: "<id de la ligne contestée>"`, le nouveau `verdict` et la nouvelle `note` ; les calculs utilisent alors ce verdict à la place de celui de la ligne remplacée (la ligne remplacée ne compte plus).
- `nouvelle: true` si la carte n'avait aucun état avant cette réponse.

### `progres/qcm/AAAA-MM.jsonl`
```json
{"id":"<appareil>-<ts>","ts":…,"t":"…","appareil":"…","qcm":"cv-cm06-q01","cours":"cv-cm06","ue":"cv","cochees":["A","C"],"points":0.5,"discordances":1,"duree":30000}
```

### `progres/carnet.json`
```json
{"abreviations": {"rao": "rétrécissement aortique"},
 "cartes": {"<carteId>": {"acceptees": ["…"], "refusees": ["…"]}}}
```
Au plus 20 entrées par liste et par carte, sans doublon (comparaison après `normaliser`).

### `progres/a-revoir.json`
`{"cas": [{"id": "<appareil>-<ts>", "ts", "type": "contestation"|"incertain"|"qcm-signale"|"qcm-rejete", "paquet"?, "carte"?, "qcm"?, "cours"?, "reponse"?, "verdict"?, "confiance"?, "raison"?, "avis"?, "explication"?, "issue"?: "accepte"|"refuse"}]}`

### `progres/reglages.json`
```json
{"nouvellesParJour": 15, "objectifJour": 30, "ordrePaquets": [], "baremeQcm": [1, 0.5, 0.2, 0],
 "qcmParSeance": 8, "pauseToutes": 30, "modeles": {"correction": "", "contestation": ""},
 "voix": {"vitesse": 1, "silence": 2.5}, "maj": 0}
```
Valeurs par défaut dans `depot.js` (`REGLAGES_DEFAUT`), fusionnées avec le fichier. `modeles.*` vide → valeurs de `config.js`. `maj` = ms de la dernière modification (la plus récente gagne entre appareils).

### `progres/exceptions.json` : `{"jours": {"AAAA-MM-JJ": "motif"}}`
### `progres/historique-v1.json` : `{"source", "days": {"AAAA-MM-JJ": {"n", "judged", "right", "nw"}}, "settings"}`
### `progres/calibration/AAAA-MM-JJ.json` : résultat de l'essai de correction (voir § 9).

## 3. Modules purs — contrats

### `js/config.js`
```js
export const DEPOT_DEFAUT = {proprietaire: 'lmaisonneuve02-cmyk', depot: 'etudes', branche: 'main', racine: 'rappel/'};
export const MODELES_DEFAUT = {correction: 'gemini-3.5-flash-lite', contestation: 'gemini-3.8-flash'};
export const CLES = {jeton: 'rappel.jeton', gemini: 'rappel.gemini', depot: 'rappel.depot', appareil: 'rappel.appareil', voixNom: 'rappel.voixNom', theme: 'rappel.theme'};
export const OBJECTIF_DEFAUT = 30;
export const VERSION = '2.0.0';
```

### `js/temps.js`
```js
export const MIN = 6e4, HEURE = 36e5, JOUR = 864e5;
export function jourParis(ms)          // 'AAAA-MM-JJ'
export function moisParis(ms)          // 'AAAA-MM'
export function debutJourParis(ms)     // ms de 00:00 (Paris) du jour de ms
export function finJourParis(ms)       // ms du 00:00 (Paris) suivant (gère les jours de 23 h et 25 h)
export function decalerJour(jour, n)   // 'AAAA-MM-JJ' ± n jours calendaires
export function isoParis(ms)           // '2026-10-12T14:03:11+02:00'
export function heureParis(ms)         // '14:03'
```
Implémentation par `Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Paris', …})`. Tests autour du 25 oct. 2026 et du 29 mars 2026.

### `js/fsrs.js` — copie **à l'identique** de v1
```js
export const W = [0.4872,1.4003,3.7145,13.8206,5.1618,1.2298,0.8975,0.031,1.6474,0.1367,1.0461,2.1072,0.0793,0.3246,1.587,0.2272,2.8755];
export const DECAY = -0.5, FACTOR = 19/81, RET = 0.9;
export function review(st, g, now)     // identique à v1 (g = 1..4), renvoie {s, d, due, last, reps, lapses}
export function apercu(st, g, now)     // '10 min' | 'n j' | 'n mois' | '1 an' (comme preview de v1, avec now)
export const NOTES = {juste: 3, partiel: 2, faux: 1};
export function noteDe(verdict)        // NOTES[verdict] ?? 1
export function estDisponible(st, now) // carte en révision proposable maintenant :
   // si st.due - st.last <= HEURE (retour à +10 min après une erreur) : now >= st.due
   // sinon : st.due < finJourParis(now)  (« dû dès minuit »)
export function estAcquise(st, jour)   // jourParis(st.last) === jour && st.due - st.last > HEURE
export function delaiTexte(st, now)    // « revient dans 10 min » | « revient demain » | « revient dans 4 jours » | « … 2 mois »
```

### `js/texte.js` — machinerie de texte de v1 (reprise telle quelle) + aides
Exporte : `STOP, NUMW, ABBR, SYNG, SYN, ANTP, ANTS, norm, stem, canon, analyze(text, abrExtra?), lev, hasStem, splitRef, clozeParts, clozeAnswers, refText, plainQ, fullText, estJeNeSaisPas, normaliser, texteOral, creerIdf(cartes)`.
- `analyze(text, abrExtra)` : comme v1, avec en plus les abréviations du carnet (`{abr: 'développement'}`, normalisées) fusionnées à `ABBR`.
- `normaliser(s)` : minuscules, sans accents, `œ→oe`, ponctuation → espace, espaces réduits, trim (sert à la comparaison exacte et au dédoublonnage du carnet).
- `estJeNeSaisPas(texte)` : regex `DUNNO` de v1 (« je ne sais pas », « aucune idée », « je passe »…).
- `texteOral(carte)` : question pour la synthèse vocale ; trous remplacés par « blanc ».
- `creerIdf(cartes)` → `idf(stem)` (même formule que v1 : `log(1 + n / (1 + df))` sur `fullText` de toutes les cartes).

### `js/correcteur.js` — correction locale
```js
// Résultat commun à tous les correcteurs :
// {verdict: 'juste'|'partiel'|'faux', idees_trouvees: [string], idees_manquantes: [string], erreurs: [string],
//  confiance: number (0..1), explication: string, correcteur: string}
export function ideesDe(carte)                       // [{id, texte, formulations: [string], obligatoire}] depuis bareme, sinon déduites
export function correspondanceDirecte(carte, reponse, carnetCarte)  // null | Résultat juste (correcteur 'exact' ou 'carnet')
export function corrigerLocal(carte, reponse, {idf, abreviations})  // Résultat (correcteur 'local')
export function verifierBareme(carte)                // [messages] : schéma, ≥ 2 formulations par idée, ≥ 1 idée obligatoire…
```
- `correspondanceDirecte` : `normaliser(reponse)` égale à `normaliser(refText(carte))` (pour un texte à trous : les réponses des trous jointes par des espaces, séparateurs ignorés) → `exact` ; égale à une `acceptees` du carnet → `carnet`.
- `corrigerLocal` : une idée est trouvée si l'une de ses phrases (`texte` ou une `formulation`) est présente dans la réponse, selon la mesure de v1 (racines pondérées par `idf`, seuils de v1 : 1 racine → 0,99 ; ≤ 3 → 0,6 ; sinon 0,5 ; nombres exacts ; tolérance aux fautes `hasStem`/Levenshtein, abréviations, synonymes, garde-fous hypo/hyper, tachy/brady, antonymes). Les mots de la question ne comptent pas (comme v1). Piège : déclenché si `si` apparaît dans la réponse en mot entier (après `norm`) et que `sauf` n'y apparaît pas → message d'erreur = `pourquoi`. Antonymes (gauche/droite, augmente/diminue…) : erreur comme v1.
- Verdict : juste = toutes les idées obligatoires trouvées et aucune erreur ; partiel = au moins une idée obligatoire trouvée (ou toutes avec erreur) ; faux sinon. `confiance` : 0,6 (le correcteur local est approximatif). `explication` : une phrase simple.
- Exigence de données : pour chaque carte, `corrigerLocal(carte, refText(carte))` doit renvoyer `juste`.

### `js/gemini.js`
```js
export const SCHEMA_CORRECTION   // schéma de réponse imposé (voir ci-dessous)
export function requeteCorrection(carte, reponse, {carnetCarte, abreviations})  // corps JSON de generateContent
export async function corrigerGemini(carte, reponse, ctx, {cle, modele, fetch, delai = 15000})
   // → Résultat (correcteur 'gemini') + champ apprendre: {formulation: string|null, abreviations: [{abr, sens}]}
export async function contesterGemini(carte, reponse, resultatInitial, raison, ctx, {cle, modele, fetch})
   // → {etudiant_a_raison: bool, verdict, explication, formulation: string|null}
export async function genererQcm({cours, ue, cartes, fiche, n = 5}, {cle, modele, fetch})   // → [QCM brouillon] (source 'gemini', statut 'brouillon', verifie false)
export async function repondreQcm(qcm, {cle, modele, fetch})   // → ['A','C'] (QCM présenté sans la clé)
export async function verifierCle({cle, modele, fetch})         // → true, ou lève ErreurGemini
export class ErreurGemini extends Error { /* code: 'cle'|'quota'|'region'|'reseau'|'delai'|'format'|'serveur', status */ }
```
- REST (vérifié le 12 oct. 2026) : `POST https://generativelanguage.googleapis.com/v1beta/models/<modele>:generateContent`, en-têtes `Content-Type: application/json`, `x-goog-api-key: <cle>` (les clés récentes commencent par `AQ.` et ne marchent qu'en en-tête). Corps : `{systemInstruction: {parts: [{text}]}, contents: [{role: 'user', parts: [{text}]}], generationConfig: {responseMimeType: 'application/json', responseJsonSchema: <JSON Schema>, thinkingConfig, maxOutputTokens}}`.
- Modèles par défaut (`config.js`) : correction `gemini-3.5-flash-lite` (`thinkingConfig: {thinkingLevel: 'minimal'}`), contestation et QCM `gemini-3.8-flash` (`thinkingLevel: 'low'` ; « minimal » y est refusé). Pour un modèle `gemini-2.*` : `thinkingConfig: {thinkingBudget: 0}` (lite) et `temperature: 0`. Pour les modèles 3.x, ne pas envoyer `temperature` (ignorée, bientôt refusée) : la constance vient du schéma et des énumérations. Si la réponse est un 400 qui mentionne `thinking`, réessayer une fois sans `thinkingConfig`.
- Réponse : concaténer `candidates[0].content.parts[].text` en ignorant les parties `thought: true`, puis `JSON.parse` ; `promptFeedback.blockReason` ou absence de candidat ou `finishReason` ≠ `STOP` → `format`. Délai par `AbortController`.
- Erreurs (enveloppe `{error: {code, message, status, details}}`) : 400 `API_KEY_INVALID` ou 401 `UNAUTHENTICATED` ou 403 `PERMISSION_DENIED` → `cle` ; 400 `FAILED_PRECONDITION` (« free tier is not available in your country », « User location is not supported ») → `region` ; 429 `RESOURCE_EXHAUSTED` → `quota` (lire `RetryInfo.retryDelay` dans `details` si présent, exposé en `attente` ms) ; 500/503/504 → `serveur` (un seul nouvel essai après 1,5 s) ; échec de `fetch` → `reseau` ; délai dépassé → `delai`.
- Schéma de correction : `{verdict: enum[juste, partiel, faux], idees_trouvees: [string], idees_manquantes: [string], erreurs: [string], confiance: number, explication: string, apprendre: {formulation: string (vide si rien), abreviations: [{abr, sens}]}}` (tous requis).
- Consigne (system instruction, en français) : correcteur d'un étudiant de 3e année de médecine ; juger le **sens** ; tolérer abréviations, fautes de frappe et d'orthographe, erreurs de dictée vocale (homophones, mots coupés), tournures différentes, ordre différent ; rester **strict** sur les contresens médicaux (sympathique / parasympathique, hypo / hyper, augmente / diminue, droite / gauche, afférent / efférent, systole / diastole, artère / veine…) ; appliquer le barème (juste = toutes les idées obligatoires sans piège ; partiel = au moins une idée obligatoire ; faux sinon) ; `apprendre.formulation` = la réponse de l'étudiant reformulée minimalement si elle est juste mais formulée autrement que la réponse attendue, sinon chaîne vide ; abréviations nouvelles employées par l'étudiant. `explication` : une phrase, tutoiement, simple.
- Contestation : modèle un cran au-dessus ; on fournit la question, la réponse attendue, le barème, la réponse de l'étudiant, le premier verdict et sa justification, et la raison de l'étudiant ; consigne d'impartialité (ne pas céder par complaisance, ne pas s'entêter).
- Génération de QCM : uniquement à partir des cartes et de la micro-fiche fournies (jamais de connaissances extérieures non présentes dans le texte), format fac : 5 propositions A à E, une ou plusieurs vraies, explication par proposition.
- JSON illisible ou réponse bloquée → `format`. Offre gratuite : ouverte en France (≈ 15 requêtes/min et 500/jour pour Flash-Lite, chiffres indicatifs) ; un 429 bascule simplement sur la correction de l'appareil.

### `js/correction.js` — orchestration de la correction
```js
export async function corriger({carte, paquet, reponse, donnees, gemini: {cle, modele, fetch}, enLigne, idf, maintenant, appareil})
  // → {resultat, ops}  (ops = opérations de synchro à ajouter : carnet, a-revoir)
export async function contester({carte, paquet, reponse, resultat, raison, etatAvant, donnees, gemini, maintenant, appareil, ligneId})
  // → {resultat, accepte: bool, ops}  (si accepte : ops contient srs recalculé + ligne de contestation + carnet)
```
Ordre : (1) `estJeNeSaisPas` → faux (`je-ne-sais-pas`) ; (2) `correspondanceDirecte` ; (3) si `cle && enLigne` : Gemini (modèle `reglages.modeles.correction || MODELES_DEFAUT.correction`) ; si `confiance < 0.7` → op `a-revoir` type `incertain` ; si juste et `apprendre.formulation` non vide (ou réponse différente de la réponse attendue) → op `carnet` (acceptee) ; abréviations → op `carnet` ; si faux avec confiance ≥ 0,9 → op `carnet` (refusee) ; (4) en cas d'`ErreurGemini` ou hors ligne : `corrigerLocal` avec `correcteur: 'hors-ligne'` (badge « corrigé hors ligne ») et `erreurGemini: code` ; sans clé : `corrigerLocal` (`correcteur: 'local'`).

### `js/fusion.js`
```js
export function fusionSrs(a, b)          // {cards} : par carte, l'état au last le plus récent gagne (égalité : reps le plus grand, puis a)
export function fusionLignes(a, b)       // union par id, triée par ts
export function fusionCarnet(a, b)       // union des abréviations (a prioritaire si conflit), union des listes par carte (dédoublonnage normaliser, 20 max, plus récentes gardées)
export function fusionARevoir(a, b)      // union par id, triée par ts
export function fusionQcmFichier(a, b)   // union par id ; même id : maj la plus récente gagne
export function fusionReglages(a, b)     // maj la plus récente gagne (objet entier)
export function analyserJsonl(texte)     // lignes vides et lignes illisibles ignorées
export function versJsonl(lignes)
```

### `js/depot.js` — fichiers ↔ données, opérations
```js
export const REGLAGES_DEFAUT
export function cheminUtile(path, racine = 'rappel/')     // true pour plan, paquets/, fiches/, qcm/, progres/ (pas v1/, bilans/, autres)
export function analyser(path, texte)      // objet (JSON) ou tableau de lignes (.jsonl)
export function serialiser(path, objet)    // texte (format § 2)
export function vue(objets, racine)        // → Donnees (ci-dessous), à partir de {path: objet}
export function cheminsTouches(op, racine) // [paths] modifiés par l'opération
export function appliquerOp(objets, op, racine)  // modifie objets (crée les fichiers absents), idempotent
```
`Donnees = {plan, paquets: {id: paquet}, ordre: [paquetId], fiches: {id}, qcm: {id: qcm}, srs: {paquet: {carteId: etat}}, reponses: [ligne] (triées ts), qcmJournal: [ligne], carnet, aRevoir, reglages (avec défauts), exceptions, historique, cartes: {carteId: {paquet, carte}}}`.
`ordre` : `reglages.ordrePaquets` d'abord, puis l'ordre du plan (UE puis cours), puis le champ `ordre` des paquets, puis l'identifiant.
Opérations (objets JSON, persistées telles quelles) :
- `{type: 'srs', paquet, carte, etat}` → `progres/srs/<paquet>.json` via `fusionSrs`
- `{type: 'reponse', ligne}` → `progres/reponses/<moisParis(ligne.ts)>.jsonl` via `fusionLignes`
- `{type: 'qcm-reponse', ligne}` → `progres/qcm/<mois>.jsonl`
- `{type: 'carnet', carte?, acceptee?, refusee?, abreviations?: {abr: sens}}` → `progres/carnet.json`
- `{type: 'a-revoir', cas}` → `progres/a-revoir.json`
- `{type: 'reglages', reglages}` → `progres/reglages.json` via `fusionReglages`
- `{type: 'qcm-ajout', cours, ue, qcm}` / `{type: 'qcm-statut', cours, id, statut, maj}` → `qcm/<cours>.json`
- `{type: 'fichier', path, texte}` → remplace le fichier (calibration)

### `js/stockage.js`
`export async function ouvrirStockage(nom = 'rappel2')` → `{lire(cle), ecrire(cle, valeur), effacer(cle), tout()}` sur IndexedDB ; repli en mémoire si IndexedDB est indisponible (navigation privée). Toujours dans des try/catch.

### `js/github.js`
```js
export class ClientGitHub {
  constructor({jeton, proprietaire, depot, branche = 'main', fetch = globalThis.fetch})
  async tete()                    // {commit, arbre} via GET /repos/{o}/{r}/git/ref/heads/{b} puis /git/commits/{sha}
  async arbre(arbreSha)           // [{path, sha, type}] via GET /git/trees/{sha}?recursive=1
  async blob(sha)                 // texte UTF-8 (Accept: application/vnd.github.raw, ou base64 décodé en UTF-8)
  async ecrire({base: {commit, arbre}, fichiers: {path: texte|null}, message})
     // POST /git/trees {base_tree, tree: [{path, mode:'100644', type:'blob', content}]} (sha:null pour supprimer)
     // POST /git/commits {message, tree, parents:[base.commit]} ; PATCH /git/refs/heads/{b} {sha, force:false}
     // → {commit, arbre} ; 422 non fast-forward → ErreurGitHub code 'conflit'
  async verifier()                // GET /repos/{o}/{r} → {ok, prive, ecriture: permissions.push}
}
export class ErreurGitHub extends Error { /* code: 'jeton'(401) | 'droits'(403 sans limite) | 'introuvable'(404) | 'conflit'(409/422 ref) | 'limite'(403/429 rate limit) | 'reseau' | 'serveur'(5xx), status */ }
```
En-têtes : `Authorization: Bearer <jeton>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Pas de cache HTTP du navigateur (`cache: 'no-store'`).

### `js/sync.js`
```js
export class Synchro extends EventTarget {
  constructor({stockage, creerClient = cfg => new ClientGitHub(cfg), config: () => ({jeton, proprietaire, depot, branche, racine}), maintenant = Date.now, delaiEnvoi = 30000})
  async demarrer()           // charge le cache local (fichiers + ops en attente), émet 'donnees', puis rafraichir()
  async rafraichir()         // tête → arbre → blobs dont le sha a changé (6 en parallèle) → cache → émet 'donnees' ; puis pousser() s'il y a des ops
  ajouter(op)                // applique l'op localement, la persiste, émet 'donnees', programme l'envoi (30 s après la dernière op)
  async pousser(raison)      // voir ci-dessous ; raison : 'minuterie'|'fin-seance'|'arriere-plan'|'manuel'|'ouverture'|'reseau'
  donnees()                  // Donnees courantes (fichiers distants + ops en attente)
  get etat()                 // {mode: 'sans-jeton'|'chargement'|'a-jour'|'attente'|'envoi'|'hors-ligne'|'erreur', attente: n, message, derniereSynchro: ms}
}
// événements : 'donnees' (detail: Donnees), 'etat' (detail: etat)
```
Envoi : jusqu'à 5 tentatives : lire la tête et l'arbre distants ; relire les fichiers touchés par les ops en attente ; leur appliquer les ops (idempotent, `appliquerOp`) ; si rien ne change → vider les ops ; sinon `ecrire` avec message `Rappel : séance du <JJ/MM> (<n> réponses)` (n = ops `reponse`, sinon `Rappel : mise à jour du <JJ/MM>`) ; conflit → recommencer ; succès → mettre à jour le cache, retirer les ops envoyées (pas celles ajoutées pendant l'envoi). Sans réseau : `hors-ligne`, réessai à l'événement `online` et au retour au premier plan. Envoi aussi à `visibilitychange` (caché) et en fin de séance. Les ops et le cache sont dans IndexedDB : rien ne se perd si l'appli est fermée.

### `js/seance.js`
```js
export function nouvellesDuJour(donnees, maintenant)   // nb de cartes distinctes avec une ligne nouvelle:true aujourd'hui
export function acquisesDuJour(donnees, maintenant)    // nb de cartes (tous paquets) avec estAcquise(etat, jourParis(maintenant)) — la règle de déblocage
export function aReviser(donnees, maintenant, filtre)  // [{paquet, carteId}] disponibles (estDisponible), filtre = 'tout' | paquetId
export function nouvellesPossibles(donnees, maintenant, filtre)  // [{paquet, carteId}] sans état, dans l'ordre donnees.ordre puis l'ordre du fichier, limitées à max(0, nouvellesParJour - nouvellesDuJour)
export class Seance {
  constructor({donnees, maintenant, filtre = 'tout', enAvance = false, rnd = Math.random})
  // file : révisions mélangées (en évitant deux cartes de la même fiche à la suite), puis nouvelles cartes paquet par paquet
  etape()        // {type:'fiche', ficheId, paquet} avant la 1re nouvelle carte d'une fiche pas encore montrée dans la séance
                 // {type:'pause', faites, minutes} quand faites >= pauseA (réglage pauseToutes)
                 // {type:'carte', paquet, carte, etat, nouvelle, rang, total, restantes}
                 // {type:'fin', bilan}
  ficheVue()     // passe l'étape fiche
  continuer()    // après la pause : pauseA += pauseToutes
  noter({verdict, correcteur, reponse, duree, confiance, maintenant, appareil})
     // calcule review(etat, noteDe(verdict), maintenant) ; si faux : remet la carte 4 positions plus loin
     // → {etatAvant, etatApres, ligne, ops: [{type:'srs'…}, {type:'reponse'…}]} et avance
  passer()       // « suivant » sans réponse : remet la carte en fin de file, sans note
  get bilan()    // {faites, justes, partielles, fausses, minutes, fichesARelire: [ficheId]}
}
```
- La micro-fiche montrée avant une nouvelle carte : `carte.fiche` si `donnees.fiches[carte.fiche]` existe, sinon `donnees.fiches[paquet]` si elle existe, sinon rien.
- `enAvance` : rien n'est dû → les 20 révisions les plus proches.
- Une carte est « nouvelle » si `donnees.srs[paquet]?.[id]` est absent.

### `js/qcm.js`
```js
export function scorer(qcm, cochees /* ['A','C'] */, bareme = [1, 0.5, 0.2, 0])  // {points, discordances, detail: [{l, vrai, cochee, ok}]}
export function etatQcm(qcmId, journal)     // {tentatives, derniere, etape: 0|1|2|'fini', due: ms|null}
   // raté (points < 1) → due = ts + 2 j, etape 1 ; réussi à l'étape 1 → due = ts + 7 j, etape 2 ; réussi à l'étape 2 ou réussi d'emblée → 'fini' (due null) ; raté à n'importe quelle étape → étape 1
export function qcmProposables(donnees)     // statut valide, ou brouillon vérifié ; jamais signalé
export function coursVus(donnees)           // cours dont au moins une carte du paquet a un état
export function choisirQcm(donnees, maintenant, {n, cours = null, rnd})  // dus d'abord (due < finJourParis), puis jamais faits des cours vus, puis les plus anciens ; mélangés
export function ligneQcm({qcm, cochees, resultat, duree, maintenant, appareil})   // ligne du journal
```

### `js/stats.js`
```js
export function parJour(donnees, maintenant, n = 14)   // [{jour, acquises, reponses, justes, nouvelles, qcm, pointsQcm}] du plus récent au plus ancien ;
   // jours antérieurs au journal : historique-v1 (n → reponses, right → justes, nw → nouvelles, acquises null) ;
   // acquises d'un jour passé = cartes dont la dernière réponse du jour est juste ou partielle (contestations appliquées) ; aujourd'hui = acquisesDuJour
export function parUE(donnees, maintenant)   // [{ue, nom, coursTotal, coursEnCartes, cartes, cartesVues, retention7j (0..1|null), moyenneQcm (0..1|null)}]
export function contestationsParSemaine(donnees)  // [{semaine: 'AAAA-Snn', contestations, acceptees, reponses}]
export function lignesEffectives(reponses)   // applique les contestations (remplace) → lignes à compter
```
`retention7j` : part des réponses de révision (nouvelle:false), sur les 7 derniers jours, dont le verdict est juste ou partiel.

### `js/voix.js`
```js
export function reconnaissanceDisponible(win = globalThis)   // SpeechRecognition || webkitSpeechRecognition
export class Ecoute extends EventTarget {   // événements : 'partiel' (detail: texte en cours), 'fin' (detail: texte final), 'erreur' (detail: code)
  constructor({lang = 'fr-FR', silence = 2500, Reco})
  demarrer()     // Promise<texte final> ; arrêt après `silence` ms sans nouveau résultat, ou au bouton (arreter) ; gère le doublon de Chrome Android
  arreter()
  annuler()
}
export class Parole {   // speechSynthesis
  constructor({vitesse = 1, voixNom = '', synth, Utterance})
  voixFrancaises()      // [{nom, lang, locale}] (attend voiceschanged)
  async dire(texte)     // résout à la fin (avec garde-fou de durée ; découpe les longs textes par phrases)
  arreter()
}
export function commande(texte)     // 'je-ne-sais-pas'|'repete'|'suivant'|'pause'|'reprendre'|'conteste'|'stop'|null (énoncé entier, tolérant)
export function lettresQcm(texte)   // ['A','C'] ou null : « A et C », « a, c », « réponses B D », « bé et dé », « toutes », « A B C »
export async function verrouEcran(nav = navigator, doc = document)   // Wake Lock ; ré-acquis au retour au premier plan ; renvoie une fonction de libération
```

### `js/mainslibres.js`
Machine à états testable, dépendances injectées :
```js
export class MainsLibres extends EventTarget {   // événement 'etat' (detail: {phase, texte, carte, resultat, message})
  constructor({seance, corriger, parole, ecoute, enregistrer, contester, qcm?})
  // phases : 'lecture-fiche' | 'question' | 'ecoute' | 'correction' | 'verdict' | 'attente-commande' | 'pause' | 'fin' | 'erreur'
  async demarrer(); pause(); reprendre(); arreter()
}
```
Déroulé d'une carte : dire la question (`texteOral`) → écouter → si commande : « répète » (relire, réécouter), « je ne sais pas » (faux), « suivant » (passer), « pause » → sinon corriger → `enregistrer` (ops) → dire le verdict : « Juste. » / « Partiel : il manquait … » (1re idée manquante) / « Faux : la réponse était … » (`refText`, tronqué à ~25 mots) → écouter 3 s une commande (« je conteste » → demander « Pourquoi ? », écouter la raison, contester, dire l'issue ; « répète » → relire le verdict) → carte suivante. Avant une nouvelle fiche : dire « Nouvelle fiche : <titre>. Lis-la à l'écran, puis dis « suivant ». » et attendre « suivant ». QCM en mains libres : lire l'énoncé puis « A : … », … ; écouter les lettres (`lettresQcm`) ; dire les points et les bonnes lettres.

## 4. Interface

### Coquille (`index.html`, `js/app.js`, `js/ui/commun.js`)
- En-tête collant : nom « Rappel », **compteur « Acquises : X/30 »** (barre fine qui se remplit ; à 30 : ✓ et couleur de réussite), état de synchro en mots courts (« Enregistré », « 3 réponses en attente d'envoi », « Hors ligne : tout est gardé sur l'appareil », « Sans lien avec tes données »), cliquable → détail dans Réglages.
- Barre d'onglets en bas (4) : **Aujourd'hui**, **QCM**, **Suivi**, **Réglages**. Pendant une séance, la barre d'onglets est masquée (plein écran, bouton « Terminer » en haut).
- `commun.js` exporte : `h(tag, attrs, ...enfants)` (attrs : `class`, `text`, `on<Evenement>`, `aria-*`, `data-*`, `hidden`, `disabled`, `value`, `type`, `for`, `id`, `role`, `tabindex`, `placeholder`, `href`, `target`, `rel`, `src`, `alt`, `title`, `name`, `checked`, `min`, `max`, `step` ; enfants : chaînes → nœuds texte, null/false ignorés, tableaux aplatis), `$(id)`, `toast(message)`, `bouton(libelle, {principal, discret, onClick, icone})`, `ficheNoeud(fiche)`, `ouvrirFiche(fiche)` (surimpression plein écran, fermeture par bouton et Échap), `verdictNoeud(resultat)`, `pastilles(options, actif, onChoix)`, `icone(nom)` (SVG construits par `document.createElementNS`, pas de chaîne HTML).
- Contexte partagé passé à chaque écran : `ctx = {sync, donnees(), reglages(), cles(), aller(vue, params), toast, appareil, maintenant(), idf()}`.

### Premiers pas (`ui/accueil.js`) — si aucun jeton enregistré
Carte de bienvenue en 3 étapes numérotées, chacune avec une phrase d'explication, un lien direct et un champ :
1. « Relier tes cartes » : jeton GitHub (lien vers la page de création de jeton à accès fin, avec la marche à suivre en 4 lignes) → bouton « Vérifier » (appelle `verifier()` ; message clair si refusé).
2. « Correction intelligente (facultatif) » : clé Gemini (lien AI Studio, 3 lignes) → « Vérifier ». Sans clé : « La correction se fera sur ton appareil, plus stricte. Tu pourras ajouter la clé plus tard dans Réglages. »
3. « C'est parti » : résumé de ce qui va se passer (« Chaque jour : tes révisions, puis tes nouvelles cartes. Objectif : 30 cartes acquises. ») → bouton « Commencer ».
L'appli reste utilisable sans jeton en mode démonstration ? Non : sans jeton, rien à réviser ; l'écran explique pourquoi.

### Aujourd'hui (`ui/aujourdhui.js`)
- Bloc principal : « Ta séance du jour » ; chiffres « X révisions · Y nouvelles cartes · environ Z min » (Z ≈ 0,6 min par carte) ; **grand bouton « Commencer »** ; dessous, bouton secondaire « Mains libres » (icône casque) avec une ligne d'explication (« Je lis les questions, tu réponds à voix haute »), masqué si la reconnaissance vocale manque (remplacé par une note sur le micro du clavier).
- Pastilles des paquets (défilement horizontal) : « Tout » + un paquet par pastille avec son nombre de cartes du jour.
- Rien à faire : « Tout est fait pour aujourd'hui » + boutons « Faire des QCM » et « Réviser en avance ».
- Objectif atteint : bandeau de réussite (« 30 cartes acquises : objectif du jour atteint. Tu peux t'arrêter ou continuer. »).

### Séance (`ui/seance.js`)
- Haut : barre de progression fine, « Carte 3 sur 64 », bouton « Terminer » (deux appuis pour confirmer).
- Étape fiche : titre « Avant les nouvelles cartes : la micro-fiche », fiche, bouton « J'ai lu, on y va ».
- Carte : étiquette (« Révision » / « Nouvelle »), nom du paquet, question en grand (serif), consigne courte selon le type (« Une réponse précise. », « Complète les blancs, dans l'ordre. », « Explique le mécanisme. »), champ de réponse large, **bouton micro** rond dans le champ (texte affiché en direct ; état « J'écoute… » visible ; arrêt au bouton ou après le silence), bouton principal « Corriger » (Ctrl+Entrée), boutons secondaires « Je ne sais pas » et « Voir la réponse » (champ vide : montre la réponse et trois boutons « Je l'avais » / « En partie » / « Non » → correcteur `auto`).
- Pendant la correction : « Correction… » (indicateur), pas plus de 15 s.
- Verdict : bandeau coloré avec icône (Juste / Partiel / Faux), « revient dans 4 jours », listes « Ce que tu as dit de juste », « Ce qui manquait », « Erreur » ; explication ; « Réponse attendue » ; lien « Voir la fiche : <titre> » ; badge du correcteur (« Corrigé par Gemini », « Corrigé sur l'appareil », « Corrigé hors ligne », « Reconnu (déjà accepté) ») ; **bouton principal « Suivant »** (Entrée) ; lien discret « Je conteste » en bas → zone « Dis pourquoi (facultatif) » + micro + « Envoyer » → second avis → message « Tu avais raison : verdict corrigé » ou l'explication.
- Pause à 30 cartes faites (comme v1) ; à 30 acquises : message de réussite une fois.
- Fin : bilan (réponses, justes, durée), fiches à relire, bouton « Faire N QCM » si des QCM sont proposables, sinon « Retour ». Envoi des données à la fin.

### QCM (`ui/qcm.js`)
- Accueil QCM : « Mélange des cours vus » (n = `qcmParSeance`) en principal ; liste des cours avec nombre de QCM, moyenne, bouton « Générer 5 QCM » (si clé Gemini ; explication : « à partir de tes cartes et de la fiche, vérifiés par un second passage »).
- Question : énoncé, 5 lignes A à E (cases larges, état coché visible), « Valider » ; correction : chaque proposition marquée vraie/fausse, ta case, ✓/✗, explication ; points (« 0,5 point : 1 discordance ») ; « Signaler une erreur » (discret, motif facultatif) ; « Suivant ».
- Barème expliqué en une ligne (« 0 erreur = 1 point, 1 = 0,5, 2 = 0,2, 3 ou plus = 0 »).

### Suivi (`ui/suivi.js`)
- Aujourd'hui : acquises / objectif, réponses, justes, nouvelles, points QCM.
- 14 derniers jours : barres simples (acquises ; repli sur réponses pour les jours de v1) avec chiffres.
- Par UE : couverture (cours en cartes / cours du plan), rétention sur 7 jours, moyenne aux QCM.
- Correction : contestations par semaine (et acceptées).
- « Comment ça marche » (dépliable) : 6 phrases simples (rappel actif, espacement, correction, objectif, mains libres, synchro).

### Réglages (`ui/reglages.js`)
Sections : **Mes clés** (jeton GitHub, clé Gemini : champ masqué + « Vérifier » + « Retirer » ; rappel : « gardées seulement sur cet appareil ») ; **Rythme** (nouvelles cartes par jour, objectif, ordre des paquets avec flèches monter/descendre) ; **QCM** (QCM par séance, barème : 4 nombres) ; **Voix** (voix française, vitesse avec bouton « Écouter », silence avant correction en secondes) ; **Correction** (modèles Gemini, avancé ; bouton « Tester la correction » → § 9) ; **Données** (état de synchro détaillé, « Synchroniser maintenant », nom de l'appareil, dépôt avancé, « Effacer les données de cet appareil » avec confirmation) ; version.

### Mains libres (`ui/mainslibres.js`)
Plein écran sombre et calme : grand indicateur d'état (« Je lis la question… », « Je t'écoute… » avec onde animée, « Correction… », verdict), texte de la question et de ta réponse en direct, compteur « Acquises X/30 », boutons très grands « Pause » / « Reprendre » et « Arrêter », aide-mémoire des commandes vocales toujours visible (« je ne sais pas · répète · suivant · pause · je conteste »). Écran maintenu allumé.

### Apparence (`style.css`)
Identité des micro-fiches : fond « papier d'ECG » (quadrillage fin), rouge artériel (accent principal, action), bleu veineux (secondaire, information), encre sombre ; polices Newsreader (titres, questions), Atkinson Hyperlegible (texte, interface), IBM Plex Mono (chiffres, compteurs). Variables CSS sur `:root`, thème sombre via `@media (prefers-color-scheme: dark)` et `[data-theme]`. Verdicts : juste = vert sobre, partiel = ambre, faux = rouge ; jamais la couleur seule (icône + mot). Mobile d'abord (≤ 480 px), centrage max 680 px sur PC, aucune barre de défilement horizontale, `env(safe-area-inset-*)` respecté.

## 5. Service worker et installation
- `sw.js` : cache versionné (`rappel-v<VERSION>`) de la coquille (index, style, tous les modules, icônes, manifeste) ; navigation et fichiers de l'appli : réseau d'abord avec repli sur le cache (mises à jour prises dès qu'il y a du réseau) ; polices Google : cache d'abord ; **jamais** d'interception pour `api.github.com` et `generativelanguage.googleapis.com` (pas de `respondWith`). `skipWaiting` + `clients.claim` ; nettoyage des anciens caches.
- `manifest.webmanifest` : `name` « Rappel », `short_name` « Rappel », `start_url` « ./ », `scope` « ./ », `display` « standalone », couleurs du thème, icônes 192, 512, maskable 512.

## 6. Tests
- Unitaires (`node --test tests/unit/`) : FSRS identique à v1 (fixture `tests/fixtures/fsrs-v1.json` générée depuis le code de v1), temps de Paris (changements d'heure), « dû dès minuit » et retour à +10 min, ordre de séance, limite de nouvelles cartes, fiche avant la 1re nouvelle carte, compteur d'acquises, correcteur local (réponses attendues justes, fautes, accents, abréviations, paraphrases, pièges refusés, antonymes), Gemini (corps de requête, schéma, analyse, erreurs, avec `fetch` simulé), GitHub (chemins, écriture, conflit avec `fetch` simulé), fusion, ops, synchro (conflit entre deux appareils simulés), QCM (barème, échéances 2 j / 7 j, choix), stats, voix (commandes, lettres, Ecoute avec reconnaissance simulée, doublons Android), mains libres (machine à états avec dépendances simulées).
- E2E (`node --test tests/e2e/`, Playwright, Chromium de `/opt/pw-browsers`) : serveur statique local ; `api.github.com` simulé par un faux dépôt en mémoire (`tests/e2e/faux-github.mjs`), Gemini simulé, reconnaissance et synthèse vocales simulées (`addInitScript`) ; vue téléphone 390×844 et PC 1280×800 ; thèmes clair et sombre ; scénarios : premiers pas, séance complète (révisions puis fiche puis nouvelles cartes, compteur, envoi groupé en un commit), correction hors ligne, contestation, QCM, mains libres, hors ligne via service worker ; captures dans `tests/e2e/captures/` (ignorées par git) ; aucune erreur console ; aucun débordement horizontal.
- `outils/verifier-donnees.mjs <dossier rappel/>` : schémas, unicité des ids, barèmes (≥ 2 formulations par idée, réponse attendue jugée juste par `corrigerLocal`), QCM (5 propositions A-E, ≥ 1 vraie, explications), plan (paquets et fiches référencés existants).

## 7. Ce qui ne part jamais dans le dépôt public
Aucune clé, aucun jeton, aucune donnée de progression, aucune carte réelle (les tests utilisent des cartes synthétiques ou lisent les vraies données depuis un chemin passé en argument).

## 8. Auteur des commits
Commits du dépôt public signés du nom du compte GitHub (`lmaisonneuve02-cmyk`, adresse noreply GitHub), sans pseudonyme.

## 9. Essai de la correction (calibration)
Réglages → Correction → « Tester la correction » (clé Gemini requise) : passe 30 cas fournis par le dépôt `etudes` (`rappel/progres/calibration/cas.json` : `[{carte, paquet, reponse, attendu}]`) à Gemini, affiche l'accord avec le verdict attendu (en %), la liste des désaccords, et enregistre le résultat dans `progres/calibration/<jour>.json` (op `fichier`) pour que Claude ajuste le prompt.
