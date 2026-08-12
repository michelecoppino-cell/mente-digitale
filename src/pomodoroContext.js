// @ts-check
// Il contesto della sessione Pomodoro e i suoi lettori, separati dal
// componente che lo fornisce (PomodoroSession.jsx): un file che esporta un
// componente React non può esportare anche altro senza rompere il fast refresh
// di Vite.
import { createContext, useContext } from 'react';

/**
 * @typedef {Object} PomodoroSessionState
 * @property {string} startedAt        ISO del momento di avvio
 * @property {number} durationMin      durata prevista
 * @property {string|null} taskId
 * @property {string|null} taskTitle
 * @property {string|null} sectionId
 * @property {string|null} sectionName
 * @property {'running'|'paused'} state
 * @property {number} elapsedMs        millisecondi già maturati prima dell'ultima pausa
 * @property {number|null} resumedAt   timestamp dell'ultimo avvio/ripresa, null se in pausa
 */

export const PomodoroContext = createContext(/** @type {any} */ (null));

/**
 * Il tempo trascorso, che avanza ogni secondo, sta in un contesto a parte.
 *
 * Prima era dentro lo stesso oggetto della sessione e dei comandi: quel valore
 * cambia una volta al secondo, e ogni componente che leggeva il contesto — App
 * compreso, che di suo usa solo `start` e `stop` — si ridisegnava con lui. Con
 * un Pomodoro avviato l'intera app veniva ricostruita sessanta volte al minuto,
 * griglia del Piano inclusa. Qui il tick ce l'ha solo chi deve mostrare i
 * minuti che passano.
 */
export const PomodoroTickContext = createContext(0);

/**
 * Millisecondi trascorsi da inizio sessione, contando solo il tempo in cui il
 * timer girava davvero.
 * @param {PomodoroSessionState|null} s
 * @param {number} now
 * @returns {number}
 */
export function sessionElapsedMs(s, now) {
  if (!s) return 0;
  return s.elapsedMs + (s.resumedAt ? Math.max(0, now - s.resumedAt) : 0);
}

export function usePomodoro() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoro va usato dentro <PomodoroProvider>');
  return ctx;
}

/** I millisecondi trascorsi, aggiornati al secondo. Da usare *solo* dove i
 *  minuti che passano si vedono a schermo: chiunque lo legga si ridisegna ogni
 *  secondo finché il timer gira. */
export function usePomodoroElapsed() {
  return useContext(PomodoroTickContext);
}
