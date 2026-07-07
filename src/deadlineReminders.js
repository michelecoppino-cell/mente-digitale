// Scadenze ricorrenti (assicurazioni, salute, tasse...) agganciate alle Aree:
// un evento Calendario ricorrente con reminder nativo, intitolato
// "[NOME-LISTA] Titolo" (stesso nome della lista To-Do dell'Area), fa
// comparire un task nella lista giusta nel momento in cui il reminder scatta
// — letto via reminderView (App.jsx), nessuno script/cron separato: gira
// nello stesso ciclo della Daily Review (apertura app + "↺ Aggiorna tutto").

const PREFIX_RE = /^\[([^\]]+)\]\s*(.+)$/;

// "[AREA-CASA] Scadenza patente" → { listName: 'AREA-CASA', title: 'Scadenza patente' }
export function parseReminderSubject(subject) {
  const m = (subject || '').match(PREFIX_RE);
  if (!m) return null;
  const listName = m[1].trim();
  const title = m[2].trim();
  if (!listName || !title) return null;
  return { listName, title };
}

// Marker scritto nel body del task creato: l'evento sorgente può essere
// ricorrente (stesso eventId ogni anno, ma eventStartTime cambia a ogni
// occorrenza), quindi la coppia eventId+data identifica l'occorrenza precisa
// e permette di non ricreare due volte il task per lo stesso avviso.
export function reminderMarker(eventId, eventStartIso) {
  return `reminder-src:${eventId}:${eventStartIso}`;
}

export function hasReminderMarker(task, marker) {
  return !!task.body?.content?.includes(marker);
}
