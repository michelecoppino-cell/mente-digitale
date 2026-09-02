// @ts-nocheck — non ancora controllato dai tipi, come il resto del Piano da
// cui viene. Vedi la nota in jsconfig.json.
// Il mese: la distanza più larga da cui si guarda lo stesso piano.
//
// Non è un piano diverso da quello del giorno e della settimana — è lo stesso,
// visto da lontano. Ogni cella mostra al più quattro cose fra appuntamenti e
// blocchi, e dice quante altre ce ne sono: a quella distanza serve sapere
// quali giorni sono pieni, non cosa c'è dentro.

import {
  coloreEvento, evDayStr, isAllDay, isoToHHMM, liveBlockColor, localDateStr, todayStr,
} from './griglia.js';

// Vista "Mese" della modalità piano: calendario mensile con eventi Outlook e
// blocchi pianificati. Cliccando un giorno si passa alla vista Giorno.
export function MonthlyCalendar({ currentDate, plans, calEvents, calOutOfRange, config, listColorMap, coloriCalendari, onDayClick, onEventClick }) {
  const today = todayStr();
  const d = new Date(currentDate + 'T12:00:00');
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  let dow = first.getDay() - 1; if (dow < 0) dow = 6;

  const cells = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(localDateStr(new Date(d.getFullYear(), d.getMonth(), day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  // Eventi indicizzati per giorno (calEvents è già filtrato sul mese corrente)
  const eventsByDay = {};
  for (const ev of calEvents) {
    const key = evDayStr(ev);
    if (!key) continue;
    (eventsByDay[key] ||= []).push(ev);
  }

  const MAX_ITEMS = 4;
  const DOW_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  return (
    <div className="planner-month-wrap">
      {calOutOfRange && (
        <div className="planner-cal-outofrange">
          📅 Calendario non caricato oltre i 3 mesi dalla data odierna
        </div>
      )}
      <div className="planner-month-head">
        {DOW_LABELS.map(l => <div key={l} className="planner-month-dow">{l}</div>)}
      </div>
      <div className="planner-month-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="planner-month-cell empty" />;
          const dayEvents = eventsByDay[day] || [];
          const dayBlocks = (plans[day]?.blocks || []);
          const items = [
            ...dayEvents.map(ev => ({
              kind: 'event',
              title: ev.subject,
              time: isAllDay(ev) ? null : isoToHHMM(ev.start?.dateTime),
              color: coloreEvento(ev, coloriCalendari),
              ev,
            })),
            ...dayBlocks.map(b => ({
              kind: 'block',
              title: b.taskTitle,
              time: b.startTime,
              color: liveBlockColor(b, config, listColorMap),
              completed: b.completed,
            })),
          ];
          const shown = items.slice(0, MAX_ITEMS);
          const extra = items.length - shown.length;
          return (
            <div
              key={day}
              className={`planner-month-cell${day === today ? ' today' : ''}`}
              onClick={() => onDayClick(day)}
              title="Apri la vista Giorno">
              <span className="planner-month-daynum">{Number(day.slice(8))}</span>
              <div className="planner-month-items">
                {shown.map((it, j) => (
                  <div
                    key={j}
                    className={`planner-month-chip ${it.kind}${it.completed ? ' completed' : ''}`}
                    style={it.color ? { borderLeftColor: it.color } : undefined}
                    onClick={it.kind === 'event' ? e => { e.stopPropagation(); onEventClick(it.ev); } : undefined}
                    title={`${it.time ? it.time + ' · ' : ''}${it.title}`}>
                    {it.time && <span className="planner-month-chip-time">{it.time}</span>}
                    <span className="planner-month-chip-title">{it.title}</span>
                  </div>
                ))}
                {extra > 0 && <div className="planner-month-more">+{extra} altri</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
