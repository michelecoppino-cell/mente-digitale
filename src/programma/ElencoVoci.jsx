// @ts-check
// L'elenco delle voci: la seconda scheda, non una colonna.
//
// A tutta larghezza perché è il posto in cui si legge tutto il programma e si
// selezionano dieci voci per attivarle insieme — che è il gesto vero del lunedì
// mattina, non un extra.
//
// Lo **stato derivato** si legge prima del titolo, e si legge per forma e per
// parola: un bordo a sinistra e una parola scritta. Non per colore soltanto —
// la differenza fra una voce prevista, una attiva e una fatta è la prima cosa
// che si guarda, e non deve dipendere da come uno vede i colori.
import { useMemo, useState } from 'react';
import {
  alberoVoci, statoVoce, eFoglia, oreCarico, ETICHETTE_STATO,
} from '../programma.js';
import { STATUS_LABELS } from '../taskModel.js';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').Voce} Voce */

/**
 * Cosa sta succedendo al task che la voce ha generato, letto dal pool. Dopo
 * l'attivazione il Programma **racconta**: lo stato vero sta nell'attività, e
 * qui se ne mostra il riflesso.
 * @param {Voce} voce
 * @param {import('../taskStore.js').Task[]} attivita
 * @returns {string}
 */
function raccontoDelTask(voce, attivita) {
  const task = attivita.find(t => t.id === voce.taskId);
  if (!task) return 'attiva';
  if (task.stato === 'delegated' && task.persona) return `delegata a ${task.persona}`;
  if (task.stato === 'waiting' && task.persona) return `in attesa da ${task.persona}`;
  return String(STATUS_LABELS[task.stato] || 'attiva').toLowerCase();
}

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {import('../taskStore.js').Task[]} props.attivita
 * @param {boolean} props.poolPronto
 * @param {string|null} props.voceScelta
 * @param {string|null} props.pacchettoScelto
 * @param {string[]} props.selezione
 * @param {(ids: string[]) => void} props.onSelezione
 * @param {(id: string) => void} props.onScegli
 * @param {() => void} props.onAttivaBlocco
 * @param {boolean} [props.soloScoperte]  arrivando dal «da collocare» della testata
 * @param {import('react').ReactNode} [props.incolla]
 */
