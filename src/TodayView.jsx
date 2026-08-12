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
import { loadDiaryIndex, loadDiaryMonth } from './api';
import { queryClient, qk, STALE } from './queryClient';
import { monthKey, shiftMonth } from './diary';
import { taskContext, contextColor } from './taskModel';
import Skeleton from './Skeleton';
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

/** Legge dal diario quel tanto che serve alla striscia: mese corrente e
 *  precedente. Oltre non serve — una striscia più lunga di due mesi si
 *  racconta lo stesso come «60 giorni di fila». */
async function fetchDiaryStreak() {
  const index = await loadDiaryIndex();
  const wanted = [monthKey(), shiftMonth(monthKey(), -1)];
  const months = wanted.filter(m => !index?.months || index.months.includes(m));
  const dates = [];
  for (const m of months) {
    const entries = await loadDiaryMonth(m);
    for (const e of entries || []) if (e?.date) dates.push(e.date);
  }
  return diaryStreak(dates);
}

/** La striscia passa dal query client come ogni altra lettura: prima erano tre
 *  file su OneDrive riletti a ogni ritorno su Oggi — e su Oggi si torna dieci
 *  volte al giorno. */
function useDiaryStreak() {
  const [streak, setStreak] = useState(/** @type {number|null} */ (null));
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({
        queryKey: qk.diaryStreak(monthKey()),
        queryFn: fetchDiaryStreak,
        staleTime: STALE.diaryStreak,
      })
      .then(n => { if (!cancelled) setStreak(n); })
      .catch(e => {
        console.error('striscia diario', e);
        if (!cancelled) setStreak(0);
      });
    return () => { cancelled = true; };
  }, []);
  return streak;
}

/**
 * @param {Object} props
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {import('./types').CalendarEvent[]} props.calendarEvents
 * @param {boolean} [props.loading]          il primo caricamento non è ancora arrivato
 * @param {boolean} [props.calendarLoading]  gli eventi del calendario arrivano in coda, dopo
 * @param {(block: any) => void} props.onCompleteBlock
 */
export default function TodayView({
  plans, tasks, calendarEvents, loading = false, calendarLoading = false, onCompleteBlock,
}) {
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

  const events = useMemo(() => (calendarEvents || [])
    .filter(e => evDate(e.start?.dateTime) === today)
    .filter(e => !RECURRENCE_RE.test(e._calName || ''))
    .sort((a, b) => (a.start?.dateTime || '').localeCompare(b.start?.dateTime || '')),
    [calendarEvents, today]);

  // Dipende dal *giorno*, non dall'istante: con `now` fra le dipendenze l'intero
  // elenco eventi veniva rifiltrato e riordinato a ogni tick del minuto, per
  // dare sempre lo stesso risultato.
  const recurrences = useMemo(() => {
    const limit = new Date(today + 'T00:00:00'); limit.setDate(limit.getDate() + 30);
    const limitStr = todayStr(limit);
    return (calendarEvents || [])
      .filter(e => RECURRENCE_RE.test(e._calName || '') || RECURRENCE_RE.test(e.subject || ''))
      .filter(e => { const d = evDate(e.start?.dateTime); return d >= today && d <= limitStr; })
      .sort((a, b) => (a.start?.dateTime || '').localeCompare(b.start?.dateTime || ''))
      .slice(0, 6);
  }, [calendarEvents, today]);

  const plannedMin = blocks.reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  // Il confine fra «domani» e «più avanti» per le ricorrenze: una volta, non
  // una per riga dentro il map.
  const tomorrowStr = todayStr(new Date(now.getTime() + 86_400_000));

  // Finché il primo caricamento non è tornato non si può dire *niente* sulla
  // giornata: prima Oggi mostrava «Niente in programma per il resto della
  // giornata» e «Nessun appuntamento oggi» durante l'attesa — cioè una risposta
  // falsa, e proprio quella che scoraggia dall'aprire l'app. Lo stato vuoto ora
  // è solo il vuoto vero.
  const waiting = loading && blocks.length === 0;

  const summary = loading
    ? 'Caricamento della giornata…'
    : [
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
          ) : waiting ? (
            <section className="today-now empty" aria-busy="true">
              <span className="eyebrow">Adesso</span>
              <Skeleton rows={2} height={16} />
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
            {events.length === 0 && (
              calendarLoading
                ? <Skeleton rows={3} />
                : <p className="today-empty">Nessun appuntamento oggi</p>
            )}
            {events.map(e => (
              <div className="today-event" key={e.id}>
                <span className="today-event-time">{e.isAllDay ? 'tutto il giorno' : evTime(e.start?.dateTime)}</span>
                <span className="today-event-title">{e.subject || '(senza titolo)'}</span>
                <span className="today-event-cal">{e._calName}</span>
              </div>
            ))}
          </section>

          {/* ── Azioni di oggi ─────────────────────────────────────────── */}
          <section className="today-block">
            <span className="eyebrow">Azioni di oggi</span>
            {blocks.length === 0 && (
              waiting
                ? <Skeleton rows={3} />
                : (
                  <p className="today-empty">
                    Nessuna azione programmata. <Link to="/attivita">Guarda le prossime azioni</Link>
                  </p>
                )
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
          <section className="today-card">
            <span className="eyebrow">Ricorrenze</span>
            {recurrences.length === 0 && (
              calendarLoading
                ? <Skeleton rows={2} />
                : <p className="today-empty">Niente nei prossimi 30 giorni</p>
            )}
            {recurrences.map(e => {
              const d = evDate(e.start?.dateTime);
              const soon = d <= tomorrowStr;
              return (
                <div className="today-rec" key={e.id}>
                  <span className="today-rec-badge">{initials(e.subject || '')}</span>
                  <span className="today-rec-name">{e.subject}</span>
                  <span className={`today-rec-date${soon ? ' soon' : ''}`}>
                    {new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </section>

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
