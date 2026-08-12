// @ts-check
// Vista Attività: le cinque colonne del flusso GTD.
//
// Prima questa vista era un elenco unico filtrabile per PARA/taccuino/sezione:
// diceva *dove* stava un task, non *a che punto* fosse. Qui la colonna è lo
// stato — un task ne ha uno solo, e la colonna in cui appare è derivata da
// taskModel.taskStatus, mai un'etichetta salvata a parte.
//
// La lente Eisenhower resta disponibile come vista alternativa (Quadranti),
// applicata alle sole Prossime azioni: è una lettura del serbatoio, non più
// la struttura.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  taskStatus, inboxListId, indexScheduled, taskContext, taskEstimateMin,
  parseWaitingFor, waitingDays, CONTEXTS, isSlipped,
} from './taskModel';
import { DEFAULT_CONFIG, findProject, formatDueDate, dueDateSortValue, isTaskOverdue } from './plannerShared';
import EisenhowerTriage from './EisenhowerTriage';
import Skeleton from './Skeleton';
import TaskDetailDrawer from './TaskDetailDrawer';
import './ActivityBoard.css';

/** Le cinque colonne, nell'ordine del flusso. `done` non ha colonna: i task
 *  completati vivono nello storico del giorno, non nel serbatoio. */
const COLUMNS = [
  { status: 'inbox',     label: 'Inbox',           empty: 'Niente da chiarire' },
  { status: 'next',      label: 'Prossime azioni', empty: 'Nessuna azione pronta' },
  { status: 'waiting',   label: 'In attesa',       empty: 'Non aspetti nessuno' },
  { status: 'scheduled', label: 'Programmate',     empty: 'Nessuna in agenda' },
  { status: 'someday',   label: 'Un giorno',       empty: 'Niente in sospeso' },
];

const VIEWS = [
  { key: 'flusso',    label: 'Flusso' },
  { key: 'quadranti', label: 'Quadranti' },
  { key: 'scadenza',  label: 'Scadenza' },
];

/** 'YYYY-MM-DD' locale. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "1h", "45m", "1h30" — la stima, compatta. */
function fmtEstimate(/** @type {number} */ min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** "oggi 14:30", "dom 9:00", "17/07 9:00" a seconda di quanto è lontano. */
function fmtWhen(/** @type {{date: string, startTime: string}} */ placement) {
  const today = todayStr();
  if (placement.date === today) return `oggi ${placement.startTime}`;
  const d = new Date(placement.date + 'T00:00:00');
  const diff = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000);
  if (diff === 1) return `domani ${placement.startTime}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString('it-IT', { weekday: 'short' })} ${placement.startTime}`;
  return `${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${placement.startTime}`;
}

/**
 * @param {Object} props
 * @param {import('./types').TodoTask} props.task
 * @param {string} props.status
 * @param {import('./types').PlannerConfig} props.config
 * @param {{ date: string, startTime: string, endTime: string, completed: boolean }|null} props.placement
 * @param {boolean} props.dragging
 * @param {(t: import('./types').TodoTask) => void} props.onClick
 * @param {(t: import('./types').TodoTask) => void} props.onDragStart
 * @param {() => void} props.onDragEnd
 */
