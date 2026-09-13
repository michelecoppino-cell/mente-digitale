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
 * «Sezione» qui vuol dire una lista di attività. Una commessa può averne
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
  elencoListe, leggiTask, leggiTaskAperti, creaTask, aggiornaTask, creaLista, spostaTask,
  loadDailyPlans, saveDailyPlans, loadIdentityDoc,
  loadObiettivi, saveObiettivi,
  loadDiaryIndex, loadDiaryMonth, saveDiaryEntry,
  loadRecap, saveRecap, getRecentEmails,
  getCalendarEvents, getCalendars, createCalendarEvent,
  getNotebooks, getSections, getPages, getPageContentHtml, htmlToText,
  createPage, appendToPage, textToHtml,
  leggiRegistroProgrammi, leggiProgramma, salvaCelleProgramma,
} from './mente-graph.mjs';

import {
  riepilogoPacchetti, caricoPersone, celleConsuntivo, oreSottoRiga, catenaVoce,
  ORE_SETTIMANA_DEFAULT,
} from '../src/programma.js';

import { settimanaIso, spostaSettimane, settimaneTra } from '../src/tempo.js';

import {
  taskStatus, inboxListId, indexScheduled, taskEstimateMin,
  taskContext, personRoleFor, taskPerson, applicaSottoattivita,
  STATUS_LABELS, TASK_STATUSES, CONTEXTS, GRANULARITY_MEMO_LINE, REGOLE_SOTTOATTIVITA_TESTO,
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

import { extractEmailCandidates } from '../src/dailyReview.js';

// Gli stati che si possono scrivere da fuori l'app. `inbox` e `scheduled` non
// ci sono: il primo è la lista in cui il task si trova, il secondo un blocco
// nel piano del giorno. Nessuno dei due è un campo che si possa impostare.
export const STATI_SCRIVIBILI = ['next', 'ask', 'waiting', 'delegated', 'someday', 'done'];
export const STATI_CREABILI = ['inbox', 'next', 'ask', 'waiting', 'delegated', 'someday'];
export const TIPI_DIARIO = Object.keys(DIARY_TYPES);
export { TASK_STATUSES, CONTEXTS, STATUS_LABELS, GRANULARITY_MEMO_LINE, REGOLE_SOTTOATTIVITA_TESTO };

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
/**
 * Le liste, con un errore parlante se non ce n'è ancora nessuna. Succede una
 * volta sola: finché l'app non è stata aperta dopo il passaggio ai file, le
 * attività stanno ancora su Microsoft To-Do e il registro non esiste. La
 * migrazione la fa l'app, che è l'unica ad avere il permesso di leggere To-Do.
 * @returns {Promise<any[]>}
 */
async function listeRegistrate() {
  const lists = await elencoListe();
  if (!lists.length) {
    throw new Error(
      'Nessuna lista di attività su OneDrive (mente-digitale/task/). ' +
      "Apri l'app una volta: la prima apertura porta le attività da Microsoft To-Do ai file."
    );
  }
  return lists;
}

async function collectTasks(opts = {}) {
  const [lists, plans] = await Promise.all([listeRegistrate(), loadDailyPlans()]);
  const scheduled = indexScheduled(plans);
  const scheduledIds = new Set(scheduled.keys());
  const inboxId = inboxListId(lists);

  const perLista = await Promise.all(
    lists.map(l => (opts.includeDone ? leggiTask(l.id) : leggiTaskAperti(l.id)))
  );
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
 * Le liste indicate da un nome, dove almeno una ci deve essere. Di solito
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
 * errore, non una scelta arbitraria: da qui si scrive sull'archivio vero.
 * @param {any[]} tasks
 * @param {string} query
 */
function findTask(tasks, query) {
  const q = query.toLowerCase();
  const perId = tasks.filter(t => String(t.id).toLowerCase().startsWith(q));
  const found = perId.length ? perId : tasks.filter(t => (t.titolo || '').toLowerCase().includes(q));
  if (!found.length) throw new Error(`Nessuna attività per "${query}".`);
  if (found.length > 1) {
    const elenco = found.slice(0, 8).map(t => `  ${shortId(t.id)}  ${tronca(t.titolo, 60)}`).join('\n');
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
  if (t.scadenza) meta.push(`scade ${t.scadenza}`);
  if (t._placement) meta.push(`${t._placement.date} ${t._placement.startTime}`);
  return `${shortId(t.id)}  ${tronca(t.titolo, 58)}  · ${meta.join(' · ')}`;
}

/** @param {any} t */
function riassuntoTask(t) {
  const consegna = listGroupKey(t._listName) ? listDeliverableLabel(t._listName) : null;
  const scadenzaConsegna = listDueDate(t._listName);
  return {
    id: t.id,
    titolo: t.titolo,
    stato: t._status,
    // `sezione` resta la commessa (o la lista, se non è annidata): è la chiave
    // con cui si filtra. La consegna è un campo a parte, con la sua scadenza.
    sezione: listGroupKey(t._listName) || t._listName,
    consegna,
    scadenzaConsegna: scadenzaConsegna ? scadenzaConsegna.toISOString().slice(0, 10) : null,
    lista: t._listName,
    contesto: taskContext(t),
    stimaMin: taskEstimateMin(t),
    scadenza: t.scadenza,
    nota: t.nota || null,
    // Chi ha in mano la cosa, per gli stati che ne prevedono una.
    persona: t.persona,
    sottoattivita: (t.sottoattivita || []).map(c => ({ testo: c.titolo, fatta: !!c.fatta })),
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
  const [{ tasks, plans }, eventi, recap] = await Promise.all([
    collectTasks(),
    getCalendarEvents(inizio, fine).catch(e => { erroreAgenda = e.message; return []; }),
    // Il recap del mattino, se stanotte è stato scritto. Sta dentro «oggi» e
    // non in uno strumento suo perché la domanda è la stessa — «come si mette
    // la giornata» — e uno strumento in più è un consenso in più da dare.
    loadRecap().catch(() => null),
  ]);

  const piano = plans[giornoStr]?.blocks || [];
  /** @type {Record<string, number>} */
  const conteggi = {};
  for (const s of TASK_STATUSES) conteggi[s] = tasks.filter(t => t._status === s).length;
  const scivolate = tasks.filter(t => t._placement && !t._placement.completed && t._placement.date < giornoStr);

  // Il recap si mostra solo se parla di questa giornata: uno di ieri, messo in
  // cima senza dirlo, si legge come se fosse di stamattina — ed è l'unico modo
  // in cui questo meccanismo può mentire.
  const etaDelRecap = etaRecap(recap);
  const recapDiOggi = recap?.data === giornoStr ? recap : null;
  const testoRecap = recapDiOggi
    ? '\n' + blocco('Recap del mattino', String(recapDiOggi.testo || '').split('\n')) +
      (etaDelRecap?.vecchio ? `\n  ⚠ scritto ${etaDelRecap.ore} ore fa` : '')
    : (recap ? `\n  ⚠ il recap più recente è del ${recap.data}: stanotte non ne è stato scritto uno.` : '');

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
    testoRecap,
  ].join('\n');

  return {
    data: {
      data: giornoStr,
      eventi,
      erroreAgenda,
      piano,
      conteggi,
      scivolate: scivolate.map(riassuntoTask),
      recap: recapDiOggi,
      etaRecap: etaDelRecap,
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
 *           scadenza?: string, contesto?: string, nota?: string, attesa?: string,
 *           sottoattivita?: string[]|string }} opts
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

  const lists = await listeRegistrate();
  const lista = sezione ? findList(lists, sezione) : lists.find(l => l.wellknownListName === 'defaultList');
  if (!lista) throw new Error('Nessuna lista Inbox: indica una sezione.');

  // Ogni cosa nel suo campo. Prima la stima diventava un marker nelle note e la
  // persona una riga da mettere per prima, nell'ordine che l'app sapeva
  // rileggere: bastava sbagliarlo per far sparire uno stato.
  // I sotto-passi alla nascita: spezzare una cosa mentre la si dice è il momento
  // in cui si sa com'è fatta, e obbligare a una seconda scrittura vuol dire che
  // quasi sempre non si fa. Gli id glieli dà `normalizzaTask` scrivendo il file.
  const sotto = applicaSottoattivita([], { aggiungi: elenco(opts.sottoattivita, ';') }).sottoattivita;

  const creato = await creaTask(lista.id, {
    titolo,
    stato: stato === 'inbox' ? 'inbox' : stato,
    persona: attesa || null,
    nota: testo(opts.nota) || '',
    stimaMin: numero(opts.stimaMin) || null,
    scadenza: scadenza || null,
    contesto: contestoRaw?.toLowerCase() || null,
    sottoattivita: sotto,
  });

  return {
    data: {
      creata: {
        id: creato.id, titolo: creato.titolo, sezione: lista.displayName, stato,
        sottoattivita: creato.sottoattivita.map(x => ({ testo: x.titolo, fatta: x.fatta })),
      },
    },
    text: `✓ creata in ${lista.displayName} come ${STATUS_LABELS[stato]}\n  ${shortId(creato.id)}  ${creato.titolo}` +
      creato.sottoattivita.map(x => `\n    · ${x.titolo}`).join(''),
  };
}

/**
 * Scrive un'attività che c'è già: lo stato nel flusso, chi ce l'ha in mano, e i
 * suoi sotto-passi. Uno strumento per cosa, non per verbo — da voce ogni
 * strumento in più è un consenso in più da dare, e «segna fatto il calcolo
 * dentro la relazione» non deve costarne due.
 *
 * Lo stato è facoltativo apposta: spuntare un sotto-passo non è cambiare stato
 * all'attività, e obbligare a ripetere quello che l'attività è già finirebbe
 * per riscriverlo per sbaglio.
 *
 * @param {{ attivita?: string, stato?: string, persona?: string,
 *           sottoAggiungi?: string[]|string, sottoFatta?: string[]|string,
 *           sottoAperta?: string[]|string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaStato(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  const stato = testo(opts.stato);
  const aggiungi = elenco(opts.sottoAggiungi, ';');
  const fatte = elenco(opts.sottoFatta, ';');
  const aperte = elenco(opts.sottoAperta, ';');
  const tocca = aggiungi.length || fatte.length || aperte.length;

  if (!stato && !tocca) {
    throw new Error(
      `Serve lo stato (${STATI_SCRIVIBILI.join(', ')}) ` +
      'o qualcosa da fare sulle sottoattività.');
  }
  if (stato && !STATI_SCRIVIBILI.includes(stato)) {
    throw new Error(
      `Da qui si passa a ${STATI_SCRIVIBILI.join(', ')}. ` +
      '«inbox» è la lista di default e «scheduled» è un blocco nel piano: si cambiano dall\'app.'
    );
  }

  const persona = testo(opts.persona);
  const ruolo = stato ? personRoleFor(stato) : null;
  if (persona && !ruolo) {
    throw new Error('La persona vale solo per gli stati «ask», «waiting» e «delegated».');
  }

  const { tasks, plans } = await collectTasks({ includeDone: true });
  const task = findTask(tasks, query);

  // Stato e persona sono due campi e si scrivono insieme. Senza un nome nuovo
  // si tiene quello che c'era — passare da «in attesa da Sara» a «delegata» non
  // deve perdere Sara.
  const chi = ruolo ? (persona || taskPerson(task)?.who || 'qualcuno') : null;
  const cambiaStato = !!stato && !(task._status === stato && (task.persona || null) === chi);

  // I sotto-passi si risolvono prima di scrivere: un pezzo di testo che ne
  // prende due è un errore, e deve fermare tutta la scrittura — non lasciare
  // l'attività spostata di stato e l'elenco a metà.
  const esito = tocca
    ? applicaSottoattivita(task.sottoattivita || [], { aggiungi, fatte, aperte })
    : null;

  if (!cambiaStato && !esito) {
    return {
      data: { id: task.id, titolo: task.titolo, stato, invariato: true },
      text: `${tronca(task.titolo, 60)} era già ${STATUS_LABELS[stato]}.`,
    };
  }

  /** @type {any} */
  const patch = {};
  if (cambiaStato) { patch.stato = stato; patch.persona = chi; }
  if (esito) patch.sottoattivita = esito.sottoattivita;
  const scritto = await aggiornaTask(task._listId, task.id, patch);

  // I blocchi che erano stati spezzati nei sotto-passi tengono una copia di
  // quelle righe: se qui ne è stata spuntata una, là dentro va spuntata anche.
  // Gli id li assegna `normalizzaTask` scrivendo il file, quindi si rilegge da
  // quello che è stato scritto e non da quello che gli si è passato.
  const sincronizzati = esito
    ? sincronizzaSottoPassi(plans, task.id, scritto?.sottoattivita || esito.sottoattivita)
    : [];
  if (sincronizzati.length) await saveDailyPlans(plans);

  const righe = [];
  if (cambiaStato) righe.push(`✓ ${tronca(task.titolo, 60)} → ${STATUS_LABELS[stato]}${chi ? ` · ${chi}` : ''}`);
  else righe.push(`  ${tronca(task.titolo, 60)}`);
  for (const t of esito?.aggiunte || []) righe.push(`  + ${t}`);
  for (const t of esito?.gia || []) righe.push(`  = ${t} (c'era già)`);
  for (const t of esito?.spuntate || []) righe.push(`  ✓ ${t}`);
  for (const t of esito?.riaperte || []) righe.push(`  · ${t} (riaperta)`);
  if (sincronizzati.length) righe.push(`  · aggiornati anche nel piano (${sincronizzati.length})`);

  return {
    data: {
      id: task.id, titolo: task.titolo,
      stato: cambiaStato ? stato : task._status,
      persona: cambiaStato ? chi : (task.persona || null),
      precedente: task._status,
      ...(esito ? {
        sottoattivita: esito.sottoattivita.map(x => ({ testo: x.titolo, fatta: x.fatta })),
        aggiunte: esito.aggiunte, gia: esito.gia, spuntate: esito.spuntate, riaperte: esito.riaperte,
      } : {}),
    },
    text: righe.join('\n'),
  };
}

/**
 * Il nome della lista in cui finisce quello che si butta. È una lista come le
 * altre — non un campo nascosto e non un file a parte — perché così il cestino
 * si apre dall'app senza aver scritto una riga di interfaccia, e quello che c'è
 * dentro si rimette a posto con gli stessi strumenti di tutti i giorni.
 */
export const NOME_CESTINO = 'Cestino';

/**
 * Un campo che si sta scrivendo: `undefined` se non è stato nominato, `''` se
 * è stato nominato vuoto — cioè «togli quello che c'era».
 *
 * `testo()` non basta qui: appiattisce i due casi su `null`, e finché nessuno
 * prova a cancellare una scadenza «non l'ho detto» e «cancellala» sembrano la
 * stessa cosa. Sono la differenza fra una modifica e una perdita di dati.
 *
 * @param {any} v
 * @returns {string|undefined}
 */
function campo(v) {
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
}

/**
 * Riscrive nei blocchi del piano quello che i blocchi si tengono per copia:
 * il titolo dell'attività e la lista da cui viene.
 *
 * Serve perché un blocco porta `taskTitle` dentro di sé, e l'app lo mostra
 * così com'è senza mai riandare a rileggere il task. Correggere un titolo
 * sbagliato senza passare di qui vorrebbe dire vederlo corretto nella vista
 * Attività e ancora sbagliato nel Piano — cioè due verità per la stessa cosa,
 * che è il difetto peggiore da cercare, perché non somiglia a un errore.
 *
 * Lavora sui piani che ha in mano chi chiama: salva lui, una volta sola.
 *
 * @param {Record<string, any>} plans
 * @param {string} taskId
 * @param {Partial<{ taskTitle: string, listId: string|null, listName: string|null }>} patch
 * @returns {{ giorno: string, blocco: any }[]} i blocchi toccati
 */
function ribattezzaBlocchi(plans, taskId, patch) {
  /** @type {{ giorno: string, blocco: any }[]} */
  const toccati = [];
  for (const [g, piano] of Object.entries(plans || {})) {
    const blocchi = piano?.blocks || [];
    if (!blocchi.some((/** @type {any} */ b) => b.taskId === taskId)) continue;
    const nuovi = blocchi.map((/** @type {any} */ b) => (b.taskId === taskId ? { ...b, ...patch } : b));
    plans[g] = { ...piano, blocks: nuovi };
    for (const b of nuovi) if (b.taskId === taskId) toccati.push({ giorno: g, blocco: b });
  }
  return toccati;
}

/**
 * Riporta nei blocchi del piano i sotto-passi come sono adesso.
 *
 * Un blocco che è stato spezzato nelle sue sottoattività ne tiene una **copia**
 * (id, titolo, spuntato), perché è quello che l'app disegna dentro il
 * rettangolo. Spuntare un passo dalle Attività senza passare di qui vuol dire
 * vederlo fatto in una vista e da fare nell'altra — la stessa classe di
 * difetto del titolo che resta indietro, e si nota ancora meno.
 *
 * Tocca solo i passi che il blocco ha già: quali righe un blocco mostri è una
 * scelta di chi l'ha spezzato, e aggiungercene di nuove da qui vorrebbe dire
 * disfarla.
 *
 * @param {Record<string, any>} plans
 * @param {string} taskId
 * @param {{ id?: string, titolo: string, fatta?: boolean }[]} sottoattivita
 * @returns {{ giorno: string, blocco: any }[]} i blocchi toccati
 */
function sincronizzaSottoPassi(plans, taskId, sottoattivita) {
  const perId = new Map(sottoattivita.filter(p => p.id).map(p => [p.id, p]));
  /** @type {{ giorno: string, blocco: any }[]} */
  const toccati = [];
  for (const [g, piano] of Object.entries(plans || {})) {
    const blocchi = piano?.blocks || [];
    let cambiato = false;
    const nuovi = blocchi.map((/** @type {any} */ b) => {
      if (b.taskId !== taskId || !(b.subSteps || []).length) return b;
      const passi = b.subSteps.map((/** @type {any} */ s) => {
        const fresco = perId.get(s.id);
        if (!fresco) return s;
        if (s.completed === !!fresco.fatta && s.title === fresco.titolo) return s;
        cambiato = true;
        return { ...s, title: fresco.titolo, completed: !!fresco.fatta };
      });
      return cambiato ? { ...b, subSteps: passi } : b;
    });
    if (!cambiato) continue;
    plans[g] = { ...piano, blocks: nuovi };
    for (const b of nuovi) if (b.taskId === taskId) toccati.push({ giorno: g, blocco: b });
  }
  return toccati;
}

/**
 * Sfila dal piano i blocchi ancora aperti di un'attività, in tutti i giorni.
 *
 * I blocchi già spuntati restano: sono lavoro fatto, e il piano di un giorno
 * passato è il registro di com'è andata, non un elenco di intenzioni da
 * ripulire. Quelli aperti invece se ne vanno, altrimenti il Piano continuerebbe
 * a dare un'ora a una cosa che nelle Attività non c'è più.
 *
 * @param {Record<string, any>} plans
 * @param {string} taskId
 * @returns {{ giorno: string, blocco: any }[]} i blocchi tolti
 */
function sfilaBlocchiAperti(plans, taskId) {
  /** @type {{ giorno: string, blocco: any }[]} */
  const tolti = [];
  for (const [g, piano] of Object.entries(plans || {})) {
    const blocchi = piano?.blocks || [];
    const via = blocchi.filter((/** @type {any} */ b) => b.taskId === taskId && !b.completed);
    if (!via.length) continue;
    for (const b of via) tolti.push({ giorno: g, blocco: b });
    plans[g] = { ...piano, blocks: blocchi.filter((/** @type {any} */ b) => !via.includes(b)) };
  }
  return tolti;
}

/**
 * Corregge la scheda di un'attività che c'è già: titolo, nota, sezione,
 * contesto, stima e scadenza.
 *
 * È l'altra metà di `attivitaStato`, che sposta nel flusso e tiene i
 * sotto-passi: due strumenti e non uno perché sono due gesti diversi — «questa
 * l'ha in mano Sara» si dice mentre si guida, «il titolo dice plinto P3 e
 * invece è il P4» si sistema da seduti. Prima l'unica strada per correggere un
 * titolo era rifare l'attività da capo, e rifarla vuol dire un id nuovo: i
 * blocchi nel piano, le sveglie e la deduplica delle scadenze citano i task per
 * id, e ne restavano tre che indicavano una cosa che non esisteva più.
 *
 * Un campo passato vuoto (`""`, o `0` per la stima) toglie quello che c'era; un
 * campo non nominato resta com'è. Cambiare sezione è uno spostamento vero
 * (`spostaTask`), che l'id se lo tiene.
 *
 * @param {{ attivita?: string, titolo?: string, nota?: string, sezione?: string,
 *           contesto?: string, stimaMin?: number|string, scadenza?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaModifica(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");

  // Tutti i controlli che non hanno bisogno della rete stanno prima della
  // prima chiamata: un contesto inventato deve fallire subito, non a metà
  // scrittura e non dopo due secondi di Graph.
  const titolo = campo(opts.titolo);
  if (titolo === '') throw new Error("Il titolo non si può svuotare: un'attività senza titolo non si ritrova più.");

  const nota = campo(opts.nota);

  const contesto = campo(opts.contesto)?.toLowerCase();
  if (contesto && !CONTEXTS.some(c => c.key === contesto)) {
    throw new Error(`Contesto sconosciuto: ${contesto} (${CONTEXTS.map(c => c.key).join(', ')})`);
  }

  const scadenza = campo(opts.scadenza);
  if (scadenza && !/^\d{4}-\d{2}-\d{2}$/.test(scadenza)) {
    throw new Error(`Scadenza in formato sbagliato: ${scadenza} (serve YYYY-MM-DD; "" la toglie)`);
  }

  /** @type {number|null|undefined} */
  let stima;
  if (opts.stimaMin !== undefined && opts.stimaMin !== null && opts.stimaMin !== '') {
    const n = numero(opts.stimaMin);
    if (n === null) throw new Error(`Stima non valida: ${opts.stimaMin} (minuti, 0 la toglie)`);
    stima = n > 0 ? Math.round(n) : null;
  }

  const sezione = testo(opts.sezione);

  if (titolo === undefined && nota === undefined && contesto === undefined
    && scadenza === undefined && stima === undefined && !sezione) {
    throw new Error('Niente da cambiare: dì almeno uno fra titolo, nota, sezione, contesto, stima e scadenza.');
  }

  const { lists, tasks, plans } = await collectTasks({ includeDone: true });
  const task = findTask(tasks, query);
  const destinazione = sezione ? findList(lists, sezione) : null;

  /** @type {any} */
  const patch = {};
  /** @type {string[]} */
  const cambi = [];
  if (titolo !== undefined && titolo !== task.titolo) {
    patch.titolo = titolo;
    cambi.push(`titolo: «${tronca(task.titolo, 40)}» → «${tronca(titolo, 40)}»`);
  }
  if (nota !== undefined && nota !== (task.nota || '')) {
    patch.nota = nota;
    cambi.push(nota ? `nota: ${tronca(nota, 50)}` : 'nota tolta');
  }
  if (contesto !== undefined && (contesto || null) !== (taskContext(task) || null)) {
    patch.contesto = contesto || null;
    cambi.push(contesto ? `contesto: ${contesto}` : 'contesto tolto');
  }
  if (scadenza !== undefined && (scadenza || null) !== (task.scadenza || null)) {
    patch.scadenza = scadenza || null;
    cambi.push(scadenza ? `scadenza: ${scadenza}` : 'scadenza tolta');
  }
  if (stima !== undefined && stima !== (task.stimaMin ?? null)) {
    patch.stimaMin = stima;
    cambi.push(stima ? `stima: ${stima} minuti` : 'stima tolta');
  }
  const sposta = destinazione && destinazione.id !== task._listId;
  if (sposta) cambi.push(`sezione: ${task._listName} → ${destinazione.displayName}`);

  if (!cambi.length) {
    return {
      data: { id: task.id, titolo: task.titolo, invariata: true },
      text: `${tronca(task.titolo, 60)}: era già così.`,
    };
  }

  // Prima lo spostamento, poi la patch: `spostaTask` copia il task com'è e lo
  // toglie dall'origine, quindi una patch scritta prima verrebbe portata dietro
  // — ma se lo spostamento fallisse a metà resterebbe scritta nella lista
  // sbagliata. Scrivendo dopo, e nella lista d'arrivo, quello che si legge è
  // sempre l'ultimo passo riuscito.
  const listaFinale = sposta ? /** @type {any} */ (destinazione) : { id: task._listId, displayName: task._listName };
  if (sposta) await spostaTask(task._listId, listaFinale.id, task.id);
  if (Object.keys(patch).length) await aggiornaTask(listaFinale.id, task.id, patch);

  // Il piano tiene una copia del titolo e della lista: se cambiano qui,
  // cambiano anche lì, o le due viste raccontano due cose diverse.
  const daRibattezzare = {
    ...(patch.titolo ? { taskTitle: patch.titolo } : {}),
    ...(sposta ? { listId: listaFinale.id, listName: listaFinale.displayName } : {}),
  };
  const blocchi = Object.keys(daRibattezzare).length
    ? ribattezzaBlocchi(plans, task.id, daRibattezzare)
    : [];
  if (blocchi.length) await saveDailyPlans(plans);

  const righe = [`✓ ${tronca(patch.titolo || task.titolo, 60)}`, ...cambi.map(c => `  · ${c}`)];
  if (blocchi.length) {
    righe.push(`  · aggiornat${blocchi.length === 1 ? 'o' : 'i'} ${blocchi.length} blocc${blocchi.length === 1 ? 'o' : 'hi'} nel piano`);
  }

  return {
    data: {
      id: task.id,
      titolo: patch.titolo || task.titolo,
      sezione: listaFinale.displayName,
      cambi,
      blocchiAggiornati: blocchi.map(b => ({ giorno: b.giorno, ora: b.blocco.startTime })),
    },
    text: righe.join('\n'),
  };
}

/**
 * Butta via un'attività: la sposta nel Cestino e la mette fra le «un giorno»,
 * cioè fuori dalle prossime azioni e fuori dal conto delle completate.
 *
 * È l'eccezione dichiarata alla regola «da fuori non si cancella niente», e la
 * regola resta in piedi perché **niente sparisce**: l'attività è in una lista
 * che si apre dall'app, con il suo id, la sua nota e i suoi sotto-passi. Prima
 * l'unico modo di togliersi davanti una cosa che non andava fatta era
 * spuntarla, e lo storico delle completate — che è come si racconta un mese —
 * si riempiva di cose mai fatte.
 *
 * Vuole `conferma: true` scritto a parte: è l'unico strumento che porta via
 * qualcosa dalla vista, e un argomento in più è quello che separa «cancella la
 * prova» detto per sbaglio dal volerlo davvero.
 *
 * Per rimetterla dov'era: `attivita_modifica --sezione «…»` e poi
 * `attivita_stato`. Lo stato che aveva lo dice la risposta qui sotto.
 *
 * @param {{ attivita?: string, conferma?: boolean }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function attivitaElimina(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  if (opts.conferma !== true) {
    throw new Error(
      'Serve la conferma: ripeti la richiesta con conferma: true. ' +
      `L'attività non viene cancellata — va nella lista «${NOME_CESTINO}», da dove si può rimettere a posto.`
    );
  }

  const { lists, tasks, plans } = await collectTasks({ includeDone: true });
  const task = findTask(tasks, query);

  const gia = lists.find(l => (l.displayName || '').toLowerCase() === NOME_CESTINO.toLowerCase());
  if (gia && task._listId === gia.id) {
    throw new Error(`«${tronca(task.titolo, 50)}» è già nel ${NOME_CESTINO}.`);
  }
  // La lista nasce alla prima cosa buttata: crearla all'avvio vorrebbe dire un
  // Cestino vuoto in mezzo alle sezioni di chi non butta mai niente.
  const cestino = gia || await creaLista(NOME_CESTINO);

  const statoPrima = task._status;
  await spostaTask(task._listId, cestino.id, task.id);
  // `someday` e non lo stato di prima: nel Cestino una cosa non è una prossima
  // azione, non è un'attesa e non è fatta. È l'unico stato che vuol dire «non
  // adesso» senza dire nient'altro, e toglie anche il completatoIl a chi era
  // stato spuntato per farlo sparire.
  await aggiornaTask(cestino.id, task.id, { stato: 'someday' });

  const tolti = sfilaBlocchiAperti(plans, task.id);
  if (tolti.length) await saveDailyPlans(plans);

  const righe = [
    `✓ nel ${NOME_CESTINO}: ${tronca(task.titolo, 55)}`,
    `  era ${STATUS_LABELS[statoPrima]} in ${task._listName}`,
  ];
  for (const t of tolti) righe.push(`  · tolto dal piano del ${t.giorno}, ${t.blocco.startTime}`);
  righe.push(`  per rimetterla: attivita_modifica «${shortId(task.id)}» con sezione «${task._listName}»`);

  return {
    data: {
      id: task.id,
      titolo: task.titolo,
      da: { lista: task._listName, stato: statoPrima },
      cestino: cestino.displayName,
      blocchiTolti: tolti.map(t => ({ giorno: t.giorno, ora: t.blocco.startTime })),
    },
    text: righe.join('\n'),
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

// ── Il recap del mattino, e la posta ─────────────────────────────────────────
// Alle cinque un Claude Code non interattivo, sul PC che resta acceso, guarda
// calendario, posta e attività e scrive due paragrafi qui dentro. Al risveglio
// la domanda è una sola — «leggimi il recap» — e la risposta è già pronta:
// niente da aspettare mentre si fa colazione, e nessuna chiamata a pagamento,
// perché quel Claude gira sull'abbonamento.
//
// Il perché sta in `docs/recap-mattina.md`. Qui ci sono le due metà che
// riguardano i dati: chi lo scrive e chi lo rilegge.

/** Oltre queste ore un recap non è più «di stamattina» e lo si dice. */
const ORE_RECAP_VECCHIO = 18;

/**
 * Quanti anni ha il recap. È la stessa regola dello specchio del calendario di
 * lavoro (`etaSpecchio`): un dato che arriva da un PC che può essere spento
 * deve dichiarare quanto è vecchio, perché un recap fermo a ieri non si
 * distingue da uno giusto — un recap mancante si nota, uno stantio no.
 *
 * @param {any} doc
 * @param {Date} [adesso]
 * @returns {{ ore: number, vecchio: boolean, quando: string }|null}
 */
export function etaRecap(doc, adesso = new Date()) {
  const quando = typeof doc?.scrittoIl === 'string' ? doc.scrittoIl : null;
  if (!quando) return null;
  const ore = Math.max(0, Math.round((adesso.getTime() - new Date(quando).getTime()) / 3_600_000));
  return { ore, vecchio: ore >= ORE_RECAP_VECCHIO, quando };
}

/**
 * Scrive il recap del mattino, sostituendo quello di ieri.
 *
 * **Sostituisce, non aggiunge**: il recap è di stamattina o non è niente, e
 * tenerne la cronologia vorrebbe dire un file che cresce per sempre con dentro
 * quarantasei giornate che nessuno rileggerà. Quello che merita di restare si
 * scrive nel diario, che è il posto delle cose che si rileggono.
 *
 * @param {{ testo?: string, data?: string, titolo?: string, fonti?: string[]|string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function recapScrivi(opts = {}) {
  const testoRecap = testo(opts.testo);
  if (!testoRecap) throw new Error('Niente da scrivere: serve il testo del recap.');

  const giorno = testo(opts.data) || dateKey();
  if (!GIORNO_RE.test(giorno)) throw new Error(`Giorno in formato sbagliato: ${giorno} (serve YYYY-MM-DD)`);

  const doc = {
    version: 1,
    data: giorno,
    scrittoIl: new Date().toISOString(),
    titolo: testo(opts.titolo) || `Recap del ${giorno}`,
    testo: testoRecap,
    // Da cosa è stato ricavato: serve a leggere un recap vecchio sapendo cosa
    // ci mancava. «Niente dalla posta» e «la posta non l'ho guardata» sono due
    // giornate diverse.
    fonti: elenco(opts.fonti, ','),
  };
  await saveRecap(doc);

  return {
    data: { recap: doc, sostituito: true },
    text: `✓ recap del ${giorno} scritto (${testoRecap.length} caratteri)` +
      (doc.fonti.length ? `, da ${doc.fonti.join(', ')}` : ''),
  };
}

/**
 * Rilegge il recap, con quanti anni ha.
 * @param {{ data?: string }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function recapLeggi(opts = {}) {
  const doc = await loadRecap();
  if (!doc?.testo) {
    return {
      data: { recap: null },
      text: 'Nessun recap: stanotte non è stato scritto. ' +
        'Lo scrive il compito delle cinque sul PC di lavoro — vedi docs/recap-mattina.md.',
    };
  }
  const eta = etaRecap(doc);
  const giorno = testo(opts.data);
  const avviso = eta?.vecchio
    ? `⚠ recap di ${doc.data}, scritto ${eta.ore} ore fa: il PC che lo scrive potrebbe essere stato spento.`
    : '';
  if (giorno && doc.data !== giorno) {
    return {
      data: { recap: doc, eta, chiesto: giorno },
      text: `Il recap più recente è del ${doc.data}, non del ${giorno}. Non se ne tiene la cronologia.\n\n` +
        [avviso, doc.testo].filter(Boolean).join('\n\n'),
    };
  }
  return {
    data: { recap: doc, eta },
    text: [avviso, doc.titolo, '', doc.testo].filter(Boolean).join('\n'),
  };
}

/**
 * Le email che sembrano chiedere qualcosa, negli ultimi giorni.
 *
 * Le proposte le tira fuori `src/dailyReview.js`, lo stesso modulo della
 * campanella dell'app: i flussi di servizio che si ripetono, le newsletter e i
 * fili già visti restano fuori di lì, non di qui. Una regola su «cosa chiede
 * qualcosa» si cambia in un posto solo, o la campanella e il recap del mattino
 * finiscono per raccontare due caselle diverse.
 *
 * Sola lettura, e non solo per scelta: il token ha `Mail.Read` e basta.
 *
 * @param {{ giorni?: number, massimo?: number }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function posta(opts = {}) {
  const giorni = Math.max(1, numero(opts.giorni, 1) ?? 1);
  const massimo = Math.max(1, numero(opts.massimo, 6) ?? 6);

  const email = await getRecentEmails(giorni);
  const proposte = extractEmailCandidates(email, massimo);
  const nonLette = email.filter((/** @type {any} */ e) => !e.isRead).length;

  const righe = proposte.map((/** @type {any} */ p) =>
    `${tronca(p.title, 55)}\n     da ${p.mittente || p.meta} · ${p.motivi.join(', ')}`);

  return {
    data: { giorni, arrivate: email.length, nonLette, proposte },
    text: blocco(
      `Posta degli ultimi ${giorni === 1 ? 'giorno' : `${giorni} giorni`}: ` +
      `${email.length} arrivate, ${nonLette} non lette`,
      righe,
    ),
  };
}

