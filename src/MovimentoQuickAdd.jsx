// @ts-check
// Il modulo per registrare una sessione: tipo, durata, nota.
//
// Il vincolo che ha deciso la forma: si registra dal telefono, in piedi,
// subito dopo l'allenamento, con una mano. Il gesto deve costare meno del non
// farlo — perché il modo in cui un registro muore non è che sia sbagliato, è
// che smette di essere aggiornato. Da qui tutto il resto: nessun campo
// obbligatorio da digitare (tipo e durata sono chip da toccare), il primo
// tipo già scelto, la data già a oggi, e la nota facoltativa con sotto le
// ultime note usate — «gambe» si tocca invece di riscriverlo.
//
// Due tocchi per una meditazione da dieci minuti, quattro per «palestra 60
// gambe + core».
import { useEffect, useRef, useState } from 'react';
import { FAMIGLIE, noteRecenti, nuovaVoce } from './movimento';
import './MovimentoQuickAdd.css';

/** "ven 28 ago" — la data della sessione, detta come la direbbe una persona. */
function fmtGiorno(/** @type {string} */ data, /** @type {string} */ oggi) {
  const etichetta = new Date(data + 'T00:00:00')
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '');
  return data === oggi ? `oggi, ${etichetta}` : etichetta;
}

/**
 * @param {Object} props
 * @param {keyof typeof FAMIGLIE} props.famiglia
 * @param {string} props.data                         'YYYY-MM-DD'
 * @param {string} props.oggi
 * @param {import('./types').Movimento[]} props.voci  per suggerire le note già usate
 * @param {{ tipo?: string, durataMin?: number, daEvento?: string, titolo?: string }} [props.preset]
 *        valori dall'evento di calendario, quando si arriva da «Fatta»
 * @param {(voce: import('./types').Movimento) => Promise<void>|void} props.onSalva
 * @param {() => void} props.onChiudi
 */
export default function MovimentoQuickAdd({ famiglia, data, oggi, voci, preset, onSalva, onChiudi }) {
  const def = FAMIGLIE[famiglia];
  // Il tipo dell'evento vince sul primo della lista solo se è uno dei tipi
  // conosciuti: un evento intitolato «Palestra con Marco» non deve creare un
  // quinto tipo che poi resta lì.
  const [tipo, setTipo] = useState(() => (
    preset?.tipo && def.tipi.includes(preset.tipo) ? preset.tipo : def.tipi[0]
  ));
  const [durata, setDurata] = useState(() => preset?.durataMin || def.durate[Math.min(1, def.durate.length - 1)]);
  const [durataLibera, setDurataLibera] = useState(false);
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState('');
  const notaRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  const suggerite = noteRecenti(voci, famiglia);

  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) {
      if (e.key === 'Escape') onChiudi();
    }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  /** @param {import('react').FormEvent} e */
  async function invia(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErrore('');
    try {
      await onSalva(nuovaVoce({
        date: data,
        famiglia,
        tipo,
        durataMin: durata,
        nota,
        daEvento: preset?.daEvento || null,
      }));
      onChiudi();
    } catch (err) {
      console.error('registra movimento', err);
      // Il modulo resta aperto con tutto dentro: quello che si è appena
      // scritto non deve sparire perché OneDrive non ha risposto.
      setErrore('Non sono riuscito a salvare. Riprova.');
      setSalvando(false);
    }
  }

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <form className="mq-sheet" onClick={e => e.stopPropagation()} onSubmit={invia}>
        <div className="mq-head">
          <span className="mq-title">{def.label}</span>
          <span className="mq-date">{fmtGiorno(data, oggi)}</span>
        </div>

        {preset?.titolo && (
          <p className="mq-preset">Da «{preset.titolo}», programmata nel calendario.</p>
        )}

        <div className="mq-field">
          <span className="mq-label">Tipo</span>
          <div className="mq-chips">
            {def.tipi.map(t => (
              <button
                key={t}
                type="button"
                className={`mq-chip${t === tipo ? ' sel' : ''}`}
                onClick={() => setTipo(t)}>
                <i className="mq-pt" style={{ background: def.colore }} />
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mq-field">
          <span className="mq-label">Durata</span>
          <div className="mq-chips">
            {def.durate.map(m => (
              <button
                key={m}
                type="button"
                className={`mq-chip${!durataLibera && m === durata ? ' sel' : ''}`}
                onClick={() => { setDurata(m); setDurataLibera(false); }}>
                {m}{!durataLibera && m === durata ? ' min' : ''}
              </button>
            ))}
            <button
              type="button"
              className={`mq-chip${durataLibera ? ' sel' : ''}`}
              onClick={() => setDurataLibera(true)}>
              altro…
            </button>
            {durataLibera && (
              <input
                className="mq-min"
                type="number"
                min="1"
                max="600"
                autoFocus
                value={durata}
                onChange={e => setDurata(Number(e.target.value))}
                aria-label="Minuti" />
            )}
          </div>
        </div>

        <div className="mq-field">
          <span className="mq-label">Nota</span>
          <input
            ref={notaRef}
            className="mq-nota"
            type="text"
            placeholder={def.notaEsempio}
            value={nota}
            onChange={e => setNota(e.target.value)} />
          {suggerite.length > 0 && (
            <div className="mq-recenti">
              {suggerite.map(n => (
                <button
                  key={n}
                  type="button"
                  className="mq-tag"
                  onClick={() => { setNota(n); notaRef.current?.focus(); }}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        {errore && <span className="mq-errore">{errore}</span>}

        <div className="mq-actions">
          <button type="button" className="mq-annulla" onClick={onChiudi}>Annulla</button>
          <button type="submit" className="mq-salva" disabled={salvando || !durata}>
            {salvando ? 'Salvo…' : 'Registra'}
          </button>
        </div>
      </form>
    </div>
  );
}
