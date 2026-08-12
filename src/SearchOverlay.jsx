// @ts-check
// ⌘K: trovare, e fare.
//
// Era una ricerca sui soli dati già in memoria, con una nota in fondo che lo
// dichiarava. Ora è la tastiera dei comandi dell'app: le risposte immediate
// (comandi, sezioni, pagine, attività) compaiono mentre si scrive, il diario e la
// posta arrivano subito dopo sotto la loro intestazione. E cercare fa anche
// un'altra cosa: mette in coda il caricamento delle pagine delle sezioni che non
// sono ancora in memoria, così l'indice locale si completa da sé invece di
// restare a metà per sempre.
import { useState, useEffect, useRef, useMemo } from 'react';
import { useDialog } from './useDialog';
import { openProtocol } from './protocolLink';
import {
  MIN_QUERY, commandHits, localHits, diaryHits, mailHits,
  sectionsWithoutPages, orderHits, GROUP_LABELS,
} from './searchSources';
import './SearchOverlay.css';

const TYPE_ICON = {
  command: '⌘',
  section: '▦',
  page: '❐',
  task: '✓',
  diary: '✎',
  mail: '✉',
};

/** Quanto si aspetta, dopo l'ultima battuta, prima di disturbare la rete. */
const REMOTE_DEBOUNCE = 320;

/** @param {any} props */
export default function SearchOverlay(props) {
  // Il contenuto è montato solo quando serve: lo stato riparte pulito a ogni
  // apertura, e la ricerca nel diario non parte a finestra chiusa.
  if (!props.open) return null;
  return <SearchBox {...props} />;
}

/**
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {any[]} props.notebooks
 * @param {Record<string, any[]>} props.sectionsMap
 * @param {any} props.pagesCache
 * @param {any[]} props.tasks
 * @param {(sec: any, nb: any, app: string) => void} props.onSelectSection
 * @param {{ id: string, label: string, hint?: string, keys?: string[], run: () => void }[]} [props.commands]
 * @param {(sectionIds: string[]) => void} [props.onWarmPages]
 * @param {(entry: any) => void} [props.onOpenDiaryEntry]
 */
