// @ts-check
// Il riepilogo: tutta la commessa in una tabella, e le ore già spese.
//
// Due mancanze che rendevano il pannello difficile da usare, e che hanno la
// stessa radice — si poteva guardare e compilare **un pacchetto alla volta**:
//
// - i cinque numeri della testata si leggevano scegliendo un pacchetto dalle
//   pastiglie, quindi per sapere come stava messa tutta la commessa bisognava
//   cliccarli uno per uno e sommare a mente. Qui sono una riga per pacchetto e
//   una riga di totale, che è la domanda vera del coordinatore;
// - lo speso si scriveva cella per cella all'indietro nella matrice. Ma del
//   passato non si sa la distribuzione, si sa il totale: «su A60 Marco ha fatto
//   novanta ore». Quindi un numero per pacchetto e persona, spalmato
//   all'indietro sulle settimane passate — il totale è vero, la distribuzione è
//   dichiaratamente approssimata, che è la stessa promessa dello «speso senza
//   timesheet».
import { useMemo, useState } from 'react';
import { riepilogoPacchetti, settimanePassate, spesoPerRisorsa, conSpesoRipartito } from '../programma.js';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */

/** Il margine col segno sempre scritto. @param {number} n */
const conSegno = n => `${n < 0 ? '−' : '+'}${Math.round(Math.abs(n))}`;

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string} props.settimanaOra
 * @param {string[]} props.pacchettiScelti
 * @param {(id: string) => void} props.onScegliPacchetto  accende o spegne quel pacchetto, lasciando gli altri
 * @param {(muta: (doc: DocProgramma) => DocProgramma) => void} props.onCambia
 */
export default function Riepilogo({ doc, settimanaOra, pacchettiScelti, onScegliPacchetto, onCambia }) {
  const [consuntivo, setConsuntivo] = useState(/** @type {string|null} */ (null));
  const { righe, totale } = useMemo(
    () => riepilogoPacchetti(doc, { settimanaOra }), [doc, settimanaOra]);
  const passate = useMemo(() => settimanePassate(doc, settimanaOra), [doc, settimanaOra]);

  return (
    <div className="pg-riepilogo">
      <div className="pg-riep-riga pg-riep-testa">
        <span className="pg-riep-nome">pacchetto</span>
        <span className="pg-riep-num">voci</span>
        <span className="pg-riep-num">stimate</span>
        <span className="pg-riep-num">speso</span>
        <span className="pg-riep-num">a finire</span>
        <span className="pg-riep-num">programmate</span>
        <span className="pg-riep-num">a piano</span>
        <span className="pg-riep-num">da collocare</span>
        <span className="pg-riep-azione" />
      </div>

      {righe.length === 0 && (
        <p className="pg-empty">
          Nessun pacchetto ancora. I pacchetti si creano in Impostazioni, o nascono da soli
          incollando delle voci che li nominano.
        </p>
      )}

      {righe.map(r => (
        <div key={r.pacchettoId || 'senza'}>
          <div
            className={`pg-riep-riga${r.pacchettoId && pacchettiScelti.includes(r.pacchettoId) ? ' scelta' : ''}`}
            onClick={() => { if (r.pacchettoId) onScegliPacchetto(r.pacchettoId); }}
          >
            <span className="pg-riep-nome">
              <span className="pg-punto" style={r.colore ? { background: r.colore } : undefined} />
              {r.nome}
            </span>
            <span className="pg-riep-num">{r.voci}</span>
            <span className="pg-riep-num">{oreBrevi(r.stimate)}</span>
            <span className="pg-riep-num">{oreBrevi(r.speso)}</span>
            <span className="pg-riep-num">{oreBrevi(r.aFinire)}</span>
            <span className="pg-riep-num">{oreBrevi(r.programmate)}</span>
            <span className="pg-riep-num">{oreBrevi(r.aPiano)}</span>
            {/* Il delta fra le voci e le celle: positivo è lavoro che c'è ma
                che nessuno sta facendo in nessuna settimana. È il numero da cui
                si capisce dove manca il piano. */}
            <span className={`pg-riep-num${r.daCollocare > 0 ? ' pg-riep-scoperto' : ''}`}>
              {r.daCollocare === 0 ? '—' : conSegno(r.daCollocare)}
            </span>
            <span className="pg-riep-azione">
              {r.pacchettoId && (
                <button
                  type="button"
                  className="pg-riep-link"
                  onClick={e => { e.stopPropagation(); setConsuntivo(consuntivo === r.pacchettoId ? null : r.pacchettoId); }}
                >
                  già spese
                </button>
              )}
            </span>
          </div>

          {consuntivo && consuntivo === r.pacchettoId && (
            <Consuntivo
              doc={doc}
              pacchettoId={r.pacchettoId}
              settimane={passate}
              onCambia={onCambia}
              onChiudi={() => setConsuntivo(null)}
            />
          )}
        </div>
      ))}

      <div className="pg-riep-riga pg-riep-totale">
        <span className="pg-riep-nome">tutta la commessa · {oreBrevi(totale.vendute) || 0} h vendute</span>
        <span className="pg-riep-num" />
        <span className="pg-riep-num">{oreBrevi(totale.stimate)}</span>
        <span className="pg-riep-num">{oreBrevi(totale.speso)}</span>
        <span className="pg-riep-num">{oreBrevi(totale.aFinire)}</span>
        <span className="pg-riep-num">{oreBrevi(totale.programmate)}</span>
        <span className="pg-riep-num">{oreBrevi(totale.aPiano)}</span>
        <span className={`pg-riep-num${totale.margine < 0 ? ' pg-riep-scoperto' : ''}`}>
          {conSegno(totale.margine)} margine
        </span>
        <span className="pg-riep-azione" />
      </div>

      <p className="pg-memo">
        stimate sono le ore delle voci · a piano sono le celle della matrice · i due numeri non
        devono coincidere, e il loro delta è «da collocare» · speso sono le celle prima di
        questa settimana, programmate quelle da qui in avanti · a finire sono le stimate meno lo
        speso, perché la programmazione non si fa mai fino in fondo · il margine è il venduto
        meno speso più a finire
      </p>
    </div>
  );
}

