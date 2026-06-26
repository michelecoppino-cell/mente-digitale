import { useState, useEffect } from 'react';
import { loadCommesseIndex, saveCommesseIndex, saveCommessa, loadCommessa, getTodoLists, createTodoList } from '../api';
import { cacheGet, cacheSet, cacheClear, TTL } from '../cache';
import { STATO_COLORS } from '../config';
import CommessaFormModal from '../components/CommessaFormModal';
import './CommessaList.css';

function calcMiniKpi(c) {
  const ore = (c.ore_segnate || []).reduce((s, r) => s + (r.ore || 0), 0);
  const budgetOre = c.contratto?.budget_ore || 0;
  const fatturato = c.contratto?.fatturato || 0;
  const importo = c.contratto?.importo_totale || 0;
  const aiAperti = (c.mom || []).flatMap(m => (m.action_items || []).filter(a => !a.completato)).length;
  const elaboratiPendenti = (c.elaborati || []).filter(e => e.stato !== 'emesso' && e.stato !== 'approvato').length;
  return {
    pctOre:    budgetOre > 0 ? Math.round((ore / budgetOre) * 100) : null,
    pctBudget: importo   > 0 ? Math.round((fatturato / importo) * 100) : null,
    aiAperti, elaboratiPendenti,
  };
}

