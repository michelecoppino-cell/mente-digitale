// Il pannello di dettaglio di un'attività: titolo, scadenza, stima, sveglia,
// stato del flusso GTD, note e sottoattività. In fondo, il bottone che porta al
// workbook della sezione.
//
// In coda ci stavano anche le pagine OneNote e i file OneDrive della sezione.
// Sono usciti: erano due riquadri che nessuno guarda mentre lavora a
// un'attività — le pagine e i file si aprono in Sezioni, dove sono due colonne
// intere — e per riempirli ci voleva una lettura delle pagine a ogni apertura
// di scheda, cioè un pezzo dell'attesa che rendeva lento aprire un'attività.
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
  PERSON_ROLES, personRoleFor, waitingDays, STATUS_HINTS,
} from './taskModel';
import { queryClient, qk } from './queryClient';
import StatusIcon from './StatusIcon';
import { elencoPersone, normalizzaPersona, ricordaPersona } from './persone';
import { SVEGLIA_CHOICES, hhmmIn, chiediNotifiche, statoNotifiche } from './sveglie';
import { listLabel, sectionNameForList } from './paraConfig';
import { pushUndo } from './undo';
import Skeleton from './Skeleton';
import './PlannerView.css';

/** I limiti della stima scritta a mano: cinque minuti è il minimo che ha un
 *  senso sulla griglia del Piano, una giornata di lavoro il massimo che ha
 *  senso in un'attività sola — oltre, sono più attività travestite (vedi
 *  GRANULARITY_MEMO in taskModel.js). */
const MIN_STIMA = 5;
const MAX_STIMA = 8 * 60;

/** Le due sole distanze proposte come pastiglia: il quarto d'ora, che è «fra
 *  poco», e l'ora, che è «più tardi». Le altre due che c'erano (5 e 30 minuti)
 *  cadevano fra queste due e costavano una riga in più. */
const SVEGLIA_RAPIDE = [15, 60];

/** Gli stati che si possono dare da qui, nell'ordine delle colonne della vista
 *  Attività.
 *
 *  Sono icone e non parole (vedi StatusIcon.jsx): sei nomi per esteso
 *  prendevano tre righe in una colonna larga trecento pixel, sei segni ci
 *  stanno in una riga sola, e il nome per esteso resta a un passaggio del
 *  cursore. Le stesse icone tornano nelle colonne della vista Attività, così
 *  un segno vuol dire la stessa cosa ovunque lo si incontri.
 *
 *  Le pastiglie sono le colonne del flusso e non lo `stato` scritto: aprendo
 *  un'attività dalla colonna Programmate si leggeva «Prossima azione», perché
 *  nel task una programmata è comunque `next` — quello che la programma è il
 *  blocco nel Piano. «Programmata» porta quindi al Piano: un orario si dà
 *  sulla griglia, non da una pastiglia.
 *
 *  `inbox` non è fra le scelte: non è uno stato ma la lista in cui il task sta,
 *  e ci si esce chiarendolo. Compare come pastiglia spenta quando è lo stato
 *  corrente, così la scheda non mente su dove si trova l'attività. */
/** @type {{ key: import('./taskModel').TaskStatus, label: string }[]} */
const STATUS_CHOICES = [
  { key: 'next',      label: 'Prossima azione' },
  { key: 'scheduled', label: 'Programmata' },
  { key: 'ask',       label: 'Da chiedere' },
  { key: 'waiting',   label: 'In attesa' },
  { key: 'delegated', label: 'Delegata' },
  { key: 'someday',   label: 'Un giorno' },
];

/** Lo stato del flusso di un'attività, per quello che il pannello sa da solo.
 *  Chi lo apre da una board sa di più — i blocchi nel piano, la lista Inbox —
 *  e lo passa come prop; qui si legge il campo e basta. Prima non era un campo:
 *  bisognava mettere insieme lo `status` di Graph e la riga della persona
 *  scritta nelle note. */
function flowStatusOf(/** @type {import('./taskStore').Task|null|undefined} */ t) {
  return t?.stato || 'next';
}

/** Un task «per intero» ha i campi che solo il file porta: la nota e le
 *  sottoattività. Chi apre il pannello da un blocco del Piano ha in mano un
 *  oggetto con id, titolo e lista e basta, e quello non basta a dipingere la
 *  scheda. */
function eCompleto(/** @type {any} */ t) {
  return !!t && Array.isArray(t.sottoattivita) && typeof t.nota === 'string';
}