/**
 * Le ore già spese di un pacchetto: un numero per persona, spalmato
 * all'indietro. Il campo nasce col totale che risulta adesso, quindi si
 * corregge un numero invece di ricominciare da capo — ed è l'unico modo in cui
 * riscrivere il consuntivo due volte non raddoppia le ore.
 *
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string} props.pacchettoId
 * @param {string[]} props.settimane   le settimane passate della matrice
 * @param {(muta: (doc: DocProgramma) => DocProgramma) => void} props.onCambia
 * @param {() => void} props.onChiudi
 */
function Consuntivo({ doc, pacchettoId, settimane, onCambia, onChiudi }) {
  const gia = useMemo(() => spesoPerRisorsa(doc, pacchettoId, settimane), [doc, pacchettoId, settimane]);
  const [bozza, setBozza] = useState(/** @type {Record<string, string>} */ ({}));

  if (!settimane.length) {
    return (
      <div className="pg-consuntivo">
        <p className="pg-empty">
          Non ci sono settimane passate nell&apos;orizzonte della matrice: lo speso comincia a
          esistere quando la commessa è cominciata. Controlla la data di inizio in Impostazioni.
        </p>
        <button type="button" className="pg-btn" onClick={onChiudi}>Chiudi</button>
      </div>
    );
  }

  /** @param {string} nome */
  function scrivi(nome) {
    const testo = bozza[nome];
    if (testo === undefined) return;
    const ore = Math.max(0, Number(String(testo).replace(',', '.')) || 0);
    onCambia(d => conSpesoRipartito(d, { risorsa: nome, pacchettoId, ore, settimane }));
    setBozza(b => { const x = { ...b }; delete x[nome]; return x; });
  }

  return (
    <div className="pg-consuntivo">
      <div className="eyebrow eyebrow-accent">Ore già spese su questo pacchetto</div>
      <p className="pg-memo">
        Un numero per persona, spalmato sulle {settimane.length} settimane passate
        ({settimane[0].replace('-W', ' W')} → {settimane[settimane.length - 1].replace('-W', ' W')}).
        Il totale è vero, la distribuzione settimana per settimana è approssimata: serve a sapere
        quanto è andato, non quando. Riscrivere il numero <b>sostituisce</b> quelle celle.
      </p>
      <div className="pg-tabella">
        {doc.risorse.length === 0 && (
          <p className="pg-empty">Prima servono le persone: si aggiungono in Impostazioni.</p>
        )}
        {doc.risorse.map(r => (
          <div key={r.nome} className="pg-tabella-riga">
            <span className="pg-cresce">{r.nome}</span>
            <input
              className="pg-campo pg-campo-stretto"
              inputMode="decimal"
              value={bozza[r.nome] ?? String(gia.get(r.nome) || '')}
              placeholder="0"
              onChange={e => setBozza(b => ({ ...b, [r.nome]: e.target.value }))}
              onBlur={() => scrivi(r.nome)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
            <span className="pg-tabella-nota">
              h in tutto {(gia.get(r.nome) || 0) > 0 ? `· adesso ${oreBrevi(gia.get(r.nome) || 0)} h` : ''}
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="pg-btn" onClick={onChiudi}>Chiudi</button>
    </div>
  );
}
