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
import { leggiUnTask, aggiornaTask, creaTask, eliminaTask, nuovoId } from './taskStore';
import {
  ESTIMATE_CHOICES, DEFAULT_ESTIMATE_MIN,
  PERSON_ROLES, personRoleFor, waitingDays,
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

/** Lo stato del flusso di un'attività, per quello che il pannello sa da solo.
 *  Chi lo apre da una board sa di più — i blocchi nel piano, la lista Inbox —
 *  e lo passa come prop; qui si legge il campo e basta. Prima non era un campo:
 *  bisognava mettere insieme lo `status` di Graph e la riga della persona
 *  scritta nelle note. */
function flowStatusOf(/** @type {import('./taskStore').Task|null|undefined} */ t) {
  return t?.stato || 'next';
}

/**
 * @param {Object} props
 * @param {import('./taskStore').Task} props.task
 * @param {import('./types').Notebook[]} [props.notebooks]
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {{ current: Record<string, import('./types').Page[]> }|null} [props.pagesCache]
 * @param {() => void} [props.onClose]
 * @param {() => void} [props.onCompleted]
 * @param {() => void} [props.onDeleted]
 * @param {(title: string) => void} [props.onRenamed]
 * @param {(scadenza: string|null) => void} [props.onDueChanged]
 * @param {(listId: string, task: import('./taskStore').Task) => void} [props.onRestored]
 * @param {(min: number) => void} [props.onEstimateChanged]
 * @param {(patch: Object) => void} [props.onPatched]  stato/note cambiati: il pool va allineato
 * @param {string} [props.status]        stato del flusso già derivato da chi apre il pannello
 *                                       (include `scheduled` e `inbox`, che nel task non sono
 *                                       scritti). Senza, si legge il campo `stato`.
 * @param {(t: import('./taskStore').Task) => void} [props.onSchedule]    porta al Piano
 * @param {(t: import('./taskStore').Task) => Promise<void>|void} [props.onUnschedule]  toglie il blocco
 * @param {boolean} [props.showResources]  le risorse della sezione in fondo al pannello.
 *                                         Spente dove OneNote e i percorsi sono già colonne
 *                                         accanto — nella plancia di Sezioni.
 * @param {boolean} [props.showWorkbook]   il bottone che porta al workbook della sezione.
 *                                         Spento dentro Sezioni: lì il workbook è già aperto,
 *                                         e il bottone porterebbe dove si è già.
 */
export default function TaskDetailPanel({ task, notebooks = [], sectionsMap = {}, pagesCache = null, onClose, onCompleted, onDeleted, onRenamed, onDueChanged, onRestored, onEstimateChanged, onPatched, status, onSchedule, onUnschedule, showResources = true, showWorkbook = true }) {
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
  const [titleDraft, setTitleDraft]   = useState(task.titolo);
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
  const [flowStatus, setFlowStatus] = useState(() => status || flowStatusOf(task));
  const [who, setWho] = useState('');
  const [waitingSince, setWaitingSince] = useState(/** @type {string|null} */ (null));
  const [savingStatus, setSavingStatus] = useState(false);
  // Stima e sveglia sono campi del task, non più marker da cercare nelle note:
  // si tengono nello stato del pannello perché si modificano da qui.
  const [estimateMin, setEstimateMin] = useState(/** @type {number|null} */ (null));
  const [sveglia, setSveglia] = useState(/** @type {string|null} */ (null));
  const estimate = estimateMin ?? DEFAULT_ESTIMATE_MIN;

  useEffect(() => { setTitleDraft(task.titolo); setEditingTitle(false); load(); }, [task.id]); // eslint-disable-line

  // Chi ci passa uno stato già derivato (la vista Attività, che sa dei blocchi
  // nel piano e della lista Inbox) è più informato del campo: quando cambia —
  // il task viene programmato, o il blocco tolto — la pastiglia lo segue.
  useEffect(() => { if (status) setFlowStatus(status); }, [status, task.id]);

  // Chi apre il pannello da un blocco del Piano ha in mano solo id, titolo e
  // lista: il task per intero si rilegge qui.
  async function load() {
    setLoading(true);
    try {
      const full = await leggiUnTask(task._listId, task.id) || task;
      setNotes(full.nota || '');
      setItems(full.sottoattivita || []);
      setDueDraft(full.scadenza || '');
      setEstimateMin(full.stimaMin ?? null);
      setSveglia(full.sveglia || null);
      setFlowStatus(status || flowStatusOf(full));
      setWho(full.persona || '');
      setWaitingSince(full.modificatoIl || full.creatoIl || null);
    } catch (e) { console.error('load task detail', e); }
    setLoading(false);
  }

  /** Una modifica al task, e l'allineamento del pool che lo tiene in mano. */
  async function scrivi(/** @type {Object} */ patch) {
    await aggiornaTask(task._listId, task.id, patch);
    onPatched?.(patch);
  }

  async function handleDueChange(e) {
    const val = e.target.value;
    const prevVal = dueDraft;
    setDueDraft(val);
    // Mentre si digita l'anno il campo data propone date parziali (0002,
    // 0020, 0202…): si salva solo quando la data è completa.
    if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
    setSavingDue(true);
    try {
      await aggiornaTask(task._listId, task.id, { scadenza: val || null });
      onDueChanged?.(val || null);
      if (prevVal !== val) {
        pushUndo({
          label: 'Scadenza task modificata',
          undo: async () => {
            await aggiornaTask(task._listId, task.id, { scadenza: prevVal || null });
            onDueChanged?.(prevVal || null);
            setDueDraft(prevVal);
          },
        });
      }
    } catch (err) { console.error('save due date', err); }
    setSavingDue(false);
  }

  async function handleEstimateChange(min) {
    if (min === estimate || savingEstimate) return;
    const prev = estimateMin;
    setEstimateMin(min);
    setSavingEstimate(true);
    try {
      await scrivi({ stimaMin: min });
      onEstimateChanged?.(min);
      pushUndo({
        label: `Stima portata a ${ESTIMATE_CHOICES.find(c => c.min === min)?.label ?? `${min}m`}`,
        undo: async () => {
          await scrivi({ stimaMin: prev });
          setEstimateMin(prev);
          onEstimateChanged?.(prev ?? DEFAULT_ESTIMATE_MIN);
        },
      });
    } catch (e) {
      console.error('save estimate', e);
      setEstimateMin(prev);
    }
    setSavingEstimate(false);
  }

  // ── Sveglia ─────────────────────────────────────────────────────────────────
  // L'ora del giorno in cui farsi richiamare. È un campo come la stima: prima
  // era un marker `[SVEGLIA:hh:mm]` in mezzo al testo delle note, e ogni
  // scrittura delle note doveva stare attenta a non portarselo via.
  /** @param {string|null} hhmm  "HH:MM", oppure null per togliere la sveglia */
  async function handleAlarmChange(hhmm) {
    if (hhmm === sveglia || savingAlarm) return;
    const prev = sveglia;
    setSveglia(hhmm);
    setSavingAlarm(true);
    try {
      await scrivi({ sveglia: hhmm });
      pushUndo({
        label: hhmm ? `Sveglia alle ${hhmm}` : 'Sveglia tolta',
        undo: async () => {
          await scrivi({ sveglia: prev });
          setSveglia(prev);
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
      setSveglia(prev);
    }
    setSavingAlarm(false);
  }

  // ── Stato del flusso ────────────────────────────────────────────────────────
  // Gli stati con una persona sono tre — «da chiedere», «in attesa»,
  // «delegata» — e sono lo stato più un nome. Erano la cosa più contorta di
  // tutta l'app: lo `status` su Graph più una riga «Delegato a: Nome» in testa
  // alle note, perché una lista personale di To-Do non ha un campo «assegnato
  // a». Due scritture, e un task che restava a metà se la seconda falliva.
  // Adesso sono due campi dello stesso task, e si scrivono insieme.
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

    // Il nome si normalizza sul registro delle persone (`persone.json`) e, se
    // è nuovo, viene ricordato: la volta dopo l'elenco lo propone da sé, e
    // «adc» scritto di fretta non apre un gruppo suo accanto ad «ADC».
    const role = personRoleFor(next);
    const person = role ? (ricordaPersona(whoValue) || 'qualcuno') : null;
    const prevPerson = who || null;
    // Uscire da Programmate vuol dire togliere il blocco dal piano: il campo
    // `stato` di una programmata è già `next`, quindi senza questo passo la
    // pastiglia direbbe «Prossima azione» e la colonna resterebbe Programmate.
    const leavingSchedule = prevStatus === 'scheduled';
    const stato = prevStatus === 'scheduled' && next === 'next' ? 'next' : next;
    if (stato === prevStatus && person === prevPerson && !leavingSchedule) return;

    setFlowStatus(next);
    setSavingStatus(true);
    try {
      if (leavingSchedule) await onUnschedule?.(task);
      const patch = { stato, persona: person };
      await scrivi(patch);
      // Senza un nome il campo dice "qualcuno": deve dirlo anche la casella, o
      // resterebbe vuota mentre il task racconta un'altra cosa.
      setWho(person || '');
      setWaitingSince(new Date().toISOString());
      // Togliere il blocco dal piano ha già il suo annulla, messo da chi lo ha
      // fatto: qui se ne aggiunge uno solo se è cambiato qualcosa sul task.
      if (stato !== prevStatus || person !== prevPerson) {
        pushUndo({
          label: role
            ? `${PERSON_ROLES.find(r => r.role === role)?.label} ${person}`
            : `Riportata in ${STATUS_CHOICES.find(s => s.key === next)?.label ?? next}`,
          undo: async () => {
            await scrivi({ stato: prevStatus === 'scheduled' ? 'next' : prevStatus, persona: prevPerson });
            setFlowStatus(prevStatus);
            setWho(prevPerson || '');
          },
        });
      }
    } catch (e) {
      console.error('cambio stato task', e);
      setFlowStatus(prevStatus);
    }
    setSavingStatus(false);
  }

  // Le note sono solo le note: nessun marker da preservare, nessuna riga della
  // persona da non calpestare. Il debounce resta, perché si scrive a mano.
  function handleNotesChange(e) {
    const val = e.target.value;
    setNotes(val);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setSavingNotes(true);
      try { await scrivi({ nota: val }); } catch (e) { console.error('save notes', e); }
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

  // Le sottoattività sono un campo del task: cambiarle è riscrivere l'array.
  // Su To-Do erano oggetti a sé, con un endpoint per creare, uno per spuntare,
  // uno per rinominare, uno per cancellare — e per riordinarle bisognava
  // ricrearle tutte nell'ordine voluto e cancellare le originali, perché Graph
  // non aveva un campo d'ordine. Qui l'ordine è l'ordine dell'array.
  /**
   * @param {any[]} prossime
   * @param {string} etichetta      per l'annulla
   * @param {string} cosaFallita    per il messaggio d'errore
   */
  async function salvaSottoattivita(prossime, etichetta, cosaFallita) {
    const precedenti = items;
    setItems(prossime);
    try {
      await scrivi({ sottoattivita: prossime });
      if (etichetta) {
        pushUndo({
          label: etichetta,
          undo: async () => {
            setItems(precedenti);
            await scrivi({ sottoattivita: precedenti });
          },
        });
      }
    } catch (e) {
      setItems(precedenti);
      flashItemError(cosaFallita, e);
    }
  }

  function handleToggle(item) {
    const fatta = !item.fatta;
    return salvaSottoattivita(
      items.map(i => (i.id === item.id ? { ...i, fatta } : i)),
      `"${item.titolo}" ${fatta ? 'spuntata' : 'da fare'}`,
      'spunta della sottoattività',
    );
  }

  function handleDelete(itemId) {
    const tolta = items.find(i => i.id === itemId);
    return salvaSottoattivita(
      items.filter(i => i.id !== itemId),
      tolta ? `Voce "${tolta.titolo}" eliminata` : '',
      'eliminazione voce',
    );
  }

  function handleAdd(formEvent) {
    formEvent.preventDefault();
    const testo = newItemText.trim();
    if (!testo) return;
    setNewItemText('');
    return salvaSottoattivita(
      [...items, { id: nuovoId(), titolo: testo, fatta: false }],
      `Voce "${testo}" aggiunta`,
      'aggiunta voce',
    );
  }

  function startItemRename(item) {
    setEditingItemId(item.id);
    setItemDraft(item.titolo);
  }

  function submitItemRename() {
    const item = items.find(i => i.id === editingItemId);
    setEditingItemId(null);
    const testo = itemDraft.trim();
    if (!item || !testo || testo === item.titolo) return;
    return salvaSottoattivita(
      items.map(i => (i.id === item.id ? { ...i, titolo: testo } : i)),
      `Voce rinominata in "${testo}"`,
      'rinomina voce',
    );
  }

  async function persistReorder(reordered) {
    setReordering(true);
    await salvaSottoattivita(reordered, '', 'riordino sottoattività');
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
    const titolo = titleDraft.trim();
    const prima = task.titolo;
    setEditingTitle(false);
    if (!titolo || titolo === task.titolo) { setTitleDraft(task.titolo); return; }
    setTitleDraft(titolo);
    scrivi({ titolo })
      .then(() => {
        onRenamed?.(titolo);
        pushUndo({
          label: `Task rinominato in "${titolo}"`,
          undo: async () => {
            await scrivi({ titolo: prima });
            onRenamed?.(prima);
            setTitleDraft(prima);
          },
        });
      })
      .catch(e => { console.error('rename task', e); setTitleDraft(task.titolo); });
  }

  async function handleCompleteTask() {
    setWorking(true);
    try {
      const prima = flowStatus === 'scheduled' ? 'next' : flowStatus;
      await aggiornaTask(task._listId, task.id, { stato: 'done' });
      const snapshot = { ...task, stato: prima };
      onCompleted?.();
      pushUndo({
        label: `Task "${task.titolo}" completato`,
        undo: async () => {
          await aggiornaTask(task._listId, task.id, { stato: prima });
          onRestored?.(task._listId, snapshot);
        },
      });
    } catch (e) { console.error('complete task', e); }
    setWorking(false);
  }

  async function handleDeleteTask() {
    if (!window.confirm(`Eliminare il task "${task.titolo}"? Potrai annullare subito dopo con Ctrl+Z.`)) return;
    setWorking(true);
    // Il task per intero, per poterlo rimettere identico se si annulla — id
    // compreso: ricreandolo con un id nuovo, i blocchi già a piano che lo
    // citano resterebbero orfani. Prima non si poteva: To-Do assegnava lui
    // l'id, e un task ricreato era un altro task.
    const snapshot = {
      ...task,
      titolo: task.titolo,
      nota: notes,
      scadenza: dueDraft || null,
      stimaMin: estimateMin,
      sveglia,
      stato: flowStatus === 'scheduled' ? 'next' : flowStatus,
      persona: who || null,
      sottoattivita: items,
    };
    try {
      await eliminaTask(task._listId, task.id);
      onDeleted?.();
      pushUndo({
        label: `Task "${snapshot.titolo}" eliminato`,
        undo: async () => {
          const ricreato = await creaTask(task._listId, snapshot);
          onRestored?.(task._listId, ricreato);
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
              if (e.key === 'Escape') { setTitleDraft(task.titolo); setEditingTitle(false); }
            }}
          />
        ) : (
          <div className="planner-task-detail-title" onClick={() => setEditingTitle(true)} title="Clicca per rinominare">
            {task.titolo}
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
          {/* La stima è un campo del task, ed è la stessa che il chiarimento
              chiede in «Quanto ci vuole». Cambiarla riscala anche il blocco già
              a piano. */}
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
              qui a che ora bisogna essere richiamati. Le pastiglie dicono «fra
              quanto» perché è così che la si pensa; il campo accanto tiene
              l'ora esatta, che è quella che finisce scritta. */}
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
                className={`planner-checklist-item${item.fatta ? ' checked' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
                draggable
                onDragStart={() => { dragIndexRef.current = index; }}
                onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
                onDragLeave={() => setDragOverIndex(prev => prev === index ? null : prev)}
                onDrop={e => { e.preventDefault(); handleItemDrop(index); }}
                onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}>
                <span className="planner-checklist-handle" title="Trascina per riordinare">⠿</span>
                <button className="planner-checklist-check" onClick={() => handleToggle(item)}>
                  {item.fatta ? '✓' : '○'}
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
                    {item.titolo}
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
          {showWorkbook && sectionId && (
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
