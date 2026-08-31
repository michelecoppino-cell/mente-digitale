// @ts-check
// L'ordine a mano delle attività dentro una lista, e il trascinamento che lo
// cambia.
//
// Le viste raggruppano sempre le attività per lista — o per consegna, che è
// una lista annidata (vedi paraConfig.js) — e l'ordine dentro il gruppo era
// finora derivato: per scadenza nel serbatoio e nella board, per orario fra le
// programmate. Un ordine derivato dice cosa scade prima, non cosa si vuole
// fare prima: due cose senza scadenza restano nell'ordine in cui sono nate,
// che non è un ordine.
//
// Riordinare vuol dire quindi scrivere una posizione sul task (`ordine`, vedi
// taskStore.js) — e siccome i gruppi sono liste, si riordina **una lista alla
// volta**: trascinare una riga sopra una di un'altra consegna non è un
// riordino, è uno spostamento, e quello ha già il suo gesto (il rilascio sul
// gruppo, in Sezioni).
//
// Il gesto è il trascinamento del mouse e basta: da telefono le stesse righe
// si trascinano già per programmarle, e sovrapporre due significati allo
// stesso dito darebbe un ordine cambiato per sbaglio ogni volta che si vuole
// mettere qualcosa in agenda.
import { riordinaTask } from './taskStore';
import { pushUndo } from './undo';

/** Il riordino si fa col mouse, e solo col mouse: da telefono le stesse righe
 *  si trascinano già per programmarle, e due significati sullo stesso dito
 *  vorrebbero dire un ordine cambiato per sbaglio ogni volta che si mette
 *  qualcosa in agenda. `pointer: fine` è il puntatore preciso — mouse,
 *  trackpad, penna — cioè esattamente «da PC». */
export const CON_MOUSE = '(pointer: fine)';

/**
 * Fra due attività della stessa lista: prima quelle messe in ordine a mano,
 * nella posizione che hanno; le altre restano indietro, e fra loro decide il
 * criterio della vista.
 * @param {{ ordine?: number|null }} a
 * @param {{ ordine?: number|null }} b
 * @returns {number} 0 se nessuna delle due è stata messa a mano
 */
export function confrontaOrdine(a, b) {
  const oa = a?.ordine ?? null;
  const ob = b?.ordine ?? null;
  if (oa === null && ob === null) return 0;
  if (oa === null) return 1;
  if (ob === null) return -1;
  return oa - ob;
}

/**
 * L'elenco di un gruppo come va mostrato: l'ordine a mano davanti a tutto, il
 * criterio della vista dove l'ordine a mano non c'è.
 * @template {{ ordine?: number|null }} T
 * @param {T[]} tasks
 * @param {(a: T, b: T) => number} [fallback]  il criterio della vista
 * @returns {T[]}
 */
export function ordinaAMano(tasks, fallback) {
  return [...tasks].sort((a, b) => confrontaOrdine(a, b) || (fallback ? fallback(a, b) : 0));
}

/**
 * Dove finisce la riga trascinata: prima o dopo quella su cui si è rilasciata,
 * a seconda che la si stia risalendo o scendendo. Senza questa distinzione
 * trascinare l'ultima riga sulla prima la metterebbe seconda.
 * @param {string[]} ids       gli id del gruppo, nell'ordine in cui si vedono
 * @param {string} daId        la riga trascinata
 * @param {string} suId        la riga su cui è stata rilasciata
 * @returns {string[]|null}    null se non c'è niente da cambiare
 */
export function ordineDopoTrascinamento(ids, daId, suId) {
  const da = ids.indexOf(daId);
  const su = ids.indexOf(suId);
  if (da < 0 || su < 0 || da === su) return null;
  const prossimi = [...ids];
  prossimi.splice(da, 1);
  prossimi.splice(su, 0, daId);
  return prossimi;
}

/**
 * Riordina il gruppo e scrive: una scrittura sola sul file della lista, con
 * dentro le posizioni di tutte le righe che si vedono.
 *
 * L'annulla rimette l'ordine di prima riscrivendolo, invece di rimettere i
 * campi com'erano: quello che si vuole indietro è la fila che si vedeva, e
 * riscriverla la riporta identica anche dove prima nessuno l'aveva toccata.
 *
 * @param {Object} opts
 * @param {string} opts.listId
 * @param {import('./taskStore').Task[]} opts.gruppo  le attività del gruppo, nell'ordine mostrato
 * @param {string} opts.daId
 * @param {string} opts.suId
 * @param {(listId: string, taskId: string, patch: { ordine: number }) => void} [opts.onOrdinato]
 * @returns {Promise<boolean>} true se qualcosa è cambiato
 */
export async function riordinaGruppo({ listId, gruppo, daId, suId, onOrdinato }) {
  // Solo le righe di questa lista: un gruppo può essere un progetto a mano
  // con dentro attività di liste diverse (vedi plannerShared.findProject), e
  // scrivere le posizioni mescolate darebbe due file con lo stesso numero e
  // un ordine che dipende da chi legge per primo.
  const dellaLista = gruppo.filter(t => (t._listId || '') === listId);
  const ids = dellaLista.map(t => t.id);
  const prima = [...ids];
  const dopo = ordineDopoTrascinamento(ids, daId, suId);
  if (!dopo) return false;

  const scritti = await riordinaTask(listId, dopo);
  const posizioni = new Map(scritti.map(t => [t.id, t.ordine]));
  for (const id of dopo) {
    const ordine = posizioni.get(id);
    if (typeof ordine === 'number') onOrdinato?.(listId, id, { ordine });
  }
  pushUndo({
    label: 'Ordine delle attività',
    undo: async () => {
      const indietro = await riordinaTask(listId, prima);
      for (const t of indietro) {
        if (typeof t.ordine === 'number') onOrdinato?.(listId, t.id, { ordine: t.ordine });
      }
    },
  });
  return true;
}
