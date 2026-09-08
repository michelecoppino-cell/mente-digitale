// @ts-check
// Le voci nuove, in due modi che portano allo stesso posto.
//
// Prima ce n'era uno solo: una casella di testo e la sintassi
// `pacchetto | titolo | ore | risorsa`. È il modo giusto per **duecento** voci
// copiate da un Excel — senza, il caricamento iniziale ferma tutto alla seconda
// commessa — ed è il modo sbagliato per **una**: alla prima voce nessuno ha
// voglia di imparare dove vanno le barre verticali, e il risultato è che la
// prima riga non la scrive nessuno.
//
// Quindi due schede sopra la stessa funzione: quattro campi separati, e la
// casella da incollare. Il modello legge il testo (`leggiRigheVoci`) e crea le
// voci (`conVociDaRighe`) in due funzioni distinte apposta, così i due modi
// non sono due implementazioni che col tempo raccontano cose diverse.
//
// Vale anche per la **scomposizione**, che è lo stesso gesto con due colonne in
// meno: `semplice` toglie pacchetto e risorsa, perché una figlia sta nel
// pacchetto della madre e la persona si decide attivando.
import { useMemo, useState } from 'react';
import { leggiRigheVoci } from '../programma.js';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').RigaVoce} RigaVoce */

/** Una riga vuota. @returns {RigaVoce} */
const rigaVuota = () => ({ pacchetto: '', titolo: '', ore: 0, risorsa: '' });

/** Le ore battute come vengono in mente. @param {string} v */
const oreDaTesto = v => Math.max(0, Number(String(v).replace(',', '.').replace(/[^\d.]/g, '')) || 0);

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string|null} props.pacchettoScelto  il pacchetto per le righe che non lo dicono
 * @param {boolean} [props.semplice]           la scomposizione: solo titolo e ore
 * @param {string} [props.titolo]
 * @param {string} [props.etichetta]           il testo del bottone
 * @param {(righe: RigaVoce[]) => Promise<void>|void} props.onAggiungi
 */
