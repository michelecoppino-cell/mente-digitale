import { useState, useEffect } from 'react';
import { getTodoLists, getTodoTasks, loadPlannerConfig } from './api';
import { queryClient, qk, STALE } from './queryClient';
import TaskPool from './TaskPool';
import { DEFAULT_CONFIG } from './plannerShared';

// Pannello "Attività" — il pulsante nel dock in basso lo apre a scomparsa sul
// lato sinistro. Mostra solo la vista "Task", identica alla colonna sinistra
// della modalità piano (nessuna vista duplicata). Il calendario vive nella
// modalità piano (vista Mese). Il pulsante di espansione apre il Piano intero.
export default function SchedulePanel({ open, onClose, onExpand, preloadedTasks, onSelectSection, notebooks, sectionsMap }) {
  const [tasks, setTasks] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (preloadedTasks) { setTasks(preloadedTasks); return; }
    if (open && !tasks.length) load();
  }, [open, preloadedTasks]); // eslint-disable-line

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const cfg = await queryClient.fetchQuery({ queryKey: qk.plannerConfig(), queryFn: loadPlannerConfig, staleTime: STALE.plannerConfig });
        if (cfg) setConfig(cfg);
      } catch (e) { console.error('planner config load', e); }
    })();
  }, [open]);

  async function load() {
    setLoadError(false);
    try {
      const lists = await getTodoLists();
      const allTasks = [];
      let anyError = false;
      for (const l of lists) {
        try {
          const t = await getTodoTasks(l.id);
          allTasks.push(...t.map(x => ({ ...x, _listName: l.displayName, _listId: l.id })));
        } catch (e) { console.error('load tasks', l.displayName, e); anyError = true; }
        await new Promise(r => setTimeout(r, 150));
      }
      setTasks(allTasks);
      if (anyError) setLoadError(true);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    }
  }

  function handleTaskClick(task) {
    setSelectedTaskId(task.id);
    if (!onSelectSection || !task._listName) return;
    const lower = task._listName.toLowerCase();
    for (const [nbId, sects] of Object.entries(sectionsMap || {})) {
      const sec = sects.find(s => s.displayName.toLowerCase() === lower);
      if (sec) { onSelectSection(sec, { id: nbId, _color: '#c8a96e' }, 'todo'); return; }
    }
  }

  return (
    <div className={`schedule-panel ${open?'open':''}`}>
      <div className="schedule-head">
        <h2 className="schedule-panel-title">Attività</h2>
        {onExpand && (
          <button className="schedule-expand-btn" onClick={onExpand} title="Apri il Piano completo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
      </div>

      <div className="schedule-panel-inner">
        {/* Vista Task — identica alla colonna sinistra della modalità piano */}
        <div className="schedule-tasks-section">
          {loadError && (
            <div className="schedule-load-error">
              Errore di caricamento — dati non aggiornati. <button onClick={load}>Riprova</button>
            </div>
          )}
          <TaskPool
            title="Task"
            tasks={tasks}
            config={config}
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            selectedTaskId={selectedTaskId}
            onTaskClick={handleTaskClick}
            draggable={false}
          />
        </div>
      </div>
      <button className="panel-close-tab" onClick={onClose} title="Chiudi">—</button>
    </div>
  );
}
