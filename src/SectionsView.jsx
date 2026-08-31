// @ts-check
// Sezioni: la plancia operativa di un progetto — pagine OneNote, percorsi,
// attività, il dettaglio di quella scelta e la giornata di oggi, tutto in una
// schermata sola.
//
// Prima queste cose stavano in un pannello che si apriva a destra della mappa
// mentale: una striscia da 385px, raggiungibile solo dalla mappa e solo una
// alla volta, senza un indirizzo proprio. Poi sono diventate tre colonne con
// un cassetto che si apriva sopra per il dettaglio di un'attività. Il cassetto
// copriva proprio le cose che servono mentre si lavora — le pagine e i
// percorsi — quindi ora il dettaglio è una colonna, e accanto c'è la giornata:
// scegliere l'attività, leggerne le note e vedere quando la si fa sono tre
// gesti che si fanno di seguito, senza aprire e chiudere niente.
//
// La colonna ATTIVITÀ non guarda più una lista To-Do sola. Una commessa può
// avere più consegne — una lista ciascuna, chiamata `GRUPPO.Consegna-YYMMDD`
// (la convenzione sta in paraConfig.js) — e qui si vedono tutte, raggruppate
// per consegna, ognuna con la sua scadenza e richiudibile. Una sezione senza
// liste col punto resta esattamente com'era: un elenco piatto di attività.
//
// Un'attività si sposta da una consegna all'altra trascinandola sul gruppo di
// destinazione — lo stesso gesto con cui la si porta su Oggi. Su To-Do non
// esiste una «move»: il task viene ricreato nella lista di arrivo e cancellato
// da quella di partenza (api.js `moveTaskToList`), quindi cambia id, e per non
// perdere le sottoattività va riletto per intero prima di spostarlo.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPages, getTask, moveTaskToList } from './api';
import {
  paraSectionLabel, sectionRole, listsForSection, listGroupKey, listDeliverableLabel,
  listDueDate, buildListName, groupKeyForSection, sectionNameForList, toDateInputValue,
} from './paraConfig';
import { buildListColorMap, listColor, formatDeliverableDue, daysUntil, daysUntilLabel } from './plannerShared';
import { useFolds } from './viewPrefs';
import {
  taskContext, contextColor, parseEstimate, indexScheduled, taskStatus, taskPerson,
  STATUS_LABELS, GRANULARITY_MEMO_LINE,
} from './taskModel';
import SectionPaths from './SectionPaths';
import SectionTimeline from './SectionTimeline';
import Skeleton from './Skeleton';
import TaskDetailPanel from './TaskDetailPanel';
import { PageTree } from './Panel';
import { pushUndo } from './undo';
import { openProtocol } from './protocolLink';
import './SectionsView.css';

/** I due elenchi per persona in fondo alla colonna Attività, nell'ordine in
 *  cui si leggono: prima quello che tocca a te far partire, poi quello che sta
 *  già camminando per conto suo. */
const PERSON_LISTS = /** @type {const} */ (['ask', 'delegated']);

/** Le quattro famiglie PARA, nell'ordine in cui si guardano: prima quello che
 *  ha una fine, poi quello che va mantenuto, poi il materiale, infine quel che
 *  è chiuso. Icona e frase sono le stesse del diagramma di chiarimento — un
 *  progetto è la stessa cosa in tutte e due le schermate. */
const ROLES = [
  { key: 'project',   label: 'Progetti', icon: '🗂', hint: 'Hanno un esito e una fine' },
  { key: 'area',      label: 'Aree',     icon: '🔁', hint: 'Da mantenere, senza fine' },
  { key: 'resources', label: 'Risorse',  icon: '💡', hint: 'Materiale di riferimento' },
  { key: 'archive',   label: 'Archivio', icon: '📦', hint: 'Chiuse, ma non buttate' },
];

/** @type {Record<string, string>} */
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.key, r.label]));

/** L'archivio parte chiuso: c'è per essere ritrovato, non per stare fra i
 *  piedi ogni volta che si cerca una sezione viva. */
const DEFAULT_FOLDED = { archive: true };

/** Le consegne richiuse a mano, ricordate fra una visita e l'altra. */
const DELIVERABLE_FOLDS_KEY = 'md_sv_deliverable_folds_v1';

/** Sotto questa soglia la scadenza di una consegna si accende: una settimana
 *  è quanto basta perché «fra sei giorni» smetta di essere un'informazione e
 *  diventi una cosa da guardare. */
const DUE_SOON_DAYS = 7;

/** La stima scritta nelle note, come la si legge in fondo alla riga
 *  dell'attività. Solo quella davvero scritta: mostrare la mezz'ora di
 *  partenza su tutte le righe sarebbe un numero inventato. */
