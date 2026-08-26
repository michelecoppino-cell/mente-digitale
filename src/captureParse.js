// @ts-check
// La riga di cattura letta come «titolo + bersaglio», invece che come solo
// titolo.
//
// Il passo 1 del flusso non deve chiedere niente (vedi QuickCapture.jsx), e
// resta così: senza token si cattura in Inbox esattamente come prima. Ma
// quando *si sa già* dove va la cosa, farle fare tutto il giro del diagramma
// di chiarimento per poi scegliere da una tendina è il motivo per cui inserire
// un task era scomodo. Qui la destinazione si dice sulla stessa riga:
//
//   Rivedere relazione fondazioni @2573 !domani ~45
//
//   @nome   la lista To-Do di destinazione (match sul nome leggibile)
//   !data   la scadenza — oggi/domani/dopodomani, un giorno della settimana,
//           o una data scritta (31/8, 31-8-2026, 2026-08-31)
//   ~n      la stima in minuti (`~45`, `~2h`, `~90m`)
//
// Invariante di sicurezza: un token viene tolto dal titolo **solo se ha
// risolto**. `@casa` in un titolo dove nessuna lista si chiama così resta
// testo normale, e il task va in Inbox — cioè il comportamento di sempre. Un
// parser che mangia pezzi di titolo è peggio di un parser che non fa niente.

/** Un token all'inizio di una parola: preceduto da inizio riga o spazio. */
const DEST_RE = /(^|\s)@([^\s@]+)/;
const DUE_RE = /(^|\s)!([^\s!]+)/;
const EST_RE = /(^|\s)~(\d{1,4})\s*([hm])?\b/i;

/**
 * Confronto «come lo si scrive a mente»: senza accenti, senza maiuscole e
 * senza punteggiatura, così `@ris-auto`, `@RIS AUTO` e `@risauto` trovano
 * tutti la sezione «RIS-AUTO».
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalize(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * @typedef {Object} Destination
 * @property {string} id       id della lista To-Do
 * @property {string} label    nome leggibile (`listLabel()`)
 * @property {string} [name]   nome grezzo della lista, se diverso dall'etichetta
 * @property {string|null} [role]   ruolo PARA: 'area' | 'resources' | null (progetto)
 */

/**
 * Le destinazioni che corrispondono a quanto scritto, dalla più probabile alla
 * meno. L'ordine è: chi comincia con la query prima di chi la contiene soltanto
 * — digitando `25` la commessa «2573» viene prima di «Casa-2025».
 *
 * A query vuota non filtra: torna tutto nell'ordine ricevuto, che è quello che
 * serve al pannello quando lo si apre senza aver scritto niente.
 *
 * @param {string} query
 * @param {Destination[]} destinations
 * @returns {Destination[]}
 */
export function matchDestinations(query, destinations) {
  const q = normalize(query);
  if (!q) return [...(destinations || [])];
  /** @type {Destination[]} */
  const starts = [];
  /** @type {Destination[]} */
  const contains = [];
  for (const d of destinations || []) {
    // Si cerca sia nell'etichetta («2573 · A60-Fondazioni») sia nel nome
    // grezzo: il primo è quello che si legge, il secondo quello che si
    // ricorda di aver scritto in To-Do.
    const hay = [normalize(d.label), normalize(d.name)];
    if (hay.some(h => h.startsWith(q))) starts.push(d);
    else if (hay.some(h => h.includes(q))) contains.push(d);
  }
  return [...starts, ...contains];
}

/** @param {Date} d @returns {string} la data come `YYYY-MM-DD` locale */
function toDateStr(d) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('-');
}

/** @param {Date} base @param {number} days @returns {Date} */
function addDays(base, days) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** @type {Record<string, number>} */
const RELATIVE_DAYS = { oggi: 0, domani: 1, dopodomani: 2 };

// Domenica = 0, come `getDay()`. Le abbreviazioni sono quelle che si scrivono
// di getto; il match è per prefisso, quindi «mer», «merc» e «mercoledì»
// arrivano tutte allo stesso giorno.
const WEEKDAYS = [
  { day: 0, names: ['domenica', 'dom'] },
  { day: 1, names: ['lunedi', 'lun'] },
  { day: 2, names: ['martedi', 'mar'] },
  { day: 3, names: ['mercoledi', 'mer'] },
  { day: 4, names: ['giovedi', 'gio'] },
  { day: 5, names: ['venerdi', 'ven'] },
  { day: 6, names: ['sabato', 'sab'] },
];

