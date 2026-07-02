import { useState, useMemo } from 'react';
import { createTask, createNotePage } from './api';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen), fedele all'originale, sempre
// visibile per intero:
// «Cose» → Inbox → Che cos'è? (statici) → È attuabile?
//   → No → Cestino / Forse un giorno / Archivio
//   → Sì → Qual è la prossima azione?
//           ├─ Progetto (più step)
//           └─ Richiede meno di due minuti?
//               ├─ Sì → Farla
//               └─ No → Delegarla → In attesa
//                       Rimandarla → Calendario / Prossime azioni
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

  async function submitLog() {
    // Cestino / Farla: nessun task o nota — si registra solo localmente il testo.
  }

  async function submitSomeday(text, { listId }) {
    const task = await createTask(listId, text, { body: '[SOMEDAY] ' });
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  async function submitReference(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Nota', text);
  }

  async function submitProject(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Progetto', text);
  }

  async function submitDelegate(text, { listId }) {
    const task = await createTask(listId, text, { body: '[WAIT] ' });
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  async function submitCalendar(text, { listId, dueDate }) {
    const task = await createTask(listId, text, { dueDate });
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  async function submitPlan(text, { listId, addToday }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday });
  }

  if (!open) return null;

  return (
    <div className="gtd-overlay" onClick={handleClose}>
      <div className="gtd-modal" onClick={e => e.stopPropagation()}>
        <div className="gtd-header">
          <span>📥 Diagramma di flusso del lavoro: Chiarire</span>
          <button className="gtd-close" onClick={handleClose} title="Chiudi">✕</button>
        </div>

        <div className="gtd-body">
          <div className="gtd-flow">
            {/* Box statici — solo per fedeltà visiva al diagramma originale */}
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node static small">«Cose»</div>
            </div>
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node static">Inbox</div>
            </div>
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node static">Che cos'è?</div>
            </div>
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node question">È attuabile?</div>
            </div>

            <div className="gtd-flow-branches">
              {/* ── No ── */}
              <div className="gtd-flow-branch">
                <div className="gtd-flow-branch-label">No</div>
                <div className="gtd-flow-leaves">
                  <GtdLeaf
                    id="trash" icon="🗑" label="Cestino"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="log" onSubmit={submitLog} confirmLabel="Scarta" confirmMsg="Scartato" />
                  <GtdLeaf
                    id="someday" icon="💭" label="Forse un giorno"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="list" todoLists={todoLists} onSubmit={submitSomeday} confirmLabel="Crea task" confirmMsg="Task creato" />
                  <GtdLeaf
                    id="archive" icon="📓" label="Archivio (OneNote)"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                    kind="section" sections={sections} onSubmit={submitReference} confirmLabel="Crea pagina" confirmMsg="Pagina creata" />
                </div>
              </div>

              {/* ── Sì ── */}
              <div className="gtd-flow-branch">
                <div className="gtd-flow-branch-label">Sì</div>
                <div className="gtd-flow-node-wrap">
                  <div className="gtd-flow-node question small">Qual è la prossima azione?</div>
                </div>
                <div className="gtd-flow-branches">
                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">Progetto</div>
                    <div className="gtd-flow-leaves">
                      <GtdLeaf
                        id="project" icon="🗂" label="Progetto (più step)"
                        openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                        kind="section" sections={sections} onSubmit={submitProject} confirmLabel="Crea pagina" confirmMsg="Pagina creata" />
                    </div>
                  </div>

                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">Azione singola</div>
                    <div className="gtd-flow-node-wrap">
                      <div className="gtd-flow-node question small">&lt;2 minuti?</div>
                    </div>
                    <div className="gtd-flow-branches">
                      <div className="gtd-flow-branch">
                        <div className="gtd-flow-branch-label">Sì</div>
                        <div className="gtd-flow-leaves">
                          <GtdLeaf
                            id="doNow" icon="⚡" label="Farla"
                            openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                            kind="log" onSubmit={submitLog} confirmLabel="Fatto" confirmMsg="Fatto" />
                        </div>
                      </div>
                      <div className="gtd-flow-branch">
                        <div className="gtd-flow-branch-label">No</div>
                        <div className="gtd-flow-branches">
                          <div className="gtd-flow-branch">
                            <div className="gtd-flow-branch-label">Delegarla</div>
                            <div className="gtd-flow-leaves">
                              <GtdLeaf
                                id="delegate" icon="🤝" label="In attesa"
                                openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                                kind="list" todoLists={todoLists} onSubmit={submitDelegate} confirmLabel="Crea task" confirmMsg="Task creato" />
                            </div>
                          </div>
                          <div className="gtd-flow-branch">
                            <div className="gtd-flow-branch-label">Rimandarla</div>
                            <div className="gtd-flow-leaves">
                              <GtdLeaf
                                id="calendar" icon="📅" label="Calendario"
                                openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                                kind="listWithDate" todoLists={todoLists} onSubmit={submitCalendar} confirmLabel="Crea task" confirmMsg="Task creato" />
                              <GtdLeaf
                                id="plan" icon="📌" label="Prossime azioni"
                                openLeaf={openLeaf} setOpenLeaf={setOpenLeaf}
                                kind="listAndToday" todoLists={todoLists} onSubmit={submitPlan} confirmLabel="Crea task" confirmMsg="Task creato" />
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
      </div>
    </div>
  );
}

