import { useState, useEffect } from 'react';
import { getTodoLists, completeTask, getCalendarEvents } from './api';
import { getToken } from './auth';

const TODAY = new Date();
TODAY.setHours(0,0,0,0);

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate()-r.getDay()+1); r.setHours(0,0,0,0); return r; }
function endOfWeek(d) { return addDays(startOfWeek(d),6); }
function sameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }

function parseLocalDate(dateStr) {
  const d = new Date(dateStr.endsWith('Z')?dateStr:dateStr+'Z');
  return new Date(d.getFullYear(),d.getMonth(),d.getDate());
}
function formatDate(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'});
}

const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const DAYS_IT = ['L','M','M','G','V','S','D'];

function groupTasks(tasks) {
  const tomorrow = addDays(TODAY,1);
  const endThisWeek = endOfWeek(TODAY);
  const endNextWeek = endOfWeek(addDays(TODAY,7));
  const end30 = addDays(TODAY,30);
  const groups = [
    {key:'overdue',label:'Scadute',tasks:[]},
    {key:'today',label:'Oggi',tasks:[]},
    {key:'tomorrow',label:'Domani',tasks:[]},
    {key:'thisweek',label:'Questa settimana',tasks:[]},
    {key:'nextweek',label:'Prossima settimana',tasks:[]},
    {key:'later',label:'Nei prossimi 30 giorni',tasks:[]},
  ];
  tasks.forEach(t => {
    if (!t.dueDateTime?.dateTime) return;
    const due = parseLocalDate(t.dueDateTime.dateTime);
    if (due < TODAY) groups.find(g=>g.key==='overdue').tasks.push(t);
    else if (sameDay(due,TODAY)) groups.find(g=>g.key==='today').tasks.push(t);
    else if (sameDay(due,tomorrow)) groups.find(g=>g.key==='tomorrow').tasks.push(t);
    else if (due<=endThisWeek) groups.find(g=>g.key==='thisweek').tasks.push(t);
    else if (due<=endNextWeek) groups.find(g=>g.key==='nextweek').tasks.push(t);
    else if (due<=end30) groups.find(g=>g.key==='later').tasks.push(t);
  });
  return groups.filter(g=>g.tasks.length>0);
}

