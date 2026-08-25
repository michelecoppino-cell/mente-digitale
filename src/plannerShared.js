// @ts-check
// Helpers condivisi tra PlannerView (modalità piano) e TaskPool, così la
// vista task usata nel pannello Attività e quella nella modalità piano
// restano sempre identiche invece di essere duplicate in due file.
//
// Qui vive anche il colore delle liste To-Do: una lista è una sezione OneNote,
// oppure una consegna dentro una commessa (`GRUPPO.Consegna-YYMMDD`, vedi
// paraConfig.js) — e in quel caso prende una sfumatura del colore della sua
// commessa, così le consegne si distinguono restando parenti.

import { listGroupKey, sectionNameForList, sortDeliverableLists } from './paraConfig';

/** @type {import('./types').PlannerConfig} */
export const DEFAULT_CONFIG = {
  projects: [
    { key: 'p1', name: 'Progetto 1', color: '#7eb8c9', todoListNames: [] },
    { key: 'p2', name: 'Progetto 2', color: '#c084a0', todoListNames: [] },
  ],
  workdayStart: '07:30',
  workdayEnd: '19:30',
  // null = nessuna preferenza ancora salvata: si applica il default (tutti i
  // calendari attivi tranne "compleanni"). Una volta che l'utente tocca il
  // filtro, diventa un array esplicito di calendar id nascosti.
  hiddenCalendarIds: null,
};

/**
 * @param {import('./types').TodoTask} task
 * @param {import('./types').PlannerConfig} cfg
 * @returns {import('./types').ProjectConfig|null}
 */
export function findProject(task, cfg) {
  const name = (task._listName || '').toLowerCase();
  for (const p of cfg.projects) {
    if ((p.todoListNames || []).some(n => n.toLowerCase() === name)) return p;
  }
  return null;
}

// Di quanto si scurisce il colore della commessa a ogni consegna successiva:
// un passo di shadeColor vale il 10%, qui se ne usa poco più di mezzo. Deve
// bastare a distinguere due consegne accanto senza che la terza diventi un
// colore diverso da quello della sezione.
const DELIVERABLE_SHADE_STEP = 0.6;

/**
 * Il colore di ogni sezione OneNote, indicizzato per nome di lista To-Do in
 * minuscolo: una lista è una sezione, ed è così che un task risale al proprio
 * colore. Nasce dentro TaskPool — il Piano colora i task così — e vive qui
 * perché anche la vista Attività dipinge le sue colonne con gli stessi colori:
 * due copie della stessa mappa avrebbero preso strade diverse.
 *
 * Passando anche le liste To-Do, la mappa contiene pure le consegne annidate:
 * senza, un task di `2573.A60` non troverebbe il colore di `2573-ABS` e
 * diventerebbe grigio senza che niente segnali l'errore. Ogni consegna prende
 * una sfumatura del colore della commessa, nello stesso ordine in cui la
 * colonna Attività le elenca (scadenza più vicina per prima).
 * @param {import('./types').Notebook[]} notebooks
 * @param {Record<string, import('./types').Section[]>} sectionsMap
 * @param {{ id?: string, displayName: string }[]} [todoLists]
 * @returns {Record<string, string>}
 */
export function buildListColorMap(notebooks = [], sectionsMap = {}, todoLists = []) {
  /** @type {Record<string, string>} */
  const map = {};
  /** @type {string[]} */
  const sectionNames = [];
  for (const nb of notebooks) {
    (sectionsMap[nb.id] || []).forEach((s, i) => {
      map[s.displayName.toLowerCase()] = s._color || shadeColor(nb._color || '#888', i);
      sectionNames.push(s.displayName);
    });
  }

  /** @type {Map<string, { displayName: string }[]>} */
  const perSection = new Map();
  /** @type {Map<string, string>} */
  const groupToSection = new Map();
  for (const l of todoLists) {
    const group = listGroupKey(l.displayName);
    if (!group) continue;                         // lista 1:1: il colore è già quello della sezione
    const section = sectionNameForList(l.displayName, sectionNames);
    if (!section) continue;                       // commessa senza sezione, o ambigua: nessun colore inventato
    const key = section.toLowerCase();
    if (!perSection.has(key)) perSection.set(key, []);
    (perSection.get(key) || []).push(l);
    groupToSection.set(group.toLowerCase(), key);
  }
  for (const [sectionKey, lists] of perSection) {
    const base = map[sectionKey];
    if (!base) continue;
    sortDeliverableLists(lists).forEach((l, i) => {
      map[l.displayName.toLowerCase()] = shadeColor(base, i * DELIVERABLE_SHADE_STEP);
    });
  }
  // Anche la commessa da sola prende un colore: è il ripiego di listColor per
  // una consegna appena creata, che nella mappa ancora non c'è.
  for (const [group, sectionKey] of groupToSection) {
    if (!map[group] && map[sectionKey]) map[group] = map[sectionKey];
  }
  return map;
}

