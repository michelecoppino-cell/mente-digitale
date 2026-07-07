import { useState, useMemo } from 'react';
import { createTask, createNotePage, createCalendarEvent } from './api';
import { sectionRole, paraSectionLabel } from './paraConfig';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen), adattato al metodo PARA
// usato nell'app, sviluppato in verticale come il diagramma originale:
// Inbox → Che cos'è? → [Cestino / Progetti / Risorse-Idee / Aree ← No,
//   solo pagina OneNote] È un'azione?
//   → Sì → Richiede meno di due minuti?
//               ├─ Sì → Falla
//               └─ No → Progetti / Risorse-Idee / Aree (task ToDo, con
//                       opzione di creare invece una scadenza a calendario)
// Le tre destinazioni PARA (Progetti/Risorse-Idee/Aree) compaiono in
// entrambi i rami con la stessa icona: cambia solo cosa creano, coerente
// con la posizione nel diagramma — non azionabile → solo riferimento
// (OneNote); azionabile → task (ToDo/Calendario). Ogni foglia apre una
// finestra pop-up con la scelta della destinazione e la descrizione
// completa, invece di un modulo inline.
export default function GtdClarifyModal({ open, onClose, todoLists = [], notebooks = [], sectionsMap = {}, onTaskCreated, onEventCreated, seedText = '' }) {
  const [activeLeaf, setActiveLeaf] = useState(null);
  const [eventLeaf, setEventLeaf] = useState(null);

  // Sezioni OneNote delle tre destinazioni PARA (ramo "No", solo pagine di
  // riferimento): "Progetti" sono le sezioni senza prefisso, "Risorse/Idee" e
  // "Aree" quelle con prefisso PARA — etichetta depurata dal prefisso
  // (es. "ARC-AUTO" → "AUTO", ma qui non si usa più Archivio).
  const projectSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, null), [notebooks, sectionsMap]);
  const resourceSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'resources'), [notebooks, sectionsMap]);
  const areaSections = useMemo(() => paraSectionsByRole(notebooks, sectionsMap, 'area'), [notebooks, sectionsMap]);

  // Stesse tre destinazioni PARA come liste ToDo (ramo "Sì", task azionabili).
  const projectLists = useMemo(() => todoLists.filter(l => !sectionRole(l.displayName)), [todoLists]);
  const areaLists = useMemo(() => todoLists.filter(l => sectionRole(l.displayName) === 'area'), [todoLists]);
  const resourceLists = useMemo(() => todoLists.filter(l => sectionRole(l.displayName) === 'resources'), [todoLists]);

  function handleClose() { setActiveLeaf(null); setEventLeaf(null); onClose(); }

  async function submitLog() {
    // Cestino / Farla: nessun task o nota — si registra solo localmente il testo.
  }

  async function submitResource(text, { sectionId }) {
    await createNotePage(sectionId, text.slice(0, 60) || 'Idea', text);
  }

  async function submitProjectTask(text, { listId }) {
    const task = await createTask(listId, text);
    const list = todoLists.find(l => l.id === listId);
    onTaskCreated?.({ ...task, _listId: listId, _listName: list?.displayName || '' }, { addToday: false });
  }

  // Stessa icona per la stessa destinazione PARA in entrambi i rami (cambia
  // solo cosa crea il pulsante, non l'icona): 🗂 Progetti, 💡 Risorse/Idee,
  // 🔁 Aree (coerente con "Aree/Ricorrenti" già usato nella vista PARA).
  const leaves = {
    trash:        { id: 'trash', icon: '🗑', label: 'Cestino', kind: 'log', onSubmit: submitLog, confirmLabel: 'Scarta', confirmMsg: 'Scartato' },
    projectNote:  { id: 'projectNote', icon: '🗂', label: 'Progetti', kind: 'section', sections: projectSections, onSubmit: submitResource, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
    resourceNote: { id: 'resourceNote', icon: '💡', label: 'Risorse/Idee', kind: 'section', sections: resourceSections, onSubmit: submitResource, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
    areaNote:     { id: 'areaNote', icon: '🔁', label: 'Aree', kind: 'section', sections: areaSections, onSubmit: submitResource, confirmLabel: 'Crea pagina', confirmMsg: 'Pagina creata' },
    doNow:        { id: 'doNow', icon: '⚡', label: 'Falla', kind: 'log', onSubmit: submitLog, confirmLabel: 'Fatto', confirmMsg: 'Fatto' },
    project:      { id: 'project', icon: '🗂', label: 'Progetti', kind: 'list', todoLists: projectLists, onSubmit: submitProjectTask, confirmLabel: 'Crea task', confirmMsg: 'Task creato' },
    resourceTask: { id: 'resourceTask', icon: '💡', label: 'Risorse/Idee', kind: 'list', todoLists: resourceLists, onSubmit: submitProjectTask, confirmLabel: 'Crea task', confirmMsg: 'Task creato' },
    area:         { id: 'area', icon: '🔁', label: 'Aree', kind: 'list', todoLists: areaLists, onSubmit: submitProjectTask, confirmLabel: 'Crea task', confirmMsg: 'Task creato' },
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
            {/* Box statico — solo per fedeltà visiva al diagramma originale */}
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node static">Inbox</div>
            </div>
            <div className="gtd-flow-node-wrap">
              <div className="gtd-flow-node">Che cos'è?</div>
            </div>

            {/* ── È un'azione? — le foglie "No" si aprono a sinistra, il ramo
                   "Sì" prosegue in verticale verso <2 minuti? ── */}
            <div className="gtd-decision">
              <div className="gtd-decision-side">
                <div className="gtd-decision-side-label">No</div>
                <div className="gtd-leaf-col">
                  <GtdLeafBtn leaf={leaves.trash} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.projectNote} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.resourceNote} onOpen={setActiveLeaf} />
                  <GtdLeafBtn leaf={leaves.areaNote} onOpen={setActiveLeaf} />
                </div>
              </div>
              <div className="gtd-decision-connector" />
              <div className="gtd-flow-node question">È un'azione?</div>
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
              <div className="gtd-flow-node question small">&lt;2 minuti?</div>
            </div>

            {/* ── <2 minuti? — biforcazione finale: Sì → Falla, No → Task progetti/Area/Risorse-idee ── */}
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
                  <GtdLeafBtn leaf={leaves.project} onOpen={setActiveLeaf} onOpenEvent={setEventLeaf} />
                  <GtdLeafBtn leaf={leaves.resourceTask} onOpen={setActiveLeaf} onOpenEvent={setEventLeaf} />
                  <GtdLeafBtn leaf={leaves.area} onOpen={setActiveLeaf} onOpenEvent={setEventLeaf} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeLeaf && (
          <GtdLeafPopup leaf={activeLeaf} seedText={seedText} onClose={() => setActiveLeaf(null)} />
        )}
        {eventLeaf && (
          <GtdEventPopup leaf={eventLeaf} seedText={seedText} onEventCreated={onEventCreated} onClose={() => setEventLeaf(null)} />
        )}
      </div>
    </div>
  );
}

