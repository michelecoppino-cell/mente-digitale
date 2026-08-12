// La colonna della concentrazione, nella vista Giorno.
//
// `DayCapacity` è la riga sotto la timeline: quanto della giornata è già
// impegnato, e quanto resta. `FocusSessionPopup` è il menù che appare quando si
// clicca una fascia — cambia tipo o la cancella. Stavano in fondo a
// PlannerView.jsx, che ne era il solo lettore possibile.
import { SESSION_TYPE_LABELS, FOCUS_SESSION_TYPES, t2m } from './plannerGrid';

// Piccolo menu ancorato al punto cliccato: sceglie/cambia il tipo di una
// fascia Pomodoro (lavoro o uno dei tre tipi di pausa) e, per una fascia
// esistente, permette di cancellarla. Un backdrop trasparente a tutto
// schermo chiude il menu al clic fuori, come i pop-up del diagramma GTD.
// Quanto della giornata è già impegnato. Il Piano diceva cosa c'è ma non
// quanto pesa: due ore libere e otto sembravano uguali finché non si contava
// a mano. La barra somma le ore piazzate sulle ore lavorative disponibili.
/**
 * @param {{ blocks: import('./types').PlanBlock[], config: import('./types').PlannerConfig }} props
 */
export function DayCapacity({ blocks, config }) {
  const available = Math.max(0, t2m(config.workdayEnd) - t2m(config.workdayStart));
  const planned = (blocks || [])
    .filter(b => !b.completed)
    .reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const done = (blocks || [])
    .filter(b => b.completed)
    .reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const free = Math.max(0, available - planned - done);

  const pct = (/** @type {number} */ v) => available ? Math.min(100, (v / available) * 100) : 0;
  const fmt = (/** @type {number} */ min) => {
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}min`;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  };

  return (
    <div className="planner-capacity" title={`Giornata lavorativa ${config.workdayStart}–${config.workdayEnd}`}>
      <span className="planner-capacity-text">
        {fmt(planned + done)} pianificate · {fmt(free)} libere
      </span>
      <span className="planner-capacity-bar">
        <span className="planner-capacity-done" style={{ width: `${pct(done)}%` }} />
        <span className="planner-capacity-planned" style={{ width: `${pct(planned)}%` }} />
      </span>
    </div>
  );
}

export function FocusSessionPopup({ popup, onPickType, onDelete, onClose }) {
  const width = 180, height = onDelete ? 190 : 150;
  const left = Math.min(Math.max(8, popup.x + 10), window.innerWidth - width - 8);
  const top  = Math.min(Math.max(8, popup.y - height / 2), window.innerHeight - height - 8);

  return (
    <>
      <div className="planner-focus-popup-backdrop" onClick={onClose} />
      <div className="planner-focus-popup" style={{ left, top }} onClick={e => e.stopPropagation()}>
        <div className="planner-focus-popup-title">
          {popup.mode === 'edit' ? 'Cambia tipo fascia' : 'Aggiungi fascia'}
        </div>
        <div className="planner-focus-popup-types">
          {FOCUS_SESSION_TYPES.map(type => (
            <button
              key={type}
              className={`planner-focus-popup-type ${type}`}
              onClick={() => onPickType(type)}>
              {SESSION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        {onDelete && (
          <button className="planner-focus-popup-delete" onClick={onDelete}>🗑 Elimina fascia</button>
        )}
      </div>
    </>
  );
}
