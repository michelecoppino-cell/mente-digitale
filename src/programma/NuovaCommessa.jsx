// @ts-check
// Una commessa nuova: il modulo che prima era un `prompt()` del browser.
//
// Il `prompt()` chiedeva solo il nome, e una commessa col solo nome nasce
// **inutilizzabile**: senza ore vendute il margine è un numero negativo senza
// senso, e senza date la matrice mostra sedici settimane attorno a oggi invece
// della commessa. Erano tutti campi che poi non si potevano nemmeno correggere,
// perché una scheda della commessa non esisteva.
//
// Quindi i cinque campi che rendono il pannello vero stanno qui, e sono gli
// stessi che restano modificabili in Impostazioni: si compila una volta e si
// corregge quando serve, che è come vanno le commesse.
import { useState } from 'react';
import CampoSezione from './CampoSezione.jsx';
import { groupKeyForSection } from '../paraConfig.js';

/**
 * @param {object} props
 * @param {{ id: string, displayName: string }[]} props.sezioni
 * @param {() => void} [props.onCaricaSezioni]
 * @param {(dati: { nome: string, commessa: Partial<import('../programma.js').Commessa> }) => Promise<void>|void} props.onCrea
 * @param {() => void} props.onChiudi
 */
export default function NuovaCommessa({ sezioni, onCaricaSezioni, onCrea, onChiudi }) {
  const [nome, setNome] = useState('');
  const [sezione, setSezione] = useState(/** @type {{ sezione: string|null, sezioneId: string|null }} */ (
    { sezione: null, sezioneId: null }));
  const [oreVendute, setOreVendute] = useState('');
  const [inizio, setInizio] = useState('');
  const [fine, setFine] = useState('');
  const [inCorso, setInCorso] = useState(false);

  async function crea() {
    const pulito = nome.trim();
    if (!pulito || inCorso) return;
    setInCorso(true);
    try {
      await onCrea({
        nome: pulito,
        commessa: {
          // Il codice non è un campo da compilare: è il nome della sezione fino
          // al punto, cioè la stessa chiave con cui le liste si ricuciono alla
          // commessa. Scriverlo a mano si può, ma in Impostazioni.
          codice: groupKeyForSection(sezione.sezione) || '',
          oreVendute: Math.max(0, Number(String(oreVendute).replace(',', '.')) || 0),
          inizio: inizio || null,
          fine: fine || null,
          sezione: sezione.sezione,
          sezioneId: sezione.sezioneId,
        },
      });
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="pg-velo" onMouseDown={e => { if (e.target === e.currentTarget) onChiudi(); }}>
      <div className="pg-modale" onKeyDown={e => { if (e.key === 'Escape') onChiudi(); }}>
        <div className="pg-col-head">
          <span className="eyebrow eyebrow-accent">Una commessa nuova</span>
          <button type="button" className="pg-chiudi" onClick={onChiudi} aria-label="Chiudi">✕</button>
        </div>

        <div className="pg-modale-corpo">
          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">nome</span>
            <input
              className="pg-campo"
              autoFocus
              value={nome}
              placeholder="2573 · Sottopasso ferroviario"
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') crea(); }}
            />
          </label>

          <div className="pg-campo-riga">
            <span className="pg-campo-etichetta">sezione</span>
            <CampoSezione
              sezioni={sezioni}
              sezione={sezione.sezione}
              onCarica={onCaricaSezioni}
              onCambia={scelta => {
                setSezione(scelta);
                // Il nome più probabile è quello della sezione: si può ancora
                // cambiare, ma non si deve battere due volte.
                if (!nome.trim() && scelta.sezione) setNome(scelta.sezione);
              }}
            />
          </div>

          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">ore vendute</span>
            <input
              className="pg-campo"
              inputMode="decimal"
              value={oreVendute}
              placeholder="1200"
              onChange={e => setOreVendute(e.target.value)}
            />
            <span className="pg-memo">il numero contrattuale: è il metro con cui si legge tutto il resto</span>
          </label>

          <div className="pg-campo-doppio">
            <label className="pg-campo-riga">
              <span className="pg-campo-etichetta">inizio</span>
              <input type="date" className="pg-campo" value={inizio} onChange={e => setInizio(e.target.value)} />
            </label>
            <label className="pg-campo-riga">
              <span className="pg-campo-etichetta">fine</span>
              <input type="date" className="pg-campo" value={fine} onChange={e => setFine(e.target.value)} />
            </label>
          </div>
          <span className="pg-memo">
            le due date sono le colonne della matrice: senza, restano le sedici settimane attorno a oggi
          </span>

          <div className="pg-attiva-azioni">
            <button type="button" className="pg-btn pg-btn-accento" disabled={!nome.trim() || inCorso} onClick={crea}>
              Crea la commessa
            </button>
            <button type="button" className="pg-btn" onClick={onChiudi}>Lascia stare</button>
          </div>
        </div>
      </div>
    </div>
  );
}
