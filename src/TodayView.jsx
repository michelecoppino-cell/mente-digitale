// @ts-check
// Oggi: la home, di sola lettura.
//
// L'app si apriva sulla mappa mentale — una vista dello spazio, non del tempo.
// Aprendo il portatile la domanda però è «cosa succede oggi», e la risposta
// stava sparsa fra tre pannelli da aprire a mano. Qui non c'è niente di nuovo
// da salvare: è una lettura delle strutture che già esistono (il piano del
// giorno, il calendario, le attività), messe in fila nell'ordine in cui
// servono.
//
// Nessuna lista è "di Oggi": tutto è una query sul giorno corrente.
//
// ── La forma della scheda ──────────────────────────────────────────────────
// Due metà. A sinistra la **giornata operativa**: adesso, l'agenda, le azioni
// programmate — le cose che hanno un'ora. A destra la **vita**: gli obiettivi
// del mese, il movimento, quello che c'è da leggere e vedere; e in una colonna
// sua, più stretta, i tre riquadri che stanno dietro il PIN.
//
// Prima era una colonna sola di riquadri scollegati, e i giorni senza blocchi
// programmati lasciavano mezza schermata vuota. La divisione non è estetica:
// la metà sinistra invecchia nell'arco della giornata, la metà destra
// nell'arco del mese, e tenerle vicine ma separate è quello che permette alla
// scheda di avere sempre la stessa forma anche quando l'agenda è vuota.
//
// ── Cosa sta dietro il PIN ─────────────────────────────────────────────────
// Bussola, Finanze e Diario. Sono i tre riquadri che non si vogliono leggere
// alle spalle di chi lavora, e da quando sono tre stanno in una colonna sola:
// un velo per colonna invece di tre veli sparsi in mezzo alle cose pubbliche.
// Il Diario ci è entrato quando ha smesso di essere un invito e ha cominciato
// a mostrare una voce vera — vedi DiarioCard.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  loadCoda, loadDiaryIndex, loadDiaryMonth, loadIdentityDoc, loadObiettivi,
} from './api';
import { parseWishes, wishSection, wishOfTheDay } from './wishes';
import { entryOfTheDay, dailyIndex, excerpt, monthKey, shiftMonth } from './diary';
import { taskContext, taskStatus, contextColor, inboxListId, indexScheduled } from './taskModel';
import {
  MAX_IN_CODA, MAX_IN_CORSO, dominio, etichettaAvanzamento, etichettaTipo, inCoda, inCorso, quota,
} from './coda';
import { giorniRestanti, meseDi, obiettiviDelMese, risolvi } from './obiettivi';
import SensitiveCard from './SensitiveCard';
import MovimentoCard from './MovimentoCard';
import { useRegistroMovimento } from './registroMovimento';
import ObiettiviModal from './ObiettiviModal';
import CodaModal from './CodaModal';
import { useSbloccato } from './finanze/sblocco';
import { caricaRiepilogoOggi } from './finanze/riepilogoOggi';
import './TodayView.css';

