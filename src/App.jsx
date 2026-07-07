import { useState, useEffect, useRef } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages, getRecentEmails, getPageContentHtml, markOneNoteTagDone, getReminders, createTask, getCalendarEvents, getTasksForDeadlineDedup } from './api';
import { cacheGet, cacheSet, cacheClear, TTL } from './cache';
import { extractEmailCandidates, extractOneNoteCandidates } from './dailyReview';
import { parseReminderSubject, reminderMarker, hasReminderMarker } from './deadlineReminders';
import MindMap from './MindMap';
import IdentityPanel from './IdentityPanel';
import SearchOverlay from './SearchOverlay';
import Panel from './Panel';
import SchedulePanel from './SchedulePanel';
import PlannerView from './PlannerView';
import GtdClarifyModal from './GtdClarifyModal';
import EisenhowerTriage from './EisenhowerTriage';
import { parseEisenhower } from './eisenhower';
import { COLORS } from './config';
import './App.css';

const REVIEW_SEEN_TTL = 7 * 24 * 60 * 60 * 1000;      // 7 giorni
const NOTES_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;    // fallback alla prima scansione: ultime 48h
const REVIEW_LAST_CHECK_KEY = 'review_last_check';
const REVIEW_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const REVIEW_PAGES_CAP = 40; // tetto di sicurezza sulle pagine il cui contenuto viene scaricato per intero

const DEADLINE_LAST_CHECK_KEY = 'deadline_reminders_last_check';
const DEADLINE_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const DEADLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;     // fallback alla prima scansione: ultimi 7 giorni

function suggestionSignature(a) {
  return `${a.source || 'email'}::${a.title || ''}::${a.extractedAction || ''}`;
}

function markSuggestionSeen(sig) {
  const seen = cacheGet('review_seen') || [];
  if (!seen.includes(sig)) {
    cacheSet('review_seen', [...seen, sig].slice(-300), REVIEW_SEEN_TTL);
  }
}

// cutoffMs: timestamp assoluto, non una durata — così la Daily Review può
// scansionare solo le pagine modificate dall'ultimo controllo riuscito in poi
// (vedi refreshDailyReview), invece di rifare sempre l'intera finestra delle
// ultime 48h. Copertura più ampia nel tempo, senza riscaricare da capo il
// contenuto di pagine già viste.
function filterRecentPages(pages, cutoffMs) {
  return pages
    .filter(p => p.lastModifiedDateTime && new Date(p.lastModifiedDateTime).getTime() >= cutoffMs)
    .sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
}

