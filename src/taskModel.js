// @ts-check
// Il flusso GTD di un'attività, letto e scritto sui campi veri di Microsoft
// To-Do invece che su una copia locale.
//
// L'app non ha un database: i task vivono su Graph, e chi li apre dall'app
// To-Do del telefono deve vedere lo stesso stato. Quindi il flusso si appoggia
// ai campi nativi ovunque ce ne sia uno, e scende a un marker nelle note solo
// per la stima di durata, che in To-Do non ha un campo:
//
//   inbox      lista di default di To-Do (wellknownListName === 'defaultList')
//   next       status 'notStarted'
//   waiting    status 'waitingOnOthers'
//   someday    status 'deferred'
//   done       status 'completed'
//   scheduled  ha un blocco nel piano del giorno (daily-plans su OneDrive)
//
//   context     categories        (Lavoro / Personale / Famiglia)
//   sectionId   id della lista To-Do — una lista è una sezione PARA
//   subtasks    checklistItems
//   note        body.content
//   completedAt completedDateTime
//   estimateMin marker [MIN:n] nelle note      ← l'unico campo senza casa nativa
//
// Invariante: un task ha uno e un solo stato. La colonna in cui appare è
// derivata da qui, mai un'etichetta salvata a parte.

/** @typedef {'inbox'|'next'|'waiting'|'scheduled'|'someday'|'done'} TaskStatus */

/** Gli stati nell'ordine delle colonne della vista Attività. */
export const TASK_STATUSES = /** @type {TaskStatus[]} */ ([
  'inbox', 'next', 'waiting', 'scheduled', 'someday', 'done',
]);

export const STATUS_LABELS = {
  inbox:     'Inbox',
  next:      'Prossime azioni',
  waiting:   'In attesa',
  scheduled: 'Programmate',
  someday:   'Un giorno',
  done:      'Fatte',
};

/** Stato Graph corrispondente a ciascuno stato del flusso. */
const GRAPH_STATUS = {
  inbox:     'notStarted',
  next:      'notStarted',
  waiting:   'waitingOnOthers',
  scheduled: 'notStarted',
  someday:   'deferred',
  done:      'completed',
};

/**
 * Il valore da mandare a Graph per portare il task in questo stato.
 * `inbox` e `scheduled` non hanno un `status` proprio: il primo dipende dalla
 * lista in cui sta il task, il secondo dall'esistenza di un blocco nel piano.
 * @param {TaskStatus} status
 * @returns {string}
 */
export function graphStatusFor(status) {
  return GRAPH_STATUS[status] || 'notStarted';
}

export const CONTEXTS = [
  { key: 'lavoro',     label: 'Lavoro',     category: 'Lavoro',     color: 'var(--ctx-lavoro)' },
  { key: 'personale',  label: 'Personale',  category: 'Personale',  color: 'var(--ctx-personale)' },
  { key: 'famiglia',   label: 'Famiglia',   category: 'Famiglia',   color: 'var(--ctx-famiglia)' },
];

export const DEFAULT_ESTIMATE_MIN = 30;

