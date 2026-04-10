import { useState, useEffect, useRef } from 'react';
import { getPages, getTodoTasks, createTask, completeTask, loadODLinksFromCloud, saveODLinksToCloud } from './api';

const LOCAL_KEY = 'onedrive_links_v2';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch(e) { return {}; }
}
function saveLocal(obj) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch(e) {}
}

export default function Panel({ selected, pagesCache, tasksCache, onClose }) {
  const [pages, setPages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [noDeadlineTasks, setNoDeadlineTasks] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);
  const [odLinks, setOdLinks] = useState(loadLocal());
  const [odSyncing, setOdSyncing] = useState(false);
  const [addingOD, setAddingOD] = useState(false);
  const [newODName, setNewODName] = useState('');
  const [newODUrl, setNewODUrl] = useState('');
  const [newODUrlPc, setNewODUrlPc] = useState('');
  const [editingOD, setEditingOD] = useState(null); // { sectionId, idx }

  // Carica link da OneDrive cloud all'avvio
  useEffect(() => {
    async function syncFromCloud() {
      try {
        const cloudLinks = await loadODLinksFromCloud();
        if (cloudLinks && typeof cloudLinks === 'object') {
          setOdLinks(cloudLinks);
          saveLocal(cloudLinks);
        }
      } catch(e) {}
    }
    syncFromCloud();
  }, []);

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

  async function handleAddODLink() {
    if (editingOD) { await handleSaveEdit(); return; }
    if (!newODName.trim() || !selected) return;
    const key = selected.data.id;
    const existing = odLinks[key] || [];
    const updated = [...existing, {
      name: newODName.trim(),
      url: newODUrl.trim() || null,
      urlPc: newODUrlPc.trim() || null,
    }];
    const next = { ...odLinks, [key]: updated };
    setOdLinks(next);
    saveLocal(next);
    setNewODName('');
    setNewODUrl('');
    setNewODUrlPc('');
    setEditingOD(null);
    setAddingOD(false);
    // Salva su cloud in background
    setOdSyncing(true);
    try { await saveODLinksToCloud(next); } catch(e) { console.error('OD sync error', e); }
    setOdSyncing(false);
  }



  function handleStartEdit(sectionId, idx) {
    const link = odLinks[sectionId]?.[idx];
    if (!link) return;
    setNewODName(link.name);
    setNewODUrl(link.url || '');
    setNewODUrlPc(link.urlPc || '');
    setEditingOD({ sectionId, idx });
    setAddingOD(true);
  }

  async function handleSaveEdit() {
    if (!editingOD) return;
    const { sectionId, idx } = editingOD;
    const existing = odLinks[sectionId] || [];
    const updated = existing.map((l, i) => i === idx ? {
      name: newODName.trim(),
      url: newODUrl.trim() || null,
      urlPc: newODUrlPc.trim() || null,
    } : l);
    const next = { ...odLinks, [sectionId]: updated };
    setOdLinks(next);
    saveLocal(next);
    setNewODName(''); setNewODUrl(''); setNewODUrlPc('');
    setEditingOD(null); setAddingOD(false);
    setOdSyncing(true);
    try { await saveODLinksToCloud(next); } catch(e) {}
    setOdSyncing(false);
  }

  async function handleRemoveODLink(sectionId, idx) {
    const existing = odLinks[sectionId] || [];
    const updated = existing.filter((_, i) => i !== idx);
    const next = { ...odLinks, [sectionId]: updated };
    setOdLinks(next);
    saveLocal(next);
    // Salva su cloud in background
    try { await saveODLinksToCloud(next); } catch(e) { console.error('OD sync error', e); }
  }

  if (!selected) return <div className="panel" />;

  const { data, nb, listId } = selected;
  const color = nb?._color || '#c8a96e';
  const sectionODLinks = odLinks[data.id] || [];
  const allTasks = [...tasks, ...noDeadlineTasks];

  return (
    <div className="panel open">
      <div className="panel-head">
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
            <PageTree pages={pages} />
            {!loadingPages && !pages.length && <div className="panel-empty">Nessuna pagina</div>}
          </div>
        </div>

        {/* ── OneDrive ── */}
        <div className="panel-col">
          <div className="panel-col-header" style={{ color }}>
            <span>OneDrive</span>
            {odSyncing && <span style={{fontSize:9,color:'var(--muted)',marginLeft:4}}>↑</span>}
            <button className="od-add-btn" onClick={() => setAddingOD(a => !a)} title="Aggiungi link">+</button>
          </div>
          {addingOD && (
            <div className="od-add-form">
              <input className="od-input" placeholder="Nome cartella"
                value={newODName} onChange={e => setNewODName(e.target.value)} />
              <input className="od-input" placeholder="Link web (1drv.ms o onedrive.com)"
                value={newODUrl} onChange={e => setNewODUrl(e.target.value)} />
              <input className="od-input" placeholder="Percorso PC (C:\Users\...)"
                value={newODUrlPc} onChange={e => setNewODUrlPc(e.target.value)}
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
                <span className="od-link-name">☁ {link.name}</span>
                <div className="od-link-btns">
                  {link.url && (
                    <button className="od-open-btn" onClick={() => window.open(link.url, '_blank')} title="Apri su mobile/web">📱</button>
                  )}
                  {link.urlPc && (
                    <CopyBtn text={link.urlPc} />
                  )}
                  <button className="od-open-btn" onClick={() => handleStartEdit(data.id, i)} title="Modifica">✏️</button>
                  <button className="od-remove-btn" onClick={() => handleRemoveODLink(data.id, i)}>✕</button>
                </div>
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

function PageTree({ pages }) {
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
    if (p.links?.oneNoteClientUrl?.href) window.location.href = p.links.oneNoteClientUrl.href;
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

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch(e) {
      // Fallback per browser che non supportano clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <button className="od-open-btn" onClick={handleCopy}
      title={copied ? 'Copiato!' : 'Copia percorso PC'}
      style={{ color: copied ? '#86c07a' : undefined }}>
      {copied ? '✓' : '🖥'}
    </button>
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
