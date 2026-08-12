// @ts-check
// Le scorciatoie da tastiera, dichiarate una volta.
//
// Prima le tre globali stavano in un `onKeyDown` dentro App.jsx e l'annullamento
// in un altro dentro UndoToast: funzionavano, ma non esisteva nessun posto da
// cui elencarle — e infatti l'unica che si annunciava era ⌘N, stampata sul
// bottone Cattura. Le altre si sapevano solo per averle scritte.
//
// Qui l'elenco *è* la definizione per quelle globali (useGlobalShortcuts installa
// l'ascoltatore leggendo da qui), e la descrizione per quelle che vivono dentro
// un componente — Escape, le frecce nella ricerca, l'annullamento. Quelle
// restano dove sono, perché hanno senso solo lì, ma comparire nell'elenco è
// l'unico modo perché qualcuno le scopra.
import { useEffect } from 'react';

/** Il tasto di comando come lo si chiama sulla macchina di chi guarda. */
export const CMD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  ? '⌘'
  : 'Ctrl';

/**
 * @typedef {Object} Shortcut
 * @property {string} id
 * @property {string[]} keys      i tasti, già pronti da mostrare
 * @property {string} label       cosa fa, detto all'infinito
 * @property {string} scope       dove vale
 * @property {boolean} [global]   se l'ascoltatore lo installa useGlobalShortcuts
 */

/** @type {Shortcut[]} */
export const SHORTCUTS = [
  { id: 'capture', keys: [CMD, 'N'], label: 'Catturare un pensiero', scope: 'Da qualunque vista', global: true },
  { id: 'search',  keys: [CMD, 'K'], label: 'Cercare, e lanciare i comandi', scope: 'Da qualunque vista', global: true },
  { id: 'diary',   keys: [CMD, 'J'], label: 'Aprire il Diario', scope: 'Da qualunque vista', global: true },
  { id: 'help',    keys: ['?'],      label: 'Questo elenco', scope: 'Da qualunque vista', global: true },
  { id: 'undo',    keys: [CMD, 'Z'], label: 'Annullare l\'ultima azione', scope: 'Fuori dai campi di testo' },
  { id: 'close',   keys: ['Esc'],    label: 'Chiudere la finestra aperta', scope: 'In una finestra' },
  { id: 'nav',     keys: ['↑', '↓'], label: 'Scorrere i risultati', scope: 'Nella ricerca' },
  { id: 'open',    keys: ['↵'],      label: 'Aprire il risultato scelto', scope: 'Nella ricerca' },
  { id: 'row',     keys: ['↵'],      label: 'Aprire il dettaglio dell\'attività', scope: 'Su una riga in Attività' },
];

/**
 * Vero se il fuoco è dentro qualcosa in cui si sta scrivendo: lì le scorciatoie
 * di una lettera sola non devono intromettersi, e nemmeno l'annullamento —
 * dentro un campo Ctrl+Z è l'annullamento del browser, che serve.
 * @param {Element|EventTarget|null} el
 */
export function isTypingTarget(el) {
  const node = /** @type {any} */ (el);
  if (!node) return false;
  return node.tagName === 'INPUT'
    || node.tagName === 'TEXTAREA'
    || node.tagName === 'SELECT'
    || node.isContentEditable === true;
}

/**
 * Installa le scorciatoie globali. Un handler per ciascun `id` marcato `global`:
 * se un handler manca, la scorciatoia semplicemente non fa niente (utile in
 * prova, e non serve tenere in piedi handler finti).
 *
 * @param {Partial<Record<string, () => void>>} handlers
 */
export function useGlobalShortcuts(handlers) {
  // handlers cambia identità a ogni render del genitore; l'effetto legge sempre
  // l'ultimo valore perché la chiusura viene ricreata a ogni giro — e le
  // dipendenze sono le sole chiavi, non gli oggetti.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      // «?» è una lettera sola: dentro un campo di testo è un punto di domanda.
      if (e.key === '?' && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        handlers.help?.();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') { e.preventDefault(); handlers.search?.(); }
      else if (key === 'j') { e.preventDefault(); handlers.diary?.(); }
      else if (key === 'n') { e.preventDefault(); handlers.capture?.(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}
