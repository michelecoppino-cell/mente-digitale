const CACHE = 'mente-digitale-v3';
// Le due pagine-scorciatoia della schermata Home vanno in precache come
// l'app: sono la prima cosa che si apre toccando la loro icona.
const PRECACHE = ['/', '/index.html', '/gtd.html', '/diario.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Solo per richieste alla stessa origine (non API Microsoft)
  if (!e.request.url.startsWith(self.location.origin)) return;
  if (e.request.url.includes('/v1.0/')) return;
  // Le API dinamiche non vanno mai in cache
  if (e.request.url.includes('/api/')) return;

  // HTML (navigazioni): network-first, così i deploy arrivano subito;
  // la cache serve solo da fallback offline
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/')))
    );
    return;
  }

  // Asset statici (JS/CSS con hash, immagini, font): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});