// ── Sezioni, OneNote, documenti identitari ───────────────────────────────────

/**
 * Le liste raccolte per commessa: quelle annidate
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
    text: [blocco('Sezioni (liste di attività)', listeText), '', blocco('Taccuini OneNote', taccuiniText)].join('\n'),
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
 * Mette un blocco nel piano di un giorno, **nei piani che ha in mano chi
 * chiama**: chi ha chiamato salva.
 *
 * Sta qui, e non dentro `pianoAggiungi`, perché spostare è togliere e rimettere
 * — e togliere prima e rimettere poi, con due salvataggi, vuol dire che un
 * conflitto d'orario nel mezzo lascia il blocco tolto e basta. Con i due pezzi
 * in memoria lo spostamento è una scrittura sola: o si sposta, o non è successo
 * niente.
 *
 * Due blocchi che si accavallano sono un errore e non una sovrapposizione da
 * disegnare: il piano dice quando si fa una cosa, e due cose alla stessa ora
 * vuol dire che non lo dice. L'app, dove si trascina e si vede la griglia, può
 * permetterselo; da qui, dove si scrive alla cieca, no.
 *
 * @param {Record<string, any>} plans
 * @param {string} giorno
 * @param {{ id: string, titolo: string, listId?: string|null, listName?: string|null }} task
 * @param {string} inizio  'HH:MM'
 * @param {number} durata  minuti
 * @param {{ id?: string, titolo: string, fatta?: boolean }[]} [sottoPassi]
 *   i sotto-passi da portare dentro il blocco, già scelti da chi chiama
 * @returns {any} il blocco messo
 */
