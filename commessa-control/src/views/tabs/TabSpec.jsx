import { useState } from 'react';
import { PRIORITA_COLORS } from '../../config';
import './Tab.css';

const STATI    = ['da_confermare', 'confermato', 'superato'];
const PRIORITA = ['alta', 'media', 'bassa'];
const CATEGORIE = ['architettonico', 'strutturale', 'impiantistico', 'normativo', 'altro'];
function newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); }
const EMPTY = { categoria: 'architettonico', testo: '', priorita: 'media', stato: 'da_confermare', note: '' };
const STATO_COLORS = { da_confermare: '#c8a96e', confermato: '#86c07a', superato: '#666' };

export default function TabSpec({ commessa, mutate }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [filterCat, setFilterCat] = useState('');
  const [filterStato, setFilterStato] = useState('');
  const spec = commessa.spec_cliente || [];
  const filtered = spec.filter(s => (!filterCat || s.categoria === filterCat) && (!filterStato || s.stato === filterStato));

  function addSpec() {
    if (!form.testo) return;
    mutate(c => ({ ...c, spec_cliente: [...(c.spec_cliente || []), { ...form, id: newId() }] }));
    setForm(EMPTY); setAdding(false);
  }
  function updateSpec(id, field, value) { mutate(c => ({ ...c, spec_cliente: (c.spec_cliente || []).map(s => s.id !== id ? s : { ...s, [field]: value }) })); }
  function deleteSpec(id) { if (!confirm('Eliminare questa specifica?')) return; mutate(c => ({ ...c, spec_cliente: (c.spec_cliente || []).filter(s => s.id !== id) })); }

  return (
    <div className="tab-root">
      <div className="tab-toolbar">
        <h3 className="tab-title">Specifiche Cliente</h3>
        <div className="tab-filters">
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">Tutte le categorie</option>
            {CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterStato} onChange={e => setFilterStato(e.target.value)}>
            <option value="">Tutti gli stati</option>
            {STATI.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? '✕ Annulla' : '+ Aggiungi'}</button>
      </div>
      {adding && (
        <div className="spec-add-form">
          <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>{CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select value={form.priorita} onChange={e => setForm(f => ({ ...f, priorita: e.target.value }))}>{PRIORITA.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <input placeholder="Testo specifica *" value={form.testo} onChange={e => setForm(f => ({ ...f, testo: e.target.value }))} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={addSpec}>Aggiungi</button>
        </div>
      )}
      <div className="spec-list">
        {filtered.length === 0 && <div className="tab-empty">Nessuna specifica</div>}
        {filtered.map(s => (
          <div key={s.id} className={`spec-item${s.stato === 'superato' ? ' spec-superata' : ''}`}>
            <div className="spec-badges">
              <span className="badge" style={{ background: (PRIORITA_COLORS[s.priorita] || '#888') + '22', color: PRIORITA_COLORS[s.priorita] || '#888' }}>{s.priorita}</span>
              <span className="badge" style={{ background: (STATO_COLORS[s.stato] || '#888') + '22', color: STATO_COLORS[s.stato] || '#888' }}>{s.stato?.replace('_', ' ')}</span>
              <span className="badge spec-cat">{s.categoria}</span>
            </div>
            <div className="spec-body">
              <p className="spec-testo">{s.testo}</p>
              {s.note && <p className="spec-note">{s.note}</p>}
            </div>
            <div className="spec-actions">
              <select value={s.stato} onChange={e => updateSpec(s.id, 'stato', e.target.value)}>{STATI.map(st => <option key={st} value={st}>{st}</option>)}</select>
              <button className="btn-del" onClick={() => deleteSpec(s.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