// Sezioni PARA di un dato ruolo ('area' | 'resources' | 'archive' | null per
// le sezioni senza prefisso, cioè "Progetti"), da tutti i taccuini — un
// taccuino può averne più di una (es. "ARC-AUTO" e "ARC-LORENZO" nello
// stesso taccuino) — etichettate col nome della sezione depurato dal
// prefisso PARA.
function paraSectionsByRole(notebooks, sectionsMap, role) {
  const out = [];
  for (const nb of notebooks) {
    const secs = (sectionsMap[nb.id] || []).filter(s => sectionRole(s.displayName) === role);
    for (const sec of secs) out.push({ id: sec.id, label: paraSectionLabel(sec.displayName), name: sec.displayName });
  }
  return out;
}

// ── GtdLeafBtn ────────────────────────────────────────────────────────────────
// Nodo terminale del diagramma: un semplice pulsante che apre la finestra
// pop-up di quella foglia (nessun modulo inline). Il badge finale indica
// dove finisce il contenuto — coerente con l'icona usata per il pulsante
// gemello "scadenza a calendario": OneNote (sezione) e ToDo (lista) hanno
// lo stesso linguaggio visivo, icona dell'app + "+" giallo nell'angolo.
function GtdLeafBtn({ leaf, onOpen, onOpenEvent }) {
  return (
    <div className="gtd-leaf-row">
      <button className="gtd-leaf-btn" onClick={() => onOpen(leaf)}>
        <span className="gtd-leaf-icon">{leaf.icon}</span>
        <span className="gtd-leaf-label">{leaf.label}</span>
        <LeafPlusBadge kind={leaf.kind} />
      </button>
      {onOpenEvent && (
        <button className="gtd-leaf-event-btn" onClick={() => onOpenEvent(leaf)} title="Crea scadenza a calendario">
          <span className="gtd-mini-badge">
            <span className="gtd-mini-icon gtd-mini-icon-calendar">📅</span>
            <span className="gtd-mini-plus">+</span>
          </span>
        </button>
      )}
    </div>
  );
}

