// @ts-check
// La stessa matrice, girata: una riga per persona, e le ore sommate su **tutte
// le commesse accese**.
//
// È la risposta alla domanda che la matrice di commessa non poteva dare. Lì le
// colonne sono le settimane di *quella* commessa e le righe sono le persone di
// *quella* commessa: una persona a cui si sono date trenta ore qui e venti là
// risulta scarica in tutt'e due le schermate, e la sovrapposizione si vede solo
// il lunedì in cui non ce la fa. Qui la stessa persona è una riga sola, e la
// settimana in cui ha più ore della sua capacità è rossa.
//
// **Si legge e basta.** Una cella qui è la somma di celle che stanno in
// documenti diversi: scriverci dentro vorrebbe dire decidere per conto di chi
// scrive da quale commessa togliere le ore, che è esattamente la decisione da
// non prendere al posto suo. Aprendo una riga si vede da dove viene il carico,
// e un clic sulla commessa porta nella sua matrice, dove quelle ore si
// cambiano davvero.
//
// **Le righe si aprono, come nella matrice di commessa**, e con gli stessi due
// bottoni: chiusa è il totale della persona, aperta scende la catena — la
// commessa, il pacchetto, e con «voci» e «sottovoci» il lavoro dentro. È la
// stessa catena della matrice letta dall'altro capo: là si parte dal lavoro e
// si arriva alla persona, qui si parte dalla persona e si arriva al lavoro.
// Solo i rami in cui ha davvero delle ore.
//
// **Con una commessa sola accesa il suo livello sparisce.** Sarebbe una riga
// che ripete il titolo della pagina, e un gradino in più fra la persona e il
// lavoro. Con due o più torna, perché lì «da dove viene questo carico»
// comincia proprio dalla commessa.
//
// **Il filtro dei pacchetti della testata vale anche qui.** Un pacchetto sta in
// una commessa sola, quindi filtrando questa tabella diventa «di questo
// pacchetto, chi fa cosa e quando»: è la stessa domanda della matrice, letta
// per riga invece che per colonna. Restano solo le persone che su quel
// pacchetto hanno qualcosa — un elenco di righe a zero non è una risposta — ma
// **le sovrapposizioni continuano a contare il carico intero**: dire che uno è
// scarico perché si sta guardando un pacchetto per volta sarebbe la bugia che
// questa vista esiste per non raccontare.
//
// **La densità è la stessa dell'altra matrice**, letta dallo stesso posto
// (`densita.js`): qui le colonne sono ancora più di là — l'unione degli
// orizzonti di tutti i programmi accesi, fino a sessanta settimane — e con dieci
// persone il problema è identico. Stringere in una e non nell'altra farebbe due
// tabelle diverse a guardarsi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lunediDellaSettimana } from '../tempo.js';
import { caricoPersone, livelloSaturazione, perMese } from '../programma.js';
import { oreBrevi } from './formato.js';
import { DENSITA, useDensita } from './densita.js';
import { readPref, writePref } from '../viewPrefs.js';

// La stessa preferenza della matrice: sono due letture della stessa catena, e
// vederla a due profondità diverse passando da una scheda all'altra sarebbe
// esattamente il modo di non fidarsi né dell'una né dell'altra.
const CHIAVE_DETTAGLIO = 'md_pg_matrice_dettaglio_v1';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** «mag» dal mese 'YYYY-MM'. @param {string} mese */
const nomeMese = mese => MESI[Number(mese.slice(5, 7)) - 1] || mese;

/**
 * L'albero sotto una persona, disteso in righe con la loro profondità: la
 * griglia è una lista di righe, e annidare dei `<div>` romperebbe l'allineamento
 * delle colonne. Aperto o chiuso lo decide già il modello — qui ci sono solo i
 * rami che hanno ore.
 * @param {import('../programma.js').QuotaCommessa[]} nodi
 * @param {number} [livello]
 * @returns {{ nodo: import('../programma.js').QuotaCommessa, livello: number }[]}
 */
