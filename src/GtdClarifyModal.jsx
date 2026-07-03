import { useState, useMemo } from 'react';
import { createTask, createNotePage } from './api';
import { sectionRole } from './paraConfig';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen), adattato al metodo PARA
// usato nell'app:
// «Cose» → Inbox → Che cos'è? (statici) → È attuabile?
//   → No → Cestino / Risorse / Archivio
//   → Sì → Qual è la prossima azione? → Richiede meno di due minuti?
//               ├─ Sì → Farla
//               └─ No → Progetto (task) / Area-Ricorrenti (task)
export default function GtdClarifyModal({ open, onClose, todoLists = [], notebooks = [], sectionsMap = {}, onTaskCreated, seedText = '' }) {
  const [openLeaf, setOpenLeaf] = useState(null);

  // Sezioni PARA "Risorse/Idee" e "Archivio", una per taccuino che le possiede
  // — l'etichetta è il nome del taccuino (la sezione si chiama sempre uguale).
  const resourceSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'resources'), [notebooks, sectionsMap]);
  const archiveSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'archive'), [notebooks, sectionsMap]);

  // Liste ToDo "progetto" = tutte tranne quelle che coincidono con un nome PARA.
  const projectLists = useMemo(() => todoLists.filter(l => !sectionRole(l.displayName)), [todoLists]);
  // Liste ToDo "Area/Ricorrenti" — se nessuna combacia col nome letterale, si
  // mostrano comunque tutte le liste per non bloccare l'utente.
  const areaLists = useMemo(() => {
    const matches = todoLists.filter(l => sectionRole(l.displayName) === 'area');
    return matches.length ? matches : todoLists;
  }, [todoLists]);

  function handleClose() { setOpenLeaf(null); onClose(); }

  async function submitLog() {
    // Cestino / Farla: nessun task o nota — si registra solo localmente il testo.
  }

  async function submitResource(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Idea', text);
  }

  async function submitArchive(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Nota', text);
  }

  async function submitProjectTask(text, { listId }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  async function submitAreaTask(text, { listId }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
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
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                    kind="log" onSubmit={submitLog} confirmLabel="Scarta" confirmMsg="Scartato" />
                  <GtdLeaf
                    id="resources" icon="💡" label="Risorse"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                    kind="section" sections={resourceSections} onSubmit={submitResource} confirmLabel="Crea pagina" confirmMsg="Pagina creata" />
                  <GtdLeaf
                    id="archive" icon="📓" label="Archivio"
                    openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                    kind="section" sections={archiveSections} onSubmit={submitArchive} confirmLabel="Crea pagina" confirmMsg="Pagina creata" />
                </div>
              </div>

              {/* ── Sì ── */}
              <div className="gtd-flow-branch">
                <div className="gtd-flow-branch-label">Sì</div>
                <div className="gtd-flow-node-wrap">
                  <div className="gtd-flow-node question small">Qual è la prossima azione?</div>
                </div>
                <div className="gtd-flow-node-wrap">
                  <div className="gtd-flow-node question small">&lt;2 minuti?</div>
                </div>
                <div className="gtd-flow-branches">
                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">Sì</div>
                    <div className="gtd-flow-leaves">
                      <GtdLeaf
                        id="doNow" icon="⚡" label="Farla"
                        openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                        kind="log" onSubmit={submitLog} confirmLabel="Fatto" confirmMsg="Fatto" />
                    </div>
                  </div>
                  <div className="gtd-flow-branch">
                    <div className="gtd-flow-branch-label">No</div>
                    <div className="gtd-flow-leaves">
                      <GtdLeaf
                        id="project" icon="🗂" label="Progetto"
                        openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                        kind="list" todoLists={projectLists} onSubmit={submitProjectTask} confirmLabel="Crea task" confirmMsg="Task creato" />
                      <GtdLeaf
                        id="area" icon="🔁" label="Area/Ricorrenti"
                        openLeaf={openLeaf} setOpenLeaf={setOpenLeaf} seedText={seedText}
                        kind="list" todoLists={areaLists} onSubmit={submitAreaTask} confirmLabel="Crea task" confirmMsg="Task creato" />
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

// Sezioni PARA di un dato ruolo ('resources' | 'archive'), una per taccuino
// che la possiede, etichettate col nome del taccuino (la sezione si chiama
// sempre allo stesso modo, distinguerle per nome sezione non avrebbe senso).
function paraSectionsByRole(notebooks, sectionsMap, role) {
  const out = [];
  for (const nb of notebooks) {
    const sec = (sectionsMap[nb.id] || []).find(s => sectionRole(s.displayName) === role);
    if (sec) out.push({ id: sec.id, label: nb.displayName });
  }
  return out;
}

// ── GtdLeaf ───────────────────────────────────────────────────────────────────
// Nodo terminale del diagramma: pulsante "+" che apre in linea un piccolo
// modulo (testo + eventuale lista/sezione) per quella foglia. Le foglie di
// tipo "log" (Cestino, Farla) non generano alcun task/nota: il testo serve solo
// a confermare la scelta, nessuna chiamata a Graph.
function GtdLeaf({ id, icon, label, openLeaf, setOpenLeaf, kind, todoLists = [], sections = [], onSubmit, confirmLabel, confirmMsg, seedText = '' }) {
  const [text, setText] = useState('');
  const [listId, setListId] = useState(todoLists[0]?.id || '');
  const [sectionId, setSectionId] = useState(sections[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const isOpen = openLeaf === id;

  function handleToggle() {
    if (isOpen) { setOpenLeaf(null); return; }
    setText(seedText || ''); setDone(false);
    setListId(todoLists[0]?.id || '');
    setSectionId(sections[0]?.id || '');
    setOpenLeaf(id);
  }

  const needsList = kind === 'list';
  const canSubmit = !busy && text.trim() &&
    (!needsList || listId) &&
    (kind !== 'section' || sectionId);

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (kind === 'log') await onSubmit(text.trim());
      else if (kind === 'list') await onSubmit(text.trim(), { listId });
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
