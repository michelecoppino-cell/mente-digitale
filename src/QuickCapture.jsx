// @ts-check
// Cattura: una riga di testo, e il pensiero è fuori dalla testa.
//
// Il punto del passo 1 del flusso è che non chieda niente. Prima ⌘N apriva
// l'albero di decisione (dove la metto? è azionabile? in che sezione?), che è
// il passo 2: farlo mentre si sta facendo altro è il motivo per cui le cose
// non si catturano. Qui il task nasce nella lista di default di To-Do — la
// colonna Inbox — e la si chiarisce dopo, quando c'è tempo.
//
// "Decidi ora" resta per quando invece si sa già dove va: apre l'albero di
// decisione di sempre, con il testo già scritto dentro.
import { useState } from 'react';
import { createTask } from './api';
import { inboxListId } from './taskModel';
import { useDialog } from './useDialog';
import './QuickCapture.css';

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {() => void} props.onClose
 * @param {(task: import('./types').TodoTask) => void} props.onCaptured
 * @param {(text: string) => void} props.onDecideNow
 */
export default function QuickCapture({ open, todoLists, onClose, onCaptured, onDecideNow }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Il componente resta montato anche a finestra chiusa (`open` falso ⇒ render
  // nullo), quindi lo stato sopravvive fra un'apertura e l'altra: senza questo
  // azzeramento la seconda cattura partiva con `busy` o l'errore della prima.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setText(''); setBusy(false); setError(''); }
  }
  // Escape, Tab che resta dentro, e il fuoco che torna dove era: vedi useDialog.
  const boxRef = useDialog(open, onClose);

  if (!open) return null;

  const inboxId = inboxListId(todoLists);

  async function capture() {
    const title = text.trim();
    if (!title || busy) return;
    if (!inboxId) {
      setError('Non trovo la lista predefinita di To-Do. Usa «Decidi ora» e scegli una sezione.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const list = todoLists.find(l => l.id === inboxId);
      const task = await createTask(inboxId, title);
      onCaptured({ ...task, _listId: inboxId, _listName: list?.displayName });
      setText('');
      setBusy(false);
      onClose();
    } catch (e) {
      console.error('cattura', e);
      setError('Non è riuscito a salvarla. Riprova.');
      setBusy(false);
    }
  }

  return (
    <div className="qc-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="qc"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cattura un pensiero">
        <span className="eyebrow">Cattura</span>
        <textarea
          className="qc-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Invio manda, Maiusc+Invio va a capo: catturare è un gesto solo.
            // (Escape lo gestisce useDialog, per tutta la modale e non solo per
            // questo campo.)
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); capture(); }
          }}
          placeholder="Cosa ti è venuto in mente?"
          rows={3}
          autoFocus
        />
        <p className="qc-hint">Finisce in Inbox. La chiarisci dopo, da Attività.</p>

        {error && <div className="qc-error">{error}</div>}

        <div className="qc-actions">
          <button
            className="qc-btn"
            onClick={() => { onDecideNow(text.trim()); setText(''); onClose(); }}
            disabled={busy}>
            Decidi ora
          </button>
          <button className="qc-btn primary" onClick={capture} disabled={!text.trim() || busy}>
            {busy ? 'Salvo…' : 'Cattura'}
          </button>
        </div>
      </div>
    </div>
  );
}
