// @ts-check
// Riquadro riservato: parte oscurato, si apre col PIN di Finanze.
//
// «Oggi» è la schermata che resta aperta sulla scrivania tutto il giorno.
// Quasi tutto quello che mostra — agenda, azioni, diario — è roba che si può
// leggere alle spalle di chi lavora senza che importi; i conti e i cento
// desideri no. Sono gli unici due riquadri privati della vista, e prima
// stavano lì in chiaro: quello dei desideri per intero, quello di Finanze
// scaricando il problema alla sezione (cioè non mostrando niente).
//
// Lo sblocco è lo stesso della sezione Finanze — stesso PIN, stessa scadenza a
// 30 minuti, stessa scheda del browser: aprire un riquadro apre anche l'altro
// e la sezione, che è l'unico comportamento che non fa digitare il codice tre
// volte di fila.
import { useEffect, useRef, useState } from 'react';
import { sblocca, useSbloccato, verificaPin } from './finanze/sblocco';

/** Il lucchetto del velo. */
function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </svg>
  );
}

/**
 * @param {Object} props
 * @param {string} props.eyebrow                    l'etichetta, sempre in chiaro
 * @param {string} props.nota                       cosa c'è sotto il velo
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children contenuto riservato
 */
export default function SensitiveCard({ eyebrow, nota, className = '', children }) {
  const sbloccato = useSbloccato();
  const [chiedePin, setChiedePin] = useState(false);

  if (sbloccato) {
    return (
      <section className={`today-card${className ? ` ${className}` : ''}`}>
        <span className="eyebrow">{eyebrow}</span>
        {children}
      </section>
    );
  }

  return (
    <section className={`today-card locked riservato${className ? ` ${className}` : ''}`}>
      <span className="eyebrow">{eyebrow}</span>
      {/* Le stesse barre sfocate dei riquadri senza fonte dati: qui però il
          dato c'è, ed è il velo a coprirlo. */}
      <div className="today-locked-ghost" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span />
      </div>
      {chiedePin
        ? <PinVeil onChiudi={() => setChiedePin(false)} />
        : (
          <button
            type="button"
            className="today-locked-veil today-unlock"
            onClick={() => setChiedePin(true)}
            title="Inserisci il PIN per vedere i dati">
            <LockIcon />
            <span className="today-locked-note">{nota}</span>
            <span className="today-unlock-cta">Inserisci il PIN →</span>
          </button>
        )}
    </section>
  );
}

/**
 * Il modulo del PIN, al posto del velo.
 * @param {{ onChiudi: () => void }} props  chiude il modulo: annullato o riuscito
 *   che sia (allo scadere dello sblocco si riparte dal velo, non da qui).
 */
function PinVeil({ onChiudi }) {
  const [pin, setPin] = useState('');
  const [errore, setErrore] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  useEffect(() => { inputRef.current?.focus(); }, []);

  /** @param {import('react').FormEvent} e */
  async function invia(e) {
    e.preventDefault();
    if (!pin || inCorso) return;
    setInCorso(true);
    try {
      // sblocca() aggiorna lo stato condiviso: tutti i riquadri riservati
      // della pagina si aprono insieme, senza che questo ne sappia nulla.
      if (await verificaPin(pin)) { sblocca(); onChiudi(); }
      else { setErrore(true); setPin(''); inputRef.current?.focus(); }
    } finally {
      setInCorso(false);
    }
  }

  return (
    <form className="today-locked-veil today-pin" onSubmit={invia}>
      <input
        ref={inputRef}
        className="today-pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        placeholder="PIN"
        value={pin}
        onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setErrore(false); }}
        onKeyDown={e => { if (e.key === 'Escape') onChiudi(); }}
      />
      <div className="today-pin-actions">
        <button type="button" className="today-pin-btn" onClick={onChiudi}>Annulla</button>
        <button type="submit" className="today-pin-btn accent" disabled={!pin || inCorso}>Sblocca</button>
      </div>
      {errore && <span className="today-pin-error">PIN errato.</span>}
    </form>
  );
}
