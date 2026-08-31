// @ts-check
// Il pannello di dettaglio di un'attività, come cassetto: da destra su schermo
// largo, dal basso da telefono.
//
// Il Piano ha una terza colonna dove ospitare il dettaglio; Attività e Sezioni
// no. Invece di dare a ognuna la sua idea di «apri un'attività» — finora, in
// Attività, un salto al vecchio pannello di sezione — le due viste montano da
// qui lo stesso pannello del Piano, con dentro note, sottoattività, stima,
// stato e rinomina.
import { useEffect } from 'react';
import TaskDetailPanel from './TaskDetailPanel';
import './TaskDetailDrawer.css';

/**
 * @param {Object} props
 * @param {import('./taskStore').Task|null} props.task
 * @param {() => void} props.onClose
 * @param {import('./types').Notebook[]} [props.notebooks]
 * @param {Record<string, import('./types').Section[]>} [props.sectionsMap]
 * @param {{ current: Record<string, import('./types').Page[]> }|null} [props.pagesCache]
 * @param {() => void} [props.onCompleted]
 * @param {() => void} [props.onDeleted]
 * @param {(title: string) => void} [props.onRenamed]
 * @param {(scadenza: string|null) => void} [props.onDueChanged]
 * @param {(patch: Object) => void} [props.onPatched]
 * @param {(listId: string, task: import('./taskStore').Task) => void} [props.onRestored]
 * @param {string} [props.status]
 * @param {(t: import('./taskStore').Task) => void} [props.onSchedule]
 * @param {(t: import('./taskStore').Task) => Promise<void>|void} [props.onUnschedule]
 */
export default function TaskDetailDrawer({ task, onClose, ...rest }) {
  useEffect(() => {
    if (!task) return undefined;
    /** @param {KeyboardEvent} e */
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task, onClose]);

  if (!task) return null;

  return (
    <>
      <div className="tdd-scrim" onClick={onClose} />
      <aside className="tdd" role="dialog" aria-label={`Dettaglio di ${task.titolo}`}>
        <TaskDetailPanel task={task} onClose={onClose} {...rest} />
      </aside>
    </>
  );
}
