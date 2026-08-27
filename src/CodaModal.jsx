// @ts-check
// «Apri la coda»: il modulo che scrive coda.json — libri, serie, film, corsi,
// articoli e PDF.
//
// Come per gli obiettivi, il riquadro in «Oggi» resta di sola lettura e questo
// è l'unico punto in cui si scrive. La differenza è che qui si scrive spesso:
// un link si salva quando lo si incontra, non il primo del mese. Per questo la
// prima cosa del modulo è un campo solo, in cima, che accetta un indirizzo
// incollato e ne ricava tipo, fonte e un titolo di partenza — un incolla e un
// Invio.
//
// Il resto è una riga per voce, con tre gesti: spostarla fra coda / in corso /
// finito, aggiornarne l'avanzamento, toglierla. Sono i tre gesti che servono a
// tenere viva una coda, e il terzo conta quanto gli altri due: una coda che non
// si accorcia mai smette di essere una coda e diventa un rimprovero.
import { useEffect, useMemo, useState } from 'react';
import { loadCoda, saveCoda } from './api';
import {
  ORDINE_TIPI, TIPI, daUrl, dominio, finite, inCoda, inCorso, nuovaVoce, soloUrl,
} from './coda';
import './TodayModals.css';

const STATI = /** @type {const} */ ([
  { id: 'corso', label: 'In corso' },
  { id: 'coda', label: 'In coda' },
  { id: 'finito', label: 'Finiti' },
]);

/**
 * @param {Object} props
 * @param {(voci: import('./types').VoceCoda[]) => void} props.onSalvato
 * @param {() => void} props.onChiudi
 */
