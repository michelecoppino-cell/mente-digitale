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

/** Quanto tenere premuta una card prima che si apra «Sposta in…». */
const LONG_PRESS_MS = 450;
/** Oltre questo scarto in px la pressione è uno scorrimento, non una pressione. */
const LONG_PRESS_SLOP = 10;

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
 * @param {(t: import('./types').TodoTask) => void} props.onLongPress  apre «Sposta in…»
 * @param {(t: import('./types').TodoTask) => void} props.onDragStart
 * @param {() => void} props.onDragEnd
 */
function TaskCard({ task, status, config, placement, dragging, onClick, onLongPress, onDragStart, onDragEnd }) {
  // Pressione lunga: da telefono è l'unico modo di cambiare colonna a un task,
  // perché il drag & drop delle colonne è su eventi HTML5 che su touch non
  // partono nemmeno. Lo scorrimento della colonna deve continuare a funzionare,
  // quindi un movimento oltre lo slop annulla la pressione invece di bloccarlo.
  const pressTimerRef = useRef(/** @type {number|null} */ (null));
  const pressStartRef = useRef({ x: 0, y: 0 });
  const pressFiredRef = useRef(false);

  function cancelPress() {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  useEffect(() => cancelPress, []);

  function handleTouchStart(/** @type {import('react').TouchEvent} */ e) {
    const t = e.touches[0];
    pressStartRef.current = { x: t.clientX, y: t.clientY };
    pressFiredRef.current = false;
    cancelPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      pressFiredRef.current = true;
      onLongPress(task);
    }, LONG_PRESS_MS);
  }

  function handleTouchMove(/** @type {import('react').TouchEvent} */ e) {
    const t = e.touches[0];
    if (Math.abs(t.clientX - pressStartRef.current.x) > LONG_PRESS_SLOP ||
        Math.abs(t.clientY - pressStartRef.current.y) > LONG_PRESS_SLOP) cancelPress();
  }

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
      title="Tieni premuta la card per spostarla"
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task); }}
      onDragEnd={onDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      // Su iOS la pressione lunga aprirebbe il menù di sistema sopra il nostro.
      onContextMenu={e => e.preventDefault()}
      // Il click che segue il touchend va ignorato: la pressione lunga ha già
      // fatto il suo, aprire anche il task sarebbe un secondo comando gratis.
      onClick={() => {
        if (pressFiredRef.current) { pressFiredRef.current = false; return; }
        onClick(task);
      }}>
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
 * @param {(t: import('./types').TodoTask) => void} props.onOpenTask
 * @param {(t: import('./types').TodoTask) => void} props.onClarify        card di Inbox: va chiarita, non spostata
 * @param {(t: import('./types').TodoTask, s: string) => void} props.onChangeStatus
 * @param {(t: import('./types').TodoTask) => void} props.onSchedule       porta al Piano sul giorno corrente
 * @param {(t: import('./types').TodoTask) => void} props.onUnschedule     toglie il blocco dal piano
 */
export default function ActivityBoard({
  tasks = [], todoLists = [], plans = {}, config = DEFAULT_CONFIG, loading = false,
  onOpenTask, onClarify, onChangeStatus, onSchedule, onUnschedule,
}) {
  // Filtri e vista stanno nell'URL: la vista è ricaricabile e condivisibile
  // com'è, invece di ripartire sempre da capo.
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(v => v.key === params.get('vista')) ? params.get('vista') : 'flusso';
  const ctxFilter = params.get('ctx') || '';
  const [query, setQuery] = useState('');
  const [dragTask, setDragTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  const [dragOver, setDragOver] = useState(/** @type {string|null} */ (null));
  // Il task su cui è aperto «Sposta in…», e la colonna al centro dello
  // scorrimento orizzontale — sotto i 1100px le cinque colonne non ci stanno.
  const [moveFor, setMoveFor] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  const [activeCol, setActiveCol] = useState(0);
  const columnsRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  const setParam = (/** @type {string} */ key, /** @type {string} */ value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

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

  const statusOf = (/** @type {import('./types').TodoTask} */ task) =>
    taskStatus(task, { scheduledIds: new Set(scheduled.keys()), inboxListId: inboxId });

  /**
   * Le regole di transizione fra colonne, scritte una volta sola: le usa il
   * trascinamento da desktop e il menù «Sposta in…» da telefono.
   */
  function moveTask(/** @type {import('./types').TodoTask} */ task, /** @type {string} */ from, /** @type {string} */ target) {
    if (from === target) return;

    // Uscire da Inbox non è uno spostamento ma il passo di chiarimento: un
    // task di Inbox è solo testo, e per stare in un'altra colonna gli servono
    // contesto, sezione e durata.
    if (from === 'inbox') { onClarify(task); return; }
    // Nessuno finisce in Inbox: l'Inbox è dove le cose arrivano, non dove si
    // rimandano.
    if (target === 'inbox') return;

    if (target === 'scheduled') { onSchedule(task); return; }
    if (from === 'scheduled') { onUnschedule(task); if (target !== 'next') onChangeStatus(task, target); return; }
    onChangeStatus(task, target);
  }

  function handleDrop(/** @type {string} */ target) {
    setDragOver(null);
    const task = dragTask;
    setDragTask(null);
    if (!task) return;
    moveTask(task, statusOf(task), target);
  }

  /** Porta al centro la colonna toccata nella riga di pastiglie. */
  function scrollToColumn(/** @type {number} */ index) {
    const kid = columnsRef.current?.children?.[index];
    kid?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  // Quale colonna si sta guardando: la pastiglia attiva la legge dallo
  // scorrimento, così scorrere col dito e toccare una pastiglia raccontano la
  // stessa cosa. Con cinque colonne i rect sono cinque per evento, e React
  // scarta da sé i setState che non cambiano il valore.
  function handleColumnsScroll() {
    const el = columnsRef.current;
    if (!el) return;
    const base = el.getBoundingClientRect().left;
    let best = 0;
    let bestDist = Infinity;
    Array.from(el.children).forEach((kid, i) => {
      const dist = Math.abs(kid.getBoundingClientRect().left - base);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    setActiveCol(best);
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
            <button key={t.id} className="ab-deadline-row" onClick={() => onOpenTask(t)}>
              <span className={`ab-due${isTaskOverdue(t.dueDateTime) ? ' overdue' : ''}`}>{formatDueDate(t.dueDateTime)}</span>
              <span className="ab-deadline-title">{t.title}</span>
              <span className="ab-deadline-list">{t._listName}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ab">
      {header}

      {/* Solo su schermo stretto (CSS). Sotto i 1100px le colonne scorrono in
          orizzontale: su un telefono da 390px se ne vede una e mezza, e niente
          diceva quante fossero né a che punto si era. Le pastiglie sono l'indice
          e la navigazione insieme; il suggerimento dice l'unica cosa che da
          telefono non si può indovinare. */}
      <div className="ab-mobile-nav">
        <div className="ab-pills">
          {COLUMNS.map((col, i) => (
            <button
              key={col.status}
              className={`ab-pill${activeCol === i ? ' active' : ''}`}
              onClick={() => scrollToColumn(i)}>
              {col.label}
              <span className="ab-pill-count">{byStatus[col.status].length}</span>
            </button>
          ))}
        </div>
        <p className="ab-touch-hint">Tieni premuta una card per spostarla di colonna.</p>
      </div>

      <div className="ab-columns" ref={columnsRef} onScroll={handleColumnsScroll}>
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
                  onClick={col.status === 'inbox' ? onClarify : onOpenTask}
                  onLongPress={setMoveFor}
                  onDragStart={setDragTask}
                  onDragEnd={() => { setDragTask(null); setDragOver(null); }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {moveFor && (
        <MoveSheet
          task={moveFor}
          from={statusOf(moveFor)}
          onClose={() => setMoveFor(null)}
          onClarify={onClarify}
          onMove={moveTask}
        />
      )}
    </div>
  );
}

/**
 * Foglio «Sposta in…», aperto dalla pressione lunga su una card.
 * @param {Object} props
 * @param {import('./types').TodoTask} props.task
 * @param {string} props.from                                             colonna di partenza
 * @param {() => void} props.onClose
 * @param {(t: import('./types').TodoTask) => void} props.onClarify
 * @param {(t: import('./types').TodoTask, from: string, to: string) => void} props.onMove
 */
function MoveSheet({ task, from, onClose, onClarify, onMove }) {
  // Nessuno finisce in Inbox per spostamento, e la colonna in cui il task è
  // già non è una destinazione: restano le mete vere.
  const options = COLUMNS.filter(c => c.status !== 'inbox' && c.status !== from);

  return (
    <>
      <div className="ab-move-scrim" onClick={onClose} />
      <div className="ab-move-sheet" role="dialog" aria-label="Sposta l'attività">
        <div className="ab-move-title">{task.title}</div>
        {from === 'inbox' ? (
          // Da Inbox non si sposta: prima si chiarisce. Il foglio lo dice
          // invece di non aprirsi, così la regola si impara una volta.
          <>
            <p className="ab-move-note">
              Da Inbox non si sposta: prima va chiarita — contesto, sezione, durata.
            </p>
            <button className="ab-move-option" onClick={() => { onClose(); onClarify(task); }}>
              Chiariscila
            </button>
          </>
        ) : (
          <>
            <div className="eyebrow ab-move-eyebrow">Sposta in</div>
            {options.map(col => (
              <button
                key={col.status}
                className="ab-move-option"
                onClick={() => { onClose(); onMove(task, from, col.status); }}>
                {col.label}
              </button>
            ))}
          </>
        )}
        <button className="ab-move-cancel" onClick={onClose}>Annulla</button>
      </div>
    </>
  );
}
