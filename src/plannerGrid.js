// @ts-check
// La griglia del Piano: misure, conversioni fra orari e minuti, formati.
//
// Stava tutto in testa a PlannerView.jsx, che era arrivato a 3300 righe — un
// file in cui per cambiare il formato di una durata bisognava scorrere oltre
// duemila righe di componente. Sono funzioni pure e costanti: nessuna tocca lo
// stato, nessuna sa che esiste React, e ora le usano in tre (la vista Giorno, la
// Settimana, il calendario mensile) invece di essere raggiungibili solo da
// dentro lo stesso file.
//
// Non finiscono in plannerShared.js di proposito: quello è ciò che il Piano
// condivide con la vista Attività, ed è importato da App.jsx — cioè dal chunk
// iniziale. Questo è interno alla timeline, e resta nel chunk del Piano.
import { taskEstimateMin } from './taskModel';
import { loadPomodoroStats, savePomodoroStats } from './api';

/** px per slot di 30 minuti (32 → ~12h visibili insieme). */
export const SLOT_HEIGHT = 32;
export const SAVE_DEBOUNCE = 2000;

// Durata di partenza di ciò che non ha una stima: eventi calendario e blocchi
// workbook. I blocchi task usano invece blockMinutesFor().
export const DEFAULT_DURATION = 60;

/** La griglia è a mezz'ore: le durate ci si allineano. */
export const SNAP_MIN = 30;

