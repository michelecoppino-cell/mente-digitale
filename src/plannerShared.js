// Helpers condivisi tra PlannerView (modalità piano) e TaskPool, così la
// vista task usata nel pannello Attività e quella nella modalità piano
// restano sempre identiche invece di essere duplicate in due file.

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

export function findProject(task, cfg) {
  const name = (task._listName || '').toLowerCase();
  for (const p of cfg.projects) {
    if ((p.todoListNames || []).some(n => n.toLowerCase() === name)) return p;
  }
  return null;
}

export function hexToRgba(hex, alpha) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  const r = (num >> 16) & 0xFF, g = (num >> 8) & 0xFF, b = num & 0xFF;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function hexToRgb(hex) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  return { r: (num >> 16) & 0xFF, g: (num >> 8) & 0xFF, b: num & 0xFF };
}

export function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v) || 0));
  return `#${[clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

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
export function formatDueDate(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return null;
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

// Timestamp per ordinare per scadenza — i task senza scadenza vanno in fondo.
export function dueDateSortValue(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return Infinity;
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
}

export function isTaskOverdue(dueDateTime) {
  const iso = dueDateTime?.dateTime;
  if (!iso) return false;
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dueDay.getTime() < new Date().setHours(0, 0, 0, 0);
}
