// @ts-check
import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Cache token in memoria per evitare acquireTokenSilent ad ogni chiamata
/** @type {string|null} */
let _cachedToken = null;
let _cachedTokenExp = 0;

/** @returns {Promise<string>} */
async function getTokenCached() {
  if (_cachedToken && Date.now() < _cachedTokenExp) return _cachedToken;
  const token = await getToken();
  _cachedToken = token;
  _cachedTokenExp = Date.now() + 45 * 60 * 1000; // 45 min (token MS dura 1h)
  return token;
}

export function invalidateTokenCache() { _cachedToken = null; _cachedTokenExp = 0; }

/**
 * Chiamata a Microsoft Graph con retry/backoff, un giro extra sul 401 (token
 * fresco) e gestione di 429/503/504. Accetta path relativi (`/me/...`) o URL
 * assoluti (i @odata.nextLink di paginazione).
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
async function call(path, options = {}, retries = 3) {
  // Accetta anche URL assoluti: i link di paginazione @odata.nextLink di Graph
  // arrivano già completi di host.
  const url = path.startsWith('https://') ? path : GRAPH + path;
  let retried401 = false;
  for (let attempt = 0; attempt < retries; attempt++) {
    let r;
    try {
      const token = await getTokenCached();
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...options
      });
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(res => setTimeout(res, (attempt + 1) * 1000));
      continue;
    }
    if (r.status === 204) return null;
    // Il token cachato può risultare scaduto (es. dopo una pausa lunga):
    // invalida la cache e riprova una volta sola con un token fresco prima
    // di arrendersi con un errore secco. Il giro extra non consuma uno dei
    // tentativi normali (altrimenti un 401 all'ultimo giro usciva con
    // "tentativi esauriti" senza aver mai provato il token fresco).
    if (r.status === 401 && !retried401) {
      retried401 = true;
      invalidateTokenCache();
      attempt--;
      continue;
    }
    if (r.status === 429 || r.status === 503 || r.status === 504) {
      const retry = r.headers.get('Retry-After');
      const wait = retry ? parseInt(retry) * 1000 : (attempt + 1) * 1000;
      await new Promise(res => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) {
      // Espone il messaggio d'errore di Graph (error.code/message) invece del
      // solo status code — senza questo un 400 non dice nulla sul perché.
      let detail = '';
      try {
        const errBody = await r.json();
        if (errBody?.error?.message) {
          detail = ` — ${errBody.error.code ? errBody.error.code + ': ' : ''}${errBody.error.message}`;
        }
      } catch { /* corpo non-JSON o vuoto */ }
      const err = /** @type {Error & { status?: number }} */ (new Error(`Graph error ${r.status}${detail}`));
      err.status = r.status; // permette ai chiamanti di distinguere 404 da errori transitori
      throw err;
    }
    return r.json();
  }
  throw new Error(`Graph error: tentativi esauriti per ${path}`);
}

// Segue @odata.nextLink e concatena i .value di tutte le pagine: senza,
// le liste più lunghe di $top venivano troncate in silenzio (task mancanti,
// controllo anti-duplicati delle scadenze incompleto).
/**
 * Segue @odata.nextLink e concatena i .value di tutte le pagine.
 * @param {string} path
 * @param {number} [maxPages]
 * @returns {Promise<any[]>}
 */
async function callPagedValues(path, maxPages = 10) {
  /** @type {any[]} */
  const out = [];
  let next = path;
  for (let i = 0; i < maxPages && next; i++) {
    const d = await call(next);
    out.push(...(d?.value || []));
    next = d?.['@odata.nextLink'] || null;
  }
  return out;
}

// ── Cartella dei file dell'app su OneDrive ──────────────────────────────────
// Tutti i JSON dell'app stanno in una sola cartella invece che sparsi nella
// root del OneDrive personale: i file sono ormai una decina e crescono con i
// mesi del diario. I nomi restano quelli di prima (prefisso `mente-digitale-`)
// per non dover riscrivere niente: cambia solo la cartella che li contiene.
const OD_FOLDER = 'mente-digitale';

/** @param {string} filename @returns {string} */
function drivePath(filename) {
  return `/me/drive/root:/${OD_FOLDER}/${filename}`;
}