export default function SchedulePanel({ open, onClose, preloadedTasks }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calModal, setCalModal] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [taskDates, setTaskDates] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [calLoading, setCalLoading] = useState(false);

  useEffect(() => {
    if (preloadedTasks) { setTasks(preloadedTasks); return; }
    if (open && !tasks.length) load();
  }, [open, preloadedTasks]);

  useEffect(() => {
    if (open) loadCalendar(calMonth);
  }, [open, calMonth]);

  async function load() {
    setLoading(true);
    try {
      const lists = await getTodoLists();
      const allTasks = [];
      for (const l of lists) {
        const token = await getToken();
        const r = await fetch(
          `https://graph.microsoft.com/v1.0/me/todo/lists/${l.id}/tasks?$filter=status ne 'completed'&$top=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) {
          const d = await r.json();
          allTasks.push(...(d.value||[]).map(t=>({...t,_listName:l.displayName,_listId:l.id})));
        }
        await new Promise(r=>setTimeout(r,150));
      }
      setTasks(allTasks);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function loadCalendar(month) {
    setCalLoading(true);
    try {
      const start = new Date(month.getFullYear(), month.getMonth(), 1);
      const end = new Date(month.getFullYear(), month.getMonth()+1, 0, 23, 59, 59);
      const evts = await getCalendarEvents(start, end);
      setEvents(evts);
      // Date task con scadenza nel mese
      const td = tasks.filter(t => t.dueDateTime?.dateTime).map(t => ({
        date: parseLocalDate(t.dueDateTime.dateTime),
        title: t.title,
        important: t.importance === 'high',
        listName: t._listName
      }));
      setTaskDates(td);
    } catch(e) { console.error(e); }
    setCalLoading(false);
  }

  async function handleComplete(task) {
    if (!task._listId) return;
    try {
      await completeTask(task._listId, task.id);
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch(e) { console.error(e); }
  }

  const withDeadline = tasks.filter(t => t.dueDateTime?.dateTime);
  const groups = groupTasks(withDeadline);
  const noDeadline = [
    ...tasks.filter(t => !t.dueDateTime?.dateTime && t.importance==='high'),
    ...tasks.filter(t => !t.dueDateTime?.dateTime && t.importance!=='high'),
  ].slice(0,10);

  // Mini calendario
  function buildGrid(month) {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth()+1, 0);
    let startDow = first.getDay()-1; if (startDow<0) startDow=6;
    const cells = [];
    for (let i=0; i<startDow; i++) cells.push(null);
    for (let d=1; d<=last.getDate(); d++) cells.push(new Date(month.getFullYear(),month.getMonth(),d));
    return cells;
  }

  function eventsForDay(day) {
    return events.filter(e => {
      const s = e.start?.dateTime || e.start?.date;
      if (!s) return false;
      const sd = parseLocalDate(s);
      return sameDay(sd, day);
    });
  }
  function tasksForDay(day) {
    return taskDates.filter(t => t.date && sameDay(t.date, day));
  }

  const miniGrid = buildGrid(calMonth);

  return (
    <>
      <div className={`schedule-panel ${open?'open':''}`}>
        <div className="schedule-head">
          <div className="panel-label">Attività</div>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="schedule-panel-inner">
          {/* 3/5 — Task */}
          <div className="schedule-tasks-section">
            {loading && <div className="panel-loading">Caricamento…</div>}
            {groups.map(group => (
              <div key={group.key} className="schedule-group">
                <div className={`schedule-group-label ${group.key==='overdue'?'overdue':''}`}>
                  {group.label}<span className="schedule-count">{group.tasks.length}</span>
                </div>
                {group.tasks.map(t => <ScheduleTask key={t.id} task={t} onComplete={handleComplete} />)}
              </div>
            ))}
            {noDeadline.length > 0 && (
              <div className="schedule-group">
                <div className="schedule-group-label">Da fare<span className="schedule-count">{noDeadline.length}</span></div>
                {noDeadline.map(t => <ScheduleTask key={t.id} task={t} onComplete={handleComplete} />)}
              </div>
            )}
            {!loading && !groups.length && !noDeadline.length && (
              <div className="panel-loading">Nessun task aperto</div>
            )}
          </div>

          {/* 2/5 — Mini calendario */}
          <div className="schedule-cal-section">
            <div className="mini-cal-header">
              <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button>
              <span className="mini-cal-month" onClick={() => setCalModal(true)} style={{cursor:'pointer'}}>
                {MONTHS_IT[calMonth.getMonth()].slice(0,3)} {calMonth.getFullYear()}
              </span>
              <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button>
              <button className="mini-cal-expand" onClick={() => setCalModal(true)} title="Apri grande">⛶</button>
            </div>
            <div className="mini-cal-grid">
              {DAYS_IT.map((d,i) => <div key={i} className="mini-cal-dow">{d}</div>)}
              {miniGrid.map((day,i) => {
                if (!day) return <div key={i} className="mini-cal-cell empty"/>;
                const isToday = sameDay(day,TODAY);
                const hasEv = eventsForDay(day).length > 0;
                const hasTk = tasksForDay(day).length > 0;
                return (
                  <div key={i}
                    className={`mini-cal-cell ${isToday?'today':''} ${hasEv||hasTk?'has-items':''}`}
                    onClick={() => { setSelectedDay(day); setCalModal(true); }}>
                    <span>{day.getDate()}</span>
                    <div className="mini-cal-dots">
                      {hasEv && <span className="cal-dot event"/>}
                      {hasTk && <span className="cal-dot task"/>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Modal calendario grande */}
      {calModal && (
        <div className="cal-modal-overlay" onClick={() => { setCalModal(false); setSelectedDay(null); }}>
          <div className="cal-modal" onClick={e => e.stopPropagation()}>
            <div className="cal-modal-head">
              <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button>
              <span className="cal-modal-title">{MONTHS_IT[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
              <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button>
              <button className="panel-close" style={{marginLeft:'auto'}} onClick={() => { setCalModal(false); setSelectedDay(null); }}>✕</button>
            </div>
            <div className="cal-modal-grid">
              {DAYS_IT.map((d,i) => <div key={i} className="cal-dow">{d}</div>)}
              {buildGrid(calMonth).map((day,i) => {
                if (!day) return <div key={i} className="cal-cell empty"/>;
                const isToday = sameDay(day,TODAY);
                const isSel = selectedDay && sameDay(day,selectedDay);
                const dayEv = eventsForDay(day);
                const dayTk = tasksForDay(day);
                return (
                  <div key={i}
                    className={`cal-cell ${isToday?'today':''} ${isSel?'selected':''} ${dayEv.length||dayTk.length?'has-items':''}`}
                    onClick={() => setSelectedDay(isSel?null:day)}>
                    <span className="cal-day-num">{day.getDate()}</span>
                    <div className="cal-dots">
                      {dayEv.slice(0,3).map((_,j) => <span key={j} className="cal-dot event"/>)}
                      {dayTk.slice(0,3).map((t,j) => <span key={'t'+j} className={`cal-dot task${t.important?' important':''}`}/>)}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedDay && (
              <div className="cal-day-detail">
                <div className="cal-detail-title">{selectedDay.getDate()} {MONTHS_IT[selectedDay.getMonth()]}</div>
                {eventsForDay(selectedDay).map(e => (
                  <div key={e.id} className="cal-event-row">
                    <span className="cal-event-time">
                      {e.isAllDay?'Tutto il giorno':new Date(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                    </span>
                    <span className="cal-event-title">{e.subject}</span>
                  </div>
                ))}
                {tasksForDay(selectedDay).map((t,i) => (
                  <div key={i} className="cal-task-row">
                    {t.important && <span className="cal-star">★</span>}
                    <span className="cal-task-title">{t.title}</span>
                    <span className="cal-task-list">{t.listName}</span>
                  </div>
                ))}
                {!eventsForDay(selectedDay).length && !tasksForDay(selectedDay).length && (
                  <div className="cal-empty-day">Nessun evento o scadenza</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ScheduleTask({ task, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';
  const due = task.dueDateTime?.dateTime ? formatDate(task.dueDateTime.dateTime) : null;

  async function handleClick(e) {
    e.stopPropagation();
    setCompleting(true);
    await onComplete(task);
  }

  return (
    <div className={`schedule-task ${completing?'completing':''}`}>
      <button className="schedule-check-btn" onClick={handleClick}>
        <div className="task-check" style={{borderColor:completing?'#86c07a':'var(--muted)'}}>
          {completing && <span className="check-mark">✓</span>}
        </div>
      </button>
      <div className="schedule-task-title-row">
        {isImportant && <span className="schedule-star">★ </span>}
        <span className="schedule-task-title-text">{task.title}</span>
      </div>
      {task._listName && <span className="schedule-task-list-right">{task._listName}</span>}
    </div>
  );
}
