/**
 * mente.mjs
 * La mente digitale da riga di comando: legge (e in due punti scrive) gli
 * stessi dati dell'app, direttamente su Microsoft Graph.
 *
 * Serve a due cose che l'app non può fare: guardare i propri dati senza aprire
 * il browser, e — soprattutto — permettere a un assistente come Claude, che
 * gira in un terminale, di leggere il diario, il piano e le attività e di
 * scriverci dentro, invece di ricevere tutto per copia-incolla.
 *
 * La scrittura è deliberatamente ristretta: si può aggiungere una voce di
 * diario e creare o far avanzare un'attività. Calendario, OneNote, Bussola e
 * piani si leggono soltanto — sono le cose che, se sbagliate, non si
 * ricostruiscono guardando la cronologia.
 *
 *   node scripts/mente.mjs aiuto
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

// ── Argomenti ────────────────────────────────────────────────────────────────

/**
 * `--chiave valore`, `--chiave=valore`, `--flag`. Il resto è posizionale.
 * @param {string[]} argv
 * @returns {{ opts: Record<string, string|true>, args: string[] }}
 */
function parseArgv(argv) {
  /** @type {Record<string, string|true>} */
  const opts = {};
  /** @type {string[]} */
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; }
    else opts[key] = true;
  }
  return { opts, args };
}

/** @param {string|true|undefined} v @param {number} [fallback] @returns {number|null} */
function num(v, fallback = null) {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** @param {string|true|undefined} v @returns {string|null} */
function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

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
  if (!found.length) throw new Error(`Nessuna sezione che somigli a "${query}". Vedi: node scripts/mente.mjs sezioni`);
  if (found.length > 1) {
    throw new Error(`"${query}" corrisponde a più sezioni: ${found.map(l => l.displayName).join(', ')}`);
  }
  return found[0];
}

/**
 * Trova un'attività da un pezzo di id o da un pezzo di titolo. Ambiguo è un
 * errore, non una scelta arbitraria: la riga di comando scrive su To-Do vero.
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
  const parti = [`${shortId(t.id)}  ${tronca(t.title, 58)}`];
  const meta = [];
  if (t._listName) meta.push(t._listName);
  const ctx = taskContext(t);
  if (ctx) meta.push(CONTEXTS.find(c => c.key === ctx)?.label || ctx);
  meta.push(`${taskEstimateMin(t)}m`);
  if (t.dueDateTime?.dateTime) meta.push(`scade ${String(t.dueDateTime.dateTime).slice(0, 10)}`);
  if (t._placement) meta.push(`${t._placement.date} ${t._placement.startTime}`);
  return `${parti[0]}  · ${meta.join(' · ')}`;
}

// ── Comandi ──────────────────────────────────────────────────────────────────
// Ogni comando restituisce { data, text }: `data` è quello che esce con --json
// (pensato per essere letto da un altro programma, o da un'AI), `text` è la
// resa leggibile.

/** @param {Record<string, string|true>} opts */
async function cmdOggi(opts) {
  const oggi = str(opts.data) || dateKey();
  const giorno = new Date(`${oggi}T12:00:00`);
  const inizio = new Date(`${oggi}T00:00:00`);
  const fine = new Date(`${oggi}T23:59:59`);

  const [{ tasks, plans }, eventi] = await Promise.all([
    collectTasks(),
    getCalendarEvents(inizio, fine).catch(() => []),
  ]);

  const piano = plans[oggi]?.blocks || [];
  const conteggi = {};
  for (const s of TASK_STATUSES) conteggi[s] = tasks.filter(t => t._status === s).length;
  const scivolate = tasks.filter(t => t._placement && !t._placement.completed && t._placement.date < oggi);

  const text = [
    fmtGiorno.format(giorno),
    '',
    blocco('Agenda', eventi.map(e => `${eventTime(e)}  ${tronca(e.subject, 60)}`)),
    '',
    blocco('Piano', piano.map(b =>
      `${b.startTime}–${b.endTime}  ${b.completed ? '✓' : '·'} ${tronca(b.taskTitle, 55)}`)),
    '',
    blocco('Attività', TASK_STATUSES.filter(s => s !== 'done' && conteggi[s])
      .map(s => `${String(conteggi[s]).padStart(3)}  ${STATUS_LABELS[s]}`)),
    scivolate.length ? `\n  ⚠ ${scivolate.length} programmate in giorni passati e mai chiuse` : '',
  ].join('\n');

  return { data: { data: oggi, eventi, piano, conteggi, scivolate: scivolate.map(t => t.title) }, text };
}

