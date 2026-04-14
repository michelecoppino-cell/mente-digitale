import { useState, useEffect, useRef } from 'react';
import { getTodoLists, completeTask, getCalendarEvents } from './api';
import { getToken } from './auth';

const TODAY = new Date();
TODAY.setHours(0,0,0,0);

const START_HOUR = 0;
const END_HOUR   = 24;
const HOUR_H     = 18; // px per ora nella griglia

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate()-r.getDay()+1); r.setHours(0,0,0,0); return r; }
function endOfWeek(d) { return addDays(startOfWeek(d),6); }
function sameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }

function parseLocalDate(s) {
  const d = new Date(s.endsWith('Z')?s:s+'Z');
  return new Date(d.getFullYear(),d.getMonth(),d.getDate());
}

const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const DAYS_IT   = ['L','M','M','G','V','S','D'];
const DAYS_ABB  = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

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

// Posizione verticale di un evento nella griglia (hh = px per ora)
function evTop(e, hh) {
  if (!e.start?.dateTime) return 0;
  const dt = new Date(e.start.dateTime);
  return Math.max(0, (dt.getHours() + dt.getMinutes()/60 - START_HOUR) * hh);
}
function evHeight(e, hh) {
  if (!e.start?.dateTime || !e.end?.dateTime) return hh;
  const dur = (new Date(e.end.dateTime) - new Date(e.start.dateTime)) / 3600000;
  return Math.max(dur * hh, 14);
}

