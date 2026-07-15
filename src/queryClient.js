// @ts-check
// Data-layer centralizzato su TanStack Query.
//
// Sostituisce la cache artigianale (cache.js con TTL su localStorage) per le
// letture Graph di App.jsx: stale-while-revalidate, dedup delle richieste e
// persistenza su localStorage arrivano "gratis" dalla libreria, al posto del
// pattern `cacheGet(...) || (fetch + cacheSet(...))` ripetuto a mano.
//
// La resilienza di rete (retry/backoff, giro extra sul 401, 429/503/504) resta
// in api.js `call()`, quindi qui `retry: false` per non duplicarla.
//
// Migrazione incrementale: cache.js è ancora usato da PlannerView e per i marker
// non-cache (review_seen, *_last_check). Verrà rimosso quando anche quei punti
// passeranno a questo client.

import { QueryClient, hydrate, dehydrate } from '@tanstack/react-query';

const HOUR = 60 * 60 * 1000;

// staleTime = per quanto un dato è considerato "fresco" prima di rivalidarlo.
// Rispecchiano i vecchi TTL di cache.js.
export const STALE = {
  notebooks:      24 * HOUR,
  sections:       24 * HOUR,
  pages:          24 * HOUR,
  todolists:      24 * HOUR,
  tasks:           2 * HOUR,
  colorSettings:  30 * 60 * 1000,
};

// gcTime lungo: un dato diventato "vecchio" resta comunque in cache (e
// persistito) come fallback finché non arriva un refetch riuscito — è ciò che
// prima faceva a mano il fallback-su-stale dopo un 401.
const GC_TIME = 24 * HOUR;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: GC_TIME,
      staleTime: 0,
      retry: false,                 // già gestito da api.js call()
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

// Chiavi di query centralizzate: un solo punto in cui sono definite.
export const qk = {
  notebooks:     () => /** @type {const} */ (['notebooks']),
  /** @param {string} notebookId */
  sections:      (notebookId) => /** @type {const} */ (['sections', notebookId]),
  /** @param {string} sectionId */
  pages:         (sectionId) => /** @type {const} */ (['pages', sectionId]),
  todolists:     () => /** @type {const} */ (['todolists']),
  /** @param {string} listId */
  tasks:         (listId) => /** @type {const} */ (['tasks', listId]),
  colorSettings: () => /** @type {const} */ (['colorSettings']),
};

// ── Persistenza su localStorage ──────────────────────────────────────────────
// Ripristino SINCRONO all'avvio (lo storage è sincrono): così i dati persistiti
// sono già in cache quando parte il primo load(), esattamente come la lettura
// sincrona di cacheGet(). Con il provider async di TanStack le sezioni già viste
// sarebbero sparite finché non si riespandeva un taccuino.
const PERSIST_KEY = 'md_rq_cache_v1';

try {
  const raw = window.localStorage.getItem(PERSIST_KEY);
  if (raw) {
    const persisted = JSON.parse(raw);
    // Scarta in blocco una cache più vecchia di GC_TIME (coerente con gcTime);
    // la freschezza fine-granulare resta governata da staleTime per query.
    if (persisted && typeof persisted.timestamp === 'number' && Date.now() - persisted.timestamp <= GC_TIME) {
      hydrate(queryClient, persisted.clientState);
    } else {
      window.localStorage.removeItem(PERSIST_KEY);
    }
  }
} catch {
  // Cache corrotta o storage non disponibile: si riparte da vuoto.
  try { window.localStorage.removeItem(PERSIST_KEY); } catch { /* noop */ }
}

// Salvataggio con debounce a ogni cambiamento della cache (una scrittura sola
// dopo una raffica di aggiornamenti, invece di una per query come cacheSet).
/** @type {ReturnType<typeof setTimeout>|undefined} */
let _saveTimer;
queryClient.getQueryCache().subscribe(() => {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const clientState = dehydrate(queryClient);
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ timestamp: Date.now(), clientState }));
    } catch {
      // localStorage pieno: si rinuncia a persistere, la cache in memoria resta.
    }
  }, 1000);
});
