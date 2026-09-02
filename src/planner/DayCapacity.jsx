// @ts-check
// La barra della capacità della giornata: quanto della giornata lavorativa è
// già pianificato, quanto è stato fatto, quanto resta libero.
//
// Serve a una domanda sola, e a rispondervi prima di aggiungere l'ennesima
// cosa: ci sta? Le ore già fatte e quelle ancora da fare si distinguono,
// perché una giornata piena a mezzogiorno e una piena alle diciotto non sono
// la stessa giornata.

import { t2m } from './griglia.js';
import { durataDistesa } from '../tempo.js';

// Quanto della giornata è già impegnato. Il Piano diceva cosa c'è ma non
// quanto pesa: due ore libere e otto sembravano uguali finché non si contava
// a mano. La barra somma le ore piazzate sulle ore lavorative disponibili.
/**
 * @param {{ blocks: import('../types').PlanBlock[], config: import('../types').PlannerConfig }} props
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
  const fmt = durataDistesa;

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