export default function ElencoVoci({
  doc, attivita, poolPronto, voceScelta, pacchettoScelto, selezione,
  onSelezione, onScegli, onAttivaBlocco, soloScoperte = false, incolla,
}) {
  const [filtroPacchetto, setFiltroPacchetto] = useState(/** @type {string} */ (pacchettoScelto || ''));
  const [filtroRisorsa, setFiltroRisorsa] = useState('');
  const [filtroStato, setFiltroStato] = useState('');
  const [scoperte, setScoperte] = useState(soloScoperte);
  const [conScartate, setConScartate] = useState(false);

  const aperte = useMemo(() => new Set(attivita.map(t => t.id)), [attivita]);

  // Le ore a piano voce per voce non esistono: il carico è per pacchetto. «Senza
  // ore a piano» è quindi la voce di un pacchetto che non ha nessuna cella —
  // ed è la domanda vera: quale lavoro non è ancora in nessuna settimana.
  const pacchettiScoperti = useMemo(() => new Set(
    doc.pacchetti.filter(p => oreCarico(doc, { pacchettoId: p.id }) === 0).map(p => p.id),
  ), [doc]);

  const fila = alberoVoci(doc, v => {
    const stato = statoVoce(v, aperte, poolPronto);
    if (stato === 'scartata' && !conScartate) return false;
    if (filtroPacchetto && v.pacchettoId !== filtroPacchetto) return false;
    if (filtroRisorsa && v.risorsa !== filtroRisorsa) return false;
    if (filtroStato && stato !== filtroStato) return false;
    if (scoperte && !(v.pacchettoId && pacchettiScoperti.has(v.pacchettoId))) return false;
    return true;
  });

  /** @param {string} id @param {boolean} conShift */
  function spunta(id, conShift) {
    if (conShift && selezione.length) {
      // Da dove si era all'ultima spunta fino a qui: è così che si prendono
      // dieci voci di fila senza dieci click.
      const ids = fila.map(f => f.voce.id);
      const da = ids.indexOf(selezione[selezione.length - 1]);
      const a = ids.indexOf(id);
      if (da >= 0 && a >= 0) {
        const fetta = ids.slice(Math.min(da, a), Math.max(da, a) + 1);
        onSelezione([...new Set([...selezione, ...fetta])]);
        return;
      }
    }
    onSelezione(selezione.includes(id) ? selezione.filter(x => x !== id) : [...selezione, id]);
  }

  return (
    <div className="pg-voci">
      <div className="pg-filtri">
        <select className="pg-filtro" value={filtroPacchetto} onChange={e => setFiltroPacchetto(e.target.value)}>
          <option value="">pacchetto: tutti</option>
          {doc.pacchetti.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select className="pg-filtro" value={filtroRisorsa} onChange={e => setFiltroRisorsa(e.target.value)}>
          <option value="">risorsa: tutte</option>
          {doc.risorse.map(r => <option key={r.nome} value={r.nome}>{r.nome}</option>)}
        </select>
        <select className="pg-filtro" value={filtroStato} onChange={e => setFiltroStato(e.target.value)}>
          <option value="">stato: tutti</option>
          {Object.entries(ETICHETTE_STATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button
          type="button"
          className={`pg-filtro pg-filtro-bottone${scoperte ? ' attivo' : ''}`}
          onClick={() => setScoperte(v => !v)}
        >
          senza ore a piano
        </button>
        <button
          type="button"
          className={`pg-filtro pg-filtro-bottone${conScartate ? ' attivo' : ''}`}
          onClick={() => setConScartate(v => !v)}
        >
          anche le scartate
        </button>
        <span className="pg-filtri-sp" />
        {selezione.length > 0 && (
          <>
            <span className="pg-selezionate">{selezione.length} selezionate</span>
            <button type="button" className="pg-btn pg-btn-accento" onClick={onAttivaBlocco}>Attiva in blocco</button>
          </>
        )}
      </div>

      <div className="pg-voci-elenco">
        {fila.length === 0 && (
          <p className="pg-empty">Nessuna voce con questi filtri. Le voci si scrivono qui sotto, anche cento alla volta.</p>
        )}
        {fila.map(({ voce, livello }) => {
          const stato = statoVoce(voce, aperte, poolPronto);
          const contenitore = !eFoglia(doc, voce.id);
          const delta = voce.ore - voce.oreIniziali;
          return (
            <div
              key={voce.id}
              className={`pg-voce pg-voce-${stato}${voceScelta === voce.id ? ' scelta' : ''}`}
              style={{ paddingLeft: `calc(var(--sp-4) + ${livello * 18}px)` }}
              onClick={() => onScegli(voce.id)}
            >
              <input
                type="checkbox"
                className="pg-spunta"
                checked={selezione.includes(voce.id)}
                onClick={e => { e.stopPropagation(); spunta(voce.id, /** @type {any} */ (e).shiftKey); }}
                onChange={() => {}}
              />
              <span className="pg-voce-segno">{stato === 'fatta' ? '✓' : (stato === 'attiva' ? '⟶' : '')}</span>
              <span className="pg-voce-titolo">{voce.titolo}</span>
              <span className="pg-voce-risorsa">{voce.risorsa || '—'}</span>
              <span className={`pg-voce-ore${contenitore ? ' pg-voce-somma' : ''}`}>{oreBrevi(voce.ore)}</span>
              <span className={`pg-voce-delta${delta > 0 ? ' su' : ''}`}>
                {contenitore && delta ? `${delta > 0 ? '▲+' : '▼−'}${Math.abs(delta)}` : ''}
              </span>
              <span className="pg-voce-stato">
                {contenitore
                  ? `${doc.voci.filter(v => v.padreId === voce.id).length} voci`
                  : (stato === 'attiva' ? raccontoDelTask(voce, attivita) : ETICHETTE_STATO[stato])}
              </span>
            </div>
          );
        })}
      </div>

      {incolla}
    </div>
  );
}
