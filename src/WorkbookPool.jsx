import { useMemo, useState } from 'react';
import { COLORS } from './config';
import { shadeColor } from './plannerShared';

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Pannello sinistro "Workbook" — alternativa a TaskPool nella colonna sinistra
// del planner. Mostra l'albero Workbook → Sub-workbook (2 livelli) che
// l'utente compila liberamente (scollegato dai taccuini/sezioni OneNote), ma
// propone come punto di partenza i taccuini OneNote già esistenti (con lo
// stesso colore usato nelle altre viste) così da non dover ridigitare nomi e
// ricolorare da zero. L'albero risultante resta comunque un file a parte,
// trascinabile sulla griglia settimanale per bozzare la settimana a grandi
// categorie prima di dettagliarla con i task/eventi reali.
export default function WorkbookPool({ workbooks = [], onChange, draggable = true, notebooks = [] }) {
  const [expanded, setExpanded]         = useState(() => new Set());
  const [colorPickerFor, setColorPickerFor] = useState(null); // { workbookId, subId: string|null }
  const [addingTop, setAddingTop]       = useState(false);
  const [addingSubFor, setAddingSubFor] = useState(null); // workbookId
  const [draftName, setDraftName]       = useState('');

  const suggestedNotebooks = useMemo(() => {
    const existing = new Set(workbooks.map(wb => wb.name.trim().toLowerCase()));
    return notebooks.filter(nb => !existing.has((nb.displayName || '').trim().toLowerCase()));
  }, [notebooks, workbooks]);

  function addFromNotebook(nb) {
    onChange([...workbooks, {
      id: genId(),
      name: nb.displayName,
      color: nb._color || COLORS[workbooks.length % COLORS.length],
      subWorkbooks: [],
    }]);
  }

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function commitAddTop() {
    const name = draftName.trim();
    setAddingTop(false);
    setDraftName('');
    if (!name) return;
    const color = COLORS[workbooks.length % COLORS.length];
    onChange([...workbooks, { id: genId(), name, color, subWorkbooks: [] }]);
  }

  function commitAddSub(workbookId) {
    const name = draftName.trim();
    setAddingSubFor(null);
    setDraftName('');
    if (!name) return;
    onChange(workbooks.map(wb => {
      if (wb.id !== workbookId) return wb;
      const color = shadeColor(wb.color, wb.subWorkbooks.length + 1);
      return { ...wb, subWorkbooks: [...wb.subWorkbooks, { id: genId(), name, color }] };
    }));
    setExpanded(prev => new Set(prev).add(workbookId));
  }

  function setColor(workbookId, subId, color) {
    onChange(workbooks.map(wb => {
      if (wb.id !== workbookId) return wb;
      if (!subId) return { ...wb, color };
      return { ...wb, subWorkbooks: wb.subWorkbooks.map(s => s.id === subId ? { ...s, color } : s) };
    }));
  }

  function removeNode(workbookId, subId) {
    if (subId) {
      onChange(workbooks.map(wb =>
        wb.id === workbookId ? { ...wb, subWorkbooks: wb.subWorkbooks.filter(s => s.id !== subId) } : wb
      ));
    } else {
      onChange(workbooks.filter(wb => wb.id !== workbookId));
    }
  }

  function handleDragStart(e, wb, sub) {
    const color = sub?.color ?? wb.color;
    const label = sub ? `${wb.name} · ${sub.name}` : wb.name;
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'workbookblock', workbookId: wb.id, subWorkbookId: sub?.id ?? null,
    }));
    const ghost = document.createElement('div');
    ghost.textContent = label;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      background: color, border: '1.5px dashed rgba(255,255,255,0.6)',
      borderRadius: '6px', color: '#fff',
      padding: '5px 10px', fontSize: '11px', fontFamily: "'Outfit',sans-serif",
      whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden',
      textOverflow: 'ellipsis', opacity: '0.95',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => ghost.parentNode?.removeChild(ghost));
  }

  return (
    <div className="workbook-pool">
      <div className="planner-col-header">
        <span>Workbook</span>
        <button className="planner-action-btn" onClick={() => { setAddingTop(true); setDraftName(''); }} title="Nuovo workbook">
          + Workbook
        </button>
      </div>
      <div className="planner-pool-body">
        {addingTop && (
          <input
            className="workbook-pool-add-input"
            autoFocus
            placeholder="Nome workbook…"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitAddTop();
              if (e.key === 'Escape') { setAddingTop(false); setDraftName(''); }
            }}
            onBlur={commitAddTop}
          />
        )}
        {suggestedNotebooks.length > 0 && (
          <div className="workbook-pool-suggestions">
            <div className="workbook-pool-suggestions-label">Taccuini OneNote</div>
            {suggestedNotebooks.map(nb => (
              <div key={nb.id} className="workbook-pool-suggestion-row">
                <span className="planner-group-dot workbook-color-dot" style={{ background: nb._color || '#888' }} />
                <span className="workbook-pool-name">{nb.displayName}</span>
                <button
                  className="workbook-pool-icon-btn workbook-pool-suggestion-add"
                  onClick={() => addFromNotebook(nb)}
                  title="Aggiungi come workbook">
                  +
                </button>
              </div>
            ))}
          </div>
        )}
        {workbooks.length === 0 && !addingTop && suggestedNotebooks.length === 0 && (
          <div className="planner-cal-filter-empty">Nessun workbook — crea il primo con "+ Workbook"</div>
        )}
        {workbooks.map(wb => (
          <div key={wb.id} className="workbook-pool-group">
            <div className="workbook-pool-row">
              <span
                className="planner-group-dot workbook-color-dot"
                style={{ background: wb.color }}
                onClick={e => { e.stopPropagation(); setColorPickerFor({ workbookId: wb.id, subId: null }); }}
                title="Cambia colore" />
              <span
                className="workbook-pool-name"
                draggable={draggable}
                onDragStart={e => handleDragStart(e, wb, null)}
                onClick={() => toggleExpand(wb.id)}
                title="Trascina sulla griglia · clic per espandere">
                {wb.subWorkbooks.length > 0 ? (expanded.has(wb.id) ? '▾ ' : '▸ ') : ''}{wb.name}
              </span>
              <button className="workbook-pool-icon-btn" onClick={() => { setAddingSubFor(wb.id); setDraftName(''); }} title="Nuovo sub-workbook">+</button>
              <button className="workbook-pool-icon-btn" onClick={() => removeNode(wb.id, null)} title="Elimina workbook">×</button>
              {colorPickerFor?.workbookId === wb.id && colorPickerFor?.subId === null && (
                <ColorPickerPopup
                  color={wb.color}
                  onPick={c => setColor(wb.id, null, c)}
                  onClose={() => setColorPickerFor(null)}
                />
              )}
            </div>
            {addingSubFor === wb.id && (
              <input
                className="workbook-pool-add-input workbook-pool-add-sub"
                autoFocus
                placeholder="Nome sub-workbook…"
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitAddSub(wb.id);
                  if (e.key === 'Escape') { setAddingSubFor(null); setDraftName(''); }
                }}
                onBlur={() => commitAddSub(wb.id)}
              />
            )}
            {expanded.has(wb.id) && wb.subWorkbooks.map(sub => (
              <div key={sub.id} className="workbook-pool-subrow">
                <span
                  className="planner-task-dot workbook-color-dot"
                  style={{ background: sub.color }}
                  onClick={e => { e.stopPropagation(); setColorPickerFor({ workbookId: wb.id, subId: sub.id }); }}
                  title="Cambia colore" />
                <span
                  className="workbook-pool-name"
                  draggable={draggable}
                  onDragStart={e => handleDragStart(e, wb, sub)}
                  title="Trascina sulla griglia">
                  {sub.name}
                </span>
                <button className="workbook-pool-icon-btn" onClick={() => removeNode(wb.id, sub.id)} title="Elimina sub-workbook">×</button>
                {colorPickerFor?.workbookId === wb.id && colorPickerFor?.subId === sub.id && (
                  <ColorPickerPopup
                    color={sub.color}
                    onPick={c => setColor(wb.id, sub.id, c)}
                    onClose={() => setColorPickerFor(null)}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorPickerPopup({ color, onPick, onClose }) {
  return (
    <div className="workbook-color-picker-wrap">
      <div className="planner-cal-filter-backdrop" onClick={onClose} />
      <div className="workbook-color-picker-popup">
        {COLORS.map(c => (
          <button key={c} className="workbook-color-swatch" style={{ background: c }} onClick={() => { onPick(c); onClose(); }} title={c} />
        ))}
        <input
          type="color"
          value={color}
          onChange={e => onPick(e.target.value)}
          className="workbook-color-native"
          title="Colore personalizzato" />
      </div>
    </div>
  );
}
