import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientGitHub, ErreurGitHub } from '../../js/github.js';
import { creerFauxGitHub } from '../fixtures/faux-github.mjs';

const FICHIERS = {
  'rappel/plan.json': '{\n "semestre": "S5"\n}\n',
  'rappel/paquets/essai.json': '{\n "nom": "Cœur · Artères élastiques — « essai »"\n}\n',
  'rappel/v1/index.html': '<!doctype html>',
  'docs/notes.md': '# Notes\n',
};

const client = (gh, extra = {}) => new ClientGitHub({ jeton: 'jeton-test', proprietaire: 'moi', depot: 'etudes', fetch: gh.fetch, ...extra });

// Faux fetch qui renvoie toujours la même réponse et garde la requête.
function fetchFixe(status, corps = {}, entetes = {}) {
  const vues = [];
  const f = async (url, options) => {
    vues.push({ url, options });
    return new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json', ...entetes } });
  };
  f.vues = vues;
  return f;
}

test('tete, arbre, blob : chemins, en-têtes et accents', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS });
  const c = client(gh);
  const tete = await c.tete();
  assert.match(tete.commit, /^[0-9a-f]{40}$/);
  assert.match(tete.arbre, /^[0-9a-f]{40}$/);
  const arbre = await c.arbre(tete.arbre);
  const blobs = arbre.filter(e => e.type === 'blob').map(e => e.path).sort();
  assert.deepEqual(blobs, Object.keys(FICHIERS).sort());
  assert.ok(arbre.some(e => e.type === 'tree' && e.path === 'rappel/paquets'));
  const e = arbre.find(x => x.path === 'rappel/paquets/essai.json');
  assert.equal(await c.blob(e.sha), FICHIERS['rappel/paquets/essai.json']);
  assert.deepEqual(gh.requetes().map(r => `${r.methode} ${r.chemin}${r.recherche}`), [
    'GET /repos/moi/etudes/git/ref/heads/main',
    `GET /repos/moi/etudes/git/commits/${tete.commit}`,
    `GET /repos/moi/etudes/git/trees/${tete.arbre}?recursive=1`,
    `GET /repos/moi/etudes/git/blobs/${e.sha}`,
  ]);
});

test('en-têtes : jeton en Bearer, version, pas de cache', async () => {
  const f = fetchFixe(200, { private: true, permissions: { push: true } });
  const c = new ClientGitHub({ jeton: 'abc', proprietaire: 'moi', depot: 'etudes', fetch: f });
  assert.deepEqual(await c.verifier(), { ok: true, prive: true, ecriture: true });
  const { url, options } = f.vues[0];
  assert.equal(url, 'https://api.github.com/repos/moi/etudes');
  assert.equal(options.headers.Authorization, 'Bearer abc');
  assert.equal(options.headers.Accept, 'application/vnd.github+json');
  assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(options.cache, 'no-store');
  assert.ok(!url.includes('abc'));
});

test('blob : contenu base64 décodé en UTF-8 si le serveur ignore le format brut', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS, brut: false });
  const c = client(gh);
  const arbre = await c.arbre((await c.tete()).arbre);
  for (const e of arbre.filter(x => x.type === 'blob')) assert.equal(await c.blob(e.sha), FICHIERS[e.path]);
});

test('ecrire : un seul commit (ajout, modification, suppression)', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS });
  const c = client(gh);
  const base = await c.tete();
  gh.viderRequetes();
  const nouvelle = await c.ecrire({
    base,
    fichiers: {
      'rappel/progres/srs/essai.json': '{\n "cards": {}\n}\n',
      'rappel/plan.json': '{\n "semestre": "S6 — été"\n}\n',
      'docs/notes.md': null,
    },
    message: 'Rappel : séance du 12/10 (2 réponses)',
  });
  assert.deepEqual(gh.requetes().map(r => r.methode + ' ' + r.chemin.replace('/repos/moi/etudes', '')), [
    'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main',
  ]);
  const [arbre, commit, ref] = gh.requetes().map(r => r.corps);
  assert.equal(arbre.base_tree, base.arbre);
  assert.deepEqual(arbre.tree.find(e => e.path === 'docs/notes.md'), { path: 'docs/notes.md', mode: '100644', type: 'blob', sha: null });
  assert.equal(arbre.tree.find(e => e.path === 'rappel/plan.json').content, '{\n "semestre": "S6 — été"\n}\n');
  assert.deepEqual(commit.parents, [base.commit]);
  assert.deepEqual(ref, { sha: nouvelle.commit, force: false });
  assert.equal(gh.tete(), nouvelle.commit);
  const fichiers = gh.fichiers();
  assert.equal(fichiers['rappel/plan.json'], '{\n "semestre": "S6 — été"\n}\n');
  assert.equal(fichiers['docs/notes.md'], undefined);
  assert.equal(fichiers['rappel/v1/index.html'], '<!doctype html>');
  const commits = gh.commits();
  assert.equal(commits.length, 2);
  assert.equal(commits[1].message, 'Rappel : séance du 12/10 (2 réponses)');
  assert.deepEqual(commits[1].chemins, ['docs/notes.md', 'rappel/plan.json', 'rappel/progres/srs/essai.json']);
  assert.equal((await c.tete()).arbre, nouvelle.arbre);
});

