import { useState, useMemo } from 'react';
import { createTask, createNotePage } from './api';
import './GtdClarifyModal.css';

// Diagramma di flusso GTD "Chiarire" (David Allen):
// cattura → azionabile? → no: cestino/forse un giorno/riferimento
//                        → sì: <2 min? → sì: fallo subito
//                                      → no: delegabile? → sì/no → crea task
export default function GtdClarifyModal({ open, onClose, todoLists = [], notebooks = [], sectionsMap = {}, onTaskCreated }) {
  const [step, setStep]         = useState('capture'); // capture|actionable|nonActionable|twoMin|delegate|createTask|reference|result
  const [text, setText]         = useState('');
  const [listId, setListId]     = useState('');
  const [sectionId, setSectionId] = useState('');
  const [addToday, setAddToday] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState('');

  const sections = useMemo(() => {
    const out = [];
    for (const nb of notebooks) {
      for (const s of (sectionsMap[nb.id] || [])) {
        out.push({ id: s.id, label: `${nb.displayName} / ${s.displayName}` });
      }
    }
    return out;
  }, [notebooks, sectionsMap]);

  function reset() {
    setStep('capture'); setText(''); setAddToday(false); setResult('');
  }
  function handleClose() { reset(); onClose(); }

  function pickList(preferredNameMatch) {
    if (!todoLists.length) return '';
    const preferred = preferredNameMatch
      ? todoLists.find(l => l.displayName.toLowerCase().includes(preferredNameMatch))
      : null;
    return (preferred || todoLists[0]).id;
  }

  async function finalizeTask({ marker, targetListId }) {
    setBusy(true);
    try {
      const body = marker ? `${marker} ` : undefined;
      const task = await createTask(targetListId, text.trim(), body ? { body } : {});
      const list = todoLists.find(l => l.id === targetListId);
      onTaskCreated?.({ ...task, _listId: targetListId, _listName: list?.displayName || '' }, { addToday });
      setResult('Task creato.');
      setStep('result');
    } catch (e) {
      console.error('gtd create task', e);
      setResult('Errore nella creazione del task.');
      setStep('result');
    }
    setBusy(false);
  }

  async function finalizeReference() {
    if (!sectionId) return;
    setBusy(true);
    try {
      await createNotePage(sectionId, text.trim().slice(0, 60) || 'Nota', text.trim());
      setResult('Pagina creata su OneNote.');
      setStep('result');
    } catch (e) {
      console.error('gtd create page', e);
      setResult('Errore nella creazione della pagina.');
      setStep('result');
    }
    setBusy(false);
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
          {step === 'capture' && (
            <>
              <div className="gtd-question">Cos'è?</div>
              <textarea
                className="gtd-textarea"
                autoFocus
                rows={3}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Descrivi il pensiero, l'idea o l'input catturato…"
              />
              <button
                className="gtd-primary-btn"
                disabled={!text.trim()}
                onClick={() => setStep('actionable')}>
                Avanti →
              </button>
            </>
          )}

          {step === 'actionable' && (
            <>
              <div className="gtd-question">È azionabile?</div>
              <div className="gtd-choice-row">
                <button className="gtd-choice-btn" onClick={() => setStep('twoMin')}>Sì</button>
                <button className="gtd-choice-btn" onClick={() => setStep('nonActionable')}>No</button>
              </div>
            </>
          )}

          {step === 'nonActionable' && (
            <>
              <div className="gtd-question">Non azionabile — cosa ne facciamo?</div>
              <div className="gtd-choice-col">
                <button className="gtd-choice-btn" onClick={handleClose}>🗑 Cestino (scarta)</button>
                <button
                  className="gtd-choice-btn"
                  disabled={!todoLists.length}
                  onClick={() => { setListId(pickList('forse') || pickList('someday') || pickList()); setStep('createSomeday'); }}>
                  💭 Forse un giorno
                </button>
                <button
                  className="gtd-choice-btn"
                  disabled={!sections.length}
                  onClick={() => { setSectionId(sections[0]?.id || ''); setStep('reference'); }}>
                  📓 Materiale di riferimento (OneNote)
                </button>
              </div>
            </>
          )}

          {step === 'reference' && (
            <>
              <div className="gtd-question">In quale sezione OneNote lo archiviamo?</div>
              <select className="gtd-select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button className="gtd-primary-btn" disabled={busy || !sectionId} onClick={finalizeReference}>
                {busy ? 'Creazione…' : 'Crea pagina'}
              </button>
            </>
          )}

          {step === 'createSomeday' && (
            <>
              <div className="gtd-question">In quale lista To-Do lo salviamo?</div>
              <select className="gtd-select" value={listId} onChange={e => setListId(e.target.value)}>
                {todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
              </select>
              <button
                className="gtd-primary-btn"
                disabled={busy || !listId}
                onClick={() => finalizeTask({ marker: '[SOMEDAY]', targetListId: listId })}>
                {busy ? 'Creazione…' : 'Crea task'}
              </button>
            </>
          )}

          {step === 'twoMin' && (
            <>
              <div className="gtd-question">Richiede meno di 2 minuti?</div>
              <div className="gtd-choice-row">
                <button className="gtd-choice-btn" onClick={() => { setResult('Fallo subito — nessun task creato.'); setStep('result'); }}>Sì</button>
                <button className="gtd-choice-btn" onClick={() => setStep('delegate')}>No</button>
              </div>
            </>
          )}

          {step === 'delegate' && (
            <>
              <div className="gtd-question">Puoi delegarla a qualcun altro?</div>
              <div className="gtd-choice-row">
                <button
                  className="gtd-choice-btn"
                  onClick={() => { setListId(pickList()); setStep('createDelegate'); }}>
                  Sì, delego
                </button>
                <button
                  className="gtd-choice-btn"
                  onClick={() => { setListId(pickList()); setStep('createTask'); }}>
                  No, la faccio io
                </button>
              </div>
            </>
          )}

          {(step === 'createDelegate' || step === 'createTask') && (
            <>
              <div className="gtd-question">In quale lista To-Do va pianificata?</div>
              <select className="gtd-select" value={listId} onChange={e => setListId(e.target.value)}>
                {todoLists.map(l => <option key={l.id} value={l.id}>{l.displayName}</option>)}
              </select>
              {step === 'createTask' && (
                <label className="gtd-checkbox-row">
                  <input type="checkbox" checked={addToday} onChange={e => setAddToday(e.target.checked)} />
                  Aggiungi subito al piano di oggi
                </label>
              )}
              <button
                className="gtd-primary-btn"
                disabled={busy || !listId}
                onClick={() => finalizeTask({ marker: step === 'createDelegate' ? '[WAIT]' : null, targetListId: listId })}>
                {busy ? 'Creazione…' : 'Crea task'}
              </button>
            </>
          )}

          {step === 'result' && (
            <>
              <div className="gtd-result">{result}</div>
              <button className="gtd-primary-btn" onClick={handleClose}>Chiudi</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
