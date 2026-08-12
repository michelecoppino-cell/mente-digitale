import { useState, useEffect } from 'react';
import { loadODLinksFromCloud, saveODLinksToCloud } from './api';

const LOCAL_KEY = 'onedrive_links_v2';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function saveLocal(obj) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch { /* quota piena — ignora */ }
}

// Riquadro OneDrive di una sezione (elenco link + form aggiungi/modifica).
// Usato sia nel Panel di sezione (ToDo/OneNote/OneDrive) sia nel pannello
// Dettagli task del Piano — stesso componente, stessi dati su OneDrive.
export default function OneDriveBox({ sectionId, color = 'var(--accent)' }) {
  const [odLinks, setOdLinks]     = useState(loadLocal());
  const [odSyncing, setOdSyncing] = useState(false);
  const [addingOD, setAddingOD]   = useState(false);
  const [newODName, setNewODName] = useState('');
  const [newODUrl, setNewODUrl]   = useState('');
  const [newODUrlPc, setNewODUrlPc] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);

  useEffect(() => {
    loadODLinksFromCloud()
      .then(cloud => { if (cloud && typeof cloud === 'object') { setOdLinks(cloud); saveLocal(cloud); } })
      .catch(e => console.error('OD links sync', e));
  }, []);

  // Riceve solo i link della sezione corrente e li innesta nel file appena
  // riletto dal cloud: ogni istanza (Panel, Dettagli task, altre schede o
  // dispositivi) riscrive l'intero file, e partire dalla propria copia in
  // stato avrebbe sovrascritto le modifiche fatte altrove nel frattempo.
  async function persist(sectionLinks) {
    const localNext = { ...odLinks, [sectionId]: sectionLinks };
    setOdLinks(localNext);
    saveLocal(localNext);
    setOdSyncing(true);
    try {
      const cloud = await loadODLinksFromCloud();
      const base = (cloud && typeof cloud === 'object') ? cloud : localNext;
      const merged = { ...base, [sectionId]: sectionLinks };
      await saveODLinksToCloud(merged);
      setOdLinks(merged);
      saveLocal(merged);
    } catch (e) { console.error('OD sync error', e); }
    setOdSyncing(false);
  }

  function resetForm() {
    setNewODName(''); setNewODUrl(''); setNewODUrlPc('');
    setEditingIdx(null); setAddingOD(false);
  }

  async function handleSubmit() {
    if (editingIdx !== null) { await handleSaveEdit(); return; }
    if (!newODName.trim()) return;
    const existing = odLinks[sectionId] || [];
    const updated = [...existing, {
      name: newODName.trim(),
      url: newODUrl.trim() || null,
      urlPc: newODUrlPc.trim() || null,
    }];
    resetForm();
    await persist(updated);
  }

  function handleStartEdit(idx) {
    const link = odLinks[sectionId]?.[idx];
    if (!link) return;
    setNewODName(link.name);
    setNewODUrl(link.url || '');
    setNewODUrlPc(link.urlPc || '');
    setEditingIdx(idx);
    setAddingOD(true);
  }

  async function handleSaveEdit() {
    const existing = odLinks[sectionId] || [];
    const updated = existing.map((l, i) => i === editingIdx ? {
      name: newODName.trim(),
      url: newODUrl.trim() || null,
      urlPc: newODUrlPc.trim() || null,
    } : l);
    resetForm();
    await persist(updated);
  }

  async function handleRemove(idx) {
    const existing = odLinks[sectionId] || [];
    await persist(existing.filter((_, i) => i !== idx));
  }

  const sectionODLinks = odLinks[sectionId] || [];

  return (
    <>
      <div className="panel-col-header" style={{ color }}>
        <span>OneDrive</span>
        {odSyncing && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>↑</span>}
        <button className="od-add-btn" onClick={() => setAddingOD(a => !a)} title="Aggiungi link">+</button>
      </div>
      {addingOD && (
        <div className="od-add-form">
          <input className="od-input" placeholder="Nome cartella"
            value={newODName} onChange={e => setNewODName(e.target.value)} />
          <input className="od-input" placeholder="Link web (1drv.ms o onedrive.com)"
            value={newODUrl} onChange={e => setNewODUrl(e.target.value)} />
          <input className="od-input" placeholder="Percorso PC (C:\Users\...)"
            value={newODUrlPc} onChange={e => setNewODUrlPc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          <div className="od-form-btns">
            <button className="od-save-btn" style={{ color }} onClick={handleSubmit}>Salva</button>
            <button className="od-cancel-btn" onClick={resetForm}>Annulla</button>
          </div>
        </div>
      )}
      <div className="panel-col-body">
        {sectionODLinks.map((link, i) => (
          <div key={i} className="od-link-row">
            <span className="od-link-name">☁ {link.name}</span>
            <div className="od-link-btns">
              {link.url && (
                <button className="od-open-btn" onClick={() => window.open(link.url, '_blank')} title="Apri su mobile/web">📱</button>
              )}
              {link.urlPc && <CopyBtn text={link.urlPc} />}
              <button className="od-edit-btn" onClick={() => handleStartEdit(i)} title="Modifica">✎</button>
              <button className="od-remove-btn" onClick={() => handleRemove(i)} aria-label="Rimuovi questo collegamento" title="Rimuovi">✕</button>
            </div>
          </div>
        ))}
        {!sectionODLinks.length && !addingOD && (
          <div className="panel-empty">Nessun link · premi + per aggiungere</div>
        )}
      </div>
    </>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback per browser che non supportano clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <button className="od-open-btn" onClick={handleCopy}
      title={copied ? 'Copiato!' : 'Copia percorso PC'}
      style={{ color: copied ? '#86c07a' : 'var(--muted)' }}>
      {copied ? '✓' : '⊡'}
    </button>
  );
}
