// @ts-check
// Le regole comuni a ogni finestra modale dell'app, in un posto solo.
//
// Prima ogni modale se le arrangiava: la cattura chiudeva con Escape solo se il
// fuoco era rimasto dentro la sua textarea, il chiarimento GTD e le
// impostazioni colore non chiudevano con Escape affatto, e nessuna delle tre
// riportava il fuoco dov'era prima di aprirsi — chi naviga da tastiera si
// ritrovava a ripartire dall'inizio della pagina a ogni chiusura.
//
// Tre cose, che valgono per tutte:
//   · Escape chiude, da qualunque punto della modale (handler sul documento,
//     non sul singolo campo).
//   · Tab resta dentro: la modale copre il resto dell'interfaccia, e uscirne
//     col fuoco senza vedere dove si è finiti non è navigabile.
//   · alla chiusura il fuoco torna all'elemento che l'aveva aperta.
import { useEffect, useRef } from 'react';

/** Gli elementi che possono ricevere il fuoco dentro una modale. */
const FOCUSABLE = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Gli ultimi due elementi che hanno avuto il fuoco.
//
// Serve per sapere *da dove* si è aperta una modale. Non basta leggere
// document.activeElement quando l'effetto parte: l'`autoFocus` di React viene
// applicato quando il campo entra nel DOM, cioè prima degli effetti, quindi a
// quel punto il fuoco è già dentro la modale e l'elemento di partenza è
// perduto. Con due passi di storia il bottone che ha aperto la finestra c'è
// ancora.
/** @type {[Element|null, Element|null]} */
let focusTrail = [null, null];
let trailing = false;

function startFocusTrail() {
  if (trailing || typeof document === 'undefined') return;
  trailing = true;
  document.addEventListener('focusin', e => {
    const el = /** @type {Element|null} */ (e.target);
    if (el !== focusTrail[1]) focusTrail = [focusTrail[1], el];
  }, true);
}

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @returns {import('react').RefObject<any>} da attaccare al contenitore della modale
 */
export function useDialog(open, onClose) {
  const boxRef = useRef(/** @type {any} */ (null));
  // onClose cambia identità a ogni render del genitore: tenuto in un ref, non
  // fra le dipendenze, così l'ascoltatore non viene rimosso e riaggiunto a ogni
  // giro (e il fuoco non viene ripristinato a metà interazione).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => { startFocusTrail(); }, []);

  useEffect(() => {
    if (!open) return undefined;
    // Se il fuoco è già dentro la modale (autoFocus), il punto di partenza è il
    // penultimo elemento della storia: il bottone che l'ha aperta.
    const active = document.activeElement;
    const returnTo = boxRef.current?.contains(active) ? focusTrail[0] : active;

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
      if (e.key === 'Escape') { onCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const items = /** @type {HTMLElement[]} */ (
        Array.from(box.querySelectorAll(FOCUSABLE))
      ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Il fuoco torna dov'era solo se nel frattempo non è già finito altrove
      // per volontà di chi usa l'app (un click su un'altra vista, per dire).
      if (returnTo instanceof HTMLElement && document.body.contains(returnTo)) {
        returnTo.focus();
      }
    };
  }, [open]);

  return boxRef;
}
