// @ts-check
// «Fallo quando il browser è fermo».
//
// L'avvio dell'app fa parecchie cose che non servono al primo schermo: la
// scansione della Daily Review (email recenti più il contenuto di decine di
// pagine OneNote), il precarico dei chunk delle viste, la serializzazione della
// cache su localStorage. Prima erano appese a `setTimeout` con numeri scelti a
// mano, che partono comunque — anche mentre il primo render sta ancora
// disegnando o l'utente sta scorrendo.
//
// requestIdleCallback aspetta invece un momento libero vero, con un tetto di
// tempo oltre il quale si procede comunque. Safari non lo ha (lo sta
// implementando da anni): là si ricade sul setTimeout di prima, che è
// esattamente il comportamento precedente.

/**
 * @param {() => void} fn
 * @param {number} [timeoutMs]  oltre questo ritardo si esegue comunque
 * @returns {() => void} per annullare, se non è ancora partita
 */
export function whenIdle(fn, timeoutMs = 2000) {
  const ric = /** @type {any} */ (globalThis).requestIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(fn, { timeout: timeoutMs });
    return () => /** @type {any} */ (globalThis).cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, Math.min(timeoutMs, 500));
  return () => clearTimeout(id);
}
