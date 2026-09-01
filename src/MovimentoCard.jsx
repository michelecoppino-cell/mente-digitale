// @ts-check
// Il riquadro Movimento in «Oggi»: la settimana a sinistra, le tre famiglie
// con il loro bersaglio a destra.
//
// La separazione che regge tutto il riquadro non è cambiata:
//
//   il calendario tiene i PROGRAMMI, il registro su OneDrive tiene il FATTO.
//
// Le barre piene sono sessioni registrate, quelle tratteggiate sono sessioni
// previste e non ancora fatte.
//
// Quello che è cambiato è il modo di dire «quanto». Prima c'era una sola riga
// «2 su 4» col denominatore preso dal calendario. Funzionava finché il
// movimento era una cosa sola, ma un allenamento, una meditazione e un'ora di
// yoga non sono intercambiabili: «4 su 6» può voler dire una settimana piena
// oppure sei meditazioni da dieci minuti e nessun allenamento, e sono due
// settimane molto diverse. Ora le famiglie hanno una riga ciascuna, con un
// bersaglio settimanale che si sceglie una volta (sta nell'indice del
// registro, accanto al calendario) e resta.
//
// Il calendario è di SOLA LETTURA. Registrare una sessione non crea, non
// sposta e non cancella nessun evento.
import { useEffect, useMemo, useState } from 'react';
import { getCalendars, loadMovimentoIndex, saveMovimento, saveMovimentoIndex } from './api';
import {
  FAMIGLIE, INIZIALI_GIORNI, ORDINE_FAMIGLIE, altezzaSegmento, bersaglioDi, coloreFamiglia,
  fmtDurata, settimanaDi, totali, totaliPerFamiglia,
} from './movimento';
import MovimentoQuickAdd from './MovimentoQuickAdd';
import { Matita } from './Matita';
import { riassuntoDelGiorno } from './rituale';
import './MovimentoCard.css';
import { ymd } from './tempo.js';

/** Altezza della colonna più alta, in pixel. Vedi altezzaSegmento. */
const MAX_PX = 40;

/** La data locale 'YYYY-MM-DD' di un evento Graph. */
function dataEvento(/** @type {any} */ ev) {
  const iso = ev?.start?.dateTime;
  if (!iso) return '';
  return ymd(new Date(iso.endsWith('Z') ? iso : iso + 'Z'));
}