function estimateLabel(/** @type {import('./types').TodoTask} */ t) {
  const min = parseEstimate(/** @type {any} */ (t)?.body?.content);
  if (!min) return null;
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Quando un'attività è già a piano, detto in una riga: «oggi 09:00»,
 *  «domani 14:30», oppure la data per bocca sua. Serve al titolo della riga
 *  grigia — vedere che è pianificata senza sapere quando non aiuta. */
function plannedWhen(/** @type {{date: string, startTime: string}} */ p) {
  const oggi = new Date();
  const key = (/** @type {Date} */ d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const domani = new Date(oggi); domani.setDate(oggi.getDate() + 1);
  const giorno = p.date === key(oggi) ? 'oggi'
    : p.date === key(domani) ? 'domani'
    : new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(`${p.date}T12:00:00`));
  return `${giorno} alle ${p.startTime}`;
}

/**
 * Tutte le sezioni di tutti i taccuini, in piatto, con il taccuino di
 * provenienza attaccato: l'elenco a sinistra è per ruolo PARA, non per
 * taccuino — è così che l'app pensa le sezioni ovunque.
 * @param {import('./types').Notebook[]} notebooks
 * @param {Record<string, import('./types').Section[]>} sectionsMap
 */
function flattenSections(notebooks, sectionsMap) {
  const out = [];
  for (const nb of notebooks || []) {
    for (const sec of sectionsMap?.[nb.id] || []) {
      out.push({ ...sec, _nbId: nb.id, _nbName: nb.displayName, _role: sectionRole(sec.displayName) || 'project' });
    }
  }
  return out;
}

/**
 * @param {Object} props
 * @param {import('./types').Notebook[]} props.notebooks
 * @param {Record<string, import('./types').Section[]>} props.sectionsMap
 * @param {import('./types').TodoList[]} props.todoLists  tutte le liste To-Do: da qui
 *        escono le consegne della sezione aperta
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {{ current: Record<string, import('./types').Page[]> }} props.pagesCache
 * @param {Record<string, {blocks?: any[]}>} [props.plans]  i piani giornalieri, per la colonna Oggi
 * @param {(plans: Record<string, any>) => void} [props.onPlansChanged]  il piano di oggi
 *        cambiato trascinando un'attività sulla colonna Oggi
 * @param {(listId: string, taskId: string) => void} [props.onTaskRemoved]
 * @param {(listId: string, taskId: string, patch: Object) => void} [props.onTaskPatched]
 * @param {(listId: string, task: import('./types').TodoTask) => void} [props.onTaskRestored]
 * @param {(displayName: string) => Promise<any>} [props.onCreateDeliverable]  crea una
 *        lista To-Do per una nuova consegna
 * @param {(listId: string, displayName: string) => Promise<any>} [props.onRenameDeliverable]
 *        rinomina una consegna: è così che se ne sposta la scadenza
 */
export default function SectionsView({
  notebooks, sectionsMap, todoLists = [], tasks, pagesCache, plans, onPlansChanged,
  onTaskRemoved, onTaskPatched, onTaskRestored, onCreateDeliverable, onRenameDeliverable,
}) {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // Le famiglie PARA chiuse: solo l'archivio, di partenza.
  const [folds, setFolds] = useState(/** @type {Record<string, boolean>} */ (DEFAULT_FOLDED));
  // L'elenco delle sezioni: si sceglie una sezione e si toglie di mezzo, così
  // le cinque colonne del lavoro hanno tutta la larghezza. La freccetta in
  // testata lo fa tornare.
  const [navOpen, setNavOpen] = useState(true);
  // L'attività aperta nella colonna Dettagli.
  const [selectedTaskId, setSelectedTaskId] = useState(/** @type {string|null} */ (null));

  const sections = useMemo(() => flattenSections(notebooks, sectionsMap), [notebooks, sectionsMap]);
  const active = sections.find(s => s.id === sectionId) || null;

  // Le famiglie sono sempre tutte e quattro, anche vuote: l'elenco dice come è
  // organizzato il lavoro, e una famiglia che sparisce quando è vuota lo
  // nasconde. Fuori dalla ricerca, dove invece contano solo i risultati.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q ? sections.filter(s => s.displayName.toLowerCase().includes(q)) : sections;
    return ROLES
      .map(role => ({ ...role, items: visible.filter(s => s._role === role.key) }))
      .filter(g => !q || g.items.length > 0);
  }, [sections, query]);

  // I colori delle sezioni sono gli stessi del Piano e della vista Attività:
  // una sezione ha un colore solo, ovunque la si incontri — e le sue consegne
  // ne prendono sfumature diverse, perché si distinguano restando parenti.
  const colorMap = useMemo(
    () => buildListColorMap(notebooks, sectionsMap, todoLists),
    [notebooks, sectionsMap, todoLists]
  );

  // I nomi di tutte le sezioni: servono a decidere a quale commessa appartiene
  // una lista annidata, e la risposta dipende da tutte insieme (un prefisso che
  // ne trova due non vale, vedi sectionNameForList).
  const sectionNames = useMemo(() => sections.map(s => s.displayName), [sections]);

  // Quante attività aperte per sezione, consegne comprese: l'elenco a sinistra
  // conta la commessa intera, non la sola lista omonima.
  const openBySection = useMemo(() => {
    /** @type {Record<string, string>} */
    const sectionByListId = {};
    for (const l of todoLists) {
      const section = sectionNameForList(l.displayName, sectionNames);
      if (section) sectionByListId[l.id] = section.toLowerCase();
    }
    /** @type {Record<string, number>} */
    const counts = {};
    for (const t of tasks || []) {
      const key = sectionByListId[t._listId || ''];
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [todoLists, sectionNames, tasks]);

  // Le pagine della sezione aperta: prima dalla cache già popolata dal
  // preload, poi da Graph se non c'è.
  // `loaded` porta anche l'id di provenienza: senza, cambiando sezione si
  // vedrebbero per un istante le pagine di quella precedente, e azzerarle con
  // un setState dentro l'effetto costerebbe un render in più a ogni giro.
  const [loaded, setLoaded] = useState(/** @type {{ id: string, pages: import('./types').Page[] }|null} */ (null));
  const pages = (loaded && loaded.id === sectionId)
    ? loaded.pages
    : (sectionId ? pagesCache?.current?.[sectionId] || null : null);

  useEffect(() => {
    if (!sectionId || pagesCache?.current?.[sectionId]) return;
    let cancelled = false;
    getPages(sectionId)
      .then(p => {
        if (cancelled) return;
        if (pagesCache?.current) pagesCache.current[sectionId] = p;
        setLoaded({ id: sectionId, pages: p });
      })
      .catch(e => { console.error('pagine sezione', e); if (!cancelled) setLoaded({ id: sectionId, pages: [] }); });
    return () => { cancelled = true; };
  }, [sectionId, pagesCache]);

  // Le liste To-Do della sezione: quella omonima — la convenzione su cui poggia
  // tutta l'app — e le consegne annidate sotto la stessa commessa.
  const sectionLists = useMemo(
    () => (active ? listsForSection(active.displayName, todoLists, sectionNames) : []),
    [active, todoLists, sectionNames]
  );
  const sectionListIds = useMemo(() => new Set(sectionLists.map(l => l.id)), [sectionLists]);
  const sectionTasks = useMemo(
    () => (tasks || []).filter(t => sectionListIds.has(t._listId || '')),
    [tasks, sectionListIds]
  );

  // I task che hanno già un blocco nel piano — in un giorno qualunque, non
  // solo oggi: una cosa messa in agenda per giovedì è pianificata quanto una
  // di stamattina, e riproporla in nero significherebbe pianificarla due
  // volte. La riga li mostra in grigio, col giorno e l'ora nel titolo. È lo
  // stesso indice che dà lo stato «programmata» al resto dell'app.
  const scheduledPlacements = useMemo(() => indexScheduled(/** @type {any} */ (plans) || {}), [plans]);

  // Le cose da chiedere e quelle delegate escono dalle consegne e vanno in due
  // elenchi loro, in fondo alla colonna, raggruppate per persona: dentro la
  // consegna direbbero «manca questo pezzo», che è falso — il pezzo è in mano
  // a qualcuno, e quello che serve sapere è a chi, per tutta la commessa
  // insieme e non consegna per consegna.
  const perPersona = useMemo(() => {
    const scheduledIds = new Set(scheduledPlacements.keys());
    /** @type {Record<string, { key: string, name: string, tasks: import('./types').TodoTask[] }[]>} */
    const out = {};
    for (const status of PERSON_LISTS) {
      /** @type {Map<string, { key: string, name: string, tasks: import('./types').TodoTask[] }>} */
      const groups = new Map();
      for (const t of sectionTasks) {
        if (taskStatus(t, { scheduledIds }) !== status) continue;
        const who = taskPerson(t)?.who || 'Senza nome';
        const key = who.toLowerCase();
        if (!groups.has(key)) groups.set(key, { key, name: who, tasks: [] });
        groups.get(key)?.tasks.push(t);
      }
      out[status] = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    }
    return out;
  }, [sectionTasks, scheduledPlacements]);

  /** Gli id già finiti nei due elenchi per persona: nelle consegne non tornano. */
  const idsPerPersona = useMemo(
    () => new Set(PERSON_LISTS.flatMap(s => perPersona[s].flatMap(g => g.tasks.map(t => t.id)))),
    [perPersona],
  );

  // Una consegna per gruppo, nell'ordine in cui listsForSection le mette
  // (scadenza più vicina per prima). Con una lista sola e senza punto nel nome
  // il gruppo è uno solo e la colonna resta l'elenco piatto di prima.
  const deliverables = useMemo(() => sectionLists.map(l => {
    const due = listDueDate(l.displayName);
    const days = daysUntil(due);
    return {
      list: l,
      nested: !!listGroupKey(l.displayName),
      label: listDeliverableLabel(l.displayName),
      due,
      days,
      color: listColor(l.displayName, colorMap, 'var(--line)'),
      tasks: sectionTasks.filter(t => t._listId === l.id && !idsPerPersona.has(t.id)),
    };
  }), [sectionLists, sectionTasks, colorMap, idsPerPersona]);

  // Le consegne chiuse restano chiuse anche domani, come le altre preferenze
  // di vista. Chiave per id di lista: rinominare una consegna (cioè spostarne
  // la scadenza) non la deve riaprire.
  const [isFolded, toggleFold] = useFolds(DELIVERABLE_FOLDS_KEY);
  // Il form della consegna nuova, aperto dal `+` in testata alla colonna.
  const [newOpen, setNewOpen] = useState(false);

  // La colonna Dettagli non è mai vuota se c'è qualcosa da mostrare: senza una
  // scelta esplicita apre la prima attività della sezione. Il task va riletto
  // dal pool, perché rinominarlo dal pannello aggiorna il pool e la copia
  // tenuta qui resterebbe quella di prima.
  const detailTask = useMemo(() => {
    if (!sectionTasks.length) return null;
    return sectionTasks.find(t => t.id === selectedTaskId) || sectionTasks[0];
  }, [sectionTasks, selectedTaskId]);
  // Il link `onenote:` che apre l'intera sezione nell'app desktop.
  const sectionClientUrl = active?.links?.oneNoteClientUrl?.href || null;

  /** Una riga di attività: la stessa dentro le consegne e dentro i due elenchi
   *  per persona — sono le stesse attività, e devono comportarsi allo stesso
   *  modo (si aprono, si trascinano su un'altra consegna o sulla giornata).
   *  @param {import('./types').TodoTask} t */
  function taskButton(t) {
    const est = estimateLabel(t);
    const placement = scheduledPlacements.get(t.id) || null;
    return (
      <button
        className={`sv-task${t.id === detailTask?.id ? ' selected' : ''}${placement ? ' scheduled' : ''}`}
        key={t.id}
        draggable
        onDragStart={e => {
          // Lo stesso payload del pool del Piano: la colonna Oggi qui accanto e
          // la griglia del Piano leggono lo stesso trascinamento.
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', task: t }));
          e.dataTransfer.effectAllowed = 'move';
          setDragTask(t);
        }}
        onDragEnd={() => { setDragTask(null); setDropListId(null); }}
        onClick={() => setSelectedTaskId(t.id)}
        title={[
          placement && `Già nel piano: ${plannedWhen(placement)}`,
          deliverables.length > 1
            ? "Apri note, sottoattività e stato · trascina su un'altra consegna per spostarla, o su Oggi per programmarla"
            : 'Apri note, sottoattività e stato · trascina su Oggi per programmarla',
        ].filter(Boolean).join('\n')}>
        <span
          className="sv-task-dot"
          style={/** @type {import('react').CSSProperties} */ ({ background: contextColor(taskContext(t)) })}
        />
        <span className="sv-task-title">{t.title}</span>
        {est && <span className="sv-task-est">{est}</span>}
      </button>
    );
  }

  // Il trascinamento di un'attività fra consegne: quale si sta trascinando (per
  // sapere quali gruppi possono accoglierla), su quale gruppo sta passando, e
  // quale spostamento è in corso o è andato storto.
  const [dragTask, setDragTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  const [dropListId, setDropListId] = useState(/** @type {string|null} */ (null));
  const [movingListId, setMovingListId] = useState(/** @type {string|null} */ (null));
  const [moveError, setMoveError] = useState(/** @type {{listId: string, message: string}|null} */ (null));

  /** Sposta un'attività in un'altra lista: la ricrea di là e la toglie di qua.
   *  @param {import('./types').TodoTask} task
   *  @param {{ id: string, displayName: string }} toList */
  async function moveTaskToDeliverable(task, toList) {
    const fromListId = task._listId || '';
    if (!fromListId || fromListId === toList.id) return;
    // Se il dettaglio stava mostrando proprio questa attività deve seguirla:
    // dopo lo spostamento l'id è un altro, e la colonna scivolerebbe su
    // un'attività a caso.
    const eraAperta = detailTask?.id === task.id;
    setMovingListId(toList.id);
    setMoveError(null);
    try {
      // Il pool tiene i task senza sottoattività (getTodoTasks non le espande):
      // spostare quella copia le perderebbe per strada, in silenzio.
      const full = await getTask(fromListId, task.id);
      const moved = await moveTaskToList(fromListId, toList.id, full);
      const decorato = { ...moved, _listId: toList.id, _listName: toList.displayName };
      onTaskRemoved?.(fromListId, task.id);
      onTaskRestored?.(toList.id, decorato);
      if (eraAperta) setSelectedTaskId(decorato.id);
      pushUndo({
        label: `Spostata in ${listDeliverableLabel(toList.displayName)}`,
        undo: async () => {
          const back = await moveTaskToList(toList.id, fromListId, { ...full, id: decorato.id });
          onTaskRemoved?.(toList.id, decorato.id);
          onTaskRestored?.(fromListId, { ...back, _listId: fromListId, _listName: task._listName });
          if (eraAperta) setSelectedTaskId(back.id);
        },
      });
    } catch (e) {
      console.error('sposta attività fra consegne', e);
      setMoveError({ listId: toList.id, message: "Non è riuscito a spostarla" });
    }
    setMovingListId(null);
  }

  /** @param {any} e @param {{ id: string }} toList */
  function handleTaskDrop(e, toList) {
    e.preventDefault();
    e.stopPropagation();
    setDropListId(null);
    setDragTask(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data?.type === 'task' && data.task) moveTaskToDeliverable(data.task, /** @type {any} */ (toList));
    } catch { /* payload non nostro — ignora */ }
  }

  const aside = (
    <nav className="sv-list" aria-label="Sezioni">
      <input
        className="sv-search"
        type="search"
        placeholder="Cerca una sezione…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {grouped.length === 0 && <p className="sv-empty">Nessuna sezione trovata</p>}
      {grouped.map(g => {
        // Cercando si apre tutto: un risultato dentro una famiglia chiusa
        // sarebbe un risultato che non si vede.
        const folded = !query.trim() && !!folds[g.key];
        return (
          <div className={`sv-group${folded ? ' folded' : ''}`} key={g.key}>
            <button
              className="sv-group-head"
              aria-expanded={!folded}
              title={g.hint}
              onClick={() => setFolds(f => ({ ...f, [g.key]: !folded }))}>
              <span className="sv-group-caret" aria-hidden="true">{folded ? '▸' : '▾'}</span>
              <span className="sv-group-icon" aria-hidden="true">{g.icon}</span>
              <span className="sv-group-label">{g.label}</span>
              <span className="sv-group-count">{g.items.length}</span>
            </button>
            {!folded && (
              <>
                <p className="sv-group-hint">{g.hint}</p>
                {g.items.length === 0 && <p className="sv-group-empty">Nessuna sezione</p>}
                {g.items.map(s => {
                  const open = openBySection[s.displayName.toLowerCase()] || 0;
                  return (
                    <button
                      key={s.id}
                      className={`sv-list-item${s.id === sectionId ? ' active' : ''}`}
                      title={`${paraSectionLabel(s.displayName)} · ${s._nbName}`}
                      onClick={() => { navigate(`/sezioni/${s.id}`); setNavOpen(false); }}>
                      <span
                        className="sv-list-dot"
                        style={{ background: colorMap[s.displayName.toLowerCase()] || 'var(--line)' }}
                      />
                      <span className="sv-list-name">{paraSectionLabel(s.displayName)}</span>
                      {open > 0 && <span className="sv-list-count">{open}</span>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </nav>
  );

  if (!active) {
    return (
      <div className="sv">
        {aside}
        <div className="sv-placeholder">
          <p className="sv-empty">
            {sections.length === 0
              ? 'I taccuini non sono ancora arrivati. Un attimo…'
              : 'Scegli una sezione per aprirne la plancia.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sv">
      {navOpen && aside}

      <div className="sv-workbook">
        <header className="sv-head">
          {/* Quando l'elenco è chiuso resta questa freccia, al suo posto: la
              colonna torna dov'era, e niente altro si muove. */}
          {!navOpen && (
            <button
              className="sv-nav-open"
              onClick={() => setNavOpen(true)}
              title="Mostra l'elenco delle sezioni"
              aria-label="Mostra l'elenco delle sezioni">
              →
            </button>
          )}
          <div className="sv-head-text">
            <h1 className="sv-title">{paraSectionLabel(active.displayName)}</h1>
            <p className="sv-subtitle">
              {[ROLE_LABELS[active._role], active._nbName].filter(Boolean).join(' · ')}
            </p>
          </div>
        </header>

        <div className="sv-cols">
          {/* OneNote — stretta: sono titoli di pagina, non testo da leggere */}
          <section className="sv-col sv-col-onenote">
            <div className="sv-col-head">
              <span className="eyebrow sv-col-label">OneNote</span>
              {sectionClientUrl && (
                <button
                  className="sv-icon-btn"
                  onClick={() => openProtocol(sectionClientUrl)}
                  title="Apri la sezione in OneNote">
                  ↗
                </button>
              )}
            </div>
            <div className="sv-col-body">
              {pages === null && <><Skeleton /><Skeleton /><Skeleton /></>}
              {pages?.length === 0 && <p className="sv-empty">Nessuna pagina in questa sezione</p>}
              {/* L'albero delle pagine, con le sottopagine raggruppate sotto la
                  loro pagina madre e chiuse di partenza: OneNote le annida fino a
                  due livelli, e un elenco piatto le rendeva indistinguibili.
                  Un clic apre la pagina nell'app OneNote del computer. */}
              {pages && pages.length > 0 && (
                <div className="sv-pages"><PageTree pages={pages} /></div>
              )}
            </div>
          </section>

          {/* Percorsi — cartelle, dischi di rete, link: pastiglie da copiare */}
          <section className="sv-col sv-col-paths">
            <SectionPaths sectionId={active.id} />
          </section>

          {/* Attività della sezione, una consegna per gruppo */}
          <section className="sv-col sv-col-tasks">
            <div className="sv-col-head">
              <span className="eyebrow sv-col-label">Attività</span>
              <span className="sv-col-memo" title={GRANULARITY_MEMO_LINE} aria-label={GRANULARITY_MEMO_LINE}>ⓘ</span>
              {onCreateDeliverable && (
                <button
                  className={`sv-icon-btn${newOpen ? ' active' : ''}`}
                  onClick={() => setNewOpen(o => !o)}
                  title="Nuova consegna in questa commessa"
                  aria-label="Nuova consegna in questa commessa"
                  aria-expanded={newOpen}>
                  +
                </button>
              )}
            </div>
            <div className="sv-col-body">
              {newOpen && onCreateDeliverable && (
                <NewDeliverableForm
                  sectionName={active.displayName}
                  sectionNames={sectionNames}
                  onCancel={() => setNewOpen(false)}
                  onCreate={onCreateDeliverable}
                />
              )}

              {deliverables.length === 0 && (
                <p className="sv-empty">
                  Nessuna lista To-Do per questa commessa: serve una lista che si chiami
                  «{active.displayName}», oppure una consegna «{groupKeyForSection(active.displayName)}.Nome».
                </p>
              )}

              {deliverables.map(d => {
                // Con una sola consegna, e senza punto nel nome, non c'è niente
                // da raggruppare: l'elenco resta piatto come è sempre stato.
                const plain = deliverables.length === 1 && !d.nested;
                const folded = !plain && isFolded(d.list.id);
                // Un gruppo accoglie l'attività che si sta trascinando solo se
                // non è già sua. Chi trascina da fuori questa colonna non lo
                // sappiamo prima del rilascio: si accetta, e si controlla lì.
                const canDrop = !dragTask || dragTask._listId !== d.list.id;
                const moving = movingListId === d.list.id;
                return (
                  <div
                    className={`sv-deliverable${folded ? ' folded' : ''}${dropListId === d.list.id ? ' drop-target' : ''}${moving ? ' moving' : ''}`}
                    key={d.list.id}
                    onDragOver={e => {
                      if (!canDrop) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropListId(d.list.id);
                    }}
                    onDragLeave={e => {
                      // Passare sopra un figlio conta come uscita dal padre:
                      // senza questo controllo l'evidenziazione lampeggerebbe.
                      if (e.currentTarget.contains(/** @type {any} */ (e.relatedTarget))) return;
                      setDropListId(prev => (prev === d.list.id ? null : prev));
                    }}
                    onDrop={e => handleTaskDrop(e, d.list)}>
                    {!plain && (
                      <DeliverableHead
                        deliverable={d}
                        folded={folded}
                        moving={moving}
                        onToggle={() => toggleFold(d.list.id)}
                        sectionName={active.displayName}
                        onRename={onRenameDeliverable}
                      />
                    )}
                    {moveError?.listId === d.list.id && (
                      <p className="sv-deliverable-error" role="alert">{moveError.message}</p>
                    )}
                    {!folded && d.tasks.length === 0 && (
                      <p className="sv-empty">
                        {deliverables.length > 1
                          ? 'Nessuna attività aperta · trascinane una qui per spostarla'
                          : 'Nessuna attività aperta'}
                      </p>
                    )}
                    {!folded && d.tasks.map(t => taskButton(t))}
                  </div>
                );
              })}

              {/* Da chiedere e delegati: due elenchi a parte, in fondo, con una
                  riga per persona. Sono attività di queste consegne come le
                  altre — si trascinano, si aprono, si spostano — ma raccolte
                  per chi le ha in mano invece che per dove stanno. */}
              {PERSON_LISTS.filter(status => perPersona[status].length > 0).map(status => (
                <div className="sv-persone" key={status}>
                  <div className="sv-persone-head">
                    <span className="eyebrow">{STATUS_LABELS[status]}</span>
                    <span className="sv-persone-count">
                      {perPersona[status].reduce((n, g) => n + g.tasks.length, 0)}
                    </span>
                  </div>
                  {perPersona[status].map(group => (
                    <div className="sv-persona" key={group.key}>
                      <div className="sv-persona-name">
                        {group.name}
                        <span className="sv-persone-count">{group.tasks.length}</span>
                      </div>
                      {group.tasks.map(t => taskButton(t))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* Dettagli — lo stesso pannello del Piano e della vista Attività,
              qui senza le risorse della sezione: OneNote e i percorsi sono già
              le due colonne accanto, e ripeterli sotto le sottoattività
              allungava la colonna per niente. */}
          <section className="sv-col sv-col-detail">
            <div className="sv-col-head">
              <span className="eyebrow sv-col-label">Dettagli</span>
            </div>
            <div className="sv-col-body">
              {!detailTask && <p className="sv-empty">Scegli un'attività per vederne il dettaglio</p>}
              {detailTask && (
                <TaskDetailPanel
                  key={detailTask.id}
                  task={detailTask}
                  notebooks={notebooks}
                  sectionsMap={sectionsMap}
                  pagesCache={pagesCache}
                  showResources={false}
                  onCompleted={() => { onTaskRemoved?.(detailTask._listId || '', detailTask.id); setSelectedTaskId(null); }}
                  onDeleted={() => { onTaskRemoved?.(detailTask._listId || '', detailTask.id); setSelectedTaskId(null); }}
                  onRenamed={title => onTaskPatched?.(detailTask._listId || '', detailTask.id, { title })}
                  onDueChanged={dueDateTime => onTaskPatched?.(detailTask._listId || '', detailTask.id, { dueDateTime })}
                  onPatched={patch => onTaskPatched?.(detailTask._listId || '', detailTask.id, patch)}
                  onRestored={(listId, restored) => onTaskRestored?.(listId, restored)}
                />
              )}
            </div>
          </section>

          {/* Oggi — dove sta questa attività nella giornata */}
          <section className="sv-col sv-col-timeline">
            <SectionTimeline
              plans={plans}
              listNames={sectionLists.map(l => l.displayName)}
              color={listColor(active.displayName, colorMap)}
              onPlansChanged={onPlansChanged}
              onPickTask={setSelectedTaskId}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * L'intestazione a tendina di una consegna: nome, scadenza con quanto manca,
 * quante attività sono ancora aperte. La data si mostra sempre formattata e
 * mai dentro il nome — nel nome della lista ci sta come `-YYMMDD`, ma quello
 * è il modo in cui To-Do la conserva, non il modo in cui si legge.
 * @param {Object} props
 * @param {any} props.deliverable
 * @param {boolean} props.folded
 * @param {boolean} [props.moving]  un'attività la sta raggiungendo proprio ora
 * @param {() => void} props.onToggle
 * @param {string} props.sectionName
 * @param {(listId: string, displayName: string) => Promise<any>} [props.onRename]
 */
function DeliverableHead({ deliverable: d, folded, moving = false, onToggle, sectionName, onRename }) {
  // La data aperta in modifica: cambiarla rinomina la lista, ma il nome
  // composto non si vede mai — si tocca solo il campo data.
  const [editingDue, setEditingDue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  const dueLabel = formatDeliverableDue(d.due);
  const daysLabel = daysUntilLabel(d.days);
  const overdue = d.days !== null && d.days < 0;
  const soon = d.days !== null && d.days >= 0 && d.days <= DUE_SOON_DAYS;
  // La scadenza si può spostare solo dove sta: nel nome di una consegna
  // annidata. Rinominare la lista omonima romperebbe il legame con la sezione.
  const canEditDue = !!onRename && d.nested;

  async function saveDue(/** @type {string} */ value) {
    setSaving(true);
    setError(null);
    try {
      await onRename?.(d.list.id, buildListName({
        gruppo: listGroupKey(d.list.displayName) || groupKeyForSection(sectionName),
        consegna: d.label,
        scadenza: value || null,
      }));
      setEditingDue(false);
    } catch (e) {
      console.error('rinomina consegna', e);
      setError(e instanceof Error ? e.message : 'Non è riuscita');
    }
    setSaving(false);
  }

  return (
    <div className="sv-deliverable-head">
      <button
        className="sv-deliverable-toggle"
        onClick={onToggle}
        aria-expanded={!folded}
        title={folded ? 'Mostra le attività della consegna' : 'Richiudi la consegna'}>
        <span className="sv-deliverable-caret" aria-hidden="true">{folded ? '▸' : '▾'}</span>
        <span className="sv-deliverable-dot" style={{ background: d.color }} />
        <span className="sv-deliverable-name">{d.label}</span>
        {dueLabel && !editingDue && (
          <span className={`sv-deliverable-due${overdue ? ' overdue' : soon ? ' soon' : ''}`}>
            {dueLabel}{daysLabel ? ` · ${daysLabel}` : ''}
          </span>
        )}
        <span className="sv-deliverable-count" title="Attività aperte">{moving ? '…' : d.tasks.length}</span>
      </button>

      {canEditDue && (
        editingDue ? (
          <input
            className="sv-deliverable-date"
            type="date"
            autoFocus
            disabled={saving}
            defaultValue={toDateInputValue(d.due)}
            onBlur={() => !saving && setEditingDue(false)}
            onKeyDown={e => { if (e.key === 'Escape') setEditingDue(false); }}
            onChange={e => saveDue(e.target.value)}
          />
        ) : (
          <button
            className="sv-icon-btn sv-deliverable-date-btn"
            onClick={() => setEditingDue(true)}
            title={dueLabel ? `Sposta la scadenza (ora ${dueLabel})` : 'Dai una scadenza alla consegna'}
            aria-label="Cambia la scadenza della consegna">
            🗓
          </button>
        )
      )}
      {error && <span className="sv-deliverable-error" role="alert">{error}</span>}
    </div>
  );
}

/**
 * Il form della consegna nuova: due campi separati, nome e data. La commessa è
 * quella della sezione aperta e la convenzione la scrive il codice — chi la usa
 * non digita mai un `GRUPPO.Nome-YYMMDD`.
 * @param {Object} props
 * @param {string} props.sectionName
 * @param {string[]} props.sectionNames
 * @param {() => void} props.onCancel
 * @param {(displayName: string) => Promise<any>} props.onCreate
 */
function NewDeliverableForm({ sectionName, sectionNames, onCancel, onCreate }) {
  const [nome, setNome] = useState('');
  const [scadenza, setScadenza] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  const gruppo = groupKeyForSection(sectionName);

  async function submit(/** @type {import('react').FormEvent} */ e) {
    e.preventDefault();
    if (!nome.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const displayName = buildListName({ gruppo, consegna: nome, scadenza: scadenza || null });
      // Una commessa che non ritrova la propria sezione creerebbe una lista
      // orfana: senza colore, senza attività in colonna e senza un modo ovvio
      // di capire perché. Meglio dirlo prima di scrivere su To-Do.
      const resolved = sectionNameForList(displayName, sectionNames);
      if ((resolved || '').toLowerCase() !== sectionName.toLowerCase()) {
        throw new Error(`«${gruppo}» non identifica questa sezione da sola: rinomina la sezione o la commessa.`);
      }
      await onCreate(displayName);
      onCancel();
    } catch (e) {
      console.error('nuova consegna', e);
      setError(e instanceof Error ? e.message : 'Non è riuscita');
      setSaving(false);
    }
  }

  return (
    <form className="sv-new-deliverable" onSubmit={submit}>
      <div className="sv-new-deliverable-row">
        <input
          className="sv-new-deliverable-name"
          autoFocus
          placeholder="Nome della consegna"
          value={nome}
          disabled={saving}
          onChange={e => setNome(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        />
        <input
          className="sv-new-deliverable-date"
          type="date"
          value={scadenza}
          disabled={saving}
          title="Scadenza della consegna"
          onChange={e => setScadenza(e.target.value)}
        />
      </div>
      <div className="sv-new-deliverable-row">
        <span className="sv-new-deliverable-hint">
          In {paraSectionLabel(sectionName)} · {GRANULARITY_MEMO_LINE}
        </span>
        <button type="button" className="sv-new-deliverable-cancel" onClick={onCancel} disabled={saving}>
          Annulla
        </button>
        <button type="submit" className="sv-new-deliverable-ok" disabled={saving || !nome.trim()}>
          {saving ? '…' : 'Crea'}
        </button>
      </div>
      {error && <p className="sv-deliverable-error" role="alert">{error}</p>}
    </form>
  );
}
