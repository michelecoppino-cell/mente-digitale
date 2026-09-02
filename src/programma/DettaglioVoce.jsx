// @ts-check
// La colonna di destra: una voce di programma per intero.
//
// Prima di tutto lo **stato derivato**, come pastiglia in cima: la differenza
// fra una voce prevista, una attiva e una fatta è la prima cosa che si legge,
// e non è un campo salvato — si ricava da `taskId` e dal pool.
//
// In fondo due gesti soli, Scomponi e Attiva, e nient'altro. Se la voce ha già
// generato un'attività, «Attiva…» lascia il posto al collegamento a quella
// attività: da lì in poi il Programma **racconta** e non comanda.
import { useState } from 'react';
import { eFoglia, ETICHETTE_STATO, figlieDi, scomponiTesto } from '../programma.js';
import { GRANULARITY_MEMO_LINE, STATUS_LABELS } from '../taskModel.js';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').Voce} Voce */

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {Voce} props.voce
 * @param {'prevista'|'attiva'|'fatta'|'scartata'} props.stato
 * @param {import('../taskStore.js').Task|null} props.task   l'attività generata, se è ancora aperta
 * @param {string[]} props.settimane
 * @param {(patch: Partial<Voce>) => void} props.onPatch
 * @param {(figlie: { titolo: string, ore: number }[]) => void} props.onScomponi
 * @param {() => void} props.onChiudi
 * @param {() => void} props.onApriAttiva
 * @param {(task: import('../taskStore.js').Task) => void} props.onApriAttivita
 * @param {import('react').ReactNode} [props.attiva]  il modulo di attivazione, quando è aperto
 */
