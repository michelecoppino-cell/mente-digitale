// @ts-check
// Il flusso GTD di un'attività, letto e scritto sui campi dei file nostri.
//
// Fino a ieri qui c'era il contrario: i task vivevano su Microsoft To-Do e metà
// di questo file spiegava come farci stare dentro cose per cui To-Do non aveva
// un posto — la stima in un marker [MIN:n] nelle note, la sveglia in un altro,
// la persona in una riga di testo libero da riconoscere con una regex, e lo
// stato spalmato fra `status` e quella riga. Adesso ogni cosa ha un campo suo
// (vedi taskStore.js) e qui resta solo quello che è davvero derivato:
//
//   inbox      il task sta nella lista trattata come Inbox
//   next       stato 'next'
//   ask        stato 'ask'          + persona: quella a cui chiedere
//   waiting    stato 'waiting'      + persona: quella da cui aspetti
//   delegated  stato 'delegated'    + persona: quella a cui hai passato la cosa
//   someday    stato 'someday'
//   done       stato 'done'
//   scheduled  ha un blocco nel piano del giorno (daily-plans su OneDrive)
//
// Invariante: un task ha uno e un solo stato. La colonna in cui appare è
// derivata da qui, mai un'etichetta salvata a parte. `scheduled` e `inbox` non
// sono scritti da nessuna parte: il primo è la presenza di un blocco nel piano,
// il secondo è la lista in cui il task si trova.

/** @typedef {'inbox'|'next'|'ask'|'waiting'|'delegated'|'scheduled'|'someday'|'done'} TaskStatus */

/** Gli stati nell'ordine in cui si leggono nella vista Attività: `ask` sta
 *  sotto `next` e `delegated` sotto `waiting`, che è dove stanno anche a
 *  schermo — due aree dentro quelle colonne, non due colonne in più. */
export const TASK_STATUSES = /** @type {TaskStatus[]} */ ([
  'inbox', 'next', 'ask', 'waiting', 'delegated', 'scheduled', 'someday', 'done',
]);

export const STATUS_LABELS = {
  inbox:     'Inbox',
  next:      'Prossime azioni',
  ask:       'Da chiedere',
  waiting:   'In attesa',
  delegated: 'Delegati',
  scheduled: 'Programmate',
  someday:   'Un giorno',
  done:      'Fatte',
};

/** Il verso di ogni stato in una riga: è il testo che esce passandoci sopra
 *  col cursore, sulle pastiglie della scheda di dettaglio e sulle icone delle
 *  colonne. Le etichette qui sopra dicono *come si chiama* una colonna, questi
 *  dicono *cosa vuol dire* per l'attività che ci sta dentro. */
export const STATUS_HINTS = /** @type {Record<string, string>} */ ({
  inbox:     'Da chiarire: sta nella lista Inbox',
  next:      'Prossima azione — fattibile, senza data',
  scheduled: 'Programmata — ha un blocco nel Piano',
  ask:       'Da chiedere — prima devi chiederlo a qualcuno',
  waiting:   'In attesa — dipende da qualcun altro',
  delegated: "Delegata — l'ha in mano qualcun altro",
  someday:   'Un giorno — non adesso',
  done:      'Fatta',
});

export const CONTEXTS = [
  { key: 'lavoro',     label: 'Lavoro',     category: 'Lavoro',     color: 'var(--ctx-lavoro)' },
  { key: 'personale',  label: 'Personale',  category: 'Personale',  color: 'var(--ctx-personale)' },
  { key: 'famiglia',   label: 'Famiglia',   category: 'Famiglia',   color: 'var(--ctx-famiglia)' },
];

// Quanto dev'essere grande una cosa, orientativamente. Non è una regola che il
// codice applica — nessun controllo, nessun avviso: è il metro con cui si
// decide se una cosa va spezzata, scritto una volta e mostrato dove si crea o
// si scompone (form della consegna, colonna Attività, `mente aiuto`).
//
//   sottoattività   meno di 2 ore     — sta dentro una giornata di lavoro
//   attività        meno di 2 giorni  — oltre, sono più attività travestite
//   consegna        meno di un mese   — oltre, è un'altra commessa
//
// Il senso è la scala: ogni livello è circa dieci volte quello sotto, così
// guardando una lista si capisce sempre a che altezza si sta ragionando.
export const GRANULARITY_MEMO = [
  { key: 'sottoattivita', label: 'Sottoattività', limit: 'meno di 2 ore' },
  { key: 'attivita',      label: 'Attività',      limit: 'meno di 2 giorni' },
  { key: 'consegna',      label: 'Consegna',      limit: 'meno di un mese' },
];

