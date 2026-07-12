import { useMemo, useState } from 'react';
import Skeleton from './Skeleton';
import { EIS_QUADRANTS, parseEisenhower } from './eisenhower';
import { DEFAULT_CONFIG, findProject, shadeColor, formatDueDate, dueDateSortValue, isTaskOverdue } from './plannerShared';
import { sectionRole } from './paraConfig';

const EMPTY_SET = new Set();

const PARA_OPTIONS = [
  { key: 'project',   label: 'Progetti' },
  { key: 'area',       label: 'Aree' },
  { key: 'resources',  label: 'Risorse' },
  { key: 'archive',    label: 'Archivio' },
];

// null = nessun filtro attivo (tutti inclusi); altrimenti un Set delle chiavi
// incluse. Comportamento uniforme per le tre righe PARA/taccuino/sezione:
// da "tutti" un click isola quell'unico elemento; da una selezione già
// ristretta un click aggiunge/rimuove normalmente (multi-selezione).
function toggleFilter(current, setter, key) {
  if (current === null) { setter(new Set([key])); return; }
  setter(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
}

function serializeFilter(f) {
  return f === null ? 'null' : Array.from(f).sort().join(',');
}

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
  // PARA: quali ruoli di sezione mostrare — di default "progetti" e "aree"
  // (le sezioni senza prefisso PARA + quelle con prefisso "area").
  const [paraFilter, setParaFilter]       = useState(() => new Set(['project', 'area']));
  // Taccuino/sezione: null = "tutti" (nessun filtro attivo)
  const [workbookFilter, setWorkbookFilter] = useState(null);
  const [sectionFilter, setSectionFilter]   = useState(null);
  const [poolViewMode, setPoolViewMode]   = useState('list');

  // Azzera i filtri quando cambia la lista task (nuovo giorno, nuovo
  // caricamento…) — aggiustamento durante il render, non un effetto.
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setParaFilter(new Set(['project', 'area']));
    setWorkbookFilter(null);
    setSectionFilter(null);
  }

  // I filtri sono a cascata: restringere PARA o taccuino azzera le righe
  // sottostanti (che altrimenti potrebbero restare bloccate su una
  // combinazione ormai vuota) — confrontiamo la "firma" della selezione col
  // render precedente, non l'istanza del Set, che cambia ad ogni toggle.
  const paraSig = serializeFilter(paraFilter);
  const [prevParaSig, setPrevParaSig] = useState(paraSig);
  if (paraSig !== prevParaSig) {
    setPrevParaSig(paraSig);
    setWorkbookFilter(null);
    setSectionFilter(null);
  }

  const workbookSig = serializeFilter(workbookFilter);
  const [prevWorkbookSig, setPrevWorkbookSig] = useState(workbookSig);
  if (workbookSig !== prevWorkbookSig) {
    setPrevWorkbookSig(workbookSig);
    setSectionFilter(null);
  }

  const listColorMap = useMemo(() => {
    const map = {};
    for (const nb of notebooks) {
      (sectionsMap[nb.id] || []).forEach((s, i) => {
        map[s.displayName.toLowerCase()] = s._color || shadeColor(nb._color || '#888', i);
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

  // Opzioni a cascata: il taccuino mostra solo ciò che resta dopo il filtro
  // PARA; la sezione mostra solo ciò che resta dopo PARA + taccuino.
  const paraFilteredTasks = tasks.filter(t =>
    paraFilter === null || paraFilter.has(resolveTaskSection(t).role));

  const workbookOptions = (() => {
    const map = new Map();
    for (const t of paraFilteredTasks) {
      const info = resolveTaskSection(t);
      if (!map.has(info.notebookId)) {
        map.set(info.notebookId, { key: info.notebookId, name: info.notebookName, color: info.color });
      }
    }
    return Array.from(map.values());
  })();

  const workbookFilteredTasks = paraFilteredTasks.filter(t =>
    workbookFilter === null || workbookFilter.has(resolveTaskSection(t).notebookId));

  const sectionOptions = (() => {
    const map = new Map();
    for (const t of workbookFilteredTasks) {
      const info = resolveTaskSection(t);
      if (!map.has(info.sectionKey)) {
        map.set(info.sectionKey, { key: info.sectionKey, name: info.sectionName, color: info.color });
      }
    }
    return Array.from(map.values());
  })();

  const poolTasks = workbookFilteredTasks.filter(t => {
    const info = resolveTaskSection(t);
    if (sectionFilter !== null && !sectionFilter.has(info.sectionKey)) return false;
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

  function colorForTask(t) {
    const proj = findProject(t, config);
    return proj?.color ?? listColorMap[(t._listName ?? '').toLowerCase()] ?? '#888';
  }

  const deadlineSortedTasks = [...poolTasks].sort((a, b) =>
    dueDateSortValue(a.dueDateTime) - dueDateSortValue(b.dueDateTime));

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
              <button className={poolViewMode === 'deadline' ? 'active' : ''} onClick={() => setPoolViewMode('deadline')}>Scadenza</button>
            </div>
          )}
        </div>
      )}

      {/* Riga 1 — PARA (progetti / aree / risorse / archivio) */}
      <div className="planner-col-header planner-para-filter-row">
        <div className="planner-filters">
          <button
            className={`planner-filter-btn${paraFilter === null ? ' active' : ''}`}
            onClick={() => setParaFilter(null)}>
            Tutti
          </button>
          {PARA_OPTIONS.map(o => (
            <button
              key={o.key}
              className={`planner-filter-btn${(paraFilter === null || paraFilter.has(o.key)) ? ' active' : ''}`}
              onClick={() => toggleFilter(paraFilter, setParaFilter, o.key)}>
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
              onClick={() => toggleFilter(workbookFilter, setWorkbookFilter, o.key)}>
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
              onClick={() => toggleFilter(sectionFilter, setSectionFilter, o.key)}>
              {o.name}
            </button>
          ))}
        </div>
      </div>

      {poolViewMode === 'list' ? (
        <div className="planner-pool-body">
          {Object.entries(poolByProject).map(([key, group]) => (
            <div key={key} className="planner-pool-group">
              <div className="planner-pool-group-label" style={{ color: group.color }}>
                <span className="planner-group-dot" style={{ background: group.color }} />
                {group.name}
                <span className="planner-group-count">{group.tasks.length}</span>
              </div>
              {group.tasks.map(task => (
                <PoolTaskRow
                  key={task.id}
                  task={task}
                  color={group.color}
                  isScheduled={scheduledIds.has(task.id)}
                  selected={selectedTaskId === task.id}
                  draggable={draggable}
                  onTaskClick={onTaskClick}
                  onDragStart={handleDragStart}
                />
              ))}
            </div>
          ))}

          {poolTasks.length === 0 && (
            tasks.length === 0
              ? <Skeleton rows={7} height={26} />
              : <div className="planner-empty">Nessun task in questa lista</div>
          )}
        </div>
      ) : poolViewMode === 'quadrants' ? (
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
                    {qTasks.map(task => (
                      <PoolTaskRow
                        key={task.id}
                        task={task}
                        color={q.color}
                        isScheduled={scheduledIds.has(task.id)}
                        selected={selectedTaskId === task.id}
                        draggable={draggable}
                        onTaskClick={onTaskClick}
                        onDragStart={handleDragStart}
                        showListName
                      />
                    ))}
                    {qTasks.length === 0 && <div className="planner-eis-cell-empty">Nessun task</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="planner-pool-body">
          {deadlineSortedTasks.map(task => (
            <PoolTaskRow
              key={task.id}
              task={task}
              color={colorForTask(task)}
              isScheduled={scheduledIds.has(task.id)}
              selected={selectedTaskId === task.id}
              draggable={draggable}
              onTaskClick={onTaskClick}
              onDragStart={handleDragStart}
              showListName
            />
          ))}

          {poolTasks.length === 0 && (
            tasks.length === 0
              ? <Skeleton rows={7} height={26} />
              : <div className="planner-empty">Nessun task in questa lista</div>
          )}
        </div>
      )}
    </div>
  );
}

function PoolTaskRow({ task, color, isScheduled, selected, draggable, onTaskClick, onDragStart, showListName = false }) {
  const due = formatDueDate(task.dueDateTime);
  const overdue = isTaskOverdue(task.dueDateTime);
  return (
    <div
      className={`planner-pool-task${isScheduled ? ' scheduled' : ''}${task.importance === 'high' ? ' important' : ''}${selected ? ' selected' : ''}`}
      draggable={draggable && !isScheduled}
      onClick={() => onTaskClick?.(task)}
      onDragStart={draggable && !isScheduled ? e => onDragStart(e, task, color) : undefined}>
      <span className="planner-task-dot" style={{ background: color }} />
      <span className="planner-task-title">{task.title}</span>
      {showListName && task._listName && <span className="planner-eis-grid-task-section">{task._listName}</span>}
      {due && (
        <span className={`planner-due-badge${overdue ? ' overdue' : ''}`} title={`Scadenza: ${due}`}>{due}</span>
      )}
      {task.importance === 'high' && !isScheduled && <span className="planner-task-star">★</span>}
    </div>
  );
}
