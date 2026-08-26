// @ts-check
// Il riquadro Movimento in «Oggi»: la settimana, l'obiettivo, e tre bottoni
// per registrare.
//
// Prima qui c'era un rettangolo bloccato e inerte, dichiarato come segnaposto
// perché non esisteva nessuna fonte dati sugli allenamenti. Ora la fonte c'è,
// ed è doppia — e la separazione fra le due è l'idea che regge tutto il
// riquadro:
//
//   il calendario tiene i PROGRAMMI, il registro su OneDrive tiene il FATTO.
//
// Le barre piene sono sessioni registrate, quelle tratteggiate sono sessioni
// previste e non ancora fatte. Il denominatore di «2 su 4» viene dal
// calendario, il numeratore dal registro: nessun obiettivo da configurare
// nell'app, perché il minimo settimanale è già la serie ricorrente che hai
// messo in agenda, e si cambia dove si cambiano tutti gli altri impegni.
//
// Il calendario è di SOLA LETTURA. Registrare una sessione non crea, non
// sposta e non cancella nessun evento: così l'app non può rovinare impegni
// veri, e la sincronizzazione resta a senso unico e prevedibile.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCalendars, loadMovimentoIndex, loadMovimentoMese, saveMovimento, saveMovimentoIndex,
} from './api';
import {
  FAMIGLIE, INIZIALI_GIORNI, ORDINE_FAMIGLIE, altezzaSegmento, coloreFamiglia,
  fmtDurata, meseDi, mesePrecedente, settimanaDi, striscia, totali,
} from './movimento';
import MovimentoQuickAdd from './MovimentoQuickAdd';
import './MovimentoCard.css';

/** Altezza della colonna più alta, in pixel. Vedi altezzaSegmento. */
const MAX_PX = 42;

