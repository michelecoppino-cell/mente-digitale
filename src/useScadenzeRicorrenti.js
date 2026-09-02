// @ts-check
// Le scadenze che tornano ogni anno — assicurazioni, revisione, tasse, visite.
//
// Non c'è niente da tenere a mente e niente da accettare: si scrive una volta
// sola un evento ricorrente sul calendario, intitolato «[NOME-LISTA] Titolo» e
// con il promemoria nativo impostato con l'anticipo che si vuole, e nel momento
// in cui quel promemoria scatta l'attività compare da sé nella lista di
// quell'area. Da lì in poi è un'attività come le altre, e resta finché non la
// si spunta.
//
// Il promemoria si legge da Graph (`reminderView`) sulla finestra che va
// dall'ultimo controllo riuscito a adesso: così non si dipende dal fatto che
// l'app fosse aperta nell'istante esatto, e non si ricalcola l'anticipo di ogni
// evento per conto nostro.
//
// La deduplica non sta in un elenco a parte ma sull'attività stessa, nel campo
// `origineScadenza`: quale occorrenza di quale evento l'ha generata. Un elenco
// a parte sarebbe una cosa in più da tenere in pari, e quando si disallinea si
// ritrovano tre copie della stessa revisione dell'auto.

import { useCallback } from 'react';
import { getReminders } from './api';
import { leggiTask, creaTask } from './taskStore';
import { getMarker, setMarker } from './markers';
import { parseReminderSubject, reminderMarker, hasReminderMarker } from './deadlineReminders';

const ULTIMO_CONTROLLO = 'deadline_reminders_last_check';
const ULTIMO_CONTROLLO_TTL = 30 * 24 * 60 * 60 * 1000;

/** Alla prima scansione, o dopo una pausa lunga: quanto indietro si guarda. */
const FINESTRA_INIZIALE = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {(listId: string, task: import('./taskStore').Task) => void} alNuovoTask
 *   dove mettere l'attività appena creata, perché si veda subito
 * @returns {(todoLists: {id: string, displayName: string}[]) => Promise<void>}
 */
export function useScadenzeRicorrenti(alNuovoTask) {
  return useCallback(async (todoLists) => {
    try {
      const ultimo = getMarker(ULTIMO_CONTROLLO);
      const daISO = new Date(ultimo || (Date.now() - FINESTRA_INIZIALE)).toISOString();
      const aISO = new Date().toISOString();

      const promemoria = await getReminders(daISO, aISO);
      if (!promemoria.length) {
        setMarker(ULTIMO_CONTROLLO, Date.now(), ULTIMO_CONTROLLO_TTL);
        return;
      }

      const perNome = new Map((todoLists || []).map(l => [l.displayName.toLowerCase(), l]));
      /** @type {Record<string, import('./taskStore').Task[]>} */
      const giaNellaLista = {};

      for (const r of promemoria) {
        const letto = parseReminderSubject(r.eventSubject);
        if (!letto) continue;
        const lista = perNome.get(letto.listName.toLowerCase());
        if (!lista) continue;

        const inizioIso = r.eventStartTime?.dateTime
          ? new Date(r.eventStartTime.dateTime).toISOString() : '';
        const origine = reminderMarker(r.eventId, inizioIso);

        if (!giaNellaLista[lista.id]) {
          giaNellaLista[lista.id] = await leggiTask(lista.id)
            .catch(e => { console.error('deadline tasks', lista.displayName, e); return []; });
        }
        if (giaNellaLista[lista.id].some(t => hasReminderMarker(t, origine))) continue;

        try {
          const task = await creaTask(lista.id, {
            titolo: letto.title,
            ...(inizioIso ? { scadenza: inizioIso.slice(0, 10) } : {}),
            // Quale occorrenza di quale evento ha generato l'attività: è così
            // che alla scansione dopo non la si ricrea.
            origineScadenza: origine,
          });
          giaNellaLista[lista.id].push(task);
          alNuovoTask(lista.id, task);
        } catch (e) { console.error('create deadline task', letto.title, e); }
      }

      setMarker(ULTIMO_CONTROLLO, Date.now(), ULTIMO_CONTROLLO_TTL);
    } catch (e) {
      console.error('deadline reminders', e);
    }
  }, [alNuovoTask]);
}
