// @ts-check
// Preferenze di vista persistite: quali gruppi sono chiusi, e cose così.
//
// Non sono dati (quelli stanno su Graph, vedi queryClient.js) e non sono
// marker con scadenza (markers.js): sono il modo in cui l'utente ha lasciato
// una schermata, e deve ritrovarlo com'era al rientro. Stesso posto e stessa
// forma della barra laterale ridotta (`AppShell.jsx`), ma raccolti qui perché
// ormai li usano tre pannelli.

import { useCallback, useEffect, useState } from 'react';

/**
 * @param {string} key
 * @param {any} fallback
 * @returns {any}
 */
export function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

/**
 * @param {string} key
 * @param {any} value
 */
export function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage pieno o negato */ }
}

/**
 * L'insieme dei gruppi chiusi di un pannello, ricordato fra una visita e
 * l'altra. Si tiene l'elenco dei chiusi e non degli aperti: un gruppo nuovo
 * (una consegna appena creata) deve nascere aperto, non nascosto.
 * @param {string} key  chiave su localStorage, con la versione nel nome
 * @returns {[(id: string) => boolean, (id: string) => void]}
 */
export function useFolds(key) {
  const [folded, setFolded] = useState(() => {
    const saved = readPref(key, []);
    return /** @type {string[]} */ (Array.isArray(saved) ? saved.filter(v => typeof v === 'string') : []);
  });

  useEffect(() => { writePref(key, folded); }, [key, folded]);

  const isFolded = useCallback((/** @type {string} */ id) => folded.includes(id), [folded]);
  const toggle = useCallback((/** @type {string} */ id) => {
    setFolded(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  }, []);

  return [isFolded, toggle];
}
