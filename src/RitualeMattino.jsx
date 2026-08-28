// @ts-check
// Il pannello del rituale del mattino, che si apre da solo la prima volta che
// si entra in «Oggi» in una giornata.
//
// È l'unico pannello dell'app che si apre senza che nessuno lo chieda, e la
// giustificazione è tutta nel momento: movimento, meditazione e yoga si fanno
// appena svegli, e la domanda «li hai fatti?» ha una risposta certa solo la
// mattina. Chiederla a mezzogiorno vuol dire chiederla a memoria.
//
// Le tre caselle nascono despuntate, con la motivazione già scelta: la
// risposta più frequente è «no, non sono riuscito», e confermarla deve costare
// un tocco. Chi ha fatto yoga spunta una casella e chiude. Chi non ha fatto
// niente chiude e basta — ma quello che resta scritto è un no motivato, non un
// silenzio.
//
// I giorni saltati (fino a tre indietro) compaiono qui dentro già compilati
// come «non fatto», e la frase in cima lo dice chiaramente invece di lasciarlo
// scoprire: un registro che si compila da solo in silenzio è un registro di
// cui non ci si fida più.
import { useEffect, useRef, useState } from 'react';
import { saveRituale, saveMovimento, deleteMovimento } from './api';
import { FAMIGLIE, ORDINE_FAMIGLIE, fmtDurata } from './movimento';
import {
  MAX_GIORNI_SCOPERTI, MOTIVI, MOTIVO_DEFAULT, fraseScoperti, giorniScoperti, giornoPrima,
  giornoVuoto, pianoSalvataggio, statoIniziale,
} from './rituale';
import './RitualeMattino.css';

/** "gio 28 ago" — la data di un gruppo di righe. */
function fmtGiorno(/** @type {string} */ data) {
  return new Date(data + 'T00:00:00')
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '');
}

/**
 * @param {Object} props
 * @param {string} props.oggi                                             'YYYY-MM-DD'
 * @param {Record<string, import('./types').RitualeGiorno>} props.doc     il rituale già letto
 * @param {import('./types').Movimento[]} props.voci                      il registro del Movimento
 * @param {boolean} [props.auto]                                          aperto dall'app, non da un bottone
 * @param {(esito: {doc: Record<string, import('./types').RitualeGiorno>, creati: import('./types').Movimento[], cancellati: import('./types').Movimento[]}) => void} props.onSalvato
 * @param {() => void} props.onChiudi
 */