function mettiBlocco(plans, giorno, task, inizio, durata, sottoPassi = []) {
  const inizioMin = minuti(inizio);
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
      `«${tronca(task.titolo, 50)}» è già nel piano del ${giorno} alle ${gia.startTime}. ` +
      'Toglila prima, se va spostata.'
    );
  }

  const blocco = {
    id: nuovoIdBlocco(),
    taskId: task.id,
    taskTitle: task.titolo,
    listId: task.listId ?? null,
    listName: task.listName ?? null,
    // Il colore lo assegna l'app dalla mappa delle sezioni, che qui non c'è:
    // lasciarlo null la fa ricadere sul suo default invece di scrivere un
    // colore inventato che poi resterebbe.
    projectKey: null,
    projectColor: null,
    startTime: ora(inizioMin),
    endTime: ora(fineMin),
    completed: false,
    completedAt: null,
    // I sotto-passi dentro il blocco sono la stessa forma che scrive l'app dal
    // modale «Sottoattività» (`applyBreakdown` in PlannerView): id uguale a
    // quello del task, `title` e `completed`. Uguale apposta — sono la stessa
    // riga vista da due schermate, e due forme diverse vorrebbero dire che una
    // delle due schermate non la sa leggere.
    subSteps: sottoPassi.map(p => ({ id: p.id, title: p.titolo, completed: !!p.fatta })),
    // Le righe orizzontali che dividono il blocco in parti uguali: senza,
    // i sotto-passi ci sono ma il blocco non li mostra.
    subSplits: sottoPassi.length > 1
      ? Array.from({ length: sottoPassi.length - 1 }, (_, k) => (k + 1) / sottoPassi.length)
      : [],
  };

  plans[giorno] = { ...piano, date: giorno, blocks: [...blocchi, blocco].sort((a, b) => a.startTime.localeCompare(b.startTime)) };
  return blocco;
}

