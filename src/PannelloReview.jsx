// @ts-check
// La campanella, per esteso: le due metà del giro quotidiano che prima
// stavano schiacciate in un elenco solo dentro `App.jsx`.
//
// ── Cosa non andava ─────────────────────────────────────────────────────────
//
// Il pannello mostrava una riga per proposta con dentro il testo modificabile,
// l'oggetto dell'email e due bottoni. Tre cose non le diceva, ed erano le
// tre che servono per decidere:
//
//  1. **perché** quella riga fosse lì. Un oggetto di email, da solo, non è un
//     motivo: chi guarda non distingue «l'ha chiesto qualcuno» da «è arrivata
//     stamattina», e senza il motivo il gesto giusto è una scommessa;
//  2. **da dove** venisse: mittente e ora stavano nel dato e non a schermo, e
//     l'originale non era raggiungibile in nessun modo;
//  3. **cosa sarebbe successo** premendo «Crea task». Si apriva il diagramma
//     GTD — sette foglie e nessuna spiegazione — e da fuori sembrava che il
//     bottone avesse fatto una cosa diversa da quella promessa.
//
// E soprattutto mancava l'altra metà. Le scadenze ricorrenti entrano da sole
// nel pool (`deadlineReminders.js`), e finché tutto va bene è la cosa giusta;
// ma quando **non** entrano — prefisso scritto male, lista rinominata, un
// anticipo troppo corto — non c'era nessun posto in cui accorgersene. Adesso
// la campanella ha due schede: «Da valutare», che chiede una decisione, e
// «Scadenze», che mostra il meccanismo automatico mentre lavora.

import { useState } from 'react';
import { ymd } from './tempo.js';

/**
 * Un giorno 'YYYY-MM-DD' come si legge in una riga stretta: «1 ott».
 * @param {string} giorno
 * @returns {string}
 */
