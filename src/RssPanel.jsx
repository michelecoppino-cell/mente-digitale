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
function BriefingTab({ color }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // 'mondo' | 'italia' | 'friuli' | null

  useEffect(() => {
    fetch('/news-summary.json?t=' + Math.floor(Date.now() / 300000)) // cache 5 min
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="rss-loading">Caricamento briefing…</div>;
  if (!data) return <div className="rss-loading">Briefing non disponibile — verrà generato automaticamente ogni 3h.</div>;

  const sections = [
    { key: 'mondo',  label: '🌍 Mondo',  items: data.sections?.mondo  || [] },
    { key: 'italia', label: '🇮🇹 Italia', items: data.sections?.italia || [] },
    { key: 'friuli', label: '📍 Friuli',  items: data.sections?.friuli || [] },
  ];

  const genDate = data.generatedAt ? new Date(data.generatedAt) : null;
  const genLabel = genDate ? genDate.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="briefing-content">
      {genLabel && <div className="briefing-meta">Aggiornato {genLabel}</div>}
      {sections.map(sec => (
        <div key={sec.key} className="briefing-section">
          <div className="briefing-section-header"
            onClick={() => setExpanded(expanded === sec.key ? null : sec.key)}>
            <span>{sec.label}</span>
            <span className="briefing-chevron">{expanded === sec.key ? '▾' : '▸'}</span>
          </div>
          {(expanded === sec.key || expanded === null) && sec.items.map((item, i) => (
            <div key={i} className="briefing-item">
              <div className="briefing-item-title" style={{ color }}>{item.title}</div>
              <div className="briefing-item-summary">{item.summary}</div>
            </div>
          ))}
        </div>
      ))}
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
