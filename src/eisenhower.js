// @ts-check
// Matrice di Eisenhower: quadrante codificato come marker `[EIS:Qn]` in testa
// alle note del task di Microsoft To-Do (letto/scritto via body.content).

export const EIS_QUADRANTS = [
  { key: 'Q1', label: 'Urgente + Importante', short: 'Fai subito',  color: '#c07a7a' },
  { key: 'Q2', label: 'Importante',           short: 'Pianifica',   color: '#c8a96e' },
  { key: 'Q3', label: 'Urgente',              short: 'Delega',      color: '#7eb8c9' },
  { key: 'Q4', label: 'Né urgente né importante', short: 'Elimina/rinvia', color: '#8a8a8a' },
];

const MARKER_RE = /\[EIS:(Q[1-4])\]/;

/**
 * Estrae il quadrante Eisenhower dal marker [EIS:Qn] in testa alle note.
 * @param {string|null|undefined} bodyContent
 * @returns {import('./types').EisenhowerKey|null}
 */
export function parseEisenhower(bodyContent) {
  if (!bodyContent) return null;
  const m = bodyContent.match(MARKER_RE);
  return m ? /** @type {import('./types').EisenhowerKey} */ (m[1]) : null;
}

/**
 * @param {string} key
 * @returns {{ key: string, label: string, short: string, color: string }|null}
 */
export function quadrantInfo(key) {
  return EIS_QUADRANTS.find(q => q.key === key) || null;
}

// Inserisce/sostituisce il marker in testa al testo, preservando il resto delle note.
/**
 * @param {string|null|undefined} bodyContent
 * @param {import('./types').EisenhowerKey} quadrant
 * @returns {string}
 */
export function withEisenhowerMarker(bodyContent, quadrant) {
  const rest = (bodyContent || '').replace(MARKER_RE, '').replace(/^\s+/, '');
  const marker = `[EIS:${quadrant}]`;
  return rest ? `${marker} ${rest}` : marker;
}
