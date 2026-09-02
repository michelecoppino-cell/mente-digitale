// @ts-check
// Il serbatoio delle attività: tutte quelle aperte, di tutte le liste, in un
// elenco solo. È quello che leggono «Oggi», il Piano, la vista Attività, la
// plancia di Sezioni, la ricerca e le sveglie.
//
// **Non è uno stato, è una lettura.** Fin qui esisteva in tre copie: uno stato
// React in `App.jsx`, un `ref` passato al pannello di sezione, e la cache di
// query — che è quella vera, l'unica che sopravvive alla chiusura dell'app.
// Le tre si tenevano in pari a mano, con una funzione apposta
// (`updateTasksEverywhere`) da ricordarsi di chiamare a ogni modifica: un
// percorso che se ne dimenticava lasciava una schermata che mostrava la
// versione di prima.
//
// È la stessa classe di difetto che `taskStore.js` aveva già rifiutato quando
// ha deciso di non tenere un file indice delle attività — «un indice è una
// cache che si disallinea» — e la stessa strada che `useDatoPersistito` aveva
// già preso per i documenti di «Oggi»: la cache *è* lo stato, e non c'è una
// seconda copia da rincorrere.
//
// Qui il pool si ricava dalla cache, lista per lista, e si ricalcola quando la
// cache cambia. Scrivere una modifica vuol dire scrivere lì — una riga sola — e
// tutto quello che legge il pool la vede.

import { useMemo, useSyncExternalStore } from 'react';
import { queryClient, qk } from './queryClient.js';

/** Il primo pezzo delle chiavi delle attività: `['tasks', listId]`. */
const CHIAVE = qk.tasks('')[0];

// Un contatore che sale a ogni cambiamento delle query delle attività.
//
// `useSyncExternalStore` pretende che due letture consecutive senza notifica
// diano lo stesso valore, e ricostruire l'elenco a ogni lettura darebbe ogni
// volta un array nuovo. Il numero invece è stabile, e il `useMemo` che ci sta
// sopra ricostruisce solo quando serve.
let versione = 0;
/** @type {Set<() => void>} */
const ascoltatori = new Set();
/** @type {(() => void)|null} */
let staccaDallaCache = null;

/** @param {() => void} ascoltatore @returns {() => void} */
function iscrivi(ascoltatore) {
  ascoltatori.add(ascoltatore);
  // Una sola sottoscrizione alla cache per tutta l'app, non una per componente:
  // il pool lo leggono in cinque, e cinque sottoscrizioni farebbero cinque giri
  // dello stesso lavoro a ogni scrittura.
  if (!staccaDallaCache) {
    staccaDallaCache = queryClient.getQueryCache().subscribe(ev => {
      if (ev?.query?.queryKey?.[0] !== CHIAVE) return;
      versione++;
      for (const a of ascoltatori) a();
    });
  }
  return () => {
    ascoltatori.delete(ascoltatore);
    if (ascoltatori.size === 0 && staccaDallaCache) {
      staccaDallaCache();
      staccaDallaCache = null;
    }
  };
}

const istantanea = () => versione;

/**
 * Le attività aperte di tutte le liste, decorate con la lista da cui vengono.
 *
 * `null` vuol dire «non è ancora arrivato niente», ed è diverso da un elenco
 * vuoto: il primo fa comparire lo scheletro, il secondo dice «non c'è niente da
 * fare oggi», e le due cose non si possono scambiare.
 *
 * Il nome della lista si riattacca qui, a ogni lettura, e non si conserva
 * dentro l'attività: dopo aver rinominato una consegna — che è come si sposta
 * la sua scadenza — il nome vecchio direbbe la data sbagliata.
 *
 * @param {{ id: string, displayName: string }[]} todoLists
 * @returns {import('./taskStore').Task[]|null}
 */
export function usePoolAttivita(todoLists) {
  const v = useSyncExternalStore(iscrivi, istantanea, istantanea);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => componiPool(todoLists), [v, todoLists]);
}

/**
 * La composizione vera, senza React attorno: si legge la cache lista per lista
 * e si mette tutto in fila. Sta fuori dal hook perché è la parte che si prova.
 *
 * @param {{ id: string, displayName: string }[]} todoLists
 * @returns {import('./taskStore').Task[]|null}
 */
export function componiPool(todoLists) {
  /** @type {import('./taskStore').Task[]} */
  const tutte = [];
  let qualcuna = false;
  for (const l of todoLists || []) {
    const attivita = /** @type {import('./taskStore').Task[]|undefined} */ (
      queryClient.getQueryData(qk.tasks(l.id)));
    if (!attivita) continue;
    qualcuna = true;
    for (const t of attivita) tutte.push({ ...t, _listId: l.id, _listName: l.displayName });
  }
  return qualcuna ? tutte : null;
}

/**
 * Cambia le attività di una lista nella cache — che è l'unico posto in cui
 * stanno. Chi legge il pool se ne accorge da sé.
 *
 * Non fa niente se quella lista non è ancora stata letta, ed è voluto: togliere
 * o modificare qualcosa dentro un elenco che non si conosce vorrebbe dire
 * scrivere `[]` e dichiarare vuota una lista che magari è piena, nascondendone
 * le attività fino alla lettura vera. Chi *aggiunge* usa `aggiungiAlPool`, che
 * quel caso lo sa gestire.
 *
 * @param {string} listId
 * @param {(attivita: import('./taskStore').Task[]) => import('./taskStore').Task[]} muta
 */
export function cambiaAttivitaInPool(listId, muta) {
  queryClient.setQueryData(qk.tasks(listId), (
    /** @type {import('./taskStore').Task[]|undefined} */ precedenti) => (
    precedenti ? muta(precedenti) : precedenti));
}

/**
 * Mette un'attività appena nata nell'elenco della sua lista.
 *
 * Qui una lista sconosciuta si può cominciare da zero, e serve: una consegna
 * creata poco fa non è mai stata letta, e catturarci dentro qualcosa deve farlo
 * comparire subito invece che al giro dopo. Quello che arriva dalla lettura
 * vera prende comunque il posto di questo elenco provvisorio.
 *
 * @param {string|null|undefined} listId
 * @param {import('./taskStore').Task} task
 */
export function aggiungiAlPool(listId, task) {
  if (!listId) return;
  queryClient.setQueryData(qk.tasks(listId), (
    /** @type {import('./taskStore').Task[]|undefined} */ precedenti) => {
    const elenco = precedenti || [];
    // Due catture dello stesso id — un undo rifatto, una doppia conferma — non
    // devono lasciare due righe uguali.
    return elenco.some(t => t.id === task.id)
      ? elenco.map(t => (t.id === task.id ? task : t))
      : [...elenco, task];
  });
}
