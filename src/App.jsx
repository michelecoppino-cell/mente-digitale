import { useState, useEffect, useRef } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getPages } from './api';
import MindMap from './MindMap';
import Panel from './Panel';
import SchedulePanel from './SchedulePanel';
import { COLORS } from './config';
import './App.css';

export default function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [notebooks, setNotebooks] = useState([]);
  const [sectionsMap, setSectionsMap] = useState({});
  const [todoListsMap, setTodoListsMap] = useState({}); // { sectionName_lower: { id, displayName } }
  const [selected, setSelected] = useState(null);
  const [sync, setSync] = useState({ state: 'idle', label: 'Non connesso' });
  const [zoom, setZoom] = useState(1);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const pagesCache = useRef({});   // { sectionId: [pages] }
  const tasksCache = useRef({});   // { listId: [tasks] }
  const [scheduledTasks, setScheduledTasks] = useState(null); // precaricati per SchedulePanel

  useEffect(() => {
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      if (acc) load();
    });
  }, []);

  async function handleLogin() {
    try {
      await login();
      setAccount(getAccount());
      load();
    } catch (e) { console.error(e); }
  }

  async function load() {
    setSync({ state: 'loading', label: 'Caricamento…' });
    try {
      const [nbs, todoLists] = await Promise.all([
        getNotebooks(),
        getTodoLists()
      ]);
      nbs.forEach((nb, i) => nb._color = COLORS[i % COLORS.length]);
      setNotebooks(nbs);

      // Mappa liste ToDo per nome (lowercase) per matching con sezioni
      const map = {};
      console.log('Liste ToDo caricate:', todoLists.map(l => l.displayName));
      todoLists.forEach(l => {
        map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName };
      });
      console.log('TodoListsMap keys:', Object.keys(map));
      setTodoListsMap(map);

      setSync({ state: 'ok', label: `${nbs.length} taccuini` });
      // Precarica task con scadenza per SchedulePanel in background
      setTimeout(() => preloadSchedule(todoLists), 1000);
    } catch {
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  async function preloadSchedule(lists) {
    try {
      const allTasks = [];
      for (const l of lists) {
        const token = await import('./auth').then(m => m.getToken());
        const r = await fetch(
          `https://graph.microsoft.com/v1.0/me/todo/lists/${l.id}/tasks?$filter=status ne 'completed' and dueDateTime/dateTime ne null&$top=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) {
          const d = await r.json();
          allTasks.push(...(d.value || []).map(t => ({ ...t, _listName: l.displayName })));
        }
        await new Promise(r => setTimeout(r, 150));
      }
      setScheduledTasks(allTasks);
    } catch(e) { console.error('Preload schedule error', e); }
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    try {
      const sects = await getSections(nb.id);
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      // Preload pagine OneNote in background con piccolo ritardo
      setTimeout(() => preloadSections(sects, nb), 500);
    } catch (e) {
      console.error('Errore sezioni', nb.displayName, e);
      setSectionsMap(prev => ({ ...prev, [nb.id]: [] }));
    }
  }

  async function preloadSections(sects, nb) {
    for (const s of sects) {
      if (pagesCache.current[s.id]) continue;
      try {
        const pages = await getPages(s.id);
        pagesCache.current[s.id] = pages;
      } catch(e) {}
      await new Promise(r => setTimeout(r, 200)); // evita 429
      // Preload task ToDo se c'è matching
      const todoList = todoListsMap[s.displayName.toLowerCase()];
      if (todoList && !tasksCache.current[todoList.id]) {
        try {
          const tasks = await getTodoTasksCached(todoList.id);
          tasksCache.current[todoList.id] = tasks;
        } catch(e) {}
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  async function getTodoTasksCached(listId) {
    const { getTodoTasks } = await import('./api');
    return getTodoTasks(listId);
  }

  // Trova lista ToDo corrispondente a una sezione per nome
  function findTodoList(sectionName) {
    return todoListsMap[sectionName.toLowerCase()] || null;
  }

  function handleSelectSection(section, nb, appKey = 'onenote') {
    const todoList = findTodoList(section.displayName);
    setSelected({
      type: 'section',
      data: section,
      nb,
      listId: todoList?.id || null,
      listName: todoList?.displayName || null,
      initialTab: appKey.toLowerCase(),
    });
  }

  if (!ready) return null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button
            className={`schedule-toggle-btn ${scheduleOpen ? 'active' : ''}`}
            onClick={() => setScheduleOpen(o => !o)}
            title="Scadenze">
            ⏰
          </button>
          <h1 className="logo">Mente Digitale</h1>
          <span className="header-sub">OneNote · ToDo · fase 1</span>
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
            <div className="login-desc">
              Accedi con il tuo account Microsoft per caricare<br />
              i tuoi taccuini OneNote automaticamente.
            </div>
            <button className="login-btn" onClick={handleLogin}>
              <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Accedi con Microsoft
            </button>
            <div className="login-note">
              Solo permessi di lettura · nessun dato salvato
            </div>
          </div>
        </div>
      ) : (
        <div className="canvas-area">
          <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} preloadedTasks={scheduledTasks} />
          <MindMap
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            todoListsMap={todoListsMap}
            onSelectSection={handleSelectSection}
            onExpandNotebook={handleExpandNotebook}
            externalZoom={zoom}
            onZoomChange={setZoom}
          />
          <Panel
            selected={selected}
            sectionsMap={sectionsMap}
            todoListsMap={todoListsMap}
            pagesCache={pagesCache}
            tasksCache={tasksCache}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}
