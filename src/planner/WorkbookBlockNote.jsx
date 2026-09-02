// @ts-nocheck — non ancora controllato dai tipi, come il resto del Piano da
// cui viene. Vedi la nota in jsconfig.json.
// Una nota libera dentro un blocco workbook.
//
// La usano tutte e due le viste che disegnano i blocchi, il Giorno e la
// Settimana: sta in un file suo per questo — quando viveva in fondo a
// `PlannerView.jsx` era una funzione sola che le due si passavano per il fatto
// di stare nello stesso file, e separando la Settimana sarebbe rimasta di là.

import { useEffect, useRef, useState } from 'react';

// Nota libera dentro un workbook block: ancorata a un offset verticale
// (note.top, px dal bordo superiore del blocco) invece che a un orario, così
// si può segnare "caffè" o "pranzo" in un punto preciso di una fascia larga
// (es. "Ufficio" 8–17:30) senza spezzarla in blocchi separati. Testo libero
// con a-capo (textarea), riposizionabile trascinando la maniglia ⠿.
export function WorkbookBlockNote({ note, blockHeight, onChange, onMove, onRemove }) {
  const [editing, setEditing] = useState(!note.text);
  const [draft, setDraft]     = useState(note.text);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft.trim() === note.text.trim() && note.text) return;
    onChange(draft);
  }

  function handleDragHandleMouseDown(e) {
        e.preventDefault();
    e.stopPropagation();
    const startY   = e.clientY;
    const startTop = note.top;
    function onMove_(ev) {
      const nextTop = Math.max(0, Math.min(Math.max(0, blockHeight - 22), startTop + (ev.clientY - startY)));
      onMove(nextTop);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove_);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove_);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div className="planner-block-note" style={{ top: note.top }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="planner-block-note-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') { setDraft(note.text); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.currentTarget.blur(); }
          }}
        />
      ) : (
        <>
                      <span className="planner-block-note-drag" onMouseDown={handleDragHandleMouseDown} title="Trascina per riposizionare">⠿</span>
          
          <pre className="planner-block-note-text" onClick={() => setEditing(true)}>{note.text}</pre>
                      <button className="planner-block-note-remove" onClick={onRemove} title="Elimina nota">×</button>
          
        </>
      )}
    </div>
  );
}
