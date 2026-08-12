// @ts-check
// Il banner degli avvisi, in basso a schermo. Vive accanto a quello dell'undo e
// ne condivide l'aspetto (vedi UndoToast.css): sono la stessa cosa per chi
// guarda — una riga che compare in fondo e dice com'è andata.
//
// Gli errori restano finché non li si chiude: un salvataggio che non è andato a
// buon fine non deve sparire da sé dopo tre secondi. Le note informative se ne
// vanno da sole.
import { useEffect, useState } from 'react';
import { subscribeNotices, dismissNotice } from './notify';
import './UndoToast.css';

const INFO_MS = 4000;

export default function Toaster() {
  const [notice, setNotice] = useState(/** @type {import('./notify').Notice|null} */ (null));

  useEffect(() => subscribeNotices(setNotice), []);

  useEffect(() => {
    if (!notice || notice.kind !== 'info') return undefined;
    const id = setTimeout(dismissNotice, INFO_MS);
    return () => clearTimeout(id);
  }, [notice]);

  if (!notice) return null;

  return (
    <div className={`undo-toast notice-${notice.kind}`} role="alert" aria-live="assertive">
      <span className="undo-toast-label notice-text">{notice.text}</span>
      <button className="undo-toast-btn" onClick={dismissNotice}>Ho capito</button>
    </div>
  );
}