/** Le durate offerte come chip nel serbatoio del Piano. */
export const ESTIMATE_CHOICES = [
  { min: 30,  label: '30m' },
  { min: 45,  label: '45m' },
  { min: 60,  label: '1h' },
  { min: 120, label: '2h' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stima di durata — marker [MIN:n] in testa alle note
// ─────────────────────────────────────────────────────────────────────────────

const MIN_MARKER_RE = /\[MIN:(\d{1,4})\]/;

// La matrice di Eisenhower non c'è più: avere insieme il flusso e i quadranti
// voleva dire due modi di dire la stessa cosa. Il marker però è ancora scritto
// nelle note dei task creati prima, su To-Do, e nessuno lo toglierà per noi:
// resta qui solo per non farlo comparire in mezzo al testo di una nota.
const LEGACY_EIS_MARKER_RE = /\[EIS:Q[1-4]\]/;

/**
 * @param {string|null|undefined} bodyContent
 * @returns {number|null}
 */
export function parseEstimate(bodyContent) {
  const m = (bodyContent || '').match(MIN_MARKER_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Inserisce o sostituisce il marker, preservando il resto delle note.
 * @param {string|null|undefined} bodyContent
 * @param {number} minutes
 * @returns {string}
 */
export function withEstimateMarker(bodyContent, minutes) {
  const rest = (bodyContent || '').replace(MIN_MARKER_RE, '').replace(/^[ \t]+/, '');
  const marker = `[MIN:${Math.max(1, Math.round(minutes))}]`;
  return rest ? `${marker} ${rest}` : marker;
}

/**
 * @param {import('./types').TodoTask} task
 * @returns {number}
 */
export function taskEstimateMin(task) {
  return parseEstimate(task?.body?.content) ?? DEFAULT_ESTIMATE_MIN;
}

// ─────────────────────────────────────────────────────────────────────────────
// In attesa di qualcuno
// ─────────────────────────────────────────────────────────────────────────────

// To-Do non ha un campo "assegnato a" sulle liste personali. Il nome della
// persona finisce quindi nella prima riga delle note, ma scritto per esteso e
// non come marker: chi apre il task da To-Do legge una frase, non un codice.
const WAITING_RE = /^\s*In attesa da:\s*(.+?)\s*$/im;

/**
 * @param {import('./types').TodoTask} task
 * @returns {{ who: string, since: string|null }|null}
 */
export function parseWaitingFor(task) {
  const m = (task?.body?.content || '').match(WAITING_RE);
  if (!m) return null;
  return { who: m[1], since: task?.lastModifiedDateTime || task?.createdDateTime || null };
}

/**
 * @param {string|null|undefined} bodyContent
 * @param {string|null} who
 * @returns {string}
 */
export function withWaitingFor(bodyContent, who) {
  const rest = (bodyContent || '').replace(WAITING_RE, '').replace(/^\n+/, '');
  if (!who) return rest;
  return rest ? `In attesa da: ${who}\n${rest}` : `In attesa da: ${who}`;
}

/**
 * Giorni interi trascorsi dall'inizio dell'attesa.
 * @param {string|null|undefined} sinceIso
 * @returns {number|null}
 */
export function waitingDays(sinceIso) {
  if (!sinceIso) return null;
  const t = new Date(sinceIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// Dopo quanti giorni un'attesa va sollecitata. Sette: una settimana è il tempo
// oltre il quale «te lo ricordi?» smette di essere insistenza e diventa il tuo
// lavoro. Prima questo numero non esisteva — i giorni si contavano e nessuno
// interveniva, quindi a quaranta giorni la riga era identica a quella di ieri,
// solo con un numero più alto.
export const WAITING_NUDGE_DAYS = 7;

/**
 * Un'attesa da sollecitare.
 * @param {import('./types').TodoTask} task
 * @returns {boolean}
 */
export function isWaitingStale(task) {
  const w = parseWaitingFor(task);
  if (!w) return false;
  const days = waitingDays(w.since);
  return days !== null && days >= WAITING_NUDGE_DAYS;
}

/**
 * Il link per sollecitare: una mail già scritta, da completare col destinatario.
 *
 * Il nome della persona sta nelle note come testo libero («In attesa da: Marco»),
 * non è un indirizzo — quindi il destinatario resta a chi manda, e qui si
 * risparmia solo la parte noiosa: l'oggetto e le prime righe.
 *
 * @param {import('./types').TodoTask} task
 * @returns {string|null}
 */
export function nudgeMailtoUrl(task) {
  const w = parseWaitingFor(task);
  if (!w) return null;
  const days = waitingDays(w.since);
  const title = task.title || '';
  const subject = `Aggiornamento su: ${title}`;
  const body = [
    `Ciao ${w.who},`,
    '',
    days
      ? `ti scrivo per «${title}»: sono in attesa da ${days} ${days === 1 ? 'giorno' : 'giorni'}.`
      : `ti scrivo per «${title}».`,
    '',
    'Fammi sapere come procede.',
    '',
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Note ripulite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Il testo della nota senza i marker e senza la riga dell'attesa: quello che
 * va mostrato nel campo "Nota" del pannello di dettaglio.
 * @param {string|null|undefined} bodyContent
 * @returns {string}
 */
export function noteText(bodyContent) {
  return (bodyContent || '')
    .replace(LEGACY_EIS_MARKER_RE, '')
    .replace(MIN_MARKER_RE, '')
    .replace(WAITING_RE, '')
    .replace(/^[ \t\n]+/, '')
    .trimEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
// Contesto — categories di To-Do
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('./types').TodoTask} task
 * @returns {string|null}
 */
export function taskContext(task) {
  const cats = (task?.categories || []).map(c => String(c).toLowerCase());
  return CONTEXTS.find(c => cats.includes(c.category.toLowerCase()))?.key || null;
}

/**
 * Le categorie da salvare per portare il task a questo contesto: quelle
 * estranee restano, così una categoria messa da Outlook non viene persa.
 * @param {import('./types').TodoTask} task
 * @param {string|null} contextKey
 * @returns {string[]}
 */
export function withContext(task, contextKey) {
  const known = CONTEXTS.map(c => c.category.toLowerCase());
  const others = (task?.categories || []).filter(c => !known.includes(String(c).toLowerCase()));
  const next = CONTEXTS.find(c => c.key === contextKey);
  return next ? [...others, next.category] : others;
}

/**
 * @param {string|null} contextKey
 * @returns {string}
 */
export function contextColor(contextKey) {
  return CONTEXTS.find(c => c.key === contextKey)?.color || 'var(--muted)';
}

// ─────────────────────────────────────────────────────────────────────────────
// Stato derivato
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo stato del task nel flusso. `scheduled` vince su `next` perché avere un
 * blocco nel piano è la cosa più specifica che si possa sapere di un task
 * altrimenti semplicemente "da fare".
 *
 * @param {import('./types').TodoTask} task
 * @param {{ scheduledIds?: Set<string>, inboxListId?: string|null }} [ctx]
 * @returns {TaskStatus}
 */
export function taskStatus(task, ctx = {}) {
  if (!task) return 'next';
  if (task.status === 'completed') return 'done';
  if (task.status === 'waitingOnOthers') return 'waiting';
  if (task.status === 'deferred') return 'someday';
  if (ctx.scheduledIds?.has(task.id)) return 'scheduled';
  if (ctx.inboxListId && task._listId === ctx.inboxListId) return 'inbox';
  return 'next';
}

/**
 * L'id della lista di default di To-Do — quella che l'app tratta come Inbox.
 * @param {{ id: string, wellknownListName?: string, displayName?: string }[]} lists
 * @returns {string|null}
 */
export function inboxListId(lists) {
  return (lists || []).find(l => l.wellknownListName === 'defaultList')?.id || null;
}

/**
 * Un task programmato su un giorno già passato e mai completato è "scivolato":
 * resta programmato, ma va segnalato.
 * @param {{ date: string, completed?: boolean }} placement
 * @param {string} todayDateStr  'YYYY-MM-DD'
 * @returns {boolean}
 */
export function isSlipped(placement, todayDateStr) {
  return !!placement && !placement.completed && placement.date < todayDateStr;
}

/**
 * I progetti fermi: hanno attività, ma nessuna che si possa fare adesso.
 *
 * È l'indicatore più utile del metodo, e l'app aveva tutti i dati per calcolarlo
 * senza calcolarlo. Un progetto con dieci attività tutte «in attesa» o tutte «un
 * giorno» sembra in corso — nella board occupa spazio, ha un colore, ha un
 * conteggio — ma non c'è niente da fare: è fermo, e nessuno lo dice.
 *
 * Le regole:
 *   · si guardano solo le liste che sono progetti, cioè quelle senza prefisso
 *     PARA (le Aree per definizione non finiscono, le Risorse non sono azioni,
 *     l'Archivio è chiuso — vedi paraConfig.js);
 *   · una lista senza nessuna attività non è ferma: è vuota, o finita;
 *   · basta una prossima azione o una programmata perché il progetto cammini.
 *
 * @param {import('./types').TodoTask[]} tasks
 * @param {(name: string|null|undefined) => string|null} roleOf   sectionRole, iniettato per non incrociare i moduli
 * @param {{ scheduledIds?: Set<string>, inboxListId?: string|null }} [ctx]
 * @returns {{ listId: string, listName: string, total: number }[]}
 */
export function stalledProjects(tasks, roleOf, ctx = {}) {
  /** @type {Map<string, { listId: string, listName: string, total: number, actionable: number }>} */
  const byList = new Map();
  for (const t of tasks || []) {
    const listId = t._listId || '';
    const listName = t._listName || '';
    if (!listId) continue;
    // Inbox non è un progetto: è la porta d'ingresso.
    if (ctx.inboxListId && listId === ctx.inboxListId) continue;
    if (roleOf(listName)) continue;
    if (!byList.has(listId)) byList.set(listId, { listId, listName, total: 0, actionable: 0 });
    const row = /** @type {any} */ (byList.get(listId));
    row.total += 1;
    const st = taskStatus(t, ctx);
    if (st === 'next' || st === 'scheduled') row.actionable += 1;
  }
  return [...byList.values()]
    .filter(r => r.total > 0 && r.actionable === 0)
    .map(({ listId, listName, total }) => ({ listId, listName, total }))
    .sort((a, b) => a.listName.localeCompare(b.listName, 'it'));
}

/**
 * Indicizza i piani giornalieri per id di task: da qui vengono sia lo stato
 * `scheduled` sia l'orario mostrato in Oggi e nella colonna Programmate.
 * @param {Record<string, import('./types').DayPlan>} plans
 * @returns {Map<string, { date: string, startTime: string, endTime: string, completed: boolean }>}
 */
export function indexScheduled(plans) {
  const out = new Map();
  for (const [date, plan] of Object.entries(plans || {})) {
    for (const b of plan?.blocks || []) {
      const prev = out.get(b.taskId);
      // Se un task è finito su più giorni vince il piazzamento più recente:
      // è quello che descrive dov'è adesso.
      if (!prev || prev.date < date) {
        out.set(b.taskId, { date, startTime: b.startTime, endTime: b.endTime, completed: !!b.completed });
      }
    }
  }
  return out;
}
