// @ts-check
// La griglia del Piano: le misure, i colori e i conti che servono a disegnarla.
//
// Sono le cose che il Piano, la sua settimana, il suo mese e il suo modale degli
// eventi usano tutti allo stesso modo — quanto è alto uno slot da mezz'ora,
// come si spezza un titolo in verticale dentro un blocco stretto, quale colore
// ha un blocco *adesso* (e non quando lo si è creato), come si dividono in
// colonne due eventi che si accavallano.
//
// Stavano in testa a `PlannerView.jsx`, che era di tremila righe. Ci restano
// solo le cose che riguardano il Piano del giorno; queste no, e sono anche le
// uniche del Piano che si possono controllare coi tipi.

import { durataInOre, minutiDaOra, oraDaMinuti, ymd } from '../tempo.js';
import { listColor } from '../plannerShared';
import { taskEstimateMin } from '../taskModel';

export const SLOT_HEIGHT      = 32;  // px per 30-min slot (32 → ~12h visible at once)
export const SAVE_DEBOUNCE    = 2000;
// Durata di partenza di ciò che non ha una stima: eventi calendario e blocchi
// workbook. I blocchi task usano invece blockMinutesFor().
export const DEFAULT_DURATION = 60;
// Il blocco dura quanto la stima del task ([MIN:n] nelle note, impostata nel
// chiarimento o dal pannello Dettagli). Prima ogni blocco nasceva di un'ora
// fissa e la stima serviva solo a colorare una chip nel serbatoio: la durata
// dichiarata e quella pianificata non si parlavano.
export const SNAP_MIN = 30; // la griglia è a mezz'ore: le durate ci si allineano

export const t2m = minutiDaOra;
export const m2t = oraDaMinuti;
/** La stima del task, arrotondata in su alla mezz'ora della griglia. */
/** @param {any} task @returns {number} minuti, arrotondati alla mezz'ora della griglia */
export function blockMinutesFor(task) {
  const est = taskEstimateMin(task);
  return Math.max(SNAP_MIN, Math.ceil(est / SNAP_MIN) * SNAP_MIN);
}
/** Le mezz'ore fra due orari, come 'HH:MM'. @param {string} start @param {string} end @returns {string[]} */
export function slots(start, end) {
  const out = [];
  let cur = t2m(start);
  while (cur < t2m(end)) { out.push(m2t(cur)); cur += 30; }
  return out;
}
// Sotto questa durata un blocco resta nel layout orizzontale classico (non
// c'è spazio per ruotare il titolo); oltre, passa al layout verticale (vedi
// .vertical-layout in PlannerView.css): etichetta a sx (sezione + titolo
// ruotati), resto del blocco libero per sottostep/note.
export const VERTICAL_LAYOUT_MIN_DURATION = 60; // minuti
export const VERTICAL_TITLE_MIN_FONT      = 10; // px, limite inferiore di leggibilità
// Spazio riservato in basso nella colonna etichetta per l'etichetta di durata
// (linea di separazione + testo ruotato) — va sottratto all'altezza
// disponibile per il titolo, come già si fa per il nome sezione in alto.
export const VERTICAL_DURATION_RESERVE_PX = 24;
export const VERTICAL_TITLE_CHAR_FACTOR   = 0.66; // ingombro medio per carattere (stima empirica, Outfit semi-bold)
// Calcola dimensione del font e numero di righe (1 o 2) del titolo ruotato in
// verticale: prova prima una riga alla dimensione base, poi due righe alla
// dimensione base, e solo se non basta riduce il font (fino al minimo) su
// due righe — così un titolo lungo può andare a capo invece di rimpicciolirsi
// oltre il leggibile.
/**
 * @param {string} title
 * @param {number} availableHeight
 * @param {number} baseFontSize
 * @returns {{ fontSize: number, lines: number }|null} null se non ci sta comunque
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
// Graph restituisce il colore del calendario come enum (es. "lightBlue",
// "auto"), non un hex CSS: mappiamo i preset noti per il pallino colorato.
/** @type {Record<string, string>} */
export const GRAPH_CAL_COLORS = {
  lightBlue: '#7eb8c9', lightGreen: '#8fbf7f', lightOrange: '#e0a05e',
  lightGray: '#a0a0a0', lightYellow: '#e6c94d', lightTeal: '#6fbfae',
  lightPink: '#d98fb3', lightBrown: '#a9825a', lightRed: '#d97a7a',
  maxColor: '#c084a0',
};
/** @param {string|null|undefined} colorEnum l'enum di Graph @returns {string} */
export function calendarSwatch(colorEnum) {
  return (colorEnum && GRAPH_CAL_COLORS[colorEnum]) || '#888888';
}

