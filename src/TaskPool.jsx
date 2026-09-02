// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
// Vista «Task»: il serbatoio del Piano e il pannello Attività, un solo file.
//
// I task sono raggruppati per lista To-Do, e una lista può essere una sezione
// OneNote o una consegna dentro una commessa (`GRUPPO.Consegna-YYMMDD`, vedi
// paraConfig.js). Le consegne si separano da sole — sono liste diverse — ma
// senza un'intestazione sopra sembrerebbero progetti diversi: quella riga, e
// il rientro sotto, sono tutto quello che serve.
//
// Qui i gruppi non si richiudono: a nascondere quello che non serve ci pensano
// già i filtri PARA/taccuino/sezione in cima alla colonna, e due modi di far
// sparire le stesse righe si sarebbero solo dati fastidio.
import { useMemo, useState } from 'react';
import Skeleton from './Skeleton';
import { ordinaAMano, riordinaGruppo, CON_MOUSE } from './taskOrder';
import { useMediaQuery } from './useMediaQuery';
import {
  DEFAULT_CONFIG, findProject, buildListColorMap, listColor,
  formatDueDate, dueDateSortValue, isTaskOverdue, formatDeliverableDue, daysUntil, daysUntilLabel,
} from './plannerShared';
import {
  sectionRole, listGroupKey, listDeliverableLabel, listDueDate, listLabel,
  sectionNameForList, paraSectionLabel,
} from './paraConfig';
import { taskEstimateMin } from './taskModel';
import { durataBreve } from './tempo.js';

const EMPTY_SET = new Set();