export default function CodaModal({ onSalvato, onChiudi }) {
  const [voci, setVoci] = useState(/** @type {import('./types').VoceCoda[]|null} */ (null));
  const [testo, setTesto] = useState('');
  const [tipoNuovo, setTipoNuovo] = useState('articolo');
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState('');

  // Si rilegge il file invece di riusare la copia di «Oggi»: qui si scrive, e
  // un link salvato dal telefono mezz'ora fa non deve sparire perché questa
  // scheda era aperta da prima.
  useEffect(() => {
    let annullato = false;
    loadCoda()
      .then(v => { if (!annullato) setVoci(v); })
      .catch(e => {
        console.error('coda', e);
        if (!annullato) { setVoci([]); setErrore('Non sono riuscito a leggere la coda.'); }
      });
    return () => { annullato = true; };
  }, []);

  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) { if (e.key === 'Escape') onChiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  const gruppi = useMemo(() => ({
    corso: inCorso(voci || []),
    coda: inCoda(voci || []),
    finito: finite(voci || []),
  }), [voci]);

  function aggiungi() {
    const t = testo.trim();
    if (!t) return;
    // Un indirizzo incollato si legge da solo: dominio come fonte, ultimo
    // pezzo del percorso come titolo. Tutto il resto è un titolo scritto a
    // mano, col tipo scelto accanto.
    const voce = soloUrl(t) ? daUrl(t) : nuovaVoce({ titolo: t, tipo: tipoNuovo });
    setVoci(v => [...(v || []), voce]);
    setTesto('');
  }

  /** @param {string} id @param {Partial<import('./types').VoceCoda>} patch */
  function cambia(id, patch) {
    setVoci(v => (v || []).map(x => (x.id === id ? { ...x, ...patch } : x)));
  }

  /** @param {import('./types').VoceCoda} v @param {number} fatti */
  function cambiaFatti(v, fatti) {
    const totale = v.avanzamento?.totale || 0;
    cambia(v.id, {
      avanzamento: {
        fatti: Math.max(0, Math.round(fatti || 0)),
        totale,
        unita: v.avanzamento?.unita || TIPI[/** @type {keyof typeof TIPI} */ (v.tipo)]?.unita || '',
      },
    });
  }

  /** @param {import('./types').VoceCoda} v @param {number} totale */
  function cambiaTotale(v, totale) {
    const n = Math.max(0, Math.round(totale || 0));
    if (!n) { cambia(v.id, { avanzamento: undefined }); return; }
    cambia(v.id, {
      avanzamento: {
        fatti: Math.min(v.avanzamento?.fatti || 0, n),
        totale: n,
        unita: v.avanzamento?.unita || TIPI[/** @type {keyof typeof TIPI} */ (v.tipo)]?.unita || '',
      },
    });
  }

  async function salva() {
    if (salvando || voci === null) return;
    setSalvando(true);
    setErrore('');
    const pulite = voci
      .filter((/** @type {import('./types').VoceCoda} */ v) => v.titolo.trim())
      .map((/** @type {import('./types').VoceCoda} */ v) => ({ ...v, titolo: v.titolo.trim() }));
    try {
      await saveCoda(pulite);
      onSalvato(pulite);
      onChiudi();
    } catch (e) {
      console.error('salva coda', e);
      setErrore('Non sono riuscito a salvare. Riprova.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <div className="mq-sheet tm-sheet tm-larga" onClick={e => e.stopPropagation()}>
        <div className="mq-head">
          <span className="mq-title">Da leggere e vedere</span>
        </div>

        <div className="tm-aggiunta">
          <input
            className="tm-titolo"
            placeholder="Incolla un link, o scrivi un titolo"
            value={testo}
            onChange={e => setTesto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aggiungi(); } }}
          />
          {!soloUrl(testo) && (
            <select className="tm-select" value={tipoNuovo} onChange={e => setTipoNuovo(e.target.value)}>
              {ORDINE_TIPI.map(t => <option key={t} value={t}>{TIPI[t].label}</option>)}
            </select>
          )}
          <button className="tm-aggiungi" onClick={aggiungi} disabled={!testo.trim()}>Aggiungi</button>
        </div>

        {voci === null && <p className="tm-vuoto">Carico…</p>}

        {voci !== null && (
          <div className="tm-gruppi">
            {STATI.map(s => (
              <div className="tm-gruppo" key={s.id}>
                <span className="tm-gruppo-titolo">{s.label} · {gruppi[s.id].length}</span>
                {gruppi[s.id].length === 0 && <p className="tm-vuoto">Niente qui.</p>}
                {gruppi[s.id].map(v => (
                  <div className="tm-riga" key={v.id}>
                    <input
                      className="tm-titolo"
                      value={v.titolo}
                      onChange={e => cambia(v.id, { titolo: e.target.value })}
                    />
                    <div className="tm-campi">
                      <select
                        className="tm-select"
                        value={v.tipo}
                        onChange={e => cambia(v.id, { tipo: e.target.value })}>
                        {ORDINE_TIPI.map(t => <option key={t} value={t}>{TIPI[t].label}</option>)}
                      </select>
                      <select
                        className="tm-select"
                        value={v.stato}
                        onChange={e => cambia(v.id, { stato: /** @type {any} */ (e.target.value) })}>
                        {STATI.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                      <label className="tm-num">
                        <span>a</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={v.avanzamento?.fatti ?? 0}
                          onChange={e => cambiaFatti(v, Number(e.target.value))}
                        />
                      </label>
                      <label className="tm-num">
                        <span>su</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          placeholder="—"
                          value={v.avanzamento?.totale || ''}
                          onChange={e => cambiaTotale(v, Number(e.target.value))}
                        />
                      </label>
                      {v.url
                        ? <a className="tm-fonte" href={v.url} target="_blank" rel="noreferrer">{dominio(v.url) || 'link'} ↗</a>
                        : <span className="tm-fonte">{v.fonte || ''}</span>}
                      <button
                        className="tm-togli"
                        onClick={() => setVoci(x => (x || []).filter(y => y.id !== v.id))}
                        aria-label="Togli dalla coda">×</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {errore && <p className="tm-errore">{errore}</p>}

        <div className="mq-actions">
          <button className="mq-annulla" onClick={onChiudi}>Annulla</button>
          <button className="mq-salva" onClick={salva} disabled={voci === null || salvando}>
            {salvando ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
