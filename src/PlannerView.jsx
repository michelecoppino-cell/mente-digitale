import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from 'react';
import {
  loadDailyPlans, saveDailyPlans,
  loadPlannerConfig, savePlannerConfig,
  completeTask, updateTaskStatus, getCalendarEvents, getCalendars, updateCalendarColor,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, moveCalendarEvent,
  patchCalendarEvent, graphDateTime,
  getTask, createTask, updateTaskBody, updateTaskTitle, updateTaskDueDate, deleteTask,
  createChecklistItem, updateChecklistItem, renameChecklistItem, deleteChecklistItem,
  reorderChecklistItems, loadPomodoroStats, savePomodoroStats,
  loadWorkbooks, saveWorkbooks, getWorkbookCalendarId, getWorkbookEvents, WORKBOOK_CALENDAR_NAME,
  loadIdealWeek, saveIdealWeek,
} from './api';
import { cacheGet, cacheSet, cacheDel } from './cache';
import Skeleton from './Skeleton';
import PomodoroTimer from './PomodoroTimer';
import TaskPool from './TaskPool';
import WorkbookPool from './WorkbookPool';
import SectionResources from './SectionResources';
import { DEFAULT_CONFIG, findProject, shadeColor, hexToRgba } from './plannerShared';
import { pushUndo } from './undo';
import './PlannerView.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const SLOT_HEIGHT      = 32;  // px per 30-min slot (32 → ~12h visible at once)
const DEFAULT_DURATION = 60;  // minutes for newly dropped tasks
const SAVE_DEBOUNCE    = 2000;
const PLANS_CACHE_TTL  = 5 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function t2m(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function m2t(min) {
  return `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`;
}
function slots(start, end) {
  const out = [];
  let cur = t2m(start);
  while (cur < t2m(end)) { out.push(m2t(cur)); cur += 30; }
  return out;
}
// Sotto questa durata un blocco resta nel layout orizzontale classico (non
// c'è spazio per ruotare il titolo); oltre, passa al layout verticale (vedi
// .vertical-layout in PlannerView.css): etichetta a sx (sezione + titolo
// ruotati), resto del blocco libero per sottostep/note.
const VERTICAL_LAYOUT_MIN_DURATION = 60; // minuti
const VERTICAL_TITLE_MIN_FONT      = 10; // px, limite inferiore di leggibilità
// Spazio riservato in basso nella colonna etichetta per l'etichetta di durata
// (linea di separazione + testo ruotato) — va sottratto all'altezza
// disponibile per il titolo, come già si fa per il nome sezione in alto.
const VERTICAL_DURATION_RESERVE_PX = 24;
const VERTICAL_TITLE_CHAR_FACTOR   = 0.66; // ingombro medio per carattere (stima empirica, Outfit semi-bold)
// Calcola dimensione del font e numero di righe (1 o 2) del titolo ruotato in
// verticale: prova prima una riga alla dimensione base, poi due righe alla
// dimensione base, e solo se non basta riduce il font (fino al minimo) su
// due righe — così un titolo lungo può andare a capo invece di rimpicciolirsi
// oltre il leggibile.
function verticalTitleLayout(title, availableHeight, baseFontSize) {
  const len = (title || '').length || 1;
  if (len * VERTICAL_TITLE_CHAR_FACTOR * baseFontSize <= availableHeight) {
    return { fontSize: baseFontSize, lines: 1 };
  }
  const perLine = Math.ceil(len / 2);
  if (perLine * VERTICAL_TITLE_CHAR_FACTOR * baseFontSize <= availableHeight) {
    return { fontSize: baseFontSize, lines: 2 };
  }
  const fitFontSize = availableHeight / (perLine * VERTICAL_TITLE_CHAR_FACTOR);
  return { fontSize: Math.max(VERTICAL_TITLE_MIN_FONT, fitFontSize), lines: 2 };
}
// Graph restituisce il colore del calendario come enum (es. "lightBlue",
// "auto"), non un hex CSS: mappiamo i preset noti per il pallino colorato.
const GRAPH_CAL_COLORS = {
  lightBlue: '#7eb8c9', lightGreen: '#8fbf7f', lightOrange: '#e0a05e',
  lightGray: '#a0a0a0', lightYellow: '#e6c94d', lightTeal: '#6fbfae',
  lightPink: '#d98fb3', lightBrown: '#a9825a', lightRed: '#d97a7a',
  maxColor: '#c084a0',
};
function calendarSwatch(colorEnum) {
  return GRAPH_CAL_COLORS[colorEnum] || '#888888';
}
// Ordine di presentazione degli enum colore Graph nei color-picker dei
// calendari — 'auto' per primo per rappresentare "nessun colore personalizzato".
const GRAPH_CAL_COLOR_OPTIONS = ['auto', ...Object.keys(GRAPH_CAL_COLORS)];

// Voce sintetica aggiunta alla lista "Calendari ▾" per poter spegnere/accendere
// tutti i blocchi Workbook come se fossero un calendario in più — non
// corrisponde a nessun calendario Graph, quindi non tocca mai filterCalEvents.
const WORKBOOK_CAL_ID = '__workbook__';

// Colore "vivo" di un blocco Workbook piazzato in griglia: il blocco nasce con
// colore/etichetta denormalizzati al momento del drop (vedi makeWorkbookBlock),
// ma il colore deve continuare a seguire il nodo Workbook/Sub-workbook se
// l'utente lo ricolora in seguito — si ricade sul valore denormalizzato solo
// se il nodo è stato nel frattempo eliminato.
function liveWorkbookColor(block, workbooksList) {
  const wb = workbooksList.find(w => w.id === block.workbookId);
  if (!wb) return block.color;
  if (block.subWorkbookId) {
    const sub = wb.subWorkbooks.find(s => s.id === block.subWorkbookId);
    return sub?.color ?? block.color;
  }
  return wb.color ?? block.color;
}
// La griglia della timeline copre sempre l'intera giornata (scorrimento libero
// con la rotella): il workday configurato serve solo a posizionare lo scroll
// iniziale su Giorno e Settimana, non più a limitare cosa viene disegnato.
const DAY_START_MIN  = 0;
const DAY_END_MIN    = 24 * 60;
const FULL_DAY_SLOTS = slots('00:00', '24:00');

// Posizione di scroll con cui la timeline (Giorno o Settimana) si apre di
// default: l'inizio dell'orario di lavoro configurato, spinta ulteriormente
// verso il basso se "adesso" è già più avanti nella giornata.
function defaultScrollOffset(workStartMin) {
  const workStartPx  = workStartMin / 30 * SLOT_HEIGHT;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const extra = Math.max(0, (cur - workStartMin) / 30 * SLOT_HEIGHT - 80);
  return workStartPx + extra;
}
// Data in formato YYYY-MM-DD nel fuso orario locale (toISOString darebbe UTC)
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() {
  return localDateStr(new Date());
}
function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function isoToHHMM(iso) {
  if (!iso) return null;
  if (!iso.includes('T')) return iso.slice(0, 5);
  // Graph restituisce dateTime in UTC senza suffisso 'Z': senza forzarlo,
  // new Date() lo interpreterebbe come ora locale (evento anticipato di 1-2h).
  const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  const d = new Date(hasTZ ? iso : iso + 'Z');
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
// Stesso "UTC finto" di isoToHHMM ma per la data: il giorno di calendario di
// un dateTime Graph va calcolato nel fuso locale, non tagliando il prefisso
// UTC grezzo (che per orari mattutini può risultare nel giorno prima).
function isoToLocalDateStr(iso) {
  if (!iso) return null;
  const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  return localDateStr(new Date(hasTZ ? iso : iso + 'Z'));
}
function isAllDay(ev) {
  return ev.isAllDay || (!ev.start?.dateTime && !!ev.start?.date);
}
// Totale di giornata nell'header della colonna Timeline — formato ore:minuti.
function fmtFocusTotal(min) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
// Durata di un blocco/evento in layout verticale, mostrata in basso nella
// colonna etichetta — formato compatto "2h" oppure "2h30" senza minuti a zero.
function fmtBlockDuration(min) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}
const SESSION_TYPE_LABELS = {
  focus: 'concentrato',
  personal: 'pausa personale',
  office: 'interruzione ufficio',
  client: 'interruzione cliente',
};
const FOCUS_SESSION_TYPES = ['focus', 'personal', 'office', 'client'];
// Durata di default di una fascia aggiunta a mano, per tipo — un pomodoro
// intero per il lavoro, una pausa breve per le interruzioni.
const FOCUS_ADD_DURATION = { focus: 25, personal: 5, office: 5, client: 5 };

// Converte "minuti dalla mezzanotte" (fuso locale) di un giorno in un
// dateTime ISO in UTC — coerente col formato già salvato da
// PomodoroTimer.jsx (new Date(...).toISOString()).
function dateTimeFromMinutes(dayStr, min) {
  const d = new Date(dayStr + 'T00:00:00');
  d.setMinutes(min);
  return d.toISOString();
}

// Riscrive la lista di sessioni pomodoro di un giorno sul file OneDrive,
// ricaricando prima lo stato più recente per non perdere modifiche
// concorrenti fatte da altre schede/dispositivi.
async function persistPomodoroSessions(day, sessions) {
  try {
    const stats = await loadPomodoroStats();
    const prevDay = stats[day] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
    stats[day] = { ...prevDay, sessions };
    await savePomodoroStats(stats);
  } catch (e) { console.error('persist pomodoro sessions', e); }
}
function getWeekDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return localDateStr(day);
  });
}

// Titolo ruotato (writing-mode verticale) di un blocco "alto" — usato nella
// colonna etichetta a sx di task/eventi/workbook. `layout` arriva da
// verticalTitleLayout: su 2 righe passa da nowrap a wrap naturale, limitando
// la larghezza a due righe di testo verticale.
function VerticalTitle({ text, layout, className }) {
  if (!layout) return <span className={className}>{text}</span>;
  return (
    <span
      className={className}
      style={{
        fontSize: layout.fontSize,
        whiteSpace: layout.lines === 2 ? 'normal' : 'nowrap',
        width: layout.lines === 2 ? Math.ceil(layout.fontSize * 2.6) : undefined,
      }}>
      {text}
    </span>
  );
}

