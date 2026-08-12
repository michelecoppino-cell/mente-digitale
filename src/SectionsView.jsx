// @ts-check
// Sezioni: il workbook di una sezione PARA — pagine OneNote, file OneDrive e
// attività collegate, uno accanto all'altro.
//
// Prima queste tre cose stavano in un pannello che si apriva a destra della
// mappa mentale: una striscia da 385px, raggiungibile solo dalla mappa e solo
// una alla volta, senza un indirizzo proprio. Qui la sezione è una rotta, e il
// posto di lavoro è la pagina intera.
//
// È anche dove atterra il Pomodoro: avviarlo dal Piano porta qui, sul workbook
// della sezione a cui appartiene l'attività.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPages } from './api';
import { paraSectionLabel, sectionRole } from './paraConfig';
import { buildListColorMap } from './plannerShared';
import { usePomodoro } from './pomodoroContext';
import { taskContext, contextColor } from './taskModel';
import OneDriveBox from './OneDriveBox';
import Skeleton from './Skeleton';
import TaskDetailDrawer from './TaskDetailDrawer';
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
 * @param {(listId: string, taskId: string) => void} [props.onTaskRemoved]
 * @param {(listId: string, taskId: string, patch: Object) => void} [props.onTaskPatched]
 * @param {(listId: string, task: import('./types').TodoTask) => void} [props.onTaskRestored]
 */
export default function SectionsView({
  notebooks, sectionsMap, todoListsMap, tasks, pagesCache,
  onTaskRemoved, onTaskPatched, onTaskRestored,
}) {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const { session } = usePomodoro();
  const [query, setQuery] = useState('');
  // Le famiglie PARA chiuse: solo l'archivio, di partenza.
  const [folds, setFolds] = useState(/** @type {Record<string, boolean>} */ (DEFAULT_FOLDED));
  // L'attività aperta nel cassetto di dettaglio — lo stesso pannello del Piano.
  const [openTask, setOpenTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));

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

  const pomodoroTaskId = session?.taskId || null;
  // Il task aperto va riletto dal pool: rinominarlo dal cassetto aggiorna il
  // pool, e la copia tenuta qui resterebbe quella di prima.
  const detailTask = openTask ? (tasks || []).find(t => t.id === openTask.id) || openTask : null;
  // Il link `onenote:` che apre l'intera sezione nell'app desktop.
  const sectionClientUrl = active?.links?.oneNoteClientUrl?.href || null;

  const aside = (
    <nav className="sv-list" aria-label="Sezioni">
      <input
        className="sv-search"
        type="search"
        placeholder="Cerca una sezione…"
        aria-label="Cerca una sezione per nome"
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
                      onClick={() => navigate(`/sezioni/${s.id}`)}>
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
              : 'Scegli una sezione per aprirne il workbook.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sv">
      {aside}

      <div className="sv-workbook">
        <header className="sv-head">
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
          {/* OneNote */}
          <section className="sv-col">
            <span className="eyebrow" style={{ color: 'var(--onenote)' }}>OneNote</span>
            {sectionClientUrl && (
              <button className="sv-open-section" onClick={() => openProtocol(sectionClientUrl)}>
                ↗ Apri la sezione in OneNote
              </button>
            )}
            {pages === null && <><Skeleton /><Skeleton /><Skeleton /></>}
            {pages?.length === 0 && <p className="sv-empty">Nessuna pagina in questa sezione</p>}
            {/* L'albero delle pagine, con le sottopagine raggruppate sotto la
                loro pagina madre e chiuse di partenza: OneNote le annida fino a
                due livelli, e un elenco piatto le rendeva indistinguibili.
                Un clic apre la pagina nell'app OneNote del computer. */}
            {pages && pages.length > 0 && (
              <div className="sv-pages"><PageTree pages={pages} /></div>
            )}
          </section>

          {/* OneDrive — riusa il componente che già gestisce i link per sezione */}
          <section className="sv-col sv-col-drive">
            <OneDriveBox sectionId={active.id} color={'var(--onedrive)'} />
          </section>

          {/* Attività della sezione */}
          <section className="sv-col">
            <span className="eyebrow">Attività</span>
            {!list && <p className="sv-empty">Nessuna lista To-Do con questo nome</p>}
            {list && sectionTasks.length === 0 && <p className="sv-empty">Nessuna attività aperta</p>}
            {sectionTasks.map(t => (
              <button
                className={`sv-task${t.id === pomodoroTaskId ? ' current' : ''}`}
                key={t.id}
                onClick={() => setOpenTask(t)}
                title="Apri note, sottoattività e stato">
                <span
                  className="sv-task-dot"
                  style={/** @type {import('react').CSSProperties} */ ({ background: contextColor(taskContext(t)) })}
                />
                <span className="sv-task-title">{t.title}</span>
              </button>
            ))}
          </section>
        </div>
      </div>

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
    </div>
  );
}