/**
 * I blocchi che somigliano a quello che si è chiesto: in un giorno, o in tutti.
 * Cercare dappertutto è quello che permette di dire «sposta la relazione a
 * domani alle nove» senza dover ricordare in che giorno stava.
 * @param {Record<string, any>} plans
 * @param {string} query
 * @param {string|null} [giorno]
 * @returns {{ giorno: string, blocco: any }[]}
 */
function trovaBlocchi(plans, query, giorno = null) {
  const q = query.toLowerCase();
  /** @type {{ giorno: string, blocco: any }[]} */
  const esiti = [];
  for (const [g, piano] of Object.entries(plans || {})) {
    if (giorno && g !== giorno) continue;
    for (const b of piano?.blocks || []) {
      if (String(b.taskId).toLowerCase().startsWith(q) || (b.taskTitle || '').toLowerCase().includes(q)) {
        esiti.push({ giorno: g, blocco: b });
      }
    }
  }
  return esiti;
}

/**
 * Toglie dal piano l'unico blocco che somiglia alla richiesta, in memoria.
 * @param {Record<string, any>} plans
 * @param {string} query
 * @param {string|null} giorno  null per cercarlo in tutti i giorni
 * @returns {{ giorno: string, blocco: any }}
 */
function togliBlocco(plans, query, giorno) {
  const trovati = trovaBlocchi(plans, query, giorno);
  const dove = giorno ? `nel piano del ${giorno}` : 'in nessun piano';
  if (!trovati.length) throw new Error(`Niente che somigli a "${query}" ${dove}.`);
  if (trovati.length > 1) {
    throw new Error(`"${query}" corrisponde a ${trovati.length} blocchi: ` +
      trovati.map(t => `${t.giorno} ${t.blocco.startTime} ${tronca(t.blocco.taskTitle, 40)}`).join(', '));
  }
  const via = trovati[0];
  const piano = plans[via.giorno];
  plans[via.giorno] = { ...piano, blocks: (piano.blocks || []).filter(b => b.id !== via.blocco.id) };
  return via;
}

