// Faux GitHub en mémoire : un petit dépôt git simulé (refs, commits, arbres récursifs, blobs)
// derrière un `fetch` compatible avec l'API REST. Sert aux tests unitaires et E2E.
import { createHash } from 'node:crypto';

const sha1 = s => createHash('sha1').update(s).digest('hex');

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999' };

const repondre = (status, corps, entetes = {}) =>
  new Response(corps === undefined ? null : JSON.stringify(corps), { status, headers: { ...JSON_TYPE, ...entetes } });

const erreur = (status, message, entetes) => repondre(status, { message, documentation_url: 'https://docs.github.com/rest' }, entetes);

/**
 * creerFauxGitHub({fichiers: {path: texte}, proprietaire, depot, branche, jeton, prive, ecriture, brut})
 * → {fetch, fichiers(), commits(), forcerCommitConcurrent(fichiers), requetes(), viderRequetes(),
 *    intercepter(fn), horsLigne(bool), tete()}
 */
export function creerFauxGitHub({
  fichiers = {}, proprietaire = 'moi', depot = 'etudes', branche = 'main',
  jeton = null, prive = true, ecriture = true, brut = true,
} = {}) {
  const objets = new Map();   // sha → blob | tree | commit
  const refs = new Map();     // 'heads/main' → sha du commit
  const journal = [];         // requêtes reçues
  let numero = 0;
  let intercepteur = null;
  let deconnecte = false;

  // --- Objets git ---
  function blob(texte) {
    const sha = sha1(`blob ${Buffer.byteLength(texte)}\0${texte}`);
    objets.set(sha, { type: 'blob', texte });
    return sha;
  }

  // Arbre récursif depuis {chemin: shaBlob} ; renvoie le sha de la racine.
  function arbreDepuis(plat) {
    const enfants = new Map();
    for (const [path, sha] of Object.entries(plat)) {
      const i = path.indexOf('/');
      if (i < 0) { enfants.set(path, { type: 'blob', sha }); continue; }
      const nom = path.slice(0, i);
      const sous = enfants.get(nom)?.plat || {};
      sous[path.slice(i + 1)] = sha;
      enfants.set(nom, { type: 'tree', plat: sous });
    }
    const entrees = [...enfants.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([nom, e]) => (e.type === 'blob'
      ? { name: nom, mode: '100644', type: 'blob', sha: e.sha }
      : { name: nom, mode: '040000', type: 'tree', sha: arbreDepuis(e.plat) }));
    const sha = sha1('tree ' + JSON.stringify(entrees));
    objets.set(sha, { type: 'tree', entrees });
    return sha;
  }

  // {chemin: shaBlob} depuis un arbre.
  function aplatir(sha, prefixe = '', sortie = {}) {
    for (const e of objets.get(sha).entrees) {
      if (e.type === 'tree') aplatir(e.sha, prefixe + e.name + '/', sortie);
      else sortie[prefixe + e.name] = e.sha;
    }
    return sortie;
  }

  function lister(sha, recursif, prefixe = '', sortie = []) {
    for (const e of objets.get(sha).entrees) {
      sortie.push({ path: prefixe + e.name, mode: e.mode, type: e.type, sha: e.sha, ...(e.type === 'blob' ? { size: Buffer.byteLength(objets.get(e.sha).texte) } : {}) });
      if (recursif && e.type === 'tree') lister(e.sha, true, prefixe + e.name + '/', sortie);
    }
    return sortie;
  }

  function commit(arbre, parents, message) {
    const sha = sha1(`commit ${++numero} ${arbre} ${parents.join(',')} ${message}`);
    objets.set(sha, { type: 'commit', tree: arbre, parents, message });
    return sha;
  }

  function descendDe(sha, ancetre) {
    const pile = [sha];
    const vus = new Set();
    while (pile.length) {
      const s = pile.pop();
      if (s === ancetre) return true;
      if (vus.has(s)) continue;
      vus.add(s);
      pile.push(...(objets.get(s)?.parents || []));
    }
    return false;
  }

  const teteSha = () => refs.get('heads/' + branche);
  const platDe = commitSha => aplatir(objets.get(commitSha).tree);

  // Applique {chemin: texte|null} à un plat ; null supprime le fichier (ou le dossier).
  function modifier(plat, changements) {
    const p = { ...plat };
    for (const [path, texte] of Object.entries(changements)) {
      if (texte === null) {
        for (const k of Object.keys(p)) if (k === path || k.startsWith(path + '/')) delete p[k];
      } else p[path] = blob(texte);
    }
    return p;
  }

  // Dépôt initial.
  refs.set('heads/' + branche, commit(arbreDepuis(modifier({}, fichiers)), [], 'Premier commit'));

  // --- Routes ---
  function traiter(methode, chemin, recherche, corps, entetes) {
    const auth = entetes.get('authorization') || '';
    if (!/^Bearer \S+/.test(auth) || (jeton && auth !== `Bearer ${jeton}`)) return erreur(401, 'Bad credentials');
    const prefixe = `/repos/${proprietaire}/${depot}`;
    if (chemin !== prefixe && !chemin.startsWith(prefixe + '/')) return erreur(404, 'Not Found');
    const route = chemin.slice(prefixe.length);
    let m;

    if (methode === 'GET' && route === '') {
      return repondre(200, { full_name: `${proprietaire}/${depot}`, private: prive, permissions: { admin: false, push: ecriture, pull: true } });
    }
    if (methode === 'GET' && (m = route.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = refs.get('heads/' + m[1]);
      if (!sha) return erreur(404, 'Not Found');
      return repondre(200, { ref: 'refs/heads/' + m[1], object: { sha, type: 'commit' } });
    }
    if (methode === 'GET' && (m = route.match(/^\/git\/commits\/([0-9a-f]{40})$/))) {
      const c = objets.get(m[1]);
      if (c?.type !== 'commit') return erreur(404, 'Not Found');
      return repondre(200, { sha: m[1], message: c.message, tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })) });
    }
    if (methode === 'GET' && (m = route.match(/^\/git\/trees\/([0-9a-f]{40})$/))) {
      if (objets.get(m[1])?.type !== 'tree') return erreur(404, 'Not Found');
      return repondre(200, { sha: m[1], tree: lister(m[1], recherche.get('recursive') === '1'), truncated: false });
    }
    if (methode === 'GET' && (m = route.match(/^\/git\/blobs\/([0-9a-f]{40})$/))) {
      const b = objets.get(m[1]);
      if (b?.type !== 'blob') return erreur(404, 'Not Found');
      if (brut && /vnd\.github\.raw/.test(entetes.get('accept') || '')) {
        return new Response(b.texte, { status: 200, headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' } });
      }
      const b64 = Buffer.from(b.texte, 'utf8').toString('base64').replace(/.{60}/g, '$&\n');
      return repondre(200, { sha: m[1], size: Buffer.byteLength(b.texte), encoding: 'base64', content: b64 });
    }
    if (methode !== 'GET' && !ecriture) return erreur(403, 'Resource not accessible by personal access token');

    if (methode === 'POST' && route === '/git/trees') {
      let plat = {};
      if (corps.base_tree) {
        if (objets.get(corps.base_tree)?.type !== 'tree') return erreur(422, 'Invalid tree info');
        plat = aplatir(corps.base_tree);
      }
      for (const e of corps.tree || []) {
        if (e.sha === null) {
          if (!Object.keys(plat).some(k => k === e.path || k.startsWith(e.path + '/'))) return erreur(422, `Path not found: ${e.path}`);
          plat = modifier(plat, { [e.path]: null });
        } else if (typeof e.content === 'string') plat[e.path] = blob(e.content);
        else if (objets.get(e.sha)?.type === 'blob') plat[e.path] = e.sha;
        else return erreur(422, 'Invalid tree entry');
      }
      const sha = arbreDepuis(plat);
      return repondre(201, { sha, tree: lister(sha, false), truncated: false });
    }
    if (methode === 'POST' && route === '/git/commits') {
      if (objets.get(corps.tree)?.type !== 'tree') return erreur(422, 'Tree not found');
      const parents = corps.parents || [];
      if (parents.some(p => objets.get(p)?.type !== 'commit')) return erreur(422, 'Parent not found');
      const sha = commit(corps.tree, parents, corps.message || '');
      return repondre(201, { sha, message: corps.message, tree: { sha: corps.tree }, parents: parents.map(p => ({ sha: p })) });
    }
    if (methode === 'PATCH' && (m = route.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const cle = 'heads/' + m[1];
      const actuel = refs.get(cle);
      if (!actuel) return erreur(422, 'Reference does not exist');
      if (objets.get(corps.sha)?.type !== 'commit') return erreur(422, 'Object does not exist');
      if (!corps.force && !descendDe(corps.sha, actuel)) return erreur(422, 'Update is not a fast forward');
      refs.set(cle, corps.sha);
      return repondre(200, { ref: 'refs/' + cle, object: { sha: corps.sha, type: 'commit' } });
    }
    return erreur(404, 'Not Found');
  }

  async function fetch(url, options = {}) {
    const u = new URL(String(url));
    const methode = (options.method || 'GET').toUpperCase();
    const corps = options.body ? JSON.parse(options.body) : undefined;
    const chemin = decodeURIComponent(u.pathname);
    const requete = { methode, chemin, recherche: u.search, corps };
    journal.push(requete);
    if (deconnecte) throw new TypeError('fetch failed');
    if (intercepteur) {
      const r = await intercepteur(requete);
      if (r) return r;
    }
    if (u.hostname !== 'api.github.com') throw new TypeError('fetch failed');
    return traiter(methode, chemin, u.searchParams, corps, new Headers(options.headers || {}));
  }

  return {
    fetch,
    // Fichiers de la tête de branche {chemin: texte}.
    fichiers() {
      const sortie = {};
      for (const [path, sha] of Object.entries(platDe(teteSha()))) sortie[path] = objets.get(sha).texte;
      return sortie;
    },
    // Commits de la branche, du plus ancien au plus récent, avec les chemins modifiés.
    commits() {
      const liste = [];
      for (let s = teteSha(); s; s = objets.get(s).parents[0]) liste.unshift(s);
      return liste.map(sha => {
        const c = objets.get(sha);
        const apres = platDe(sha), avant = c.parents[0] ? platDe(c.parents[0]) : {};
        const chemins = [...new Set([...Object.keys(avant), ...Object.keys(apres)])].filter(p => avant[p] !== apres[p]).sort();
        return { sha, message: c.message, parents: [...c.parents], chemins };
      });
    },
    // Commit fait « par un autre appareil » sur la tête de branche.
    forcerCommitConcurrent(changements, message = 'Commit concurrent') {
      const tete = teteSha();
      const sha = commit(arbreDepuis(modifier(platDe(tete), changements)), [tete], message);
      refs.set('heads/' + branche, sha);
      return sha;
    },
    requetes: () => journal.map(r => ({ ...r })),
    viderRequetes: () => { journal.length = 0; },
    // fn(requete) : peut renvoyer une Response (servie à la place), lever une erreur, ou agir puis laisser passer.
    intercepter: fn => { intercepteur = fn; },
    horsLigne: (oui = true) => { deconnecte = oui; },
    tete: () => teteSha(),
  };
}
