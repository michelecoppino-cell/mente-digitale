import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { initAuth, getAccount, login, trySsoSilent } from './auth';
import { getNotebooks, getSections, getTodoLists, getTodoTasks, getPages, getRecentEmails, getPageContentHtml, markOneNoteTagDone, getReminders, createTask, getCalendarEvents, getTasksForDeadlineDedup, invalidateCalendarsCache, loadColorSettings, saveColorSettings, migrateLegacyDriveFiles, loadPlannerConfig, loadDailyPlans, saveDailyPlans, updateTaskStatus, completeTask } from './api';
import { getMarker, setMarker, clearMarkers } from './markers';
import { queryClient, qk, STALE } from './queryClient';
import { extractEmailCandidates, extractOneNoteCandidates } from './dailyReview';
import { parseReminderSubject, reminderMarker, hasReminderMarker } from './deadlineReminders';
import { shadeColor, DEFAULT_CONFIG } from './plannerShared';
import IdentityPanel from './IdentityPanel';
import SearchOverlay from './SearchOverlay';
import Panel from './Panel';
import GtdClarifyModal from './GtdClarifyModal';
import QuickCapture from './QuickCapture';
import AppShell from './AppShell';
import { usePomodoro } from './pomodoroContext';
import TodayView from './TodayView';
import { graphStatusFor, STATUS_LABELS } from './taskModel';
import { pushUndo } from './undo';
import { COLORS } from './config';
import { whenIdle } from './idle';
import { notifyError } from './notify';
import UndoToast from './UndoToast';
import Toaster from './Toaster';
import './App.css';

// ── Viste caricate alla prima visita ────────────────────────────────────────
// L'app si apre su «Oggi», che è una lettura di dati già in memoria: non ha
// motivo di far scaricare prima la mappa mentale (d3, 115 kB), le duemila righe
// di griglia del Piano, il Diario e la board delle Attività — cioè, prima di
// questa divisione, l'intera app in un unico file da 272 kB più 128 kB di CSS.
// Ogni vista diventa un pezzo a sé, scaricato quando la si apre e poi tenuto in
// cache come ogni altro asset con hash nel nome.
//
// Il Piano è l'eccezione che vale un precarico: è la destinazione dove si va
// più spesso dopo Oggi, e lo si prende in sottofondo appena il browser è fermo
// (vedi prefetchViews), così il primo click resta immediato.
const MindMap = lazy(() => import('./MindMap'));
const PlannerView = lazy(() => import('./PlannerView'));
const ActivityBoard = lazy(() => import('./ActivityBoard'));
const SectionsView = lazy(() => import('./SectionsView'));
const DiaryPanel = lazy(() => import('./DiaryPanel'));
const FinanzeSection = lazy(() => import('./finanze/FinanzeSection'));
// Le impostazioni colore si aprono dall'ingranaggio, qualche volta l'anno:
// non devono stare nel primo caricamento di nessuno.
const ColorSettingsModal = lazy(() => import('./ColorSettingsModal'));

/** Il velo di attesa fra un chunk di vista e l'altro. */
function ViewFallback() {
  return <div className="view-loading" role="status" aria-live="polite">Caricamento…</div>;
}

// Precarico in sottofondo delle viste più probabili, quando il browser non ha
// niente di meglio da fare: il costo della divisione in chunk si paga una volta
// sola e fuori dal percorso critico, invece che al primo click.
function prefetchViews() {
  whenIdle(() => { import('./PlannerView'); }, 4000);
  whenIdle(() => { import('./ActivityBoard'); }, 8000);
}

const DEFAULT_COLOR_SETTINGS = { notebooks: {}, sections: {} };

// Applica gli override di colore (persistiti, vedi initColorSettings /
// applyColorSettings) a un taccuino o alle sue sezioni, mutandoli sul posto —
// stessa convenzione già in uso per nb._color prima di questa feature, così
// tutte le viste che leggono nb._color/sec._color vedono da subito il colore
// scelto dall'utente invece di quello assegnato automaticamente per indice.
function applyNotebookColor(nb, index, overrides) {
  nb._color = overrides.notebooks[nb.id] || COLORS[index % COLORS.length];
}

function applySectionColors(nb, sections, overrides) {
  (sections || []).forEach((s, i) => {
    s._color = overrides.sections[s.id] || shadeColor(nb._color || '#888', i);
  });
}

const REVIEW_SEEN_TTL = 7 * 24 * 60 * 60 * 1000;      // 7 giorni
const NOTES_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;    // fallback alla prima scansione: ultime 48h
const REVIEW_LAST_CHECK_KEY = 'review_last_check';
const REVIEW_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const REVIEW_PAGES_CAP = 40; // tetto di sicurezza sulle pagine il cui contenuto viene scaricato per intero

const DEADLINE_LAST_CHECK_KEY = 'deadline_reminders_last_check';
const DEADLINE_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const DEADLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;     // fallback alla prima scansione: ultimi 7 giorni

// I file dell'app sono passati dalla root di OneDrive alla cartella
// `mente-digitale/`. Lo spostamento dei file già esistenti gira una volta per
// browser, in sottofondo: non blocca il caricamento e, se fallisce, il marker
// non viene scritto e si riprova al prossimo avvio (nel frattempo i singoli
// file vengono comunque recuperati dalla migrazione pigra in api.js).
// Il flag sta su localStorage e non tra i marker: quelli vengono azzerati da
// "Aggiorna tutto" (clearMarkers), e rifare la scansione della root a ogni
// refresh manuale sarebbe una richiesta sprecata.
const DRIVE_MIGRATION_KEY = 'md_drive_folder_migrated';

