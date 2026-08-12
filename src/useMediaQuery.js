// @ts-check
// Una media query letta da JS, non solo da CSS.
//
// Serve dove la soglia non cambia solo l'aspetto ma il comportamento: il
// panino della shell ha un handler solo e due significati (drawer sotto gli
// 860px, rail ridotto sopra), e il pannello Dettagli del Piano è una colonna
// da desktop e un foglio dal basso da telefono — e va montato una volta sola,
// non due con una nascosta dal CSS.
//
// matchMedia è una sorgente esterna a React, quindi si legge con
// useSyncExternalStore invece che con stato + effetto: niente render in più al
// montaggio e nessuna finestra in cui il valore è quello sbagliato.
import { useCallback, useSyncExternalStore } from 'react';

const supported = () => typeof window !== 'undefined' && !!window.matchMedia;

/**
 * @param {string} query
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const subscribe = useCallback((/** @type {() => void} */ onChange) => {
    if (!supported()) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  const getSnapshot = useCallback(
    () => (supported() ? window.matchMedia(query).matches : false),
    [query]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
