import { useMemo, useState } from 'react';
import Skeleton from './Skeleton';
import { EIS_QUADRANTS, parseEisenhower, quadrantInfo } from './eisenhower';
import { DEFAULT_CONFIG, findProject, shadeColor } from './plannerShared';

const EMPTY_SET = new Set();

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
  const [projectFilter, setProjectFilter] = useState('all');
  const [eisFilter, setEisFilter]         = useState('all');
  const [poolViewMode, setPoolViewMode]   = useState('list');

  // Azzera il filtro progetto quando cambia la lista task (nuovo giorno,
  // nuovo caricamento…) — aggiustamento durante il render, non un effetto.
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setProjectFilter('all');
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

  const uniqueLists = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) {
      if (t._listName && !seen.has(t._listName)) {
        const proj = findProject(t, config);
        seen.set(t._listName, { name: t._listName, color: proj?.color || '#888' });
      }
    }
    return Array.from(seen.values());
  }, [tasks, config]);

  const poolTasks = tasks.filter(t => {
    if (projectFilter !== 'all' && t._listName !== projectFilter) return false;
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
      <div className="planner-col-header">
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
