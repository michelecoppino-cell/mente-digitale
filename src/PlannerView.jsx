// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import {
  loadDailyPlans, saveDailyPlans,
  loadPlannerConfig, savePlannerConfig,
  getCalendarEvents, getCalendars, getCalendarFetchReport, updateCalendarColor,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, moveCalendarEvent,
  patchCalendarEvent, graphDateTime,
  loadWorkbooks, saveWorkbooks, getWorkbookCalendarId, getWorkbookEvents, WORKBOOK_CALENDAR_NAME,
  loadIdealWeek, saveIdealWeek,
} from './api';
import { leggiUnTask, aggiornaTask } from './taskStore';
import { queryClient, qk, STALE } from './queryClient';
import Skeleton from './Skeleton';
import TaskPool from './TaskPool';
import { useMediaQuery } from './useMediaQuery';
import WorkbookPool from './WorkbookPool';
import TaskDetailPanel from './TaskDetailPanel';
import { DEFAULT_CONFIG, findProject, hexToRgba, buildListColorMap, listColor } from './plannerShared';
import { listLabel } from './paraConfig';
import { ESTIMATE_CHOICES, DEFAULT_ESTIMATE_MIN } from './taskModel';
import { pushUndo } from './undo';
import './PlannerView.css';

// Le misure, i colori e i conti della griglia stanno in un file loro: erano
// duecentoquaranta righe in testa a questo, e non riguardano il Piano del
// giorno più di quanto riguardino la settimana, il mese o il modale degli
// eventi.
import {
  SLOT_HEIGHT, SAVE_DEBOUNCE, DEFAULT_DURATION, SNAP_MIN,
  t2m, m2t, blockMinutesFor,
  VERTICAL_LAYOUT_MIN_DURATION, VERTICAL_DURATION_RESERVE_PX, verticalTitleLayout,
  GRAPH_CAL_COLORS, calendarSwatch, GRAPH_CAL_COLOR_OPTIONS,
  WORKBOOK_CAL_ID, liveWorkbookColor, liveBlockColor,
  DAY_START_MIN, DAY_END_MIN, FULL_DAY_SLOTS, defaultScrollOffset,
  localDateStr, todayStr, genId, isoToHHMM, isoToLocalDateStr,
  isAllDay, graphDayStr, evDayStr, overlapColumns, eventSpan,
  fmtBlockDuration, getWeekDays,
} from './planner/griglia.js';
import { VerticalTitle } from './planner/VerticalTitle.jsx';
// I quattro pezzi che stavano in fondo a questo file: erano già componenti a
// sé, gli mancava solo la riga di confine.
import { DayCapacity } from './planner/DayCapacity.jsx';
import { CalendarEventModal } from './planner/CalendarEventModal.jsx';
import { MonthlyCalendar } from './planner/MonthlyCalendar.jsx';
import { WeeklyTimeline } from './planner/WeeklyTimeline.jsx';
import { WorkbookBlockNote } from './planner/WorkbookBlockNote.jsx';

