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
  // PlannerView.jsx
  plannerConfig:      30 * MIN,
  dailyPlans:          5 * MIN,   // ex PLANS_CACHE_TTL
  workbooks:          30 * MIN,
  idealWeek:          30 * MIN,
  calEventsBulk:      30 * MIN,
  workbookEventsBulk: 30 * MIN,
  // TodayView — i documenti su OneDrive che «Oggi» apre a ogni ingresso.
  // Prima non avevano cache: ogni riapertura dell'app li rileggeva da zero, e
  // fino alla risposta i riquadri restavano vuoti. Adesso passano di qui, così
  // la copia dell'ultimo caricamento c'è già mentre la lettura è in volo.
  obiettivi:       15 * MIN,
  coda:            15 * MIN,
  rituale:          5 * MIN,
  movimento:        5 * MIN,
  diarioDate:      15 * MIN,
  calEventiSezioni: 30 * MIN,
};

// gcTime lungo: un dato diventato "vecchio" resta comunque in cache (e
// persistito) come fallback finché non arriva un refetch riuscito — è ciò che
// prima faceva a mano il fallback-su-stale dopo un 401.
//
// Sette giorni e non più ventiquattr'ore, perché è questo il numero che decide
// cosa si vede all'apertura. iPhone butta via la pagina dopo pochi minuti in
// secondo piano: riaprire l'icona è un caricamento da capo, e quello che si
// vede nel frattempo è esattamente quanto è sopravvissuto qui dentro. Con un
// giorno solo, tornare sull'app dopo un fine settimana voleva dire schermate
// vuote finché Graph non rispondeva; la scadenza breve non proteggeva da
// niente — la freschezza la decide staleTime, query per query, e il refetch
// parte comunque. Qui si decide solo se c'è qualcosa da guardare nell'attesa.
const GC_TIME = 7 * 24 * HOUR;

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
  // PlannerView.jsx — file singoli su OneDrive + bulk eventi ±3 mesi
  plannerConfig:      () => /** @type {const} */ (['plannerConfig']),
  dailyPlans:         () => /** @type {const} */ (['dailyPlans']),
  workbooks:          () => /** @type {const} */ (['workbooks']),
  idealWeek:          () => /** @type {const} */ (['idealWeek']),
  calEventsBulk:      () => /** @type {const} */ (['calEventsBulk']),
  workbookEventsBulk: () => /** @type {const} */ (['workbookEventsBulk']),
  // TodayView — documenti singoli su OneDrive
  obiettivi:        () => /** @type {const} */ (['obiettivi']),
  coda:             () => /** @type {const} */ (['coda']),
  rituale:          () => /** @type {const} */ (['rituale']),
  /** @param {string} oggi 'YYYY-MM-DD': il registro tenuto è quello dei due mesi attorno a oggi */
  movimento:        (oggi) => /** @type {const} */ (['movimento', oggi.slice(0, 7)]),
  diarioDate:       () => /** @type {const} */ (['diarioDate']),
  calEventiSezioni: () => /** @type {const} */ (['calEventiSezioni']),
};

// ── Persistenza su localStorage ──────────────────────────────────────────────
// Ripristino SINCRONO all'avvio (lo storage è sincrono): così i dati persistiti
// sono già in cache quando parte il primo load(), esattamente come la lettura
// sincrona di cacheGet(). Con il provider async di TanStack le sezioni già viste
// sarebbero sparite finché non si riespandeva un taccuino.
const PERSIST_KEY = 'md_rq_cache_v1';

// Quanto spazio può prendersi la cache, e perché un tetto ci vuole.
//
// `localStorage` è uno solo per origine, e su Safari è piccolo: qualche mega,
// meno ancora per un'app aperta dall'icona sulla Home. Dentro ci sta la cache
// di TanStack — pagine OneNote, task, e gli eventi di calendario a ±3 mesi,
// tenuti una settimana — ma ci sta anche, nello stesso cassetto, la cache di MSAL,
// cioè l'account e il refresh token. Quando lo spazio finisce, `setItem`
// smette di funzionare *per tutti*: la cache dei dati se ne fa una ragione
// (c'è il try/catch qui sotto), MSAL no — si ritrova a non poter scrivere il
// token appena ruotato, e l'accesso sparisce senza che nessuno abbia visto
// scadere niente. Da fuori sembra una sessione che dura poco; in realtà è la
// cache dei dati che ha mangiato il posto dell'account.
//
// Un mega di JSON è comodo per i dati e lascia margine abbondante a MSAL, che
// di suo occupa qualche decina di kB.
const PERSIST_BUDGET = 1_000_000;

// Se lo spazio è finito lo stesso, resta scritto qui: la schermata di login lo
// legge e lo dice, invece di lasciare l'utente davanti a un logout inspiegato.
const STORAGE_FULL_KEY = 'md_storage_full';

/**
 * Sfoltisce la cache da persistere finché non sta nel budget, buttando prima
 * le query più grosse. Perdere gli eventi di tre mesi vuol dire riscaricarli;
 * perdere l'account vuol dire rifare l'accesso — non è lo stesso prezzo.
 * @param {ReturnType<typeof dehydrate>} clientState
 * @returns {string} il JSON da scrivere, già sotto al budget
 */
function serializzaEntroIlBudget(clientState) {
  const payload = { timestamp: Date.now(), clientState };
  let json = JSON.stringify(payload);
  if (json.length <= PERSIST_BUDGET) return json;

  const queries = [...(clientState.queries || [])]
    .map(q => ({ q, size: JSON.stringify(q).length }))
    .sort((a, b) => b.size - a.size);
  const tenute = new Set(queries.map(x => x.q));
  for (const { q } of queries) {
    tenute.delete(q);
    json = JSON.stringify({
      timestamp: payload.timestamp,
      clientState: { ...clientState, queries: [...tenute] },
    });
    if (json.length <= PERSIST_BUDGET) break;
  }
  return json;
}

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
      window.localStorage.setItem(PERSIST_KEY, serializzaEntroIlBudget(dehydrate(queryClient)));
      window.localStorage.removeItem(STORAGE_FULL_KEY);
    } catch {
      // Spazio finito lo stesso: la cache in memoria resta e si va avanti, ma
      // il posto va liberato subito — quello che manca qui manca anche a MSAL,
      // e lì costa l'accesso.
      try {
        window.localStorage.removeItem(PERSIST_KEY);
        window.localStorage.setItem(STORAGE_FULL_KEY, new Date().toISOString());
      } catch { /* nemmeno questo si può fare */ }
    }
  }, 1000);
});
