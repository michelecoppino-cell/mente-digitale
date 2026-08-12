// Il pannello di dettaglio di un'attività: titolo, scadenza, stima, note,
// sottoattività, stato del flusso GTD e le risorse della sezione collegata.
//
// Nasce dentro PlannerView, dove era la terza colonna del Piano. Vive qui da
// solo perché è l'unico posto in cui un'attività si può davvero lavorare, e
// quel posto deve essere lo stesso ovunque la si tocchi: dal Piano, dalla
// scheda Attività e dal workbook di Sezioni.
//
// Senza `// @ts-check`, come PlannerView da cui viene: il codice qui dentro è
// lo stesso di prima, e accenderlo adesso vorrebbe dire annotare mezzo file in
// un cambiamento che di suo non tocca la logica.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  completeTask, createTask, deleteTask, getTask,
  createChecklistItem, updateChecklistItem, renameChecklistItem,
  deleteChecklistItem, reorderChecklistItems,
  updateTaskBody, updateTaskDueDate, updateTaskStatus, updateTaskTitle,
} from './api';
import {
  ESTIMATE_CHOICES, DEFAULT_ESTIMATE_MIN, parseEstimate, withEstimateMarker,
  graphStatusFor, parseWaitingFor, withWaitingFor, waitingDays,
} from './taskModel';
import { usePomodoro } from './pomodoroContext';
import { pushUndo } from './undo';
import SectionResources from './SectionResources';
import Skeleton from './Skeleton';
import './PlannerView.css';

/** Gli stati che si possono dare da qui. `inbox` non c'è (è la lista in cui sta
 *  il task) e `scheduled` nemmeno: un orario si dà dal Piano, sulla griglia. */
const STATUS_CHOICES = [
  { key: 'next',    label: 'Prossima azione', hint: 'Fattibile, senza data' },
  { key: 'waiting', label: 'In attesa',       hint: 'Dipende da qualcun altro' },
  { key: 'someday', label: 'Un giorno',       hint: 'Non adesso' },
];

/** La persona attesa scritta nelle note, se c'è. */
function whoFrom(/** @type {string} */ body) {
  return parseWaitingFor(/** @type {any} */ ({ body: { content: body } }))?.who || '';
}

/** Lo stato del flusso a partire dallo `status` di Graph. */
function flowStatusOf(/** @type {string|undefined} */ graphStatus) {
  if (graphStatus === 'waitingOnOthers') return 'waiting';
  if (graphStatus === 'deferred') return 'someday';
  return 'next';
}

/**
 * @param {Object} props
 * @param {import('./types').TodoTask} props.task
 * @param {import('./types').Notebook[]} [props.notebooks]
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {{ current: Record<string, import('./types').Page[]> }|null} [props.pagesCache]
 * @param {() => void} [props.onClose]
 * @param {() => void} [props.onCompleted]
 * @param {() => void} [props.onDeleted]
 * @param {(title: string) => void} [props.onRenamed]
 * @param {(due: {dateTime: string, timeZone: string}|null) => void} [props.onDueChanged]
 * @param {(listId: string, task: import('./types').TodoTask) => void} [props.onRestored]
 * @param {(min: number) => void} [props.onEstimateChanged]
 * @param {(patch: Object) => void} [props.onPatched]  stato/note cambiati: il pool va allineato
 */
