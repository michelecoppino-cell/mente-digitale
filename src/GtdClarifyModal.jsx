import { useState, useMemo } from 'react';
import { createTask, createNotePage } from './api';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen), sempre visibile per intero:
// Azionabile? → No → Cestino / Forse un giorno / Riferimento
//             → Sì → <2 minuti? → Sì → Fallo subito
//                                → No → Delegabile? → Sì → Delega
//                                                    → No → Pianifica
export default function GtdClarifyModal({ open, onClose, todoLists = [], notebooks = [], sectionsMap = {}, onTaskCreated }) {
  const [openLeaf, setOpenLeaf] = useState(null);

  const sections = useMemo(() => {
    const out = [];
    for (const nb of notebooks) {
      for (const s of (sectionsMap[nb.id] || [])) {
        out.push({ id: s.id, label: `${nb.displayName} / ${s.displayName}` });
      }
    }
    return out;
  }, [notebooks, sectionsMap]);

  function handleClose() { setOpenLeaf(null); onClose(); }

  async function submitTrash() {
    setOpenLeaf(null);
  }

  async function submitDoNow() {
    setOpenLeaf(null);
  }

  async function submitSomeday(text, { listId }) {
    const task = await createTask(listId, text, { body: '[SOMEDAY] ' });
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
    setOpenLeaf(null);
  }

  async function submitReference(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Nota', text);
    setOpenLeaf(null);
  }

  async function submitDelegate(text, { listId }) {
    const task = await createTask(listId, text, { body: '[WAIT] ' });
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
    setOpenLeaf(null);
  }

  async function submitPlan(text, { listId, addToday }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday });
    setOpenLeaf(null);
  }

  if (!open) return null;

  return (
    <div className="gtd-overlay" onClick={handleClose}>
      <div className="gtd-modal" onClick={e => e.stopPropagation()}>
        <div className="gtd-header">
          <span>📥 Chiarire (GTD)</span>
          <button className="gtd-close" onClick={handleClose} title="Chiudi">✕</button>
        </div>

        <div className="gtd-body">
          <div className="gtd-flow">
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node question">Azionabile?</div>
            </div>

            <div className="gtd-flow-branches">
              {/* ── No ── */}
              <div className="gtd-flow-branch">
                <div className="gtd-flow-branch-label">No</div>
                <div className="gtd-flow-leaves">
                  <GtdLeaf
                    id="trash" icon="🗑" label="Cestino"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="none" onSubmit={submitTrash} confirmLabel="Scarta" />
                  <GtdLeaf
                    id="someday" icon="💭" label="Forse un giorno"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="list" todoLists={todoLists} onSubmit={submitSomeday} confirmLabel="Crea task" />
                  <GtdLeaf
                    id="reference" icon="📓" label="Riferimento (OneNote)"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="section" sections={sections} onSubmit={submitReference} confirmLabel="Crea pagina" />
                </div>
              </div>

              {/* ── Sì ── */}
              <div className="gtd-flow-branch">
                <div className="gtd-flow-branch-label">Sì</div>
                <div className="gtd-flow-node-wrap">
                  <div className="gtd-flow-node question small">&lt;2 minuti?</div>
                </div>
                <div className="gtd-flow-branches">
                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">Sì</div>
                    <div className="gtd-flow-leaves">
                      <GtdLeaf
                        id="doNow" icon="⚡" label="Fallo subito"
                        openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                        kind="none" onSubmit={submitDoNow} confirmLabel="Fatto" />
                    </div>
                  </div>
                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">No</div>
                    <div className="gtd-flow-node-wrap">
                      <div className="gtd-flow-node question small">Delegabile?</div>
                    </div>
                    <div className="gtd-flow-branches">
                      <div className="gtd-flow-branch">
                        <div className="gtd-flow-branch-label">Sì</div>
                        <div className="gtd-flow-leaves">
                          <GtdLeaf
                            id="delegate" icon="🤝" label="Delega"
                            openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                            kind="list" todoLists={todoLists} onSubmit={submitDelegate} confirmLabel="Crea task" />
                        </div>
                      </div>
                      <div className="gtd-flow-branch">
                        <div className="gtd-flow-branch-label">No</div>
                        <div className="gtd-flow-leaves">
                          <GtdLeaf
                            id="plan" icon="📌" label="Pianifica"
                            openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                            kind="listAndToday" todoLists={todoLists} onSubmit={submitPlan} confirmLabel="Crea task" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GtdLeaf ───────────────────────────────────────────────────────────────────
// Nodo terminale del diagramma: pulsante "+" che apre in linea un piccolo
// modulo (testo + eventuale lista/sezione + eventuale checkbox) per quella foglia.
function GtdLeaf({ id, icon, label, openLeaf, setOpenLeaf, kind, todoLists = [], sections = [], onSubmit, confirmLabel }) {
  const [text, setText] = useState('');
  const [listId, setListId] = useState(todoLists[0]?.id || '');
  const [sectionId, setSectionId] = useState(sections[0]?.id || '');
  const [addToday, setAddToday] = useState(false);
  const [busy, setBusy] = useState(false);

  const isOpen = openLeaf === id;

  function handleToggle() {
    if (isOpen) { setOpenLeaf(null); return; }
    setText(''); setAddToday(false);
    setListId(todoLists[0]?.id || '');
    setSectionId(sections[0]?.id || '');
    setOpenLeaf(id);
  }

  const needsText = kind !== 'none';
  const canSubmit = !busy && (!needsText || text.trim()) &&
    (kind !== 'list' && kind !== 'listAndToday' || listId) &&
    (kind !== 'section' || sectionId);

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (kind === 'none') await onSubmit();
      else if (kind === 'list') await onSubmit(text.trim(), { listId });
      else if (kind === 'listAndToday') await onSubmit(text.trim(), { listId, addToday });
      else if (kind === 'section') await onSubmit(text.trim(), { sectionId });
    } catch (e) {
      console.error('gtd leaf submit', id, e);
    }
    setBusy(false);
  }

  return (
    <div className={`gtd-leaf${isOpen ? ' open' : ''}`}>
      <button className="gtd-leaf-btn" onClick={handleToggle}>
        <span className="gtd-leaf-icon">{icon}</span>
        <span className="gtd-leaf-label">{label}</span>
        <span className="gtd-leaf-plus">{isOpen ? '✕' : '+'}</span>
      </button>
      {isOpen && (
        <div className="gtd-leaf-form">
          {needsText && (
            <textarea
              className="gtd-textarea"
              autoFocus
              rows={2}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Descrivi l'idea…"
            />
          )}
          {(kind === 'list' || kind === 'listAndToday') && (
            <select className="gtd-select" value={listId} onChange={e => setListId(e.target.value)}>
              {todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
            </select>
          )}
          {kind === 'section' && (
            <select className="gtd-select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          {kind === 'listAndToday' && (
            <label className="gtd-checkbox-row">
              <input type="checkbox" checked={addToday} onChange={e => setAddToday(e.target.checked)} />
              Aggiungi subito al piano di oggi
            </label>
          )}
          <button className="gtd-primary-btn" disabled={!canSubmit} onClick={handleSubmit}>
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}