// ── Main PlannerView ──────────────────────────────────────────────────────────
export default function PlannerView({
  open, onClose, preloadedTasks = [], notebooks = [], sectionsMap = {}, pagesCache = null, autoAddTask = null, onAutoAdded,
  onTaskCompleted, onTaskDeleted, onTaskRenamed, onTaskDueChanged, onTaskRestored,
  onStartFocus, onEndFocus, calendarDirtyToken = 0,
}) {
  const [currentDate, setCurrentDate]       = useState(todayStr);
  const [plans, setPlans]                   = useState({});
  const [config, setConfig]                 = useState(DEFAULT_CONFIG);
  const [todayPlan, setTodayPlan]           = useState({ date: todayStr(), blocks: [], emailExtractedActions: [] });
  const [calEvents, setCalEvents]           = useState([]);
  const [pomodoroStatsMap, setPomodoroStatsMap] = useState({});
  // Il Pomodoro è solo un indicatore di concentrazione, scollegato da
  // qualunque task/blocco: si avvia/ferma dal pulsante volante, non da un
  // task specifico.
  const [pomodoroActive, setPomodoroActive] = useState(false);
  const [pomodoroRunning, setPomodoroRunning] = useState(true);
  // Fascia oraria ancora aperta (non persistita) del Pomodoro in corso —
  // usata per disegnare nella colonna Timeline la barra che cresce live
  // verso "adesso", invece di apparire solo a fascia chiusa.
  const [activeInterval, setActiveInterval] = useState(null); // { start, type } | null
  // Orologio che avanza ogni 15s: fa crescere la barra live e sposta la
  // linea ocra dell'ora corrente.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Bloccata solo mentre il Pomodoro è effettivamente in corso (non in pausa):
  // premere "Pausa" riporta alla normale modalità Piano, sbloccata.
  const locked = pomodoroActive && pomodoroRunning;
  const [saveStatus, setSaveStatus]         = useState('idle');
  const [breakdownModal, setBreakdownModal] = useState(null);
  const [dragOverTime, setDragOverTime]     = useState(null);
  const [viewMode, setViewMode]             = useState('day');
  const [resizingId, setResizingId]         = useState(null);
  // Analogo al resizingWbId locale di WeeklyTimeline: disattiva il draggable
  // del blocco Workbook mentre se ne trascina il bordo inferiore in vista Giorno.
  const [dayResizingWbId, setDayResizingWbId] = useState(null);
  const [selectedTask, setSelectedTask]     = useState(null);
  const [poolWidth, setPoolWidth]           = useState(560);
  const [weekPoolWidth, setWeekPoolWidth]   = useState(280); // metà della larghezza di default del pool in vista Giorno
  const [aiWidth, setAiWidth]               = useState(560);
  const [calOutOfRange, setCalOutOfRange]   = useState(false);
  const [mobileTab, setMobileTab]           = useState('timeline'); // colonna visibile su schermi stretti
  const [calendarsList, setCalendarsList]   = useState([]);
  const [calFilterOpen, setCalFilterOpen]   = useState(false);
  const [calColorPickerFor, setCalColorPickerFor] = useState(null); // id del calendario con lo swatch colori aperto
  const [calModal, setCalModal]             = useState(null); // { mode: 'create'|'edit', event }
  // Popup di modifica/aggiunta di una fascia della colonna Pomodoro —
  // { mode: 'edit', idx, x, y } oppure { mode: 'add', startMin, x, y }.
  const [focusPopup, setFocusPopup]         = useState(null);

  // ── Workbook (pianificazione settimanale "a spettro ampio") ──
  // Stato del tutto parallelo/indipendente da quello dei task/blocchi sopra:
  // file OneDrive dedicati, proprio debounce di salvataggio — non condivide
  // nulla con plansRef/saveTimerRef per non rischiare regressioni sul flusso
  // task già in produzione.
  const [poolMode, setPoolMode]             = useState('task'); // 'task' | 'workbook'
  const [workbooks, setWorkbooks]           = useState([]);
  const [workbookPlans, setWorkbookPlans]   = useState({});
  const [idealWeek, setIdealWeek]           = useState(null); // { blocks: [] } | null

  const timelineBodyRef  = useRef(null);
  const saveTimerRef     = useRef(null);
  const plansRef         = useRef({});
  const configRef        = useRef(DEFAULT_CONFIG);
  // Diventano true solo quando il rispettivo load da OneDrive è riuscito
  // (anche con file inesistente: il 404 è uno stato valido, vedi api.js).
  // Finché sono false qualunque salvataggio remoto viene saltato: scrivere
  // partendo da uno stato vuoto per colpa di un errore transitorio avrebbe
  // sovrascritto il file remoto cancellando lo storico.
  const plansLoadedRef   = useRef(false);
  const configLoadedRef  = useRef(false);
  const resizingRef      = useRef(null);
  const subResizingRef   = useRef(null);
  const focusDragRef     = useRef(null);
  // Un vero trascinamento (resize blocco/fascia, ridimensiona pannello…) può
  // terminare con un mouseup sopra lo sfondo vuoto della Timeline, generando
  // un click nativo lì: questo flag lo fa ignorare invece di aprire "Nuovo
  // evento" per sbaglio. Si autoresetta dopo un istante nel caso quel click
  // fantasma non arrivi mai a consumarlo (es. finisce fuori dalla Timeline),
  // per non silenziare a tempo indeterminato un clic genuino successivo.
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef(null);
  function markDragSuppressClick() {
    suppressClickRef.current = true;
    clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 300);
  }
  const allCalEventsRef  = useRef([]);
  const currentDateRef   = useRef(currentDate);
  currentDateRef.current = currentDate;
  // Specchi sempre aggiornati dello stato, per leggerne il valore corrente da
  // callback di mouseup/drag senza infilare side-effect negli updater di
  // setState (che in StrictMode girano due volte).
  const todayPlanRef     = useRef(todayPlan);
  todayPlanRef.current   = todayPlan;
  const pomodoroStatsRef = useRef(pomodoroStatsMap);
  pomodoroStatsRef.current = pomodoroStatsMap;

  const workbooksRef           = useRef([]);
  const workbooksLoadedRef     = useRef(false);
  const workbookPlansRef       = useRef({});
  const workbookCalIdRef       = useRef(null);
  const allWorkbookEventsRef   = useRef([]);
  const workbookSyncTimersRef  = useRef({}); // blockId -> timeoutId, per resize/nota in drag continuo
  const idealWeekRef           = useRef(null);

  // ── Load config + plans once on open; scroll to now ─────────────────────────
  useEffect(() => {
    if (!open) return;
    Promise.all([
      initConfig(), initPlans(), initPomodoroStats(), initCalendarsList(),
      initWorkbooks(), initWorkbookCalendar(), initIdealWeek(),
    ]);
    requestAnimationFrame(() => {
      if (!timelineBodyRef.current) return;
      timelineBodyRef.current.scrollTop = defaultScrollOffset(t2m(configRef.current.workdayStart));
    });
  }, [open]); // eslint-disable-line

  // ── Fetch bulk cal events once, then filter locally on every date/view change ─
  useEffect(() => {
    if (!open) return;
    fetchCalEventsAll();
    fetchWorkbookEventsAll();
  }, [open, currentDate, viewMode]); // eslint-disable-line

  // Un evento calendario creato altrove nell'app (es. dal popup GTD) bypassa
  // questo componente: quando il token cambia, la cache bulk va invalidata e
  // rifetchata, altrimenti resterebbe silenziosamente stale fino al TTL.
  const calendarDirtyTokenRef = useRef(calendarDirtyToken);
  useEffect(() => {
    if (calendarDirtyToken === calendarDirtyTokenRef.current) return;
    calendarDirtyTokenRef.current = calendarDirtyToken;
    refreshCalEvents();
  }, [calendarDirtyToken]); // eslint-disable-line

  // Sync todayPlan when the user navigates to a different date
  useEffect(() => {
    if (!open) return;
    setTodayPlan(plansRef.current[currentDate] || { date: currentDate, blocks: [], emailExtractedActions: [] });
  }, [currentDate]); // eslint-disable-line

  // Aggiunge automaticamente un task catturato da GTD al piano di oggi, una tantum
  useEffect(() => {
    if (!open || !autoAddTask) return;
    addBlock(autoAddTask, configRef.current.workdayStart);
    onAutoAdded?.();
  }, [open, autoAddTask]); // eslint-disable-line

  // Fa avanzare la linea dell'ora corrente e la barra live del Pomodoro.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, [open]);

  async function initConfig() {
    try {
      const cached = cacheGet('planner_config');
      const cfg = cached || await loadPlannerConfig();
      if (cfg) { setConfig(cfg); configRef.current = cfg; }
      if (!cached && cfg) cacheSet('planner_config', cfg, 30 * 60 * 1000);
      configLoadedRef.current = true;
    } catch (e) { console.error('planner config load', e); }
  }

  async function initPlans() {
    try {
      const cached = cacheGet('daily_plans');
      const allPlans = cached || await loadDailyPlans() || {};
      setPlans(allPlans);
      plansRef.current = allPlans;
      plansLoadedRef.current = true;
      if (!cached) cacheSet('daily_plans', allPlans, PLANS_CACHE_TTL);

      const dayPlan = allPlans[currentDate] || { date: currentDate, blocks: [], emailExtractedActions: [] };
      setTodayPlan(dayPlan);

    } catch (e) {
      console.error('planner plans load', e);
      setSaveStatus('error');
    }
  }

  // Statistiche giornaliere Pomodoro (minuti concentrati) — mostrate come
  // colonna a sx delle ore e totale nell'header della Timeline.
  async function initPomodoroStats() {
    try {
      const stats = await loadPomodoroStats();
      setPomodoroStatsMap(stats || {});
    } catch (e) { console.error('pomodoro stats load', e); }
  }

  async function initWorkbooks() {
    try {
      const cached = cacheGet('workbooks');
      const data = cached || await loadWorkbooks();
      const list = data?.workbooks || [];
      setWorkbooks(list);
      workbooksRef.current = list;
      workbooksLoadedRef.current = true;
      if (!cached && data) cacheSet('workbooks', data, 30 * 60 * 1000);
    } catch (e) { console.error('workbooks load', e); }
  }

  async function initWorkbookCalendar() {
    try {
      workbookCalIdRef.current = await getWorkbookCalendarId();
    } catch (e) { console.error('workbook calendar init', e); }
  }

  // Outlook/Graph normalizza spesso un body creato con contentType 'text' in
  // HTML alla lettura (tag + entity &quot;/&amp;…): senza ripulirlo prima del
  // parse, il JSON dei metadati risulterebbe illeggibile e i blocchi
  // perderebbero colore/collegamento al nodo Workbook.
  function decodeEventMetaContent(raw) {
    if (!raw) return '{}';
    let text = raw;
    if (/<[a-z][\s\S]*>/i.test(text)) text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return text.trim();
  }

  // Converte un evento Graph del calendario Workbook nel blocco usato dal
  // rendering — stessa forma di prima (id, workbookId, subWorkbookId, label,
  // color, startTime, endTime, notes), solo che ora arriva da Graph invece che
  // dal JSON: workbookId/subWorkbookId/colore/note sono serializzati nel body
  // (vedi workbookEventBody), il subject resta l'etichetta leggibile.
  function parseWorkbookEvent(ev) {
    let meta = {};
    try { meta = JSON.parse(decodeEventMetaContent(ev.body?.content)); } catch { meta = {}; }
    let workbookId    = meta.workbookId ?? null;
    let subWorkbookId = meta.subWorkbookId ?? null;
    // Se il body non è sopravvissuto integro al giro su Graph (o manca del
    // tutto nella risposta), recupera i riferimenti al nodo dal subject
    // "Workbook · Sub-workbook" — l'unico campo che Graph non altera mai —
    // così il colore torna a seguire il nodo live invece di restare grigio.
    const knownWb = workbookId && workbooksRef.current.find(w => w.id === workbookId);
    if (!knownWb) {
      const [wbName, subName] = (ev.subject || '').split(' · ').map(s => s?.trim());
      const wb = wbName ? workbooksRef.current.find(w => w.name === wbName) : null;
      if (wb) {
        workbookId = wb.id;
        const sub = subName ? wb.subWorkbooks.find(s => s.name === subName) : null;
        subWorkbookId = sub ? sub.id : null;
      }
    }
    // Un blocco che finisce a fine giornata è salvato su Graph come "00:00
    // del giorno dopo" (vedi graphDateTime/localToUtcDateTime): isoToHHMM
    // legge solo ore/minuti e perde il cambio di giorno, restituendo "00:00"
    // — che letto alla lettera precede lo startTime e schiaccia la durata a
    // zero/negativa. Se il giorno locale dell'evento finale è successivo a
    // quello iniziale, va reinterpretato come "24:00" (il sentinel di fine
    // giornata usato internamente, vedi DAY_END_MIN), non come mezzanotte.
    const startDay = isoToLocalDateStr(ev.start?.dateTime);
    const endDay   = isoToLocalDateStr(ev.end?.dateTime);
    const endTime  = (endDay && startDay && endDay !== startDay) ? '24:00' : isoToHHMM(ev.end?.dateTime);
    return {
      id: ev.id,
      workbookId, subWorkbookId,
      label: ev.subject || '',
      color: meta.color || '#888',
      startTime: isoToHHMM(ev.start?.dateTime),
      endTime,
      notes: Array.isArray(meta.notes) ? meta.notes : [],
    };
  }

  function workbookEventBody(block) {
    return JSON.stringify({
      workbookId: block.workbookId, subWorkbookId: block.subWorkbookId,
      color: block.color, notes: block.notes || [],
    });
  }

  // Fetch bulk (±3 mesi) degli eventi del calendario Workbook, mirror esatto
  // di fetchCalEventsAll/filterCalEvents sopra ma su un solo calendario
  // dedicato — stesso pattern cache in-memory → cache sessione → Graph.
  async function fetchWorkbookEventsAll() {
    const WB_BULK_KEY = 'workbook_events_bulk';
    const WB_MONTHS   = 3;

    if (allWorkbookEventsRef.current.length > 0) {
      filterWorkbookEvents(allWorkbookEventsRef.current);
      return;
    }
    const cached = cacheGet(WB_BULK_KEY);
    if (cached) {
      allWorkbookEventsRef.current = cached;
      filterWorkbookEvents(cached);
      return;
    }
    try {
      if (!workbookCalIdRef.current) await initWorkbookCalendar();
      if (!workbookCalIdRef.current) { filterWorkbookEvents([]); return; }
      const today = new Date();
      const start = new Date(today); start.setMonth(today.getMonth() - WB_MONTHS); start.setHours(0,0,0,0);
      const end   = new Date(today); end.setMonth(today.getMonth() + WB_MONTHS);   end.setHours(23,59,59,999);
      const evs = await getWorkbookEvents(workbookCalIdRef.current, start, end, 500);
      allWorkbookEventsRef.current = evs;
      cacheSet(WB_BULK_KEY, evs, 30 * 60 * 1000);
      filterWorkbookEvents(evs);
    } catch (e) {
      console.error('workbook events bulk load', e);
      filterWorkbookEvents([]);
    }
  }

  // Raggruppa gli eventi Graph per giorno nella finestra attualmente
  // visualizzata (stessa logica viewStart/viewEnd di filterCalEvents).
  function filterWorkbookEvents(allEvs) {
    const WB_MONTHS = 3;
    const today     = new Date();
    const minDate   = new Date(today); minDate.setMonth(today.getMonth() - WB_MONTHS);
    const maxDate   = new Date(today); maxDate.setMonth(today.getMonth() + WB_MONTHS);
    const viewDate  = new Date(currentDate + 'T12:00:00');
    if (viewDate < minDate || viewDate > maxDate) {
      workbookPlansRef.current = {};
      setWorkbookPlans({});
      return;
    }

    let viewStart, viewEnd;
    if (viewMode === 'week') {
      const wd = getWeekDays(currentDate);
      viewStart = wd[0]; viewEnd = wd[6];
    } else if (viewMode === 'month') {
      const d = new Date(currentDate + 'T12:00:00');
      viewStart = localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
      viewEnd   = localDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    } else {
      viewStart = currentDate; viewEnd = currentDate;
    }

    const grouped = {};
    allEvs.forEach(ev => {
      // Il prefisso data di start.dateTime è in UTC (vedi graphDateTime): per
      // orari mattutini con fuso avanti su UTC (es. Italia +1/+2) tagliare i
      // primi 10 caratteri può restituire il giorno PRECEDENTE a quello
      // locale in cui il blocco è stato effettivamente piazzato — lo stesso
      // trucco "UTC finto" già usato da isoToHHMM per l'ora va applicato
      // anche qui per il giorno, o un blocco creato la mattina presto
      // sembrerebbe "spostarsi" al giorno prima al refetch successivo.
      const day = ev.start?.dateTime ? isoToLocalDateStr(ev.start.dateTime) : (ev.start?.date || '').slice(0, 10);
      if (day < viewStart || day > viewEnd) return;
      const dayPlan = grouped[day] || { date: day, blocks: [] };
      dayPlan.blocks.push(parseWorkbookEvent(ev));
      grouped[day] = dayPlan;
    });
    workbookPlansRef.current = grouped;
    setWorkbookPlans(grouped);
  }

  // Forza un refetch dal server dopo una modifica ai blocchi Workbook.
  async function refreshWorkbookEvents() {
    allWorkbookEventsRef.current = [];
    cacheDel('workbook_events_bulk');
    await fetchWorkbookEventsAll();
  }

  async function initIdealWeek() {
    try {
      const cached = cacheGet('ideal_week');
      const template = cached || await loadIdealWeek();
      setIdealWeek(template);
      idealWeekRef.current = template;
      if (!cached && template) cacheSet('ideal_week', template, 30 * 60 * 1000);
    } catch (e) { console.error('ideal week load', e); }
  }

  // Albero Workbook/Sub-workbook: azione rara (creazione nodo, cambio
  // colore) — salvataggio diretto, nessun debounce necessario.
  function persistWorkbooks(nextList) {
    setWorkbooks(nextList);
    workbooksRef.current = nextList;
    const payload = { workbooks: nextList };
    cacheSet('workbooks', payload, 30 * 60 * 1000);
    if (workbooksLoadedRef.current) {
      saveWorkbooks(payload).catch(e => console.error('save workbooks', e));
    }
  }

  // Aggiorna solo lo stato locale (nessuna chiamata Graph) — usato per il
  // feedback visivo istantaneo di ogni mutazione sui blocchi Workbook; la
  // sincronizzazione con l'evento reale è sempre esplicita a parte (subito
  // per le azioni singole, con debounce per i trascinamenti continui, vedi
  // scheduleWorkbookSync), non più un side-effect automatico come prima.
  function mutateWorkbookPlansLocal(updater) {
    const next = updater(workbookPlansRef.current);
    if (next === workbookPlansRef.current) return;
    workbookPlansRef.current = next;
    setWorkbookPlans(next);
  }

  // Debounce per blocco (resize e trascinamento nota, che chiamano l'update
  // locale a ogni mousemove): coalizza le chiamate rapide in un solo PATCH
  // Graph, sparato ~600ms dopo l'ultimo movimento invece che a ogni tick.
  const WB_SYNC_DEBOUNCE = 600;
  function scheduleWorkbookSync(blockId, fn) {
    clearTimeout(workbookSyncTimersRef.current[blockId]);
    workbookSyncTimersRef.current[blockId] = setTimeout(() => {
      delete workbookSyncTimersRef.current[blockId];
      fn().catch(e => console.error('sync workbook event', e));
    }, WB_SYNC_DEBOUNCE);
  }

  // Calendari esclusi dalla visualizzazione. finché l'utente non tocca il
  // filtro (hiddenCalendarIds === null) si nasconde di default il calendario
  // "Birthday calendar" restituito da Graph.
  function getHiddenCalendarIds() {
    const hidden = configRef.current.hiddenCalendarIds;
    if (hidden === null || hidden === undefined) {
      return calendarsList.filter(c => (c.name || '').trim().toLowerCase() === 'birthday calendar').map(c => c.id);
    }
    return hidden;
  }

  function toggleCalendarVisibility(calId) {
    const hidden = getHiddenCalendarIds();
    const nextHidden = hidden.includes(calId) ? hidden.filter(id => id !== calId) : [...hidden, calId];
    const nextConfig = { ...configRef.current, hiddenCalendarIds: nextHidden };
    configRef.current = nextConfig;
    setConfig(nextConfig);
    cacheSet('planner_config', nextConfig, 30 * 60 * 1000);
    // Se il load della config è fallito, non riscrivere il file remoto
    // partendo dai default: si perderebbe la configurazione salvata.
    if (configLoadedRef.current) {
      savePlannerConfig(nextConfig).catch(e => console.error('save planner config', e));
    }
  }

  // Cambia il colore di un calendario (proprio o condiviso) — aggiornamento
  // ottimistico della lista locale, con rollback se la PATCH su Graph fallisce.
  async function changeCalendarColor(calId, color) {
    const prevList = calendarsList;
    setCalendarsList(list => list.map(c => c.id === calId ? { ...c, color } : c));
    setCalColorPickerFor(null);
    try {
      await updateCalendarColor(calId, color);
    } catch (e) {
      console.error('update calendar color', e);
      setCalendarsList(prevList);
    }
  }

  // Riapplica il filtro (senza rifetchare) quando cambiano le preferenze di
  // visibilità o arriva/aggiorna la lista calendari.
  useEffect(() => {
    if (!open) return;
    filterCalEvents(allCalEventsRef.current);
  }, [open, config.hiddenCalendarIds, calendarsList]); // eslint-disable-line

  // Rifà il parsing (senza rifetchare) quando l'albero Workbook arriva/cambia:
  // parseWorkbookEvent risolve workbookId/subWorkbookId dal subject leggendo
  // workbooksRef, quindi se gli eventi sono già in cache da prima che i nodi
  // fossero caricati i blocchi restavano col colore di fallback grigio finché
  // non scattava un refetch — questo li riallinea subito.
  useEffect(() => {
    if (!open) return;
    filterWorkbookEvents(allWorkbookEventsRef.current);
  }, [open, workbooks]); // eslint-disable-line

  // Fetch a 6-month window once; subsequent calls filter from the in-memory/cache ref.
  async function fetchCalEventsAll() {
    const CAL_BULK_KEY = 'cal_events_bulk';
    const CAL_MONTHS   = 3;

    // 1 — in-memory (same session)
    if (allCalEventsRef.current.length > 0) {
      filterCalEvents(allCalEventsRef.current);
      return;
    }
    // 2 — session cache
    const cached = cacheGet(CAL_BULK_KEY);
    if (cached) {
      allCalEventsRef.current = cached;
      filterCalEvents(cached);
      return;
    }
    // 3 — API: fetch the full ±3-month window once
    try {
      const today = new Date();
      const start = new Date(today); start.setMonth(today.getMonth() - CAL_MONTHS); start.setHours(0,0,0,0);
      const end   = new Date(today); end.setMonth(today.getMonth() + CAL_MONTHS);   end.setHours(23,59,59,999);
      const evs = await getCalendarEvents(start, end, 500);
      allCalEventsRef.current = evs;
      cacheSet(CAL_BULK_KEY, evs, 30 * 60 * 1000);
      filterCalEvents(evs);
    } catch (e) {
      console.error('cal events bulk load', e);
      filterCalEvents([]);
    }
  }

  function filterCalEvents(allEvs) {
    const CAL_MONTHS = 3;
    const today      = new Date();
    const minDate    = new Date(today); minDate.setMonth(today.getMonth() - CAL_MONTHS);
    const maxDate    = new Date(today); maxDate.setMonth(today.getMonth() + CAL_MONTHS);
    const viewDate   = new Date(currentDate + 'T12:00:00');

    if (viewDate < minDate || viewDate > maxDate) {
      setCalOutOfRange(true);
      setCalEvents([]);
      return;
    }
    setCalOutOfRange(false);

    let viewStart, viewEnd;
    if (viewMode === 'week') {
      const wd = getWeekDays(currentDate);
      viewStart = wd[0]; viewEnd = wd[6];
    } else if (viewMode === 'month') {
      const d = new Date(currentDate + 'T12:00:00');
      viewStart = localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
      viewEnd   = localDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    } else {
      viewStart = currentDate; viewEnd = currentDate;
    }

    const hiddenIds = getHiddenCalendarIds();
    const filtered = allEvs.filter(ev => {
      if (hiddenIds.includes(ev._calId)) return false;
      const d = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
      return d >= viewStart && d <= viewEnd;
    });
    setCalEvents(filtered);
  }

  // Il calendario dedicato ai blocchi Workbook non compare nel filtro
  // "Calendari ▾" né nel picker di "+ Evento": ha già il suo toggle sintetico
  // (WORKBOOK_CAL_ID) e i suoi eventi non vanno creati/modificati come eventi
  // generici (perderebbero i metadati workbookId/subWorkbookId nel body).
  async function initCalendarsList() {
    try {
      const cals = await getCalendars();
      setCalendarsList(cals.filter(c => (c.name || '').trim().toLowerCase() !== WORKBOOK_CALENDAR_NAME.toLowerCase()));
    } catch (e) { console.error('calendars load', e); }
  }

  // Forza un refetch dal server dopo una modifica (crea/modifica/elimina evento).
  async function refreshCalEvents() {
    allCalEventsRef.current = [];
    cacheDel('cal_events_bulk');
    await fetchCalEventsAll();
  }

  function openCreateEventModal(dateStr, startTime) {
    setCalModal({
      mode: 'create',
      defaultDate: dateStr || currentDate,
      defaultStartTime: startTime || null,
      defaultEndTime: startTime ? m2t(Math.min(t2m(startTime) + DEFAULT_DURATION, DAY_END_MIN)) : null,
    });
  }

  function openEditEventModal(ev) {
    setCalModal({ mode: 'edit', event: ev });
  }

  async function handleSaveCalEvent(form) {
    const { calendarId, subject, startDate, endDate, startTime, endTime } = form;
    if (calModal?.mode === 'edit') {
      const ev = calModal.event;
      const defaultCalId = calendarsList.find(c => c.isDefaultCalendar)?.id || calendarsList[0]?.id || null;
      const originCalId  = ev._calId || defaultCalId;
      const targetCalId  = calendarId || defaultCalId;
      // Snapshot dei valori precedenti, per poter tornare indietro con l'undo.
      const prevAllDay    = ev.isAllDay;
      const prevStartDate = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
      const prevEndDate   = (ev.end?.dateTime || ev.end?.date || '').slice(0, 10);
      const prevStartTime = prevAllDay ? null : isoToHHMM(ev.start?.dateTime);
      const prevEndTime   = prevAllDay ? null : isoToHHMM(ev.end?.dateTime);
      const prevSubject   = ev.subject;
      let targetEventId  = ev.id;
      if (originCalId !== targetCalId) {
        const moved = await moveCalendarEvent(ev._calId || null, ev.id, targetCalId);
        targetEventId = moved?.id || ev.id;
      }
      await updateCalendarEvent(targetCalId, targetEventId, { subject, startDate, endDate, startTime, endTime });
      pushUndo({
        label: `Modifica a "${subject}" annullabile`,
        undo: async () => {
          let backEventId = targetEventId;
          if (originCalId !== targetCalId) {
            const movedBack = await moveCalendarEvent(targetCalId, targetEventId, originCalId);
            backEventId = movedBack?.id || targetEventId;
          }
          await updateCalendarEvent(originCalId, backEventId, {
            subject: prevSubject, startDate: prevStartDate, endDate: prevEndDate,
            startTime: prevStartTime, endTime: prevEndTime,
          });
          await refreshCalEvents();
        },
      });
    } else {
      const created = await createCalendarEvent({ calendarId, subject, startDate, endDate, startTime, endTime });
      const createdCalId = calendarId || null;
      pushUndo({
        label: `Evento "${subject}" creato`,
        undo: async () => {
          await deleteCalendarEvent(createdCalId, created.id);
          await refreshCalEvents();
        },
      });
    }
    setCalModal(null);
    await refreshCalEvents();
  }

  async function handleDeleteCalEvent() {
    if (calModal?.mode !== 'edit') return;
    const ev = calModal.event;
    const calId = ev._calId;
    await deleteCalendarEvent(calId, ev.id);
    pushUndo({
      label: `Evento "${ev.subject}" eliminato`,
      undo: async () => {
        // Graph non offre un "ripristina": ricreiamo un evento nuovo con gli
        // stessi dati (nuovo ID). Se l'evento aveva partecipanti, l'eventuale
        // notifica di cancellazione già inviata non viene richiamata indietro.
        await createCalendarEvent({
          calendarId: calId,
          subject: ev.subject,
          startDate: (ev.start?.dateTime || ev.start?.date || '').slice(0, 10),
          endDate: (ev.end?.dateTime || ev.end?.date || '').slice(0, 10),
          startTime: ev.isAllDay ? null : isoToHHMM(ev.start?.dateTime),
          endTime: ev.isAllDay ? null : isoToHHMM(ev.end?.dateTime),
        });
        await refreshCalEvents();
      },
    });
    setCalModal(null);
    await refreshCalEvents();
  }

  // Ctrl/Cmd+trascina un evento sulla Timeline (Giorno o Settimana): crea un
  // nuovo evento Graph con la stessa durata/calendario nel punto di drop,
  // senza toccare l'originale — a differenza di move/resize non c'è drag
  // "semplice" sugli eventi, solo questa variante copia innescata dal
  // modificatore (vedi onDragStart sui blocchi evento).
  async function copyCalendarEvent(calId, subject, durationMin, toDay, newStartTime) {
    const startMin = Math.max(DAY_START_MIN, Math.min(t2m(newStartTime), DAY_END_MIN - 30));
    const endMin   = Math.min(startMin + durationMin, DAY_END_MIN);
    try {
      const created = await createCalendarEvent({
        calendarId: calId, subject,
        startDate: toDay, endDate: toDay,
        startTime: m2t(startMin), endTime: m2t(endMin),
      });
      pushUndo({
        label: `Evento "${subject}" duplicato`,
        undo: async () => {
          await deleteCalendarEvent(calId, created.id);
          await refreshCalEvents();
        },
      });
      await refreshCalEvents();
    } catch (e) { console.error('copy calendar event', e); }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  function scheduleSave(updatedPlan) {
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!plansLoadedRef.current) { setSaveStatus('error'); return; }
      try {
        const updated = { ...plansRef.current, [currentDate]: updatedPlan };
        plansRef.current = updated;
        setPlans(updated);
        cacheSet('daily_plans', updated, PLANS_CACHE_TTL);
        await saveDailyPlans(updated);
        setSaveStatus('saved');
      } catch (e) {
        console.error('save plans', e);
        setSaveStatus('error');
      }
    }, SAVE_DEBOUNCE);
  }

  function mutatePlan(updater) {
    setTodayPlan(prev => {
      const next = updater(prev);
      // Immediately update plansRef so navigating away and back shows correct data
      plansRef.current = { ...plansRef.current, [currentDateRef.current]: next };
      scheduleSave(next);
      return next;
    });
  }

  // Mutazione su più giorni (vista settimana): aggiorna tutti i piani e salva
  function mutatePlansMulti(updater) {
    const next = updater(plansRef.current);
    if (next === plansRef.current) return;
    plansRef.current = next;
    setPlans(next);
    const cur = next[currentDateRef.current];
    if (cur) setTodayPlan(cur);
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!plansLoadedRef.current) { setSaveStatus('error'); return; }
      try {
        cacheSet('daily_plans', plansRef.current, PLANS_CACHE_TTL);
        await saveDailyPlans(plansRef.current);
        setSaveStatus('saved');
      } catch (e) {
        console.error('save plans', e);
        setSaveStatus('error');
      }
    }, SAVE_DEBOUNCE);
  }

  function moveBlockBetweenDays(fromDay, blockId, toDay, newStartTime) {
    mutatePlansMulti(all => {
      const fromPlan = all[fromDay];
      const block = fromPlan?.blocks.find(b => b.id === blockId);
      if (!block) return all;
      const dur       = t2m(block.endTime) - t2m(block.startTime);
      const startMin  = Math.max(DAY_START_MIN, Math.min(t2m(newStartTime), DAY_END_MIN - 30));
      const moved     = { ...block, startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, DAY_END_MIN)) };
      const next = { ...all };
      if (fromDay === toDay) {
        next[fromDay] = { ...fromPlan, blocks: fromPlan.blocks.map(b => b.id === blockId ? moved : b) };
      } else {
        next[fromDay] = { ...fromPlan, blocks: fromPlan.blocks.filter(b => b.id !== blockId) };
        const toPlan  = next[toDay] || { date: toDay, blocks: [], emailExtractedActions: [] };
        next[toDay]   = { ...toPlan, blocks: [...toPlan.blocks, moved] };
      }
      return next;
    });
  }

  // Ctrl/Cmd+trascina un blocco task: duplica invece di spostare — l'originale
  // resta al suo posto, il duplicato nasce "da zero" (non completato, sotto-step
  // reimpostati) nel punto di drop, anche su un altro giorno.
  function copyBlockBetweenDays(fromDay, blockId, toDay, newStartTime) {
    mutatePlansMulti(all => {
      const fromPlan = all[fromDay];
      const block = fromPlan?.blocks.find(b => b.id === blockId);
      if (!block) return all;
      const dur      = t2m(block.endTime) - t2m(block.startTime);
      const startMin = Math.max(DAY_START_MIN, Math.min(t2m(newStartTime), DAY_END_MIN - 30));
      const copy = {
        ...block, id: genId(),
        startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, DAY_END_MIN)),
        completed: false, completedAt: null,
        subSteps: (block.subSteps || []).map(s => ({ ...s, completed: false })),
      };
      const toPlan = all[toDay] || { date: toDay, blocks: [], emailExtractedActions: [] };
      return { ...all, [toDay]: { ...toPlan, blocks: [...toPlan.blocks, copy] } };
    });
  }

  // ── DnD ─────────────────────────────────────────────────────────────────────
  function handleTimelineDragOver(e) {
    if (locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!timelineBodyRef.current) return;
    const rect = timelineBodyRef.current.getBoundingClientRect();
    const relY  = e.clientY - rect.top + timelineBodyRef.current.scrollTop;
    const slotIndex  = Math.floor(relY / SLOT_HEIGHT);
    const clamped    = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 30, slotIndex * 30));
    setDragOverTime(m2t(clamped));
  }

  function handleTimelineDrop(e) {
    e.preventDefault();
    if (locked || !dragOverTime) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'task')   addBlock(data.task, dragOverTime);
      else if (data.type === 'block') {
        if (data.copy) copyBlockBetweenDays(currentDate, data.blockId, currentDate, dragOverTime);
        else moveBlock(data.blockId, dragOverTime);
      }
      else if (data.type === 'workbookblock') addWorkbookBlockToDay(data.workbookId, data.subWorkbookId, currentDate, dragOverTime);
      else if (data.type === 'weekworkbookblock') {
        if (data.copy) copyWorkbookBlockBetweenDays(data.fromDay, data.blockId, currentDate, dragOverTime);
        else moveWorkbookBlockBetweenDays(data.fromDay, data.blockId, currentDate, dragOverTime);
      }
      else if (data.type === 'calevent-copy') copyCalendarEvent(data.calId, data.subject, data.durationMin, currentDate, dragOverTime);
    } catch { /* payload drag non valido — ignora */ }
    setDragOverTime(null);
  }

  // Clic su uno spazio vuoto della Timeline: apre "Nuovo evento" precompilato
  // con la data corrente e l'ora del punto cliccato (arrotondata al mezz'ora).
  function handleTimelineClick(e) {
    if (locked) return;
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (e.target.closest('.planner-block, .planner-cal-event, .planner-day-workbook-block, .planner-focus-bar, .planner-focus-column, .planner-focus-daytotal')) return;
    if (!timelineBodyRef.current) return;
    const rect = timelineBodyRef.current.getBoundingClientRect();
    const relY = e.clientY - rect.top + timelineBodyRef.current.scrollTop;
    const slotIndex = Math.floor(relY / SLOT_HEIGHT);
    const startMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 30, slotIndex * 30));
    openCreateEventModal(currentDate, m2t(startMin));
  }

  function makeBlock(task, startTime) {
    const proj    = findProject(task, configRef.current);
    const color   = proj?.color ?? listColorMapRef.current[(task._listName ?? '').toLowerCase()] ?? '#888';
    const endMin  = Math.min(t2m(startTime) + DEFAULT_DURATION, DAY_END_MIN);
    return {
      id: genId(), taskId: task.id, taskTitle: task.title,
      listId: task._listId, listName: task._listName,
      projectKey: proj?.key || null, projectColor: color,
      startTime, endTime: m2t(endMin),
      completed: false, completedAt: null,
      subSteps: [],
    };
  }

  function addBlock(task, startTime) {
    const newBlock = makeBlock(task, startTime);
    mutatePlan(prev => ({ ...prev, blocks: [...prev.blocks, newBlock] }));
  }

  // Drop di un task dal pool su un giorno qualunque della vista Settimana.
  function addBlockToDay(task, day, startTime) {
    const newBlock = makeBlock(task, startTime);
    mutatePlansMulti(all => {
      const dayPlan = all[day] || { date: day, blocks: [], emailExtractedActions: [] };
      return { ...all, [day]: { ...dayPlan, blocks: [...dayPlan.blocks, newBlock] } };
    });
  }

  // Blocco workbook — colore/etichetta denormalizzati al momento del drop,
  // come makeBlock() sopra: non insegue modifiche successive al nodo.
  function makeWorkbookBlock(workbookId, subWorkbookId, startTime) {
    const wb    = workbooksRef.current.find(w => w.id === workbookId);
    const sub   = subWorkbookId ? wb?.subWorkbooks.find(s => s.id === subWorkbookId) : null;
    const color = sub?.color ?? wb?.color ?? '#888';
    const label = sub ? `${wb.name} · ${sub.name}` : (wb?.name ?? '?');
    const endMin = Math.min(t2m(startTime) + DEFAULT_DURATION, DAY_END_MIN);
    return { id: genId(), workbookId, subWorkbookId, label, color, startTime, endTime: m2t(endMin) };
  }

  // Crea subito il blocco in locale (id temporaneo) per il feedback visivo
  // istantaneo del drop, poi crea l'evento reale su Graph e sostituisce l'id
  // temporaneo con quello vero restituito da Graph — necessario perché ogni
  // mutazione successiva (resize, note, spostamento) deve poter indirizzare
  // l'evento giusto. Se la creazione fallisce il blocco locale viene ritirato.
  function addWorkbookBlockToDay(workbookId, subWorkbookId, day, startTime) {
    if (!workbookCalIdRef.current) return;
    const newBlock = makeWorkbookBlock(workbookId, subWorkbookId, startTime);
    mutateWorkbookPlansLocal(all => {
      const dayPlan = all[day] || { date: day, blocks: [] };
      return { ...all, [day]: { ...dayPlan, blocks: [...dayPlan.blocks, newBlock] } };
    });
    const tempId = newBlock.id;
    createCalendarEvent({
      calendarId: workbookCalIdRef.current,
      subject: newBlock.label, startDate: day, endDate: day,
      startTime: newBlock.startTime, endTime: newBlock.endTime,
      body: workbookEventBody(newBlock),
    }).then(created => {
      mutateWorkbookPlansLocal(all => {
        const dayPlan = all[day];
        if (!dayPlan) return all;
        return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.map(b => b.id === tempId ? { ...b, id: created.id } : b) } };
      });
      refreshWorkbookEvents();
    }).catch(e => {
      console.error('create workbook event', e);
      mutateWorkbookPlansLocal(all => {
        const dayPlan = all[day];
        if (!dayPlan) return all;
        return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.filter(b => b.id !== tempId) } };
      });
    });
  }

  function moveWorkbookBlockBetweenDays(fromDay, blockId, toDay, newStartTime) {
    let moved = null;
    mutateWorkbookPlansLocal(all => {
      const fromPlan = all[fromDay];
      const block = fromPlan?.blocks.find(b => b.id === blockId);
      if (!block) return all;
      const dur      = t2m(block.endTime) - t2m(block.startTime);
      const startMin = Math.max(DAY_START_MIN, Math.min(t2m(newStartTime), DAY_END_MIN - 30));
      moved = { ...block, startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, DAY_END_MIN)) };
      const next = { ...all };
      if (fromDay === toDay) {
        next[fromDay] = { ...fromPlan, blocks: fromPlan.blocks.map(b => b.id === blockId ? moved : b) };
      } else {
        next[fromDay] = { ...fromPlan, blocks: fromPlan.blocks.filter(b => b.id !== blockId) };
        const toPlan  = next[toDay] || { date: toDay, blocks: [] };
        next[toDay]   = { ...toPlan, blocks: [...toPlan.blocks, moved] };
      }
      return next;
    });
    if (!moved || !workbookCalIdRef.current) return;
    patchCalendarEvent(workbookCalIdRef.current, blockId, {
      start: graphDateTime(toDay, moved.startTime),
      end: graphDateTime(toDay, moved.endTime),
    }).then(() => refreshWorkbookEvents())
      .catch(e => console.error('move workbook event', e));
  }

  // Ctrl/Cmd+trascina un blocco workbook: duplica invece di spostare, come
  // copyBlockBetweenDays sopra ma crea un nuovo evento Graph — le note vengono
  // copiate con id nuovi per non condividerle con l'originale.
  function copyWorkbookBlockBetweenDays(fromDay, blockId, toDay, newStartTime) {
    if (!workbookCalIdRef.current) return;
    const fromPlan = workbookPlansRef.current[fromDay];
    const block = fromPlan?.blocks.find(b => b.id === blockId);
    if (!block) return;
    const dur      = t2m(block.endTime) - t2m(block.startTime);
    const startMin = Math.max(DAY_START_MIN, Math.min(t2m(newStartTime), DAY_END_MIN - 30));
    const copy = {
      ...block, id: genId(),
      startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, DAY_END_MIN)),
      notes: (block.notes || []).map(n => ({ ...n, id: genId() })),
    };
    mutateWorkbookPlansLocal(all => {
      const toPlan = all[toDay] || { date: toDay, blocks: [] };
      return { ...all, [toDay]: { ...toPlan, blocks: [...toPlan.blocks, copy] } };
    });
    const tempId = copy.id;
    createCalendarEvent({
      calendarId: workbookCalIdRef.current,
      subject: copy.label, startDate: toDay, endDate: toDay,
      startTime: copy.startTime, endTime: copy.endTime,
      body: workbookEventBody(copy),
    }).then(created => {
      mutateWorkbookPlansLocal(all => {
        const toPlan = all[toDay];
        if (!toPlan) return all;
        return { ...all, [toDay]: { ...toPlan, blocks: toPlan.blocks.map(b => b.id === tempId ? { ...b, id: created.id } : b) } };
      });
      refreshWorkbookEvents();
    }).catch(e => {
      console.error('copy workbook event', e);
      mutateWorkbookPlansLocal(all => {
        const toPlan = all[toDay];
        if (!toPlan) return all;
        return { ...all, [toDay]: { ...toPlan, blocks: toPlan.blocks.filter(b => b.id !== tempId) } };
      });
    });
  }

  function handleRemoveWorkbookBlock(day, blockId) {
    clearTimeout(workbookSyncTimersRef.current[blockId]);
    delete workbookSyncTimersRef.current[blockId];
    mutateWorkbookPlansLocal(all => {
      const dayPlan = all[day];
      if (!dayPlan) return all;
      return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.filter(b => b.id !== blockId) } };
    });
    if (!workbookCalIdRef.current) return;
    deleteCalendarEvent(workbookCalIdRef.current, blockId)
      .then(() => refreshWorkbookEvents())
      .catch(e => console.error('delete workbook event', e));
  }

  // Helper condiviso dalle 4 mutazioni sulle note di un workbook block: le
  // note sono sganciate dal testo del blocco (label) — servono per annotare
  // un dettaglio ("caffè", "pranzo"…) in un punto preciso della fascia, con
  // andate a capo libere, senza doverne creare uno spezzettando l'orario.
  // `immediate` false per il trascinamento continuo della nota (onMove a ogni
  // mousemove): la sincronizzazione Graph passa dal debounce per blocco
  // invece di sparare un PATCH a ogni tick.
  function patchWorkbookNotes(day, blockId, updater, { immediate = true } = {}) {
    let updatedBlock = null;
    mutateWorkbookPlansLocal(all => {
      const dayPlan = all[day];
      if (!dayPlan) return all;
      return {
        ...all,
        [day]: {
          ...dayPlan,
          blocks: dayPlan.blocks.map(b => {
            if (b.id !== blockId) return b;
            updatedBlock = { ...b, notes: updater(b.notes || []) };
            return updatedBlock;
          }),
        },
      };
    });
    if (!updatedBlock || !workbookCalIdRef.current) return;
    const sync = () => patchCalendarEvent(workbookCalIdRef.current, blockId, {
      body: { contentType: 'text', content: workbookEventBody(updatedBlock) },
    });
    if (immediate) sync().catch(e => console.error('sync workbook notes', e));
    else scheduleWorkbookSync(blockId, sync);
  }

  function addWorkbookNote(day, blockId, top) {
    patchWorkbookNotes(day, blockId, notes => [...notes, { id: genId(), text: '', top }]);
  }

  // Nota lasciata vuota alla chiusura dell'editor → scartata invece di
  // restare come etichetta fantasma cliccabile ma senza contenuto.
  function editWorkbookNoteText(day, blockId, noteId, text) {
    patchWorkbookNotes(day, blockId, notes => {
      if (!text.trim()) return notes.filter(n => n.id !== noteId);
      return notes.map(n => n.id === noteId ? { ...n, text } : n);
    });
  }

  function moveWorkbookNote(day, blockId, noteId, top) {
    patchWorkbookNotes(day, blockId, notes => notes.map(n => n.id === noteId ? { ...n, top } : n), { immediate: false });
  }

  function removeWorkbookNote(day, blockId, noteId) {
    patchWorkbookNotes(day, blockId, notes => notes.filter(n => n.id !== noteId));
  }

  // Resize (drag verticale sul bordo inferiore) di un workbook block nella
  // vista Settimana — non esiste un equivalente per i blocchi task lì (solo
  // spostamento), quindi è una funzione nuova, non un riuso di handleResizeStart.
  function handleWorkbookResizeStart(e, block, day) {
    e.preventDefault();
    e.stopPropagation();
    const startY        = e.clientY;
    const startEndMin   = t2m(block.endTime);
    const blockStartMin = t2m(block.startTime);
    function onMove(ev) {
      const deltaMin  = Math.round((ev.clientY - startY) / SLOT_HEIGHT * 30 / 30) * 30;
      const newEndMin = Math.max(blockStartMin + 30, Math.min(DAY_END_MIN, startEndMin + deltaMin));
      mutateWorkbookPlansLocal(all => {
        const dayPlan = all[day];
        if (!dayPlan) return all;
        return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.map(b => b.id === block.id ? { ...b, endTime: m2t(newEndMin) } : b) } };
      });
      if (workbookCalIdRef.current) {
        scheduleWorkbookSync(block.id, () => patchCalendarEvent(workbookCalIdRef.current, block.id, {
          end: graphDateTime(day, m2t(newEndMin)),
        }));
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Resize (drag verticale sul bordo inferiore) di un task block nella vista
  // Settimana — analogo a handleResizeStart della vista Giorno, ma opera su
  // `plans` multi-giorno invece che sul solo todayPlan.
  function handleWeekBlockResizeStart(e, block, day) {
    e.preventDefault();
    e.stopPropagation();
    const startY        = e.clientY;
    const startEndMin   = t2m(block.endTime);
    const blockStartMin = t2m(block.startTime);
    function onMove(ev) {
      markDragSuppressClick();
      const deltaMin  = Math.round((ev.clientY - startY) / SLOT_HEIGHT * 30 / 30) * 30;
      const newEndMin = Math.max(blockStartMin + 30, Math.min(DAY_END_MIN, startEndMin + deltaMin));
      mutatePlansMulti(all => {
        const dayPlan = all[day];
        if (!dayPlan) return all;
        return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.map(b => b.id === block.id ? { ...b, endTime: m2t(newEndMin) } : b) } };
      });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Wrapper di handleWorkbookResizeStart per la vista Giorno: gestisce in più
  // il flag dayResizingWbId (stesso ruolo del resizingWbId locale di
  // WeeklyTimeline), assente lì perché la vista Settimana tiene il proprio
  // stato di resize dentro il componente.
  function handleDayWorkbookResizeStart(e, block) {
    setDayResizingWbId(block.id);
    handleWorkbookResizeStart(e, block, currentDate);
    function clearResizing() {
      setDayResizingWbId(null);
      document.removeEventListener('mouseup', clearResizing);
    }
    document.addEventListener('mouseup', clearResizing);
  }

  // Salva i workbook block della settimana visualizzata come template
  // ricorrente (giorno della settimana 0-6 invece di data assoluta). Sovrascrive
  // sempre l'intero file su OneDrive: senza conferma, cliccarlo per sbaglio su
  // una settimana vuota/diversa cancella silenziosamente il template buono.
  function saveAsIdealWeek() {
    if (idealWeekRef.current?.blocks?.length &&
        !window.confirm('Questo sovrascrive la settimana ideale già salvata con i blocchi Workbook di questa settimana. Continuare?')) return;
    const wd = getWeekDays(currentDateRef.current);
    const blocks = [];
    wd.forEach((day, dayOfWeek) => {
      (workbookPlansRef.current[day]?.blocks || []).forEach(b => {
        blocks.push({
          id: genId(), workbookId: b.workbookId, subWorkbookId: b.subWorkbookId,
          label: b.label, color: b.color, startTime: b.startTime, endTime: b.endTime,
          dayOfWeek,
        });
      });
    });
    const template = { blocks, updatedAt: new Date().toISOString() };
    setIdealWeek(template);
    idealWeekRef.current = template;
    cacheSet('ideal_week', template, 30 * 60 * 1000);
    saveIdealWeek(template).catch(e => console.error('save ideal week', e));
  }

  // Importa il template nella settimana visualizzata per COPIA: nuovi id,
  // nessun riferimento al template — modificarli qui non lo altera. Ogni
  // blocco del template diventa un evento reale sul calendario Workbook,
  // stesso schema crea-locale-poi-riconcilia-id di addWorkbookBlockToDay.
  function importIdealWeek() {
    const template = idealWeekRef.current;
    if (!template?.blocks?.length || !workbookCalIdRef.current) return;
    const wd = getWeekDays(currentDateRef.current);
    const creations = template.blocks.map(tb => {
      const day = wd[tb.dayOfWeek];
      if (!day) return null; // dayOfWeek fuori range 0-6 (template corrotto) — scarta senza crashare
      const copy = {
        id: genId(), workbookId: tb.workbookId, subWorkbookId: tb.subWorkbookId,
        label: tb.label, color: tb.color, startTime: tb.startTime, endTime: tb.endTime, notes: [],
      };
      mutateWorkbookPlansLocal(all => {
        const dayPlan = all[day] || { date: day, blocks: [] };
        return { ...all, [day]: { ...dayPlan, blocks: [...dayPlan.blocks, copy] } };
      });
      const tempId = copy.id;
      return createCalendarEvent({
        calendarId: workbookCalIdRef.current,
        subject: copy.label, startDate: day, endDate: day,
        startTime: copy.startTime, endTime: copy.endTime,
        body: workbookEventBody(copy),
      }).then(created => {
        mutateWorkbookPlansLocal(all => {
          const dayPlan = all[day];
          if (!dayPlan) return all;
          return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.map(b => b.id === tempId ? { ...b, id: created.id } : b) } };
        });
      }).catch(e => {
        console.error('import ideal week event', e);
        mutateWorkbookPlansLocal(all => {
          const dayPlan = all[day];
          if (!dayPlan) return all;
          return { ...all, [day]: { ...dayPlan, blocks: dayPlan.blocks.filter(b => b.id !== tempId) } };
        });
      });
    }).filter(Boolean);
    // Un solo refetch a fine importazione invece che uno per blocco: la
    // settimana ideale ne piazza tipicamente una decina in un colpo solo.
    Promise.allSettled(creations).then(() => refreshWorkbookEvents());
  }

  // Elimina TUTTI i blocchi Workbook (eventi reali) della settimana
  // visualizzata — solo sul calendario dedicato "Workbook", non tocca alcun
  // altro calendario/evento. Utile per ripartire da zero dopo un test o
  // prima di reimportare la settimana ideale.
  function clearWorkbookWeek() {
    if (!workbookCalIdRef.current) return;
    const wd = getWeekDays(currentDateRef.current);
    const ids = wd.flatMap(day => (workbookPlansRef.current[day]?.blocks || []).map(b => b.id));
    if (!ids.length) return;
    if (!window.confirm(`Eliminare tutti i ${ids.length} blocchi Workbook di questa settimana? L'azione non è reversibile.`)) return;
    ids.forEach(id => {
      clearTimeout(workbookSyncTimersRef.current[id]);
      delete workbookSyncTimersRef.current[id];
    });
    mutateWorkbookPlansLocal(all => {
      const next = { ...all };
      wd.forEach(day => { if (next[day]) next[day] = { ...next[day], blocks: [] }; });
      return next;
    });
    Promise.allSettled(ids.map(id => deleteCalendarEvent(workbookCalIdRef.current, id)))
      .then(() => refreshWorkbookEvents())
      .catch(e => console.error('clear workbook week', e));
  }

  function moveBlock(blockId, newStartTime) {
    mutatePlan(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => {
        if (b.id !== blockId) return b;
        const dur    = t2m(b.endTime) - t2m(b.startTime);
        const endMin = Math.min(t2m(newStartTime) + dur, DAY_END_MIN);
        return { ...b, startTime: newStartTime, endTime: m2t(endMin) };
      }),
    }));
  }

  async function handleCompleteBlock(blockId) {
    const block = todayPlan.blocks.find(b => b.id === blockId);
    if (!block) return;
    mutatePlan(prev => ({
      ...prev,
      blocks: prev.blocks.map(b =>
        b.id === blockId ? { ...b, completed: true, completedAt: new Date().toISOString() } : b
      ),
    }));
    if (block.listId && block.taskId) {
      try {
        await completeTask(block.listId, block.taskId);
        onTaskCompleted?.(block.listId, block.taskId);
      } catch (e) { console.error('complete task', e); }
    }
  }

  function handleRemoveBlock(blockId) {
    mutatePlan(prev => ({ ...prev, blocks: prev.blocks.filter(b => b.id !== blockId) }));
  }

  // Un pomodoro intero (25 min di lavoro) si è completato: aggiorna i totali
  // giornalieri. La fascia oraria in sé arriva già via recordSessionClosed,
  // non aspetta più questo evento.
  function recordPomodoroSession({ focusedMinutes, interruptions } = {}) {
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDateRef.current] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      return {
        ...prev,
        [currentDateRef.current]: {
          ...prevDay,
          pomodori: prevDay.pomodori + 1,
          focusedMinutes: prevDay.focusedMinutes + (focusedMinutes || 0),
          interruptions: prevDay.interruptions + (interruptions || 0),
        },
      };
    });
  }

  // Una fascia oraria (lavoro o pausa) si è chiusa e va disegnata subito
  // sulla timeline, senza aspettare il completamento di un pomodoro intero.
  function recordSessionClosed(session) {
    const day = localDateStr(new Date(session.start));
    setPomodoroStatsMap(prev => {
      const prevDay = prev[day] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      return {
        ...prev,
        [day]: { ...prevDay, sessions: [...(prevDay.sessions || []), session] },
      };
    });
  }

  // ── Colonna Pomodoro: correzione a posteriori delle fasce orarie ───────────
  // Le fasce sono registrate automaticamente dal timer, ma un tipo scelto per
  // errore o un orario impreciso vanno corretti a mano: trascinare sposta la
  // fascia, le due manigliette agli estremi ne ridimensionano inizio/fine, un
  // clic apre il menu per cambiarne il tipo o cancellarla, un clic su uno
  // spazio vuoto della colonna ne aggiunge una nuova.
  function persistCurrentFocusSessions() {
    persistPomodoroSessions(currentDate, pomodoroStatsRef.current[currentDate]?.sessions || []);
  }

  function updateFocusSessionTimes(idx, newStartMin, newEndMin) {
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDate] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const sessions = (prevDay.sessions || []).map((s, i) => i === idx
        ? { ...s, start: dateTimeFromMinutes(currentDate, newStartMin), end: dateTimeFromMinutes(currentDate, newEndMin) }
        : s);
      return { ...prev, [currentDate]: { ...prevDay, sessions } };
    });
  }

  function changeFocusSessionType(idx, type) {
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDate] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const sessions = (prevDay.sessions || []).map((s, i) => i === idx ? { ...s, type } : s);
      persistPomodoroSessions(currentDate, sessions);
      return { ...prev, [currentDate]: { ...prevDay, sessions } };
    });
    setFocusPopup(null);
  }

  function deleteFocusSession(idx) {
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDate] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const sessions = (prevDay.sessions || []).filter((_, i) => i !== idx);
      persistPomodoroSessions(currentDate, sessions);
      return { ...prev, [currentDate]: { ...prevDay, sessions } };
    });
    setFocusPopup(null);
  }

  function addFocusSession(startMin, type) {
    const duration = FOCUS_ADD_DURATION[type] || 15;
    const start = Math.max(0, Math.min(24 * 60 - duration, startMin));
    const session = {
      start: dateTimeFromMinutes(currentDate, start),
      end: dateTimeFromMinutes(currentDate, start + duration),
      type,
    };
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDate] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const sessions = [...(prevDay.sessions || []), session];
      persistPomodoroSessions(currentDate, sessions);
      return { ...prev, [currentDate]: { ...prevDay, sessions } };
    });
    setFocusPopup(null);
  }

  // mode: 'move' trascina l'intera fascia, 'resize-start'/'resize-end' ne
  // spostano solo un estremo. Un mousedown senza trascinamento (spostamento
  // sotto soglia) viene trattato come un clic e apre il menu di modifica.
  function handleFocusSessionMouseDown(e, idx, mode) {
    e.preventDefault();
    e.stopPropagation();
    const sessions = pomodoroStatsMap[currentDate]?.sessions || [];
    const session = sessions[idx];
    if (!session) return;
    const sStart = new Date(session.start);
    const sEnd   = new Date(session.end);
    const drag = {
      idx, mode, moved: false, startY: e.clientY,
      origStart: sStart.getHours() * 60 + sStart.getMinutes(),
      origEnd:   sEnd.getHours() * 60 + sEnd.getMinutes(),
    };
    focusDragRef.current = drag;

    function onMove(ev) {
      const d = focusDragRef.current;
      if (!d) return;
      if (Math.abs(ev.clientY - d.startY) > 3) { d.moved = true; markDragSuppressClick(); }
      const deltaMin = Math.round(((ev.clientY - d.startY) / SLOT_HEIGHT * 30) / 5) * 5;
      let newStart = d.origStart, newEnd = d.origEnd;
      if (d.mode === 'move') {
        newStart = d.origStart + deltaMin;
        newEnd   = d.origEnd + deltaMin;
        if (newStart < 0) { newEnd -= newStart; newStart = 0; }
        if (newEnd > 24 * 60) { newStart -= (newEnd - 24 * 60); newEnd = 24 * 60; }
      } else if (d.mode === 'resize-start') {
        newStart = Math.max(0, Math.min(d.origEnd - 5, d.origStart + deltaMin));
      } else {
        newEnd = Math.min(24 * 60, Math.max(d.origStart + 5, d.origEnd + deltaMin));
      }
      updateFocusSessionTimes(idx, newStart, newEnd);
    }

    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const d = focusDragRef.current;
      focusDragRef.current = null;
      if (!d) return;
      if (!d.moved && d.mode === 'move') {
        setFocusPopup({ mode: 'edit', idx, x: ev.clientX, y: ev.clientY });
        return;
      }
      if (d.moved) persistCurrentFocusSessions();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Clic su uno spazio vuoto della colonna Pomodoro: apre il menu per
  // scegliere il tipo della nuova fascia, ancorata all'orario cliccato.
  function handleFocusColumnClick(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const rawMin = ((e.clientY - rect.top) / SLOT_HEIGHT) * 30;
    const startMin = Math.max(0, Math.min(24 * 60 - 5, Math.round(rawMin / 5) * 5));
    setFocusPopup({ mode: 'add', startMin, x: e.clientX, y: e.clientY });
  }

  function handleResizeStart(e, block) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { blockId: block.id, startY: e.clientY, startEndMin: t2m(block.endTime), blockStartMin: t2m(block.startTime) };
    setResizingId(block.id);

    function onMove(ev) {
      markDragSuppressClick();
      const { blockId, startY, startEndMin, blockStartMin } = resizingRef.current;
      const deltaMin = Math.round((ev.clientY - startY) / SLOT_HEIGHT * 30 / 30) * 30;
      const newEndMin = Math.max(blockStartMin + 30,
        Math.min(DAY_END_MIN, startEndMin + deltaMin));
      setTodayPlan(prev => ({
        ...prev,
        blocks: prev.blocks.map(b =>
          b.id === blockId ? { ...b, endTime: m2t(newEndMin) } : b),
      }));
    }

    function onUp() {
      resizingRef.current = null;
      setResizingId(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleSave(todayPlanRef.current);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function handleBreakdownTask(block) {
    if (!block.taskId || !block.listId) {
      setBreakdownModal({ block, items: [], loading: false, noTask: true });
      return;
    }
    setBreakdownModal({ block, items: null, loading: true });
    try {
      const full = await getTask(block.listId, block.taskId);
      const items = (full.checklistItems || [])
        .sort((a, b) => a.isChecked - b.isChecked)
        .map(i => ({ ...i, selected: !i.isChecked }));
      setBreakdownModal({ block, items, loading: false });
    } catch {
      setBreakdownModal(prev => ({ ...prev, loading: false, items: [], error: true }));
    }
  }

  function applyBreakdown(items) {
    if (!breakdownModal) return;
    const selected = items.filter(i => i.selected);
    const n = selected.length;
    mutatePlan(prev => ({
      ...prev,
      blocks: prev.blocks.map(b =>
        b.id === breakdownModal.block.id
          ? {
              ...b,
              subSteps:  selected.map(i => ({ id: i.id, title: i.displayName, completed: i.isChecked })),
              subSplits: n > 1 ? Array.from({ length: n - 1 }, (_, k) => (k + 1) / n) : [],
            }
          : b
      ),
    }));
    setBreakdownModal(null);
  }

  function handleSubSplitResizeStart(e, block, splitIdx, blockHeight) {
    e.preventDefault();
    e.stopPropagation();
    const n = block.subSteps.length;
    const splits = block.subSplits?.length === n - 1
      ? [...block.subSplits]
      : Array.from({ length: n - 1 }, (_, k) => (k + 1) / n);
    subResizingRef.current = { blockId: block.id, splitIdx, startY: e.clientY, startFrac: splits[splitIdx], blockHeight, splits };

    function onMove(ev) {
      markDragSuppressClick();
      const { blockId, splitIdx, startY, startFrac, blockHeight, splits: orig } = subResizingRef.current;
      const deltaFrac = (ev.clientY - startY) / blockHeight;
      const minGap = Math.max(0.05, 20 / blockHeight);
      const lo = splitIdx > 0 ? orig[splitIdx - 1] + minGap : minGap;
      const hi = splitIdx < orig.length - 1 ? orig[splitIdx + 1] - minGap : 1 - minGap;
      const newFrac = Math.max(lo, Math.min(hi, startFrac + deltaFrac));
      setTodayPlan(prev => ({
        ...prev,
        blocks: prev.blocks.map(b => {
          if (b.id !== blockId) return b;
          const next = b.subSplits ? [...b.subSplits] : [...orig];
          next[splitIdx] = newFrac;
          return { ...b, subSplits: next };
        }),
      }));
    }

    function onUp() {
      subResizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleSave(todayPlanRef.current);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Panel resize ─────────────────────────────────────────────────────────────
  function handlePoolResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = poolWidth;
    const onMove = ev => { markDragSuppressClick(); setPoolWidth(Math.max(180, Math.min(800, startW + ev.clientX - startX))); };
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleWeekPoolResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = weekPoolWidth;
    const onMove = ev => { markDragSuppressClick(); setWeekPoolWidth(Math.max(140, Math.min(500, startW + ev.clientX - startX))); };
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleAiResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = aiWidth;
    const onMove = ev => { markDragSuppressClick(); setAiWidth(Math.max(180, Math.min(800, startW - (ev.clientX - startX)))); };
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const timeSlots   = FULL_DAY_SLOTS;
  const scheduledIds = new Set(todayPlan.blocks.map(b => b.taskId));
  const weekDays = getWeekDays(currentDate);
  const weekScheduledIds = new Set();
  for (const day of weekDays) (plans[day]?.blocks || []).forEach(b => weekScheduledIds.add(b.taskId));

  // Statistiche del pannello Workbook (ore + % per categoria): quante ore
  // sono già piazzate sulla griglia della settimana visualizzata, per
  // workbook e sub-workbook — bySub tiene solo i blocchi assegnati a un
  // sub-workbook, byWorkbookDirect quelli assegnati al workbook padre senza
  // sub, così WorkbookPool può sommare i due per il totale di categoria.
  const workbookMinuteStats = (() => {
    const bySub = {};
    const byWorkbookDirect = {};
    let totalMin = 0;
    weekDays.forEach(day => {
      (workbookPlans[day]?.blocks || []).forEach(b => {
        const min = t2m(b.endTime) - t2m(b.startTime);
        if (min <= 0) return;
        totalMin += min;
        if (b.subWorkbookId) bySub[b.subWorkbookId] = (bySub[b.subWorkbookId] || 0) + min;
        else byWorkbookDirect[b.workbookId] = (byWorkbookDirect[b.workbookId] || 0) + min;
      });
    });
    return { bySub, byWorkbookDirect, totalMin };
  })();

  // Map each section/list name → a shade of its notebook color
  const listColorMap = useMemo(() => {
    const map = {};
    for (const nb of notebooks) {
      (sectionsMap[nb.id] || []).forEach((s, i) => {
        map[s.displayName.toLowerCase()] = s._color || shadeColor(nb._color || '#888', i);
      });
    }
    return map;
  }, [notebooks, sectionsMap]);
  const listColorMapRef = useRef({});
  listColorMapRef.current = listColorMap;

  const allDayEvents = calEvents.filter(isAllDay);
  const timedEvents  = calEvents.filter(ev => !isAllDay(ev));
  const dayWorkbookPlan  = workbookPlans[currentDate] || { blocks: [] };
  const workbookCalHidden = getHiddenCalendarIds().includes(WORKBOOK_CAL_ID);

  const workStart = t2m(config.workdayStart);
  const dayFocusMinutes = pomodoroStatsMap[currentDate]?.focusedMinutes || 0;

  function saveLabel() {
    const now = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (saveStatus === 'saving') return '⏳ Salvataggio…';
    if (saveStatus === 'saved')  return `💾 ${now}`;
    if (saveStatus === 'error')  return '⚠️ Errore salvataggio';
    return '';
  }

  // Il piano resta montato (invisibile via CSS, non smontato) mentre un
  // Pomodoro è in corso: così il timer e le sue statistiche sopravvivono alla
  // chiusura della vista Piano quando si passa alla modalità "focus" (Attività
  // a sx, Mente Digitale al centro, sezione a dx).
  if (!open && !pomodoroActive) return null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="planner-view" style={{ display: open ? undefined : 'none' }}>

      {/* Header */}
      <div className="planner-header">
        <div className="planner-header-left">
          <button className="planner-nav-btn" disabled={locked} onClick={() => {
            const d = new Date(currentDate + 'T12:00:00');
            if (viewMode === 'month') { setCurrentDate(localDateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1))); return; }
            d.setDate(d.getDate() - (viewMode === 'week' ? 7 : 1));
            setCurrentDate(localDateStr(d));
          }}>◀</button>
          <span className="planner-date">
            {viewMode === 'week' ? (() => {
              const wd = getWeekDays(currentDate);
              const f = ds => new Date(ds + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
              return `${f(wd[0])} – ${f(wd[6])}`;
            })() : viewMode === 'month'
              ? new Date(currentDate + 'T12:00:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
              : new Date(currentDate + 'T12:00:00').toLocaleDateString('it-IT', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
          </span>
          <button className="planner-nav-btn" disabled={locked} onClick={() => {
            const d = new Date(currentDate + 'T12:00:00');
            if (viewMode === 'month') { setCurrentDate(localDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1))); return; }
            d.setDate(d.getDate() + (viewMode === 'week' ? 7 : 1));
            setCurrentDate(localDateStr(d));
          }}>▶</button>
          {currentDate !== todayStr() && (
            <button className="planner-today-btn" disabled={locked} onClick={() => setCurrentDate(todayStr())}>Oggi</button>
          )}
          <div className="planner-view-toggle">
            <button disabled={locked} className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Giorno</button>
            <button disabled={locked} className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Settimana</button>
            <button disabled={locked} className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Mese</button>
          </div>
        </div>
        <div className="planner-header-actions">
          <div className="planner-cal-filter-wrap">
            <button className="planner-action-btn" disabled={locked} onClick={() => setCalFilterOpen(v => !v)} title="Filtra calendari">
              Calendari ▾
            </button>
            {calFilterOpen && (
              <>
                <div className="planner-cal-filter-backdrop" onClick={() => { setCalFilterOpen(false); setCalColorPickerFor(null); }} />
                <div className="planner-cal-filter-popup">
                  {/* Calendario sintetico: spegne/accende tutti i blocchi Workbook
                      (Settimana + Giorno) insieme, come un calendario in più. */}
                  <label className="planner-cal-filter-item">
                    <input
                      type="checkbox"
                      checked={!workbookCalHidden}
                      onChange={() => toggleCalendarVisibility(WORKBOOK_CAL_ID)}
                    />
                    <span className="planner-cal-filter-dot" style={{ background: '#c8a96e' }} />
                    <span className="planner-cal-filter-name">Workbook</span>
                  </label>
                  <div className="planner-cal-filter-divider" />
                  {calendarsList.length === 0 ? (
                    <div className="planner-cal-filter-empty">Nessun calendario</div>
                  ) : calendarsList.map(cal => {
                    const hidden  = getHiddenCalendarIds().includes(cal.id);
                    return (
                      <Fragment key={cal.id}>
                        <label className="planner-cal-filter-item">
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={() => toggleCalendarVisibility(cal.id)}
                          />
                          <button
                            type="button"
                            className="planner-cal-filter-dot planner-cal-filter-dot-btn"
                            style={{ background: calendarSwatch(cal.color) }}
                            onClick={e => { e.preventDefault(); e.stopPropagation(); setCalColorPickerFor(v => v === cal.id ? null : cal.id); }}
                            title="Cambia colore calendario" />
                          <span className="planner-cal-filter-name">{cal.name}</span>
                        </label>
                        {calColorPickerFor === cal.id && (
                          <div className="planner-cal-color-swatches">
                            {GRAPH_CAL_COLOR_OPTIONS.map(opt => (
                              <button
                                key={opt}
                                type="button"
                                className={`planner-cal-color-swatch${cal.color === opt ? ' active' : ''}${opt === 'auto' ? ' auto' : ''}`}
                                style={opt === 'auto' ? undefined : { background: GRAPH_CAL_COLORS[opt] }}
                                title={opt === 'auto' ? 'Colore predefinito' : opt}
                                onClick={() => changeCalendarColor(cal.id, opt)} />
                            ))}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {viewMode === 'week' && (
            <>
              <button className="planner-action-btn" disabled={locked} onClick={saveAsIdealWeek} title="Salva i workbook di questa settimana come template ricorrente">
                💾 Settimana ideale
              </button>
              <button className="planner-action-btn" disabled={locked || !idealWeek?.blocks?.length} onClick={importIdealWeek} title="Copia i workbook della settimana ideale in questa settimana">
                📥 Importa ideale
              </button>
              <button className="planner-action-btn danger" disabled={locked || !weekDays.some(d => workbookPlans[d]?.blocks?.length)} onClick={clearWorkbookWeek} title="Elimina tutti i blocchi Workbook (solo calendario Workbook) di questa settimana">
                🗑️ Svuota Workbook
              </button>
            </>
          )}
          <button className="planner-action-btn accent" disabled={locked} onClick={() => openCreateEventModal(currentDate)} title="Nuovo evento calendario">+ Evento</button>
          <button className="planner-close-btn" disabled={locked} onClick={onClose} title={locked ? 'Metti in pausa il Pomodoro per chiudere' : 'Chiudi pianificatore'}>✕</button>
        </div>
      </div>

      {/* Tab colonne — visibili solo su mobile (CSS) */}
      {viewMode === 'day' && (
        <div className="planner-mobile-tabs">
          <button className={mobileTab === 'pool' ? 'active' : ''} onClick={() => setMobileTab('pool')}>Task</button>
          <button className={mobileTab === 'timeline' ? 'active' : ''} onClick={() => setMobileTab('timeline')}>Giornata</button>
          <button className={mobileTab === 'panel' ? 'active' : ''} onClick={() => setMobileTab('panel')}>Dettagli</button>
        </div>
      )}

      {/* Body */}
      <div className="planner-body">

      {viewMode === 'month' ? (
        <MonthlyCalendar
          currentDate={currentDate}
          plans={plans}
          calEvents={calEvents}
          calOutOfRange={calOutOfRange}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
          onEventClick={openEditEventModal}
        />
      ) : viewMode === 'week' ? (<>

        {/* ── Task/Workbook Pool a sx, ridotto — stesso pool della vista
            Giorno, ridimensionabile e trascinabile sui giorni della settimana. */}
        <div className={`planner-pool planner-week-pool${locked ? ' locked' : ''}`} style={{ width: weekPoolWidth }}>
          <div className="planner-col-header">
            <span>Pannello</span>
            <div className="planner-view-toggle">
              <button className={poolMode === 'task' ? 'active' : ''} onClick={() => setPoolMode('task')}>Task</button>
              <button className={poolMode === 'workbook' ? 'active' : ''} onClick={() => setPoolMode('workbook')}>Workbook</button>
            </div>
          </div>
          {poolMode === 'task' ? (
            <TaskPool
              title="Task"
              tasks={preloadedTasks}
              config={config}
              notebooks={notebooks}
              sectionsMap={sectionsMap}
              scheduledIds={weekScheduledIds}
              draggable={!locked}
            />
          ) : (
            <WorkbookPool workbooks={workbooks} onChange={persistWorkbooks} draggable={!locked} notebooks={notebooks} stats={workbookMinuteStats} />
          )}
        </div>
        <div className="planner-col-resize" onMouseDown={handleWeekPoolResizeStart} title="Ridimensiona" />

        <WeeklyTimeline
          weekDays={weekDays}
          plans={plans}
          calEvents={calEvents}
          workbookPlans={workbookPlans}
          workbooks={workbooks}
          workbookCalHidden={workbookCalHidden}
          workdayStartMin={workStart}
          timeSlots={timeSlots}
          locked={locked}
          suppressClickRef={suppressClickRef}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
          onMoveBlock={moveBlockBetweenDays}
          onCopyBlock={copyBlockBetweenDays}
          onEventClick={openEditEventModal}
          onCopyEvent={copyCalendarEvent}
          onAddTask={addBlockToDay}
          onCreateEvent={(day, time) => openCreateEventModal(day, time)}
          onAddWorkbookBlock={addWorkbookBlockToDay}
          onMoveWorkbookBlock={moveWorkbookBlockBetweenDays}
          onCopyWorkbookBlock={copyWorkbookBlockBetweenDays}
          onRemoveWorkbookBlock={handleRemoveWorkbookBlock}
          onResizeWorkbookBlockStart={handleWorkbookResizeStart}
          onResizeBlockStart={handleWeekBlockResizeStart}
          onAddWorkbookNote={addWorkbookNote}
          onEditWorkbookNote={editWorkbookNoteText}
          onMoveWorkbookNote={moveWorkbookNote}
          onRemoveWorkbookNote={removeWorkbookNote}
        />
      </>) : (<>

        {/* ── Column 1: Task/Workbook Pool ──
            Durante il blocco Pomodoro resta visibile ma del tutto non
            interagibile: solo il task già aperto nel pannello Dettagli
            si può modificare. */}
        <div className={`planner-pool${mobileTab === 'pool' ? ' mobile-active' : ''}${locked ? ' locked' : ''}`} style={{ width: poolWidth }}>
          <div className="planner-col-header">
            <span>Pannello</span>
            <div className="planner-view-toggle">
              <button className={poolMode === 'task' ? 'active' : ''} onClick={() => setPoolMode('task')}>Task</button>
              <button className={poolMode === 'workbook' ? 'active' : ''} onClick={() => setPoolMode('workbook')}>Workbook</button>
            </div>
          </div>
          {poolMode === 'task' ? (
            <TaskPool
              title="Task"
              tasks={preloadedTasks}
              config={config}
              notebooks={notebooks}
              sectionsMap={sectionsMap}
              scheduledIds={scheduledIds}
              selectedTaskId={selectedTask?.id ?? null}
              draggable={!locked}
              onTaskClick={locked ? undefined : task => { setSelectedTask(task); setMobileTab('panel'); }}
            />
          ) : (
            <WorkbookPool workbooks={workbooks} onChange={persistWorkbooks} draggable={!locked} notebooks={notebooks} stats={workbookMinuteStats} />
          )}
        </div>

        <div className="planner-col-resize" onMouseDown={handlePoolResizeStart} title="Ridimensiona" />
        {/* ── Column 2: Timeline ── */}
        <div className={`planner-timeline${mobileTab === 'timeline' ? ' mobile-active' : ''}`}>
          <div className="planner-col-header">
            <span>
              {new Date(currentDate + 'T12:00:00').toLocaleDateString('it-IT', {
                weekday: 'short', day: 'numeric', month: 'short',
              })}
            </span>
            <span className="planner-timeline-hint">Trascina qui i task →</span>
          </div>
          {calOutOfRange && (
            <div className="planner-cal-outofrange">
              📅 Calendario non caricato oltre i 3 mesi dalla data odierna
            </div>
          )}
          {allDayEvents.length > 0 && (
            <div className="planner-allday-strip">
              {allDayEvents.map((ev, i) => (
                <span key={i} className="planner-allday-chip" onClick={() => openEditEventModal(ev)} title={ev.subject}>{ev.subject}</span>
              ))}
            </div>
          )}
          <div
            ref={timelineBodyRef}
            className="planner-timeline-body"
            onDragOver={handleTimelineDragOver}
            onDrop={handleTimelineDrop}
            onDragLeave={e => {
              if (!timelineBodyRef.current?.contains(e.relatedTarget)) setDragOverTime(null);
            }}
            onClick={handleTimelineClick}>

            {/* Colonna Pomodoro: totale giornaliero in alto + fasce orarie reali,
                modificabili — clic su uno spazio vuoto ne aggiunge una nuova. */}
            <div
              className="planner-focus-column"
              style={{ height: timeSlots.length * SLOT_HEIGHT }}
              onClick={handleFocusColumnClick}
              title="Clic per aggiungere una fascia Pomodoro" />
            <div className="planner-focus-daytotal" title="Totale concentrazione Pomodoro">
              <span>🍅</span>
              <span>{fmtFocusTotal(dayFocusMinutes)}</span>
            </div>
            {(pomodoroStatsMap[currentDate]?.sessions || []).map((s, i) => {
              const sStart = new Date(s.start);
              const sEnd   = new Date(s.end);
              const startMin = sStart.getHours() * 60 + sStart.getMinutes();
              const endMin   = sEnd.getHours() * 60 + sEnd.getMinutes();
              const top    = Math.max(0, (Math.max(startMin, DAY_START_MIN) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
              const height = Math.max(3, (Math.min(endMin, DAY_END_MIN) - Math.max(startMin, DAY_START_MIN)) / 30 * SLOT_HEIGHT);
              const type = s.type || 'focus';
              return (
                <div
                  key={`focus-${i}`}
                  className={`planner-focus-bar editable ${type}`}
                  style={{ top, height }}
                  title={`${isoToHHMM(s.start)}–${isoToHHMM(s.end)} · ${SESSION_TYPE_LABELS[type] || SESSION_TYPE_LABELS.focus} · trascina per spostare, clic per modificare`}
                  onMouseDown={e => handleFocusSessionMouseDown(e, i, 'move')}>
                  <div
                    className="planner-focus-bar-handle top"
                    onMouseDown={e => handleFocusSessionMouseDown(e, i, 'resize-start')} />
                  <div
                    className="planner-focus-bar-handle bottom"
                    onMouseDown={e => handleFocusSessionMouseDown(e, i, 'resize-end')} />
                </div>
              );
            })}
            {/* Fascia ancora aperta: cresce live verso "adesso" invece di comparire solo a fascia chiusa */}
            {activeInterval && localDateStr(new Date(activeInterval.start)) === currentDate && (() => {
              const sStart = new Date(activeInterval.start);
              const startMin = sStart.getHours() * 60 + sStart.getMinutes();
              const nowD = new Date(nowTick);
              const endMin = nowD.getHours() * 60 + nowD.getMinutes();
              const top    = Math.max(0, (Math.max(startMin, DAY_START_MIN) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
              const height = Math.max(3, (Math.min(endMin, DAY_END_MIN) - Math.max(startMin, DAY_START_MIN)) / 30 * SLOT_HEIGHT);
              const type = activeInterval.type || 'focus';
              const startHHMM = `${String(sStart.getHours()).padStart(2, '0')}:${String(sStart.getMinutes()).padStart(2, '0')}`;
              return (
                <div
                  key="focus-live"
                  className={`planner-focus-bar live ${type}`}
                  style={{ top, height }}
                  title={`${startHHMM}– · ${SESSION_TYPE_LABELS[type] || SESSION_TYPE_LABELS.focus}`} />
              );
            })()}
            {/* Linea dell'ora corrente — solo sul giorno di oggi */}
            {currentDate === todayStr() && (() => {
              const nowD = new Date(nowTick);
              const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
              const top = (nowMin - DAY_START_MIN) / 30 * SLOT_HEIGHT;
              return <div className="planner-now-line" style={{ top }} />;
            })()}

            {/* Slot grid lines (also define total height) */}
            {timeSlots.map(slot => (
              <div
                key={slot}
                className={`planner-slot${dragOverTime === slot ? ' drag-over' : ''}`}
                style={{ height: SLOT_HEIGHT }}>
                <span className="planner-slot-time">{slot}</span>
                <div className="planner-slot-line" />
              </div>
            ))}

            {/* Workbook blocks — stessa bozza "a spettro ampio" trascinata in vista
                Settimana, visibile anche qui così non serve passare a Settimana per
                vederla. Sotto (z-index 0) a task/eventi come nella griglia settimanale;
                spenta insieme quando il calendario sintetico "Workbook" è disattivato. */}
            {!workbookCalHidden && dayWorkbookPlan.blocks.map(wb => {
              const top    = Math.max(0, (t2m(wb.startTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
              const height = Math.max(SLOT_HEIGHT - 4, (t2m(wb.endTime) - t2m(wb.startTime)) / 30 * SLOT_HEIGHT - 4);
              const wbColor = liveWorkbookColor(wb, workbooks);
              const isVertical  = (t2m(wb.endTime) - t2m(wb.startTime)) > VERTICAL_LAYOUT_MIN_DURATION;
              const titleLayout = isVertical ? verticalTitleLayout(wb.label, height - 12 - VERTICAL_DURATION_RESERVE_PX, 11) : null;
              const notesEls = (wb.notes || []).map(note => (
                <WorkbookBlockNote
                  key={note.id}
                  note={note}
                  blockHeight={height}
                  locked={locked}
                  onChange={text => editWorkbookNoteText(currentDate, wb.id, note.id, text)}
                  onMove={noteTop => moveWorkbookNote(currentDate, wb.id, note.id, noteTop)}
                  onRemove={() => removeWorkbookNote(currentDate, wb.id, note.id)}
                />
              ));
              return (
                <div key={wb.id}
                  className={`planner-day-workbook-block${isVertical ? ' vertical-layout' : ''}`}
                  style={{ top: top + 2, height, background: hexToRgba(wbColor, 0.28), borderLeftColor: wbColor }}
                  title={`${wb.startTime}–${wb.endTime} · ${wb.label} (trascina per spostare, Ctrl+trascina per duplicare, doppio clic per una nota)`}
                  draggable={!locked && dayResizingWbId !== wb.id}
                  onClick={e => e.stopPropagation()}
                  onDragStart={e => {
                    if (e.target.closest('.planner-block-note')) { e.preventDefault(); return; }
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekworkbookblock', blockId: wb.id, fromDay: currentDate, copy: e.ctrlKey || e.metaKey }));
                  }}
                  onDoubleClick={e => {
                    if (locked || e.target.closest('.planner-block-note')) return;
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const noteTop = Math.max(0, Math.min(height - 22, e.clientY - rect.top));
                    addWorkbookNote(currentDate, wb.id, noteTop);
                  }}>
                  {isVertical ? (
                    <>
                      <div className="planner-block-label-col">
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={wb.label} layout={titleLayout} className="planner-block-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(t2m(wb.endTime) - t2m(wb.startTime))}</span>
                      </div>
                      <div className="planner-block-content-col">{notesEls}</div>
                    </>
                  ) : (
                    <>
                      <span className="planner-block-title">{wb.label}</span>
                      {notesEls}
                    </>
                  )}
                  {!locked && (
                    <button
                      className="planner-week-workbook-block-remove"
                      onClick={e => { e.stopPropagation(); handleRemoveWorkbookBlock(currentDate, wb.id); }}
                      title="Elimina">×</button>
                  )}
                  {!locked && (
                    <div
                      className="planner-block-resize"
                      onMouseDown={e => handleDayWorkbookResizeStart(e, wb)} />
                  )}
                </div>
              );
            })}

            {/* Calendar events — absolute, editabili al click */}
            {timedEvents.map((ev, i) => {
              const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
              const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
              if (!evStart || !evEnd) return null;
              const evStartMin = t2m(evStart);
              const evEndMin   = t2m(evEnd);
              const top    = Math.max(0, (evStartMin - DAY_START_MIN) / 30 * SLOT_HEIGHT);
              const height = Math.max(SLOT_HEIGHT / 2, (Math.min(evEndMin, DAY_END_MIN) - Math.max(evStartMin, DAY_START_MIN)) / 30 * SLOT_HEIGHT);
              const evColor = calendarSwatch(ev._calColor);
              const isVertical  = (evEndMin - evStartMin) > VERTICAL_LAYOUT_MIN_DURATION;
              const titleLayout = isVertical ? verticalTitleLayout(ev.subject, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
              return (
                <div
                  key={`cal-${i}`}
                  className={`planner-cal-event${ev._isShared ? ' shared' : ''}${isVertical ? ' vertical-layout' : ''}`}
                  style={{ top, height, background: evColor, borderLeftColor: evColor }}
                  draggable={!locked}
                  onDragStart={e => {
                    // L'evento non si sposta trascinando (solo dal modale di
                    // modifica): senza Ctrl/Cmd annulla il drag nativo, così un
                    // trascinamento accidentale non fa nulla — il gesto esiste
                    // solo per la copia.
                    if (!(e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({
                      type: 'calevent-copy', calId: ev._calId || null, subject: ev.subject, durationMin: evEndMin - evStartMin,
                    }));
                  }}
                  onClick={e => { e.stopPropagation(); openEditEventModal(ev); }}
                  title={`${evStart}–${evEnd} · ${ev.subject}${ev._calName ? ` (${ev._calName})` : ''} — clicca per modificare, Ctrl+trascina per duplicare`}>
                  {isVertical ? (
                    <>
                      <div className="planner-block-label-col">
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={ev.subject} layout={titleLayout} className="planner-event-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(evEndMin - evStartMin)}</span>
                      </div>
                      <div className="planner-block-content-col" />
                    </>
                  ) : (
                    <>
                      <span className="planner-event-time">{evStart}–{evEnd}</span>
                      <span className="planner-event-title">{ev.subject}</span>
                    </>
                  )}
                </div>
              );
            })}

            {/* Task blocks — absolute, draggable */}
            {todayPlan.blocks.map(block => {
              const startMin = t2m(block.startTime);
              const endMin   = t2m(block.endTime);
              const top      = Math.max(0, (startMin - DAY_START_MIN) / 30 * SLOT_HEIGHT);
              const height   = Math.max(SLOT_HEIGHT - 4, (endMin - startMin) / 30 * SLOT_HEIGHT - 4);
              const isVertical  = (endMin - startMin) > VERTICAL_LAYOUT_MIN_DURATION;
              const titleLayout = isVertical ? verticalTitleLayout(block.taskTitle, height - (block.listName ? 34 : 12) - VERTICAL_DURATION_RESERVE_PX, 11) : null;
              const checkBtn = (
                <button
                  className="planner-block-check"
                  style={{ color: block.completed ? '#86c07a' : block.projectColor }}
                  onClick={() => handleCompleteBlock(block.id)}
                  disabled={locked}
                  title="Segna come completato">
                  {block.completed ? '✓' : '○'}
                </button>
              );
              const actionsBtns = (
                <div className="planner-block-actions">
                  <button className="planner-block-btn" onClick={() => handleBreakdownTask(block)} disabled={locked} title="Scomponi in sottostep">🔀</button>
                  <button className="planner-block-btn" onClick={() => handleRemoveBlock(block.id)} disabled={locked} title="Rimuovi">✕</button>
                </div>
              );
              const subStepsOverlay = block.subSteps?.length > 0 ? (() => {
                const n = block.subSteps.length;
                const splits = block.subSplits?.length === n - 1
                  ? block.subSplits
                  : Array.from({ length: n - 1 }, (_, k) => (k + 1) / n);
                return (
                  <div className="planner-substep-overlay">
                    {block.subSteps.map((s, i) => {
                      const topFrac = i === 0 ? 0 : splits[i - 1];
                      const btmFrac = i === n - 1 ? 1 : splits[i];
                      const subTop    = topFrac * height;
                      const subHeight = (btmFrac - topFrac) * height;
                      return (
                        <div
                          key={s.id}
                          className={`planner-substep-zone${s.completed ? ' done' : ''}`}
                          style={{ top: subTop, height: subHeight }}>
                          <span className="planner-substep-label">{s.title}</span>
                          {i < n - 1 && !locked && (
                            <div
                              className="planner-substep-divider"
                              onMouseDown={ev => handleSubSplitResizeStart(ev, block, i, height)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })() : null;
              return (
                <Fragment key={block.id}>
                <div
                  className={`planner-block${block.completed ? ' completed' : ''}${isVertical ? ' vertical-layout' : ''}`}
                  style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: block.projectColor }}
                  draggable={!locked && !block.completed && resizingId !== block.id}
                  onClick={e => {
                    e.stopPropagation();
                    if (block.taskId && block.listId) {
                      setSelectedTask({ id: block.taskId, title: block.taskTitle, _listId: block.listId, _listName: block.listName });
                      setMobileTab('panel');
                    }
                  }}
                  onDragStart={locked ? undefined : e => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'block', blockId: block.id, copy: e.ctrlKey || e.metaKey }));
                  }}>
                  {isVertical ? (
                    <>
                      <div className="planner-block-label-col">
                        {block.listName && <span className="planner-block-label-section">{block.listName}</span>}
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={block.taskTitle} layout={titleLayout} className="planner-block-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(endMin - startMin)}</span>
                      </div>
                      <div className="planner-block-content-col">
                        <div className="planner-block-header planner-block-header--compact">
                          {checkBtn}
                          {actionsBtns}
                        </div>
                        {subStepsOverlay}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="planner-block-header">
                        {checkBtn}
                        <span className="planner-block-title">{block.taskTitle}</span>
                        {actionsBtns}
                      </div>
                      <div className="planner-block-meta">
                        <span>{block.startTime}–{block.endTime}</span>
                        {block.listName && <span>{block.listName}</span>}
                      </div>
                      {subStepsOverlay}
                    </>
                  )}
                  {!block.completed && !locked && (
                    <div className="planner-block-resize" onMouseDown={e => handleResizeStart(e, block)} />
                  )}
                </div>
                </Fragment>
              );
            })}

            {/* Drop indicator */}
            {dragOverTime && (
              <div
                className="planner-drop-indicator"
                style={{
                  top:    (t2m(dragOverTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT,
                  height: SLOT_HEIGHT * 2,
                }} />
            )}
          </div>
        </div>

        <div className="planner-col-resize" onMouseDown={handleAiResizeStart} title="Ridimensiona" />
        {/* ── Column 3: Detail Panel ── */}
        <div className={`planner-ai-panel${mobileTab === 'panel' ? ' mobile-active' : ''}`} style={{ width: aiWidth }}>
          <div className="planner-col-header">
            <span>📋 Dettagli</span>
            <span className={`planner-save-status ${saveStatus}`}>{saveLabel()}</span>
          </div>
          <div className={`planner-ai-body${pomodoroActive ? ' pomodoro-clearance' : ''}`}>
            {selectedTask ? (
              <TaskDetailPanel
                task={selectedTask}
                notebooks={notebooks}
                sectionsMap={sectionsMap}
                pagesCache={pagesCache}
                onClose={() => setSelectedTask(null)}
                onCompleted={() => { onTaskCompleted?.(selectedTask._listId, selectedTask.id); setSelectedTask(null); }}
                onDeleted={() => { onTaskDeleted?.(selectedTask._listId, selectedTask.id); setSelectedTask(null); }}
                onRenamed={title => { onTaskRenamed?.(selectedTask._listId, selectedTask.id, title); setSelectedTask(prev => prev && ({ ...prev, title })); }}
                onDueChanged={dueDateTime => onTaskDueChanged?.(selectedTask._listId, selectedTask.id, dueDateTime)}
                onRestored={(listId, restoredTask) => onTaskRestored?.(listId, restoredTask)}
              />
            ) : (
              <div className="planner-detail-empty">
                <p>Clicca un task nel pool per vedere note e sottoattività.</p>
              </div>
            )}
          </div>
        </div>
      </>)}
      </div>

      {/* Breakdown modal */}
      {breakdownModal && (
        <div className="planner-modal-overlay" onClick={() => setBreakdownModal(null)}>
          <div className="planner-modal" onClick={e => e.stopPropagation()}>
            <div className="planner-modal-header">
              <span>Sottoattività: {breakdownModal.block.taskTitle}</span>
              <button onClick={() => setBreakdownModal(null)}>✕</button>
            </div>
            <div className="planner-modal-body">
              {breakdownModal.loading && (
                <div className="planner-modal-loading">Caricamento sottoattività…</div>
              )}
              {!breakdownModal.loading && breakdownModal.noTask && (
                <div className="planner-modal-loading" style={{ color: 'var(--muted)' }}>
                  Questo blocco non è collegato a un task To-Do.
                </div>
              )}
              {!breakdownModal.loading && breakdownModal.error && (
                <div className="planner-modal-loading" style={{ color: '#c07a7a' }}>
                  Errore durante il caricamento. Riprova.
                </div>
              )}
              {!breakdownModal.loading && breakdownModal.items && !breakdownModal.noTask && (
                breakdownModal.items.length === 0 ? (
                  <div className="planner-modal-loading">Nessuna sottoattività nel task.</div>
                ) : (
                  <>
                    <div className="planner-modal-hint">Seleziona le sottoattività da mostrare nel blocco:</div>
                    {breakdownModal.items.map((item, i) => (
                      <div
                        key={item.id}
                        className={`planner-modal-step selectable${item.selected ? ' selected' : ''}${item.isChecked ? ' done' : ''}`}
                        onClick={() => setBreakdownModal(prev => ({
                          ...prev,
                          items: prev.items.map((it, j) => j === i ? { ...it, selected: !it.selected } : it),
                        }))}>
                        <span className="planner-modal-check">{item.selected ? '☑' : '☐'}</span>
                        <span className="planner-modal-step-text">{item.displayName}</span>
                        {item.isChecked && <span className="planner-modal-done-badge">✓</span>}
                      </div>
                    ))}
                    <button
                      className="planner-modal-apply-btn"
                      onClick={() => applyBreakdown(breakdownModal.items)}>
                      Applica al blocco ({breakdownModal.items.filter(i => i.selected).length} selezionate)
                    </button>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/edit calendar event modal */}
      {calModal && (
        <CalendarEventModal
          mode={calModal.mode}
          event={calModal.event}
          defaultDate={calModal.defaultDate}
          defaultStartTime={calModal.defaultStartTime}
          defaultEndTime={calModal.defaultEndTime}
          calendars={calendarsList}
          onClose={() => setCalModal(null)}
          onSave={handleSaveCalEvent}
          onDelete={handleDeleteCalEvent}
        />
      )}

      {/* Menu di modifica/aggiunta di una fascia della colonna Pomodoro */}
      {focusPopup && (
        <FocusSessionPopup
          popup={focusPopup}
          onPickType={type => focusPopup.mode === 'edit'
            ? changeFocusSessionType(focusPopup.idx, type)
            : addFocusSession(focusPopup.startMin, type)}
          onDelete={focusPopup.mode === 'edit' ? () => deleteFocusSession(focusPopup.idx) : null}
          onClose={() => setFocusPopup(null)}
        />
      )}
    </div>

    {/* Pulsante volante per avviare il Pomodoro, a fianco del "+" dorato GTD:
        solo indicatore di concentrazione, scollegato da qualunque task. */}
    {open && !pomodoroActive && (
      <button
        className="pomodoro-fab"
        onClick={() => { setPomodoroActive(true); setPomodoroRunning(true); onStartFocus?.(); }}
        title="Avvia Pomodoro">🍅</button>
    )}

    {/* Renderizzato fuori dal contenitore nascosto via CSS: resta visibile e
        attivo (interval del timer, statistiche) anche quando il Piano è
        chiuso e si passa alla modalità focus. */}
    {pomodoroActive && (
      <PomodoroTimer
        onClose={() => { setPomodoroActive(false); setActiveInterval(null); onEndFocus?.(); }}
        onCycleComplete={recordPomodoroSession}
        onSessionClosed={recordSessionClosed}
        onActiveIntervalChange={setActiveInterval}
        onRunningChange={running => {
          setPomodoroRunning(running);
          if (running) onStartFocus?.();
          else onEndFocus?.();
        }}
      />
    )}
    </>
  );
}

// ── FocusSessionPopup ─────────────────────────────────────────────────────────
// Piccolo menu ancorato al punto cliccato: sceglie/cambia il tipo di una
// fascia Pomodoro (lavoro o uno dei tre tipi di pausa) e, per una fascia
// esistente, permette di cancellarla. Un backdrop trasparente a tutto
// schermo chiude il menu al clic fuori, come i pop-up del diagramma GTD.
function FocusSessionPopup({ popup, onPickType, onDelete, onClose }) {
  const width = 180, height = onDelete ? 190 : 150;
  const left = Math.min(Math.max(8, popup.x + 10), window.innerWidth - width - 8);
  const top  = Math.min(Math.max(8, popup.y - height / 2), window.innerHeight - height - 8);

  return (
    <>
      <div className="planner-focus-popup-backdrop" onClick={onClose} />
      <div className="planner-focus-popup" style={{ left, top }} onClick={e => e.stopPropagation()}>
        <div className="planner-focus-popup-title">
          {popup.mode === 'edit' ? 'Cambia tipo fascia' : 'Aggiungi fascia'}
        </div>
        <div className="planner-focus-popup-types">
          {FOCUS_SESSION_TYPES.map(type => (
            <button
              key={type}
              className={`planner-focus-popup-type ${type}`}
              onClick={() => onPickType(type)}>
              {SESSION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        {onDelete && (
          <button className="planner-focus-popup-delete" onClick={onDelete}>🗑 Elimina fascia</button>
        )}
      </div>
    </>
  );
}

// ── CalendarEventModal ────────────────────────────────────────────────────────
// Crea o modifica un evento su uno qualsiasi dei calendari collegati (non solo
// quello di default) — usato dal pulsante "+ Evento" e dal click su un evento
// nella Timeline, in Settimana o in Mese.
function CalendarEventModal({ mode, event, defaultDate, defaultStartTime, defaultEndTime, calendars, onClose, onSave, onDelete }) {
  const defaultCalId = calendars.find(c => c.isDefaultCalendar)?.id || calendars[0]?.id || '';
  const eventIsAllDay = event ? isAllDay(event) : false;

  const [calendarId, setCalendarId] = useState(event?._calId ?? '');
  const [subject, setSubject]       = useState(event?.subject || '');
  const [allDay, setAllDay]         = useState(eventIsAllDay);
  const [date, setDate]             = useState(
    event ? (event.start?.dateTime || event.start?.date || '').slice(0, 10) : (defaultDate || todayStr())
  );
  const [startTime, setStartTime]   = useState(event && !eventIsAllDay ? isoToHHMM(event.start?.dateTime) : (defaultStartTime || '09:00'));
  const [endTime, setEndTime]       = useState(event && !eventIsAllDay ? isoToHHMM(event.end?.dateTime) : (defaultEndTime || '10:00'));
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  // Se i calendari arrivano dopo l'apertura del modale (rete lenta), il valore
  // effettivo ricade sul default appena disponibile invece di restare vuoto.
  const effectiveCalendarId = calendarId || defaultCalId;

  const canSubmit = subject.trim() && date && effectiveCalendarId && (allDay || (startTime && endTime && startTime < endTime));

  function openPicker(e) {
    try { e.target.showPicker?.(); } catch { /* alcuni browser/contesti lo rifiutano */ }
  }

  async function handleSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        calendarId: effectiveCalendarId,
        subject: subject.trim(),
        startDate: date,
        endDate: date,
        startTime: allDay ? null : startTime,
        endTime: allDay ? null : endTime,
      });
    } catch (e) {
      console.error('cal event save', e);
      setError(e?.message ? `Errore nel salvataggio: ${e.message}` : 'Errore nel salvataggio dell’evento');
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onDelete();
    } catch (e) {
      console.error('cal event delete', e);
      setError(e?.message ? `Errore nell’eliminazione: ${e.message}` : 'Errore nell’eliminazione dell’evento');
      setBusy(false);
    }
  }

  return (
    <div className="planner-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="planner-modal" onClick={e => e.stopPropagation()}>
        <div className="planner-modal-header">
          <span>{mode === 'edit' ? 'Modifica evento' : 'Nuovo evento'}</span>
          <button onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="planner-modal-body planner-event-form">
          <label className="planner-modal-field">
            <span>Calendario</span>
            <select className="planner-modal-select" value={effectiveCalendarId} onChange={e => setCalendarId(e.target.value)}>
              {calendars.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.isDefaultCalendar ? ' (predefinito)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="planner-modal-field">
            <span>Titolo</span>
            <input
              className="planner-modal-select"
              type="text"
              autoFocus
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Titolo evento"
            />
          </label>
          <label className="planner-modal-field">
            <span>Data</span>
            <input className="planner-modal-select" type="date" value={date} onChange={e => setDate(e.target.value)} onClick={openPicker} />
          </label>
          <label className="planner-modal-checkbox-field">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
            <span>Tutto il giorno</span>
          </label>
          {!allDay && (
            <div className="planner-event-time-row">
              <label className="planner-modal-field">
                <span>Inizio</span>
                <input className="planner-modal-select" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} onClick={openPicker} />
              </label>
              <label className="planner-modal-field">
                <span>Fine</span>
                <input className="planner-modal-select" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} onClick={openPicker} />
              </label>
            </div>
          )}
          {error && <div className="planner-modal-error">{error}</div>}
          <div className="planner-event-form-actions">
            {mode === 'edit' && (
              <button className="planner-event-delete-btn" disabled={busy} onClick={handleDelete}>Elimina</button>
            )}
            <button className="planner-modal-apply-btn" disabled={!canSubmit || busy} onClick={handleSubmit}>
              {busy ? '…' : (mode === 'edit' ? 'Salva modifiche' : 'Crea evento')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TaskDetailPanel ───────────────────────────────────────────────────────────
function TaskDetailPanel({ task, notebooks = [], sectionsMap = {}, pagesCache = null, onClose, onCompleted, onDeleted, onRenamed, onDueChanged, onRestored }) {
  const [loading, setLoading]         = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft]   = useState(task.title);
  const [working, setWorking]         = useState(false);
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState([]);
  const [newItemText, setNewItemText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemDraft, setItemDraft]     = useState('');
  const [reordering, setReordering]   = useState(false);
  const dragIndexRef                  = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const notesTimerRef                 = useRef(null);
  const [dueDraft, setDueDraft]       = useState('');
  const [savingDue, setSavingDue]     = useState(false);
  const [itemError, setItemError]     = useState('');

  // Sezione OneNote collegata alla lista ToDo del task (per nome, come nel
  // resto dell'app) — usata per mostrare qui sotto i riquadri OneNote/OneDrive.
  const { section, notebook } = useMemo(() => {
    const lower = (task._listName || '').toLowerCase();
    if (!lower) return { section: null, notebook: null };
    for (const [nbId, sects] of Object.entries(sectionsMap)) {
      const sec = sects.find(s => s.displayName.toLowerCase() === lower);
      if (sec) return { section: sec, notebook: notebooks.find(n => n.id === nbId) || { id: nbId } };
    }
    return { section: null, notebook: null };
  }, [task._listName, notebooks, sectionsMap]);

  useEffect(() => { setTitleDraft(task.title); setEditingTitle(false); load(); }, [task.id]); // eslint-disable-line

  async function load() {
    setLoading(true);
    try {
      const full = await getTask(task._listId, task.id);
      let body = full.body?.content || '';
      if (full.body?.contentType === 'html') {
        body = body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      }
      setNotes(body);
      setItems((full.checklistItems || []).sort((a, b) => a.isChecked - b.isChecked));
      setDueDraft(full.dueDateTime?.dateTime ? full.dueDateTime.dateTime.slice(0, 10) : '');
    } catch (e) { console.error('load task detail', e); }
    setLoading(false);
  }

  async function handleDueChange(e) {
    const val = e.target.value;
    const prevVal = dueDraft;
    setDueDraft(val);
    setSavingDue(true);
    try {
      await updateTaskDueDate(task._listId, task.id, val || null);
      onDueChanged?.(val ? { dateTime: val, timeZone: 'UTC' } : null);
      if (prevVal !== val) {
        pushUndo({
          label: 'Scadenza task modificata',
          undo: async () => {
            await updateTaskDueDate(task._listId, task.id, prevVal || null);
            onDueChanged?.(prevVal ? { dateTime: prevVal, timeZone: 'UTC' } : null);
            setDueDraft(prevVal);
          },
        });
      }
    } catch (err) { console.error('save due date', err); }
    setSavingDue(false);
  }

  function handleNotesChange(e) {
    const val = e.target.value;
    setNotes(val);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setSavingNotes(true);
      try { await updateTaskBody(task._listId, task.id, val); } catch (e) { console.error('save notes', e); }
      setSavingNotes(false);
    }, 1200);
  }

  function flashItemError(action, e) {
    console.error(action, e);
    setItemError(`Errore: ${action} non riuscito${e?.message ? ` (${e.message})` : ''}. Riprova.`);
  }

  useEffect(() => {
    if (!itemError) return;
    const t = setTimeout(() => setItemError(''), 5000);
    return () => clearTimeout(t);
  }, [itemError]);

  async function handleToggle(item) {
    const checked = !item.isChecked;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: checked } : i));
    try {
      await updateChecklistItem(task._listId, task.id, item.id, checked);
      pushUndo({
        label: `"${item.displayName}" ${checked ? 'spuntata' : 'da fare'}`,
        undo: async () => {
          await updateChecklistItem(task._listId, task.id, item.id, !checked);
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: !checked } : i));
        },
      });
    } catch (e) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: !checked } : i));
      flashItemError('spunta checklist', e);
    }
  }

  async function handleDelete(itemId) {
    const removed = items.find(i => i.id === itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await deleteChecklistItem(task._listId, task.id, itemId);
      if (removed) {
        pushUndo({
          label: `Voce "${removed.displayName}" eliminata`,
          undo: async () => {
            const created = await createChecklistItem(task._listId, task.id, removed.displayName);
            if (removed.isChecked) await updateChecklistItem(task._listId, task.id, created.id, true);
            setItems(prev => [...prev, { ...created, isChecked: !!removed.isChecked }]);
          },
        });
      }
    } catch (e) {
      if (removed) setItems(prev => [...prev, removed]);
      flashItemError('eliminazione voce', e);
    }
  }

  async function handleAdd(formEvent) {
    formEvent.preventDefault();
    const text = newItemText.trim();
    if (!text) return;
    setNewItemText('');
    const tmp = { id: `tmp-${Date.now()}`, displayName: text, isChecked: false };
    setItems(prev => [...prev, tmp]);
    try {
      const created = await createChecklistItem(task._listId, task.id, text);
      setItems(prev => prev.map(i => i.id === tmp.id ? created : i));
      pushUndo({
        label: `Voce "${text}" aggiunta`,
        undo: async () => {
          await deleteChecklistItem(task._listId, task.id, created.id);
          setItems(prev => prev.filter(i => i.id !== created.id));
        },
      });
    } catch (err) {
      setItems(prev => prev.filter(i => i.id !== tmp.id));
      setNewItemText(text);
      flashItemError('aggiunta voce', err);
    }
  }

  function startItemRename(item) {
    setEditingItemId(item.id);
    setItemDraft(item.displayName);
  }

  async function submitItemRename() {
    const item = items.find(i => i.id === editingItemId);
    setEditingItemId(null);
    const text = itemDraft.trim();
    if (!item || !text || text === item.displayName) return;
    const prevName = item.displayName;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: text } : i));
    try {
      await renameChecklistItem(task._listId, task.id, item.id, text);
      pushUndo({
        label: `Voce rinominata in "${text}"`,
        undo: async () => {
          await renameChecklistItem(task._listId, task.id, item.id, prevName);
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: prevName } : i));
        },
      });
    } catch (e) {
      console.error('rename checklist item', e);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: item.displayName } : i));
    }
  }

  async function persistReorder(reordered) {
    setItems(reordered);
    setReordering(true);
    try {
      const created = await reorderChecklistItems(task._listId, task.id, reordered);
      setItems(created.sort((a, b) => a.isChecked - b.isChecked));
    } catch (e) {
      console.error('reorder checklist items', e);
      await load();
    }
    setReordering(false);
  }

  function moveItem(index, dir) {
    const next = index + dir;
    if (next < 0 || next >= items.length || reordering) return;
    const reordered = [...items];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    persistReorder(reordered);
  }

  function handleItemDrop(index) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from === null || from === index || reordering) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);
    persistReorder(reordered);
  }

  function submitRename() {
    const title = titleDraft.trim();
    const prevTitle = task.title;
    setEditingTitle(false);
    if (!title || title === task.title) { setTitleDraft(task.title); return; }
    setTitleDraft(title);
    updateTaskTitle(task._listId, task.id, title)
      .then(() => {
        onRenamed?.(title);
        pushUndo({
          label: `Task rinominato in "${title}"`,
          undo: async () => {
            await updateTaskTitle(task._listId, task.id, prevTitle);
            onRenamed?.(prevTitle);
            setTitleDraft(prevTitle);
          },
        });
      })
      .catch(e => { console.error('rename task', e); setTitleDraft(task.title); });
  }

  async function handleCompleteTask() {
    setWorking(true);
    try {
      await completeTask(task._listId, task.id);
      const snapshot = { ...task };
      onCompleted?.();
      pushUndo({
        label: `Task "${task.title}" completato`,
        undo: async () => {
          await updateTaskStatus(task._listId, task.id, 'notStarted');
          onRestored?.(task._listId, snapshot);
        },
      });
    } catch (e) { console.error('complete task', e); }
    setWorking(false);
  }

  async function handleDeleteTask() {
    if (!window.confirm(`Eliminare il task "${task.title}"? Potrai annullare subito dopo con Ctrl+Z.`)) return;
    setWorking(true);
    // Snapshot completo (titolo, scadenza, note, checklist) per poter
    // ricreare il task in caso di undo — Graph non offre un "ripristina".
    const snapshot = {
      title: task.title,
      listId: task._listId,
      listName: task._listName,
      dueDate: dueDraft || null,
      body: notes || '',
      items: items.map(i => ({ displayName: i.displayName, isChecked: !!i.isChecked })),
    };
    try {
      await deleteTask(task._listId, task.id);
      onDeleted?.();
      pushUndo({
        label: `Task "${snapshot.title}" eliminato`,
        undo: async () => {
          const created = await createTask(snapshot.listId, snapshot.title, {
            body: snapshot.body || undefined,
            dueDate: snapshot.dueDate || undefined,
          });
          for (const it of snapshot.items) {
            const ci = await createChecklistItem(snapshot.listId, created.id, it.displayName);
            if (it.isChecked) await updateChecklistItem(snapshot.listId, created.id, ci.id, true);
          }
          onRestored?.(snapshot.listId, { ...created, _listId: snapshot.listId, _listName: snapshot.listName });
        },
      });
    } catch (e) { console.error('delete task', e); }
    setWorking(false);
  }

  return (
    <div className="planner-task-detail">
      <div className="planner-task-detail-header">
        {editingTitle ? (
          <input
            autoFocus
            className="planner-task-detail-title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); }
            }}
          />
        ) : (
          <div className="planner-task-detail-title" onClick={() => setEditingTitle(true)} title="Clicca per rinominare">
            {task.title}
          </div>
        )}
        <div className="planner-task-detail-meta">{task._listName}</div>
        <div className="planner-task-detail-due">
          <span>📅 Scadenza</span>
          <input
            type="date"
            className="planner-task-detail-due-input"
            value={dueDraft}
            onChange={handleDueChange}
          />
          {savingDue && <span className="planner-saving-dot">●</span>}
        </div>
        <div className="planner-task-detail-header-actions">
          <button className="planner-task-detail-action" onClick={() => setEditingTitle(true)} disabled={working} title="Rinomina">✎</button>
          <button className="planner-task-detail-action" onClick={handleCompleteTask} disabled={working} title="Segna come completato">✓</button>
          <button className="planner-task-detail-action danger" onClick={handleDeleteTask} disabled={working} title="Elimina task">🗑</button>
        </div>
        <button className="planner-task-detail-close" onClick={onClose} title="Chiudi">✕</button>
      </div>

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Note {savingNotes && <span className="planner-saving-dot">●</span>}
            </div>
            <textarea
              className="planner-task-detail-notes"
              value={notes}
              onChange={handleNotesChange}
              placeholder="Nessuna nota…"
              rows={4}
            />
          </div>

          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">Sottoattività ({items.length})</div>
            {items.map((item, index) => (
              <div
                key={item.id}
                className={`planner-checklist-item${item.isChecked ? ' checked' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
                draggable
                onDragStart={() => { dragIndexRef.current = index; }}
                onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
                onDragLeave={() => setDragOverIndex(prev => prev === index ? null : prev)}
                onDrop={e => { e.preventDefault(); handleItemDrop(index); }}
                onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}>
                <span className="planner-checklist-handle" title="Trascina per riordinare">⠿</span>
                <button className="planner-checklist-check" onClick={() => handleToggle(item)}>
                  {item.isChecked ? '✓' : '○'}
                </button>
                {editingItemId === item.id ? (
                  <input
                    autoFocus
                    className="planner-checklist-input planner-checklist-edit-input"
                    value={itemDraft}
                    onChange={e => setItemDraft(e.target.value)}
                    onBlur={submitItemRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitItemRename();
                      if (e.key === 'Escape') setEditingItemId(null);
                    }}
                  />
                ) : (
                  <span className="planner-checklist-text" onClick={() => startItemRename(item)} title="Clicca per rinominare">
                    {item.displayName}
                  </span>
                )}
                <div className="planner-checklist-move">
                  <button className="planner-checklist-move-btn" onClick={() => moveItem(index, -1)} disabled={index === 0 || reordering} title="Sposta su">▲</button>
                  <button className="planner-checklist-move-btn" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1 || reordering} title="Sposta giù">▼</button>
                </div>
                <button className="planner-checklist-delete" onClick={() => handleDelete(item.id)}>✕</button>
              </div>
            ))}
            <form className="planner-checklist-add" onSubmit={handleAdd}>
              <input
                type="text"
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                placeholder="+ Nuova sottoattività"
                className="planner-checklist-input"
              />
              <button type="submit" className="planner-checklist-add-btn" disabled={!newItemText.trim()}>
                +
              </button>
            </form>
            {itemError && <div className="planner-checklist-error">{itemError}</div>}
          </div>

          <SectionResources section={section} notebook={notebook} pagesCache={pagesCache} />
        </>
      )}
    </div>
  );
}

// ── MonthlyCalendar ───────────────────────────────────────────────────────────
// Vista "Mese" della modalità piano: calendario mensile con eventi Outlook e
// blocchi pianificati. Cliccando un giorno si passa alla vista Giorno.
function MonthlyCalendar({ currentDate, plans, calEvents, calOutOfRange, onDayClick, onEventClick }) {
  const today = todayStr();
  const d = new Date(currentDate + 'T12:00:00');
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  let dow = first.getDay() - 1; if (dow < 0) dow = 6;

  const cells = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(localDateStr(new Date(d.getFullYear(), d.getMonth(), day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  // Eventi indicizzati per giorno (calEvents è già filtrato sul mese corrente)
  const eventsByDay = {};
  for (const ev of calEvents) {
    const key = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
    if (!key) continue;
    (eventsByDay[key] ||= []).push(ev);
  }

  const MAX_ITEMS = 4;
  const DOW_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  return (
    <div className="planner-month-wrap">
      {calOutOfRange && (
        <div className="planner-cal-outofrange">
          📅 Calendario non caricato oltre i 3 mesi dalla data odierna
        </div>
      )}
      <div className="planner-month-head">
        {DOW_LABELS.map(l => <div key={l} className="planner-month-dow">{l}</div>)}
      </div>
      <div className="planner-month-grid">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="planner-month-cell empty" />;
          const dayEvents = eventsByDay[day] || [];
          const dayBlocks = (plans[day]?.blocks || []);
          const items = [
            ...dayEvents.map(ev => ({
              kind: 'event',
              title: ev.subject,
              time: isAllDay(ev) ? null : isoToHHMM(ev.start?.dateTime),
              color: calendarSwatch(ev._calColor),
              ev,
            })),
            ...dayBlocks.map(b => ({
              kind: 'block',
              title: b.taskTitle,
              time: b.startTime,
              color: b.projectColor,
              completed: b.completed,
            })),
          ];
          const shown = items.slice(0, MAX_ITEMS);
          const extra = items.length - shown.length;
          return (
            <div
              key={day}
              className={`planner-month-cell${day === today ? ' today' : ''}`}
              onClick={() => onDayClick(day)}
              title="Apri la vista Giorno">
              <span className="planner-month-daynum">{Number(day.slice(8))}</span>
              <div className="planner-month-items">
                {shown.map((it, j) => (
                  <div
                    key={j}
                    className={`planner-month-chip ${it.kind}${it.completed ? ' completed' : ''}`}
                    style={it.color ? { borderLeftColor: it.color } : undefined}
                    onClick={it.kind === 'event' ? e => { e.stopPropagation(); onEventClick(it.ev); } : undefined}
                    title={`${it.time ? it.time + ' · ' : ''}${it.title}`}>
                    {it.time && <span className="planner-month-chip-time">{it.time}</span>}
                    <span className="planner-month-chip-title">{it.title}</span>
                  </div>
                ))}
                {extra > 0 && <div className="planner-month-more">+{extra} altri</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── WeeklyTimeline ────────────────────────────────────────────────────────────
function WeeklyTimeline({
  weekDays, plans, calEvents, workbookPlans, workbooks, workbookCalHidden, workdayStartMin, timeSlots, locked, suppressClickRef,
  onDayClick, onMoveBlock, onCopyBlock, onEventClick, onCopyEvent, onAddTask, onCreateEvent,
  onAddWorkbookBlock, onMoveWorkbookBlock, onCopyWorkbookBlock, onRemoveWorkbookBlock, onResizeWorkbookBlockStart, onResizeBlockStart,
  onAddWorkbookNote, onEditWorkbookNote, onMoveWorkbookNote, onRemoveWorkbookNote,
}) {
  const today = todayStr();
  const [dragOver, setDragOver] = useState(null); // { day, min }
  // Mentre un workbook/task block è in resize disattiva il suo draggable (stesso
  // accorgimento di resizingId nella vista Giorno, handleResizeStart): senza
  // di questo il mousedown sulla maniglia di resize può essere interpretato
  // dal browser come inizio di un drag nativo invece che come resize.
  const [resizingWbId, setResizingWbId] = useState(null);
  const [resizingId, setResizingId] = useState(null);
  const weekBodyRef = useRef(null);
  // Larghezza reale della scrollbar verticale del corpo scorrevole: l'header e
  // la riga eventi "tutto il giorno" non scorrono e quindi non perdono questo
  // spazio, sfalsando le colonne giorno rispetto alla griglia sottostante se
  // non compensata (vedi useLayoutEffect sotto).
  const [scrollbarW, setScrollbarW] = useState(0);

  function handleWbResizeMouseDown(e, block, day) {
    setResizingWbId(block.id);
    onResizeWorkbookBlockStart(e, block, day);
    function clearResizing() {
      setResizingWbId(null);
      document.removeEventListener('mouseup', clearResizing);
    }
    document.addEventListener('mouseup', clearResizing);
  }

  function handleResizeMouseDown(e, block, day) {
    setResizingId(block.id);
    onResizeBlockStart(e, block, day);
    function clearResizing() {
      setResizingId(null);
      document.removeEventListener('mouseup', clearResizing);
    }
    document.addEventListener('mouseup', clearResizing);
  }

  // Apre di default sull'orario di lavoro configurato, come la vista Giorno —
  // ma essendo la griglia sempre 00:00–24:00 resta scorrevole con la rotella.
  useEffect(() => {
    if (!weekBodyRef.current) return;
    weekBodyRef.current.scrollTop = defaultScrollOffset(workdayStartMin);
  }, []); // eslint-disable-line

  useLayoutEffect(() => {
    function measure() {
      const el = weekBodyRef.current;
      if (el) setScrollbarW(el.offsetWidth - el.clientWidth);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [weekDays, plans, workbookPlans, calEvents]);

  function slotFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const idx  = Math.floor(relY / SLOT_HEIGHT);
    return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 30, idx * 30));
  }

  function handleColDragOver(e, day) {
    if (locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ day, min: slotFromEvent(e) });
  }

  function handleColDrop(e, day) {
    e.preventDefault();
    if (locked) { setDragOver(null); return; }
    const min = slotFromEvent(e);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'weekblock') {
        if (data.copy) onCopyBlock(data.fromDay, data.blockId, day, m2t(min));
        else onMoveBlock(data.fromDay, data.blockId, day, m2t(min));
      }
      else if (data.type === 'task') onAddTask(data.task, day, m2t(min));
      else if (data.type === 'workbookblock') onAddWorkbookBlock(data.workbookId, data.subWorkbookId, day, m2t(min));
      else if (data.type === 'weekworkbookblock') {
        if (data.copy) onCopyWorkbookBlock(data.fromDay, data.blockId, day, m2t(min));
        else onMoveWorkbookBlock(data.fromDay, data.blockId, day, m2t(min));
      }
      else if (data.type === 'calevent-copy') onCopyEvent(data.calId, data.subject, data.durationMin, day, m2t(min));
    } catch { /* payload drag non valido — ignora */ }
    setDragOver(null);
  }

  // Clic su uno spazio vuoto della colonna: apre "Nuovo evento" precompilato
  // con quel giorno e l'ora del punto cliccato.
  function handleColClick(e, day) {
    if (locked) return;
    if (suppressClickRef?.current) { suppressClickRef.current = false; return; }
    if (e.target.closest('.planner-week-cal-event, .planner-week-task-block, .planner-week-workbook-block')) return;
    onCreateEvent(day, m2t(slotFromEvent(e)));
  }

  return (
    <div className="planner-week-wrap">
      <div className="planner-week-head" style={{ paddingRight: scrollbarW }}>
        <div className="planner-week-gutter" />
        {weekDays.map(day => (
          <div
            key={day}
            className={`planner-week-day-header${day === today ? ' today' : ''}`}
            onClick={() => onDayClick(day)}>
            {new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        ))}
        <div className="planner-week-gutter right" />
      </div>
      {/* All-day events row */}
      <div className="planner-week-allday-row" style={{ paddingRight: scrollbarW }}>
        <div className="planner-week-gutter" />
        {weekDays.map(day => {
          const dayAllDay = calEvents.filter(ev =>
            isAllDay(ev) && (ev.start?.date || ev.start?.dateTime || '').slice(0, 10) === day
          );
          return (
            <div key={day} className="planner-week-allday-col">
              {dayAllDay.map((ev, i) => (
                <span key={i} className="planner-allday-chip" onClick={() => onEventClick(ev)} title={ev.subject}>{ev.subject}</span>
              ))}
            </div>
          );
        })}
        <div className="planner-week-gutter right" />
      </div>
      <div className="planner-week-body" ref={weekBodyRef}>
        <div className="planner-week-gutter-col" style={{ height: timeSlots.length * SLOT_HEIGHT }}>
          {timeSlots.map(slot => (
            <div key={slot} className="planner-week-slot-label" style={{ height: SLOT_HEIGHT }}>{slot}</div>
          ))}
        </div>
        {weekDays.map(day => {
          const dayPlan         = plans[day] || { blocks: [] };
          const dayWorkbookPlan = workbookPlans[day] || { blocks: [] };
          const dayEvents = calEvents.filter(ev =>
            !isAllDay(ev) && (ev.start?.dateTime || ev.start?.date || '').slice(0, 10) === day
          );
          return (
            <div
              key={day}
              className={`planner-week-day-col${day === today ? ' today' : ''}`}
              style={{ height: timeSlots.length * SLOT_HEIGHT }}
              onDragOver={e => handleColDragOver(e, day)}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null);
              }}
              onDrop={e => handleColDrop(e, day)}
              onClick={e => handleColClick(e, day)}>
              {timeSlots.map(slot => (
                <div key={slot} className="planner-week-slot-row" style={{ height: SLOT_HEIGHT }} />
              ))}
              {dragOver?.day === day && (
                <div
                  className="planner-week-drop-indicator"
                  style={{ top: (dragOver.min - DAY_START_MIN) / 30 * SLOT_HEIGHT, height: SLOT_HEIGHT }}>
                  {m2t(dragOver.min)}
                </div>
              )}
              {!workbookCalHidden && dayWorkbookPlan.blocks.map(wb => {
                const top    = Math.max(0, (t2m(wb.startTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT - 4, (t2m(wb.endTime) - t2m(wb.startTime)) / 30 * SLOT_HEIGHT - 4);
                const wbColor = liveWorkbookColor(wb, workbooks);
                const isVertical  = (t2m(wb.endTime) - t2m(wb.startTime)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(wb.label, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
                const notesEls = (wb.notes || []).map(note => (
                  <WorkbookBlockNote
                    key={note.id}
                    note={note}
                    blockHeight={height}
                    locked={locked}
                    onChange={text => onEditWorkbookNote(day, wb.id, note.id, text)}
                    onMove={noteTop => onMoveWorkbookNote(day, wb.id, note.id, noteTop)}
                    onRemove={() => onRemoveWorkbookNote(day, wb.id, note.id)}
                  />
                ));
                return (
                  <div key={wb.id}
                    className={`planner-week-workbook-block${isVertical ? ' vertical-layout' : ''}`}
                    style={{ top: top + 2, height, background: hexToRgba(wbColor, 0.28), borderLeftColor: wbColor }}
                    title={`${wb.startTime}–${wb.endTime} · ${wb.label} (trascina per spostare, Ctrl+trascina per duplicare, doppio clic per una nota)`}
                    draggable={!locked && resizingWbId !== wb.id}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => {
                      // Una nota in editing/drag (vedi WorkbookBlockNote) non deve
                      // avviare il drag nativo dell'intero blocco.
                      if (e.target.closest('.planner-block-note')) { e.preventDefault(); return; }
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekworkbookblock', blockId: wb.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}
                    onDoubleClick={e => {
                      if (locked || e.target.closest('.planner-block-note')) return;
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const noteTop = Math.max(0, Math.min(height - 22, e.clientY - rect.top));
                      onAddWorkbookNote(day, wb.id, noteTop);
                    }}>
                    {isVertical ? (
                      <>
                        <div className="planner-block-label-col">
                          <div className="planner-block-label-title-wrap">
                            <VerticalTitle text={wb.label} layout={titleLayout} className="planner-block-title" />
                          </div>
                          <span className="planner-block-label-duration">{fmtBlockDuration(t2m(wb.endTime) - t2m(wb.startTime))}</span>
                        </div>
                        <div className="planner-block-content-col">{notesEls}</div>
                      </>
                    ) : (
                      <>
                        <span className="planner-block-title">{wb.label}</span>
                        {notesEls}
                      </>
                    )}
                    {!locked && (
                      <button
                        className="planner-week-workbook-block-remove"
                        onClick={e => { e.stopPropagation(); onRemoveWorkbookBlock(day, wb.id); }}
                        title="Elimina">×</button>
                    )}
                    {!locked && (
                      <div
                        className="planner-block-resize"
                        onMouseDown={e => handleWbResizeMouseDown(e, wb, day)} />
                    )}
                  </div>
                );
              })}
              {dayEvents.map((ev, i) => {
                const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
                const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
                if (!evStart || !evEnd) return null;
                const top    = Math.max(0, (t2m(evStart) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT / 2, (t2m(evEnd) - t2m(evStart)) / 30 * SLOT_HEIGHT);
                const evColor = calendarSwatch(ev._calColor);
                const isVertical  = (t2m(evEnd) - t2m(evStart)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(ev.subject, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
                return (
                  <div key={i} className={`planner-week-cal-event${isVertical ? ' vertical-layout' : ''}`}
                    style={{ top, height, background: evColor, borderLeftColor: evColor }}
                    draggable={!locked}
                    onDragStart={e => {
                      if (!(e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({
                        type: 'calevent-copy', calId: ev._calId || null, subject: ev.subject, durationMin: t2m(evEnd) - t2m(evStart),
                      }));
                    }}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    title={`${evStart}–${evEnd} · ${ev.subject} (clicca per modificare, Ctrl+trascina per duplicare)`}>
                    {isVertical ? (
                      <>
                        <div className="planner-block-label-col">
                          <div className="planner-block-label-title-wrap">
                            <VerticalTitle text={ev.subject} layout={titleLayout} className="planner-event-title" />
                          </div>
                          <span className="planner-block-label-duration">{fmtBlockDuration(t2m(evEnd) - t2m(evStart))}</span>
                        </div>
                        <div className="planner-block-content-col" />
                      </>
                    ) : (
                      <>
                        <span className="planner-event-time">{evStart}</span>
                        <span className="planner-event-title">{ev.subject}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {dayPlan.blocks.map(block => {
                const top    = Math.max(0, (t2m(block.startTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT - 4, (t2m(block.endTime) - t2m(block.startTime)) / 30 * SLOT_HEIGHT - 4);
                const isVertical  = (t2m(block.endTime) - t2m(block.startTime)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(block.taskTitle, height - (block.listName ? 30 : 12) - VERTICAL_DURATION_RESERVE_PX, 9) : null;
                return (
                  <div key={block.id}
                    className={`planner-week-task-block${block.completed ? ' completed' : ''}${isVertical ? ' vertical-layout' : ''}`}
                    style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: block.projectColor }}
                    title={`${block.startTime}–${block.endTime} · ${block.taskTitle} (trascina per spostare, Ctrl+trascina per duplicare)`}
                    draggable={!block.completed && !locked && resizingId !== block.id}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekblock', blockId: block.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}>
                    {isVertical ? (
                      <div className="planner-block-label-col">
                        {block.listName && <span className="planner-block-label-section">{block.listName}</span>}
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={block.taskTitle} layout={titleLayout} className="planner-block-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(t2m(block.endTime) - t2m(block.startTime))}</span>
                      </div>
                    ) : (
                      <span className="planner-block-title">{block.taskTitle}</span>
                    )}
                    {!block.completed && !locked && (
                      <div
                        className="planner-block-resize"
                        onMouseDown={e => handleResizeMouseDown(e, block, day)} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="planner-week-gutter-col right" style={{ height: timeSlots.length * SLOT_HEIGHT }}>
          {timeSlots.map(slot => (
            <div key={slot} className="planner-week-slot-label" style={{ height: SLOT_HEIGHT }}>{slot}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Nota libera dentro un workbook block: ancorata a un offset verticale
// (note.top, px dal bordo superiore del blocco) invece che a un orario, così
// si può segnare "caffè" o "pranzo" in un punto preciso di una fascia larga
// (es. "Ufficio" 8–17:30) senza spezzarla in blocchi separati. Testo libero
// con a-capo (textarea), riposizionabile trascinando la maniglia ⠿.
function WorkbookBlockNote({ note, blockHeight, locked, onChange, onMove, onRemove }) {
  const [editing, setEditing] = useState(!note.text);
  const [draft, setDraft]     = useState(note.text);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft.trim() === note.text.trim() && note.text) return;
    onChange(draft);
  }

  function handleDragHandleMouseDown(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const startY   = e.clientY;
    const startTop = note.top;
    function onMove_(ev) {
      const nextTop = Math.max(0, Math.min(Math.max(0, blockHeight - 22), startTop + (ev.clientY - startY)));
      onMove(nextTop);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove_);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove_);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div className="planner-block-note" style={{ top: note.top }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="planner-block-note-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') { setDraft(note.text); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.currentTarget.blur(); }
          }}
        />
      ) : (
        <>
          {!locked && (
            <span className="planner-block-note-drag" onMouseDown={handleDragHandleMouseDown} title="Trascina per riposizionare">⠿</span>
          )}
          <pre className="planner-block-note-text" onClick={() => !locked && setEditing(true)}>{note.text}</pre>
          {!locked && (
            <button className="planner-block-note-remove" onClick={onRemove} title="Elimina nota">×</button>
          )}
        </>
      )}
    </div>
  );
}