// Creazione della cartella al primo bisogno, una volta per sessione: il 409
// (esiste già) è l'esito normale dopo la prima volta in assoluto.
/** @type {Promise<any>|null} */
let _folderReady = null;
function ensureAppFolder() {
  if (!_folderReady) {
    _folderReady = call('/me/drive/root/children', {
      method: 'POST',
      body: JSON.stringify({ name: OD_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    }).catch(e => {
      if (e?.status === 409) return null;
      _folderReady = null;   // errore vero (rete, permessi): si riproverà
      throw e;
    });
  }
  return _folderReady;
}

// Migrazione pigra dei file salvati nella root prima dell'introduzione della
// cartella: al primo 404 sul percorso nuovo si prova a spostare il vecchio
// file con un PATCH (spostamento vero lato Graph, niente copia + cancella,
// quindi nessuna finestra in cui il dato esiste in due posti o in nessuno).
// Un tentativo solo per nome di file: i file mai esistiti — es. il mese di
// diario di un mese in cui non si è scritto — non devono costare una richiesta
// a ogni lettura.
/** @type {Set<string>} */
const _migrationTried = new Set();

/** @param {string} filename @returns {Promise<boolean>} true se il file è stato spostato */
async function migrateLegacyFile(filename) {
  if (_migrationTried.has(filename)) return false;
  _migrationTried.add(filename);
  try {
    await ensureAppFolder();
    await call(`/me/drive/root:/${filename}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentReference: { path: `/drive/root:/${OD_FOLDER}` } }),
    });
    return true;
  } catch {
    // Nessun file da migrare (404) o spostamento fallito: si prosegue con il
    // percorso nuovo, che è comunque la sola fonte di verità da qui in poi.
    return false;
  }
}

// Migrazione in blocco: sposta nella cartella tutti i file `mente-digitale-*.json`
// rimasti nella root. La migrazione pigra di getDriveJson basterebbe a non
// perdere nulla, ma sposterebbe ogni file solo quando la funzione che lo usa
// viene aperta — la root resterebbe sporca per giorni. Questa gira una volta
// sola (vedi il marker in App.jsx) e ripulisce tutto insieme.
/** @returns {Promise<number>} quanti file sono stati spostati */
export async function migrateLegacyDriveFiles() {
  const items = await callPagedValues('/me/drive/root/children?$select=id,name,file&$top=200');
  const legacy = items.filter(i => i.file && /^mente-digitale-.*\.json$/.test(i.name || ''));
  if (!legacy.length) return 0;
  await ensureAppFolder();
  let moved = 0;
  for (const item of legacy) {
    try {
      await call(`/me/drive/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentReference: { path: `/drive/root:/${OD_FOLDER}` } }),
      });
      _migrationTried.add(item.name);
      moved++;
    } catch (e) {
      console.error('migrazione file OneDrive', item.name, e);
    }
  }
  return moved;
}

// PUT di un file JSON nella cartella dell'app su OneDrive
/**
 * @param {string} filename
 * @param {any} data
 * @returns {Promise<any>}
 */
async function putDriveJson(filename, data) {
  await ensureAppFolder();
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}${drivePath(filename)}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!r.ok) throw new Error(`Save ${filename} error ${r.status}`);
  return r.json();
}

/** @returns {Promise<import('./types').Notebook[]>} */
export async function getNotebooks() {
  const d = await call('/me/onenote/notebooks?includePersonalNotebooks=true&$orderby=displayName');
  return d.value;
}

/**
 * @param {string} notebookId
 * @returns {Promise<import('./types').Section[]>}
 */
export async function getSections(notebookId) {
  const d = await call(`/me/onenote/notebooks/${notebookId}/sections?$orderby=displayName`);
  return d.value;
}

// Restituisce tutte le pagine top-level (level=0) della sezione
/**
 * @param {string} sectionId
 * @returns {Promise<import('./types').Page[]>}
 */
export async function getPages(sectionId) {
  return callPagedValues(`/me/onenote/sections/${sectionId}/pages?pagelevel=true&$top=100`);
}

// Contenuto HTML grezzo di una pagina OneNote (l'endpoint restituisce HTML, non
// JSON). Manteniamo l'HTML — non testo semplice — perché i tag nativi di OneNote
// come "Da fare" (Ctrl+1) sono marcati con l'attributo data-tag sui paragrafi,
// il segnale usato dall'euristica della Daily Review per trovare le azioni.
/**
 * @param {string} pageId
 * @returns {Promise<string>}
 */
export async function getPageContentHtml(pageId) {
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/onenote/pages/${pageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Page content error ${r.status}`);
  return r.text();
}

/** @returns {Promise<import('./types').TodoList[]>} */
export async function getTodoLists() {
  return callPagedValues('/me/todo/lists');
}

/**
 * @param {string} listId
 * @returns {Promise<import('./types').TodoTask[]>}
 */
export async function getTodoTasks(listId) {
  return callPagedValues(`/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$orderby=importance desc,createdDateTime desc&$top=50`);
}

// Task di una lista indipendentemente dallo stato (anche completati), solo
// id+body: usata per il controllo anti-duplicati delle scadenze ricorrenti
// (refreshDeadlineReminders in App.jsx) — getTodoTasks esclude i completati,
// e uno spuntato non deve poter essere ricreato al giro successivo.
/**
 * @param {string} listId
 * @returns {Promise<import('./types').TodoTask[]>}
 */
export async function getTasksForDeadlineDedup(listId) {
  return callPagedValues(`/me/todo/lists/${listId}/tasks?$select=id,body&$top=200`);
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @returns {Promise<any>}
 */
export async function completeTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
}

// Usata anche per annullare un completamento (status: 'notStarted').
/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} status
 * @returns {Promise<any>}
 */
export async function updateTaskStatus(listId, taskId, status) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

/**
 * @param {string} listId
 * @param {string} title
 * @param {{ body?: string, dueDate?: string }} [opts]
 * @returns {Promise<import('./types').TodoTask>}
 */
export async function createTask(listId, title, opts = {}) {
  /** @type {{ title: string, body?: import('./types').ItemBody, dueDateTime?: import('./types').GraphDateTime }} */
  const payload = { title };
  if (opts.body) payload.body = { content: opts.body, contentType: 'text' };
  if (opts.dueDate) payload.dueDateTime = { dateTime: opts.dueDate, timeZone: 'UTC' };
  return call(`/me/todo/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} title
 * @returns {Promise<any>}
 */
export async function updateTaskTitle(listId, taskId, title) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string|null} dueDate
 * @returns {Promise<any>}
 */