function giornoBreve(giorno) {
  const [a, m, g] = giorno.split('-').map(Number);
  return new Date(a, m - 1, g).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/**
 * Quando è arrivata una proposta: «oggi 09:12» se è di oggi, «3 set 14:20» se
 * no. L'ora conta solo per le email di giornata — più indietro basta il giorno.
 * @param {string} iso
 * @returns {string}
 */
function quandoBreve(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return ymd(d) === ymd() ? `oggi ${ora}` : `${giornoBreve(ymd(d))} ${ora}`;
}

/** Quanto manca, detto come lo direbbe una persona. @param {number} g */
function fraQuanto(g) {
  if (g === 0) return 'oggi';
  if (g === 1) return 'domani';
  if (g < 0) return `${-g} giorni fa`;
  return `fra ${g} giorni`;
}

// Una riga della scheda «Da valutare». Senza un LLM a ripulire il testo, il
// titolo proposto (oggetto email o riga taggata «Da fare» in OneNote) resta
// modificabile prima di portarlo nel chiarimento.
/**
 * @param {{ proposta: any, onAccetta: (p: any, testo?: string) => void, onScarta: (p: any) => void }} props
 */
function RigaProposta({ proposta, onAccetta, onScarta }) {
  const [testo, setTesto] = useState(proposta.extractedAction);
  const daOneNote = proposta.source === 'onenote';
  const provenienza = [
    daOneNote ? `📓 ${proposta.title}` : `📧 ${proposta.mittente || proposta.meta || ''}`,
    quandoBreve(proposta.quando),
  ].filter(Boolean).join(' · ');

  return (
    <div className="bell-item">
      <input
        className="bell-item-input"
        value={testo}
        onChange={e => setTesto(e.target.value)}
        aria-label="Testo dell'attività da creare"
      />
      {/* I motivi prima della provenienza: è la domanda a cui si risponde per
          prima («perché me la stai mostrando?»), e finché non c'era scritto
          da nessuna parte la risposta era «non si sa». */}
      {proposta.motivi?.length > 0 && (
        <div className="bell-item-motivi">
          {proposta.motivi.map((/** @type {string} */ m) => (
            <span className="bell-motivo" key={m}>{m}</span>
          ))}
        </div>
      )}
      <div className="bell-item-meta" title={provenienza}>
        {provenienza}
        {proposta.link && (
          <> · <a href={proposta.link} target="_blank" rel="noreferrer">apri l&apos;originale</a></>
        )}
      </div>
      <div className="bell-item-actions">
        <button className="bell-accept-btn" onClick={() => onAccetta(proposta, testo)}
          title="Apre il chiarimento GTD: lì si sceglie se è un'azione e dove va">
          Chiarisci →
        </button>
        <button className="bell-dismiss-btn" onClick={() => onScarta(proposta)}
          title="Non è una cosa da fare: non me la riproporre">✕</button>
      </div>
    </div>
  );
}

// Una riga della scheda «Scadenze»: cosa c'è scritto sul calendario, quando
// scade, e — la parte che prima non si vedeva — quando diventa un'attività.
/** @param {{ scadenza: import('./types').ScadenzaInArrivo }} props */
function RigaScadenza({ scadenza }) {
  return (
    <div className="bell-scadenza">
      <div className="bell-scadenza-titolo">
        <span className={`bell-pallino${scadenza.giaEntrata ? ' entrata' : ''}`} />
        {scadenza.titolo}
      </div>
      <div className="bell-item-meta">
        {scadenza.listName} · scade il {giornoBreve(scadenza.giorno)} ({fraQuanto(scadenza.giorniAllaScadenza)})
      </div>
      <div className="bell-scadenza-stato">
        {scadenza.giaEntrata
          ? `già nel pool di ${scadenza.listName}`
          : `diventa un'attività il ${giornoBreve(scadenza.entraIl)}, ${scadenza.anticipoGiorni} giorni prima`}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {any[]} props.proposte
 * @param {boolean} props.inCorso
 * @param {import('./types').ScadenzaInArrivo[]} props.scadenze
 * @param {{ listName: string, titolo: string, giorno: string }[]} props.orfane
 * @param {(proposta: any, testo?: string) => void} props.onAccetta
 * @param {(proposta: any) => void} props.onScarta
 * @param {() => void} props.onChiudi
 */
export default function PannelloReview({ proposte, inCorso, scadenze, orfane, onAccetta, onScarta, onChiudi }) {
  // Si apre sulle proposte, tranne quando non ce ne sono e invece c'è
  // qualcosa che non va fra le scadenze: un prefisso che non aggancia nessuna
  // lista è l'unica cosa qui dentro che nessun altro schermo dirà mai.
  const [scheda, setScheda] = useState(
    !proposte.length && orfane.length ? 'scadenze' : 'proposte');

  return (
    <div className="bell-dropdown">
      <div className="bell-dropdown-header">
        <span>Revisione quotidiana</span>
        <button onClick={onChiudi} title="Chiudi">✕</button>
      </div>

      <div className="bell-schede">
        <button className={scheda === 'proposte' ? 'attiva' : ''} onClick={() => setScheda('proposte')}>
          Da valutare{proposte.length ? ` (${proposte.length})` : ''}
        </button>
        <button className={scheda === 'scadenze' ? 'attiva' : ''} onClick={() => setScheda('scadenze')}>
          Scadenze{scadenze.length ? ` (${scadenze.length})` : ''}
          {orfane.length > 0 && <span className="bell-avviso-punto" title="Qualcosa non aggancia nessuna lista">!</span>}
        </button>
      </div>

      {scheda === 'proposte' && (
        <>
          <p className="bell-spiega">
            Email e righe «Da fare» di OneNote che <em>sembrano</em> cose da fare.
            Niente entra da solo: <strong>Chiarisci</strong> apre il diagramma GTD col testo
            già dentro, e lì si decide se è un&apos;azione e in quale sezione va.
          </p>
          {inCorso && <div className="bell-empty">Analisi email e OneNote in corso…</div>}
          {!inCorso && proposte.length === 0 && (
            <div className="bell-empty">Niente da valutare. La casella e gli appunti non chiedono azioni.</div>
          )}
          {!inCorso && proposte.map(p => (
            <RigaProposta key={p.id} proposta={p} onAccetta={onAccetta} onScarta={onScarta} />
          ))}
        </>
      )}

      {scheda === 'scadenze' && (
        <>
          <p className="bell-spiega">
            Le scadenze si scrivono <strong>una volta sola</strong> sul calendario, come evento
            ricorrente intitolato <code>[NOME-LISTA +30g] Titolo</code>: l&apos;attività compare da
            sé nella lista, con la scadenza dentro, quel numero di giorni prima
            (<code>g</code> giorni, <code>s</code> settimane, <code>m</code> mesi; senza, due settimane).
          </p>
          {orfane.length > 0 && (
            <div className="bell-orfane">
              <div className="bell-orfane-titolo">⚠ Non diventeranno attività</div>
              {orfane.map(o => (
                <div className="bell-orfana" key={`${o.listName}|${o.titolo}|${o.giorno}`}>
                  <strong>{o.titolo}</strong> — nessuna lista si chiama «{o.listName}»
                  <span className="bell-item-meta"> (scade il {giornoBreve(o.giorno)})</span>
                </div>
              ))}
            </div>
          )}
          {scadenze.length === 0 && (
            <div className="bell-empty">Nessuna scadenza scritta sul calendario nei prossimi mesi.</div>
          )}
          {scadenze.map(s => <RigaScadenza key={s.origine} scadenza={s} />)}
        </>
      )}
    </div>
  );
}
