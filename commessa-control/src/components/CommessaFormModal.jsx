import { useState } from 'react';
import './modals.css';

const STATI = ['offerta', 'in_corso', 'sospesa', 'chiusa', 'archiviata'];

function newId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export default function CommessaFormModal({ commessa, onSave, onClose }) {
  const isNew = !commessa;
  const [form, setForm] = useState({
    id:        commessa?.id || newId(),
    nome:      commessa?.nome || '',
    cliente:   commessa?.cliente || '',
    codice:    commessa?.codice || '',
    stato:     commessa?.stato || 'offerta',
    data_inizio:         commessa?.contratto?.data_inizio || '',
    data_fine:           commessa?.contratto?.data_fine || '',
    importo_totale:      commessa?.contratto?.importo_totale || '',
    tariffa_oraria_media:commessa?.contratto?.tariffa_oraria_media || '',
    budget_ore:          commessa?.contratto?.budget_ore || '',
    fatturato:           commessa?.contratto?.fatturato || '',
    saldo_contabile:     commessa?.contratto?.saldo_contabile || '',
    note_contratto:      commessa?.contratto?.note || '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.nome.trim()) return;
    const data = {
      id:     form.id,
      nome:   form.nome.trim(),
      cliente:form.cliente.trim(),
      codice: form.codice.trim(),
      stato:  form.stato,
      todo_list_id: commessa?.todo_list_id || null,
      contratto: {
        data_inizio:          form.data_inizio || null,
        data_fine:            form.data_fine || null,
        importo_totale:       parseFloat(form.importo_totale) || 0,
        tariffa_oraria_media: parseFloat(form.tariffa_oraria_media) || 0,
        budget_ore:           parseFloat(form.budget_ore) || 0,
        fatturato:            parseFloat(form.fatturato) || 0,
        saldo_contabile:      parseFloat(form.saldo_contabile) || 0,
        note:                 form.note_contratto,
      },
      ore_segnate:  commessa?.ore_segnate  || [],
      mom:          commessa?.mom          || [],
      spec_cliente: commessa?.spec_cliente || [],
      elaborati:    commessa?.elaborati    || [],
    };
    onSave(data);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h2>{isNew ? 'Nuova Commessa' : 'Modifica Commessa'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <fieldset>
            <legend>Anagrafica</legend>
            <div className="form-row">
              <label>Nome commessa *</label>
              <input value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="es. Ristrutturazione Via Roma" required />
            </div>
            <div className="form-row2">
              <div className="form-row">
                <label>Cliente</label>
                <input value={form.cliente} onChange={e => set('cliente', e.target.value)} placeholder="Ragione sociale" />
              </div>
              <div className="form-row">
                <label>Codice</label>
                <input value={form.codice} onChange={e => set('codice', e.target.value)} placeholder="2024-001" />
              </div>
            </div>
            <div className="form-row">
              <label>Stato</label>
              <select value={form.stato} onChange={e => set('stato', e.target.value)}>
                {STATI.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </fieldset>

          <fieldset>
            <legend>Contratto</legend>
            <div className="form-row2">
              <div className="form-row">
                <label>Data inizio</label>
                <input type="date" value={form.data_inizio} onChange={e => set('data_inizio', e.target.value)} />
              </div>
              <div className="form-row">
                <label>Data fine prevista</label>
                <input type="date" value={form.data_fine} onChange={e => set('data_fine', e.target.value)} />
              </div>
            </div>
            <div className="form-row2">
              <div className="form-row">
                <label>Importo totale (€)</label>
                <input type="number" min="0" step="0.01" value={form.importo_totale} onChange={e => set('importo_totale', e.target.value)} placeholder="0" />
              </div>
              <div className="form-row">
                <label>Fatturato (€)</label>
                <input type="number" min="0" step="0.01" value={form.fatturato} onChange={e => set('fatturato', e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="form-row2">
              <div className="form-row">
                <label>Budget ore (h)</label>
                <input type="number" min="0" step="1" value={form.budget_ore} onChange={e => set('budget_ore', e.target.value)} placeholder="0" />
              </div>
              <div className="form-row">
                <label>Tariffa oraria media (€/h)</label>
                <input type="number" min="0" step="0.01" value={form.tariffa_oraria_media} onChange={e => set('tariffa_oraria_media', e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="form-row">
              <label>Note contratto</label>
              <textarea rows={2} value={form.note_contratto} onChange={e => set('note_contratto', e.target.value)} />
            </div>
          </fieldset>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn btn-primary">{isNew ? 'Crea commessa' : 'Salva modifiche'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
