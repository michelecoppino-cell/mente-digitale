// @ts-check
// «Cambia gli obiettivi»: il modulo che scrive obiettivi.json.
//
// Il riquadro in «Oggi» è di sola lettura, come tutta la scheda. Questo è
// l'unico punto in cui si scrive, e ci si arriva da lì — non da una sezione
// nuova nel rail: gli obiettivi si toccano il primo del mese e poi quasi mai,
// e una voce di menù che si usa dodici volte l'anno è una voce di menù che
// occupa spazio trecentocinquanta giorni su trecentosessantacinque.
//
// La riga più importante è quella in fondo: **ricopia dal mese scorso**. Senza,
// «Palestra 12 volte» va riscritto dodici volte l'anno, e alla terza non lo si
// riscrive più — il mese comincia vuoto e il riquadro resta muto per trentuno
// giorni. Con quella riga, cominciare un mese costa un tocco.
import { useEffect, useState } from 'react';
import { loadObiettivi, saveObiettivi } from './api';
import {
  FONTI, MAX_OBIETTIVI, ORDINE_FONTI, meseDi, nuovoObiettivo, obiettiviDelMese, ricopia,
} from './obiettivi';
import './TodayModals.css';

/** Il mese precedente a 'YYYY-MM'. */
function mesePrecedente(/** @type {string} */ ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "agosto 2026" */
function nomeMese(/** @type {string} */ ym) {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

/**
 * @param {Object} props
 * @param {string} props.oggi                  'YYYY-MM-DD'
 * @param {import('./types').VoceCoda[]} props.coda  per collegare un obiettivo a una lettura
 * @param {(doc: Record<string, import('./types').Obiettivo[]>) => void} props.onSalvato
 * @param {() => void} props.onChiudi
 */
export default function ObiettiviModal({ oggi, coda, onSalvato, onChiudi }) {
  const ym = meseDi(oggi);
  const [doc, setDoc] = useState(/** @type {Record<string, import('./types').Obiettivo[]>|null} */ (null));
  const [righe, setRighe] = useState(/** @type {import('./types').Obiettivo[]} */ ([]));
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState('');

  // Si rilegge il file invece di riusare la copia che «Oggi» ha già: qui si
  // scrive, e scrivere sopra una copia vecchia di mezz'ora — o di un'altra
  // scheda aperta sul telefono — cancella quello che c'è dentro senza dirlo.
  useEffect(() => {
    let annullato = false;
    loadObiettivi()
      .then(d => {
        if (annullato) return;
        setDoc(d);
        setRighe(obiettiviDelMese(d, ym));
      })
      .catch(e => {
        console.error('obiettivi', e);
        if (!annullato) { setDoc({}); setErrore('Non sono riuscito a leggere gli obiettivi.'); }
      });
    return () => { annullato = true; };
  }, [ym]);

  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) { if (e.key === 'Escape') onChiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  /** @param {string} id @param {Partial<import('./types').Obiettivo>} patch */
  function cambia(id, patch) {
    setRighe(r => r.map(o => (o.id === id ? { ...o, ...patch } : o)));
  }

  /** La fonte scelta nella tendina: '' = a mano. */
  function cambiaFonte(/** @type {string} */ id, /** @type {string} */ fonte) {
    setRighe(r => r.map(o => {
      if (o.id !== id) return o;
      if (!fonte) {
        const { fonte: _via, ...resto } = o;
        return { ...resto, fatti: o.fatti ?? 0 };
      }
      const { fatti: _viaFatti, ...resto } = o;
      return { ...resto, fonte };
    }));
  }

  async function salva() {
    if (salvando) return;
    setSalvando(true);
    setErrore('');
    // Le righe senza titolo si buttano invece di rifiutare il salvataggio: una
    // riga aggiunta e lasciata vuota è un ripensamento, non un errore.
    const pulite = righe
      .filter(o => o.titolo.trim())
      .map(o => ({ ...o, titolo: o.titolo.trim(), totale: Math.max(1, Math.round(o.totale || 1)) }));
    const nuovo = { ...(doc || {}), [ym]: pulite };
    try {
      await saveObiettivi(nuovo);
      onSalvato(nuovo);
      onChiudi();
    } catch (e) {
      console.error('salva obiettivi', e);
      setErrore('Non sono riuscito a salvare. Riprova.');
    } finally {
      setSalvando(false);
    }
  }

  const precedenti = obiettiviDelMese(doc, mesePrecedente(ym));

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <div className="mq-sheet tm-sheet" onClick={e => e.stopPropagation()}>
        <div className="mq-head">
          <span className="mq-title">Obiettivi di {nomeMese(ym)}</span>
        </div>

        <p className="tm-nota">
          Da tre a sei, liberi: di lavoro o di vita, come viene. Quello che l'app
          già conta — sessioni, giorni di diario, pagine di un libro — non si
          scrive a mano: si sceglie la fonte, e il numero si aggiorna da solo.
        </p>

        {doc === null && <p className="tm-vuoto">Carico…</p>}

        {doc !== null && (
          <div className="tm-lista">
            {righe.length === 0 && <p className="tm-vuoto">Nessun obiettivo per questo mese.</p>}
            {righe.map(o => (
              <div className="tm-riga" key={o.id}>
                <input
                  className="tm-titolo"
                  placeholder="Che cosa, entro fine mese"
                  value={o.titolo}
                  onChange={e => cambia(o.id, { titolo: e.target.value })}
                />
                <div className="tm-campi">
                  <select
                    className="tm-select"
                    value={o.fonte || ''}
                    onChange={e => cambiaFonte(o.id, e.target.value)}>
                    <option value="">Conto io</option>
                    {ORDINE_FONTI.map(f => (
                      <option key={f} value={f}>{FONTI[f].etichetta}</option>
                    ))}
                    {coda.filter(v => v.avanzamento?.totale).map(v => (
                      <option key={v.id} value={`lettura:${v.id}`}>Lettura · {v.titolo}</option>
                    ))}
                  </select>
                  {!o.fonte && (
                    <label className="tm-num">
                      <span>fatti</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={o.fatti ?? 0}
                        onChange={e => cambia(o.id, { fatti: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                  )}
                  <label className="tm-num">
                    <span>su</span>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={o.totale}
                      onChange={e => cambia(o.id, { totale: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </label>
                  <button
                    className="tm-togli"
                    onClick={() => setRighe(r => r.filter(x => x.id !== o.id))}
                    aria-label="Togli questo obiettivo">×</button>
                </div>
              </div>
            ))}

            <div className="tm-azioni-lista">
              {righe.length < MAX_OBIETTIVI && (
                <button
                  className="tm-aggiungi"
                  onClick={() => setRighe(r => [...r, nuovoObiettivo({ ym })])}>
                  + Aggiungi un obiettivo
                </button>
              )}
              {righe.length === 0 && precedenti.length > 0 && (
                <button
                  className="tm-aggiungi"
                  onClick={() => setRighe(ricopia(precedenti, ym))}>
                  ↻ Ricopia i {precedenti.length} del mese scorso
                </button>
              )}
            </div>
          </div>
        )}

        {errore && <p className="tm-errore">{errore}</p>}

        <div className="mq-actions">
          <button className="mq-annulla" onClick={onChiudi}>Annulla</button>
          <button className="mq-salva" onClick={salva} disabled={doc === null || salvando}>
            {salvando ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
