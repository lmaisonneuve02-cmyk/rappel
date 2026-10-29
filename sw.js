// Service worker de Rappel : la coquille de l'appli marche hors ligne.
// Jamais d'interception pour GitHub ni Gemini (pas de respondWith : le navigateur les traite seul).
const VERSION = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE = `rappel-v${VERSION}`;
const POLICES = `rappel-polices`;
const COQUILLE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/temps.js', 'js/fsrs.js', 'js/texte.js', 'js/correcteur.js', 'js/gemini.js',
  'js/correction.js', 'js/github.js', 'js/fusion.js', 'js/depot.js', 'js/stockage.js', 'js/sync.js',
  'js/seance.js', 'js/qcm.js', 'js/qcmcartes.js', 'js/coche.js', 'js/controle.js', 'js/stats.js', 'js/voix.js', 'js/ecoutegemini.js', 'js/feuille.js', 'js/mainslibres.js',
  'js/ui/commun.js', 'js/ui/accueil.js', 'js/ui/aujourdhui.js', 'js/ui/seance.js', 'js/ui/qcm.js',
  'js/ui/suivi.js', 'js/ui/reglages.js', 'js/ui/mainslibres.js', 'js/ui/feuille.js', 'js/ui/controle.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const JAMAIS = ['api.github.com', 'generativelanguage.googleapis.com'];
const POLICES_HOTES = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fichier par fichier : un échec isolé n'empêche pas l'installation.
    await Promise.all(COQUILLE.map(async chemin => {
      try {
        const rep = await fetch(new Request(chemin, { cache: 'reload' }));
        if (rep.ok) await cache.put(chemin, rep);
      } catch { /* hors ligne pendant l'installation : on réessaiera */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const cle of await caches.keys()) {
      if (cle.startsWith('rappel-v') && cle !== CACHE) await caches.delete(cle);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (JAMAIS.includes(url.hostname)) return;   // GitHub et Gemini : jamais interceptés

  // Polices Google : cache d'abord.
  if (POLICES_HOTES.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(POLICES);
      const trouve = await cache.match(req);
      if (trouve) return trouve;
      try {
        const rep = await fetch(req);
        if (rep.ok || rep.type === 'opaque') cache.put(req, rep.clone()).catch(() => {});
        return rep;
      } catch {
        return new Response('', { status: 504, statusText: 'hors ligne' });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Appli : réseau d'abord (mises à jour prises dès qu'il y a du réseau), repli sur le cache.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const rep = await fetch(req, { cache: 'no-cache' });
      if (rep.ok && rep.type === 'basic') cache.put(req, rep.clone()).catch(() => {});
      return rep;
    } catch {
      const trouve = await cache.match(req, { ignoreSearch: true });
      if (trouve) return trouve;
      if (req.mode === 'navigate') {
        const page = await cache.match('index.html') || await cache.match('./');
        if (page) return page;
      }
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