function runDriveMigrationOnce() {
  try { if (localStorage.getItem(DRIVE_MIGRATION_KEY)) return; } catch { /* storage non disponibile */ }
  migrateLegacyDriveFiles()
    .then(moved => {
      try { localStorage.setItem(DRIVE_MIGRATION_KEY, '1'); } catch { /* no-op */ }
      if (moved) console.info(`OneDrive: spostati ${moved} file in mente-digitale/`);
    })
    .catch(e => console.error('migrazione cartella OneDrive', e));
}

// Scorciatoie dalla schermata Home di iPhone: /gtd.html e /diario.html sono
// due pagine che, lanciate dalla loro icona, rimbalzano qui con `?apri=…`.
// Servono perché iOS ignora gli `shortcuts` del manifest: l'unico modo di
// avere due icone distinte è avere due pagine distinte da aggiungere alla Home.
function launchIntent() {
  try {
    return new URLSearchParams(window.location.search).get('apri');
  } catch { return null; }
}

// Modo della Mappa (taccuini | para) — vedi mapViewMode in App.
const MAP_VIEW_MODE_KEY = 'md_map_view_mode_v1';

function readMapViewMode() {
  try {
    const saved = localStorage.getItem(MAP_VIEW_MODE_KEY);
    return saved === 'para' || saved === 'workbook' ? saved : 'workbook';
  } catch { return 'workbook'; }
}

function suggestionSignature(a) {
  return `${a.source || 'email'}::${a.title || ''}::${a.extractedAction || ''}`;
}

function markSuggestionSeen(sig) {
  const seen = getMarker('review_seen') || [];
  if (!seen.includes(sig)) {
    setMarker('review_seen', [...seen, sig].slice(-300), REVIEW_SEEN_TTL);
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
//
// Riusa le cache già popolate (localStorage + pagesCache in memoria) invece di
// riscaricare da Graph l'elenco pagine di ogni sezione a ogni avvio: era il
// costo di rete più grosso dell'app, duplicava il lavoro della preload queue.
// Le pagine modificate di recente si individuano comunque via
// lastModifiedDateTime, presente anche nelle copie in cache.
// Lettura via TanStack Query che rispecchia il vecchio `cacheGet(...) || (fetch
// + cacheSet(...))`: con forceRefresh forza il refetch (staleTime 0), altrimenti
// riusa il dato in cache se ancora fresco. La persistenza su localStorage e la
// dedup delle richieste sono gestite dal query client (vedi queryClient.js).
function fetchCached(queryKey, queryFn, staleTime, forceRefresh = false) {
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime: forceRefresh ? 0 : staleTime });
}

