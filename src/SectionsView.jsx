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
// È anche dove atterra il Pomodoro: avviarlo dal Piano porta qui, sulla
// plancia della sezione a cui appartiene l'attività.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPages } from './api';
import { paraSectionLabel, sectionRole } from './paraConfig';
import { buildListColorMap } from './plannerShared';
import { usePomodoro } from './pomodoroContext';
import { taskContext, contextColor, parseEstimate } from './taskModel';
import SectionPaths from './SectionPaths';
import SectionTimeline from './SectionTimeline';
import Skeleton from './Skeleton';
import TaskDetailPanel from './TaskDetailPanel';
import { PageTree } from './Panel';
import { openProtocol } from './protocolLink';
import './SectionsView.css';

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
 * @param {Record<string, {id: string, displayName: string}>} props.todoListsMap
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {{ current: Record<string, import('./types').Page[]> }} props.pagesCache
 * @param {Record<string, {blocks?: any[]}>} [props.plans]  i piani giornalieri, per la colonna Oggi
 * @param {(plans: Record<string, any>) => void} [props.onPlansChanged]  il piano di oggi
 *        cambiato trascinando un'attività sulla colonna Oggi
 * @param {(listId: string, taskId: string) => void} [props.onTaskRemoved]
 * @param {(listId: string, taskId: string, patch: Object) => void} [props.onTaskPatched]
 * @param {(listId: string, task: import('./types').TodoTask) => void} [props.onTaskRestored]
 */
export default function SectionsView({
  notebooks, sectionsMap, todoListsMap, tasks, pagesCache, plans, onPlansChanged,
  onTaskRemoved, onTaskPatched, onTaskRestored,
}) {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const { session } = usePomodoro();
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
  // una sezione ha un colore solo, ovunque la si incontri.
  const colorMap = useMemo(() => buildListColorMap(notebooks, sectionsMap), [notebooks, sectionsMap]);

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

  // Le attività della sezione sono quelle della lista To-Do omonima: una lista
  // è una sezione, è la convenzione su cui poggia tutta l'app.
  const list = active ? todoListsMap?.[active.displayName.toLowerCase()] : null;
  const sectionTasks = useMemo(
    () => (tasks || []).filter(t => list && t._listId === list.id),
    [tasks, list]
  );

  // I task che hanno già un blocco nel piano di oggi: la riga lo segna, così
  // non li si trascina due volte. È la stessa cosa che il pool del Piano fa
  // con i task già programmati.
  const scheduledTaskIds = useMemo(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return new Set((plans?.[today]?.blocks || []).map(b => b.taskId).filter(Boolean));
  }, [plans]);

  const pomodoroTaskId = session?.taskId || null;
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
                  const l = todoListsMap?.[s.displayName.toLowerCase()];
                  const open = (tasks || []).filter(t => l && t._listId === l.id).length;
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
              {session?.sectionId === active.id && session.taskTitle && (
                <> · aperto perché stai lavorando a «{session.taskTitle}»</>
              )}
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

          {/* Attività della sezione */}
          <section className="sv-col sv-col-tasks">
            <div className="sv-col-head">
              <span className="eyebrow sv-col-label">Attività</span>
            </div>
            <div className="sv-col-body">
              {!list && <p className="sv-empty">Nessuna lista To-Do con questo nome</p>}
              {list && sectionTasks.length === 0 && <p className="sv-empty">Nessuna attività aperta</p>}
              {sectionTasks.map(t => {
                const est = estimateLabel(t);
                return (
                  <button
                    className={`sv-task${t.id === detailTask?.id ? ' selected' : ''}${t.id === pomodoroTaskId ? ' current' : ''}${scheduledTaskIds.has(t.id) ? ' scheduled' : ''}`}
                    key={t.id}
                    draggable
                    onDragStart={e => {
                      // Lo stesso payload del pool del Piano: la colonna Oggi
                      // qui accanto e la griglia del Piano leggono lo stesso
                      // trascinamento.
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'task', task: t }));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => setSelectedTaskId(t.id)}
                    title="Apri note, sottoattività e stato · trascina su Oggi per programmarla">
                    <span
                      className="sv-task-dot"
                      style={/** @type {import('react').CSSProperties} */ ({ background: contextColor(taskContext(t)) })}
                    />
                    <span className="sv-task-title">{t.title}</span>
                    {est && <span className="sv-task-est">{est}</span>}
                  </button>
                );
              })}
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
              listName={active.displayName}
              color={colorMap[active.displayName.toLowerCase()]}
              onPlansChanged={onPlansChanged}
              onPickTask={setSelectedTaskId}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
