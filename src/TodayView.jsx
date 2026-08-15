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
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadDiaryIndex, loadDiaryMonth, loadIdentityDoc } from './api';
import { monthKey, shiftMonth } from './diary';
import { taskContext, contextColor } from './taskModel';
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
const AHEAD_MAX_ROWS = 7;

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

/** Carica quel tanto di diario che serve alla striscia: mese corrente e
 *  precedente. Oltre non serve — una striscia più lunga di due mesi si
 *  racconta lo stesso come «60 giorni di fila». */
function useDiaryStreak(enabled = true) {
  const [streak, setStreak] = useState(/** @type {number|null} */ (null));
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const index = await loadDiaryIndex();
        const wanted = [monthKey(), shiftMonth(monthKey(), -1)];
        const months = wanted.filter(m => !index?.months || index.months.includes(m));
        const dates = [];
        for (const m of months) {
          const entries = await loadDiaryMonth(m);
          for (const e of entries || []) if (e?.date) dates.push(e.date);
        }
        if (!cancelled) setStreak(diaryStreak(dates));
      } catch (e) {
        console.error('striscia diario', e);
        if (!cancelled) setStreak(0);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return streak;
}

/**
 * @param {Object} props
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {import('./types').CalendarEvent[]} props.calendarEvents
 * @param {(block: any) => void} props.onCompleteBlock
 * @param {(which: 'bussola'|'visione') => void} props.onOpenIdentity
 */
export default function TodayView({ plans, tasks, calendarEvents, onCompleteBlock, onOpenIdentity }) {
  const navigate = useNavigate();
  // Un tick al minuto: basta a far avanzare "restano 1h40" e a far passare la
  // card da ADESSO a PROSSIMO senza ricaricare.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = todayStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const streak = useDiaryStreak();

  const blocks = useMemo(
    () => [...(plans?.[today]?.blocks || [])].sort((a, b) => t2m(a.startTime) - t2m(b.startTime)),
    [plans, today]
  );

  const taskById = useMemo(() => new Map((tasks || []).map(t => [t.id, t])), [tasks]);

  const current = blocks.find(b => !b.completed && t2m(b.startTime) <= nowMin && nowMin < t2m(b.endTime));
  const upcoming = blocks.find(b => !b.completed && t2m(b.startTime) > nowMin);
  const focus = current || upcoming || null;

  // Agenda e Ricorrenze erano due riquadri lontani fra loro, ma sono la stessa
  // cosa: eventi del calendario Microsoft, tagliati su due finestre di tempo
  // diverse. Tenerli separati voleva dire che il compleanno di oggi finiva
  // nella colonna di destra, in mezzo a quelli fra tre settimane, invece che in
  // agenda accanto agli altri impegni della giornata. Qui c'è una sola
  // cronologia: prima oggi, poi quello che arriva.
  const { events, ahead } = useMemo(() => {
    const all = (calendarEvents || [])
      .map(e => ({ e, date: evDate(e.start?.dateTime), rec: isRecurrence(e) }))
      .filter(x => x.date >= today)
      .sort((a, b) => (a.e.start?.dateTime || '').localeCompare(b.e.start?.dateTime || ''));
    return {
      events: all.filter(x => x.date === today),
      ahead: all
        .filter(x => {
          const gap = daysBetween(today, x.date);
          if (gap <= 0) return false;
          return gap <= (x.rec ? AHEAD_RECURRENCES : AHEAD_APPOINTMENTS);
        })
        .slice(0, AHEAD_MAX_ROWS),
    };
  }, [calendarEvents, today]);

  const plannedMin = blocks.reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  const summary = [
    `${events.length} ${events.length === 1 ? 'evento' : 'eventi'}`,
    `${blocks.length} ${blocks.length === 1 ? 'azione programmata' : 'azioni programmate'}`,
    plannedMin ? `${fmtHours(plannedMin)} pianificate` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="today">
      <header className="today-head">
        <div>
          <h1 className="today-date">{dateLabel[0].toUpperCase() + dateLabel.slice(1)}</h1>
          <p className="today-summary">{summary}</p>
        </div>
        <Link className="today-plan-link" to="/piano">Apri il Piano →</Link>
      </header>

      <div className="today-grid">
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
              </>
            )}
          </section>

          {/* ── Azioni di oggi ─────────────────────────────────────────── */}
          <section className="today-block">
            <span className="eyebrow">Azioni di oggi</span>
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
          </section>
        </div>

        {/* ── Colonna destra ───────────────────────────────────────────── */}
        <aside className="today-aside">
          <CompassCard today={today} onOpenIdentity={onOpenIdentity} />

          {/* Movimento resta un riquadro senza fonte dati: nel codebase non
              esiste niente sugli allenamenti. Sta qui come segnaposto inerte,
              dichiarato, invece di essere finto con numeri inventati. */}
          <LockedCard
            title="Movimento"
            eyebrow="Movimento"
            note="Sette barre, una per giorno. Serve una fonte: un calendario dedicato agli allenamenti o una sezione PARA da cui contarli."
          />

          {/* Finanze invece la sezione ce l'ha: saldo reale, tasse, fatture e
              proiezione. Qui non compaiono cifre di proposito — i conti stanno
              dietro il PIN, e Oggi è una pagina che resta aperta sulla
              scrivania: questo è il collegamento, non un'anteprima. */}
          <Link className="today-finanze" to="/finanze">
            <span className="eyebrow">Finanze</span>
            <p className="today-finanze-note">
              Saldo reale, tasse, fatture e proiezione. I numeri restano nella sezione, dietro il PIN.
            </p>
            <span className="today-finanze-link">Apri Finanze →</span>
          </Link>

          <Link className="today-diary" to="/diario">
            <span className="eyebrow">Diario</span>
            <p className="today-diary-prompt">Due righe su com'è andata…</p>
            <span className="today-diary-streak">
              {streak === null ? '…' : streak > 0 ? `${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila` : 'Ricomincia la striscia'}
            </span>
          </Link>
        </aside>
      </div>
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

