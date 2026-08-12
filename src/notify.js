// @ts-check
// Gli avvisi che l'app deve dare quando qualcosa non è riuscito.
//
// Fino a qui ogni scrittura verso Graph finiva così:
//
//     catch (e) { console.error('cambio stato attività', e); }
//
// cioè: la card trascinata in un'altra colonna tornava al suo posto e non
// succedeva niente. Nessun messaggio, nessun indizio — la sola traccia stava
// nella console, che su un telefono non esiste. In un'app che scrive su Graph a
// ogni gesto, e che si usa in mobilità, un salvataggio fallito in silenzio è la
// cosa peggiore che può capitare: si crede di aver spostato l'attività, e non
// è vero.
//
// Qui c'è un canale minimo, con la stessa forma dello stack di undo (una lista
// di iscritti, nessuna dipendenza da React): chi fallisce chiama `notifyError`,
// il banner in basso lo mostra (vedi Toaster.jsx). Gli errori identici che si
// ripetono non si accumulano: si sostituiscono.

/** @typedef {{ id: number, text: string, kind: 'error'|'info', ts: number }} Notice */

/** @type {Set<(n: Notice|null) => void>} */
const listeners = new Set();
let seq = 0;
/** @type {Notice|null} */
let current = null;

/**
 * @param {string} text        una frase, in italiano, che dice cosa non è riuscito
 * @param {unknown} [error]    l'errore vero, che va comunque in console
 */
export function notifyError(text, error) {
  if (error !== undefined) console.error(text, error);
  emit({ id: ++seq, text, kind: 'error', ts: Date.now() });
}

/** @param {string} text */
export function notifyInfo(text) {
  emit({ id: ++seq, text, kind: 'info', ts: Date.now() });
}

/** @param {Notice} notice */
function emit(notice) {
  current = notice;
  listeners.forEach(fn => fn(notice));
}

export function dismissNotice() {
  current = null;
  listeners.forEach(fn => fn(null));
}

/**
 * @param {(n: Notice|null) => void} fn
 * @returns {() => void}
 */
export function subscribeNotices(fn) {
  listeners.add(fn);
  // Un avviso arrivato prima che il banner fosse montato non va perso.
  if (current) fn(current);
  return () => listeners.delete(fn);
}
