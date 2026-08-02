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

// PUT di un file JSON nella root di OneDrive
/**
 * @param {string} filename
 * @param {any} data
 * @returns {Promise<any>}
 */
async function putDriveJson(filename, data) {
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/drive/root:/${filename}:/content`, {
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

// GET di un file JSON dalla root di OneDrive. Distingue "file non ancora
// creato" (404 → notFoundValue) dagli errori transitori (rete, 401…), che
// vengono propagati: senza questa distinzione un errore momentaneo faceva
// ripartire i chiamanti da un contenuto vuoto che, al salvataggio successivo,
// sovrascriveva il file remoto cancellando tutto lo storico.
/**
 * @template T
 * @param {string} filename
 * @param {T} notFoundValue   ritornato su 404 (file non ancora creato)
 * @returns {Promise<any>}
 */
async function getDriveJson(filename, notFoundValue) {
  try {
    return await call(`/me/drive/root:/${filename}:/content`);
  } catch (e) {
    if (/** @type {any} */ (e)?.status === 404) return notFoundValue;
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

// Graph non espone un campo di ordinamento per i checklistItem, ma restituisce
// sempre la collezione nello stesso ordine. Quindi non ricreiamo le voci
// (ricrearle+eliminarle lasciava duplicati ogni volta che una DELETE falliva):
// teniamo fermi gli id — che sono le "caselle" dell'ordine di Graph — e ci
// spostiamo dentro il contenuto (testo + spunta) nella sequenza voluta.
/**
 * @param {string} listId
 * @param {string} taskId
 * @param {import('./types').ChecklistItem[]} orderedItems
 * @returns {Promise<import('./types').ChecklistItem[]>}
 */
export async function reorderChecklistItems(listId, taskId, orderedItems) {
  const base = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;
  // Ripartiamo dallo stato reale sul server: è lui a definire le caselle.
  const full = await getTask(listId, taskId);
  const serverItems = full.checklistItems || [];
  if (!serverItems.length) return [];

  const wantedIds = new Set(orderedItems.map(i => i.id));
  // Voci richieste che esistono davvero + eventuali voci comparse altrove
  // (o non ancora salvate quando è partito il riordino) accodate in fondo.
  const target = [
    ...orderedItems.filter(i => serverItems.some(s => s.id === i.id)),
    ...serverItems.filter(s => !wantedIds.has(s.id)),
  ];

  /** @type {import('./types').ChecklistItem[]} */
  const result = [];
  /** @type {import('./types').ChecklistItem[]} */
  const patched = [];
  const content = it => ({ displayName: it.displayName, isChecked: !!it.isChecked });
  const same = (a, b) => a.displayName === b.displayName && a.isChecked === b.isChecked;

  try {
    for (let i = 0; i < serverItems.length; i++) {
      const slot = serverItems[i];
      const want = content(target[i]);
      if (!same(content(slot), want)) {
        // Sequenziale: PATCH paralleli sulla stessa collezione si scavalcano.
        await call(`${base}/${slot.id}`, { method: 'PATCH', body: JSON.stringify(want) });
        patched.push(slot);
      }
      result.push({ ...slot, ...want });
    }
  } catch (e) {
    // Ripristina il contenuto originale delle caselle già toccate, così un
    // riordino a metà non lascia voci con il testo sbagliato.
    for (const slot of patched.reverse()) {
      await call(`${base}/${slot.id}`, {
        method: 'PATCH', body: JSON.stringify(content(slot)),
      }).catch(() => {});
    }
    throw e;
  }
  return result;
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