// ── GtdLeaf ───────────────────────────────────────────────────────────────────
// Nodo terminale del diagramma: pulsante "+" che apre in linea un piccolo
// modulo (testo + eventuale lista/sezione/data) per quella foglia. Le foglie di
// tipo "log" (Cestino, Farla) non generano alcun task/nota: il testo serve solo
// a confermare la scelta, nessuna chiamata a Graph.
function nowLocalDatetimeValue() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function GtdLeaf({ id, icon, label, openLeaf, setOpenLeaf, kind, todoLists = [], sections = [], onSubmit, confirmLabel, confirmMsg }) {
  const [text, setText] = useState('');
  const [listId, setListId] = useState(todoLists[0]?.id || '');
  const [sectionId, setSectionId] = useState(sections[0]?.id || '');
  const [dueDate, setDueDate] = useState(nowLocalDatetimeValue);
  const [addToday, setAddToday] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const isOpen = openLeaf === id;

  function handleToggle() {
    if (isOpen) { setOpenLeaf(null); return; }
    setText(''); setAddToday(false); setDone(false);
    setListId(todoLists[0]?.id || '');
    setSectionId(sections[0]?.id || '');
    setDueDate(nowLocalDatetimeValue());
    setOpenLeaf(id);
  }

  const needsList = kind === 'list' || kind === 'listAndToday' || kind === 'listWithDate';
  const canSubmit = !busy && text.trim() &&
    (!needsList || listId) &&
    (kind !== 'section' || sectionId);

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (kind === 'log') await onSubmit(text.trim());
      else if (kind === 'list') await onSubmit(text.trim(), { listId });
      else if (kind === 'listAndToday') await onSubmit(text.trim(), { listId, addToday });
      else if (kind === 'listWithDate') await onSubmit(text.trim(), { listId, dueDate });
      else if (kind === 'section') await onSubmit(text.trim(), { sectionId });
      setBusy(false);
      setDone(true);
      setTimeout(() => setOpenLeaf(null), 900);
    } catch (e) {
      console.error('gtd leaf submit', id, e);
      setBusy(false);
    }
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
          {done ? (
            <div className="gtd-leaf-confirm">✓ {confirmMsg}</div>
          ) : (
            <>
              <textarea
                className="gtd-textarea"
                autoFocus
                rows={2}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Descrivi l'idea…"
              />
              {needsList && (
                <select className="gtd-select" value={listId} onChange={e => setListId(e.target.value)}>
                  {todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
                </select>
              )}
              {kind === 'section' && (
                <select className="gtd-select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              )}
              {kind === 'listWithDate' && (
                <input
                  type="datetime-local"
                  className="gtd-select"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
