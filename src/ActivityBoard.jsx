// @ts-check
// Vista Attività: le cinque colonne del flusso GTD, e dentro due di esse le
// aree «Da chiedere» e «Delegati».
//
// Prima questa vista era un elenco unico filtrabile per PARA/taccuino/sezione:
// diceva *dove* stava un task, non *a che punto* fosse. Qui la colonna è lo
// stato — un task ne ha uno solo, e la colonna in cui appare è derivata da
// taskModel.taskStatus, mai un'etichetta salvata a parte.
//
// Dentro la colonna, invece, i task tornano a raggrupparsi per sezione e a
// portarne il colore, come nel Piano: lo stato dice *quando* ci si lavora, il
// colore *di cosa si tratta*, e le due cose insieme si leggono in un colpo
// d'occhio. Ogni attività sta su una riga sola, con la stima allineata a
// destra; le colonne che non servono — «Un giorno» sempre, «Inbox» quando è
// vuota — si riducono a una striscia, e lo spazio che liberano va al dettaglio
// dell'attività, che sta sempre lì a destra invece di aprirsi sopra la board.
//
// «Da chiedere» e «Delegati» sono due aree in fondo alle colonne «Prossime
// azioni» e «In attesa», non due colonne nuove: le colonne dicono a che punto
// è una cosa, e queste due non sono un punto diverso — sono lo stesso punto
// con dentro una persona. Lì il raggruppamento cambia: per nome e non per
// sezione, perché è la persona il motivo per cui quelle righe stanno insieme.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  taskStatus, inboxListId, indexScheduled, taskContext, taskEstimateMin,
  taskPerson, personRoleFor, waitingDays, CONTEXTS, isSlipped, STATUS_LABELS, STATUS_HINTS,
} from './taskModel';
import { ordinaAMano, riordinaGruppo, CON_MOUSE } from './taskOrder';
import StatusIcon from './StatusIcon';
import {
  DEFAULT_CONFIG, findProject, buildListColorMap, listColor, formatDueDate, dueDateSortValue, isTaskOverdue,
} from './plannerShared';
import { listLabel } from './paraConfig';
import { aggiornaTask } from './taskStore';
import { pushUndo } from './undo';
import { useMediaQuery } from './useMediaQuery';
import Skeleton from './Skeleton';
import TaskDetailPanel from './TaskDetailPanel';
import TaskDetailDrawer from './TaskDetailDrawer';
import './ActivityBoard.css';
import { durataBreve, ymd } from './tempo.js';

/** Le cinque colonne, nell'ordine del flusso. `done` non ha colonna: i task
 *  completati vivono nello storico del giorno, non nel serbatoio.
 *  `collapse` dice quando la colonna si riduce a striscia da sola: 'always'
 *  per «Un giorno» (è il magazzino, non il piano di lavoro), 'empty' per Inbox
 *  (a posta letta non ha niente da dire). */
const COLUMNS = [
  { status: 'inbox',     label: 'Inbox',           empty: 'Niente da chiarire',  collapse: 'empty' },
  { status: 'next',      label: 'Prossime azioni', empty: 'Nessuna azione pronta', sub: 'ask' },
  { status: 'waiting',   label: 'In attesa',       empty: 'Non aspetti nessuno',   sub: 'delegated' },
  { status: 'scheduled', label: 'Programmate',     empty: 'Nessuna in agenda' },
  { status: 'someday',   label: 'Un giorno',       empty: 'Niente in sospeso',   collapse: 'always' },
];

/** Le due aree che stanno *dentro* una colonna, in fondo: le cose da chiedere
 *  sotto le prossime azioni — chiedere è una prossima azione, solo che la fa
 *  partire qualcun altro — e le delegate sotto le attese, perché una cosa
 *  delegata è un'attesa con un nome sopra. Dentro l'area i task si raggruppano
 *  per persona e non per sezione: quando si becca Sara si vuole sapere cosa
 *  chiederle, non a quale commessa appartiene ogni domanda. */
const SUB_AREAS = /** @type {Record<string, { label: string, empty: string }>} */ ({
  ask:       { label: 'Da chiedere', empty: 'Niente da chiedere' },
  delegated: { label: 'Delegati',    empty: 'Niente di delegato' },
});

/** Gli stati che la board disegna: le cinque colonne più le due aree. */
const BOARD_STATUSES = [...COLUMNS.map(c => c.status), ...Object.keys(SUB_AREAS)];

const VIEWS = [
  { key: 'flusso',    label: 'Flusso' },
  { key: 'scadenza',  label: 'Scadenza' },
];

