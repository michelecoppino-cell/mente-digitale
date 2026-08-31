/**
 * mente-comandi.mjs
 * Le operazioni della mente digitale fuori dal browser, una funzione ciascuna.
 *
 * Sta in mezzo fra `mente-graph.mjs` (che parla con Microsoft) e i due modi di
 * usarle: `mente.mjs` da riga di comando e `mente-mcp.mjs` come server MCP. Le
 * regole — quali stati si possono scrivere, quando serve una sezione, come si
 * compongono le note di un'attività — stanno qui una volta sola, così le due
 * strade non possono divergere.
 *
 * «Sezione» qui vuol dire una lista di Microsoft To-Do. Una commessa può averne
 * più d'una: una per consegna, chiamata `GRUPPO.Consegna-YYMMDD` (la convenzione
 * sta in `src/paraConfig.js`). Quindi un nome può indicare una consegna sola
 * oppure tutta la commessa — cercare `2573` con tre consegne aperte vale «tutte
 * e tre», non è un errore di ambiguità.
 *
 * Ogni funzione prende un oggetto di opzioni già normalizzate e restituisce
 * `{ data, text }`: `data` è la forma strutturata (per --json e per i tool MCP),
 * `text` la resa leggibile in un terminale.
 *
 * Nessuna dipendenza, Node 18+.
 */

import {
  getTodoLists, getTodoTasks, createTask, patchTask, createTodoList,
  loadDailyPlans, saveDailyPlans, loadIdentityDoc,
  loadObiettivi, saveObiettivi,
  loadDiaryIndex, loadDiaryMonth, saveDiaryEntry,
  getCalendarEvents, getCalendars, createCalendarEvent,
  getNotebooks, getSections, getPages, getPageContentHtml, htmlToText,
  createPage, appendToPage, textToHtml,
} from './mente-graph.mjs';

import {
  taskStatus, inboxListId, indexScheduled, taskEstimateMin, noteText,
  taskContext, withEstimateMarker, withPerson, withContext, personRoleFor, taskPerson,
  graphStatusFor, STATUS_LABELS, TASK_STATUSES, CONTEXTS, GRANULARITY_MEMO_LINE,
} from '../src/taskModel.js';

import {
  listGroupKey, listDeliverableLabel, listDueDate, listLabel, sortDeliverableLists,
  buildListName,
} from '../src/paraConfig.js';

import {
  nuovoObiettivo, obiettiviDelMese, meseDi, MIN_OBIETTIVI, MAX_OBIETTIVI,
} from '../src/obiettivi.js';

import {
  makeEntry, dateKey, monthKey, filterEntries, humanDate, DIARY_TYPES,
  MOOD_LABELS, ENERGY_LABELS,
} from '../src/diary.js';

// Gli stati che si possono scrivere da fuori l'app. `inbox` e `scheduled` non
// ci sono: il primo è la lista di default di To-Do, il secondo un blocco nel
// piano del giorno. Nessuno dei due è un campo che si possa impostare.
export const STATI_SCRIVIBILI = ['next', 'ask', 'waiting', 'delegated', 'someday', 'done'];
export const STATI_CREABILI = ['inbox', 'next', 'ask', 'waiting', 'delegated', 'someday'];
export const TIPI_DIARIO = Object.keys(DIARY_TYPES);
export { TASK_STATUSES, CONTEXTS, STATUS_LABELS, GRANULARITY_MEMO_LINE };

// ── Formattazione ────────────────────────────────────────────────────────────

const fmtGiorno = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome',
});

/** @param {any} ev @returns {string} */
function eventTime(ev) {
  if (ev.isAllDay) return 'tutto il giorno';
  const t = /** @param {string} s */ s => String(s || '').slice(11, 16);
  return `${t(ev.start?.dateTime)}–${t(ev.end?.dateTime)}`;
}