export default function TaskDetailPanel({ task, notebooks = [], sectionsMap = {}, pagesCache = null, onClose, onCompleted, onDeleted, onRenamed, onDueChanged, onRestored, onEstimateChanged, onPatched }) {
  const navigate = useNavigate();
  const { start: startPomodoro } = usePomodoro();
  // La sezione PARA del task è la sezione OneNote che si chiama come la sua
  // lista To-Do: è la convenzione su cui poggia tutta l'app. Senza, il
  // pomodoro non saprebbe quale workbook aprire e il bottone non compare.
  const sectionId = (() => {
    const name = (task?._listName || '').toLowerCase();
    if (!name) return null;
    for (const sects of Object.values(sectionsMap || {})) {
      const sec = (sects || []).find(x => (x.displayName || '').toLowerCase() === name);
      if (sec) return sec.id;
    }
    return null;
  })();
  const [loading, setLoading]         = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft]   = useState(task.title);
  const [working, setWorking]         = useState(false);
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState([]);
  const [newItemText, setNewItemText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemDraft, setItemDraft]     = useState('');
  const [reordering, setReordering]   = useState(false);
  const dragIndexRef                  = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const notesTimerRef                 = useRef(null);
  const [dueDraft, setDueDraft]       = useState('');
  const [savingDue, setSavingDue]     = useState(false);
  const [itemError, setItemError]     = useState('');
  const [savingEstimate, setSavingEstimate] = useState(false);
  // Stato del flusso e persona attesa: si conoscono solo dopo il caricamento
  // completo del task, perché chi apre il pannello da un blocco del Piano ha in
  // mano solo id, titolo e lista.
  const [flowStatus, setFlowStatus] = useState(() => flowStatusOf(task?.status));
  const [who, setWho] = useState('');
  const [waitingSince, setWaitingSince] = useState(/** @type {string|null} */ (null));
  const [savingStatus, setSavingStatus] = useState(false);
  const estimate = parseEstimate(notes) ?? DEFAULT_ESTIMATE_MIN;

  // Sezione OneNote collegata alla lista ToDo del task (per nome, come nel
  // resto dell'app) — usata per mostrare qui sotto i riquadri OneNote/OneDrive.
  const { section, notebook } = useMemo(() => {
    const lower = (task._listName || '').toLowerCase();
    if (!lower) return { section: null, notebook: null };
    for (const [nbId, sects] of Object.entries(sectionsMap)) {
      const sec = sects.find(s => s.displayName.toLowerCase() === lower);
      if (sec) return { section: sec, notebook: notebooks.find(n => n.id === nbId) || { id: nbId } };
    }
    return { section: null, notebook: null };
  }, [task._listName, notebooks, sectionsMap]);

  useEffect(() => { setTitleDraft(task.title); setEditingTitle(false); load(); }, [task.id]); // eslint-disable-line

  async function load() {
    setLoading(true);
    try {
      const full = await getTask(task._listId, task.id);
      let body = full.body?.content || '';
      if (full.body?.contentType === 'html') {
        body = body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      }
      setNotes(body);
      setItems((full.checklistItems || []).sort((a, b) => a.isChecked - b.isChecked));
      setDueDraft(full.dueDateTime?.dateTime ? full.dueDateTime.dateTime.slice(0, 10) : '');
      setFlowStatus(flowStatusOf(full.status));
      setWho(whoFrom(body));
      setWaitingSince(full.lastModifiedDateTime || full.createdDateTime || null);
    } catch (e) { console.error('load task detail', e); }
    setLoading(false);
  }

  async function handleDueChange(e) {
    const val = e.target.value;
    const prevVal = dueDraft;
    setDueDraft(val);
    setSavingDue(true);
    try {
      await updateTaskDueDate(task._listId, task.id, val || null);
      onDueChanged?.(val ? { dateTime: val, timeZone: 'UTC' } : null);
      if (prevVal !== val) {
        pushUndo({
          label: 'Scadenza task modificata',
          undo: async () => {
            await updateTaskDueDate(task._listId, task.id, prevVal || null);
            onDueChanged?.(prevVal ? { dateTime: prevVal, timeZone: 'UTC' } : null);
            setDueDraft(prevVal);
          },
        });
      }
    } catch (err) { console.error('save due date', err); }
    setSavingDue(false);
  }

  async function handleEstimateChange(min) {
    if (min === estimate || savingEstimate) return;
    const prev = notes;
    const next = withEstimateMarker(notes, min);
    // Il debounce delle note sta per riscrivere il body con la versione
    // vecchia: va fermato, o sovrascriverebbe il marker appena messo.
    clearTimeout(notesTimerRef.current);
    setNotes(next);
    setSavingEstimate(true);
    try {
      await updateTaskBody(task._listId, task.id, next);
      onEstimateChanged?.(min);
      pushUndo({
        label: `Stima portata a ${ESTIMATE_CHOICES.find(c => c.min === min)?.label ?? `${min}m`}`,
        undo: async () => {
          await updateTaskBody(task._listId, task.id, prev);
          setNotes(prev);
          onEstimateChanged?.(estimate);
        },
      });
    } catch (e) {
      console.error('save estimate', e);
      setNotes(prev);
    }
    setSavingEstimate(false);
  }

  // ── Stato del flusso ────────────────────────────────────────────────────────
  // "In attesa" è due cose insieme: lo status waitingOnOthers su Graph — così
  // anche l'app To-Do del telefono la vede in attesa — e la riga "In attesa da:
  // Nome" in testa alle note, che è dove finisce il nome della persona perché
  // una lista personale di To-Do non ha un campo "assegnato a". Fino a qui
  // quella riga andava scritta a mano: nessuno poteva indovinarne la forma.
  /**
   * @param {string} next        stato del flusso da applicare
   * @param {string} [whoValue]  persona attesa, se `next` è 'waiting'
   */
  async function applyStatus(next, whoValue = who) {
    if (savingStatus) return;
    const prevStatus = flowStatus;
    const prevNotes = notes;
    const person = next === 'waiting' ? (whoValue.trim() || 'qualcuno') : null;
    const nextNotes = withWaitingFor(notes, person);
    if (next === prevStatus && nextNotes === prevNotes) return;

    // Il debounce delle note sta per riscrivere il body con la versione
    // vecchia: va fermato, o cancellerebbe la riga appena messa.
    clearTimeout(notesTimerRef.current);
    setFlowStatus(next);
    setNotes(nextNotes);
    setSavingStatus(true);
    try {
      if (nextNotes !== prevNotes) await updateTaskBody(task._listId, task.id, nextNotes);
      const graph = graphStatusFor(/** @type {any} */ (next));
      if (next !== prevStatus) await updateTaskStatus(task._listId, task.id, graph);
      // Senza un nome la riga dice "qualcuno": il campo deve dirlo anche lui,
      // o resterebbe vuoto mentre le note sotto raccontano un'altra cosa.
      setWho(person || '');
      setWaitingSince(new Date().toISOString());
      onPatched?.({ status: graph, body: { content: nextNotes, contentType: 'text' } });
      pushUndo({
        label: next === 'waiting'
          ? `In attesa da ${person}`
          : `Riportata in ${STATUS_CHOICES.find(s => s.key === next)?.label ?? next}`,
        undo: async () => {
          if (nextNotes !== prevNotes) await updateTaskBody(task._listId, task.id, prevNotes);
          const back = graphStatusFor(/** @type {any} */ (prevStatus));
          if (next !== prevStatus) await updateTaskStatus(task._listId, task.id, back);
          setFlowStatus(prevStatus);
          setNotes(prevNotes);
          setWho(whoFrom(prevNotes));
          onPatched?.({ status: back, body: { content: prevNotes, contentType: 'text' } });
        },
      });
    } catch (e) {
      console.error('cambio stato task', e);
      setFlowStatus(prevStatus);
      setNotes(prevNotes);
    }
    setSavingStatus(false);
  }

  function handleNotesChange(e) {
    const val = e.target.value;
    setNotes(val);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setSavingNotes(true);
      try { await updateTaskBody(task._listId, task.id, val); } catch (e) { console.error('save notes', e); }
      setSavingNotes(false);
    }, 1200);
  }

  function flashItemError(action, e) {
    console.error(action, e);
    setItemError(`Errore: ${action} non riuscito${e?.message ? ` (${e.message})` : ''}. Riprova.`);
  }

  useEffect(() => {
    if (!itemError) return;
    const t = setTimeout(() => setItemError(''), 5000);
    return () => clearTimeout(t);
  }, [itemError]);

  async function handleToggle(item) {
    const checked = !item.isChecked;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: checked } : i));
    try {
      await updateChecklistItem(task._listId, task.id, item.id, checked);
      pushUndo({
        label: `"${item.displayName}" ${checked ? 'spuntata' : 'da fare'}`,
        undo: async () => {
          await updateChecklistItem(task._listId, task.id, item.id, !checked);
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: !checked } : i));
        },
      });
    } catch (e) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isChecked: !checked } : i));
      flashItemError('spunta checklist', e);
    }
  }

  async function handleDelete(itemId) {
    const removed = items.find(i => i.id === itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await deleteChecklistItem(task._listId, task.id, itemId);
      if (removed) {
        pushUndo({
          label: `Voce "${removed.displayName}" eliminata`,
          undo: async () => {
            const created = await createChecklistItem(task._listId, task.id, removed.displayName);
            if (removed.isChecked) await updateChecklistItem(task._listId, task.id, created.id, true);
            setItems(prev => [...prev, { ...created, isChecked: !!removed.isChecked }]);
          },
        });
      }
    } catch (e) {
      if (removed) setItems(prev => [...prev, removed]);
      flashItemError('eliminazione voce', e);
    }
  }

  async function handleAdd(formEvent) {
    formEvent.preventDefault();
    const text = newItemText.trim();
    if (!text) return;
    setNewItemText('');
    const tmp = { id: `tmp-${Date.now()}`, displayName: text, isChecked: false };
    setItems(prev => [...prev, tmp]);
    try {
      const created = await createChecklistItem(task._listId, task.id, text);
      setItems(prev => prev.map(i => i.id === tmp.id ? created : i));
      pushUndo({
        label: `Voce "${text}" aggiunta`,
        undo: async () => {
          await deleteChecklistItem(task._listId, task.id, created.id);
          setItems(prev => prev.filter(i => i.id !== created.id));
        },
      });
    } catch (err) {
      setItems(prev => prev.filter(i => i.id !== tmp.id));
      setNewItemText(text);
      flashItemError('aggiunta voce', err);
    }
  }

  function startItemRename(item) {
    setEditingItemId(item.id);
    setItemDraft(item.displayName);
  }

  async function submitItemRename() {
    const item = items.find(i => i.id === editingItemId);
    setEditingItemId(null);
    const text = itemDraft.trim();
    if (!item || !text || text === item.displayName) return;
    const prevName = item.displayName;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: text } : i));
    try {
      await renameChecklistItem(task._listId, task.id, item.id, text);
      pushUndo({
        label: `Voce rinominata in "${text}"`,
        undo: async () => {
          await renameChecklistItem(task._listId, task.id, item.id, prevName);
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: prevName } : i));
        },
      });
    } catch (e) {
      console.error('rename checklist item', e);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, displayName: item.displayName } : i));
    }
  }

  async function persistReorder(reordered) {
    setItems(reordered);
    setReordering(true);
    try {
      const created = await reorderChecklistItems(task._listId, task.id, reordered);
      setItems(created.sort((a, b) => a.isChecked - b.isChecked));
    } catch (e) {
      console.error('reorder checklist items', e);
      await load();
    }
    setReordering(false);
  }

  function moveItem(index, dir) {
    const next = index + dir;
    if (next < 0 || next >= items.length || reordering) return;
    const reordered = [...items];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    persistReorder(reordered);
  }

  function handleItemDrop(index) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from === null || from === index || reordering) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);
    persistReorder(reordered);
  }

  function submitRename() {
    const title = titleDraft.trim();
    const prevTitle = task.title;
    setEditingTitle(false);
    if (!title || title === task.title) { setTitleDraft(task.title); return; }
    setTitleDraft(title);
    updateTaskTitle(task._listId, task.id, title)
      .then(() => {
        onRenamed?.(title);
        pushUndo({
          label: `Task rinominato in "${title}"`,
          undo: async () => {
            await updateTaskTitle(task._listId, task.id, prevTitle);
            onRenamed?.(prevTitle);
            setTitleDraft(prevTitle);
          },
        });
      })
      .catch(e => { console.error('rename task', e); setTitleDraft(task.title); });
  }

  async function handleCompleteTask() {
    setWorking(true);
    try {
      await completeTask(task._listId, task.id);
      const snapshot = { ...task };
      onCompleted?.();
      pushUndo({
        label: `Task "${task.title}" completato`,
        undo: async () => {
          await updateTaskStatus(task._listId, task.id, 'notStarted');
          onRestored?.(task._listId, snapshot);
        },
      });
    } catch (e) { console.error('complete task', e); }
    setWorking(false);
  }

  async function handleDeleteTask() {
    if (!window.confirm(`Eliminare il task "${task.title}"? Potrai annullare subito dopo con Ctrl+Z.`)) return;
    setWorking(true);
    // Snapshot completo (titolo, scadenza, note, checklist) per poter
    // ricreare il task in caso di undo — Graph non offre un "ripristina".
    const snapshot = {
      title: task.title,
      listId: task._listId,
      listName: task._listName,
      dueDate: dueDraft || null,
      body: notes || '',
      items: items.map(i => ({ displayName: i.displayName, isChecked: !!i.isChecked })),
    };
    try {
      await deleteTask(task._listId, task.id);
      onDeleted?.();
      pushUndo({
        label: `Task "${snapshot.title}" eliminato`,
        undo: async () => {
          const created = await createTask(snapshot.listId, snapshot.title, {
            body: snapshot.body || undefined,
            dueDate: snapshot.dueDate || undefined,
          });
          for (const it of snapshot.items) {
            const ci = await createChecklistItem(snapshot.listId, created.id, it.displayName);
            if (it.isChecked) await updateChecklistItem(snapshot.listId, created.id, ci.id, true);
          }
          onRestored?.(snapshot.listId, { ...created, _listId: snapshot.listId, _listName: snapshot.listName });
        },
      });
    } catch (e) { console.error('delete task', e); }
    setWorking(false);
  }

  return (
    <div className="planner-task-detail">
      <div className="planner-task-detail-header">
        {editingTitle ? (
          <input
            autoFocus
            className="planner-task-detail-title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); }
            }}
          />
        ) : (
          <div className="planner-task-detail-title" onClick={() => setEditingTitle(true)} title="Clicca per rinominare">
            {task.title}
          </div>
        )}
        <div className="planner-task-detail-meta">{task._listName}</div>
        <div className="planner-task-detail-due">
          <span>📅 Scadenza</span>
          <input
            type="date"
            className="planner-task-detail-due-input"
            value={dueDraft}
            onChange={handleDueChange}
          />
          {savingDue && <span className="planner-saving-dot">●</span>}
        </div>
        <div className="planner-task-detail-header-actions">
          <button className="planner-task-detail-action" onClick={() => setEditingTitle(true)} disabled={working} title="Rinomina">✎</button>
          <button className="planner-task-detail-action" onClick={handleCompleteTask} disabled={working} title="Segna come completato">✓</button>
          <button className="planner-task-detail-action danger" onClick={handleDeleteTask} disabled={working} title="Elimina task">🗑</button>
        </div>
        <button className="planner-task-detail-close" onClick={onClose} title="Chiudi">✕</button>
      </div>

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          {/* La stima vive nelle note come marker [MIN:n], ed è la stessa che
              il chiarimento chiede in «Quanto ci vuole». Fino a qui si poteva
              scrivere solo lì: da qualunque altra parte un task valeva mezz'ora
              per definizione. Cambiarla riscala anche il blocco già a piano. */}
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Quanto ci vuole {savingEstimate && <span className="planner-saving-dot">●</span>}
            </div>
            <div className="planner-estimate-chips">
              {ESTIMATE_CHOICES.map(c => (
                <button
                  key={c.min}
                  className={`planner-estimate-chip${estimate === c.min ? ' active' : ''}`}
                  onClick={() => handleEstimateChange(c.min)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lo stato del flusso, e con esso il modo di mettere un'attività in
              attesa: si sceglie la pastiglia e si scrive chi si aspetta, invece
              di dover conoscere a memoria la riga da mettere nelle note. */}
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Stato {savingStatus && <span className="planner-saving-dot">●</span>}
            </div>
            <div className="planner-estimate-chips">
              {STATUS_CHOICES.map(s => (
                <button
                  key={s.key}
                  className={`planner-estimate-chip${flowStatus === s.key ? ' active' : ''}`}
                  title={s.hint}
                  disabled={savingStatus}
                  onClick={() => applyStatus(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            {flowStatus === 'waiting' && (
              <div className="planner-waiting">
                <input
                  className="planner-waiting-input"
                  value={who}
                  onChange={e => setWho(e.target.value)}
                  onBlur={() => applyStatus('waiting', who)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="Da chi aspetti…"
                />
                <span className="planner-waiting-since">
                  {(() => {
                    const d = waitingDays(waitingSince);
                    if (d === null) return null;
                    return d === 0 ? 'da oggi' : `da ${d} ${d === 1 ? 'giorno' : 'giorni'}`;
                  })()}
                </span>
              </div>
            )}
          </div>

          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Note {savingNotes && <span className="planner-saving-dot">●</span>}
            </div>
            <textarea
              className="planner-task-detail-notes"
              value={notes}
              onChange={handleNotesChange}
              placeholder="Nessuna nota…"
              rows={4}
            />
          </div>

          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">Sottoattività ({items.length})</div>
            {items.map((item, index) => (
              <div
                key={item.id}
                className={`planner-checklist-item${item.isChecked ? ' checked' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
                draggable
                onDragStart={() => { dragIndexRef.current = index; }}
                onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
                onDragLeave={() => setDragOverIndex(prev => prev === index ? null : prev)}
                onDrop={e => { e.preventDefault(); handleItemDrop(index); }}
                onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}>
                <span className="planner-checklist-handle" title="Trascina per riordinare">⠿</span>
                <button className="planner-checklist-check" onClick={() => handleToggle(item)}>
                  {item.isChecked ? '✓' : '○'}
                </button>
                {editingItemId === item.id ? (
                  <input
                    autoFocus
                    className="planner-checklist-input planner-checklist-edit-input"
                    value={itemDraft}
                    onChange={e => setItemDraft(e.target.value)}
                    onBlur={submitItemRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitItemRename();
                      if (e.key === 'Escape') setEditingItemId(null);
                    }}
                  />
                ) : (
                  <span className="planner-checklist-text" onClick={() => startItemRename(item)} title="Clicca per rinominare">
                    {item.displayName}
                  </span>
                )}
                <div className="planner-checklist-move">
                  <button className="planner-checklist-move-btn" onClick={() => moveItem(index, -1)} disabled={index === 0 || reordering} title="Sposta su">▲</button>
                  <button className="planner-checklist-move-btn" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1 || reordering} title="Sposta giù">▼</button>
                </div>
                <button className="planner-checklist-delete" onClick={() => handleDelete(item.id)}>✕</button>
              </div>
            ))}
            <form className="planner-checklist-add" onSubmit={handleAdd}>
              <input
                type="text"
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                placeholder="+ Nuova sottoattività"
                className="planner-checklist-input"
              />
              <button type="submit" className="planner-checklist-add-btn" disabled={!newItemText.trim()}>
                +
              </button>
            </form>
            {itemError && <div className="planner-checklist-error">{itemError}</div>}
          </div>

          {/* Avviare il pomodoro da qui è ciò che lega la programmazione al
              posto di lavoro: la sessione sale a livello di app e porta al
              workbook della sezione, dove stanno le pagine e i file che
              servono a farla davvero, questa attività. */}
          {sectionId && (
            <button
              className="planner-pomodoro-start"
              onClick={() => {
                startPomodoro({
                  taskId: task.id,
                  taskTitle: task.title,
                  sectionId,
                  sectionName: task._listName || null,
                  durationMin: 25,
                });
                navigate(`/sezioni/${sectionId}`);
              }}>
              <span className="planner-pomodoro-dot" />
              Avvia pomodoro
              <span className="planner-pomodoro-caption">
                apre Sezioni sul workbook {task._listName || 'della sezione'}
              </span>
            </button>
          )}

          <SectionResources section={section} notebook={notebook} pagesCache={pagesCache} />
        </>
      )}
    </div>
  );
}
