// @ts-check
// Il calendario di lavoro: quello che l'account personale non può vedere.
//
// Il calendario aziendale sta su un tenant che non lo condivide con l'account
// personale, quindi Graph — che qui parla come *quell'account* — non lo
// raggiungerà mai. Non c'è niente da correggere in questo file: è un limite
// dell'account, e la strada è un'altra.
//
// La strada è uno **specchio**: una GitHub Action legge il feed ICS pubblicato
// dal calendario di lavoro e ne scrive tutta la finestra in un solo file su
// OneDrive (`scripts/sync-calendario-lavoro.mjs`, e il perché di quella scelta
// contro le altre sta lì e in `docs/calendario-lavoro.md`). Qui si legge quel
// file e lo si trasforma in eventi della stessa forma di quelli di Graph, così
// il Piano, «Oggi» e la settimana in arrivo li disegnano senza sapere che
// vengono da un'altra parte.
//
// **Sono in sola lettura, ed è una proprietà, non una limitazione.** Lo
// specchio si riscrive intero a ogni giro dell'Action: qualunque cosa si
// scrivesse qui sparirebbe entro un paio d'ore, e in silenzio. Meglio non
// poterlo fare — il modale dell'evento lo dice a chiare lettere invece di
// lasciar provare.

/** Il file dello specchio, dentro la cartella dell'app. */
export const FILE_CALENDARIO_LAVORO = 'calendario-lavoro.json';

/**
 * L'id del calendario sintetico. Ha la stessa forma di `WORKBOOK_CAL_ID`: un
 * id che Graph non emetterebbe mai, così non può collidere con un calendario
 * vero nel filtro «Calendari ▾» e nei colori.
 */
export const CAL_LAVORO_ID = '__lavoro__';

/** Il nome che si legge nel filtro dei calendari. */
export const CAL_LAVORO_NOME = 'Lavoro';

/**
 * @typedef {object} DocCalendarioLavoro
 * @property {number} version
 * @property {string} aggiornatoIl        ISO: quando l'Action ha letto il feed
 * @property {{ nome: string, eventi: number, errore: string|null }[]} fonti
 * @property {{ id: string, subject: string, start: string, end: string, isAllDay: boolean, fonte?: string }[]} eventi
 */

/** Il documento vuoto: quando il file non c'è ancora, o è di un'altra forma. */
export const DOC_VUOTO = /** @type {DocCalendarioLavoro} */ ({
  version: 1, aggiornatoIl: '', fonti: [], eventi: [],
});

/**
 * @param {any} raw
 * @returns {DocCalendarioLavoro}
 */
export function normalizzaDocumento(raw) {
  if (!raw || !Array.isArray(raw.eventi)) return DOC_VUOTO;
  return {
    version: Number(raw.version) || 1,
    aggiornatoIl: String(raw.aggiornatoIl || ''),
    fonti: Array.isArray(raw.fonti) ? raw.fonti : [],
    eventi: raw.eventi,
  };
}

/**
 * Gli eventi dello specchio nella finestra chiesta, nella forma di Graph.
 *
 * `timeZone: 'UTC'` perché è quello che scrive l'Action e quello che l'app si
 * aspetta ovunque: `isoToHHMM` in `planner/griglia.js` legge un `dateTime`
 * senza suffisso come UTC, ed è la convenzione di tutta la vista. Un evento di
 * tutto il giorno porta `date` invece di `dateTime`, come da Graph.
 *
 * @param {DocCalendarioLavoro|null|undefined} doc
 * @param {Date} da
 * @param {Date} a
 * @returns {any[]}
 */
export function eventiDiLavoro(doc, da, a) {
  const daIso = da.toISOString();
  const aIso = a.toISOString();
  return (doc?.eventi || [])
    .filter(e => {
      // Gli eventi di tutto il giorno hanno solo il giorno: confrontarli con
      // un istante completo funziona lo stesso, perché `YYYY-MM-DD` è un
      // prefisso di `YYYY-MM-DDTHH:MM:SS` e l'ordine lessicografico è quello
      // cronologico.
      const fine = e.end || e.start;
      return fine >= daIso.slice(0, e.isAllDay ? 10 : 19) && e.start <= aIso.slice(0, 19);
    })
    .map(e => ({
      id: e.id,
      subject: e.subject,
      isAllDay: !!e.isAllDay,
      start: e.isAllDay ? { date: e.start } : { dateTime: e.start, timeZone: 'UTC' },
      end: e.isAllDay ? { date: e.end } : { dateTime: e.end, timeZone: 'UTC' },
      _calId: CAL_LAVORO_ID,
      _calName: e.fonte || CAL_LAVORO_NOME,
      _isShared: true,
      // Il campo su cui si regge la sola lettura: lo guarda il modale
      // dell'evento, ed è l'unica cosa che impedisce di scrivere su una copia
      // che verrà riscritta da capo fra due ore.
      _soloLettura: true,
    }));
}