/**
 * Mette un'attività nel piano di un giorno, a un'ora.
 *
 * Con `sottoPassi` il blocco si porta dentro i sotto-passi ancora aperti
 * dell'attività, come fa il modale «Sottoattività» del Piano: sono la scaletta
 * dell'ora che si sta per passare, e averla dentro il blocco vuol dire poterla
 * spuntare da lì. Facoltativo e non automatico, per la stessa ragione per cui
 * nell'app è un gesto: un blocco di mezz'ora con dentro sette righe non si
 * legge più.
 *
 * @param {{ attivita?: string, data?: string, ora?: string, durataMin?: number,
 *           sottoPassi?: boolean }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoAggiungi(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");
  const inizio = testo(opts.ora);
  if (!inizio) throw new Error("Serve l'ora di inizio, HH:MM.");

  const giorno = giornoValido(testo(opts.data) || dateKey());

  const { tasks, plans } = await collectTasks();
  const task = findTask(tasks, query);

  // La durata: quella chiesta, altrimenti la stima dell'attività — che è la
  // stessa cosa che fa l'app quando si trascina un task sulla griglia.
  const durata = numero(opts.durataMin) ?? taskEstimateMin(task);
  // Solo quelli aperti: portarsi dentro il blocco una riga già spuntata vuol
  // dire rifare un pezzo di strada che si era già fatto.
  const sotto = opts.sottoPassi
    ? (task.sottoattivita || []).filter((/** @type {any} */ p) => !p.fatta)
    : [];
  const blocco = mettiBlocco(
    plans, giorno,
    { id: task.id, titolo: task.titolo, listId: task._listId, listName: task._listName },
    inizio, durata, sotto,
  );
  await saveDailyPlans(plans);

  return {
    data: { giorno, blocco },
    text: `✓ ${giorno} ${blocco.startTime}–${blocco.endTime}  ${tronca(task.titolo, 55)}` +
      sotto.map((/** @type {any} */ p) => `\n    · ${tronca(p.titolo, 50)}`).join(''),
  };
}

