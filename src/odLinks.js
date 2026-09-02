// @ts-check
// I percorsi di una sezione — l'archivio unico dietro la colonna «Percorsi»
// della scheda sezione e dietro il riquadro OneDrive del Panel.
//
// Prima queste funzioni stavano dentro OneDriveBox: due componenti che
// leggevano e scrivevano lo stesso file su OneDrive, ma solo uno dei due
// sapeva come farlo. Qui stanno una volta sola, insieme alla forma del dato.
import { loadODLinksFromCloud, saveODLinksToCloud } from './api';

const LOCAL_KEY = 'onedrive_links_v2';

/** La categoria dei collegamenti su OneDrive. */
export const CAT_DRIVE = 'OneDrive';

/** Le categorie che aprono invece di copiare: le loro pastiglie sono link da
 *  far aprire al browser, non percorsi da incollare in Esplora risorse. È la
 *  categoria a decidere il gesto — il campo indirizzo è uno solo. */
export const OPEN_CATS = [CAT_DRIVE, 'Web'];

/** @param {string[]} cats */
export function opensLink(cats) {
  return (cats || []).some(c => OPEN_CATS.includes(c));
}

/** Dove finisce un percorso appena creato, e dove finiscono i vecchi record
 *  senza link web: da qualche parte devono stare, o non si vedrebbero. */
export const CAT_DEFAULT = 'Progetto';

/** L'ordine in cui si guardano le categorie note. Le altre — quelle inventate
 *  da chi usa l'app — vengono dopo, nell'ordine in cui compaiono nei dati. */
export const KNOWN_CATS = [CAT_DRIVE, CAT_DEFAULT, 'Rete', 'Web'];

/**
 * @typedef {Object} PathLink
 * @property {string} name
 * @property {string} link         l'indirizzo, uno solo: la categoria dice se
 *                                 si apre o si copia
 * @property {string|null} url     link web — mantenuto per il riquadro OneDrive
 * @property {string|null} urlPc   percorso sul computer — idem
 * @property {string[]} cats
 */

/** @returns {Record<string, PathLink[]>} */
export function loadLocalLinks() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}

/** @param {Record<string, PathLink[]>} obj */
export function saveLocalLinks(obj) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch { /* quota piena — ignora */ }
}

/**
 * Un record dell'archivio come lo vuole la colonna Percorsi. I link salvati
 * prima delle categorie non ne hanno nessuna: quelli con un link web sono
 * OneDrive — è l'unica cosa che il riquadro di prima sapesse fare — gli altri
 * finiscono nella categoria di partenza.
 *
 * L'indirizzo è uno solo. Nei record vecchi ce ne sono due, `url` e `urlPc`:
 * si sceglie quello che serve al gesto della categoria, e l'altro resta nel
 * record senza essere toccato — il riquadro OneDrive del Panel lo usa ancora.
 * @param {any} l
 * @returns {PathLink}
 */
export function normalizeLink(l) {
  const cats = Array.isArray(l?.cats) && l.cats.length
    ? l.cats.filter(/** @param {any} c */ c => typeof c === 'string' && c.trim()).map(/** @param {string} c */ c => c.trim())
    : [l?.url ? CAT_DRIVE : CAT_DEFAULT];
  const safeCats = cats.length ? cats : [CAT_DEFAULT];
  const open = opensLink(safeCats);
  return {
    name: l?.name || '',
    link: l?.link || (open ? (l?.url || l?.urlPc) : (l?.urlPc || l?.url)) || '',
    url: l?.url || null,
    urlPc: l?.urlPc || null,
    cats: safeCats,
  };
}

/**
 * Il record da scrivere nel file. L'indirizzo unico va anche nel campo che il
 * riquadro OneDrive si aspetta — `url` se la categoria apre, `urlPc` se copia —
 * e l'altro campo resta com'era: cambiare categoria qui non deve cancellare un
 * percorso scritto altrove.
 * @param {PathLink} p
 * @returns {any}  il record grezzo del file, dove un indirizzo vuoto è `null`
 */
export function serializeLink(p) {
  const link = (p.link || '').trim();
  const open = opensLink(p.cats);
  return {
    name: p.name,
    link: link || null,
    url: open ? (link || null) : (p.url ?? null),
    urlPc: open ? (p.urlPc ?? null) : (link || null),
    cats: p.cats,
  };
}

/** @param {any[]|undefined|null} links */
export function normalizeLinks(links) {
  return (links || []).map(normalizeLink);
}

/**
 * Le categorie presenti in una sezione: quelle note nel loro ordine, poi le
 * altre. Una categoria senza percorsi non compare — è la regola del disegno,
 * ed è anche l'unica che tiene la colonna corta quando i percorsi sono pochi.
 * @param {PathLink[]} links
 */
export function categoriesOf(links) {
  const used = new Set();
  for (const l of links) for (const c of l.cats) used.add(c);
  const extra = [...used].filter(c => !KNOWN_CATS.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...KNOWN_CATS.filter(c => used.has(c)), ...extra];
}

/**
 * Scrive i percorsi di una sezione sul file condiviso. Rilegge sempre il
 * cloud prima di scrivere e ci innesta dentro la sola sezione toccata: ogni
 * istanza riscrive il file intero, e partire dalla propria copia in memoria
 * sovrascriverebbe quello che è cambiato altrove nel frattempo.
 * I record sono quelli **del file**, non i `PathLink` in memoria: chi scrive
 * dalla colonna Percorsi ci passa l'uscita di `serializeLink`, e il riquadro
 * OneDrive la forma più vecchia con `url`/`urlPc` e basta. Le due si rileggono
 * uguali perché `normalizeLink` le riporta entrambe alla stessa forma; quello
 * che qui dentro non si può fare è trattarle come se fossero già normalizzate.
 * @param {string} sectionId
 * @param {any[]} sectionLinks
 * @param {Record<string, any[]>} known  l'archivio come lo conosce chi chiama
 * @returns {Promise<Record<string, any[]>>} l'archivio da tenere in stato
 */
export async function persistSectionLinks(sectionId, sectionLinks, known) {
  const local = { ...known, [sectionId]: sectionLinks };
  saveLocalLinks(local);
  try {
    const cloud = await loadODLinksFromCloud();
    const base = (cloud && typeof cloud === 'object') ? cloud : local;
    const merged = { ...base, [sectionId]: sectionLinks };
    await saveODLinksToCloud(merged);
    saveLocalLinks(merged);
    return merged;
  } catch (e) {
    console.error('OD sync error', e);
    return local;
  }
}

/**
 * Copia negli appunti, con il ripiego per i browser che non hanno la
 * Clipboard API. Torna `false` se non ce l'ha fatta: la conferma si mostra
 * solo quando la copia è avvenuta davvero.
 * @param {string} text
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch { return false; }
  }
}
