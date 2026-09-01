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
// L'ascolto sta su `window` in fase di cattura, come i modali che ce l'avevano
// già: un campo di testo dentro il pannello non deve poter mangiare il tasto.
import { useEffect } from 'react';

/**
 * @param {boolean} attivo   in genere è `open`: un pannello chiuso non ascolta
 * @param {() => void} chiudi
 */
export function useEscape(attivo, chiudi) {
  useEffect(() => {
    if (!attivo) return undefined;
    /** @param {KeyboardEvent} e */
    function suTasto(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();   // il modale sopra vince su quello sotto
      chiudi();
    }
    window.addEventListener('keydown', suTasto, true);
    return () => window.removeEventListener('keydown', suTasto, true);
  }, [attivo, chiudi]);
}
