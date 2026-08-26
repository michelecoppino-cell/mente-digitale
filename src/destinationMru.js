// @ts-check
// Le destinazioni usate di recente dalla cattura rapida.
//
// Le cose si buttano quasi sempre negli stessi tre o quattro posti: senza un
// ordine d'uso il pannello delle destinazioni ripartirebbe ogni volta
// dall'ordine in cui Graph restituisce le liste, che non vuol dire niente.
// È una preferenza di vista, non un dato — stesso posto e stessa forma degli
// altri (`viewPrefs.js`).
import { readPref, writePref } from './viewPrefs';

const MRU_KEY = 'mente.capture.dest.mru.v1';
const MRU_MAX = 6;

/** @returns {string[]} gli id delle liste usate di recente, dalla più recente */
export function readDestMru() {
  const saved = readPref(MRU_KEY, []);
  return Array.isArray(saved) ? saved.filter(v => typeof v === 'string') : [];
}

/** @param {string} listId */
export function pushDestMru(listId) {
  if (!listId) return;
  const next = [listId, ...readDestMru().filter(id => id !== listId)].slice(0, MRU_MAX);
  writePref(MRU_KEY, next);
}

/**
 * Le destinazioni riordinate per uso recente. Non filtra e non toglie niente:
 * chi è stato usato da poco sale in cima, il resto mantiene l'ordine ricevuto.
 * @param {import('./captureParse').Destination[]} destinations
 * @returns {import('./captureParse').Destination[]}
 */
export function byRecentUse(destinations) {
  const mru = readDestMru();
  const rank = new Map(mru.map((id, i) => [id, i]));
  return [...(destinations || [])].sort((a, b) => {
    const ra = rank.has(a.id) ? /** @type {number} */ (rank.get(a.id)) : Infinity;
    const rb = rank.has(b.id) ? /** @type {number} */ (rank.get(b.id)) : Infinity;
    return ra - rb;
  });
}
