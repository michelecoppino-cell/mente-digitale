import { useState, useEffect } from 'react';
import { getPages } from './api';
import { leggiTaskAperti, creaTask, aggiornaTask } from './taskStore';
import { filterEventsBySectionPrefix, parseReminderSubject } from './deadlineReminders';
import Skeleton from './Skeleton';
import OneDriveBox from './OneDriveBox';
import { formatDueDate } from './plannerShared';
import { listDeliverableLabel } from './paraConfig';
import { openProtocol } from './protocolLink';
import { useEscape } from './useEscape';

// calendarEvents: elenco già precaricato in App.jsx (preloadSectionCalendarEvents,
// un'unica chiamata Graph in coda dopo task/pagine) — qui si filtra solo
// localmente per prefisso "[NomeSezione]", nessuna nuova richiesta di rete a
// ogni apertura del pannello (era il collo di bottiglia lento lamentato).
//
// `selected.lists` sono le liste della sezione: quella omonima e le sue
// consegne (`GRUPPO.Nome-YYMMDD`, vedi paraConfig.js). Il pannello le legge
// tutte; `selected.listId` resta la principale, ed è lì che nasce un'attività
// creata da qui — una consegna la si sceglie dalla plancia Sezioni, non da una
// striscia laterale.
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
      const lists = selected.lists?.length
        ? selected.lists
        : (selected.listId ? [{ id: selected.listId, displayName: selected.listName }] : []);
      if (lists.length) loadTasks(lists);
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

  // Le attività di tutte le liste della sezione in un elenco solo: ogni task si
  // porta dietro la lista da cui viene, perché la riga possa dire di quale
  // consegna è.
  async function loadTasks(lists) {
    if (lists.some(l => !tasksCache?.current?.[l.id])) setLoadingTasks(true);
    try {
      const perList = await Promise.all(lists.map(async l => {
        const cached = tasksCache?.current?.[l.id];
        const all = cached || await leggiTaskAperti(l.id);
        if (!cached && tasksCache?.current) tasksCache.current[l.id] = all;
        return all.map(t => ({ ...t, _listId: l.id, _listName: l.displayName }));
      }));
      splitTasks(perList.flat());
    } catch(e) { console.error(e); }
    setLoadingTasks(false);
  }

  // Le attività con una scadenza in alto, le altre sotto. Prima le senza
  // scadenza si ordinavano mettendo davanti quelle "importanti": era il flag
  // di To-Do, che si poteva accendere solo dall'app To-Do — e quella non si
  // usa. Con l'archivio nostro quel flag non esiste più, e non manca a nessuno.
  function splitTasks(all) {
    setTasks(all.filter(t => t.scadenza));
    setNoDeadlineTasks(all.filter(t => !t.scadenza));
  }

  async function handleAddTask() {
    if (!newTask.trim() || !selected?.listId) return;
    setAdding(true);
    try {
      const created = await creaTask(selected.listId, { titolo: newTask.trim() });
      const task = { ...created, _listId: selected.listId, _listName: selected.listName };
      setNoDeadlineTasks(prev => [task, ...prev]);
      if (tasksCache?.current?.[selected.listId])
        tasksCache.current[selected.listId] = [task, ...tasksCache.current[selected.listId]];
      setNewTask('');
    } catch(e) { console.error(e); }
    setAdding(false);
  }

  async function handleComplete(task) {
    const listId = task._listId || selected?.listId;
    if (!listId) return;
    try {
      await aggiornaTask(listId, task.id, { stato: 'done' });
      setTasks(prev => prev.filter(t => t.id !== task.id));
      setNoDeadlineTasks(prev => prev.filter(t => t.id !== task.id));
      if (tasksCache?.current?.[listId])
        tasksCache.current[listId] = tasksCache.current[listId].filter(t => t.id !== task.id);
    } catch(e) { console.error(e); }
  }

  // Escape chiude la striscia laterale, come chiude ogni altro pannello.
  useEscape(!!selected, onClose);

  if (!selected) return <div className="panel" />;

  const { data, nb, listId } = selected;
  const color = data?._color || nb?._color || '#d4a44a';
  // Con più consegne la riga deve dire di quale è: con una sola sarebbe la
  // ripetizione del titolo del pannello.
  const manyLists = (selected.lists?.length || 0) > 1;
  const allTasks = [...tasks, ...noDeadlineTasks];
  // Le scadenze ricorrenti sono eventi intitolati "[NomeLista] Titolo": con le
  // consegne annidate le liste sono più d'una, quindi si guardano tutte —
  // insieme al nome della sezione, che è come si chiamano gli eventi di sempre.
  const eventPrefixes = [data.displayName, ...(selected.lists || []).map(l => l.displayName)]
    .filter((n, i, all) => n && all.indexOf(n) === i);
  const sortedEvents = Object.values(Object.fromEntries(
    eventPrefixes
      .flatMap(name => filterEventsBySectionPrefix(calendarEvents, name))
      .map(ev => [ev.id, ev])
  )).sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));

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
                {tasks.map(t => <TaskRow key={t.id} task={t} color={color} showList={manyLists} onComplete={handleComplete} />)}
                {noDeadlineTasks.map(t => <TaskRow key={t.id} task={t} color={color} showList={manyLists} onComplete={handleComplete} />)}
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

function TaskRow({ task, color, onComplete, showList = false }) {
  const [completing, setCompleting] = useState(false);
  const due = formatDueDate(task.scadenza);

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
      <div className="task-row-content">
        <div className="task-title">
          {task.titolo}
        </div>
        {(due || (showList && task._listName)) && (
          <div className="task-due">
            {[showList && task._listName ? listDeliverableLabel(task._listName) : null, due]
              .filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
