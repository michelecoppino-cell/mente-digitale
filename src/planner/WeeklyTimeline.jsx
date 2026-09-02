// @ts-nocheck — non ancora controllato dai tipi, come il resto del Piano da
// cui viene. Vedi la nota in jsconfig.json.
// La settimana: sette colonne della stessa griglia del giorno.
//
// Ci si trascina dentro come nella vista Giorno — attività, blocchi workbook,
// note — e ogni gesto lo esegue chi la usa: qui ci sono la griglia, il
// disegno e lo stato del trascinamento in corso, non le scritture.
//
// La riga degli eventi «tutto il giorno» e l'intestazione non scorrono, il
// corpo sì: da qui la larghezza della barra di scorrimento misurata a mano,
// che altrimenti sfalsa le colonne rispetto alla griglia sotto.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DAY_START_MIN, DAY_END_MIN, SLOT_HEIGHT,
  VERTICAL_DURATION_RESERVE_PX, VERTICAL_LAYOUT_MIN_DURATION,
  coloreEvento, defaultScrollOffset, evDayStr, eventSpan, fmtBlockDuration,
  isAllDay, isoToHHMM, liveBlockColor, liveWorkbookColor, m2t, overlapColumns,
  t2m, todayStr, verticalTitleLayout,
} from './griglia.js';
import { VerticalTitle } from './VerticalTitle.jsx';
import { WorkbookBlockNote } from './WorkbookBlockNote.jsx';
import { hexToRgba } from '../plannerShared';
import { listLabel } from '../paraConfig';