/** Sopra questa soglia il dettaglio è una colonna della board; sotto resta il
 *  cassetto, perché una sesta colonna su un telefono non è una colonna. La
 *  soglia è più alta di quella a cui le colonne cominciano a scorrere (1100px):
 *  fra le due il dettaglio ruberebbe alle colonne lo spazio che le tiene
 *  leggibili. */
const WIDE = '(min-width: 1280px)';

/** Le chiavi attive di un filtro, dal parametro dell'URL: `''` (assente) è il
 *  Set vuoto, cioè «nessun filtro, si vede tutto».
 *  @param {string|null} raw */
function parseFilter(raw) {
  return new Set((raw || '').split(',').filter(Boolean));
}

/** Lo stesso gesto del pool del Piano: dal «tutte» il primo clic isola quella
 *  pastiglia, i clic successivi aggiungono o tolgono. Tolta l'ultima si torna
 *  a vedere tutto.
 *  @param {Set<string>} current @param {string} key */
function toggleFilter(current, key) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key); else next.add(key);
  return Array.from(next).join(',');
}

/** 'YYYY-MM-DD' locale. */
const todayStr = ymd;

/** "1h", "45m", "1h30" — la stima, compatta. */
const fmtEstimate = durataBreve;

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
 * Le liste in cui ci sono davvero attività, col loro conteggio, in
 * ordine alfabetico.
 * @param {import('./taskStore').Task[]} tasks
 * @returns {{ id: string, name: string, count: number }[]}
 */
function countByList(tasks) {
  /** @type {Record<string, { id: string, name: string, count: number }>} */
  const byId = {};
  for (const t of tasks) {
    const id = t._listId || '';
    if (!id) continue;
    if (!byId[id]) byId[id] = { id, name: t._listName || 'Senza lista', count: 0 };
    byId[id].count += 1;
  }
  return Object.values(byId).sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

/** La spunta di un'attività: lo stesso segno di Oggi, perché è la stessa cosa. */
function CheckMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

/**
 * Una riga di attività: spunta, titolo, e a destra il solo dato che conta in
 * quella colonna — la stima fra le prossime azioni, l'orario fra le
 * programmate, la persona fra le attese, le delegate e le cose da chiedere. Una riga sola: prima
 * ogni card ne occupava tre, e in una colonna ci stavano sei attività.
 *
 * @param {Object} props
 * @param {import('./taskStore').Task} props.task
 * @param {string} props.status
 * @param {string} props.color
 * @param {{ date: string, startTime: string, endTime: string, completed: boolean }|null} props.placement
 * @param {boolean} props.dragging
 * @param {boolean} props.selected
 * @param {boolean} [props.showPerson]  il nome della persona a destra: spento dentro
 *                                      le aree, dove il gruppo lo dice già
 * @param {(t: import('./taskStore').Task) => void} props.onClick
 * @param {(t: import('./taskStore').Task) => void} props.onComplete
 * @param {(t: import('./taskStore').Task) => void} props.onDragStart
 * @param {() => void} props.onDragEnd
 * @param {boolean} [props.riordinabile]  ci si può rilasciare sopra un'altra riga
 *                                        della stessa lista, per riordinare
 * @param {boolean} [props.dropOn]        ci si sta passando sopra adesso
 * @param {() => void} [props.onDropOn]
 * @param {() => void} [props.onDropLeave]
 * @param {() => void} [props.onReorder]
 */
function TaskRow({
  task, status, color, placement, dragging, selected, showPerson = true,
  onClick, onComplete, onDragStart, onDragEnd,
  riordinabile = false, dropOn = false, onDropOn, onDropLeave, onReorder,
}) {
  // Il nome si mostra dove la riga non sta già sotto l'intestazione di quella
  // persona: nella colonna «In attesa» sì, dentro le aree per persona no —
  // ripeterlo su ogni riga sarebbe scriverlo due volte.
  const person = showPerson && personRoleFor(status) ? taskPerson(task) : null;
  const days = person ? waitingDays(person.since) : null;
  const due = formatDueDate(task.scadenza);
  const slipped = placement ? isSlipped(placement, todayStr()) : false;

  // La riga non è un <button>: dentro ce n'è uno vero, la spunta, e un bottone
  // dentro un bottone non è HTML valido. Resta attivabile da tastiera.
  return (
    <div
      className={`ab-row ab-row-${status}${dragging ? ' dragging' : ''}${selected ? ' selected' : ''}${dropOn ? ' drop-on' : ''}`}
      style={/** @type {import('react').CSSProperties} */ ({ '--task-color': color })}
      role="button"
      tabIndex={0}
      draggable
      title={task.titolo}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task); }}
      onDragEnd={onDragEnd}
      // Rilasciare una riga sopra un'altra della stessa lista le mette in
      // quell'ordine; il rilascio sulla colonna, che resta quello che cambia
      // stato, non deve partire anche lui.
      onDragOver={riordinabile ? e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; onDropOn?.(); } : undefined}
      onDragLeave={riordinabile ? () => onDropLeave?.() : undefined}
      onDrop={riordinabile ? e => { e.preventDefault(); e.stopPropagation(); onReorder?.(); } : undefined}
      onClick={() => onClick(task)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(task); }
      }}>
      {/* Spuntare da qui: finora un'attività finita si chiudeva solo aprendo
          il dettaglio, o dal blocco in Oggi se era programmata. */}
      <button
        className="ab-row-check"
        title="Segna come fatta"
        aria-label={`Segna "${task.titolo}" come fatta`}
        onClick={e => { e.stopPropagation(); onComplete(task); }}>
        <CheckMark />
      </button>
      <span className="ab-row-title">{task.titolo}</span>

      <span className="ab-row-meta">
        {person && (
          <span className="ab-waiting" title={`${STATUS_LABELS[person.role]}: ${person.who}`}>
            {person.who}{days !== null ? ` · ${days === 0 ? 'oggi' : `${days}g`}` : ''}
          </span>
        )}
        {due && status !== 'scheduled' && (
          <span className={`ab-due${isTaskOverdue(task.scadenza) ? ' overdue' : ''}`} title={`Scade il ${due}`}>{due}</span>
        )}
        {status === 'scheduled' && placement ? (
          <span className={`ab-when${slipped ? ' slipped' : ''}`} title={slipped ? 'Non finita nel blocco previsto' : 'Quando è in programma'}>
            {fmtWhen(placement)}
          </span>
        ) : (
          <span className="ab-est" title="Stima di durata">{fmtEstimate(taskEstimateMin(task))}</span>
        )}
      </span>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {import('./taskStore').Task[]} props.tasks
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').PlannerConfig} [props.config]
 * @param {boolean} [props.loading]
 * @param {import('./types').Notebook[]} [props.notebooks]
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {(t: import('./taskStore').Task) => void} props.onClarify        card di Inbox: va chiarita, non spostata
 * @param {(t: import('./taskStore').Task, s: string) => void} props.onChangeStatus
 * @param {(t: import('./taskStore').Task) => void} props.onSchedule       porta al Piano sul giorno corrente
 * @param {(t: import('./taskStore').Task) => void} props.onUnschedule     toglie il blocco dal piano
 * @param {(listId: string, taskId: string) => void} [props.onTaskRemoved]
 * @param {(listId: string, taskId: string, patch: Object) => void} [props.onTaskPatched]
 * @param {(listId: string, task: import('./taskStore').Task) => void} [props.onTaskRestored]
 */
