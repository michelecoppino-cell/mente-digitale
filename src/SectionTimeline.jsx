// @ts-check
// «Oggi» — la giornata a mezz'ore, in fondo alla scheda sezione.
//
// Serve a rispondere alla domanda che ci si fa mentre si guarda l'elenco delle
// attività di un progetto: quando la faccio? Finora bisognava lasciare la
// scheda e andare al Piano. Qui la giornata sta accanto alle attività, in sola
// lettura: i blocchi si spostano ancora dov'è la griglia grande, sul Piano.
import { useEffect, useMemo, useState } from 'react';

const SLOT_MIN = 30;
const SLOT_H = 24;      // altezza di mezz'ora, px
const DAY_START = 8 * 60;
const DAY_END = 24 * 60;

function t2m(/** @type {string} */ t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}
function m2t(/** @type {number} */ min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function ymd(/** @type {Date} */ d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDur(/** @type {number} */ min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * @param {Object} props
 * @param {Record<string, {blocks?: any[]}>} [props.plans]  i piani giornalieri, per data
 * @param {string} [props.listName]  la sezione aperta: i suoi blocchi si accendono
 */
export default function SectionTimeline({ plans, listName }) {
  // Un tick al minuto: la lancetta dell'ora attuale è l'unica cosa che si
  // muove da sola in questa colonna.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const blocks = useMemo(
    () => [...(plans?.[today]?.blocks || [])]
      .filter(b => b?.startTime && b?.endTime)
      .sort((a, b) => t2m(a.startTime) - t2m(b.startTime)),
    [plans, today]
  );

  const slots = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) slots.push(m);

  const dayLabel = now
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '')
    .toUpperCase();

  const top = (/** @type {number} */ min) => ((min - DAY_START) / SLOT_MIN) * SLOT_H;
  const inRange = (/** @type {number} */ min) => min >= DAY_START && min <= DAY_END;

  return (
    <>
      <div className="sv-col-head">
        <span className="eyebrow sv-col-label">Oggi · {dayLabel}</span>
      </div>
      <div className="sv-col-body sv-timeline-body">
        <div className="sv-timeline" style={{ height: slots.length * SLOT_H }}>
          {slots.map(m => (
            <div className="sv-tl-row" key={m} style={{ height: SLOT_H }}>
              <span className={`sv-tl-time${m % 60 ? ' half' : ''}`}>{m2t(m)}</span>
              <span className={`sv-tl-line${m % 60 ? ' half' : ''}`} />
            </div>
          ))}

          {blocks.map(b => {
            const startMin = Math.max(DAY_START, t2m(b.startTime));
            const endMin = Math.min(DAY_END, t2m(b.endTime));
            if (endMin <= startMin) return null;
            const mine = !!listName && (b.listName || '').toLowerCase() === listName.toLowerCase();
            return (
              <div
                key={b.id}
                className={`sv-tl-block${mine ? ' mine' : ''}${b.completed ? ' done' : ''}`}
                style={{ top: top(startMin) + SLOT_H / 2, height: ((endMin - startMin) / SLOT_MIN) * SLOT_H }}
                title={`${b.startTime}–${b.endTime} · ${b.taskTitle || b.label || ''}`}>
                <span className="sv-tl-block-meta">
                  {[fmtDur(endMin - startMin), b.listName].filter(Boolean).join(' · ')}
                </span>
                <span className="sv-tl-block-title">{b.taskTitle || b.label || 'Blocco'}</span>
              </div>
            );
          })}

          {inRange(nowMin) && (
            <div className="sv-tl-now" style={{ top: top(nowMin) + SLOT_H / 2 }}>
              <span className="sv-tl-now-dot" />
              <span className="sv-tl-now-line" />
              <span className="sv-tl-now-time">{m2t(nowMin)}</span>
            </div>
          )}
        </div>
        {blocks.length === 0 && <p className="sv-empty sv-tl-empty">Niente in programma oggi</p>}
      </div>
    </>
  );
}
