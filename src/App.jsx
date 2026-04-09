import { useState, useEffect, useRef, useCallback } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages } from './api';
import MindMap from './MindMap';
import Panel from './Panel';
import SchedulePanel from './SchedulePanel';
import RssPanel from './RssPanel';
import { COLORS } from './config';
import './App.css';

export default function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [notebooks, setNotebooks] = useState([]);
  const [sectionsMap, setSectionsMap] = useState({});
  const [todoListsMap, setTodoListsMap] = useState({});
  const [todoCountMap, setTodoCountMap] = useState({}); // { sectionName_lower: count }
  const [selected, setSelected] = useState(null);
  const [sync, setSync] = useState({ state: 'idle', label: 'Non connesso' });
  const [zoom, setZoom] = useState(1);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rssOpen, setRssOpen] = useState(false);
  const pagesCache = useRef({});
  const tasksCache = useRef({});
  const [scheduledTasks, setScheduledTasks] = useState(null);
  const preloadQueueRef = useRef([]);
  const preloadRunningRef = useRef(false);

  useEffect(() => {
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      if (acc) load();
    });
  }, []);

  async function handleLogin() {
    try { await login(); setAccount(getAccount()); load(); }
    catch (e) { console.error(e); }
  }

  async function load() {
    setSync({ state: 'loading', label: 'Caricamento…' });
    try {
      const [nbs, todoLists] = await Promise.all([getNotebooks(), getTodoLists()]);
      nbs.forEach((nb, i) => nb._color = COLORS[i % COLORS.length]);
      setNotebooks(nbs);
      const map = {};
      todoLists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
      setTodoListsMap(map);
      setSync({ state: 'ok', label: `${nbs.length} taccuini` });
      // Precarica task in background dopo 2s
      setTimeout(() => preloadAllTasks(todoLists), 2000);
    } catch {
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  // Precarica tutti i task ToDo in background (sequenziale per evitare 429)
  async function preloadAllTasks(lists) {
    const allTasks = [];
    for (const l of lists) {
      try {
        if (!tasksCache.current[l.id]) {
          const tasks = await getTodoTasks(l.id);
          tasksCache.current[l.id] = tasks;
          tasks.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        } else {
          tasksCache.current[l.id].forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {}
    }
    setScheduledTasks(allTasks);
    // Calcola badge counts per sezione
    const counts = {};
    lists.forEach(l => {
      const tasks = tasksCache.current[l.id] || [];
      if (tasks.length > 0) counts[l.displayName.toLowerCase()] = tasks.length;
    });
    setTodoCountMap(counts);
  }

  // Precarica pagine OneNote in background (coda sequenziale)
  function enqueuePagePreload(sectionId) {
    if (pagesCache.current[sectionId]) return;
    preloadQueueRef.current.push(sectionId);
    runPreloadQueue();
  }

  async function runPreloadQueue() {
    if (preloadRunningRef.current) return;
    preloadRunningRef.current = true;
    while (preloadQueueRef.current.length > 0) {
      const id = preloadQueueRef.current.shift();
      if (pagesCache.current[id]) continue;
      try {
        const pages = await getPages(id);
        pagesCache.current[id] = pages;
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {}
    }
    preloadRunningRef.current = false;
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    try {
      const sects = await getSections(nb.id);
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      // Accoda preload pagine per ogni sezione
      setTimeout(() => sects.forEach(s => enqueuePagePreload(s.id)), 1000);
    } catch (e) {
      console.error('Errore sezioni', nb.displayName, e);
      setSectionsMap(prev => ({ ...prev, [nb.id]: [] }));
    }
  }

  function findTodoList(sectionName) {
    return todoListsMap[sectionName.toLowerCase()] || null;
  }

  function handleSelectSection(section, nb, appKey = 'onenote') {
    const todoList = findTodoList(section.displayName);
    setSelected({ type: 'section', data: section, nb, listId: todoList?.id || null, listName: todoList?.displayName || null, initialTab: appKey.toLowerCase() });
  }

  if (!ready) return null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button className={`schedule-toggle-btn ${scheduleOpen ? 'active' : ''}`}
            onClick={() => setScheduleOpen(o => !o)} title="Scadenze">⏰</button>
          <h1 className="logo">Mente Digitale</h1>
          <span className="header-sub">OneNote · ToDo · Calendario</span>
        </div>
        <div className="header-right">
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom(z => Math.max(0.15, +(z - 0.2).toFixed(2)))}>−</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="zoom-btn" onClick={() => setZoom(z => Math.min(5, +(z + 0.2).toFixed(2)))}>+</button>
            <button className="zoom-btn" style={{fontSize:11,padding:'0 8px',width:'auto'}} onClick={() => setZoom(1)}>↺</button>
          </div>
          <div className="sync-status">
            <div className={`sync-dot ${sync.state}`} />
            <span>{sync.label}</span>
          </div>
        </div>
      </header>

      {!account ? (
        <div className="login-screen">
          <div className="login-card">
            <div className="login-title">Benvenuto</div>
            <div className="login-desc">Accedi con il tuo account Microsoft per caricare<br />i tuoi taccuini OneNote automaticamente.</div>
            <button className="login-btn" onClick={handleLogin}>
              <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Accedi con Microsoft
            </button>
            <div className="login-note">Solo permessi di lettura · nessun dato salvato</div>
          </div>
        </div>
      ) : (
        <div className="canvas-area">
          <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} preloadedTasks={scheduledTasks} />
          <MindMap
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            todoListsMap={todoListsMap}
            todoCountMap={todoCountMap}
            onSelectSection={handleSelectSection}
            onExpandNotebook={handleExpandNotebook}
            externalZoom={zoom}
            onZoomChange={setZoom}
          />
          <Panel
            selected={selected}
            pagesCache={pagesCache}
            tasksCache={tasksCache}
            onClose={() => setSelected(null)}
          />
          <RssPanel open={rssOpen} onToggle={() => setRssOpen(o => !o)} />
        </div>
      )}
    </div>
  );
}