export default function CommessaList({ onSelect, account }) {
  const [index, setIndex] = useState(null);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [formModal, setFormModal] = useState(false);

  useEffect(() => { loadIndex(); }, []);

  async function loadIndex(force = false) {
    setLoading(true);
    try {
      let idx = force ? null : cacheGet('commesse_index');
      if (!idx) { idx = await loadCommesseIndex(); cacheSet('commesse_index', idx, TTL.COMMESSE_INDEX); }
      setIndex(idx);
      loadAllDetails(idx.commesse || []);
    } catch (e) { console.error(e); setIndex({ version: 1, commesse: [] }); }
    finally { setLoading(false); }
  }

  async function loadAllDetails(commesse) {
    for (const c of commesse.filter(c => c.stato !== 'archiviata')) {
      const key = `commessa_${c.id}`;
      let d = cacheGet(key);
      if (!d) { try { d = await loadCommessa(c.id); if (d) cacheSet(key, d, TTL.COMMESSA); } catch {} }
      if (d) setDetails(prev => ({ ...prev, [c.id]: d }));
    }
  }

  async function handleCreate(data) {
    try {
      let lists = []; try { lists = await getTodoLists(); } catch {}
      let existing = lists.find(l => l.displayName.toLowerCase() === data.nome.toLowerCase());
      if (!existing) { try { existing = await createTodoList(data.nome); } catch {} }
      const withList = { ...data, todo_list_id: existing?.id || null };
      await saveCommessa(withList.id, withList);
      const newEntry = { id: withList.id, nome: withList.nome, cliente: withList.cliente, codice: withList.codice, stato: withList.stato, data_inizio: withList.contratto.data_inizio, data_fine_prevista: withList.contratto.data_fine, todo_list_id: withList.todo_list_id, aggiornata_il: new Date().toISOString() };
      const newIndex = { ...index, commesse: [...(index.commesse || []), newEntry] };
      await saveCommesseIndex(newIndex);
      cacheClear();
      setIndex(newIndex);
      setDetails(prev => ({ ...prev, [withList.id]: withList }));
      setFormModal(false);
      onSelect(withList.id);
    } catch (e) { alert('Errore salvataggio: ' + e.message); }
  }

  const commesse = (index?.commesse || []).filter(c => c.stato !== 'archiviata');
  const archiviate = (index?.commesse || []).filter(c => c.stato === 'archiviata');

  return (
    <div className="cl-root">
      <header className="cl-header">
        <div className="cl-logo">
          <span className="cl-logo-icon">📋</span>
          <span className="cl-logo-text">Commessa Control</span>
        </div>
        <div className="cl-header-right">
          {account && <span className="cl-user">{account.name || account.username}</span>}
          <button className="btn btn-primary" onClick={() => setFormModal(true)}>+ Nuova Commessa</button>
          <button className="btn btn-ghost cl-refresh" onClick={() => loadIndex(true)} title="Ricarica">↺</button>
        </div>
      </header>
      <main className="cl-main">
        {loading && !index && <div className="cl-empty">Caricamento commesse…</div>}
        {!loading && commesse.length === 0 && !archiviate.length && (
          <div className="cl-empty">
            <div className="cl-empty-icon">📂</div>
            <p>Nessuna commessa. Crea la prima!</p>
            <button className="btn btn-primary" onClick={() => setFormModal(true)}>+ Nuova Commessa</button>
          </div>
        )}
        {commesse.length > 0 && (
          <>
            <h2 className="cl-section-title">Commesse attive</h2>
            <div className="cl-grid">
              {commesse.map(c => {
                const d = details[c.id];
                const kpi = d ? calcMiniKpi(d) : null;
                return (
                  <button key={c.id} className="cl-card" onClick={() => onSelect(c.id)}>
                    <div className="cl-card-top">
                      <div className="cl-card-info">
                        <div className="cl-card-name">{c.nome}</div>
                        <div className="cl-card-cliente">{c.cliente}</div>
                        {c.codice && <div className="cl-card-codice">{c.codice}</div>}
                      </div>
                      <span className="badge cl-stato-badge" style={{ background: (STATO_COLORS[c.stato] || '#888') + '22', color: STATO_COLORS[c.stato] || '#888' }}>{c.stato?.replace('_', ' ')}</span>
                    </div>
                    {kpi && (
                      <div className="cl-card-kpi">
                        {kpi.pctOre != null && <div className="cl-mini-kpi"><div className="cl-mini-label">Ore</div><div className="cl-mini-bar-wrap"><div className="cl-mini-bar" style={{ width: `${Math.min(kpi.pctOre, 100)}%`, background: kpi.pctOre >= 90 ? '#c07a7a' : kpi.pctOre >= 70 ? '#c8a96e' : '#7eb8c9' }} /></div><div className="cl-mini-pct">{kpi.pctOre}%</div></div>}
                        {kpi.pctBudget != null && <div className="cl-mini-kpi"><div className="cl-mini-label">Budget</div><div className="cl-mini-bar-wrap"><div className="cl-mini-bar" style={{ width: `${Math.min(kpi.pctBudget, 100)}%`, background: kpi.pctBudget >= 90 ? '#c07a7a' : kpi.pctBudget >= 70 ? '#c8a96e' : '#86c07a' }} /></div><div className="cl-mini-pct">{kpi.pctBudget}%</div></div>}
                        <div className="cl-card-badges">
                          {kpi.aiAperti > 0 && <span className="badge" style={{ background: '#c8a96e22', color: '#c8a96e' }}>{kpi.aiAperti} action</span>}
                          {kpi.elaboratiPendenti > 0 && <span className="badge" style={{ background: '#7eb8c922', color: '#7eb8c9' }}>{kpi.elaboratiPendenti} elab.</span>}
                        </div>
                      </div>
                    )}
                    {!d && <div className="cl-card-loading">…</div>}
                    {c.data_fine_prevista && <div className="cl-card-date">Scadenza: {new Date(c.data_fine_prevista).toLocaleDateString('it-IT')}</div>}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {archiviate.length > 0 && (
          <>
            <h2 className="cl-section-title cl-muted">Archiviate ({archiviate.length})</h2>
            <div className="cl-grid cl-archived">
              {archiviate.map(c => (
                <button key={c.id} className="cl-card cl-card-archived" onClick={() => onSelect(c.id)}>
                  <div className="cl-card-name">{c.nome}</div>
                  <div className="cl-card-cliente">{c.cliente}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
      {formModal && <CommessaFormModal onSave={handleCreate} onClose={() => setFormModal(false)} />}
    </div>
  );
}