/**
 * Una data scritta come viene: `oggi`, `domani`, `dopodomani`, un giorno della
 * settimana (la prossima occorrenza, mai oggi stesso — «giovedì» detto di
 * giovedì è quello dopo), `31/8`, `31-8-26`, `2026-08-31`.
 *
 * Senza anno si intende la prossima occorrenza: `31/12` scritto a gennaio è
 * quest'anno, `1/1` scritto a dicembre è l'anno prossimo.
 *
 * @param {string} raw
 * @param {Date} today
 * @returns {string|null}  `YYYY-MM-DD`, o null se non è una data
 */
export function parseDueToken(raw, today) {
  const t = normalize(raw);
  if (!t) return null;

  if (t in RELATIVE_DAYS) return toDateStr(addDays(today, RELATIVE_DAYS[t]));

  const weekday = WEEKDAYS.find(w => w.names.some(n => n.startsWith(t) && t.length >= 3));
  if (weekday) {
    const delta = ((weekday.day - today.getDay()) + 7) % 7 || 7;
    return toDateStr(addDays(today, delta));
  }

  // `2026-08-31` — l'unico formato in cui l'anno viene per primo.
  const iso = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);

  // `31/8`, `31-8-26`, `31.8.2026` — normalize() ha già tolto i separatori,
  // quindi si riparte dal testo grezzo.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/.exec(raw.trim());
  if (!dmy) return null;
  const day = +dmy[1];
  const month = +dmy[2];
  if (dmy[3]) {
    const year = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3];
    return validDate(year, month, day);
  }
  const thisYear = validDate(today.getFullYear(), month, day);
  if (!thisYear) return null;
  // Una data già passata quest'anno si intende l'anno prossimo: nessuno
  // scrive una scadenza nel passato.
  return thisYear >= toDateStr(today) ? thisYear : validDate(today.getFullYear() + 1, month, day);
}

/**
 * @param {number} year @param {number} month @param {number} day
 * @returns {string|null}  null se il giorno non esiste (31 febbraio)
 */
function validDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return toDateStr(d);
}

/**
 * @typedef {Object} ParsedCapture
 * @property {string} title            il titolo ripulito dai token che hanno risolto
 * @property {Destination|null} destination  la lista scelta dal token `@`
 * @property {string} destQuery        quanto scritto dopo `@` (anche se non ha risolto)
 * @property {boolean} hasDestToken    c'è un token `@` nella riga
 * @property {string|null} dueDate     `YYYY-MM-DD`
 * @property {number|null} estimateMin
 */

/**
 * Legge la riga di cattura.
 *
 * `overrideDestination` è la destinazione scelta a mano — dal pannello, con le
 * frecce o con un clic — e ha tre valori distinti:
 *
 *   `undefined`   nessuna scelta esplicita: decide il token `@`
 *   una lista     va lì, qualunque cosa dica il token
 *   `null`        Inbox, esplicitamente: il token è stato letto e scartato
 *
 * In entrambi i casi espliciti il token sparisce comunque dal titolo: è stato
 * lui ad aprire la scelta, ha fatto da selettore e non è testo.
 *
 * @param {string} raw
 * @param {Destination[]} destinations
 * @param {{ today?: Date, overrideDestination?: Destination|null }} [opts]
 * @returns {ParsedCapture}
 */
export function parseCapture(raw, destinations = [], opts = {}) {
  const today = opts.today || new Date();
  let title = raw || '';

  const chosen = 'overrideDestination' in opts;
  const destMatch = DEST_RE.exec(title);
  const destQuery = destMatch ? destMatch[2] : '';
  const candidates = destMatch && !chosen ? matchDestinations(destQuery, destinations) : [];
  const destination = chosen ? (opts.overrideDestination || null) : (candidates[0] || null);
  // Senza una scelta esplicita il token sparisce dal titolo solo se ha portato
  // a una lista vera: `@casa` che non è nessuna sezione resta testo.
  if (destMatch && (chosen || destination)) title = title.replace(DEST_RE, '$1');

  const dueMatch = DUE_RE.exec(title);
  const dueDate = dueMatch ? parseDueToken(dueMatch[2], today) : null;
  if (dueMatch && dueDate) title = title.replace(DUE_RE, '$1');

  const estMatch = EST_RE.exec(title);
  const estimateMin = estMatch ? estimateFrom(estMatch) : null;
  if (estMatch && estimateMin) title = title.replace(EST_RE, '$1');

  return {
    title: title.replace(/\s{2,}/g, ' ').trim(),
    destination,
    destQuery,
    hasDestToken: !!destMatch,
    dueDate,
    estimateMin,
  };
}

/**
 * `~45` e `~45m` sono minuti, `~2h` sono ore. Zero non è una stima.
 * @param {RegExpExecArray} m
 * @returns {number|null}
 */
function estimateFrom(m) {
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (m[3] || '').toLowerCase() === 'h' ? n * 60 : n;
}
