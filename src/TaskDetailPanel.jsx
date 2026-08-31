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
  parseAlarm, withAlarm,
  graphStatusFor, PERSON_ROLES, personRoleFor, parsePersonLine, withPerson, waitingDays,
} from './taskModel';
import { elencoPersone, normalizzaPersona, ricordaPersona } from './persone';
import { SVEGLIA_CHOICES, hhmmIn, chiediNotifiche, statoNotifiche } from './sveglie';
import { listLabel, sectionNameForList } from './paraConfig';
import { pushUndo } from './undo';
import SectionResources from './SectionResources';
import Skeleton from './Skeleton';
import './PlannerView.css';

/** Gli stati che si possono dare da qui, nell'ordine delle colonne della vista
 *  Attività: aprendo un'attività dalla colonna Programmate si leggeva
 *  «Prossima azione», perché qui lo stato si ricavava dal solo `status` di
 *  Graph, che per una programmata è comunque `notStarted`. Le pastiglie sono
 *  ora le colonne del flusso, e «Programmata» porta al Piano — un orario si dà
 *  sulla griglia, non da una pastiglia.
 *
 *  `inbox` non è fra le scelte: non è uno stato ma la lista in cui il task sta,
 *  e ci si esce chiarendolo. Compare come pastiglia spenta quando è lo stato
 *  corrente, così la scheda non mente su dove si trova l'attività. */
const STATUS_CHOICES = [
  { key: 'next',      label: 'Prossima azione', hint: 'Fattibile, senza data' },
  { key: 'scheduled', label: 'Programmata',     hint: 'Ha un blocco nel Piano' },
  { key: 'ask',       label: 'Da chiedere',     hint: 'Prima devi chiederlo a qualcuno' },
  { key: 'waiting',   label: 'In attesa',       hint: 'Dipende da qualcun altro' },
  { key: 'delegated', label: 'Delegata',        hint: "L'ha in mano qualcun altro" },
  { key: 'someday',   label: 'Un giorno',       hint: 'Non adesso' },
];

/** La persona scritta nelle note, se c'è — di qualunque dei tre ruoli. */
function whoFrom(/** @type {string} */ body) {
  return parsePersonLine(body)?.who || '';
}

/** Lo stato del flusso a partire dallo `status` di Graph e dalle note: sono le
 *  note a dire se un `waitingOnOthers` è un'attesa o una delega, e se un
 *  `notStarted` è una prossima azione o una cosa da chiedere. Stessa regola di
 *  taskModel.taskStatus, con in mano quello che il pannello sa. */
