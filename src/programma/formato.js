// @ts-check
// Come si scrivono e come si leggono le ore in questa vista.
//
// Sta in un file suo e non dentro `Matrice.jsx` per una ragione pratica: un
// modulo che esporta un componente **e** delle funzioni rompe il ricaricamento
// a caldo di Vite, e queste due righe le usano quattro componenti diversi.

/**
 * Il numero come si scrive in una cella: intero secco, mezz'ora con la virgola,
 * e **niente** quando è zero. Una cella vuota è vuota: nessuno zero, nessun
 * trattino — su venticinque colonne il rumore degli zeri copre il dato.
 * @param {number} ore
 * @returns {string}
 */
export function oreBrevi(ore) {
  if (!ore) return '';
  return Number.isInteger(ore) ? String(ore) : String(ore).replace('.', ',');
}

/**
 * Il numero battuto in una cella. Interi e mezze ore, virgola o punto; tutto il
 * resto si rifiuta **senza svuotare la cella**, perché una cifra sbagliata non
 * deve costare il valore che c'era.
 * @param {string} testo
 * @returns {number|null} null se non è un numero che qui abbia senso
 */
export function leggiOre(testo) {
  const pulito = String(testo).trim().replace(',', '.');
  if (pulito === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(pulito)) return null;
  const n = Number(pulito);
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
}
