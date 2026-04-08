import { useState, useEffect } from 'react';
import { getCalendarEvents } from './api';
import { getTodoTasks, getTodoLists } from './api';

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }
function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.endsWith('Z') ? str : str + 'Z');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const DAYS_IT = ['L','M','M','G','V','S','D'];

export default function CalendarBar({ open, onToggle }) {
  const [month, setMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [taskDates, setTaskDates] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) loadMonth();
  }, [open, month]);

  async function loadMonth() {
    setLoading(true);
    try {
      const start = startOfMonth(month);
      const end = endOfMonth(month);
      // Carica eventi e task in parallelo
      const [evts, lists] = await Promise.all([
        getCalendarEvents(start, end),
        getTodoLists()
      ]);
      setEvents(evts);
      // Raccogli date task con scadenza
      const allTaskDates = [];
      for (const l of lists) {
        try {
          const tasks = await getTodoTasks(l.id);
          tasks.forEach(t => {
            if (t.dueDateTime?.dateTime) {
              allTaskDates.push({
                date: parseDate(t.dueDateTime.dateTime),
                title: t.title,
                important: t.importance === 'high',
                listName: l.displayName
              });
            }
          });
        } catch(e) {}
      }
      setTaskDates(allTaskDates);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  // Costruisce griglia del mese
  function buildGrid() {
    const first = startOfMonth(month);
    const last = endOfMonth(month);
    // Lunedì = 0
    let startDow = first.getDay() - 1;
    if (startDow < 0) startDow = 6;
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    return cells;
  }

  function eventsForDay(day) {
    return events.filter(e => {
      const start = parseDate(e.start?.dateTime || e.start?.date);
      return start && sameDay(start, day);
    });
  }

  function tasksForDay(day) {
    return taskDates.filter(t => t.date && sameDay(t.date, day));
  }

  const grid = buildGrid();
  const todayDate = today();

  return (
    <div className={`calendar-bar ${open ? 'open' : ''}`}>
      <div className="calendar-toggle" onClick={onToggle}>
        <span className="calendar-toggle-icon">📅</span>
        <span className="calendar-toggle-label">Calendario</span>
        <span className="calendar-toggle-arrow">{open ? '▼' : '▲'}</span>
      </div>

      {open && (
        <div className="calendar-content">
          <div className="calendar-nav">
            <button className="cal-nav-btn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))}>‹</button>
            <span className="cal-month-label">{MONTHS_IT[month.getMonth()]} {month.getFullYear()}</span>
            <button className="cal-nav-btn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))}>›</button>
          </div>

          <div className="cal-grid">
            {DAYS_IT.map((d, i) => (
              <div key={i} className="cal-dow">{d}</div>
            ))}
            {grid.map((day, i) => {
              if (!day) return <div key={i} className="cal-cell empty" />;
              const dayEvents = eventsForDay(day);
              const dayTasks = tasksForDay(day);
              const isToday = sameDay(day, todayDate);
              const isSelected = selectedDay && sameDay(day, selectedDay);
              return (
                <div
                  key={i}
                  className={`cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${dayEvents.length || dayTasks.length ? 'has-items' : ''}`}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                >
                  <span className="cal-day-num">{day.getDate()}</span>
                  <div className="cal-dots">
                    {dayEvents.slice(0,3).map((_, j) => <span key={j} className="cal-dot event" />)}
                    {dayTasks.slice(0,3).map((t, j) => <span key={'t'+j} className={`cal-dot task ${t.important ? 'important' : ''}`} />)}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedDay && (
            <div className="cal-day-detail">
              <div className="cal-detail-title">
                {selectedDay.getDate()} {MONTHS_IT[selectedDay.getMonth()]}
              </div>
              {eventsForDay(selectedDay).length > 0 && (
                <div className="cal-detail-section">
                  <div className="cal-detail-label">Eventi</div>
                  {eventsForDay(selectedDay).map(e => (
                    <div key={e.id} className="cal-event-row">
                      <span className="cal-event-time">
                        {e.isAllDay ? 'Tutto il giorno' : new Date(e.start.dateTime).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'})}
                      </span>
                      <span className="cal-event-title">{e.subject}</span>
                    </div>
                  ))}
                </div>
              )}
              {tasksForDay(selectedDay).length > 0 && (
                <div className="cal-detail-section">
                  <div className="cal-detail-label">Task in scadenza</div>
                  {tasksForDay(selectedDay).map((t, i) => (
                    <div key={i} className="cal-task-row">
                      {t.important && <span className="cal-star">★</span>}
                      <span className="cal-task-title">{t.title}</span>
                      <span className="cal-task-list">{t.listName}</span>
                    </div>
                  ))}
                </div>
              )}
              {!eventsForDay(selectedDay).length && !tasksForDay(selectedDay).length && (
                <div className="cal-empty-day">Nessun evento o scadenza</div>
              )}
            </div>
          )}
          {loading && <div className="cal-loading">Caricamento…</div>}
        </div>
      )}
    </div>
  );
}
