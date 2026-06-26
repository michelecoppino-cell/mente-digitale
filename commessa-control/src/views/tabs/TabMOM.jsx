import { useState } from 'react';
import { createTaskFull } from '../../api';
import './Tab.css';

function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); }
const EMPTY_MEETING = { titolo: '', data: '', partecipanti: '', note: '' };
const EMPTY_AI      = { testo: '', assegnato_a: '', scadenza: '' };

export default function TabMOM({ commessa, mutate }) {
  const [expanded, setExpanded] = useState(null);
  const [addingMeeting, setAddingMeeting] = useState(false);
  const [newMeeting, setNewMeeting] = useState(EMPTY_MEETING);
  const [addingAI, setAddingAI] = useState(null);
  const [newAI, setNewAI] = useState(EMPTY_AI);
  const [todoStatus, setTodoStatus] = useState({});
  const moms = [...(commessa.mom || [])].sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  function addMeeting() {
    if (!newMeeting.titolo) return;
    const m = { id: newId('m'), titolo: newMeeting.titolo, data: newMeeting.data || new Date().toISOString().slice(0, 10), partecipanti: newMeeting.partecipanti.split(',').map(s => s.trim()).filter(Boolean), note: newMeeting.note, action_items: [] };
    mutate(c => ({ ...c, mom: [...(c.mom || []), m] }));
    setNewMeeting(EMPTY_MEETING); setAddingMeeting(false); setExpanded(m.id);
  }
  function deleteMeeting(id) { if (!confirm('Eliminare questo meeting?')) return; mutate(c => ({ ...c, mom: (c.mom || []).filter(m => m.id !== id) })); }
  function toggleAIComplete(meetingId, aiId) { mutate(c => ({ ...c, mom: (c.mom || []).map(m => m.id !== meetingId ? m : { ...m, action_items: (m.action_items || []).map(ai => ai.id !== aiId ? ai : { ...ai, completato: !ai.completato }) }) })); }
  function addAI(meetingId) {
    if (!newAI.testo) return;
    const ai = { id: newId('ai'), testo: newAI.testo, assegnato_a: newAI.assegnato_a, scadenza: newAI.scadenza, completato: false, todo_task_id: null };
    mutate(c => ({ ...c, mom: (c.mom || []).map(m => m.id !== meetingId ? m : { ...m, action_items: [...(m.action_items || []), ai] }) }));
    setNewAI(EMPTY_AI); setAddingAI(null);
  }
  function deleteAI(meetingId, aiId) { mutate(c => ({ ...c, mom: (c.mom || []).map(m => m.id !== meetingId ? m : { ...m, action_items: (m.action_items || []).filter(ai => ai.id !== aiId) }) })); }
  async function sendToTodo(meetingId, ai) {
    if (!commessa.todo_list_id) { alert('Configura prima la lista To-Do per questa commessa.'); return; }
    setTodoStatus(s => ({ ...s, [ai.id]: 'loading' }));
    try {
      const task = await createTaskFull(commessa.todo_list_id, { title: `[${commessa.codice || commessa.nome}] ${ai.testo}`, dueDateTime: ai.scadenza || undefined, notes: `Action item da MOM — Assegnato a: ${ai.assegnato_a || 'N/D'}` });
      mutate(c => ({ ...c, mom: (c.mom || []).map(m => m.id !== meetingId ? m : { ...m, action_items: (m.action_items || []).map(a => a.id !== ai.id ? a : { ...a, todo_task_id: task?.id || 'created' }) }) }));
      setTodoStatus(s => ({ ...s, [ai.id]: 'done' }));
    } catch (e) { setTodoStatus(s => ({ ...s, [ai.id]: 'error' })); alert('Errore: ' + e.message); }
  }

  return (
    <div className="tab-root">
      <div className="tab-toolbar">
        <h3 className="tab-title">Verbali (MOM)</h3>
        <button className="btn btn-primary" onClick={() => setAddingMeeting(a => !a)}>{addingMeeting ? '✕ Annulla' : '+ Nuovo verbale'}</button>
      </div>
      {addingMeeting && (
        <div className="mom-add-form">
          <div className="form-row2">
            <div className="form-row"><label>Titolo *</label><input value={newMeeting.titolo} onChange={e => setNewMeeting(m => ({ ...m, titolo: e.target.value }))} placeholder="es. Riunione avanzamento #3" /></div>
            <div className="form-row"><label>Data</label><input type="date" value={newMeeting.data} onChange={e => setNewMeeting(m => ({ ...m, data: e.target.value }))} /></div>
          </div>
          <div className="form-row"><label>Partecipanti (separati da virgola)</label><input value={newMeeting.partecipanti} onChange={e => setNewMeeting(m => ({ ...m, partecipanti: e.target.value }))} placeholder="Mario, Sig. Rossi" /></div>
          <div className="form-row"><label>Note</label><textarea rows={2} value={newMeeting.note} onChange={e => setNewMeeting(m => ({ ...m, note: e.target.value }))} /></div>
          <button className="btn btn-primary" onClick={addMeeting}>Salva verbale</button>
        </div>
      )}
      <div className="mom-list">
        {moms.length === 0 && <div className="tab-empty">Nessun verbale. Aggiungine uno!</div>}
        {moms.map(m => {
          const aiAperti = (m.action_items || []).filter(a => !a.completato).length;
          const isOpen = expanded === m.id;
          return (
            <div key={m.id} className="mom-item">
              <div className="mom-header" onClick={() => setExpanded(isOpen ? null : m.id)}>
                <div className="mom-info">
                  <span className="mom-toggle">{isOpen ? '▾' : '▸'}</span>
                  <span className="mom-date">{m.data ? new Date(m.data).toLocaleDateString('it-IT') : '—'}</span>
                  <span className="mom-title">{m.titolo}</span>
                  {m.partecipanti?.length > 0 && <span className="mom-partecipanti">{m.partecipanti.join(', ')}</span>}
                </div>
                <div className="mom-meta">
                  {aiAperti > 0 && <span className="badge" style={{ background: '#c8a96e22', color: '#c8a96e' }}>{aiAperti} action</span>}
                  <button className="btn-del" onClick={e => { e.stopPropagation(); deleteMeeting(m.id); }}>✕</button>
                </div>
              </div>
              {isOpen && (
                <div className="mom-body">
                  {m.note && <p className="mom-note">{m.note}</p>}
                  <div className="mom-ai-section">
                    <div className="mom-ai-header">
                      <span className="mom-ai-title">Action items</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => setAddingAI(addingAI === m.id ? null : m.id)}>{addingAI === m.id ? '✕' : '+ Aggiungi'}</button>
                    </div>
                    {addingAI === m.id && (
                      <div className="ai-add-form">
                        <input placeholder="Testo action item *" value={newAI.testo} onChange={e => setNewAI(a => ({ ...a, testo: e.target.value }))} style={{ flex: 1 }} />
                        <input placeholder="Assegnato a" value={newAI.assegnato_a} onChange={e => setNewAI(a => ({ ...a, assegnato_a: e.target.value }))} style={{ width: 130 }} />
                        <input type="date" value={newAI.scadenza} onChange={e => setNewAI(a => ({ ...a, scadenza: e.target.value }))} style={{ width: 140 }} />
                        <button className="btn btn-primary btn-sm" onClick={() => addAI(m.id)}>OK</button>
                      </div>
                    )}
                    <div className="ai-list">
                      {(m.action_items || []).length === 0 && <span className="tab-empty-sm">Nessun action item</span>}
                      {(m.action_items || []).map(ai => {
                        const isScaduto = !ai.completato && ai.scadenza && new Date(ai.scadenza) < new Date();
                        const ts = todoStatus[ai.id];
                        return (
                          <div key={ai.id} className={`ai-row${ai.completato ? ' ai-done' : ''}${isScaduto ? ' ai-scaduto' : ''}`}>
                            <input type="checkbox" checked={ai.completato} onChange={() => toggleAIComplete(m.id, ai.id)} />
                            <span className="ai-testo">{ai.testo}</span>
                            {ai.assegnato_a && <span className="ai-chip">{ai.assegnato_a}</span>}
                            {ai.scadenza && <span className={`ai-chip${isScaduto ? ' ai-chip-red' : ''}`}>{new Date(ai.scadenza).toLocaleDateString('it-IT')}</span>}
                            {!ai.completato && (ai.todo_task_id ? <span className="ai-todo-done">✓ To-Do</span> : <button className="btn btn-ghost btn-sm ai-todo-btn" onClick={() => sendToTodo(m.id, ai)} disabled={ts === 'loading'}>{ts === 'loading' ? '…' : '→ To-Do'}</button>)}
                            <button className="btn-del" onClick={() => deleteAI(m.id, ai.id)}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
