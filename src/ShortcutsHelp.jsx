// @ts-check
// L'elenco delle scorciatoie, su «?».
//
// Raggruppate per dove valgono e non per tasto: la domanda di chi lo apre non è
// «cosa fa ⌘J» ma «cosa posso fare da qui».
import { SHORTCUTS } from './shortcuts';
import { useDialog } from './useDialog';
import './ShortcutsHelp.css';

/** @param {{ open: boolean, onClose: () => void }} props */
export default function ShortcutsHelp({ open, onClose }) {
  const boxRef = useDialog(open, onClose);
  if (!open) return null;

  /** @type {Map<string, typeof SHORTCUTS>} */
  const byScope = new Map();
  for (const s of SHORTCUTS) {
    if (!byScope.has(s.scope)) byScope.set(s.scope, []);
    byScope.get(s.scope)?.push(s);
  }

  return (
    <div className="sc-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="sc-box"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Scorciatoie da tastiera">
        <div className="sc-head">
          <span className="eyebrow">Scorciatoie</span>
          <button className="sc-close" onClick={onClose} aria-label="Chiudi" title="Chiudi">✕</button>
        </div>

        <div className="sc-groups">
          {[...byScope.entries()].map(([scope, items]) => (
            <section className="sc-group" key={scope}>
              <h3 className="sc-scope">{scope}</h3>
              <dl className="sc-list">
                {items.map(s => (
                  <div className="sc-row" key={s.id + s.label}>
                    <dt className="sc-keys">
                      {s.keys.map((k, i) => (
                        <kbd key={i}>{k}</kbd>
                      ))}
                    </dt>
                    <dd className="sc-label">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="sc-foot">Si riapre con <kbd>?</kbd>.</p>
      </div>
    </div>
  );
}
