// @ts-check
// Il calendario di lavoro: quello che l'account personale non può vedere.
//
// Il calendario aziendale sta su un tenant che non lo condivide con l'account
// personale, quindi Graph — che qui parla come *quell'account* — non lo
// raggiungerà mai. Non c'è niente da correggere in questo file: è un limite
// dell'account, e la strada è un'altra.
//
// La strada è uno **specchio**: il PC di lavoro manda alla casella personale,
// ogni due ore, una mail con allegata l'agenda intera in formato `.ics`, e una
// GitHub Action legge l'ultima di quelle mail e ne scrive tutta la finestra in
// un solo file su OneDrive (`scripts/sync-calendario-lavoro.mjs`, e il perché
// di quella scelta contro le altre sta lì e in `docs/calendario-lavoro.md`).
// Qui si legge quel file e lo si trasforma in eventi della stessa forma di
// quelli di Graph, così il Piano, «Oggi» e la settimana in arrivo li disegnano
// senza sapere che vengono da un'altra parte.
//
// **Sono in sola lettura, ed è una proprietà, non una limitazione.** Lo
// specchio si riscrive intero a ogni giro dell'Action: qualunque cosa si
// scrivesse qui sparirebbe entro un paio d'ore, e in silenzio. Meglio non
// poterlo fare — il modale dell'evento lo dice a chiare lettere invece di
// lasciar provare.
//
// **L'età dello specchio si vede.** È il difetto che questo disegno può avere:
// il PC di lavoro spento, o il compito pianificato che non parte, e l'agenda a
// schermo resta quella di ieri senza dirlo. Uno specchio fermo che non lo
// dichiara è peggio di uno rotto — un calendario vuoto lo si nota, un
// calendario vecchio no. Per questo `etaSpecchio` sta qui, e da qui la leggono
// il filtro «Calendari ▾» del Piano e la scheda dell'evento.

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
 * @typedef {object} FonteSpecchio
 * @property {string} nome
 * @property {'mail'|'ics'} [tipo]
 * @property {number} eventi
 * @property {string|null} [letturaIl]  quando il dato è stato **prodotto** dal
 *   PC di lavoro, che con la posta non è quando l'Action l'ha raccolto
 * @property {string|null} errore
 */

/**
 * @typedef {object} DocCalendarioLavoro
 * @property {number} version
 * @property {string} aggiornatoIl        ISO: quando l'Action ha riscritto il file
 * @property {FonteSpecchio[]} fonti
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
 * Oltre quante ore uno specchio è «fermo». Due giri e mezzo dell'Action: uno
 * saltato è normale (il PC di lavoro spento a pranzo, una mail in ritardo),
 * cinque ore di seguito no.
 */
export const ORE_PRIMA_DI_DIRLO = 5;

/**
 * Quando il dato è stato prodotto, e quanto tempo fa. Si guarda la fonte
 * **più fresca**: con due fonti, una ferma e una viva, il calendario a schermo
 * è vivo, e dire il contrario sarebbe un falso allarme.
 *
 * Il riferimento è `letturaIl` — l'ora in cui il PC di lavoro ha esportato —
 * e non `aggiornatoIl`, che è solo l'ora in cui l'Action ha riscritto il file.
 * Sono due cose diverse proprio nel caso che conta: l'Action gira puntuale
 * ogni due ore anche quando la mail che legge è di tre giorni fa.
 *
 * @param {DocCalendarioLavoro|null|undefined} doc
 * @param {Date} [adesso]
 * @returns {{ ore: number, quando: string }|null}  null se non si sa
 */
export function etaSpecchio(doc, adesso = new Date()) {
  const date = (doc?.fonti || [])
    .map(f => f.letturaIl)
    .filter(/** @returns {v is string} */ v => !!v);
  // I file scritti prima che `letturaIl` esistesse hanno solo `aggiornatoIl`:
  // è una stima per eccesso della freschezza, ma è meglio di «non si sa».
  if (!date.length && doc?.aggiornatoIl) date.push(doc.aggiornatoIl);
  if (!date.length) return null;

  const quando = date.reduce((m, d) => (d > m ? d : m), date[0]);
  const ms = adesso.getTime() - new Date(quando).getTime();
  return { ore: Math.max(0, Math.round(ms / 3_600_000)), quando };
}

/**
 * L'età detta a parole, o stringa vuota quando non c'è niente da dire: sotto
 * la soglia lo specchio è semplicemente aggiornato, e scriverlo sarebbe
 * rumore che si smette di leggere.
 * @param {DocCalendarioLavoro|null|undefined} doc
 * @param {Date} [adesso]
 * @returns {string}
 */
export function avvisoSpecchioFermo(doc, adesso = new Date()) {
  const eta = etaSpecchio(doc, adesso);
  if (!eta || eta.ore < ORE_PRIMA_DI_DIRLO) return '';
  const quanto = eta.ore < 48 ? `${eta.ore} ore` : `${Math.round(eta.ore / 24)} giorni`;
  return `fermo da ${quanto}: il PC di lavoro non manda l'agenda da ${eta.quando.slice(0, 16).replace('T', ' ')}`;
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
