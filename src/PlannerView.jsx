import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import {
  loadDailyPlans, saveDailyPlans,
  loadPlannerConfig,
  completeTask, getCalendarEvents, getCalendars,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, moveCalendarEvent,
  getTask, updateTaskBody, updateTaskTitle, updateTaskDueDate, deleteTask,
  createChecklistItem, updateChecklistItem, renameChecklistItem, deleteChecklistItem,
  reorderChecklistItems, loadPomodoroStats,
} from './api';
import { cacheGet, cacheSet, cacheDel } from './cache';
import Skeleton from './Skeleton';
import PomodoroTimer from './PomodoroTimer';
import TaskPool from './TaskPool';
import SectionResources from './SectionResources';
import { DEFAULT_CONFIG, findProject, shadeColor } from './plannerShared';
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
function isAllDay(ev) {
  return ev.isAllDay || (!ev.start?.dateTime && !!ev.start?.date);
}
// Totale di giornata nell'header della colonna Timeline — formato ore:minuti.
function fmtFocusTotal(min) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
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

// ── Main PlannerView ──────────────────────────────────────────────────────────
export default function PlannerView({
  open, onClose, preloadedTasks = [], notebooks = [], sectionsMap = {}, pagesCache = null, autoAddTask = null, onAutoAdded,
  onTaskCompleted, onTaskDeleted, onTaskRenamed, onTaskDueChanged,
  onStartFocus, onEndFocus,
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
  // Bloccata solo mentre il Pomodoro è effettivamente in corso (non in pausa):
  // premere "Pausa" riporta alla normale modalità Piano, sbloccata.
  const locked = pomodoroActive && pomodoroRunning;
  const [saveStatus, setSaveStatus]         = useState('idle');
  const [breakdownModal, setBreakdownModal] = useState(null);
  const [dragOverTime, setDragOverTime]     = useState(null);
  const [viewMode, setViewMode]             = useState('day');
  const [resizingId, setResizingId]         = useState(null);
  const [selectedTask, setSelectedTask]     = useState(null);
  const [poolWidth, setPoolWidth]           = useState(560);
  const [aiWidth, setAiWidth]               = useState(560);
  const [calOutOfRange, setCalOutOfRange]   = useState(false);
  const [mobileTab, setMobileTab]           = useState('timeline'); // colonna visibile su schermi stretti
  const [calendarsList, setCalendarsList]   = useState([]);
  const [calModal, setCalModal]             = useState(null); // { mode: 'create'|'edit', event }

  const timelineBodyRef  = useRef(null);
  const saveTimerRef     = useRef(null);
  const plansRef         = useRef({});
  const configRef        = useRef(DEFAULT_CONFIG);
  const resizingRef      = useRef(null);
  const subResizingRef   = useRef(null);
  const allCalEventsRef  = useRef([]);
  const currentDateRef   = useRef(currentDate);
  currentDateRef.current = currentDate;

  // ── Load config + plans once on open; scroll to now ─────────────────────────
  useEffect(() => {
    if (!open) return;
    Promise.all([initConfig(), initPlans(), initPomodoroStats(), initCalendarsList()]);
    requestAnimationFrame(() => {
      if (!timelineBodyRef.current) return;
      const now = new Date();
      const workStart = t2m(configRef.current.workdayStart);
      const cur = now.getHours() * 60 + now.getMinutes();
      const offset = Math.max(0, (cur - workStart) / 30 * SLOT_HEIGHT - 80);
      timelineBodyRef.current.scrollTop = offset;
    });
  }, [open]); // eslint-disable-line

  // ── Fetch bulk cal events once, then filter locally on every date/view change ─
  useEffect(() => {
    if (!open) return;
    fetchCalEventsAll();
  }, [open, currentDate, viewMode]); // eslint-disable-line

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

  async function initConfig() {
    try {
      const cached = cacheGet('planner_config');
      const cfg = cached || await loadPlannerConfig();
      if (cfg) { setConfig(cfg); configRef.current = cfg; }
      if (!cached && cfg) cacheSet('planner_config', cfg, 30 * 60 * 1000);
    } catch (e) { console.error('planner config load', e); }
  }

  async function initPlans() {
    try {
      const cached = cacheGet('daily_plans');
      const allPlans = cached || await loadDailyPlans() || {};
      setPlans(allPlans);
      plansRef.current = allPlans;
      if (!cached) cacheSet('daily_plans', allPlans, PLANS_CACHE_TTL);

      const dayPlan = allPlans[currentDate] || { date: currentDate, blocks: [], emailExtractedActions: [] };
      setTodayPlan(dayPlan);

    } catch (e) { console.error('planner plans load', e); }
  }

  // Statistiche giornaliere Pomodoro (minuti concentrati) — mostrate come
  // colonna a sx delle ore e totale nell'header della Timeline.
  async function initPomodoroStats() {
    try {
      const stats = await loadPomodoroStats();
      setPomodoroStatsMap(stats || {});
    } catch (e) { console.error('pomodoro stats load', e); }
  }

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

    const filtered = allEvs.filter(ev => {
      const d = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
      return d >= viewStart && d <= viewEnd;
    });
    setCalEvents(filtered);
  }

  async function initCalendarsList() {
    try {
      const cals = await getCalendars();
      setCalendarsList(cals);
    } catch (e) { console.error('calendars load', e); }
  }

  // Forza un refetch dal server dopo una modifica (crea/modifica/elimina evento).
  async function refreshCalEvents() {
    allCalEventsRef.current = [];
    cacheDel('cal_events_bulk');
    await fetchCalEventsAll();
  }

  function openCreateEventModal(dateStr) {
    setCalModal({ mode: 'create', defaultDate: dateStr || currentDate });
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
      let targetEventId  = ev.id;
      if (originCalId !== targetCalId) {
        const moved = await moveCalendarEvent(ev._calId || null, ev.id, targetCalId);
        targetEventId = moved?.id || ev.id;
      }
      await updateCalendarEvent(targetCalId, targetEventId, { subject, startDate, endDate, startTime, endTime });
    } else {
      await createCalendarEvent({ calendarId, subject, startDate, endDate, startTime, endTime });
    }
    setCalModal(null);
    await refreshCalEvents();
  }

  async function handleDeleteCalEvent() {
    if (calModal?.mode !== 'edit') return;
    const ev = calModal.event;
    await deleteCalendarEvent(ev._calId, ev.id);
    setCalModal(null);
    await refreshCalEvents();
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  function scheduleSave(updatedPlan) {
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
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
      const workStart = t2m(configRef.current.workdayStart);
      const workEnd   = t2m(configRef.current.workdayEnd);
      const startMin  = Math.max(workStart, Math.min(t2m(newStartTime), workEnd - 30));
      const moved     = { ...block, startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, workEnd)) };
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

  // ── DnD ─────────────────────────────────────────────────────────────────────
  function handleTimelineDragOver(e) {
    if (locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!timelineBodyRef.current) return;
    const rect = timelineBodyRef.current.getBoundingClientRect();
    const relY  = e.clientY - rect.top + timelineBodyRef.current.scrollTop;
    const workStart  = t2m(configRef.current.workdayStart);
    const workEnd    = t2m(configRef.current.workdayEnd);
    const slotIndex  = Math.floor(relY / SLOT_HEIGHT);
    const clamped    = Math.max(workStart, Math.min(workEnd - 30, workStart + slotIndex * 30));
    setDragOverTime(m2t(clamped));
  }

  function handleTimelineDrop(e) {
    e.preventDefault();
    if (locked || !dragOverTime) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'task')   addBlock(data.task, dragOverTime);
      else if (data.type === 'block') moveBlock(data.blockId, dragOverTime);
    } catch { /* payload drag non valido — ignora */ }
    setDragOverTime(null);
  }

  function addBlock(task, startTime) {
    const proj    = findProject(task, configRef.current);
    const color   = proj?.color ?? listColorMapRef.current[(task._listName ?? '').toLowerCase()] ?? '#888';
    const endMin  = Math.min(t2m(startTime) + DEFAULT_DURATION, t2m(configRef.current.workdayEnd));
    const newBlock = {
      id: genId(), taskId: task.id, taskTitle: task.title,
      listId: task._listId, listName: task._listName,
      projectKey: proj?.key || null, projectColor: color,
      startTime, endTime: m2t(endMin),
      completed: false, completedAt: null,
      isAISuggested: false, subSteps: [],
    };
    mutatePlan(prev => ({ ...prev, blocks: [...prev.blocks, newBlock] }));
  }

  function moveBlock(blockId, newStartTime) {
    mutatePlan(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => {
        if (b.id !== blockId) return b;
        const dur    = t2m(b.endTime) - t2m(b.startTime);
        const endMin = Math.min(t2m(newStartTime) + dur, t2m(configRef.current.workdayEnd));
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

  function recordPomodoroSession({ focusedMinutes, interruptions, sessions } = {}) {
    setPomodoroStatsMap(prev => {
      const prevDay = prev[currentDateRef.current] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      return {
        ...prev,
        [currentDateRef.current]: {
          pomodori: prevDay.pomodori + 1,
          focusedMinutes: prevDay.focusedMinutes + (focusedMinutes || 0),
          interruptions: prevDay.interruptions + (interruptions || 0),
          sessions: [...(prevDay.sessions || []), ...(sessions || [])],
        },
      };
    });
  }

  function handleResizeStart(e, block) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { blockId: block.id, startY: e.clientY, startEndMin: t2m(block.endTime), blockStartMin: t2m(block.startTime) };
    setResizingId(block.id);

    function onMove(ev) {
      const { blockId, startY, startEndMin, blockStartMin } = resizingRef.current;
      const deltaMin = Math.round((ev.clientY - startY) / SLOT_HEIGHT * 30 / 30) * 30;
      const newEndMin = Math.max(blockStartMin + 30,
        Math.min(t2m(configRef.current.workdayEnd), startEndMin + deltaMin));
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
      setTodayPlan(prev => { scheduleSave(prev); return prev; });
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
      setTodayPlan(prev => { scheduleSave(prev); return prev; });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Panel resize ─────────────────────────────────────────────────────────────
  function handlePoolResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = poolWidth;
    const onMove = ev => setPoolWidth(Math.max(180, Math.min(800, startW + ev.clientX - startX)));
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleAiResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = aiWidth;
    const onMove = ev => setAiWidth(Math.max(180, Math.min(800, startW - (ev.clientX - startX))));
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const timeSlots   = slots(config.workdayStart, config.workdayEnd);
  const scheduledIds = new Set(todayPlan.blocks.map(b => b.taskId));

  // Map each section/list name → a shade of its notebook color
  const listColorMap = useMemo(() => {
    const map = {};
    for (const nb of notebooks) {
      (sectionsMap[nb.id] || []).forEach((s, i) => {
        map[s.displayName.toLowerCase()] = shadeColor(nb._color || '#888', i);
      });
    }
    return map;
  }, [notebooks, sectionsMap]);
  const listColorMapRef = useRef({});
  listColorMapRef.current = listColorMap;

  const allDayEvents = calEvents.filter(isAllDay);
  const timedEvents  = calEvents.filter(ev => !isAllDay(ev));

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
      ) : viewMode === 'week' ? (
        <WeeklyTimeline
          weekDays={getWeekDays(currentDate)}
          plans={plans}
          calEvents={calEvents}
          workStart={workStart}
          timeSlots={timeSlots}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
          onMoveBlock={moveBlockBetweenDays}
          onEventClick={openEditEventModal}
        />
      ) : (<>

        {/* ── Column 1: Task Pool ──
            Durante il blocco Pomodoro resta visibile ma del tutto non
            interagibile: solo il task già aperto nel pannello Dettagli
            si può modificare. */}
        <div className={`planner-pool${mobileTab === 'pool' ? ' mobile-active' : ''}${locked ? ' locked' : ''}`} style={{ width: poolWidth }}>
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
            }}>

            {/* Colonna Pomodoro: totale giornaliero in alto + fasce orarie reali */}
            <div className="planner-focus-daytotal" title="Totale concentrazione Pomodoro">
              <span>🍅</span>
              <span>{fmtFocusTotal(dayFocusMinutes)}</span>
            </div>
            {(pomodoroStatsMap[currentDate]?.sessions || []).map((s, i) => {
              const sStart = new Date(s.start);
              const sEnd   = new Date(s.end);
              const startMin = sStart.getHours() * 60 + sStart.getMinutes();
              const endMin   = sEnd.getHours() * 60 + sEnd.getMinutes();
              const workEnd  = t2m(config.workdayEnd);
              if (endMin <= workStart || startMin >= workEnd) return null;
              const top    = Math.max(0, (Math.max(startMin, workStart) - workStart) / 30 * SLOT_HEIGHT);
              const height = Math.max(3, (Math.min(endMin, workEnd) - Math.max(startMin, workStart)) / 30 * SLOT_HEIGHT);
              return (
                <div
                  key={`focus-${i}`}
                  className="planner-focus-bar"
                  style={{ top, height }}
                  title={`${isoToHHMM(s.start)}–${isoToHHMM(s.end)} concentrato`} />
              );
            })}

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

            {/* Calendar events — absolute, editabili al click */}
            {timedEvents.map((ev, i) => {
              const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
              const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
              if (!evStart || !evEnd) return null;
              const evStartMin = t2m(evStart);
              const evEndMin   = t2m(evEnd);
              const workEnd    = t2m(config.workdayEnd);
              if (evEndMin <= workStart || evStartMin >= workEnd) return null;
              const top    = Math.max(0, (evStartMin - workStart) / 30 * SLOT_HEIGHT);
              const height = Math.max(SLOT_HEIGHT / 2, (Math.min(evEndMin, workEnd) - Math.max(evStartMin, workStart)) / 30 * SLOT_HEIGHT);
              return (
                <div
                  key={`cal-${i}`}
                  className={`planner-cal-event${ev._isShared ? ' shared' : ''}`}
                  style={{ top, height }}
                  onClick={e => { e.stopPropagation(); openEditEventModal(ev); }}
                  title={`${evStart}–${evEnd} · ${ev.subject}${ev._calName ? ` (${ev._calName})` : ''} — clicca per modificare`}>
                  <span className="planner-event-time">{evStart}–{evEnd}</span>
                  <span className="planner-event-title">{ev.subject}</span>
                </div>
              );
            })}

            {/* Task blocks — absolute, draggable */}
            {todayPlan.blocks.map(block => {
              const startMin = t2m(block.startTime);
              const endMin   = t2m(block.endTime);
              const top      = Math.max(0, (startMin - workStart) / 30 * SLOT_HEIGHT);
              const height   = Math.max(SLOT_HEIGHT - 4, (endMin - startMin) / 30 * SLOT_HEIGHT - 4);
              return (
                <Fragment key={block.id}>
                <div
                  className={`planner-block${block.completed ? ' completed' : ''}${block.isAISuggested ? ' ai-suggested' : ''}`}
                  style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: block.projectColor }}
                  draggable={!locked && !block.completed && resizingId !== block.id}
                  onClick={() => {
                    if (block.taskId && block.listId) {
                      setSelectedTask({ id: block.taskId, title: block.taskTitle, _listId: block.listId, _listName: block.listName });
                      setMobileTab('panel');
                    }
                  }}
                  onDragStart={locked ? undefined : e => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'block', blockId: block.id }));
                  }}>
                  <div className="planner-block-header">
                    <button
                      className="planner-block-check"
                      style={{ color: block.completed ? '#86c07a' : block.projectColor }}
                      onClick={() => handleCompleteBlock(block.id)}
                      disabled={locked}
                      title="Segna come completato">
                      {block.completed ? '✓' : '○'}
                    </button>
                    <span className="planner-block-title">{block.taskTitle}</span>
                    <div className="planner-block-actions">
                      <button className="planner-block-btn" onClick={() => handleBreakdownTask(block)} disabled={locked} title="Scomponi in sottostep">🔀</button>
                      <button className="planner-block-btn" onClick={() => handleRemoveBlock(block.id)} disabled={locked} title="Rimuovi">✕</button>
                    </div>
                  </div>
                  <div className="planner-block-meta">
                    <span>{block.startTime}–{block.endTime}</span>
                    {block.listName && <span>{block.listName}</span>}
                    {block.isAISuggested && <span className="planner-ai-badge">AI</span>}
                  </div>
                  {block.subSteps?.length > 0 && (() => {
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
                  })()}
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
                  top:    (t2m(dragOverTime) - workStart) / 30 * SLOT_HEIGHT,
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
          <div className="planner-ai-body">
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
          calendars={calendarsList}
          onClose={() => setCalModal(null)}
          onSave={handleSaveCalEvent}
          onDelete={handleDeleteCalEvent}
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
        onClose={() => { setPomodoroActive(false); onEndFocus?.(); }}
        onCycleComplete={recordPomodoroSession}
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