// L'endpoint "flat" /me/onenote/pages risponde 400 sugli account Microsoft
// personali (MSA), a prescindere dai parametri della query. Si aggregano invece
// le pagine passando per taccuini → sezioni → pagine, gli stessi endpoint già
// usati con successo altrove nell'app (MindMap, Panel).
async function collectAllOneNotePages() {
  const notebooks = await getNotebooks();
  const allPages = [];
  for (const nb of notebooks) {
    let sections = [];
    try { sections = await getSections(nb.id); } catch (e) { console.error('sections', nb.displayName, e); continue; }
    for (const sec of sections) {
      try {
        const pages = await getPages(sec.id);
        allPages.push(...pages);
      } catch (e) { console.error('pages', sec.displayName, e); }
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return allPages;
}

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
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [mapViewMode, setMapViewMode] = useState('workbook');
  const [identityOpen, setIdentityOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [gtdOpen, setGtdOpen] = useState(false);
  const [eisenhowerOpen, setEisenhowerOpen] = useState(false);
  const [pendingPlannerTask, setPendingPlannerTask] = useState(null);
  const [reviewSuggestions, setReviewSuggestions] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [gtdSeedText, setGtdSeedText] = useState('');
  const [pomodoroFocus, setPomodoroFocus] = useState(false);
  const pagesCache = useRef({});
  const tasksCache = useRef({});
  const [scheduledTasks, setScheduledTasks] = useState(null);
  const [sectionCalendarEvents, setSectionCalendarEvents] = useState([]);
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
      refreshDeadlineReminders(todoLists);

      // Precarica in coda (dopo task/pagine) tutti gli eventi Calendario dei
      // prossimi mesi in un'unica chiamata: il Pannello sezione li filtra poi
      // localmente per prefisso "[NomeSezione]", senza dover interrogare
      // Graph a ogni apertura (era il collo di bottiglia lento lamentato).
      setTimeout(() => preloadSectionCalendarEvents(), 3000);

    } catch (e) {
      console.error('load', e);
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  // Campanella Daily Review: proposte di task da email Outlook recenti + tag
  // "Da fare" (Ctrl+1) nelle pagine OneNote modificate di recente. Richiamata
  // all'avvio e su "↺ Aggiorna tutto". Interamente euristica/locale — nessuna
  // chiamata AI, nessun costo. Ogni proposta viene mostrata una sola volta:
  // accettata o ignorata, la sua "firma" viene ricordata (localStorage, 7
  // giorni) così non ricompare più — nessuno sforzo manuale ripetuto.
  async function refreshDailyReview() {
    setReviewLoading(true);
    try {
      const [emails, pages] = await Promise.all([
        getRecentEmails().catch(e => { console.error('recent emails', e); return []; }),
        collectAllOneNotePages().catch(e => { console.error('recent pages', e); return []; }),
      ]);

      // Scansiona solo le pagine modificate dall'ultimo controllo riuscito in
      // poi — non più sempre e solo le ultime 48h. Il primo avvio (o dopo una
      // pausa lunga) ricade sul lookback di 48h con un tetto di sicurezza sul
      // numero di pagine scaricate per intero; le volte successive, essendo
      // l'intervallo corto, restano leggere.
      const lastCheck = cacheGet(REVIEW_LAST_CHECK_KEY);
      const cutoffMs  = lastCheck || (Date.now() - NOTES_LOOKBACK_MS);
      const recentPages = filterRecentPages(pages, cutoffMs).slice(0, REVIEW_PAGES_CAP);

      const pagesWithHtml = [];
      for (const p of recentPages) {
        try {
          const html = await getPageContentHtml(p.id);
          pagesWithHtml.push({ ...p, html });
          await new Promise(r => setTimeout(r, 120));
        } catch (e) { console.error('page content', p.title, e); }
      }

      const seen = cacheGet('review_seen') || [];
      const candidates = [
        ...extractEmailCandidates(emails, 6),
        ...extractOneNoteCandidates(pagesWithHtml, 8),
      ];
      const fresh = candidates
        .map(a => ({ ...a, id: Math.random().toString(36).slice(2) + Date.now().toString(36), _sig: suggestionSignature(a) }))
        .filter(a => !seen.includes(a._sig));
      setReviewSuggestions(fresh);
      cacheSet(REVIEW_LAST_CHECK_KEY, Date.now(), REVIEW_LAST_CHECK_TTL);
    } catch (e) {
      console.error('daily review', e);
    }
    setReviewLoading(false);
  }

  // Scadenze ricorrenti (assicurazioni, salute, tasse...): un evento Calendario
  // ricorrente intitolato "[NOME-LISTA] Titolo", con reminder nativo impostato
  // con l'anticipo desiderato, fa comparire un task nella lista To-Do di
  // quell'Area nel momento in cui il reminder scatta — letto tramite
  // reminderView sulla finestra dall'ultimo controllo riuscito a oggi.
  // Nessuna proposta da accettare: il task compare direttamente, coerente con
  // l'uso quotidiano di To-Do (resta lì finché non lo spunti).
  async function refreshDeadlineReminders(todoLists) {
    try {
      const lastCheck = cacheGet(DEADLINE_LAST_CHECK_KEY);
      const startISO = new Date(lastCheck || (Date.now() - DEADLINE_LOOKBACK_MS)).toISOString();
      const endISO = new Date().toISOString();

      const reminders = await getReminders(startISO, endISO);
      if (!reminders.length) { cacheSet(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL); return; }

      const listByName = new Map((todoLists || []).map(l => [l.displayName.toLowerCase(), l]));
      const tasksByListId = {};

      for (const r of reminders) {
        const parsed = parseReminderSubject(r.eventSubject);
        if (!parsed) continue;
        const list = listByName.get(parsed.listName.toLowerCase());
        if (!list) continue;

        const startIso = r.eventStartTime?.dateTime ? new Date(r.eventStartTime.dateTime).toISOString() : '';
        const marker = reminderMarker(r.eventId, startIso);

        if (!tasksByListId[list.id]) {
          tasksByListId[list.id] = await getTasksForDeadlineDedup(list.id).catch(e => { console.error('deadline tasks', list.displayName, e); return []; });
        }
        if (tasksByListId[list.id].some(t => hasReminderMarker(t, marker))) continue;

        try {
          const dueDate = startIso ? startIso.slice(0, 19) : undefined;
          const task = await createTask(list.id, parsed.title, { body: marker, ...(dueDate ? { dueDate } : {}) });
          tasksByListId[list.id].push(task);
          setScheduledTasks(prev => [...(prev || []), { ...task, _listName: list.displayName, _listId: list.id }]);
        } catch (e) { console.error('create deadline task', parsed.title, e); }
      }

      cacheSet(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL);
    } catch (e) {
      console.error('deadline reminders', e);
    }
  }

  // Eventi Calendario dei prossimi mesi, precaricati in un'unica chiamata (in
  // coda dopo task/pagine, vedi load()) invece che dal Pannello sezione a ogni
  // apertura — era il collo di bottiglia lento lamentato, perché ripeteva
  // l'intera scansione multi-calendario a ogni click. Il Pannello ora filtra
  // solo localmente per prefisso "[NomeSezione]" (vedi deadlineReminders.js).
  async function preloadSectionCalendarEvents() {
    try {
      const start = new Date(); start.setMonth(start.getMonth() - 1);
      const end = new Date(); end.setMonth(end.getMonth() + 18);
      const events = await getCalendarEvents(start, end, 250);
      setSectionCalendarEvents(events);
    } catch (e) { console.error('section calendar events preload', e); }
  }

  // Se il candidato viene da OneNote, spunta subito la riga "Da fare" nella
  // pagina di origine — sia che venga accettato sia che venga scartato, la
  // Daily Review l'ha comunque "gestito" e non deve ripresentarlo.
  function resolveOneNoteSuggestion(suggestion) {
    if (suggestion.source !== 'onenote') return;
    markOneNoteTagDone(suggestion.pageId, suggestion.elementId, suggestion.originalTagHtml)
      .catch(e => console.error('mark onenote tag done', e));
  }

  // "Crea task" da un suggerimento non crea più un task al volo nella prima
  // lista disponibile: apre il pannello GTD con il testo già pronto, così
  // l'utente decide lui dove posizionarlo nel flusso (Farla, Progetto,
  // Area/Ricorrenti, Risorse, Archivio...).
  function handleAcceptSuggestion(suggestion, editedText) {
    markSuggestionSeen(suggestion._sig);
    resolveOneNoteSuggestion(suggestion);
    setReviewSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    setReviewOpen(false);
    setGtdSeedText((editedText || suggestion.extractedAction || '').trim());
    setGtdOpen(true);
  }

  function handleDismissSuggestion(suggestion) {
    markSuggestionSeen(suggestion._sig);
    resolveOneNoteSuggestion(suggestion);
    setReviewSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
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

  // Aggiorna la lista globale dei task (e la cache del Panel di sezione) dopo
  // un completamento/eliminazione/rinomina fatti dal pannello Piano, così
  // Task Pool, Panel e Smistamento Eisenhower restano coerenti senza dover
  // ricaricare tutto da Graph.
  function handleTaskCompleted(listId, taskId) {
    setScheduledTasks(prev => (prev || []).filter(t => t.id !== taskId));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = tasksCache.current[listId].filter(t => t.id !== taskId);
    }
  }

  function handleTaskDeleted(listId, taskId) {
    setScheduledTasks(prev => (prev || []).filter(t => t.id !== taskId));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = tasksCache.current[listId].filter(t => t.id !== taskId);
    }
  }

  function handleTaskRenamed(listId, taskId, newTitle) {
    setScheduledTasks(prev => (prev || []).map(t => t.id === taskId ? { ...t, title: newTitle } : t));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = tasksCache.current[listId].map(t => t.id === taskId ? { ...t, title: newTitle } : t);
    }
  }

  function handleTaskDueDateChanged(listId, taskId, dueDateTime) {
    setScheduledTasks(prev => (prev || []).map(t => t.id === taskId ? { ...t, dueDateTime } : t));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = tasksCache.current[listId].map(t => t.id === taskId ? { ...t, dueDateTime } : t);
    }
  }

  // Solo per nascondere il FAB GTD durante il focus Pomodoro (stesso angolo
  // del widget del timer): il Piano resta invariato, nessun pannello si apre.
  function handleStartPomodoroFocus() {
    setPomodoroFocus(true);
  }

  function handleEndPomodoroFocus() {
    setPomodoroFocus(false);
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
        <div className="header-left" />
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
            <div className="map-view-toggle">
              <button className={mapViewMode === 'workbook' ? 'active' : ''} onClick={() => setMapViewMode('workbook')} title="Vista per taccuino">Taccuini</button>
              <button className={mapViewMode === 'para' ? 'active' : ''} onClick={() => setMapViewMode('para')} title="Vista PARA">PARA</button>
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
        <div className="canvas-area" style={{ display: plannerOpen ? 'none' : undefined }}>
          <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(null)} />
          <SchedulePanel
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            onExpand={() => { setScheduleOpen(false); setPlannerOpen(true); }}
            preloadedTasks={scheduledTasks}
            onSelectSection={handleSelectSection}
            notebooks={notebooks}
            sectionsMap={sectionsMap}
          />
          <MindMap
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            todoListsMap={todoListsMap}
            todoCountMap={todoCountMap}
            viewMode={mapViewMode}
            onSelectSection={handleSelectSection}
            onExpandNotebook={handleExpandNotebook}
            externalZoom={zoom}
            onZoomChange={setZoom}
            onIdentityOpen={setIdentityOpen}
          />
          {/* Dock unificato in basso: Eisenhower · GTD · Attività · Review.
              Un solo contenitore centrato — niente più pile di bottoni
              flottanti che si sovrappongono ai pannelli. */}
          <div className="bottom-dock">
            <button
              className={`dock-btn${unclassifiedCount > 0 ? ' has-badge' : ''}`}
              onClick={() => setEisenhowerOpen(true)}
              title="Smistamento Eisenhower dei task non classificati">
              <span className="dock-btn-icon">🧭</span>
              <span className="dock-btn-label">Smista</span>
              {unclassifiedCount > 0 && <span className="header-badge">{unclassifiedCount}</span>}
            </button>
            <div className="dock-sep" />
            <button className="dock-gtd-btn" onClick={() => setGtdOpen(true)} title="Cattura pensiero (GTD)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              GTD
            </button>
            <div className="dock-sep" />
            <button
              className={`dock-btn${scheduleOpen ? ' active' : ''}`}
              onClick={() => setScheduleOpen(o => !o)}
              title="Pannello Attività (task)">
              <span className="dock-btn-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 5.5 4.5 7 7.5 4" />
                  <line x1="10.5" y1="6" x2="21" y2="6" />
                  <polyline points="3 11.5 4.5 13 7.5 10" />
                  <line x1="10.5" y1="12" x2="21" y2="12" />
                  <polyline points="3 17.5 4.5 19 7.5 16" />
                  <line x1="10.5" y1="18" x2="21" y2="18" />
                </svg>
              </span>
              <span className="dock-btn-label">Attività</span>
            </button>
            <div className="bell-wrap">
              <button
                className={`dock-btn${reviewOpen ? ' active' : ''}${reviewSuggestions.length ? ' has-badge' : ''}`}
                onClick={() => setReviewOpen(o => !o)}
                title="Proposte Daily Review">
                <span className="dock-btn-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <span className="dock-btn-label">Review</span>
                {reviewSuggestions.length > 0 && <span className="header-badge">{reviewSuggestions.length}</span>}
              </button>
              {reviewOpen && (
                <div className="bell-dropdown">
                  <div className="bell-dropdown-header">
                    <span>Daily Review</span>
                    <button onClick={() => setReviewOpen(false)}>✕</button>
                  </div>
                  {reviewLoading && <div className="bell-empty">Analisi email e OneNote in corso…</div>}
                  {!reviewLoading && reviewSuggestions.length === 0 && (
                    <div className="bell-empty">Nessuna proposta al momento.</div>
                  )}
                  {!reviewLoading && reviewSuggestions.map(s => (
                    <BellSuggestionItem
                      key={s.id}
                      suggestion={s}
                      onAccept={handleAcceptSuggestion}
                      onDismiss={handleDismissSuggestion}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Pannello sezione (ToDo/OneNote/OneDrive) — fisso rispetto al
            viewport, non alla vista corrente: così può aprirsi/restare aperto
            sia dalla vista principale sia dal Piano (es. focus Pomodoro),
            senza dover chiudere/cambiare vista. */}
        <Panel
          selected={selected}
          pagesCache={pagesCache}
          tasksCache={tasksCache}
          calendarEvents={sectionCalendarEvents}
          onClose={() => setSelected(null)}
        />
        <PlannerView
          open={plannerOpen}
          onClose={() => setPlannerOpen(false)}
          preloadedTasks={scheduledTasks || []}
          notebooks={notebooks}
          sectionsMap={sectionsMap}
          pagesCache={pagesCache}
          autoAddTask={pendingPlannerTask}
          onAutoAdded={() => setPendingPlannerTask(null)}
          onTaskCompleted={handleTaskCompleted}
          onTaskDeleted={handleTaskDeleted}
          onTaskRenamed={handleTaskRenamed}
          onTaskDueChanged={handleTaskDueDateChanged}
          onStartFocus={handleStartPomodoroFocus}
          onEndFocus={handleEndPomodoroFocus}
        />
        <EisenhowerTriage
          open={eisenhowerOpen}
          onClose={() => setEisenhowerOpen(false)}
          tasks={scheduledTasks || []}
        />
        {/* In modalità Piano il dock in basso (dentro .canvas-area, nascosta)
            non è visibile: si ripropone qui il pulsante GTD, fuori da quel
            contenitore, come cerchio fisso in basso a destra. Si spegne
            durante il focus Pomodoro: stesso angolo dello schermo del widget
            del timer, e la visualizzazione è comunque bloccata. */}
        {plannerOpen && !pomodoroFocus && (
          <button className="gtd-fab" onClick={() => setGtdOpen(true)} title="Cattura pensiero (GTD)">+</button>
        )}
        <GtdClarifyModal
          open={gtdOpen}
          onClose={() => { setGtdOpen(false); setGtdSeedText(''); }}
          seedText={gtdSeedText}
          todoLists={todoListsRef.current}
          notebooks={notebooks}
          sectionsMap={sectionsMap}
          onTaskCreated={(task, { addToday }) => {
            setScheduledTasks(prev => [...(prev || []), task]);
            if (addToday) { setPendingPlannerTask(task); setPlannerOpen(true); }
          }}
          onEventCreated={event => setSectionCalendarEvents(prev => [...(prev || []), event])}
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

// Riga della campanella Daily Review: senza un LLM a ripulire il testo, il
// titolo proposto (oggetto email o riga taggata "Da fare" in OneNote) resta
// modificabile prima di creare il task.
function BellSuggestionItem({ suggestion, onAccept, onDismiss }) {
  const [text, setText] = useState(suggestion.extractedAction);

  return (
    <div className="bell-item">
      <input
        className="bell-item-input"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="bell-item-meta">
        {suggestion.source === 'onenote' ? '📓' : '📧'} {suggestion.title?.slice(0, 40)}
      </div>
      <div className="bell-item-actions">
        <button className="bell-accept-btn" onClick={() => onAccept(suggestion, text)}>✓ Crea task</button>
        <button className="bell-dismiss-btn" onClick={() => onDismiss(suggestion)}>✕</button>
      </div>
    </div>
  );
}
