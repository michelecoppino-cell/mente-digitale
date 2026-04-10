// Cache persistente su localStorage con TTL
const PREFIX = 'md_cache_v3_'; // v3: pagine con level per tree view // v2: invalida cache vecchia con sottopagine

export function cacheSet(key, data, ttlMs) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({
      data,
      expires: Date.now() + ttlMs
    }));
  } catch(e) {
    // localStorage pieno — pulisci vecchie chiavi
    clearExpired();
  }
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() > obj.expires) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return obj.data;
  } catch(e) { return null; }
}

export function cacheClear() {
  // Cancella tutte le chiavi della app
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k));
}

function clearExpired() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => {
      try {
        const obj = JSON.parse(localStorage.getItem(k));
        if (Date.now() > obj.expires) localStorage.removeItem(k);
      } catch(e) { localStorage.removeItem(k); }
    });
}

// TTL costanti
export const TTL = {
  TASKS:    2  * 60 * 60 * 1000,  // 2 ore
  PAGES:   24  * 60 * 60 * 1000,  // 24 ore
  SECTIONS:24  * 60 * 60 * 1000,  // 24 ore
  NOTEBOOKS:24 * 60 * 60 * 1000,  // 24 ore
  TODOLISTS:24 * 60 * 60 * 1000,  // 24 ore
};