// Il colore con cui si disegna un calendario, e quindi ogni suo evento.
//
// Prima era solo l'enum di Graph, e su un account dove nessun calendario ha un
// colore scelto rispondeva grigio per tutti: il mese era una parete di
// rettangoli identici, in cui non si distingueva un compleanno da una riunione.
// La scelta fatta nell'app (ingranaggio → Colori, o il pallino nel filtro
// «Calendari») vince, perché è l'unica che l'utente ha davvero espresso; sotto
// resta l'enum di Graph, che almeno distingue i calendari colorati in Outlook.
/**
 * @param {string|null|undefined} calId
 * @param {string|null|undefined} colorEnum
 * @param {Record<string, string>} [scelti]  calendarId -> hex, dalle impostazioni
 * @returns {string}
 */
export function calendarColor(calId, colorEnum, scelti) {
  return (calId && scelti?.[calId]) || calendarSwatch(colorEnum);
}

/** Lo stesso, partendo dall'evento già decorato da api.js.
 *  @param {any} ev @param {Record<string, string>} [scelti] @returns {string} */
export function coloreEvento(ev, scelti) {
  return calendarColor(ev?._calId, ev?._calColor, scelti);
}

// Voce sintetica aggiunta alla lista "Calendari ▾" per poter spegnere/accendere
// tutti i blocchi Workbook come se fossero un calendario in più — non
// corrisponde a nessun calendario Graph, quindi non tocca mai filterCalEvents.
export const WORKBOOK_CAL_ID = '__workbook__';

// Colore "vivo" di un blocco Workbook piazzato in griglia: il blocco nasce con
// colore/etichetta denormalizzati al momento del drop (vedi makeWorkbookBlock),
// ma il colore deve continuare a seguire il nodo Workbook/Sub-workbook se
// l'utente lo ricolora in seguito — si ricade sul valore denormalizzato solo
// se il nodo è stato nel frattempo eliminato.
/** @param {any} block @param {any[]} workbooksList @returns {string|null} */
export function liveWorkbookColor(block, workbooksList) {
  const wb = workbooksList.find((/** @type {any} */ w) => w.id === block.workbookId);
  if (!wb) return block.color;
  if (block.subWorkbookId) {
    const sub = wb.subWorkbooks.find((/** @type {any} */ s) => s.id === block.subWorkbookId);
    return sub?.color ?? block.color;
  }
  return wb.color ?? block.color;
}
// Stesso principio di liveWorkbookColor ma per i PlanBlock nati da un task
// To-Do (vedi makeBlock): il colore viene denormalizzato sul blocco al
// momento del drop, ma deve continuare a seguire il colore live della
// sezione OneNote (listColorMap) o del progetto custom se l'utente lo
// ricolora in seguito — si ricade sul valore denormalizzato solo se la
// sezione/lista non esiste più.
/** @param {any} block @param {any} config @param {Record<string, string>} listColorMap @returns {string|null} */
export function liveBlockColor(block, config, listColorMap) {
  if (block.projectKey) {
    const proj = (config.projects || []).find((/** @type {any} */ p) => p.key === block.projectKey);
    if (proj) return proj.color;
  }
  return listColor(block.listName ?? '', listColorMap, block.projectColor);
}
// La griglia della timeline copre sempre l'intera giornata (scorrimento libero
// con la rotella): il workday configurato serve solo a posizionare lo scroll
// iniziale su Giorno e Settimana, non più a limitare cosa viene disegnato.
export const DAY_START_MIN  = 0;
export const DAY_END_MIN    = 24 * 60;
export const FULL_DAY_SLOTS = slots('00:00', '24:00');