/** @param {string} s @param {number} n @returns {string} */
function tronca(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** @param {string} id @returns {string} le prime 8 cifre dell'id, quanto basta per riferirsi a un task */
const shortId = id => String(id || '').slice(0, 8);

/** @param {string} title @param {string[]} lines @returns {string} */
function blocco(title, lines) {
  if (!lines.length) return `${title}\n  —`;
  return `${title}\n${lines.map(l => '  ' + l).join('\n')}`;
}

/** @param {any} v @returns {string|null} */
function testo(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** @param {any} v @param {number|null} [fallback] @returns {number|null} */
function numero(v, fallback = null) {
  if (v === undefined || v === null || v === '' || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── Attività: raccolta e ricerca ─────────────────────────────────────────────

/**
 * Tutte le attività di tutte le liste, con lo stato del flusso già calcolato
 * come lo calcola l'app (piani del giorno inclusi: da lì viene `scheduled`).
 * @param {{ includeDone?: boolean }} [opts]
 */
async function collectTasks(opts = {}) {
  const [lists, plans] = await Promise.all([getTodoLists(), loadDailyPlans()]);
  const scheduled = indexScheduled(plans);
  const scheduledIds = new Set(scheduled.keys());
  const inboxId = inboxListId(lists);

  const perLista = await Promise.all(lists.map(l => getTodoTasks(l, opts)));
  const tasks = perLista.flat().map(t => ({
    ...t,
    _status: taskStatus(t, { scheduledIds, inboxListId: inboxId }),
    _placement: scheduled.get(t.id) || null,
  }));
  return { lists, tasks, plans, inboxId };
}

/**
 * Le liste che somigliano a un nome, anche parziale: prima quelle con il nome
 * esatto, altrimenti tutte quelle che lo contengono. Nessun errore — serve ai
 * filtri, dove «niente che somigli» è un elenco vuoto, non un problema.
 * @param {any[]} lists
 * @param {string} query
 * @returns {any[]}
 */
function matchLists(lists, query) {
  const q = query.toLowerCase();
  const exact = lists.filter(l => (l.displayName || '').toLowerCase() === q);
  return exact.length ? exact : lists.filter(l => (l.displayName || '').toLowerCase().includes(q));
}

/**
 * Le liste To-Do indicate da un nome, dove almeno una ci deve essere. Di solito
 * è una sola — una lista è una sezione — ma quando i risultati sono tutti
 * consegne della stessa commessa (`2573.A60`, `2573.B10`…) valgono per la
 * commessa intera: chi scrive `2573` intende quel lavoro, non una consegna a
 * caso. Gruppi diversi restano un'ambiguità, e un'ambiguità resta un errore.
 * @param {any[]} lists
 * @param {string} query
 * @returns {any[]} almeno una lista, tutte della stessa commessa
 */
function findLists(lists, query) {
  const found = matchLists(lists, query);
  if (!found.length) throw new Error(`Nessuna sezione che somigli a "${query}".`);
  if (found.length === 1) return found;

  const gruppi = new Set(found.map(l => (listGroupKey(l.displayName) || l.displayName).toLowerCase()));
  if (gruppi.size > 1) {
    throw new Error(`"${query}" corrisponde a più sezioni: ${found.map(l => l.displayName).join(', ')}`);
  }
  return sortDeliverableLists(found);
}

/**
 * Come findLists, ma dove ne serve una sola — creare un'attività va fatto in
 * una lista precisa, e «tutta la commessa» non è un posto.
 * @param {any[]} lists
 * @param {string} query
 */
function findList(lists, query) {
  const found = findLists(lists, query);
  if (found.length > 1) {
    const consegne = found.map(l => `${listDeliverableLabel(l.displayName)} (${l.displayName})`).join(', ');
    throw new Error(`"${query}" è una commessa con ${found.length} consegne: indica quale — ${consegne}`);
  }
  return found[0];
}

/**
 * Trova un'attività da un pezzo di id o da un pezzo di titolo. Ambiguo è un
 * errore, non una scelta arbitraria: da qui si scrive su To-Do vero.
 * @param {any[]} tasks
 * @param {string} query
 */
function findTask(tasks, query) {
  const q = query.toLowerCase();
  const perId = tasks.filter(t => String(t.id).toLowerCase().startsWith(q));
  const found = perId.length ? perId : tasks.filter(t => (t.title || '').toLowerCase().includes(q));
  if (!found.length) throw new Error(`Nessuna attività per "${query}".`);
  if (found.length > 1) {
    const elenco = found.slice(0, 8).map(t => `  ${shortId(t.id)}  ${tronca(t.title, 60)}`).join('\n');
    throw new Error(`"${query}" corrisponde a ${found.length} attività:\n${elenco}`);
  }
  return found[0];
}

/** @param {any} t @returns {string} una riga di elenco per un'attività */
function taskLine(t) {
  const meta = [];
  // «commessa · consegna», mai il nome grezzo: la scadenza della consegna sta
  // dentro il nome della lista come `-YYMMDD`, ma è un campo, non testo.
  if (t._listName) meta.push(listLabel(t._listName));
  const ctx = taskContext(t);
  if (ctx) meta.push(CONTEXTS.find(c => c.key === ctx)?.label || ctx);
  const persona = taskPerson(t);
  if (persona) meta.push(persona.who);
  meta.push(`${taskEstimateMin(t)}m`);
  if (t.dueDateTime?.dateTime) meta.push(`scade ${String(t.dueDateTime.dateTime).slice(0, 10)}`);
  if (t._placement) meta.push(`${t._placement.date} ${t._placement.startTime}`);
  return `${shortId(t.id)}  ${tronca(t.title, 58)}  · ${meta.join(' · ')}`;
}

/** @param {any} t */
function riassuntoTask(t) {
  const consegna = listGroupKey(t._listName) ? listDeliverableLabel(t._listName) : null;
  const scadenzaConsegna = listDueDate(t._listName);
  return {
    id: t.id,
    titolo: t.title,
    stato: t._status,
    // `sezione` resta la commessa (o la lista, se non è annidata): è la chiave
    // con cui si filtra. La consegna è un campo a parte, con la sua scadenza.
    sezione: listGroupKey(t._listName) || t._listName,
    consegna,
    scadenzaConsegna: scadenzaConsegna ? scadenzaConsegna.toISOString().slice(0, 10) : null,
    lista: t._listName,
    contesto: taskContext(t),
    stimaMin: taskEstimateMin(t),
    scadenza: t.dueDateTime?.dateTime?.slice(0, 10) || null,
    nota: noteText(t.body?.content) || null,
    // Chi ha in mano la cosa, per gli stati che ne prevedono una: è dentro le
    // note come riga, ma un programma non deve doverla rileggere a mano.
    persona: taskPerson(t)?.who || null,
    sottoattivita: (t.checklistItems || []).map(c => ({ testo: c.displayName, fatta: !!c.isChecked })),
    programmata: t._placement,
  };
}

// ── Il giorno ────────────────────────────────────────────────────────────────

/**
 * @param {{ data?: string }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function oggi(opts = {}) {
  const giornoStr = testo(opts.data) || dateKey();
  const inizio = new Date(`${giornoStr}T00:00:00`);
  const fine = new Date(`${giornoStr}T23:59:59`);

  // Il calendario non deve poter far fallire tutto il resto, ma un errore va
  // detto: un trattino al posto dell'agenda non deve poter significare tanto
  // "giornata libera" quanto "Graph ha risposto 403".
  /** @type {string|null} */
  let erroreAgenda = null;
  const [{ tasks, plans }, eventi] = await Promise.all([
    collectTasks(),
    getCalendarEvents(inizio, fine).catch(e => { erroreAgenda = e.message; return []; }),
  ]);

  const piano = plans[giornoStr]?.blocks || [];
  /** @type {Record<string, number>} */
  const conteggi = {};
  for (const s of TASK_STATUSES) conteggi[s] = tasks.filter(t => t._status === s).length;
  const scivolate = tasks.filter(t => t._placement && !t._placement.completed && t._placement.date < giornoStr);

  const text = [
    fmtGiorno.format(new Date(`${giornoStr}T12:00:00`)),
    '',
    erroreAgenda
      ? `Agenda\n  ⚠ calendario non raggiungibile — ${erroreAgenda}`
      : blocco('Agenda', eventi.map(e => `${eventTime(e)}  ${tronca(e.subject, 60)}`)),
    '',
    blocco('Piano', piano.map(b =>
      `${b.startTime}–${b.endTime}  ${b.completed ? '✓' : '·'} ${tronca(b.taskTitle, 55)}`)),
    '',
    blocco('Attività', TASK_STATUSES.filter(s => s !== 'done' && conteggi[s])
      .map(s => `${String(conteggi[s]).padStart(3)}  ${STATUS_LABELS[s]}`)),
    scivolate.length ? `\n  ⚠ ${scivolate.length} programmate in giorni passati e mai chiuse` : '',
  ].join('\n');

  return {
    data: {
      data: giornoStr,
      eventi,
      erroreAgenda,
      piano,
      conteggi,
      scivolate: scivolate.map(riassuntoTask),
    },
    text,
  };
}

/**
 * @param {{ data?: string, giorni?: number }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function agenda(opts = {}) {
  const giorni = numero(opts.giorni, 7) || 7;
  const inizio = new Date(`${testo(opts.data) || dateKey()}T00:00:00`);
  const fine = new Date(inizio);
  fine.setDate(fine.getDate() + giorni);

  const eventi = await getCalendarEvents(inizio, fine);
  /** @type {Record<string, any[]>} */
  const perGiorno = {};
  for (const e of eventi) {
    const d = String(e.start?.dateTime || e.start?.date || '').slice(0, 10);
    (perGiorno[d] ||= []).push(e);
  }

  const text = Object.keys(perGiorno).sort().map(d => blocco(
    fmtGiorno.format(new Date(`${d}T12:00:00`)),
    perGiorno[d].map(e => `${eventTime(e)}  ${tronca(e.subject, 60)}`)
  )).join('\n\n') || 'Nessun evento nel periodo.';

  return { data: { da: dateKey(inizio), giorni, eventi }, text };
}

/**
 * @param {{ data?: string }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function piano(opts = {}) {
  const giornoStr = testo(opts.data) || dateKey();
  const plans = await loadDailyPlans();
  const blocks = plans[giornoStr]?.blocks || [];

  const righe = blocks.map(b => {
    const capo = `${b.startTime}–${b.endTime}  ${b.completed ? '✓' : '·'} ${tronca(b.taskTitle, 55)}`;
    const sotto = (b.subSteps || []).map(s => `     ${s.done ? '✓' : '·'} ${tronca(s.text || s.title || '', 50)}`);
    return [capo, ...sotto].join('\n  ');
  });

  return {
    data: { data: giornoStr, blocks },
    text: blocco(`Piano di ${fmtGiorno.format(new Date(`${giornoStr}T12:00:00`))}`, righe),
  };
}

// ── Attività ─────────────────────────────────────────────────────────────────

/**
 * @param {{ stato?: string, sezione?: string, contesto?: string, includiFatte?: boolean }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaLista(opts = {}) {
  const stato = testo(opts.stato);
  if (stato && !TASK_STATUSES.includes(/** @type {any} */ (stato))) {
    throw new Error(`Stato sconosciuto: ${stato} (${TASK_STATUSES.join(', ')})`);
  }

  const { lists, tasks } = await collectTasks({ includeDone: !!opts.includiFatte });
  let sel = stato ? tasks.filter(t => t._status === stato) : tasks;
  const sezione = testo(opts.sezione);
  if (sezione) {
    // Un nome che pesca più consegne della stessa commessa vale per tutte: è
    // la stessa regola di findLists, e qui filtrare non è mai un errore —
    // se non c'è niente che somigli, l'elenco esce vuoto.
    const ids = new Set(matchLists(lists, sezione).map(l => l.id));
    sel = sel.filter(t => ids.has(t._listId));
  }
  const contesto = testo(opts.contesto);
  if (contesto) sel = sel.filter(t => taskContext(t) === contesto.toLowerCase());

  const text = TASK_STATUSES
    .filter(s => sel.some(t => t._status === s))
    .map(s => blocco(STATUS_LABELS[s], sel.filter(t => t._status === s).map(taskLine)))
    .join('\n\n') || 'Nessuna attività con questi filtri.';

  return { data: { totale: sel.length, attivita: sel.map(riassuntoTask) }, text };
}