/** @param {Record<string, string|true>} opts */
async function cmdAgenda(opts) {
  const giorni = num(opts.giorni, 7) || 7;
  const inizio = new Date(`${str(opts.data) || dateKey()}T00:00:00`);
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

/** @param {Record<string, string|true>} opts */
async function cmdPiano(opts) {
  const data = str(opts.data) || dateKey();
  const plans = await loadDailyPlans();
  const blocks = plans[data]?.blocks || [];

  const righe = blocks.map(b => {
    const capo = `${b.startTime}–${b.endTime}  ${b.completed ? '✓' : '·'} ${tronca(b.taskTitle, 55)}`;
    const sotto = (b.subSteps || []).map(s => `     ${s.done ? '✓' : '·'} ${tronca(s.text || s.title || '', 50)}`);
    return [capo, ...sotto].join('\n  ');
  });

  return {
    data: { data, blocks },
    text: blocco(`Piano di ${fmtGiorno.format(new Date(`${data}T12:00:00`))}`, righe),
  };
}

/** @param {string[]} args @param {Record<string, string|true>} opts */
async function cmdAttivita(args, opts) {
  const sub = args[0] || 'lista';

  if (sub === 'lista') {
    const stato = str(opts.stato);
    if (stato && !TASK_STATUSES.includes(stato)) {
      throw new Error(`Stato sconosciuto: ${stato} (${TASK_STATUSES.join(', ')})`);
    }

    const { tasks } = await collectTasks({ includeDone: !!opts.tutte });
    let sel = stato ? tasks.filter(t => t._status === stato) : tasks;
    const sezione = str(opts.sezione);
    if (sezione) sel = sel.filter(t => (t._listName || '').toLowerCase().includes(sezione.toLowerCase()));
    const contesto = str(opts.contesto);
    if (contesto) sel = sel.filter(t => taskContext(t) === contesto.toLowerCase());

    const text = TASK_STATUSES
      .filter(s => sel.some(t => t._status === s))
      .map(s => blocco(STATUS_LABELS[s], sel.filter(t => t._status === s).map(taskLine)))
      .join('\n\n') || 'Nessuna attività con questi filtri.';

    return { data: { totale: sel.length, attivita: sel.map(riassuntoTask) }, text };
  }

  if (sub === 'crea') {
    const titolo = args.slice(1).join(' ').trim() || str(opts.titolo);
    if (!titolo) throw new Error('Serve un titolo: attivita crea "Chiamare il commercialista"');

    // Tutti i controlli che non hanno bisogno della rete stanno prima della
    // prima chiamata: un'opzione scritta male deve fallire subito, non dopo
    // due secondi di Graph.
    const sezione = str(opts.sezione);
    const stato = str(opts.stato) || (sezione ? 'next' : 'inbox');
    if (!['inbox', 'next', 'waiting', 'someday'].includes(stato)) {
      throw new Error("Da qui si crea in inbox, next, waiting o someday (scheduled si ottiene mettendo l'attività nel piano, done spuntandola).");
    }
    if (stato !== 'inbox' && !sezione) {
      throw new Error("Fuori da Inbox un'attività ha bisogno di una sezione: aggiungi --sezione.");
    }

    const attesa = str(opts.attesa);
    if (attesa && stato !== 'waiting') throw new Error('--attesa vale solo con --stato waiting.');

    const contestoRaw = str(opts.contesto);
    if (contestoRaw && !CONTEXTS.some(c => c.key === contestoRaw.toLowerCase())) {
      throw new Error(`Contesto sconosciuto: ${contestoRaw} (${CONTEXTS.map(c => c.key).join(', ')})`);
    }

    const lists = await getTodoLists();
    const lista = sezione ? findList(lists, sezione) : lists.find(l => l.wellknownListName === 'defaultList');
    if (!lista) throw new Error('Nessuna lista di default su To-Do: indica una sezione con --sezione.');

    // Le note si compongono nell'ordine che l'app sa rileggere: il marker della
    // stima può stare ovunque, la riga dell'attesa deve restare la prima.
    let body = str(opts.nota) || '';
    const stima = num(opts.stima);
    if (stima) body = withEstimateMarker(body, stima);
    if (attesa) body = withWaitingFor(body, attesa);

    const contesto = contestoRaw?.toLowerCase() || null;

    const creato = await createTask(lista.id, {
      title: titolo,
      body: body || undefined,
      status: graphStatusFor(/** @type {any} */ (stato)),
      dueDate: str(opts.scadenza) || undefined,
      categories: contesto ? withContext({ categories: [] }, contesto) : undefined,
    });

    return {
      data: { creata: { id: creato.id, title: creato.title, lista: lista.displayName, stato } },
      text: `✓ creata in ${lista.displayName} come ${STATUS_LABELS[stato]}\n  ${shortId(creato.id)}  ${creato.title}`,
    };
  }

  if (sub === 'stato' || sub === 'completa') {
    const query = args[1];
    if (!query) throw new Error(`Serve un'attività: attivita ${sub} <id o pezzo di titolo>` + (sub === 'stato' ? ' <stato>' : ''));
    const stato = sub === 'completa' ? 'done' : args[2];
    if (!stato) throw new Error(`Serve lo stato: ${TASK_STATUSES.join(', ')}`);
    if (!['next', 'waiting', 'someday', 'done'].includes(stato)) {
      throw new Error(
        'Da qui si passa a next, waiting, someday o done. ' +
        'inbox è la lista di default e scheduled è un blocco nel piano: si cambiano dall\'app.'
      );
    }

    const { tasks } = await collectTasks({ includeDone: true });
    const task = findTask(tasks, query);
    await patchTask(task._listId, task.id, { status: graphStatusFor(/** @type {any} */ (stato)) });

    return {
      data: { id: task.id, title: task.title, stato },
      text: `✓ ${tronca(task.title, 60)} → ${STATUS_LABELS[stato]}`,
    };
  }

  throw new Error(`attivita: sottocomando sconosciuto "${sub}" (lista, crea, stato, completa)`);
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

/** @param {string[]} args @param {Record<string, string|true>} opts */
async function cmdDiario(args, opts) {
  const sub = args[0] || 'leggi';

  if (sub === 'leggi') {
    const mese = str(opts.mese);
    const giorni = num(opts.giorni, mese ? null : 14);

    const idx = await loadDiaryIndex();
    /** @type {string[]} */
    let mesi;
    if (mese) {
      mesi = [mese];
    } else {
      // I mesi toccati dalla finestra richiesta, presi dall'indice: chiedere a
      // OneDrive un mese in cui non si è scritto costa una richiesta a vuoto.
      const da = new Date();
      da.setDate(da.getDate() - (giorni - 1));
      const primo = monthKey(da);
      mesi = idx.months.filter(m => m >= primo);
      if (!mesi.length) mesi = [monthKey()];
    }

    const voci = (await Promise.all(mesi.map(loadDiaryMonth))).flat();
    let sel = filterEntries(voci, {
      query: str(opts.cerca) || '',
      tag: str(opts.tag),
      includeSealed: !!opts.cassetto,
    });
    if (!mese && giorni) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (giorni - 1));
      const soglia = dateKey(cutoff);
      sel = sel.filter(e => e.date >= soglia);
    }

    const text = sel.length ? sel.map(vociText).join('\n\n') : 'Nessuna voce nel periodo.';
    return { data: { mesi, voci: sel }, text };
  }

  if (sub === 'scrivi') {
    const testo = str(opts.testo) || args.slice(1).join(' ').trim() || await leggiStdin();
    if (!testo) throw new Error('Niente da scrivere: passa --testo "…" oppure il testo su stdin.');

    const tipo = str(opts.tipo) || 'libero';
    if (!DIARY_TYPES[tipo]) throw new Error(`Tipo sconosciuto: ${tipo} (${Object.keys(DIARY_TYPES).join(', ')})`);

    const entry = makeEntry({
      text: testo,
      type: /** @type {any} */ (tipo),
      date: str(opts.data) || undefined,
      tags: str(opts.tag) ? String(opts.tag).split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : undefined,
      mood: num(opts.umore),
      energy: num(opts.energia),
      gratitude: str(opts.gratitudine) ? String(opts.gratitudine).split('|').map(g => g.trim()) : [],
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

  throw new Error(`diario: sottocomando sconosciuto "${sub}" (leggi, scrivi)`);
}

/** @param {any} e @returns {string} */
function vociText(e) {
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

/** @returns {Promise<string>} */
async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function cmdSezioni() {
  const [{ lists, tasks }, notebooks] = await Promise.all([collectTasks(), getNotebooks()]);
  const sezioniPerTaccuino = await Promise.all(notebooks.map(n => getSections(n.id)));

  const listeText = lists.map(l => {
    const aperte = tasks.filter(t => t._listId === l.id).length;
    return `${String(aperte).padStart(3)} aperte  ${l.displayName}${l.wellknownListName === 'defaultList' ? '  (Inbox)' : ''}`;
  });
  const noteText_ = notebooks.map((n, i) =>
    `${n.displayName}: ${(sezioniPerTaccuino[i] || []).map(s => s.displayName).join(', ') || '—'}`);

  return {
    data: {
      liste: lists.map(l => ({ id: l.id, nome: l.displayName, aperte: tasks.filter(t => t._listId === l.id).length })),
      taccuini: notebooks.map((n, i) => ({
        nome: n.displayName,
        sezioni: (sezioniPerTaccuino[i] || []).map(s => ({ id: s.id, nome: s.displayName })),
      })),
    },
    text: [blocco('Sezioni (liste To-Do)', listeText), '', blocco('Taccuini OneNote', noteText_)].join('\n'),
  };
}

/** @param {string[]} args @param {Record<string, string|true>} opts */
async function cmdNote(args, opts) {
  const sub = args[0];

  /** Tutte le sezioni di tutti i taccuini, con il nome del taccuino accanto. */
  async function tutteLeSezioni() {
    const notebooks = await getNotebooks();
    const perTaccuino = await Promise.all(notebooks.map(n => getSections(n.id)));
    return perTaccuino.flatMap((sezioni, i) =>
      sezioni.map(s => ({ ...s, _notebook: notebooks[i].displayName })));
  }

  /** @param {string} query */
  async function trovaSezione(query) {
    const sezioni = await tutteLeSezioni();
    const q = query.toLowerCase();
    const esatte = sezioni.filter(s => (s.displayName || '').toLowerCase() === q);
    const found = esatte.length ? esatte : sezioni.filter(s => (s.displayName || '').toLowerCase().includes(q));
    if (!found.length) throw new Error(`Nessuna sezione OneNote per "${query}".`);
    if (found.length > 1) throw new Error(`"${query}" corrisponde a: ${found.map(s => `${s._notebook}/${s.displayName}`).join(', ')}`);
    return found[0];
  }

  if (sub === 'pagine') {
    const query = args.slice(1).join(' ').trim();
    if (!query) throw new Error('Serve una sezione: note pagine "Casa"');
    const sezione = await trovaSezione(query);
    const pagine = await getPages(sezione.id);
    return {
      data: { sezione: sezione.displayName, pagine: pagine.map(p => ({ id: p.id, titolo: p.title, modificata: p.lastModifiedDateTime })) },
      text: blocco(`${sezione._notebook} / ${sezione.displayName}`,
        pagine.map(p => `${String(p.lastModifiedDateTime || '').slice(0, 10)}  ${tronca(p.title, 60)}\n    ${p.id}`)),
    };
  }

  if (sub === 'leggi') {
    const query = args.slice(1).join(' ').trim();
    if (!query) throw new Error('Serve una pagina: note leggi <id> oppure note leggi "titolo" --sezione Casa');

    let pageId = query;
    let titolo = query;
    // Gli id OneNote contengono sempre un '!': tutto il resto è un titolo da
    // cercare dentro una sezione.
    if (!query.includes('!')) {
      const sezioneQuery = str(opts.sezione);
      if (!sezioneQuery) throw new Error('Per cercare una pagina per titolo serve --sezione.');
      const sezione = await trovaSezione(sezioneQuery);
      const pagine = await getPages(sezione.id);
      const q = query.toLowerCase();
      const found = pagine.filter(p => (p.title || '').toLowerCase().includes(q));
      if (!found.length) throw new Error(`Nessuna pagina "${query}" in ${sezione.displayName}.`);
      if (found.length > 1) throw new Error(`"${query}" corrisponde a: ${found.map(p => p.title).join(', ')}`);
      pageId = found[0].id;
      titolo = found[0].title;
    }

    const testo = htmlToText(await getPageContentHtml(pageId));
    return { data: { id: pageId, titolo, testo }, text: testo };
  }

  throw new Error(`note: sottocomando sconosciuto "${sub || ''}" (pagine, leggi)`);
}

/** @param {'bussola'|'visione'} tipo */
async function cmdIdentita(tipo) {
  const doc = await loadIdentityDoc(tipo);
  if (!doc) return { data: null, text: `Nessun documento "${tipo}" su OneDrive.` };
  const sezioni = doc.sections || [];
  return {
    data: doc,
    text: sezioni.map(s => `── ${s.title} ──\n${s.content || ''}`.trim()).join('\n\n'),
  };
}

const AIUTO = `mente.mjs — la mente digitale da riga di comando

  node scripts/mente.mjs <comando> [opzioni]

Lettura
  oggi [--data YYYY-MM-DD]        agenda, piano e conteggi del giorno
  agenda [--giorni N]             eventi del calendario (default 7 giorni)
  piano [--data YYYY-MM-DD]       i blocchi del piano di un giorno
  sezioni                         liste To-Do (con quante attività aperte) e sezioni OneNote
  note pagine <sezione>           le pagine OneNote di una sezione
  note leggi <id | titolo --sezione X>
  bussola | visione               i documenti identitari

  attivita lista [--stato s] [--sezione s] [--contesto c] [--tutte]
  diario leggi [--mese YYYY-MM | --giorni N] [--cerca t] [--tag t] [--cassetto]

Scrittura
  attivita crea "titolo" [--sezione s] [--stato inbox|next|waiting|someday]
                         [--stima 45] [--scadenza YYYY-MM-DD]
                         [--contesto lavoro|personale|famiglia] [--nota "…"] [--attesa "Nome"]
  attivita stato <id|titolo> <next|waiting|someday|done>
  attivita completa <id|titolo>
  diario scrivi [--testo "…"] [--tipo libero|svuota-testa|sera] [--data YYYY-MM-DD]
                [--tag a,b] [--umore 1-5] [--energia 1-5] [--gratitudine "a|b"] [--cassetto]
                (senza --testo legge da stdin)

Globali
  --json                          esce in JSON invece che in testo

Calendario, OneNote, Bussola e piani si leggono soltanto: da qui non si
scrivono, per non poter rovinare quello che non si ricostruisce da solo.

Autenticazione: refresh token in scripts/.mente-refresh-token o in
MENTE_REFRESH_TOKEN. Per ottenerlo: node scripts/get-refresh-token.mjs --mente
`;

// ── Dispatch ─────────────────────────────────────────────────────────────────

async function main() {
  const { opts, args } = parseArgv(process.argv.slice(2));
  const comando = args[0];
  const resto = args.slice(1);

  if (!comando || comando === 'aiuto' || opts.aiuto || opts.help) {
    process.stdout.write(AIUTO);
    return;
  }

  /** @type {{ data: any, text: string }} */
  let esito;
  switch (comando) {
    case 'oggi':     esito = await cmdOggi(opts); break;
    case 'agenda':   esito = await cmdAgenda(opts); break;
    case 'piano':    esito = await cmdPiano(opts); break;
    case 'attivita': esito = await cmdAttivita(resto, opts); break;
    case 'diario':   esito = await cmdDiario(resto, opts); break;
    case 'sezioni':  esito = await cmdSezioni(); break;
    case 'note':     esito = await cmdNote(resto, opts); break;
    case 'bussola':  esito = await cmdIdentita('bussola'); break;
    case 'visione':  esito = await cmdIdentita('visione'); break;
    default:
      throw new Error(`Comando sconosciuto: ${comando}\n\n${AIUTO}`);
  }

  process.stdout.write(opts.json ? JSON.stringify(esito.data, null, 2) + '\n' : esito.text + '\n');
}

main().catch(e => {
  console.error('Errore: ' + e.message);
  process.exit(1);
});