/** 'YYYY-MM-DD' locale. */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Minuti da mezzanotte di una "HH:MM". */
function t2m(/** @type {string} */ t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

/** "1h40", "25 min" — quanto resta, detto come lo direbbe una persona. */
function fmtLeft(/** @type {number} */ min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function fmtHours(/** @type {number} */ min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** L'ora di inizio di un evento Graph, come "HH:MM". */
function evTime(/** @type {any} */ iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** La data locale 'YYYY-MM-DD' di un evento Graph. */
function evDate(/** @type {any} */ iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return todayStr(d);
}

/** Iniziali per il cerchietto delle ricorrenze. */
function initials(/** @type {string} */ name) {
  return (name || '?')
    .replace(/complean\w*\s+(di\s+)?/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}

const RECURRENCE_RE = /complean|ricorrenz|anniversar|onomastic/i;

/** Una ricorrenza è un evento come gli altri, solo che torna ogni anno. */
function isRecurrence(/** @type {any} */ e) {
  return RECURRENCE_RE.test(e._calName || '') || RECURRENCE_RE.test(e.subject || '');
}

/** "ven 22" — l'etichetta di una data futura in agenda. */
function fmtDayLabel(/** @type {string} */ ymd) {
  return new Date(ymd + 'T00:00:00')
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })
    .replace('.', '');
}

/** "25 ago" — una data breve, per le righe di servizio. */
function fmtBreve(/** @type {string} */ ymd) {
  return new Date(ymd + 'T00:00:00')
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

/** Giorni interi fra due 'YYYY-MM-DD'. */
function daysBetween(/** @type {string} */ from, /** @type {string} */ to) {
  return Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000);
}

// Quanto lontano guarda la parte «in arrivo» dell'agenda. Le due finestre sono
// diverse di proposito: un appuntamento fra tre settimane non è cosa di oggi e
// sta nel Piano, mentre un compleanno fra tre settimane è esattamente il tipo
// di cosa che si vuole vedere in anticipo, perché richiede di preparare
// qualcosa.
const AHEAD_APPOINTMENTS = 7;
const AHEAD_RECURRENCES = 30;
const AHEAD_MAX_ROWS = 5;

/**
 * Giorni consecutivi di diario che finiscono oggi (o ieri: la giornata non è
 * ancora finita, e azzerare la striscia alle 00:01 sarebbe una punizione per
 * qualcosa che non è ancora successo).
 * @param {string[]} dates  'YYYY-MM-DD', anche ripetute
 * @returns {number}
 */
function diaryStreak(dates) {
  const set = new Set(dates);
  const today = new Date();
  let cursor = new Date(today);
  if (!set.has(todayStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(todayStr(cursor))) return 0;
  }
  let n = 0;
  while (set.has(todayStr(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/**
 * Carica quel tanto di diario che serve alla striscia: mese corrente e
 * precedente. Oltre non serve — una striscia più lunga di due mesi si
 * racconta lo stesso come «60 giorni di fila».
 *
 * Tiene solo le **date**, non i testi: servono alla striscia, alle sette
 * barrette e all'obiettivo «diario ogni giorno», e nessuna delle tre ha
 * bisogno di sapere cosa c'è scritto. Il testo si legge altrove e solo dopo il
 * PIN (vedi useVoceDelGiorno).
 */
function useDiarioDate() {
  const [stato, setStato] = useState(/** @type {{date: string[], index: any}|null} */ (null));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadDiaryIndex();
        const wanted = [monthKey(), shiftMonth(monthKey(), -1)];
        const months = wanted.filter(m => !index?.months || index.months.includes(m));
        const dates = [];
        for (const m of months) {
          const entries = await loadDiaryMonth(m);
          for (const e of entries || []) if (e?.date && !e.sealed) dates.push(e.date);
        }
        if (!cancelled) setStato({ date: dates, index });
      } catch (e) {
        console.error('striscia diario', e);
        if (!cancelled) setStato({ date: [], index: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return stato;
}

/**
 * Una lettura da OneDrive tenuta per tutta la sessione, con un modo di
 * rileggerla dopo una scrittura.
 *
 * Serve due volte identica — obiettivi e coda — e sono due file che si aprono
 * a ogni ingresso in «Oggi» e cambiano una volta ogni tanto: rileggerli
 * passando da un'altra vista e tornando sarebbe una richiesta buttata via.
 * @template T
 * @param {() => Promise<T>} leggi
 * @param {T} vuoto
 * @returns {{ dato: T, aggiorna: (d: T) => void }}
 */
function useDatoOneDrive(leggi, vuoto) {
  const [dato, setDato] = useState(/** @type {T} */ (vuoto));
  useEffect(() => {
    let annullato = false;
    leggi()
      .then(d => { if (!annullato) setDato(d); })
      .catch(e => { console.error('lettura OneDrive', e); });
    return () => { annullato = true; };
    // `leggi` è una funzione importata, stabile fra i render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { dato, aggiorna: useCallback((/** @type {T} */ d) => setDato(d), []) };
}

/**
 * @param {Object} props
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {import('./types').TodoList[]} [props.todoLists]
 * @param {import('./types').CalendarEvent[]} props.calendarEvents
 * @param {(block: any) => void} props.onCompleteBlock
 * @param {(which: 'bussola'|'visione'|'desideri') => void} props.onOpenIdentity
 */
export default function TodayView({ plans, tasks, todoLists, calendarEvents, onCompleteBlock, onOpenIdentity }) {
  const navigate = useNavigate();
  // Un tick al minuto: basta a far avanzare "restano 1h40" e a far passare la
  // card da ADESSO a PROSSIMO senza ricaricare.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = todayStr(now);
  const ym = meseDi(today);
  const { docs: identityDocs } = useIdentityDocs();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const diario = useDiarioDate();

  // Le sessioni di movimento si leggono qui e non dentro il riquadro: servono
  // anche agli obiettivi del mese («Palestra 7/12»), e leggerle due volte
  // vorrebbe dire due richieste per lo stesso file e due verità che possono
  // divergere fra un riquadro e quello accanto.
  const registro = useRegistroMovimento(today);
  const { dato: obiettiviDoc, aggiorna: aggiornaObiettivi } = useDatoOneDrive(loadObiettivi, /** @type {any} */ ({}));
  const { dato: coda, aggiorna: aggiornaCoda } = useDatoOneDrive(loadCoda, /** @type {import('./types').VoceCoda[]} */ ([]));

  const [modale, setModale] = useState(/** @type {'obiettivi'|'coda'|null} */ (null));

  const blocks = useMemo(
    () => [...(plans?.[today]?.blocks || [])].sort((a, b) => t2m(a.startTime) - t2m(b.startTime)),
    [plans, today]
  );

  const taskById = useMemo(() => new Map((tasks || []).map(t => [t.id, t])), [tasks]);

  const current = blocks.find(b => !b.completed && t2m(b.startTime) <= nowMin && nowMin < t2m(b.endTime));
  const upcoming = blocks.find(b => !b.completed && t2m(b.startTime) > nowMin);
  const focus = current || upcoming || null;
  // Il blocco dopo quello in corso. Veniva già calcolato e poi buttato via
  // ogni volta che c'era un `current`: sapere cosa viene dopo è metà del
  // motivo per cui si guarda «Adesso» — l'altra metà è quanto manca.
  const poi = current ? upcoming : null;

  // Quante cose aspettano di essere chiarite: è il numero che decide se vale
  // la pena passare dall'Inbox oggi. Sta in testata e non in un riquadro
  // perché non è una cosa da leggere, è una cosa da fare (o da non fare).
  const daChiarire = useMemo(() => {
    const inbox = inboxListId(todoLists || []);
    if (!inbox) return 0;
    const scheduledIds = new Set(indexScheduled(plans).keys());
    return (tasks || []).filter(t => taskStatus(t, { scheduledIds, inboxListId: inbox }) === 'inbox').length;
  }, [tasks, todoLists, plans]);

  // Le prossime azioni senza un blocco nel Piano: il serbatoio da cui si pesca
  // quando la giornata si libera.
  const nonProgrammate = useMemo(() => {
    const inbox = inboxListId(todoLists || []);
    const scheduledIds = new Set(indexScheduled(plans).keys());
    return (tasks || []).filter(t => taskStatus(t, { scheduledIds, inboxListId: inbox }) === 'next').length;
  }, [tasks, todoLists, plans]);

  // Agenda e Ricorrenze erano due riquadri lontani fra loro, ma sono la stessa
  // cosa: eventi del calendario Microsoft, tagliati su due finestre di tempo
  // diverse. Tenerli separati voleva dire che il compleanno di oggi finiva
  // nella colonna di destra, in mezzo a quelli fra tre settimane, invece che in
  // agenda accanto agli altri impegni della giornata. Qui c'è una sola
  // cronologia: prima oggi, poi quello che arriva.
  const { events, ahead, aheadTotale } = useMemo(() => {
    const all = (calendarEvents || [])
      .map(e => ({ e, date: evDate(e.start?.dateTime), rec: isRecurrence(e) }))
      .filter(x => x.date >= today)
      .sort((a, b) => (a.e.start?.dateTime || '').localeCompare(b.e.start?.dateTime || ''));
    const futuri = all.filter(x => {
      const gap = daysBetween(today, x.date);
      if (gap <= 0) return false;
      return gap <= (x.rec ? AHEAD_RECURRENCES : AHEAD_APPOINTMENTS);
    });
    return {
      events: all.filter(x => x.date === today),
      ahead: futuri.slice(0, AHEAD_MAX_ROWS),
      aheadTotale: futuri.length,
    };
  }, [calendarEvents, today]);

  const plannedMin = blocks.reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const fatte = blocks.filter(b => b.completed).length;
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  const summary = [
    `${events.length} ${events.length === 1 ? 'evento' : 'eventi'}`,
    `${blocks.length} ${blocks.length === 1 ? 'azione programmata' : 'azioni programmate'}`,
    plannedMin ? `${fmtHours(plannedMin)} pianificate` : null,
  ].filter(Boolean).join(' · ');

  // I registri da cui gli obiettivi derivabili prendono il loro numero: sono
  // gli stessi dati che disegnano gli altri riquadri, non una seconda lettura.
  const registri = useMemo(() => ({
    movimento: registro.voci || [],
    diario: diario?.date || [],
    coda,
  }), [registro.voci, diario, coda]);

  const obiettivi = useMemo(
    () => obiettiviDelMese(obiettiviDoc, ym).map(o => risolvi(o, registri, ym, today)),
    [obiettiviDoc, ym, registri, today]
  );

  return (
    <div className="today">
      <header className="today-head">
        <div>
          <h1 className="today-date">{dateLabel[0].toUpperCase() + dateLabel.slice(1)}</h1>
          <p className="today-summary">{summary}</p>
        </div>
        <div className="today-head-right">
          {daChiarire > 0 && (
            <Link className="today-pill" to="/attivita">
              <span className="today-pill-dot" />
              {daChiarire} {daChiarire === 1 ? 'cosa da chiarire' : 'cose da chiarire'}
            </Link>
          )}
          <Link className="today-plan-link" to="/piano">Apri il Piano →</Link>
        </div>
      </header>

      <div className="today-grid">
        {/* ── Metà operativa: le cose che hanno un'ora ────────────────────── */}
        <div className="today-col">
          {/* ── Adesso ─────────────────────────────────────────────────── */}
          {focus ? (
            <section className="today-now">
              <span className="eyebrow eyebrow-accent">
                {current ? `Adesso · ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Prossimo'}
              </span>
              <h2 className="today-now-title">{focus.taskTitle}</h2>
              <p className="today-now-meta">
                {[
                  `${focus.startTime}–${focus.endTime}`,
                  focus.listName,
                  current
                    ? `restano ${fmtLeft(t2m(focus.endTime) - nowMin)}`
                    : `fra ${fmtLeft(t2m(focus.startTime) - nowMin)}`,
                ].filter(Boolean).join(' · ')}
              </p>
              <div className="today-now-actions">
                <button className="today-btn accent" onClick={() => onCompleteBlock(focus)}>Completa</button>
                <button className="today-btn" onClick={() => navigate('/piano')}>Sposta</button>
              </div>
              {poi && (
                <p className="today-now-poi">Poi alle {poi.startTime} · {poi.taskTitle}</p>
              )}
            </section>
          ) : (
            <section className="today-now empty">
              <span className="eyebrow">Adesso</span>
              <p className="today-empty">
                Niente in programma per il resto della giornata.{' '}
                <Link to="/piano">Programma qualcosa</Link>
              </p>
            </section>
          )}

          {/* ── Agenda ─────────────────────────────────────────────────── */}
          <section className="today-block">
            <span className="eyebrow">Agenda</span>
            {events.length === 0 && <p className="today-empty">Nessun appuntamento oggi</p>}
            {events.map(({ e, rec }) => (
              <EventRow key={`${e.id}-${today}`} event={e} recurrence={rec} />
            ))}

            {ahead.length > 0 && (
              <>
                <span className="today-ahead-sep">In arrivo</span>
                {ahead.map(({ e, date, rec }) => (
                  <EventRow key={`${e.id}-${date}`} event={e} recurrence={rec} day={fmtDayLabel(date)} soon={daysBetween(today, date) <= 1} />
                ))}
                {/* Quello che non ci sta non sparisce: diventa un numero. Un
                    riquadro che tronca in silenzio insegna a non fidarsi. */}
                {aheadTotale > ahead.length && (
                  <Link className="today-piu" to="/piano">
                    Altri {aheadTotale - ahead.length} entro trenta giorni →
                  </Link>
                )}
              </>
            )}
          </section>

          {/* ── Azioni di oggi ─────────────────────────────────────────── */}
          <section className="today-block">
            <div className="today-block-head">
              <span className="eyebrow">Azioni di oggi</span>
              {blocks.length > 0 && (
                <span className="today-block-conta">
                  {fatte} su {blocks.length} {fatte === 1 ? 'fatta' : 'fatte'}
                  {plannedMin ? ` · ${fmtHours(plannedMin)}` : ''}
                </span>
              )}
            </div>
            {blocks.length === 0 && (
              <p className="today-empty">
                Nessuna azione programmata. <Link to="/attivita">Guarda le prossime azioni</Link>
              </p>
            )}
            {blocks.map(b => {
              const ctx = taskContext(taskById.get(b.taskId) || /** @type {any} */ ({}));
              return (
                <div className={`today-action${b.completed ? ' done' : ''}`} key={b.id}>
                  <button
                    className="today-check"
                    onClick={() => !b.completed && onCompleteBlock(b)}
                    disabled={b.completed}
                    aria-label={b.completed ? 'Completata' : 'Segna come completata'}>
                    {b.completed && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4 12.5 9.5 18 20 6.5" />
                      </svg>
                    )}
                  </button>
                  <span className="today-action-title">{b.taskTitle}</span>
                  {b.listName && (
                    <span
                      className="today-action-chip"
                      style={/** @type {import('react').CSSProperties} */ ({ '--chip': contextColor(ctx) })}>
                      {b.listName}
                    </span>
                  )}
                  <span className="today-action-time">{b.startTime}</span>
                </div>
              );
            })}
            {nonProgrammate > 0 && (
              <Link className="today-piu" to="/attivita">
                {nonProgrammate} {nonProgrammate === 1 ? 'prossima azione non programmata' : 'prossime azioni non programmate'} →
              </Link>
            )}
          </section>
        </div>

        {/* ── Metà vita: quello che invecchia nell'arco di un mese ────────── */}
        <div className="today-vita">
          <div className="today-col-vita">
            <ObiettiviCard
              obiettivi={obiettivi}
              ym={ym}
              oggi={today}
              onCambia={() => setModale('obiettivi')}
            />

            <MovimentoCard today={today} calendarEvents={calendarEvents} registro={registro} />

            <CodaCard voci={coda} onApri={() => setModale('coda')} />
          </div>

          {/* Tre riquadri, un velo solo: quello che non si legge alle spalle
              sta tutto nella stessa colonna. */}
          <div className="today-col-riservati">
            <BussolaCard docs={identityDocs} today={today} onOpenIdentity={onOpenIdentity} />
            <FinanzeCard />
            <DiarioCard diario={diario} today={today} />
          </div>
        </div>
      </div>

      {modale === 'obiettivi' && (
        <ObiettiviModal
          oggi={today}
          coda={coda}
          onSalvato={aggiornaObiettivi}
          onChiudi={() => setModale(null)}
        />
      )}
      {modale === 'coda' && (
        <CodaModal onSalvato={aggiornaCoda} onChiudi={() => setModale(null)} />
      )}
    </div>
  );
}

/**
 * Una riga di agenda. È la stessa forma per un appuntamento di oggi, per un
 * compleanno di oggi e per uno fra tre settimane: cambia solo cosa sta nella
 * colonna di sinistra (l'ora, oppure il giorno) e il cerchietto con le
 * iniziali, che è il segno che distingue una ricorrenza da un impegno.
 * @param {Object} props
 * @param {any} props.event
 * @param {boolean} props.recurrence
 * @param {string} [props.day]  etichetta del giorno, per le righe «in arrivo»
 * @param {boolean} [props.soon]
 */
function EventRow({ event, recurrence, day, soon }) {
  const when = day || (event.isAllDay ? 'tutto il giorno' : evTime(event.start?.dateTime));
  return (
    <div className={`today-event${recurrence ? ' recurrence' : ''}${day ? ' ahead' : ''}`}>
      <span className={`today-event-time${soon ? ' soon' : ''}`}>{when}</span>
      {recurrence && <span className="today-rec-badge">{initials(event.subject || '')}</span>}
      <span className="today-event-title">{event.subject || '(senza titolo)'}</span>
      <span className="today-event-cal">{event._calName}</span>
    </div>
  );
}

/**
 * Una barra di avanzamento da tre pixel: la stessa forma per gli obiettivi,
 * per le letture e per i cento desideri.
 * @param {{ quota: number, colore?: string }} props
 */
function Barra({ quota, colore }) {
  return (
    <span className="today-barra">
      <i style={{ width: `${Math.max(0, Math.min(1, quota)) * 100}%`, background: colore }} />
    </span>
  );
}

/**
 * Gli obiettivi del mese: da tre a sei righe che dicono dove si vuole
 * arrivare entro il trentuno.
 *
 * Non è un elenco di cose da fare — quelle stanno in To-Do e hanno una loro
 * vista. È la domanda opposta: non «cosa faccio adesso» ma «di questo mese,
 * cosa voglio poter dire alla fine». Per questo sta nella metà destra, con le
 * cose che invecchiano lentamente, e per questo la riga di servizio dice i
 * giorni che restano: è l'unica cosa che cambia da sola.
 * @param {Object} props
 * @param {ReturnType<typeof risolvi>[]} props.obiettivi
 * @param {string} props.ym
 * @param {string} props.oggi
 * @param {() => void} props.onCambia
 */
function ObiettiviCard({ obiettivi, ym, oggi, onCambia }) {
  const restano = giorniRestanti(ym, oggi);
  const nomeMese = new Date(`${ym}-01T00:00:00`).toLocaleDateString('it-IT', { month: 'long' });

  return (
    <section className="today-card today-obiettivi">
      <div className="today-card-head">
        <span className="eyebrow">Obiettivi di {nomeMese}</span>
        <span className="today-card-meta">
          {restano > 0 ? `${restano} ${restano === 1 ? 'giorno' : 'gg'} alla fine` : 'mese chiuso'}
        </span>
      </div>

      {obiettivi.length === 0 ? (
        <p className="today-empty">Nessun obiettivo per questo mese.</p>
      ) : (
        <div className="today-ob-griglia">
          {obiettivi.map(o => (
            <div className="today-ob" key={o.id}>
              <div className="today-ob-riga">
                <span className="today-ob-titolo" title={o.titolo}>{o.titolo}</span>
                <span className="today-ob-num">{o.fatti}/{o.totale}</span>
              </div>
              {/* Fuori passo è rosso, il resto è ocra. Non c'è un verde per
                  «in anticipo»: essere avanti non è una notizia, essere
                  indietro sì. */}
              <Barra quota={o.quota} colore={o.fuoriPasso ? 'var(--danger)' : undefined} />
            </div>
          ))}
        </div>
      )}

      <button className="today-link-btn" onClick={onCambia}>Cambia gli obiettivi →</button>
    </section>
  );
}

/**
 * «Da leggere e vedere»: quello che si sta leggendo, e quello che aspetta.
 *
 * Erano due cose separate nella testa prima che nell'app — le letture da una
 * parte, i link messi da parte dall'altra — ma la domanda è una: *cosa avevo
 * detto che volevo leggere o vedere?*. In corso a sinistra perché è quello che
 * si finisce; la coda a destra perché è quello che si sceglie.
 * @param {{ voci: import('./types').VoceCoda[], onApri: () => void }} props
 */
function CodaCard({ voci, onApri }) {
  const correnti = inCorso(voci).slice(0, MAX_IN_CORSO);
  const attesa = inCoda(voci).slice(0, MAX_IN_CODA);
  const nCorso = inCorso(voci).length;
  const nCoda = inCoda(voci).length;

  return (
    <section className="today-card today-coda">
      <div className="today-card-head">
        <span className="eyebrow">Da leggere e vedere</span>
        <span className="today-card-meta">{nCorso} in corso · {nCoda} in coda</span>
      </div>

      {voci.length === 0 ? (
        <p className="today-empty">Niente in lettura. Un link incollato qui dentro diventa una riga.</p>
      ) : (
        <div className="today-coda-griglia">
          <div className="today-coda-col">
            <span className="today-sotto">In corso</span>
            {correnti.length === 0 && <p className="today-empty">Niente aperto.</p>}
            {correnti.map((v, i) => (
              <div className="today-lettura" key={v.id}>
                <div className="today-lettura-riga">
                  <span className="today-lettura-titolo" title={v.titolo}>{v.titolo}</span>
                  <span className="today-tag">{etichettaTipo(v.tipo)}</span>
                </div>
                <div className="today-lettura-meta">
                  <span>{v.fonte || dominio(v.url) || ''}</span>
                  <span>{etichettaAvanzamento(v)}</span>
                </div>
                {/* Piena solo la prima: è quella più vicina alla fine, e la
                    fine è l'unico modo in cui una coda si accorcia. */}
                <Barra quota={quota(v)} colore={i === 0 ? undefined : 'var(--accent-line)'} />
              </div>
            ))}
          </div>

          <div className="today-coda-col">
            <span className="today-sotto">In coda</span>
            {attesa.length === 0 && <p className="today-empty">Coda vuota.</p>}
            {attesa.map(v => (
              <div className="today-coda-riga" key={v.id}>
                <span className={`today-coda-titolo${v.url ? '' : ' spenta'}`} title={v.titolo}>{v.titolo}</span>
                {v.url
                  ? <span className="today-coda-dom">{dominio(v.url)}</span>
                  : <span className="today-tag">{etichettaTipo(v.tipo)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="today-link-btn" onClick={onApri}>Apri la coda →</button>
    </section>
  );
}

// La Bussola e la Visione stanno su OneDrive e cambiano una volta ogni tanto:
// una volta lette restano qui per tutta la sessione, così passare da Oggi a
// un'altra vista e tornare non rifà due chiamate.
/** @type {{bussola: any, visione: any}|null} */
let identityMemo = null;

/** @returns {{docs: {bussola: any, visione: any}|null}} */
function useIdentityDocs() {
  const [docs, setDocs] = useState(identityMemo);
  useEffect(() => {
    if (identityMemo) return;
    let cancelled = false;
    Promise.all([
      loadIdentityDoc('bussola').catch(() => null),
      loadIdentityDoc('visione').catch(() => null),
    ]).then(([bussola, visione]) => {
      identityMemo = { bussola, visione };
      if (!cancelled) setDocs(identityMemo);
    });
    return () => { cancelled = true; };
  }, []);
  return { docs };
}

/**
 * Bussola: il desiderio del giorno, dove sto andando, e le tre porte.
 *
 * Erano due riquadri: «I cento desideri» e «Bussola», uno sopra l'altro nella
 * stessa colonna. Ma leggono lo stesso documento — i cento desideri sono una
 * sezione della Bussola, non un altro testo — e da quando entrambi sono dietro
 * il PIN, tenerli separati voleva dire due veli identici in fila, due bottoni
 * «Inserisci il PIN» a due centimetri l'uno dall'altro, e due volte la stessa
 * etichetta per la stessa cosa.
 *
 * Fusi, l'ordine dice quello che conta: il desiderio di oggi in alto, perché è
 * la riga che si guarda tutti i giorni; l'assaggio di Visione sotto; e in
 * fondo le tre porte, per quando si vuole leggere il documento intero.
 *
 * Ne compare un desiderio solo. Quaranta righe in colonna sono un elenco da
 * scorrere; una riga sola è una cosa a cui pensare.
 * @param {{ docs: any, today: string, onOpenIdentity?: (which: 'bussola'|'visione'|'desideri') => void }} props
 */
function BussolaCard({ docs, today, onOpenIdentity }) {
  const wishes = useMemo(() => parseWishes(wishSection(docs?.bussola)?.content || ''), [docs]);
  const wish = wishOfTheDay(wishes, today);

  const visioneText = (docs?.visione?.sections || [])
    .map((/** @type {any} */ s) => (s.content || '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 130);

  return (
    <SensitiveCard
      className="today-bussola"
      eyebrow="Bussola"
      nota="Il desiderio di oggi, la Visione e i cento desideri.">
      {!docs && <p className="today-empty">…</p>}
      {docs && (
        wish
          ? <p className="today-compass-wish">{wish.text}</p>
          : <p className="today-empty">Ancora nessun desiderio scritto.</p>
      )}
      {wish && (
        <span className="today-compass-count">
          {[wish.group, `uno dei ${wishes.length}`].filter(Boolean).join(' · ')}
        </span>
      )}

      {/* Quanto manca ai cento. La barra dice in un colpo d'occhio quello che
          prima era una frase in fondo alla riga sopra — e in una colonna
          stretta una frase in più è una riga in meno per la Visione. */}
      {wishes.length > 0 && (
        <div className="today-compass-barra">
          <Barra quota={wishes.length / 100} colore="var(--accent-line)" />
          <span className="today-micro">{wishes.length} su 100 desideri scritti</span>
        </div>
      )}

      {visioneText && <p className="today-compass-vision">{visioneText}…</p>}

      <div className="today-compass-links">
        <button type="button" onClick={() => onOpenIdentity?.('desideri')}>I cento desideri →</button>
        <button type="button" onClick={() => onOpenIdentity?.('bussola')}>La Bussola →</button>
        <button type="button" onClick={() => onOpenIdentity?.('visione')}>La Visione →</button>
      </div>
    </SensitiveCard>
  );
}

// I colori delle cifre sono gli stessi della scheda Saldo — grigio per il
// grezzo, blu per il netto tasse, verde per il patrimonio. Ripetuti qui a mano
// e non importati: stanno in Saldo.tsx dentro il chunk di Finanze, e tirarsi
// dietro mezzo megabyte di recharts per tre stringhe esadecimali sarebbe il
// contrario di quello che fa `caricaRiepilogoOggi`.
const COLORI_SALDO = {
  grezzo: '#8a94a6',
  nettoTasse: '#4c78a8',
  totale: '#54a24b',
};

/** 'YYYY-MM-DD' → "12 mar 2026". */
function fmtDataDato(/** @type {string} */ iso) {
  return new Date(iso + 'T00:00:00')
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace('.', '');
}

/**
 * Finanze in Oggi: il patrimonio in evidenza, tre cifre di contorno e la porta
 * della sezione.
 *
 * Prima qui non compariva nessun numero — solo un invito a entrare — e il
 * riquadro occupava spazio senza dire niente. Le cifre ci sono, ma dietro il
 * PIN: sono le stesse del «Riepilogo (oggi)» della scheda Saldo, calcolate
 * dalla stessa catena e caricate solo dopo lo sblocco.
 */
function FinanzeCard() {
  const sbloccato = useSbloccato();
  // Un solo stato e non due (dato + «sto caricando»): il caricamento è
  // semplicemente «sbloccato ma esito ancora null», e tenerlo in un booleano
  // a parte vorrebbe dire accenderlo dentro l'effetto, cioè un render in più
  // a ogni sblocco.
  /** @typedef {{ tipo: 'ok', riep: import('./finanze/riepilogoOggi').RiepilogoOggi } | { tipo: 'vuoto' } | { tipo: 'errore' }} EsitoFinanze */
  const [esito, setEsito] = useState(/** @type {EsitoFinanze|null} */ (null));

  useEffect(() => {
    if (!sbloccato) return;
    let annullato = false;
    caricaRiepilogoOggi()
      .then(r => { if (!annullato) setEsito(r ? { tipo: 'ok', riep: r } : { tipo: 'vuoto' }); })
      .catch(e => {
        console.error('riepilogo finanze', e);
        if (!annullato) setEsito({ tipo: 'errore' });
      });
    return () => { annullato = true; };
  }, [sbloccato]);

  return (
    <SensitiveCard
      className="today-finanze-card"
      eyebrow="Finanze"
      nota="Patrimonio, saldo grezzo e netto tasse all'ultimo dato.">
      {esito === null && <p className="today-empty">Calcolo in corso…</p>}
      {esito?.tipo === 'errore' && <p className="today-empty">Non sono riuscito a leggere i dati.</p>}
      {esito?.tipo === 'vuoto' && <p className="today-empty">Nessun movimento importato.</p>}
      {esito?.tipo === 'ok' && (
        <>
          {/* Il patrimonio esce dalla fila e sale in cima, grande: è la cifra
              per cui si sblocca il riquadro. Le altre tre la spiegano. */}
          <div className="today-fin-forte">
            <span className="today-micro">Patrimonio + immobili</span>
            <span className="today-fin-grande" style={{ color: COLORI_SALDO.totale }}>
              {esito.riep.totaleConImmobili}
            </span>
          </div>
          <div className="today-fin-righe">
            <FinRiga etichetta="Saldo grezzo" valore={esito.riep.grezzo} colore={COLORI_SALDO.grezzo} />
            <FinRiga etichetta="Netto tasse" valore={esito.riep.nettoTasse} colore={COLORI_SALDO.nettoTasse} />
            <FinRiga etichetta="Ultimo dato" valore={fmtDataDato(esito.riep.ultimoDato)} />
          </div>
        </>
      )}
      <Link className="today-link-btn" to="/finanze">Apri Finanze →</Link>
    </SensitiveCard>
  );
}

/**
 * Una riga del riepilogo: etichetta a sinistra, cifra a destra.
 * @param {{ etichetta: string, valore: string, colore?: string }} props
 */
function FinRiga({ etichetta, valore, colore }) {
  return (
    <div className="today-fin-riga">
      <span className="today-fin-etichetta">{etichetta}</span>
      <span className="today-fin-valore" style={colore ? { color: colore } : undefined}>{valore}</span>
    </div>
  );
}

/**
 * Legge una voce di diario vera da rileggere oggi.
 *
 * Il mese da cui pescarla si sceglie con la data e non a caso, come il
 * desiderio del giorno: due giorni diversi danno due mesi diversi, ma dentro
 * la stessa giornata la voce non cambia sotto gli occhi. Pescare dall'indice
 * intero e non dagli ultimi due mesi è metà del senso della cosa — l'interesse
 * di rileggersi cresce con la distanza, e una voce di due anni fa vale dieci
 * volte quella di martedì.
 *
 * Si carica **solo dopo il PIN**: è l'unico posto di «Oggi» in cui il testo del
 * diario esce da OneDrive, e come per Finanze non deve uscirne affatto finché
 * il riquadro è coperto.
 * @param {any} index          l'indice dei mesi del diario
 * @param {string} today
 * @param {boolean} attivo     sbloccato
 */
function useVoceDelGiorno(index, today, attivo) {
  const mese = useMemo(() => {
    const mesi = index?.months || [];
    return mesi.length ? mesi[dailyIndex(today, mesi.length)] : null;
  }, [index, today]);

  const [caricato, setCaricato] = useState(/** @type {{mese: string, voci: any[]}|null} */ (null));

  useEffect(() => {
    if (!attivo || !mese) return;
    let annullato = false;
    loadDiaryMonth(mese)
      .then(voci => { if (!annullato) setCaricato({ mese, voci: voci || [] }); })
      .catch(e => {
        console.error('voce del giorno', e);
        if (!annullato) setCaricato({ mese, voci: [] });
      });
    return () => { annullato = true; };
  }, [mese, attivo]);

  // `undefined` = sto ancora leggendo, `null` = non c'è niente da rileggere.
  // Due stati e non uno perché «carico…» e «non hai ancora scritto niente»
  // sono due cose diverse da dire, e la seconda è quella che invita a
  // scrivere.
  if (!mese) return null;
  if (caricato?.mese !== mese) return undefined;
  return entryOfTheDay(caricato.voci, today);
}

/**
 * Diario: una voce di ieri o di due anni fa, e la striscia dei sette giorni.
 *
 * Era un invito e basta — «Due righe su com'è andata…» — cioè un bottone
 * travestito da riquadro. Un invito non si legge due volte: dopo la prima
 * settimana quello spazio non diceva più niente.
 *
 * Adesso dice una cosa vera: una delle voci già scritte, scelta con la data
 * come il desiderio del giorno. È lo stesso meccanismo dei cento desideri e per
 * la stessa ragione — l'archivio del diario esiste per essere riletto, e un
 * archivio che si apre solo se lo si va a cercare non viene riletto mai.
 *
 * E per questo sta dietro il PIN insieme a Finanze e alla Bussola: nel momento
 * in cui il riquadro ha smesso di mostrare un invito e ha cominciato a mostrare
 * quello che si è scritto una sera, è diventato la cosa più privata della
 * schermata che sta aperta tutto il giorno sulla scrivania.
 * @param {{ diario: {date: string[], index: any}|null, today: string }} props
 */
function DiarioCard({ diario, today }) {
  const sbloccato = useSbloccato();
  const voce = useVoceDelGiorno(diario?.index, today, sbloccato);

  const date = useMemo(() => diario?.date || [], [diario]);
  const streak = useMemo(() => (diario ? diaryStreak(date) : null), [diario, date]);
  const ultima = useMemo(() => (date.length ? [...date].sort().at(-1) : null), [date]);

  // I sette giorni fino a oggi: una barretta piena per ogni giorno con una
  // voce. Sette e non trenta perché la domanda è «sto scrivendo in questi
  // giorni», non «quanto ho scritto quest'anno».
  const settimana = useMemo(() => {
    const set = new Set(date);
    const out = [];
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      out.push({ g: todayStr(d), pieno: set.has(todayStr(d)) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [date, today]);

  return (
    <SensitiveCard
      className="today-diario-card"
      eyebrow="Diario"
      nota="La striscia dei sette giorni e una voce da rileggere.">
      <p className="today-diary-prompt">Due righe su com'è andata…</p>

      <div className="today-diary-week" aria-hidden="true">
        {settimana.map(x => (
          <span key={x.g} className={`today-diary-tacca${x.pieno ? ' pieno' : ''}`} />
        ))}
      </div>

      {voce === undefined && <p className="today-empty">…</p>}
      {voce === null && <p className="today-empty">Ancora niente da rileggere.</p>}
      {voce && (
        <p className="today-diary-voce">
          <span className="today-diary-quando">{fmtBreve(voce.date)}</span>
          <span className="today-diary-testo">«{excerpt(voce.text, 110)}»</span>
        </p>
      )}

      <span className="today-micro">
        {[
          streak === null ? '…' : streak > 0 ? `${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila` : 'Ricomincia la striscia',
          ultima ? `ultima voce ${fmtBreve(ultima)}` : null,
        ].filter(Boolean).join(' · ')}
      </span>

      <Link className="today-link-btn" to="/diario">Apri il Diario →</Link>
    </SensitiveCard>
  );
}