/** La copia del task che abbiamo già in casa, senza chiedere niente a OneDrive.
 *
 *  Aprire una scheda costava due secondi di schermo grigio, e non perché
 *  servisse leggere qualcosa che non si avesse: erano due letture da OneDrive
 *  in fila — il registro delle liste per sapere in che file guardare, poi il
 *  file — per un task che il serbatoio della vista ha già in mano per intero.
 *  Qui si guarda prima in casa: l'attività passata dalla vista, se è completa,
 *  o la copia in cache del suo elenco. La lettura vera parte lo stesso, dietro,
 *  e aggiorna quello che nel frattempo non si sta scrivendo.
 *  @param {any} task
 *  @returns {any|null} */
function daMemoria(task) {
  if (eCompleto(task)) return task;
  const elenco = /** @type {any[]|undefined} */ (queryClient.getQueryData(qk.tasks(task?._listId)));
  const trovato = elenco?.find(t => t.id === task?.id);
  return eCompleto(trovato) ? trovato : null;
}

/**
 * @param {Object} props
 * @param {import('./taskStore').Task} props.task
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {() => void} [props.onClose]
 * @param {() => void} [props.onCompleted]
 * @param {() => void} [props.onDeleted]
 * @param {(title: string) => void} [props.onRenamed]
 * @param {(scadenza: string|null) => void} [props.onDueChanged]
 * @param {(listId: string, task: import('./taskStore').Task) => void} [props.onRestored]
 * @param {(min: number) => void} [props.onEstimateChanged]
 * @param {(patch: Object) => void} [props.onPatched]  stato/note cambiati: il pool va allineato
 * @param {import('./taskModel').TaskStatus} [props.status]  stato del flusso già derivato da chi apre il pannello
 *                                       (include `scheduled` e `inbox`, che nel task non sono
 *                                       scritti). Senza, si legge il campo `stato`.
 * @param {(t: import('./taskStore').Task) => void} [props.onSchedule]    porta al Piano
 * @param {(t: import('./taskStore').Task) => Promise<void>|void} [props.onUnschedule]  toglie il blocco
 * @param {boolean} [props.showWorkbook]   il bottone che porta al workbook della sezione.
 *                                         Spento dentro Sezioni: lì il workbook è già aperto,
 *                                         e il bottone porterebbe dove si è già.
 */
