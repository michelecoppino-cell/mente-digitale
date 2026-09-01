// @ts-check
// Escape chiude quello che è aperto.
//
// È il gesto che nell'app c'era già dappertutto — la coda, gli obiettivi, il
// rituale, la ricerca, il cassetto del dettaglio — scritto a mano in ognuno
// dei suoi undici punti, e proprio per questo dimenticato negli altri: il
// chiarimento GTD, le impostazioni dei colori, la Bussola e il modulo di
// importazione del diario si chiudevano solo col mouse. Da tastiera erano
// vicoli ciechi, e in un'app che ha una scorciatoia per aprire ogni cosa
// quella era l'unica strada senza uscita.
//
// L'ascolto sta su `window` in fase di risalita, esattamente come nei modali
// che il gesto ce l'avevano già scritto a mano: chi sta dentro — una casella
// che annulla la modifica in corso — vede il tasto per primo, e questo hook
// non gli cambia l'ordine sotto i piedi. Un pannello chiuso non ascolta.
import { useEffect } from 'react';

/**
 * @param {boolean} attivo   in genere è `open`
 * @param {() => void} chiudi
 */
export function useEscape(attivo, chiudi) {
  useEffect(() => {
    if (!attivo) return undefined;
    /** @param {KeyboardEvent} e */
    function suTasto(e) { if (e.key === 'Escape') chiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [attivo, chiudi]);
}
