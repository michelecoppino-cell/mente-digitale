// @ts-check
// La lettura del registro di Movimento: i due mesi che servono a disegnare la
// settimana e a non azzerare una striscia a cavallo del primo del mese.
//
// Sta in un file suo e non dentro MovimentoCard perché la chiama «Oggi», che
// passa il risultato al riquadro: le stesse sessioni servono anche agli
// obiettivi del mese («Palestra 7/12»), e leggerle due volte vorrebbe dire due
// richieste a OneDrive per lo stesso file e due verità che possono divergere
// fra un riquadro e quello accanto.
import { useCallback } from 'react';
import { loadMovimentoIndex, loadMovimentoMese } from './api';
import { meseDi, mesePrecedente } from './movimento';
import { qk, STALE } from './queryClient';
import { useDatoPersistito } from './useDatoPersistito';

/** @typedef {import('./types').Movimento[]|null} Voci */
/** @typedef {import('./types').MovimentoIndex|null} Indice */

/**
 * Legge indice e sessioni dei due mesi che servono.
 * @param {string} oggi 'YYYY-MM-DD'
 */
async function leggiRegistro(oggi) {
  const ym = meseDi(oggi);
  const idx = await loadMovimentoIndex();
  const mesi = [mesePrecedente(ym), ym].filter(m => idx.months.length === 0 || idx.months.includes(m));
  const caricate = await Promise.all(mesi.map(m => loadMovimentoMese(m).catch(() => [])));
  return { voci: caricate.flat(), indice: idx };
}

/**
 * @param {string} oggi 'YYYY-MM-DD'
 */
export function useRegistroMovimento(oggi) {
  // `voci: null` vuol dire «non lo so ancora», e da qui in avanti lo dice solo
  // la primissima volta: alle riaperture successive la copia dell'ultimo
  // caricamento c'è già, e le barre della settimana si disegnano subito invece
  // di aspettare due file da OneDrive. Il rituale del mattino guarda proprio
  // questo per decidere se può aprirsi (vedi ritualePronto in TodayView).
  const { dato, aggiorna, fresco } = useDatoPersistito(
    qk.movimento(oggi), () => leggiRegistro(oggi), STALE.movimento,
    /** @type {{voci: Voci, indice: Indice}} */ ({ voci: null, indice: null }));

  // Le due `set` di prima, che i chiamanti usano con l'aggiornatore
  // funzionale: adesso scrivono nella cache — cioè nella copia che sopravvive
  // alla chiusura dell'app — invece che in uno stato che muore con la pagina.
  const setVoci = useCallback((
    /** @type {Voci | ((prec: Voci) => Voci)} */ f) => {
    aggiorna(prec => ({ ...prec, voci: typeof f === 'function' ? f(prec.voci) : f }));
  }, [aggiorna]);

  const setIndice = useCallback((
    /** @type {Indice | ((prec: Indice) => Indice)} */ f) => {
    aggiorna(prec => ({ ...prec, indice: typeof f === 'function' ? f(prec.indice) : f }));
  }, [aggiorna]);

  // `fresco`: se le sessioni sono quelle confermate o una copia dell'ultima
  // apertura. Le barre della settimana non se ne curano — meglio vecchie che
  // assenti — se ne cura il rituale del mattino, che da queste sessioni decide
  // cosa scrivere (vedi ritualePronto in TodayView).
  return { voci: dato.voci, indice: dato.indice, setVoci, setIndice, fresco };
}
