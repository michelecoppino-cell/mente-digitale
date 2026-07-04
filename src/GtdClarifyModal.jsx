import { useState, useMemo } from 'react';
import { createTask, createNotePage } from './api';
import { sectionRole, paraSectionLabel } from './paraConfig';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen), adattato al metodo PARA
// usato nell'app, sviluppato in verticale come il diagramma originale:
// «Cose» → Inbox → Che cos'è? → [Cestino / Risorse / Archivio ← No] È attuabile?
//   → Sì → Qual è la prossima azione? → Richiede meno di due minuti?
//               ├─ Sì → Farla
//               └─ No → Task ToDo (task) / Area-Ricorrenti (pagina)
// Ogni foglia (Cestino/Risorse/Archivio/Farla/Task ToDo/Area) apre una
// finestra pop-up con la scelta della destinazione e la descrizione
// completa, invece di un modulo inline.
export default function GtdClarifyModal({ open, onClose, todoLists = [], notebooks = [], sectionsMap = {}, onTaskCreated, seedText = '' }) {
  const [activeLeaf, setActiveLeaf] = useState(null);

  // Sezioni PARA "Risorse/Idee", "Archivio" e "Area/Ricorrenti", una per
  // taccuino che le possiede — l'etichetta è il nome della sezione depurato
  // dal prefisso PARA (es. "ARC-AUTO" → "AUTO").
  const resourceSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'resources'), [notebooks, sectionsMap]);
  const archiveSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'archive'), [notebooks, sectionsMap]);
  const areaSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'area'), [notebooks, sectionsMap]);

  // Liste ToDo "progetto" = tutte tranne quelle che coincidono con un nome PARA.
  const projectLists = useMemo(() => todoLists.filter(l => !sectionRole(l.displayName)), [todoLists]);

  function handleClose() { setActiveLeaf(null); onClose(); }

  async function submitLog() {
    // Cestino / Farla: nessun task o nota — si registra solo localmente il testo.
  }

  async function submitResource(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Idea', text);
  }

  async function submitArchive(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Nota', text);
  }

  async function submitAreaPage(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Nota', text);
  }

  async function submitProjectTask(text, { listId }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  const leaves = {
    trash:     { id: 'trash', icon: '🗑', label: 'Cestino', kind: 'log', onSubmit: submitLog, confirmLabel: 'Scarta', confirmMsg: 'Scartato' },
    resources: { id: 'resources', icon: '💡', label: 'Risorse', kind: 'section', sections: resourceSections, onSubmit: submitResource, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
    archive:   { id: 'archive', icon: '📓', label: 'Archivio', kind: 'section', sections: archiveSections, onSubmit: submitArchive, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
    doNow:     { id: 'doNow', icon: '⚡', label: 'Farla', kind: 'log', onSubmit: submitLog, confirmLabel: 'Fatto', confirmMsg: 'Fatto' },
    project:   { id: 'project', icon: '🗂', label: 'Task ToDo', kind: 'list', todoLists: projectLists, onSubmit: submitProjectTask, confirmLabel: 'Crea task', confirmMsg: 'Task creato' },
    area:      { id: 'area', icon: '🔁', label: 'Area/Ricorrenti', kind: 'section', sections: areaSections, onSubmit: submitAreaPage, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
  };

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

            {/* ── È attuabile? — le foglie "No" si aprono a sinistra, il ramo
                   "Sì" prosegue in verticale verso la prossima azione ── */}
            <div className="gtd-decision">
              <div className="gtd-decision-side">
                <div className="gtd-decision-side-label">No</div>
                <div className="gtd-leaf-col">
                  <GtdLeafBtn leaf={leaves.trash} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.resources} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.archive} onOpen={setActiveLeaf} />
                </div>
              </div>
              <div className="gtd-decision-connector" />
              <div className="gtd-flow-node question">È attuabile?</div>
              <div className="gtd-decision-connector ghost" />
              <div className="gtd-decision-side ghost" aria-hidden="true" />
            </div>

            {/* Ramo "Sì" verso il basso */}
            <div className="gtd-branch-down">
              <div className="gtd-vline" />
              <span className="gtd-decision-side-label">Sì</span>
              <div className="gtd-vline" />
            </div>

            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node question small">Qual è la prossima azione?</div>
            </div>
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node question small">&lt;2 minuti?</div>
            </div>

            {/* ── <2 minuti? — biforcazione finale: Sì → Farla, No → Progetto/Area ── */}
            <div className="gtd-branch-split">
              <div className="gtd-split-bar" />
              <div className="gtd-branch">
                <div className="gtd-vline" />
                <div className="gtd-decision-side-label">Sì</div>
                <div className="gtd-leaf-col">
                  <GtdLeafBtn leaf={leaves.doNow} onOpen={setActiveLeaf} />
                </div>
              </div>
              <div className="gtd-branch">
                <div className="gtd-vline" />
                <div className="gtd-decision-side-label">No</div>
                <div className="gtd-leaf-col">
                  <GtdLeafBtn leaf={leaves.project} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.area} onOpen={setActiveLeaf} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeLeaf && (
          <GtdLeafPopup leaf={activeLeaf} seedText={seedText} onClose={() => setActiveLeaf(null)} />
        )}
      </div>
    </div>
  );
}