/**
 * @param {{ titolo?: string, sezione?: string, stato?: string, stimaMin?: number,
 *           scadenza?: string, contesto?: string, nota?: string, attesa?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaCrea(opts = {}) {
  const titolo = testo(opts.titolo);
  if (!titolo) throw new Error("Serve il titolo dell'attività.");

  // Tutti i controlli che non hanno bisogno della rete stanno prima della prima
  // chiamata: un'opzione sbagliata deve fallire subito, non dopo due secondi
  // di Graph e con un'attività a metà.
  const sezione = testo(opts.sezione);
  const stato = testo(opts.stato) || (sezione ? 'next' : 'inbox');
  if (!STATI_CREABILI.includes(stato)) {
    throw new Error(
      `Si crea in ${STATI_CREABILI.join(', ')}. ` +
      "«scheduled» si ottiene mettendo l'attività nel piano del giorno, «done» spuntandola."
    );
  }
  if (stato !== 'inbox' && !sezione) {
    throw new Error("Fuori da Inbox un'attività ha bisogno di una sezione.");
  }

  const attesa = testo(opts.attesa);
  const ruolo = personRoleFor(stato);
  if (attesa && !ruolo) {
    throw new Error('La persona vale solo per gli stati «ask», «waiting» e «delegated».');
  }
  if (!attesa && (stato === 'ask' || stato === 'delegated')) {
    throw new Error(`Lo stato «${stato}» ha bisogno di una persona: aggiungi --persona "Nome".`);
  }

  const contestoRaw = testo(opts.contesto);
  if (contestoRaw && !CONTEXTS.some(c => c.key === contestoRaw.toLowerCase())) {
    throw new Error(`Contesto sconosciuto: ${contestoRaw} (${CONTEXTS.map(c => c.key).join(', ')})`);
  }

  const scadenza = testo(opts.scadenza);
  if (scadenza && !/^\d{4}-\d{2}-\d{2}$/.test(scadenza)) {
    throw new Error(`Scadenza in formato sbagliato: ${scadenza} (serve YYYY-MM-DD)`);
  }

  const lists = await getTodoLists();
  const lista = sezione ? findList(lists, sezione) : lists.find(l => l.wellknownListName === 'defaultList');
  if (!lista) throw new Error('Nessuna lista di default su To-Do: indica una sezione.');

  // Le note si compongono nell'ordine che l'app sa rileggere: il marker della
  // stima può stare ovunque, la riga dell'attesa deve restare la prima.
  let body = testo(opts.nota) || '';
  const stima = numero(opts.stimaMin);
  if (stima) body = withEstimateMarker(body, stima);
  if (attesa) body = withPerson(body, ruolo, attesa);

  const contesto = contestoRaw?.toLowerCase() || null;
  const creato = await createTask(lista.id, {
    title: titolo,
    body: body || undefined,
    status: graphStatusFor(/** @type {any} */ (stato)),
    dueDate: scadenza || undefined,
    categories: contesto ? withContext({ categories: [] }, contesto) : undefined,
  });

  return {
    data: { creata: { id: creato.id, titolo: creato.title, sezione: lista.displayName, stato } },
    text: `✓ creata in ${lista.displayName} come ${STATUS_LABELS[stato]}\n  ${shortId(creato.id)}  ${creato.title}`,
  };
}