export default function DettaglioVoce({
  doc, voce, stato, task, settimane, onPatch, onScomponi, onChiudi, onApriAttiva, onApriAttivita, attiva,
}) {
  const [titolo, setTitolo] = useState(voce.titolo);
  const [nota, setNota] = useState(voce.nota);
  const [scomposizione, setScomposizione] = useState(/** @type {string|null} */ (null));
  const contenitore = !eFoglia(doc, voce.id);
  const figlie = figlieDi(doc, voce.id);

  // Cambiando voce il componente si rimonta — la vista gli passa `key={voce.id}`
  // — e i campi in bozza ripartono da quella nuova. Tenerli in pari con un
  // effetto vorrebbe dire una riga di stato scritta durante il render, e nel
  // frattempo si scriverebbe il titolo di una voce dentro un'altra.

  const righeNuove = scomposizione === null ? [] : scomponiTesto(scomposizione);
  const sommaNuove = righeNuove.reduce((s, r) => s + r.ore, 0);

  return (
    <aside className="pg-dettaglio">
      <div className="pg-col-head">
        <span className="eyebrow eyebrow-accent">Voce di programma</span>
        <button type="button" className="pg-chiudi" onClick={onChiudi} aria-label="Chiudi il dettaglio">✕</button>
      </div>

      <div className="pg-dettaglio-corpo">
        <div>
          <span className={`pg-pastiglia pg-pastiglia-${stato}`}>{ETICHETTE_STATO[stato]}</span>
          <input
            className="pg-titolo-campo"
            value={titolo}
            onChange={e => setTitolo(e.target.value)}
            onBlur={() => titolo !== voce.titolo && onPatch({ titolo })}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          {task && (
            <div className="pg-dettaglio-meta">
              {task.persona ? `delegata a ${task.persona}` : String(STATUS_LABELS[task.stato] || '').toLowerCase()}
              {task.scadenza ? ` · scade il ${task.scadenza.slice(8)}/${task.scadenza.slice(5, 7)}` : ''}
            </div>
          )}
        </div>

        <div className="pg-scheda-dati">
          <span className="pg-scheda-et">pacchetto</span>
          <select
            className="pg-campo pg-campo-nudo"
            value={voce.pacchettoId || ''}
            onChange={e => onPatch({ pacchettoId: e.target.value || null })}
          >
            <option value="">—</option>
            {doc.pacchetti.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>

          <span className="pg-scheda-et">ore</span>
          {contenitore ? (
            <span className="pg-scheda-somma" title="La somma delle figlie: non si scrive a mano">
              {oreBrevi(voce.ore)} · {figlie.length} voci
            </span>
          ) : (
            <input
              className="pg-campo pg-campo-nudo"
              defaultValue={oreBrevi(voce.ore)}
              key={`ore-${voce.id}-${voce.ore}`}
              onBlur={e => {
                const n = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(n) && n !== voce.ore) onPatch({ ore: Math.max(0, n) });
              }}
            />
          )}

          <span className="pg-scheda-et">iniziali</span>
          <span className="pg-scheda-fisso">
            {oreBrevi(voce.oreIniziali)}
            {voce.ore !== voce.oreIniziali && (
              <span className={`pg-voce-delta${voce.ore > voce.oreIniziali ? ' su' : ''}`}>
                {' '}{voce.ore > voce.oreIniziali ? '▲+' : '▼−'}{Math.abs(voce.ore - voce.oreIniziali)}
              </span>
            )}
          </span>

          <span className="pg-scheda-et">risorsa</span>
          <input
            className="pg-campo pg-campo-nudo"
            defaultValue={voce.risorsa || ''}
            key={`ris-${voce.id}`}
            placeholder="—"
            onBlur={e => onPatch({ risorsa: e.target.value.trim() || null })}
          />

          <span className="pg-scheda-et">finestra</span>
          <span className="pg-finestra">
            <select
              className="pg-campo pg-campo-nudo"
              value={voce.finestra?.da || ''}
              onChange={e => onPatch({
                finestra: e.target.value
                  ? { da: e.target.value, a: voce.finestra?.a && voce.finestra.a >= e.target.value ? voce.finestra.a : e.target.value }
                  : null,
              })}
            >
              <option value="">—</option>
              {settimane.map(w => <option key={w} value={w}>W{w.slice(6)}</option>)}
            </select>
            <span className="pg-freccia">→</span>
            <select
              className="pg-campo pg-campo-nudo"
              value={voce.finestra?.a || ''}
              disabled={!voce.finestra?.da}
              onChange={e => voce.finestra?.da && onPatch({ finestra: { da: voce.finestra.da, a: e.target.value } })}
            >
              <option value="">—</option>
              {settimane.map(w => <option key={w} value={w}>W{w.slice(6)}</option>)}
            </select>
          </span>
        </div>

        <div>
          <div className="eyebrow">note</div>
          <textarea
            className="pg-nota"
            rows={3}
            value={nota}
            onChange={e => setNota(e.target.value)}
            onBlur={() => nota !== voce.nota && onPatch({ nota })}
          />
        </div>

        <div className="pg-dettaglio-azioni">
          <div className="pg-due-bottoni">
            <button
              type="button"
              className="pg-btn"
              onClick={() => setScomposizione(s => (s === null ? '' : null))}
            >
              Scomponi
            </button>
            {stato === 'attiva' && task ? (
              <button type="button" className="pg-btn pg-btn-accento" onClick={() => onApriAttivita(task)}>
                Apri l&apos;attività ›
              </button>
            ) : (
              !contenitore && stato !== 'fatta' && (
                <button type="button" className="pg-btn pg-btn-accento" onClick={onApriAttiva}>Attiva…</button>
              )
            )}
          </div>
          {contenitore && <p className="pg-memo">Un contenitore non si attiva: si attivano le sue figlie, una alla volta.</p>}
          <p className="pg-memo">{GRANULARITY_MEMO_LINE}</p>
        </div>

        {scomposizione !== null && (
          <div className="pg-scomponi">
            <div className="eyebrow">Una figlia per riga</div>
            <textarea
              className="pg-incolla-campo"
              rows={4}
              autoFocus
              value={scomposizione}
              placeholder={'Plinti P1-P4 | 80\nPlatea | 120'}
              onChange={e => setScomposizione(e.target.value)}
            />
            {righeNuove.length > 0 && (
              <p className="pg-memo">
                {sommaNuove === voce.ore
                  ? `${oreBrevi(sommaNuove)} h di figlie: il padre resta a ${oreBrevi(voce.ore)} h`
                  : `${oreBrevi(sommaNuove)} h di figlie contro ${oreBrevi(voce.ore)} h — il padre passa a ${oreBrevi(sommaNuove)} h`}
              </p>
            )}
            <div className="pg-due-bottoni">
              <button type="button" className="pg-btn" onClick={() => setScomposizione(null)}>Lascia stare</button>
              <button
                type="button"
                className="pg-btn pg-btn-accento"
                disabled={!righeNuove.length}
                onClick={() => { onScomponi(righeNuove); setScomposizione(null); }}
              >
                Crea {righeNuove.length} figlie
              </button>
            </div>
          </div>
        )}

        {attiva}

        <button
          type="button"
          className="pg-scarta"
          onClick={() => onPatch({ scartata: !voce.scartata })}
        >
          {voce.scartata ? 'Rimetti in programma' : 'Scarta questa voce'}
        </button>
      </div>
    </aside>
  );
}