export default function TaskDetailPanel({ task, sectionsMap = {}, onClose, onCompleted, onDeleted, onRenamed, onDueChanged, onRestored, onEstimateChanged, onPatched, status, onSchedule, onUnschedule, showWorkbook = true }) {
  const navigate = useNavigate();
  // La sezione PARA del task è la sezione OneNote che si chiama come la sua
  // lista — o, se la lista è una consegna annidata (`2573.A60`, vedi
  // paraConfig.js), quella della sua commessa. Serve al bottone che apre il
  // workbook: senza, non comparirebbe, e sparirebbe in silenzio.
  const section = useMemo(() => {
    const sezioni = Object.values(sectionsMap || {}).flat();
    const target = (sectionNameForList(task?._listName, sezioni.map(s => s.displayName)) || '').toLowerCase();
    if (!target) return null;
    return sezioni.find(s => (s.displayName || '').toLowerCase() === target) || null;
  }, [task?._listName, sectionsMap]);
  const sectionId = section?.id || null;
  // La lista da cui l'attività viene. Nel tipo di `Task` è facoltativa perché
  // è una decorazione del pool e non un campo del file, ma il pannello si apre
  // sempre da lì — dal Piano, dalla vista Attività, dalla plancia di Sezioni —
  // e non c'è modo di aprirlo su un'attività che non sappia da dove viene.
  // Fissarla qui evita di ripetere il controllo a ogni scrittura.
  const listId = /** @type {string} */ (task._listId);
  const [loading, setLoading]         = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft]   = useState(task.titolo);
  const [working, setWorking]         = useState(false);
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState(/** @type {import('./taskStore').Sottoattivita[]} */ ([]));
  const [newItemText, setNewItemText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingItemId, setEditingItemId] = useState(/** @type {string|null} */ (null));
  const [itemDraft, setItemDraft]     = useState('');
  const [reordering, setReordering]   = useState(false);
  const dragIndexRef                  = useRef(/** @type {number|null} */ (null));
  const [dragOverIndex, setDragOverIndex] = useState(/** @type {number|null} */ (null));
  const notesTimerRef                 = useRef(/** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined));
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
  const [flowStatus, setFlowStatus] = useState(
    /** @type {import('./taskModel').TaskStatus} */ (status || flowStatusOf(task)));
  const [who, setWho] = useState('');
  const [waitingSince, setWaitingSince] = useState(/** @type {string|null} */ (null));
  const [savingStatus, setSavingStatus] = useState(false);
  // Stima e sveglia sono campi del task, non più marker da cercare nelle note:
  // si tengono nello stato del pannello perché si modificano da qui.
  const [estimateMin, setEstimateMin] = useState(/** @type {number|null} */ (null));
  const [sveglia, setSveglia] = useState(/** @type {string|null} */ (null));
  const estimate = estimateMin ?? DEFAULT_ESTIMATE_MIN;
  // Quello che si sta scrivendo nella casella dei minuti. Le pastiglie coprono
  // le quattro durate di tutti i giorni, ma una cosa può durare venti minuti o
  // tre ore, e non c'era modo di dirlo: il numero si scrive.
  const [estimateDraft, setEstimateDraft] = useState('');

  useEffect(() => { setTitleDraft(task.titolo); setEditingTitle(false); load(); }, [task.id]); // eslint-disable-line

  // Chi ci passa uno stato già derivato (la vista Attività, che sa dei blocchi
  // nel piano e della lista Inbox) è più informato del campo: quando cambia —
  // il task viene programmato, o il blocco tolto — la pastiglia lo segue.
  useEffect(() => { if (status) setFlowStatus(status); }, [status, task.id]);

  /** I campi che si stanno scrivendo adesso: la rilettura di sfondo non li
   *  tocca. Senza, chi comincia a scrivere una nota mentre OneDrive risponde
   *  se la vedrebbe sostituire dalla versione di prima. */
  const toccatiRef = useRef(/** @type {Set<string>} */ (new Set()));
  /** Quale caricamento è quello buono: cambiando attività in fretta, la
   *  risposta della precedente non deve dipingere la scheda della successiva. */
  const caricamentoRef = useRef(0);

  /** @param {string} campo */
  function tocca(campo) { toccatiRef.current.add(campo); }

  /** Dipinge la scheda con un task per intero.
   *  @param {any} full
   *  @param {boolean} rispettaModifiche  salta i campi che si stanno scrivendo */
  function applica(full, rispettaModifiche = false) {
    const salta = (/** @type {string} */ campo) => rispettaModifiche && toccatiRef.current.has(campo);
    if (!salta('nota')) setNotes(full.nota || '');
    if (!salta('sottoattivita')) setItems(full.sottoattivita || []);
    if (!salta('scadenza')) setDueDraft(full.scadenza || '');
    if (!salta('stimaMin')) setEstimateMin(full.stimaMin ?? null);
    if (!salta('sveglia')) setSveglia(full.sveglia || null);
    if (!salta('stato')) setFlowStatus(status || flowStatusOf(full));
    if (!salta('persona')) {
      setWho(full.persona || '');
      setWaitingSince(full.modificatoIl || full.creatoIl || null);
    }
  }

  // Il task per intero. Se ce l'abbiamo già in casa la scheda si dipinge
  // subito, e la lettura da OneDrive parte lo stesso dietro: la copia in mano
  // alla vista è aggiornata a ogni modifica fatta da qui, ma non sa di quelle
  // fatte da un altro dispositivo, e quelle arrivano dalla lettura vera.
  async function load() {
    const giro = ++caricamentoRef.current;
    toccatiRef.current = new Set();
    const memoria = daMemoria(task);
    if (memoria) { applica(memoria); setLoading(false); } else { setLoading(true); }
    try {
      const full = await leggiUnTask(listId, task.id);
      if (giro !== caricamentoRef.current) return;
      if (full) applica(full, !!memoria);
      else if (!memoria) applica(task);
    } catch (e) {
      console.error('load task detail', e);
      if (!memoria && giro === caricamentoRef.current) applica(task);
    }
    if (giro === caricamentoRef.current) setLoading(false);
  }

  // La casella segue il valore quando cambia da fuori (le pastiglie, un altro
  // dispositivo, il cambio di attività) — non mentre la si scrive.
  useEffect(() => { setEstimateDraft(estimateMin === null ? '' : String(estimateMin)); }, [estimateMin, task.id]);

  /** Una modifica al task, e l'allineamento del pool che lo tiene in mano. */
  async function scrivi(/** @type {Object} */ patch) {
    await aggiornaTask(listId, task.id, patch);
    onPatched?.(patch);
  }

  /** @param {{ target: { value: string } }} e */
  async function handleDueChange(e) {
    tocca('scadenza');
    const val = e.target.value;
    const prevVal = dueDraft;
    setDueDraft(val);
    // Mentre si digita l'anno il campo data propone date parziali (0002,
    // 0020, 0202…): si salva solo quando la data è completa.
    if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
    setSavingDue(true);
    try {
      await aggiornaTask(listId, task.id, { scadenza: val || null });
      onDueChanged?.(val || null);
      if (prevVal !== val) {
        pushUndo({
          label: 'Scadenza task modificata',
          undo: async () => {
            await aggiornaTask(listId, task.id, { scadenza: prevVal || null });
            onDueChanged?.(prevVal || null);
            setDueDraft(prevVal);
          },
        });
      }
    } catch (err) { console.error('save due date', err); }
    setSavingDue(false);
  }

  /** @param {number} min */
  async function handleEstimateChange(min) {
    if (min === estimate || savingEstimate) return;
    tocca('stimaMin');
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

  /** La stima scritta a mano nella casella. Si conferma uscendo dal campo o
   *  con Invio, non a ogni tasto: salvare mentre si digita «120» vorrebbe dire
   *  scrivere prima 1, poi 12, e ridimensionare il blocco a piano due volte
   *  per niente. */
  function commitEstimateDraft() {
    const n = Math.round(Number(estimateDraft));
    if (!Number.isFinite(n) || n <= 0) { setEstimateDraft(String(estimate)); return; }
    const clamped = Math.min(MAX_STIMA, Math.max(MIN_STIMA, n));
    setEstimateDraft(String(clamped));
    if (clamped !== estimate) handleEstimateChange(clamped);
  }

  // ── Sveglia ─────────────────────────────────────────────────────────────────
  // L'ora del giorno in cui farsi richiamare. È un campo come la stima: prima
  // era un marker `[SVEGLIA:hh:mm]` in mezzo al testo delle note, e ogni
  // scrittura delle note doveva stare attenta a non portarselo via.
  /** @param {string|null} hhmm  "HH:MM", oppure null per togliere la sveglia */
  async function handleAlarmChange(hhmm) {
    if (hhmm === sveglia || savingAlarm) return;
    tocca('sveglia');
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
   * @param {import('./taskModel').TaskStatus} next  stato del flusso da applicare
   * @param {string} [whoValue]  la persona, se `next` ne prevede una
   */
  async function applyStatus(next, whoValue = who) {
    if (savingStatus) return;
    tocca('stato'); tocca('persona');
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
  /** @param {{ target: { value: string } }} e */
  function handleNotesChange(e) {
    tocca('nota');
    const val = e.target.value;
    setNotes(val);
    clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setSavingNotes(true);
      try { await scrivi({ nota: val }); } catch (e) { console.error('save notes', e); }
      setSavingNotes(false);
    }, 1200);
  }

  /** @param {string} action @param {any} e */
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
    tocca('sottoattivita');
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

  /** @param {import('./taskStore').Sottoattivita} item */
  function handleToggle(item) {
    const fatta = !item.fatta;
    return salvaSottoattivita(
      items.map(i => (i.id === item.id ? { ...i, fatta } : i)),
      `"${item.titolo}" ${fatta ? 'spuntata' : 'da fare'}`,
      'spunta della sottoattività',
    );
  }

  /** @param {string} itemId */
  function handleDelete(itemId) {
    const tolta = items.find(i => i.id === itemId);
    return salvaSottoattivita(
      items.filter(i => i.id !== itemId),
      tolta ? `Voce "${tolta.titolo}" eliminata` : '',
      'eliminazione voce',
    );
  }

  /** @param {import('react').FormEvent} formEvent */
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

  /** @param {import('./taskStore').Sottoattivita} item */
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

  /** @param {import('./taskStore').Sottoattivita[]} reordered */
  async function persistReorder(reordered) {
    setReordering(true);
    await salvaSottoattivita(reordered, '', 'riordino sottoattività');
    setReordering(false);
  }

  /** @param {number} index @param {-1|1} dir */
  function moveItem(index, dir) {
    const next = index + dir;
    if (next < 0 || next >= items.length || reordering) return;
    const reordered = [...items];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    persistReorder(reordered);
  }

  /** @param {number} index */
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
      await aggiornaTask(listId, task.id, { stato: 'done' });
      const snapshot = { ...task, stato: prima };
      onCompleted?.();
      pushUndo({
        label: `Task "${task.titolo}" completato`,
        undo: async () => {
          await aggiornaTask(listId, task.id, { stato: prima });
          onRestored?.(listId, snapshot);
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
      await eliminaTask(listId, task.id);
      onDeleted?.();
      pushUndo({
        label: `Task "${snapshot.titolo}" eliminato`,
        undo: async () => {
          const ricreato = await creaTask(listId, snapshot);
          onRestored?.(listId, ricreato);
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
              {/* Le quattro pastiglie sono le durate di tutti i giorni; la
                  casella è per tutte le altre — venti minuti, tre ore — che
                  finora non si potevano dire. */}
              <input
                type="number"
                className="planner-estimate-input"
                value={estimateDraft}
                min={MIN_STIMA}
                max={MAX_STIMA}
                step={5}
                disabled={savingEstimate}
                aria-label="Minuti, scritti a mano"
                title="Minuti, scritti a mano"
                onChange={e => { tocca('stimaMin'); setEstimateDraft(e.target.value); }}
                onBlur={commitEstimateDraft}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEstimateDraft(String(estimate));
                }}
              />
              <span className="planner-estimate-unit">min</span>
            </div>
          </div>

          {/* La sveglia, sorella di «Quanto ci vuole»: là si dice quanto dura,
              qui a che ora bisogna essere richiamati.
              Le pastiglie erano quattro — 5, 15, 30 minuti, un'ora — più il
              campo dell'ora e la crocetta: sei controlli che andavano a capo
              due volte in una colonna di trecento pixel, per una cosa che si
              mette in un gesto solo. Restano i due scarti che si usano
              davvero, il quarto d'ora e l'ora, e «ora», che segna questo
              momento; l'ora esatta si scrive nel campo accanto, che è quello
              che finisce scritto sul task. */}
          <div className="planner-task-detail-section">
            <div className="planner-task-detail-section-label">
              Sveglia {savingAlarm && <span className="planner-saving-dot">●</span>}
            </div>
            <div className="planner-estimate-chips planner-sveglia-row">
              {SVEGLIA_CHOICES.filter(c => SVEGLIA_RAPIDE.includes(c.min)).map(c => (
                <button
                  key={c.min}
                  className="planner-estimate-chip"
                  disabled={savingAlarm}
                  title={`Suona ${c.label}, cioè alle ${hhmmIn(c.min)}`}
                  onClick={() => handleAlarmChange(hhmmIn(c.min))}>
                  fra {c.min}′
                </button>
              ))}
              <button
                className="planner-estimate-chip"
                disabled={savingAlarm}
                title="Segna l'ora di adesso"
                onClick={() => handleAlarmChange(hhmmIn(0))}>
                ora
              </button>
              <input
                type="time"
                className="planner-sveglia-input"
                value={sveglia || ''}
                disabled={savingAlarm}
                aria-label="Ora della sveglia"
                title="L'ora esatta"
                onChange={e => handleAlarmChange(e.target.value || null)}
              />
              {sveglia && (
                <button
                  className="planner-estimate-chip planner-chip-icon"
                  disabled={savingAlarm}
                  title="Togli la sveglia"
                  aria-label="Togli la sveglia"
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
            <div className="planner-estimate-chips planner-stato-row">
              {flowStatus === 'inbox' && (
                <button
                  className="planner-estimate-chip planner-chip-icon active"
                  title={STATUS_HINTS.inbox}
                  aria-label="Inbox"
                  disabled>
                  <StatusIcon status="inbox" />
                </button>
              )}
              {STATUS_CHOICES
                // «Programmata» solo dove il Piano è raggiungibile: chi apre il
                // pannello dal Piano stesso è già sulla griglia.
                .filter(s => s.key !== 'scheduled' || onSchedule || flowStatus === 'scheduled')
                .map(s => (
                  <button
                    key={s.key}
                    className={`planner-estimate-chip planner-chip-icon${flowStatus === s.key ? ' active' : ''}`}
                    title={STATUS_HINTS[s.key]}
                    aria-label={s.label}
                    aria-pressed={flowStatus === s.key}
                    disabled={savingStatus}
                    onClick={() => applyStatus(s.key)}>
                    <StatusIcon status={s.key} />
                  </button>
                ))}
              {/* Il nome dello stato scelto, per esteso: le icone si imparano
                  in due giorni, ma la scheda non deve chiedere di indovinare
                  qual è quella accesa. */}
              <span className="planner-stato-nome">
                {STATUS_CHOICES.find(c => c.key === flowStatus)?.label
                  ?? (flowStatus === 'inbox' ? 'Da chiarire' : '')}
              </span>
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
                    onChange={e => { tocca('persona'); setWho(e.target.value); }}
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

        </>
      )}
    </div>
  );
}
