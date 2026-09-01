// @ts-check
// Convenzione PARA: in ogni taccuino (workbook) le sezioni il cui nome inizia
// con uno dei prefissi qui sotto vengono assegnate al ruolo corrispondente
// (es. "ARC-AUTO" e "ARC-LORENZO" → archive). OneNote non accetta "/" nei nomi
// sezione, quindi si usa un prefisso invece del nome letterale fisso. Tutte le
// altre sezioni sono considerate "progetti attivi" — nessuna configurazione
// aggiuntiva richiesta, basta rispettare i prefissi.
import { ymd } from './tempo';

export const PARA_SECTION_PREFIXES = {
  area: ['AREA'],
  resources: ['RIS-', 'IDEE-'],
  archive: ['ARC-'],
};

/**
 * @param {string|null|undefined} displayName
 * @returns {{ role: string, prefix: string }|null}
 */
function matchPrefix(displayName) {
  const name = (displayName || '').toUpperCase();
  for (const [role, prefixes] of Object.entries(PARA_SECTION_PREFIXES)) {
    const prefix = prefixes.find(p => name.startsWith(p));
    if (prefix) return { role, prefix };
  }
  return null;
}

// 'area' | 'resources' | 'archive' | null (progetto)
/**
 * @param {string|null|undefined} displayName
 * @returns {string|null}
 */
export function sectionRole(displayName) {
  return matchPrefix(displayName)?.role || null;
}

/**
 * @param {string|null|undefined} displayName
 * @returns {boolean}
 */
export function isParaSection(displayName) {
  return sectionRole(displayName) !== null;
}

// Nome sezione depurato dal prefisso PARA (es. "ARC-AUTO" → "AUTO"), usato
// come etichetta al posto del nome del taccuino nella vista PARA. Se la
// sezione non è PARA, o non resta nulla dopo il prefisso, ritorna il nome
// originale.
/**
 * @param {string|null|undefined} displayName
 * @returns {string}
 */