export default function SchedulePanel({ open, onClose, preloadedTasks, onSelectSection, sectionsMap }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calView, setCalView] = useState('week'); // 'week' | 'month'
  const [calExpanded, setCalExpanded] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date());
  const [calWeek, setCalWeek]   = useState(() => startOfWeek(new Date()));
  const [events, setEvents]     = useState([]);
  const [taskDates, setTaskDates] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [, setCalLoading] = useState(false);
  const gridRef = useRef(null);

  useEffect(() => {
    if (preloadedTasks) { setTasks(preloadedTasks); return; }
    if (open && !tasks.length) load();
  }, [open, preloadedTasks]);

  useEffect(() => {
    if (open) loadCalendar(calMonth);
  }, [open, calMonth]);

  useEffect(() => {
    const td = tasks.filter(t => t.dueDateTime?.dateTime).map(t => ({
      date: parseLocalDate(t.dueDateTime.dateTime),
      title: t.title, important: t.importance==='high', listName: t._listName
    }));
    setTaskDates(td);
  }, [tasks]);

  // Scrolla la griglia all'ora corrente quando si apre in vista settimana
  useEffect(() => {
    if (open && calView==='week' && gridRef.current) {
      const h = new Date().getHours() - 1;
      gridRef.current.scrollTop = Math.max(0, (h - START_HOUR) * effectiveHourH);
    }
  }, [open, calView, calExpanded]);

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
      const end   = new Date(month.getFullYear(), month.getMonth()+1, 0, 23, 59, 59);
      setEvents(await getCalendarEvents(start, end));
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

  function handleOpenPanel(task) {
    if (!onSelectSection || !task._listName) return;
    const lower = task._listName.toLowerCase();
    for (const [nbId, sects] of Object.entries(sectionsMap || {})) {
      const sec = sects.find(s => s.displayName.toLowerCase() === lower);
      if (sec) { onSelectSection(sec, { id: nbId, _color: '#c8a96e' }, 'todo'); return; }
    }
  }

  function navigateWeek(dir) {
    const next = addDays(calWeek, dir * 7);
    setCalWeek(next);
    const m = new Date(next.getFullYear(), next.getMonth(), 1);
    if (m.getMonth() !== calMonth.getMonth() || m.getFullYear() !== calMonth.getFullYear())
      setCalMonth(m);
  }

  function eventsForDay(day) {
    return events.filter(e => {
      const s = e.start?.dateTime || e.start?.date;
      return s && sameDay(parseLocalDate(s), day);
    });
  }
  function tasksForDay(day) {
    return taskDates.filter(t => t.date && sameDay(t.date, day));
  }

  const groups    = groupTasks(tasks.filter(t => t.dueDateTime?.dateTime));
  const noDeadline = [
    ...tasks.filter(t => !t.dueDateTime?.dateTime && t.importance==='high'),
    ...tasks.filter(t => !t.dueDateTime?.dateTime && t.importance!=='high'),
  ].slice(0,10);

  // Label header settimana
  const weekEnd = addDays(calWeek, 6);
  const weekLabel = calWeek.getMonth() === weekEnd.getMonth()
    ? `${calWeek.getDate()} – ${weekEnd.getDate()} ${MONTHS_IT[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`
    : `${calWeek.getDate()} ${MONTHS_IT[calWeek.getMonth()].slice(0,3)} – ${weekEnd.getDate()} ${MONTHS_IT[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`;

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

  // Ore da visualizzare (ogni 4h per compattezza)
  const hours = Array.from({length: END_HOUR - START_HOUR}, (_, i) => START_HOUR + i);
  const hourTicks = hours.filter(h => h % 4 === 0);
  const effectiveHourH = calExpanded ? HOUR_H * 2 : HOUR_H;
  const totalH = hours.length * effectiveHourH;

  // Ora corrente per la linea rossa
  const nowOffset = (() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes()/60;
    return (h >= START_HOUR && h <= END_HOUR) ? (h - START_HOUR) * effectiveHourH : null;
  })();

  return (
    <div className={`schedule-panel ${open?'open':''}`}>
      <div className="schedule-head">
        <h2 className="schedule-panel-title">Attività</h2>
      </div>

      <div className="schedule-panel-inner">

        {/* ── Task ── */}
        <div className={`schedule-tasks-section ${calExpanded?'tasks-collapsed':''}`}>
          {loading && <div className="panel-loading">Caricamento…</div>}
          {groups.map(group => (
            <div key={group.key} className="schedule-group">
              <div className={`schedule-group-label ${group.key==='overdue'?'overdue':''}`}>
                {group.label}<span className="schedule-count">{group.tasks.length}</span>
              </div>
              {group.tasks.map(t => <ScheduleTask key={t.id} task={t} onComplete={handleComplete} onOpenPanel={onSelectSection ? t => handleOpenPanel(t) : null}/>)}
            </div>
          ))}
          {noDeadline.length > 0 && (
            <div className="schedule-group">
              <div className="schedule-group-label">Da fare<span className="schedule-count">{noDeadline.length}</span></div>
              {noDeadline.map(t => <ScheduleTask key={t.id} task={t} onComplete={handleComplete} onOpenPanel={onSelectSection ? t => handleOpenPanel(t) : null}/>)}
            </div>
          )}
          {!loading && !groups.length && !noDeadline.length && (
            <div className="panel-loading">Nessun task aperto</div>
          )}
        </div>

        {/* ── Calendario ── */}
        <div className={`schedule-cal-section ${calExpanded?'cal-expanded':''}`}>

          {/* Header */}
          <div className="cal-panel-header">
            {calView === 'week' ? (
              <>
                <button className="cal-nav-btn" onClick={() => navigateWeek(-1)}>‹</button>
                <span className="cal-panel-label">{weekLabel}</span>
                <button className="cal-nav-btn" onClick={() => navigateWeek(1)}>›</button>
              </>
            ) : (
              <>
                <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button>
                <span className="cal-panel-label">{MONTHS_IT[calMonth.getMonth()].slice(0,3)} {calMonth.getFullYear()}</span>
                <button className="cal-nav-btn" onClick={() => setCalMonth(m => new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button>
              </>
            )}
            <div className="cal-view-toggle">
              <button className={calView==='week'?'active':''} onClick={() => setCalView('week')}>Sett.</button>
              <button className={calView==='month'?'active':''} onClick={() => setCalView('month')}>Mese</button>
              <button className={calExpanded?'active':''} onClick={() => setCalExpanded(e=>!e)} title={calExpanded?'Riduci':'Espandi'}>{calExpanded?'↑':'↓'}</button>
            </div>
          </div>

          {/* ── Vista settimana ── */}
          {calView === 'week' && (
            <>
              {/* Intestazioni giorni */}
              <div className="week-days-row">
                <div className="week-axis-spacer"/>
                {[0,1,2,3,4,5,6].map(i => {
                  const day = addDays(calWeek, i);
                  const isToday = sameDay(day, TODAY);
                  const tks = tasksForDay(day);
                  const allDay = eventsForDay(day).filter(e => e.isAllDay);
                  return (
                    <div key={i} className={`week-day-header${isToday?' today':''}`}
                      onClick={() => setSelectedDay(selectedDay && sameDay(selectedDay,day) ? null : day)}>
                      <span className="week-day-name">{DAYS_ABB[i]}</span>
                      <span className={`week-day-num${isToday?' today':''}`}>{day.getDate()}</span>
                      {tks.length > 0 && <span className="week-task-badge">{tks.length}</span>}
                      {allDay.map((e,j) => (
                        <div key={j} className="week-allday-event" title={e.subject}>{e.subject}</div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Griglia 24h */}
              <div className="week-time-grid" ref={gridRef}>
                {/* Colonna ore */}
                <div className="week-time-axis" style={{height: totalH, position:'relative'}}>
                  {hourTicks.map(h => (
                    <div key={h} className="week-hour-tick"
                      style={{position:'absolute', top:(h-START_HOUR)*effectiveHourH, width:'100%'}}>
                      <span>{h}</span>
                    </div>
                  ))}
                </div>

                {/* Colonne giorni */}
                {[0,1,2,3,4,5,6].map(i => {
                  const day = addDays(calWeek, i);
                  const isToday = sameDay(day, TODAY);
                  const dayEvs = eventsForDay(day).filter(e => !e.isAllDay && e.start?.dateTime);
                  const isSel = selectedDay && sameDay(day, selectedDay);
                  return (
                    <div key={i} className={`week-day-col${isToday?' today':''}${isSel?' selected':''}`}
                      style={{height: totalH}}>
                      {/* Linee ore */}
                      {hours.map(h => (
                        <div key={h} className="week-hour-line" style={{top:(h-START_HOUR)*effectiveHourH}}/>
                      ))}
                      {/* Linea ora corrente */}
                      {isToday && nowOffset !== null && (
                        <div className="week-now-line" style={{top: nowOffset}}/>
                      )}
                      {/* Eventi */}
                      {dayEvs.map((e,j) => (
                        <div key={j} className="week-event-block"
                          style={{top: evTop(e, effectiveHourH), height: evHeight(e, effectiveHourH)}}
                          title={e.subject}>
                          <span className="week-event-time-mini">
                            {new Date(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                          </span>
                          <span className="week-event-title">{e.subject}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Dettaglio giorno selezionato */}
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
                          {e.isAllDay ? 'Tutto il giorno' : new Date(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
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
            </>
          )}

          {/* ── Vista mese ── */}
          {calView === 'month' && (
            <div className="month-grid-panel">
              <div className={`mini-cal-grid ${calExpanded?'expanded':''}`}>
                {DAYS_IT.map((d,i) => <div key={i} className="mini-cal-dow">{d}</div>)}
                {buildGrid(calMonth).map((day,i) => {
                  if (!day) return <div key={i} className="mini-cal-cell empty"/>;
                  const isToday = sameDay(day,TODAY);
                  const isSel = selectedDay && sameDay(day,selectedDay);
                  const dayEvs = eventsForDay(day);
                  const hasTk = tasksForDay(day).length > 0;
                  return (
                    <div key={i}
                      className={`mini-cal-cell ${isToday?'today':''} ${isSel?'selected':''} ${dayEvs.length||hasTk?'has-items':''}`}
                      onClick={() => setSelectedDay(isSel?null:day)}>
                      <span className="mini-cal-day-num">{day.getDate()}</span>
                      {calExpanded ? (
                        <div className="mini-cal-previews">
                          {dayEvs.slice(0,2).map((e,j) => (
                            <div key={j} className="mini-cal-ev-preview" title={e.subject}>
                              {!e.isAllDay && e.start?.dateTime &&
                                <span className="mini-cal-ev-time">
                                  {new Date(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
                                </span>}
                              <span className="mini-cal-ev-name">{e.subject}</span>
                            </div>
                          ))}
                          {hasTk && <div className="mini-cal-ev-preview task-preview">✓ task</div>}
                        </div>
                      ) : (
                        <div className="mini-cal-dots">
                          {dayEvs.length > 0 && <span className="cal-dot event"/>}
                          {hasTk && <span className="cal-dot task"/>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Dettaglio giorno in vista mese */}
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
                          {e.isAllDay ? 'Tutto il giorno' : new Date(e.start.dateTime).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
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
          )}

        </div>
      </div>
      <button className="panel-close-tab" onClick={onClose} title="Chiudi">—</button>
    </div>
  );
}

function ScheduleTask({ task, onComplete, onOpenPanel }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';

  async function handleClick(e) {
    e.stopPropagation();
    setCompleting(true);
    await onComplete(task);
  }

  return (
    <div className={`schedule-task ${completing?'completing':''}`}
      onClick={onOpenPanel ? () => onOpenPanel(task) : undefined}
      style={{ cursor: onOpenPanel ? 'pointer' : 'default' }}>
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