/** Come in Sezioni: sotto una settimana la scadenza di una consegna si accende. */
const DUE_SOON_DAYS = 7;

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
  todoLists = [],
  scheduledIds = EMPTY_SET,
  selectedTaskId = null,
  onTaskClick,
  onTaskPatched,
  draggable = true,
  showViewToggle = true,
  title = null,
}) {
  // Il riordino a mano si fa col mouse: vedi taskOrder.js.
  const conMouse = useMediaQuery(CON_MOUSE);
  // Su quale riga si sta passando trascinandone un'altra, per la linea che
  // dice dove finirà.
  const [dropOnId, setDropOnId] = useState(null);
  const [dragTaskId, setDragTaskId] = useState(null);
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

  const listColorMap = useMemo(
    () => buildListColorMap(notebooks, sectionsMap, todoLists),
    [notebooks, sectionsMap, todoLists]
  );

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
          resolved: true,
          notebookId: nb.id,
          notebookName: nb.displayName,
          color: nb._color || '#888',
          role: sectionRole(s.displayName) || 'project',
        };
      });
    }
    return map;
  }, [notebooks, sectionsMap]);

  // Da quale sezione viene ogni lista che compare nel pool. Per le liste 1:1 è
  // il nome stesso; per le consegne annidate va sciolta la commessa, altrimenti
  // i filtri PARA/taccuino/sezione le butterebbero tutte in «Altro» senza che
  // niente lo segnali.
  const sectionKeyByList = useMemo(() => {
    const sectionNames = Object.values(sectionsMap).flat().map(s => s.displayName);
    /** @type {Record<string, string>} */
    const map = {};
    for (const name of new Set(tasks.map(t => t._listName || ''))) {
      if (!name) continue;
      map[name.toLowerCase()] = (sectionNameForList(name, sectionNames) || '').toLowerCase();
    }
    return map;
  }, [tasks, sectionsMap]);

  function resolveTaskSection(task) {
    const listKey = (task._listName || '').toLowerCase();
    const key = sectionKeyByList[listKey] || listKey;
    // Nessuna sezione: la lista non ne ha una omonima, o la commessa è ambigua.
    // Il filtro resta per lista, e il nome mostrato è quello leggibile — la
    // data della consegna non è un pezzo di nome nemmeno qui.
    return sectionInfoMap[key] || {
      sectionKey: key || '__other__',
      sectionName: task._listName ? listLabel(task._listName) : 'Altro',
      resolved: false,
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
    const listName = t._listName ?? '';
    // Un gruppo che è un progetto custom non appartiene a una commessa: i suoi
    // task possono venire da liste diverse, e raggrupparli sotto la sezione del
    // primo sarebbe una bugia.
    const info  = proj ? null : resolveTaskSection(t);
    // Sotto l'intestazione di una commessa il nome della consegna basta — la
    // commessa è già scritta sopra. Dove quell'intestazione non c'è (consegna
    // che non trova la sua sezione) il nome va per esteso, o si perderebbe di
    // chi è. La scadenza, comunque, è una data e non un pezzo di nome.
    const nested = !!listGroupKey(listName);
    const key   = proj?.key ?? `list:${listName || 'altro'}`;
    const name  = proj?.name
      ?? (nested ? (info?.resolved ? listDeliverableLabel(listName) : listLabel(listName)) : listName)
      ?? 'Altro';
    const color = proj?.color ?? listColor(listName, listColorMap);
    if (!poolByProject[key]) {
      poolByProject[key] = {
        name, color, tasks: [],
        commessa: info,
        due: nested ? listDueDate(listName) : null,
      };
    }
    poolByProject[key].tasks.push(t);
  }

  // Dentro il gruppo comanda l'ordine messo a mano, dove c'è: è l'unico che
  // dice in che ordine si vogliono fare le cose, invece di quale scade prima.
  for (const group of Object.values(poolByProject)) {
    group.tasks = ordinaAMano(group.tasks);
  }

  // I gruppi di una stessa commessa, uno sotto l'altro sotto la sua
  // intestazione. Dove le consegne non ci sono l'intestazione non compare, e
  // l'elenco è quello di sempre.
  const poolCommesse = (() => {
    /** @type {Map<string, { key: string, name: string, color: string, nested: boolean, groups: any[], count: number }>} */
    const map = new Map();
    for (const [key, group] of Object.entries(poolByProject)) {
      const info = group.commessa;
      const commessaKey = info ? `sec:${info.sectionKey}` : `grp:${key}`;
      if (!map.has(commessaKey)) {
        map.set(commessaKey, {
          key: commessaKey,
          name: info ? paraSectionLabel(info.sectionName) : group.name,
          color: info ? listColor(info.sectionName, listColorMap, group.color) : group.color,
          nested: false,
          groups: [],
          count: 0,
        });
      }
      const commessa = map.get(commessaKey);
      if (commessa) {
        commessa.groups.push({ key, ...group });
        commessa.count += group.tasks.length;
        // L'intestazione ha senso solo se la commessa è davvero una sezione con
        // dentro delle consegne: per una consegna che non trova la sua sezione
        // (commessa ambigua) sarebbe una riga che ripete quella sotto.
        if (info?.resolved && group.tasks.some(t => listGroupKey(t._listName))) commessa.nested = true;
      }
    }
    return Array.from(map.values());
  })();

  function colorForTask(t) {
    const proj = findProject(t, config);
    return proj?.color ?? listColor(t._listName ?? '', listColorMap);
  }

  const deadlineSortedTasks = [...poolTasks].sort((a, b) =>
    dueDateSortValue(a.scadenza) - dueDateSortValue(b.scadenza));

  /** Il rilascio di una riga sopra un'altra dello stesso gruppo: si riordina.
   *  Fra liste diverse non si fa niente — quello è uno spostamento, e ha il suo
   *  gesto nella colonna Attività di Sezioni. */
  async function handleReorderDrop(gruppo, daTask, suTask) {
    setDropOnId(null);
    setDragTaskId(null);
    const listId = daTask?._listId || '';
    if (!listId || listId !== (suTask?._listId || '') || daTask.id === suTask.id) return;
    try {
      await riordinaGruppo({
        listId, gruppo, daId: daTask.id, suId: suTask.id,
        onOrdinato: (lid, id, patch) => onTaskPatched?.(lid, id, patch),
      });
    } catch (e) { console.error('riordino task', e); }
  }

  function handleDragStart(e, task, color) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', task }));
    const ghost = document.createElement('div');
    ghost.textContent = task.titolo;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      background: color, border: '1.5px dashed rgba(255,255,255,0.6)',
      borderRadius: '6px', color: '#fff',
      padding: '5px 10px', fontSize: '11px', fontFamily: "var(--font-ui)",
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
          {poolCommesse.map(commessa => (
            <div
              key={commessa.key}
              className={`planner-pool-commessa${commessa.nested ? ' nested' : ''}`}>
              {/* L'intestazione della commessa c'è solo quando ha davvero delle
                  consegne: altrimenti sarebbe una riga in più che ripete il
                  nome del gruppo sotto. */}
              {commessa.nested && (
                <div className="planner-pool-commessa-head" style={{ color: commessa.color }}>
                  <span className="planner-group-dot" style={{ background: commessa.color }} />
                  <span className="planner-pool-commessa-name">{commessa.name}</span>
                  <span className="planner-group-count">{commessa.count}</span>
                </div>
              )}
              {commessa.groups.map(group => (
                <div key={group.key} className="planner-pool-group">
                  <div className="planner-pool-group-label" style={{ color: group.color }}>
                    <span className="planner-group-dot" style={{ background: group.color }} />
                    {group.name}
                    <DeliverableDue due={group.due} />
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
                      onDragEnd={() => { setDragTaskId(null); setDropOnId(null); }}
                      onDragTask={setDragTaskId}
                      // Il riordino vale dentro il gruppo, che è una lista: le
                      // righe di un progetto a mano possono venire da liste
                      // diverse, e lì riordinare non vuol dire niente.
                      riordinabile={conMouse && !!onTaskPatched
                        && dragTaskId !== null && dragTaskId !== task.id
                        && group.tasks.some(t => t.id === dragTaskId)}
                      dropOn={dropOnId === task.id}
                      onDropOn={() => setDropOnId(task.id)}
                      onDropLeave={() => setDropOnId(prev => (prev === task.id ? null : prev))}
                      onReorder={() => {
                        const da = group.tasks.find(t => t.id === dragTaskId);
                        if (da) handleReorderDrop(group.tasks, da, task);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}

          {poolTasks.length === 0 && (
            tasks.length === 0
              ? <Skeleton rows={7} height={26} />
              : <div className="planner-empty">Nessun task in questa lista</div>
          )}
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

/** La scadenza di una consegna accanto al suo nome: la data per esteso e
 *  quanto manca nel titolo, perché nella riga non ci sta. Scaduta e in
 *  scadenza si accendono, come nella colonna Attività di Sezioni. */
function DeliverableDue({ due }) {
  if (!due) return null;
  const days = daysUntil(due);
  const label = formatDeliverableDue(due);
  const overdue = days !== null && days < 0;
  const soon = days !== null && days >= 0 && days <= DUE_SOON_DAYS;
  return (
    <span
      className={`planner-group-due${overdue ? ' overdue' : soon ? ' soon' : ''}`}
      title={[label, daysUntilLabel(days)].filter(Boolean).join(' · ')}>
      {label}
    </span>
  );
}

/** "30m", "1h", "1h30" — la stima, nello spazio di una chip. */
const fmtEstimate = durataBreve;

function PoolTaskRow({
  task, color, isScheduled, selected, draggable, onTaskClick, onDragStart, showListName = false,
  onDragEnd, onDragTask, riordinabile = false, dropOn = false, onDropOn, onDropLeave, onReorder,
}) {
  const due = formatDueDate(task.scadenza);
  const overdue = isTaskOverdue(task.scadenza);
  return (
    <div
      className={`planner-pool-task${isScheduled ? ' scheduled' : ''}${selected ? ' selected' : ''}${dropOn ? ' drop-on' : ''}`}
      draggable={draggable && !isScheduled}
      onClick={() => onTaskClick?.(task)}
      onDragStart={draggable && !isScheduled ? e => { onDragTask?.(task.id); onDragStart(e, task, color); } : undefined}
      onDragEnd={onDragEnd}
      onDragOver={riordinabile ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDropOn?.(); } : undefined}
      onDragLeave={riordinabile ? () => onDropLeave?.() : undefined}
      onDrop={riordinabile ? e => { e.preventDefault(); e.stopPropagation(); onReorder?.(); } : undefined}>
      <span className="planner-task-dot" style={{ background: color }} />
      <span className="planner-task-title">{task.titolo}</span>
      {showListName && task._listName && (
        <span className="planner-pool-task-section">{listLabel(task._listName)}</span>
      )}
      {/* La stima serve prima del trascinamento, non dopo: è quella che dice
          se l'attività ci sta nel buco che si sta guardando. */}
      <span className="planner-task-estimate" title="Stima di durata">{fmtEstimate(taskEstimateMin(task))}</span>
      {due && (
        <span className={`planner-due-badge${overdue ? ' overdue' : ''}`} title={`Scadenza: ${due}`}>{due}</span>
      )}
    </div>
  );
}
