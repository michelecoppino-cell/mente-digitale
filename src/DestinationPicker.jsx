// @ts-check
// L'elenco delle destinazioni sotto la riga di cattura: dove finisce il task.
//
// Non è una tendina. Una `<select>` con dentro tutte le liste — quella
// del popup di chiarimento — costringe a cercare con gli occhi in un elenco
// piatto: con una ventina di commesse è il passaggio più lento di tutto
// l'inserimento. Qui si scrive e la lista si stringe, come la ricerca globale.
//
// L'ordine a query vuota è quello d'uso recente: le cose si buttano quasi
// sempre in tre o quattro posti, e quei posti devono stare in cima senza che
// nessuno li configuri.
import { Fragment, useEffect, useRef } from 'react';
import './DestinationPicker.css';

// Stesse icone delle foglie PARA del diagramma di chiarimento: la stessa
// destinazione si riconosce uguale ovunque la si scelga.
/** @type {Record<string, string>} */
const ROLE_ICON = { area: '🔁', resources: '💡' };

/**
 * @param {Object} props
 * @param {import('./captureParse').Destination[]} props.items   già filtrate e ordinate
 * @param {number} props.activeIndex   -1 = Inbox, l'opzione sempre in testa
 * @param {number} [props.contextCount]  quante voci in testa sono della sezione aperta
 * @param {string} [props.contextLabel]  il nome di quella sezione
 * @param {(dest: import('./captureParse').Destination|null) => void} props.onPick
 * @param {(index: number) => void} props.onHover
 */
export default function DestinationPicker({ items, activeIndex, contextCount = 0, contextLabel = '', onPick, onHover }) {
  const listRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  // La riga scelta con le frecce deve restare visibile: senza questo, scendendo
  // oltre il bordo si sceglie alla cieca.
  useEffect(() => {
    const el = listRef.current?.querySelector('.dp-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="dp" ref={listRef} role="listbox" aria-label="Destinazione">
      <button
        type="button"
        role="option"
        aria-selected={activeIndex === -1}
        className={`dp-item${activeIndex === -1 ? ' active' : ''}`}
        onMouseEnter={() => onHover(-1)}
        onMouseDown={e => e.preventDefault()}
        onClick={() => onPick(null)}>
        <span className="dp-icon">📥</span>
        <span className="dp-label">Inbox</span>
        <span className="dp-note">la chiarisci dopo</span>
      </button>

      {items.length === 0 && <div className="dp-empty">Nessuna sezione con questo nome</div>}

      {items.map((d, i) => (
        // Le liste della sezione aperta stanno in testa sotto il loro nome, il
        // resto sotto «Tutte le sezioni»: senza le due intestazioni una
        // commessa con tre consegne sembrerebbe tre sezioni diverse. Appena si
        // scrive qualcosa dopo `@` la ricerca è globale e piatta, e allora
        // `contextCount` è zero e le intestazioni non compaiono.
        <Fragment key={d.id}>
          {contextCount > 0 && i === 0 && <div className="dp-head">{contextLabel}</div>}
          {contextCount > 0 && i === contextCount && <div className="dp-head">Tutte le sezioni</div>}
          <button
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`dp-item${i === activeIndex ? ' active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(d)}>
            <span className="dp-icon">{ROLE_ICON[d.role || ''] || '🗂'}</span>
            <span className="dp-label">{d.label}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
