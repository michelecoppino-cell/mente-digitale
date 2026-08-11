// @ts-check
// Chiarimento di un'attività: un solo passaggio che assegna contesto, sezione,
// durata e stato.
//
// È il passo 2 del flusso, e l'unico modo di uscire da Inbox: un task catturato
// è solo testo, e per stare in una qualunque delle altre colonne gli servono
// almeno una sezione e uno stato. Le diramazioni del metodo (sotto i 2 minuti,
// dipende da altri, non adesso, cestino) sono i bottoni in fondo, non altre
// schermate.
import { useState } from 'react';
import {
  completeTask, deleteTask, moveTaskToList, updateTaskBody,
  updateTaskCategories, updateTaskStatus, updateTaskTitle,
} from './api';
import {
  CONTEXTS, ESTIMATE_CHOICES, DEFAULT_ESTIMATE_MIN, graphStatusFor,
  noteText, parseWaitingFor, taskContext, taskEstimateMin,
  withEstimateMarker, withWaitingFor, withContext,
} from './taskModel';
import { sectionRole, paraSectionLabel } from './paraConfig';
import './ClarifyTaskModal.css';

/** Gli stati raggiungibili dal chiarimento. `scheduled` non c'è: una data si
 *  dà dal Piano, trascinando l'attività su un'ora. */
const OUTCOMES = [
  { key: 'next',    label: 'Prossima azione', hint: 'Fattibile, senza data' },
  { key: 'waiting', label: 'In attesa',       hint: 'Dipende da qualcun altro' },
  { key: 'someday', label: 'Un giorno',       hint: 'Non adesso' },
];

/** Le liste To-Do raggruppate come sono nella mappa PARA. */
function groupLists(/** @type {import('./types').TodoList[]} */ lists) {
  return [
    { label: 'Progetti', items: lists.filter(l => !sectionRole(l.displayName)) },
    { label: 'Aree',     items: lists.filter(l => sectionRole(l.displayName) === 'area') },
    { label: 'Risorse',  items: lists.filter(l => sectionRole(l.displayName) === 'resources') },
  ].filter(g => g.items.length > 0);
}

/**
 * @param {Object} props
 * @param {import('./types').TodoTask|null} props.task
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {() => void} props.onClose
 * @param {(oldTask: import('./types').TodoTask, newTask: import('./types').TodoTask|null) => void} props.onSaved
 * @param {(task: import('./types').TodoTask) => void} props.onRemoved
 */
