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
 * Il giorno che viene `quanti` giorni dopo (o prima, con un numero negativo).
 *
 * Si passa da `new Date(y, m, d)` e non dai millisecondi: il giorno dell'ora
 * legale dura 23 ore, e sommare 86 400 000 millisecondi a un lunedì di fine
 * marzo restituisce lo stesso lunedì alle 23. Le date qui sono giorni di
 * calendario, non istanti.
 * @param {string} giorno  'YYYY-MM-DD'
 * @param {number} quanti
 * @returns {string}
 */
export function spostaGiorni(giorno, quanti) {
  const [a, m, g] = giorno.split('-').map(Number);
  return ymd(new Date(a, m - 1, g + quanti));
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
 * L'ora che viene `minuti` dopo un'altra: `09:30` + 90 → `11:00`.
 *
 * Si ferma alle 23:59 e non scavalca la mezzanotte: chi la usa sta calcolando
 * la fine di un appuntamento cominciato in giornata, e farlo finire il giorno
 * dopo **senza averlo detto** sarebbe peggio che accorciarlo.
 * @param {string} ora  `HH:MM`
 * @param {number} minuti
 * @returns {string}
 */
export function sommaOra(ora, minuti) {
  return oraDaMinuti(Math.min(minutiDaOra(ora) + minuti, 23 * 60 + 59));
}

/**
 * La prima ora plausibile per un appuntamento fissato di getto: **oggi la
 * prossima mezz'ora, un altro giorno le nove**.
 *
 * Un appuntamento che si scrive al volo è quasi sempre «fra poco» se cade
 * oggi, e «di mattina» se cade un altro giorno — e a tarda sera la «prossima
 * mezz'ora» sarebbe domani, quindi anche lì valgono le nove.
 * @param {string} giorno  `YYYY-MM-DD`
 * @param {Date} [adesso]
 * @returns {string} `HH:MM`
 */
export function oraProposta(giorno, adesso = new Date()) {
  if (giorno !== ymd(adesso)) return '09:00';
  const arrotondata = Math.ceil((adesso.getHours() * 60 + adesso.getMinutes() + 1) / 30) * 30;
  return arrotondata >= 23 * 60 ? '09:00' : oraDaMinuti(arrotondata);
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

// ── Le settimane ISO ────────────────────────────────────────────────────────
// Le colonne della matrice del Programma sono settimane, e una settimana va
// scritta in un modo solo: `2026-W12`, lunedì-domenica, con la regola ISO
// (l'anno di una settimana è quello del suo giovedì). Senza, le settimane a
// cavallo di capodanno finiscono in due colonne diverse a seconda di chi le
// calcola — e la chiave del carico, che è una stringa, smetterebbe di
// combaciare fra un dispositivo e l'altro.

/** Il giovedì della settimana di `d`, che è quello che decide l'anno ISO. */
function giovediDellaSettimana(/** @type {Date} */ d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  return t;
}

/**
 * La settimana ISO di una data, `'YYYY-Www'`.
 * @param {Date|string} [d] una data o un giorno 'YYYY-MM-DD'
 * @returns {string}
 */
export function settimanaIso(d = new Date()) {
  const data = typeof d === 'string' ? dataDaYmd(d) : d;
  const giovedi = giovediDellaSettimana(data);
  const primoGiovedi = giovediDellaSettimana(new Date(giovedi.getFullYear(), 0, 4));
  // Differenza in giorni interi e non in millisecondi: fra marzo e ottobre c'è
  // un'ora di fuso in mezzo, e `(a - b) / 7 giorni` sbaglia di un'unità
  // proprio nelle settimane del cambio.
  const giorni = Math.round((giovedi.getTime() - primoGiovedi.getTime()) / 86400000);
  return `${giovedi.getFullYear()}-W${String(1 + giorni / 7).padStart(2, '0')}`;
}

/**
 * Il lunedì di una settimana ISO, come giorno locale 'YYYY-MM-DD'.
 * @param {string} settimana 'YYYY-Www'
 * @returns {string}
 */
export function lunediDellaSettimana(settimana) {
  const [anno, numero] = settimana.split('-W').map(Number);
  const primoGiovedi = giovediDellaSettimana(new Date(anno, 0, 4));
  const lunedi = new Date(primoGiovedi);
  lunedi.setDate(primoGiovedi.getDate() - 3 + (numero - 1) * 7);
  return ymd(lunedi);
}

/** Una data 'YYYY-MM-DD' come Date locale (mezzanotte). @param {string} s */
function dataDaYmd(s) {
  const [a, m, g] = String(s).split('-').map(Number);
  return new Date(a, (m || 1) - 1, g || 1);
}

/**
 * Le settimane da una all'altra, comprese, in ordine.
 *
 * Si cammina di sette giorni sul calendario invece di contare i numeri di
 * settimana: gli anni ISO hanno 52 o 53 settimane, e sommare uno al numero
 * inventerebbe una `2026-W53` che non esiste.
 * @param {string} da  settimana o giorno
 * @param {string} a
 * @returns {string[]}
 */
export function settimaneTra(da, a) {
  const primo = da.includes('W') ? da : settimanaIso(da);
  const ultimo = a.includes('W') ? a : settimanaIso(a);
  /** @type {string[]} */
  const elenco = [];
  const cursore = dataDaYmd(lunediDellaSettimana(primo));
  const fine = dataDaYmd(lunediDellaSettimana(ultimo));
  // Un tetto di sicurezza: una commessa con le date scambiate, o sbagliate di
  // qualche secolo, non deve appendere il browser dentro un ciclo.
  for (let i = 0; cursore <= fine && i < 520; i++) {
    elenco.push(settimanaIso(cursore));
    cursore.setDate(cursore.getDate() + 7);
  }
  return elenco;
}

/**
 * Il mese in cui cade il lunedì di una settimana, 'YYYY-MM'. È come la matrice
 * aggrega le colonne quando le settimane sono troppe per starci.
 * @param {string} settimana
 * @returns {string}
 */
export function meseDellaSettimana(settimana) {
  return lunediDellaSettimana(settimana).slice(0, 7);
}

/**
 * La settimana spostata avanti (o indietro) di tante settimane.
 *
 * Si cammina sul calendario invece di sommare al numero: un `+1` su `2026-W52`
 * inventerebbe una `2026-W53` che in quell'anno non esiste.
 * @param {string} settimana 'YYYY-Www'
 * @param {number} quante
 * @returns {string}
 */
export function spostaSettimane(settimana, quante) {
  const lunedi = dataDaYmd(lunediDellaSettimana(settimana));
  lunedi.setDate(lunedi.getDate() + 7 * quante);
  return settimanaIso(lunedi);
}
