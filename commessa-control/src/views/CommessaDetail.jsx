import { useState, useEffect, useRef, useCallback } from 'react';
import { loadCommessa, saveCommessa, loadCommesseIndex, saveCommesseIndex, createTaskFull } from '../api';
import { cacheGet, cacheSet, cacheClear, TTL } from '../cache';
import CommessaFormModal from '../components/CommessaFormModal';
import TaskSuggestionModal from '../components/TaskSuggestionModal';
import TabDashboard from './tabs/TabDashboard';
import TabOre from './tabs/TabOre';
import TabMOM from './tabs/TabMOM';
import TabElaborati from './tabs/TabElaborati';
import TabSpec from './tabs/TabSpec';
import TabAI from './tabs/TabAI';
import './CommessaDetail.css';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ore',       label: 'Ore' },
  { id: 'mom',       label: 'MOM' },
  { id: 'elaborati', label: 'Elaborati' },
  { id: 'spec',      label: 'Spec Cliente' },
  { id: 'ai',        label: '❖ AI' },
];

export default function CommessaDetail({ commessaId, onBack, account }) {
  const [commessa, setCommessa]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saveStatus, setSaveStatus]   = useState('idle');
  const [activeTab, setActiveTab]     = useState('dashboard');
  const [editModal, setEditModal]     = useState(false);
  const [analisi, setAnalisi]         = useState(null);
  const [taskModal, setTaskModal]     = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => { loadDetail(); }, [commessaId]);

  async function loadDetail(force = false) {
    setLoading(true);
    try {
      const key = `commessa_${commessaId}`;
      let d = force ? null : cacheGet(key);
      if (!d) { d = await loadCommessa(commessaId); if (d) cacheSet(key, d, TTL.COMMESSA); }
      setCommessa(d);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  const scheduleSave = useCallback((updated) => {
    setSaveStatus('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveCommessa(updated.id, updated);
        cacheSet(`commessa_${updated.id}`, updated, TTL.COMMESSA);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) { setSaveStatus('error'); console.error(e); }
    }, 1500);
  }, []);

  function mutate(updater) {
    setCommessa(prev => {
      const updated = updater(prev);
      scheduleSave(updated);
      return updated;
    });
  }

  async function handleEditSave(data) {
    setCommessa(data);
    scheduleSave(data);
    try {
      const idx = await loadCommesseIndex();
      const updated = { ...idx, commesse: (idx.commesse || []).map(c => c.id === data.id ? { ...c, nome: data.nome, cliente: data.cliente, codice: data.codice, stato: data.stato, data_inizio: data.contratto.data_inizio, data_fine_prevista: data.contratto.data_fine, aggiornata_il: new Date().toISOString() } : c) };
      await saveCommesseIndex(updated);
      cacheClear();
    } catch {}
    setEditModal(false);
  }

  async function handleConfirmTasks(tasks) {
    const listId = commessa.todo_list_id;
    if (!listId) throw new Error('Lista To-Do non configurata per questa commessa');
    let created = 0;
    for (const t of tasks) { await createTaskFull(listId, t); created++; }
    return created;
  }

  if (loading) return <div className="cd-loading">Caricamento commessa…</div>;
  if (!commessa) return <div className="cd-loading">Commessa non trovata.</div>;

  const saveLabel = saveStatus === 'saving' ? 'Salvataggio…' : saveStatus === 'saved' ? 'Salvato ✓' : saveStatus === 'error' ? 'Errore!' : saveStatus === 'pending' ? '●' : '';

  return (
    <div className="cd-root">
      <header className="cd-header">
        <button className="btn btn-ghost cd-back" onClick={onBack}>← Commesse</button>
        <div className="cd-title-area">
          <span className="cd-title">{commessa.nome}</span>
          {commessa.cliente && <span className="cd-subtitle">{commessa.cliente}</span>}
        </div>
        <div className="cd-header-right">
          {saveLabel && <span className="cd-save-status">{saveLabel}</span>}
          <button className="btn btn-ghost cd-edit" onClick={() => setEditModal(true)}>✎ Modifica</button>
          <button className="btn btn-ghost cd-refresh" onClick={() => loadDetail(true)} title="Ricarica">↺</button>
        </div>
      </header>
      <nav className="cd-tabs">
        {TABS.map(t => <button key={t.id} className={`cd-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
      </nav>
      <div className="cd-body">
        {activeTab === 'dashboard' && <TabDashboard commessa={commessa} analisi={analisi} />}
        {activeTab === 'ore'       && <TabOre commessa={commessa} mutate={mutate} />}
        {activeTab === 'mom'       && <TabMOM commessa={commessa} mutate={mutate} />}
        {activeTab === 'elaborati' && <TabElaborati commessa={commessa} mutate={mutate} />}
        {activeTab === 'spec'      && <TabSpec commessa={commessa} mutate={mutate} />}
        {activeTab === 'ai'        && <TabAI commessa={commessa} analisi={analisi} onAnalisi={setAnalisi} onSuggestTasks={setTaskModal} />}
      </div>
      {editModal && <CommessaFormModal commessa={commessa} onSave={handleEditSave} onClose={() => setEditModal(false)} />}
      {taskModal && <TaskSuggestionModal suggerimenti={taskModal} listName={commessa.nome} onConfirm={handleConfirmTasks} onClose={() => setTaskModal(null)} />}
    </div>
  );
}
