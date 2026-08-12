// @ts-check
// Una media query letta da JS, non solo da CSS.
//
// Serve dove la soglia non cambia solo l'aspetto ma il comportamento: il
// panino della shell ha un handler solo e due significati (drawer sotto gli
// 860px, rail ridotto sopra), e il pannello Dettagli del Piano è una colonna
// da desktop e un foglio dal basso da telefono — e va montato una volta sola,
// non due con una nascosta dal CSS.
import { useEffect, useState } from 'react';

/**
 * @param {string} query
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (/** @type {MediaQueryListEvent} */ e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
