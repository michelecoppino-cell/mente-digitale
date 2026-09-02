// @ts-check
// La matrice del carico: una colonna per settimana, una riga per persona.
//
// È il pezzo difficile del Programma, e le decisioni prese qui dentro sono
// tutte sullo stesso problema: **queste celle si compilano cento volte**, quindi
// ogni gesto che costa un giro di mouse in più si paga cento volte.
//
// **La riga chiusa è il totale della persona su tutta la commessa**, aperta si
// spezza in una sotto-riga per pacchetto — e solo nei pacchetti in cui quella
// persona ha qualcosa. Con sei persone e dodici pacchetti le righe sarebbero
// settantadue: quello che si guarda a colpo d'occhio è se una persona è carica,
// il dettaglio si apre dove serve.
//
// **Si scrive solo nelle sotto-righe.** Una riga chiusa non ha una
// destinazione: le ore andrebbero in quale pacchetto? L'unica eccezione è la
// persona che ha un pacchetto solo, dove la destinazione è ovvia. Negli altri
// casi la cella non dà errore, **apre la riga**: l'apertura *è* la risposta.
//
// **La settimana corrente è una linea, non un riempimento.** Taglia la matrice
// in due — a sinistra lo speso, a destra la previsione — ed è la cosa che dà
// senso ai numeri della testata, quindi deve restare riconoscibile mentre si
// scorre senza coprire il numero che c'è nella cella.
//
// **L'annulla non è un lusso.** Un trascinamento sbagliato riscrive un mese in
// un secondo: senza ⌘Z la matrice diventa una cosa che si tocca con paura, e
// una matrice che si tocca con paura non la compila nessuno.
import { useEffect, useMemo, useRef, useState } from 'react';
import { lunediDellaSettimana } from '../tempo.js';
import {
  chiaveCarico, livelloSaturazione, oreCella, oreRisorsaSettimana, pacchettiDiRisorsa,
  perMese, spalma,
} from '../programma.js';
import { oreBrevi, leggiOre } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {{ tipo: 'risorsa'|'pacchetto', nome: string, risorsa: string, capacita: number, colore: string|null, pacchettoId: string|null, aperta: boolean }} Riga */

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** «mag» dal mese 'YYYY-MM'. @param {string} mese */
const nomeMese = mese => MESI[Number(mese.slice(5, 7)) - 1] || mese;

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string[]} props.settimane
 * @param {string} props.settimanaOra
 * @param {string|null} props.pacchettoScelto  quando c'è, restano solo le sue sotto-righe
 * @param {(celle: Record<string, number>) => void} props.onCelle  le ore cambiate, tutte insieme
 * @param {() => void} props.onAnnulla
 * @param {(risorsa: string, pacchettoId: string) => void} [props.onSceltaRiga]
 */