async function collectAllOneNotePages(pagesCacheRef) {
  // ensureQueryData riusa il dato già in cache (anche "vecchio") senza
  // rivalidarlo: la Daily Review vuole solo aggregare le pagine già viste, non
  // riscaricare da Graph l'elenco di ogni sezione a ogni avvio.
  const notebooks = await queryClient.ensureQueryData({
    queryKey: qk.notebooks(), queryFn: getNotebooks, staleTime: STALE.notebooks,
  });
  const allPages = [];
  for (const nb of notebooks) {
    let sections;
    try {
      sections = await queryClient.ensureQueryData({
        queryKey: qk.sections(nb.id), queryFn: () => getSections(nb.id), staleTime: STALE.sections,
      });
    } catch (e) { console.error('sections', nb.displayName, e); continue; }
    for (const sec of sections) {
      let pages = pagesCacheRef?.current?.[sec.id] || queryClient.getQueryData(qk.pages(sec.id));
      if (!pages) {
        try {
          pages = await queryClient.ensureQueryData({
            queryKey: qk.pages(sec.id), queryFn: () => getPages(sec.id), staleTime: STALE.pages,
          });
          if (pagesCacheRef?.current) pagesCacheRef.current[sec.id] = pages;
        } catch (e) { console.error('pages', sec.displayName, e); continue; }
        // Throttle solo quando si è davvero interrogato Graph
        await new Promise(r => setTimeout(r, 100));
      }
      allPages.push(...pages);
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
  // La Mappa riapre come l'hai lasciata: il commutatore Taccuini/PARA è una
  // preferenza, non un parametro di sessione, e ripartire sempre da «Taccuini»
  // costringeva a rimetterlo su PARA ogni volta.
  const [mapViewMode, setMapViewMode] = useState(readMapViewMode);
  const [identityOpen, setIdentityOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // La cattura chiesta dalla scorciatoia è aperta già al primo render, non in
  // un effetto: così non si vede prima la vista sotto e poi il modale coprirla.
  const [gtdOpen, setGtdOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(() => launchIntent() === 'gtd');
  const [pendingPlannerTask, setPendingPlannerTask] = useState(null);
  const [reviewSuggestions, setReviewSuggestions] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [gtdSeedText, setGtdSeedText] = useState('');
  const [colorSettings, setColorSettings] = useState(DEFAULT_COLOR_SETTINGS);
  const [colorSettingsOpen, setColorSettingsOpen] = useState(false);
  const colorSettingsRef = useRef(DEFAULT_COLOR_SETTINGS);
  const colorSettingsLoadedRef = useRef(false);
  const notebooksRef = useRef([]);
  const pagesCache = useRef({});
  const tasksCache = useRef({});
  const [scheduledTasks, setScheduledTasks] = useState(null);
  // Config del Piano: la vista Attività ne ha bisogno per i colori di
  // progetto, altrimenti mostrerebbe quelli segnaposto del default.
  const [plannerConfig, setPlannerConfig] = useState(DEFAULT_CONFIG);
  // Le liste To-Do servono alla board (per sapere qual è l'Inbox) e al
  // chiarimento (per scegliere la sezione). todoListsRef non basta: è un ref,
  // non fa ri-renderizzare quando arriva.
  const [todoLists, setTodoLists] = useState([]);
  // I piani giornalieri decidono quali task sono `scheduled`: lo stato non è
  // sul task ma nell'esistenza di un blocco nel piano.
  const [dailyPlans, setDailyPlans] = useState({});
  // L'attività di Inbox che si sta chiarendo: il chiarimento è il diagramma
  // GTD di sempre — quello che si apre da «Decidi ora» — solo che qui parte da
  // un task già catturato invece che da una riga di testo.
  const [clarifyTask, setClarifyTask] = useState(null);
  const [sectionCalendarEvents, setSectionCalendarEvents] = useState([]);
  // Gli eventi del calendario arrivano in coda, qualche secondo dopo il resto:
  // finché il tentativo non è stato fatto, «nessun appuntamento oggi» sarebbe
  // una risposta inventata (vedi TodayView).
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  // Incrementato ogni volta che un evento calendario viene creato fuori dal
  // Piano (es. dal popup GTD), per far invalidare a PlannerView la sua cache
  // bulk altrimenti stale fino al TTL.
  const [calendarDirtyToken, setCalendarDirtyToken] = useState(0);
  const preloadQueueRef = useRef([]);
  const preloadRunningRef = useRef(false);
  const todoListsRef = useRef([]);

  const navigate = useNavigate();
  const location = useLocation();
  const pomodoro = usePomodoro();

  useEffect(() => {
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      if (acc) {
        load(false);
        prefetchViews();
      } else {
        // Tentativo di SSO silenzioso in background, senza bloccare il primo
        // render: se la sessione Microsoft è ancora attiva si passa dallo
        // schermo di login senza che l'utente se ne accorga.
        trySsoSilent().then(ssoAcc => {
          if (ssoAcc) {
            setAccount(ssoAcc);
            load(false);
          }
        });
      }
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(MAP_VIEW_MODE_KEY, mapViewMode); } catch { /* storage non disponibile */ }
  }, [mapViewMode]);

  // Il parametro `apri` ha fatto il suo lavoro al primo render: si toglie
  // dall'URL, così chiudere il pannello e ricaricare la pagina non lo riapre.
  useEffect(() => {
    if (!launchIntent()) return;
    if (launchIntent() === 'diario') navigate('/diario', { replace: true });
    // Il pathname da solo butterebbe via anche l'hash, cioè la rotta corrente.
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scorciatoie: ⌘K ricerca globale, ⌘J diario, ⌘N cattura da qualunque vista
  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
      if (key === 'j') {
        e.preventDefault();
        navigate('/diario');
      }
      if (key === 'n') {
        e.preventDefault();
        setCaptureOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  async function handleLogin() {
    try { await login(); setAccount(getAccount()); load(false); }
    catch (e) { console.error(e); }
  }

  async function load(forceRefresh = false) {
    setSync({ state: 'loading', label: 'Caricamento…' });
    runDriveMigrationOnce();

    // Svuota cache in memoria se forceRefresh
    if (forceRefresh) {
      clearMarkers();
      // Marca stale tutte le query (App + PlannerView): App le rifetcha subito
      // con staleTime 0, PlannerView alla prossima apertura/navigazione — come
      // prima faceva cacheClear() azzerando le chiavi di cache.js di entrambi.
      queryClient.invalidateQueries();
      invalidateCalendarsCache();
      pagesCache.current = {};
      tasksCache.current = {};
    }

    try {
      // Le tre letture d'avvio partono insieme e non una dopo l'altra: sono
      // indipendenti (due endpoint Graph diversi e un file su OneDrive), e in
      // fila costavano tre viaggi di rete sommati prima che comparisse
      // qualunque cosa. I colori vanno comunque applicati ai taccuini *dopo*
      // che sono arrivati entrambi, ed è quello che fa l'await unico qui sotto.
      const colorPromise = fetchCached(qk.colorSettings(), loadColorSettings, STALE.colorSettings, forceRefresh)
        .catch(e => { console.error('color settings load', e); return queryClient.getQueryData(qk.colorSettings()) || null; });
      const notebooksPromise = fetchCached(qk.notebooks(), getNotebooks, STALE.notebooks, forceRefresh);
      const listsPromise = fetchCached(qk.todolists(), getTodoLists, STALE.todolists, forceRefresh);

      // Config del Piano: serve alla vista Attività per i colori di progetto.
      // Non è bloccante — se non arriva si resta sul default e i task si
      // vedono comunque, solo senza il colore del loro progetto.
      fetchCached(qk.plannerConfig(), loadPlannerConfig, STALE.plannerConfig, forceRefresh)
        .then(cfg => { if (cfg) setPlannerConfig(cfg); })
        .catch(e => console.error('planner config load', e));

      const [colorCfg, nbs, lists] = await Promise.all([colorPromise, notebooksPromise, listsPromise]);

      // Colori personalizzati (taccuini/sezioni) scelti dall'utente
      // nell'ingranaggio impostazioni — vanno applicati subito dopo aver
      // ricevuto taccuini e sezioni, prima di renderli nello stato.
      const overrides = colorCfg || DEFAULT_COLOR_SETTINGS;
      colorSettingsRef.current = overrides;
      colorSettingsLoadedRef.current = true;
      setColorSettings(overrides);

      // Taccuini
      nbs.forEach((nb, i) => applyNotebookColor(nb, i, overrides));
      notebooksRef.current = nbs;
      setNotebooks(nbs);

      // Liste ToDo
      todoListsRef.current = lists;
      setTodoLists(lists);
      const map = {};
      lists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
      setTodoListsMap(map);

      // Piani giornalieri: da qui esce lo stato `scheduled` delle attività.
      // Non blocca il caricamento — senza, la colonna Programmate resta vuota
      // ma il resto della board funziona.
      fetchCached(qk.dailyPlans(), loadDailyPlans, STALE.dailyPlans, forceRefresh)
        .then(plans => setDailyPlans(plans || {}))
        .catch(e => console.error('daily plans load', e));

      // Sezioni — mostra subito quelle già in cache, poi si espandono lazy al
      // click. Anche su forceRefresh si parte da quelle in cache: sparire per
      // qualche secondo e ricomparire identiche è peggio che mostrarle e
      // aggiornarle sotto (il rifetch vero è in coda qui sotto).
      const sectMap = {};
      for (const nb of nbs) {
        const cached = queryClient.getQueryData(qk.sections(nb.id));
        if (cached) {
          applySectionColors(nb, cached, overrides);
          sectMap[nb.id] = cached;
        }
      }
      if (Object.keys(sectMap).length > 0) setSectionsMap(sectMap);

      setSync({ state: 'ok', label: `${nbs.length} taccuini` });

      // ── Il resto è sottofondo, in ordine di quanto serve allo schermo ─────
      // I task riempiono Oggi e Attività: partono subito, senza aspettare un
      // momento libero. Tutto il resto — pagine OneNote, eventi del calendario,
      // Daily Review, scadenze — non è visibile al primo schermo e va in coda
      // ai momenti in cui il browser è fermo, invece che a `setTimeout` con
      // numeri scelti a mano che partono comunque mentre si sta ancora
      // disegnando (o mentre l'utente scorre).
      preloadAllTasks(lists, forceRefresh);

      // «Aggiorna tutto» finora non toccava l'elenco delle sezioni: azzerava la
      // cache e aspettava che si riespandesse un taccuino a mano. Una sezione
      // creata o rinominata su OneNote non compariva finché non si ricaricava la
      // pagina. Qui il rifetch è esplicito, in coda e taccuino per taccuino.
      whenIdle(async () => {
        const fresh = forceRefresh ? await refreshAllSections(nbs, overrides) : sectMap;
        Object.values(fresh).forEach(sects =>
          sects.forEach(s => enqueuePagePreload(s.id, forceRefresh))
        );
      }, 2500);

      // Eventi Calendario dei prossimi mesi in un'unica chiamata: il Pannello
      // sezione li filtra poi localmente per prefisso "[NomeSezione]", senza
      // dover interrogare Graph a ogni apertura (era il collo di bottiglia
      // lento lamentato).
      whenIdle(() => preloadSectionCalendarEvents(), 3500);

      // La Daily Review scarica il contenuto di decine di pagine OneNote: è la
      // cosa più costosa dell'avvio e la meno urgente — la campanella può
      // riempirsi qualche secondo dopo che la giornata è già a schermo.
      whenIdle(() => {
        refreshDailyReview();
        refreshDeadlineReminders(lists);
      }, 6000);

    } catch (e) {
      setSync({ state: 'error', label: 'Errore caricamento' });
      notifyError('Non sono riuscito a leggere taccuini e liste da Microsoft. Quello che vedi potrebbe essere la copia di prima.', e);
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
        collectAllOneNotePages(pagesCache).catch(e => { console.error('recent pages', e); return []; }),
      ]);

      // Scansiona solo le pagine modificate dall'ultimo controllo riuscito in
      // poi — non più sempre e solo le ultime 48h. Il primo avvio (o dopo una
      // pausa lunga) ricade sul lookback di 48h con un tetto di sicurezza sul
      // numero di pagine scaricate per intero; le volte successive, essendo
      // l'intervallo corto, restano leggere.
      const lastCheck = getMarker(REVIEW_LAST_CHECK_KEY);
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

      const seen = getMarker('review_seen') || [];
      const candidates = [
        ...extractEmailCandidates(emails, 6),
        ...extractOneNoteCandidates(pagesWithHtml, 8),
      ];
      const fresh = candidates
        .map(a => ({ ...a, id: Math.random().toString(36).slice(2) + Date.now().toString(36), _sig: suggestionSignature(a) }))
        .filter(a => !seen.includes(a._sig));
      setReviewSuggestions(fresh);
      setMarker(REVIEW_LAST_CHECK_KEY, Date.now(), REVIEW_LAST_CHECK_TTL);
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
      const lastCheck = getMarker(DEADLINE_LAST_CHECK_KEY);
      const startISO = new Date(lastCheck || (Date.now() - DEADLINE_LOOKBACK_MS)).toISOString();
      const endISO = new Date().toISOString();

      const reminders = await getReminders(startISO, endISO);
      if (!reminders.length) { setMarker(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL); return; }

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

      setMarker(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL);
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
    // Riuscito o fallito, il tentativo è stato fatto: da qui in poi un'agenda
    // vuota è un'agenda vuota, e Oggi può dirlo invece di mostrare l'attesa.
    setCalendarLoaded(true);
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
    let anyError = false;
    for (const l of lists) {
      try {
        const tasks = await fetchCached(qk.tasks(l.id), () => getTodoTasks(l.id), STALE.tasks, forceRefresh);
        tasksCache.current[l.id] = tasks;
        tasks.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        if (tasks.length > 0) counts[l.displayName.toLowerCase()] = tasks.length;
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error('preload tasks', l.displayName, e);
        anyError = true;
        // Non lasciare la lista vuota per un errore transitorio (es. 401 dopo
        // una pausa lunga): ripiega sull'ultima copia in cache così l'utente
        // non vede la pianificazione sparire del tutto.
        const stale = queryClient.getQueryData(qk.tasks(l.id));
        if (stale) {
          tasksCache.current[l.id] = stale;
          stale.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
          if (stale.length > 0) counts[l.displayName.toLowerCase()] = stale.length;
        }
      }
    }
    setScheduledTasks(allTasks);
    setTodoCountMap(counts);
    if (anyError) {
      setSync({ state: 'error', label: 'Errore aggiornamento task — dati non aggiornati' });
    }
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
        const cached = await fetchCached(qk.pages(sectionId), () => getPages(sectionId), STALE.pages, forceRefresh);
        pagesCache.current[sectionId] = cached;
        await new Promise(r => setTimeout(r, 400));
      } catch (e) { console.error('preload pages', sectionId, e); }
    }
    preloadRunningRef.current = false;
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    try {
      const sects = await fetchCached(qk.sections(nb.id), () => getSections(nb.id), STALE.sections);
      applySectionColors(nb, sects, colorSettingsRef.current);
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      whenIdle(() => sects.forEach(s => enqueuePagePreload(s.id)), 1500);
    } catch (e) {
      console.error('Errore sezioni', nb.displayName, e);
      setSectionsMap(prev => ({ ...prev, [nb.id]: [] }));
    }
  }

  // Rilettura da Graph dell'elenco sezioni di ogni taccuino, una alla volta e
  // con un respiro fra le richieste (come il resto dei precarichi). Ogni
  // taccuino aggiorna lo stato appena arriva: l'elenco si rinfresca a pezzi
  // invece di cambiare tutto insieme dopo l'ultima risposta.
  async function refreshAllSections(nbs, overrides) {
    /** @type {Record<string, any[]>} */
    const out = {};
    for (const nb of nbs) {
      try {
        const sects = await fetchCached(qk.sections(nb.id), () => getSections(nb.id), STALE.sections, true);
        applySectionColors(nb, sects, overrides);
        out[nb.id] = sects;
        setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.error('refresh sezioni', nb.displayName, e);
        const stale = queryClient.getQueryData(qk.sections(nb.id));
        if (stale) out[nb.id] = /** @type {any[]} */ (stale);
      }
    }
    return out;
  }

  // Salva i nuovi override colore (localStorage + OneDrive, come workbooks/
  // planner config) e ricolora subito taccuini/sezioni già in memoria, così
  // il cambiamento è visibile ovunque senza dover ricaricare la pagina.
  function applyColorSettings(next) {
    colorSettingsRef.current = next;
    setColorSettings(next);
    queryClient.setQueryData(qk.colorSettings(), next);
    if (colorSettingsLoadedRef.current) {
      saveColorSettings(next).catch(e => console.error('save color settings', e));
    }

    const nbs = notebooksRef.current;
    nbs.forEach((nb, i) => applyNotebookColor(nb, i, next));
    setNotebooks([...nbs]);

    setSectionsMap(prev => {
      Object.entries(prev).forEach(([nbId, sects]) => {
        const nb = nbs.find(n => n.id === nbId);
        if (nb) applySectionColors(nb, sects, next);
      });
      return { ...prev };
    });
  }

  function setNotebookColor(nbId, color) {
    const cur = colorSettingsRef.current;
    applyColorSettings({ notebooks: { ...cur.notebooks, [nbId]: color }, sections: cur.sections });
  }

  function setSectionColor(sectionId, color) {
    const cur = colorSettingsRef.current;
    applyColorSettings({ notebooks: cur.notebooks, sections: { ...cur.sections, [sectionId]: color } });
  }

  function resetNotebookColor(nbId) {
    const cur = colorSettingsRef.current;
    const nextNotebooks = { ...cur.notebooks };
    delete nextNotebooks[nbId];
    applyColorSettings({ notebooks: nextNotebooks, sections: cur.sections });
  }

  function resetSectionColor(sectionId) {
    const cur = colorSettingsRef.current;
    const nextSections = { ...cur.sections };
    delete nextSections[sectionId];
    applyColorSettings({ notebooks: cur.notebooks, sections: nextSections });
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
  // Task Pool e Panel restano coerenti senza dover
  // ricaricare tutto da Graph.
  function updateTasksEverywhere(listId, updater) {
    setScheduledTasks(prev => updater(prev || []));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = updater(tasksCache.current[listId]);
    }
  }

  // Completamento ed eliminazione hanno lo stesso effetto locale: il task
  // sparisce da pool e cache di sezione.
  function handleTaskRemoved(listId, taskId) {
    updateTasksEverywhere(listId, tasks => tasks.filter(t => t.id !== taskId));
  }

  function handleTaskPatched(listId, taskId, patch) {
    updateTasksEverywhere(listId, tasks => tasks.map(t => t.id === taskId ? { ...t, ...patch } : t));
  }

  // Simmetrico a handleTaskRemoved: rimette un task (ricreato da un undo di
  // eliminazione/completamento) nel pool globale.
  function handleTaskRestored(listId, task) {
    updateTasksEverywhere(listId, tasks => [...tasks, task]);
  }

  // Il Pomodoro avviato dal Piano diventa una sessione a livello di app: la
  // barra in cima resta visibile anche cambiando vista, che è tutto il punto
  // di averla tirata fuori da PlannerView. La sessione non è ancora legata a
  // un task o a una sezione — quel collegamento arriva col Piano e con Sezioni.
  function handleStartPomodoroFocus() {
    pomodoro.start({ durationMin: 25 });
  }

  function handleEndPomodoroFocus() {
    pomodoro.stop();
  }

  // ── Vista Attività: le transizioni di stato ──────────────────────────────
  // Lo stato vive su Graph, non in memoria: si scrive prima lì e si aggiorna
  // il pool solo dopo, così una schermata che dice "In attesa" corrisponde
  // sempre a un task che su To-Do è davvero waitingOnOthers.

  async function handleChangeTaskStatus(task, status) {
    const listId = task._listId;
    const before = task.status;
    try {
      await updateTaskStatus(listId, task.id, graphStatusFor(status));
      handleTaskPatched(listId, task.id, { status: graphStatusFor(status) });
      pushUndo({
        label: `Spostata in ${STATUS_LABELS[status]}`,
        undo: async () => {
          await updateTaskStatus(listId, task.id, before || 'notStarted');
          handleTaskPatched(listId, task.id, { status: before });
        },
      });
    } catch (e) {
      notifyError(`Non ho potuto spostare "${task.title}" in ${STATUS_LABELS[status]}. Controlla la connessione e riprova.`, e);
    }
  }

  // Programmare vuol dire dare un'ora, e l'ora si dà sulla griglia: la board
  // porta al Piano sul giorno corrente con il task già in mano, invece di
  // inventare un orario per conto suo.
  function handleScheduleTask(task) {
    setPendingPlannerTask(task);
    navigate('/piano');
  }

  // Toglie il blocco dal piano di ogni giorno in cui compare: senza blocco il
  // task torna `next` da solo, perché `scheduled` non è un campo ma la
  // presenza del blocco.
  async function handleUnscheduleTask(task) {
    const previous = dailyPlans;
    const next = {};
    for (const [date, plan] of Object.entries(dailyPlans || {})) {
      next[date] = { ...plan, blocks: (plan.blocks || []).filter(b => b.taskId !== task.id) };
    }
    setDailyPlans(next);
    try {
      await saveDailyPlans(next);
      queryClient.setQueryData(qk.dailyPlans(), next);
      pushUndo({
        label: 'Rimandata',
        undo: async () => {
          setDailyPlans(previous);
          await saveDailyPlans(previous);
          queryClient.setQueryData(qk.dailyPlans(), previous);
        },
      });
    } catch (e) {
      // Lo stato locale torna indietro: senza avviso la card sarebbe rimasta
      // fuori dalle programmate a schermo, e programmata su OneDrive.
      setDailyPlans(previous);
      notifyError(`Non ho potuto rimandare "${task.title}": il piano non è stato salvato.`, e);
    }
  }

  // Completare un'azione da Oggi tocca due cose: il task su To-Do e il blocco
  // nel piano del giorno. Il blocco va segnato comunque — è lo storico della
  // giornata, e serve al Diario — anche se il task nel frattempo non esiste
  // più su Graph (cancellato dal telefono, per dire).
  async function handleCompleteBlock(block) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const previous = dailyPlans;
    const plan = dailyPlans?.[dateStr];
    if (!plan) return;

    const next = {
      ...dailyPlans,
      [dateStr]: {
        ...plan,
        blocks: (plan.blocks || []).map(b =>
          b.id === block.id ? { ...b, completed: true, completedAt: new Date().toISOString() } : b
        ),
      },
    };
    setDailyPlans(next);

    try {
      if (block.taskId && block.listId) {
        await completeTask(block.listId, block.taskId);
        handleTaskRemoved(block.listId, block.taskId);
      }
    } catch (e) {
      // Il blocco resta segnato — è lo storico della giornata — ma l'attività su
      // To-Do no, e va detto: altrimenti resta aperta sul telefono senza motivo
      // apparente.
      notifyError(`"${block.taskTitle}" è segnata nel piano di oggi, ma non sono riuscito a spuntarla su To-Do.`, e);
    }

    try {
      await saveDailyPlans(next);
      queryClient.setQueryData(qk.dailyPlans(), next);
    } catch (e) {
      setDailyPlans(previous);
      notifyError('Non ho potuto salvare il piano di oggi: la spunta non è stata registrata.', e);
    }
  }

  // «Aggiorna tutto» non svuota più lo schermo prima di ricaricare: azzerare
  // taccuini, sezioni e attività faceva sparire tutta l'interfaccia per i
  // secondi del ricaricamento, per poi rimettere quasi sempre le stesse cose.
  // I dati vecchi restano visibili e vengono sostituiti man mano che arrivano —
  // il pallino della sincronizzazione dice già che si sta aggiornando.
  async function handleRefresh() {
    setSelected(null);
    await load(true);
  }

  if (!ready) return null;

  if (!account) {
    return (
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
          {/* Diceva «Solo permessi di lettura · nessun dato salvato», che non è
              vero da parecchie versioni: l'app scrive attività su To-Do e i suoi
              file (piani, diario, impostazioni) nella cartella
              `mente-digitale/` del tuo OneDrive. Vero è invece che non esiste
              nessun server nostro in mezzo — il browser parla direttamente con
              Microsoft. Meglio dirlo giusto: è l'unica frase che si legge prima
              di dare il consenso. */}
          <div className="login-note">
            I dati restano sul tuo account Microsoft · nessun server nostro in mezzo
          </div>
        </div>
      </div>
    );
  }

  // La vista Mappa è l'unica a cui serva il commutatore taccuini/PARA: tenerlo
  // sempre in topbar lo renderebbe un comando che per cinque viste su sei non
  // fa niente di visibile.
  const onMap = location.pathname.startsWith('/mappa');

  const topbar = (
    <>
      {/* Lo stato della sincronizzazione va anche detto, non solo colorato: da
          telefono l'etichetta è nascosta dal CSS e resta il solo pallino, che
          un lettore di schermo non sa leggere. */}
      <div className="sync-status" title={sync.label} role="status" aria-live="polite">
        <span className={`sync-dot ${sync.state}`} aria-hidden="true" />
        <span className="sync-label-text">{sync.label}</span>
        <span className="sr-only">Sincronizzazione: {sync.label}</span>
      </div>
      {onMap && (
        <div className="map-view-toggle">
          <button className={mapViewMode === 'workbook' ? 'active' : ''} onClick={() => setMapViewMode('workbook')} title="Vista per taccuino">Taccuini</button>
          <button className={mapViewMode === 'para' ? 'active' : ''} onClick={() => setMapViewMode('para')} title="Vista PARA">PARA</button>
        </div>
      )}
      <div className="bell-wrap">
        <button
          className={`search-btn tap-44${reviewOpen ? ' active' : ''}${reviewSuggestions.length ? ' has-badge' : ''}`}
          onClick={() => setReviewOpen(o => !o)}
          aria-expanded={reviewOpen}
          aria-label={reviewSuggestions.length
            ? `Proposte Daily Review: ${reviewSuggestions.length}`
            : 'Proposte Daily Review'}
          title="Proposte Daily Review">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {reviewSuggestions.length > 0 && <span className="header-badge">{reviewSuggestions.length}</span>}
        </button>
        {reviewOpen && (
          <div className="bell-dropdown">
            <div className="bell-dropdown-header">
              <span>Daily Review</span>
              <button onClick={() => setReviewOpen(false)} aria-label="Chiudi le proposte">✕</button>
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
      <button className="search-btn tap-44" onClick={() => setSearchOpen(true)} title="Cerca (⌘K)" aria-label="Cerca (⌘K)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>
      <button
        className={`search-btn tap-44${sync.state === 'loading' ? ' spinning' : ''}`}
        onClick={handleRefresh}
        disabled={sync.state === 'loading'}
        title="Aggiorna tutto"
        aria-label="Aggiorna tutto">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
          <polyline points="20.5 4 20.5 9 15.5 9" />
        </svg>
      </button>
    </>
  );

  return (
    <>
      <AppShell
        topbar={topbar}
        onCapture={() => setCaptureOpen(true)}
        onOpenSettings={() => setColorSettingsOpen(true)}>
        {/* Un solo confine di attesa per tutte le rotte caricate a pezzi: il
            velo compare al posto del contenuto, la shell (menù, topbar, barra
            Pomodoro) non si smonta mai. */}
        <Suspense fallback={<ViewFallback />}>
        <Routes>
          <Route path="/oggi" element={
            <TodayView
              plans={dailyPlans}
              tasks={scheduledTasks || []}
              calendarEvents={sectionCalendarEvents}
              loading={scheduledTasks === null}
              calendarLoading={!calendarLoaded}
              onCompleteBlock={handleCompleteBlock}
            />
          } />

          <Route path="/piano" element={
            <PlannerView
              open
              onClose={() => navigate('/oggi')}
              preloadedTasks={scheduledTasks || []}
              notebooks={notebooks}
              sectionsMap={sectionsMap}
              pagesCache={pagesCache}
              autoAddTask={pendingPlannerTask}
              onAutoAdded={() => setPendingPlannerTask(null)}
              onTaskCompleted={handleTaskRemoved}
              onTaskDeleted={handleTaskRemoved}
              onTaskRenamed={(listId, taskId, title) => handleTaskPatched(listId, taskId, { title })}
              onTaskDueChanged={(listId, taskId, dueDateTime) => handleTaskPatched(listId, taskId, { dueDateTime })}
              onTaskPatched={handleTaskPatched}
              onTaskRestored={handleTaskRestored}
              onStartFocus={handleStartPomodoroFocus}
              onEndFocus={handleEndPomodoroFocus}
              calendarDirtyToken={calendarDirtyToken}
            />
          } />

          <Route path="/attivita" element={
            <ActivityBoard
              tasks={scheduledTasks || []}
              todoLists={todoLists}
              plans={dailyPlans}
              config={plannerConfig}
              loading={scheduledTasks === null}
              notebooks={notebooks}
              sectionsMap={sectionsMap}
              pagesCache={pagesCache}
              onClarify={task => { setClarifyTask(task); setGtdSeedText(task.title || ''); setGtdOpen(true); }}
              onChangeStatus={handleChangeTaskStatus}
              onSchedule={handleScheduleTask}
              onUnschedule={handleUnscheduleTask}
              onTaskRemoved={handleTaskRemoved}
              onTaskPatched={handleTaskPatched}
              onTaskRestored={handleTaskRestored}
            />
          } />

          <Route path="/sezioni/:sectionId?" element={
            <SectionsView
              notebooks={notebooks}
              sectionsMap={sectionsMap}
              todoListsMap={todoListsMap}
              tasks={scheduledTasks || []}
              pagesCache={pagesCache}
              onTaskRemoved={handleTaskRemoved}
              onTaskPatched={handleTaskPatched}
              onTaskRestored={handleTaskRestored}
            />
          } />

          <Route path="/diario" element={<DiaryPanel />} />

          {/* Finanze porta con sé recharts e sette pagine di tabelle: mezzo
              megabyte che non deve pesare sull'avvio di «Oggi», visto che è la
              sezione in cui si entra qualche volta al mese. Caricata alla prima
              visita e poi in cache come ogni chunk. */}
          <Route path="/finanze/:sezione?" element={<FinanzeSection />} />

          <Route path="/mappa" element={
            <div className="canvas-area">
              <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(null)} />
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
            </div>
          } />

          <Route path="*" element={<Navigate to="/oggi" replace />} />
        </Routes>
        </Suspense>
      </AppShell>

      {/* Pannello sezione (ToDo/OneNote/OneDrive) — fisso rispetto al
          viewport, non alla rotta corrente, così resta aperto anche
          cambiando vista. Sparisce quando arriverà /sezioni/:id. */}
      <Panel
        selected={selected}
        pagesCache={pagesCache}
        tasksCache={tasksCache}
        calendarEvents={sectionCalendarEvents}
        onClose={() => setSelected(null)}
      />
      <QuickCapture
        open={captureOpen}
        todoLists={todoLists}
        onClose={() => setCaptureOpen(false)}
        onCaptured={task => setScheduledTasks(prev => [...(prev || []), task])}
        onDecideNow={text => { setGtdSeedText(text); setGtdOpen(true); }}
      />
      <GtdClarifyModal
        open={gtdOpen}
        onClose={() => { setGtdOpen(false); setGtdSeedText(''); setClarifyTask(null); }}
        seedText={gtdSeedText}
        sourceTask={clarifyTask}
        todoLists={todoLists}
        notebooks={notebooks}
        sectionsMap={sectionsMap}
        onTaskCreated={(task, { addToday }) => {
          setScheduledTasks(prev => [...(prev || []), task]);
          if (addToday) { setPendingPlannerTask(task); navigate('/piano'); }
        }}
        onTaskRemoved={handleTaskRemoved}
        onEventCreated={event => {
          setSectionCalendarEvents(prev => [...(prev || []), event]);
          setCalendarDirtyToken(t => t + 1);
        }}
        onEventRemoved={eventId => {
          setSectionCalendarEvents(prev => (prev || []).filter(e => e.id !== eventId));
          setCalendarDirtyToken(t => t + 1);
        }}
      />
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        notebooks={notebooks}
        sectionsMap={sectionsMap}
        pagesCache={pagesCache}
        tasks={scheduledTasks || []}
        onSelectSection={(sec, nb, app) => { navigate('/mappa'); handleSelectSection(sec, nb, app); }}
      />
      {/* Montata solo quando serve: è l'unica modale a stare in un chunk a
          parte, e senza il montaggio condizionato il chunk verrebbe scaricato
          all'avvio come prima. */}
      {colorSettingsOpen && (
        <Suspense fallback={null}>
          <ColorSettingsModal
            open
            onClose={() => setColorSettingsOpen(false)}
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            overrides={colorSettings}
            onExpandNotebook={handleExpandNotebook}
            onSetNotebookColor={setNotebookColor}
            onSetSectionColor={setSectionColor}
            onResetNotebookColor={resetNotebookColor}
            onResetSectionColor={resetSectionColor}
          />
        </Suspense>
      )}
      <UndoToast />
      <Toaster />
    </>
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
        <button className="bell-dismiss-btn" onClick={() => onDismiss(suggestion)} aria-label="Scarta questa proposta" title="Scarta">✕</button>
      </div>
    </div>
  );
}