export default function ActivityBoard({
  tasks = [], todoLists = [], plans = {}, config = DEFAULT_CONFIG, loading = false,
  notebooks = [], sectionsMap = {},
  onClarify, onChangeStatus, onSchedule, onUnschedule,
  onTaskRemoved, onTaskPatched, onTaskRestored,
}) {
  // Filtri e vista stanno nell'URL: la vista è ricaricabile e condivisibile
  // com'è, invece di ripartire sempre da capo.
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(v => v.key === params.get('vista')) ? params.get('vista') : 'flusso';
  // Filtri multipli: nell'URL restano una lista di chiavi separate da virgola
  // (`?lista=a,b`). Un Set vuoto vuol dire «nessun filtro», cioè tutte.
  const ctxFilter = useMemo(() => parseFilter(params.get('ctx')), [params]);
  const listFilter = useMemo(() => parseFilter(params.get('lista')), [params]);
  const [query, setQuery] = useState('');
  const [dragTask, setDragTask] = useState(/** @type {import('./taskStore').Task|null} */ (null));
  const [dragOver, setDragOver] = useState(/** @type {string|null} */ (null));
  // L'attività aperta nel dettaglio. È stato di vista, non del pool: chiuderla
  // non cambia niente su Graph.
  const [openTask, setOpenTask] = useState(/** @type {import('./taskStore').Task|null} */ (null));
  // Le colonne che l'utente ha aperto o chiuso a mano, contro il loro default:
  // solo «Inbox» e «Un giorno» hanno una striscia da cui riaprirsi. `true` =
  // tenuta aperta, `false` = tenuta chiusa, assente = come dice il default.
  const [expandedCols, setExpandedCols] = useState(/** @type {Record<string, boolean>} */ ({}));
  // Le aree «Da chiedere» e «Delegati» partono chiuse: stanno in fondo alla
  // loro colonna come una riga sola, e si aprono col chevron. Sono un elenco
  // che si consulta quando si becca la persona, non mentre si lavora — aperte
  // di default rubavano metà colonna alle prossime azioni e alle attese.
  const [expandedAreas, setExpandedAreas] = useState(/** @type {Record<string, boolean>} */ ({}));
  // Su schermo stretto le cinque colonne scorrono in orizzontale e se ne vede
  // una e mezza: senza le pastiglie non c'è niente che dica quante sono né a
  // che punto della fila si è.
  const columnsRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [visibleCol, setVisibleCol] = useState(0);
  const wide = useMediaQuery(WIDE);
  // Il riordino a mano dentro un gruppo si fa col mouse: vedi taskOrder.js.
  const conMouse = useMediaQuery(CON_MOUSE);
  // Su quale riga si sta passando, per la linea che dice dove finirà quella
  // trascinata.
  const [dropOnId, setDropOnId] = useState(/** @type {string|null} */ (null));

  // Più chiavi in un colpo solo: due `setParam` di fila partirebbero entrambe
  // dagli stessi `params`, e la seconda cancellerebbe la prima.
  const setParam = (/** @type {Record<string, string>} */ patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  // Il task aperto va riletto dal pool a ogni giro: rinominarlo o metterlo in
  // attesa dal dettaglio aggiorna il pool, e la copia tenuta qui resterebbe
  // quella di prima.
  const detailTask = openTask ? tasks.find(t => t.id === openTask.id) || openTask : null;

  const scheduled = useMemo(() => indexScheduled(plans), [plans]);
  const inboxId = useMemo(() => inboxListId(todoLists), [todoLists]);
  // L'insieme degli id programmati, costruito una volta sola. Prima nasceva
  // *dentro* il ciclo che smista i task nelle colonne — un Set nuovo per ogni
  // attività, cioè tanti Set quanti sono i task moltiplicati per i blocchi nel
  // piano. Con quattro liste e un piano di qualche settimana non si notava; è
  // il genere di costo che si fa sentire quando l'archivio cresce, e sta tutto
  // in una riga spostata.
  const scheduledIds = useMemo(() => new Set(scheduled.keys()), [scheduled]);

  // Il colore di ogni sezione, lo stesso che il Piano dà ai blocchi: qui tinge
  // il bordo della riga e il pallino del gruppo.
  // Le liste servono anche al colore: una consegna annidata (`2573.A60`, vedi
  // paraConfig.js) prende una sfumatura del colore della sua commessa, e senza
  // le liste non si saprebbe di chi è figlia.
  const listColorMap = useMemo(
    () => buildListColorMap(notebooks, sectionsMap, todoLists),
    [notebooks, sectionsMap, todoLists]
  );

  /** @param {import('./taskStore').Task} t */
  function colorForTask(t) {
    const proj = findProject(t, config);
    return proj?.color || listColor(t._listName || '', listColorMap);
  }

  // Lo stato del flusso dell'attività aperta nel dettaglio: la board lo sa —
  // conosce i blocchi nel piano e la lista Inbox — e il pannello no.
  const detailStatus = useMemo(
    () => (detailTask
      ? taskStatus(detailTask, { scheduledIds, inboxListId: inboxId })
      : undefined),
    [detailTask, scheduledIds, inboxId],
  );

  // Le liste in cui ci sono davvero attività, col loro conteggio: è
  // così che le attività sono organizzate qui dentro — una lista per sezione
  // PARA — e finora la testata offriva solo i contesti. Chi non li usa aveva
  // tre filtri che non filtravano niente: «Lavoro» svuotava la board invece di
  // mostrare il lavoro.
  const lists = useMemo(() => countByList(tasks), [tasks]);

  // I contesti restano, ma solo per chi li usa davvero: le pastiglie compaiono
  // se almeno un'attività ne porta uno.
  const hasContexts = useMemo(() => tasks.some(t => taskContext(t)), [tasks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(t => {
      if (q && !(t.titolo || '').toLowerCase().includes(q)) return false;
      if (listFilter.size && !listFilter.has(t._listId || '')) return false;
      if (ctxFilter.size && !ctxFilter.has(taskContext(t) || '')) return false;
      return true;
    });
  }, [tasks, query, ctxFilter, listFilter]);

  const byStatus = useMemo(() => {
    /** @type {Record<string, import('./taskStore').Task[]>} */
    const out = {};
    for (const k of BOARD_STATUSES) out[k] = [];
    for (const t of visible) {
      const s = taskStatus(t, { scheduledIds, inboxListId: inboxId });
      if (out[s]) out[s].push(t);
    }
    // Le programmate in ordine di quando toccano; le altre per scadenza, che è
    // l'unico ordine che significhi qualcosa senza una data di esecuzione.
    out.scheduled.sort((a, b) => {
      const pa = scheduled.get(a.id), pb = scheduled.get(b.id);
      return `${pa?.date} ${pa?.startTime}`.localeCompare(`${pb?.date} ${pb?.startTime}`);
    });
    // Dove l'ordine è stato messo a mano comanda quello: dice in che ordine si
    // vogliono fare le cose, che è un'altra domanda rispetto a quale scade
    // prima. Dove nessuno l'ha toccato resta la scadenza, come sempre.
    for (const k of ['next', 'ask', 'waiting', 'delegated', 'someday', 'inbox']) {
      out[k] = ordinaAMano(out[k], (a, b) => dueDateSortValue(a.scadenza) - dueDateSortValue(b.scadenza));
    }
    return out;
  }, [visible, scheduled, scheduledIds, inboxId]);

  // Dentro la colonna, i task per sezione: lo stesso raggruppamento del Piano,
  // con lo stesso colore. L'ordine dei gruppi è alfabetico — l'ordine interno
  // resta quello della colonna (orario o scadenza).
  const groupedByStatus = useMemo(() => {
    /** @type {Record<string, { key: string, name: string, color: string, tasks: import('./taskStore').Task[] }[]>} */
    const out = {};
    for (const col of COLUMNS) {
      /** @type {Map<string, { key: string, name: string, color: string, tasks: import('./taskStore').Task[] }>} */
      const groups = new Map();
      for (const t of byStatus[col.status]) {
        const proj = findProject(t, config);
        const key = proj?.key || `list:${(t._listName || 'altro').toLowerCase()}`;
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            name: proj?.name || listLabel(t._listName) || 'Altro',
            color: colorForTask(t),
            tasks: [],
          });
        }
        groups.get(key)?.tasks.push(t);
      }
      out[col.status] = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    }
    return out;
    // colorForTask dipende solo da config e listColorMap, entrambe in elenco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byStatus, config, listColorMap]);

  // Le aree, invece, raggruppano per persona: una riga per «Sara», una per
  // «ADC». Il nome è quello scritto sul task — il pannello lo normalizza sul
  // registro (`persone.json`), così «adc» e «ADC» non fanno due gruppi.
  const groupedByPerson = useMemo(() => {
    /** @type {Record<string, { key: string, name: string, tasks: import('./taskStore').Task[] }[]>} */
    const out = {};
    for (const status of Object.keys(SUB_AREAS)) {
      /** @type {Map<string, { key: string, name: string, tasks: import('./taskStore').Task[] }>} */
      const groups = new Map();
      for (const t of byStatus[status]) {
        const who = taskPerson(t)?.who || 'Senza nome';
        const key = who.toLowerCase();
        if (!groups.has(key)) groups.set(key, { key, name: who, tasks: [] });
        groups.get(key)?.tasks.push(t);
      }
      out[status] = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    }
    return out;
  }, [byStatus]);

  /** Quante attività mostra una colonna in tutto: le sue, più quelle dell'area
   *  che le sta in fondo. @param {{status: string, sub?: string}} col */
  function columnCount(col) {
    return byStatus[col.status].length + (col.sub ? byStatus[col.sub].length : 0);
  }

  /** Una colonna è ridotta a striscia se il suo default lo dice e l'utente non
   *  l'ha aperta a mano. @param {{status: string, collapse?: string, sub?: string}} col */
  function isCollapsed(col) {
    if (!col.collapse) return false;
    if (col.status in expandedCols) return !expandedCols[col.status];
    if (col.collapse === 'always') return true;
    return columnCount(col) === 0;
  }

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

    const from = taskStatus(task, { scheduledIds, inboxListId: inboxId });
    if (from === target) return;

    // Uscire da Inbox non è uno spostamento ma il passo di chiarimento: un
    // task di Inbox è solo testo, e per stare in un'altra colonna gli servono
    // contesto, sezione e durata.
    if (from === 'inbox') { onClarify(task); return; }
    // Nessuno finisce in Inbox trascinandocelo: l'Inbox è dove le cose
    // arrivano, non dove si rimandano.
    if (target === 'inbox') return;

    if (target === 'scheduled') { onSchedule(task); return; }
    if (from === 'scheduled') onUnschedule(task);
    onChangeStatus(task, target);
    // Attesa, domanda e delega restano mute finché non si dice di chi si
    // tratta, e nessuno può indovinarlo. Trascinarci dentro un'attività senza
    // persona apre quindi il dettaglio, dove c'è il campo — con l'elenco delle
    // solite persone già pronto.
    if (personRoleFor(target) && !taskPerson(task)) setOpenTask(task);
  }

  /** Il rilascio di una riga sopra un'altra: le mette in quell'ordine. Vale
   *  dentro la stessa lista — un gruppo può essere un progetto a mano con
   *  dentro attività di liste diverse, e lì l'ordine non vorrebbe dire niente.
   *  @param {import('./taskStore').Task[]} gruppo
   *  @param {import('./taskStore').Task} suTask */
  async function handleReorder(gruppo, suTask) {
    const daTask = dragTask;
    setDropOnId(null);
    setDragTask(null);
    const listId = daTask?._listId || '';
    if (!daTask || !listId || listId !== (suTask._listId || '') || daTask.id === suTask.id) return;
    try {
      await riordinaGruppo({
        listId, gruppo, daId: daTask.id, suId: suTask.id,
        onOrdinato: (lid, id, patch) => onTaskPatched?.(lid, id, patch),
      });
    } catch (e) { console.error('riordino attività', e); }
  }

  /** Le props del riordino per una riga dentro un gruppo.
   *  @param {import('./taskStore').Task[]} gruppo
   *  @param {import('./taskStore').Task} t */
  function propsRiordino(gruppo, t) {
    const riordinabile = conMouse && !!dragTask && dragTask.id !== t.id
      && (dragTask._listId || '') === (t._listId || '')
      && gruppo.some(x => x.id === dragTask.id);
    return {
      riordinabile,
      dropOn: dropOnId === t.id,
      onDropOn: () => setDropOnId(t.id),
      onDropLeave: () => setDropOnId(prev => (prev === t.id ? null : prev)),
      onReorder: () => handleReorder(gruppo, t),
    };
  }

  // Spuntare un'attività dalla board. Il completamento sta nel file — la
  // colonna sparisce perché il task esce dal pool, non perché la board tenga
  // un elenco di "fatte" per conto suo — e l'annulla lo riporta indietro come
  // ovunque nell'app.
  async function handleComplete(/** @type {import('./taskStore').Task} */ task) {
    const listId = task._listId || '';
    const snapshot = { ...task };
    const prima = task.stato || 'next';
    onTaskRemoved?.(listId, task.id);
    if (openTask?.id === task.id) setOpenTask(null);
    try {
      await aggiornaTask(listId, task.id, { stato: 'done' });
      pushUndo({
        label: `"${task.titolo}" fatta`,
        undo: async () => {
          await aggiornaTask(listId, task.id, { stato: prima });
          onTaskRestored?.(listId, snapshot);
        },
      });
    } catch (e) {
      console.error('completamento attività', e);
      onTaskRestored?.(listId, snapshot);
    }
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
        <button
          className={`ab-filter${!listFilter.size && !ctxFilter.size ? ' active' : ''}`}
          onClick={() => setParam({ lista: '', ctx: '' })}>
          Tutte
        </button>
        {lists.map(l => (
          <button
            key={l.id}
            className={`ab-filter${!listFilter.size || listFilter.has(l.id) ? ' active' : ''}`}
            style={/** @type {import('react').CSSProperties} */ ({ '--chip': listColor(l.name, listColorMap) })}
            title={`Solo le attività della lista ${listLabel(l.name)}`}
            onClick={() => setParam({ lista: toggleFilter(listFilter, l.id) })}>
            {listLabel(l.name)}
            <span className="ab-filter-count">{l.count}</span>
          </button>
        ))}
        {hasContexts && CONTEXTS.map(c => (
          <button
            key={c.key}
            className={`ab-filter${!ctxFilter.size || ctxFilter.has(c.key) ? ' active' : ''}`}
            style={/** @type {import('react').CSSProperties} */ ({ '--chip': c.color })}
            onClick={() => setParam({ ctx: toggleFilter(ctxFilter, c.key) })}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="ab-views">
        {VIEWS.map(v => (
          <button
            key={v.key}
            className={view === v.key ? 'active' : ''}
            onClick={() => setParam({ vista: v.key === 'flusso' ? '' : v.key })}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );

  // Gli stessi agganci per il pannello, che stia in colonna o nel cassetto.
  const detailProps = {
    sectionsMap,
    onClose: () => setOpenTask(null),
    onCompleted: () => { if (detailTask) onTaskRemoved?.(detailTask._listId || '', detailTask.id); setOpenTask(null); },
    onDeleted: () => { if (detailTask) onTaskRemoved?.(detailTask._listId || '', detailTask.id); setOpenTask(null); },
    onRenamed: (/** @type {string} */ titolo) => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, { titolo }); },
    onDueChanged: (/** @type {string|null} */ scadenza) => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, { scadenza }); },
    onPatched: (/** @type {Object} */ patch) => { if (detailTask) onTaskPatched?.(detailTask._listId || '', detailTask.id, patch); },
    onRestored: (/** @type {string} */ listId, /** @type {any} */ restored) => onTaskRestored?.(listId, restored),
    // Lo stato lo sa la board, non il file: `scheduled` non è scritto da
    // nessuna parte — è la presenza di un blocco nel piano — e senza dirglielo
    // il pannello mostrerebbe «Prossima azione» per un'attività aperta dalla
    // colonna Programmate.
    status: detailStatus,
    onSchedule,
    onUnschedule,
  };

  // Da schermo largo il dettaglio è una colonna fissa: c'è sempre, vuota
  // finché non si tocca un'attività — così la board non si riassesta a ogni
  // apertura e le altre colonne non finiscono coperte da un cassetto.
  const detailPane = wide ? (
    <aside className="ab-detail" aria-label="Dettaglio attività">
      {detailTask
        ? <TaskDetailPanel key={detailTask.id} task={detailTask} {...detailProps} />
        : (
          <div className="ab-detail-empty">
            <p>Scegli un'attività per vederne note, sottoattività e stato.</p>
          </div>
        )}
    </aside>
  ) : null;

  // Sotto la soglia resta il cassetto: montato una volta sola, in coda a ogni
  // ramo del render, perché è lo stesso in Flusso e in Scadenza.
  const drawer = wide ? null : <TaskDetailDrawer task={detailTask} {...detailProps} />;

  if (loading) {
    return (
      <div className="ab">
        {header}
        <div className="ab-body">
          <div className="ab-columns">
            {COLUMNS.map(c => (
              <div className="ab-col" key={c.status}>
                <div className="ab-col-head">
                  <StatusIcon status={c.status} size={13} />
                  <span className="eyebrow">{c.label}</span>
                </div>
                <div className="ab-col-body"><Skeleton /><Skeleton /><Skeleton /></div>
              </div>
            ))}
          </div>
          {detailPane}
        </div>
      </div>
    );
  }

  // Scadenza: un solo elenco, ordinato per scadenza, di tutto ciò che ne ha una.
  if (view === 'scadenza') {
    const withDue = visible
      .filter(t => t.scadenza)
      .sort((a, b) => dueDateSortValue(a.scadenza) - dueDateSortValue(b.scadenza));
    return (
      <div className="ab">
        {header}
        <div className="ab-body">
          <div className="ab-deadlines">
            {withDue.length === 0 && <div className="ab-empty">Nessuna attività ha una scadenza</div>}
            {withDue.map(t => (
              <div
                key={t.id}
                className={`ab-deadline-row${openTask?.id === t.id ? ' selected' : ''}`}
                style={/** @type {import('react').CSSProperties} */ ({ '--task-color': colorForTask(t) })}
                role="button"
                tabIndex={0}
                onClick={() => setOpenTask(t)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenTask(t); } }}>
                <button
                  className="ab-row-check"
                  title="Segna come fatta"
                  aria-label={`Segna "${t.titolo}" come fatta`}
                  onClick={e => { e.stopPropagation(); handleComplete(t); }}>
                  <CheckMark />
                </button>
                <span className={`ab-due${isTaskOverdue(t.scadenza) ? ' overdue' : ''}`}>{formatDueDate(t.scadenza)}</span>
                <span className="ab-deadline-title">{t.titolo}</span>
                <span className="ab-deadline-list">{listLabel(t._listName)}</span>
              </div>
            ))}
          </div>
          {detailPane}
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
            title={STATUS_HINTS[col.status]}
            onClick={() => scrollToColumn(i)}>
            <StatusIcon status={col.status} size={12} />
            {col.label}
            <span className="ab-pill-count">{columnCount(col)}</span>
          </button>
        ))}
      </div>
      <div className="ab-body">
        <div className="ab-columns" ref={columnsRef}>
          {COLUMNS.map(col => {
            const collapsed = isCollapsed(col);
            const count = columnCount(col);
            return (
              <div
                key={col.status}
                className={`ab-col${collapsed ? ' collapsed' : ''}${col.collapse && count > 0 ? ' flagged' : ''}${dragOver === col.status ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(col.status); }}
                onDragLeave={() => setDragOver(o => (o === col.status ? null : o))}
                onDrop={e => { e.preventDefault(); handleDrop(col.status); }}>
                {collapsed ? (
                  // Ridotta: una striscia col nome per lungo e il conteggio.
                  // Trascinarci sopra un'attività funziona lo stesso — il
                  // bersaglio è la colonna, non il suo contenuto.
                  <button
                    className="ab-strip"
                    title={`Mostra «${col.label}»`}
                    aria-expanded={false}
                    onClick={() => setExpandedCols(s => ({ ...s, [col.status]: true }))}>
                    <span className="ab-strip-chevron" aria-hidden="true">›</span>
                    <StatusIcon status={col.status} size={12} />
                    <span className="ab-strip-label">{col.label}</span>
                    <span className="ab-strip-count">{count}</span>
                  </button>
                ) : (
                  <>
                    <div className="ab-col-head" title={STATUS_HINTS[col.status]}>
                      {/* Il segno dello stato sta sul titolo della colonna, che
                          è il posto in cui dice qualcosa: la colonna *è* lo
                          stato, e tutte le righe che ci stanno dentro lo hanno
                          per definizione. Sulle righe era un'icona ripetuta
                          venti volte che non distingueva niente. */}
                      <StatusIcon status={col.status} size={13} />
                      <span className="eyebrow">{col.label}</span>
                      <span className="ab-count">{count}</span>
                      {col.collapse && (
                        <button
                          className="ab-col-fold"
                          title={`Riduci «${col.label}»`}
                          aria-expanded
                          onClick={() => setExpandedCols(s => ({ ...s, [col.status]: false }))}>
                          ‹
                        </button>
                      )}
                    </div>
                    <div className="ab-col-body">
                      {count === 0 && <div className="ab-empty">{col.empty}</div>}
                      {groupedByStatus[col.status].map(group => (
                        <div className="ab-group" key={group.key}>
                          <div className="ab-group-head" style={{ color: group.color }}>
                            <span className="ab-group-dot" style={{ background: group.color }} />
                            <span className="ab-group-name">{group.name}</span>
                            <span className="ab-group-count">{group.tasks.length}</span>
                          </div>
                          {group.tasks.map(t => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              status={col.status}
                              color={group.color}
                              placement={scheduled.get(t.id) || null}
                              dragging={dragTask?.id === t.id}
                              selected={openTask?.id === t.id}
                              onClick={col.status === 'inbox' ? onClarify : setOpenTask}
                              onComplete={handleComplete}
                              onDragStart={setDragTask}
                              onDragEnd={() => { setDragTask(null); setDragOver(null); setDropOnId(null); }}
                              {...propsRiordino(group.tasks, t)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                    {/* L'area sta *sotto* il corpo della colonna, non dentro:
                        così resta incollata in fondo mentre l'elenco sopra
                        scorre, invece di finire fuori vista in coda ai gruppi.
                        È un bersaglio suo per il trascinamento — con lo stop
                        alla risalita, o il rilascio finirebbe alla colonna che
                        la contiene. */}
                    {col.sub && (
                      <div
                        className={`ab-area${expandedAreas[col.sub] ? ' expanded' : ''}${dragOver === col.sub ? ' drag-over' : ''}`}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(col.sub); }}
                        onDragLeave={e => {
                          if (e.currentTarget.contains(/** @type {any} */ (e.relatedTarget))) return;
                          setDragOver(o => (o === col.sub ? null : o));
                        }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(col.sub); }}>
                        <button
                          className="ab-area-head"
                          aria-expanded={!!expandedAreas[col.sub]}
                          title={`${STATUS_HINTS[col.sub]}\n${expandedAreas[col.sub] ? 'Chiudi' : 'Apri'} «${SUB_AREAS[col.sub].label}»`}
                          onClick={() => setExpandedAreas(s2 => ({ ...s2, [col.sub]: !s2[col.sub] }))}>
                          <span className="ab-area-chevron" aria-hidden="true">›</span>
                          <StatusIcon status={col.sub} size={12} />
                          <span className="eyebrow">{SUB_AREAS[col.sub].label}</span>
                          <span className="ab-count">{byStatus[col.sub].length}</span>
                        </button>
                        {expandedAreas[col.sub] && (
                          <div className="ab-area-body">
                            {byStatus[col.sub].length === 0 && (
                              <div className="ab-empty">{SUB_AREAS[col.sub].empty}</div>
                            )}
                            {groupedByPerson[col.sub].map(group => (
                              <div className="ab-group ab-group-person" key={group.key}>
                                <div className="ab-group-head">
                                  <span className="ab-group-name">{group.name}</span>
                                  <span className="ab-group-count">{group.tasks.length}</span>
                                </div>
                                {group.tasks.map(t => (
                                  <TaskRow
                                    key={t.id}
                                    task={t}
                                    status={col.sub}
                                    color={colorForTask(t)}
                                    placement={scheduled.get(t.id) || null}
                                    dragging={dragTask?.id === t.id}
                                    selected={openTask?.id === t.id}
                                    showPerson={false}
                                    onClick={setOpenTask}
                                    onComplete={handleComplete}
                                    onDragStart={setDragTask}
                                    onDragEnd={() => { setDragTask(null); setDragOver(null); setDropOnId(null); }}
                                    {...propsRiordino(group.tasks, t)}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        {detailPane}
      </div>
      {drawer}
    </div>
  );
}