export default function RitualeMattino({ oggi, doc, voci, auto, onSalvato, onChiudi }) {
  // I giorni scoperti si calcolano una volta sola all'apertura: appena vengono
  // tappati non sono più scoperti, e ricalcolarli farebbe sparire le righe
  // sotto le dita di chi le sta correggendo.
  const [scoperti] = useState(() => giorniScoperti(doc, oggi));

  // Quali giorni sono modificabili qui dentro. Aperto da solo la mattina si
  // vede oggi e i giorni rimasti scoperti: è una domanda sulla mattina, e
  // dodici righe alle sette non le legge nessuno. Riaperto a mano si vedono
  // sempre gli ultimi tre — perché una sessione si fa anche la sera, e ci si
  // ricorda di averla fatta anche il giorno dopo.
  const [passati] = useState(() => (
    auto ? [...scoperti].reverse() : [1, 2, MAX_GIORNI_SCOPERTI].map(n => giornoPrima(oggi, n))
  ));
  const giorni = [oggi, ...passati];

  const [stato, setStato] = useState(() => {
    /** @type {Record<string, Record<string, {fatto: boolean, motivo: string, registrate: number, tipo: string, durataMin: number}>>} */
    const s = {};
    for (const g of giorni) s[g] = statoIniziale(doc, voci || [], g);
    return s;
  });
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState('');

  // Il recupero si scrive all'apertura, non al salvataggio: «se per tre giorni
  // non apro, compila non fatto» deve valere anche per chi apre la scheda e la
  // chiude senza toccare niente. Quello che si scrive qui è la stessa risposta
  // che le righe mostrano, e resta correggibile finché il pannello è aperto.
  const tappati = useRef(false);
  useEffect(() => {
    if (tappati.current || scoperti.length === 0) return;
    tappati.current = true;
    /** @type {Record<string, import('./types').RitualeGiorno>} */
    const vuoti = {};
    for (const g of scoperti) vuoti[g] = giornoVuoto(true);
    saveRituale(vuoti).catch(e => console.error('recupero rituale', e));
  }, [scoperti]);

  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) { if (e.key === 'Escape') onChiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  /** @param {string} data @param {string} famiglia @param {Partial<{fatto: boolean, motivo: string, tipo: string, durataMin: number}>} patch */
  function cambia(data, famiglia, patch) {
    setStato(s => ({
      ...s,
      [data]: { ...s[data], [famiglia]: { ...s[data][famiglia], ...patch } },
    }));
  }

  async function salva() {
    if (salvando) return;
    setSalvando(true);
    setErrore('');
    const piano = pianoSalvataggio(stato, voci || []);
    try {
      // Prima il registro, poi il rituale: se qualcosa va storto a metà, il
      // fatto è già al sicuro e la risposta si riscrive con un tocco. Al
      // contrario si perderebbe una sessione vera.
      for (const v of piano.daCreare) await saveMovimento(v);
      for (const v of piano.daCancellare) await deleteMovimento(v);
      const nuovo = await saveRituale(piano.giorni);
      onSalvato({ doc: nuovo, creati: piano.daCreare, cancellati: piano.daCancellare });
      onChiudi();
    } catch (e) {
      console.error('salva rituale', e);
      setErrore('Non sono riuscito a salvare. Riprova.');
      setSalvando(false);
    }
  }

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <div className="mq-sheet rt-sheet" onClick={e => e.stopPropagation()}>
        <div className="mq-head">
          <span className="mq-title">Il mattino</span>
          <span className="mq-date">{fmtGiorno(oggi)}</span>
        </div>

        <p className="rt-nota">
          {auto
            ? 'Movimento, meditazione e yoga: com’è andata stamattina. Le caselle partono da «non ho fatto» — spunta quello che invece hai fatto, e dì cosa e per quanto.'
            : 'Spunta quello che hai fatto, con cosa e per quanto; per il resto, il motivo. Si può correggere anche più tardi, e nei giorni scorsi.'}
        </p>

        {scoperti.length > 0 && <p className="rt-recupero">{fraseScoperti(scoperti)}</p>}

        <div className="rt-giorni">
          {giorni.map(g => (
            <div className="rt-giorno" key={g}>
              <span className="rt-giorno-titolo">
                {g === oggi
                  ? 'Oggi'
                  : `${fmtGiorno(g)}${scoperti.includes(g) ? ' · compilato come non fatto' : ''}`}
              </span>
              {ORDINE_FAMIGLIE.map(f => {
                const riga = stato[g][f];
                return (
                  <div className={`rt-riga${riga.fatto ? ' fatto' : ''}`} key={f}>
                    <label className="rt-casella">
                      <input
                        type="checkbox"
                        checked={riga.fatto}
                        onChange={e => cambia(g, f, { fatto: e.target.checked })}
                      />
                      <span className="rt-pt" style={{ background: FAMIGLIE[f].colore }} />
                      <span className="rt-nome">{FAMIGLIE[f].label}</span>
                    </label>

                    {/* Spuntata, la riga chiede le due cose che il registro
                        vuole sapere e che qui si davano per scontate: cosa, e
                        per quanto. Prima la casella scriveva sempre «Palestra,
                        30 minuti» — un valore inventato che poi restava lì, e
                        una sessione con dentro un dato inventato è peggio di
                        una sessione che manca. I campi compaiono solo quando
                        servono: chi risponde di no non li vede mai, e la
                        risposta più frequente resta un tocco solo.

                        Se una sessione c'è già è un fatto scritto altrove, e
                        non si corregge da qui: la riga lo dice e basta, il
                        posto per cambiarla è la scheda Movimento. */}
                    {riga.fatto ? (
                      riga.registrate > 0 ? (
                        <span className="rt-esito">
                          {riga.registrate === 1 ? 'sessione registrata' : `${riga.registrate} sessioni registrate`}
                        </span>
                      ) : (
                        <div className="rt-campi">
                          <select
                            className="rt-tipo"
                            value={riga.tipo}
                            onChange={e => cambia(g, f, { tipo: e.target.value })}
                            aria-label={`Cosa hai fatto — ${FAMIGLIE[f].label.toLowerCase()}`}>
                            {FAMIGLIE[f].tipi.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <select
                            className="rt-durata"
                            value={riga.durataMin}
                            onChange={e => cambia(g, f, { durataMin: Number(e.target.value) })}
                            aria-label={`Per quanto tempo — ${FAMIGLIE[f].label.toLowerCase()}`}>
                            {FAMIGLIE[f].durate.map(d => <option key={d} value={d}>{fmtDurata(d)}</option>)}
                          </select>
                        </div>
                      )
                    ) : (
                      <select
                        className="rt-motivo"
                        value={riga.motivo || MOTIVO_DEFAULT}
                        onChange={e => cambia(g, f, { motivo: e.target.value })}
                        aria-label={`Perché non hai fatto ${FAMIGLIE[f].label.toLowerCase()}`}>
                        {MOTIVI.map(m => (
                          <option key={m.chiave} value={m.chiave}>{m.etichetta}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {errore && <p className="rt-errore">{errore}</p>}

        <div className="mq-actions">
          <button type="button" className="mq-annulla" onClick={onChiudi}>Più tardi</button>
          <button type="button" className="mq-salva" onClick={salva} disabled={salvando}>
            {salvando ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
