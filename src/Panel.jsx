import { useState, useEffect } from 'react';
import { getPages, getTodoTasks, createTask, completeTask } from './api';
import { filterEventsBySectionPrefix, parseReminderSubject } from './deadlineReminders';
import Skeleton from './Skeleton';
import OneDriveBox from './OneDriveBox';
import { formatDueDate } from './plannerShared';
import { openProtocol } from './protocolLink';

// calendarEvents: elenco già precaricato in App.jsx (preloadSectionCalendarEvents,
// un'unica chiamata Graph in coda dopo task/pagine) — qui si filtra solo
// localmente per prefisso "[NomeSezione]", nessuna nuova richiesta di rete a
// ogni apertura del pannello (era il collo di bottiglia lento lamentato).
export default function Panel({ selected, pagesCache, tasksCache, calendarEvents, onClose }) {
  const [pages, setPages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [noDeadlineTasks, setNoDeadlineTasks] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setPages([]);
    setTasks([]);
    setNoDeadlineTasks([]);
    setNewTask('');
    if (!selected) return;
    setTimeout(() => {
      loadPages(selected.data.id);
      if (selected.listId) loadTasks(selected.listId);
    }, 0);
  }, [selected]);

  async function loadPages(sectionId) {
    // Usa sempre la cache se disponibile — ricarica solo con il pulsante refresh
    if (pagesCache?.current?.[sectionId]) {
      setPages(pagesCache.current[sectionId]);
      return;
    }
    setLoadingPages(true);
    try {
      const p = await getPages(sectionId);
      if (pagesCache?.current) pagesCache.current[sectionId] = p;
      setPages(p);
    } catch(e) { console.error(e); }
    setLoadingPages(false);
  }

  async function loadTasks(listId) {
    if (tasksCache?.current?.[listId]) {
      splitTasks(tasksCache.current[listId]);
      return;
    }
    setLoadingTasks(true);
    try {
      const all = await getTodoTasks(listId);
      if (tasksCache?.current) tasksCache.current[listId] = all;
      splitTasks(all);
    } catch(e) { console.error(e); }
    setLoadingTasks(false);
  }

  function splitTasks(all) {
    const withDue = all.filter(t => t.dueDateTime?.dateTime);
    const noDue = [
      ...all.filter(t => !t.dueDateTime?.dateTime && t.importance === 'high'),
      ...all.filter(t => !t.dueDateTime?.dateTime && t.importance !== 'high'),
    ];
    setTasks(withDue);
    setNoDeadlineTasks(noDue);
  }

  async function handleAddTask() {
    if (!newTask.trim() || !selected?.listId) return;
    setAdding(true);
    try {
      const task = await createTask(selected.listId, newTask.trim());
      setNoDeadlineTasks(prev => [task, ...prev]);
      if (tasksCache?.current?.[selected.listId])
        tasksCache.current[selected.listId] = [task, ...tasksCache.current[selected.listId]];
      setNewTask('');
    } catch(e) { console.error(e); }
    setAdding(false);
  }

  async function handleComplete(task) {
    if (!selected?.listId) return;
    try {
      await completeTask(selected.listId, task.id);
      setTasks(prev => prev.filter(t => t.id !== task.id));
      setNoDeadlineTasks(prev => prev.filter(t => t.id !== task.id));
      if (tasksCache?.current?.[selected.listId])
        tasksCache.current[selected.listId] = tasksCache.current[selected.listId].filter(t => t.id !== task.id);
    } catch(e) { console.error(e); }
  }

  if (!selected) return <div className="panel" />;

  const { data, nb, listId } = selected;
  const color = data?._color || nb?._color || '#d4a44a';
  const allTasks = [...tasks, ...noDeadlineTasks];
  const sortedEvents = filterEventsBySectionPrefix(calendarEvents, data.displayName)
    .sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));

  return (
    <div className="panel open">
      <div className="panel-head">
        <div className="panel-title" style={{ color }}>{data.displayName}</div>
      </div>

      <div className="panel-body panel-3col">

        {/* ── ToDo/Calendario ── */}
        <div className="panel-col">
          <div className="panel-col-header" style={{ color }}>
            <span>ToDo/Calendario</span>
            {(allTasks.length + sortedEvents.length) > 0 && (
              <span className="panel-col-count">{allTasks.length + sortedEvents.length}</span>
            )}
          </div>
          {listId ? (
            <>
              <div className="add-task-row">
                <input className="add-task-input" placeholder="Nuova attività…"
                  value={newTask} onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                  style={{ borderColor: color + '33' }} />
                <button className="add-task-btn" onClick={handleAddTask}
                  disabled={adding || !newTask.trim()} style={{ color, borderColor: color + '33' }}>
                  {adding ? '…' : '+'}
                </button>
              </div>
              {loadingTasks && <Skeleton rows={4} />}
              <div className="panel-col-body">
                {sortedEvents.map(ev => <CalendarEventRow key={ev.id} event={ev} color={color} />)}
                {tasks.map(t => <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />)}
                {noDeadlineTasks.map(t => <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />)}
                {!loadingTasks && !allTasks.length && !sortedEvents.length && (
                  <div className="panel-empty">Nessuna attività</div>
                )}
              </div>
            </>
          ) : (
            <div className="panel-empty">Nessuna lista ToDo collegata</div>
          )}
        </div>

        {/* ── OneNote ── */}
        <div className="panel-col">
          <div className="panel-col-header" style={{ color }}>
            <span>OneNote</span>
            {pages.length > 0 && <span className="panel-col-count">{pages.length}</span>}
          </div>
          {/* Link apri sezione */}
          {data.links?.oneNoteClientUrl?.href && (
            <div className="onenote-open-link" onClick={() => openProtocol(data.links.oneNoteClientUrl.href)}>
              ↗ Apri sezione
            </div>
          )}
          {loadingPages && <Skeleton rows={5} />}
          <div className="panel-col-body">
            <PageTree pages={pages} />
            {!loadingPages && !pages.length && <div className="panel-empty">Nessuna pagina</div>}
          </div>
        </div>

        {/* ── OneDrive ── */}
        <div className="panel-col">
          <OneDriveBox sectionId={data.id} color={color} />
        </div>

      </div>
      <button className="panel-close-tab" onClick={onClose} title="Chiudi">—</button>
    </div>
  );
}