function flowStatusOf(/** @type {string|undefined} */ graphStatus, /** @type {string} */ body = '') {
  const role = parsePersonLine(body)?.role;
  if (graphStatus === 'waitingOnOthers') return role === 'delegated' ? 'delegated' : 'waiting';
  if (graphStatus === 'deferred') return 'someday';
  return role === 'ask' ? 'ask' : 'next';
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
 * @param {string} [props.status]        stato del flusso già derivato da chi apre il pannello
 *                                       (include `scheduled` e `inbox`, che dallo `status` di
 *                                       Graph non si vedono). Senza, si ricava da Graph.
 * @param {(t: import('./types').TodoTask) => void} [props.onSchedule]    porta al Piano
 * @param {(t: import('./types').TodoTask) => Promise<void>|void} [props.onUnschedule]  toglie il blocco
 * @param {boolean} [props.showResources]  le risorse della sezione in fondo al pannello.
 *                                         Spente dove OneNote e i percorsi sono già colonne
 *                                         accanto — nella plancia di Sezioni.
 */
export default function TaskDetailPanel({ task, notebooks = [], sectionsMap = {}, pagesCache = null, onClose, onCompleted, onDeleted, onRenamed, onDueChanged, onRestored, onEstimateChanged, onPatched, status, onSchedule, onUnschedule, showResources = true }) {
  const navigate = useNavigate();
  // La sezione PARA del task è la sezione OneNote che si chiama come la sua
  // lista To-Do — o, se la lista è una consegna annidata (`2573.A60`, vedi
  // paraConfig.js), quella della sua commessa. Senza, il bottone che apre il
  // workbook non comparirebbe e i riquadri OneNote/OneDrive resterebbero
  // vuoti: tutte cose che sparirebbero in silenzio, senza un errore.
  const { section, notebook } = useMemo(() => {
    const names = Object.values(sectionsMap || {}).flat().map(s => s.displayName);
    const target = (sectionNameForList(task?._listName, names) || '').toLowerCase();
    if (!target) return { section: null, notebook: null };
    for (const [nbId, sects] of Object.entries(sectionsMap || {})) {
      const sec = (sects || []).find(x => (x.displayName || '').toLowerCase() === target);
      if (sec) return { section: sec, notebook: notebooks.find(n => n.id === nbId) || { id: nbId } };
    }
    return { section: null, notebook: null };
  }, [task?._listName, notebooks, sectionsMap]);
  const sectionId = section?.id || null;
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
  const [savingAlarm, setSavingAlarm] = useState(false);
  // Il permesso alle notifiche di sistema si chiede alla prima sveglia messa,
  // non all'avvio dell'app: chiederlo prima è chiederlo a vuoto.
  const [permessoNotifiche, setPermessoNotifiche] = useState(statoNotifiche);
  // Stato del flusso e persona attesa: si conoscono solo dopo il caricamento
  // completo del task, perché chi apre il pannello da un blocco del Piano ha in
  // mano solo id, titolo e lista.
  const [flowStatus, setFlowStatus] = useState(() => status || flowStatusOf(task?.status, task?.body?.content || ''));
  const [who, setWho] = useState('');
  const [waitingSince, setWaitingSince] = useState(/** @type {string|null} */ (null));
  const [savingStatus, setSavingStatus] = useState(false);
  const estimate = parseEstimate(notes) ?? DEFAULT_ESTIMATE_MIN;
  const sveglia = parseAlarm(notes);

  useEffect(() => { setTitleDraft(task.title); setEditingTitle(false); load(); }, [task.id]); // eslint-disable-line

  // Chi ci passa uno stato già derivato (la vista Attività, che sa dei blocchi
  // nel piano e della lista Inbox) è più informato di Graph: quando cambia —
  // il task viene programmato, o il blocco tolto — la pastiglia lo segue.
  useEffect(() => { if (status) setFlowStatus(status); }, [status, task.id]);

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
      setFlowStatus(status || flowStatusOf(full.status, body));
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

  // ── Sveglia ─────────────────────────────────────────────────────────────────
  // L'ora finisce nelle note come `[SVEGLIA:hh:mm]`, esattamente come la stima
  // ci finisce come `[MIN:n]`: stesso posto, stesso modo di scriverlo, stesso
  // debounce da fermare prima di riscrivere il body.
  /** @param {string|null} hhmm  "HH:MM", oppure null per togliere la sveglia */
  async function handleAlarmChange(hhmm) {
    if (hhmm === sveglia || savingAlarm) return;
    const prev = notes;
    const next = withAlarm(notes, hhmm);
    clearTimeout(notesTimerRef.current);
    setNotes(next);
    setSavingAlarm(true);
    try {
      await updateTaskBody(task._listId, task.id, next);
      onPatched?.({ body: { content: next, contentType: 'text' } });
      pushUndo({
        label: hhmm ? `Sveglia alle ${hhmm}` : 'Sveglia tolta',
        undo: async () => {
          await updateTaskBody(task._listId, task.id, prev);
          setNotes(prev);
          onPatched?.({ body: { content: prev, contentType: 'text' } });
        },
      });
      // Il pannello a tutto schermo arriva comunque; la notifica di sistema è
      // quella che si vede anche da dietro un'altra finestra, e per averla
      // serve il permesso. Si chiede qui, quando il gesto lo spiega da sé.
      if (hhmm && permessoNotifiche === 'default') {
        await chiediNotifiche();
        setPermessoNotifiche(statoNotifiche());
      }
    } catch (e) {
      console.error('save alarm', e);
      setNotes(prev);
    }
    setSavingAlarm(false);
  }

  // ── Stato del flusso ────────────────────────────────────────────────────────
  // Gli stati con una persona sono tre — «da chiedere», «in attesa»,
  // «delegata» — e sono due cose insieme: lo status su Graph, così anche l'app
  // To-Do del telefono li vede per quello che sono, e la riga "Delegato a:
  // Nome" in testa alle note, che è dove finisce il nome della persona perché
  // una lista personale di To-Do non ha un campo "assegnato a". Fino a qui
  // quella riga andava scritta a mano: nessuno poteva indovinarne la forma.
  /**
   * @param {string} next        stato del flusso da applicare
   * @param {string} [whoValue]  la persona, se `next` ne prevede una
   */
  async function applyStatus(next, whoValue = who) {
    if (savingStatus) return;
    const prevStatus = flowStatus;
    // «Programmata» non è un campo da scrivere ma un blocco sulla griglia del
    // Piano: la pastiglia porta lì con l'attività in mano, come fa il trascina
    // nella colonna Programmate.
    if (next === 'scheduled') { if (prevStatus !== 'scheduled') onSchedule?.(task); return; }

    const prevNotes = notes;
    // Il nome si normalizza sul registro delle persone (`persone.json`) e, se
    // è nuovo, viene ricordato: la volta dopo l'elenco lo propone da sé, e
    // «adc» scritto di fretta non apre un gruppo suo accanto ad «ADC».
    const role = personRoleFor(next);
    const person = role ? (ricordaPersona(whoValue) || 'qualcuno') : null;
    const nextNotes = withPerson(notes, role, person);
    const graph = graphStatusFor(/** @type {any} */ (next));
    const prevGraph = graphStatusFor(/** @type {any} */ (prevStatus));
    // Uscire da Programmate vuol dire togliere il blocco dal piano: lo stato
    // Graph di una programmata è già `notStarted`, quindi senza questo passo la
    // pastiglia direbbe «Prossima azione» e la colonna resterebbe Programmate.
    const leavingSchedule = prevStatus === 'scheduled';
    if (next === prevStatus && nextNotes === prevNotes) return;

    // Il debounce delle note sta per riscrivere il body con la versione
    // vecchia: va fermato, o cancellerebbe la riga appena messa.
    clearTimeout(notesTimerRef.current);
    setFlowStatus(next);
    setNotes(nextNotes);
    setSavingStatus(true);
    try {
      if (leavingSchedule) await onUnschedule?.(task);
      if (nextNotes !== prevNotes) await updateTaskBody(task._listId, task.id, nextNotes);
      if (graph !== prevGraph) await updateTaskStatus(task._listId, task.id, graph);
      // Senza un nome la riga dice "qualcuno": il campo deve dirlo anche lui,
      // o resterebbe vuoto mentre le note sotto raccontano un'altra cosa.
      setWho(person || '');
      setWaitingSince(new Date().toISOString());
      onPatched?.({ status: graph, body: { content: nextNotes, contentType: 'text' } });
      // Togliere il blocco dal piano ha già il suo annulla, messo da chi lo ha
      // fatto: qui se ne aggiunge uno solo se è cambiato qualcosa sul task.
      if (nextNotes !== prevNotes || graph !== prevGraph) {
        pushUndo({
          label: role
            ? `${PERSON_ROLES.find(r => r.role === role)?.label} ${person}`
            : `Riportata in ${STATUS_CHOICES.find(s => s.key === next)?.label ?? next}`,
          undo: async () => {
            if (nextNotes !== prevNotes) await updateTaskBody(task._listId, task.id, prevNotes);
            if (graph !== prevGraph) await updateTaskStatus(task._listId, task.id, prevGraph);
            setFlowStatus(prevStatus);
            setNotes(prevNotes);
            setWho(whoFrom(prevNotes));
            onPatched?.({ status: prevGraph, body: { content: prevNotes, contentType: 'text' } });
          },
        });
      }
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
        <div className="planner-task-detail-meta">{listLabel(task._listName)}</div>
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
        {/* Il pannello vive anche dentro una colonna, dove non c'è niente da
            chiudere: la crocetta compare solo se qualcuno la sta ascoltando. */}
        {onClose && <button className="planner-task-detail-close" onClick={onClose} title="Chiudi">✕</button>}
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

          {/* La sveglia, sorella di «Quanto ci vuole»: là si dice quanto dura,
              qui a che ora bisogna essere richiamati. Anche questa vive nelle
              note, come `[SVEGLIA:hh:mm]`, quindi si legge anche dall'app To-Do
              del telefono. Le pastiglie dicono «fra quanto» perché è così che
              la si pensa; il campo accanto tiene l'ora esatta, che è quella
              che finisce scritta. */}
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Sveglia {savingAlarm && <span className="planner-saving-dot">●</span>}
            </div>
            <div className="planner-estimate-chips">
              {SVEGLIA_CHOICES.map(c => (
                <button
                  key={c.min}
                  className="planner-estimate-chip"
                  disabled={savingAlarm}
                  onClick={() => handleAlarmChange(hhmmIn(c.min))}>
                  {c.label}
                </button>
              ))}
              <input
                type="time"
                className="planner-sveglia-input"
                value={sveglia || ''}
                disabled={savingAlarm}
                aria-label="Ora della sveglia"
                onChange={e => handleAlarmChange(e.target.value || null)}
              />
              {sveglia && (
                <button
                  className="planner-estimate-chip"
                  disabled={savingAlarm}
                  title="Togli la sveglia"
                  onClick={() => handleAlarmChange(null)}>
                  ✕
                </button>
              )}
            </div>
            {sveglia && (
              <p className="planner-sveglia-hint">
                Suona alle {sveglia}, con l’app aperta.
                {permessoNotifiche === 'denied' &&
                  ' Le notifiche di sistema sono bloccate nel browser: l’avviso resta solo dentro l’app.'}
              </p>
            )}
          </div>

          {/* Lo stato del flusso, e con esso il modo di mettere un'attività in
              attesa, di segnarla da chiedere o di delegarla: si sceglie la
              pastiglia e poi la persona, invece di dover conoscere a memoria la
              riga da mettere nelle note. */}
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Stato {savingStatus && <span className="planner-saving-dot">●</span>}
            </div>
            <div className="planner-estimate-chips">
              {flowStatus === 'inbox' && (
                <button
                  className="planner-estimate-chip active"
                  title="Sta nella lista Inbox: si esce chiarendola"
                  disabled>
                  Inbox
                </button>
              )}
              {STATUS_CHOICES
                // «Programmata» solo dove il Piano è raggiungibile: chi apre il
                // pannello dal Piano stesso è già sulla griglia.
                .filter(s => s.key !== 'scheduled' || onSchedule || flowStatus === 'scheduled')
                .map(s => (
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
            {/* Il campo della persona, uguale per i tre stati che ne hanno una.
                Le solite persone stanno in `persone.json` e arrivano come
                pastiglie: un nome si sceglie con un dito, e chi manca lo si
                scrive lo stesso nel campo — verrà ricordato per la volta dopo,
                ma il posto stabile dove aggiungerlo resta il JSON. */}
            {personRoleFor(flowStatus) && (
              <>
                <div className="planner-persone">
                  {elencoPersone().map(nome => (
                    <button
                      key={nome}
                      className={`planner-estimate-chip${normalizzaPersona(who) === nome ? ' active' : ''}`}
                      disabled={savingStatus}
                      title={`${PERSON_ROLES.find(r => r.role === personRoleFor(flowStatus))?.label} ${nome}`}
                      onClick={() => { setWho(nome); applyStatus(flowStatus, nome); }}>
                      {nome}
                    </button>
                  ))}
                </div>
                <div className="planner-waiting">
                  <input
                    className="planner-waiting-input"
                    value={who}
                    onChange={e => setWho(e.target.value)}
                    onBlur={() => applyStatus(flowStatus, who)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    placeholder={PERSON_ROLES.find(r => r.role === personRoleFor(flowStatus))?.prompt}
                  />
                  <span className="planner-waiting-since">
                    {(() => {
                      const d = waitingDays(waitingSince);
                      if (d === null) return null;
                      return d === 0 ? 'da oggi' : `da ${d} ${d === 1 ? 'giorno' : 'giorni'}`;
                    })()}
                  </span>
                </div>
              </>
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

          {/* Il ponte fra la programmazione e il posto di lavoro: da qui si va
              al workbook della sezione, dove stanno le pagine e i file che
              servono a farla davvero, questa attività. */}
          {sectionId && (
            <button
              className="planner-workbook-open"
              onClick={() => navigate(`/sezioni/${sectionId}`)}>
              <span className="planner-workbook-dot" />
              Apri il workbook
              <span className="planner-workbook-caption">
                {section?.displayName || 'la sezione'} in Sezioni
              </span>
            </button>
          )}

          {showResources && <SectionResources section={section} notebook={notebook} pagesCache={pagesCache} />}
        </>
      )}
    </div>
  );
}
