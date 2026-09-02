// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
import { useEffect, useState } from 'react';
import { ColorPickerPopup } from './WorkbookPool';
import { useEscape } from './useEscape';
import { getCalendars, WORKBOOK_CALENDAR_NAME } from './api';
import { calendarColor } from './planner/griglia.js';
import './ColorSettingsModal.css';

// Impostazioni colori — apribile dall'ingranaggio nell'header. Permette di
// scegliere un colore fisso per ogni calendario, ogni taccuino OneNote e ogni
// sua sezione, al posto di quello assegnato automaticamente (config.js
// COLORS[i % COLORS.length] per i taccuini, l'enum di Graph per i calendari).
// L'override è persistito (App.jsx) e da lì riapplicato a nb._color /
// sec._color, quindi si propaga da solo a tutte le viste che già leggono quei
// campi (mappa, planner, ricerca, pool task...); per i calendari, che non sono
// oggetti nostri, lo legge coloreEvento (planner/griglia.js).
export default function ColorSettingsModal({
  open, onClose, notebooks = [], sectionsMap = {},
  overrides = { notebooks: {}, sections: {}, calendars: {} },
  onSetNotebookColor, onSetSectionColor, onSetCalendarColor,
  onResetNotebookColor, onResetSectionColor, onResetCalendarColor,
  onExpandNotebook,
}) {
  const [pickerFor, setPickerFor] = useState(null); // { type: 'notebook'|'section'|'calendar', id, anchor }
  // I calendari li chiede questo pannello, e non l'App: sono l'unica cosa qui
  // dentro che nessun'altra vista tiene in mano, e getCalendars ha già il suo
  // memo in api.js — aprire due volte le impostazioni non è una richiesta in
  // più.
  const [calendari, setCalendari] = useState([]);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    getCalendars()
      // Il calendario dei blocchi Workbook non è un calendario da guardare: i
      // suoi blocchi prendono il colore dal workbook, non da qui.
      .then(cals => {
        if (!vivo) return;
        setCalendari(cals.filter(c => (c.name || '').trim().toLowerCase() !== WORKBOOK_CALENDAR_NAME.toLowerCase()));
      })
      .catch(e => console.error('calendari impostazioni colori', e));
    return () => { vivo = false; };
  }, [open]);

  // Le sezioni dei taccuini non ancora espansi altrove potrebbero mancare da
  // sectionsMap: le richiede alla prima apertura, così ogni taccuino mostra
  // subito le sue sezioni da colorare.
  useEffect(() => {
    if (!open) return;
    notebooks.forEach(nb => { if (!sectionsMap[nb.id]) onExpandNotebook?.(nb); });
  }, [open, notebooks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape chiude il pannello — e prima, se è aperto, la tavolozza: chiudere
  // tutto in un colpo mentre si stava solo scegliendo un colore vorrebbe dire
  // annullare il gesto sbagliato.
  useEscape(open, () => (pickerFor ? setPickerFor(null) : onClose()));

  if (!open) return null;

  function openPicker(type, id, e) {
    e.stopPropagation();
    setPickerFor({ type, id, anchor: e.currentTarget });
  }

  return (
    <div className="cset-overlay" onClick={onClose}>
      <div className="cset-modal" onClick={e => e.stopPropagation()}>
        <div className="cset-header">
          <span>Colori</span>
          <button className="cset-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        <div className="cset-body">
          <p className="cset-hint">
            Scegli un colore fisso per un calendario, un taccuino o una
            sezione: verrà usato al posto di quello automatico ovunque
            nell'app.
          </p>
          {/* I calendari per primi: sono pochi, e sono quelli che si
              ricolorano davvero — il colore di un calendario è quello che
              distingue un compleanno da una riunione nel Piano e in Oggi. */}
          {calendari.length > 0 && (
            <div className="cset-group">
              <div className="cset-sezione">Calendari</div>
              {calendari.map(cal => {
                const scelto = !!overrides.calendars?.[cal.id];
                return (
                  <div key={cal.id} className="cset-row">
                    <span
                      className="cset-dot"
                      style={{ background: calendarColor(cal.id, cal.color, overrides.calendars) }}
                      onClick={e => openPicker('calendar', cal.id, e)}
                      title="Cambia colore" />
                    <span className="cset-name">{cal.name}</span>
                    {scelto && (
                      <button
                        className="cset-reset-btn"
                        onClick={() => onResetCalendarColor(cal.id)}
                        title="Ripristina colore automatico">
                        ↺
                      </button>
                    )}
                    {pickerFor?.type === 'calendar' && pickerFor.id === cal.id && (
                      <ColorPickerPopup
                        color={calendarColor(cal.id, cal.color, overrides.calendars)}
                        anchor={pickerFor.anchor}
                        onPick={c => onSetCalendarColor(cal.id, c)}
                        onClose={() => setPickerFor(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
