import { useState, useEffect } from 'react';
import { getPages } from './api';

export default function Panel({ selected, sectionsMap, onClose }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPages([]);
    if (selected?.type === 'section') loadPages(selected.data.id);
  }, [selected]);

  async function loadPages(id) {
    setLoading(true);
    try { setPages(await getPages(id)); }
    catch (e) { console.error(e); }
    setLoading(false);
  }

  if (!selected) return <div className="panel" />;

  const { type, data, nb } = selected;
  const color = nb._color;
  const sects = sectionsMap[nb.id] || [];

  return (
    <div className="panel open">
      <div className="panel-head">
        <div>
          <div className="panel-label">{type === 'notebook' ? 'Taccuino' : 'Sezione'}</div>
          <div className="panel-title" style={{ color }}>{data.displayName}</div>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="panel-body">
        {type === 'notebook' && <>
          <PanelSection title="Apri taccuino">
            <LinkRow color={color} label={data.displayName}
              appUrl={data.links?.oneNoteClientUrl?.href}
              webUrl={data.links?.oneNoteWebUrl?.href}
              badge={`${sects.length} sezioni`} />
          </PanelSection>
          {sects.length > 0 && (
            <PanelSection title={`Sezioni (${sects.length})`}>
              {sects.map(s => (
                <LinkRow key={s.id} color={color + '99'} label={s.displayName}
                  appUrl={s.links?.oneNoteClientUrl?.href}
                  webUrl={s.links?.oneNoteWebUrl?.href} />
              ))}
            </PanelSection>
          )}
        </>}
        {type === 'section' && <>
          <PanelSection title="Apri sezione">
            <LinkRow color={color} label={data.displayName}
              appUrl={data.links?.oneNoteClientUrl?.href}
              webUrl={data.links?.oneNoteWebUrl?.href} />
          </PanelSection>
          <PanelSection title="Ultime pagine">
            {loading && <div className="panel-loading">Caricamento…</div>}
            {pages.map(p => (
              <LinkRow key={p.id} color={color + '77'} label={p.title || 'Senza titolo'}
                appUrl={p.links?.oneNoteClientUrl?.href}
                webUrl={p.links?.oneNoteWebUrl?.href} />
            ))}
            {!loading && !pages.length && <div className="panel-loading">Nessuna pagina trovata</div>}
          </PanelSection>
        </>}
      </div>
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div className="panel-section">
      <div className="panel-section-title">{title}</div>
      {children}
    </div>
  );
}

function LinkRow({ color, label, appUrl, webUrl, badge }) {
  return (
    <div className="link-row">
      <span className="link-dot" style={{ background: color }} />
      <span className="link-label">{label}</span>
      <div className="link-btns">
        {badge && <span className="link-badge">{badge}</span>}
        {appUrl && (
          <button className="link-btn primary"
            onClick={() => window.location.href = appUrl}
            title="Apri in OneNote desktop">App</button>
        )}
        {webUrl && (
          <button className="link-btn"
            onClick={() => window.open(webUrl, '_blank')}
            title="Apri nel browser">Web</button>
        )}
      </div>
    </div>
  );
}
