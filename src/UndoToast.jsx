import { useCallback, useEffect, useState, useRef } from 'react';
import { subscribeUndo, undoLast } from './undo';
import './UndoToast.css';

const VISIBLE_MS = 8000;

function isEditableTarget(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// Banner "Annulla" in basso a schermo + scorciatoia globale Ctrl+Z (Cmd+Z su
// Mac). Non intercetta Ctrl+Z quando il focus è su un campo di testo, per non
// rubare l'undo nativo del browser dentro gli input.
export default function UndoToast() {
  const [entry, setEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hideTimerRef = useRef(null);

  useEffect(() => subscribeUndo(e => {
    setError('');
    setEntry(e);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setEntry(prev => (prev?.id === e.id ? null : prev));
    }, VISIBLE_MS);
  }), []);

  // Dichiarata prima dell'effetto che la usa, e stabile: prima era una funzione
  // dichiarata *sotto* — l'ascoltatore di Ctrl+Z la catturava per hoisting, che
  // funziona ma è la stessa forma che nasconde una chiusura vecchia appena si
  // aggiunge una dipendenza. Qui la relazione è esplicita.
  const runUndo = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const done = await undoLast();
      if (done) {
        clearTimeout(hideTimerRef.current);
        setEntry(null);
      }
    } catch (e) {
      console.error('undo', e);
      setError('Annullamento non riuscito, riprova.');
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (!isUndo || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      runUndo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runUndo]);

  // Il timer va fermato anche allo smontaggio, non solo alla voce successiva.
  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  if (!entry) return null;

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span className="undo-toast-label">{entry.label}</span>
      {error && <span className="undo-toast-error">{error}</span>}
      <button className="undo-toast-btn" disabled={busy} onClick={runUndo}>
        {busy ? '…' : 'Annulla (Ctrl+Z)'}
      </button>
    </div>
  );
}
