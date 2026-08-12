// La finestra con cui si crea o si modifica un evento del calendario Outlook
// dalla timeline del Piano.
import { useState } from 'react';
import { isAllDay, isoToHHMM, todayStr } from './plannerGrid';

// Crea o modifica un evento su uno qualsiasi dei calendari collegati (non solo
// quello di default) — usato dal pulsante "+ Evento" e dal click su un evento
// nella Timeline, in Settimana o in Mese.
export function CalendarEventModal({ mode, event, defaultDate, defaultStartTime, defaultEndTime, calendars, onClose, onSave, onDelete }) {
  const defaultCalId = calendars.find(c => c.isDefaultCalendar)?.id || calendars[0]?.id || '';
  const eventIsAllDay = event ? isAllDay(event) : false;

  const [calendarId, setCalendarId] = useState(event?._calId ?? '');
  const [subject, setSubject]       = useState(event?.subject || '');
  const [allDay, setAllDay]         = useState(eventIsAllDay);
  const [date, setDate]             = useState(
    event ? (event.start?.dateTime || event.start?.date || '').slice(0, 10) : (defaultDate || todayStr())
  );
  const [startTime, setStartTime]   = useState(event && !eventIsAllDay ? isoToHHMM(event.start?.dateTime) : (defaultStartTime || '09:00'));
  const [endTime, setEndTime]       = useState(event && !eventIsAllDay ? isoToHHMM(event.end?.dateTime) : (defaultEndTime || '10:00'));
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  // Se i calendari arrivano dopo l'apertura del modale (rete lenta), il valore
  // effettivo ricade sul default appena disponibile invece di restare vuoto.
  const effectiveCalendarId = calendarId || defaultCalId;

  const canSubmit = subject.trim() && date && effectiveCalendarId && (allDay || (startTime && endTime && startTime < endTime));

  function openPicker(e) {
    try { e.target.showPicker?.(); } catch { /* alcuni browser/contesti lo rifiutano */ }
  }

  async function handleSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        calendarId: effectiveCalendarId,
        subject: subject.trim(),
        startDate: date,
        endDate: date,
        startTime: allDay ? null : startTime,
        endTime: allDay ? null : endTime,
      });
    } catch (e) {
      console.error('cal event save', e);
      setError(e?.message ? `Errore nel salvataggio: ${e.message}` : 'Errore nel salvataggio dell’evento');
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (e) {
      console.error('cal event delete', e);
      setError(e?.message ? `Errore nell’eliminazione: ${e.message}` : 'Errore nell’eliminazione dell’evento');
      setBusy(false);
    }
  }

  return (
    <div className="planner-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="planner-modal" onClick={e => e.stopPropagation()}>
        <div className="planner-modal-header">
          <span>{mode === 'edit' ? 'Modifica evento' : 'Nuovo evento'}</span>
          <button onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="planner-modal-body planner-event-form">
          <label className="planner-modal-field">
            <span>Calendario</span>
            <select className="planner-modal-select" value={effectiveCalendarId} onChange={e => setCalendarId(e.target.value)}>
              {calendars.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.isDefaultCalendar ? ' (predefinito)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="planner-modal-field">
            <span>Titolo</span>
            <input
              className="planner-modal-select"
              type="text"
              autoFocus
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Titolo evento"
            />
          </label>
          <label className="planner-modal-field">
            <span>Data</span>
            <input className="planner-modal-select" type="date" value={date} onChange={e => setDate(e.target.value)} onClick={openPicker} />
          </label>
          <label className="planner-modal-checkbox-field">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
            <span>Tutto il giorno</span>
          </label>
          {!allDay && (
            <div className="planner-event-time-row">
              <label className="planner-modal-field">
                <span>Inizio</span>
                <input className="planner-modal-select" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} onClick={openPicker} />
              </label>
              <label className="planner-modal-field">
                <span>Fine</span>
                <input className="planner-modal-select" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} onClick={openPicker} />
              </label>
            </div>
          )}
          {error && <div className="planner-modal-error">{error}</div>}
          <div className="planner-event-form-actions">
            {mode === 'edit' && (
              <button className="planner-event-delete-btn" disabled={busy} onClick={handleDelete}>Elimina</button>
            )}
            <button className="planner-modal-apply-btn" disabled={!canSubmit || busy} onClick={handleSubmit}>
              {busy ? '…' : (mode === 'edit' ? 'Salva modifiche' : 'Crea evento')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

