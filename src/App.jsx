import { useState, useEffect, useRef } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages } from './api';
import { cacheGet, cacheSet, cacheClear, TTL } from './cache';
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
  const [todoCountMap, setTodoCountMap] = useState({});
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
  const todoListsRef = useRef([]);

  useEffect(() => {
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      if (acc) load(false);
    });
  }, []);

  async function handleLogin() {
    try { await login(); setAccount(getAccount()); load(false); }
    catch (e) { console.error(e); }
  }

  async function load(forceRefresh = false) {
    setSync({ state: 'loading', label: 'Caricamento…' });

    // Svuota cache in memoria se forceRefresh
    if (forceRefresh) {
      cacheClear();
      pagesCache.current = {};
      tasksCache.current = {};
    }

    try {
      // Taccuini
      let nbs = forceRefresh ? null : cacheGet('notebooks');
      if (!nbs) {
        nbs = await getNotebooks();
        cacheSet('notebooks', nbs, TTL.NOTEBOOKS);
      }
      nbs.forEach((nb, i) => nb._color = COLORS[i % COLORS.length]);
      setNotebooks(nbs);

      // Liste ToDo
      let todoLists = forceRefresh ? null : cacheGet('todolists');
      if (!todoLists) {
        todoLists = await getTodoLists();
        cacheSet('todolists', todoLists, TTL.TODOLISTS);
      }
      todoListsRef.current = todoLists;
      const map = {};
      todoLists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
      setTodoListsMap(map);

      // Sezioni — carica da cache subito, poi espandi
      const sectMap = {};
      for (const nb of nbs) {
        const cached = forceRefresh ? null : cacheGet(`sections_${nb.id}`);
        if (cached) sectMap[nb.id] = cached;
      }
      if (Object.keys(sectMap).length > 0) setSectionsMap(sectMap);

      setSync({ state: 'ok', label: `${nbs.length} taccuini` });

      // Precarica task in background
      setTimeout(() => preloadAllTasks(todoLists, forceRefresh), 1000);

      // Precarica pagine in background
      setTimeout(() => {
        Object.entries(sectMap).forEach(([, sects]) =>
          sects.forEach(s => enqueuePagePreload(s.id, forceRefresh))
        );
      }, 2000);

    } catch {
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  async function preloadAllTasks(lists, forceRefresh = false) {
    const allTasks = [];
    const counts = {};
    for (const l of lists) {
      try {
        let tasks = forceRefresh ? null : cacheGet(`tasks_${l.id}`);
        if (!tasks) {
          tasks = await getTodoTasks(l.id);
          cacheSet(`tasks_${l.id}`, tasks, TTL.TASKS);
        }
        tasksCache.current[l.id] = tasks;
        tasks.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        if (tasks.length > 0) counts[l.displayName.toLowerCase()] = tasks.length;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {}
    }
    setScheduledTasks(allTasks);
    setTodoCountMap(counts);
  }

  function enqueuePagePreload(sectionId, forceRefresh = false) {
    if (!forceRefresh && pagesCache.current[sectionId]) return;
    preloadQueueRef.current.push({ sectionId, forceRefresh });
    runPreloadQueue();
  }

  async function runPreloadQueue() {
    if (preloadRunningRef.current) return;
    preloadRunningRef.current = true;
    while (preloadQueueRef.current.length > 0) {
      const { sectionId, forceRefresh } = preloadQueueRef.current.shift();
      if (!forceRefresh && pagesCache.current[sectionId]) continue;
      try {
        let cached = forceRefresh ? null : cacheGet(`pages_${sectionId}`);
        if (!cached) {
          cached = await getPages(sectionId);
          cacheSet(`pages_${sectionId}`, cached, TTL.PAGES);
        }
        pagesCache.current[sectionId] = cached;
        await new Promise(r => setTimeout(r, 400));
      } catch(e) {}
    }
    preloadRunningRef.current = false;
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    try {
      let sects = cacheGet(`sections_${nb.id}`);
      if (!sects) {
        sects = await getSections(nb.id);
        cacheSet(`sections_${nb.id}`, sects, TTL.SECTIONS);
      }
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      setTimeout(() => sects.forEach(s => enqueuePagePreload(s.id)), 1500);
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

  async function handleRefresh() {
    setSelected(null);
    setNotebooks([]);
    setSectionsMap({});
    setScheduledTasks(null);
    setTodoCountMap({});
    await load(true);
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
          <div className="sync-status" style={{cursor:'pointer'}} onClick={handleRefresh} title="Aggiorna tutto">
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
          <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} preloadedTasks={scheduledTasks} onSelectSection={handleSelectSection} todoListsMap={todoListsMap} sectionsMap={sectionsMap} />
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
