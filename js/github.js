// Client minimal de l'API GitHub (Git Data) : lire l'arbre et les fichiers, écrire en un commit.
const API = 'https://api.github.com';

const MESSAGES = {
  jeton: "Le jeton d'accès est refusé (expiré ou mal copié). Colle un nouveau jeton dans Réglages.",
  droits: "Le jeton n'a pas le droit d'écrire dans le dépôt. Donne-lui l'accès « Contenu : lecture et écriture ».",
  introuvable: 'Dépôt introuvable : vérifie son nom dans Réglages, et que le jeton y a accès.',
  conflit: 'Un autre appareil a enregistré en même temps.',
  limite: 'GitHub demande de patienter un peu : nouvel essai dans quelques minutes.',
  reseau: "Pas de connexion : tout est gardé sur l'appareil.",
  serveur: 'GitHub ne répond pas correctement pour le moment : nouvel essai plus tard.',
};

export class ErreurGitHub extends Error {
  constructor(code, status = 0, detail = '') {
    super(MESSAGES[code] || MESSAGES.serveur);
    this.name = 'ErreurGitHub';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

// Texte UTF-8 depuis du base64 (avec retours à la ligne, comme GitHub les envoie).
function base64VersTexte(b64) {
  const binaire = atob(String(b64).replace(/\s/g, ''));
  const octets = Uint8Array.from(binaire, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(octets);
}

const segments = s => String(s).split('/').map(encodeURIComponent).join('/');

export class ClientGitHub {
  constructor({ jeton, proprietaire, depot, branche = 'main', fetch = globalThis.fetch, delai = 30000 }) {
    this.jeton = jeton;
    this.branche = branche;
    this.base = `${API}/repos/${encodeURIComponent(proprietaire)}/${encodeURIComponent(depot)}`;
    this.delai = delai;
    const f = fetch;
    this.fetch = (url, options) => f(url, options); // appel détaché (évite « Illegal invocation »)
  }

  // Requête JSON (ou brute) ; lève une ErreurGitHub claire en cas d'échec.
  async requete(methode, chemin, { corps, accept = 'application/vnd.github+json', brut = false, surRef = false } = {}) {
    const controle = typeof AbortController === 'function' ? new AbortController() : null;
    const minuterie = controle ? setTimeout(() => controle.abort(), this.delai) : null;
    let rep;
    try {
      rep = await this.fetch(this.base + chemin, {
        method: methode,
        headers: {
          Authorization: `Bearer ${this.jeton}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corps !== undefined ? JSON.stringify(corps) : undefined,
        cache: 'no-store',
        signal: controle?.signal,
      });
      if (!rep.ok) throw await erreurDe(rep, surRef);
      if (brut) return new TextDecoder('utf-8').decode(await rep.arrayBuffer());
      return await rep.json();
    } catch (e) {
      if (e instanceof ErreurGitHub) throw e;
      // Réponse illisible : côté serveur ; tout le reste (coupure, délai) : réseau.
      throw new ErreurGitHub(e instanceof SyntaxError ? 'serveur' : 'reseau', rep?.status || 0, String(e?.message || e));
    } finally {
      if (minuterie) clearTimeout(minuterie);
    }
  }

  async tete() {
    const ref = await this.requete('GET', `/git/ref/heads/${segments(this.branche)}`);
    const commit = await this.requete('GET', `/git/commits/${ref.object.sha}`);
    return { commit: commit.sha || ref.object.sha, arbre: commit.tree.sha };
  }

  async arbre(arbreSha) {
    const r = await this.requete('GET', `/git/trees/${arbreSha}?recursive=1`);
    return (r.tree || []).map(({ path, sha, type }) => ({ path, sha, type }));
  }

  async blob(sha) {
    const texte = await this.requete('GET', `/git/blobs/${sha}`, { accept: 'application/vnd.github.raw', brut: true });
    // Si le serveur a ignoré la demande de contenu brut : enveloppe JSON en base64.
    if (texte.startsWith('{') && texte.includes('"encoding"')) {
      try {
        const o = JSON.parse(texte);
        if (o && o.sha === sha && o.encoding === 'base64' && typeof o.content === 'string') return base64VersTexte(o.content);
      } catch { /* contenu brut qui ressemble à du JSON */ }
    }
    return texte;
  }

  // Un seul commit : arbre (contenus en ligne, null = suppression), commit, avance de la branche.
  async ecrire({ base, fichiers, message }) {
    const entrees = Object.entries(fichiers || {});
    if (!entrees.length) return { commit: base.commit, arbre: base.arbre };
    const tree = entrees.map(([path, texte]) => (texte === null
      ? { path, mode: '100644', type: 'blob', sha: null }
      : { path, mode: '100644', type: 'blob', content: texte }));
    const arbre = await this.requete('POST', '/git/trees', { corps: { base_tree: base.arbre, tree } });
    const commit = await this.requete('POST', '/git/commits', { corps: { message, tree: arbre.sha, parents: [base.commit] } });
    await this.requete('PATCH', `/git/refs/heads/${segments(this.branche)}`, { corps: { sha: commit.sha, force: false }, surRef: true });
    return { commit: commit.sha, arbre: arbre.sha };
  }

  async verifier() {
    const r = await this.requete('GET', '');
    return { ok: true, prive: !!r.private, ecriture: !!r.permissions?.push };
  }
}

// Traduit une réponse en erreur, d'après le statut et les en-têtes de limite.
async function erreurDe(rep, surRef) {
  let detail = '';
  try { detail = (await rep.json())?.message || ''; } catch { /* corps vide ou non JSON */ }
  const s = rep.status;
  const h = n => rep.headers?.get?.(n);
  let code;
  if (s === 401) code = 'jeton';
  else if (s === 429 || (s === 403 && (h('x-ratelimit-remaining') === '0' || h('retry-after') || /rate limit/i.test(detail)))) code = 'limite';
  else if (s === 403) code = 'droits';
  else if (s === 404) code = 'introuvable';
  else if (surRef && (s === 409 || s === 422)) code = 'conflit';
  else code = 'serveur';
  const e = new ErreurGitHub(code, s, detail);
  const apres = Number(h('retry-after'));
  if (code === 'limite' && apres > 0) e.attente = apres * 1000;
  return e;
}
