import { useState, useEffect, useRef } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages, getRecentEmails, getPageContentHtml, markOneNoteTagDone } from './api';
import { cacheGet, cacheSet, cacheClear, TTL } from './cache';
import { extractEmailCandidates, extractOneNoteCandidates } from './dailyReview';
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
const NOTES_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;    // ultime 48h

function suggestionSignature(a) {
  return `${a.source || 'email'}::${a.title || ''}::${a.extractedAction || ''}`;
}

function markSuggestionSeen(sig) {
  const seen = cacheGet('review_seen') || [];
  if (!seen.includes(sig)) {
    cacheSet('review_seen', [...seen, sig].slice(-300), REVIEW_SEEN_TTL);
  }
}

function filterRecentPages(pages, lookbackMs) {
  const cutoff = Date.now() - lookbackMs;
  return pages
    .filter(p => p.lastModifiedDateTime && new Date(p.lastModifiedDateTime).getTime() >= cutoff)
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

      const recentPages = filterRecentPages(pages, NOTES_LOOKBACK_MS).slice(0, 10);

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
    } catch (e) {
      console.error('daily review', e);
    }
    setReviewLoading(false);
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
        {!scheduleOpen && !plannerOpen && (
          <div className="floating-btn-stack">
            <div className="bell-wrap">
              <button
                className={`floating-btn${reviewSuggestions.length ? ' has-badge' : ''}`}
                onClick={() => setReviewOpen(o => !o)}
                title="Proposte Daily Review">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
            <button
              className="floating-btn"
              onClick={() => setScheduleOpen(o => !o)}
              title="Attività">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="13" r="7"/>
                <polyline points="12 10 12 14 14 14"/>
                <line x1="7" y1="4" x2="4.5" y2="6.5"/>
                <line x1="17" y1="4" x2="19.5" y2="6.5"/>
              </svg>
            </button>
          </div>
        )}
        <div className="canvas-area" style={{ display: plannerOpen ? 'none' : undefined }}>
          <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(null)} />
          <SchedulePanel
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            onExpand={() => { setScheduleOpen(false); setPlannerOpen(true); }}
            preloadedTasks={scheduledTasks}
            onSelectSection={handleSelectSection}
            todoListsMap={todoListsMap}
            sectionsMap={sectionsMap}
          />
          <MindMap
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            todoListsMap={todoListsMap}
            todoCountMap={todoCountMap}
            viewMode={mapViewMode}
            onViewModeChange={setMapViewMode}
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
          <div className="bottom-action-bar">
            <button
              className={`bottom-eis-btn${unclassifiedCount > 0 ? ' has-badge' : ''}`}
              onClick={() => setEisenhowerOpen(true)}
              title="Smistamento Eisenhower dei task non classificati">
              🧭
              {unclassifiedCount > 0 && <span className="header-badge">{unclassifiedCount}</span>}
            </button>
            <button className="bottom-gtd-btn" onClick={() => setGtdOpen(true)} title="Cattura pensiero (GTD)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              GTD
            </button>
            <div className="bottom-action-bar-spacer" />
          </div>
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
          onClose={() => { setGtdOpen(false); setGtdSeedText(''); }}
          seedText={gtdSeedText}
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