export async function updateTaskDueDate(listId, taskId, dueDate) {
  const payload = { dueDateTime: dueDate ? { dateTime: dueDate, timeZone: 'UTC' } : null };
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

// Contesto dell'attività: `categories` è un campo nativo di To-Do, quindi la
// scelta resta leggibile anche aprendo il task da un'altra app.
/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string[]} categories
 * @returns {Promise<any>}
 */
export async function updateTaskCategories(listId, taskId, categories) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ categories })
  });
}

// Sposta un task in un'altra lista — cioè, nel modello PARA dell'app, in
// un'altra sezione. Graph non ha una "move": si ricrea il task nella lista di
// destinazione con tutto ciò che porta con sé e si cancella l'originale, in
// quest'ordine, così un errore a metà lascia un doppione (recuperabile) invece
// di far sparire il task.
/**
 * @param {string} fromListId
 * @param {string} toListId
 * @param {import('./types').TodoTask} task
 * @returns {Promise<import('./types').TodoTask>}
 */
export async function moveTaskToList(fromListId, toListId, task) {
  /** @type {Record<string, any>} */
  const payload = {
    title: task.title,
    status: task.status || 'notStarted',
    importance: task.importance || 'normal',
  };
  if (task.body) payload.body = { content: task.body.content || '', contentType: 'text' };
  if (task.dueDateTime) payload.dueDateTime = task.dueDateTime;
  if (task.categories?.length) payload.categories = task.categories;

  const created = await call(`/me/todo/lists/${toListId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // Le sottoattività non si possono creare nello stesso POST del task.
  for (const item of task.checklistItems || []) {
    try {
      await call(`/me/todo/lists/${toListId}/tasks/${created.id}/checklistItems`, {
        method: 'POST',
        body: JSON.stringify({ displayName: item.displayName, isChecked: item.isChecked })
      });
    } catch (e) {
      console.error('move task: sottoattività non copiata', item.displayName, e);
    }
  }

  await call(`/me/todo/lists/${fromListId}/tasks/${task.id}`, { method: 'DELETE' });
  return created;
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @returns {Promise<any>}
 */
export async function deleteTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

/** @param {string|null|undefined} s @returns {string} */
function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Crea una pagina OneNote nella sezione indicata (richiede content-type
// application/xhtml+xml, diverso dalle chiamate JSON standard di `call`).
/**
 * @param {string} sectionId
 * @param {string} title
 * @param {string} contentText
 * @returns {Promise<any>}
 */
export async function createNotePage(sectionId, title, contentText) {
  const token = await getTokenCached();
  const html = `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head>` +
    `<body><p>${escapeHtml(contentText).replace(/\n/g, '<br/>')}</p></body></html>`;
  const r = await fetch(`${GRAPH}/me/onenote/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/xhtml+xml' },
    body: html,
  });
  if (!r.ok) throw new Error(`Create page error ${r.status}`);
  return r.json();
}

// PATCH del contenuto di una pagina OneNote: richiede multipart/form-data con
// una parte "Commands" contenente l'array di comandi (target/action/content).
/**
 * @param {string} pageId
 * @param {Array<{ target: string, action: string, content?: string }>} commands
 * @returns {Promise<void>}
 */
export async function patchPageContent(pageId, commands) {
  const token = await getTokenCached();
  const form = new FormData();
  form.append('Commands', new Blob([JSON.stringify(commands)], { type: 'application/json' }));
  const r = await fetch(`${GRAPH}/me/onenote/pages/${pageId}/content`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Patch page content error ${r.status}`);
}

// Spunta come completata la riga "Da fare" (data-tag="to-do") di una pagina
// OneNote, sostituendo il tag con "to-do:completed" nell'HTML originale del
// paragrafo — così la Daily Review non ripropone più un candidato già gestito.
/**
 * @param {string|null|undefined} pageId
 * @param {string|null|undefined} elementId
 * @param {string|null|undefined} originalTagHtml
 * @returns {Promise<void>}
 */
export async function markOneNoteTagDone(pageId, elementId, originalTagHtml) {
  if (!pageId || !elementId || !originalTagHtml) return;
  const content = originalTagHtml.replace(/data-tag="to-do"/, 'data-tag="to-do:completed"');
  await patchPageContent(pageId, [{ target: `#${elementId}`, action: 'replace', content }]);
}

// Memo in memoria della lista calendari: viene richiesta da più punti
// (ogni getCalendarEvents, il filtro calendari del Piano) ma cambia di rado.
/** @type {import('./types').Calendar[]|null} */
let _calsCache = null;
let _calsCacheExp = 0;

export function invalidateCalendarsCache() { _calsCache = null; _calsCacheExp = 0; }

/** @returns {Promise<import('./types').Calendar[]>} */
export async function getCalendars() {
  if (_calsCache && Date.now() < _calsCacheExp) return _calsCache;
  const d = await call('/me/calendars?$select=id,name,color,isDefaultCalendar,owner&$top=50');
  /** @type {import('./types').Calendar[]} */
  const cals = d.value || [];
  _calsCache = cals;
  _calsCacheExp = Date.now() + 10 * 60 * 1000;
  return cals;
}

// Cambia il colore di visualizzazione di un calendario (proprio o
// condiviso): Graph accetta solo l'enum predefinito (lightBlue, maxColor…),
// non un hex libero come per i workbook — è una preferenza personale
// dell'utente sulla propria voce di calendario, quindi funziona anche sui
// calendari condivisi da altri.
/**
 * @param {string} calendarId
 * @param {string} color   enum Graph (lightBlue, maxColor, ...)
 * @returns {Promise<any>}
 */
export async function updateCalendarColor(calendarId, color) {
  const res = await call(`/me/calendars/${calendarId}`, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  });
  invalidateCalendarsCache();
  return res;
}