// La Bussola e la Visione stanno su OneDrive e cambiano una volta ogni tanto:
// una volta lette restano qui per tutta la sessione, così passare da Oggi a
// un'altra vista e tornare non rifà due chiamate.
/** @type {{bussola: any, visione: any}|null} */
let identityMemo = null;

/** Le righe «Voglio …» della Bussola: i cento desideri, uno per riga. */
function extractWishes(/** @type {any} */ bussola) {
  const section = (bussola?.sections || []).find((/** @type {any} */ s) => /cosa voglio/i.test(s.title || ''));
  return /** @type {string[]} */ ((section?.content || '')
    .split('\n')
    .map((/** @type {string} */ l) => l.trim())
    .filter((/** @type {string} */ l) => l.length > 2));
}

/**
 * Bussola: chi sono, cosa voglio. Sulla schermata del giorno non ci sta tutta
 * — sono quattro schermate di testo — e metterla tutta la ridurrebbe a un muro
 * che si smette di leggere dopo tre giorni. Ci sta un desiderio, quello di
 * oggi, scelto in modo che sia lo stesso per tutta la giornata e cambi domani.
 * @param {{ today: string, onOpenIdentity?: (which: 'bussola'|'visione') => void }} props
 */
function CompassCard({ today, onOpenIdentity }) {
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

  const wishes = useMemo(() => extractWishes(docs?.bussola), [docs]);
  // L'indice si ricava dalla data e non da un random: un desiderio che cambia
  // a ogni render sarebbe rumore, e riaprire la pagina per «trovarne uno
  // migliore» è esattamente il contrario di quello che serve.
  const wish = wishes.length
    ? wishes[Math.floor(new Date(today + 'T00:00:00').getTime() / 86_400_000) % wishes.length]
    : null;

  const visioneText = (docs?.visione?.sections || [])
    .map((/** @type {any} */ s) => (s.content || '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 150);

  return (
    <section className="today-card today-compass">
      <span className="eyebrow">Bussola</span>
      {!docs && <p className="today-empty">…</p>}
      {docs && (
        wish
          ? <p className="today-compass-wish">{wish}</p>
          : <p className="today-empty">La Bussola è ancora vuota — scrivi cosa vuoi.</p>
      )}
      {wishes.length > 0 && (
        <span className="today-compass-count">
          uno dei {wishes.length} desideri scritti{wishes.length < 100 ? ` · ne mancano ${100 - wishes.length} ai cento` : ''}
        </span>
      )}
      <div className="today-compass-links">
        <button type="button" onClick={() => onOpenIdentity?.('bussola')}>La Bussola →</button>
        <button type="button" onClick={() => onOpenIdentity?.('visione')}>La Visione →</button>
      </div>
      {visioneText && <p className="today-compass-vision">{visioneText}…</p>}
    </section>
  );
}

/**
 * Riquadro bloccato: il contenuto sfocato sotto un velo, con il perché.
 * @param {{ eyebrow: string, title: string, note: string }} props
 */
function LockedCard({ eyebrow, title, note }) {
  return (
    <section className="today-card locked">
      <span className="eyebrow">{eyebrow}</span>
      <div className="today-locked-ghost" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span />
      </div>
      <div className="today-locked-veil">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
        </svg>
        <p className="today-locked-note">{note}</p>
        {/* Inerte per davvero: non c'è niente da sbloccare finché non c'è una
            fonte dati. Un bottone che non fa nulla sarebbe peggio del vuoto. */}
        <span className="today-locked-soon">{title} arriva più avanti</span>
      </div>
    </section>
  );
}