/** @param {string} t @returns {number} */
export function t2m(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** @param {number} min @returns {string} */
export function m2t(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Il blocco dura quanto la stima del task ([MIN:n] nelle note, impostata nel
// chiarimento o dal pannello Dettagli). Prima ogni blocco nasceva di un'ora
// fissa e la stima serviva solo a colorare una chip nel serbatoio: la durata
// dichiarata e quella pianificata non si parlavano.
/** La stima del task, arrotondata in su alla mezz'ora della griglia.
 *  @param {any} task @returns {number} */
export function blockMinutesFor(task) {
  const est = taskEstimateMin(task);
  return Math.max(SNAP_MIN, Math.ceil(est / SNAP_MIN) * SNAP_MIN);
}

/** @param {string} start @param {string} end @returns {string[]} */
export function slots(start, end) {
  const out = [];
  let cur = t2m(start);
  while (cur < t2m(end)) { out.push(m2t(cur)); cur += 30; }
  return out;
}

// ── Titolo verticale ────────────────────────────────────────────────────────
// Sotto questa durata un blocco resta nel layout orizzontale classico (non c'è
// spazio per ruotare il titolo); oltre, passa al layout verticale (vedi
// .vertical-layout in PlannerView.css): etichetta a sx (sezione + titolo
// ruotati), resto del blocco libero per sottostep/note.
export const VERTICAL_LAYOUT_MIN_DURATION = 60; // minuti
const VERTICAL_TITLE_MIN_FONT = 10;             // px, limite inferiore di leggibilità

// Spazio riservato in basso nella colonna etichetta per l'etichetta di durata
// (linea di separazione + testo ruotato) — va sottratto all'altezza disponibile
// per il titolo, come già si fa per il nome sezione in alto.
export const VERTICAL_DURATION_RESERVE_PX = 24;
const VERTICAL_TITLE_CHAR_FACTOR = 0.66; // ingombro medio per carattere (stima empirica, Outfit semi-bold)

// Calcola dimensione del font e numero di righe (1 o 2) del titolo ruotato in
// verticale: prova prima una riga alla dimensione base, poi due righe alla
// dimensione base, e solo se non basta riduce il font (fino al minimo) su due
// righe — così un titolo lungo può andare a capo invece di rimpicciolirsi oltre
// il leggibile.
/**
 * @param {string} title
 * @param {number} availableHeight
 * @param {number} baseFontSize
 * @returns {{ fontSize: number, lines: number }}
 */
export function verticalTitleLayout(title, availableHeight, baseFontSize) {
  const len = (title || '').length || 1;
  if (len * VERTICAL_TITLE_CHAR_FACTOR * baseFontSize <= availableHeight) {
    return { fontSize: baseFontSize, lines: 1 };
  }
  const perLine = Math.ceil(len / 2);
  if (perLine * VERTICAL_TITLE_CHAR_FACTOR * baseFontSize <= availableHeight) {
    return { fontSize: baseFontSize, lines: 2 };
  }
  const fitFontSize = availableHeight / (perLine * VERTICAL_TITLE_CHAR_FACTOR);
  return { fontSize: Math.max(VERTICAL_TITLE_MIN_FONT, fitFontSize), lines: 2 };
}

// ── Colori ──────────────────────────────────────────────────────────────────
// Graph restituisce il colore del calendario come enum (es. "lightBlue",
// "auto"), non un hex CSS: mappiamo i preset noti per il pallino colorato.
const GRAPH_CAL_COLORS = {
  lightBlue: '#7eb8c9', lightGreen: '#8fbf7f', lightOrange: '#e0a05e',
  lightGray: '#a0a0a0', lightYellow: '#e6c94d', lightTeal: '#6fbfae',
  lightPink: '#d98fb3', lightBrown: '#a9825a', lightRed: '#d97a7a',
  maxColor: '#c084a0',
};

/** @param {string} colorEnum @returns {string} */
export function calendarSwatch(colorEnum) {
  return /** @type {Record<string, string>} */ (GRAPH_CAL_COLORS)[colorEnum] || '#888888';
}

// Ordine di presentazione degli enum colore Graph nei color-picker dei
// calendari — 'auto' per primo per rappresentare "nessun colore personalizzato".
export const GRAPH_CAL_COLOR_OPTIONS = ['auto', ...Object.keys(GRAPH_CAL_COLORS)];

// Voce sintetica aggiunta alla lista "Calendari ▾" per poter spegnere/accendere
// tutti i blocchi Workbook come se fossero un calendario in più — non
// corrisponde a nessun calendario Graph, quindi non tocca mai filterCalEvents.
export const WORKBOOK_CAL_ID = '__workbook__';

// Colore "vivo" di un blocco Workbook piazzato in griglia: il blocco nasce con
// colore/etichetta denormalizzati al momento del drop (vedi makeWorkbookBlock),
// ma il colore deve continuare a seguire il nodo Workbook/Sub-workbook se
// l'utente lo ricolora in seguito — si ricade sul valore denormalizzato solo se
// il nodo è stato nel frattempo eliminato.
/** @param {any} block @param {any[]} workbooksList @returns {string|undefined} */
export function liveWorkbookColor(block, workbooksList) {
  const wb = workbooksList.find(w => w.id === block.workbookId);
  if (!wb) return block.color;
  if (block.subWorkbookId) {
    const sub = wb.subWorkbooks.find((/** @type {any} */ s) => s.id === block.subWorkbookId);
    return sub?.color ?? block.color;
  }
  return wb.color ?? block.color;
}

// Stesso principio di liveWorkbookColor ma per i PlanBlock nati da un task
// To-Do (vedi makeBlock): il colore viene denormalizzato sul blocco al momento
// del drop, ma deve continuare a seguire il colore live della sezione OneNote
// (listColorMap) o del progetto custom se l'utente lo ricolora in seguito — si
// ricade sul valore denormalizzato solo se la sezione/lista non esiste più.
/**
 * @param {any} block
 * @param {any} config
 * @param {Record<string, string>} listColorMap
 * @returns {string|undefined}
 */
export function liveBlockColor(block, config, listColorMap) {
  if (block.projectKey) {
    const proj = (config.projects || []).find((/** @type {any} */ p) => p.key === block.projectKey);
    if (proj) return proj.color;
  }
  const live = listColorMap[(block.listName ?? '').toLowerCase()];
  return live ?? block.projectColor;
}

// ── La giornata ─────────────────────────────────────────────────────────────
// La griglia della timeline copre sempre l'intera giornata (scorrimento libero
// con la rotella): il workday configurato serve solo a posizionare lo scroll
// iniziale su Giorno e Settimana, non più a limitare cosa viene disegnato.
export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60;
export const FULL_DAY_SLOTS = slots('00:00', '24:00');

// Posizione di scroll con cui la timeline (Giorno o Settimana) si apre di
// default: l'inizio dell'orario di lavoro configurato, spinta ulteriormente
// verso il basso se "adesso" è già più avanti nella giornata.
/** @param {number} workStartMin @returns {number} */
export function defaultScrollOffset(workStartMin) {
  const workStartPx = workStartMin / 30 * SLOT_HEIGHT;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const extra = Math.max(0, (cur - workStartMin) / 30 * SLOT_HEIGHT - 80);
  return workStartPx + extra;
}

/** Data in formato YYYY-MM-DD nel fuso orario locale (toISOString darebbe UTC).
 *  @param {Date} d @returns {string} */
export function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @returns {string} */
export function todayStr() {
  return localDateStr(new Date());
}

/** @returns {string} */
export function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** @param {string|null|undefined} iso @returns {string|null} */
export function isoToHHMM(iso) {
  if (!iso) return null;
  if (!iso.includes('T')) return iso.slice(0, 5);
  // Graph restituisce dateTime in UTC senza suffisso 'Z': senza forzarlo,
  // new Date() lo interpreterebbe come ora locale (evento anticipato di 1-2h).
  const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  const d = new Date(hasTZ ? iso : iso + 'Z');
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Stesso "UTC finto" di isoToHHMM ma per la data: il giorno di calendario di un
// dateTime Graph va calcolato nel fuso locale, non tagliando il prefisso UTC
// grezzo (che per orari mattutini può risultare nel giorno prima).
/** @param {string|null|undefined} iso @returns {string|null} */
export function isoToLocalDateStr(iso) {
  if (!iso) return null;
  const hasTZ = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  return localDateStr(new Date(hasTZ ? iso : iso + 'Z'));
}

/** @param {any} ev @returns {boolean} */
export function isAllDay(ev) {
  return ev.isAllDay || (!ev.start?.dateTime && !!ev.start?.date);
}

/** Totale di giornata nell'header della colonna Timeline — formato ore:minuti.
 *  @param {number} min @returns {string} */
export function fmtFocusTotal(min) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Durata di un blocco in layout verticale — compatto "2h" oppure "2h30".
 *  @param {number} min @returns {string} */
export function fmtBlockDuration(min) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${String(rest).padStart(2, '0')}`;
}

/** @param {string} dateStr @returns {string[]} i sette giorni della settimana, da lunedì */
export function getWeekDays(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return localDateStr(day);
  });
}

// ── Sessioni di concentrazione ──────────────────────────────────────────────
export const SESSION_TYPE_LABELS = {
  focus: 'concentrato',
  personal: 'pausa personale',
  office: 'interruzione ufficio',
  client: 'interruzione cliente',
};
export const FOCUS_SESSION_TYPES = ['focus', 'personal', 'office', 'client'];

// Durata di default di una fascia aggiunta a mano, per tipo — un pomodoro
// intero per il lavoro, una pausa breve per le interruzioni.
export const FOCUS_ADD_DURATION = { focus: 25, personal: 5, office: 5, client: 5 };

// Converte "minuti dalla mezzanotte" (fuso locale) di un giorno in un dateTime
// ISO in UTC — coerente col formato già salvato da PomodoroTimer.jsx.
/** @param {string} dayStr @param {number} min @returns {string} */
export function dateTimeFromMinutes(dayStr, min) {
  const d = new Date(dayStr + 'T00:00:00');
  d.setMinutes(min);
  return d.toISOString();
}

// Riscrive la lista di sessioni pomodoro di un giorno sul file OneDrive,
// ricaricando prima lo stato più recente per non perdere modifiche concorrenti
// fatte da altre schede/dispositivi.
/** @param {string} day @param {any[]} sessions */
export async function persistPomodoroSessions(day, sessions) {
  try {
    const stats = await loadPomodoroStats();
    const prevDay = stats[day] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
    stats[day] = { ...prevDay, sessions };
    await savePomodoroStats(stats);
  } catch (e) { console.error('persist pomodoro sessions', e); }
}