/**
 * Sposta un blocco: altro giorno, altra ora, o tutti e due. Una scrittura sola,
 * e la durata resta quella che aveva se non se ne chiede un'altra — chi sposta
 * una cosa non sta anche decidendo che duri di meno.
 *
 * Il blocco si cerca in tutti i giorni quando non si dice da dove: è la forma
 * in cui la richiesta arriva parlando («sposta la relazione a domani alle
 * nove»), dove il giorno di partenza è proprio la cosa che non si ricorda.
 *
 * @param {{ attivita?: string, ora?: string, data?: string, daData?: string, durataMin?: number }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoSposta(opts = {}) {
  const query = testo(opts.attivita);
  if (!query) throw new Error("Serve l'attività: un pezzo del suo id o del suo titolo.");

  const daGiorno = testo(opts.daData) ? giornoValido(String(testo(opts.daData))) : null;
  const plans = await loadDailyPlans();
  const { giorno: eraIl, blocco: via } = togliBlocco(plans, query, daGiorno);

  const giorno = giornoValido(testo(opts.data) || eraIl);
  const inizio = testo(opts.ora) || via.startTime;
  const durata = numero(opts.durataMin) ?? (minuti(via.endTime) - minuti(via.startTime));

  const blocco = mettiBlocco(
    plans, giorno,
    { id: via.taskId, titolo: via.taskTitle, listId: via.listId, listName: via.listName },
    inizio, durata,
  );
  // Quello che c'era attaccato al blocco lo si porta dietro: i sotto-passi
  // spuntati sono lavoro fatto, e uno spostamento non è un ricominciare.
  blocco.subSteps = via.subSteps || [];
  blocco.subSplits = via.subSplits || [];
  blocco.completed = !!via.completed;
  blocco.completedAt = via.completedAt ?? null;
  await saveDailyPlans(plans);

  return {
    data: { giorno, eraIl, blocco },
    text: `✓ ${tronca(via.taskTitle, 45)}: da ${eraIl} ${via.startTime} ` +
      `a ${giorno} ${blocco.startTime}–${blocco.endTime}`,
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
  const { blocco: via } = togliBlocco(plans, query, giorno);
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
 * `arco` dice quale dei due si vuole quando il mese non si nomina: senza di
 * lui «mese» si potrebbe chiedere solo scrivendone il numero, e chi parla dice
 * «questo mese».
 * @param {{ data?: string, mese?: string, arco?: string }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoArco(opts = {}) {
  const mese = testo(opts.mese)
    || (opts.arco === 'mese' ? meseDi(testo(opts.data) || dateKey()) : null);
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

/**
 * Gli intervalli occupati di un giorno, in minuti dalla mezzanotte, uniti e in
 * ordine. Ci finiscono i blocchi del piano e gli eventi del calendario: sono
 * due cose diverse — uno dice quando farò una cosa, l'altro un'ora che riguarda
 * anche altri — ma per chi cerca un buco valgono uguale.
 *
 * Gli eventi di giornata intera restano fuori: «ferie» o «compleanno» non
 * occupano le nove del mattino, e trattarli come tali svuoterebbe il giorno.
 *
 * @param {any[]} blocchi
 * @param {any[]} eventi
 * @returns {{ da: number, a: number, cosa: string }[]}
 */
function occupatoDelGiorno(blocchi, eventi) {
  /** @type {{ da: number, a: number, cosa: string }[]} */
  const pezzi = [];
  for (const b of blocchi) {
    pezzi.push({ da: minuti(b.startTime), a: minuti(b.endTime), cosa: b.taskTitle || 'a piano' });
  }
  for (const e of eventi) {
    if (e.isAllDay) continue;
    const da = String(e.start?.dateTime || '').slice(11, 16);
    const a = String(e.end?.dateTime || '').slice(11, 16);
    if (!ORA_RE.test(da) || !ORA_RE.test(a)) continue;
    pezzi.push({ da: minuti(da), a: minuti(a), cosa: e.subject || 'evento' });
  }
  return pezzi.sort((x, y) => x.da - y.da);
}

/**
 * I buchi dentro una finestra, tolto quello che è già occupato.
 * @param {number} da
 * @param {number} a
 * @param {{ da: number, a: number }[]} occupato
 * @returns {{ da: number, a: number }[]}
 */
function buchi(da, a, occupato) {
  /** @type {{ da: number, a: number }[]} */
  const liberi = [];
  let cursore = da;
  for (const o of occupato) {
    if (o.a <= cursore) continue;
    if (o.da >= a) break;
    if (o.da > cursore) liberi.push({ da: cursore, a: Math.min(o.da, a) });
    cursore = Math.max(cursore, o.a);
    if (cursore >= a) break;
  }
  if (cursore < a) liberi.push({ da: cursore, a });
  return liberi;
}

