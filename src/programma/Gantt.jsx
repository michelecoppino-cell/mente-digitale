// @ts-check
// Il Gantt: una riga per attività, una colonna per settimana, e nella cella una
// barra colorata che dice quando ci si lavora.
//
// **Perché una terza tabella.** La matrice e la scheda Persone rispondono alla
// stessa domanda da due lati — «questa settimana chi è pieno», «a questa persona
// quanto ho già dato» — e sono le viste in cui si *compila*. La domanda che
// restava senza vista è quella che si fa in riunione, ed è un'altra: **cosa
// finisce quando**. Nella matrice quella risposta c'è, ma sparsa: le righe sono
// raccolte per pacchetto, e per sapere cosa si chiude prima bisogna leggerne
// venti e tenere a mente venti date. Qui le righe sono ordinate per quando
// finiscono, ed è tutta la vista.
//
// **In sola lettura, ed è il punto.** Nel Gantt non si scrive niente: le celle
// si compilano nella matrice, e due posti in cui scrivere la stessa cella
// sarebbero due modi di sbagliarla. Questa è la lettura — si guarda, si stampa,
// si manda — e per questo la riga si può cliccare: porta al dettaglio della
// voce, cioè al posto in cui quelle ore si cambiano davvero.
//
// **Il colore è quello del pacchetto**, lo stesso punto che si vede nella barra
// dei filtri e nella matrice: un Gantt in cui ogni barra ha un colore suo è un
// arcobaleno che non dice niente, uno in cui il colore è il pacchetto si legge
// da lontano.
//
// **Chi ci lavora sta scritto, non solo nel tooltip.** Il passaggio del mouse
// dà il dettaglio della settimana — chi, e quante ore — ma i nomi della riga
// stanno anche in una colonna a sinistra: un'informazione che esiste solo al
// passaggio del mouse non esiste da telefono, non esiste stampata, e non esiste
// nemmeno per chi la tabella la sta guardando insieme a qualcun altro.
//
// **Le non programmate si mostrano a richiesta.** Sono le voci che non hanno
// nemmeno un'ora in queste settimane: senza di loro il Gantt racconta una
// commessa che finisce prima di quanto finirà, con loro in mezzo alle altre
// sarebbe una tabella per metà vuota. Quindi in coda, e dietro un bottone.
import { useMemo, useState } from 'react';
import { lunediDellaSettimana } from '../tempo.js';
import { gantt, perMese } from '../programma.js';
import { oreBrevi } from './formato.js';
import { DENSITA, useDensita } from './densita.js';
import { readPref, writePref } from '../viewPrefs.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {import('../programma.js').RigaGantt} RigaGantt */

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** «mag» dal mese 'YYYY-MM'. @param {string} mese */
const nomeMese = mese => MESI[Number(mese.slice(5, 7)) - 1] || mese;

const CHIAVE_NONPROG = 'md_pg_gantt_nonprogrammate_v1';

/**
 * Il fondo di una cella: il colore del pacchetto, schiarito.
 *
 * Il colore pieno è quello del punto nella barra dei filtri — un tondo da otto
 * pixel, dove serve che si veda. Steso su una fascia larga mezza schermata lo
 * stesso colore diventa un fondo su cui il testo attorno non si legge più, e
 * dieci pacchetti fanno dieci fasce che gridano tutte insieme. Schiarito resta
 * riconoscibile e sta al suo posto.
 * @param {string|null} colore
 * @returns {string}
 */
function fondo(colore) {
  return colore ? `color-mix(in srgb, ${colore} 42%, var(--surface))` : 'var(--line)';
}

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string[]} props.settimane
 * @param {string} props.settimanaOra
 * @param {string[]} props.pacchettiScelti
 * @param {(voceId: string) => void} props.onSceltaVoce
 */
