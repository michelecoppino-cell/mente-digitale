// @ts-check
// Il tempo come lo scrive l'app: il giorno, l'ora del giorno, una durata.
//
// Queste sei righe stavano scritte a mano in undici file. Non erano tutte
// uguali — ed è il motivo per cui stanno qui adesso: la stessa mezz'ora si
// leggeva «30m» nella vista Attività, «30min» in «Oggi» e «0h30» nel Piano,
// perché ogni schermata aveva riscritto la formattazione per conto suo e
// nessuno aveva mai messo le tre versioni una accanto all'altra. Il giorno
// locale — quello che `toISOString()` sbaglia di un giorno per chi vive a est
// di Greenwich — era ricopiato altrettante volte, e bastava che una copia
// dimenticasse il `padStart` perché una schermata guardasse un altro giorno.
//
// Qui ognuna è scritta una volta. Le tre forme della durata restano tre, con
// tre nomi: sono scelte di stile per schermate diverse, non tre bug.

/**
 * Il giorno di una data nel fuso locale, 'YYYY-MM-DD'.
 *
 * Non `toISOString().slice(0, 10)`: quello dà il giorno UTC, e alle 01:00 di
 * un martedì italiano risponde «lunedì». È il giorno in cui una cosa è
 * successa per chi l'ha fatta, non per Greenwich.
 * @param {Date} [d]
 * @returns {string}
 */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Il mese 'YYYY-MM' di una data 'YYYY-MM-DD' (o di un istante).
 * @param {string|Date} [data]
 * @returns {string}
 */
export function meseDi(data = new Date()) {
  return (typeof data === 'string' ? data : ymd(data)).slice(0, 7);
}

/**
 * I minuti da mezzanotte di una "HH:MM". Tollera l'ora senza zero davanti e
 * la stringa vuota, che vale mezzanotte: la griglia del Piano ci passa sopra
 * anche i blocchi non ancora collocati.
 * @param {string|null|undefined} t
 * @returns {number}
 */
export function minutiDaOra(t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * L'inverso: i minuti da mezzanotte come "HH:MM", sempre a due cifre.
 * @param {number} min
 * @returns {string}
 */
export function oraDaMinuti(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Una durata come la scrivono le righe fitte — stima di un'attività, colonna
 * di una board: "45m", "1h30", "2h".
 * @param {number} min
 * @returns {string}
 */
export function durataBreve(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m}m`;
  const ore = Math.floor(m / 60), resto = m % 60;
  return resto ? `${ore}h${String(resto).padStart(2, '0')}` : `${ore}h`;
}

/**
 * La stessa durata dove c'è spazio per una parola intera — «Oggi», il
 * Movimento: "45min", "1h30", "2h".
 * @param {number} min
 * @returns {string}
 */
export function durataDistesa(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m}min`;
  const ore = Math.floor(m / 60), resto = m % 60;
  return resto ? `${ore}h${String(resto).padStart(2, '0')}` : `${ore}h`;
}

/**
 * La durata sempre in ore, anche sotto l'ora: "0h45", "1h30", "2h". È la
 * forma delle colonne del Piano e dell'albero Workbook, dove le durate stanno
 * incolonnate e devono cominciare tutte con lo stesso genere di numero.
 * @param {number} min
 * @returns {string}
 */
export function durataInOre(min) {
  const m = Math.max(0, Math.round(min || 0));
  const ore = Math.floor(m / 60), resto = m % 60;
  return resto === 0 ? `${ore}h` : `${ore}h${String(resto).padStart(2, '0')}`;
}
