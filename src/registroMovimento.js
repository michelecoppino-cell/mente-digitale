// @ts-check
// La lettura del registro di Movimento: i due mesi che servono a disegnare la
// settimana e a non azzerare una striscia a cavallo del primo del mese.
//
// Sta in un file suo e non dentro MovimentoCard perché la chiama «Oggi», che
// passa il risultato al riquadro: le stesse sessioni servono anche agli
// obiettivi del mese («Palestra 7/12»), e leggerle due volte vorrebbe dire due
// richieste a OneDrive per lo stesso file e due verità che possono divergere
// fra un riquadro e quello accanto.
import { useCallback, useEffect, useState } from 'react';
import { loadMovimentoIndex, loadMovimentoMese } from './api';
import { meseDi, mesePrecedente } from './movimento';

/**
 * @param {string} oggi 'YYYY-MM-DD'
 */
export function useRegistroMovimento(oggi) {
  const [voci, setVoci] = useState(/** @type {import('./types').Movimento[]|null} */ (null));
  const [indice, setIndice] = useState(/** @type {import('./types').MovimentoIndex|null} */ (null));

  const ricarica = useCallback(async () => {
    const ym = meseDi(oggi);
    const idx = await loadMovimentoIndex();
    const mesi = [mesePrecedente(ym), ym].filter(m => idx.months.length === 0 || idx.months.includes(m));
    const caricate = await Promise.all(mesi.map(m => loadMovimentoMese(m).catch(() => [])));
    return { voci: caricate.flat(), indice: idx };
  }, [oggi]);

  useEffect(() => {
    let annullato = false;
    ricarica()
      .then(r => { if (!annullato) { setVoci(r.voci); setIndice(r.indice); } })
      .catch(e => {
        console.error('registro movimento', e);
        if (!annullato) { setVoci([]); setIndice({ months: [], calendarId: null, calendarName: null, bersagli: {} }); }
      });
    return () => { annullato = true; };
  }, [ricarica]);

  return { voci, indice, setVoci, setIndice };
}