export default function Gantt({ doc, settimane, settimanaOra, pacchettiScelti, onSceltaVoce }) {
  const [densita, cambiaDensita] = useDensita();
  // Ricordata fra una visita e l'altra, come la densità: è come uno ha lasciato
  // la schermata, e ritrovarla ogni volta senza la coda vorrebbe dire riaprirla
  // ogni volta.
  const [nonProgrammate, setNonProgrammate] = useState(() => readPref(CHIAVE_NONPROG, false) === true);
  const cambiaNonProgrammate = (/** @type {boolean} */ quale) => {
    setNonProgrammate(quale);
    writePref(CHIAVE_NONPROG, quale);
  };

  const righe = useMemo(
    () => gantt(doc, settimane, { pacchetti: pacchettiScelti, conNonProgrammate: nonProgrammate }),
    [doc, settimane, pacchettiScelti, nonProgrammate],
  );
  const gruppiMese = useMemo(() => perMese(settimane), [settimane]);
  const inizioMese = new Set(gruppiMese.map(g => g.settimane[0]));

  const perSettimana = settimane.map((_, i) => righe.reduce((s, r) => s + r.ore[i], 0));
  const totale = perSettimana.reduce((s, o) => s + o, 0);
  const programmate = righe.filter(r => r.totale > 0).length;

  if (!programmate) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          Il Gantt disegna le ore già messe a piano, e in queste settimane non ce n&apos;è
          ancora nessuna: le celle si compilano nella Matrice, e qui compaiono ordinate
          per quando finiscono.
        </p>
      </div>
    );
  }

  return (
    <div className="pg-matrice-guscio">
      <div className="pg-barra">
        <span className="eyebrow">in ordine di fine</span>
        <button
          type="button"
          className={`pg-barra-btn${nonProgrammate ? ' scelto' : ''}`}
          onClick={() => cambiaNonProgrammate(!nonProgrammate)}
          title="In coda, le voci che in queste settimane non hanno nemmeno un'ora"
        >
          non programmate
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
          {programmate} attività · {settimane.length} settimane · {oreBrevi(totale)} h
        </span>
      </div>

      <div className={`pg-matrice pg-densita-${densita}`}>
        <div
          className="pg-griglia pg-gantt"
          style={/** @type {import('react').CSSProperties} */ ({ '--pg-w': `${DENSITA[densita].w}px` })}
        >
          <div className="pg-riga pg-riga-mesi">
            <div className="pg-nome pg-nome-angolo" />
            <div className="pg-gantt-chi pg-nome-angolo" />
            {gruppiMese.map(g => (
              <div key={g.mese} className="pg-mese" style={{ width: `calc(var(--pg-w) * ${g.settimane.length})` }}>
                {nomeMese(g.mese)}
              </div>
            ))}
            <div className="pg-tot pg-tot-angolo" />
          </div>

          <div className="pg-riga pg-riga-testa">
            <div className="pg-nome pg-nome-angolo eyebrow">attività</div>
            <div className="pg-gantt-chi pg-nome-angolo eyebrow">chi</div>
            {settimane.map(w => (
              <div key={w} className={`pg-w${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}>
                <span className="pg-w-iso"><span className="pg-w-w">W</span>{w.slice(6)}</span>
                <span className="pg-w-giorno">{lunediDellaSettimana(w).slice(8)}/{lunediDellaSettimana(w).slice(5, 7)}</span>
              </div>
            ))}
            <div className="pg-tot pg-tot-testa" title="A piano, e dopo la barra le ore stimate della voce">
              tot<span className="pg-tot-stima">/stim</span>
            </div>
          </div>

          {righe.map(riga => (
            <div
              key={riga.chiave}
              className={`pg-riga pg-riga-gantt${riga.totale ? '' : ' pg-riga-orfana'}`}
            >
              <div
                className="pg-nome"
                role={riga.voceId ? 'button' : undefined}
                tabIndex={riga.voceId ? 0 : undefined}
                onClick={() => riga.voceId && onSceltaVoce(riga.voceId)}
                onKeyDown={e => { if (riga.voceId && (e.key === 'Enter' || e.key === ' ')) onSceltaVoce(riga.voceId); }}
                title={[riga.pacchetto, riga.oggetto, riga.attivita].filter(Boolean).join(' › ')}
              >
                <span className="pg-punto" style={riga.colore ? { background: riga.colore } : undefined} />
                <span className="pg-nome-testo">{riga.attivita || riga.oggetto || riga.pacchetto}</span>
                {/* Il ramo sopra la riga, in piccolo: due voci si chiamano
                    «Calcolo» in due pacchetti diversi, e senza questo la
                    tabella ha due righe che sembrano la stessa. Sulla riga del
                    pacchetto il titolo *è* il pacchetto, quindi lì il ramo dice
                    l'altra cosa: che quelle ore nessuna voce le reclama. */}
                <span className="pg-gantt-ramo">
                  {riga.voceId
                    ? [riga.pacchetto, riga.attivita ? riga.oggetto : ''].filter(Boolean).join(' › ')
                    : 'sul pacchetto'}
                </span>
              </div>
              <div className="pg-gantt-chi" title={riga.chi.join(', ')}>
                {riga.chi.join(', ') || (riga.totale ? '' : '—')}
              </div>
              {settimane.map((w, i) => {
                const ore = riga.ore[i];
                const primo = ore > 0 && !(riga.ore[i - 1] > 0);
                const ultimo = ore > 0 && !(riga.ore[i + 1] > 0);
                return (
                  <div
                    key={w}
                    className={[
                      'pg-cella',
                      w === settimanaOra ? 'pg-w-ora' : '',
                      inizioMese.has(w) ? 'pg-mese-inizio' : '',
                    ].filter(Boolean).join(' ')}
                    title={ore
                      ? `${w} · ${riga.chiSettimana[i].join(', ') || 'nessuno'} · ${oreBrevi(ore)} h`
                      : undefined}
                  >
                    {ore > 0 && (
                      <span
                        className={`pg-barra-gantt${primo ? ' pg-barra-inizio' : ''}${ultimo ? ' pg-barra-fine' : ''}`}
                        style={{ background: fondo(riga.colore) }}
                      >
                        {/* Il numero dentro la barra sparisce alla densità
                            stretta: a ventotto pixel è quello che manda la
                            barra a capo, e a quella larghezza si guarda la
                            forma del carico, non la mezz'ora. */}
                        <span className="pg-barra-ore">{oreBrevi(ore)}</span>
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="pg-tot">
                {oreBrevi(riga.totale)}
                {riga.stimate > 0 && <span className="pg-tot-stima">/{oreBrevi(riga.stimate)}</span>}
              </div>
            </div>
          ))}

          <div className="pg-riga pg-riga-piede">
            <div className="pg-nome">totale settimana</div>
            <div className="pg-gantt-chi" />
            {settimane.map((w, i) => (
              <div
                key={w}
                className={`pg-cella pg-cella-piede${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}
              >
                {oreBrevi(perSettimana[i])}
              </div>
            ))}
            <div className="pg-tot">{oreBrevi(totale)}</div>
          </div>
        </div>
      </div>

      <div className="pg-legenda">
        <span className="pg-legenda-nota">una riga per attività, ordinate per quando finiscono</span>
        <span className="pg-legenda-nota">il colore è il pacchetto · col mouse sopra una barra: chi e quante ore</span>
        <span className="pg-legenda-nota">una riga senza Oggetto è lavoro lasciato sul pacchetto, che nessuna voce reclama</span>
      </div>
    </div>
  );
}
