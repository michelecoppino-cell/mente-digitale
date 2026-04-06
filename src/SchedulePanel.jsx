import { useState, useEffect } from 'react';
import { getTodoTasks, getTodoLists } from './api';

const TODAY = new Date();
TODAY.setHours(0,0,0,0);

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay() + 1);
  r.setHours(0,0,0,0);
  return r;
}

function endOfWeek(d) {
  return addDays(startOfWeek(d), 6);
}

function groupTasks(tasks) {
  const tomorrow = addDays(TODAY, 1);
  const endThisWeek = endOfWeek(TODAY);
  const endNextWeek = endOfWeek(addDays(TODAY, 7));
  const end30 = addDays(TODAY, 30);

  const groups = [
    { key: 'today',     label: 'Oggi',            tasks: [] },
    { key: 'tomorrow',  label: 'Domani',           tasks: [] },
    { key: 'thisweek',  label: 'Questa settimana', tasks: [] },
    { key: 'nextweek',  label: 'Prossima settimana', tasks: [] },
    { key: 'later',     label: 'Nei prossimi 30 giorni', tasks: [] },
    { key: 'overdue',   label: 'Scadute',          tasks: [] },
  ];

  tasks.forEach(t => {
    if (!t.dueDateTime?.dateTime) return;
    const due = parseLocalDate(t.dueDateTime.dateTime);

    if (due < TODAY) groups.find(g => g.key === 'overdue').tasks.push(t);
    else if (due.getTime() === TODAY.getTime()) groups.find(g => g.key === 'today').tasks.push(t);
    else if (due.getTime() === tomorrow.getTime()) groups.find(g => g.key === 'tomorrow').tasks.push(t);
    else if (due <= endThisWeek) groups.find(g => g.key === 'thisweek').tasks.push(t);
    else if (due <= endNextWeek) groups.find(g => g.key === 'nextweek').tasks.push(t);
    else if (due <= end30) groups.find(g => g.key === 'later').tasks.push(t);
  });

  return groups.filter(g => g.tasks.length > 0);
}

function parseLocalDate(dateStr) {
  // new Date() converte automaticamente UTC in ora locale
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  // Estrae anno/mese/giorno nell'ora locale del browser
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

export default function SchedulePanel({ open, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && !tasks.length) load();
  }, [open]);

  async function load() {
    setLoading(true);
    try {
      const lists = await getTodoLists();
      // Chiamate sequenziali con piccolo ritardo per evitare 429
      const allTasks = [];
      for (const l of lists) {
        const tasks = await getTodoTasksWithDue(l.id, l.displayName);
        allTasks.push(...tasks);
        await new Promise(r => setTimeout(r, 150));
      }
      console.log('Sample task due:', allTasks[0]?.dueDateTime);
      setTasks(allTasks);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  const groups = groupTasks(tasks);

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
        {!loading && !groups.length && (
          <div className="panel-loading">Nessuna scadenza nei prossimi 30 giorni</div>
        )}
        {groups.map(group => (
          <div key={group.key} className="schedule-group">
            <div className={`schedule-group-label ${group.key === 'overdue' ? 'overdue' : ''}`}>
              {group.label}
              <span className="schedule-count">{group.tasks.length}</span>
            </div>
            {group.tasks.map(t => (
              <ScheduleTask key={t.id} task={t} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleTask({ task }) {
  const isImportant = task.importance === 'high';
  const due = task.dueDateTime?.dateTime ? formatDate(task.dueDateTime.dateTime) : null;

  return (
    <div className="schedule-task">
      <div className="schedule-task-left">
        <div className="task-check" style={{ borderColor: 'var(--muted)' }} />
      </div>
      <div className="task-content">
        <div className="schedule-task-title">
          {task.title}
        </div>
        {task._listName && (
          <div className="schedule-task-list">{task._listName}</div>
        )}
      </div>
      <div className="schedule-task-right">
        {isImportant && <span className="schedule-star">★</span>}
        {due && <span className="schedule-due">{due}</span>}
      </div>
    </div>
  );
}

// Versione che include scadenze anche completate no, solo aperte
async function getTodoTasksWithDue(listId, listName) {
  const { getTodoTasks } = await import('./api');
  // Prendi tutti i task con scadenza, non solo quelli non completati
  const token = await getTokenForSchedule();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks?$filter=status ne 'completed' and dueDateTime/dateTime ne null&$top=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.value || []).map(t => ({ ...t, _listName: listName }));
}

async function getTokenForSchedule() {
  const { getToken } = await import('./auth');
  return getToken();
}
