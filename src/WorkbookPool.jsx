import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COLORS } from './config';
import { shadeColor, hexToRgb, rgbToHex } from './plannerShared';

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
                onClick={e => { e.stopPropagation(); setColorPickerFor({ workbookId: wb.id, subId: null, anchor: e.currentTarget }); }}
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
                  anchor={colorPickerFor.anchor}
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
                  onClick={e => { e.stopPropagation(); setColorPickerFor({ workbookId: wb.id, subId: sub.id, anchor: e.currentTarget }); }}
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
                    anchor={colorPickerFor.anchor}
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

// Popup colore in un portale su document.body: ancorato in position:fixed
// alla posizione del pallino cliccato invece che con position:absolute dentro
// la riga del workbook, così non viene più tagliato dall'overflow del
// pannello (workbook-pool-body scrolla in verticale) né intrappolato in uno
// stacking context locale. Oltre alle swatch predefinite offre tre slider
// R/G/B 0-255 (+ input numerico e campo hex) per scegliere qualsiasi colore.
function ColorPickerPopup({ color, anchor, onPick, onClose }) {
  const [rgb, setRgb]         = useState(() => hexToRgb(color));
  const [hexDraft, setHexDraft] = useState(color);
  const [pos, setPos]         = useState(null);
  const popupRef = useRef(null);

  // Misura la posizione dell'ancora (il pallino cliccato) e, in un secondo
  // passaggio, le dimensioni reali del popup una volta montato per tenerlo
  // dentro al viewport: sincronizzazione con il DOM, non stato derivabile
  // dal render, quindi legittimo farlo in un effetto nonostante il lint.
  useLayoutEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left }); // eslint-disable-line react-hooks/set-state-in-effect
  }, [anchor]);

  useLayoutEffect(() => {
    if (!pos || !popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    const margin = 8;
    let { top, left } = pos;
    if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
    if (left < margin) left = margin;
    if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
    if (top < margin) top = margin;
    if (top !== pos.top || left !== pos.left) setPos({ top, left }); // eslint-disable-line react-hooks/set-state-in-effect
  }, [pos]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function applyRgb(next) {
    const clamped = {
      r: Math.max(0, Math.min(255, next.r)),
      g: Math.max(0, Math.min(255, next.g)),
      b: Math.max(0, Math.min(255, next.b)),
    };
    setRgb(clamped);
    const hex = rgbToHex(clamped.r, clamped.g, clamped.b);
    setHexDraft(hex);
    onPick(hex);
  }

  function applyHex(raw) {
    const cleaned = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft('#' + cleaned);
    if (cleaned.length === 6) {
      const hex = '#' + cleaned;
      setRgb(hexToRgb(hex));
      onPick(hex);
    }
  }

  return createPortal(
    <>
      <div className="workbook-color-picker-backdrop" onClick={onClose} />
      <div
        ref={popupRef}
        className="workbook-color-picker-popup"
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        onClick={e => e.stopPropagation()}>
        <div className="workbook-color-picker-preview" style={{ background: hexDraft }} />
        <div className="workbook-color-picker-swatches">
          {COLORS.map(c => (
            <button key={c} className="workbook-color-swatch" style={{ background: c }}
              onClick={() => { setRgb(hexToRgb(c)); setHexDraft(c); onPick(c); }} title={c} />
          ))}
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(hexDraft) ? hexDraft : color}
            onChange={e => { setRgb(hexToRgb(e.target.value)); setHexDraft(e.target.value); onPick(e.target.value); }}
            className="workbook-color-native"
            title="Selettore colore di sistema" />
        </div>
        <div className="workbook-color-picker-sliders">
          {['r', 'g', 'b'].map(ch => (
            <label key={ch} className={`workbook-color-slider-row workbook-color-slider-${ch}`}>
              <span className="workbook-color-slider-label">{ch.toUpperCase()}</span>
              <input
                type="range" min="0" max="255" value={rgb[ch]}
                onChange={e => applyRgb({ ...rgb, [ch]: Number(e.target.value) })} />
              <input
                type="number" min="0" max="255" value={rgb[ch]}
                className="workbook-color-slider-num"
                onChange={e => applyRgb({ ...rgb, [ch]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="workbook-color-picker-hex-row">
          <span>#</span>
          <input
            type="text" className="workbook-color-hex-input"
            value={hexDraft.replace('#', '')}
            maxLength={6}
            onChange={e => applyHex(e.target.value)}
            placeholder="rrggbb" />
        </div>
      </div>
    </>,
    document.body
  );
}
