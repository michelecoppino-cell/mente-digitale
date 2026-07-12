import { useEffect, useState } from 'react';
import { ColorPickerPopup } from './WorkbookPool';
import './ColorSettingsModal.css';

// Impostazioni colori — apribile dall'ingranaggio nell'header. Permette di
// scegliere un colore fisso per ogni taccuino OneNote e ogni sua sezione,
// al posto di quello assegnato automaticamente per indice (config.js
// COLORS[i % COLORS.length]). L'override è persistito (App.jsx) e da lì
// riapplicato a nb._color / sec._color, quindi si propaga da solo a tutte le
// viste che già leggono quei campi (mappa, planner, ricerca, pool task...).
export default function ColorSettingsModal({
  open, onClose, notebooks = [], sectionsMap = {},
  overrides = { notebooks: {}, sections: {} },
  onSetNotebookColor, onSetSectionColor,
  onResetNotebookColor, onResetSectionColor,
  onExpandNotebook,
}) {
  const [pickerFor, setPickerFor] = useState(null); // { type: 'notebook'|'section', id, anchor }

  // Le sezioni dei taccuini non ancora espansi altrove potrebbero mancare da
  // sectionsMap: le richiede alla prima apertura, così ogni taccuino mostra
  // subito le sue sezioni da colorare.
  useEffect(() => {
    if (!open) return;
    notebooks.forEach(nb => { if (!sectionsMap[nb.id]) onExpandNotebook?.(nb); });
  }, [open, notebooks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function openPicker(type, id, e) {
    e.stopPropagation();
    setPickerFor({ type, id, anchor: e.currentTarget });
  }

  return (
    <div className="cset-overlay" onClick={onClose}>
      <div className="cset-modal" onClick={e => e.stopPropagation()}>
        <div className="cset-header">
          <span>Colori taccuini e sezioni</span>
          <button className="cset-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        <div className="cset-body">
          <p className="cset-hint">
            Scegli un colore fisso per un taccuino o una sezione: verrà usato
            al posto di quello automatico ovunque nell'app.
          </p>
          {notebooks.length === 0 && (
            <div className="cset-empty">Nessun taccuino caricato.</div>
          )}
          {notebooks.map(nb => {
            const overridden = !!overrides.notebooks[nb.id];
            return (
              <div key={nb.id} className="cset-group">
                <div className="cset-row">
                  <span
                    className="cset-dot"
                    style={{ background: nb._color || '#888' }}
                    onClick={e => openPicker('notebook', nb.id, e)}
                    title="Cambia colore" />
                  <span className="cset-name">{nb.displayName}</span>
                  {overridden && (
                    <button
                      className="cset-reset-btn"
                      onClick={() => onResetNotebookColor(nb.id)}
                      title="Ripristina colore automatico">
                      ↺
                    </button>
                  )}
                  {pickerFor?.type === 'notebook' && pickerFor.id === nb.id && (
                    <ColorPickerPopup
                      color={nb._color || '#888'}
                      anchor={pickerFor.anchor}
                      onPick={c => onSetNotebookColor(nb.id, c)}
                      onClose={() => setPickerFor(null)}
                    />
                  )}
                </div>
                {(sectionsMap[nb.id] || []).map(sec => {
                  const secOverridden = !!overrides.sections[sec.id];
                  return (
                    <div key={sec.id} className="cset-subrow">
                      <span
                        className="cset-dot cset-dot-sm"
                        style={{ background: sec._color || nb._color || '#888' }}
                        onClick={e => openPicker('section', sec.id, e)}
                        title="Cambia colore" />
                      <span className="cset-name">{sec.displayName}</span>
                      {secOverridden && (
                        <button
                          className="cset-reset-btn"
                          onClick={() => onResetSectionColor(sec.id)}
                          title="Ripristina colore automatico">
                          ↺
                        </button>
                      )}
                      {pickerFor?.type === 'section' && pickerFor.id === sec.id && (
                        <ColorPickerPopup
                          color={sec._color || nb._color || '#888'}
                          anchor={pickerFor.anchor}
                          onPick={c => onSetSectionColor(sec.id, c)}
                          onClose={() => setPickerFor(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
