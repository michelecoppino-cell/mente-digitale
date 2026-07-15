// @ts-check
// Marker persistenti dell'app: NON sono una cache di dati fetchati (quella è
// passata a TanStack Query, vedi queryClient.js), ma piccoli segnalibri di stato
// con scadenza — le firme dei suggerimenti Daily Review già visti e i timestamp
// dell'ultimo controllo riuscito di review/scadenze. Restano su localStorage con
// una TTL di auto-pulizia.
//
// Il prefisso è lo stesso che usava cache.js, così i marker già salvati (es. la
// lista dei suggerimenti visti) sopravvivono all'introduzione di questo modulo.
const PREFIX = 'md_cache_v4_';

/**
 * @param {string} key
 * @param {unknown} data
 * @param {number} ttlMs
 */
export function setMarker(key, data, ttlMs) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, expires: Date.now() + ttlMs }));
  } catch {
    // localStorage pieno: si rinuncia a persistere il marker.
  }
}

/**
 * @param {string} key
 * @returns {any}
 */
export function getMarker(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() > obj.expires) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return obj.data;
  } catch { return null; }
}

// Cancella tutti i marker — usato da "↺ Aggiorna tutto" per far ripartire da capo
// Daily Review e scadenze.
export function clearMarkers() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* noop */ }
}
