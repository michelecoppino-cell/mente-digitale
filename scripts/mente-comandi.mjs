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
 * Ogni funzione prende un oggetto di opzioni già normalizzate e restituisce
 * `{ data, text }`: `data` è la forma strutturata (per --json e per i tool MCP),
 * `text` la resa leggibile in un terminale.
 *
 * Nessuna dipendenza, Node 18+.
 */

import {
  getTodoLists, getTodoTasks, createTask, patchTask,
  loadDailyPlans, loadIdentityDoc,
  loadDiaryIndex, loadDiaryMonth, saveDiaryEntry,
  getCalendarEvents,
  getNotebooks, getSections, getPages, getPageContentHtml, htmlToText,
} from './mente-graph.mjs';

import {
  taskStatus, inboxListId, indexScheduled, taskEstimateMin, noteText,
  taskContext, withEstimateMarker, withWaitingFor, withContext,
  graphStatusFor, STATUS_LABELS, TASK_STATUSES, CONTEXTS,
} from '../src/taskModel.js';

import {
  makeEntry, dateKey, monthKey, filterEntries, humanDate, DIARY_TYPES,
  MOOD_LABELS, ENERGY_LABELS,
} from '../src/diary.js';

// Gli stati che si possono scrivere da fuori l'app. `inbox` e `scheduled` non
// ci sono: il primo è la lista di default di To-Do, il secondo un blocco nel
// piano del giorno. Nessuno dei due è un campo che si possa impostare.
export const STATI_SCRIVIBILI = ['next', 'waiting', 'someday', 'done'];
export const STATI_CREABILI = ['inbox', 'next', 'waiting', 'someday'];
export const TIPI_DIARIO = Object.keys(DIARY_TYPES);
export { TASK_STATUSES, CONTEXTS, STATUS_LABELS };

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
 * Trova una lista To-Do — cioè una sezione — dal nome, anche parziale.
 * @param {any[]} lists
 * @param {string} query
 */
function findList(lists, query) {
  const q = query.toLowerCase();
  const exact = lists.filter(l => (l.displayName || '').toLowerCase() === q);
  const found = exact.length ? exact : lists.filter(l => (l.displayName || '').toLowerCase().includes(q));
  if (!found.length) throw new Error(`Nessuna sezione che somigli a "${query}".`);
  if (found.length > 1) {
    throw new Error(`"${query}" corrisponde a più sezioni: ${found.map(l => l.displayName).join(', ')}`);
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
  if (t._listName) meta.push(t._listName);
  const ctx = taskContext(t);
  if (ctx) meta.push(CONTEXTS.find(c => c.key === ctx)?.label || ctx);
  meta.push(`${taskEstimateMin(t)}m`);
  if (t.dueDateTime?.dateTime) meta.push(`scade ${String(t.dueDateTime.dateTime).slice(0, 10)}`);
  if (t._placement) meta.push(`${t._placement.date} ${t._placement.startTime}`);
  return `${shortId(t.id)}  ${tronca(t.title, 58)}  · ${meta.join(' · ')}`;
}

/** @param {any} t */
function riassuntoTask(t) {
  return {
    id: t.id,
    titolo: t.title,
    stato: t._status,
    sezione: t._listName,
    contesto: taskContext(t),
    stimaMin: taskEstimateMin(t),
    scadenza: t.dueDateTime?.dateTime?.slice(0, 10) || null,
    nota: noteText(t.body?.content) || null,
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

  const { tasks } = await collectTasks({ includeDone: !!opts.includiFatte });
  let sel = stato ? tasks.filter(t => t._status === stato) : tasks;
  const sezione = testo(opts.sezione);
  if (sezione) sel = sel.filter(t => (t._listName || '').toLowerCase().includes(sezione.toLowerCase()));
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
  if (attesa && stato !== 'waiting') throw new Error('La persona attesa vale solo per lo stato «waiting».');

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
  if (attesa) body = withWaitingFor(body, attesa);

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
 * @param {{ attivita?: string, stato?: string }} opts
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

  const { tasks } = await collectTasks({ includeDone: true });
  const task = findTask(tasks, query);
  if (task._status === stato) {
    return {
      data: { id: task.id, titolo: task.title, stato, invariato: true },
      text: `${tronca(task.title, 60)} era già ${STATUS_LABELS[stato]}.`,
    };
  }

  await patchTask(task._listId, task.id, { status: graphStatusFor(/** @type {any} */ (stato)) });
  return {
    data: { id: task.id, titolo: task.title, stato, precedente: task._status },
    text: `✓ ${tronca(task.title, 60)} → ${STATUS_LABELS[stato]}`,
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

/** @returns {Promise<{ data: any, text: string }>} */
export async function sezioni() {
  const [{ lists, tasks }, notebooks] = await Promise.all([collectTasks(), getNotebooks()]);
  const sezioniPerTaccuino = await Promise.all(notebooks.map(n => getSections(n.id)));

  const conteggio = /** @param {string} id */ id => tasks.filter(t => t._listId === id).length;
  const listeText = lists.map(l =>
    `${String(conteggio(l.id)).padStart(3)} aperte  ${l.displayName}` +
    (l.wellknownListName === 'defaultList' ? '  (Inbox)' : ''));
  const taccuiniText = notebooks.map((n, i) =>
    `${n.displayName}: ${(sezioniPerTaccuino[i] || []).map(s => s.displayName).join(', ') || '—'}`);

  return {
    data: {
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

  let pageId = query;
  let titolo = query;
  // Gli id OneNote contengono sempre un '!': tutto il resto è un titolo da
  // cercare dentro una sezione.
  if (!query.includes('!')) {
    const sezioneQuery = testo(opts.sezione);
    if (!sezioneQuery) throw new Error('Per cercare una pagina per titolo serve anche la sezione.');
    const sezione = await trovaSezioneOneNote(sezioneQuery);
    const pagine = await getPages(sezione.id);
    const q = query.toLowerCase();
    const found = pagine.filter(p => (p.title || '').toLowerCase().includes(q));
    if (!found.length) throw new Error(`Nessuna pagina "${query}" in ${sezione.displayName}.`);
    if (found.length > 1) throw new Error(`"${query}" corrisponde a: ${found.map(p => p.title).join(', ')}`);
    pageId = found[0].id;
    titolo = found[0].title;
  }

  const contenuto = htmlToText(await getPageContentHtml(pageId));
  return { data: { id: pageId, titolo, testo: contenuto }, text: contenuto };
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
