// @ts-check
// Un documento su OneDrive letto in modo che sullo schermo ci sia sempre
// qualcosa: prima la copia dell'ultimo caricamento, poi quella appena letta.
//
// Serve perché su iPhone l'app non resta mai aperta a lungo. Il telefono butta
// via la pagina dopo pochi minuti in secondo piano, e riaprire l'icona non è
// tornare dove si era: è un avvio da capo, con tutti gli stati React vuoti.
// Finora ogni riquadro di «Oggi» partiva da lì — stato vuoto, lettura in volo,
// e sullo schermo il nulla per il tempo che ci mette OneDrive a rispondere,
// che dal telefono in giro non sono decimi di secondo.
//
// La cache di TanStack quel documento ce l'ha già, ripristinata da
// localStorage prima ancora del primo render (vedi queryClient.js): il punto
// non è ritrovarlo, è mostrarlo mentre si rilegge invece di aspettare. È
// esattamente quello che fa useQuery — `data` è la copia in cache al primo
// render, il refetch parte se il dato è vecchio, e quando arriva la risposta
// il riquadro si aggiorna sotto gli occhi senza essere mai stato vuoto.
//
// Se la rilettura fallisce (rete assente, sessione scaduta) `data` resta la
// copia di prima: meglio dei dati di mezz'ora fa che una schermata vuota, ed è
// la stessa scelta già fatta per i task in App.jsx.
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from './queryClient';

/**
 * @template T
 * @param {readonly unknown[]} queryKey
 * @param {() => Promise<T>} queryFn
 * @param {number} staleTime
 * @param {T} vuoto  cosa mostrare la primissima volta, quando in cache non c'è niente
 * @returns {{ dato: T, aggiorna: (d: T | ((prec: T) => T)) => void, fresco: boolean }}
 */
export function useDatoPersistito(queryKey, queryFn, staleTime, vuoto) {
  const { data, isFetching, isStale } = useQuery({ queryKey, queryFn, staleTime });

  // La scrittura locale va nella cache e non in uno stato a parte: è la cache
  // la copia che sopravvive alla chiusura dell'app, e una modifica salvata su
  // OneDrive ma non scritta qui tornerebbe indietro alla riapertura.
  const aggiorna = useCallback((/** @type {T | ((prec: T) => T)} */ d) => {
    queryClient.setQueryData(queryKey, (/** @type {T|undefined} */ prec) =>
      typeof d === 'function' ? /** @type {(p: T) => T} */ (d)(prec === undefined ? vuoto : prec) : d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(queryKey)]);

  // `fresco` è per chi la copia vecchia non se la può permettere: non basta
  // avere un dato, bisogna sapere che è quello buono. Vero solo con una
  // lettura confermata — o arrivata adesso, o abbastanza recente da non
  // doverla rifare — e falso mentre la rilettura è in volo o se è fallita.
  //
  // Ne ha bisogno il rituale del mattino: decide quali giorni tappare come
  // «non fatto» guardando quello che manca nel documento, e farlo su una copia
  // di ieri vorrebbe dire riscrivere così una risposta data dall'altro
  // dispositivo. Mostrare qualcosa di vecchio non fa danni; scriverci sopra sì.
  const fresco = data !== undefined && !isFetching && !isStale;

  return { dato: data === undefined ? vuoto : data, aggiorna, fresco };
}
