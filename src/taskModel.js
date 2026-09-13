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

// Le regole delle sottoattività, scritte per esteso in un posto solo.
//
// Il memo qui sopra dice *quanto* deve essere grande una cosa; questo dice
// *che cosa* è una sottoattività e cosa non è — ed è la parte che serviva a
// chi la mente digitale la guida da fuori (il CLI, il server MCP, il recap del
// mattino), perché una macchina che non lo sa fa la cosa sbagliata in modo
// plausibile: crea otto attività dove ne bastava una con otto passi, oppure
// tiene tutto in un'attività sola e non sa mai dire a che punto è.
//
// Sta qui e non nelle descrizioni dei tool perché è il modello, non
// l'interfaccia: la stessa frase vale per la colonna Attività, per il modale
// del Piano e per chi scrive da una chat.
export const REGOLE_SOTTOATTIVITA = [
  "Una sottoattività è un passo dentro un'attività, non un'attività piccola: " +
  'non ha uno stato suo, non ha una persona, non ha una scadenza e non va a piano da sola. ' +
  "Se serve una di queste quattro cose, non è un passo: è un'attività, e va creata come tale.",

  "Si spezza mentre si scrive l'attività, non dopo: il momento in cui si sa com'è fatta una cosa " +
  'è quello in cui la si sta dicendo. Sotto le due ore non si spezza niente — una scaletta di una ' +
  "riga non serve a nessuno — e sopra i cinque o sei passi quella non è più un'attività ma una " +
  'consegna travestita, e vuole una sezione sua.',

  "Spuntare un passo è il gesto di tutti i giorni e non tocca lo stato dell'attività: " +
  "l'attività resta dov'è finché non la si chiude. Spuntato l'ultimo passo, chiedere se chiuderla " +
  'è la cosa giusta da fare — non farlo da soli, e non lasciarlo cadere.',

  "Messa a piano, un'attività può portarsi dentro il blocco i suoi passi ancora aperti: sono la " +
  "scaletta dell'ora che si sta per passare. Spuntarne uno vale da tutte e due le parti — nelle " +
  'Attività e dentro il blocco — e non va tenuto in pari a mano.',
];

/** Le stesse regole in un paragrafo, per le istruzioni di un modello. */
export const REGOLE_SOTTOATTIVITA_TESTO = REGOLE_SOTTOATTIVITA.join(' ');

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

// ─────────────────────────────────────────────────────────────────────────────
// Sottoattività
// ─────────────────────────────────────────────────────────────────────────────
// I sotto-passi si scrivevano solo dall'app: da fuori — CLI e server MCP — si
// leggevano e basta, e spezzare un'attività a voce finiva per essere un elenco
// dettato dentro la nota, cioè in un posto dove nessuna spunta si può togliere.
//
// La regola qui è la stessa di `findTask`: si indica un sotto-passo con un
// pezzo del suo testo, e se il pezzo ne prende due è un errore, non una scelta
// a caso — da qui si scrive sull'archivio vero. E un titolo che c'è già non si
// riaggiunge: chi detta due volte la stessa cosa (o ripete la chiamata perché
// la prima risposta non è arrivata) si ritroverebbe l'elenco doppio, che è la
// classe di guai per cui altrove si dice «sostituisce, non somma».

/**
 * @param {{ titolo: string }[]} elenco
 * @param {string} query
 * @returns {{ titolo: string }} il solo sotto-passo che il pezzo di testo prende
 */
function trovaSottoattivita(elenco, query) {
  const q = query.trim().toLowerCase();
  const presi = elenco.filter(s => (s.titolo || '').toLowerCase().includes(q));
  if (!presi.length) throw new Error(`Nessuna sottoattività per "${query}".`);
  if (presi.length > 1) {
    throw new Error(
      `"${query}" corrisponde a ${presi.length} sottoattività: ` +
      presi.map(s => `«${s.titolo}»`).join(', '));
  }
  return presi[0];
}

/**
 * Applica a un elenco di sotto-passi quello che una scrittura chiede: aggiungerne,
 * spuntarne, riaprirne. Puro: nuovo elenco in uscita, l'originale intatto, e
 * nessun id inventato qui dentro — ai sotto-passi nuovi lo dà `normalizzaTask`
 * quando il file viene scritto.
 *
 * @param {{ id?: string, titolo: string, fatta?: boolean }[]} elenco
 * @param {{ aggiungi?: string[], fatte?: string[], aperte?: string[] }} [ops]
 * @returns {{ sottoattivita: { id?: string, titolo: string, fatta: boolean }[],
 *             aggiunte: string[], gia: string[], spuntate: string[], riaperte: string[] }}
 */
export function applicaSottoattivita(elenco, ops = {}) {
  const out = (elenco || []).map(s => ({ ...s, titolo: String(s.titolo || ''), fatta: !!s.fatta }));
  /** @type {string[]} */ const aggiunte = [];
  /** @type {string[]} */ const gia = [];
  /** @type {string[]} */ const spuntate = [];
  /** @type {string[]} */ const riaperte = [];

  // Prima si aggiunge, poi si spunta: così «aggiungi A, B e segna fatta A» è
  // una scrittura sola, e a voce è una frase sola.
  for (const grezzo of ops.aggiungi || []) {
    const titolo = String(grezzo || '').trim();
    if (!titolo) continue;
    if (out.some(s => s.titolo.toLowerCase() === titolo.toLowerCase())) { gia.push(titolo); continue; }
    out.push({ titolo, fatta: false });
    aggiunte.push(titolo);
  }
  for (const query of ops.fatte || []) {
    const s = trovaSottoattivita(out, String(query));
    if (!(/** @type {any} */ (s).fatta)) spuntate.push(s.titolo);
    /** @type {any} */ (s).fatta = true;
  }
  for (const query of ops.aperte || []) {
    const s = trovaSottoattivita(out, String(query));
    if (/** @type {any} */ (s).fatta) riaperte.push(s.titolo);
    /** @type {any} */ (s).fatta = false;
  }

  return { sottoattivita: /** @type {any} */ (out), aggiunte, gia, spuntate, riaperte };
}