/**
 * Una bozza di giornata: prende le prossime azioni e le incastra nei buchi di
 * una finestra oraria, in ordine di urgenza, usando la stima che ogni attività
 * porta già con sé.
 *
 * **Non scrive niente**, ed è la cosa che conta di questo strumento. Una
 * giornata composta da una macchina è una proposta: si guarda, si sposta una
 * riga, se ne toglie un'altra. Scriverla di slancio vorrebbe dire otto blocchi
 * da disfare uno per uno quando due non convincono — e disfare costa più che
 * comporre. Quello che passa si mette a piano con `piano_scrivi`, una riga per
 * volta, che è anche l'occasione per cambiare l'ora prima di scriverla.
 *
 * L'ordine è la scadenza: prima quella dell'attività, poi — se non ce l'ha —
 * quella della consegna in cui sta, perché una consegna che scade è una
 * scadenza per tutto quello che contiene. A pari scadenza vale l'ordine che le
 * attività hanno nella loro lista, che è quello deciso trascinandole.
 *
 * Chi non entra viene detto, non scartato in silenzio: «non ci sta» è
 * un'informazione sulla giornata, e una giornata che non contiene quello che
 * deve contenere è esattamente la cosa che si vuole vedere alle nove.
 *
 * @param {{ data?: string, dalle?: string, alle?: string, sezione?: string,
 *           contesto?: string, pausaMin?: number, massimo?: number }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function pianoAuto(opts = {}) {
  const giorno = giornoValido(testo(opts.data) || dateKey());
  const dalle = testo(opts.dalle) || '09:00';
  const alle = testo(opts.alle) || '18:00';
  const da = minuti(dalle);
  const a = minuti(alle);
  if (a <= da) throw new Error(`La finestra ${dalle}–${alle} è vuota: la fine viene prima dell'inizio.`);

  const pausa = Math.max(0, numero(opts.pausaMin, 0) ?? 0);
  const massimo = Math.max(0, numero(opts.massimo, 0) ?? 0);   // 0: quante ce ne stanno
  const contesto = testo(opts.contesto)?.toLowerCase();
  if (contesto && !CONTEXTS.some(c => c.key === contesto)) {
    throw new Error(`Contesto sconosciuto: ${contesto} (${CONTEXTS.map(c => c.key).join(', ')})`);
  }

  // Il calendario qui non è un di più che si può perdere: una bozza che non
  // vede le riunioni propone di lavorare dentro una riunione, e chi la legge
  // non ha modo di accorgersene. Meglio nessuna bozza che una sbagliata.
  const [{ lists, tasks, plans }, eventi] = await Promise.all([
    collectTasks(),
    getCalendarEvents(new Date(`${giorno}T00:00:00`), new Date(`${giorno}T23:59:59`))
      .catch(e => {
        throw new Error(
          `Calendario non raggiungibile (${e.message}): senza non si sa quali ore sono già impegnate, ` +
          'e una bozza che scavalca le riunioni è peggio di nessuna bozza.'
        );
      }),
  ]);

  const occupato = occupatoDelGiorno(plans[giorno]?.blocks || [], eventi);
  const liberi = buchi(da, a, occupato);

  let candidati = tasks.filter(t => t._status === 'next');
  const sezione = testo(opts.sezione);
  if (sezione) {
    const ids = new Set(matchLists(lists, sezione).map(l => l.id));
    candidati = candidati.filter(t => ids.has(t._listId));
  }
  if (contesto) candidati = candidati.filter(t => taskContext(t) === contesto);

  /** La scadenza che pesa su un'attività: la sua, o quella della consegna. */
  const scadenzaDi = /** @param {any} t */ t => {
    if (t.scadenza) return t.scadenza;
    const consegna = listDueDate(t._listName);
    return consegna ? consegna.toISOString().slice(0, 10) : null;
  };
  candidati = [...candidati].sort((x, y) => {
    const sx = scadenzaDi(x) || '9999-12-31';
    const sy = scadenzaDi(y) || '9999-12-31';
    if (sx !== sy) return sx < sy ? -1 : 1;
    const ox = Number.isFinite(x.ordine) ? x.ordine : Number.MAX_SAFE_INTEGER;
    const oy = Number.isFinite(y.ordine) ? y.ordine : Number.MAX_SAFE_INTEGER;
    if (ox !== oy) return ox - oy;
    return String(x.creatoIl || '').localeCompare(String(y.creatoIl || ''));
  });

  /** @type {any[]} */
  const bozza = [];
  const presi = new Set();
  for (const buco of liberi) {
    let cursore = buco.da;
    // Dentro un buco si scende in ordine e si prende la prima che ci sta: la
    // prima che *non* ci sta non ferma il giro, perché mezz'ora libera dopo una
    // riunione è mezz'ora, e lasciarla vuota per rispetto dell'ordine non
    // aiuta nessuno.
    for (const t of candidati) {
      if (presi.has(t.id)) continue;
      if (massimo && bozza.length >= massimo) break;
      const durata = taskEstimateMin(t);
      const inizio = cursore + (cursore > buco.da ? pausa : 0);
      if (inizio + durata > buco.a) continue;
      presi.add(t.id);
      cursore = inizio + durata;
      bozza.push({
        id: t.id,
        titolo: t.titolo,
        data: giorno,
        ora: ora(inizio),
        fine: ora(inizio + durata),
        durataMin: durata,
        stimata: t.stimaMin !== null && t.stimaMin !== undefined,
        sezione: listGroupKey(t._listName) || t._listName,
        lista: t._listName,
        contesto: taskContext(t),
        scadenza: scadenzaDi(t),
        // I sotto-passi ancora aperti: sono quello che si guarda per decidere
        // se il blocco basta o se la cosa va spezzata su due giorni.
        sottoattivitaAperte: (t.sottoattivita || []).filter((/** @type {any} */ s) => !s.fatta).map((/** @type {any} */ s) => s.titolo),
      });
    }
    if (massimo && bozza.length >= massimo) break;
  }

  const fuori = candidati.filter(t => !presi.has(t.id));
  const minutiLiberi = liberi.reduce((n, b) => n + (b.a - b.da), 0);
  const minutiPresi = bozza.reduce((n, b) => n + b.durataMin, 0);
  const durata = /** @param {number} m */ m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

  const righe = bozza.map(b => {
    const meta = [listLabel(b.lista)];
    if (b.scadenza) meta.push(`scade ${b.scadenza}`);
    if (!b.stimata) meta.push('stima di default');
    const capo = `${b.ora}–${b.fine}  ${tronca(b.titolo, 45)}  · ${meta.join(' · ')}`;
    return [capo, ...b.sottoattivitaAperte.map((/** @type {string} */ s) => `     · ${tronca(s, 50)}`)].join('\n  ');
  });

  const coda = [
    '',
    `Bozza: ${bozza.length} attività, ${durata(minutiPresi)} dentro ${durata(minutiLiberi)} liberi ` +
    `fra le ${dalle} e le ${alle}.`,
    'Niente è stato scritto. Per metterne una a piano: piano_scrivi con la sua ora.',
  ];
  if (fuori.length) {
    coda.push(`Restano fuori ${fuori.length}: ` + fuori.slice(0, 5).map(t => tronca(t.titolo, 35)).join(', ') +
      (fuori.length > 5 ? '…' : ''));
  }

  return {
    data: {
      data: giorno,
      finestra: { dalle, alle },
      occupato: occupato.map(o => ({ dalle: ora(o.da), alle: ora(o.a), cosa: o.cosa })),
      liberi: liberi.map(b => ({ dalle: ora(b.da), alle: ora(b.a), minuti: b.a - b.da })),
      bozza,
      fuori: fuori.map(riassuntoTask),
      minutiLiberi,
      minutiPianificati: minutiPresi,
      scritto: false,
    },
    text: blocco(`Bozza per ${fmtGiorno.format(new Date(`${giorno}T12:00:00`))}`, righe) + '\n' + coda.join('\n'),
  };
}

// ── Programma di commessa ────────────────────────────────────────────────────
// Il piano del giorno dice quando si fa una cosa; il Programma dice quante ore
// una commessa vale, in quante si divide e chi le fa in che settimana. Da qui
// se ne guarda il quadro e si scrivono le ore di una persona — il resto (voci
// nuove, scomposizioni, attivazioni) resta nell'app, dove c'è la matrice: sono
// le cose che si fanno guardando venti colonne insieme, non dettandole.
//
// Le regole dei conti stanno in `src/programma.js`, le stesse su cui gira la
// matrice: qui non se ne riscrive nessuna.

const SETTIMANA_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** @param {string} nome @param {string} query */
const somiglia = (nome, query) => String(nome).toLowerCase().includes(query.toLowerCase());

/**
 * L'unico programma che somiglia a quello che si è chiesto. Un nome che ne
 * pesca due è un errore e non una scelta da fare al posto di chi chiede:
 * scrivere ore sulla commessa sbagliata non si vede finché non si guarda il
 * margine, settimane dopo.
 * @param {any[]} programmi
 * @param {string} query
 */
function programmaUno(programmi, query) {
  const trovati = programmi.filter(p => String(p.id).toLowerCase().startsWith(query.toLowerCase()) || somiglia(p.nome, query));
  if (!trovati.length) {
    throw new Error(`Nessuna commessa somiglia a "${query}". Ci sono: ${programmi.map(p => p.nome).join(', ')}`);
  }
  if (trovati.length > 1) {
    throw new Error(`"${query}" corrisponde a ${trovati.length} commesse: ${trovati.map(p => p.nome).join(', ')}`);
  }
  return trovati[0];
}

/** Il registro, con un errore parlante quando non c'è ancora niente. */
async function registroProgrammi() {
  const { programmi } = await leggiRegistroProgrammi();
  if (!programmi.length) {
    throw new Error(
      'Nessun programma di commessa su OneDrive (mente-digitale/programmi/). ' +
      "Il primo si crea dall'app, nella scheda Programma."
    );
  }
  return programmi;
}

/**
 * La settimana di cui si parla: quella detta, quella che contiene un giorno, o
 * questa.
 * @param {{ settimana?: string, data?: string }} opts
 */
function settimanaChiesta(opts) {
  const detta = testo(opts.settimana);
  if (detta) {
    if (!SETTIMANA_RE.test(detta)) throw new Error(`Settimana in formato sbagliato: ${detta} (serve YYYY-Www)`);
    return detta;
  }
  const giorno = testo(opts.data);
  return giorno ? settimanaIso(giornoValido(giorno)) : settimanaIso();
}

/** Le persone che un programma nomina: in anagrafica o proposte su una voce. */
function nomiDelProgramma(doc) {
  const nomi = doc.risorse.map(r => r.nome);
  for (const v of doc.voci) for (const n of v.risorse) if (!nomi.includes(n)) nomi.push(n);
  return nomi;
}

/** @param {any} doc @param {string} query */
function risorsaUna(doc, query) {
  const nomi = nomiDelProgramma(doc);
  const trovati = nomi.filter(n => somiglia(n, query));
  if (!trovati.length) throw new Error(`Nessuno che somigli a "${query}" in questa commessa. Ci sono: ${nomi.join(', ') || '—'}`);
  if (trovati.length > 1) throw new Error(`"${query}" corrisponde a ${trovati.length} persone: ${trovati.join(', ')}`);
  return trovati[0];
}

