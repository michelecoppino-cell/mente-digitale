import { useMemo, useState } from 'react';
import Skeleton from './Skeleton';
import { EIS_QUADRANTS, parseEisenhower, quadrantInfo } from './eisenhower';
import { DEFAULT_CONFIG, findProject, shadeColor } from './plannerShared';
import { sectionRole } from './paraConfig';

const EMPTY_SET = new Set();

const PARA_OPTIONS = [
  { key: 'project',   label: 'Progetti' },
  { key: 'area',       label: 'Aree' },
  { key: 'resources',  label: 'Risorse' },
  { key: 'archive',    label: 'Archivio' },
];
const ALL_PARA_KEYS = PARA_OPTIONS.map(o => o.key);

// Vista "Task" — usata sia nella colonna sinistra della modalità piano sia,
// identica, nel pannello Attività: un'unica implementazione, non due viste
// che si scollegano nel tempo.
export default function TaskPool({
  tasks = [],
  config = DEFAULT_CONFIG,
  notebooks = [],
  sectionsMap = {},
  scheduledIds = EMPTY_SET,
  selectedTaskId = null,
  onTaskClick,
  draggable = true,
  showViewToggle = true,
  title = null,
}) {
  // PARA: quali ruoli di sezione mostrare — di default solo i "progetti"
  // (le sezioni senza prefisso PARA). null = nessun filtro (tutti inclusi).
  const [paraFilter, setParaFilter]       = useState(() => new Set(['project']));
  // Taccuino/sezione: null = "tutti" (nessun filtro attivo)
  const [workbookFilter, setWorkbookFilter] = useState(null);
  const [sectionFilter, setSectionFilter]   = useState(null);
  const [eisFilter, setEisFilter]         = useState('all');
  const [poolViewMode, setPoolViewMode]   = useState('list');

  // Azzera i filtri quando cambia la lista task (nuovo giorno, nuovo
  // caricamento…) — aggiustamento durante il render, non un effetto.
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setParaFilter(new Set(['project']));
    setWorkbookFilter(null);
    setSectionFilter(null);
  }

  const listColorMap = useMemo(() => {
    const map = {};
    for (const nb of notebooks) {
      (sectionsMap[nb.id] || []).forEach((s, i) => {
        map[s.displayName.toLowerCase()] = shadeColor(nb._color || '#888', i);
      });
    }
    return map;
  }, [notebooks, sectionsMap]);

  // Sezione OneNote (PARA + taccuino) associata a ogni lista To-Do, per nome
  // (case-insensitive) — permette di risalire da un task alla sua collocazione
  // PARA/taccuino/sezione senza bisogno di ulteriore configurazione manuale.
  const sectionInfoMap = useMemo(() => {
    const map = {};
    for (const nb of notebooks) {
      (sectionsMap[nb.id] || []).forEach(s => {
        map[s.displayName.toLowerCase()] = {
          sectionKey: s.displayName.toLowerCase(),
          sectionName: s.displayName,
          notebookId: nb.id,
          notebookName: nb.displayName,
          color: nb._color || '#888',
          role: sectionRole(s.displayName) || 'project',
        };
      });
    }
    return map;
  }, [notebooks, sectionsMap]);

  function resolveTaskSection(task) {
    const key = (task._listName || '').toLowerCase();
    return sectionInfoMap[key] || {
      sectionKey: key || '__other__',
      sectionName: task._listName || 'Altro',
      notebookId: '__other__',
      notebookName: 'Altro',
      color: '#888',
      role: 'project',
    };
  }

  const workbookOptions = (() => {
    const map = new Map();
    for (const nb of notebooks) map.set(nb.id, { key: nb.id, name: nb.displayName, color: nb._color });
    if (tasks.some(t => resolveTaskSection(t).notebookId === '__other__')) {
      map.set('__other__', { key: '__other__', name: 'Altro', color: '#888' });
    }
    return Array.from(map.values());
  })();

  const sectionOptions = (() => {
    const map = new Map();
    for (const t of tasks) {
      const info = resolveTaskSection(t);
      if (!map.has(info.sectionKey)) {
        map.set(info.sectionKey, { key: info.sectionKey, name: info.sectionName, color: info.color });
      }
    }
    return Array.from(map.values());
  })();

  function toggleSetFilter(setter, allOptions, key) {
    setter(prev => {
      const base = prev === null ? new Set(allOptions.map(o => o.key)) : new Set(prev);
      if (base.has(key)) base.delete(key); else base.add(key);
      return base;
    });
  }

  function toggleParaFilter(key) {
    setParaFilter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const poolTasks = tasks.filter(t => {
    const info = resolveTaskSection(t);
    if (!paraFilter.has(info.role)) return false;
    if (workbookFilter !== null && !workbookFilter.has(info.notebookId)) return false;
    if (sectionFilter !== null && !sectionFilter.has(info.sectionKey)) return false;
    if (eisFilter !== 'all' && parseEisenhower(t.body?.content) !== eisFilter) return false;
    return true;
  });

  const poolByProject = {};
  for (const t of poolTasks) {
    const proj  = findProject(t, config);
    const key   = proj?.key ?? `list:${t._listName ?? 'altro'}`;
    const name  = proj?.name ?? t._listName ?? 'Altro';
    const color = proj?.color ?? listColorMap[(t._listName ?? '').toLowerCase()] ?? '#888';
    if (!poolByProject[key]) poolByProject[key] = { name, color, tasks: [] };
    poolByProject[key].tasks.push(t);
  }

  const unclassifiedPoolTasks = poolTasks.filter(t => !parseEisenhower(t.body?.content));

  function handleDragStart(e, task, color) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', task }));
    const ghost = document.createElement('div');
    ghost.textContent = task.title;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      background: color, border: '1.5px dashed rgba(255,255,255,0.6)',
      borderRadius: '6px', color: '#fff',
      padding: '5px 10px', fontSize: '11px', fontFamily: "'Outfit',sans-serif",
      whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden',
      textOverflow: 'ellipsis', opacity: '0.95',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => ghost.parentNode?.removeChild(ghost));
  }

  return (
    <div className="task-pool">
      {(title || showViewToggle) && (
        <div className="planner-col-header">
          {title && <span>{title}</span>}
          {showViewToggle && (
            <div className="planner-view-toggle">
              <button className={poolViewMode === 'list' ? 'active' : ''} onClick={() => setPoolViewMode('list')}>Lista</button>
              <button className={poolViewMode === 'quadrants' ? 'active' : ''} onClick={() => setPoolViewMode('quadrants')}>Quadranti</button>
            </div>
          )}
        </div>
      )}

      {/* Riga 1 — PARA (progetti / aree / risorse / archivio) */}
      <div className="planner-col-header planner-para-filter-row">
        <div className="planner-filters">
          <button
            className={`planner-filter-btn${paraFilter.size === ALL_PARA_KEYS.length ? ' active' : ''}`}
            onClick={() => setParaFilter(new Set(ALL_PARA_KEYS))}>
            Tutti
          </button>
          {PARA_OPTIONS.map(o => (
            <button
              key={o.key}
              className={`planner-filter-btn${paraFilter.has(o.key) ? ' active' : ''}`}
              onClick={() => toggleParaFilter(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Riga 2 — Taccuino (workbook) */}
      <div className="planner-col-header planner-stacked-filter-row">
        <div className="planner-filters">
          <button
            className={`planner-filter-btn${workbookFilter === null ? ' active' : ''}`}
            onClick={() => setWorkbookFilter(null)}>
            Tutti
          </button>
          {workbookOptions.map(o => (
            <button
              key={o.key}
              className={`planner-filter-btn${(workbookFilter === null || workbookFilter.has(o.key)) ? ' active' : ''}`}
              style={{ '--proj-color': o.color }}
              onClick={() => toggleSetFilter(setWorkbookFilter, workbookOptions, o.key)}>
              {o.name}
            </button>
          ))}
        </div>
      </div>

      {/* Riga 3 — Sezione */}
      <div className="planner-col-header planner-stacked-filter-row">
        <div className="planner-filters">
          <button
            className={`planner-filter-btn${sectionFilter === null ? ' active' : ''}`}
            onClick={() => setSectionFilter(null)}>
            Tutti
          </button>
          {sectionOptions.map(o => (
            <button
              key={o.key}
              className={`planner-filter-btn${(sectionFilter === null || sectionFilter.has(o.key)) ? ' active' : ''}`}
              style={{ '--proj-color': o.color }}
              onClick={() => toggleSetFilter(setSectionFilter, sectionOptions, o.key)}>
              {o.name}
            </button>
          ))}
        </div>
      </div>

      {poolViewMode === 'list' && (
        <div className="planner-col-header planner-eis-filter-row">
          <div className="planner-filters">
            <button
              className={`planner-filter-btn${eisFilter === 'all' ? ' active' : ''}`}
              onClick={() => setEisFilter('all')}>
              Tutti i quadranti
            </button>
            {EIS_QUADRANTS.map(q => (
              <button
                key={q.key}
                className={`planner-filter-btn${eisFilter === q.key ? ' active' : ''}`}
                style={{ '--proj-color': q.color }}
                onClick={() => setEisFilter(prev => prev === q.key ? 'all' : q.key)}
                title={q.label}>
                {q.key}
              </button>
            ))}
          </div>
        </div>
      )}

      {poolViewMode === 'list' ? (
        <div className="planner-pool-body">
          {Object.entries(poolByProject).map(([key, group]) => (
            <div key={key} className="planner-pool-group">
              <div className="planner-pool-group-label" style={{ color: group.color }}>
                <span className="planner-group-dot" style={{ background: group.color }} />
                {group.name}
                <span className="planner-group-count">{group.tasks.length}</span>
              </div>
              {group.tasks.map(task => {
                const isScheduled = scheduledIds.has(task.id);
                const eisKey  = parseEisenhower(task.body?.content);
                const eisInfo = eisKey ? quadrantInfo(eisKey) : null;
                return (
                  <div
                    key={task.id}
                    className={`planner-pool-task${isScheduled ? ' scheduled' : ''}${task.importance === 'high' ? ' important' : ''}${selectedTaskId === task.id ? ' selected' : ''}`}
                    draggable={draggable && !isScheduled}
                    onClick={() => onTaskClick?.(task)}
                    onDragStart={draggable && !isScheduled ? e => handleDragStart(e, task, group.color) : undefined}>
                    <span className="planner-task-dot" style={{ background: group.color }} />
                    <span className="planner-task-title">{task.title}</span>
                    {eisInfo && (
                      <span
                        className="planner-eis-badge"
                        style={{ '--q-color': eisInfo.color }}
                        title={eisInfo.label}>
                        {eisInfo.key}
                      </span>
                    )}
                    {task.importance === 'high' && !isScheduled && <span className="planner-task-star">★</span>}
                  </div>
                );
              })}
            </div>
          ))}

          {poolTasks.length === 0 && (
            tasks.length === 0
              ? <Skeleton rows={7} height={26} />
              : <div className="planner-empty">Nessun task in questa lista</div>
          )}
        </div>
      ) : (
        <div className="planner-pool-body planner-eis-grid-body">
          {unclassifiedPoolTasks.length > 0 && (
            <div className="planner-eis-unclassified-banner">
              ⚠️ Alcuni task non sono catalogati
            </div>
          )}
          <div className="planner-eis-grid">
            {EIS_QUADRANTS.map(q => {
              const qTasks = poolTasks.filter(t => parseEisenhower(t.body?.content) === q.key);
              return (
                <div key={q.key} className="planner-eis-cell" style={{ '--q-color': q.color }}>
                  <div className="planner-eis-cell-header">
                    <span className="planner-eis-cell-key">{q.key}</span>
                    <span className="planner-eis-cell-label">{q.label}</span>
                  </div>
                  <div className="planner-eis-cell-tasks">
                    {qTasks.map(task => {
                      const isScheduled = scheduledIds.has(task.id);
                      return (
                        <div
                          key={task.id}
                          className={`planner-pool-task${isScheduled ? ' scheduled' : ''}${task.importance === 'high' ? ' important' : ''}${selectedTaskId === task.id ? ' selected' : ''}`}
                          draggable={draggable && !isScheduled}
                          onClick={() => onTaskClick?.(task)}
                          onDragStart={draggable && !isScheduled ? e => handleDragStart(e, task, q.color) : undefined}>
                          <span className="planner-task-title">{task.title}</span>
                          {task._listName && <span className="planner-eis-grid-task-section">{task._listName}</span>}
                          {task.importance === 'high' && !isScheduled && <span className="planner-task-star">★</span>}
                        </div>
                      );
                    })}
                    {qTasks.length === 0 && <div className="planner-eis-cell-empty">Nessun task</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
