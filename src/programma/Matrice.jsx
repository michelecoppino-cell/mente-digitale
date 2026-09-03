// @ts-check
// La matrice del carico: una colonna per settimana, una riga per **pacchetto**.
//
// È il pezzo difficile del Programma, e le decisioni prese qui dentro sono
// tutte sullo stesso problema: **queste celle si compilano cento volte**, quindi
// ogni gesto che costa un giro di mouse in più si paga cento volte.
//
// **Le righe sono il lavoro, non le persone.** È l'esatto contrario della
// scheda Persone, ed è voluto: là la domanda è «a questa persona quanto ho già
// dato», qui è «questo pacchetto quando si fa, e chi ci sta sopra». Prima
// erano tutt'e due per persona, e la domanda sul lavoro non aveva una vista
// sua: per sapere quante ore c'erano su un pacchetto in una settimana bisognava
// aprire tutte le righe e sommare a mente le sotto-righe con lo stesso nome.
//
// **La riga chiusa è il totale del pacchetto su tutte le persone**, aperta si
// spezza in una sotto-riga per persona — e solo le persone che su quel
// pacchetto hanno qualcosa (o che una voce ci propone). Con dodici pacchetti e
// sei persone le righe sarebbero settantadue: quello che si guarda a colpo
// d'occhio è quando cade il lavoro, il dettaglio si apre dove serve.
//
// **Si scrive solo nelle sotto-righe.** Una riga chiusa non ha una
// destinazione: le ore andrebbero a quale persona? L'unica eccezione è il
// pacchetto con una persona sola, dove la destinazione è ovvia. Negli altri
// casi la cella non dà errore, **apre la riga**: l'apertura *è* la risposta.
//
// **La tinta della saturazione resta quella della persona, non della cella.**
// In una sotto-riga il numero sono le ore di quella persona *su questo
// pacchetto*, ma il rosso continua a voler dire una cosa sola — quella persona,
// quella settimana, è oltre la sua capacità contando tutto quello che ha
// addosso in questa commessa. Colorare sul numero della cella direbbe che chi
// ha dieci ore su un pacchetto sta bene, anche con altre trenta due righe più
// sotto: è esattamente l'allarme che serve, e si perderebbe girando la tabella.
//
// **La settimana corrente è una linea, non un riempimento.** Taglia la matrice
// in due — a sinistra lo speso, a destra la previsione — ed è la cosa che dà
// senso ai numeri della testata, quindi deve restare riconoscibile mentre si
// scorre senza coprire il numero che c'è nella cella.
//
// **L'annulla non è un lusso.** Un trascinamento sbagliato riscrive un mese in
// un secondo: senza ⌘Z la matrice diventa una cosa che si tocca con paura, e
// una matrice che si tocca con paura non la compila nessuno.
//
// **Dieci persone e un anno sono un'altra tabella.** Con tre risorse e sedici
// settimane tutto sta a schermo e non c'è niente da governare; con dieci righe
// e cinquanta colonne la stessa griglia diventa un tunnel — si scorre a destra
// per due schermate, si perde di vista la settimana di oggi, e la riga che si
// sta leggendo si confonde con le altre nove. Da lì la barra qui sopra, e sono
// tre gesti soli:
//
//   · **la densità** — la stessa griglia a tre larghezze di colonna. «Anno»
//     rimpicciolisce finché l'intera commessa ci sta in una schermata: non è
//     uno zoom estetico, è la differenza fra vedere l'andamento e ricostruirselo
//     scorrendo.
//   · **«oggi»** — la colonna di adesso torna al suo posto. Scorrendo la si
//     perde, ed è la linea che divide lo speso dalla previsione: senza, i
//     numeri della testata non si sanno più leggere.
//   · **una persona sola** — dieci pacchetti aperti sono sessanta sotto-righe.
//     Il più delle volte la domanda è su una persona, e allora le altre nove
//     sono rumore. Scegliendone una, anche i totali dei pacchetti diventano i
//     suoi: una riga chiusa che continuasse a sommare tutti non direbbe più
//     niente sul filtro acceso.
//
// E il filtro dei pacchetti della testata vale **dappertutto**: restano le sue
// righe, e i totali in fondo e in colonna sono i suoi. Un filtro che lascia in
// piedi somme di tutto il resto è peggio di nessun filtro, perché il numero
// sbagliato sembra giusto.
//
// E tre cose che si vedono e non si toccano: la riga e la colonna in cui si sta
// restano segnate mentre si scorre, le righe si alternano di fondo, e il primo
// lunedì di ogni mese porta una linea verticale. Sono i tre modi in cui si
// tiene il segno in una tabella grande, e nessuno costa un click.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lunediDellaSettimana } from '../tempo.js';
import {
  chiaveCarico, livelloSaturazione, oreCella, oreRisorsaSettimana, orePacchettoSettimana,
  risorseDiPacchetto, perMese, spalma,
} from '../programma.js';
import { oreBrevi, leggiOre } from './formato.js';
import { DENSITA, useDensita } from './densita.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {{ tipo: 'pacchetto'|'risorsa', nome: string, risorsa: string|null, capacita: number, colore: string|null, pacchettoId: string, aperta: boolean }} Riga */

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];