// Sezioni PARA di un dato ruolo ('area' | 'resources' | 'archive'), da tutti
// i taccuini — un taccuino può averne più di una (es. "ARC-AUTO" e
// "ARC-LORENZO" nello stesso taccuino) — etichettate col nome della sezione
// depurato dal prefisso PARA.
function paraSectionsByRole(notebooks, sectionsMap, role) {
  const out = [];
  for (const nb of notebooks) {
    const secs = (sectionsMap[nb.id] || []).filter(s => sectionRole(s.displayName) === role);
    for (const sec of secs) out.push({ id: sec.id, label: paraSectionLabel(sec.displayName) });
  }
  return out;
}

// ── GtdLeafBtn ────────────────────────────────────────────────────────────────
// Nodo terminale del diagramma: un semplice pulsante che apre la finestra
// pop-up di quella foglia (nessun modulo inline).
function GtdLeafBtn({ leaf, onOpen }) {
  return (
    <button className="gtd-leaf-btn" onClick={() => onOpen(leaf)}>
      <span className="gtd-leaf-icon">{leaf.icon}</span>
      <span className="gtd-leaf-label">{leaf.label}</span>
      <span className="gtd-leaf-plus">+</span>
    </button>
  );
}

// ── GtdLeafPopup ──────────────────────────────────────────────────────────────
// Finestra pop-up di una foglia: scelta della destinazione (lista/taccuino,
// se prevista) e descrizione completa. Le foglie di tipo "log" (Cestino,
// Farla) non generano alcun task/nota: il testo serve solo a confermare la
// scelta, nessuna chiamata a Graph.
function GtdLeafPopup({ leaf, seedText, onClose }) {
  const [text, setText] = useState(seedText || '');
  const [listId, setListId] = useState(leaf.todoLists?.[0]?.id || '');
  const [sectionId, setSectionId] = useState(leaf.sections?.[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const needsList = leaf.kind === 'list';
  const needsSection = leaf.kind === 'section';
  const canSubmit = !busy && text.trim() && (!needsList || listId) && (!needsSection || sectionId);

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (leaf.kind === 'log') await leaf.onSubmit(text.trim());
      else if (leaf.kind === 'list') await leaf.onSubmit(text.trim(), { listId });
      else if (leaf.kind === 'section') await leaf.onSubmit(text.trim(), { sectionId });
      setBusy(false);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      console.error('gtd leaf submit', leaf.id, e);
      setBusy(false);
    }
  }

  return (
    <div className="gtd-popup-overlay" onClick={onClose}>
      <div className="gtd-popup" onClick={e => e.stopPropagation()}>
        <div className="gtd-popup-header">
          <span className="gtd-popup-icon">{leaf.icon}</span>
          <span className="gtd-popup-title">{leaf.label}</span>
          <button className="gtd-popup-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        <div className="gtd-popup-body">
          {done ? (
            <div className="gtd-leaf-confirm">✓ {leaf.confirmMsg}</div>
          ) : (
            <>
              {needsList && (
                <label className="gtd-popup-field">
                  <span>Lista</span>
                  <select className="gtd-select" value={listId} onChange={e => setListId(e.target.value)}>
                    {leaf.todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
                  </select>
                </label>
              )}
              {needsSection && (
                <label className="gtd-popup-field">
                  <span>Taccuino</span>
                  <select className="gtd-select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                    {leaf.sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              )}
              <label className="gtd-popup-field">
                <span>Descrizione</span>
                <textarea
                  className="gtd-textarea gtd-textarea-lg"
                  autoFocus
                  rows={7}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Descrivi l'idea per intero…"
                />
              </label>
              <button className="gtd-primary-btn" disabled={!canSubmit} onClick={handleSubmit}>
                {busy ? '…' : leaf.confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
