// @ts-check
// Le scadenze ricorrenti, dal calendario al pool.
//
// Il perché di tutto — la sintassi del titolo, l'anticipo, la finestra e la
// deduplica — sta in `deadlineReminders.js`, che è la parte pura e provata.
// Qui c'è solo il giro attorno: leggere le attività che ci sono già, creare
// quelle che mancano, mostrarle subito.
//
// Non fa **nessuna** chiamata di rete propria: gli eventi glieli passa chi la
// chiama, e sono quelli che l'app scarica comunque per i pannelli delle
// sezioni. Prima interrogava `reminderView` per conto suo, ed era una
// richiesta in più per un dato che era già in casa.

import { useCallback } from 'react';
import { leggiTask, creaTask } from './taskStore';
import { scadenzeDovute, scadenzaGiaPresente } from './deadlineReminders';

/**
 * @param {(listId: string, task: import('./taskStore').Task) => void} alNuovoTask
 *   dove mettere l'attività appena creata, perché si veda subito
 * @returns {(todoLists: {id: string, displayName: string}[], eventi: any[]) => Promise<void>}
 */
export function useScadenzeRicorrenti(alNuovoTask) {
  return useCallback(async (todoLists, eventi) => {
    try {
      const dovute = scadenzeDovute(eventi || [], todoLists || []);
      if (!dovute.length) return;

      // Le attività di una lista si leggono una volta sola, spuntate comprese:
      // una scadenza già fatta non deve tornare (vedi `leggiTask` in
      // taskStore.js, che i task chiusi li tiene apposta anche per questo).
      /** @type {Record<string, import('./taskStore').Task[]>} */
      const giaNellaLista = {};

      for (const scadenza of dovute) {
        if (!giaNellaLista[scadenza.listId]) {
          giaNellaLista[scadenza.listId] = await leggiTask(scadenza.listId)
            .catch(e => { console.error('scadenze: lettura', scadenza.listName, e); return []; });
        }
        if (scadenzaGiaPresente(giaNellaLista[scadenza.listId], scadenza)) continue;

        try {
          const task = await creaTask(scadenza.listId, {
            titolo: scadenza.titolo,
            scadenza: scadenza.giorno,
            origineScadenza: scadenza.origine,
          });
          giaNellaLista[scadenza.listId].push(task);
          alNuovoTask(scadenza.listId, task);
        } catch (e) { console.error('scadenze: creazione', scadenza.titolo, e); }
      }
    } catch (e) {
      console.error('scadenze ricorrenti', e);
    }
  }, [alNuovoTask]);
}
