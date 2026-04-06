import { useState, useEffect } from 'react';
import { getPages, getTodoTasks } from './api';

export default function Panel({ selected, sectionsMap, todoListsMap, pagesCache, tasksCache, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('onenote');

  useEffect(() => {
    setItems([]);
    if (!selected) return;
    const tab = selected.initialTab || 'onenote';
    setActiveTab(tab);
    if (tab === 'todo' && selected.listId) {
      loadTodo(selected.listId);
    } else {
      loadOneNote(selected.data.id);
    }
  }, [selected]);

  async function loadOneNote(sectionId) {
    // Usa cache se disponibile
    if (pagesCache?.current?.[sectionId]) {
      setItems(pagesCache.current[sectionId]);
      return;
    }
    setLoading(true);
    try {
      const pages = await getPages(sectionId);
      if (pagesCache?.current) pagesCache.current[sectionId] = pages;
      setItems(pages);
    }
    catch (e) { console.error(e); }
    setLoading(false);
  }

  async function loadTodo(listId) {
    // Usa cache se disponibile
    if (tasksCache?.current?.[listId]) {
      setItems(tasksCache.current[listId]);
      return;
    }
    setLoading(true);
    try {
      const tasks = await getTodoTasks(listId);
      if (tasksCache?.current) tasksCache.current[listId] = tasks;
      setItems(tasks);
    }
    catch (e) { console.error(e); }
    setLoading(false);
  }

  if (!selected) return <div className="panel" />;

  const { type, data, nb, listId, listName } = selected;
  const color = nb?._color || '#c8a96e';
  const sects = sectionsMap[nb?.id] || [];

  // Titolo pannello
  const panelLabel = activeTab === 'todo' ? 'ToDo' : 'Sezione';
  const panelTitle = activeTab === 'todo' ? (listName || data?.displayName) : data?.displayName;

  return (
    <div className="panel open">
      <div className="panel-head">
        <div>
          <div className="panel-label">{panelLabel}</div>
          <div className="panel-title" style={{ color }}>{panelTitle}</div>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      {/* Tab se sezione con lista ToDo collegata */}
      {type === 'section' && listId && (
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === 'onenote' ? 'active' : ''}`}
            style={{ '--tab-color': color }}
            onClick={() => { setActiveTab('onenote'); loadOneNote(data.id); }}>
            OneNote
          </button>
          <button
            className={`panel-tab ${activeTab === 'todo' ? 'active' : ''}`}
            style={{ '--tab-color': color }}
            onClick={() => { setActiveTab('todo'); loadTodo(listId); }}>
            ToDo
          </button>
        </div>
      )}

      <div className="panel-body">

        {/* Vista OneNote */}
        {activeTab === 'onenote' && type === 'section' && <>
          <PanelSection title="Apri sezione">
            <LinkRow color={color} label={data.displayName}
              appUrl={data.links?.oneNoteClientUrl?.href}
              webUrl={data.links?.oneNoteWebUrl?.href} />
          </PanelSection>
          <PanelSection title="Ultime pagine">
            {loading && <div className="panel-loading">Caricamento…</div>}
            {items.map(p => (
              <LinkRow key={p.id} color={color + '77'} label={p.title || 'Senza titolo'}
                appUrl={p.links?.oneNoteClientUrl?.href}
                webUrl={p.links?.oneNoteWebUrl?.href} />
            ))}
            {!loading && !items.length && <div className="panel-loading">Nessuna pagina trovata</div>}
          </PanelSection>
        </>}

        {/* Vista ToDo */}
        {activeTab === 'todo' && <>
          <PanelSection title={`Attività aperte`}>
            {loading && <div className="panel-loading">Caricamento…</div>}
            {items.map(t => (
              <TaskRow key={t.id} task={t} color={color} listId={listId} />
            ))}
            {!loading && !items.length && <div className="panel-loading">Nessuna attività aperta</div>}
          </PanelSection>
        </>}

      </div>
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div className="panel-section">
      <div className="panel-section-title">{title}</div>
      {children}
    </div>
  );
}

function TaskRow({ task, color, listId }) {
  const isImportant = task.importance === 'high';
  const due = task.dueDateTime?.dateTime
    ? (() => {
        const d = new Date(task.dueDateTime.dateTime.endsWith('Z') ? task.dueDateTime.dateTime : task.dueDateTime.dateTime + 'Z');
        return new Date(d.getFullYear(), d.getMonth(), d.getDate())
          .toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      })()
    : null;

  const appUrl = `ms-to-do://tasks/id/${task.id}`;
  const webUrl = `https://to-do.live.com/tasks/id/${task.id}/details`;

  function openTask() {
    window.location.href = appUrl;
    setTimeout(() => window.open(webUrl, '_blank'), 800);
  }

  return (
    <div className="task-row" onClick={openTask} style={{ cursor: 'pointer' }}>
      <div className="task-check" style={{ borderColor: color + '66' }} />
      <div className="task-content">
        <div className="task-title" style={{ color: isImportant ? color : 'var(--text)' }}>
          {isImportant && <span className="task-important">★ </span>}
          {task.title}
        </div>
        {due && <div className="task-due">{due}</div>}
        {task.body?.content && task.body.contentType === 'text' && task.body.content.trim() && (
          <div className="task-note">{task.body.content.trim().slice(0, 80)}{task.body.content.length > 80 ? '…' : ''}</div>
        )}
      </div>
      <div className="link-btns">
        <button className="link-btn primary" onClick={e => { e.stopPropagation(); window.location.href = appUrl; }} title="Apri in ToDo">App</button>
        <button className="link-btn" onClick={e => { e.stopPropagation(); window.open(`https://to-do.live.com/tasks/id/${task.id}/details`, '_blank'); }} title="Apri nel browser">Web</button>
      </div>
    </div>
  );
}

function LinkRow({ color, label, appUrl, webUrl, badge }) {
  return (
    <div className="link-row">
      <span className="link-dot" style={{ background: color }} />
      <span className="link-label">{label}</span>
      <div className="link-btns">
        {badge && <span className="link-badge">{badge}</span>}
        {appUrl && (
          <button className="link-btn primary"
            onClick={() => window.location.href = appUrl}
            title="Apri in OneNote desktop">App</button>
        )}
        {webUrl && (
          <button className="link-btn"
            onClick={() => window.open(webUrl, '_blank')}
            title="Apri nel browser">Web</button>
        )}
      </div>
    </div>
  );
}
