import { useState, useEffect } from 'react';
import { getPages, getTodoTasks, createTask, completeTask } from './api';

export default function Panel({ selected, sectionsMap, todoListsMap, pagesCache, tasksCache, onClose }) {
  const [items, setItems] = useState([]);
  const [noDeadlineItems, setNoDeadlineItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('onenote');
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setItems([]);
    setNoDeadlineItems([]);
    setNewTask('');
    if (!selected) return;
    const tab = selected.initialTab || 'onenote';
    setActiveTab(tab);
    // Carica in background senza bloccare UI
    setTimeout(() => {
      if (tab === 'todo' && selected.listId) loadTodo(selected.listId);
      else loadOneNote(selected.data.id);
    }, 0);
  }, [selected]);

  async function loadOneNote(sectionId) {
    if (pagesCache?.current?.[sectionId]) { setItems(pagesCache.current[sectionId]); return; }
    setLoading(true);
    try {
      const pages = await getPages(sectionId);
      if (pagesCache?.current) pagesCache.current[sectionId] = pages;
      setItems(pages);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function loadTodo(listId) {
    setLoading(true);
    try {
      let all;
      if (tasksCache?.current?.[listId]) {
        all = tasksCache.current[listId];
      } else {
        all = await getTodoTasks(listId);
        if (tasksCache?.current) tasksCache.current[listId] = all;
      }
      // Separa con scadenza e senza
      const withDue = all.filter(t => t.dueDateTime?.dateTime);
      const noDue = all.filter(t => !t.dueDateTime?.dateTime);
      // Senza scadenza: stellati prima, max 10
      const noDueSorted = [
        ...noDue.filter(t => t.importance === 'high'),
        ...noDue.filter(t => t.importance !== 'high'),
      ].slice(0, 10);
      setItems(withDue);
      setNoDeadlineItems(noDueSorted);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  async function handleAddTask() {
    if (!newTask.trim() || !selected?.listId) return;
    setAdding(true);
    try {
      const task = await createTask(selected.listId, newTask.trim());
      // Aggiunge ai task senza scadenza (è nuovo, non ha scadenza)
      setNoDeadlineItems(prev => [task, ...prev].slice(0, 10));
      if (tasksCache?.current?.[selected.listId]) {
        tasksCache.current[selected.listId] = [task, ...tasksCache.current[selected.listId]];
      }
      setNewTask('');
    } catch(e) { console.error(e); }
    setAdding(false);
  }

  async function handleComplete(task) {
    if (!selected?.listId) return;
    try {
      await completeTask(selected.listId, task.id);
      setItems(prev => prev.filter(t => t.id !== task.id));
      setNoDeadlineItems(prev => prev.filter(t => t.id !== task.id));
      if (tasksCache?.current?.[selected.listId]) {
        tasksCache.current[selected.listId] = tasksCache.current[selected.listId].filter(t => t.id !== task.id);
      }
    } catch(e) { console.error(e); }
  }

  if (!selected) return <div className="panel" />;

  const { data, nb, listId, listName } = selected;
  const color = nb?._color || '#c8a96e';
  const allTasks = [...items, ...noDeadlineItems];

  return (
    <div className="panel open">
      <div className="panel-head">
        <div>
          <div className="panel-label">{activeTab === 'todo' ? 'ToDo' : 'Sezione'}</div>
          <div className="panel-title" style={{ color }}>
            {activeTab === 'todo' ? (listName || data?.displayName) : data?.displayName}
          </div>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      {listId && (
        <div className="panel-tabs">
          <button className={`panel-tab ${activeTab==='onenote'?'active':''}`}
            style={{'--tab-color':color}}
            onClick={() => { setActiveTab('onenote'); loadOneNote(data.id); }}>
            OneNote
          </button>
          <button className={`panel-tab ${activeTab==='todo'?'active':''}`}
            style={{'--tab-color':color}}
            onClick={() => { setActiveTab('todo'); loadTodo(listId); }}>
            ToDo
          </button>
        </div>
      )}

      <div className="panel-body">
        {activeTab === 'onenote' && (
          <>
            <div className="panel-section">
              <div className="panel-section-title">Apri sezione</div>
              <LinkRow color={color} label={data.displayName}
                appUrl={data.links?.oneNoteClientUrl?.href}
                webUrl={data.links?.oneNoteWebUrl?.href} />
            </div>
            <div className="panel-section">
              <div className="panel-section-title">Ultime pagine</div>
              {loading && <div className="panel-loading">Caricamento…</div>}
              {items.map(p => (
                <LinkRow key={p.id} color={color+'77'} label={p.title||'Senza titolo'}
                  appUrl={p.links?.oneNoteClientUrl?.href}
                  webUrl={p.links?.oneNoteWebUrl?.href} />
              ))}
              {!loading && !items.length && <div className="panel-loading">Nessuna pagina</div>}
            </div>
          </>
        )}

        {activeTab === 'todo' && (
          <>
            <div className="add-task-row">
              <input
                className="add-task-input"
                placeholder="Aggiungi attività…"
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                style={{ borderColor: color + '44' }}
              />
              <button
                className="add-task-btn"
                onClick={handleAddTask}
                disabled={adding || !newTask.trim()}
                style={{ color, borderColor: color + '44' }}>
                {adding ? '…' : '+'}
              </button>
            </div>

            {loading && <div className="panel-loading">Caricamento…</div>}

            {items.length > 0 && (
              <div className="panel-section">
                <div className="panel-section-title">Con scadenza ({items.length})</div>
                {items.map(t => (
                  <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />
                ))}
              </div>
            )}

            {noDeadlineItems.length > 0 && (
              <div className="panel-section">
                <div className="panel-section-title">Da fare ({noDeadlineItems.length})</div>
                {noDeadlineItems.map(t => (
                  <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />
                ))}
              </div>
            )}

            {!loading && !allTasks.length && <div className="panel-loading">Nessuna attività</div>}
          </>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, color, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';
  const appUrl = `ms-to-do://tasks/id/${task.id}`;
  const webUrl = `https://to-do.live.com/tasks/id/${task.id}/details`;
  const due = task.dueDateTime?.dateTime
    ? (() => {
        const d = new Date(task.dueDateTime.dateTime.endsWith('Z') ? task.dueDateTime.dateTime : task.dueDateTime.dateTime+'Z');
        return new Date(d.getFullYear(),d.getMonth(),d.getDate()).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'});
      })()
    : null;

  async function handleComplete(e) {
    e.stopPropagation();
    setCompleting(true);
    await onComplete(task);
    setCompleting(false);
  }

  return (
    <div className={`link-row ${completing ? 'completing' : ''}`} style={{ alignItems: 'flex-start', gap: 8 }}>
      <button className="schedule-check-btn" onClick={handleComplete} style={{ marginTop: 2 }}>
        <div className="task-check" style={{ borderColor: completing ? '#86c07a' : color + '66' }}>
          {completing && <span className="check-mark">✓</span>}
        </div>
      </button>
      <div className="task-content" style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title" style={{ color: isImportant ? color : 'var(--text)', textDecoration: completing ? 'line-through' : 'none' }}>
          {isImportant && <span className="task-important">★ </span>}
          {task.title}
        </div>
        {due && <div className="task-due">{due}</div>}
      </div>
      <div className="link-btns" style={{ flexShrink: 0 }}>
        <button className="link-btn primary" onClick={() => window.location.href = appUrl} title="App">App</button>
        <button className="link-btn" onClick={() => window.open(webUrl,'_blank')} title="Web">Web</button>
      </div>
    </div>
  );
}

function LinkRow({ color, label, appUrl, webUrl }) {
  return (
    <div className="link-row">
      <span className="link-dot" style={{ background: color }} />
      <span className="link-label">{label}</span>
      <div className="link-btns">
        {appUrl && <button className="link-btn primary" onClick={() => window.location.href = appUrl}>App</button>}
        {webUrl && <button className="link-btn" onClick={() => window.open(webUrl,'_blank')}>Web</button>}
      </div>
    </div>
  );
}