export function paraSectionLabel(displayName) {
  const name = displayName || '';
  const match = matchPrefix(name);
  if (!match) return name;
  const rest = name.slice(match.prefix.length).replace(/^[\s\-_]+/, '');
  return rest || name;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consegne dentro una commessa: la gerarchia nel nome della lista To-Do
//
// Una lista To-Do è una sezione OneNote (stesso nome), ma una commessa ha più
// consegne, ognuna con la sua data. I gruppi di Microsoft To-Do non servono:
// Graph non li espone (`todoTaskList` non ha un padre, né in v1.0 né in beta),
// quindi la gerarchia sta nel nome — come già i prefissi PARA qui sopra e il
// marker `[MIN:n]` della stima in taskModel.js.
//
//   GRUPPO.Consegna[-YYMMDD]
//
//   2573.A60-Fondazioni-260831  →  commessa 2573, consegna «A60-Fondazioni»,
//                                  scadenza 31/08/2026
//
// Senza punto il nome resta quello di oggi, 1:1 con la sezione: la convenzione
// è opt-in e una commessa che non vuole consegne separate non cambia di una
// virgola. Per lo stesso motivo la data si legge solo nei nomi con il punto:
// una lista `Coldbox-260831` senza gruppo è un nome, non una scadenza.
//
// La scadenza è solo l'ultimo segmento dopo l'ultimo `-`, e solo se è
// esattamente `\d{6}` ed è una data vera: il trattino è già dentro i nomi
// (`Coldbox-revB`), quindi tutto il resto fa parte del nome della consegna.
// La data è un campo, non testo: non va mai mostrata dentro il nome.
//
// Quanto grande è una consegna, orientativamente (vedi GRANULARITY_MEMO in
// taskModel.js): sottoattività meno di 2 ore, attività meno di 2 giorni,
// consegna meno di un mese. Più lunga di così è una commessa a sé.

/** L'ultimo `-YYMMDD` di un nome: la scadenza della consegna. */
const DUE_SUFFIX_RE = /-(\d{6})$/;

/** Un carattere alfanumerico (lettere accentate comprese). */
const ALNUM_RE = /[\p{L}\p{N}]/u;

/**
 * `YYMMDD` → data locale a mezzanotte, o null se non è una data vera
 * (`-999999` resta parte del nome).
 * @param {string} yymmdd
 * @returns {Date|null}
 */
function parseYYMMDD(yymmdd) {
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** @param {Date} d @returns {string} la data come `YYMMDD` */
function toYYMMDD(d) {
  return [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map(n => String(n).padStart(2, '0')).join('');
}

/**
 * @typedef {Object} ParsedListName
 * @property {string} raw          il nome così com'è
 * @property {string|null} group   la commessa, o null se il nome non è annidato
 * @property {string} deliverable  la consegna senza la data (il nome intero se non è annidato)
 * @property {Date|null} due       la scadenza della consegna
 */

/**
 * Il nome di una lista To-Do letto secondo la convenzione. È l'unico punto in
 * cui il nome viene spezzato: tutti gli altri helper passano da qui.
 * @param {string|null|undefined} displayName
 * @returns {ParsedListName}
 */
export function parseListName(displayName) {
  const raw = (displayName || '').trim();
  const dot = raw.indexOf('.');
  const group = dot > 0 ? raw.slice(0, dot).trim() : '';
  const rest = dot > 0 ? raw.slice(dot + 1).trim() : '';
  // Un punto in testa o in coda non fa una gerarchia: il nome resta intero.
  if (!group || !rest) return { raw, group: null, deliverable: raw, due: null };

  const m = DUE_SUFFIX_RE.exec(rest);
  const due = m ? parseYYMMDD(m[1]) : null;
  const deliverable = (due && m ? rest.slice(0, m.index).trim() : rest) || rest;
  return { raw, group, deliverable, due };
}

/**
 * La commessa di una lista, o null se la lista non è annidata.
 * @param {string|null|undefined} displayName
 * @returns {string|null}
 */
export function listGroupKey(displayName) {
  return parseListName(displayName).group;
}

/**
 * Il nome della consegna, senza commessa e senza data — quello che si legge
 * dentro la sezione, dove la commessa è già scritta in testata.
 * @param {string|null|undefined} displayName
 * @returns {string}
 */
export function listDeliverableLabel(displayName) {
  return parseListName(displayName).deliverable;
}

/**
 * La scadenza della consegna, o null. Data locale a mezzanotte, confrontabile
 * con `new Date()` senza correzioni di fuso.
 * @param {string|null|undefined} displayName
 * @returns {Date|null}
 */
export function listDueDate(displayName) {
  return parseListName(displayName).due;
}

/**
 * Come si scrive il nome di una lista fuori dalla sua sezione: «commessa ·
 * consegna», mai la data — quella è un campo e si mostra formattata.
 * @param {string|null|undefined} displayName
 * @returns {string}
 */
export function listLabel(displayName) {
  const { group, deliverable } = parseListName(displayName);
  if (!group) return paraSectionLabel(displayName);
  return `${paraSectionLabel(group)} · ${deliverable}`;
}

/**
 * La sezione appartiene a questa commessa? Vale il nome uguale, oppure il nome
 * che comincia con la commessa seguita da un carattere non alfanumerico:
 * `2573` trova `2573-ABS`, `257` non lo trova.
 * @param {string|null|undefined} sectionName
 * @param {string|null|undefined} group
 * @returns {boolean}
 */
export function sectionMatchesGroup(sectionName, group) {
  const s = (sectionName || '').trim().toLowerCase();
  const g = (group || '').trim().toLowerCase();
  if (!s || !g) return false;
  if (s === g) return true;
  if (!s.startsWith(g)) return false;
  return !ALNUM_RE.test(s.charAt(g.length));
}

/**
 * La sezione a cui appartiene una lista, cercata fra i nomi dati: prima il
 * nome esatto, poi il prefisso. Se restano più candidati la risposta è null —
 * meglio nessun collegamento che uno indovinato.
 * @param {string|null|undefined} listName
 * @param {string[]} sectionNames
 * @returns {string|null}
 */
export function sectionNameForList(listName, sectionNames = []) {
  // Nomi diversi solo per maiuscole sono lo stesso nome: due sezioni omonime in
  // taccuini diversi non rendono ambigua una lista, portano alla stessa riga.
  const names = [...new Map(
    sectionNames.filter(Boolean).map(n => [n.trim().toLowerCase(), n.trim()])
  ).values()];
  const { group } = parseListName(listName);

  if (!group) {
    const q = (listName || '').trim().toLowerCase();
    return names.find(n => n.toLowerCase() === q) || null;
  }
  const g = group.toLowerCase();
  const exact = names.filter(n => n.toLowerCase() === g);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const prefixed = names.filter(n => sectionMatchesGroup(n, group));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * Le consegne nell'ordine in cui si guardano: prima quella che scade prima,
 * quelle senza data in fondo, a parità il nome. È anche l'ordine delle
 * sfumature di colore (vedi buildListColorMap), così colonna e colori
 * raccontano la stessa sequenza.
 * @template {{ displayName: string }} T
 * @param {T[]} lists
 * @returns {T[]}
 */
export function sortDeliverableLists(lists = []) {
  return [...lists].sort((a, b) => {
    const da = listDueDate(a.displayName)?.getTime() ?? Infinity;
    const db = listDueDate(b.displayName)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return a.displayName.localeCompare(b.displayName, 'it');
  });
}

/**
 * Tutte le liste To-Do di una sezione: quella omonima (il caso 1:1 di sempre)
 * per prima, poi le consegne annidate in ordine di scadenza.
 * @template {{ displayName: string }} T
 * @param {string|null|undefined} sectionName
 * @param {T[]} lists
 * @param {string[]} sectionNames  tutte le sezioni conosciute, per sciogliere le ambiguità
 * @returns {T[]}
 */
export function listsForSection(sectionName, lists = [], sectionNames = []) {
  const target = (sectionName || '').trim().toLowerCase();
  if (!target) return [];
  const mine = lists.filter(l =>
    (sectionNameForList(l.displayName, sectionNames) || '').toLowerCase() === target);
  const plain = mine.filter(l => !listGroupKey(l.displayName));
  const nested = sortDeliverableLists(mine.filter(l => listGroupKey(l.displayName)));
  return [...plain, ...nested];
}

/**
 * La commessa con cui nominare le consegne di una sezione. È il nome della
 * sezione, troncato a un eventuale punto: il pezzo prima del punto resta
 * comunque un prefisso valido (il punto non è alfanumerico), mentre tenere il
 * nome intero spezzerebbe il gruppo alla prima lettura.
 * @param {string|null|undefined} sectionName
 * @returns {string}
 */
export function groupKeyForSection(sectionName) {
  const name = (sectionName || '').trim();
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot).trim() : name;
}

/**
 * Il nome della lista da creare o rinominare: la composizione inversa di
 * parseListName. È l'unico modo in cui l'app scrive un nome annidato —
 * l'utente compila due campi separati e la convenzione non la digita mai.
 * @param {{ gruppo: string, consegna: string, scadenza?: Date|string|null }} parts
 * @returns {string}
 */
export function buildListName({ gruppo, consegna, scadenza = null }) {
  const g = (gruppo || '').trim();
  // Il punto separa commessa e consegna: dentro il nome della consegna
  // sposterebbe il confine, quindi non ci può stare.
  const c = (consegna || '').trim().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (!g || !c) throw new Error('Servono la commessa e il nome della consegna.');
  const base = `${g}.${c}`;
  if (!scadenza) return base;
  const d = scadenza instanceof Date ? scadenza : new Date(`${scadenza}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Scadenza non valida: ${scadenza}`);
  return `${base}-${toYYMMDD(d)}`;
}

/**
 * La scadenza di una consegna come la vuole un `<input type="date">`.
 * @param {Date|null|undefined} d
 * @returns {string}
 */
export function toDateInputValue(d) {
  return d ? ymd(d) : '';
}