// ── CalendarEventModal ────────────────────────────────────────────────────────
// Crea o modifica un evento su uno qualsiasi dei calendari collegati (non solo
// quello di default) — usato dal pulsante "+ Evento" e dal click su un evento
// nella Timeline, in Settimana o in Mese.
function CalendarEventModal({ mode, event, defaultDate, calendars, onClose, onSave, onDelete }) {
  const defaultCalId = calendars.find(c => c.isDefaultCalendar)?.id || calendars[0]?.id || '';
  const eventIsAllDay = event ? isAllDay(event) : false;

  const [calendarId, setCalendarId] = useState(event?._calId ?? '');
  const [subject, setSubject]       = useState(event?.subject || '');
  const [allDay, setAllDay]         = useState(eventIsAllDay);
  const [date, setDate]             = useState(
    event ? (event.start?.dateTime || event.start?.date || '').slice(0, 10) : (defaultDate || todayStr())
  );
  const [startTime, setStartTime]   = useState(event && !eventIsAllDay ? isoToHHMM(event.start?.dateTime) : '09:00');
  const [endTime, setEndTime]       = useState(event && !eventIsAllDay ? isoToHHMM(event.end?.dateTime) : '10:00');
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
function TaskDetailPanel({ task, notebooks = [], sectionsMap = {}, pagesCache = null, onClose, onCompleted, onDeleted, onRenamed, onDueChanged }) {
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
    setDueDraft(val);
    setSavingDue(true);
    try {
      await updateTaskDueDate(task._listId, task.id, val || null);
      onDueChanged?.(val ? { dateTime: val, timeZone: 'UTC' } : null);
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

  async function handleToggle(item) {
    const checked = !item.isChecked;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: checked } : i));
    try { await updateChecklistItem(task._listId, task.id, item.id, checked); } catch (e) { console.error('toggle checklist', e); }
  }

  async function handleDelete(itemId) {
    setItems(prev => prev.filter(i => i.id !== itemId));
    try { await deleteChecklistItem(task._listId, task.id, itemId); } catch (e) { console.error('delete checklist', e); }
  }

  async function handleAdd(e) {
    e.preventDefault();
    const text = newItemText.trim();
    if (!text) return;
    setNewItemText('');
    const tmp = { id: `tmp-${Date.now()}`, displayName: text, isChecked: false };
    setItems(prev => [...prev, tmp]);
    try {
      const created = await createChecklistItem(task._listId, task.id, text);
      setItems(prev => prev.map(i => i.id === tmp.id ? created : i));
    } catch {
      setItems(prev => prev.filter(i => i.id !== tmp.id));
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
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: text } : i));
    try {
      await renameChecklistItem(task._listId, task.id, item.id, text);
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
    setEditingTitle(false);
    if (!title || title === task.title) { setTitleDraft(task.title); return; }
    setTitleDraft(title);
    updateTaskTitle(task._listId, task.id, title)
      .then(() => onRenamed?.(title))
      .catch(e => { console.error('rename task', e); setTitleDraft(task.title); });
  }

  async function handleCompleteTask() {
    setWorking(true);
    try {
      await completeTask(task._listId, task.id);
      onCompleted?.();
    } catch (e) { console.error('complete task', e); }
    setWorking(false);
  }

  async function handleDeleteTask() {
    if (!window.confirm(`Eliminare definitivamente il task "${task.title}"? L'operazione non è reversibile.`)) return;
    setWorking(true);
    try {
      await deleteTask(task._listId, task.id);
      onDeleted?.();
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
function WeeklyTimeline({ weekDays, plans, calEvents, workStart, timeSlots, onDayClick, onMoveBlock, onEventClick }) {
  const today = todayStr();
  const [dragOver, setDragOver] = useState(null); // { day, min }
  const workEnd = workStart + timeSlots.length * 30;

  function slotFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const idx  = Math.floor(relY / SLOT_HEIGHT);
    return Math.max(workStart, Math.min(workEnd - 30, workStart + idx * 30));
  }

  function handleColDragOver(e, day) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ day, min: slotFromEvent(e) });
  }

  function handleColDrop(e, day) {
    e.preventDefault();
    const min = slotFromEvent(e);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'weekblock') onMoveBlock(data.fromDay, data.blockId, day, m2t(min));
    } catch { /* payload drag non valido — ignora */ }
    setDragOver(null);
  }

  return (
    <div className="planner-week-wrap">
      <div className="planner-week-head">
        <div className="planner-week-gutter" />
        {weekDays.map(day => (
          <div
            key={day}
            className={`planner-week-day-header${day === today ? ' today' : ''}`}
            onClick={() => onDayClick(day)}>
            {new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        ))}
      </div>
      {/* All-day events row */}
      <div className="planner-week-allday-row">
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
      </div>
      <div className="planner-week-body">
        <div className="planner-week-gutter-col">
          {timeSlots.map(slot => (
            <div key={slot} className="planner-week-slot-label" style={{ height: SLOT_HEIGHT }}>{slot}</div>
          ))}
        </div>
        {weekDays.map(day => {
          const dayPlan   = plans[day] || { blocks: [] };
          const dayEvents = calEvents.filter(ev =>
            !isAllDay(ev) && (ev.start?.dateTime || ev.start?.date || '').slice(0, 10) === day
          );
          return (
            <div
              key={day}
              className={`planner-week-day-col${day === today ? ' today' : ''}`}
              onDragOver={e => handleColDragOver(e, day)}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null);
              }}
              onDrop={e => handleColDrop(e, day)}>
              {timeSlots.map(slot => (
                <div key={slot} className="planner-week-slot-row" style={{ height: SLOT_HEIGHT }} />
              ))}
              {dragOver?.day === day && (
                <div
                  className="planner-week-drop-indicator"
                  style={{ top: (dragOver.min - workStart) / 30 * SLOT_HEIGHT, height: SLOT_HEIGHT }}>
                  {m2t(dragOver.min)}
                </div>
              )}
              {dayEvents.map((ev, i) => {
                const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
                const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
                if (!evStart || !evEnd) return null;
                const top    = Math.max(0, (t2m(evStart) - workStart) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT / 2, (t2m(evEnd) - t2m(evStart)) / 30 * SLOT_HEIGHT);
                return (
                  <div key={i} className="planner-week-cal-event"
                    style={{ top, height }}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    title={`${evStart}–${evEnd} · ${ev.subject} (clicca per modificare)`}>
                    <span className="planner-event-time">{evStart}</span>
                    <span className="planner-event-title">{ev.subject}</span>
                  </div>
                );
              })}
              {dayPlan.blocks.map(block => {
                const top    = Math.max(0, (t2m(block.startTime) - workStart) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT - 4, (t2m(block.endTime) - t2m(block.startTime)) / 30 * SLOT_HEIGHT - 4);
                return (
                  <div key={block.id}
                    className={`planner-week-task-block${block.completed ? ' completed' : ''}`}
                    style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: `${block.projectColor}4d` }}
                    title={`${block.startTime}–${block.endTime} · ${block.taskTitle} (trascina per spostare)`}
                    draggable={!block.completed}
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekblock', blockId: block.id, fromDay: day }));
                    }}>
                    <span className="planner-block-title">{block.taskTitle}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

