// @ts-check
// L'elenco delle scorciatoie da tastiera, dietro la (i) in topbar.
//
// Le scorciatoie c'erano già — ⌘K, ⌘N, ⌘J, ⌘Z e una manciata di tasti dentro
// la cattura e la ricerca — ma si scoprivano solo leggendo i `title` dei
// bottoni, uno per volta, o il codice. Un elenco solo, accanto alla
// campanella: si guarda una volta e poi non serve più, che è esattamente
// quello che deve fare.
import { useEffect, useState } from 'react';
import './ShortcutsPanel.css';

// Su Mac il modificatore è ⌘, altrove Ctrl. La riga si scrive una volta con
// «Mod» e viene resa nel simbolo giusto: nei `title` sparsi per l'app c'è ⌘
// perché è lì che l'app è nata, ma un elenco di scorciatoie che mostra il
// tasto sbagliato è peggio di nessun elenco.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

/** @type {{ titolo: string, voci: [string, string][] }[]} */
const GRUPPI = [
  {
    titolo: 'Ovunque',
    voci: [
      [`${MOD} K`, 'Cerca in taccuini, sezioni e attività'],
      [`${MOD} N`, 'Cattura rapida di un pensiero'],
      [`${MOD} J`, 'Apri il Diario'],
      [`${MOD} Z`, "Annulla l'ultima azione"],
      ['Esc', 'Chiudi il pannello o la finestra aperta'],
    ],
  },
  {
    titolo: 'Cattura rapida',
    voci: [
      ['⏎', 'Cattura'],
      ['⇧ ⏎', 'Vai a capo senza catturare'],
      ['@', 'Scegli la destinazione mentre scrivi'],
      ['↑ ↓', 'Scorri le destinazioni'],
      ['⇥', 'Conferma la destinazione e continua a scrivere'],
      ['Esc', 'Chiudi le destinazioni, poi la cattura'],
    ],
  },
  {
    titolo: 'Ricerca',
    voci: [
      ['↑ ↓', 'Scorri i risultati'],
      ['⏎', 'Apri il risultato scelto'],
    ],
  },
  {
    titolo: 'Diario · foto',
    voci: [
      ['← →', 'Foto precedente e successiva'],
    ],
  },
];

/**
 * La (i) in topbar e il suo pannello. Si chiude cliccando fuori o con Esc,
 * come la campanella accanto.
 */
export default function ShortcutsPanel() {
  const [aperto, setAperto] = useState(false);

  useEffect(() => {
    if (!aperto) return;
    function suTasto(/** @type {KeyboardEvent} */ e) {
      if (e.key === 'Escape') setAperto(false);
    }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [aperto]);

  return (
    <div className="bell-wrap">
      <button
        className={`search-btn tap-44${aperto ? ' active' : ''}`}
        onClick={() => setAperto(o => !o)}
        title="Scorciatoie da tastiera">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5" />
          <path d="M12 7.6v.1" />
        </svg>
      </button>
      {aperto && (
        <>
          {/* Lo scrim e non un listener sul documento: dentro il menù «altro»
              della topbar fusa il pannello è già annidato in un altro strato,
              e un click fuori misurato sul documento lo chiuderebbe insieme
              al menù che lo contiene. */}
          <div className="sc-scrim" onClick={() => setAperto(false)} />
          <div className="sc-dropdown">
            <div className="bell-dropdown-header">
              <span>Scorciatoie da tastiera</span>
              <button onClick={() => setAperto(false)}>✕</button>
            </div>
            {GRUPPI.map(g => (
              <div className="sc-group" key={g.titolo}>
                <div className="sc-group-title">{g.titolo}</div>
                {g.voci.map(([tasto, cosa]) => (
                  <div className="sc-row" key={g.titolo + tasto + cosa}>
                    <kbd className="sc-key">{tasto}</kbd>
                    <span className="sc-desc">{cosa}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
