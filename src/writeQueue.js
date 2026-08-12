// @ts-check
// Le scritture che non si perdono quando manca la rete.
//
// Il service worker fa aprire l'app offline, ma ogni scrittura andava su Graph
// nell'istante del gesto: senza rete la cattura falliva e il pensiero era
// perduto. Che è, fra tutte, la cosa che non deve accadere — il primo passo del
// metodo funziona solo se non chiede niente e non tradisce mai, e si cattura in
// metropolitana, in fila, in ascensore.
//
// Qui le operazioni che non sono riuscite finiscono in una coda su IndexedDB —
// non localStorage: sopravvive alla chiusura della scheda, ha spazio vero e non
// blocca il thread — e vengono ripetute quando la rete torna.
//
// ── Cosa entra in coda, e cosa no ──────────────────────────────────────────
// Solo operazioni piccole, indipendenti e ripetibili: creare un'attività,
// spuntarla, cambiarle stato. Ripetere una di queste a distanza di mezz'ora fa
// esattamente la stessa cosa che avrebbe fatto subito.
//
// Fuori resta il salvataggio del piano del giorno, e non per pigrizia: è la
// riscrittura di un file intero. Rimandarla vorrebbe dire riscrivere, mezz'ora
// dopo, uno stato vecchio sopra quello nuovo — l'esatto contrario di quello che
// fa la fusione a tre vie in api.js. Il piano, senza rete, dice che non è stato
// salvato e lo si rifà.
import { createTask, completeTask, updateTaskStatus } from './api';
import { notifyError, notifyInfo } from './notify';

const DB_NAME = 'mente-digitale-coda';
const STORE = 'operazioni';
const DB_VERSION = 1;

/** Dopo quanti tentativi falliti un'operazione viene abbandonata. */
const MAX_TRIES = 5;

/** Le operazioni che la coda sa ripetere. La chiave finisce su disco: non va
 *  rinominata a cuor leggero, o le operazioni già in coda diventano illeggibili. */
const HANDLERS = {
  /** @param {{ listId: string, title: string }} a */
  'crea-attività': a => createTask(a.listId, a.title),
  /** @param {{ listId: string, taskId: string }} a */
  'completa-attività': a => completeTask(a.listId, a.taskId),
  /** @param {{ listId: string, taskId: string, status: string }} a */
  'stato-attività': a => updateTaskStatus(a.listId, a.taskId, a.status),
};

/** @typedef {{ id: number, kind: keyof HANDLERS, args: any, label: string, createdAt: number, tries: number }} PendingOp */

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 * @returns {Promise<T>}
 */
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Chi guarda la coda ──────────────────────────────────────────────────────
/** @type {Set<(n: number) => void>} */
const listeners = new Set();
let count = 0;

/** @param {(n: number) => void} fn @returns {() => void} */
export function subscribePending(fn) {
  listeners.add(fn);
  fn(count);
  // Il conteggio in memoria parte da zero e viene aggiornato solo da enqueue e
  // flush: al primo iscritto va letto da disco, o dopo un ricaricamento una coda
  // piena si presenterebbe come vuota finché non ci si scrive dentro.
  refreshCount();
  return () => listeners.delete(fn);
}

async function refreshCount() {
  try {
    count = /** @type {number} */ (await tx('readonly', s => s.count()));
  } catch { count = 0; }
  listeners.forEach(fn => fn(count));
}

/** Le operazioni in attesa, per mostrarle (es. le catture in Inbox). */
export async function pendingOps() {
  try {
    return /** @type {PendingOp[]} */ (await tx('readonly', s => s.getAll())) || [];
  } catch { return []; }
}

/**
 * Mette un'operazione in coda.
 * @param {keyof HANDLERS} kind
 * @param {any} args
 * @param {string} label   come raccontarla all'utente se fallisce per sempre
 */
export async function enqueue(kind, args, label) {
  await tx('readwrite', s => s.add({ kind, args, label, createdAt: Date.now(), tries: 0 }));
  await refreshCount();
}

