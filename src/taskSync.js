// @ts-check
// Sincronizzazione incrementale delle attività di To-Do.
//
// Prima: a ogni avvio, per ogni lista, si riscaricava l'elenco completo delle
// attività aperte. Con dodici liste sono dodici richieste per scoprire, quasi
// sempre, che nulla è cambiato — e la lista non si poteva interrogare spesso,
// perché interrogarla costava sempre lo stesso. Da lì il TTL di due ore, e i
// dati stantii in mezzo.
//
// Qui la domanda cambia: non «dammi tutte le attività» ma «dammi quelle
// cambiate da quando ho guardato l'ultima volta». La risposta normale è vuota, e
// si può quindi chiedere spesso.
//
// ── Perché non i delta token di Graph ──────────────────────────────────────
// La strada canonica sarebbe `/tasks/delta`, che dà anche le cancellazioni. Ha
// due problemi concreti qui: per ottenere il primo token bisogna paginare
// l'intera lista *comprese le attività completate* — che in una lista usata da
// anni sono la maggioranza — e `$deltatoken=latest`, che eviterebbe quel giro, è
// documentato per le risorse Outlook ma non per To-Do, quindi non verificabile
// senza provarlo su un account vero.
//
// Il filtro su `lastModifiedDateTime` è documentato, si comporta come ci si
// aspetta e costa una richiesta piccola. In cambio non racconta le
// cancellazioni: un'attività cancellata da un altro dispositivo non compare fra
// quelle «cambiate» e resterebbe a schermo. Per questo ogni lista viene
// comunque riallineata per intero una volta al giorno, e sempre quando si preme
// «Aggiorna tutto» — che è esattamente il gesto di chi vede qualcosa di stantio.
import { getTodoTasks, getTodoTasksChangedSince } from './api';
import { queryClient, qk, STALE } from './queryClient';
import { getMarker, setMarker } from './markers';

/** Oltre questa età dall'ultimo allineamento completo si rilegge tutto. */
const FULL_RESYNC_AFTER = 24 * 60 * 60 * 1000;

/** Un filo di sovrapposizione sulla finestra: gli orologi non sono allineati al
 *  millisecondo, e perdere una modifica è peggio che rileggerla. */
const OVERLAP_MS = 60 * 1000;

const SYNC_MARKER = 'tasks_full_sync';
const SYNC_MARKER_TTL = 30 * 24 * 60 * 60 * 1000;

/** @returns {Record<string, string>} listId → ISO dell'ultimo allineamento completo */
function readSyncMap() {
  const m = getMarker(SYNC_MARKER);
  return m && typeof m === 'object' ? m : {};
}

/** @param {string} listId @param {string} iso */
function rememberSync(listId, iso) {
  setMarker(SYNC_MARKER, { ...readSyncMap(), [listId]: iso }, SYNC_MARKER_TTL);
}

/**
 * Le attività di una lista, aggiornate. Restituisce anche *come* le ha prese,
 * così chi chiama può dirlo (e i test a mano si vedono in console).
 *
 * @param {{ id: string, displayName: string }} list
 * @param {{ forceFull?: boolean }} [opts]
 * @returns {Promise<{ tasks: any[], mode: 'completo'|'incrementale', changed: number }>}
 */
export async function syncTasksForList(list, opts = {}) {
  const cached = /** @type {any[]|undefined} */ (queryClient.getQueryData(qk.tasks(list.id)));
  const lastFull = readSyncMap()[list.id];
  const tooOld = !lastFull || (Date.now() - new Date(lastFull).getTime()) > FULL_RESYNC_AFTER;

  if (opts.forceFull || tooOld || !cached) {
    const tasks = await queryClient.fetchQuery({
      queryKey: qk.tasks(list.id),
      queryFn: () => getTodoTasks(list.id),
      staleTime: 0,
    });
    rememberSync(list.id, new Date().toISOString());
    return { tasks, mode: 'completo', changed: tasks.length };
  }

  const since = new Date(new Date(lastFull).getTime() - OVERLAP_MS).toISOString();
  const changed = await getTodoTasksChangedSince(list.id, since);

  // Niente di nuovo: si tiene la copia in cache e non si scrive nulla, così non
  // si sveglia inutilmente la serializzazione su localStorage.
  if (!changed.length) return { tasks: cached, mode: 'incrementale', changed: 0 };

  const merged = applyChanges(cached, changed);
  queryClient.setQueryData(qk.tasks(list.id), merged);
  return { tasks: merged, mode: 'incrementale', changed: changed.length };
}

/**
 * Applica le attività cambiate alla copia in memoria.
 *
 * La finestra non è filtrata per stato — a differenza della lettura completa,
 * che chiede solo le aperte — quindi qui arrivano anche quelle appena
 * completate: sono la ragione principale per cui un elenco cambia, e vanno
 * togliete dal serbatoio invece che aggiornate dentro.
 *
 * @param {any[]} current
 * @param {any[]} changed
 * @returns {any[]}
 */
export function applyChanges(current, changed) {
  const byId = new Map((current || []).map(t => [t.id, t]));
  for (const t of changed) {
    if (t.status === 'completed') byId.delete(t.id);
    else byId.set(t.id, { ...(byId.get(t.id) || {}), ...t });
  }
  return [...byId.values()];
}

/** Quanto è fresca la copia di questa lista, per la barra di stato. */
export function lastFullSyncAt(/** @type {string} */ listId) {
  return readSyncMap()[listId] || null;
}

export { STALE };