export default function ClarifyTaskModal({ task, todoLists, onClose, onSaved, onRemoved }) {
  const [title, setTitle] = useState('');
  const [context, setContext] = useState(/** @type {string|null} */ (null));
  const [listId, setListId] = useState('');
  const [estimate, setEstimate] = useState(DEFAULT_ESTIMATE_MIN);
  const [outcome, setOutcome] = useState('next');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState('');

  // Ricarica i campi quando si apre su un task diverso. Aggiustamento durante
  // il render e non un effetto — stessa convenzione già in uso in TaskPool:
  // un effetto qui farebbe vedere per un fotogramma i campi del task
  // precedente.
  // Parte da null e non da `task`: se il modale monta con un task già in mano
  // (non è così in App, ma lo è ovunque lo si monti condizionalmente), con
  // `useState(task)` i due sarebbero già uguali al primo render e i campi
  // resterebbero vuoti.
  const [prevTask, setPrevTask] = useState(/** @type {import('./types').TodoTask|null} */ (null));
  if (task !== prevTask) {
    setPrevTask(task);
    if (task) {
      setTitle(task.title || '');
      setContext(taskContext(task));
      setListId(task._listId || '');
      setEstimate(taskEstimateMin(task));
      setOutcome(task.status === 'waitingOnOthers' ? 'waiting' : task.status === 'deferred' ? 'someday' : 'next');
      setWho(parseWaitingFor(task)?.who || '');
      setNote(noteText(task.body?.content));
      setError('');
      setBusy(null);
    }
  }

  if (!task) return null;

  // Copia locale non annullabile: dentro le funzioni async qui sotto TypeScript
  // perde il restringimento fatto dalla guardia, e ogni uso di `task`
  // tornerebbe "forse null".
  const t = task;

  const groups = groupLists(todoLists);
  // Senza sezione il task non ha un posto dove stare: è l'unico campo che
  // il chiarimento pretende davvero.
  const canSave = !!listId && !!title.trim();

  /** Il corpo delle note con dentro stima e attesa, ricomposto da zero. */
  function composeBody() {
    let body = withEstimateMarker(note, estimate);
    body = withWaitingFor(body, outcome === 'waiting' ? (who.trim() || 'qualcuno') : null);
    return body;
  }

  async function save() {
    if (!canSave || busy) return;
    setBusy('save');
    setError('');
    try {
      const body = composeBody();
      const status = graphStatusFor(/** @type {any} */ (outcome));
      const categories = withContext(t, context);

      if (listId !== t._listId) {
        // Cambiare sezione vuol dire cambiare lista To-Do, e Graph non ha una
        // "move": moveTaskToList ricrea e cancella, portandosi dietro anche le
        // sottoattività. Le passiamo il task già aggiornato, così non serve
        // una seconda tornata di PATCH su quello nuovo.
        const moved = await moveTaskToList(t._listId || '', listId, {
          ...t,
          title: title.trim(),
          body: { content: body, contentType: 'text' },
          status,
          categories,
        });
        const listName = todoLists.find(l => l.id === listId)?.displayName;
        onSaved(t, { ...moved, _listId: listId, _listName: listName });
      } else {
        const lid = t._listId || '';
        if (title.trim() !== t.title) await updateTaskTitle(lid, t.id, title.trim());
        await updateTaskBody(lid, t.id, body);
        await updateTaskCategories(lid, t.id, categories);
        if (status !== t.status) await updateTaskStatus(lid, t.id, status);
        onSaved(t, {
          ...t,
          title: title.trim(),
          body: { content: body, contentType: 'text' },
          status,
          categories,
        });
      }
      onClose();
    } catch (e) {
      console.error('chiarimento: salvataggio', e);
      setError('Non è riuscito a salvare. Riprova.');
      setBusy(null);
    }
  }

  // Sotto i due minuti: si fa subito e si chiude da qui, senza passare da una
  // sezione. È l'unica uscita che non richiede di aver scelto dove metterla.
  async function doNow() {
    if (busy) return;
    setBusy('now');
    try {
      await completeTask(t._listId || '', t.id);
      onRemoved(t);
      onClose();
    } catch (e) {
      console.error('chiarimento: completamento', e);
      setError('Non è riuscito a completarla. Riprova.');
      setBusy(null);
    }
  }

  async function trash() {
    if (busy) return;
    setBusy('trash');
    try {
      await deleteTask(t._listId || '', t.id);
      onRemoved(t);
      onClose();
    } catch (e) {
      console.error('chiarimento: eliminazione', e);
      setError('Non è riuscito a eliminarla. Riprova.');
      setBusy(null);
    }
  }

  return (
    <div className="clarify-overlay" onClick={onClose}>
      <div className="clarify" onClick={e => e.stopPropagation()} role="dialog" aria-label="Chiarisci l'attività">
        <div className="clarify-head">
          <span className="eyebrow">Chiarisci</span>
          <button className="clarify-close tap-44" onClick={onClose} title="Chiudi">✕</button>
        </div>

        <input
          className="clarify-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Di cosa si tratta?"
          autoFocus
        />

        <label className="clarify-field">
          <span className="eyebrow">Contesto</span>
          <div className="clarify-chips">
            {CONTEXTS.map(c => (
              <button
                key={c.key}
                className={`clarify-chip${context === c.key ? ' active' : ''}`}
                style={/** @type {import('react').CSSProperties} */ ({ '--chip': c.color })}
                onClick={() => setContext(context === c.key ? null : c.key)}>
                {c.label}
              </button>
            ))}
          </div>
        </label>

        <label className="clarify-field">
          <span className="eyebrow">Sezione</span>
          <select className="clarify-select" value={listId} onChange={e => setListId(e.target.value)}>
            <option value="">Scegli una sezione…</option>
            {groups.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map(l => (
                  <option key={l.id} value={l.id}>{paraSectionLabel(l.displayName)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="clarify-field">
          <span className="eyebrow">Quanto ci vuole</span>
          <div className="clarify-chips">
            {ESTIMATE_CHOICES.map(c => (
              <button
                key={c.min}
                className={`clarify-chip${estimate === c.min ? ' active' : ''}`}
                onClick={() => setEstimate(c.min)}>
                {c.label}
              </button>
            ))}
          </div>
        </label>

        <div className="clarify-field">
          <span className="eyebrow">Dove finisce</span>
          <div className="clarify-outcomes">
            {OUTCOMES.map(o => (
              <button
                key={o.key}
                className={`clarify-outcome${outcome === o.key ? ' active' : ''}`}
                onClick={() => setOutcome(o.key)}>
                <span className="clarify-outcome-label">{o.label}</span>
                <span className="clarify-outcome-hint">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {outcome === 'waiting' && (
          <label className="clarify-field">
            <span className="eyebrow">Da chi aspetti</span>
            <input
              className="clarify-input"
              value={who}
              onChange={e => setWho(e.target.value)}
              placeholder="Nome della persona"
            />
          </label>
        )}

        <label className="clarify-field">
          <span className="eyebrow">Nota</span>
          <textarea
            className="clarify-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Quello che serve ricordare"
          />
        </label>

        {error && <div className="clarify-error">{error}</div>}

        <div className="clarify-actions">
          <button className="clarify-btn ghost" onClick={doNow} disabled={!!busy}>
            {busy === 'now' ? '…' : 'Fatta, ci ho messo 2 minuti'}
          </button>
          <button className="clarify-btn danger" onClick={trash} disabled={!!busy}>
            {busy === 'trash' ? '…' : 'Cestino'}
          </button>
          <button className="clarify-btn primary" onClick={save} disabled={!canSave || !!busy}>
            {busy === 'save' ? 'Salvo…' : 'Chiarita'}
          </button>
        </div>
      </div>
    </div>
  );
}