function TaskCard({ task, status, config, placement, dragging, onClick, onDragStart, onDragEnd }) {
  const ctx = taskContext(task);
  const project = findProject(task, config);
  const waiting = status === 'waiting' ? parseWaitingFor(task) : null;
  const days = waiting ? waitingDays(waiting.since) : null;
  const due = formatDueDate(task.dueDateTime);
  const slipped = placement ? isSlipped(placement, todayStr()) : false;

  return (
    <button
      className={`ab-card ab-card-${status}${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task); }}
      onDragEnd={onDragEnd}
      onClick={() => onClick(task)}>
      <span className="ab-card-title">{task.title}</span>

      <span className="ab-card-meta">
        {project && (
          <span className="ab-chip ab-chip-project" style={/** @type {import('react').CSSProperties} */ ({ '--chip': ctx ? `var(--ctx-${ctx})` : project.color })}>
            {project.name}
          </span>
        )}
        {status === 'next' && <span className="ab-chip">{fmtEstimate(taskEstimateMin(task))}</span>}
        {status === 'scheduled' && placement && (
          <span className={`ab-when${slipped ? ' slipped' : ''}`}>
            {fmtWhen(placement)}{slipped ? ' · non finita' : ''}
          </span>
        )}
        {due && status !== 'scheduled' && (
          <span className={`ab-due${isTaskOverdue(task.dueDateTime) ? ' overdue' : ''}`}>scade {due}</span>
        )}
      </span>

      {waiting && (
        <span className="ab-card-waiting">
          da {waiting.who}{days !== null ? ` · ${days === 0 ? 'oggi' : `${days} ${days === 1 ? 'giorno' : 'giorni'}`}` : ''}
        </span>
      )}
    </button>
  );
}

/**
 * @param {Object} props
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').PlannerConfig} [props.config]
 * @param {boolean} [props.loading]
 * @param {import('./types').Notebook[]} [props.notebooks]
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {{ current: Record<string, import('./types').Page[]> }|null} [props.pagesCache]
 * @param {(t: import('./types').TodoTask) => void} props.onClarify        card di Inbox: va chiarita, non spostata
 * @param {(t: import('./types').TodoTask, s: string) => void} props.onChangeStatus
 * @param {(t: import('./types').TodoTask) => void} props.onSchedule       porta al Piano sul giorno corrente
 * @param {(t: import('./types').TodoTask) => void} props.onUnschedule     toglie il blocco dal piano
 * @param {(listId: string, taskId: string) => void} [props.onTaskRemoved]
 * @param {(listId: string, taskId: string, patch: Object) => void} [props.onTaskPatched]
 * @param {(listId: string, task: import('./types').TodoTask) => void} [props.onTaskRestored]
 */
export default function ActivityBoard({
  tasks = [], todoLists = [], plans = {}, config = DEFAULT_CONFIG, loading = false,
  notebooks = [], sectionsMap = {}, pagesCache = null,
  onClarify, onChangeStatus, onSchedule, onUnschedule,
  onTaskRemoved, onTaskPatched, onTaskRestored,
}) {
  // Filtri e vista stanno nell'URL: la vista è ricaricabile e condivisibile
  // com'è, invece di ripartire sempre da capo.
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(v => v.key === params.get('vista')) ? params.get('vista') : 'flusso';
  const ctxFilter = params.get('ctx') || '';
  const [query, setQuery] = useState('');
  const [dragTask, setDragTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  const [dragOver, setDragOver] = useState(/** @type {string|null} */ (null));
  // L'attività aperta nel cassetto di dettaglio. È stato di vista, non del
  // pool: chiuderla non cambia niente su Graph.
  const [openTask, setOpenTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  // Su schermo stretto le cinque colonne scorrono in orizzontale e se ne vede
  // una e mezza: senza le pastiglie non c'è niente che dica quante sono né a
  // che punto della fila si è.
  const columnsRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [visibleCol, setVisibleCol] = useState(0);

  const setParam = (/** @type {string} */ key, /** @type {string} */ value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  // Il task aperto va riletto dal pool a ogni giro: rinominarlo o metterlo in
  // attesa dal cassetto aggiorna il pool, e la copia nel cassetto resterebbe
  // quella di prima.
  const detailTask = openTask ? tasks.find(t => t.id === openTask.id) || openTask : null;

  const scheduled = useMemo(() => indexScheduled(plans), [plans]);
  const inboxId = useMemo(() => inboxListId(todoLists), [todoLists]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      if (q && !(t.title || '').toLowerCase().includes(q)) return false;
      if (ctxFilter && taskContext(t) !== ctxFilter) return false;
      return true;
    });
  }, [tasks, query, ctxFilter]);

  const byStatus = useMemo(() => {
    /** @type {Record<string, import('./types').TodoTask[]>} */
    const out = { inbox: [], next: [], waiting: [], scheduled: [], someday: [] };
    for (const t of visible) {
      const s = taskStatus(t, { scheduledIds: new Set(scheduled.keys()), inboxListId: inboxId });
      if (out[s]) out[s].push(t);
    }
    // Le programmate in ordine di quando toccano; le altre per scadenza, che è
    // l'unico ordine che significhi qualcosa senza una data di esecuzione.
    out.scheduled.sort((a, b) => {
      const pa = scheduled.get(a.id), pb = scheduled.get(b.id);
      return `${pa?.date} ${pa?.startTime}`.localeCompare(`${pb?.date} ${pb?.startTime}`);
    });
    for (const k of ['next', 'waiting', 'someday', 'inbox']) {
      out[k].sort((a, b) => dueDateSortValue(a.dueDateTime) - dueDateSortValue(b.dueDateTime));
    }
    return out;
  }, [visible, scheduled, inboxId]);

  // La pastiglia attiva segue lo scorrimento: si ricava dalla posizione, non
  // da uno stato a parte, così resta giusta anche scorrendo col dito.
  useEffect(() => {
    const el = columnsRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const width = el.scrollWidth / COLUMNS.length;
      if (!width) return;
      setVisibleCol(Math.min(COLUMNS.length - 1, Math.round(el.scrollLeft / width)));
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view]);

  function scrollToColumn(/** @type {number} */ index) {
    const el = columnsRef.current;
    if (!el) return;
    el.scrollTo({ left: (el.scrollWidth / COLUMNS.length) * index, behavior: 'smooth' });
  }

  function handleDrop(/** @type {string} */ target) {
    setDragOver(null);
    const task = dragTask;
    setDragTask(null);
    if (!task) return;

    const from = taskStatus(task, { scheduledIds: new Set(scheduled.keys()), inboxListId: inboxId });
    if (from === target) return;

    // Uscire da Inbox non è uno spostamento ma il passo di chiarimento: un
    // task di Inbox è solo testo, e per stare in un'altra colonna gli servono
    // contesto, sezione e durata.
    if (from === 'inbox') { onClarify(task); return; }
    // Nessuno finisce in Inbox trascinandocelo: l'Inbox è dove le cose
    // arrivano, non dove si rimandano.
    if (target === 'inbox') return;

    if (target === 'scheduled') { onSchedule(task); return; }
    if (from === 'scheduled') { onUnschedule(task); if (target !== 'next') onChangeStatus(task, target); return; }
    onChangeStatus(task, target);
    // «In attesa» resta una colonna muta finché non si dice da chi si aspetta:
    // il nome vive nelle note, e nessuno può indovinarne la forma. Trascinarci
    // dentro un'attività apre quindi il dettaglio, dove il campo c'è.
    if (target === 'waiting' && !parseWaitingFor(task)) setOpenTask(task);
  }

  const header = (
    <div className="ab-head">
      <input
        className="ab-search"
        type="search"
        placeholder="Filtra le attività…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="ab-chips">
        <button className={`ab-filter${!ctxFilter ? ' active' : ''}`} onClick={() => setParam('ctx', '')}>Tutti</button>
        {CONTEXTS.map(c => (
          <button
            key={c.key}
            className={`ab-filter${ctxFilter === c.key ? ' active' : ''}`}
            style={/** @type {import('react').CSSProperties} */ ({ '--chip': c.color })}
            onClick={() => setParam('ctx', ctxFilter === c.key ? '' : c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="ab-views">
        {VIEWS.map(v => (
          <button
            key={v.key}
            className={view === v.key ? 'active' : ''}
            onClick={() => setParam('vista', v.key === 'flusso' ? '' : v.key)}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );

  // Montato una volta sola, in coda a ogni ramo del render: il cassetto è lo
  // stesso in Flusso, Quadranti e Scadenza.
  const drawer = (
    <TaskDetailDrawer
      task={detailTask}
      notebooks={notebooks}
      sectionsMap={sectionsMap}
      pagesCache={pagesCache}
      onClose={() => setOpenTask(null)}
      onCompleted={() => { if (detailTask) onTaskRemoved?.(detailTask._listId || '', detailTask.id); setOpenTask(null); }}
      onDeleted={() => { if (detailTask) onTaskRemoved?.(detailTask._listId || '', detailTask.id); setOpenTask(null); }}
      onRenamed={title => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, { title }); }}
      onDueChanged={dueDateTime => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, { dueDateTime }); }}
      onPatched={patch => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, patch); }}
      onRestored={(listId, restored) => onTaskRestored?.(listId, restored)}
    />
  );

  if (loading) {
    return (
      <div className="ab">
        {header}
        <div className="ab-columns">
          {COLUMNS.map(c => (
            <div className="ab-col" key={c.status}>
              <div className="ab-col-head"><span className="eyebrow">{c.label}</span></div>
              <div className="ab-col-body"><Skeleton /><Skeleton /><Skeleton /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Quadranti: la lente Eisenhower sulle sole Prossime azioni.
  if (view === 'quadranti') {
    return (
      <div className="ab">
        {header}
        <div className="ab-lens">
          <p className="ab-lens-note">
            I quadranti guardano le <strong>Prossime azioni</strong>: {byStatus.next.length} attività pronte, senza data.
            È la lettura da fare in revisione settimanale, non la struttura del flusso.
          </p>
          <EisenhowerTriage open inline tasks={byStatus.next} onClose={() => setParam('vista', '')} />
        </div>
        {drawer}
      </div>
    );
  }

  // Scadenza: un solo elenco, ordinato per dueDateTime, di tutto ciò che ne ha una.
  if (view === 'scadenza') {
    const withDue = visible
      .filter(t => t.dueDateTime)
      .sort((a, b) => dueDateSortValue(a.dueDateTime) - dueDateSortValue(b.dueDateTime));
    return (
      <div className="ab">
        {header}
        <div className="ab-deadlines">
          {withDue.length === 0 && <div className="ab-empty">Nessuna attività ha una scadenza</div>}
          {withDue.map(t => (
            <button key={t.id} className="ab-deadline-row" onClick={() => setOpenTask(t)}>
              <span className={`ab-due${isTaskOverdue(t.dueDateTime) ? ' overdue' : ''}`}>{formatDueDate(t.dueDateTime)}</span>
              <span className="ab-deadline-title">{t.title}</span>
              <span className="ab-deadline-list">{t._listName}</span>
            </button>
          ))}
        </div>
        {drawer}
      </div>
    );
  }

  return (
    <div className="ab">
      {header}
      {/* Solo su schermo stretto (CSS): cinque pastiglie col conteggio, che
          dicono quante colonne ci sono e portano a quella toccata. */}
      <div className="ab-pills">
        {COLUMNS.map((col, i) => (
          <button
            key={col.status}
            className={`ab-pill${visibleCol === i ? ' active' : ''}`}
            onClick={() => scrollToColumn(i)}>
            {col.label}
            <span className="ab-pill-count">{byStatus[col.status].length}</span>
          </button>
        ))}
      </div>
      <div className="ab-columns" ref={columnsRef}>
        {COLUMNS.map(col => (
          <div
            key={col.status}
            className={`ab-col${dragOver === col.status ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(col.status); }}
            onDragLeave={() => setDragOver(o => (o === col.status ? null : o))}
            onDrop={e => { e.preventDefault(); handleDrop(col.status); }}>
            <div className="ab-col-head">
              <span className="eyebrow">{col.label}</span>
              <span className="ab-count">{byStatus[col.status].length}</span>
            </div>
            <div className="ab-col-body">
              {byStatus[col.status].length === 0 && <div className="ab-empty">{col.empty}</div>}
              {byStatus[col.status].map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  status={col.status}
                  config={config}
                  placement={scheduled.get(t.id) || null}
                  dragging={dragTask?.id === t.id}
                  onClick={col.status === 'inbox' ? onClarify : setOpenTask}
                  onDragStart={setDragTask}
                  onDragEnd={() => { setDragTask(null); setDragOver(null); }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {drawer}
    </div>
  );
}
