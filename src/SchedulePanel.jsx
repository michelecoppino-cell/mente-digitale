import { useState, useEffect } from 'react';
import { getTodoLists, completeTask } from './api';
import { getToken } from './auth';

const TODAY = new Date();
TODAY.setHours(0,0,0,0);

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate()-r.getDay()+1); r.setHours(0,0,0,0); return r; }
function endOfWeek(d) { return addDays(startOfWeek(d),6); }

function parseLocalDate(dateStr) {
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr+'Z');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'});
}

function groupTasks(tasks) {
  const tomorrow = addDays(TODAY,1);
  const endThisWeek = endOfWeek(TODAY);
  const endNextWeek = endOfWeek(addDays(TODAY,7));
  const end30 = addDays(TODAY,30);
  const groups = [
    {key:'overdue', label:'Scadute', tasks:[]},
    {key:'today', label:'Oggi', tasks:[]},
    {key:'tomorrow', label:'Domani', tasks:[]},
    {key:'thisweek', label:'Questa settimana', tasks:[]},
    {key:'nextweek', label:'Prossima settimana', tasks:[]},
    {key:'later', label:'Nei prossimi 30 giorni', tasks:[]},
    {key:'nodeadline', label:'Senza scadenza', tasks:[]},
  ];
  tasks.forEach(t => {
    if (!t.dueDateTime?.dateTime) { groups.find(g=>g.key==='nodeadline').tasks.push(t); return; }
    const due = parseLocalDate(t.dueDateTime.dateTime);
    if (due < TODAY) groups.find(g=>g.key==='overdue').tasks.push(t);
    else if (due.getTime()===TODAY.getTime()) groups.find(g=>g.key==='today').tasks.push(t);
    else if (due.getTime()===tomorrow.getTime()) groups.find(g=>g.key==='tomorrow').tasks.push(t);
    else if (due<=endThisWeek) groups.find(g=>g.key==='thisweek').tasks.push(t);
    else if (due<=endNextWeek) groups.find(g=>g.key==='nextweek').tasks.push(t);
    else if (due<=end30) groups.find(g=>g.key==='later').tasks.push(t);
  });
  return groups.filter(g=>g.tasks.length>0);
}

export default function SchedulePanel({ open, onClose, preloadedTasks }) {
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preloadedTasks) { setTasks(preloadedTasks); return; }
    if (open && !tasks.length) load();
  }, [open, preloadedTasks]);

  async function load() {
    setLoading(true);
    try {
      const ls = await getTodoLists();
      setLists(ls);
      const allTasks = [];
      for (const l of ls) {
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

  async function handleComplete(task) {
    if (!task._listId) return;
    try {
      await completeTask(task._listId, task.id);
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch(e) { console.error(e); }
  }

  // Separa task con scadenza da quelli senza
  const withDeadline = tasks.filter(t => t.dueDateTime?.dateTime);
  const noDeadline = tasks.filter(t => !t.dueDateTime?.dateTime);
  // Senza scadenza: stellati prima, poi gli altri, max 10
  const noDeadlineSorted = [
    ...noDeadline.filter(t => t.importance==='high'),
    ...noDeadline.filter(t => t.importance!=='high'),
  ].slice(0, 10);

  const groups = groupTasks(withDeadline);

  return (
    <div className={`schedule-panel ${open ? 'open' : ''}`}>
      <div className="schedule-head">
        <div>
          <div className="panel-label">Scadenze</div>
          <div className="schedule-title">Prossimi 30 giorni</div>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="schedule-body">
        {loading && <div className="panel-loading">Caricamento…</div>}

        {groups.map(group => (
          <div key={group.key} className="schedule-group">
            <div className={`schedule-group-label ${group.key==='overdue'?'overdue':''}`}>
              {group.label}
              <span className="schedule-count">{group.tasks.length}</span>
            </div>
            {group.tasks.map(t => (
              <ScheduleTask key={t.id} task={t} onComplete={handleComplete} />
            ))}
          </div>
        ))}

        {noDeadlineSorted.length > 0 && (
          <div className="schedule-group">
            <div className="schedule-group-label">
              Da fare
              <span className="schedule-count">{noDeadlineSorted.length}</span>
            </div>
            {noDeadlineSorted.map(t => (
              <ScheduleTask key={t.id} task={t} onComplete={handleComplete} />
            ))}
          </div>
        )}

        {!loading && !groups.length && !noDeadlineSorted.length && (
          <div className="panel-loading">Nessun task aperto</div>
        )}
      </div>
    </div>
  );
}

function ScheduleTask({ task, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';
  const due = task.dueDateTime?.dateTime ? formatDate(task.dueDateTime.dateTime) : null;

  async function handleClick() {
    setCompleting(true);
    await onComplete(task);
    setCompleting(false);
  }

  return (
    <div className={`schedule-task ${completing ? 'completing' : ''}`}>
      <button className="schedule-check-btn" onClick={handleClick} title="Segna come fatto">
        <div className="task-check" style={{ borderColor: completing ? '#86c07a' : 'var(--muted)' }}>
          {completing && <span className="check-mark">✓</span>}
        </div>
      </button>
      <div className="task-content">
        <div className="schedule-task-title">
          {isImportant && <span className="schedule-star">★ </span>}
          {task.title}
        </div>
        {task._listName && <div className="schedule-task-list">{task._listName}</div>}
      </div>
      <div className="schedule-task-right">
        {due && <span className="schedule-due">{due}</span>}
      </div>
    </div>
  );
}
