// @ts-check
// Creare, spostare, modificare ed eliminare un evento del calendario.
//
// Erano due funzioni dentro PlannerView, ed è lì che sono nate: il modale
// dell'evento si apriva solo dal Piano. Ora si apre anche da «Oggi», dalla
// settimana in arrivo, e le stesse tre scritture — con lo stesso annulla —
// non possono stare scritte in due posti: un'undo che ricrea l'evento con i
// campi giusti è esattamente il genere di codice che, copiato, diverge.
//
// Chi le chiama passa `dopo`: cosa fare quando la scrittura è andata a buon
// fine (rileggere gli eventi). Il modale raccoglie i campi, questo file
// scrive, la vista si aggiorna per conto suo.

import {
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, moveCalendarEvent,
} from './api';
import { isAllDay, isoToHHMM, graphDayStr } from './planner/griglia.js';
import { pushUndo } from './undo';

/**
 * @typedef {Object} FormEvento
 * @property {string} calendarId
 * @property {string} subject
 * @property {string} startDate
 * @property {string} endDate
 * @property {string|null} [startTime]  assente o null: evento di tutto il giorno
 * @property {string|null} [endTime]
 */

/** Graph distingue «non c'è» da «è null»: un evento di tutto il giorno arriva
 *  qui come null dal modale, e alle funzioni di api.js va passato omesso.
 *  @param {string|null|undefined} v @returns {string|undefined} */
function orario(v) {
  return v || undefined;
}

/** Il calendario su cui scrivere quando l'evento non ne dichiara uno.
 *  @param {any[]} calendars */
function calendarioDiDefault(calendars) {
  return calendars.find(c => c.isDefaultCalendar)?.id || calendars[0]?.id || null;
}

/**
 * Salva l'evento: lo crea, oppure lo modifica (spostandolo di calendario se
 * il modale ne ha scelto un altro). Lascia dietro di sé un annulla.
 * @param {Object} p
 * @param {'create'|'edit'} p.mode
 * @param {any} [p.event]           l'evento di partenza, in modifica
 * @param {FormEvento} p.form
 * @param {any[]} [p.calendars]
 * @param {() => Promise<void>|void} p.dopo
 */
export async function salvaEvento({ mode, event, form, calendars = [], dopo }) {
  const { calendarId, subject, startDate, endDate, startTime, endTime } = form;
  if (mode === 'edit' && event) {
    const defaultCalId = calendarioDiDefault(calendars);
    const originCalId  = event._calId || defaultCalId;
    const targetCalId  = calendarId || defaultCalId;
    // Snapshot dei valori precedenti, per poter tornare indietro con l'undo.
    const prevAllDay    = event.isAllDay;
    const prevStartDate = graphDayStr(event.start, prevAllDay);
    const prevEndDate   = graphDayStr(event.end, prevAllDay);
    const prevStartTime = prevAllDay ? null : isoToHHMM(event.start?.dateTime);
    const prevEndTime   = prevAllDay ? null : isoToHHMM(event.end?.dateTime);
    const prevSubject   = event.subject;
    let targetEventId   = event.id;
    if (originCalId !== targetCalId) {
      const moved = await moveCalendarEvent(event._calId || null, event.id, targetCalId);
      targetEventId = moved?.id || event.id;
    }
    await updateCalendarEvent(targetCalId, targetEventId, {
      subject, startDate, endDate, startTime: orario(startTime), endTime: orario(endTime),
    });
    pushUndo({
      label: `Modifica a "${subject}" annullabile`,
      undo: async () => {
        let backEventId = targetEventId;
        if (originCalId !== targetCalId) {
          const movedBack = await moveCalendarEvent(targetCalId, targetEventId, originCalId);
          backEventId = movedBack?.id || targetEventId;
        }
        await updateCalendarEvent(originCalId, backEventId, {
          subject: prevSubject, startDate: prevStartDate, endDate: prevEndDate,
          startTime: orario(prevStartTime), endTime: orario(prevEndTime),
        });
        await dopo();
      },
    });
  } else {
    const created = await createCalendarEvent({
      calendarId, subject, startDate, endDate, startTime: orario(startTime), endTime: orario(endTime),
    });
    const createdCalId = calendarId || null;
    pushUndo({
      label: `Evento "${subject}" creato`,
      undo: async () => {
        await deleteCalendarEvent(createdCalId, created.id);
        await dopo();
      },
    });
  }
  await dopo();
}

/**
 * Elimina l'evento. Graph non offre un «ripristina»: l'annulla ne ricrea uno
 * nuovo con gli stessi dati (e un id nuovo). Se l'evento aveva partecipanti,
 * la notifica di cancellazione già partita non torna indietro.
 * @param {Object} p
 * @param {any} p.event
 * @param {() => Promise<void>|void} p.dopo
 */
export async function eliminaEvento({ event, dopo }) {
  const calId = event._calId;
  await deleteCalendarEvent(calId, event.id);
  pushUndo({
    label: `Evento "${event.subject}" eliminato`,
    undo: async () => {
      await createCalendarEvent({
        calendarId: calId,
        subject: event.subject,
        startDate: graphDayStr(event.start, isAllDay(event)),
        endDate: graphDayStr(event.end, isAllDay(event)),
        startTime: event.isAllDay ? undefined : orario(isoToHHMM(event.start?.dateTime)),
        endTime: event.isAllDay ? undefined : orario(isoToHHMM(event.end?.dateTime)),
      });
      await dopo();
    },
  });
  await dopo();
}