/** "18:30" */
function oraEvento(/** @type {any} */ ev) {
  const iso = ev?.start?.dateTime;
  if (!iso) return '';
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z')
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Minuti fra inizio e fine di un evento; 45 se il calendario non lo dice. */
function durataEvento(/** @type {any} */ ev) {
  const a = ev?.start?.dateTime, b = ev?.end?.dateTime;
  if (!a || !b) return 45;
  const min = Math.round(
    (new Date(b.endsWith('Z') ? b : b + 'Z').getTime() - new Date(a.endsWith('Z') ? a : a + 'Z').getTime()) / 60_000
  );
  return min > 0 && min < 600 ? min : 45;
}

/**
 * A quale famiglia appartiene un evento programmato, dal suo titolo.
 *
 * Questa è l'unica euristica sul testo che mi concedo, e sta qui e non nel
 * filtro degli eventi per una ragione precisa: **quali** eventi contano lo
 * decide il calendario scelto (una proprietà del dato, non una parola nel
 * titolo), e questa funzione decide solo di che colore disegnare una barra che
 * comparirebbe comunque. Se sbaglia, sbaglia una tinta: nessun evento entra o
 * esce dal riquadro per colpa sua. Nel dubbio è movimento, che è il caso più
 * frequente di gran lunga.
 * @param {any} ev
 * @returns {keyof typeof FAMIGLIE}
 */
function famigliaEvento(ev) {
  const t = (ev?.subject || '').toLowerCase();
  if (/yoga|pilates|mobilit/.test(t)) return 'yoga';
  if (/medita|respir|mindful|body ?scan/.test(t)) return 'meditazione';
  return 'movimento';
}

/**
 * @param {Object} props
 * @param {string} props.today                                'YYYY-MM-DD'
 * @param {import('./types').CalendarEvent[]} props.calendarEvents  già caricati da App
 * @param {ReturnType<typeof import('./registroMovimento').useRegistroMovimento>} props.registro
 * @param {Record<string, import('./types').RitualeGiorno>|null} [props.rituale]  le risposte del mattino
 * @param {() => void} [props.onApriRituale]
 */
export default function MovimentoCard({ today, calendarEvents, registro, rituale, onApriRituale }) {
  const { voci, indice, setVoci, setIndice } = registro;
  // { famiglia, data, preset } — il modulo aperto, o null.
  const [modulo, setModulo] = useState(/** @type {any} */ (null));
  const [impostazioni, setImpostazioni] = useState(false);

  const giorni = useMemo(() => settimanaDi(today), [today]);

  // ── Il fatto: le sessioni registrate, raggruppate per giorno ────────────
  const fattePerGiorno = useMemo(() => {
    /** @type {Record<string, import('./types').Movimento[]>} */
    const m = {};
    for (const v of voci || []) (m[v.date] ||= []).push(v);
    return m;
  }, [voci]);

  // ── Il programmato: gli eventi del calendario scelto, meno quelli già
  //    soddisfatti da una sessione registrata (è a questo che serve daEvento).
  const previstePerGiorno = useMemo(() => {
    /** @type {Record<string, any[]>} */
    const m = {};
    const calId = indice?.calendarId;
    if (!calId) return m;
    const soddisfatti = new Set((voci || []).map(v => v.daEvento).filter(Boolean));
    for (const ev of calendarEvents || []) {
      if (ev._calId !== calId || soddisfatti.has(ev.id)) continue;
      const d = dataEvento(ev);
      if (d) (m[d] ||= []).push(ev);
    }
    return m;
  }, [calendarEvents, indice, voci]);

  const settimana = useMemo(() => totali(voci || [], giorni), [voci, giorni]);
  const perFamiglia = useMemo(() => totaliPerFamiglia(voci || [], giorni), [voci, giorni]);

  // La prima sessione prevista per oggi e non ancora registrata: è il caso più
  // frequente in assoluto, e merita una riga sua con un tasto solo.
  const previstaOggi = (previstePerGiorno[today] || [])[0] || null;

  async function registra(/** @type {import('./types').Movimento} */ voce) {
    await saveMovimento(voce);
    // Aggiunta in locale invece di rileggere il mese: il file l'abbiamo appena
    // scritto noi, e una seconda richiesta a OneDrive per sapere quello che
    // sappiamo già farebbe aspettare la barra a metà animazione.
    setVoci(prev => [...(prev || []), voce]);
  }

  /**
   * @param {{ calendarId: string|null, calendarName: string|null }} cal
   * @param {Record<string, number>} bersagli
   */
  async function salvaImpostazioni(cal, bersagli) {
    setIndice(prev => ({ months: prev?.months || [], ...cal, bersagli }));
    setImpostazioni(false);
    try {
      // L'elenco dei mesi si rilegge invece di riusare quello in memoria: nel
      // file c'è anche l'indice del registro, e sovrascriverlo con la copia
      // che avevamo in mano — magari vuota perché il caricamento non era
      // finito, o vecchia di una sessione registrata altrove — cancellerebbe
      // il modo di ritrovare i mesi già scritti.
      const attuale = await loadMovimentoIndex();
      await saveMovimentoIndex({ ...attuale, ...cal, bersagli });
    } catch (e) {
      console.error('salva impostazioni movimento', e);
    }
  }

  const caricando = voci === null;

  return (
    <section className="today-card mv-card">
      <div className="mv-head">
        <div className="today-card-titolo">
          <span className="eyebrow">Movimento</span>
          {/* Il mattino. Era una riga larga quanto il riquadro, con dentro il
              riassunto di oggi — «yoga fatto · movimento, meditazione no
              (lavorato)» — e una freccia. Adesso il riassunto è il title della
              matita: si legge passandoci sopra, che è il momento in cui uno se
              lo sta chiedendo, e non occupa una riga per dirlo a chi non se lo
              stava chiedendo affatto. */}
          {onApriRituale && (
            <Matita
              onClick={onApriRituale}
              title={`Il mattino${rituale ? `: ${riassuntoDelGiorno(rituale, today) || 'nessuna risposta oggi'}` : ''}`}
            />
          )}
        </div>
        <div className="mv-head-right">
          <span className="mv-tot">
            {caricando ? '…' : settimana.sessioni === 0
              ? 'nessuna sessione'
              : `${settimana.sessioni} ${settimana.sessioni === 1 ? 'sessione' : 'sessioni'} · ${fmtDurata(settimana.minuti)}`}
          </span>
          <button
            className="mv-set-btn"
            onClick={() => setImpostazioni(true)}
            title={indice?.calendarId
              ? `Sessioni programmate da «${indice.calendarName}». Cambia calendario e bersagli.`
              : 'Scegli il calendario dei programmi e i bersagli della settimana'}
            aria-label="Impostazioni del movimento">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mv-body">
        {/* La settimana: una colonna per giorno, un segmento per sessione. */}
        <div className="mv-week" aria-hidden={caricando}>
          {giorni.map((g, i) => {
            const fatte = fattePerGiorno[g] || [];
            const previste = previstePerGiorno[g] || [];
            const vuoto = fatte.length === 0 && previste.length === 0;
            return (
              <div className={`mv-day${g === today ? ' oggi' : ''}`} key={g}>
                <div className="mv-stack" title={etichettaGiorno(g, fatte, previste)}>
                  {previste.map(ev => (
                    <i
                      key={ev.id}
                      className="mv-seg previsto"
                      style={{ height: altezzaSegmento(durataEvento(ev), MAX_PX) }} />
                  ))}
                  {fatte.map(v => (
                    <i
                      key={v.id}
                      className="mv-seg"
                      style={{
                        height: altezzaSegmento(v.durataMin, MAX_PX),
                        background: coloreFamiglia(v.famiglia),
                      }} />
                  ))}
                  {/* Un giorno senza niente non è una colonna vuota ma un
                      trattino: la riga di base si vede, e la settimana resta
                      leggibile come settimana invece che come tre barre in
                      mezzo al nulla. */}
                  {vuoto && <i className="mv-seg niente" />}
                </div>
                <span className="mv-day-label">{INIZIALI_GIORNI[i]}</span>
              </div>
            );
          })}
        </div>

        {/* Le tre famiglie: quante ne hai fatte, su quante te ne eri date. */}
        <div className="mv-fam">
          {ORDINE_FAMIGLIE.map(f => {
            const fatte = perFamiglia[f]?.sessioni || 0;
            const bersaglio = bersaglioDi(indice, f);
            return (
              <button
                key={f}
                className={`mv-fam-riga${bersaglio && fatte >= bersaglio ? ' fatto' : ''}`}
                onClick={() => setModulo({ famiglia: f, data: today, preset: null })}
                title={`Registra una sessione di ${FAMIGLIE[f].label.toLowerCase()}`}>
                <span className="mv-fam-dot" style={{ background: FAMIGLIE[f].colore }} />
                <span className="mv-fam-nome">{FAMIGLIE[f].label}</span>
                <span className="mv-fam-num">{bersaglio ? `${fatte}/${bersaglio}` : `${fatte}`}</span>
              </button>
            );
          })}
        </div>
      </div>

      {previstaOggi && (
        <div className="mv-today">
          <span className="mv-today-dot" />
          <span className="mv-today-txt">
            {[previstaOggi.subject || 'Sessione', `oggi ${oraEvento(previstaOggi)}`]
              .filter(Boolean).join(' · ')}
          </span>
          <button
            className="mv-today-btn"
            onClick={() => setModulo({
              famiglia: famigliaEvento(previstaOggi),
              data: today,
              preset: {
                tipo: previstaOggi.subject,
                durataMin: durataEvento(previstaOggi),
                daEvento: previstaOggi.id,
                titolo: previstaOggi.subject,
              },
            })}>
            Fatta
          </button>
        </div>
      )}

      {/* Non c'è più un «Registra una sessione →» in fondo: registrava sempre
          e comunque un movimento, mentre le tre righe qui sopra sono già tre
          bottoni che aprono lo stesso modulo sulla famiglia giusta. Era una
          quarta porta per la stessa stanza, con la serratura peggiore. */}

      {modulo && (
        <MovimentoQuickAdd
          famiglia={modulo.famiglia}
          data={modulo.data}
          oggi={today}
          voci={voci || []}
          preset={modulo.preset}
          onSalva={registra}
          onChiudi={() => setModulo(null)}
        />
      )}

      {impostazioni && (
        <ImpostazioniMovimento
          indice={indice}
          onSalva={salvaImpostazioni}
          onChiudi={() => setImpostazioni(false)}
        />
      )}
    </section>
  );
}

/** Il testo che compare passando sopra una colonna della settimana. */
function etichettaGiorno(/** @type {string} */ g, /** @type {any[]} */ fatte, /** @type {any[]} */ previste) {
  const righe = [
    ...fatte.map(v => `${v.tipo} · ${fmtDurata(v.durataMin)}${v.nota ? ` · ${v.nota}` : ''}`),
    ...previste.map(ev => `${ev.subject || 'Sessione'} · programmata`),
  ];
  return righe.length ? `${g}\n${righe.join('\n')}` : `${g}\nniente`;
}

/**
 * Le due impostazioni della scheda: il calendario dei programmi e i bersagli
 * settimanali.
 *
 * Stanno qui dentro e non nelle Impostazioni generali per due motivi: quelle
 * sono «colori di taccuini e sezioni», e una preferenza si cerca dove se ne
 * vedono gli effetti. Sono anche due sole, e una schermata di impostazioni per
 * due campi è un posto in cui non si torna mai.
 * @param {Object} props
 * @param {import('./types').MovimentoIndex|null} props.indice
 * @param {(cal: {calendarId: string|null, calendarName: string|null}, bersagli: Record<string, number>) => void} props.onSalva
 * @param {() => void} props.onChiudi
 */
function ImpostazioniMovimento({ indice, onSalva, onChiudi }) {
  const [cals, setCals] = useState(/** @type {any[]|null} */ (null));
  const [scelto, setScelto] = useState(/** @type {{id: string|null, name: string|null}} */ ({
    id: indice?.calendarId || null, name: indice?.calendarName || null,
  }));
  const [bersagli, setBersagli] = useState(() => {
    /** @type {Record<string, number>} */
    const b = {};
    for (const f of ORDINE_FAMIGLIE) b[f] = bersaglioDi(indice, f);
    return b;
  });

  useEffect(() => {
    let annullato = false;
    getCalendars()
      .then(c => { if (!annullato) setCals(c); })
      .catch(e => { console.error('elenco calendari', e); if (!annullato) setCals([]); });
    return () => { annullato = true; };
  }, []);

  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) { if (e.key === 'Escape') onChiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <div className="mq-sheet mv-picker" onClick={e => e.stopPropagation()}>
        <div className="mq-head">
          <span className="mq-title">Movimento</span>
        </div>

        <p className="mv-picker-note">
          Quante sessioni a settimana ti sei dato. Zero vuol dire «non me lo
          conto»: la riga resta, e mostra soltanto quante ne hai fatte.
        </p>
        <div className="mv-bersagli">
          {ORDINE_FAMIGLIE.map(f => (
            <label className="mv-bersaglio" key={f}>
              <span className="mv-fam-dot" style={{ background: FAMIGLIE[f].colore }} />
              <span className="mv-bersaglio-nome">{FAMIGLIE[f].label}</span>
              <input
                type="number"
                min="0"
                max="21"
                inputMode="numeric"
                value={bersagli[f]}
                onChange={e => setBersagli(b => ({ ...b, [f]: Math.max(0, Math.min(21, Number(e.target.value) || 0)) }))}
              />
              <span className="mv-bersaglio-unita">a settimana</span>
            </label>
          ))}
        </div>

        <p className="mv-picker-note">
          Da questo calendario arrivano le sessioni previste — le barre
          tratteggiate. L'app lo legge soltanto, non ci scrive mai.
        </p>
        {cals === null && <p className="mv-picker-vuoto">Carico i calendari…</p>}
        {cals?.length === 0 && <p className="mv-picker-vuoto">Nessun calendario disponibile.</p>}
        <div className="mv-picker-list">
          {(cals || []).map(c => (
            <button
              key={c.id}
              className={`mv-picker-row${c.id === scelto.id ? ' sel' : ''}`}
              onClick={() => setScelto(s => (s.id === c.id ? { id: null, name: null } : { id: c.id, name: c.name }))}>
              <span className="mv-picker-name">{c.name}</span>
              {c.id === scelto.id && <span className="mv-picker-check">✓</span>}
            </button>
          ))}
        </div>

        <div className="mq-actions">
          <button className="mq-annulla" onClick={onChiudi}>Annulla</button>
          <button
            className="mq-salva"
            onClick={() => onSalva({ calendarId: scelto.id, calendarName: scelto.name }, bersagli)}>
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