/**
 * Prova un'operazione e, se la rete non c'è, la mette in coda invece di
 * lasciarla cadere. Restituisce il risultato quando è andata subito, `null`
 * quando è stata accodata — così chi chiama sa se ha un id vero in mano.
 *
 * @template T
 * @param {keyof HANDLERS} kind
 * @param {any} args
 * @param {string} label
 * @returns {Promise<{ ok: boolean, result?: any, queued?: boolean }>}
 */
export async function tryOrQueue(kind, args, label) {
  if (!navigator.onLine) {
    await enqueue(kind, args, label);
    return { ok: false, queued: true };
  }
  try {
    const result = await HANDLERS[kind](args);
    return { ok: true, result };
  } catch (e) {
    // Solo i guasti di rete vanno in coda. Un 400 di Graph — un titolo vuoto, una
    // lista che non esiste più — ripetuto cinque volte resta un 400: quello va
    // detto subito.
    if (isNetworkError(e)) {
      await enqueue(kind, args, label);
      return { ok: false, queued: true };
    }
    throw e;
  }
}

/**
 * Un guasto di rete, non un rifiuto del server. `fetch` lancia un TypeError
 * quando non riesce a partire; `call()` in api.js lascia passare quell'errore
 * dopo i suoi tentativi, e su un 5xx esaurito arriva un Error senza `status`.
 * @param {any} e
 */
export function isNetworkError(e) {
  if (!e) return false;
  if (e.status) return false;
  return e instanceof TypeError
    || /network|failed to fetch|tentativi esauriti|load failed/i.test(String(e.message || e));
}

let flushing = false;

/**
 * Svuota la coda, in ordine. Un'operazione che continua a fallire per rete resta
 * dov'è (si riproverà); una che fallisce per un rifiuto del server viene tolta
 * dopo MAX_TRIES tentativi e raccontata, perché una coda che non si svuota mai è
 * peggio di un errore.
 *
 * @returns {Promise<{ fatte: number, restano: number }>}
 */
export async function flush() {
  if (flushing || !navigator.onLine) return { fatte: 0, restano: count };
  flushing = true;
  let fatte = 0;
  try {
    const ops = await pendingOps();
    for (const op of ops.sort((a, b) => a.createdAt - b.createdAt)) {
      const handler = HANDLERS[op.kind];
      if (!handler) {
        // Operazione di una versione precedente che non esiste più: si toglie,
        // altrimenti resterebbe in coda per sempre.
        await tx('readwrite', s => s.delete(op.id));
        continue;
      }
      try {
        await handler(op.args);
        await tx('readwrite', s => s.delete(op.id));
        fatte++;
      } catch (e) {
        if (isNetworkError(e)) break;   // è tornata a mancare: si riprova dopo
        const tries = (op.tries || 0) + 1;
        if (tries >= MAX_TRIES) {
          await tx('readwrite', s => s.delete(op.id));
          notifyError(`Non sono riuscito a salvare «${op.label}» dopo diversi tentativi. Rifallo a mano.`, e);
        } else {
          await tx('readwrite', s => s.put({ ...op, tries }));
        }
      }
    }
  } finally {
    flushing = false;
    await refreshCount();
  }
  return { fatte, restano: count };
}

/**
 * Aggancia la coda alla rete: si svuota quando torna il collegamento, e una
 * volta all'avvio (l'app può essere stata chiusa mentre era offline).
 *
 * @param {() => void} [onFlushed]  per rileggere le liste dopo un recupero
 * @returns {() => void}
 */
export function watchNetwork(onFlushed) {
  async function run() {
    const { fatte } = await flush();
    if (fatte > 0) {
      notifyInfo(fatte === 1
        ? 'Una cosa in attesa è stata salvata ora che la rete è tornata.'
        : `${fatte} cose in attesa sono state salvate ora che la rete è tornata.`);
      onFlushed?.();
    }
  }
  window.addEventListener('online', run);
  refreshCount();
  run();
  return () => window.removeEventListener('online', run);
}
