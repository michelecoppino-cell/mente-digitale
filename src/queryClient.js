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
import { whenIdle } from './idle';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// staleTime = per quanto un dato è considerato "fresco" prima di rivalidarlo.
// Rispecchiano i vecchi TTL di cache.js.
export const STALE = {
  // App.jsx
  notebooks:      24 * HOUR,
  sections:       24 * HOUR,
  pages:          24 * HOUR,
  todolists:      24 * HOUR,
  tasks:           2 * HOUR,
  colorSettings:  30 * MIN,
  diaryStreak:    15 * MIN,   // TodayView
  // PlannerView.jsx
  plannerConfig:      30 * MIN,
  dailyPlans:          5 * MIN,   // ex PLANS_CACHE_TTL
  workbooks:          30 * MIN,
  idealWeek:          30 * MIN,
  calEventsBulk:      30 * MIN,
  workbookEventsBulk: 30 * MIN,
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
  /** @param {string} ym 'YYYY-MM' — la striscia dipende dal mese corrente */
  diaryStreak:   (ym) => /** @type {const} */ (['diaryStreak', ym]),
  // Diario: l'indice dei mesi e i mesi stessi, letti dalla ricerca (⌘K).
  diaryIndex:    () => /** @type {const} */ (['diaryIndex']),
  /** @param {string} ym 'YYYY-MM' */
  diaryMonth:    (ym) => /** @type {const} */ (['diaryMonth', ym]),
  // PlannerView.jsx — file singoli su OneDrive + bulk eventi ±3 mesi
  plannerConfig:      () => /** @type {const} */ (['plannerConfig']),
  dailyPlans:         () => /** @type {const} */ (['dailyPlans']),
  workbooks:          () => /** @type {const} */ (['workbooks']),
  idealWeek:          () => /** @type {const} */ (['idealWeek']),
  calEventsBulk:      () => /** @type {const} */ (['calEventsBulk']),
  workbookEventsBulk: () => /** @type {const} */ (['workbookEventsBulk']),
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
//
// La serializzazione non è gratis: la cache contiene l'elenco pagine di ogni
// sezione OneNote e tutti i task di ogni lista, cioè qualche centinaio di
// kilobyte di JSON, e `JSON.stringify` + `setItem` sono sincroni — cadendo in
// mezzo al primo caricamento (quando le query arrivano una dopo l'altra) si
// vedeva l'interfaccia inchiodarsi per una frazione di secondo alla volta.
// Il debounce aspetta la fine della raffica, e whenIdle aspetta che il browser
// sia libero prima di scrivere davvero.
//
// Si persistono solo le query riuscite: salvare un errore voleva dire
// ripresentarlo al riavvio successivo come se fosse un dato.
/** @type {ReturnType<typeof setTimeout>|undefined} */
let _saveTimer;
/** @type {(() => void)|undefined} */
let _cancelIdleSave;
let _pending = false;

function persistCache() {
  _pending = false;
  try {
    const clientState = dehydrate(queryClient, {
      shouldDehydrateQuery: q => q.state.status === 'success',
    });
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ timestamp: Date.now(), clientState }));
  } catch {
    // localStorage pieno: si rinuncia a persistere, la cache in memoria resta.
  }
}

queryClient.getQueryCache().subscribe(() => {
  _pending = true;
  clearTimeout(_saveTimer);
  _cancelIdleSave?.();
  _saveTimer = setTimeout(() => {
    _cancelIdleSave = whenIdle(persistCache, 4000);
  }, 1000);
});

// Alla chiusura della scheda l'ultima raffica potrebbe non essere ancora stata
// scritta: si salva subito, senza aspettare il momento libero che non arriverà.
// `pagehide` e non `beforeunload`: è l'unico evento che Safari iOS garantisce
// quando l'app finisce in sottofondo.
window.addEventListener('pagehide', () => {
  if (!_pending) return;
  clearTimeout(_saveTimer);
  _cancelIdleSave?.();
  persistCache();
});
