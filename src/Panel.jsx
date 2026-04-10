import { useState, useEffect, useRef } from 'react';
import { getPages, getTodoTasks, createTask, completeTask } from './api';

const ONEDRIVE_KEY = 'onedrive_links_v2';

function loadODLinks() {
  try { return JSON.parse(localStorage.getItem(ONEDRIVE_KEY) || '{}'); } catch(e) { return {}; }
}
function saveODLinks(obj) {
  localStorage.setItem(ONEDRIVE_KEY, JSON.stringify(obj));
}

export default function Panel({ selected, pagesCache, tasksCache, onClose }) {
  const [pages, setPages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [noDeadlineTasks, setNoDeadlineTasks] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);
  const [odLinks, setOdLinks] = useState(loadODLinks());
  const [addingOD, setAddingOD] = useState(false);
  const [newODName, setNewODName] = useState('');
  const [newODUrl, setNewODUrl] = useState('');

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
    if (pagesCache?.current?.[sectionId]) { setPages(pagesCache.current[sectionId]); return; }
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

  function handleAddODLink() {
    if (!newODName.trim() || !newODUrl.trim() || !selected) return;
    const key = selected.data.id;
    const existing = odLinks[key] || [];
    const updated = [...existing, { name: newODName.trim(), url: newODUrl.trim() }];
    const next = { ...odLinks, [key]: updated };
    setOdLinks(next);
    saveODLinks(next);
    setNewODName('');
    setNewODUrl('');
    setAddingOD(false);
  }

  function openODLink(url) {
    // Costruisce URL nativo ms-onedrive:// dal link web
    // es. https://onedrive.live.com/redir?resid=XXX → ms-onedrive://open?resid=XXX
    let nativeUrl = null;
    try {
      const u = new URL(url);
      if (u.hostname.includes('onedrive.live.com') || u.hostname.includes('1drv.ms')) {
        // Estrai resid se presente
        const resid = u.searchParams.get('resid') || u.searchParams.get('id');
        if (resid) {
          nativeUrl = `ms-onedrive://open?resid=${resid}`;
        } else {
          // Fallback generico per link condivisi
          nativeUrl = `ms-onedrive://open?url=${encodeURIComponent(url)}`;
        }
      } else if (u.hostname.includes('sharepoint.com')) {
        nativeUrl = `ms-onedrive://open?url=${encodeURIComponent(url)}`;
      }
    } catch(e) {}

    if (nativeUrl) {
      // Prova app nativa, fallback web dopo 600ms
      window.location.href = nativeUrl;
      setTimeout(() => window.open(url, '_blank'), 600);
    } else {
      window.open(url, '_blank');
    }
  }

  function handleRemoveODLink(sectionId, idx) {
    const existing = odLinks[sectionId] || [];
    const updated = existing.filter((_, i) => i !== idx);
    const next = { ...odLinks, [sectionId]: updated };
    setOdLinks(next);
    saveODLinks(next);
  }

  if (!selected) return <div className="panel" />;

  const { data, nb, listId } = selected;
  const color = nb?._color || '#c8a96e';
  const sectionODLinks = odLinks[data.id] || [];
  const allTasks = [...tasks, ...noDeadlineTasks];

  return (
    <div className="panel open">
      <div className="panel-head">
        <div className="panel-label">Sezione</div>
        <div className="panel-title" style={{ color }}>{data.displayName}</div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="panel-body panel-3col">

        {/* ── ToDo ── */}
        <div className="panel-col">
          <div className="panel-col-header" style={{ color }}>
            <span>ToDo</span>
            {allTasks.length > 0 && <span className="panel-col-count">{allTasks.length}</span>}
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
              {loadingTasks && <div className="panel-loading">Caricamento…</div>}
              <div className="panel-col-body">
                {tasks.map(t => <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />)}
                {noDeadlineTasks.map(t => <TaskRow key={t.id} task={t} color={color} onComplete={handleComplete} />)}
                {!loadingTasks && !allTasks.length && <div className="panel-empty">Nessuna attività</div>}
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
            <div className="onenote-open-link" onClick={() => window.location.href = data.links.oneNoteClientUrl.href}>
              ↗ Apri sezione
            </div>
          )}
          {loadingPages && <div className="panel-loading">Caricamento…</div>}
          <div className="panel-col-body">
            {pages.map(p => (
              <div key={p.id} className="page-link"
                onClick={() => p.links?.oneNoteClientUrl?.href && (window.location.href = p.links.oneNoteClientUrl.href)}>
                {p.title || 'Senza titolo'}
              </div>
            ))}
            {!loadingPages && !pages.length && <div className="panel-empty">Nessuna pagina</div>}
          </div>
        </div>

        {/* ── OneDrive ── */}
        <div className="panel-col">
          <div className="panel-col-header" style={{ color }}>
            <span>OneDrive</span>
            <button className="od-add-btn" onClick={() => setAddingOD(a => !a)} title="Aggiungi link">+</button>
          </div>
          {addingOD && (
            <div className="od-add-form">
              <input className="od-input" placeholder="Nome cartella"
                value={newODName} onChange={e => setNewODName(e.target.value)} />
              <input className="od-input" placeholder="URL OneDrive"
                value={newODUrl} onChange={e => setNewODUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddODLink()} />
              <div className="od-form-btns">
                <button className="od-save-btn" style={{ color }} onClick={handleAddODLink}>Salva</button>
                <button className="od-cancel-btn" onClick={() => setAddingOD(false)}>Annulla</button>
              </div>
            </div>
          )}
          <div className="panel-col-body">
            {sectionODLinks.map((link, i) => (
              <div key={i} className="od-link-row">
                <span className="od-link-name" onClick={() => openODLink(link.url)}>
                  ☁ {link.name}
                </span>
                <button className="od-remove-btn" onClick={() => handleRemoveODLink(data.id, i)}>✕</button>
              </div>
            ))}
            {!sectionODLinks.length && !addingOD && (
              <div className="panel-empty">Nessun link · premi + per aggiungere</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

function TaskRow({ task, color, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const isImportant = task.importance === 'high';
  const appUrl = `ms-to-do://tasks/id/${task.id}`;
  const due = task.dueDateTime?.dateTime
    ? (() => {
        const d = new Date(task.dueDateTime.dateTime.endsWith('Z') ? task.dueDateTime.dateTime : task.dueDateTime.dateTime + 'Z');
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      })() : null;

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
      <div className="task-row-content" onClick={() => window.location.href = appUrl} style={{ cursor: 'pointer' }}>
        <div className="task-title" style={{ color: isImportant ? color : 'var(--text)' }}>
          {isImportant && <span className="task-important">★ </span>}
          {task.title}
        </div>
        {due && <div className="task-due">{due}</div>}
      </div>
    </div>
  );
}
