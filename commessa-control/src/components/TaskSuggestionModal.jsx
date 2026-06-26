import { useState } from 'react';
import './modals.css';

const PRIORITA_COLOR = { alta: '#c07a7a', media: '#c8a96e', bassa: '#7eb8c9' };

export default function TaskSuggestionModal({ suggerimenti, listName, onConfirm, onClose }) {
  const [items, setItems] = useState(
    suggerimenti.map(s => ({ ...s, checked: true, titleEdited: s.titolo, dateEdited: s.scadenza_suggerita || '' }))
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  function toggle(i) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it));
  }
  function editTitle(i, v) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, titleEdited: v } : it));
  }
  function editDate(i, v) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, dateEdited: v } : it));
  }

  async function handleConfirm() {
    const selected = items.filter(it => it.checked);
    if (!selected.length) { onClose(); return; }
    setSaving(true);
    try {
      const count = await onConfirm(selected.map(it => ({
        title: it.titleEdited,
        dueDateTime: it.dateEdited || undefined,
        notes: it.contesto || undefined,
      })));
      setDone(count);
    } catch (e) {
      alert('Errore: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const checkedCount = items.filter(i => i.checked).length;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-wide">
        <div className="modal-header">
          <h2>Task suggeriti da AI</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {done != null ? (
          <div className="task-confirm-done">
            <div className="done-icon">✓</div>
            <p>{done} task aggiunti alla lista <strong>“{listName}”</strong></p>
            <button className="btn btn-primary" onClick={onClose}>Chiudi</button>
          </div>
        ) : (
          <>
            <p className="task-modal-sub">
              Verifica e modifica i task, poi confermali per aggiungerli a Microsoft To-Do
              nella lista <strong>“{listName}”</strong>.
            </p>
            <div className="task-suggestion-list">
              {items.map((it, i) => (
                <div key={i} className={`task-suggestion-item${it.checked ? ' checked' : ''}`}>
                  <label className="ts-check">
                    <input type="checkbox" checked={it.checked} onChange={() => toggle(i)} />
                  </label>
                  <div className="ts-body">
                    <div className="ts-row1">
                      <input
                        className="ts-title"
                        value={it.titleEdited}
                        onChange={e => editTitle(i, e.target.value)}
                        disabled={!it.checked}
                      />
                      <span className="badge" style={{ background: PRIORITA_COLOR[it.priorita] + '33', color: PRIORITA_COLOR[it.priorita] }}>
                        {it.priorita}
                      </span>
                    </div>
                    {it.contesto && <div className="ts-context">{it.contesto}</div>}
                    <div className="ts-row2">
                      <label className="ts-date-label">Scadenza:</label>
                      <input
                        type="date"
                        className="ts-date"
                        value={it.dateEdited}
                        onChange={e => editDate(i, e.target.value)}
                        disabled={!it.checked}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={saving || checkedCount === 0}
              >
                {saving ? 'Creazione…' : `Aggiungi ${checkedCount} task a To-Do`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
