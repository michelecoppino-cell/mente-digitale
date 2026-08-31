// @ts-check
// «Oggi» — la giornata a mezz'ore, in fondo alla scheda sezione.
//
// Serve a rispondere alla domanda che ci si fa mentre si guarda l'elenco delle
// attività di un progetto: quando la faccio? Finora bisognava lasciare la
// scheda e andare al Piano. Qui si trascina l'attività sull'ora e il blocco è
// fatto — è lo stesso gesto della griglia del Piano, sugli stessi dati
// (`daily-plans` su OneDrive), quindi un blocco creato qui è già lì.
//
// Quello che resta al Piano: le fasce di focus, i sottostep, le note sul
// blocco, la settimana, gli eventi del calendario. Qui si programma e si
// sposta, che è quel che serve mentre si lavora a un progetto.
import { useEffect, useMemo, useRef, useState } from 'react';
import { taskEstimateMin } from './taskModel';
import { listLabel } from './paraConfig';

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
function genId() {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** La durata del blocco: la stima del task arrotondata in su alla mezz'ora
 *  della griglia, come fa il Piano. Un blocco non può essere più corto di una
 *  casella, o non lo si vedrebbe. */
function blockMinutesFor(/** @type {any} */ task) {
  const est = taskEstimateMin(task);
  return Math.max(SLOT_MIN, Math.ceil(est / SLOT_MIN) * SLOT_MIN);
}

/**
 * @param {Object} props
 * @param {Record<string, {blocks?: any[]}>} [props.plans]  i piani giornalieri, per data
 * @param {string[]} [props.listNames]  le liste della sezione aperta — quella
 *        omonima e le sue consegne: i blocchi di tutte si accendono
 * @param {string} [props.color]     il colore della sezione, per i blocchi nuovi
 * @param {(plans: Record<string, any>) => void} [props.onPlansChanged]  senza, la
 *        colonna è in sola lettura: niente da salvare, niente da trascinare
 * @param {(taskId: string) => void} [props.onPickTask]  clic su un blocco della sezione
 */
export default function SectionTimeline({ plans, listNames = [], color, onPlansChanged, onPickTask }) {
  // Un tick al minuto: la lancetta dell'ora attuale è l'unica cosa che si
  // muove da sola in questa colonna.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // L'ora sotto il puntatore durante il trascinamento, e il blocco che si sta
  // spostando: la riga di anteprima dice dove finirà prima di lasciarlo.
  const [dragOverMin, setDragOverMin] = useState(/** @type {number|null} */ (null));
  // Il blocco che si sta allungando col bordo inferiore, e la sua fine mentre
  // la si trascina: il blocco cresce sotto il puntatore e si salva al rilascio.
  const [resize, setResize] = useState(/** @type {{blockId: string, endMin: number}|null} */ (null));
  const gridRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const resizeRef = useRef(/** @type {any} */ (null));
  const blocksRef = useRef(/** @type {any[]} */ ([]));
  const plansRef = useRef(/** @type {any} */ (null));

  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const editable = !!onPlansChanged;

  // Un blocco è «della sezione» se la sua lista è una qualsiasi delle sue: con
  // le consegne annidate il confronto non è più un nome contro un nome.
  const mineNames = useMemo(
    () => new Set(listNames.map(n => (n || '').toLowerCase()).filter(Boolean)),
    [listNames]
  );

  const blocks = useMemo(
    () => [...(plans?.[today]?.blocks || [])]
      .filter(b => b?.startTime && b?.endTime)
      .sort((a, b) => t2m(a.startTime) - t2m(b.startTime)),
    [plans, today]
  );

  // I gestori del mouse dell'allungamento vivono oltre il render in cui sono
  // nati: leggono blocchi e piani da qui, non dalla chiusura, o salverebbero
  // una giornata vecchia.
  useEffect(() => { blocksRef.current = blocks; plansRef.current = plans; });

  const slots = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) slots.push(m);

  const dayLabel = now
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '')
    .toUpperCase();

  const top = (/** @type {number} */ min) => ((min - DAY_START) / SLOT_MIN) * SLOT_H;
  const inRange = (/** @type {number} */ min) => min >= DAY_START && min <= DAY_END;

  /** L'ora della casella sotto il puntatore, agganciata alla mezz'ora. */
  function minuteAt(/** @type {DragEvent|any} */ e) {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const slot = Math.floor((e.clientY - rect.top) / SLOT_H);
    return Math.max(DAY_START, Math.min(DAY_END - SLOT_MIN, DAY_START + slot * SLOT_MIN));
  }

  /** Scrive il piano di oggi. Il resto dei giorni non si tocca: questa colonna
   *  conosce solo oggi. @param {any[]} nextBlocks */
  function writeToday(nextBlocks) {
    const all = plansRef.current || {};
    const plan = all[today] || { date: today, blocks: [], emailExtractedActions: [] };
    onPlansChanged?.({ ...all, [today]: { ...plan, blocks: nextBlocks } });
  }

  /** Un blocco nuovo da un'attività trascinata. Colore e nomi sono copiati
   *  adesso, come fa il Piano: il blocco è lo storico della giornata e non deve
   *  cambiare se poi il task viene rinominato. */
  function addBlock(/** @type {any} */ task, /** @type {number} */ startMin) {
    const endMin = Math.min(startMin + blockMinutesFor(task), DAY_END);
    writeToday([...blocks, {
      id: genId(),
      taskId: task.id,
      taskTitle: task.titolo,
      listId: task._listId || null,
      listName: task._listName || null,
      projectKey: null,
      projectColor: color || null,
      startTime: m2t(startMin),
      endTime: m2t(endMin),
      completed: false,
      completedAt: null,
      subSteps: [],
    }]);
  }

  /** Sposta un blocco tenendone la durata, come sulla griglia del Piano. */
  function moveBlock(/** @type {string} */ blockId, /** @type {number} */ startMin) {
    writeToday(blocks.map(b => {
      if (b.id !== blockId) return b;
      const dur = t2m(b.endTime) - t2m(b.startTime);
      return { ...b, startTime: m2t(startMin), endTime: m2t(Math.min(startMin + dur, DAY_END)) };
    }));
  }

  function removeBlock(/** @type {string} */ blockId) {
    writeToday(blocks.filter(b => b.id !== blockId));
  }

  /** Allunga o accorcia un blocco dal bordo inferiore, come sulla griglia del
   *  Piano: si muove solo la fine, mai l'inizio, e mai sotto la mezz'ora. La
   *  stima del task non si tocca — un blocco più lungo è una giornata diversa,
   *  non un'attività diversa. */
  function handleResizeStart(/** @type {any} */ e, /** @type {any} */ block) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      blockId: block.id,
      startY: e.clientY,
      startEndMin: t2m(block.endTime),
      blockStartMin: t2m(block.startTime),
      endMin: undefined,
    };
    setResize({ blockId: block.id, endMin: t2m(block.endTime) });

    function onMove(/** @type {MouseEvent} */ ev) {
      const d = resizeRef.current;
      if (!d) return;
      const deltaSlots = Math.round((ev.clientY - d.startY) / SLOT_H);
      const endMin = Math.max(
        d.blockStartMin + SLOT_MIN,
        Math.min(DAY_END, d.startEndMin + deltaSlots * SLOT_MIN)
      );
      // La fine corrente sta anche nel ref: al rilascio serve il valore
      // dell'ultimo movimento, e lo stato di React non è ancora leggibile lì.
      d.endMin = endMin;
      setResize({ blockId: d.blockId, endMin });
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const d = resizeRef.current;
      resizeRef.current = null;
      setResize(null);
      if (!d || d.endMin === undefined || d.endMin === d.startEndMin) return;
      writeToday(blocksRef.current.map(b => b.id === d.blockId ? { ...b, endTime: m2t(d.endMin) } : b));
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleDragOver(/** @type {any} */ e) {
    if (!editable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverMin(minuteAt(e));
  }

  function handleDrop(/** @type {any} */ e) {
    if (!editable) return;
    e.preventDefault();
    const startMin = dragOverMin ?? minuteAt(e);
    setDragOverMin(null);
    if (startMin === null) return;
    try {
      // Lo stesso payload del pool del Piano: un'attività trascinata da lì e
      // una trascinata da qui sono la stessa cosa.
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'task' && data.task) addBlock(data.task, startMin);
      else if (data.type === 'block' && data.blockId) moveBlock(data.blockId, startMin);
    } catch { /* payload non nostro — ignora */ }
  }

  return (
    <>
      <div className="sv-col-head">
        <span className="eyebrow sv-col-label">Oggi · {dayLabel}</span>
      </div>
      <div className="sv-col-body sv-timeline-body">
        <div
          className="sv-timeline"
          ref={gridRef}
          style={{ height: slots.length * SLOT_H }}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOverMin(null)}
          onDrop={handleDrop}>
          {slots.map(m => (
            <div className="sv-tl-row" key={m} style={{ height: SLOT_H }}>
              <span className={`sv-tl-time${m % 60 ? ' half' : ''}`}>{m2t(m)}</span>
              <span className={`sv-tl-line${m % 60 ? ' half' : ''}`} />
            </div>
          ))}

          {/* Dove finirebbe adesso il blocco che si sta trascinando. */}
          {dragOverMin !== null && (
            <div className="sv-tl-drop" style={{ top: top(dragOverMin) + SLOT_H / 2 }}>
              <span className="sv-tl-drop-time">{m2t(dragOverMin)}</span>
            </div>
          )}

          {blocks.map(b => {
            const startMin = Math.max(DAY_START, t2m(b.startTime));
            const resizing = resize?.blockId === b.id;
            const endMin = (resizing && resize) ? resize.endMin : Math.min(DAY_END, t2m(b.endTime));
            if (endMin <= startMin) return null;
            const mine = mineNames.has((b.listName || '').toLowerCase());
            return (
              <div
                key={b.id}
                className={`sv-tl-block${mine ? ' mine' : ''}${b.completed ? ' done' : ''}${resizing ? ' resizing' : ''}`}
                style={{ top: top(startMin) + SLOT_H / 2, height: ((endMin - startMin) / SLOT_MIN) * SLOT_H }}
                draggable={editable && !resizing}
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'block', blockId: b.id }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => { if (mine && b.taskId) onPickTask?.(b.taskId); }}
                title={`${b.startTime}–${m2t(endMin)} · ${b.taskTitle || b.label || ''}${editable ? ' — trascina per spostare, il bordo in basso per allungare' : ''}`}>
                <span className="sv-tl-block-meta">
                  {[fmtDur(endMin - startMin), b.listName ? listLabel(b.listName) : null].filter(Boolean).join(' · ')}
                </span>
                <span className="sv-tl-block-title">{b.taskTitle || b.label || 'Blocco'}</span>
                {editable && (
                  <>
                    <button
                      className="sv-tl-block-del"
                      title="Togli dal piano"
                      onClick={e => { e.stopPropagation(); removeBlock(b.id); }}>
                      ✕
                    </button>
                    <span
                      className="sv-tl-block-resize"
                      title="Trascina per allungare"
                      draggable={false}
                      onMouseDown={e => handleResizeStart(e, b)} />
                  </>
                )}
              </div>
            );
          })}

          {blocks.length === 0 && (
            <p className="sv-empty sv-tl-empty">
              {editable ? 'Niente in programma: trascina qui un’attività' : 'Niente in programma oggi'}
            </p>
          )}

          {inRange(nowMin) && (
            <div className="sv-tl-now" style={{ top: top(nowMin) + SLOT_H / 2 }}>
              <span className="sv-tl-now-dot" />
              <span className="sv-tl-now-line" />
              <span className="sv-tl-now-time">{m2t(nowMin)}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