export default function NuoveVoci({
  doc, pacchettoScelto, semplice = false, titolo = 'Voci nuove', etichetta = 'Aggiungi', onAggiungi,
}) {
  const [modo, setModo] = useState(/** @type {'campi'|'incolla'} */ ('campi'));
  const [righe, setRighe] = useState(/** @type {RigaVoce[]} */ ([rigaVuota()]));
  const [testo, setTesto] = useState('');
  const [inCorso, setInCorso] = useState(false);

  const nomePacchetto = doc.pacchetti.find(p => p.id === pacchettoScelto)?.nome || '';

  // Le righe pronte: quelle con un titolo. Le altre sono la riga in fondo
  // ancora vuota, che deve poter restare lì senza essere un errore.
  const daiCampi = righe.filter(r => r.titolo.trim());
  const dalTesto = useMemo(() => leggiRigheVoci(testo, { semplice }), [testo, semplice]);
  const pronte = modo === 'campi' ? daiCampi : dalTesto.righe;
  const ore = pronte.reduce((s, r) => s + r.ore, 0);

  // I pacchetti nominati e non ancora esistenti nascono aggiungendo: vederli
  // prima è la differenza fra una convenzione e un pasticcio da ripulire.
  const pacchettiNuovi = useMemo(() => {
    if (semplice) return [];
    const noti = new Set(doc.pacchetti.map(p => p.nome.toLowerCase()));
    /** @type {string[]} */
    const nuovi = [];
    for (const r of pronte) {
      const nome = (r.pacchetto || '').trim();
      if (!nome || noti.has(nome.toLowerCase())) continue;
      noti.add(nome.toLowerCase());
      nuovi.push(nome);
    }
    return nuovi;
  }, [pronte, doc.pacchetti, semplice]);

  /** @param {number} i @param {Partial<RigaVoce>} patch */
  function cambia(i, patch) {
    setRighe(prec => {
      const x = prec.map((r, j) => (j === i ? { ...r, ...patch } : r));
      // La riga in fondo si aggiunge da sola appena si scrive nell'ultima: si
      // battono dieci voci senza mai staccare le mani dalla tastiera.
      if (i === x.length - 1 && x[i].titolo.trim()) x.push(rigaVuota());
      return x;
    });
  }

  async function conferma() {
    if (!pronte.length || inCorso) return;
    setInCorso(true);
    try {
      await onAggiungi(pronte);
      setRighe([rigaVuota()]);
      setTesto('');
    } finally {
      setInCorso(false);
    }
  }

  return (
    <div className="pg-nuove">
      <div className="pg-nuove-testa">
        <span className="eyebrow">{titolo}</span>
        <span className="pg-filtri-sp" />
        <button
          type="button"
          className={`pg-filtro pg-filtro-bottone${modo === 'campi' ? ' attivo' : ''}`}
          onClick={() => setModo('campi')}
        >
          a campi
        </button>
        <button
          type="button"
          className={`pg-filtro pg-filtro-bottone${modo === 'incolla' ? ' attivo' : ''}`}
          onClick={() => setModo('incolla')}
        >
          incolla un elenco
        </button>
      </div>

      {modo === 'campi' ? (
        <div className="pg-righe">
          <div className="pg-riga-campi pg-riga-campi-testa">
            {!semplice && <span className="pg-campo-etichetta pg-c-pacchetto">pacchetto</span>}
            <span className="pg-campo-etichetta pg-c-titolo">titolo</span>
            <span className="pg-campo-etichetta pg-c-ore">ore</span>
            {!semplice && <span className="pg-campo-etichetta pg-c-risorsa">risorsa</span>}
          </div>
          {righe.map((r, i) => (
            <div className="pg-riga-campi" key={i}>
              {!semplice && (
                <input
                  className="pg-campo pg-c-pacchetto"
                  list="pg-pacchetti"
                  value={r.pacchetto}
                  placeholder={nomePacchetto || 'nessuno'}
                  onChange={e => cambia(i, { pacchetto: e.target.value })}
                />
              )}
              <input
                className="pg-campo pg-c-titolo"
                value={r.titolo}
                placeholder={semplice ? 'Plinti P1-P4' : 'Calcolo plinti P5-P8'}
                onChange={e => cambia(i, { titolo: e.target.value })}
              />
              <input
                className="pg-campo pg-c-ore"
                inputMode="decimal"
                value={r.ore || ''}
                placeholder="0"
                onChange={e => cambia(i, { ore: oreDaTesto(e.target.value) })}
              />
              {!semplice && (
                <input
                  className="pg-campo pg-c-risorsa"
                  list="pg-risorse"
                  value={r.risorsa}
                  placeholder="a chi"
                  onChange={e => cambia(i, { risorsa: e.target.value })}
                />
              )}
            </div>
          ))}
          {/* Le tendine native: suggeriscono senza impedire un nome nuovo, che
              è esattamente il comportamento voluto — un pacchetto o una persona
              in più nascono scrivendoli. */}
          <datalist id="pg-pacchetti">
            {doc.pacchetti.map(p => <option key={p.id} value={p.nome} />)}
          </datalist>
          <datalist id="pg-risorse">
            {doc.risorse.map(r => <option key={r.nome} value={r.nome} />)}
          </datalist>
        </div>
      ) : (
        <>
          <textarea
            className="pg-incolla-campo"
            rows={4}
            value={testo}
            placeholder={semplice ? 'Plinti P1-P4 | 80\nPlatea | 120' : 'A60 Fondazioni | Calcolo plinti P5-P8 | 60 | Marco'}
            onChange={e => setTesto(e.target.value)}
          />
          <span className="pg-incolla-sintassi">
            {semplice
              ? 'titolo | ore — una riga per voce'
              : 'pacchetto | titolo | ore | risorsa — una riga per voce, anche solo il titolo'}
          </span>
        </>
      )}

      <div className="pg-incolla-piede">
        <span className="pg-incolla-conto">
          {pronte.length
            ? `${pronte.length} ${pronte.length === 1 ? 'voce' : 'voci'} · ${oreBrevi(ore) || 0} h`
            : 'niente da aggiungere'}
          {pacchettiNuovi.length > 0 && ` · ${pacchettiNuovi.length} pacchetti nuovi: ${pacchettiNuovi.join(', ')}`}
          {modo === 'incolla' && dalTesto.scartate.length > 0 && ` · ${dalTesto.scartate.length} righe senza titolo, saltate`}
        </span>
        <span className="pg-filtri-sp" />
        <button
          type="button"
          className="pg-btn pg-btn-accento"
          disabled={!pronte.length || inCorso}
          onClick={conferma}
        >
          {etichetta} {pronte.length || ''}
        </button>
      </div>
    </div>
  );
}
