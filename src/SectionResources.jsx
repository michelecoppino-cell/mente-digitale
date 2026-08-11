import { useState, useEffect } from 'react';
import { getPages } from './api';
import Skeleton from './Skeleton';
import { PageTree } from './Panel';
import { openProtocol } from './protocolLink';
import OneDriveBox from './OneDriveBox';

// OneNote + OneDrive della sezione collegata a un task, per il pannello
// Dettagli del Piano: stessi riquadri del Panel di sezione (ToDo/OneNote/
// OneDrive), mostrati sotto Note/Sottoattività invece che in un pannello a
// parte — così avviare un Pomodoro non richiede più alcun cambio di layout.
export default function SectionResources({ section, notebook, pagesCache }) {
  const [pages, setPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);

  useEffect(() => {
    setPages([]); // eslint-disable-line react-hooks/set-state-in-effect -- reset on cambio sezione
    setLoadingPages(false);
    if (!section) return;
    if (pagesCache?.current?.[section.id]) {
      setPages(pagesCache.current[section.id]);
      return;
    }
    let cancelled = false;
    setLoadingPages(true);
    getPages(section.id)
      .then(p => {
        if (cancelled) return;
        if (pagesCache?.current) pagesCache.current[section.id] = p;
        setPages(p);
      })
      .catch(e => console.error('load pages', e))
      .finally(() => { if (!cancelled) setLoadingPages(false); });
    return () => { cancelled = true; };
  }, [section?.id]); // eslint-disable-line

  if (!section) return null;
  const color = section?._color || notebook?._color || '#d4a44a';

  return (
    <>
      <div className="planner-task-detail-section">
        <div className="panel-col-header" style={{ color }}>
          <span>OneNote</span>
          {pages.length > 0 && <span className="panel-col-count">{pages.length}</span>}
        </div>
        {section.links?.oneNoteClientUrl?.href && (
          <div className="onenote-open-link" onClick={() => openProtocol(section.links.oneNoteClientUrl.href)}>
            ↗ Apri sezione
          </div>
        )}
        {loadingPages && <Skeleton rows={3} />}
        {!loadingPages && (
          <div className="panel-col-body">
            <PageTree pages={pages} />
            {!pages.length && <div className="panel-empty">Nessuna pagina</div>}
          </div>
        )}
      </div>

      <div className="planner-task-detail-section">
        <OneDriveBox sectionId={section.id} color={color} />
      </div>
    </>
  );
}