/**
 * @param {{ attivita?: string, stato?: string, persona?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaStato(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  const stato = testo(opts.stato);
  if (!stato) throw new Error(`Serve lo stato: ${STATI_SCRIVIBILI.join(', ')}`);
  if (!STATI_SCRIVIBILI.includes(stato)) {
    throw new Error(
      `Da qui si passa a ${STATI_SCRIVIBILI.join(', ')}. ` +
      '«inbox» è la lista di default e «scheduled» è un blocco nel piano: si cambiano dall\'app.'
    );
  }

  const persona = testo(opts.persona);
  const ruolo = personRoleFor(stato);
  if (persona && !ruolo) {
    throw new Error('La persona vale solo per gli stati «ask», «waiting» e «delegated».');
  }

  const { tasks } = await collectTasks({ includeDone: true });
  const task = findTask(tasks, query);

  // Da chiedere e delegata non sono uno stato di To-Do ma una riga nelle note,
  // e uscirne vuol dire cancellarla: quindi qui si riscrive sempre il corpo,
  // non solo lo `status`. Senza un nome nuovo si tiene quello che c'era —
  // passare da «in attesa da Sara» a «delegata» non deve perdere Sara.
  const bodyPrima = task.body?.content || '';
  const chi = ruolo ? (persona || taskPerson(task)?.who || 'qualcuno') : null;
  const bodyDopo = withPerson(bodyPrima, ruolo, chi);

  if (task._status === stato && bodyDopo === bodyPrima) {
    return {
      data: { id: task.id, titolo: task.title, stato, invariato: true },
      text: `${tronca(task.title, 60)} era già ${STATUS_LABELS[stato]}.`,
    };
  }

  await patchTask(task._listId, task.id, {
    status: graphStatusFor(/** @type {any} */ (stato)),
    ...(bodyDopo !== bodyPrima ? { body: { content: bodyDopo, contentType: 'text' } } : {}),
  });
  return {
    data: { id: task.id, titolo: task.title, stato, persona: chi, precedente: task._status },
    text: `✓ ${tronca(task.title, 60)} → ${STATUS_LABELS[stato]}${chi ? ` · ${chi}` : ''}`,
  };
}

// ── Diario ───────────────────────────────────────────────────────────────────

/**
 * @param {{ mese?: string, giorni?: number, cerca?: string, tag?: string, includiCassetto?: boolean }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function diarioLeggi(opts = {}) {
  const mese = testo(opts.mese);
  const giorni = numero(opts.giorni, mese ? null : 14);

  /** @type {string[]} */
  let mesi;
  if (mese) {
    if (!/^\d{4}-\d{2}$/.test(mese)) throw new Error(`Mese in formato sbagliato: ${mese} (serve YYYY-MM)`);
    mesi = [mese];
  } else {
    // I mesi toccati dalla finestra richiesta, presi dall'indice: chiedere a
    // OneDrive un mese in cui non si è scritto costa una richiesta a vuoto.
    const idx = await loadDiaryIndex();
    const da = new Date();
    da.setDate(da.getDate() - (/** @type {number} */ (giorni) - 1));
    const primo = monthKey(da);
    mesi = idx.months.filter(m => m >= primo);
    if (!mesi.length) mesi = [monthKey()];
  }

  const voci = (await Promise.all(mesi.map(loadDiaryMonth))).flat();
  let sel = filterEntries(voci, {
    query: testo(opts.cerca) || '',
    tag: testo(opts.tag),
    includeSealed: !!opts.includiCassetto,
  });
  if (!mese && giorni) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (giorni - 1));
    const soglia = dateKey(cutoff);
    sel = sel.filter(e => e.date >= soglia);
  }

  return {
    data: { mesi, totale: sel.length, voci: sel },
    text: sel.length ? sel.map(voceText).join('\n\n') : 'Nessuna voce nel periodo.',
  };
}

/**
 * @param {{ testo?: string, tipo?: string, data?: string, tag?: string[]|string,
 *           umore?: number, energia?: number, gratitudine?: string[]|string, cassetto?: boolean }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function diarioScrivi(opts = {}) {
  const contenuto = testo(opts.testo);
  if (!contenuto) throw new Error('Niente da scrivere: serve il testo della voce.');

  const tipo = testo(opts.tipo) || 'libero';
  if (!DIARY_TYPES[tipo]) throw new Error(`Tipo sconosciuto: ${tipo} (${TIPI_DIARIO.join(', ')})`);

  const data = testo(opts.data);
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error(`Data in formato sbagliato: ${data} (serve YYYY-MM-DD)`);
  }

  const umore = numero(opts.umore);
  const energia = numero(opts.energia);
  for (const [nome, v] of [['umore', umore], ['energia', energia]]) {
    if (v !== null && (v < 1 || v > 5)) throw new Error(`${nome}: serve un numero da 1 a 5, non ${v}.`);
  }

  const entry = makeEntry({
    text: contenuto,
    type: /** @type {any} */ (tipo),
    date: data || undefined,
    tags: elenco(opts.tag, ',').map(t => t.replace(/^#/, '').toLowerCase()),
    mood: umore,
    energy: energia,
    gratitude: elenco(opts.gratitudine, '|'),   // makeEntry, con tag vuoti, li ricava dal testo (#cosi)
    sealed: !!opts.cassetto,
  });
  await saveDiaryEntry(entry);
  return {
    data: { voce: entry },
    text: `✓ voce salvata — ${humanDate(entry.date)}, ${DIARY_TYPES[entry.type].label}` +
          (entry.sealed ? ' (nel cassetto)' : '') +
          (entry.tags.length ? `, tag ${entry.tags.map(t => '#' + t).join(' ')}` : ''),
  };
}

/**
 * Accetta sia un array (MCP) sia una stringa con separatore (riga di comando).
 * @param {string[]|string|undefined} v
 * @param {string} sep
 * @returns {string[]}
 */
function elenco(v, sep) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(sep).map(x => x.trim()).filter(Boolean);
  return [];
}

/** @param {any} e @returns {string} */
function voceText(e) {
  const meta = [DIARY_TYPES[e.type]?.label || e.type];
  if (e.mood) meta.push(`umore ${e.mood}/5 (${MOOD_LABELS[e.mood]})`);
  if (e.energy) meta.push(`energia ${e.energy}/5 (${ENERGY_LABELS[e.energy]})`);
  if (e.tags?.length) meta.push(e.tags.map(t => `#${t}`).join(' '));
  if (e.sealed) meta.push('nel cassetto');
  const righe = [`${humanDate(e.date)} — ${meta.join(' · ')}`];
  if (e.seed) righe.push(`  _${e.seed}_`);
  righe.push(...String(e.text || '').split('\n').map(r => '  ' + r));
  for (const g of e.gratitude || []) righe.push(`  · grato per: ${g}`);
  for (const p of e.photos || []) righe.push(`  [foto] ${p.caption || p.name}`);
  return righe.join('\n');
}

// ── Sezioni, OneNote, documenti identitari ───────────────────────────────────

/**
 * Le liste To-Do raccolte per commessa: quelle annidate
 * (`GRUPPO.Consegna-YYMMDD`) stanno sotto il loro gruppo, con la scadenza
 * accanto; le altre restano da sole, come sono sempre state.
 * @param {any[]} lists
 * @returns {{ nome: string, liste: any[] }[]}
 */
