import { useState, useEffect } from 'react';

const FEEDS = [
  {
    id: 'corriere',
    name: 'Corriere della Sera',
    url: 'https://www.corriere.it/rss/homepage.xml',
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

const PROXY = 'https://api.rss2json.com/v1/api.json?rss_url=';

function isRecent(str) {
  if (!str) return false;
  const d = new Date(str);
  return (Date.now() - d.getTime()) < 36 * 3600 * 1000; // ultime 36h
}

export default function RssPanel({ open, onToggle }) {
  const [activeFeed, setActiveFeed] = useState('corriere');
  const [articles, setArticles] = useState({});
  const [loading, setLoading] = useState({});
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (open) loadFeed(activeFeed);
  }, [open, activeFeed]);

  async function loadFeed(id) {
    if (articles[id]) return;
    setLoading(prev => ({ ...prev, [id]: true }));
    try {
      const feed = FEEDS.find(f => f.id === id);
      const r = await fetch(PROXY + encodeURIComponent(feed.url));
      const d = await r.json();
      if (d.status === 'ok') {
        setArticles(prev => ({ ...prev, [id]: d.items }));
      }
    } catch(e) { console.error('RSS error', e); }
    setLoading(prev => ({ ...prev, [id]: false }));
  }

  const feed = FEEDS.find(f => f.id === activeFeed);
  const allItems = articles[activeFeed] || [];
  // Corriere: ultime 36h (copre sempre almeno oggi); Sadhguru: tutto
  const items = feed.filterToday
    ? allItems.filter(item => isRecent(item.pubDate))
    : allItems;
  const isLoading = loading[activeFeed];

  function formatTime(str) {
    if (!str) return '';
    try { return new Date(str).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
    catch(e) { return ''; }
  }

  return (
    <div className={`rss-bar ${open ? 'open' : ''}`}>
      <div className="rss-toggle" onClick={onToggle}>
        <div className="rss-feed-tabs">
          {FEEDS.map(f => (
            <span key={f.id}
              className={`rss-feed-tab ${activeFeed === f.id ? 'active' : ''}`}
              style={{ '--feed-color': f.color }}
              onClick={e => { e.stopPropagation(); setActiveFeed(f.id); if (!open) onToggle(); }}>
              {f.name}
            </span>
          ))}
        </div>
        <span className="rss-toggle-arrow">{open ? '▼' : '▲'}</span>
      </div>

      {open && (
        <div className="rss-content">
          {isLoading && <div className="rss-loading">Caricamento {feed.name}…</div>}
          {!isLoading && !items.length && (
            <div className="rss-loading">
              {feed.filterToday ? 'Nessun articolo di oggi ancora disponibile' : 'Nessun articolo trovato'}
            </div>
          )}
          <div className="rss-list">
            {items.map((item, i) => (
              <div key={i} className={`rss-item ${expanded === i ? 'expanded' : ''}`}
                onClick={() => setExpanded(expanded === i ? null : i)}>
                <div className="rss-item-title" style={{ color: expanded === i ? feed.color : 'var(--text)' }}>
                  {item.title}
                </div>
                <div className="rss-item-meta">
                  <span className="rss-item-date">{formatTime(item.pubDate)}</span>
                  {expanded === i && (
                    <a className="rss-item-link" href={item.link} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()} style={{ color: feed.color }}>
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
        </div>
      )}
    </div>
  );
}