function LeafPlusBadge({ kind }) {
  if (kind === 'section') {
    return (
      <span className="gtd-mini-badge">
        <span className="gtd-mini-icon gtd-mini-icon-onenote">N</span>
        <span className="gtd-mini-plus">+</span>
      </span>
    );
  }
  if (kind === 'list') {
    return (
      <span className="gtd-mini-badge">
        <span className="gtd-mini-icon gtd-mini-icon-todo">✓</span>
        <span className="gtd-mini-plus">+</span>
      </span>
    );
  }
  return <span className="gtd-leaf-plus">+</span>;
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

// ── GtdEventPopup ─────────────────────────────────────────────────────────────
// Alternativa al task/nota: crea un evento Calendario tutto il giorno con
// reminder nativo — la scadenza vera e propria (assicurazione, salute,
// tasse...). Il titolo è sempre "[NomeSezione] Titolo": la prima parte è
// compilata con la sezione/lista scelta (stessa selezione del popup
// task/nota), la seconda si scrive a mano — stessa convenzione letta da
// deadlineReminders.js/refreshDeadlineReminders in App.jsx, che trasforma
// l'evento in un task nella lista dell'Area quando il reminder scatta.
function GtdEventPopup({ leaf, seedText, onEventCreated, onClose }) {
  const options = leaf.kind === 'list' ? leaf.todoLists : leaf.sections;
  const [targetId, setTargetId] = useState(options?.[0]?.id || '');
  const [title, setTitle] = useState(seedText || '');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const target = (options || []).find(o => o.id === targetId);
  const prefixName = target ? (leaf.kind === 'list' ? target.displayName : target.name) : '';

  const canSubmit = !busy && targetId && title.trim() && deadlineDate && taskDate && taskDate <= deadlineDate;

  // Apre subito il calendario nativo del browser al click, invece di
  // richiedere di scrivere la data a mano — basta cliccare il giorno.
  // showPicker() richiede un gesto utente diretto: solo onClick, non onFocus
  // (il focus può arrivare anche senza un gesto e il browser lo rifiuta).
  function openDatePicker(e) {
    try { e.target.showPicker?.(); } catch { /* alcuni browser/contesti lo rifiutano: resta l'icona nativa */ }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const reminderMinutesBeforeStart = Math.max(0, Math.round(
        (new Date(`${deadlineDate}T00:00:00Z`) - new Date(`${taskDate}T00:00:00Z`)) / 60000
      ));
      const event = await createCalendarEvent({
        subject: `[${prefixName}] ${title.trim()}`,
        startDate: deadlineDate,
        reminderMinutesBeforeStart,
        body: notes.trim() || undefined,
      });
      onEventCreated?.(event);
      setBusy(false);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      console.error('gtd event submit', leaf.id, e);
      setError("Errore nella creazione dell'evento");
      setBusy(false);
    }
  }

  return (
    <div className="gtd-popup-overlay" onClick={onClose}>
      <div className="gtd-popup" onClick={e => e.stopPropagation()}>
        <div className="gtd-popup-header">
          <span className="gtd-popup-icon">📅</span>
          <span className="gtd-popup-title">{leaf.label} — Scadenza a calendario</span>
          <button className="gtd-popup-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        <div className="gtd-popup-body">
          {done ? (
            <div className="gtd-leaf-confirm">✓ Evento creato</div>
          ) : (
            <>
              <label className="gtd-popup-field">
                <span>{leaf.kind === 'list' ? 'Lista' : 'Taccuino'}</span>
                <select className="gtd-select" value={targetId} onChange={e => setTargetId(e.target.value)}>
                  {(options || []).map(o => (
                    <option key={o.id} value={o.id}>{leaf.kind === 'list' ? o.displayName : o.label}</option>
                  ))}
                </select>
              </label>
              <label className="gtd-popup-field">
                <span>Titolo evento</span>
                <div className="gtd-event-title-row">
                  <span className="gtd-event-prefix">{prefixName ? `[${prefixName}]` : '…'}</span>
                  <input
                    className="gtd-select"
                    type="text"
                    autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Titolo della scadenza"
                  />
                </div>
              </label>
              <label className="gtd-popup-field">
                <span>Data scadenza</span>
                <input
                  className="gtd-select"
                  type="date"
                  value={deadlineDate}
                  onChange={e => setDeadlineDate(e.target.value)}
                  onClick={openDatePicker}
                />
              </label>
              <label className="gtd-popup-field">
                <span>Diventa task dal</span>
                <input
                  className="gtd-select"
                  type="date"
                  value={taskDate}
                  max={deadlineDate || undefined}
                  onChange={e => setTaskDate(e.target.value)}
                  onClick={openDatePicker}
                />
              </label>
              <label className="gtd-popup-field">
                <span>Note evento</span>
                <textarea
                  className="gtd-textarea"
                  rows={4}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Note facoltative…"
                />
              </label>
              {error && <div className="gtd-error">{error}</div>}
              <button className="gtd-primary-btn" disabled={!canSubmit} onClick={handleSubmit}>
                {busy ? '…' : 'Crea evento'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