// ── Main PlannerView ──────────────────────────────────────────────────────────
export default function PlannerView({
  open, onClose, preloadedTasks = [], notebooks = [], sectionsMap = {}, todoLists = [], autoAddTask = null, onAutoAdded,
  onTaskCompleted, onTaskDeleted, onTaskRenamed, onTaskDueChanged, onTaskPatched, onTaskRestored,
  calendarDirtyToken = 0,
}) {
  const [currentDate, setCurrentDate]       = useState(todayStr);
  const [plans, setPlans]                   = useState({});
  const [config, setConfig]                 = useState(DEFAULT_CONFIG);
  const [todayPlan, setTodayPlan]           = useState({ date: todayStr(), blocks: [], emailExtractedActions: [] });
  const [calEvents, setCalEvents]           = useState([]);
  // Orologio che avanza ogni 15s: sposta la linea ocra dell'ora corrente.
  const [nowTick, setNowTick] = useState(() => Date.now());
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
  // Stessa soglia della media query del Piano: sotto, la terza colonna non
  // esiste e il dettaglio è un foglio dal basso.
  const narrow = useMediaQuery('(max-width: 768px)');
  const [calendarsList, setCalendarsList]   = useState([]);
  // Esito dell'ultimo caricamento per calendario (vedi getCalendarFetchReport):
  // è quello che rende visibile nel filtro un calendario che c'è ma non porta
  // eventi, invece di lasciar credere che quei giorni siano vuoti.
  const [calReport, setCalReport]           = useState([]);
  const [calFilterOpen, setCalFilterOpen]   = useState(false);
  const [calColorPickerFor, setCalColorPickerFor] = useState(null); // id del calendario con lo swatch colori aperto
  const [calModal, setCalModal]             = useState(null); // { mode: 'create'|'edit', event }

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
  // Un vero trascinamento (resize di un blocco, ridimensiona pannello…) può
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
    dipingiUltimoCaricamento();
    Promise.all([
      initConfig(), initPlans(), initCalendarsList(),
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

  // Fa avanzare la linea dell'ora corrente.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, [open]);

  // Il Piano dell'ultimo caricamento, dipinto prima di qualunque attesa.
  //
  // Le init qui sotto passano tutte da fetchQuery, che con un dato ancora
  // fresco risponde subito ma con uno vecchio va in rete: e finché non
  // tornava, il Piano restava una griglia vuota — cioè esattamente quello che
  // si vede riaprendo l'app dal telefono, dove la pagina è stata buttata via e
  // ogni dato è «vecchio» per definizione. I blocchi e gli appuntamenti sono
  // già in cache: si mettono in pagina adesso, e la rilettura li sostituisce
  // quando arriva.
  //
  // Gli eventi si dipingono senza toccare allCalEventsRef: quel ref è la
  // scorciatoia che dice «già letti in questa sessione, non rifetchare», e
  // riempirlo qui vorrebbe dire un Piano che non si aggiorna più.
  function dipingiUltimoCaricamento() {
    const cfg = queryClient.getQueryData(qk.plannerConfig());
    if (cfg) { setConfig(cfg); configRef.current = cfg; }

    const allPlans = queryClient.getQueryData(qk.dailyPlans());
    if (allPlans) {
      setPlans(allPlans);
      plansRef.current = allPlans;
      setTodayPlan(allPlans[currentDate] || { date: currentDate, blocks: [], emailExtractedActions: [] });
    }

    const wb = queryClient.getQueryData(qk.workbooks());
    if (wb?.workbooks) { setWorkbooks(wb.workbooks); workbooksRef.current = wb.workbooks; }

    const evs = queryClient.getQueryData(qk.calEventsBulk());
    if (evs?.length) filterCalEvents(evs);

    const wbEvs = queryClient.getQueryData(qk.workbookEventsBulk());
    if (wbEvs?.length) filterWorkbookEvents(wbEvs);
  }

  async function initConfig() {
    try {
      const cfg = await queryClient.fetchQuery({ queryKey: qk.plannerConfig(), queryFn: loadPlannerConfig, staleTime: STALE.plannerConfig });
      if (cfg) { setConfig(cfg); configRef.current = cfg; }
      configLoadedRef.current = true;
    } catch (e) { console.error('planner config load', e); }
  }

  async function initPlans() {
    try {
      const allPlans = await queryClient.fetchQuery({ queryKey: qk.dailyPlans(), queryFn: loadDailyPlans, staleTime: STALE.dailyPlans }) || {};
      setPlans(allPlans);
      plansRef.current = allPlans;
      plansLoadedRef.current = true;

      const dayPlan = allPlans[currentDate] || { date: currentDate, blocks: [], emailExtractedActions: [] };
      setTodayPlan(dayPlan);

    } catch (e) {
      console.error('planner plans load', e);
      setSaveStatus('error');
    }
  }

  async function initWorkbooks() {
    try {
      const data = await queryClient.fetchQuery({ queryKey: qk.workbooks(), queryFn: loadWorkbooks, staleTime: STALE.workbooks });
      const list = data?.workbooks || [];
      setWorkbooks(list);
      workbooksRef.current = list;
      workbooksLoadedRef.current = true;
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
    const WB_MONTHS = 3;

    if (allWorkbookEventsRef.current.length > 0) {
      filterWorkbookEvents(allWorkbookEventsRef.current);
      return;
    }
    try {
      if (!workbookCalIdRef.current) await initWorkbookCalendar();
      if (!workbookCalIdRef.current) { filterWorkbookEvents([]); return; }
      const today = new Date();
      const start = new Date(today); start.setMonth(today.getMonth() - WB_MONTHS); start.setHours(0,0,0,0);
      const end   = new Date(today); end.setMonth(today.getMonth() + WB_MONTHS);   end.setHours(23,59,59,999);
      const calId = workbookCalIdRef.current;
      // fetchQuery: riusa la cache di sessione se ancora fresca, altrimenti
      // interroga Graph una volta e la persiste (al posto di cacheGet/cacheSet).
      const evs = await queryClient.fetchQuery({
        queryKey: qk.workbookEventsBulk(),
        queryFn: () => getWorkbookEvents(calId, start, end, 500),
        staleTime: STALE.workbookEventsBulk,
      });
      allWorkbookEventsRef.current = evs;
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
    await queryClient.invalidateQueries({ queryKey: qk.workbookEventsBulk() });
    await fetchWorkbookEventsAll();
  }

  async function initIdealWeek() {
    try {
      const template = await queryClient.fetchQuery({ queryKey: qk.idealWeek(), queryFn: loadIdealWeek, staleTime: STALE.idealWeek });
      setIdealWeek(template);
      idealWeekRef.current = template;
    } catch (e) { console.error('ideal week load', e); }
  }

  // Albero Workbook/Sub-workbook: azione rara (creazione nodo, cambio
  // colore) — salvataggio diretto, nessun debounce necessario.
  function persistWorkbooks(nextList) {
    setWorkbooks(nextList);
    workbooksRef.current = nextList;
    const payload = { workbooks: nextList };
    queryClient.setQueryData(qk.workbooks(), payload);
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
    queryClient.setQueryData(qk.plannerConfig(), nextConfig);
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
    const CAL_MONTHS = 3;

    // 1 — in-memory (stessa sessione): evita anche il tick async di fetchQuery
    if (allCalEventsRef.current.length > 0) {
      filterCalEvents(allCalEventsRef.current);
      setCalReport(getCalendarFetchReport());
      return;
    }
    // 2 — fetchQuery: cache di sessione persistita se fresca, altrimenti Graph
    // una volta (finestra ±3 mesi), al posto di cacheGet/cacheSet.
    try {
      const today = new Date();
      const start = new Date(today); start.setMonth(today.getMonth() - CAL_MONTHS); start.setHours(0,0,0,0);
      const end   = new Date(today); end.setMonth(today.getMonth() + CAL_MONTHS);   end.setHours(23,59,59,999);
      const evs = await queryClient.fetchQuery({
        queryKey: qk.calEventsBulk(),
        queryFn: () => getCalendarEvents(start, end, 500),
        staleTime: STALE.calEventsBulk,
      });
      allCalEventsRef.current = evs;
      filterCalEvents(evs);
      setCalReport(getCalendarFetchReport());
    } catch (e) {
      console.error('cal events bulk load', e);
      filterCalEvents([]);
      setCalReport(getCalendarFetchReport());
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
      const d = evDayStr(ev);
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
    await queryClient.invalidateQueries({ queryKey: qk.calEventsBulk() });
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
      const prevStartDate = graphDayStr(ev.start, prevAllDay);
      const prevEndDate   = graphDayStr(ev.end, prevAllDay);
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
          startDate: graphDayStr(ev.start, isAllDay(ev)),
          endDate: graphDayStr(ev.end, isAllDay(ev)),
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
        queryClient.setQueryData(qk.dailyPlans(), updated);
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

  // Cambiare la stima di un task riscala i suoi blocchi già a piano — su tutti
  // i giorni, non solo quello aperto: se la stessa attività è in agenda tre
  // volte, ha la stessa durata tutte e tre. L'inizio non si tocca.
  function resizeBlocksForTask(taskId, minutes) {
    if (!taskId) return;
    const dur = Math.max(SNAP_MIN, Math.ceil(minutes / SNAP_MIN) * SNAP_MIN);
    mutatePlansMulti(all => {
      const next = {};
      for (const [date, plan] of Object.entries(all || {})) {
        next[date] = {
          ...plan,
          blocks: (plan.blocks || []).map(b => b.taskId === taskId && !b.completed
            ? { ...b, endTime: m2t(Math.min(t2m(b.startTime) + dur, DAY_END_MIN)) }
            : b),
        };
      }
      return next;
    });
  }

  // Apre il dettaglio del task di un blocco — da desktop nella terza colonna,
  // da telefono nel foglio che sale dal basso.
  function openBlockDetail(block) {
    if (!block?.taskId || !block?.listId) return;
    setSelectedTask({ id: block.taskId, title: block.taskTitle, _listId: block.listId, _listName: block.listName });
  }

  function closeDetail() {
    setSelectedTask(null);
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
        queryClient.setQueryData(qk.dailyPlans(), plansRef.current);
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
    if (!dragOverTime) return;
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
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (e.target.closest('.planner-block, .planner-cal-event, .planner-day-workbook-block')) return;
    if (!timelineBodyRef.current) return;
    const rect = timelineBodyRef.current.getBoundingClientRect();
    const relY = e.clientY - rect.top + timelineBodyRef.current.scrollTop;
    const slotIndex = Math.floor(relY / SLOT_HEIGHT);
    const startMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 30, slotIndex * 30));
    openCreateEventModal(currentDate, m2t(startMin));
  }

  function makeBlock(task, startTime) {
    const proj    = findProject(task, configRef.current);
    const color   = proj?.color ?? listColor(task._listName ?? '', listColorMapRef.current);
    const endMin  = Math.min(t2m(startTime) + blockMinutesFor(task), DAY_END_MIN);
    return {
      id: genId(), taskId: task.id, taskTitle: task.titolo,
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
          notes: b.notes || [],
          dayOfWeek,
        });
      });
    });
    const template = { blocks, updatedAt: new Date().toISOString() };
    setIdealWeek(template);
    idealWeekRef.current = template;
    queryClient.setQueryData(qk.idealWeek(), template);
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
        label: tb.label, color: tb.color, startTime: tb.startTime, endTime: tb.endTime,
        notes: (tb.notes || []).map(n => ({ ...n, id: genId() })),
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
        await aggiornaTask(block.listId, block.taskId, { stato: 'done' });
        onTaskCompleted?.(block.listId, block.taskId);
      } catch (e) { console.error('complete task', e); }
    }
  }

  function handleRemoveBlock(blockId) {
    mutatePlan(prev => ({ ...prev, blocks: prev.blocks.filter(b => b.id !== blockId) }));
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
      const full = await leggiUnTask(block.listId, block.taskId);
      const items = (full?.sottoattivita || [])
        .map(i => ({ ...i, selected: !i.fatta }));
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
              subSteps:  selected.map(i => ({ id: i.id, title: i.titolo, completed: i.fatta })),
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

  // Il colore di ogni sezione — e di ogni consegna annidata, che prende una
  // sfumatura della sua commessa. È la stessa mappa di TaskPool e di Sezioni:
  // un blocco del piano e il task da cui è nato hanno lo stesso colore.
  const listColorMap = useMemo(
    () => buildListColorMap(notebooks, sectionsMap, todoLists),
    [notebooks, sectionsMap, todoLists]
  );
  const listColorMapRef = useRef({});
  listColorMapRef.current = listColorMap;

  const allDayEvents = calEvents.filter(isAllDay);
  const timedEvents  = calEvents.filter(ev => !isAllDay(ev));
  // Colonne per gli eventi che si accavallano nella timeline del Giorno.
  const timedEventsLayout = overlapColumns(timedEvents.map(eventSpan));
  const dayWorkbookPlan  = workbookPlans[currentDate] || { blocks: [] };
  const workbookCalHidden = getHiddenCalendarIds().includes(WORKBOOK_CAL_ID);

  // Quanti eventi ha portato ogni calendario, e chi non ce l'ha fatta: si
  // legge nel filtro "Calendari", che è il posto dove ci si accorge che un
  // calendario è elencato ma non mostra niente.
  const calReportById = Object.fromEntries(calReport.map(r => [r.calId, r]));
  const calIssueCount = calReport.filter(r => r.level !== 'ok').length;
  // Quanti ne cadono nel periodo che si sta guardando. È il numero che separa
  // le due domande che si somigliano: «questo calendario non si legge» (zero
  // letti in assoluto) e «lo leggo ma non lo disegno qui» (letti tanti, in
  // vista nessuno, oppure in vista tre e sullo schermo uno).
  const calInViewCount = calEvents.reduce((acc, ev) => {
    acc[ev._calId] = (acc[ev._calId] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const workStart = t2m(config.workdayStart);

  function saveLabel() {
    const now = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (saveStatus === 'saving') return '⏳ Salvataggio…';
    if (saveStatus === 'saved')  return `💾 ${now}`;
    if (saveStatus === 'error')  return '⚠️ Errore salvataggio';
    return '';
  }

  if (!open) return null;

  // Note, sottoattività e stima del task selezionato. Uno
  // solo, montato o nella terza colonna (desktop) o nel foglio dal basso
  // (telefono): due istanze vorrebbero dire due caricamenti da Graph.
  const detailBody = selectedTask ? (
    <TaskDetailPanel
      task={selectedTask}
      sectionsMap={sectionsMap}
      onEstimateChanged={min => resizeBlocksForTask(selectedTask.id, min)}
      onClose={closeDetail}
      onCompleted={() => { onTaskCompleted?.(selectedTask._listId, selectedTask.id); closeDetail(); }}
      onDeleted={() => { onTaskDeleted?.(selectedTask._listId, selectedTask.id); closeDetail(); }}
      onRenamed={titolo => { onTaskRenamed?.(selectedTask._listId, selectedTask.id, titolo); setSelectedTask(prev => prev && ({ ...prev, titolo })); }}
      onDueChanged={scadenza => onTaskDueChanged?.(selectedTask._listId, selectedTask.id, scadenza)}
      onPatched={patch => onTaskPatched?.(selectedTask._listId, selectedTask.id, patch)}
      onRestored={(listId, restoredTask) => onTaskRestored?.(listId, restoredTask)}
    />
  ) : (
    <div className="planner-detail-empty">
      <p>Clicca un task nel pool per vedere note e sottoattività.</p>
    </div>
  );

  const detailColumn = (
    <div className="planner-ai-panel" style={{ width: aiWidth }}>
      <div className="planner-col-header">
        <span>📋 Dettagli</span>
        <span className={`planner-save-status ${saveStatus}`}>{saveLabel()}</span>
      </div>
      <div className="planner-ai-body">
        {detailBody}
      </div>
    </div>
  );

  // Foglio inferiore: da telefono il Piano si legge e si avvia, e questo è il
  // solo punto in cui ci si arriva — su un blocco, con un tocco.
  const detailSheet = narrow && selectedTask && (
    <>
      <div className="planner-sheet-scrim" onClick={closeDetail} />
      <div className="planner-ai-panel mobile-active">
        <div className="planner-col-header">
          <span>📋 Dettagli</span>
          <button className="planner-sheet-close" onClick={closeDetail} title="Chiudi">✕</button>
        </div>
        <div className="planner-ai-body">{detailBody}</div>
      </div>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="planner-view" style={{ display: open ? undefined : 'none' }}>

      {/* Header */}
      <div className="planner-header">
        <div className="planner-header-left">
          <button className="planner-nav-btn" onClick={() => {
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
          <button className="planner-nav-btn" onClick={() => {
            const d = new Date(currentDate + 'T12:00:00');
            if (viewMode === 'month') { setCurrentDate(localDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1))); return; }
            d.setDate(d.getDate() + (viewMode === 'week' ? 7 : 1));
            setCurrentDate(localDateStr(d));
          }}>▶</button>
          {currentDate !== todayStr() && (
            <button className="planner-today-btn" onClick={() => setCurrentDate(todayStr())}>Oggi</button>
          )}
          <div className="planner-view-toggle">
            <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Giorno</button>
            <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Settimana</button>
            <button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Mese</button>
          </div>
        </div>
        <div className="planner-header-actions">
          <DayCapacity blocks={todayPlan.blocks || []} config={config} />
          <div className="planner-cal-filter-wrap">
            <button
              className={`planner-action-btn${calIssueCount ? ' warn' : ''}`}
              onClick={() => setCalFilterOpen(v => !v)}
              title={calIssueCount ? `${calIssueCount} calendari con eventi non caricati` : 'Filtra calendari'}>
              Calendari{calIssueCount ? ' ⚠️' : ''} ▾
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
                    <span className="planner-cal-filter-dot" style={{ background: '#d4a44a' }} />
                    <span className="planner-cal-filter-name">Workbook</span>
                  </label>
                  <div className="planner-cal-filter-divider" />
                  {calendarsList.length === 0 ? (
                    <div className="planner-cal-filter-empty">Nessun calendario</div>
                  ) : calendarsList.map(cal => {
                    const hidden  = getHiddenCalendarIds().includes(cal.id);
                    const rep     = calReportById[cal.id];
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
                          {rep && (
                            <span
                              className={`planner-cal-filter-count${rep.count === 0 ? ' zero' : ''}`}
                              title={`${calInViewCount[cal.id] || 0} eventi in questa vista, ${rep.count} letti da questo calendario nell'ultimo caricamento`}>
                              <span className="planner-cal-filter-count-view">{calInViewCount[cal.id] || 0}</span>
                              /{rep.count}
                            </span>
                          )}
                        </label>
                        {rep && rep.level !== 'ok' && (
                          <div className={`planner-cal-filter-issue ${rep.level}`}>
                            {rep.level === 'error' ? '⚠️ Eventi non caricati — ' : 'ℹ️ '}{rep.message}
                          </div>
                        )}
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
                  {calReport.length > 0 && (
                    <div className="planner-cal-filter-legend">
                      in questa vista / letti in ±3 mesi
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {viewMode === 'week' && (
            <>
              <button className="planner-action-btn" onClick={saveAsIdealWeek} title="Salva i workbook di questa settimana come template ricorrente">
                💾 Settimana ideale
              </button>
              <button className="planner-action-btn" disabled={!idealWeek?.blocks?.length} onClick={importIdealWeek} title="Copia i workbook della settimana ideale in questa settimana">
                📥 Importa ideale
              </button>
              <button className="planner-action-btn danger" disabled={!weekDays.some(d => workbookPlans[d]?.blocks?.length)} onClick={clearWorkbookWeek} title="Elimina tutti i blocchi Workbook (solo calendario Workbook) di questa settimana">
                🗑️ Svuota Workbook
              </button>
            </>
          )}
          <button className="planner-action-btn accent" onClick={() => openCreateEventModal(currentDate)} title="Nuovo evento calendario">+ Evento</button>
          <button className="planner-close-btn" onClick={onClose} title="Chiudi pianificatore">✕</button>
        </div>
      </div>

      {/* Body */}
      <div className="planner-body">

      {viewMode === 'month' ? (
        <MonthlyCalendar
          currentDate={currentDate}
          plans={plans}
          calEvents={calEvents}
          calOutOfRange={calOutOfRange}
          config={config}
          listColorMap={listColorMap}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
          onEventClick={openEditEventModal}
        />
      ) : viewMode === 'week' ? (<>

        {/* ── Task/Workbook Pool a sx, ridotto — stesso pool della vista
            Giorno, ridimensionabile e trascinabile sui giorni della settimana. */}
        <div className={`planner-pool planner-week-pool`} style={{ width: weekPoolWidth }}>
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
              todoLists={todoLists}
              scheduledIds={weekScheduledIds}
              draggable
              onTaskPatched={onTaskPatched}
            />
          ) : (
            <WorkbookPool workbooks={workbooks} onChange={persistWorkbooks} draggable notebooks={notebooks} stats={workbookMinuteStats} />
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
          suppressClickRef={suppressClickRef}
          config={config}
          listColorMap={listColorMap}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
          onMoveBlock={moveBlockBetweenDays}
          onCopyBlock={copyBlockBetweenDays}
          onBlockClick={narrow ? openBlockDetail : undefined}
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

        {/* ── Column 1: Task/Workbook Pool ── */}
        <div className={`planner-pool`} style={{ width: poolWidth }}>
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
              todoLists={todoLists}
              scheduledIds={scheduledIds}
              selectedTaskId={selectedTask?.id ?? null}
              draggable
              onTaskClick={setSelectedTask}
              onTaskPatched={onTaskPatched}
            />
          ) : (
            <WorkbookPool workbooks={workbooks} onChange={persistWorkbooks} draggable notebooks={notebooks} stats={workbookMinuteStats} />
          )}
        </div>

        <div className="planner-col-resize" onMouseDown={handlePoolResizeStart} title="Ridimensiona" />
        {/* ── Column 2: Timeline ── */}
        <div className="planner-timeline">
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
                  draggable={dayResizingWbId !== wb.id}
                  onClick={e => e.stopPropagation()}
                  onDragStart={e => {
                    if (e.target.closest('.planner-block-note')) { e.preventDefault(); return; }
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekworkbookblock', blockId: wb.id, fromDay: currentDate, copy: e.ctrlKey || e.metaKey }));
                  }}
                  onDoubleClick={e => {
                    if (e.target.closest('.planner-block-note')) return;
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
                                      <button
                      className="planner-week-workbook-block-remove"
                      onClick={e => { e.stopPropagation(); handleRemoveWorkbookBlock(currentDate, wb.id); }}
                      title="Elimina">×</button>
                  
                                      <div
                      className="planner-block-resize"
                      onMouseDown={e => handleDayWorkbookResizeStart(e, wb)} />
                  
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
              const geo = timedEventsLayout[i] || { col: 0, cols: 1 };
              return (
                <div
                  key={ev.id || `cal-${i}`}
                  className={`planner-cal-event${ev._isShared ? ' shared' : ''}${isVertical ? ' vertical-layout' : ''}`}
                  style={{
                    top, height, background: evColor, borderLeftColor: evColor,
                    '--cal-col': geo.col, '--cal-cols': geo.cols,
                  }}
                  draggable
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
              const blockColor = liveBlockColor(block, config, listColorMap);
              const checkBtn = (
                <button
                  className="planner-block-check"
                  style={{ color: block.completed ? '#86c07a' : blockColor }}
                  onClick={() => handleCompleteBlock(block.id)}
                 
                  title="Segna come completato">
                  {block.completed ? '✓' : '○'}
                </button>
              );
              const actionsBtns = (
                <div className="planner-block-actions">
                  <button className="planner-block-btn" onClick={() => handleBreakdownTask(block)} title="Scomponi in sottostep">🔀</button>
                  <button className="planner-block-btn" onClick={() => handleRemoveBlock(block.id)} title="Rimuovi">✕</button>
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
                          {i < n - 1 && (
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
                  style={{
                    top: top + 2, height,
                    background: hexToRgba(blockColor, 0.10),
                    borderColor: hexToRgba(blockColor, 0.22),
                    borderLeftColor: blockColor,
                  }}
                  draggable={!block.completed && resizingId !== block.id}
                  onClick={e => { e.stopPropagation(); openBlockDetail(block); }}
                  onDragStart={e => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'block', blockId: block.id, copy: e.ctrlKey || e.metaKey }));
                  }}>
                  {isVertical ? (
                    <>
                      <div className="planner-block-label-col">
                        {block.listName && <span className="planner-block-label-section">{listLabel(block.listName)}</span>}
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
                        {block.listName && <span>{listLabel(block.listName)}</span>}
                      </div>
                      {subStepsOverlay}
                    </>
                  )}
                  {!block.completed && (
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
        {/* Da telefono questa colonna non viene montata: il dettaglio diventa
            un foglio che sale dal basso (vedi detailSheet in fondo al render),
            montato una volta sola e valido anche in vista Settimana. */}
        {!narrow && detailColumn}
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
                  Questo blocco non è collegato a un'attività.
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

    </div>

    {open && detailSheet}
    </>
  );
}