test('ecrire : rien à écrire → aucune requête', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS });
  const c = client(gh);
  const base = await c.tete();
  gh.viderRequetes();
  assert.deepEqual(await c.ecrire({ base, fichiers: {}, message: 'x' }), base);
  assert.equal(gh.requetes().length, 0);
});

test('ecrire : tête déplacée entre-temps → conflit, rien de perdu', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS });
  const c = client(gh);
  const base = await c.tete();
  gh.forcerCommitConcurrent({ 'rappel/plan.json': '{}\n' });
  await assert.rejects(c.ecrire({ base, fichiers: { 'rappel/plan.json': '{"a":1}\n' }, message: 'x' }),
    e => e instanceof ErreurGitHub && e.code === 'conflit' && e.status === 422);
  assert.equal(gh.fichiers()['rappel/plan.json'], '{}\n');
  assert.equal(gh.commits().length, 2);
});

test('erreurs : statuts traduits en codes avec un message clair', async () => {
  const cas = [
    [401, {}, 'jeton'],
    [403, { 'x-ratelimit-remaining': '0' }, 'limite'],
    [429, {}, 'limite'],
    [403, {}, 'droits'],
    [404, {}, 'introuvable'],
    [500, {}, 'serveur'],
    [503, {}, 'serveur'],
  ];
  for (const [status, entetes, code] of cas) {
    const c = new ClientGitHub({ jeton: 'j', proprietaire: 'moi', depot: 'etudes', fetch: fetchFixe(status, { message: 'non' }, entetes) });
    await assert.rejects(c.verifier(), e => {
      assert.ok(e instanceof ErreurGitHub);
      assert.equal(e.code, code, `statut ${status}`);
      assert.equal(e.status, status);
      assert.ok(e.message.length > 10 && !/token|api/i.test(e.message), e.message);
      return true;
    });
  }
  // 403 « secondary rate limit » avec retry-after → limite, attente en ms
  const c = new ClientGitHub({ jeton: 'j', proprietaire: 'moi', depot: 'etudes', fetch: fetchFixe(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '60' }) });
  await assert.rejects(c.verifier(), e => e.code === 'limite' && e.attente === 60000);
});

test('erreurs : 409 / 422 hors de la ref → serveur ; sur la ref → conflit', async () => {
  const c = new ClientGitHub({ jeton: 'j', proprietaire: 'moi', depot: 'etudes', fetch: fetchFixe(409, { message: 'Git Repository is empty.' }) });
  await assert.rejects(c.tete(), e => e.code === 'serveur' && e.status === 409);
  const gh = creerFauxGitHub({ fichiers: FICHIERS });
  const c2 = client(gh);
  const base = await c2.tete();
  gh.intercepter(r => (r.methode === 'PATCH' ? new Response('{"message":"conflict"}', { status: 409 }) : undefined));
  await assert.rejects(c2.ecrire({ base, fichiers: { 'a.json': '{}' }, message: 'x' }), e => e.code === 'conflit' && e.status === 409);
});

test('erreurs : pas de réseau → reseau ; jeton refusé par le faux GitHub → jeton', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS, jeton: 'bon' });
  await assert.rejects(client(gh, { jeton: 'mauvais' }).tete(), e => e.code === 'jeton' && e.status === 401);
  gh.horsLigne();
  await assert.rejects(client(gh, { jeton: 'bon' }).tete(), e => e.code === 'reseau' && e.status === 0);
  const leve = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(new ClientGitHub({ jeton: 'j', proprietaire: 'a', depot: 'b', fetch: leve }).verifier(), e => e.code === 'reseau');
});

test('erreurs : dépôt inconnu → introuvable ; jeton en lecture seule → droits', async () => {
  const gh = creerFauxGitHub({ fichiers: FICHIERS, ecriture: false });
  await assert.rejects(client(gh, { depot: 'autre' }).tete(), e => e.code === 'introuvable');
  const c = client(gh);
  assert.deepEqual(await c.verifier(), { ok: true, prive: true, ecriture: false });
  await assert.rejects(c.ecrire({ base: await c.tete(), fichiers: { 'a.json': '{}' }, message: 'x' }), e => e.code === 'droits');
});

test('délai dépassé → reseau', async () => {
  const lent = (url, { signal }) => new Promise((_, ko) => signal.addEventListener('abort', () => ko(new DOMException('abandon', 'AbortError'))));
  const c = new ClientGitHub({ jeton: 'j', proprietaire: 'a', depot: 'b', fetch: lent, delai: 20 });
  await assert.rejects(c.tete(), e => e.code === 'reseau');
});

test('fetch appelé détaché (pas d\'« Illegal invocation » dans le navigateur)', async () => {
  let ceci = 'non appelé';
  function f() { ceci = this; return Promise.resolve(new Response('{"private":false,"permissions":{"push":false}}', { status: 200 })); }
  await new ClientGitHub({ jeton: 'j', proprietaire: 'a', depot: 'b', fetch: f }).verifier();
  assert.equal(ceci, undefined);
});