// Posizione di scroll con cui la timeline (Giorno o Settimana) si apre di
// default: l'inizio dell'orario di lavoro configurato, spinta ulteriormente
// verso il basso se "adesso" è già più avanti nella giornata.
/** @param {number} workStartMin @returns {number} px */
export function defaultScrollOffset(workStartMin) {
  const workStartPx  = workStartMin / 30 * SLOT_HEIGHT;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const extra = Math.max(0, (cur - workStartMin) / 30 * SLOT_HEIGHT - 80);
  return workStartPx + extra;
}
// Data in formato YYYY-MM-DD nel fuso orario locale (toISOString darebbe UTC)
export const localDateStr = ymd;
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
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
// Stesso "UTC finto" di isoToHHMM ma per la data: il giorno di calendario di
// un dateTime Graph va calcolato nel fuso locale, non tagliando il prefisso
// UTC grezzo (che per orari mattutini può risultare nel giorno prima).
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
// Il giorno di calendario di un evento. Per quelli con orario conta il fuso
// locale: tagliare i primi dieci caratteri del dateTime UTC di Graph fa
// scivolare al giorno prima tutto ciò che comincia dopo mezzanotte (in Italia
// prima delle 01:00 o 02:00) — ed è il motivo per cui uno stesso evento poteva
// comparire in agenda, che il fuso lo applica, e non nel Piano, che lo
// tagliava. Per quelli tutto-il-giorno vale invece la data così com'è: Graph la
// dà a mezzanotte UTC, e convertirla la sposterebbe di un giorno nei fusi a
// ovest di Greenwich.
/** @param {any} dt @param {boolean} allDay @returns {string} */
export function graphDayStr(dt, allDay) {
  if (!dt) return '';
  if (allDay) return (dt.dateTime || dt.date || '').slice(0, 10);
  return isoToLocalDateStr(dt.dateTime) || (dt.date || '').slice(0, 10);
}
/** @param {any} ev @returns {string} */
export function evDayStr(ev) {
  return ev ? graphDayStr(ev.start, isAllDay(ev)) : '';
}
// Due eventi che si accavallano nel tempo occupavano entrambi tutta la
// larghezza della colonna, uno esattamente sopra l'altro: quello disegnato
// prima spariva dietro il secondo, che è opaco. Qui gli eventi che si toccano
// si dividono la larghezza in colonne, come in qualunque calendario, e
// restano visibili tutti. Ritorna, nello stesso ordine ricevuto, la colonna di
// ciascuno e quante colonne ha il gruppo cui appartiene.
/**
 * @param {{start: number, end: number}[]} spans  minuti dall'inizio giornata
 * @returns {{col: number, cols: number}[]}
 */
export function overlapColumns(spans) {
  const layout = spans.map(() => ({ col: 0, cols: 1 }));
  const ordine = spans.map((_, i) => i)
    .sort((a, b) => spans[a].start - spans[b].start || spans[a].end - spans[b].end);
  /** @type {number[]} */
  let gruppo = [];
  /** @type {number[]} */
  let fineColonna = [];
  let fineGruppo = -Infinity;
  // Un gruppo si chiude quando comincia un evento che non tocca più nessuno
  // di quelli in corso: solo allora si sa in quante colonne dividerlo.
  const chiudiGruppo = () => {
    const cols = Math.max(1, fineColonna.length);
    gruppo.forEach(i => { layout[i].cols = cols; });
    gruppo = []; fineColonna = []; fineGruppo = -Infinity;
  };
  for (const i of ordine) {
    const s = spans[i];
    if (s.start >= fineGruppo) chiudiGruppo();
    let col = fineColonna.findIndex(fine => fine <= s.start);
    if (col === -1) { col = fineColonna.length; fineColonna.push(s.end); }
    else fineColonna[col] = s.end;
    layout[i].col = col;
    gruppo.push(i);
    fineGruppo = Math.max(fineGruppo, s.end);
  }
  chiudiGruppo();
  return layout;
}
// Inizio/fine in minuti di un evento, per il calcolo delle sovrapposizioni.
// Un evento che scavalla la mezzanotte (fine < inizio) e uno di durata nulla
// occuperebbero un intervallo vuoto: gli si dà comunque mezz'ora di corpo,
// che è la sua altezza minima sulla timeline.
/** @param {any} ev @returns {{start: number, end: number}} */
export function eventSpan(ev) {
  const s = t2m(isoToHHMM(ev.start?.dateTime || ev.start?.date) || '00:00');
  const e = t2m(isoToHHMM(ev.end?.dateTime || ev.end?.date) || '00:00');
  return { start: s, end: Math.max(e, s + 30) };
}
// Durata di un blocco/evento in layout verticale, mostrata in basso nella
// colonna etichetta — formato compatto "2h" oppure "2h30" senza minuti a zero.
export const fmtBlockDuration = durataInOre;
/** I sette giorni della settimana che contiene quel giorno. @param {string} dateStr @returns {string[]} */
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

// Titolo ruotato (writing-mode verticale) di un blocco "alto" — usato nella
// colonna etichetta a sx di task/eventi/workbook. `layout` arriva da
// verticalTitleLayout: su 2 righe passa da nowrap a wrap naturale, limitando
// la larghezza a due righe di testo verticale.