/** Il memo in una riga sola, per un titolo o una nota a piè di form. */
export const GRANULARITY_MEMO_LINE =
  'Orientativamente: ' + GRANULARITY_MEMO.map(g => `${g.label.toLowerCase()} ${g.limit}`).join(', ') + '.';

export const DEFAULT_ESTIMATE_MIN = 30;

/** Le durate offerte come chip nel serbatoio del Piano. */
export const ESTIMATE_CHOICES = [
  { min: 30,  label: '30m' },
  { min: 45,  label: '45m' },
  { min: 60,  label: '1h' },
  { min: 120, label: '2h' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stima di durata e sveglia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quanto ci vuole, in minuti. Chi non l'ha detto prende la mezz'ora di
 * partenza: serve al Piano per dare un'altezza al blocco.
 * @param {import('./taskStore').Task} task
 * @returns {number}
 */
export function taskEstimateMin(task) {
  return task?.stimaMin ?? DEFAULT_ESTIMATE_MIN;
}

/**
 * L'ora della sveglia, "HH:MM", o null. È un'ora del giorno e non una data: la
 * sveglia serve a farsi richiamare oggi, «alle 15:30 questa cosa», non a
 * ricordarsi di una scadenza — per quella c'è il campo scadenza.
 * @param {import('./taskStore').Task} task
 * @returns {string|null}
 */
export function taskAlarm(task) {
  return task?.sveglia || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// La persona di un'attività — attesa, da chiedere, delegata
// ─────────────────────────────────────────────────────────────────────────────

// I ruoli sono tre e si escludono a vicenda, perché dicono tre momenti diversi
// della stessa cosa: la domanda la devo ancora fare (`ask`), l'ho fatta e
// aspetto (`waiting`), l'ho passata a qualcuno che la porti a casa
// (`delegated`). Il ruolo non è un campo: è lo stato. Il campo `persona` porta
// solo il nome.
export const PERSON_ROLES = /** @type {const} */ ([
  { role: 'ask',       label: 'Da chiedere a', prompt: 'A chi lo chiedi…',        empty: 'Niente da chiedere' },
  { role: 'waiting',   label: 'In attesa da',  prompt: 'Da chi aspetti…',         empty: 'Non aspetti nessuno' },
  { role: 'delegated', label: 'Delegato a',    prompt: "A chi l'hai delegato…",   empty: 'Niente di delegato' },
]);

/** @typedef {'ask'|'waiting'|'delegated'} PersonRole */

/** Il ruolo della persona per uno stato del flusso, se quello stato ne ha uno. */
export function personRoleFor(/** @type {string|null|undefined} */ status) {
  return /** @type {PersonRole|null} */ (
    PERSON_ROLES.find(r => r.role === status)?.role || null
  );
}

/**
 * La persona di un task, col ruolo e da quando: `since` è l'ultima modifica,
 * che è il momento in cui il task è entrato in quello stato.
 * @param {import('./taskStore').Task} task
 * @returns {{ role: PersonRole, who: string, since: string|null }|null}
 */
export function taskPerson(task) {
  const role = personRoleFor(task?.stato);
  if (!role || !task?.persona) return null;
  return { role, who: task.persona, since: task.modificatoIl || task.creatoIl || null };
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

// ─────────────────────────────────────────────────────────────────────────────
// Contesto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('./taskStore').Task} task
 * @returns {string|null}
 */
export function taskContext(task) {
  return task?.contesto || null;
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
 * Lo stato del task nel flusso. Lo stato scritto vale quasi sempre; sopra ci
 * sono solo le due cose che non sono scritte da nessuna parte:
 * `inbox`, che è la lista in cui il task sta, e `scheduled`, che è la presenza
 * di un blocco nel piano — la cosa più specifica che si possa sapere di un task
 * altrimenti semplicemente "da fare".
 *
 * @param {import('./taskStore').Task} task
 * @param {{ scheduledIds?: Set<string>, inboxListId?: string|null }} [ctx]
 * @returns {TaskStatus}
 */
export function taskStatus(task, ctx = {}) {
  if (!task) return 'next';
  const stato = task.stato || 'next';
  if (stato === 'done' || stato === 'waiting' || stato === 'delegated' || stato === 'someday') {
    return /** @type {TaskStatus} */ (stato);
  }
  if (ctx.scheduledIds?.has(task.id)) return 'scheduled';
  if (ctx.inboxListId && task._listId === ctx.inboxListId) return 'inbox';
  // Un task che porta ancora `inbox` scritto ma non sta più nella lista Inbox è
  // stato chiarito: da lì in poi è una prossima azione come le altre.
  return /** @type {TaskStatus} */ (stato === 'inbox' ? 'next' : stato);
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
