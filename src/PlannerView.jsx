import { useState, useEffect, useRef, useMemo } from 'react';
import {
  loadDailyPlans, saveDailyPlans,
  loadPlannerConfig, savePlannerConfig,
  getRecentEmails, completeTask, getCalendarEvents,
  getTask, updateTaskBody,
  createChecklistItem, updateChecklistItem, deleteChecklistItem,
} from './api';
import { cacheGet, cacheSet } from './cache';
import './PlannerView.css';

// ── Constants ─────────────────────────────────────────────────────────────────
const SLOT_HEIGHT      = 48;  // px per 30-min slot
const DEFAULT_DURATION = 60;  // minutes for newly dropped tasks
const SAVE_DEBOUNCE    = 2000;
const PLANS_CACHE_TTL  = 5 * 60 * 1000;

const DEFAULT_CONFIG = {
  projects: [
    { key: 'p1', name: 'Progetto 1', color: '#7eb8c9', todoListNames: [] },
    { key: 'p2', name: 'Progetto 2', color: '#c084a0', todoListNames: [] },
  ],
  workdayStart: '06:00',
  workdayEnd: '20:00',
};

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
function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function isoToHHMM(iso) {
  if (!iso) return null;
  if (!iso.includes('T')) return iso.slice(0, 5);
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function findProject(task, cfg) {
  const name = (task._listName || '').toLowerCase();
  for (const p of cfg.projects) {
    if ((p.todoListNames || []).some(n => n.toLowerCase() === name)) return p;
  }
  return null;
}

function isAllDay(ev) {
  return ev.isAllDay || (!ev.start?.dateTime && !!ev.start?.date);
}

function shadeColor(hex, step) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  const f = 1 - step * 0.1;
  const r = Math.min(255, Math.max(20, Math.round(((num >> 16) & 0xFF) * f)));
  const g = Math.min(255, Math.max(20, Math.round(((num >> 8) & 0xFF) * f)));
  const b = Math.min(255, Math.max(20, Math.round((num & 0xFF) * f)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function getWeekDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day.toISOString().split('T')[0];
  });
}

