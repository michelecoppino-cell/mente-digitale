import { useState, useEffect, useRef, useMemo } from 'react';
import { useDialog } from './useDialog';
import { openProtocol } from './protocolLink';

const TYPE_META = {
  section: { icon: '▦', label: 'Sezione' },
  page:    { icon: '❐', label: 'Pagina' },
  task:    { icon: '✓', label: 'Task' },
};

// Cerca tra i dati già in cache (sezioni, pagine OneNote, task) — nessuna chiamata API.
// Il contenuto è montato solo quando open: lo stato riparte pulito a ogni apertura.
export default function SearchOverlay(props) {
  if (!props.open) return null;
  return <SearchBox {...props} />;
}

function SearchBox({ onClose, notebooks, sectionsMap, pagesCache, tasks, onSelectSection }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  // Escape era gestito solo dal campo di testo: bastava un clic su un risultato
  // (che sposta il fuoco) perché il tasto non chiudesse più nulla. Qui vale per
  // tutta la finestra, e il fuoco torna dove era all'apertura.
  const boxRef = useDialog(true, onClose);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    // startsWith vale più di includes
    const score = s => {
      const t = (s || '').toLowerCase();
      return t.startsWith(q) ? 2 : t.includes(q) ? 1 : 0;
    };
    const out = [];

    for (const nb of notebooks) {
      for (const sec of sectionsMap[nb.id] || []) {
        const sc = score(sec.displayName);
        if (sc) out.push({ type: 'section', label: sec.displayName, sub: nb.displayName, color: nb._color, sc, section: sec, nb });

        for (const p of pagesCache.current?.[sec.id] || []) {
          const psc = score(p.title);
          if (psc) out.push({ type: 'page', label: p.title || 'Senza titolo', sub: `${nb.displayName} › ${sec.displayName}`, color: nb._color, sc: psc, page: p });
        }
      }
    }

    for (const t of tasks) {
      const sc = score(t.title);
      if (sc) out.push({ type: 'task', label: t.title, sub: t._listName, important: t.importance === 'high', sc, task: t });
    }

    const order = { section: 0, page: 1, task: 2 };
    out.sort((a, b) => b.sc - a.sc || order[a.type] - order[b.type] || a.label.localeCompare(b.label));
    return out.slice(0, 24);
  }, [query, notebooks, sectionsMap, pagesCache, tasks]);

  // Se i risultati si accorciano, la selezione resta comunque valida
  const activeIdx = Math.max(0, Math.min(active, results.length - 1));

  function handleOpen(r) {
    if (r.type === 'section') {
      onSelectSection(r.section, r.nb, 'onenote');
    } else if (r.type === 'page') {
      openProtocol(r.page.links?.oneNoteClientUrl?.href);
    } else if (r.type === 'task') {
      // Apri il pannello della sezione omonima alla lista, tab ToDo; fallback: app To-Do
      const lower = (r.task._listName || '').toLowerCase();
      let found = null;
      for (const nb of notebooks) {
        const sec = (sectionsMap[nb.id] || []).find(s => s.displayName.toLowerCase() === lower);
        if (sec) { found = { sec, nb }; break; }
      }
      if (found) onSelectSection(found.sec, found.nb, 'todo');
      else openProtocol(`ms-to-do://tasks/id/${r.task.id}`);
    }
    onClose();
  }

  function handleKeyDown(e) {
    // Escape lo gestisce useDialog, per tutta la finestra.
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleOpen(results[activeIdx]);
    }
  }

  // Tieni visibile l'elemento attivo durante la navigazione con le frecce
  useEffect(() => {
    listRef.current?.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="search-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={boxRef}
        className="search-box"
        role="dialog"
        aria-modal="true"
        aria-label="Cerca sezioni, pagine e attività">
        <div className="search-input-row">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            autoFocus
            className="search-input"
            placeholder="Cerca sezioni, pagine, task…"
            value={query}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results.length ? `search-result-${activeIdx}` : undefined}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="search-kbd">esc</kbd>
        </div>

        {query.trim().length >= 2 && (
          <div className="search-results" ref={listRef} id="search-results" role="listbox">
            {results.map((r, i) => (
              <div
                key={`${r.type}-${i}`}
                id={`search-result-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`search-result${i === activeIdx ? ' active' : ''}`}
                onClick={() => handleOpen(r)}
                onMouseEnter={() => setActive(i)}>
                <span className="search-result-icon" style={{ color: r.color || 'var(--accent)' }}>
                  {TYPE_META[r.type].icon}
                </span>
                <span className="search-result-label">
                  {r.important && <span className="search-star">★ </span>}
                  {r.label}
                </span>
                <span className="search-result-sub">{r.sub}</span>
                <span className="search-result-type">{TYPE_META[r.type].label}</span>
              </div>
            ))}
            {!results.length && (
              <div className="search-empty">Nessun risultato per “{query.trim()}”</div>
            )}
          </div>
        )}

        <div className="search-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviga</span>
          <span><kbd>↵</kbd> apri</span>
          <span>La ricerca copre i dati già caricati</span>
        </div>
      </div>
    </div>
  );
}
