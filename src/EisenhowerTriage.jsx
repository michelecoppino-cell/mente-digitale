import { useState, useEffect, useRef } from 'react';
import { getTask, updateTaskBody } from './api';
import { EIS_QUADRANTS, parseEisenhower, withEisenhowerMarker } from './eisenhower';
import './EisenhowerTriage.css';

// Smistamento mattutino: mostra i task non ancora classificati uno alla volta
// e li assegna a un quadrante Eisenhower, salvando subito nelle note del task.
export default function EisenhowerTriage({ open, onClose, tasks = [] }) {
  const [queue, setQueue]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [index, setIndex]         = useState(0);
  const [saving, setSaving]       = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelledRef.current = false;
    setLoading(true);
    setIndex(0);
    setDoneCount(0);
    buildQueue();
    return () => { cancelledRef.current = true; };
  }, [open]); // eslint-disable-line

  async function buildQueue() {
    const unclassified = [];
    for (const t of tasks) {
      if (cancelledRef.current) return;
      let body = t.body?.content;
      if (body === undefined) {
        try {
          const full = await getTask(t._listId, t.id);
          body = full.body?.content || '';
          await new Promise(r => setTimeout(r, 120));
        } catch (e) {
          console.error('eisenhower fetch task', t.id, e);
          body = '';
        }
      }
      if (!parseEisenhower(body)) unclassified.push({ ...t, _body: body || '' });
    }
    if (!cancelledRef.current) {
      setQueue(unclassified);
      setLoading(false);
    }
  }

  async function assign(quadrant) {
    const task = queue[index];
    if (!task || saving) return;
    setSaving(true);
    try {
      const newBody = withEisenhowerMarker(task._body, quadrant);
      await updateTaskBody(task._listId, task.id, newBody);
      setDoneCount(c => c + 1);
      setIndex(i => i + 1);
    } catch (e) {
      console.error('eisenhower assign', e);
    }
    setSaving(false);
  }

  function skip() {
    setIndex(i => i + 1);
  }

  if (!open) return null;

  const current  = queue[index];
  const finished = !loading && (queue.length === 0 || index >= queue.length);

  return (
    <div className="eis-overlay" onClick={onClose}>
      <div className="eis-modal" onClick={e => e.stopPropagation()}>
        <div className="eis-header">
          <span>🧭 Smistamento Eisenhower</span>
          <button className="eis-close" onClick={onClose} title="Chiudi">✕</button>
        </div>

        <div className="eis-body">
          {loading && <div className="eis-status">Analisi task in corso…</div>}

          {!loading && finished && (
            <div className="eis-status">
              {queue.length === 0
                ? 'Tutti i task sono già classificati. Ottimo lavoro!'
                : `Fatto! ${doneCount} task classificati.`}
              <button className="eis-done-btn" onClick={onClose}>Chiudi</button>
            </div>
          )}

          {!loading && !finished && current && (
            <>
              <div className="eis-progress">{index + 1} / {queue.length}</div>
              <div className="eis-task-card">
                <div className="eis-task-list">{current._listName}</div>
                <div className="eis-task-title">{current.title}</div>
              </div>
              <div className="eis-quadrants">
                {EIS_QUADRANTS.map(q => (
                  <button
                    key={q.key}
                    className="eis-quadrant-btn"
                    style={{ '--q-color': q.color }}
                    disabled={saving}
                    onClick={() => assign(q.key)}>
                    <span className="eis-quadrant-key">{q.key}</span>
                    <span className="eis-quadrant-label">{q.label}</span>
                    <span className="eis-quadrant-short">{q.short}</span>
                  </button>
                ))}
              </div>
              <button className="eis-skip-btn" onClick={skip} disabled={saving}>Salta per ora</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
