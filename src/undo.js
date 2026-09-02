// Stack di undo globale, in memoria: ogni azione reversibile (creazione,
// modifica, eliminazione di eventi/task/checklist) registra qui la propria
// azione inversa. L'utente annulla con Ctrl+Z o dal banner "Annulla" che
// compare in basso a schermo (vedi UndoToast.jsx).

/**
 * @typedef {object} VoceUndo
 * @property {number} id
 * @property {string} label      cosa si sta per annullare, come si legge nel banner
 * @property {() => any} undo    l'azione inversa
 * @property {number} ts
 */

/** @type {VoceUndo[]} */
const stack = [];
/** @type {Set<(entry: VoceUndo) => void>} */
const listeners = new Set();
let seq = 0;

/**
 * @param {{ label: string, undo: () => any }} azione
 * @returns {number} l'id della voce registrata
 */
export function pushUndo({ label, undo }) {
  const entry = { id: ++seq, label, undo, ts: Date.now() };
  stack.push(entry);
  if (stack.length > 30) stack.shift();
  listeners.forEach(fn => fn(entry));
  return entry.id;
}

/** @returns {Promise<VoceUndo|null>} la voce annullata, o null se non c'era niente */
export async function undoLast() {
  const entry = stack.pop();
  if (!entry) return null;
  try {
    await entry.undo();
    return entry;
  } catch (e) {
    // Se l'annullamento fallisce (es. rete) rimettiamo l'azione in coda:
    // l'utente può riprovare invece di perdere la possibilità di annullare.
    stack.push(entry);
    throw e;
  }
}

/** @param {(entry: VoceUndo) => void} fn @returns {() => void} */
export function subscribeUndo(fn) {
  listeners.add(fn);
  // Niente `return listeners.delete(fn)`: `delete` risponde un booleano, e chi
  // usa questa funzione come pulizia di un `useEffect` deve poterla
  // restituire così com'è.
  return () => { listeners.delete(fn); };
}
