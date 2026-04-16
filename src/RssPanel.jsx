import { useState, useEffect } from 'react';

const RSS_FEEDS = [
  {
    id: 'ansa',
    name: 'ANSA',
    url: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml',
    color: '#c8a96e',
    filterToday: true,
  },
  {
    id: 'sadhguru',
    name: 'Sadhguru',
    url: 'https://feeds.feedburner.com/Sadhguru',
    color: '#9b8ec4',
    filterToday: false,
  },
];

const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

function isRecent(str) {
  if (!str) return false;
  const d = new Date(str);
  return (Date.now() - d.getTime()) < 36 * 3600 * 1000;
}

// ── Briefing AI ──────────────────────────────────────────────────────────────
const BRIEFING_SECTIONS = [
  { key: 'mondo',  label: '🌍 Mondo' },
  { key: 'italia', label: '🇮🇹 Italia' },
  { key: 'friuli', label: '📍 Friuli' },
];

const EMPTY_STATE = { items: null, loading: false, error: null, generatedAt: null };

function BriefingTab({ color }) {
  const [sections, setSections] = useState({
    mondo:  { ...EMPTY_STATE },
    italia: { ...EMPTY_STATE },
    friuli: { ...EMPTY_STATE },
  });
  const [expanded, setExpanded] = useState(null);

  async function fetchSection(key) {
    setSections(prev => ({ ...prev, [key]: { ...prev[key], loading: true, error: null } }));
    try {
      const r = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: key }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setSections(prev => ({
        ...prev,
        [key]: { items: d.items, loading: false, error: null, generatedAt: d.generatedAt },
      }));
    } catch (e) {
      setSections(prev => ({ ...prev, [key]: { ...prev[key], loading: false, error: e.message } }));
    }
  }

  function handleToggle(key) {
    const opening = expanded !== key;
    setExpanded(opening ? key : null);
    if (opening && !sections[key].items && !sections[key].loading) {
      fetchSection(key);
    }
  }

  return (
    <div className="briefing-content">
      {BRIEFING_SECTIONS.map(({ key, label }) => {
        const sec = sections[key];
        const isOpen = expanded === key;
        const genLabel = sec.generatedAt
          ? new Date(sec.generatedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : null;

        return (
          <div key={key} className="briefing-section">
            <div className="briefing-section-header" onClick={() => handleToggle(key)}>
              <span>{label}</span>
              <div className="briefing-header-right">
                {sec.items && !sec.loading && (
                  <span className="briefing-refresh" title="Aggiorna"
                    onClick={e => { e.stopPropagation(); fetchSection(key); }}>↺</span>
                )}
                {sec.loading && <span className="briefing-spinner" />}
                <span className="briefing-chevron">{isOpen ? '▾' : '▸'}</span>
              </div>
            </div>

            {isOpen && (
              <div>
                {sec.loading && <div className="rss-loading">Generazione in corso…</div>}
                {sec.error && <div className="briefing-error">{sec.error}</div>}
                {!sec.loading && !sec.items && !sec.error && (
                  <div className="briefing-empty" onClick={() => fetchSection(key)}>
                    Tocca per generare il briefing
                  </div>
                )}
                {sec.items?.map((item, i) => (
                  <div key={i} className="briefing-item">
                    <div className="briefing-item-title" style={{ color }}>{item.title}</div>
                    <div className="briefing-item-summary">{item.summary}</div>
                  </div>
                ))}
                {genLabel && <div className="briefing-meta">Generato {genLabel}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── RSS Feed ─────────────────────────────────────────────────────────────────
export default function RssPanel({ open, onToggle }) {
  const [activeTab, setActiveTab] = useState('briefing'); // 'briefing' | 'ansa' | 'sadhguru'
  const [articles, setArticles] = useState({});
  const [loading, setLoading] = useState({});
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (open && activeTab !== 'briefing') loadFeed(activeTab);
  }, [open, activeTab]);

  async function loadFeed(id) {
    if (articles[id]?.length) return;
    setLoading(prev => ({ ...prev, [id]: true }));
    try {
      const feed = RSS_FEEDS.find(f => f.id === id);
      const r = await fetch(RSS2JSON + encodeURIComponent(feed.url));
      const d = await r.json();
      if (d.status === 'ok' && d.items?.length) {
        setArticles(prev => ({ ...prev, [id]: d.items }));
      }
    } catch(e) { console.error('RSS error', e); }
    setLoading(prev => ({ ...prev, [id]: false }));
  }

  function formatTime(str) {
    if (!str) return '';
    try { return new Date(str).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }

  const tabs = [
    { id: 'briefing', name: 'Briefing AI', color: '#c8a96e' },
    ...RSS_FEEDS.map(f => ({ id: f.id, name: f.name, color: f.color })),
  ];

  const activeFeedDef = RSS_FEEDS.find(f => f.id === activeTab);
  const allItems = articles[activeTab] || [];
  const items = activeFeedDef?.filterToday
    ? allItems.filter(item => isRecent(item.pubDate))
    : allItems;
  const isLoading = loading[activeTab];
  const activeColor = tabs.find(t => t.id === activeTab)?.color || '#c8a96e';

  return (
    <div className={`rss-bar ${open ? 'open' : ''}`}>
      <div className="rss-toggle" onClick={onToggle}>
        <div className="rss-feed-tabs">
          {tabs.map(t => (
            <span key={t.id}
              className={`rss-feed-tab ${activeTab === t.id ? 'active' : ''}`}
              style={{ '--feed-color': t.color }}
              onClick={e => { e.stopPropagation(); setActiveTab(t.id); if (!open) onToggle(); }}>
              {t.name}
            </span>
          ))}
        </div>
        <span className="rss-toggle-arrow">{open ? '▼' : '▲'}</span>
      </div>

      {open && (
        <div className="rss-content">
          {activeTab === 'briefing' ? (
            <BriefingTab color={activeColor} />
          ) : (
            <>
              {isLoading && <div className="rss-loading">Caricamento {activeFeedDef?.name}…</div>}
              {!isLoading && !items.length && (
                <div className="rss-loading">
                  {activeFeedDef?.filterToday ? 'Nessun articolo delle ultime 36h' : 'Nessun articolo trovato'}
                </div>
              )}
              <div className="rss-list">
                {items.map((item, i) => (
                  <div key={i} className={`rss-item ${expanded === i ? 'expanded' : ''}`}
                    onClick={() => setExpanded(expanded === i ? null : i)}>
                    <div className="rss-item-title" style={{ color: expanded === i ? activeColor : 'var(--text)' }}>
                      {item.title}
                    </div>
                    <div className="rss-item-meta">
                      <span className="rss-item-date">{formatTime(item.pubDate)}</span>
                      {expanded === i && (
                        <a className="rss-item-link" href={item.link} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()} style={{ color: activeColor }}>
                          Apri →
                        </a>
                      )}
                    </div>
                    {expanded === i && item.description && (
                      <div className="rss-item-desc"
                        dangerouslySetInnerHTML={{ __html: item.description.replace(/<img[^>]*>/g, '').slice(0, 300) + '…' }} />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
