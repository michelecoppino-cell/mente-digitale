import { useState } from 'react';
import { ELABORATO_COLORS } from '../../config';
import './Tab.css';

const STATI = ['in_corso', 'in_revisione', 'emesso', 'approvato', 'superato'];
const DISCIPLINE = ['architettura', 'struttura', 'impianti', 'paesaggio', 'sicurezza', 'altro'];
function newId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); }
const EMPTY = { codice: '', titolo: '', disciplina: 'architettura', stato: 'in_corso', revisione: '0', data_emissione: '', note: '' };

export default function TabElaborati({ commessa, mutate }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const elaborati = commessa.elaborati || [];

  function addElaborato() {
    if (!form.titolo) return;
    mutate(c => ({ ...c, elaborati: [...(c.elaborati || []), { ...form, id: newId() }] }));
    setForm(EMPTY); setAdding(false);
  }
  function startEdit(e) { setEditId(e.id); setEditForm({ ...e }); }
  function saveEdit() { mutate(c => ({ ...c, elaborati: (c.elaborati || []).map(e => e.id === editId ? { ...editForm } : e) })); setEditId(null); setEditForm(null); }
  function deleteElaborato(id) { if (!confirm('Eliminare questo elaborato?')) return; mutate(c => ({ ...c, elaborati: (c.elaborati || []).filter(e => e.id !== id) })); }

  return (
    <div className="tab-root">
      <div className="tab-toolbar">
        <h3 className="tab-title">Elaborati</h3>
        <button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? '✕ Annulla' : '+ Aggiungi'}</button>
      </div>
      {adding && (
        <div className="elab-add-form">
          <input placeholder="Codice (es. AR-001)" value={form.codice} onChange={e => setForm(f => ({ ...f, codice: e.target.value }))} style={{ width: 120 }} />
          <input placeholder="Titolo *" value={form.titolo} onChange={e => setForm(f => ({ ...f, titolo: e.target.value }))} style={{ flex: 1 }} />
          <select value={form.disciplina} onChange={e => setForm(f => ({ ...f, disciplina: e.target.value }))}>{DISCIPLINE.map(d => <option key={d} value={d}>{d}</option>)}</select>
          <select value={form.stato} onChange={e => setForm(f => ({ ...f, stato: e.target.value }))}>{STATI.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <input placeholder="Rev." value={form.revisione} onChange={e => setForm(f => ({ ...f, revisione: e.target.value }))} style={{ width: 50 }} />
          <button className="btn btn-primary" onClick={addElaborato}>Aggiungi</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Codice</th><th>Titolo</th><th>Disciplina</th><th>Stato</th><th>Rev.</th><th>Data emissione</th><th className="th-action"></th></tr></thead>
          <tbody>
            {elaborati.map(e => (
              editId === e.id ? (
                <tr key={e.id} className="tr-editing">
                  <td><input value={editForm.codice} onChange={ev => setEditForm(f => ({ ...f, codice: ev.target.value }))} /></td>
                  <td><input value={editForm.titolo} onChange={ev => setEditForm(f => ({ ...f, titolo: ev.target.value }))} /></td>
                  <td><select value={editForm.disciplina} onChange={ev => setEditForm(f => ({ ...f, disciplina: ev.target.value }))}>{DISCIPLINE.map(d => <option key={d} value={d}>{d}</option>)}</select></td>
                  <td><select value={editForm.stato} onChange={ev => setEditForm(f => ({ ...f, stato: ev.target.value }))}>{STATI.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><input value={editForm.revisione} onChange={ev => setEditForm(f => ({ ...f, revisione: ev.target.value }))} style={{ width: 50 }} /></td>
                  <td><input type="date" value={editForm.data_emissione || ''} onChange={ev => setEditForm(f => ({ ...f, data_emissione: ev.target.value }))} /></td>
                  <td className="td-actions"><button className="btn btn-primary btn-sm" onClick={saveEdit}>✓</button><button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>✕</button></td>
                </tr>
              ) : (
                <tr key={e.id} onDoubleClick={() => startEdit(e)}>
                  <td className="td-mono">{e.codice || '—'}</td><td>{e.titolo}</td><td className="td-muted">{e.disciplina}</td>
                  <td><span className="badge" style={{ background: (ELABORATO_COLORS[e.stato] || '#888') + '22', color: ELABORATO_COLORS[e.stato] || '#888' }}>{e.stato?.replace('_', ' ')}</span></td>
                  <td className="td-mono">{e.revisione || '—'}</td>
                  <td className="td-muted">{e.data_emissione ? new Date(e.data_emissione).toLocaleDateString('it-IT') : '—'}</td>
                  <td className="td-actions"><button className="btn-edit" onClick={() => startEdit(e)} title="Modifica">✎</button><button className="btn-del" onClick={() => deleteElaborato(e.id)}>✕</button></td>
                </tr>
              )
            ))}
            {elaborati.length === 0 && <tr><td colSpan={7} className="td-empty">Nessun elaborato</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="tab-hint-sm">Doppio click su una riga per modificarla.</p>
    </div>
  );
}
