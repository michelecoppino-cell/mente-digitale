// @ts-check
// Le scadenze che tornano ogni anno — bollo, assicurazione, revisione, tasse,
// visite — agganciate alle Aree.
//
// Si scrive **una volta sola** un evento ricorrente sul calendario, intitolato
// `[NOME-LISTA] Titolo`, e quando la data si avvicina l'attività compare da sé
// nella lista di quell'area, con la scadenza già dentro. Da lì in poi è
// un'attività come le altre.
//
// L'anticipo si dice nel titolo dell'evento, dentro la parentesi quadra:
//
//   [AREA-AUTO +30g] Bollo auto        trenta giorni prima
//   [AREA-CASA +6s]  Revisione caldaia  sei settimane prima
//   [AREA-SALUTE +2m] Visita            due mesi prima
//   [AREA-CASA] Cambio gomme            l'anticipo di default, due settimane
//
// ── Perché non si legge più il promemoria di Outlook ────────────────────────
//
// La prima versione leggeva `reminderView`: la finestra di promemoria scattati
// fra l'ultimo controllo riuscito e adesso. Era **un meccanismo a eventi**, e
// ha smesso di funzionare senza dire niente, per tre motivi che si sommano:
//
//  1. il segnalibro dell'ultimo controllo aveva una scadenza di trenta giorni.
//     Passato un mese senza aprire l'app, la finestra ripartiva dagli ultimi
//     sette giorni e **tutto quello che era scattato in mezzo era perso per
//     sempre**: un promemoria scatta in un istante, e quell'istante non torna;
//  2. «↺ Aggiorna tutto» cancella i segnalibri, e riportava la finestra a sette
//     giorni con lo stesso effetto;
//  3. il promemoria nativo di Outlook non va oltre le due settimane. Per il
//     bollo — che si vuole vedere un mese prima — l'anticipo giusto non era
//     nemmeno esprimibile.
//
// Adesso è **un meccanismo a stato**: non si guarda «cos'è scattato da quando
// ti ho visto l'ultima volta», si guarda «quali occorrenze cadono dentro il
// loro anticipo, oggi». Non c'è nessuna finestra da non perdere e nessun
// segnalibro da tenere in pari: aprendo l'app in un giorno qualsiasi fra
// l'anticipo e la scadenza, l'attività c'è. Gli eventi sono quelli che l'app
// già scarica per i pannelli delle sezioni (un mese indietro, diciotto avanti,
// tutti i calendari, ricorrenze già espanse da `calendarView`): nessuna
// chiamata in più.
//
// La deduplica non sta in un elenco a parte ma sull'attività stessa, nel campo
// `origineScadenza`. Un elenco a parte sarebbe una cosa in più da tenere in
// pari, e quando si disallinea si ritrovano tre copie della stessa revisione.

import { ymd, spostaGiorni } from './tempo.js';

/** L'anticipo quando il titolo non ne dice uno: due settimane. */
export const ANTICIPO_DEFAULT = 14;

/**
 * Quanto ancora si crea l'attività dopo che la data è passata. Serve a chi
 * apre l'app per la prima volta dopo la scadenza: un bollo scaduto tre giorni
 * fa è esattamente la cosa che si vuole ancora vedere. Oltre, l'occorrenza è
 * archeologia — e ricrearla vorrebbe dire far tornare a galla quello che era
 * stato cancellato apposta.
 */
export const GRAZIA_GIORNI = 7;

// `[AREA-AUTO +30g] Bollo auto` → prefisso, anticipo, titolo.
const PREFIX_RE = /^\[([^\]]+)\]\s*(.+)$/;
// L'anticipo in coda al nome della lista: `+30g`, `+6s`, `+2m`.
const ANTICIPO_RE = /\s*\+\s*(\d{1,3})\s*([gsmGSM])?\s*$/;

/** Giorni per unità. Il mese è di trenta giorni: è un anticipo, non una data. */
const GIORNI_PER_UNITA = { g: 1, s: 7, m: 30 };

/**
 * `[AREA-AUTO +30g] Bollo auto` →
 * `{ listName: 'AREA-AUTO', title: 'Bollo auto', anticipoGiorni: 30 }`.
 *
 * L'anticipo si stacca dal nome della lista **solo se è scritto bene**: una
 * lista che si chiamasse davvero «AREA+2» resta quella che è. Vale la stessa
 * regola della riga di cattura — un pezzo si toglie solo se ha risolto.
 *
 * @param {string|null|undefined} subject
 * @returns {import('./types').ParsedReminder|null}
 */
export function parseReminderSubject(subject) {
  const m = (subject || '').match(PREFIX_RE);
  if (!m) return null;
  let listName = m[1].trim();
  const title = m[2].trim();
  let anticipoGiorni = ANTICIPO_DEFAULT;

  const anticipo = listName.match(ANTICIPO_RE);
  if (anticipo) {
    const unita = (anticipo[2] || 'g').toLowerCase();
    const giorni = Number(anticipo[1]) * (GIORNI_PER_UNITA[/** @type {'g'|'s'|'m'} */ (unita)] || 1);
    if (giorni > 0) {
      anticipoGiorni = giorni;
      listName = listName.slice(0, anticipo.index).trim();
    }
  }

  if (!listName || !title) return null;
  return { listName, title, anticipoGiorni };
}