function listePerCommessa(lists) {
  /** @type {Map<string, { nome: string, liste: any[] }>} */
  const map = new Map();
  for (const l of lists) {
    const gruppo = listGroupKey(l.displayName);
    const key = (gruppo || l.displayName).toLowerCase();
    if (!map.has(key)) map.set(key, { nome: gruppo || l.displayName, liste: [] });
    map.get(key)?.liste.push(l);
  }
  for (const c of map.values()) c.liste = sortDeliverableLists(c.liste);
  return Array.from(map.values());
}

/** @returns {Promise<{ data: any, text: string }>} */
export async function sezioni() {
  const [{ lists, tasks }, notebooks] = await Promise.all([collectTasks(), getNotebooks()]);
  const sezioniPerTaccuino = await Promise.all(notebooks.map(n => getSections(n.id)));

  const conteggio = /** @param {string} id */ id => tasks.filter(t => t._listId === id).length;
  const commesse = listePerCommessa(lists);

  /** @param {any} l @returns {string} */
  const rigaLista = l => {
    const scadenza = listDueDate(l.displayName);
    const coda = [
      scadenza ? `scade ${scadenza.toISOString().slice(0, 10)}` : null,
      l.wellknownListName === 'defaultList' ? '(Inbox)' : null,
    ].filter(Boolean).join('  ');
    const nome = listGroupKey(l.displayName) ? `  · ${listDeliverableLabel(l.displayName)}` : l.displayName;
    return `${String(conteggio(l.id)).padStart(3)} aperte  ${nome}${coda ? '  ' + coda : ''}`;
  };

  const listeText = commesse.flatMap(c => (
    // Una commessa con una consegna sola non ha bisogno di un'intestazione: la
    // riga è già il suo nome.
    c.liste.length === 1 && !listGroupKey(c.liste[0].displayName)
      ? [rigaLista(c.liste[0])]
      : [`${c.nome}`, ...c.liste.map(rigaLista)]
  ));
  const taccuiniText = notebooks.map((n, i) =>
    `${n.displayName}: ${(sezioniPerTaccuino[i] || []).map(s => s.displayName).join(', ') || '—'}`);

  return {
    data: {
      commesse: commesse.map(c => ({
        nome: c.nome,
        liste: c.liste.map(l => ({
          id: l.id,
          nome: l.displayName,
          consegna: listGroupKey(l.displayName) ? listDeliverableLabel(l.displayName) : null,
          scadenza: listDueDate(l.displayName)?.toISOString().slice(0, 10) || null,
          aperte: conteggio(l.id),
        })),
      })),
      // `liste` resta piatta: è la forma che usa chi vuole solo i nomi.
      liste: lists.map(l => ({ id: l.id, nome: l.displayName, aperte: conteggio(l.id) })),
      taccuini: notebooks.map((n, i) => ({
        nome: n.displayName,
        sezioni: (sezioniPerTaccuino[i] || []).map(s => ({ id: s.id, nome: s.displayName })),
      })),
    },
    text: [blocco('Sezioni (liste To-Do)', listeText), '', blocco('Taccuini OneNote', taccuiniText)].join('\n'),
  };
}

/** Tutte le sezioni di tutti i taccuini, con il nome del taccuino accanto. */
async function tutteLeSezioniOneNote() {
  const notebooks = await getNotebooks();
  const perTaccuino = await Promise.all(notebooks.map(n => getSections(n.id)));
  return perTaccuino.flatMap((sezioni, i) =>
    sezioni.map(s => ({ ...s, _notebook: notebooks[i].displayName })));
}

/** @param {string} query */
async function trovaSezioneOneNote(query) {
  const sezioni = await tutteLeSezioniOneNote();
  const q = query.toLowerCase();
  const esatte = sezioni.filter(s => (s.displayName || '').toLowerCase() === q);
  const found = esatte.length ? esatte : sezioni.filter(s => (s.displayName || '').toLowerCase().includes(q));
  if (!found.length) throw new Error(`Nessuna sezione OneNote per "${query}".`);
  if (found.length > 1) {
    throw new Error(`"${query}" corrisponde a: ${found.map(s => `${s._notebook}/${s.displayName}`).join(', ')}`);
  }
  return found[0];
}

/**
 * @param {{ sezione?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function notePagine(opts = {}) {
  const query = testo(opts.sezione);
  if (!query) throw new Error('Serve il nome di una sezione OneNote.');
  const sezione = await trovaSezioneOneNote(query);
  const pagine = await getPages(sezione.id);

  return {
    data: {
      taccuino: sezione._notebook,
      sezione: sezione.displayName,
      pagine: pagine.map(p => ({ id: p.id, titolo: p.title, modificata: p.lastModifiedDateTime })),
    },
    text: blocco(`${sezione._notebook} / ${sezione.displayName}`,
      pagine.map(p => `${String(p.lastModifiedDateTime || '').slice(0, 10)}  ${tronca(p.title, 60)}\n    ${p.id}`)),
  };
}

/**
 * @param {{ pagina?: string, sezione?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function noteLeggi(opts = {}) {
  const query = testo(opts.pagina);
  if (!query) throw new Error("Serve l'id di una pagina OneNote, o il suo titolo insieme alla sezione.");

  const { id, titolo } = await risolviPagina(query, testo(opts.sezione));
  const contenuto = htmlToText(await getPageContentHtml(id));
  return { data: { id, titolo, testo: contenuto }, text: contenuto };
}

/**
 * @param {{ tipo?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function identita(opts = {}) {
  const tipo = testo(opts.tipo) || 'bussola';
  if (tipo !== 'bussola' && tipo !== 'visione') throw new Error(`Documento sconosciuto: ${tipo} (bussola, visione)`);

  const doc = await loadIdentityDoc(tipo);
  if (!doc) return { data: null, text: `Nessun documento "${tipo}" su OneDrive.` };
  const sezioni = doc.sections || [];
  return {
    data: doc,
    text: sezioni.map(/** @param {any} s */ s => `── ${s.title} ──\n${s.content || ''}`.trim()).join('\n\n'),
  };
}

// ── Piano: scrittura ─────────────────────────────────────────────────────────
// Il piano vive in un file solo su OneDrive (`mente-digitale-daily-plans.json`),
// una chiave per giorno. Un blocco è un'attività messa a un'ora: dice quando la
// si fa, e da lì l'attività prende lo stato «programmata» in tutta l'app.
//
// «Giornaliero, settimanale, mensile» non sono tre piani ma tre distanze da cui
// si guarda lo stesso: nel Piano dell'app sono tre viste sugli stessi blocchi.
// Perciò qui c'è una sola scrittura — `pianoAggiungi`, che prende un giorno
// qualunque — e due letture, la settimana e il mese, per vedere il risultato
// alla distanza giusta. Il piano *del mese* nel senso di dove si vuole
// arrivare è un'altra cosa e ha i suoi strumenti: gli obiettivi, più sotto.

const ORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GIORNO_RE = /^\d{4}-\d{2}-\d{2}$/;
// Il mese vuole il mese vero, 01–12: due cifre qualunque lasciano passare 2026-13,
// e da lì `new Date(2026, 13, 0)` scivola in gennaio dell'anno dopo senza dirlo.
const MESE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** @param {string} hhmm @returns {number} minuti dalla mezzanotte */
function minuti(hhmm) {
  const m = ORA_RE.exec(hhmm);
  if (!m) throw new Error(`Ora in formato sbagliato: ${hhmm} (serve HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** @param {number} min @returns {string} "HH:MM" */
function ora(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** @param {string} giorno @returns {string} controllato, o eccezione */
function giornoValido(giorno) {
  if (!GIORNO_RE.test(giorno) || Number.isNaN(new Date(`${giorno}T12:00:00`).getTime())) {
    throw new Error(`Giorno in formato sbagliato: ${giorno} (serve YYYY-MM-DD)`);
  }
  return giorno;
}

/** I sette giorni della settimana che contiene una data, da lunedì. */
function settimanaDi(/** @type {string} */ giorno) {
  const d = new Date(`${giorno}T12:00:00`);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const g = new Date(d);
    g.setDate(d.getDate() + i);
    return `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`;
  });
}

/** Un id come quelli che genera l'app: basta che sia unico dentro al file. */
function nuovoIdBlocco() {
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Mette un'attività nel piano di un giorno, a un'ora.
 *
 * Due blocchi che si accavallano sono un errore e non una sovrapposizione da
 * disegnare: il piano dice quando si fa una cosa, e due cose alla stessa ora
 * vuol dire che non lo dice. L'app, dove si trascina e si vede la griglia, può
 * permetterselo; da qui, dove si scrive alla cieca, no.
 *
 * @param {{ attivita?: string, data?: string, ora?: string, durataMin?: number }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoAggiungi(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  const inizio = testo(opts.ora);
  if (!inizio) throw new Error("Serve l'ora di inizio, HH:MM.");

  const giorno = giornoValido(testo(opts.data) || dateKey());
  const inizioMin = minuti(inizio);

  const { tasks, plans } = await collectTasks();
  const task = findTask(tasks, query);

  // La durata: quella chiesta, altrimenti la stima dell'attività — che è la
  // stessa cosa che fa l'app quando si trascina un task sulla griglia.
  const durata = numero(opts.durataMin) ?? taskEstimateMin(task);
  if (durata <= 0) throw new Error(`Durata non valida: ${durata} minuti.`);
  const fineMin = inizioMin + durata;
  if (fineMin > 24 * 60) throw new Error(`Un blocco dalle ${inizio} di ${durata} minuti esce dal giorno.`);

  const piano = plans[giorno] || { date: giorno, blocks: [] };
  const blocchi = piano.blocks || [];

  const scontro = blocchi.find(b => minuti(b.startTime) < fineMin && inizioMin < minuti(b.endTime));
  if (scontro) {
    throw new Error(
      `Alle ${inizio} c'è già «${tronca(scontro.taskTitle, 50)}» ` +
      `(${scontro.startTime}–${scontro.endTime}). Scegli un'altra ora.`
    );
  }

  const gia = blocchi.find(b => b.taskId === task.id);
  if (gia) {
    throw new Error(
      `«${tronca(task.title, 50)}» è già nel piano del ${giorno} alle ${gia.startTime}. ` +
      'Toglila prima, se va spostata.'
    );
  }

  const blocco = {
    id: nuovoIdBlocco(),
    taskId: task.id,
    taskTitle: task.title,
    listId: task._listId,
    listName: task._listName,
    // Il colore lo assegna l'app dalla mappa delle sezioni, che qui non c'è:
    // lasciarlo null la fa ricadere sul suo default invece di scrivere un
    // colore inventato che poi resterebbe.
    projectKey: null,
    projectColor: null,
    startTime: ora(inizioMin),
    endTime: ora(fineMin),
    completed: false,
    completedAt: null,
    subSteps: [],
  };

  plans[giorno] = { ...piano, date: giorno, blocks: [...blocchi, blocco].sort((a, b) => a.startTime.localeCompare(b.startTime)) };
  await saveDailyPlans(plans);

  return {
    data: { giorno, blocco },
    text: `✓ ${giorno} ${blocco.startTime}–${blocco.endTime}  ${tronca(task.title, 55)}`,
  };
}

/**
 * Toglie un'attività dal piano di un giorno. Non la completa e non la cancella:
 * torna solo a non avere un'ora.
 * @param {{ attivita?: string, data?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoTogli(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  const giorno = giornoValido(testo(opts.data) || dateKey());

  const plans = await loadDailyPlans();
  const piano = plans[giorno];
  const blocchi = piano?.blocks || [];
  const q = query.toLowerCase();
  const trovati = blocchi.filter(b =>
    String(b.taskId).toLowerCase().startsWith(q) || (b.taskTitle || '').toLowerCase().includes(q));

  if (!trovati.length) throw new Error(`Niente che somigli a "${query}" nel piano del ${giorno}.`);
  if (trovati.length > 1) {
    throw new Error(`"${query}" corrisponde a ${trovati.length} blocchi: ` +
      trovati.map(b => `${b.startTime} ${tronca(b.taskTitle, 40)}`).join(', '));
  }

  const via = trovati[0];
  plans[giorno] = { ...piano, blocks: blocchi.filter(b => b.id !== via.id) };
  await saveDailyPlans(plans);

  return {
    data: { giorno, tolto: { id: via.id, titolo: via.taskTitle, dalle: via.startTime } },
    text: `✓ tolto dal piano del ${giorno}: ${via.startTime} ${tronca(via.taskTitle, 50)}`,
  };
}

/**
 * Il piano di un arco di giorni: la settimana che contiene una data, oppure un
 * mese intero. È la stessa cosa che `piano` mostra per un giorno solo, letta
 * dalla distanza da cui si decide come sta la settimana.
 * @param {{ data?: string, mese?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoArco(opts = {}) {
  const mese = testo(opts.mese);
  /** @type {string[]} */
  let giorni;
  /** @type {string} */
  let titolo;

  if (mese) {
    if (!MESE_RE.test(mese)) throw new Error(`Mese in formato sbagliato: ${mese} (serve YYYY-MM)`);
    const [y, m] = mese.split('-').map(Number);
    const quanti = new Date(y, m, 0).getDate();
    giorni = Array.from({ length: quanti }, (_, i) => `${mese}-${String(i + 1).padStart(2, '0')}`);
    titolo = `Piano di ${mese}`;
  } else {
    const giorno = giornoValido(testo(opts.data) || dateKey());
    giorni = settimanaDi(giorno);
    titolo = `Piano dal ${giorni[0]} al ${giorni[6]}`;
  }

  const plans = await loadDailyPlans();
  const perGiorno = giorni.map(g => ({ giorno: g, blocks: plans[g]?.blocks || [] }));

  const righe = perGiorno.flatMap(d => {
    const impegnati = d.blocks.reduce((sum, b) => sum + (minuti(b.endTime) - minuti(b.startTime)), 0);
    const capo = `${fmtGiorno.format(new Date(`${d.giorno}T12:00:00`))}` +
      (d.blocks.length ? `  · ${Math.floor(impegnati / 60)}h${String(impegnati % 60).padStart(2, '0')} a piano` : '  · libero');
    const sotto = d.blocks.map(b =>
      `   ${b.startTime}–${b.endTime}  ${b.completed ? '✓' : '·'} ${tronca(b.taskTitle, 48)}`);
    return [capo, ...sotto];
  });

  const totale = perGiorno.reduce((n, d) => n + d.blocks.length, 0);
  return {
    data: { giorni: perGiorno, totaleBlocchi: totale },
    text: blocco(titolo, righe),
  };
}