export function PageTree({ pages }) {
  const [expanded, setExpanded] = useState({});

  // Ordina per order (posizione in OneNote)
  const sorted = [...pages].sort((a, b) => (a.order || 0) - (b.order || 0));

  // Costruisci albero: ogni pagina con level > parentLevel è figlia
  // Le pagine sono ordinate per posizione, quindi i figli seguono sempre il parent
  function buildTree(allPages) {
    const roots = [];
    const stack = []; // stack di {page, children}

    allPages.forEach(p => {
      const level = p.level || 0;
      const node = { page: p, children: [] };

      // Risali lo stack fino a trovare il parent corretto
      while (stack.length > 0 && (stack[stack.length - 1].page.level || 0) >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    });
    return roots;
  }

  const tree = buildTree(sorted);

  function openPage(p) {
    if (p.links?.oneNoteClientUrl?.href) openProtocol(p.links.oneNoteClientUrl.href);
  }

  function renderNode(node, depth = 0) {
    const { page: p, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expanded[p.id];

    return (
      <div key={p.id}>
        <div className="page-link" style={{ paddingLeft: depth * 14 + 4 }}
          onClick={() => openPage(p)}>
          {hasChildren ? (
            <span className="page-expand-btn"
              onClick={e => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] })); }}>
              {isExpanded ? '▾' : '▸'}
            </span>
          ) : (
            depth > 0 && <span className="page-expand-btn" style={{opacity:0}}>·</span>
          )}
          {p.title || 'Senza titolo'}
        </div>
        {hasChildren && isExpanded && children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  }

  return <>{tree.map(n => renderNode(n, 0))}</>;
}

// Evento Calendario di scadenza (titolo "[NomeSezione] Titolo", vedi
// deadlineReminders.js): mostrato nella stessa colonna dei task ToDo,
// distinto da un'icona calendario invece del pallino di completamento —
// non è completabile da qui, si spunta il task che genera quando scatta.
function CalendarEventRow({ event, color }) {
  const parsed = parseReminderSubject(event.subject);
  const label = parsed?.title || event.subject;
  const due = formatDueDate(event.start);

  return (
    <div className="task-row-item">
      <span className="cal-event-icon" style={{ color: color + 'aa' }}>📅</span>
      <div
        className="task-row-content"
        onClick={() => event.webLink && openProtocol(event.webLink)}
        style={{ cursor: event.webLink ? 'pointer' : 'default' }}>
        <div className="task-title">{label}</div>
        {due && <div className="task-due">{due}</div>}
      </div>
    </div>
  );
}

function TaskRow({ task, color, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';
  const appUrl = `ms-to-do://tasks/id/${task.id}`;
  const due = formatDueDate(task.dueDateTime);

  async function handleComplete(e) {
    e.stopPropagation();
    setCompleting(true);
    await onComplete(task);
    setCompleting(false);
  }

  return (
    <div className={`task-row-item ${completing ? 'completing' : ''}`}>
      <button className="schedule-check-btn" onClick={handleComplete}>
        <div className="task-check" style={{ borderColor: completing ? '#86c07a' : color + '55' }}>
          {completing && <span className="check-mark">✓</span>}
        </div>
      </button>
      <div className="task-row-content" onClick={() => openProtocol(appUrl)} style={{ cursor: 'pointer' }}>
        <div className="task-title" style={{ color: isImportant ? color : 'var(--text)' }}>
          {isImportant && <span className="task-important">★ </span>}
          {task.title}
        </div>
        {due && <div className="task-due">{due}</div>}
      </div>
    </div>
  );
}
