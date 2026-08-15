// @ts-check
// I cento desideri: lettura della sezione «COSA VOGLIO» della Bussola.
//
// Il testo è scritto a mano dentro il documento su OneDrive, e ha attraversato
// due formati. Prima era un elenco piatto di righe che cominciavano tutte con
// «Voglio»:
//
//     Voglio essere più felice
//     Voglio dormire bene e svegliarmi con energia
//
// poi è diventato un elenco a gruppi, che si legge molto meglio quando i
// desideri sono quaranta e non otto:
//
//     ── ESSERE ────────────────────────────
//
//       · Essere più felice
//       · Volermi bene — lo merito
//
// Qui si leggono tutti e due. Non è gentilezza verso il passato: il documento
// vero sta su OneDrive e non lo riscrive nessuno finché non lo riscrive lui,
// quindi un lettore che capisce un formato solo mostrerebbe la barra dei
// separatori come se fosse un desiderio. Il formato è una cosa dell'utente,
// non del codice: il codice si adatta.

/**
 * @typedef {Object} Wish
 * @property {string} text   il desiderio, senza pallino né «Voglio»
 * @property {string} group  il gruppo di appartenenza, '' se l'elenco è piatto
 */

/**
 * @typedef {Object} WishGroup
 * @property {string} title  '' per l'elenco senza gruppi
 * @property {string[]} items
 */

// Una riga di intestazione di gruppo: trattini lunghi, il nome, altri trattini.
// Il nome può essere seguito da un numero qualunque di trattini o da nessuno.
const GROUP_RE = /^[─—\-=_]{2,}\s*(.*?)\s*[─—\-=_]*$/;

// Il pallino con cui comincia ogni voce nel formato a gruppi. Sono tre perché
// nel documento ne convivono di diversi: · per i desideri, ◦ per le pratiche.
const BULLET_RE = /^[·•◦*\-–]\s*/;

/** Una riga fatta solo di trattini: un separatore, non un titolo. */
function isRule(/** @type {string} */ line) {
  return /^[─—\-=_\s]+$/.test(line);
}

/**
 * I desideri raggruppati, nell'ordine in cui sono scritti.
 * @param {string} content  il contenuto della sezione «COSA VOGLIO»
 * @returns {WishGroup[]}
 */
export function parseWishGroups(content) {
  /** @type {WishGroup[]} */
  const groups = [];
  /** @type {WishGroup|null} */
  let current = null;

  for (const raw of (content || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // Un separatore con dentro un nome apre un gruppo; uno vuoto si salta.
    if (isRule(line)) continue;
    const header = line.match(GROUP_RE);
    if (header && header[1]) {
      current = { title: header[1].trim(), items: [] };
      groups.push(current);
      continue;
    }

    const text = line.replace(BULLET_RE, '').trim();
    // Due caratteri non fanno un desiderio: è più probabile che sia un avanzo
    // di formattazione.
    if (text.length <= 2) continue;

    if (!current) {
      current = { title: '', items: [] };
      groups.push(current);
    }
    current.items.push(text);
  }

  return groups.filter(g => g.items.length > 0);
}

/**
 * Gli stessi desideri in fila, ognuno col suo gruppo — la forma che serve a
 * chi ne deve pescare uno solo.
 * @param {string} content
 * @returns {Wish[]}
 */
export function parseWishes(content) {
  return parseWishGroups(content).flatMap(g => g.items.map(text => ({ text, group: g.title })));
}

/** La sezione «COSA VOGLIO» dentro il documento della Bussola. */
export function wishSection(/** @type {any} */ bussola) {
  return (bussola?.sections || []).find((/** @type {any} */ s) => WISH_TITLE_RE.test(s.title || '')) || null;
}

export const WISH_TITLE_RE = /cosa voglio|desideri/i;

/**
 * Il desiderio del giorno. L'indice si ricava dalla data e non da un random:
 * uno che cambia a ogni render sarebbe rumore, e ricaricare la pagina per
 * «trovarne uno migliore» è il contrario di quello che serve.
 * @param {Wish[]} wishes
 * @param {string} today  'YYYY-MM-DD'
 * @returns {Wish|null}
 */
export function wishOfTheDay(wishes, today) {
  if (!wishes.length) return null;
  const day = Math.floor(new Date(today + 'T00:00:00').getTime() / 86_400_000);
  return wishes[((day % wishes.length) + wishes.length) % wishes.length];
}
