// @ts-check
// Helpers condivisi tra PlannerView (modalità piano) e TaskPool, così la
// vista task usata nel pannello Attività e quella nella modalità piano
// restano sempre identiche invece di essere duplicate in due file.

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

// La griglia del Piano è a mezz'ore: ogni durata ci si allinea. Stava dentro
// PlannerView insieme alle conversioni orario↔minuti, ma da quando la stima di
// un task e l'altezza del suo blocco sono la stessa cosa quei conti servono
// anche fuori — ad Attività, che riscala i blocchi già a piano, e a Oggi.
export const SNAP_MIN = 30;

/** Minuti da mezzanotte di una "HH:MM". @param {string} t @returns {number} */
export function timeToMinutes(t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "HH:MM" da minuti da mezzanotte. @param {number} min @returns {string} */
export function minutesToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Una durata portata alla mezz'ora della griglia, arrotondando in su: mezz'ora
 * è anche il minimo, perché un blocco più basso non si legge.
 * @param {number} minutes
 * @returns {number}
 */
export function snapMinutes(minutes) {
  return Math.max(SNAP_MIN, Math.ceil(minutes / SNAP_MIN) * SNAP_MIN);
}

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

/**
 * Il colore di ogni sezione OneNote, indicizzato per nome di lista To-Do in
 * minuscolo: una lista è una sezione, ed è così che un task risale al proprio
 * colore. Nasce dentro TaskPool — il Piano colora i task così — e vive qui
 * perché anche la vista Attività dipinge le sue colonne con gli stessi colori:
 * due copie della stessa mappa avrebbero preso strade diverse.
 * @param {import('./types').Notebook[]} notebooks
 * @param {Record<string, import('./types').Section[]>} sectionsMap
 * @returns {Record<string, string>}
 */
export function buildListColorMap(notebooks = [], sectionsMap = {}) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const nb of notebooks) {
    (sectionsMap[nb.id] || []).forEach((s, i) => {
      map[s.displayName.toLowerCase()] = s._color || shadeColor(nb._color || '#888', i);
    });
  }
  return map;
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
