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
import { usePomodoro } from './pomodoroContext';
import { taskContext, contextColor } from './taskModel';
import OneDriveBox from './OneDriveBox';
import Skeleton from './Skeleton';
import './SectionsView.css';

/** @type {Record<string, string>} */
const ROLE_LABELS = { project: 'Progetti', area: 'Aree', resources: 'Risorse', archive: 'Archivio' };
const ROLE_ORDER = ['project', 'area', 'resources', 'archive'];

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
 */
export default function SectionsView({ notebooks, sectionsMap, todoListsMap, tasks, pagesCache }) {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const { session } = usePomodoro();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => flattenSections(notebooks, sectionsMap), [notebooks, sectionsMap]);
  const active = sections.find(s => s.id === sectionId) || null;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q ? sections.filter(s => s.displayName.toLowerCase().includes(q)) : sections;
    return ROLE_ORDER
      .map(role => ({ role, items: visible.filter(s => s._role === role) }))
      .filter(g => g.items.length > 0);
  }, [sections, query]);

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

  const openTaskId = session?.taskId || null;

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
      {grouped.map(g => (
        <div className="sv-group" key={g.role}>
          <span className="eyebrow">{ROLE_LABELS[g.role] || g.role}</span>
          {g.items.map(s => {
            const l = todoListsMap?.[s.displayName.toLowerCase()];
            const open = (tasks || []).filter(t => l && t._listId === l.id).length;
            return (
              <button
                key={s.id}
                className={`sv-list-item${s.id === sectionId ? ' active' : ''}`}
                onClick={() => navigate(`/sezioni/${s.id}`)}>
                <span className="sv-list-name">{paraSectionLabel(s.displayName)}</span>
                {open > 0 && <span className="sv-list-count">{open}</span>}
              </button>
            );
          })}
        </div>
      ))}
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
            {pages === null && <><Skeleton /><Skeleton /><Skeleton /></>}
            {pages?.length === 0 && <p className="sv-empty">Nessuna pagina in questa sezione</p>}
            {pages?.map(p => (
              <div className="sv-page" key={p.id}>
                <span className="sv-page-title">{p.title || '(senza titolo)'}</span>
                {p.lastModifiedDateTime && (
                  <span className="sv-page-date">
                    {new Date(p.lastModifiedDateTime).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
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
              <div className={`sv-task${t.id === openTaskId ? ' current' : ''}`} key={t.id}>
                <span
                  className="sv-task-dot"
                  style={/** @type {import('react').CSSProperties} */ ({ background: contextColor(taskContext(t)) })}
                />
                <span className="sv-task-title">{t.title}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