/**
 * Eventi Calendario mergiati da tutti i calendari (max 8, in parallelo),
 * escluso il calendario Workbook dedicato. Ogni evento è decorato con
 * _calId/_calName/_calColor/_isShared.
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {number} [top]
 * @returns {Promise<import('./types').CalendarEvent[]>}
 */
export async function getCalendarEvents(startDate, endDate, top = 50) {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const params = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=${top}&$select=id,subject,start,end,isAllDay,webLink`;

  // Recupera tutti i calendari per distinguere condivisi da propri
  /** @type {import('./types').Calendar[]} */
  let calendars = [];
  try { calendars = await getCalendars(); } catch { /* fallback: solo calendario default */ }
  // Il calendario dedicato ai blocchi Workbook ha una sua vista/CRUD dedicati
  // (vedi getWorkbookCalendarId/getWorkbookEvents) e viene già renderizzato
  // separatamente in PlannerView: includerlo anche qui duplicherebbe ogni
  // blocco come evento "normale" nella timeline.
  calendars = calendars.filter(c => (c.name || '').trim().toLowerCase() !== WORKBOOK_CALENDAR_NAME.toLowerCase());

  if (!calendars.length) {
    // Fallback: solo calendario default
    return callPagedValues(`/me/calendarView?${params}`);
  }

  const defaultCal = calendars.find(c => c.isDefaultCalendar) || calendars[0];
  const userEmail  = (defaultCal?.owner?.address || '').toLowerCase();

  // Fetch in parallelo da tutti i calendari (max 8). calendarView pagina i
  // risultati anche quando $top chiede di più: senza seguire @odata.nextLink
  // gli eventi oltre la prima pagina (tipicamente quelli più lontani nel
  // tempo, essendo l'ordinamento per start/dateTime crescente) sparivano in
  // silenzio dalla finestra ±3 mesi.
  const results = await Promise.allSettled(
    calendars.slice(0, 8).map(cal =>
      callPagedValues(`/me/calendars/${cal.id}/calendarView?${params}`)
        .then(events => {
          const isOwn = !userEmail || (cal.owner?.address || '').toLowerCase() === userEmail;
          return events.map(e => ({
            ...e,
            _calId:     cal.id,
            _calName:   cal.name,
            _calColor:  cal.color,
            _isShared:  !isOwn,
          }));
        })
    )
  );

  const allEvents = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return allEvents.sort((a, b) => {
    const at = a.start?.dateTime || a.start?.date || '';
    const bt = b.start?.dateTime || b.start?.date || '';
    return at.localeCompare(bt);
  });
}

/** @param {string|null|undefined} calendarId @returns {string} */
function eventsBasePath(calendarId) {
  return calendarId ? `/me/calendars/${calendarId}/events` : '/me/events';
}

// Converte data+ora locale (fuso del browser) in una stringa dateTime senza
// suffisso, coerente col fuso 'UTC' dichiarato nel payload — così un evento
// creato per le 9:00 locali torna a schermo come 9:00 (vedi isoToHHMM in
// PlannerView.jsx, che tratta i dateTime senza 'Z' come UTC).
/** @param {string} dateStr @param {string} timeStr @returns {string} */
function localToUtcDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString().slice(0, 19);
}

// Oggetto start/end Graph-shaped per un PATCH parziale (vedi patchCalendarEvent)
// — stesso fuso "UTC finto" di localToUtcDateTime, riusato dai blocchi Workbook.
/**
 * @param {string} dateStr
 * @param {string} timeStr
 * @returns {import('./types').GraphDateTime}
 */
export function graphDateTime(dateStr, timeStr) {
  return { dateTime: localToUtcDateTime(dateStr, timeStr), timeZone: 'UTC' };
}

// Crea un evento Calendario — tutto il giorno (con reminder nativo, usato
// dalla scadenza GTD) oppure con orario, su un calendario a scelta (default:
// calendario principale dell'utente).
/**
 * @param {Object} params
 * @param {string|null} [params.calendarId]
 * @param {string} params.subject
 * @param {string} params.startDate
 * @param {string} [params.endDate]
 * @param {string} [params.startTime]
 * @param {string} [params.endTime]
 * @param {number} [params.reminderMinutesBeforeStart]
 * @param {string} [params.body]
 * @returns {Promise<import('./types').CalendarEvent>}
 */
export async function createCalendarEvent({
  calendarId, subject, startDate, endDate, startTime, endTime,
  reminderMinutesBeforeStart, body,
}) {
  /** @type {any} */
  let payload;
  if (startTime && endTime) {
    payload = {
      subject,
      isAllDay: false,
      start: { dateTime: localToUtcDateTime(startDate, startTime), timeZone: 'UTC' },
      end:   { dateTime: localToUtcDateTime(endDate || startDate, endTime), timeZone: 'UTC' },
      ...(body ? { body: { contentType: 'text', content: body } } : {}),
    };
  } else {
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    payload = {
      subject,
      isAllDay: true,
      start: { dateTime: `${startDate}T00:00:00`, timeZone: 'UTC' },
      end: { dateTime: `${end.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'UTC' },
      ...(reminderMinutesBeforeStart != null ? { isReminderOn: true, reminderMinutesBeforeStart } : {}),
      ...(body ? { body: { contentType: 'text', content: body } } : {}),
    };
  }
  return call(eventsBasePath(calendarId), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Modifica un evento esistente (stesso calendario). Per spostarlo su un altro
// calendario usare prima moveCalendarEvent.
/**
 * @param {string|null} calendarId
 * @param {string} eventId
 * @param {Object} fields
 * @param {string} fields.subject
 * @param {string} fields.startDate
 * @param {string} [fields.endDate]
 * @param {string} [fields.startTime]
 * @param {string} [fields.endTime]
 * @returns {Promise<any>}
 */
export async function updateCalendarEvent(calendarId, eventId, {
  subject, startDate, endDate, startTime, endTime,
}) {
  /** @type {any} */
  let payload;
  if (!startTime || !endTime) {
    const end = new Date(`${endDate || startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    payload = {
      subject,
      isAllDay: true,
      start: { dateTime: `${startDate}T00:00:00`, timeZone: 'UTC' },
      end:   { dateTime: `${end.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'UTC' },
    };
  } else {
    payload = {
      subject,
      isAllDay: false,
      start: { dateTime: localToUtcDateTime(startDate, startTime), timeZone: 'UTC' },
      end:   { dateTime: localToUtcDateTime(endDate || startDate, endTime), timeZone: 'UTC' },
    };
  }
  return call(`${eventsBasePath(calendarId)}/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * @param {string|null} calendarId
 * @param {string} eventId
 * @returns {Promise<any>}
 */
export async function deleteCalendarEvent(calendarId, eventId) {
  return call(`${eventsBasePath(calendarId)}/${eventId}`, { method: 'DELETE' });
}

// PATCH parziale — a differenza di updateCalendarEvent (che ricostruisce
// sempre l'intero start/end/subject) accetta solo i campi Graph da cambiare,
// usata dai blocchi Workbook per aggiornare un singolo aspetto (solo l'ora di
// fine in un resize, solo il body in una modifica alle note) senza dover
// ripassare ogni volta tutti gli altri campi invariati.
/**
 * @param {string|null} calendarId
 * @param {string} eventId
 * @param {Record<string, any>} payload
 * @returns {Promise<any>}
 */
export async function patchCalendarEvent(calendarId, eventId, payload) {
  return call(`${eventsBasePath(calendarId)}/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// Sposta un evento su un altro calendario — necessario perché Graph non
// permette di cambiare calendario con una semplice PATCH.
/**
 * @param {string|null} calendarId
 * @param {string} eventId
 * @param {string} destinationCalendarId
 * @returns {Promise<any>}
 */
export async function moveCalendarEvent(calendarId, eventId, destinationCalendarId) {
  return call(`${eventsBasePath(calendarId)}/${eventId}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationCalendarId }),
  });
}

// GET di un file JSON dalla cartella dell'app su OneDrive. Distingue "file non
// ancora creato" (404 → notFoundValue) dagli errori transitori (rete, 401…),
// che vengono propagati: senza questa distinzione un errore momentaneo faceva
// ripartire i chiamanti da un contenuto vuoto che, al salvataggio successivo,
// sovrascriveva il file remoto cancellando tutto lo storico.
//
// Sul 404 si prova prima la migrazione dalla vecchia posizione in root (vedi
// migrateLegacyFile): un file già esistente non deve mai apparire "non ancora
// creato" solo perché è stata introdotta la cartella.
/**
 * @template T
 * @param {string} filename
 * @param {T} notFoundValue   ritornato su 404 (file non ancora creato)
 * @returns {Promise<any>}
 */
async function getDriveJson(filename, notFoundValue) {
  try {
    return await call(`${drivePath(filename)}:/content`);
  } catch (e) {
    if (/** @type {any} */ (e)?.status === 404) {
      if (await migrateLegacyFile(filename)) {
        return call(`${drivePath(filename)}:/content`);
      }
      return notFoundValue;
    }
    throw e;
  }
}

// ── OneDrive Identity Docs ────────────────────────────────────────────────────
const OD_BUSSOLA_FILE = 'mente-digitale-bussola.json';
const OD_VISIONE_FILE  = 'mente-digitale-visione.json';

/**
 * @param {'bussola'|'visione'} type
 * @returns {Promise<any>}
 */
export async function loadIdentityDoc(type) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  return getDriveJson(filename, null);
}

/**
 * @param {'bussola'|'visione'} type
 * @param {any} data
 * @returns {Promise<any>}
 */
export async function saveIdentityDoc(type, data) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  return putDriveJson(filename, data);
}

// ── OneDrive Links File ──
const OD_LINKS_FILE = 'mente-digitale-links.json';

/** @returns {Promise<any>} */
export async function loadODLinksFromCloud() {
  return getDriveJson(OD_LINKS_FILE, null);
}

/** @param {any} links @returns {Promise<any>} */
export async function saveODLinksToCloud(links) {
  return putDriveJson(OD_LINKS_FILE, links);
}

// ── OneDrive Planner Files ────────────────────────────────────────────────────
const OD_DAILY_PLANS_FILE  = 'mente-digitale-daily-plans.json';
const OD_PLANNER_CFG_FILE  = 'mente-digitale-planner-config.json';

/** @returns {Promise<Record<string, import('./types').DayPlan>>} */
export async function loadDailyPlans() {
  return getDriveJson(OD_DAILY_PLANS_FILE, {});
}

/**
 * @param {Record<string, import('./types').DayPlan>} plans
 * @returns {Promise<any>}
 */
export async function saveDailyPlans(plans) {
  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  /** @type {Record<string, import('./types').DayPlan>} */
  const pruned = {};
  for (const [date, plan] of Object.entries(plans)) {
    if (new Date(date) >= cutoff) pruned[date] = plan;
  }
  return putDriveJson(OD_DAILY_PLANS_FILE, pruned);
}

/** @returns {Promise<import('./types').PlannerConfig|null>} */
export async function loadPlannerConfig() {
  return getDriveJson(OD_PLANNER_CFG_FILE, null);
}

/** @param {import('./types').PlannerConfig} config @returns {Promise<any>} */
export async function savePlannerConfig(config) {
  return putDriveJson(OD_PLANNER_CFG_FILE, config);
}

// ── OneDrive Workbook Files (albero categorie + template settimana ideale) ──
const OD_WORKBOOKS_FILE   = 'mente-digitale-workbooks.json';
const OD_IDEAL_WEEK_FILE  = 'mente-digitale-ideal-week.json';

/** @returns {Promise<import('./types').Workbook[]|null>} */
export async function loadWorkbooks() {
  return getDriveJson(OD_WORKBOOKS_FILE, null);
}

/** @param {import('./types').Workbook[]} data @returns {Promise<any>} */
export async function saveWorkbooks(data) {
  return putDriveJson(OD_WORKBOOKS_FILE, data);
}

/** @returns {Promise<any>} */
export async function loadIdealWeek() {
  return getDriveJson(OD_IDEAL_WEEK_FILE, null);
}

/** @param {any} template @returns {Promise<any>} */
export async function saveIdealWeek(template) {
  return putDriveJson(OD_IDEAL_WEEK_FILE, template);
}

// ── Calendario Workbook dedicato ─────────────────────────────────────────────
// I blocchi Workbook piazzati in griglia (drag&drop dall'albero
// Workbook/Sub-workbook) vivono come eventi reali su un calendario Outlook
// dedicato, separato dagli eventi "normali": workbookId/subWorkbookId/colore
// (per seguire il nodo se rinominato) e le note libere sono serializzati come
// JSON nel body dell'evento; il subject resta l'etichetta leggibile
// "Workbook · Sub-workbook" per chi guarda direttamente Outlook.
export const WORKBOOK_CALENDAR_NAME = 'Workbook';

/** @type {string|null} */
let _workbookCalId = null;

/** @returns {Promise<string>} */
export async function getWorkbookCalendarId() {
  if (_workbookCalId) return _workbookCalId;
  const cals = await getCalendars();
  let cal = cals.find(c => (c.name || '').trim().toLowerCase() === WORKBOOK_CALENDAR_NAME.toLowerCase());
  if (!cal) {
    cal = await call('/me/calendars', {
      method: 'POST',
      body: JSON.stringify({ name: WORKBOOK_CALENDAR_NAME }),
    });
    invalidateCalendarsCache();
  }
  _workbookCalId = /** @type {import('./types').Calendar} */ (cal).id;
  return _workbookCalId;
}

/**
 * @param {string} calendarId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {number} [top]
 * @returns {Promise<import('./types').CalendarEvent[]>}
 */
export async function getWorkbookEvents(calendarId, startDate, endDate, top = 500) {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const params = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=${top}&$select=id,subject,start,end,body`;
  return callPagedValues(`/me/calendars/${calendarId}/calendarView?${params}`);
}

// ── OneDrive Color Settings (colori personalizzati taccuini/sezioni) ───────
const OD_COLOR_SETTINGS_FILE = 'mente-digitale-color-settings.json';

/** @returns {Promise<import('./types').ColorSettings|null>} */
export async function loadColorSettings() {
  return getDriveJson(OD_COLOR_SETTINGS_FILE, null);
}

/** @param {import('./types').ColorSettings} settings @returns {Promise<any>} */
export async function saveColorSettings(settings) {
  return putDriveJson(OD_COLOR_SETTINGS_FILE, settings);
}

// ── OneDrive Diario ────────────────────────────────────────────────────────
// Un file per mese invece di un file unico: il diario è l'unico dato che
// cresce senza limite (e che non si può potare come piani e statistiche, dove
// si buttano le voci oltre i 90 giorni), quindi si evita di rileggere e
// riscrivere anni di scritture a ogni salvataggio.
//
// Un piccolo indice tiene la lista dei mesi che contengono voci: OneDrive non
// offre un filtro affidabile per prefisso sul nome dei file, e senza indice
// l'unico modo di sapere quali mesi esistono sarebbe tentare il GET di ognuno
// a ritroso.
const OD_DIARY_INDEX_FILE = 'mente-digitale-diario-index.json';

/** @param {string} ym 'YYYY-MM' @returns {string} */
function diaryMonthFile(ym) {
  return `mente-digitale-diario-${ym}.json`;
}

/** @returns {Promise<{ months: string[] }>} */
export async function loadDiaryIndex() {
  const idx = await getDriveJson(OD_DIARY_INDEX_FILE, { months: [] });
  return { months: Array.isArray(idx?.months) ? idx.months : [] };
}

/** @param {string} ym @returns {Promise<import('./types').DiaryEntry[]>} */
export async function loadDiaryMonth(ym) {
  const data = await getDriveJson(diaryMonthFile(ym), []);
  return Array.isArray(data) ? data : [];
}

/**
 * Salva (o aggiorna, per id) una voce nel file del suo mese e registra il mese
 * nell'indice. Rilegge il mese prima di scrivere, così una voce creata da un
 * altro dispositivo nella stessa giornata non viene persa.
 * @param {import('./types').DiaryEntry} entry
 * @returns {Promise<import('./types').DiaryEntry[]>} le voci del mese aggiornate
 */
export async function saveDiaryEntry(entry) {
  const ym = entry.date.slice(0, 7);
  const existing = await loadDiaryMonth(ym);
  const i = existing.findIndex(e => e.id === entry.id);
  const updated = i >= 0
    ? existing.map(e => (e.id === entry.id ? entry : e))
    : [...existing, entry];
  await putDriveJson(diaryMonthFile(ym), updated);

  const idx = await loadDiaryIndex();
  if (!idx.months.includes(ym)) {
    await putDriveJson(OD_DIARY_INDEX_FILE, { months: [...idx.months, ym].sort() });
  }
  return updated;
}

/**
 * Salva molte voci insieme: un file per mese riscritto una volta sola e
 * l'indice aggiornato alla fine.
 *
 * saveDiaryEntry costa tre o quattro richieste a voce, il che va benissimo per
 * una scrittura della sera e per niente per un'importazione da centinaia di
 * voci: da lì arriva questa. La fusione resta per id, quindi reimportare lo
 * stesso archivio aggiorna le voci invece di sdoppiarle.
 *
 * @param {import('./types').DiaryEntry[]} entries
 * @returns {Promise<string[]>} i mesi toccati
 */
export async function saveDiaryEntries(entries) {
  /** @type {Record<string, import('./types').DiaryEntry[]>} */
  const perMese = {};
  for (const e of entries) (perMese[e.date.slice(0, 7)] ||= []).push(e);

  const mesi = Object.keys(perMese).sort();
  for (const ym of mesi) {
    const esistenti = await loadDiaryMonth(ym);
    const mappa = new Map(esistenti.map(e => [e.id, e]));
    for (const e of perMese[ym]) mappa.set(e.id, e);
    await putDriveJson(diaryMonthFile(ym), [...mappa.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1)));
  }

  const idx = await loadDiaryIndex();
  const tutti = [...new Set([...idx.months, ...mesi])].sort();
  if (tutti.length !== idx.months.length) {
    await putDriveJson(OD_DIARY_INDEX_FILE, { months: tutti });
  }
  return mesi;
}

/**
 * @param {import('./types').DiaryEntry} entry
 * @returns {Promise<import('./types').DiaryEntry[]>} le voci del mese aggiornate
 */
export async function deleteDiaryEntry(entry) {
  const ym = entry.date.slice(0, 7);
  const existing = await loadDiaryMonth(ym);
  const updated = existing.filter(e => e.id !== entry.id);
  await putDriveJson(diaryMonthFile(ym), updated);
  return updated;
}

// ── Foto del diario ────────────────────────────────────────────────────────
// Le immagini non stanno dentro il JSON del mese (un file di voci non deve
// diventare da megabyte): vivono come file veri in una sottocartella, e la
// voce ne conserva solo il nome. Così una foto si può anche aprire da
// OneDrive, e cancellare una voce non obbliga a riscrivere nulla di binario.
const OD_DIARY_PHOTO_FOLDER = 'diario-foto';

/** @type {Promise<any>|null} */
let _photoFolderReady = null;
function ensurePhotoFolder() {
  if (!_photoFolderReady) {
    _photoFolderReady = ensureAppFolder()
      .then(() => call(`/me/drive/root:/${OD_FOLDER}:/children`, {
        method: 'POST',
        body: JSON.stringify({
          name: OD_DIARY_PHOTO_FOLDER,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      }))
      .catch(e => {
        if (e?.status === 409) return null;
        _photoFolderReady = null;
        throw e;
      });
  }
  return _photoFolderReady;
}

/** @param {string} name @returns {string} */
function photoPath(name) {
  return `/me/drive/root:/${OD_FOLDER}/${OD_DIARY_PHOTO_FOLDER}/${encodeURIComponent(name)}`;
}

/**
 * Carica un'immagine e restituisce il nome del file su OneDrive.
 * @param {Blob} blob
 * @param {string} name  nome già normalizzato dal chiamante (id + estensione)
 * @returns {Promise<string>}
 */
export async function uploadDiaryPhoto(blob, name) {
  await ensurePhotoFolder();
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}${photoPath(name)}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!r.ok) throw new Error(`Upload foto ${name} error ${r.status}`);
  return name;
}

// Graph serve i binari con un 302 verso un URL pre-autenticato, e rifollow con
// l'header Authorization fa fallire il CORS: si chiede quindi il downloadUrl
// dai metadati e si scarica quello in chiaro. Vale circa un'ora, quindi si
// tiene in cache un po' meno per non servire mai un link già scaduto.
const PHOTO_URL_TTL = 45 * 60 * 1000;
/** @type {Map<string, { url: string, at: number }>} */
const _photoUrls = new Map();

/** @param {string} name @returns {Promise<string>} URL scaricabile dell'immagine */
export async function getDiaryPhotoUrl(name) {
  const hit = _photoUrls.get(name);
  if (hit && Date.now() - hit.at < PHOTO_URL_TTL) return hit.url;
  const item = await call(`${photoPath(name)}?$select=id,name,@microsoft.graph.downloadUrl`);
  const url = item?.['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error(`Foto ${name} senza downloadUrl`);
  _photoUrls.set(name, { url, at: Date.now() });
  return url;
}

/** @param {string} name @returns {Promise<void>} */
export async function deleteDiaryPhoto(name) {
  _photoUrls.delete(name);
  try {
    await call(photoPath(name), { method: 'DELETE' });
  } catch (e) {
    // Una foto già assente non è un errore da propagare: la voce che la
    // citava sta comunque per sparire.
    if (/** @type {any} */ (e)?.status !== 404) throw e;
  }
}

// ── OneDrive Pomodoro Stats ────────────────────────────────────────────────
const OD_POMODORO_STATS_FILE = 'mente-digitale-pomodoro-stats.json';

/** @returns {Promise<Record<string, any>>} */
export async function loadPomodoroStats() {
  return getDriveJson(OD_POMODORO_STATS_FILE, {});
}

/** @param {Record<string, any>} stats @returns {Promise<any>} */
export async function savePomodoroStats(stats) {
  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  /** @type {Record<string, any>} */
  const pruned = {};
  for (const [date, entry] of Object.entries(stats)) {
    if (new Date(date) >= cutoff) pruned[date] = entry;
  }
  return putDriveJson(OD_POMODORO_STATS_FILE, pruned);
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @returns {Promise<import('./types').TodoTask>}
 */
export async function getTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}?$expand=checklistItems`);
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} content
 * @returns {Promise<any>}
 */
export async function updateTaskBody(listId, taskId, content) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { content, contentType: 'text' } }),
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} displayName
 * @returns {Promise<import('./types').ChecklistItem>}
 */
export async function createChecklistItem(listId, taskId, displayName) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`, {
    method: 'POST',
    body: JSON.stringify({ displayName, isChecked: false }),
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} itemId
 * @param {boolean} isChecked
 * @returns {Promise<any>}
 */
export async function updateChecklistItem(listId, taskId, itemId, isChecked) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isChecked }),
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} itemId
 * @param {string} displayName
 * @returns {Promise<any>}
 */
export async function renameChecklistItem(listId, taskId, itemId, displayName) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {string} itemId
 * @returns {Promise<any>}
 */
export async function deleteChecklistItem(listId, taskId, itemId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'DELETE',
  });
}