// ── Obiettivi del mese ───────────────────────────────────────────────────────
// Il piano del mese nel senso che conta: non quando si fanno le cose — quello è
// la griglia dei giorni — ma dove si vuole arrivare entro il trentuno. Da tre a
// sei righe, ognuna un titolo e un numero. Il modello sta in `src/obiettivi.js`,
// lo stesso che usa il riquadro in «Oggi».

/**
 * @param {{ mese?: string }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function obiettiviLeggi(opts = {}) {
  const ym = testo(opts.mese) || meseDi(dateKey());
  if (!MESE_RE.test(ym)) throw new Error(`Mese in formato sbagliato: ${ym} (serve YYYY-MM)`);

  const doc = await loadObiettivi();
  const righe = obiettiviDelMese(doc, ym);

  const text = blocco(`Obiettivi di ${ym}`, righe.map(o => {
    // Un obiettivo con una `fonte` non porta il suo numero: lo si deriva dai
    // registri, e quel conto vive nell'app. Da qui si dice da dove viene.
    const conto = o.fonte ? `dal registro «${o.fonte}»` : `${o.fatti ?? 0}/${o.totale}`;
    return `${tronca(o.titolo, 48).padEnd(48)}  ${conto}${o.unita ? ' ' + o.unita : ''}`;
  }));

  return { data: { mese: ym, obiettivi: righe }, text };
}

/**
 * Scrive gli obiettivi di un mese. Li riscrive tutti insieme, e non uno alla
 * volta: sono da tre a sei righe che si guardano come un blocco solo — «questo
 * mese voglio questo» — e aggiungerne uno per volta senza vedere gli altri è il
 * modo di ritrovarsene nove a metà mese.
 *
 * @param {{ mese?: string, obiettivi?: any[] }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function obiettiviScrivi(opts = {}) {
  const ym = testo(opts.mese) || meseDi(dateKey());
  if (!MESE_RE.test(ym)) throw new Error(`Mese in formato sbagliato: ${ym} (serve YYYY-MM)`);

  const righe = Array.isArray(opts.obiettivi) ? opts.obiettivi : [];
  if (righe.length < MIN_OBIETTIVI || righe.length > MAX_OBIETTIVI) {
    throw new Error(
      `Gli obiettivi di un mese sono da ${MIN_OBIETTIVI} a ${MAX_OBIETTIVI}: ne sono arrivati ${righe.length}. ` +
      'Sotto i tre è un elenco della spesa, sopra i sei non è più una scelta.'
    );
  }

  const nuovi = righe.map((o, i) => {
    const titolo = testo(o?.titolo);
    if (!titolo) throw new Error(`L'obiettivo n. ${i + 1} non ha un titolo.`);
    const totale = numero(o?.totale, 1) ?? 1;
    if (totale < 1) throw new Error(`«${titolo}»: il totale dev'essere almeno 1.`);
    return nuovoObiettivo({
      ym,
      titolo,
      totale,
      fatti: numero(o?.fatti, 0) ?? 0,
      unita: testo(o?.unita) || '',
      fonte: testo(o?.fonte),
    });
  });

  const doc = await loadObiettivi();
  const precedenti = obiettiviDelMese(doc, ym);
  doc[ym] = nuovi;
  await saveObiettivi(doc);

  return {
    data: { mese: ym, obiettivi: nuovi, sostituiti: precedenti.length },
    text: [
      `✓ ${nuovi.length} obiettivi per ${ym}` + (precedenti.length ? ` (ne sostituiscono ${precedenti.length})` : ''),
      ...nuovi.map(o => `  ${tronca(o.titolo, 50)}  ${o.fonte ? `dal registro «${o.fonte}»` : `${o.fatti ?? 0}/${o.totale}`}`),
    ].join('\n'),
  };
}

// ── Sezioni: creazione ───────────────────────────────────────────────────────

/**
 * Una lista To-Do nuova. Due modi, e sono lo stesso: o si passa il nome per
 * intero, o si passano commessa, consegna e scadenza e il nome lo compone la
 * convenzione (`GRUPPO.Consegna-YYMMDD`, vedi `src/paraConfig.js`) — che è
 * meglio, perché un nome scritto a mano che sbaglia il formato non viene letto
 * come consegna da nessuna parte e la scadenza sparisce senza un errore.
 *
 * @param {{ nome?: string, commessa?: string, consegna?: string, scadenza?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function sezioneCrea(opts = {}) {
  const commessa = testo(opts.commessa);
  const consegna = testo(opts.consegna);
  const scadenza = testo(opts.scadenza);

  if (scadenza && !GIORNO_RE.test(scadenza)) {
    throw new Error(`Scadenza in formato sbagliato: ${scadenza} (serve YYYY-MM-DD)`);
  }
  if ((commessa && !consegna) || (consegna && !commessa)) {
    throw new Error('Per una consegna servono sia la commessa sia il nome della consegna.');
  }

  const nome = commessa && consegna
    ? buildListName({ gruppo: commessa, consegna, scadenza: scadenza || null })
    : testo(opts.nome);
  if (!nome) throw new Error('Serve il nome della lista, oppure commessa + consegna.');

  const lists = await getTodoLists();
  const gia = lists.find(l => (l.displayName || '').toLowerCase() === nome.toLowerCase());
  if (gia) throw new Error(`Esiste già una lista che si chiama «${gia.displayName}».`);

  const creata = await createTodoList(nome);
  return {
    data: { id: creata.id, nome: creata.displayName },
    text: `✓ creata la lista «${creata.displayName}»`,
  };
}

// ── Calendario: creazione ────────────────────────────────────────────────────

/**
 * Un evento nuovo sul calendario. Le ore si danno locali, e locali restano:
 * «giovedì alle 15» è le 15 sul calendario, anche se fra oggi e giovedì cambia
 * l'ora legale.
 *
 * @param {{ oggetto?: string, data?: string, inizio?: string, fine?: string, durataMin?: number,
 *           tuttoIlGiorno?: boolean, luogo?: string, note?: string,
 *           promemoriaMin?: number, calendario?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function eventoCrea(opts = {}) {
  const oggetto = testo(opts.oggetto);
  if (!oggetto) throw new Error("Serve l'oggetto dell'evento.");
  const giorno = giornoValido(testo(opts.data) || dateKey());
  const tuttoIlGiorno = !!opts.tuttoIlGiorno;

  let inizio = null, fine = null;
  if (!tuttoIlGiorno) {
    inizio = testo(opts.inizio);
    if (!inizio) throw new Error("Serve l'ora di inizio, HH:MM (oppure tuttoIlGiorno).");
    const inizioMin = minuti(inizio);
    fine = testo(opts.fine);
    if (fine) {
      if (minuti(fine) <= inizioMin) throw new Error(`La fine (${fine}) non è dopo l'inizio (${inizio}).`);
    } else {
      const durata = numero(opts.durataMin, 60) ?? 60;
      if (durata <= 0) throw new Error(`Durata non valida: ${durata} minuti.`);
      if (inizioMin + durata > 24 * 60) throw new Error(`Un evento dalle ${inizio} di ${durata} minuti esce dal giorno.`);
      fine = ora(inizioMin + durata);
    }
  }

  // Il calendario: quello chiesto per nome, altrimenti il default dell'account.
  let calendarId = null;
  let calendarioNome = 'calendario di default';
  const calQuery = testo(opts.calendario);
  if (calQuery) {
    const cals = await getCalendars();
    const q = calQuery.toLowerCase();
    const esatti = cals.filter(c => (c.name || '').toLowerCase() === q);
    const found = esatti.length ? esatti : cals.filter(c => (c.name || '').toLowerCase().includes(q));
    if (!found.length) throw new Error(`Nessun calendario che somigli a "${calQuery}".`);
    if (found.length > 1) throw new Error(`"${calQuery}" corrisponde a: ${found.map(c => c.name).join(', ')}`);
    if (found[0].canEdit === false) throw new Error(`Sul calendario «${found[0].name}» non si può scrivere.`);
    calendarId = found[0].id;
    calendarioNome = found[0].name;
  }

  const creato = await createCalendarEvent({
    oggetto, data: giorno,
    inizio: inizio || undefined, fine: fine || undefined,
    tuttoIlGiorno,
    luogo: testo(opts.luogo) || undefined,
    note: testo(opts.note) || undefined,
    promemoriaMin: numero(opts.promemoriaMin),
    calendarId,
  });

  const quando = tuttoIlGiorno ? 'tutto il giorno' : `${inizio}–${fine}`;
  return {
    data: { id: creato.id, oggetto, giorno, quando, calendario: calendarioNome },
    text: `✓ ${giorno} ${quando}  ${oggetto}  · ${calendarioNome}`,
  };
}

// ── OneNote: scrittura ───────────────────────────────────────────────────────
// Due sole operazioni, e nessuna che tolga: una pagina nuova, e testo aggiunto
// in fondo a una che c'è già. OneNote sa anche sostituire il contenuto di un
// blocco, ma una sostituzione sbagliata da qui — alla cieca, senza vedere la
// pagina — cancellerebbe appunti che non si ricostruiscono.

/**
 * Una pagina nuova in una sezione OneNote.
 * @param {{ sezione?: string, titolo?: string, testo?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function noteCrea(opts = {}) {
  const sezioneQuery = testo(opts.sezione);
  if (!sezioneQuery) throw new Error('Serve la sezione OneNote in cui creare la pagina.');
  const titolo = testo(opts.titolo);
  if (!titolo) throw new Error('Serve il titolo della pagina.');

  const sezione = await trovaSezioneOneNote(sezioneQuery);
  const corpo = testo(opts.testo) || '';
  const pagina = await createPage(sezione.id, titolo, textToHtml(corpo));

  return {
    data: { id: pagina.id, titolo, sezione: sezione.displayName, taccuino: sezione._notebook },
    text: `✓ creata «${titolo}» in ${sezione._notebook} / ${sezione.displayName}\n  ${pagina.id}`,
  };
}

/**
 * Testo aggiunto in fondo a una pagina che esiste. La pagina si indica per id,
 * oppure per titolo insieme alla sezione — come in `noteLeggi`.
 * @param {{ pagina?: string, sezione?: string, testo?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function noteAggiungi(opts = {}) {
  const query = testo(opts.pagina);
  if (!query) throw new Error("Serve l'id della pagina, o il suo titolo insieme alla sezione.");
  const corpo = testo(opts.testo);
  if (!corpo) throw new Error('Serve il testo da aggiungere.');

  const { id, titolo } = await risolviPagina(query, testo(opts.sezione));
  await appendToPage(id, textToHtml(corpo));

  return {
    data: { id, titolo, aggiunto: corpo },
    text: `✓ aggiunto in fondo a «${titolo}»`,
  };
}

/**
 * Una pagina OneNote da un id o da un titolo più la sezione. Gli id OneNote
 * contengono sempre un '!': tutto il resto è un titolo da cercare.
 * @param {string} query
 * @param {string|null} sezioneQuery
 * @returns {Promise<{ id: string, titolo: string }>}
 */
async function risolviPagina(query, sezioneQuery) {
  if (query.includes('!')) return { id: query, titolo: query };
  if (!sezioneQuery) throw new Error('Per cercare una pagina per titolo serve anche la sezione.');
  const sezione = await trovaSezioneOneNote(sezioneQuery);
  const pagine = await getPages(sezione.id);
  const q = query.toLowerCase();
  const found = pagine.filter(p => (p.title || '').toLowerCase().includes(q));
  if (!found.length) throw new Error(`Nessuna pagina "${query}" in ${sezione.displayName}.`);
  if (found.length > 1) throw new Error(`"${query}" corrisponde a: ${found.map(p => p.title).join(', ')}`);
  return { id: found[0].id, titolo: found[0].title };
}
