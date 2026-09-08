// @ts-check
// Attiva: il momento in cui una voce di programma **genera** un'attività vera.
//
// È l'unico gesto del Programma che tocca il resto dell'app, e ha due
// requisiti che sembrano opposti: dev'essere impossibile farlo per sbaglio, e
// velocissimo quando se ne fanno dieci di fila. Stanno insieme così: **nessun
// passaggio di conferma** — la sicurezza è l'annulla, che sta nel toast per
// otto secondi — e i tre campi arrivano già compilati, quindi dieci attivazioni
// sono dieci ⌘Invio.
//
// La lista si crea solo qui, e il suo nome si vede **prima**: un pacchetto
// nasce senza lista apposta (una commessa con dodici pacchetti non deve creare
// dodici liste vuote), e la prima attivazione è il momento in cui quella lista
// comincia a servire davvero.
import { useEffect, useMemo, useRef, useState } from 'react';
import { nomeListaProposto, scadenzaProposta } from '../programma.js';
import { elencoPersone } from '../persone.js';
import { GRANULARITY_MEMO_LINE } from '../taskModel.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').Voce} Voce */

/**
 * Il campo della risorsa: si scrive e l'elenco si stringe, come la
 * destinazione della cattura rapida. Non una `<select>`: con dieci persone e un
 * nome nuovo ogni tanto, cercare con gli occhi in un elenco piatto è il
 * passaggio più lento di tutto il gesto.
 * @param {{ valore: string, nomi: string[], onCambia: (v: string) => void, autoFocus?: boolean }} props
 */
function CampoRisorsa({ valore, nomi, onCambia, autoFocus }) {
  const [aperto, setAperto] = useState(false);
  const filtrati = useMemo(() => {
    const q = valore.trim().toLowerCase();
    return nomi.filter(n => !q || n.toLowerCase().includes(q)).slice(0, 6);
  }, [valore, nomi]);

  return (
    <div className="pg-campo-cerca">
      <input
        className="pg-campo"
        value={valore}
        autoFocus={autoFocus}
        placeholder="a chi la dai — vuoto se è tua"
        onChange={e => { onCambia(e.target.value); setAperto(true); }}
        onFocus={() => setAperto(true)}
        onBlur={() => setTimeout(() => setAperto(false), 120)}
      />
      {aperto && filtrati.length > 0 && (
        <div className="pg-suggerimenti">
          {filtrati.map(n => (
            <button
              type="button"
              key={n}
              className="pg-suggerimento"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onCambia(n); setAperto(false); }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {Voce[]} props.voci                 una, o l'intera selezione
 * @param {{ id: string, displayName: string }[]} props.todoLists
 * @param {(dati: { risorsePerVoce: Record<string, string>, scadenza: string, listId: string|null, nomeLista: string }) => Promise<void>|void} props.onCrea
 * @param {() => void} props.onChiudi
 */
export default function AttivaVoce({ doc, voci, todoLists, onCrea, onChiudi }) {
  const pacchetto = doc.pacchetti.find(p => p.id === voci[0]?.pacchettoId) || null;
  const listaDelPacchetto = pacchetto?.listId
    ? todoLists.find(l => l.id === pacchetto.listId) || null
    : null;

  const [risorse, setRisorse] = useState(/** @type {Record<string, string>} */ (
    // La prima delle proposte: un task ha un delegato solo, e se la voce è di
    // due chi attiva sceglie qui — le altre proposte restano dove sono.
    Object.fromEntries(voci.map(v => [v.id, v.risorse[0] || '']))));
  const [scadenza, setScadenza] = useState(scadenzaProposta(voci[0]));
  const [listId, setListId] = useState(/** @type {string} */ (listaDelPacchetto?.id || ''));
  const nomeProposto = nomeListaProposto(doc, pacchetto);
  const [inCorso, setInCorso] = useState(false);
  const guscio = useRef(/** @type {HTMLDivElement|null} */ (null));

  // I nomi già in casa: le risorse della commessa prima, poi le persone del
  // registro. Sono le stesse stringhe del campo `persona` di un'attività, ed è
  // il motivo per cui un task delegato e una riga della matrice parlano della
  // stessa persona senza tabelle di conversione.
  const nomi = useMemo(() => [
    ...doc.risorse.map(r => r.nome),
    ...elencoPersone().filter(n => !doc.risorse.some(r => r.nome === n)),
  ], [doc.risorse]);

  async function crea() {
    if (inCorso) return;
    setInCorso(true);
    try {
      await onCrea({ risorsePerVoce: risorse, scadenza, listId: listId || null, nomeLista: nomeProposto });
    } finally {
      setInCorso(false);
    }
  }

  useEffect(() => {
    const suTasto = (/** @type {KeyboardEvent} */ e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); crea(); }
      if (e.key === 'Escape') onChiudi();
    };
    const box = guscio.current;
    box?.addEventListener('keydown', suTasto);
    return () => box?.removeEventListener('keydown', suTasto);
  });

  return (
    <div className="pg-attiva" ref={guscio}>
      <div className="eyebrow eyebrow-accent">{voci.length > 1 ? `Attiva ${voci.length} voci` : 'Attiva la voce'}</div>

      {voci.length === 1 ? (
        <label className="pg-campo-riga">
          <span className="pg-campo-etichetta">risorsa</span>
          <CampoRisorsa
            autoFocus
            valore={risorse[voci[0].id] || ''}
            nomi={nomi}
            onCambia={v => setRisorse(r => ({ ...r, [voci[0].id]: v }))}
          />
        </label>
      ) : (
        <div className="pg-attiva-elenco">
          {voci.map(v => (
            <div key={v.id} className="pg-attiva-voce">
              <span className="pg-attiva-titolo">{v.titolo}</span>
              <CampoRisorsa
                valore={risorse[v.id] || ''}
                nomi={nomi}
                onCambia={x => setRisorse(r => ({ ...r, [v.id]: x }))}
              />
            </div>
          ))}
        </div>
      )}

      <label className="pg-campo-riga">
        <span className="pg-campo-etichetta">scadenza</span>
        <input type="date" className="pg-campo" value={scadenza} onChange={e => setScadenza(e.target.value)} />
      </label>

      <label className="pg-campo-riga">
        <span className="pg-campo-etichetta">lista</span>
        <select className="pg-campo" value={listId} onChange={e => setListId(e.target.value)}>
          <option value="">{nomeProposto} — la creo</option>
          {todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
        </select>
      </label>
      {!listId && <span className="pg-nota-accento">la lista non esiste ancora, la creo</span>}

      <div className="pg-attiva-azioni">
        <button type="button" className="pg-btn pg-btn-accento" disabled={inCorso} onClick={crea}>
          {voci.length > 1 ? `Crea ${voci.length} attività` : 'Crea l\'attività'} <span className="pg-scorciatoia">⌘⏎</span>
        </button>
        <button type="button" className="pg-btn" onClick={onChiudi}>Chiudi</button>
      </div>
      <p className="pg-memo">
        {'Chi la riceve la trova come attività delegata; senza una risorsa resta tua, in «Prossime».'}
      </p>
      <p className="pg-memo">{GRANULARITY_MEMO_LINE}</p>
    </div>
  );
}