/** «mag» dal mese 'YYYY-MM'. @param {string} mese */
const nomeMese = mese => MESI[Number(mese.slice(5, 7)) - 1] || mese;

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string[]} props.settimane
 * @param {string} props.settimanaOra
 * @param {string|null} props.pacchettoScelto  quando c'è, resta solo la sua riga — totali compresi
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
  // La stessa densità della matrice per persona: sono le stesse colonne, e una
  // stretta e l'altra no sarebbero due tabelle diverse a guardarsi.
  const [densita, cambiaDensita] = useDensita();
  const [personaSola, setPersonaSola] = useState('');
  const scorrevole = useRef(/** @type {HTMLDivElement|null} */ (null));
  const trascina = useRef(/** @type {'selezione'|'riempi'|null} */ (null));

  // Le righe visibili: una per pacchetto, più le sue sotto-righe se è aperto.
  const righe = useMemo(() => {
    /** @type {Riga[]} */
    const fila = [];
    const pacchetti = pacchettoScelto
      ? doc.pacchetti.filter(p => p.id === pacchettoScelto)
      : doc.pacchetti;
    for (const p of pacchetti) {
      const aperto = aperte.includes(p.id);
      // Con una persona sola scelta, restano i pacchetti in cui ha qualcosa:
      // gli altri sarebbero righe a zero, cioè rumore travestito da dato.
      const sue = personaSola
        ? doc.risorse.filter(r => r.nome === personaSola)
        : risorseDiPacchetto(doc, p.id);
      if (personaSola && !risorseDiPacchetto(doc, p.id).some(r => r.nome === personaSola)) continue;
      fila.push({
        tipo: 'pacchetto', nome: p.nome, risorsa: unicaRisorsa(sue, personaSola),
        capacita: 0, colore: p.colore, pacchettoId: p.id, aperta: aperto,
      });
      if (!aperto) continue;
      const elenco = sue.length ? sue : doc.risorse.slice(0, 1);
      for (const r of elenco) {
        fila.push({
          tipo: 'risorsa', nome: r.nome, risorsa: r.nome, capacita: r.oreSettimana,
          colore: null, pacchettoId: p.id, aperta: false,
        });
      }
    }
    return fila;
  }, [doc, aperte, pacchettoScelto, personaSola]);

  // La matrice si mette con la settimana corrente a un terzo da sinistra: si
  // vuole vedere un po' di passato e molto futuro, e su cinquanta colonne
  // partire dall'inizio della commessa vuol dire scorrere ogni volta prima di
  // vedere qualcosa.
  //
  // È anche il bottone «oggi», perché è lo stesso gesto: scorrendo la colonna
  // di adesso si perde, ed è la linea che divide lo speso dalla previsione.
  const vaiAOggi = useCallback(() => {
    const box = scorrevole.current;
    const colonna = box?.querySelector('.pg-w-ora');
    if (box && colonna instanceof HTMLElement) {
      box.scrollLeft = Math.max(0, colonna.offsetLeft - box.clientWidth / 3);
    }
  }, []);

  useEffect(() => { vaiAOggi(); }, [doc.id, vaiAOggi]);
  // Cambiando densità cambiano tutte le distanze: senza rimetterla a posto, la
  // colonna di oggi finisce fuori schermo proprio mentre si stringe per vedere
  // di più.
  useEffect(() => { vaiAOggi(); }, [densita, vaiAOggi]);

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
      if (!riga?.risorsa) continue;
      for (let c = q.c1; c <= q.c2; c++) elenco.push({ riga, colonna: c });
    }
    return elenco;
  };

  /** Le ore come si scrivono a questa densità. @param {number} ore */
  const scritte = ore => (
    DENSITA[densita].intere ? oreBrevi(Math.round(ore)) : oreBrevi(ore));

  /** @param {Riga} riga @param {number} colonna */
  const valore = (riga, colonna) => (riga.tipo === 'risorsa'
    ? oreCella(doc, /** @type {string} */ (riga.risorsa), riga.pacchettoId, settimane[colonna])
    // La riga chiusa somma le persone — tutte, o la sola scelta nel filtro.
    : orePacchettoSettimana(doc, riga.pacchettoId, settimane[colonna], personaSola || null));

  /** Scrive un valore nelle celle indicate. @param {{ riga: Riga, colonna: number }[]} celle @param {number[]} valori */
  function scrivi(celle, valori) {
    /** @type {Record<string, number>} */
    const mappa = {};
    celle.forEach((cella, i) => {
      const chiave = chiaveCarico(/** @type {string} */ (cella.riga.risorsa), cella.riga.pacchettoId, settimane[cella.colonna]);
      mappa[chiave] = valori[Math.min(i, valori.length - 1)];
    });
    if (Object.keys(mappa).length) onCelle(mappa);
  }

  /** La riga su cui si sta scrivendo, o l'apertura che ci porta. @param {number} r */
  function apriSeServe(r) {
    const riga = righe[r];
    if (!riga || riga.risorsa) return true;
    // Non un errore: scrivere in una riga chiusa non ha una destinazione, e
    // l'apertura è la risposta alla domanda «a quale persona?».
    setAperte(p => (p.includes(riga.pacchettoId) ? p : [...p, riga.pacchettoId]));
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
      if (riga) setAperte(p => (p.includes(riga.pacchettoId) ? p.filter(n => n !== riga.pacchettoId) : [...p, riga.pacchettoId]));
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
  // I pacchetti che la tabella sta mostrando: è da qui che i totali del piede
  // sanno del filtro.
  const pacchettiVisti = righe.filter(r => r.tipo === 'pacchetto')
    .map(r => ({ id: r.pacchettoId }));
  // Il numero d'ordine di ogni pacchetto: serve alla zebra, che alterna per
  // pacchetto e non per riga.
  const indiciPacchetto = new Map(doc.pacchetti.map((p, i) => [p.id, i]));
  // Le settimane che aprono un mese: con cinquanta colonne la fascia in cima
  // non basta a tenere il segno, e una linea verticale sì.
  const inizioMese = new Set(gruppiMese.map(g => g.settimane[0]));

  if (!doc.pacchetti.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          La matrice ha una riga per pacchetto, e non ce n&apos;è ancora nessuno. I pacchetti si
          creano in Impostazioni, o nascono da soli incollando delle voci che li nominano.
        </p>
      </div>
    );
  }
  if (!doc.risorse.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          Le ore si danno a qualcuno, e non c&apos;è ancora nessuno: le persone si aggiungono
          nelle Impostazioni della commessa.
        </p>
      </div>
    );
  }

  const tutteAperte = doc.pacchetti.length > 0 && doc.pacchetti.every(p => aperte.includes(p.id));

  return (
    <div className="pg-matrice-guscio">
      <div className="pg-barra">
        <button type="button" className="pg-barra-btn" onClick={vaiAOggi} title="Riporta a schermo la settimana di adesso">
          oggi
        </button>
        <button
          type="button"
          className="pg-barra-btn"
          onClick={() => setAperte(tutteAperte ? [] : doc.pacchetti.map(p => p.id))}
        >
          {tutteAperte ? 'chiudi tutte' : 'apri tutte'}
        </button>

        {/* Una persona sola. Con dieci pacchetti aperti le sotto-righe sono
            sessanta, e la domanda quasi sempre è su una persona: le altre nove
            in quel momento sono rumore. Scelta una, tutti i totali di questa
            tabella — righe chiuse, colonna «tot», piede — diventano i suoi. */}
        <select
          className="pg-filtro"
          value={personaSola}
          onChange={e => setPersonaSola(e.target.value)}
          title="Restringi la matrice a una persona sola"
        >
          <option value="">tutte le persone</option>
          {doc.risorse.map(r => <option key={r.nome} value={r.nome}>solo {r.nome}</option>)}
        </select>

        <span className="pg-barra-sp" />

        <span className="eyebrow">densità</span>
        {Object.entries(DENSITA).map(([chiave, { etichetta }]) => (
          <button
            type="button"
            key={chiave}
            className={`pg-barra-btn${densita === chiave ? ' scelto' : ''}`}
            onClick={() => cambiaDensita(/** @type {import('./densita.js').Densita} */ (chiave))}
          >
            {etichetta}
          </button>
        ))}
        <span className="pg-barra-conto">
          {settimane.length} settimane · {pacchettoScelto ? '1' : doc.pacchetti.length} pacchetti
        </span>
      </div>

      <div
        className={`pg-matrice pg-densita-${densita}`}
        ref={scorrevole}
        tabIndex={0}
        onKeyDown={tasti}
        onMouseUp={() => { trascina.current = null; }}
        onMouseLeave={() => { trascina.current = null; }}
      >
        <div
          className="pg-griglia"
          style={/** @type {import('react').CSSProperties} */ ({ '--pg-w': `${DENSITA[densita].w}px` })}
        >
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
            <div className="pg-nome pg-nome-angolo eyebrow">pacchetto</div>
            {settimane.map(w => (
              <div key={w} className={`pg-w${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}${sel.c === settimane.indexOf(w) ? ' pg-colonna-scelta' : ''}`}>
                {/* La «W» sparisce alla densità più stretta: a ventotto pixel
                    è la lettera che manda fuori il numero, ed è anche la meno
                    utile — la colonna delle settimane si sa che è. */}
                <span className="pg-w-iso"><span className="pg-w-w">W</span>{w.slice(6)}</span>
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
              <div
                key={`${riga.pacchettoId}|${riga.risorsa || 'tot'}|${riga.tipo}`}
                className={[
                  'pg-riga', `pg-riga-${riga.tipo === 'pacchetto' ? 'risorsa' : 'pacchetto'}`,
                  riga.aperta ? 'pg-aperta' : '',
                  // A righe alterne, contando i **pacchetti** e non le righe:
                  // un pacchetto aperto resta un blocco solo con le sue
                  // sotto-righe, che è quello che si segue con l'occhio.
                  (indiciPacchetto.get(riga.pacchettoId) || 0) % 2 ? 'pg-dispari' : '',
                  r === sel.r ? 'pg-riga-scelta' : '',
                ].filter(Boolean).join(' ')}
              >
                <div
                  className="pg-nome"
                  onClick={() => {
                    if (riga.tipo === 'pacchetto') {
                      setAperte(p => (p.includes(riga.pacchettoId)
                        ? p.filter(id => id !== riga.pacchettoId)
                        : [...p, riga.pacchettoId]));
                    } else if (riga.risorsa) {
                      onSceltaRiga?.(riga.risorsa, riga.pacchettoId);
                    }
                  }}
                >
                  {riga.tipo === 'pacchetto' ? (
                    <>
                      <span className="pg-caret">{riga.aperta ? '▾' : '▸'}</span>
                      <span className="pg-punto" style={riga.colore ? { background: riga.colore } : undefined} />
                      <span className="pg-nome-testo">{riga.nome}</span>
                    </>
                  ) : (
                    <>
                      <span className="pg-nome-testo">{riga.nome}</span>
                      <span className="pg-cap">{riga.capacita}h/s</span>
                    </>
                  )}
                </div>

                {celle.map(({ w, c, v }) => {
                  const scelta = sel.r === r && sel.c === c;
                  const dentro = nelRettangolo(r, c);
                  // La tinta è la persona, non la cella: dice «questa persona,
                  // questa settimana, è oltre la sua capacità in questa
                  // commessa», e conta tutto quello che ha addosso — non le
                  // sole ore di questo pacchetto, che direbbero sempre di sì.
                  const sat = riga.tipo === 'risorsa'
                    ? livelloSaturazione(oreRisorsaSettimana(doc, /** @type {string} */ (riga.risorsa), w), riga.capacita)
                    : 'vuota';
                  return (
                    <div
                      key={w}
                      className={[
                        'pg-cella',
                        `pg-sat-${sat}`,
                        w === settimanaOra ? 'pg-w-ora' : '',
                        w < settimanaOra ? 'pg-passato' : '',
                        inizioMese.has(w) ? 'pg-mese-inizio' : '',
                        dentro ? 'pg-dentro' : '',
                        // La colonna in cui si sta, segnata per tutta l'altezza:
                        // su cinquanta colonne, guardando la riga in fondo non
                        // si sa più in che settimana si è.
                        sel.c === c ? 'pg-colonna-scelta' : '',
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
                            if (ore !== null && riga.risorsa) scrivi([{ riga, colonna: c }], [ore]);
                            setBozza(null);
                            scorrevole.current?.focus();
                            if (ore !== null) muovi(passo[0], ev.shiftKey ? -passo[1] : passo[1], false);
                          }}
                        />
                      ) : scritte(v)}

                      {/* Il quadratino che ripete il valore. Solo in
                          orizzontale: verso il basso vorrebbe dire copiare le
                          ore di una persona su un'altra — o peggio, su un altro
                          pacchetto — che non è mai quello che si intende. */}
                      {scelta && riga.risorsa && bozza === null && (
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

                <div className="pg-tot">{scritte(totale)}</div>
              </div>
            );
          })}

          <div className="pg-riga pg-riga-piede">
            <div className="pg-nome">totale settimana</div>
            {/* Il piede rispetta i filtri accesi: sommare tutta la commessa
                sotto una tabella che ne mostra un pezzo darebbe un numero
                giusto alla domanda sbagliata, e nessuno se ne accorgerebbe. */}
            {settimane.map(w => (
              <div key={w} className={`pg-cella pg-cella-piede${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}>
                {scritte(pacchettiVisti.reduce(
                  (s, p) => s + orePacchettoSettimana(doc, p.id, w, personaSola || null), 0))}
              </div>
            ))}
            <div className="pg-tot">
              {scritte(settimane.reduce((s, w) => s + pacchettiVisti.reduce(
                (q, p) => q + orePacchettoSettimana(doc, p.id, w, personaSola || null), 0), 0))}
            </div>
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
        <span className="pg-legenda-nota">
          la tinta è la persona nella settimana, su tutta la commessa — non le ore della cella
        </span>
        {DENSITA[densita].intere && (
          <span className="pg-legenda-nota">ore arrotondate all&apos;intero: le mezze ore ci sono, si rivedono a densità «stretta»</span>
        )}
        <span className="pg-legenda-sp" />
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-soglia" /> in soglia</span>
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-sopra" /> oltre la capacità</span>
      </div>
    </div>
  );
}

/**
 * La persona di un pacchetto quando ce n'è una sola — o quella scelta nel
 * filtro: lì scrivere in una riga chiusa ha una destinazione ovvia, e chiedere
 * di aprirla sarebbe un passaggio per niente.
 * @param {import('../programma.js').Risorsa[]} sue  le persone del pacchetto
 * @param {string} personaSola
 * @returns {string|null}
 */
function unicaRisorsa(sue, personaSola) {
  if (personaSola) return personaSola;
  return sue.length === 1 ? sue[0].nome : null;
}
