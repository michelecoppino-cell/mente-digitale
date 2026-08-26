// @ts-check
// Dove sta guardando l'utente quando preme ⌘N.
//
// La destinazione scritta con `@` ha tolto il giro dal chiarimento, ma resta
// da scrivere: se si è già dentro la plancia di una sezione, quale sia la
// sezione l'app lo sa già, e chiederlo è chiedere una cosa che si vede a
// schermo. Da qui esce la destinazione da proporre — proposta, non imposta:
// la chip resta cliccabile e Inbox è sempre la prima voce dell'elenco.
//
// Il legame non è uno a uno. La rotta dà una **sezione** OneNote, mentre un
// task vive in una **lista** To-Do, e una commessa può avere più consegne —
// una lista ciascuna, `GRUPPO.Consegna-YYMMDD` (paraConfig.js). Quindi non si
// propone «la lista della sezione», che spesso non esiste: si propongono
// tutte le sue liste, la prima in cima, e le altre a un tasto di distanza
// nell'elenco. Una sezione senza consegne separate ha una lista sola e la
// scelta non si pone.
import { listsForSection, sectionRole, listLabel, listDeliverableLabel, paraSectionLabel } from './paraConfig';

/** `#/sezioni/<id>` — la rotta è nell'hash, ma react-router dà già il path. */
const SECTION_PATH_RE = /^\/sezioni\/([^/]+)/;

/**
 * Tutte le sezioni di tutti i taccuini, appiattite: l'id della rotta va
 * cercato lì dentro, e i nomi servono interi a `listsForSection` per capire
 * quale lista appartiene a quale sezione.
 * @param {{ id: string, displayName?: string }[]} notebooks
 * @param {Record<string, { id: string, displayName: string }[]>} sectionsMap
 * @returns {{ id: string, displayName: string }[]}
 */
export function flattenSections(notebooks, sectionsMap) {
  const out = [];
  for (const nb of notebooks || []) {
    for (const sec of sectionsMap?.[nb.id] || []) out.push(sec);
  }
  return out;
}

/**
 * @typedef {Object} CaptureContext
 * @property {string} label   il nome della sezione, come si legge in testata
 * @property {import('./captureParse').Destination[]} destinations  le sue liste To-Do
 */

/**
 * La sezione aperta e le sue liste, o null se non si è dentro una sezione
 * (`/oggi`, `/piano`, la mappa…) o se quella sezione non ha nessuna lista —
 * una sezione di sola documentazione non è un posto dove mettere un task.
 *
 * L'etichetta delle liste è quella della consegna quando le consegne sono
 * più d'una: la commessa è già scritta nell'intestazione del gruppo, e
 * ripeterla su ogni riga direbbe tre volte la stessa cosa.
 *
 * @param {string} pathname
 * @param {{ id: string, displayName?: string }[]} notebooks
 * @param {Record<string, { id: string, displayName: string }[]>} sectionsMap
 * @param {{ id: string, displayName: string }[]} todoLists
 * @returns {CaptureContext|null}
 */
export function captureContextFor(pathname, notebooks, sectionsMap, todoLists) {
  const m = SECTION_PATH_RE.exec(pathname || '');
  if (!m) return null;
  const sectionId = decodeURIComponent(m[1]);

  const sections = flattenSections(notebooks, sectionsMap);
  const active = sections.find(s => s.id === sectionId);
  if (!active) return null;

  const names = sections.map(s => s.displayName);
  const lists = listsForSection(active.displayName, todoLists || [], names);
  if (!lists.length) return null;

  const many = lists.length > 1;
  return {
    label: paraSectionLabel(active.displayName),
    destinations: lists.map(l => ({
      id: l.id,
      label: many ? listDeliverableLabel(l.displayName) : listLabel(l.displayName),
      name: l.displayName,
      role: sectionRole(l.displayName),
    })),
  };
}
