// Service worker dell'app.
//
// I due segnaposto qui sotto (il numero di build e l'elenco degli asset) vengono
// sostituiti a fine build dal plugin in vite.config.js. In sviluppo restano tali
// e quali: la cache prende un nome fisso e nessun asset è dichiarato, che è il
// comportamento giusto quando i file arrivano dal dev server.
const BUILD_ID = '__BUILD_ID__';

// Gli asset con hash nel nome prodotti da *questa* build. Serve alla potatura:
// senza un elenco, il worker non ha modo di distinguere il chunk di ieri da
// quello di oggi, e la cache cresceva a ogni deploy.
const ASSETS = new Set(JSON.parse('__ASSETS__'));

// Il nome della cache resta stabile fra i deploy — di proposito.
//
// Prima era versionato a mano (`mente-digitale-v5`) e l'attivazione cancellava
// ogni altra cache: cambiare versione voleva dire riscaricare tutta l'app, non
// cambiarla voleva dire tenersi dentro i pezzi di ogni build passata. Con un
// nome stabile gli asset con hash restano validi — se il nome del file non è
// cambiato, il contenuto non è cambiato — e alla potatura si passa per elenco.
const CACHE = 'mente-digitale';

// Le due pagine-scorciatoia della schermata Home vanno in precache come
// l'app: sono la prima cosa che si apre toccando la loro icona.
const PRECACHE = ['/', '/index.html', '/gtd.html', '/diario.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .catch(() => {})           // offline al primo avvio: si riempirà strada facendo
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      // Le cache di schema vecchio (mente-digitale-v1…v5) non servono più.
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));

      // Potatura: via gli asset con hash che questa build non usa più. Si tocca
      // solo /assets/, cioè i file col contenuto nel nome: tutto il resto
      // (pagine, icone, manifest) ha un nome stabile e va tenuto.
      if (ASSETS.size) {
        const cache = await caches.open(CACHE);
        const cached = await cache.keys();
        await Promise.all(cached.map(req => {
          const path = new URL(req.url).pathname;
          if (!path.startsWith('/assets/')) return undefined;
          return ASSETS.has(path) ? undefined : cache.delete(req);
        }));
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', e => {
  // Solo le GET: la Cache Storage rifiuta di memorizzare la risposta di una
  // POST/PUT/DELETE, e `cache.put` finiva per gettare un errore non gestito
  // dentro il worker a ogni scrittura verso la stessa origine.
  if (e.request.method !== 'GET') return;
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
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/')))
    );
    return;
  }

  // Asset statici (JS/CSS con hash, immagini, font): cache-first, con
  // rivalidazione in sottofondo. Il `catch` non è di cortesia: con una copia in
  // cache la risposta è già partita, e senza rete la promessa di rivalidazione
  // finiva in un rifiuto non gestito dentro il worker a ogni richiesta offline —
  // cioè, su iOS, un worker che veniva ucciso e riavviato di continuo.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(err => {
          if (cached) return cached;
          throw err;
        });
      return cached || networkFetch;
    })
  );
});

// Il numero di build serve solo a far cambiare il byte-per-byte del file, così
// il browser si accorge che il worker è nuovo e riesegue l'attivazione (e quindi
// la potatura). Senza, un worker identico non viene rimpiazzato.
self.addEventListener('message', e => {
  if (e.data === 'build-id') e.source?.postMessage?.({ buildId: BUILD_ID });
});