/**
 * Il colore di una lista: il suo, altrimenti quello della commessa a cui
 * appartiene. Il ripiego sul gruppo serve quando la mappa è stata costruita
 * senza le liste (o la consegna è appena nata): meglio il colore della
 * commessa che il grigio di «non trovato».
 * @param {string|null|undefined} listName
 * @param {Record<string, string>} colorMap
 * @param {string} [fallback]
 * @returns {string}
 */
export function listColor(listName, colorMap, fallback = '#888') {
  const key = (listName || '').toLowerCase();
  if (colorMap[key]) return colorMap[key];
  const group = listGroupKey(listName);
  if (group && colorMap[group.toLowerCase()]) return colorMap[group.toLowerCase()];
  return fallback;
}

/**
 * @param {string|null|undefined} hex
 * @param {number} alpha
 * @returns {string}
 */
export function hexToRgba(hex, alpha) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  const r = (num >> 16) & 0xFF, g = (num >> 8) & 0xFF, b = num & 0xFF;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * @param {string|null|undefined} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  return { r: (num >> 16) & 0xFF, g: (num >> 8) & 0xFF, b: num & 0xFF };
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v) || 0));
  return `#${[clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {string|null|undefined} hex
 * @param {number} step
 * @returns {string}
 */
export function shadeColor(hex, step) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  const f = 1 - step * 0.1;
  const r = Math.min(255, Math.max(20, Math.round(((num >> 16) & 0xFF) * f)));
  const g = Math.min(255, Math.max(20, Math.round(((num >> 8) & 0xFF) * f)));
  const b = Math.min(255, Math.max(20, Math.round((num & 0xFF) * f)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Scadenza dei task ToDo (dueDateTime) — formattazione e ordinamento condivisi
// tra TaskPool e Panel, così la data appare identica ovunque venga mostrata.
/**
 * @param {import('./types').GraphDateTime|null|undefined} dueDateTime
 * @returns {string|null}
 */
export function formatDueDate(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return null;
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

// Scadenza di una consegna (non di un task): giorno intero, quindi si scrive
// per esteso e si accompagna con quanto manca — «31/08/2026 · fra 6 giorni».
/**
 * @param {Date|null|undefined} due
 * @returns {string|null}
 */
export function formatDeliverableDue(due) {
  if (!due) return null;
  return due.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Giorni che mancano a una scadenza: 0 è oggi, negativo è passato.
 * @param {Date|null|undefined} due
 * @returns {number|null}
 */
export function daysUntil(due) {
  if (!due) return null;
  const today = new Date().setHours(0, 0, 0, 0);
  const day = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((day - today) / 86400000);
}

/**
 * «scaduta da 3 giorni», «oggi», «fra 6 giorni»: come si legge il tempo che
 * resta a una consegna.
 * @param {number|null} days
 * @returns {string|null}
 */
export function daysUntilLabel(days) {
  if (days === null) return null;
  if (days === 0) return 'oggi';
  if (days === 1) return 'domani';
  if (days === -1) return 'ieri';
  if (days < 0) return `scaduta da ${-days} giorni`;
  return `fra ${days} giorni`;
}

// Timestamp per ordinare per scadenza — i task senza scadenza vanno in fondo.
/**
 * @param {import('./types').GraphDateTime|null|undefined} dueDateTime
 * @returns {number}
 */
export function dueDateSortValue(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return Infinity;
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
}

/**
 * @param {import('./types').GraphDateTime|null|undefined} dueDateTime
 * @returns {boolean}
 */
export function isTaskOverdue(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return false;
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dueDay.getTime() < new Date().setHours(0, 0, 0, 0);
}
