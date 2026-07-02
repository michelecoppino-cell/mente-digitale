import { useState, useEffect, useRef } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages, getRecentEmails, createTask } from './api';
import { cacheGet, cacheSet, cacheClear, TTL } from './cache';
import MindMap from './MindMap';
import IdentityPanel from './IdentityPanel';
import SearchOverlay from './SearchOverlay';
import Panel from './Panel';
import SchedulePanel from './SchedulePanel';
import RssPanel from './RssPanel';
import PlannerView from './PlannerView';
import GtdClarifyModal from './GtdClarifyModal';
import EisenhowerTriage from './EisenhowerTriage';
import { parseEisenhower } from './eisenhower';
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
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [gtdOpen, setGtdOpen] = useState(false);
  const [eisenhowerOpen, setEisenhowerOpen] = useState(false);
  const [pendingPlannerTask, setPendingPlannerTask] = useState(null);
  const [reviewSuggestions, setReviewSuggestions] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
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

  // Scorciatoia Ctrl/Cmd+K per la ricerca globale
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

      refreshDailyReview();

    } catch (e) {
      console.error('load', e);
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  // Campanella Daily Review: proposte di task da email recenti (in futuro anche
  // MOM/routine). Richiamata all'avvio e su "↺ Aggiorna tutto".
  async function refreshDailyReview() {
    setReviewLoading(true);
    try {
      const emails = await getRecentEmails();
      if (!emails.length) { setReviewSuggestions([]); setReviewLoading(false); return; }
      const res = await fetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'daily-review-suggestions', emails: emails.slice(0, 20) }),
      });
      const data = await res.json();
      setReviewSuggestions((data.actions || []).map(a => ({
        ...a,
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      })));
    } catch (e) {
      console.error('daily review', e);
    }
    setReviewLoading(false);
  }

  async function handleAcceptSuggestion(suggestion) {
    const list = todoListsRef.current[0];
    if (!list) return;
    try {
      const task = await createTask(list.id, suggestion.extractedAction);
      setScheduledTasks(prev => [...(prev || []), { ...task, _listId: list.id, _listName: list.displayName }]);
      setReviewSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    } catch (e) { console.error('accept suggestion', e); }
  }

  function handleDismissSuggestion(id) {
    setReviewSuggestions(prev => prev.filter(s => s.id !== id));
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
      } catch (e) { console.error('preload tasks', l.displayName, e); }
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
      } catch (e) { console.error('preload pages', sectionId, e); }
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
    if (!section) { setSelected(null); return; }
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

  const unclassifiedCount = (scheduledTasks || []).filter(t => !parseEisenhower(t.body?.content)).length;

  if (!ready) return null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          {account && (
            <button
              className={`planner-toggle-btn${plannerOpen ? ' active' : ''}`}
              onClick={() => setPlannerOpen(o => !o)}
              title="Pianificatore giornaliero">
              📅 Piano
            </button>
          )}
        </div>
        <div className="header-center">
          <h1 className="logo">Mente Digitale</h1>
        </div>
        <div className="header-right">
          {account && (
            <div className="sync-status" title={sync.label}>
              <span className={`sync-dot ${sync.state}`} />
              <span className="sync-label-text">{sync.label}</span>
            </div>
          )}
          {account && (
            <button className="search-btn" onClick={() => setSearchOpen(true)} title="Cerca (Ctrl+K)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            </button>
          )}
          {account && (
            <button className="search-btn" onClick={() => setGtdOpen(true)} title="Cattura pensiero (GTD)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {account && (
            <button
              className={`search-btn${unclassifiedCount > 0 ? ' has-badge' : ''}`}
              onClick={() => setEisenhowerOpen(true)}
              title="Smistamento Eisenhower dei task non classificati">
              🧭
              {unclassifiedCount > 0 && <span className="header-badge">{unclassifiedCount}</span>}
            </button>
          )}
          {account && (
            <div className="bell-wrap">
              <button
                className={`search-btn${reviewSuggestions.length ? ' has-badge' : ''}`}
                onClick={() => setReviewOpen(o => !o)}
                title="Proposte Daily Review">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {reviewSuggestions.length > 0 && <span className="header-badge">{reviewSuggestions.length}</span>}
              </button>
              {reviewOpen && (
                <div className="bell-dropdown">
                  <div className="bell-dropdown-header">
                    <span>Daily Review</span>
                    <button onClick={() => setReviewOpen(false)}>✕</button>
                  </div>
                  {reviewLoading && <div className="bell-empty">Analisi email in corso…</div>}
                  {!reviewLoading && reviewSuggestions.length === 0 && (
                    <div className="bell-empty">Nessuna proposta al momento.</div>
                  )}
                  {!reviewLoading && reviewSuggestions.map(s => (
                    <div key={s.id} className="bell-item">
                      <div className="bell-item-text">{s.extractedAction}</div>
                      <div className="bell-item-meta">{s.subject?.slice(0, 40)}</div>
                      <div className="bell-item-actions">
                        <button className="bell-accept-btn" onClick={() => handleAcceptSuggestion(s)}>✓ Crea task</button>
                        <button className="bell-dismiss-btn" onClick={() => handleDismissSuggestion(s.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom(z => Math.max(0.15, +(z - 0.2).toFixed(2)))}>−</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="zoom-btn" onClick={() => setZoom(z => Math.min(5, +(z + 0.2).toFixed(2)))}>+</button>
          </div>
          <button className="refresh-btn" onClick={handleRefresh} title="Aggiorna tutto">↺</button>
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
        <>
        {!scheduleOpen && !plannerOpen && <button
            className="alarm-btn"
            onClick={() => setScheduleOpen(o => !o)}
            title="Attività">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="7"/>
              <polyline points="12 10 12 14 14 14"/>
              <line x1="7" y1="4" x2="4.5" y2="6.5"/>
              <line x1="17" y1="4" x2="19.5" y2="6.5"/>
            </svg>
          </button>}
        <div className="canvas-area" style={{ display: plannerOpen ? 'none' : undefined }}>
          <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(null)} />
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
            onIdentityOpen={setIdentityOpen}
          />
          <Panel
            selected={selected}
            pagesCache={pagesCache}
            tasksCache={tasksCache}
            onClose={() => setSelected(null)}
          />
          <RssPanel open={rssOpen} onToggle={() => setRssOpen(o => !o)} />
        </div>
        <PlannerView
          open={plannerOpen}
          onClose={() => setPlannerOpen(false)}
          preloadedTasks={scheduledTasks || []}
          notebooks={notebooks}
          sectionsMap={sectionsMap}
          autoAddTask={pendingPlannerTask}
          onAutoAdded={() => setPendingPlannerTask(null)}
        />
        <EisenhowerTriage
          open={eisenhowerOpen}
          onClose={() => setEisenhowerOpen(false)}
          tasks={scheduledTasks || []}
        />
        <GtdClarifyModal
          open={gtdOpen}
          onClose={() => setGtdOpen(false)}
          todoLists={todoListsRef.current}
          notebooks={notebooks}
          sectionsMap={sectionsMap}
          onTaskCreated={(task, { addToday }) => {
            setScheduledTasks(prev => [...(prev || []), task]);
            if (addToday) { setPendingPlannerTask(task); setPlannerOpen(true); }
          }}
        />
        <SearchOverlay
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          notebooks={notebooks}
          sectionsMap={sectionsMap}
          pagesCache={pagesCache}
          tasks={scheduledTasks || []}
          onSelectSection={(sec, nb, app) => { setPlannerOpen(false); handleSelectSection(sec, nb, app); }}
        />
        </>
      )}
    </div>
  );
}
