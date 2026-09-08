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
import { eFoglia, ETICHETTE_STATO, figlieDi } from '../programma.js';
import { GRANULARITY_MEMO_LINE, STATUS_LABELS } from '../taskModel.js';
import { oreBrevi } from './formato.js';
import NuoveVoci from './NuoveVoci.jsx';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').Voce} Voce */

/**
 * Il nome scritto, appoggiato a una risorsa che c'è già quando è la stessa a
 * meno di maiuscole e spazi. «gaia» e «Gaia » sono la stessa persona, e due
 * righe con lo stesso nome scritto in due modi sarebbero due righe che si
 * contendono le stesse celle. Un nome davvero nuovo resta com'è scritto: entra
 * fra le risorse della commessa.
 * @param {string} scritto
 * @param {string[]} nomi
 * @returns {string}
 */
function accostaNome(scritto, nomi) {
  const pulito = String(scritto || '').trim().replace(/\s+/g, ' ');
  if (!pulito) return '';
  return nomi.find(n => n.toLowerCase() === pulito.toLowerCase()) || pulito;
}

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
 * @param {() => void} props.onCancella   solo per una voce che non ha ancora generato niente
 * @param {() => void} props.onApriAttiva
 * @param {(task: import('../taskStore.js').Task) => void} props.onApriAttivita
 * @param {import('react').ReactNode} [props.attiva]  il modulo di attivazione, quando è aperto
 */
export default function DettaglioVoce({
  doc, voce, stato, task, settimane, onPatch, onScomponi, onChiudi, onCancella,
  onApriAttiva, onApriAttivita, attiva,
}) {
  const [titolo, setTitolo] = useState(voce.titolo);
  const [nota, setNota] = useState(voce.nota);
  const [scomponi, setScomponi] = useState(false);
  const contenitore = !eFoglia(doc, voce.id);
  const figlie = figlieDi(doc, voce.id);

  // Cambiando voce il componente si rimonta — la vista gli passa `key={voce.id}`
  // — e i campi in bozza ripartono da quella nuova. Tenerli in pari con un
  // effetto vorrebbe dire una riga di stato scritta durante il render, e nel
  // frattempo si scriverebbe il titolo di una voce dentro un'altra.

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

          <span className="pg-scheda-et pg-scheda-et-alto">risorse</span>
          {/*
            Una voce può essere di due persone: un calcolo lo fanno in due, e
            fingere che sia di uno solo obbligava a sdoppiare la voce per far
            comparire la seconda riga nella matrice. Quindi un campo per ognuna,
            e **sotto l'ultimo pieno ce n'è sempre uno vuoto**: aggiungere è
            scrivere, togliere è cancellare. Nessun bottone «+», che sarebbe un
            gesto in più per la cosa che si fa più spesso.

            I nomi vengono dall'elenco (`datalist`) e quello che si scrive si
            appoggia a una risorsa che c'è già anche se scritto in minuscolo:
            una proposta che non combacia con nessuna risorsa non farebbe
            comparire nessuna riga, e nessuno lo direbbe.
          */}
          <span className="pg-scheda-risorse">
            {[...voce.risorse, ''].map((nome, i) => (
              <input
                className="pg-campo pg-campo-nudo"
                key={`ris-${voce.id}-${i}-${nome}`}
                defaultValue={nome}
                list={`pg-persone-${voce.id}`}
                placeholder={i === 0 ? '—' : 'un\'altra'}
                onBlur={e => {
                  const scritto = accostaNome(e.target.value, doc.risorse.map(r => r.nome));
                  if (scritto === nome) { e.target.value = nome; return; }
                  const prossime = [...voce.risorse];
                  if (i < prossime.length) {
                    if (scritto) prossime[i] = scritto; else prossime.splice(i, 1);
                  } else if (scritto) {
                    prossime.push(scritto);
                  }
                  onPatch({ risorse: prossime.filter((n, k) => n && prossime.indexOf(n) === k) });
                }}
              />
            ))}
            <datalist id={`pg-persone-${voce.id}`}>
              {doc.risorse.map(r => <option key={r.nome} value={r.nome} />)}
            </datalist>
          </span>

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
            <button type="button" className="pg-btn" onClick={() => setScomponi(s => !s)}>
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

        {/* La scomposizione è lo stesso gesto delle voci nuove con due colonne in
            meno — una figlia sta nel pacchetto della madre e la persona si
            decide attivando — quindi è lo stesso componente, e i due modi di
            scrivere (campi separati o elenco incollato) valgono anche qui.
            Prima era una casella di testo sola, con la sintassi da imparare. */}
        {scomponi && (
          <div className="pg-scomponi">
            <NuoveVoci
              doc={doc}
              pacchettoScelto={voce.pacchettoId}
              semplice
              titolo="Una figlia per riga"
              etichetta="Crea"
              onAggiungi={righe => {
                onScomponi(righe.map(r => ({ titolo: r.titolo, ore: r.ore })));
                setScomponi(false);
              }}
            />
            <p className="pg-memo">
              Le ore della madre diventano la somma delle figlie: adesso {oreBrevi(voce.ore)} h.
            </p>
            <button type="button" className="pg-btn" onClick={() => setScomponi(false)}>Lascia stare</button>
          </div>
        )}

        {attiva}

        {/* Scartare e cancellare non sono la stessa cosa, e la differenza è
            quale delle due è reversibile. Una voce che ha già generato
            un'attività si **scarta**: il task esiste per conto suo, e la voce è
            l'unica cosa che sa da dove è venuto. Una voce che non ha generato
            niente si può cancellare davvero — altrimenti l'elenco si riempie di
            righe barrate scritte per sbaglio, e nessuno le può togliere. */}
        <div className="pg-scarta-riga">
          <button
            type="button"
            className="pg-scarta"
            onClick={() => onPatch({ scartata: !voce.scartata })}
          >
            {voce.scartata ? 'Rimetti in programma' : 'Scarta questa voce'}
          </button>
          {!voce.taskId && (
            <button
              type="button"
              className="pg-scarta"
              onClick={onCancella}
              title={contenitore ? 'Cancella anche le voci che ci stanno dentro' : 'La voce non ha generato nessuna attività: si cancella davvero'}
            >
              {contenitore ? `Cancella con le sue ${figlie.length} figlie` : 'Cancella'}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
