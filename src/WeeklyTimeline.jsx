// La vista Settimana: sette colonne della stessa griglia a mezz'ore della vista
// Giorno, con i blocchi task, gli eventi del calendario e i blocchi Workbook
// (che qui si possono ridimensionare e annotare). Quasi quattrocento righe che
// stavano in fondo a PlannerView.jsx e non c'entravano niente con il resto: il
// componente riceve tutto dall'alto e non tocca la rete.
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { hexToRgba } from './plannerShared';
import {
  SLOT_HEIGHT, DAY_START_MIN, DAY_END_MIN,
  VERTICAL_LAYOUT_MIN_DURATION, VERTICAL_DURATION_RESERVE_PX,
  t2m, m2t, verticalTitleLayout, calendarSwatch, defaultScrollOffset,
  fmtBlockDuration, isAllDay, isoToHHMM, liveBlockColor, liveWorkbookColor, todayStr,
} from './plannerGrid';
import VerticalTitle from './VerticalTitle';

export function WeeklyTimeline({
  weekDays, plans, calEvents, workbookPlans, workbooks, workbookCalHidden, workdayStartMin, timeSlots, locked, suppressClickRef,
  config, listColorMap,
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
    if (locked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ day, min: slotFromEvent(e) });
  }

  function handleColDrop(e, day) {
    e.preventDefault();
    if (locked) { setDragOver(null); return; }
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
    if (locked) return;
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
          const dayEvents = calEvents.filter(ev =>
            !isAllDay(ev) && (ev.start?.dateTime || ev.start?.date || '').slice(0, 10) === day
          );
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
                    locked={locked}
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
                    draggable={!locked && resizingWbId !== wb.id}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => {
                      // Una nota in editing/drag (vedi WorkbookBlockNote) non deve
                      // avviare il drag nativo dell'intero blocco.
                      if (e.target.closest('.planner-block-note')) { e.preventDefault(); return; }
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekworkbookblock', blockId: wb.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}
                    onDoubleClick={e => {
                      if (locked || e.target.closest('.planner-block-note')) return;
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
                    {!locked && (
                      <button
                        className="planner-week-workbook-block-remove"
                        onClick={e => { e.stopPropagation(); onRemoveWorkbookBlock(day, wb.id); }}
                        title="Elimina">×</button>
                    )}
                    {!locked && (
                      <div
                        className="planner-block-resize"
                        onMouseDown={e => handleWbResizeMouseDown(e, wb, day)} />
                    )}
                  </div>
                );
              })}
              {dayEvents.map((ev, i) => {
                const evStart = isoToHHMM(ev.start?.dateTime || ev.start?.date);
                const evEnd   = isoToHHMM(ev.end?.dateTime   || ev.end?.date);
                if (!evStart || !evEnd) return null;
                const top    = Math.max(0, (t2m(evStart) - DAY_START_MIN) / 30 * SLOT_HEIGHT);
                const height = Math.max(SLOT_HEIGHT / 2, (t2m(evEnd) - t2m(evStart)) / 30 * SLOT_HEIGHT);
                const evColor = calendarSwatch(ev._calColor);
                const isVertical  = (t2m(evEnd) - t2m(evStart)) > VERTICAL_LAYOUT_MIN_DURATION;
                const titleLayout = isVertical ? verticalTitleLayout(ev.subject, height - 12 - VERTICAL_DURATION_RESERVE_PX, 10) : null;
                return (
                  <div key={i} className={`planner-week-cal-event${isVertical ? ' vertical-layout' : ''}`}
                    style={{ top, height, background: evColor, borderLeftColor: evColor }}
                    draggable={!locked}
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
                    draggable={!block.completed && !locked && resizingId !== block.id}
                    onClick={e => { e.stopPropagation(); onBlockClick?.(block); }}
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'weekblock', blockId: block.id, fromDay: day, copy: e.ctrlKey || e.metaKey }));
                    }}>
                    {isVertical ? (
                      <div className="planner-block-label-col">
                        {block.listName && <span className="planner-block-label-section">{block.listName}</span>}
                        <div className="planner-block-label-title-wrap">
                          <VerticalTitle text={block.taskTitle} layout={titleLayout} className="planner-block-title" />
                        </div>
                        <span className="planner-block-label-duration">{fmtBlockDuration(t2m(block.endTime) - t2m(block.startTime))}</span>
                      </div>
                    ) : (
                      <span className="planner-block-title">{block.taskTitle}</span>
                    )}
                    {!block.completed && !locked && (
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

// Nota libera dentro un workbook block: ancorata a un offset verticale
// (note.top, px dal bordo superiore del blocco) invece che a un orario, così
// si può segnare "caffè" o "pranzo" in un punto preciso di una fascia larga
// (es. "Ufficio" 8–17:30) senza spezzarla in blocchi separati. Testo libero
// con a-capo (textarea), riposizionabile trascinando la maniglia ⠿.
function WorkbookBlockNote({ note, blockHeight, locked, onChange, onMove, onRemove }) {
  const [editing, setEditing] = useState(!note.text);
  const [draft, setDraft]     = useState(note.text);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft.trim() === note.text.trim() && note.text) return;
    onChange(draft);
  }

  function handleDragHandleMouseDown(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const startY   = e.clientY;
    const startTop = note.top;
    function onMove_(ev) {
      const nextTop = Math.max(0, Math.min(Math.max(0, blockHeight - 22), startTop + (ev.clientY - startY)));
      onMove(nextTop);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove_);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove_);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div className="planner-block-note" style={{ top: note.top }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="planner-block-note-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') { setDraft(note.text); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.currentTarget.blur(); }
          }}
        />
      ) : (
        <>
          {!locked && (
            <span className="planner-block-note-drag" onMouseDown={handleDragHandleMouseDown} title="Trascina per riposizionare">⠿</span>
          )}
          <pre className="planner-block-note-text" onClick={() => !locked && setEditing(true)}>{note.text}</pre>
          {!locked && (
            <button className="planner-block-note-remove" onClick={onRemove} title="Elimina nota">×</button>
          )}
        </>
      )}
    </div>
  );
}
