// @ts-check
import { useEffect, useState, useRef } from 'react';
import { subscribeUndo, undoLast } from './undo';
import './UndoToast.css';

const VISIBLE_MS = 8000;

/** @param {Element|null} el */
function isEditableTarget(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || /** @type {HTMLElement} */ (el).isContentEditable;
}

// Banner "Annulla" in basso a schermo + scorciatoia globale Ctrl+Z (Cmd+Z su
// Mac). Non intercetta Ctrl+Z quando il focus è su un campo di testo, per non
// rubare l'undo nativo del browser dentro gli input.
export default function UndoToast() {
  const [entry, setEntry] = useState(/** @type {import('./undo').VoceUndo|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hideTimerRef = useRef(/** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined));

  // La `subscribeUndo` restituisce la funzione per disiscriversi, e va
  // restituita così com'è: `useEffect` vuole `void` o una funzione di pulizia,
  // e `Set.delete` risponde un booleano.
  useEffect(() => subscribeUndo(e => {
    setError('');
    setEntry(e);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setEntry(prev => (prev?.id === e.id ? null : prev));
    }, VISIBLE_MS);
  }), []);


  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (!isUndo || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      runUndo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function runUndo() {
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
  }

  if (!entry) return null;

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-label">{entry.label}</span>
      {error && <span className="undo-toast-error">{error}</span>}
      <button className="undo-toast-btn" disabled={busy} onClick={runUndo}>
        {busy ? '…' : 'Annulla (Ctrl+Z)'}
      </button>
    </div>
  );
}