export function WeeklyTimeline({
  weekDays, plans, calEvents, workbookPlans, workbooks, workbookCalHidden, workdayStartMin, timeSlots, suppressClickRef,
  config, listColorMap, coloriCalendari,
  onDayClick, onMoveBlock, onCopyBlock, onBlockClick, onEventClick, onCopyEvent, onAddTask, onCreateEvent,
  onAddWorkbookBlock, onMoveWorkbookBlock, onCopyWorkbookBlock, onRemoveWorkbookBlock, onResizeWorkbookBlockStart, onResizeBlockStart,
  onAddWorkbookNote, onEditWorkbookNote, onMoveWorkbookNote, onRemoveWorkbookNote,
}) {
  const today = todayStr();
  const [dragOver, setDragOver] = useState(null); // { day, min }
  // Mentre un workbook/task block è in resize disattiva il suo draggable (stesso
  // accorgimento di resizingId nella vista Giorno, handleResizeStart): senza
  // di questo il mousedown sulla maniglia di resize può essere interpretato
  // dal browser come inizio di un drag nativo invece che come resize.
  const [resizingWbId, setResizingWbId] = useState(null);
  const [resizingId, setResizingId] = useState(null);
  const weekBodyRef = useRef(null);
  // Larghezza reale della scrollbar verticale del corpo scorrevole: l'header e
  // la riga eventi "tutto il giorno" non scorrono e quindi non perdono questo
  // spazio, sfalsando le colonne giorno rispetto alla griglia sottostante se
  // non compensata (vedi useLayoutEffect sotto).
  const [scrollbarW, setScrollbarW] = useState(0);

  function handleWbResizeMouseDown(e, block, day) {
    setResizingWbId(block.id);
    onResizeWorkbookBlockStart(e, block, day);
    function clearResizing() {
      setResizingWbId(null);
      document.removeEventListener('mouseup', clearResizing);
    }
    document.addEventListener('mouseup', clearResizing);
  }

  function handleResizeMouseDown(e, block, day) {
    setResizingId(block.id);
    onResizeBlockStart(e, block, day);
    function clearResizing() {
      setResizingId(null);
      document.removeEventListener('mouseup', clearResizing);
    }
    document.addEventListener('mouseup', clearResizing);
  }

  // Apre di default sull'orario di lavoro configurato, come la vista Giorno —
  // ma essendo la griglia sempre 00:00–24:00 resta scorrevole con la rotella.
  useEffect(() => {
    if (!weekBodyRef.current) return;
    weekBodyRef.current.scrollTop = defaultScrollOffset(workdayStartMin);
  }, []); // eslint-disable-line

  useLayoutEffect(() => {
    function measure() {
      const el = weekBodyRef.current;
      if (el) setScrollbarW(el.offsetWidth - el.clientWidth);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [weekDays, plans, workbookPlans, calEvents]);

  function slotFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const idx  = Math.floor(relY / SLOT_HEIGHT);
    return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 30, idx * 30));
  }

  function handleColDragOver(e, day) {
        e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ day, min: slotFromEvent(e) });
  }

  function handleColDrop(e, day) {
    e.preventDefault();
        const min = slotFromEvent(e);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'weekblock') {
        if (data.copy) onCopyBlock(data.fromDay, data.blockId, day, m2t(min));
        else onMoveBlock(data.fromDay, data.blockId, day, m2t(min));
      }
      else if (data.type === 'task') onAddTask(data.task, day, m2t(min));
      else if (data.type === 'workbookblock') onAddWorkbookBlock(data.workbookId, data.subWorkbookId, day, m2t(min));
      else if (data.type === 'weekworkbookblock') {
        if (data.copy) onCopyWorkbookBlock(data.fromDay, data.blockId, day, m2t(min));
        else onMoveWorkbookBlock(data.fromDay, data.blockId, day, m2t(min));
      }
      else if (data.type === 'calevent-copy') onCopyEvent(data.calId, data.subject, data.durationMin, day, m2t(min));
    } catch { /* payload drag non valido — ignora */ }
    setDragOver(null);
  }

  // Clic su uno spazio vuoto della colonna: apre "Nuovo evento" precompilato
  // con quel giorno e l'ora del punto cliccato.
  function handleColClick(e, day) {
        if (suppressClickRef?.current) { suppressClickRef.current = false; return; }
    if (e.target.closest('.planner-week-cal-event, .planner-week-task-block, .planner-week-workbook-block')) return;
    onCreateEvent(day, m2t(slotFromEvent(e)));
  }

  return (
    <div className="planner-week-wrap">
      <div className="planner-week-head" style={{ paddingRight: scrollbarW }}>
        <div className="planner-week-gutter" />
        {weekDays.map(day => (
          <div
            key={day}
            className={`planner-week-day-header${day === today ? ' today' : ''}`}
            onClick={() => onDayClick(day)}>
            {new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        ))}
        <div className="planner-week-gutter right" />
      </div>
      {/* All-day events row */}
      <div className="planner-week-allday-row" style={{ paddingRight: scrollbarW }}>
        <div className="planner-week-gutter" />
        {weekDays.map(day => {
          const dayAllDay = calEvents.filter(ev =>
            isAllDay(ev) && (ev.start?.date || ev.start?.dateTime || '').slice(0, 10) === day
          );
          return (
            <div key={day} className="planner-week-allday-col">
              {dayAllDay.map((ev, i) => (
                <span key={i} className="planner-allday-chip" onClick={() => onEventClick(ev)} title={ev.subject}>{ev.subject}</span>
              ))}
            </div>
          );
        })}
        <div className="planner-week-gutter right" />
      </div>
      <div className="planner-week-body" ref={weekBodyRef}>
        <div className="planner-week-gutter-col" style={{ height: timeSlots.length * SLOT_HEIGHT }}>
          {timeSlots.map(slot => (
            <div key={slot} className="planner-week-slot-label" style={{ height: SLOT_HEIGHT }}>{slot}</div>
          ))}
        </div>
        {weekDays.map(day => {
          const dayPlan         = plans[day] || { blocks: [] };
          const dayWorkbookPlan = workbookPlans[day] || { blocks: [] };
          const dayEvents = calEvents.filter(ev => !isAllDay(ev) && evDayStr(ev) === day);
          // Gli eventi che si accavallano si dividono la colonna del giorno.
          const dayEventsLayout = overlapColumns(dayEvents.map(eventSpan));
          return (
            <div
              key={day}
              className={`planner-week-day-col${day === today ? ' today' : ''}`}
              style={{ height: timeSlots.length * SLOT_HEIGHT }}
              onDragOver={e => handleColDragOver(e, day)}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null);
              }}
              onDrop={e => handleColDrop(e, day)}
              onClick={e => handleColClick(e, day)}>
              {timeSlots.map(slot => (
                <div key={slot} className="planner-week-slot-row" style={{ height: SLOT_HEIGHT }} />
              ))}
              {dragOver?.day === day && (
                <div
                  className="planner-week-drop-indicator"
                  style={{ top: (dragOver.min - DAY_START_MIN) / 30 * SLOT_HEIGHT, height: SLOT_HEIGHT }}>
                  {m2t(dragOver.min)}
                </div>
              )}
              {!workbookCalHidden && dayWorkbookPlan.blocks.map(wb => {
                const top    = Math.max(0, (t2m(wb.startTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT - 4, (t2m(wb.endTime) - t2m(wb.startTime)) / 30 * SLOT_HEIGHT - 4);
                const wbColor = liveWorkbookColor(wb, workbooks);
                const isVertical  = (t2m(wb.endTime) - t2m(wb.startTime)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(wb.label, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
                const notesEls = (wb.notes || []).map(note => (
                  <WorkbookBlockNote
                    key={note.id}
                    note={note}
                    blockHeight={height}
                    onChange={text => onEditWorkbookNote(day, wb.id, note.id, text)}
                    onMove={noteTop => onMoveWorkbookNote(day, wb.id, note.id, noteTop)}
                    onRemove={() => onRemoveWorkbookNote(day, wb.id, note.id)}
                  />
                ));
                return (
                  <div key={wb.id}
                    className={`planner-week-workbook-block${isVertical ? ' vertical-layout' : ''}`}
                    style={{ top: top + 2, height, background: hexToRgba(wbColor, 0.28), borderLeftColor: wbColor }}
                    title={`${wb.startTime}–${wb.endTime} · ${wb.label} (trascina per spostare, Ctrl+trascina per duplicare, doppio clic per una nota)`}
                    draggable={resizingWbId !== wb.id}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => {
                      // Una nota in editing/drag (vedi WorkbookBlockNote) non deve
                      // avviare il drag nativo dell'intero blocco.
                      if (e.target.closest('.planner-block-note')) { e.preventDefault(); return; }
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekworkbookblock', blockId: wb.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}
                    onDoubleClick={e => {
                      if (e.target.closest('.planner-block-note')) return;
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const noteTop = Math.max(0, Math.min(height - 22, e.clientY - rect.top));
                      onAddWorkbookNote(day, wb.id, noteTop);
                    }}>
                    {isVertical ? (
                      <>
                        <div className="planner-block-label-col">
                          <div className="planner-block-label-title-wrap">
                            <VerticalTitle text={wb.label} layout={titleLayout} className="planner-block-title" />
                          </div>
                          <span className="planner-block-label-duration">{fmtBlockDuration(t2m(wb.endTime) - t2m(wb.startTime))}</span>
                        </div>
                        <div className="planner-block-content-col">{notesEls}</div>
                      </>
                    ) : (
                      <>
                        <span className="planner-block-title">{wb.label}</span>
                        {notesEls}
                      </>
                    )}
                                          <button
                        className="planner-week-workbook-block-remove"
                        onClick={e => { e.stopPropagation(); onRemoveWorkbookBlock(day, wb.id); }}
                        title="Elimina">×</button>
                    
                                          <div
                        className="planner-block-resize"
                        onMouseDown={e => handleWbResizeMouseDown(e, wb, day)} />
                    
                  </div>
                );
              })}
              {dayEvents.map((ev, i) => {
                const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
                const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
                if (!evStart || !evEnd) return null;
                const top    = Math.max(0, (t2m(evStart) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT / 2, (t2m(evEnd) - t2m(evStart)) / 30 * SLOT_HEIGHT);
                const evColor = coloreEvento(ev, coloriCalendari);
                const isVertical  = (t2m(evEnd) - t2m(evStart)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(ev.subject, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
                const geo = dayEventsLayout[i] || { col: 0, cols: 1 };
                return (
                  <div key={ev.id || i} className={`planner-week-cal-event${isVertical ? ' vertical-layout' : ''}`}
                    style={{
                      top, height, background: evColor, borderLeftColor: evColor,
                      '--cal-col': geo.col, '--cal-cols': geo.cols,
                    }}
                    draggable
                    onDragStart={e => {
                      if (!(e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({
                        type: 'calevent-copy', calId: ev._calId || null, subject: ev.subject, durationMin: t2m(evEnd) - t2m(evStart),
                      }));
                    }}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    title={`${evStart}–${evEnd} · ${ev.subject} (clicca per modificare, Ctrl+trascina per duplicare)`}>
                    {isVertical ? (
                      <>
                        <div className="planner-block-label-col">
                          <div className="planner-block-label-title-wrap">
                            <VerticalTitle text={ev.subject} layout={titleLayout} className="planner-event-title" />
                          </div>
                          <span className="planner-block-label-duration">{fmtBlockDuration(t2m(evEnd) - t2m(evStart))}</span>
                        </div>
                        <div className="planner-block-content-col" />
                      </>
                    ) : (
                      <>
                        <span className="planner-event-time">{evStart}</span>
                        <span className="planner-event-title">{ev.subject}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {dayPlan.blocks.map(block => {
                const top    = Math.max(0, (t2m(block.startTime) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT - 4, (t2m(block.endTime) - t2m(block.startTime)) / 30 * SLOT_HEIGHT - 4);
                const isVertical  = (t2m(block.endTime) - t2m(block.startTime)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(block.taskTitle, height - (block.listName ? 30 : 12) - VERTICAL_DURATION_RESERVE_PX, 9) : null;
                const blockColor = liveBlockColor(block, config, listColorMap);
                return (
                  <div key={block.id}
                    className={`planner-week-task-block${block.completed ? ' completed' : ''}${isVertical ? ' vertical-layout' : ''}`}
                    style={{
                    top: top + 2, height,
                    background: hexToRgba(blockColor, 0.10),
                    borderColor: hexToRgba(blockColor, 0.22),
                    borderLeftColor: blockColor,
                  }}
                    title={`${block.startTime}–${block.endTime} · ${block.taskTitle} (trascina per spostare, Ctrl+trascina per duplicare)`}
                    draggable={!block.completed && resizingId !== block.id}
                    onClick={e => { e.stopPropagation(); onBlockClick?.(block); }}
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekblock', blockId: block.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}>
                    {isVertical ? (
                      <div className="planner-block-label-col">
                        {block.listName && <span className="planner-block-label-section">{listLabel(block.listName)}</span>}
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={block.taskTitle} layout={titleLayout} className="planner-block-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(t2m(block.endTime) - t2m(block.startTime))}</span>
                      </div>
                    ) : (
                      <span className="planner-block-title">{block.taskTitle}</span>
                    )}
                    {!block.completed && (
                      <div
                        className="planner-block-resize"
                        onMouseDown={e => handleResizeMouseDown(e, block, day)} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="planner-week-gutter-col right" style={{ height: timeSlots.length * SLOT_HEIGHT }}>
          {timeSlots.map(slot => (
            <div key={slot} className="planner-week-slot-label" style={{ height: SLOT_HEIGHT }}>{slot}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