// Graph non espone un campo di ordinamento per i checklistItem: l'unico modo
// per persistere un nuovo ordine è ricrearli nella sequenza voluta (l'ordine
// restituito da Graph segue quello di creazione) ed eliminare gli originali.
/**
 * @param {string} listId
 * @param {string} taskId
 * @param {import('./types').ChecklistItem[]} orderedItems
 * @returns {Promise<import('./types').ChecklistItem[]>}
 */
export async function reorderChecklistItems(listId, taskId, orderedItems) {
  const base = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;
  /** @type {import('./types').ChecklistItem[]} */
  const created = [];
  try {
    for (const item of orderedItems) {
      created.push(await call(base, {
        method: 'POST',
        body: JSON.stringify({ displayName: item.displayName, isChecked: item.isChecked }),
      }));
    }
  } catch (e) {
    await Promise.all(created.map(c => call(`${base}/${c.id}`, { method: 'DELETE' }).catch(() => {})));
    throw e;
  }
  await Promise.all(orderedItems.map(item => call(`${base}/${item.id}`, { method: 'DELETE' }).catch(() => {})));
  return created;
}

// Elenco dei reminder (di eventi Calendario) che scattano nella finestra di
// tempo indicata — usato per far comparire un task To-Do nell'Area giusta nel
// momento esatto in cui il preavviso di una scadenza (assicurazione, salute,
// tasse...) si attiva, senza dover ricalcolare noi il lead time impostato su
// ogni evento (vedi deadlineReminders.js).
/**
 * @param {string} startISO
 * @param {string} endISO
 * @returns {Promise<import('./types').Reminder[]>}
 */
export async function getReminders(startISO, endISO) {
  const d = await call(`/me/reminderView(startDateTime='${startISO}',endDateTime='${endISO}')`);
  return d?.value || [];
}

/** @returns {Promise<import('./types').EmailMessage[]>} */
export async function getRecentEmails() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const iso = yesterday.toISOString();
  const params = [
    `$filter=receivedDateTime ge ${iso}`,
    `$select=subject,from,bodyPreview,receivedDateTime,isRead`,
    `$top=50`,
    `$orderby=receivedDateTime desc`,
  ].join('&');
  const d = await call(`/me/messages?${params}`);
  return d?.value || [];
}
