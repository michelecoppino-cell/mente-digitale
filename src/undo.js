// Stack di undo globale, in memoria: ogni azione reversibile (creazione,
// modifica, eliminazione di eventi/task/checklist) registra qui la propria
// azione inversa. L'utente annulla con Ctrl+Z o dal banner "Annulla" che
// compare in basso a schermo (vedi UndoToast.jsx).
const stack = [];
const listeners = new Set();
let seq = 0;

export function pushUndo({ label, undo }) {
  const entry = { id: ++seq, label, undo, ts: Date.now() };
  stack.push(entry);
  if (stack.length > 30) stack.shift();
  listeners.forEach(fn => fn(entry));
  return entry.id;
}

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

export function subscribeUndo(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