function appiattisci(nodi, livello = 0) {
  /** @type {{ nodo: import('../programma.js').QuotaCommessa, livello: number }[]} */
  const fila = [];
  for (const nodo of nodi) {
    fila.push({ nodo, livello });
    if (nodo.figli.length) fila.push(...appiattisci(nodo.figli, livello + 1));
  }
  return fila;
}

/**
 * @param {object} props
 * @param {{ id: string, nome: string, doc: DocProgramma }[]} props.programmi  i programmi accesi, già letti
 * @param {string[]} props.settimane
 * @param {string} props.settimanaOra
 * @param {boolean} [props.inCaricamento]  qualche documento sta ancora arrivando
 * @param {string[]} [props.pacchettiScelti]  il filtro della testata, se acceso
 * @param {string} [props.nomiPacchetti]  come si chiamano, per scriverlo in legenda
 * @param {(programmaId: string) => void} [props.onApriCommessa]
 */
export default function MatricePersone({
  programmi, settimane, settimanaOra, inCaricamento = false,
  pacchettiScelti = [], nomiPacchetti = '', onApriCommessa,
}) {
  const [aperte, setAperte] = useState(/** @type {string[]} */ ([]));
  const [densita, cambiaDensita] = useDensita();
  const [dettaglio, setDettaglio] = useState(() => {
    const salvato = readPref(CHIAVE_DETTAGLIO, 0);
    return typeof salvato === 'number' && salvato >= 0 && salvato <= 2 ? salvato : 0;
  });
  const scorrevole = useRef(/** @type {HTMLDivElement|null} */ (null));

  const persone = useMemo(
    () => caricoPersone(programmi, settimane, { pacchettoId: pacchettiScelti, dettaglio }),
    [programmi, settimane, pacchettiScelti, dettaglio]);

  /** @param {number} livelli */
  const cambiaDettaglio = livelli => { setDettaglio(livelli); writePref(CHIAVE_DETTAGLIO, livelli); };

  // Come nella matrice di commessa: la settimana corrente a un terzo da
  // sinistra, perché è la colonna da cui si guarda avanti — e lo stesso gesto
  // è il bottone «oggi», perché scorrendo quella colonna si perde.
  const vaiAOggi = useCallback(() => {
    const box = scorrevole.current;
    const colonna = box?.querySelector('.pg-w-ora');
    if (box && colonna instanceof HTMLElement) {
      box.scrollLeft = Math.max(0, colonna.offsetLeft - box.clientWidth / 3);
    }
  }, []);

  useEffect(() => { vaiAOggi(); }, [settimane.length, densita, vaiAOggi]);

  const gruppiMese = perMese(settimane);
  const sovrapposti = persone.filter(p => p.sovrapposte.length);
  const inizioMese = new Set(gruppiMese.map(g => g.settimane[0]));
  /** Le ore come si scrivono a questa densità. @param {number} ore */
  const scritte = ore => (DENSITA[densita].intere ? oreBrevi(Math.round(ore)) : oreBrevi(ore));
  const tutteAperte = persone.length > 0 && persone.every(p => aperte.includes(p.nome));

  if (!persone.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          {inCaricamento
            ? 'Sto leggendo i programmi accesi…'
            : (pacchettiScelti.length
              ? `Nessuno ha ore su ${nomiPacchetti || 'questi pacchetti'}: il filtro è ancora acceso in testata.`
              : 'Nessuna persona nei programmi accesi: le persone si aggiungono nelle Impostazioni di una commessa.')}
        </p>
      </div>
    );
  }

  return (
    <div className="pg-matrice-guscio">
      <div className="pg-barra">
        <button type="button" className="pg-barra-btn" onClick={vaiAOggi} title="Riporta a schermo la settimana di adesso">
          oggi
        </button>
        <button
          type="button"
          className="pg-barra-btn"
          onClick={() => setAperte(tutteAperte ? [] : persone.map(p => p.nome))}
        >
          {tutteAperte ? 'chiudi tutte' : 'apri tutte'}
        </button>
        <button
          type="button"
          className={`pg-barra-btn${dettaglio >= 1 ? ' scelto' : ''}`}
          onClick={() => cambiaDettaglio(dettaglio >= 1 ? 0 : 1)}
          title="Sotto ogni pacchetto, le lavorazioni su cui la persona ha ore"
        >
          voci
        </button>
        <button
          type="button"
          className={`pg-barra-btn${dettaglio >= 2 ? ' scelto' : ''}`}
          onClick={() => cambiaDettaglio(dettaglio >= 2 ? 1 : 2)}
          title="Anche le figlie delle lavorazioni scomposte"
        >
          sottovoci
        </button>

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
          {settimane.length} settimane · {persone.length} persone
          {pacchettiScelti.length ? ` · solo ${nomiPacchetti || 'una parte dei pacchetti'}` : ''}
        </span>
      </div>

      <div className={`pg-matrice pg-densita-${densita}`} ref={scorrevole}>
        <div
          className="pg-griglia"
          style={/** @type {import('react').CSSProperties} */ ({ '--pg-w': `${DENSITA[densita].w}px` })}
        >
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
            <div className="pg-nome pg-nome-angolo eyebrow">persona</div>
            {settimane.map(w => (
              <div key={w} className={`pg-w${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}>
                <span className="pg-w-iso"><span className="pg-w-w">W</span>{w.slice(6)}</span>
                <span className="pg-w-giorno">{lunediDellaSettimana(w).slice(8)}/{lunediDellaSettimana(w).slice(5, 7)}</span>
              </div>
            ))}
            <div className="pg-tot pg-tot-testa">tot</div>
          </div>

          {persone.map(persona => {
            const aperta = aperte.includes(persona.nome);
            return (
              <div key={persona.nome}>
                <div className={`pg-riga pg-riga-risorsa${aperta ? ' pg-aperta' : ''}`}>
                  <div
                    className="pg-nome"
                    onClick={() => setAperte(p => (p.includes(persona.nome)
                      ? p.filter(n => n !== persona.nome)
                      : [...p, persona.nome]))}
                  >
                    <span className="pg-caret">{aperta ? '▾' : '▸'}</span>
                    <span className="pg-nome-testo">{persona.nome}</span>
                    <span className="pg-cap">{persona.capacita || '—'}h/s</span>
                  </div>
                  {settimane.map(w => {
                    const ore = persona.ore[w] || 0;
                    // Col filtro acceso la cella dice le ore del pacchetto, ma
                    // il rosso continua a dire «questa persona è oltre»: conta
                    // tutto quello che ha addosso, non il pezzo in vista.
                    //
                    // Il passato però non si colora: una settimana già andata
                    // è un fatto, non un allarme — nessuno può più spostare
                    // quelle ore, e il rosso su una colonna che non si può
                    // cambiare è solo rumore fra i rossi che contano.
                    const sat = w < settimanaOra
                      ? 'vuota'
                      : livelloSaturazione(persona.oreIntere[w] || 0, persona.capacita);
                    return (
                      <div
                        key={w}
                        className={[
                          'pg-cella', `pg-sat-${sat}`,
                          w === settimanaOra ? 'pg-w-ora' : '',
                          w < settimanaOra ? 'pg-passato' : '',
                          inizioMese.has(w) ? 'pg-mese-inizio' : '',
                        ].filter(Boolean).join(' ')}
                        title={sat === 'sopra'
                          ? `${persona.nome}, ${w}: ${oreBrevi(persona.oreIntere[w] || 0)} h su ${persona.capacita || '—'} — ${persona.commesse.filter(c => c.ore[w]).map(c => `${c.nome} ${oreBrevi(c.ore[w])}`).join(' + ')}`
                          : undefined}
                      >
                        {scritte(ore)}
                      </div>
                    );
                  })}
                  <div className="pg-tot">{scritte(persona.totale)}</div>
                </div>

                {aperta && appiattisci(persona.commesse).map(({ nodo, livello }) => (
                  <div key={nodo.chiave} className={`pg-riga pg-riga-pacchetto${nodo.tipo === 'voce' ? ' pg-riga-voce' : ''}`}>
                    <div
                      className="pg-nome"
                      style={{ paddingLeft: `calc(var(--sp-3) + ${(livello + 1) * 16}px)` }}
                      onClick={() => onApriCommessa?.(nodo.programmaId)}
                      title="Apri la matrice di questa commessa"
                    >
                      {nodo.tipo === 'voce'
                        ? <span className="pg-voce-segno">·</span>
                        : <span className="pg-punto" style={nodo.colore ? { background: nodo.colore } : undefined} />}
                      <span className="pg-nome-testo">{nodo.nome}</span>
                    </div>
                    {settimane.map(w => (
                      <div
                        key={w}
                        className={[
                          'pg-cella',
                          w === settimanaOra ? 'pg-w-ora' : '',
                          w < settimanaOra ? 'pg-passato' : '',
                          inizioMese.has(w) ? 'pg-mese-inizio' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {scritte(nodo.ore[w] || 0)}
                      </div>
                    ))}
                    <div className="pg-tot">{scritte(nodo.totale)}</div>
                  </div>
                ))}
                {aperta && !persona.commesse.length && (
                  <div className="pg-riga pg-riga-pacchetto">
                    <div className="pg-nome"><span className="pg-nome-testo muted">nessuna ora in questo periodo</span></div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="pg-riga pg-riga-piede">
            <div className="pg-nome">totale settimana</div>
            {settimane.map(w => (
              <div key={w} className={`pg-cella pg-cella-piede${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}>
                {scritte(persone.reduce((s, p) => s + (p.ore[w] || 0), 0))}
              </div>
            ))}
            <div className="pg-tot">{scritte(persone.reduce((s, p) => s + p.totale, 0))}</div>
          </div>
        </div>
      </div>

      {/* Sotto la tabella, in chiaro, la sola cosa che questa vista esiste per
          dire. Un elenco e non un contatore: «tre sovrapposizioni» obbliga a
          cercarle, i nomi no. */}
      <div className="pg-legenda">
        <span>{pacchettiScelti.length
          ? `solo le ore di ${nomiPacchetti || 'una parte dei pacchetti'}`
          : (programmi.length === 1
            ? 'un solo programma acceso'
            : `somma di ${programmi.length} programmi accesi`)}</span>
        <span className="pg-legenda-voce">·</span>
        {/* Le sovrapposizioni si contano sempre sul carico intero, anche col
            filtro acceso: sono la sola cosa che questa vista esiste per dire,
            e un filtro non deve poterle spegnere. */}
        {sovrapposti.length ? (
          // Con due o tre persone le settimane si scrivono per nome, che è la
          // risposta completa. Con dieci non ci stanno, e l'avviso finiva
          // troncato a metà parola: sopra le tre resta il nome — che è la metà
          // che serve per andare a guardare — e delle settimane resta il conto.
          <span className="pg-persone-avviso">
            oltre la capacità: {sovrapposti.map(p => (sovrapposti.length <= 3
              ? `${p.nome} (${p.sovrapposte.map(w => `W${w.slice(6)}`).join(', ')})`
              : `${p.nome} (${p.sovrapposte.length} sett.)`)).join(' · ')}
          </span>
        ) : (
          <span>nessuno oltre la sua capacità in queste settimane</span>
        )}
        {DENSITA[densita].intere && (
          <span className="pg-legenda-nota">ore arrotondate all&apos;intero</span>
        )}
        <span className="pg-legenda-sp" />
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-soglia" /> in soglia</span>
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-sopra" /> oltre la capacità</span>
      </div>
    </div>
  );
}
