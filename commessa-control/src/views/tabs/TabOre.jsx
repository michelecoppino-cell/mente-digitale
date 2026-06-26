import { useState } from 'react';
import './Tab.css';

const CATEGORIE = ['progettazione', 'coordinamento', 'direzione_lavori', 'riunione', 'admin', 'altro'];
const CAT_COLORS = { progettazione: '#7eb8c9', coordinamento: '#c084a0', direzione_lavori: '#86c07a', riunione: '#c8a96e', admin: '#a084c8', altro: '#888' };
function newId() { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4); }
const EMPTY_ROW = { data: '', risorsa: '', categoria: 'progettazione', ore: '', descrizione: '' };

export default function TabOre({ commessa, mutate }) {
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState(EMPTY_ROW);
  const [sortKey, setSortKey] = useState('data');
  const [sortDir, setSortDir] = useState(-1);
  const ore = commessa.ore_segnate || [];
  const sorted = [...ore].sort((a, b) => { const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? ''; return sortDir * (av < bv ? -1 : av > bv ? 1 : 0); });
  const totale = ore.reduce((s, r) => s + (parseFloat(r.ore) || 0), 0);
  function toggleSort(key) { setSortDir(s => sortKey === key ? -s : -1); setSortKey(key); }
  function addRow() {
    if (!newRow.risorsa || !newRow.ore) return;
    mutate(c => ({ ...c, ore_segnate: [...(c.ore_segnate || []), { ...newRow, id: newId(), ore: parseFloat(newRow.ore) }] }));
    setNewRow(EMPTY_ROW); setAdding(false);
  }
  function deleteRow(id) {
    if (!confirm('Eliminare questa riga?')) return;
    mutate(c => ({ ...c, ore_segnate: (c.ore_segnate || []).filter(r => r.id !== id) }));
  }
  const SortIcon = ({ k }) => sortKey === k ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
  return (
    <div className="tab-root">
      <div className="tab-toolbar">
        <h3 className="tab-title">Ore segnate</h3>
        <button className="btn btn-primary" onClick={() => setAdding(a => !a)}>{adding ? '✕ Annulla' : '+ Aggiungi'}</button>
      </div>
      {adding && (
        <div className="ore-add-form">
          <input type="date" value={newRow.data} onChange={e => setNewRow(r => ({ ...r, data: e.target.value }))} />
          <input placeholder="Risorsa" value={newRow.risorsa} onChange={e => setNewRow(r => ({ ...r, risorsa: e.target.value }))} />
          <select value={newRow.categoria} onChange={e => setNewRow(r => ({ ...r, categoria: e.target.value }))}>{CATEGORIE.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <input type="number" min="0" step="0.5" placeholder="Ore" value={newRow.ore} onChange={e => setNewRow(r => ({ ...r, ore: e.target.value }))} style={{ width: 70 }} />
          <input placeholder="Descrizione (opz.)" value={newRow.descrizione} onChange={e => setNewRow(r => ({ ...r, descrizione: e.target.value }))} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={addRow}>Aggiungi</button>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <th className="sortable" onClick={() => toggleSort('data')}>Data<SortIcon k="data" /></th>
            <th className="sortable" onClick={() => toggleSort('risorsa')}>Risorsa<SortIcon k="risorsa" /></th>
            <th className="sortable" onClick={() => toggleSort('categoria')}>Categoria<SortIcon k="categoria" /></th>
            <th className="sortable th-num" onClick={() => toggleSort('ore')}>Ore<SortIcon k="ore" /></th>
            <th>Descrizione</th><th className="th-action"></th>
          </tr></thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id}>
                <td>{r.data ? new Date(r.data).toLocaleDateString('it-IT') : '—'}</td>
                <td>{r.risorsa}</td>
                <td><span className="badge" style={{ background: (CAT_COLORS[r.categoria] || '#888') + '22', color: CAT_COLORS[r.categoria] || '#888' }}>{r.categoria}</span></td>
                <td className="td-num">{r.ore}</td>
                <td className="td-muted">{r.descrizione}</td>
                <td><button className="btn-del" onClick={() => deleteRow(r.id)}>✕</button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={6} className="td-empty">Nessuna riga</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3} className="tf-label">Totale</td><td className="td-num tf-total">{totale.toFixed(1)}h</td><td colSpan={2}></td></tr></tfoot>
        </table>
      </div>
      {commessa.contratto?.budget_ore > 0 && (
        <div className="ore-summary">
          <span>Budget ore: <strong>{commessa.contratto.budget_ore}h</strong></span>
          <span>Consumate: <strong>{totale.toFixed(1)}h</strong></span>
          <span>Rimanenti: <strong style={{ color: totale > commessa.contratto.budget_ore ? '#c07a7a' : '#86c07a' }}>{(commessa.contratto.budget_ore - totale).toFixed(1)}h</strong></span>
        </div>
      )}
    </div>
  );
}