// ── Main PlannerView ──────────────────────────────────────────────────────────
export default function PlannerView({ open, onClose, preloadedTasks = [], notebooks = [], sectionsMap = {} }) {
  const [currentDate, setCurrentDate]       = useState(todayStr);
  const [plans, setPlans]                   = useState({});
  const [config, setConfig]                 = useState(DEFAULT_CONFIG);
  const [todayPlan, setTodayPlan]           = useState({ date: todayStr(), blocks: [], emailExtractedActions: [] });
  const [calEvents, setCalEvents]           = useState([]);
  const [projectFilter, setProjectFilter]   = useState('all');
  const [saveStatus, setSaveStatus]         = useState('idle');
  const [emailStatus, setEmailStatus]       = useState('idle');
  const [aiStatus, setAiStatus]             = useState('idle');
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [breakdownModal, setBreakdownModal] = useState(null);
  const [dragOverTime, setDragOverTime]     = useState(null);
  const [viewMode, setViewMode]             = useState('day');
  const [resizingId, setResizingId]         = useState(null);
  const [selectedTask, setSelectedTask]     = useState(null);
  const [rightPanel, setRightPanel]         = useState('detail');
  const [poolWidth, setPoolWidth]           = useState(280);
  const [aiWidth, setAiWidth]               = useState(280);

  const timelineBodyRef = useRef(null);
  const saveTimerRef    = useRef(null);
  const plansRef        = useRef({});
  const configRef       = useRef(DEFAULT_CONFIG);
  const resizingRef     = useRef(null);

  // ── Load on open / date change ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    loadAll();
    // Scroll to current hour on open
    requestAnimationFrame(() => {
      if (!timelineBodyRef.current) return;
      const now = new Date();
      const workStart = t2m(configRef.current.workdayStart);
      const cur = now.getHours() * 60 + now.getMinutes();
      const offset = Math.max(0, (cur - workStart) / 30 * SLOT_HEIGHT - 80);
      timelineBodyRef.current.scrollTop = offset;
    });
  }, [open, currentDate, viewMode]); // eslint-disable-line

  // Reset filter when tasks list changes
  useEffect(() => { setProjectFilter('all'); }, [preloadedTasks]);

  async function loadAll() {
    await Promise.all([initConfig(), initPlans()]);
    fetchCalEvents();
  }

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

  async function fetchCalEvents() {
    try {
      let start, end;
      if (viewMode === 'week') {
        const wd = getWeekDays(currentDate);
        start = new Date(wd[0] + 'T00:00:00');
        end   = new Date(wd[6] + 'T23:59:59');
      } else {
        start = new Date(currentDate + 'T00:00:00');
        end   = new Date(currentDate + 'T23:59:59');
      }
      const evs = await getCalendarEvents(start, end);
      setCalEvents(evs);
    } catch (e) { console.error('cal events load', e); }
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
      scheduleSave(next);
      return next;
    });
  }

  // ── DnD ─────────────────────────────────────────────────────────────────────
  function handleTimelineDragOver(e) {
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
    if (!dragOverTime) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'task')   addBlock(data.task, dragOverTime, false);
      else if (data.type === 'block') moveBlock(data.blockId, dragOverTime);
    } catch {}
    setDragOverTime(null);
  }

  function addBlock(task, startTime, fromRollover) {
    const proj    = findProject(task, configRef.current);
    const color   = proj?.color ?? listColorMapRef.current[(task._listName ?? '').toLowerCase()] ?? '#888';
    const endMin  = Math.min(t2m(startTime) + DEFAULT_DURATION, t2m(configRef.current.workdayEnd));
    const newBlock = {
      id: genId(), taskId: task.id, taskTitle: task.title,
      listId: task._listId, listName: task._listName,
      projectKey: proj?.key || null, projectColor: color,
      startTime, endTime: m2t(endMin),
      completed: false, completedAt: null,
      isAISuggested: false, subSteps: [], fromRollover: !!fromRollover,
    };
    mutatePlan(prev => ({ ...prev, blocks: [...prev.blocks, newBlock] }));
    if (fromRollover) setRolloverBlocks(prev => prev.filter(b => b.taskId !== task.id));
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
      try { await completeTask(block.listId, block.taskId); } catch {}
    }
  }

  function handleRemoveBlock(blockId) {
    mutatePlan(prev => ({ ...prev, blocks: prev.blocks.filter(b => b.id !== blockId) }));
  }

  function handleResizeStart(e, block) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { blockId: block.id, startY: e.clientY, startEndMin: t2m(block.endTime) };
    setResizingId(block.id);

    function onMove(ev) {
      const { blockId, startY, startEndMin } = resizingRef.current;
      const deltaMin = Math.round((ev.clientY - startY) / SLOT_HEIGHT * 30 / 30) * 30;
      const newEndMin = Math.max(startEndMin + 30,
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

  function dismissEmailAction(actionId) {
    mutatePlan(prev => ({
      ...prev,
      emailExtractedActions: (prev.emailExtractedActions || []).map(a =>
        a.id === actionId ? { ...a, dismissed: true } : a
      ),
    }));
  }

  // ── AI ───────────────────────────────────────────────────────────────────────
  async function handleScanEmail() {
    setEmailStatus('loading');
    try {
      const emails = await getRecentEmails();
      if (!emails.length) { setEmailStatus('done'); return; }
      const res  = await fetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract-email-actions', emails: emails.slice(0, 20) }),
      });
      const data = await res.json();
      if (data.actions?.length) {
        const actions = data.actions.map(a => ({ ...a, id: genId(), dismissed: false }));
        mutatePlan(prev => ({
          ...prev,
          emailExtractedActions: [...(prev.emailExtractedActions || []), ...actions],
          emailScanTimestamp: new Date().toISOString(),
        }));
      }
      setEmailStatus('done');
    } catch (e) {
      console.error('scan email', e);
      setEmailStatus('error');
    }
  }

  async function handleGenerateSchedule() {
    setAiStatus('loading');
    try {
      const taskPayload = preloadedTasks.map(t => ({
        taskId: t.id, taskTitle: t.title,
        listId: t._listId, listName: t._listName,
        projectKey: findProject(t, configRef.current)?.key || null,
        importance: t.importance,
        dueDate: t.dueDateTimeValue?.dateTime || null,
      }));
      const evPayload = calEvents.map(ev => ({
        subject: ev.subject,
        startTime: isoToHHMM(ev.start?.dateTime || ev.start?.date),
        endTime:   isoToHHMM(ev.end?.dateTime   || ev.end?.date),
      })).filter(e => e.startTime);
      const res  = await fetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-schedule',
          tasks: taskPayload.slice(0, 30),
          calEvents: evPayload,
          workdayStart: configRef.current.workdayStart,
          workdayEnd:   configRef.current.workdayEnd,
          date: currentDate,
        }),
      });
      const data = await res.json();
      if (data.blocks) {
        const newBlocks = data.blocks.map(b => ({
          ...b, id: genId(),
          isAISuggested: true, completed: false, completedAt: null,
          subSteps: b.subSteps || [],
          projectColor: configRef.current.projects.find(p => p.key === b.projectKey)?.color || '#888',
        }));
        mutatePlan(prev => ({ ...prev, blocks: newBlocks }));
      }
      setAiStatus('done');
    } catch (e) {
      console.error('generate schedule', e);
      setAiStatus('error');
    }
  }

  async function handleBreakdownTask(block) {
    setBreakdownModal({ block, steps: null, loading: true });
    try {
      const res  = await fetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'breakdown-task',
          taskTitle: block.taskTitle,
          listName:  block.listName,
          projectKey: block.projectKey,
        }),
      });
      const data = await res.json();
      setBreakdownModal({ block, steps: data.steps || [], loading: false });
    } catch {
      setBreakdownModal(prev => ({ ...prev, loading: false, steps: [], error: true }));
    }
  }

  function applyBreakdown(steps) {
    if (!breakdownModal) return;
    mutatePlan(prev => ({
      ...prev,
      blocks: prev.blocks.map(b =>
        b.id === breakdownModal.block.id
          ? { ...b, subSteps: steps.map(s => ({ id: genId(), title: s.title, completed: false })) }
          : b
      ),
    }));
    setBreakdownModal(null);
  }

  // ── Panel resize ─────────────────────────────────────────────────────────────
  function handlePoolResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = poolWidth;
    const onMove = ev => setPoolWidth(Math.max(180, Math.min(520, startW + ev.clientX - startX)));
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleAiResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX, startW = aiWidth;
    const onMove = ev => setAiWidth(Math.max(180, Math.min(520, startW - (ev.clientX - startX))));
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Config ───────────────────────────────────────────────────────────────────
  async function handleSaveConfig(newConfig) {
    setConfig(newConfig);
    configRef.current = newConfig;
    cacheSet('planner_config', newConfig, 30 * 60 * 1000);
    try { await savePlannerConfig(newConfig); } catch (e) { console.error('save config', e); }
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

  const uniqueLists = (() => {
    const seen = new Map();
    for (const t of preloadedTasks) {
      if (t._listName && !seen.has(t._listName)) {
        const proj = findProject(t, config);
        seen.set(t._listName, { name: t._listName, color: proj?.color || '#888' });
      }
    }
    return Array.from(seen.values());
  })();

  const poolTasks = preloadedTasks.filter(t => {
    if (projectFilter === 'all') return true;
    return t._listName === projectFilter;
  });

  const allDayEvents = calEvents.filter(isAllDay);
  const timedEvents  = calEvents.filter(ev => !isAllDay(ev));

  const poolByProject = {};
  for (const t of poolTasks) {
    const proj  = findProject(t, config);
    const key   = proj?.key ?? `list:${t._listName ?? 'altro'}`;
    const name  = proj?.name ?? t._listName ?? 'Altro';
    const color = proj?.color ?? listColorMap[(t._listName ?? '').toLowerCase()] ?? '#888';
    if (!poolByProject[key]) poolByProject[key] = { name, color, tasks: [] };
    poolByProject[key].tasks.push(t);
  }

  const activeEmailActions = (todayPlan.emailExtractedActions || []).filter(a => !a.dismissed);
  const workStart          = t2m(config.workdayStart);

  function saveLabel() {
    const now = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (saveStatus === 'saving') return '⏳ Salvataggio…';
    if (saveStatus === 'saved')  return `💾 ${now}`;
    if (saveStatus === 'error')  return '⚠️ Errore salvataggio';
    return '';
  }

  if (!open) return null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="planner-view">

      {/* Header */}
      <div className="planner-header">
        <div className="planner-header-left">
          <button className="planner-nav-btn" onClick={() => {
            const d = new Date(currentDate + 'T12:00:00');
            d.setDate(d.getDate() - (viewMode === 'week' ? 7 : 1));
            setCurrentDate(d.toISOString().split('T')[0]);
          }}>◀</button>
          <span className="planner-date">
            {viewMode === 'week' ? (() => {
              const wd = getWeekDays(currentDate);
              const f = ds => new Date(ds + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
              return `${f(wd[0])} – ${f(wd[6])}`;
            })() : new Date(currentDate + 'T12:00:00').toLocaleDateString('it-IT', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </span>
          <button className="planner-nav-btn" onClick={() => {
            const d = new Date(currentDate + 'T12:00:00');
            d.setDate(d.getDate() + (viewMode === 'week' ? 7 : 1));
            setCurrentDate(d.toISOString().split('T')[0]);
          }}>▶</button>
          {currentDate !== todayStr() && (
            <button className="planner-today-btn" onClick={() => setCurrentDate(todayStr())}>Oggi</button>
          )}
          <div className="planner-view-toggle">
            <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Giorno</button>
            <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Settimana</button>
          </div>
        </div>
        <div className="planner-header-actions">
          <button
            className={`planner-action-btn${emailStatus === 'loading' ? ' loading' : ''}`}
            onClick={handleScanEmail}
            disabled={emailStatus === 'loading'}
            title="Scansiona email per estrarre action item">
            {emailStatus === 'loading' ? '⏳' : '📧'} Email
          </button>
          <button
            className={`planner-action-btn accent${aiStatus === 'loading' ? ' loading' : ''}`}
            onClick={handleGenerateSchedule}
            disabled={aiStatus === 'loading'}
            title="Genera piano AI per oggi">
            {aiStatus === 'loading' ? '⏳' : '✨'} Piano AI
          </button>
          <button className="planner-action-btn" onClick={() => setSettingsOpen(s => !s)} title="Impostazioni">
            ⚙️
          </button>
          <button className="planner-close-btn" onClick={onClose} title="Chiudi pianificatore">✕</button>
        </div>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel config={config} onSave={handleSaveConfig} onClose={() => setSettingsOpen(false)} />
      )}

      {/* Body */}
      <div className="planner-body">

      {viewMode === 'week' ? (
        <WeeklyTimeline
          weekDays={getWeekDays(currentDate)}
          plans={plans}
          calEvents={calEvents}
          config={config}
          workStart={workStart}
          timeSlots={timeSlots}
          onDayClick={day => { setCurrentDate(day); setViewMode('day'); }}
        />
      ) : (<>

        {/* ── Column 1: Task Pool ── */}
        <div className="planner-pool" style={{ width: poolWidth }}>
          <div className="planner-col-header">
            <span>Task</span>
            <div className="planner-filters">
              <button
                className={`planner-filter-btn${projectFilter === 'all' ? ' active' : ''}`}
                onClick={() => setProjectFilter('all')}>
                Tutti
              </button>
              {uniqueLists.map(list => (
                <button
                  key={list.name}
                  className={`planner-filter-btn${projectFilter === list.name ? ' active' : ''}`}
                  style={{ '--proj-color': list.color }}
                  onClick={() => setProjectFilter(prev => prev === list.name ? 'all' : list.name)}>
                  {list.name}
                </button>
              ))}
            </div>
          </div>
          <div className="planner-pool-body">
            {/* Pool by project */}
            {Object.entries(poolByProject).map(([key, group]) => (
              <div key={key} className="planner-pool-group">
                <div className="planner-pool-group-label" style={{ color: group.color }}>
                  <span className="planner-group-dot" style={{ background: group.color }} />
                  {group.name}
                  <span className="planner-group-count">{group.tasks.length}</span>
                </div>
                {group.tasks.map(task => {
                  const isScheduled = scheduledIds.has(task.id);
                  return (
                    <div
                      key={task.id}
                      className={`planner-pool-task${isScheduled ? ' scheduled' : ''}${task.importance === 'high' ? ' important' : ''}${selectedTask?.id === task.id ? ' selected' : ''}`}
                      draggable={!isScheduled}
                      onClick={() => { setSelectedTask(task); setRightPanel('detail'); }}
                      onDragStart={isScheduled ? undefined : e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', task }));
                        const c = group.color;
                        const ghost = document.createElement('div');
                        ghost.textContent = task.title;
                        Object.assign(ghost.style, {
                          position: 'fixed', top: '-9999px', left: '-9999px',
                          background: c, border: `1.5px dashed rgba(255,255,255,0.6)`,
                          borderRadius: '6px', color: '#fff',
                          padding: '5px 10px', fontSize: '11px', fontFamily: "'Outfit',sans-serif",
                          whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden',
                          textOverflow: 'ellipsis', opacity: '0.82',
                        });
                        document.body.appendChild(ghost);
                        e.dataTransfer.setDragImage(ghost, 10, 10);
                        requestAnimationFrame(() => ghost.parentNode?.removeChild(ghost));
                      }}>
                      <span className="planner-task-dot" style={{ background: group.color }} />
                      <span className="planner-task-title">{task.title}</span>
                      {task.importance === 'high' && !isScheduled && <span className="planner-task-star">★</span>}
                    </div>
                  );
                })}
              </div>
            ))}

            {poolTasks.length === 0 && (
              <div className="planner-empty">
                {preloadedTasks.length === 0
                  ? 'Caricamento task in corso…'
                  : 'Nessun task in questa lista'}
              </div>
            )}
          </div>
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
          {allDayEvents.length > 0 && (
            <div className="planner-allday-strip">
              {allDayEvents.map((ev, i) => (
                <span key={i} className="planner-allday-chip" title={ev.subject}>{ev.subject}</span>
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

            {/* Calendar events — absolute, read-only */}
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
                  title={`${evStart}–${evEnd} · ${ev.subject}${ev._calName ? ` (${ev._calName})` : ''}`}>
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
                <div
                  key={block.id}
                  className={`planner-block${block.completed ? ' completed' : ''}${block.isAISuggested ? ' ai-suggested' : ''}`}
                  style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: `${block.projectColor}22` }}
                  draggable={!block.completed && resizingId !== block.id}
                  onClick={() => {
                    if (block.taskId && block.listId) {
                      setSelectedTask({ id: block.taskId, title: block.taskTitle, _listId: block.listId, _listName: block.listName });
                      setRightPanel('detail');
                    }
                  }}
                  onDragStart={e => {
                    e.stopPropagation();
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'block', blockId: block.id }));
                  }}>
                  <div className="planner-block-header">
                    <button
                      className="planner-block-check"
                      style={{ color: block.completed ? '#86c07a' : block.projectColor }}
                      onClick={() => handleCompleteBlock(block.id)}
                      title="Segna come completato">
                      {block.completed ? '✓' : '○'}
                    </button>
                    <span className="planner-block-title">{block.taskTitle}</span>
                    <div className="planner-block-actions">
                      <button className="planner-block-btn" onClick={() => handleBreakdownTask(block)} title="Scomponi in sottostep">🔀</button>
                      <button className="planner-block-btn" onClick={() => handleRemoveBlock(block.id)} title="Rimuovi">✕</button>
                    </div>
                  </div>
                  <div className="planner-block-meta">
                    <span>{block.startTime}–{block.endTime}</span>
                    {block.listName && <span>{block.listName}</span>}
                    {block.isAISuggested && <span className="planner-ai-badge">AI</span>}
                  </div>
                  {block.subSteps?.length > 0 && (
                    <div className="planner-block-steps">
                      {block.subSteps.slice(0, 3).map(s => (
                        <div key={s.id} className={`planner-step${s.completed ? ' done' : ''}`}>· {s.title}</div>
                      ))}
                    </div>
                  )}
                  {!block.completed && (
                    <div className="planner-block-resize" onMouseDown={e => handleResizeStart(e, block)} />
                  )}
                </div>
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
        {/* ── Column 3: Detail / AI Panel ── */}
        <div className="planner-ai-panel" style={{ width: aiWidth }}>
          <div className="planner-col-header">
            <div className="planner-panel-tabs">
              <button
                className={`planner-panel-tab${rightPanel === 'detail' ? ' active' : ''}`}
                onClick={() => setRightPanel('detail')}>
                📋 Dettagli
              </button>
              <button
                className={`planner-panel-tab${rightPanel === 'assistant' ? ' active' : ''}`}
                onClick={() => setRightPanel('assistant')}>
                🤖 Assistente
              </button>
            </div>
            <span className={`planner-save-status ${saveStatus}`}>{saveLabel()}</span>
          </div>
          <div className="planner-ai-body">

            {rightPanel === 'detail' ? (
              selectedTask ? (
                <TaskDetailPanel
                  task={selectedTask}
                  onClose={() => setSelectedTask(null)}
                />
              ) : (
                <div className="planner-detail-empty">
                  <p>Clicca un task nel pool per vedere note e sottoattività.</p>
                </div>
              )
            ) : (
              <>
                {/* Email actions */}
                {activeEmailActions.length > 0 && (
                  <div className="planner-ai-section">
                    <div className="planner-ai-section-title">📧 Action da email</div>
                    {activeEmailActions.map(a => (
                      <div key={a.id} className="planner-email-action">
                        <div className="planner-email-action-text">{a.extractedAction}</div>
                        <div className="planner-email-action-meta" title={`Da: ${a.from}`}>{a.subject?.slice(0, 35)}</div>
                        <div className="planner-email-action-btns">
                          <button
                            className="planner-email-add-btn"
                            onClick={() => {
                              addBlock(
                                { id: genId(), title: a.extractedAction, _listId: null, _listName: 'Email' },
                                config.workdayStart,
                                false
                              );
                              dismissEmailAction(a.id);
                            }}>
                            + Timeline
                          </button>
                          <button className="planner-email-dismiss-btn" onClick={() => dismissEmailAction(a.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Active blocks summary */}
                {todayPlan.blocks.length > 0 && (
                  <div className="planner-ai-section">
                    <div className="planner-ai-section-title">
                      📋 Piano di oggi
                      <span className="planner-ai-count">{todayPlan.blocks.filter(b => !b.completed).length} attivi</span>
                    </div>
                    {todayPlan.blocks
                      .filter(b => !b.completed)
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .slice(0, 8)
                      .map(b => (
                        <div key={b.id} className="planner-ai-block-item">
                          <span className="planner-ai-time">{b.startTime}</span>
                          <span className="planner-ai-task">{b.taskTitle}</span>
                        </div>
                      ))
                    }
                  </div>
                )}

                {activeEmailActions.length === 0 && todayPlan.blocks.length === 0 && (
                  <div className="planner-ai-empty">
                    <p>Trascina i task dalla lista a sinistra sulla timeline per pianificarli.</p>
                    <p>Usa <strong>📧 Email</strong> per estrarre action item automaticamente.</p>
                    <p>Usa <strong>✨ Piano AI</strong> per generare l&apos;intera giornata con un click.</p>
                  </div>
                )}
              </>
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
              <span>Scomponi: {breakdownModal.block.taskTitle}</span>
              <button onClick={() => setBreakdownModal(null)}>✕</button>
            </div>
            <div className="planner-modal-body">
              {breakdownModal.loading && (
                <div className="planner-modal-loading">Analisi con AI in corso…</div>
              )}
              {!breakdownModal.loading && breakdownModal.error && (
                <div className="planner-modal-loading" style={{ color: '#c07a7a' }}>
                  Errore durante l&apos;analisi. Riprova.
                </div>
              )}
              {!breakdownModal.loading && breakdownModal.steps && (
                <>
                  {breakdownModal.steps.map((s, i) => (
                    <div key={i} className="planner-modal-step">
                      <span>{i + 1}.</span> {s.title}
                    </div>
                  ))}
                  {breakdownModal.steps.length > 0 && (
                    <button className="planner-modal-apply-btn" onClick={() => applyBreakdown(breakdownModal.steps)}>
                      Applica sottostep al blocco
                    </button>
                  )}
                  {breakdownModal.steps.length === 0 && (
                    <div className="planner-modal-loading">Nessun sottostep suggerito.</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TaskDetailPanel ───────────────────────────────────────────────────────────
function TaskDetailPanel({ task, onClose }) {
  const [loading, setLoading]         = useState(true);
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState([]);
  const [newItemText, setNewItemText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const notesTimerRef                 = useRef(null);

  useEffect(() => { load(); }, [task.id]); // eslint-disable-line

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
    } catch {}
    setLoading(false);
  }

  function handleNotesChange(e) {
    const val = e.target.value;
    setNotes(val);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setSavingNotes(true);
      try { await updateTaskBody(task._listId, task.id, val); } catch {}
      setSavingNotes(false);
    }, 1200);
  }

  async function handleToggle(item) {
    const checked = !item.isChecked;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: checked } : i));
    try { await updateChecklistItem(task._listId, task.id, item.id, checked); } catch {}
  }

  async function handleDelete(itemId) {
    setItems(prev => prev.filter(i => i.id !== itemId));
    try { await deleteChecklistItem(task._listId, task.id, itemId); } catch {}
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

  return (
    <div className="planner-task-detail">
      <div className="planner-task-detail-header">
        <div className="planner-task-detail-title">{task.title}</div>
        <div className="planner-task-detail-meta">{task._listName}</div>
        <button className="planner-task-detail-close" onClick={onClose} title="Chiudi">✕</button>
      </div>

      {loading ? (
        <div className="planner-task-detail-loading">Caricamento…</div>
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
            {items.map(item => (
              <div key={item.id} className={`planner-checklist-item${item.isChecked ? ' checked' : ''}`}>
                <button className="planner-checklist-check" onClick={() => handleToggle(item)}>
                  {item.isChecked ? '✓' : '○'}
                </button>
                <span className="planner-checklist-text">{item.displayName}</span>
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
        </>
      )}
    </div>
  );
}

// ── WeeklyTimeline ────────────────────────────────────────────────────────────
function WeeklyTimeline({ weekDays, plans, calEvents, config, workStart, timeSlots, onDayClick }) {
  const today = todayStr();
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
                <span key={i} className="planner-allday-chip" title={ev.subject}>{ev.subject}</span>
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
            <div key={day} className={`planner-week-day-col${day === today ? ' today' : ''}`}>
              {timeSlots.map(slot => (
                <div key={slot} className="planner-week-slot-row" style={{ height: SLOT_HEIGHT }} />
              ))}
              {dayEvents.map((ev, i) => {
                const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
                const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
                if (!evStart || !evEnd) return null;
                const top    = Math.max(0, (t2m(evStart) - workStart) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT / 2, (t2m(evEnd) - t2m(evStart)) / 30 * SLOT_HEIGHT);
                return (
                  <div key={i} className="planner-week-cal-event"
                    style={{ top, height }}
                    title={`${evStart}–${evEnd} · ${ev.subject}`}>
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
                    style={{ top: top + 2, height, borderLeftColor: block.projectColor, background: `${block.projectColor}22` }}
                    title={`${block.startTime}–${block.endTime} · ${block.taskTitle}`}>
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

// ── SettingsPanel ─────────────────────────────────────────────────────────────
function SettingsPanel({ config, onSave, onClose }) {
  const [local, setLocal] = useState(() => JSON.parse(JSON.stringify(config)));

  function setProject(key, field, value) {
    setLocal(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.key === key ? { ...p, [field]: value } : p),
    }));
  }

  return (
    <div className="planner-settings">
      <div className="planner-settings-header">
        <span>Impostazioni Pianificatore</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="planner-settings-body">
        <div className="planner-settings-row">
          <label>Inizio giornata</label>
          <input type="time" value={local.workdayStart}
            onChange={e => setLocal(p => ({ ...p, workdayStart: e.target.value }))} />
        </div>
        <div className="planner-settings-row">
          <label>Fine giornata</label>
          <input type="time" value={local.workdayEnd}
            onChange={e => setLocal(p => ({ ...p, workdayEnd: e.target.value }))} />
        </div>
        <div className="planner-settings-section-title">Progetti (mappa a liste To-Do)</div>
        {local.projects.map(p => (
          <div key={p.key} className="planner-settings-project">
            <input type="color" value={p.color}
              onChange={e => setProject(p.key, 'color', e.target.value)} />
            <input type="text" value={p.name} placeholder="Nome progetto"
              onChange={e => setProject(p.key, 'name', e.target.value)} />
            <input
              type="text"
              value={(p.todoListNames || []).join(', ')}
              placeholder="Nomi liste To-Do (virgola)"
              onChange={e => setProject(p.key, 'todoListNames',
                e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </div>
        ))}
      </div>
      <div className="planner-settings-footer">
        <button className="planner-settings-save-btn" onClick={() => { onSave(local); onClose(); }}>
          Salva impostazioni
        </button>
      </div>
    </div>
  );
}