function SearchBox({
  onClose, notebooks, sectionsMap, pagesCache, tasks, onSelectSection,
  commands = [], onWarmPages, onOpenDiaryEntry,
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState(/** @type {{ diary: any[], mail: any[] }} */ ({ diary: [], mail: [] }));
  const [remoteBusy, setRemoteBusy] = useState(false);
  const listRef = useRef(/** @type {any} */ (null));
  // Escape era gestito solo dal campo di testo: bastava un clic su un risultato
  // (che sposta il fuoco) perché il tasto non chiudesse più nulla. Qui vale per
  // tutta la finestra, e il fuoco torna dove era all'apertura.
  const boxRef = useDialog(true, onClose);

  const q = query.trim().toLowerCase();
  const enough = q.length >= MIN_QUERY;

  // Le sorgenti immediate. Il calcolo è sincrono e locale: deve stare dietro a
  // chi scrive veloce.
  const instant = useMemo(() => {
    if (!enough) return [];
    return [
      ...commandHits(q, commands),
      ...localHits(q, { notebooks, sectionsMap, pagesCache, tasks }),
    ];
  }, [q, enough, commands, notebooks, sectionsMap, pagesCache, tasks]);

  // Diario e posta: dopo una pausa nella digitazione, e senza far aspettare il
  // resto. Se la richiesta è ancora in volo quando si batte un altro carattere,
  // il suo risultato viene scartato — `annullato` è l'unica cosa che tiene
  // l'elenco coerente con quello che c'è scritto nel campo.
  useEffect(() => {
    if (!enough) { setRemote({ diary: [], mail: [] }); return undefined; }
    let annullato = false;
    setRemoteBusy(true);
    const t = setTimeout(async () => {
      const [diary, mail] = await Promise.all([
        diaryHits(q).catch(e => { console.error('ricerca diario', e); return []; }),
        mailHits(q).catch(e => { console.error('ricerca posta', e); return []; }),
      ]);
      if (annullato) return;
      setRemote({ diary, mail });
      setRemoteBusy(false);
    }, REMOTE_DEBOUNCE);
    return () => { annullato = true; clearTimeout(t); };
  }, [q, enough]);

  // Cercare completa l'indice: le sezioni senza pagine in memoria vanno in coda
  // di precarico, una volta per apertura della finestra.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!enough || warmedRef.current || !onWarmPages) return;
    const missing = sectionsWithoutPages({ notebooks, sectionsMap, pagesCache });
    if (!missing.length) return;
    warmedRef.current = true;
    onWarmPages(missing);
  }, [enough, notebooks, sectionsMap, pagesCache, onWarmPages]);

  const results = useMemo(
    () => orderHits([...instant, ...remote.diary, ...remote.mail]),
    [instant, remote],
  );

  // Se i risultati si accorciano, la selezione resta comunque valida
  const activeIdx = Math.max(0, Math.min(active, results.length - 1));

  function handleOpen(/** @type {any} */ r) {
    if (!r) return;
    switch (r.type) {
      case 'command':
        r.data.run();
        break;
      case 'section':
        onSelectSection(r.data.section, r.data.nb, 'onenote');
        break;
      case 'page':
        openProtocol(r.data.page.links?.oneNoteClientUrl?.href);
        break;
      case 'task': {
        // Il pannello della sezione omonima alla lista, scheda ToDo; se quella
        // sezione non è (ancora) in memoria, si apre il task nell'app To-Do.
        const lower = (r.data.task._listName || '').toLowerCase();
        let found = null;
        for (const nb of notebooks) {
          const sec = (sectionsMap[nb.id] || []).find(s => s.displayName.toLowerCase() === lower);
          if (sec) { found = { sec, nb }; break; }
        }
        if (found) onSelectSection(found.sec, found.nb, 'todo');
        else openProtocol(`ms-to-do://tasks/id/${r.data.task.id}`);
        break;
      }
      case 'diary':
        onOpenDiaryEntry?.(r.data.entry);
        break;
      case 'mail':
        if (r.data.message.webLink) openProtocol(r.data.message.webLink);
        break;
      default:
        break;
    }
    onClose();
  }

  function handleKeyDown(/** @type {any} */ e) {
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
    listRef.current?.querySelector('.search-result.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Le intestazioni compaiono al primo risultato di ciascuna famiglia: l'elenco
  // resta piatto per le frecce, e leggibile per l'occhio.
  let lastType = '';

  return (
    <div className="search-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={boxRef}
        className="search-box"
        role="dialog"
        aria-modal="true"
        aria-label="Cerca, e lancia i comandi">
        <div className="search-input-row">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            autoFocus
            className="search-input"
            placeholder="Cerca, o scrivi un comando…"
            value={query}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results.length ? `search-result-${activeIdx}` : undefined}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKeyDown}
          />
          {remoteBusy && <span className="search-busy" aria-hidden="true" />}
          <kbd className="search-kbd">esc</kbd>
        </div>

        {enough && (
          <div className="search-results" ref={listRef} id="search-results" role="listbox">
            {results.map((r, i) => {
              const head = r.type !== lastType ? r.type : null;
              lastType = r.type;
              return (
                <div key={r.id}>
                  {head && <div className="search-group eyebrow">{GROUP_LABELS[head]}</div>}
                  <div
                    id={`search-result-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    className={`search-result${i === activeIdx ? ' active' : ''}`}
                    onClick={() => handleOpen(r)}
                    onMouseEnter={() => setActive(i)}>
                    <span className="search-result-icon" style={{ color: r.color || 'var(--accent)' }}>
                      {TYPE_ICON[r.type]}
                    </span>
                    <span className="search-result-label">
                      {r.data?.task?.importance === 'high' && <span className="search-star">★ </span>}
                      {r.label}
                    </span>
                    <span className="search-result-sub">{r.sub}</span>
                    {r.type === 'command' && r.data.keys && (
                      <span className="search-result-keys">
                        {r.data.keys.map((/** @type {string} */ k, /** @type {number} */ n) => <kbd key={n}>{k}</kbd>)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {!results.length && !remoteBusy && (
              <div className="search-empty">Nessun risultato per “{query.trim()}”</div>
            )}
            {!results.length && remoteBusy && (
              <div className="search-empty">Cerco anche nel diario e nella posta…</div>
            )}
          </div>
        )}

        <div className="search-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviga</span>
          <span><kbd>↵</kbd> apri</span>
          <span>Comandi, sezioni, pagine, attività, diario e posta</span>
        </div>
      </div>
    </div>
  );
}