/**
 * Il giorno di un evento Graph, `YYYY-MM-DD`. Un evento di tutto il giorno
 * porta `start.date`, uno con l'ora `start.dateTime`: in entrambi i casi i
 * primi dieci caratteri sono il giorno, ed è l'unica cosa che serve qui.
 * @param {any} evento
 * @returns {string}
 */
export function giornoEvento(evento) {
  return String(evento?.start?.date || evento?.start?.dateTime || '').slice(0, 10);
}

/**
 * Da cosa nasce un'attività di scadenza: quale scadenza, di quale lista, in
 * che giorno. È quello che finisce in `origineScadenza`, ed è il solo motivo
 * per cui alla scansione dopo non se ne crea una seconda.
 *
 * Non contiene l'id dell'evento **apposta**: l'id di un'occorrenza espansa da
 * `calendarView` non è lo stesso che tornava da `reminderView`, e non è detto
 * che resti uguale se la serie viene toccata in Outlook. Lista, titolo e
 * giorno invece sono esattamente ciò che rende due attività «la stessa cosa»
 * per chi le guarda.
 *
 * @param {string} listName
 * @param {string} title
 * @param {string} giorno  'YYYY-MM-DD'
 * @returns {string}
 */
export function origineScadenza(listName, title, giorno) {
  return `scadenza:${listName}|${title}|${giorno}`;
}

/**
 * Le scadenze che oggi vanno esistere come attività: un'occorrenza per riga,
 * già abbinata alla sua lista.
 *
 * Pura e senza rete: prende gli eventi già scaricati e le liste, e dice cosa
 * andrebbe creato. Chi la chiama toglie quello che c'è già e crea il resto.
 *
 * @param {any[]} eventi        gli eventi Calendario della finestra precaricata
 * @param {{ id: string, displayName: string }[]} liste
 * @param {string} [oggi]       'YYYY-MM-DD', per le prove
 * @returns {{ listId: string, listName: string, titolo: string, giorno: string, origine: string }[]}
 */
export function scadenzeDovute(eventi, liste, oggi = ymd()) {
  const perNome = new Map((liste || []).map(l => [l.displayName.toLowerCase(), l]));
  /** @type {{ listId: string, listName: string, titolo: string, giorno: string, origine: string }[]} */
  const dovute = [];
  const viste = new Set();

  for (const evento of eventi || []) {
    const letto = parseReminderSubject(evento?.subject);
    if (!letto) continue;
    const lista = perNome.get(letto.listName.toLowerCase());
    if (!lista) continue;

    const giorno = giornoEvento(evento);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) continue;

    // La finestra: dall'anticipo fino a qualche giorno dopo la data.
    if (oggi < spostaGiorni(giorno, -letto.anticipoGiorni)) continue;
    if (oggi > spostaGiorni(giorno, GRAZIA_GIORNI)) continue;

    const origine = origineScadenza(lista.displayName, letto.title, giorno);
    // Lo stesso evento può arrivare due volte quando lo stesso calendario è
    // letto da due strade (vedi il ripiego su /events in api.js): due righe
    // qui vorrebbero dire due attività identiche.
    if (viste.has(origine)) continue;
    viste.add(origine);

    dovute.push({
      listId: lista.id, listName: lista.displayName, titolo: letto.title, giorno, origine,
    });
  }
  return dovute;
}

/**
 * Se l'attività esiste già. Due prove, e la seconda non è ridondante:
 *
 *  - il marker, che è il caso normale;
 *  - stesso titolo e stessa scadenza nella stessa lista, che copre le attività
 *    nate dal meccanismo di prima (il loro `origineScadenza` è scritto in un
 *    altro formato, con dentro l'id dell'evento) e chiunque si sia scritto la
 *    stessa scadenza a mano. Un doppione è una cosa che si nota e dà fastidio;
 *    una scadenza che non compare perché qualcosa le somigliava, no.
 *
 * @param {import('./taskStore').Task[]} esistenti  tutti i task della lista, spuntati compresi
 * @param {{ titolo: string, giorno: string, origine: string }} scadenza
 * @returns {boolean}
 */
export function scadenzaGiaPresente(esistenti, { titolo, giorno, origine }) {
  const atteso = titolo.trim().toLowerCase();
  return (esistenti || []).some(t =>
    t?.origineScadenza === origine
    || (String(t?.titolo || '').trim().toLowerCase() === atteso && String(t?.scadenza || '').slice(0, 10) === giorno));
}

// Filtra localmente (nessuna chiamata Graph) gli eventi intitolati
// "[NomeSezione] …" — usata dal Pannello sezione sull'elenco di eventi già
// precaricato una volta sola in App.jsx (preloadSectionCalendarEvents),
// invece di interrogare Calendario a ogni apertura del pannello.
//
// Passa dal parser e non da un confronto di stringhe: col prefisso che può
// portare l'anticipo (`[AREA-AUTO +30g]`), un `startsWith('[area-auto]')`
// smetterebbe di riconoscere proprio gli eventi che l'anticipo ce l'hanno.
/**
 * @param {import('./types').CalendarEvent[]|null|undefined} events
 * @param {string} sectionName
 * @returns {import('./types').CalendarEvent[]}
 */
export function filterEventsBySectionPrefix(events, sectionName) {
  if (!sectionName) return [];
  const atteso = sectionName.trim().toLowerCase();
  return (events || []).filter(e => parseReminderSubject(e.subject)?.listName.toLowerCase() === atteso);
}
