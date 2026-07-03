import { useState, useEffect } from 'react';
import { getTodoLists, getTodoTasks, getCalendarEvents, loadPlannerConfig } from './api';
import { cacheGet } from './cache';
import TaskPool from './TaskPool';
import { DEFAULT_CONFIG } from './plannerShared';

// Mezzanotte di oggi — da ricalcolare a ogni uso, non a caricamento modulo
function todayMidnight() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function sameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }

function parseLocalDate(s) {
  const d = new Date(s.endsWith('Z')?s:s+'Z');
  return new Date(d.getFullYear(),d.getMonth(),d.getDate());
}
// Graph restituisce dateTime senza 'Z' ma in UTC — aggiungiamo Z per forzare parsing UTC
function parseDT(s) { return new Date(s.endsWith('Z') ? s : s + 'Z'); }

const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const DAYS_IT   = ['L','M','M','G','V','S','D'];

// Pannello "Attività" — la sveglia in basso lo apre a scomparsa sul lato
// sinistro. Mostra solo un'anteprima rapida: vista mensile in alto, sotto la
// stessa vista "Task" della modalità piano (nessuna vista duplicata). Il
// pulsante di espansione apre la modalità piano per intero.
export default function SchedulePanel({ open, onClose, onExpand, preloadedTasks, onSelectSection, notebooks, sectionsMap }) {
  const TODAY = todayMidnight();
  const [tasks, setTasks] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [calMonth, setCalMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  useEffect(() => {
    if (preloadedTasks) { setTasks(preloadedTasks); return; }
    if (open && !tasks.length) load();
  }, [open, preloadedTasks]); // eslint-disable-line

  useEffect(() => {
    if (open) loadCalendar(calMonth);
  }, [open, calMonth]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const cached = cacheGet('planner_config');
        const cfg = cached || await loadPlannerConfig();
        if (cfg) setConfig(cfg);
      } catch (e) { console.error('planner config load', e); }
    })();
  }, [open]);

  async function load() {
    try {
      const lists = await getTodoLists();
      const allTasks = [];
      for (const l of lists) {
        try {
          const t = await getTodoTasks(l.id);
          allTasks.push(...t.map(x => ({ ...x, _listName: l.displayName, _listId: l.id })));
        } catch (e) { console.error('load tasks', l.displayName, e); }
        await new Promise(r => setTimeout(r, 150));
      }
      setTasks(allTasks);
    } catch (e) { console.error(e); }
  }

  async function loadCalendar(month) {
    try {
      const start = new Date(month.getFullYear(), month.getMonth(), 1);
      const end   = new Date(month.getFullYear(), month.getMonth()+1, 0, 23, 59, 59);
      setEvents(await getCalendarEvents(start, end));
    } catch (e) { console.error(e); }
  }

  const taskDates = tasks.filter(t => t.dueDateTime?.dateTime).map(t => ({
    date: parseLocalDate(t.dueDateTime.dateTime),
    title: t.title, important: t.importance === 'high', listName: t._listName,
  }));

  function eventsForDay(day) {
    return events.filter(e => {
      const s = e.start?.dateTime || e.start?.date;
      return s && sameDay(parseLocalDate(s), day);
    });
  }
  function tasksForDay(day) {
    return taskDates.filter(t => t.date && sameDay(t.date, day));
  }

  // Griglia mese
  function buildGrid(month) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last  = new Date(month.getFullYear(), month.getMonth()+1, 0);
    let dow = first.getDay()-1; if (dow<0) dow=6;
    const cells = [];
    for (let i=0; i<dow; i++) cells.push(null);
    for (let d=1; d<=last.getDate(); d++) cells.push(new Date(month.getFullYear(),month.getMonth(),d));
    return cells;
  }

  function handleTaskClick(task) {
    setSelectedTaskId(task.id);
    if (!onSelectSection || !task._listName) return;
    const lower = task._listName.toLowerCase();
    for (const [nbId, sects] of Object.entries(sectionsMap || {})) {
      const sec = sects.find(s => s.displayName.toLowerCase() === lower);
      if (sec) { onSelectSection(sec, { id: nbId, _color: '#c8a96e' }, 'todo'); return; }
    }
  }

  return (
    <div className={`schedule-panel ${open?'open':''}`}>
      <div className="schedule-head">
        <h2 className="schedule-panel-title">Attività</h2>
        {onExpand && (
          <button className="schedule-expand-btn" onClick={onExpand} title="Apri il Piano completo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
      </div>

      <div className="schedule-panel-inner">

        {/* ── Vista mensile ── */}
        <div className="schedule-month-section">
          <div className="cal-panel-header">
            <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))}>‹</button>
            <span className="cal-panel-label">{MONTHS_IT[calMonth.getMonth()].slice(0,3)} {calMonth.getFullYear()}</span>
            <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))}>›</button>
          </div>
          <div className="mini-cal-grid">
            {DAYS_IT.map((d,i) => <div key={i} className="mini-cal-dow">{d}</div>)}
            {buildGrid(calMonth).map((day,i) => {
              if (!day) return <div key={i} className="mini-cal-cell empty"/>;
              const isToday = sameDay(day, TODAY);
              const isSel = selectedDay && sameDay(day, selectedDay);
              const dayEvs = eventsForDay(day);
              const hasTk = tasksForDay(day).length > 0;
              return (
                <div key={i}
                  className={`mini-cal-cell ${isToday?'today':''} ${isSel?'selected':''} ${dayEvs.length||hasTk?'has-items':''}`}
                  onClick={() => setSelectedDay(isSel?null:day)}>
                  <span className="mini-cal-day-num">{day.getDate()}</span>
                  <div className="mini-cal-dots">
                    {dayEvs.length > 0 && <span className="cal-dot event"/>}
                    {hasTk && <span className="cal-dot task"/>}
                  </div>
                </div>
              );
            })}
          </div>
          {selectedDay && (() => {
            const dayEvs = eventsForDay(selectedDay);
            const dayTks = tasksForDay(selectedDay);
            return (
              <div className="week-day-detail">
                <div className="week-day-detail-title">
                  {selectedDay.getDate()} {MONTHS_IT[selectedDay.getMonth()]}
                  <button className="week-day-detail-close" onClick={() => setSelectedDay(null)}>✕</button>
                </div>
                {dayEvs.map((e,i) => (
                  <div key={i} className="cal-event-row">
                    <span className="cal-event-time">
                      {e.isAllDay ? 'Tutto il giorno' : parseDT(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                    </span>
                    <span className="cal-event-title">{e.subject}</span>
                  </div>
                ))}
                {dayTks.map((t,i) => (
                  <div key={i} className="cal-task-row">
                    {t.important && <span className="cal-star">★</span>}
                    <span className="cal-task-title">{t.title}</span>
                    <span className="cal-task-list">{t.listName}</span>
                  </div>
                ))}
                {!dayEvs.length && !dayTks.length && <div className="cal-empty-day">Nessun evento</div>}
              </div>
            );
          })()}
        </div>

        {/* ── Vista Task — identica alla colonna sinistra della modalità piano ── */}
        <div className="schedule-tasks-section">
          <TaskPool
            title="Task"
            tasks={tasks}
            config={config}
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            selectedTaskId={selectedTaskId}
            onTaskClick={handleTaskClick}
            draggable={false}
          />
        </div>

      </div>
      <button className="panel-close-tab" onClick={onClose} title="Chiudi">—</button>
    </div>
  );
}