export default function Matrice({
  doc, settimane, settimanaOra, pacchettoScelto, onCelle, onAnnulla, onSceltaRiga,
}) {
  const [aperte, setAperte] = useState(/** @type {string[]} */ ([]));
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [ancora, setAncora] = useState(/** @type {{r:number,c:number}|null} */ (null));
  const [bozza, setBozza] = useState(/** @type {string|null} */ (null));
  const [spalmatura, setSpalmatura] = useState(/** @type {string|null} */ (null));
  const scorrevole = useRef(/** @type {HTMLDivElement|null} */ (null));
  const trascina = useRef(/** @type {'selezione'|'riempi'|null} */ (null));

  // Le righe visibili: una per persona, più le sue sotto-righe se è aperta.
  const righe = useMemo(() => {
    /** @type {Riga[]} */
    const fila = [];
    for (const r of doc.risorse) {
      const aperta = aperte.includes(r.nome);
      fila.push({
        tipo: 'risorsa', nome: r.nome, risorsa: r.nome, capacita: r.oreSettimana,
        colore: null, pacchettoId: unicoPacchetto(doc, r.nome, pacchettoScelto), aperta,
      });
      if (!aperta) continue;
      const suoi = pacchettoScelto
        ? doc.pacchetti.filter(p => p.id === pacchettoScelto)
        : pacchettiDiRisorsa(doc, r.nome);
      const elenco = suoi.length ? suoi : doc.pacchetti.slice(0, 1);
      for (const p of elenco) {
        fila.push({
          tipo: 'pacchetto', nome: p.nome, risorsa: r.nome, capacita: 0,
          colore: p.colore, pacchettoId: p.id, aperta: false,
        });
      }
    }
    return fila;
  }, [doc, aperte, pacchettoScelto]);

  // All'apertura la matrice si mette con la settimana corrente a un terzo da
  // sinistra: si vuole vedere un po' di passato e molto futuro, e su venticinque
  // colonne partire dall'inizio della commessa vuol dire scorrere ogni volta
  // prima di vedere qualcosa.
  useEffect(() => {
    const box = scorrevole.current;
    const colonna = box?.querySelector('.pg-w-ora');
    if (box && colonna instanceof HTMLElement) {
      box.scrollLeft = Math.max(0, colonna.offsetLeft - box.clientWidth / 3);
    }
  }, [doc.id]);

  const rettangolo = () => {
    const a = ancora || sel;
    return {
      r1: Math.min(a.r, sel.r), r2: Math.max(a.r, sel.r),
      c1: Math.min(a.c, sel.c), c2: Math.max(a.c, sel.c),
    };
  };
  const nelRettangolo = (/** @type {number} */ r, /** @type {number} */ c) => {
    const q = rettangolo();
    return r >= q.r1 && r <= q.r2 && c >= q.c1 && c <= q.c2;
  };
  /** Le celle scrivibili dentro la selezione. @returns {{ riga: Riga, colonna: number }[]} */
  const celleScrivibili = () => {
    const q = rettangolo();
    /** @type {{ riga: Riga, colonna: number }[]} */
    const elenco = [];
    for (let r = q.r1; r <= q.r2; r++) {
      const riga = righe[r];
      if (!riga?.pacchettoId) continue;
      for (let c = q.c1; c <= q.c2; c++) elenco.push({ riga, colonna: c });
    }
    return elenco;
  };

  /** @param {Riga} riga @param {number} colonna */
  const valore = (riga, colonna) => (riga.tipo === 'pacchetto'
    ? oreCella(doc, riga.risorsa, /** @type {string} */ (riga.pacchettoId), settimane[colonna])
    : oreRisorsaSettimana(doc, riga.risorsa, settimane[colonna]));

  /** Scrive un valore nelle celle indicate. @param {{ riga: Riga, colonna: number }[]} celle @param {number[]} valori */
  function scrivi(celle, valori) {
    /** @type {Record<string, number>} */
    const mappa = {};
    celle.forEach((cella, i) => {
      const chiave = chiaveCarico(cella.riga.risorsa, /** @type {string} */ (cella.riga.pacchettoId), settimane[cella.colonna]);
      mappa[chiave] = valori[Math.min(i, valori.length - 1)];
    });
    if (Object.keys(mappa).length) onCelle(mappa);
  }

  /** La riga su cui si sta scrivendo, o l'apertura che ci porta. @param {number} r */
  function apriSeServe(r) {
    const riga = righe[r];
    if (!riga || riga.pacchettoId) return true;
    // Non un errore: scrivere in una riga chiusa non ha una destinazione, e
    // l'apertura è la risposta alla domanda «in quale pacchetto?».
    setAperte(p => (p.includes(riga.risorsa) ? p : [...p, riga.risorsa]));
    return false;
  }

  /** @param {number} dr @param {number} dc @param {boolean} estendi */
  function muovi(dr, dc, estendi) {
    setSel(s => {
      const r = Math.max(0, Math.min(righe.length - 1, s.r + dr));
      const c = Math.max(0, Math.min(settimane.length - 1, s.c + dc));
      return { r, c };
    });
    setAncora(precedente => (estendi ? (precedente || sel) : null));
  }

  /** @param {import('react').KeyboardEvent} e */
  function tasti(e) {
    if (bozza !== null) return;   // ci pensa l'input della cella
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); onAnnulla(); return; }

    const frecce = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const passo = frecce[/** @type {keyof typeof frecce} */ (e.key)];
    if (passo) {
      e.preventDefault();
      muovi(passo[0], passo[1], e.shiftKey);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      const riga = righe[sel.r];
      if (riga) setAperte(p => (p.includes(riga.risorsa) ? p.filter(n => n !== riga.risorsa) : [...p, riga.risorsa]));
      return;
    }
    if (e.key === 'Escape') { setAncora(null); setSpalmatura(null); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const celle = celleScrivibili();
      if (celle.length) scrivi(celle, [0]);
      return;
    }
    if (/^[\d.,]$/.test(e.key)) {
      e.preventDefault();
      if (!apriSeServe(sel.r)) return;
      // Con un intervallo selezionato non si indovina se quel numero vada in
      // ogni settimana o distribuito in tutte: si chiede, mostrando i due
      // risultati già calcolati.
      if (celleScrivibili().length > 1) setSpalmatura(e.key);
      else setBozza(e.key);
    }
  }

  /** Conferma della barretta: lo stesso numero in ogni cella, o spalmato. @param {boolean} inTutto */
  function confermaSpalmatura(inTutto) {
    const ore = leggiOre(spalmatura || '');
    const celle = celleScrivibili();
    setSpalmatura(null);
    if (ore === null || !celle.length) return;
    scrivi(celle, inTutto ? spalma(ore, celle.length) : [ore]);
  }

  const gruppiMese = perMese(settimane);

  if (!doc.risorse.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">La matrice ha una riga per persona, e non c&apos;è ancora nessuno.</p>
      </div>
    );
  }

  return (
    <div className="pg-matrice-guscio">
      <div
        className="pg-matrice"
        ref={scorrevole}
        tabIndex={0}
        onKeyDown={tasti}
        onMouseUp={() => { trascina.current = null; }}
        onMouseLeave={() => { trascina.current = null; }}
      >
        <div className="pg-griglia">
          {/* La fascia dei mesi: con venticinque colonne è l'unico modo di
              sapere dove si è senza contare le settimane. */}
          <div className="pg-riga pg-riga-mesi">
            <div className="pg-nome pg-nome-angolo" />
            {gruppiMese.map(g => (
              <div key={g.mese} className="pg-mese" style={{ width: `calc(var(--pg-w) * ${g.settimane.length})` }}>
                {nomeMese(g.mese)}
              </div>
            ))}
            <div className="pg-tot pg-tot-angolo" />
          </div>

          <div className="pg-riga pg-riga-testa">
            <div className="pg-nome pg-nome-angolo eyebrow">risorsa</div>
            {settimane.map(w => (
              <div key={w} className={`pg-w${w === settimanaOra ? ' pg-w-ora' : ''}`}>
                <span className="pg-w-iso">W{w.slice(6)}</span>
                <span className="pg-w-giorno">{lunediDellaSettimana(w).slice(8)}/{lunediDellaSettimana(w).slice(5, 7)}</span>
              </div>
            ))}
            <div className="pg-tot pg-tot-testa">tot</div>
          </div>

          {righe.map((riga, r) => {
            let totale = 0;
            const celle = settimane.map((w, c) => {
              const v = valore(riga, c);
              totale += v;
              return { w, c, v };
            });
            return (
              <div key={`${riga.risorsa}|${riga.pacchettoId || 'tot'}|${riga.tipo}`} className={`pg-riga pg-riga-${riga.tipo}${riga.aperta ? ' pg-aperta' : ''}`}>
                <div
                  className="pg-nome"
                  onClick={() => {
                    if (riga.tipo === 'risorsa') {
                      setAperte(p => (p.includes(riga.risorsa) ? p.filter(n => n !== riga.risorsa) : [...p, riga.risorsa]));
                    } else if (riga.pacchettoId) {
                      onSceltaRiga?.(riga.risorsa, riga.pacchettoId);
                    }
                  }}
                >
                  {riga.tipo === 'risorsa' ? (
                    <>
                      <span className="pg-caret">{riga.aperta ? '▾' : '▸'}</span>
                      <span className="pg-nome-testo">{riga.nome}</span>
                      <span className="pg-cap">{riga.capacita}h/s</span>
                    </>
                  ) : (
                    <>
                      <span className="pg-punto" style={riga.colore ? { background: riga.colore } : undefined} />
                      <span className="pg-nome-testo">{riga.nome}</span>
                    </>
                  )}
                </div>

                {celle.map(({ w, c, v }) => {
                  const scelta = sel.r === r && sel.c === c;
                  const dentro = nelRettangolo(r, c);
                  const sat = riga.tipo === 'risorsa' ? livelloSaturazione(v, riga.capacita) : 'vuota';
                  return (
                    <div
                      key={w}
                      className={[
                        'pg-cella',
                        `pg-sat-${sat}`,
                        w === settimanaOra ? 'pg-w-ora' : '',
                        w < settimanaOra ? 'pg-passato' : '',
                        dentro ? 'pg-dentro' : '',
                        scelta ? 'pg-scelta' : '',
                      ].filter(Boolean).join(' ')}
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        trascina.current = 'selezione';
                        setSel({ r, c });
                        setAncora(e.shiftKey ? (ancora || sel) : null);
                        setBozza(null);
                        setSpalmatura(null);
                        scorrevole.current?.focus();
                      }}
                      onMouseEnter={() => {
                        if (trascina.current !== 'selezione') return;
                        setAncora(a => a || sel);
                        setSel({ r, c });
                      }}
                      onDoubleClick={() => { if (apriSeServe(r)) { setSel({ r, c }); setBozza(oreBrevi(v)); } }}
                    >
                      {scelta && bozza !== null ? (
                        <input
                          className="pg-input"
                          autoFocus
                          value={bozza}
                          onChange={ev => setBozza(ev.target.value)}
                          onBlur={() => setBozza(null)}
                          onKeyDown={ev => {
                            const avanti = { Enter: [1, 0], Tab: [0, 1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
                            const passo = avanti[/** @type {keyof typeof avanti} */ (ev.key)];
                            if (ev.key === 'Escape') { ev.preventDefault(); setBozza(null); scorrevole.current?.focus(); return; }
                            if (!passo) return;
                            ev.preventDefault();
                            const ore = leggiOre(bozza);
                            // Un valore che non si legge non svuota la cella:
                            // si resta dov'è, e chi ha sbagliato lo vede.
                            if (ore !== null && riga.pacchettoId) scrivi([{ riga, colonna: c }], [ore]);
                            setBozza(null);
                            scorrevole.current?.focus();
                            if (ore !== null) muovi(passo[0], ev.shiftKey ? -passo[1] : passo[1], false);
                          }}
                        />
                      ) : oreBrevi(v)}

                      {/* Il quadratino che ripete il valore. Solo in
                          orizzontale: verso il basso vorrebbe dire copiare le
                          ore di una persona su un'altra, che non è mai quello
                          che si intende. */}
                      {scelta && riga.pacchettoId && bozza === null && (
                        <span
                          className="pg-maniglia"
                          onMouseDown={e => {
                            e.stopPropagation();
                            trascina.current = 'riempi';
                            const partenza = { r, c, v };
                            const suCella = (/** @type {MouseEvent} */ ev) => {
                              const sotto = document.elementFromPoint(ev.clientX, ev.clientY);
                              const box = sotto?.closest('.pg-cella');
                              const riquadro = box?.parentElement;
                              if (!box || !riquadro) return;
                              const colonna = [...riquadro.querySelectorAll('.pg-cella')].indexOf(box);
                              if (colonna < 0) return;
                              setAncora({ r: partenza.r, c: partenza.c });
                              setSel({ r: partenza.r, c: colonna });
                            };
                            const fine = () => {
                              document.removeEventListener('mousemove', suCella);
                              document.removeEventListener('mouseup', fine);
                              trascina.current = null;
                              setSel(s => {
                                const da = Math.min(partenza.c, s.c), a = Math.max(partenza.c, s.c);
                                /** @type {{ riga: Riga, colonna: number }[]} */
                                const celleDaRiempire = [];
                                for (let x = da; x <= a; x++) celleDaRiempire.push({ riga, colonna: x });
                                scrivi(celleDaRiempire, [partenza.v]);
                                return s;
                              });
                            };
                            document.addEventListener('mousemove', suCella);
                            document.addEventListener('mouseup', fine);
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                <div className="pg-tot">{oreBrevi(totale)}</div>
              </div>
            );
          })}

          <div className="pg-riga pg-riga-piede">
            <div className="pg-nome">totale settimana</div>
            {settimane.map(w => (
              <div key={w} className={`pg-cella pg-cella-piede${w === settimanaOra ? ' pg-w-ora' : ''}`}>
                {oreBrevi(doc.risorse.reduce((s, r) => s + oreRisorsaSettimana(doc, r.nome, w), 0))}
              </div>
            ))}
            <div className="pg-tot">{oreBrevi(Object.values(doc.carico).reduce((s, o) => s + o, 0))}</div>
          </div>
        </div>
      </div>

      {spalmatura !== null && (
        <div className="pg-spalma">
          <span className="pg-spalma-num">{spalmatura}</span>
          <button type="button" className="pg-spalma-scelta" onClick={() => confermaSpalmatura(false)}>
            {leggiOre(spalmatura) ?? '—'} h in ogni settimana <span className="pg-scorciatoia">Invio</span>
          </button>
          <button type="button" className="pg-spalma-scelta" onClick={() => confermaSpalmatura(true)}>
            {leggiOre(spalmatura) ?? '—'} h in tutto = {oreBrevi(spalma(leggiOre(spalmatura) || 0, celleScrivibili().length)[0] || 0)} h × {celleScrivibili().length}
            <span className="pg-scorciatoia">⌥Invio</span>
          </button>
          <input
            className="pg-spalma-campo"
            autoFocus
            value={spalmatura}
            onChange={e => setSpalmatura(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); confermaSpalmatura(e.altKey); scorrevole.current?.focus(); }
              if (e.key === 'Escape') { setSpalmatura(null); scorrevole.current?.focus(); }
            }}
          />
        </div>
      )}

      <div className="pg-legenda">
        <span>frecce per muoversi · una cifra per scrivere · ⇧+frecce per un intervallo · ⌘Z annulla</span>
        <span className="pg-legenda-sp" />
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-soglia" /> in soglia</span>
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-sopra" /> oltre la capacità</span>
      </div>
    </div>
  );
}

/**
 * Il pacchetto di una persona quando ne ha uno solo: lì scrivere in una riga
 * chiusa ha una destinazione ovvia, e chiedere di aprirla sarebbe un passaggio
 * per niente.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string|null} pacchettoScelto
 * @returns {string|null}
 */
function unicoPacchetto(doc, risorsa, pacchettoScelto) {
  if (pacchettoScelto) return pacchettoScelto;
  const suoi = pacchettiDiRisorsa(doc, risorsa);
  return suoi.length === 1 ? suoi[0].id : null;
}