/** La data locale 'YYYY-MM-DD' di un evento Graph. */
function dataEvento(/** @type {any} */ ev) {
  const iso = ev?.start?.dateTime;
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 * Legge il registro dei due mesi che servono: quello corrente per la settimana
 * e i totali, il precedente perché una striscia a cavallo del primo del mese
 * non deve azzerarsi per un motivo di archiviazione.
 * @param {string} oggi
 */
function useRegistro(oggi) {
  const [voci, setVoci] = useState(/** @type {import('./types').Movimento[]|null} */ (null));
  const [indice, setIndice] = useState(/** @type {import('./types').MovimentoIndex|null} */ (null));

  const ricarica = useCallback(async () => {
    const ym = meseDi(oggi);
    const idx = await loadMovimentoIndex();
    const mesi = [mesePrecedente(ym), ym].filter(m => idx.months.length === 0 || idx.months.includes(m));
    const caricate = await Promise.all(mesi.map(m => loadMovimentoMese(m).catch(() => [])));
    return { voci: caricate.flat(), indice: idx };
  }, [oggi]);

  useEffect(() => {
    let annullato = false;
    ricarica()
      .then(r => { if (!annullato) { setVoci(r.voci); setIndice(r.indice); } })
      .catch(e => {
        console.error('registro movimento', e);
        if (!annullato) { setVoci([]); setIndice({ months: [], calendarId: null, calendarName: null }); }
      });
    return () => { annullato = true; };
  }, [ricarica]);

  return { voci, indice, setVoci, setIndice };
}

/**
 * @param {Object} props
 * @param {string} props.today                                'YYYY-MM-DD'
 * @param {import('./types').CalendarEvent[]} props.calendarEvents  già caricati da App
 */
export default function MovimentoCard({ today, calendarEvents }) {
  const { voci, indice, setVoci, setIndice } = useRegistro(today);
  // { famiglia, data, preset } — il modulo aperto, o null.
  const [modulo, setModulo] = useState(/** @type {any} */ (null));
  const [sceltaCal, setSceltaCal] = useState(false);

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
  const strisciaGiorni = useMemo(() => striscia((voci || []).map(v => v.date), today), [voci, today]);

  // «2 su 4»: il denominatore è quanto avevi programmato per la settimana
  // (previste rimaste + quelle già onorate), il numeratore quante ne hai
  // chiuse. Conta solo le sessioni che nascono dal calendario: registrare tre
  // corse a sorpresa non deve far risultare «5 su 4».
  const obiettivo = useMemo(() => {
    if (!indice?.calendarId) return null;
    const inSettimana = new Set(giorni);
    const rimaste = giorni.reduce((n, g) => n + (previstePerGiorno[g]?.length || 0), 0);
    const onorate = (voci || []).filter(v => v.daEvento && inSettimana.has(v.date)).length;
    const totale = rimaste + onorate;
    return totale > 0 ? { fatte: onorate, totale } : null;
  }, [indice, giorni, previstePerGiorno, voci]);

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

  async function scegliCalendario(/** @type {{id: string, name: string}|null} */ cal) {
    const scelta = { calendarId: cal?.id ?? null, calendarName: cal?.name ?? null };
    setIndice(prev => ({ months: prev?.months || [], ...scelta }));
    setSceltaCal(false);
    try {
      // L'elenco dei mesi si rilegge invece di riusare quello in memoria: nel
      // file c'è anche l'indice del registro, e sovrascriverlo con la copia
      // che avevamo in mano — magari vuota perché il caricamento non era
      // finito, o vecchia di una sessione registrata altrove — cancellerebbe
      // il modo di ritrovare i mesi già scritti.
      const attuale = await loadMovimentoIndex();
      await saveMovimentoIndex({ ...attuale, ...scelta });
    } catch (e) {
      console.error('salva calendario movimento', e);
    }
  }

  const caricando = voci === null;

  return (
    <section className="today-card mv-card">
      <div className="mv-head">
        <span className="eyebrow">Movimento</span>
        <button
          className="mv-cal-btn"
          onClick={() => setSceltaCal(true)}
          title={indice?.calendarId
            ? `Sessioni programmate da «${indice.calendarName}»`
            : 'Collega un calendario per vedere le sessioni programmate'}>
          {indice?.calendarId ? indice.calendarName : 'Collega un calendario'}
        </button>
      </div>

      <div className="mv-week" aria-hidden={caricando}>
        {giorni.map((g, i) => {
          const fatte = fattePerGiorno[g] || [];
          const previste = previstePerGiorno[g] || [];
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
              </div>
              <span className="mv-day-label">{INIZIALI_GIORNI[i]}</span>
            </div>
          );
        })}
      </div>

      <p className="mv-meta">
        {caricando ? '…' : settimana.sessioni === 0
          ? (indice?.calendarId
            ? 'Nessuna sessione questa settimana.'
            : 'Nessuna sessione questa settimana. Collega il calendario in cui programmi gli allenamenti e le sessioni previste compariranno qui.')
          : [
            `${settimana.sessioni} ${settimana.sessioni === 1 ? 'sessione' : 'sessioni'}`,
            fmtDurata(settimana.minuti),
            strisciaGiorni > 0 ? `${strisciaGiorni} ${strisciaGiorni === 1 ? 'giorno' : 'giorni'} di fila` : null,
          ].filter(Boolean).join(' · ')}
      </p>

      {obiettivo && (
        <div className="mv-goal">
          <div className="mv-goal-row">
            <span className="mv-goal-label">Programmate questa settimana</span>
            <span className="mv-goal-val">
              <b>{obiettivo.fatte}</b> su {obiettivo.totale}
              {obiettivo.fatte >= obiettivo.totale ? ' · fatto' : ''}
            </span>
          </div>
          <div className="mv-bar">
            <i style={{ width: `${(obiettivo.fatte / obiettivo.totale) * 100}%` }} />
            <i className="previsto" style={{ width: `${100 - (obiettivo.fatte / obiettivo.totale) * 100}%` }} />
          </div>
        </div>
      )}

      {previstaOggi && (
        <div className="mv-today">
          <span className="mv-today-dot" />
          <span className="mv-today-txt">
            {[previstaOggi.subject || 'Sessione', `oggi ${oraEvento(previstaOggi)}`, fmtDurata(durataEvento(previstaOggi))]
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

      <div className="mv-add">
        {ORDINE_FAMIGLIE.map(f => (
          <button
            key={f}
            className={`mv-add-btn ${f}`}
            style={/** @type {import('react').CSSProperties} */ ({ '--fam': FAMIGLIE[f].colore })}
            onClick={() => setModulo({ famiglia: f, data: today, preset: null })}>
            {FAMIGLIE[f].breve}
          </button>
        ))}
      </div>

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

      {sceltaCal && (
        <CalendarioPicker
          scelto={indice?.calendarId || null}
          onScegli={scegliCalendario}
          onChiudi={() => setSceltaCal(false)}
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
 * La scelta del calendario dei programmi.
 *
 * Sta qui dentro e non nelle Impostazioni generali per due motivi: quelle sono
 * «colori di taccuini e sezioni», e questa preferenza si cerca dove se ne
 * vedono gli effetti. È anche l'unica impostazione della scheda, e una schermata
 * di impostazioni per un campo solo è un posto in cui non si torna mai.
 * @param {{ scelto: string|null, onScegli: (cal: any) => void, onChiudi: () => void }} props
 */
function CalendarioPicker({ scelto, onScegli, onChiudi }) {
  const [cals, setCals] = useState(/** @type {any[]|null} */ (null));

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
          <span className="mq-title">Calendario dei programmi</span>
        </div>
        <p className="mv-picker-note">
          Da qui arrivano le sessioni previste. Un calendario dedicato — anche
          con una serie ricorrente: quella serie è il tuo minimo settimanale.
          L'app lo legge soltanto, non ci scrive mai.
        </p>
        {cals === null && <p className="mv-picker-vuoto">Carico i calendari…</p>}
        {cals?.length === 0 && <p className="mv-picker-vuoto">Nessun calendario disponibile.</p>}
        <div className="mv-picker-list">
          {(cals || []).map(c => (
            <button
              key={c.id}
              className={`mv-picker-row${c.id === scelto ? ' sel' : ''}`}
              onClick={() => onScegli(c)}>
              <span className="mv-picker-name">{c.name}</span>
              {c.id === scelto && <span className="mv-picker-check">✓</span>}
            </button>
          ))}
        </div>
        <div className="mq-actions">
          {scelto && (
            <button className="mq-annulla" onClick={() => onScegli(null)}>Scollega</button>
          )}
          <button className="mq-salva" onClick={onChiudi}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