/** @param {any} doc @param {string} query */
function pacchettoUno(doc, query) {
  const trovati = doc.pacchetti.filter(p => somiglia(p.nome, query) || String(p.id).toLowerCase().startsWith(query.toLowerCase()));
  if (!trovati.length) {
    throw new Error(`Nessun pacchetto somiglia a "${query}". Ci sono: ${doc.pacchetti.map(p => p.nome).join(', ') || '—'}`);
  }
  if (trovati.length > 1) throw new Error(`"${query}" corrisponde a ${trovati.length} pacchetti: ${trovati.map(p => p.nome).join(', ')}`);
  return trovati[0];
}

/** @param {any} doc @param {string} pacchettoId @param {string} query */
function voceUna(doc, pacchettoId, query) {
  const trovate = doc.voci.filter(v => !v.scartata && somiglia(v.titolo, query));
  if (!trovate.length) throw new Error(`Nessuna voce somiglia a "${query}".`);
  if (trovate.length > 1) throw new Error(`"${query}" corrisponde a ${trovate.length} voci: ${trovate.map(v => v.titolo).join(', ')}`);
  const voce = trovate[0];
  // Il pacchetto di una voce è quello della sua radice: una sotto-voce non lo
  // porta scritto addosso, e scrivere le ore in un pacchetto che non è il suo
  // le metterebbe in una riga che nella matrice non esiste.
  const radice = catenaVoce(doc, voce.id)[0];
  if (radice?.pacchettoId !== pacchettoId) {
    throw new Error(`La voce «${voce.titolo}» non è di questo pacchetto.`);
  }
  return voce;
}

/** Le ore come si dicono: interi dove sono interi. @param {number} n */
const oreDette = n => (Math.round(n * 10) / 10).toString().replace('.', ',');

/**
 * Il quadro del Programma: le commesse accese, oppure una sola, oppure il
 * carico di una persona. Sola lettura.
 *
 * La finestra parte da questa settimana e va avanti: del passato il Programma
 * dice già lo speso nella testata, e la domanda che si fa da fuori — «come
 * siamo messi», «chi è pieno» — guarda avanti.
 *
 * @param {{ commessa?: string, persona?: string, settimane?: number }} [opts]
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function programma(opts = {}) {
  const quante = Math.min(Math.max(numero(opts.settimane, 6) || 6, 1), 26);
  const settimanaOra = settimanaIso();
  const finestra = settimaneTra(settimanaOra, spostaSettimane(settimanaOra, quante - 1));
  const persona = testo(opts.persona);
  const query = testo(opts.commessa);

  const programmi = await registroProgrammi();
  const scelte = query ? [programmaUno(programmi, query)] : programmi.filter(p => p.attivo);
  if (!scelte.length) {
    throw new Error('Nessuna commessa accesa. Dimmi quale guardare, o accendile dall\'app.');
  }

  const docs = await Promise.all(scelte.map(async voce => ({
    id: voce.id, nome: voce.nome, doc: await leggiProgramma(voce.id),
  })));

  // Le persone senza ore nella finestra restano fuori: un elenco di righe a
  // zero non è una risposta. A meno che sia proprio quella la domanda.
  const righe = caricoPersone(docs, finestra)
    .filter(r => (persona ? somiglia(r.nome, persona) : r.totale > 0));
  if (persona && !righe.length) {
    throw new Error(`Nessuno che somigli a "${persona}" in ${scelte.length > 1 ? 'queste commesse' : 'questa commessa'}.`);
  }

  const commesse = docs.map(({ id, nome, doc }) => {
    const { righe: pacchetti, totale } = riepilogoPacchetti(doc, { settimanaOra });
    return { id, nome, totale, pacchetti };
  });

  const rigaPersona = (/** @type {any} */ r) => {
    const capacita = r.capacita || ORE_SETTIMANA_DEFAULT;
    const celle = finestra.map(w => (r.ore[w] ? oreDette(r.ore[w]) : '—')).join(' ');
    const oltre = r.sovrapposte.length ? `  ⚠ oltre le ${capacita} in ${r.sovrapposte.join(', ')}` : '';
    return `${r.nome.padEnd(10)} ${celle}${oltre}`;
  };

  const testata = commesse.map(c => {
    const t = c.totale;
    return `${tronca(c.nome, 44)}  vendute ${oreDette(t.vendute)} · stimate ${oreDette(t.stimate)} · ` +
      `spese ${oreDette(t.speso)} · in calendario ${oreDette(t.programmate)} · margine ${oreDette(t.margine)}`;
  });

  const testo_ = [
    // Chiedendo di una persona la testata delle commesse è rumore: la domanda
    // era «quante ore ha», non «come stanno le commesse».
    persona && !query ? '' : blocco(scelte.length > 1 ? 'Commesse accese' : 'Commessa', testata) + '\n',
    // I pacchetti solo quando la commessa è una: con tre commesse aperte
    // sarebbero trenta righe, e la domanda era un'altra.
    commesse.length === 1
      ? blocco('Pacchetti', commesse[0].pacchetti.map(r =>
        `${tronca(r.nome, 24).padEnd(24)} stimate ${oreDette(r.stimate).padStart(6)} · ` +
        `a piano ${oreDette(r.aPiano).padStart(6)} · da collocare ${oreDette(r.daCollocare).padStart(6)}`)) + '\n'
      : '',
    blocco(`Persone, da ${finestra[0]} (${finestra.length} settimane: ${finestra.join(' ')})`,
      righe.map(rigaPersona)),
  ].filter(Boolean).join('\n');

  return {
    data: {
      settimane: finestra,
      commesse,
      persone: righe.map(r => ({
        nome: r.nome, capacita: r.capacita, ore: r.ore, totale: r.totale, sovrapposte: r.sovrapposte,
      })),
    },
    text: testo_,
  };
}

/**
 * Le ore di una persona su un pacchetto in una settimana.
 *
 * **Sostituisce, non somma**: è la stessa regola del consuntivo, e vale anche
 * scrivendo da qui. Il numero che si dà è quanto quella persona ha lì quella
 * settimana — se si sommasse, ripetere la stessa frase due volte raddoppierebbe
 * la settimana, ed è una cosa che si scopre dal margine sbagliato tre settimane
 * dopo. Zero toglie la cella.
 *
 * Dove finiscono davvero le ore lo decide `celleConsuntivo`, cioè la stessa
 * regola della matrice: se sotto quella riga c'è una voce sola, ci vanno lì.
 *
 * @param {{ commessa?: string, persona?: string, pacchetto?: string, voce?: string,
 *           settimana?: string, data?: string, ore?: number }} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
export async function programmaOre(opts = {}) {
  const commessa = testo(opts.commessa);
  if (!commessa) throw new Error('Serve la commessa: un pezzo del nome.');
  const chi = testo(opts.persona);
  if (!chi) throw new Error('Serve la persona.');
  const quale = testo(opts.pacchetto);
  if (!quale) throw new Error('Serve il pacchetto.');
  const ore = numero(opts.ore);
  if (ore === null || ore < 0) throw new Error('Servono le ore, un numero da zero in su.');

  const settimana = settimanaChiesta(opts);
  const registrata = programmaUno(await registroProgrammi(), commessa);
  const doc = await leggiProgramma(registrata.id);

  const risorsa = risorsaUna(doc, chi);
  const pacchetto = pacchettoUno(doc, quale);
  const voce = testo(opts.voce) ? voceUna(doc, pacchetto.id, String(testo(opts.voce))) : null;

  const prima = oreSottoRiga(doc, risorsa, pacchetto.id, voce?.id || null, settimana);
  const celle = celleConsuntivo(doc, risorsa, pacchetto.id, settimana, ore, voce?.id || null);
  await salvaCelleProgramma(registrata.id, celle);

  const dove = `${risorsa} · ${pacchetto.nome}${voce ? ` · ${voce.titolo}` : ''} · ${settimana}`;
  return {
    data: {
      commessa: registrata.nome, risorsa, pacchettoId: pacchetto.id, voceId: voce?.id || null,
      settimana, ore, prima, celle,
    },
    text: `✓ ${dove}: ${oreDette(ore)} ore` + (prima !== ore ? ` (prima ${oreDette(prima)})` : ''),
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
 * Una lista nuova. Due modi, e sono lo stesso: o si passa il nome per
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

  const lists = await elencoListe();
  const gia = lists.find(l => (l.displayName || '').toLowerCase() === nome.toLowerCase());
  if (gia) throw new Error(`Esiste già una lista che si chiama «${gia.displayName}».`);

  const creata = await creaLista(nome);
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
