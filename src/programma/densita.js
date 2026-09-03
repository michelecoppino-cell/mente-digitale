// @ts-check
// Quanto larga è una colonna di settimana.
//
// Sta in un file suo perché **le due matrici la devono avere uguale**: quella
// per commessa e quella per persona hanno le stesse colonne e lo stesso
// problema — cinquanta settimane non ci stanno — e una che si stringe e l'altra
// no sarebbero due tabelle diverse a guardarsi. Stretta in una, stretta anche
// nell'altra: è una preferenza sulle settimane, non su una schermata.
//
// Ed è un file di funzioni e non di componenti per la ragione già scritta in
// `formato.js`: un modulo che esporta un componente **e** delle costanti rompe
// il ricaricamento a caldo di Vite.

import { useState } from 'react';
import { readPref, writePref } from '../viewPrefs.js';

/**
 * Le tre larghezze. Non è uno zoom continuo: tre valori scelti perché ognuno
 * serve a una cosa diversa — scrivere, guardare un trimestre, guardare la
 * commessa intera — e uno slider costringerebbe a cercarli ogni volta.
 *
 * `intere` dice che a quella larghezza le ore si scrivono all'ora tonda: a
 * ventotto pixel «16,5» non ci sta, e un numero tagliato a metà è peggio di un
 * numero arrotondato. È la densità in cui si guarda **la forma** del carico —
 * dove si accumula, dove si svuota — non la mezz'ora; e la mezz'ora vera resta
 * nella cella, si rivede tornando a «stretta» e si riscrive intera aprendola.
 */
export const DENSITA = /** @type {const} */ ({
  comoda: { w: 52, etichetta: 'comoda', intere: false },
  stretta: { w: 38, etichetta: 'stretta', intere: false },
  anno: { w: 28, etichetta: 'anno', intere: true },
});

/** @typedef {keyof typeof DENSITA} Densita */

const CHIAVE = 'md_pg_densita_v1';

/**
 * La densità scelta, ricordata fra una visita e l'altra: è come uno ha lasciato
 * la schermata, e ritrovarla larga ogni volta vorrebbe dire rimpicciolirla ogni
 * volta.
 * @returns {[Densita, (quale: Densita) => void]}
 */
export function useDensita() {
  const [densita, setDensita] = useState(() => {
    const salvata = String(readPref(CHIAVE, 'comoda'));
    return /** @type {Densita} */ (salvata in DENSITA ? salvata : 'comoda');
  });
  return [densita, (/** @type {Densita} */ quale) => { setDensita(quale); writePref(CHIAVE, quale); }];
}
