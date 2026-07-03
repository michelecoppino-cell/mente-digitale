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
};

export function findProject(task, cfg) {
  const name = (task._listName || '').toLowerCase();
  for (const p of cfg.projects) {
    if ((p.todoListNames || []).some(n => n.toLowerCase() === name)) return p;
  }
  return null;
}

export function shadeColor(hex, step) {
  const num = parseInt((hex || '#888888').replace('#', ''), 16);
  const f = 1 - step * 0.1;
  const r = Math.min(255, Math.max(20, Math.round(((num >> 16) & 0xFF) * f)));
  const g = Math.min(255, Math.max(20, Math.round(((num >> 8) & 0xFF) * f)));
  const b = Math.min(255, Math.max(20, Math.round((num & 0xFF) * f)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
