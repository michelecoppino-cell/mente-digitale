import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Cache token in memoria per evitare acquireTokenSilent ad ogni chiamata
let _cachedToken = null;
let _cachedTokenExp = 0;

async function getTokenCached() {
  if (_cachedToken && Date.now() < _cachedTokenExp) return _cachedToken;
  _cachedToken = await getToken();
  _cachedTokenExp = Date.now() + 45 * 60 * 1000; // 45 min (token MS dura 1h)
  return _cachedToken;
}

export function invalidateTokenCache() { _cachedToken = null; _cachedTokenExp = 0; }

async function call(path, options = {}, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getTokenCached();
      const r = await fetch(GRAPH + path, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...options
      });
      if (r.status === 204) return null;
      if (r.status === 429 || r.status === 503 || r.status === 504) {
        const retry = r.headers.get('Retry-After');
        const wait = retry ? parseInt(retry) * 1000 : (attempt + 1) * 1000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!r.ok) throw new Error(`Graph error ${r.status}`);
      return r.json();
    } catch(e) {
      if (attempt === retries - 1) throw e;
      await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
    }
  }
  throw new Error(`Graph error: tentativi esauriti per ${path}`);
}

// PUT di un file JSON nella root di OneDrive
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

export async function getNotebooks() {
  const d = await call('/me/onenote/notebooks?includePersonalNotebooks=true&$orderby=displayName');
  return d.value;
}

export async function getSections(notebookId) {
  const d = await call(`/me/onenote/notebooks/${notebookId}/sections?$orderby=displayName`);
  return d.value;
}

// Restituisce tutte le pagine top-level (level=0) della sezione
export async function getPages(sectionId) {
  const d = await call(`/me/onenote/sections/${sectionId}/pages?pagelevel=true&$top=100`);
  return d.value || [];
}

// Contenuto HTML grezzo di una pagina OneNote (l'endpoint restituisce HTML, non
// JSON). Manteniamo l'HTML — non testo semplice — perché i tag nativi di OneNote
// come "Da fare" (Ctrl+1) sono marcati con l'attributo data-tag sui paragrafi,
// il segnale usato dall'euristica della Daily Review per trovare le azioni.
export async function getPageContentHtml(pageId) {
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/onenote/pages/${pageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Page content error ${r.status}`);
  return r.text();
}

export async function getTodoLists() {
  const d = await call('/me/todo/lists');
  return d.value;
}

export async function getTodoTasks(listId) {
  const d = await call(`/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$orderby=importance desc,createdDateTime desc&$top=50`);
  return d.value;
}

// Task di una lista indipendentemente dallo stato (anche completati), solo
// id+body: usata per il controllo anti-duplicati delle scadenze ricorrenti
// (refreshDeadlineReminders in App.jsx) — getTodoTasks esclude i completati,
// e uno spuntato non deve poter essere ricreato al giro successivo.
export async function getTasksForDeadlineDedup(listId) {
  const d = await call(`/me/todo/lists/${listId}/tasks?$select=id,body&$top=200`);
  return d.value || [];
}

export async function completeTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
}

export async function createTask(listId, title, opts = {}) {
  const payload = { title };
  if (opts.body) payload.body = { content: opts.body, contentType: 'text' };
  if (opts.dueDate) payload.dueDateTime = { dateTime: opts.dueDate, timeZone: 'UTC' };
  return call(`/me/todo/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updateTaskTitle(listId, taskId, title) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  });
}

export async function updateTaskDueDate(listId, taskId, dueDate) {
  const payload = { dueDateTime: dueDate ? { dateTime: dueDate, timeZone: 'UTC' } : null };
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export async function deleteTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Crea una pagina OneNote nella sezione indicata (richiede content-type
// application/xhtml+xml, diverso dalle chiamate JSON standard di `call`).
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
export async function markOneNoteTagDone(pageId, elementId, originalTagHtml) {
  if (!pageId || !elementId || !originalTagHtml) return;
  const content = originalTagHtml.replace(/data-tag="to-do"/, 'data-tag="to-do:completed"');
  await patchPageContent(pageId, [{ target: `#${elementId}`, action: 'replace', content }]);
}

export async function getCalendars() {
  const d = await call('/me/calendars?$select=id,name,color,isDefaultCalendar,owner&$top=50');
  return d.value || [];
}

export async function getCalendarEvents(startDate, endDate, top = 50) {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const params = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=${top}&$select=id,subject,start,end,isAllDay,webLink`;

  // Recupera tutti i calendari per distinguere condivisi da propri
  let calendars = [];
  try { calendars = await getCalendars(); } catch { /* fallback: solo calendario default */ }

  if (!calendars.length) {
    // Fallback: solo calendario default
    const d = await call(`/me/calendarView?${params}`);
    return d.value || [];
  }

  const defaultCal = calendars.find(c => c.isDefaultCalendar) || calendars[0];
  const userEmail  = (defaultCal?.owner?.address || '').toLowerCase();

  // Fetch in parallelo da tutti i calendari (max 8)
  const results = await Promise.allSettled(
    calendars.slice(0, 8).map(cal =>
      call(`/me/calendars/${cal.id}/calendarView?${params}`)
        .then(d => {
          const isOwn = !userEmail || (cal.owner?.address || '').toLowerCase() === userEmail;
          return (d.value || []).map(e => ({
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

function eventsBasePath(calendarId) {
  return calendarId ? `/me/calendars/${calendarId}/events` : '/me/events';
}

// Converte data+ora locale (fuso del browser) in una stringa dateTime senza
// suffisso, coerente col fuso 'UTC' dichiarato nel payload — così un evento
// creato per le 9:00 locali torna a schermo come 9:00 (vedi isoToHHMM in
// PlannerView.jsx, che tratta i dateTime senza 'Z' come UTC).
function localToUtcDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString().slice(0, 19);
}

// Crea un evento Calendario — tutto il giorno (con reminder nativo, usato
// dalla scadenza GTD) oppure con orario, su un calendario a scelta (default:
// calendario principale dell'utente).
export async function createCalendarEvent({
  calendarId, subject, startDate, endDate, startTime, endTime,
  reminderMinutesBeforeStart, body,
}) {
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
export async function updateCalendarEvent(calendarId, eventId, {
  subject, startDate, endDate, startTime, endTime,
}) {
  const isAllDay = !startTime || !endTime;
  let payload;
  if (isAllDay) {
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

export async function deleteCalendarEvent(calendarId, eventId) {
  return call(`${eventsBasePath(calendarId)}/${eventId}`, { method: 'DELETE' });
}

// Sposta un evento su un altro calendario — necessario perché Graph non
// permette di cambiare calendario con una semplice PATCH.
export async function moveCalendarEvent(calendarId, eventId, destinationCalendarId) {
  return call(`${eventsBasePath(calendarId)}/${eventId}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationCalendarId }),
  });
}

// ── OneDrive Identity Docs ────────────────────────────────────────────────────
const OD_BUSSOLA_FILE = 'mente-digitale-bussola.json';
const OD_VISIONE_FILE  = 'mente-digitale-visione.json';

export async function loadIdentityDoc(type) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  try {
    return await call(`/me/drive/root:/${filename}:/content`);
  } catch {
    return null;
  }
}

export async function saveIdentityDoc(type, data) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  return putDriveJson(filename, data);
}

// ── OneDrive Links File ──
const OD_LINKS_FILE = 'mente-digitale-links.json';

export async function loadODLinksFromCloud() {
  try {
    // Graph restituisce il contenuto raw del file
    return await call(`/me/drive/root:/${OD_LINKS_FILE}:/content`);
  } catch {
    // File non esiste ancora
    return null;
  }
}

export async function saveODLinksToCloud(links) {
  return putDriveJson(OD_LINKS_FILE, links);
}

// ── OneDrive Planner Files ────────────────────────────────────────────────────
const OD_DAILY_PLANS_FILE  = 'mente-digitale-daily-plans.json';
const OD_PLANNER_CFG_FILE  = 'mente-digitale-planner-config.json';

export async function loadDailyPlans() {
  try {
    return await call(`/me/drive/root:/${OD_DAILY_PLANS_FILE}:/content`);
  } catch {
    return {};
  }
}

export async function saveDailyPlans(plans) {
  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const pruned = {};
  for (const [date, plan] of Object.entries(plans)) {
    if (new Date(date) >= cutoff) pruned[date] = plan;
  }
  return putDriveJson(OD_DAILY_PLANS_FILE, pruned);
}

export async function loadPlannerConfig() {
  try {
    return await call(`/me/drive/root:/${OD_PLANNER_CFG_FILE}:/content`);
  } catch {
    return null;
  }
}

export async function savePlannerConfig(config) {
  return putDriveJson(OD_PLANNER_CFG_FILE, config);
}

// ── OneDrive Pomodoro Stats ────────────────────────────────────────────────
const OD_POMODORO_STATS_FILE = 'mente-digitale-pomodoro-stats.json';

export async function loadPomodoroStats() {
  try {
    return await call(`/me/drive/root:/${OD_POMODORO_STATS_FILE}:/content`);
  } catch {
    return {};
  }
}

export async function savePomodoroStats(stats) {
  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const pruned = {};
  for (const [date, entry] of Object.entries(stats)) {
    if (new Date(date) >= cutoff) pruned[date] = entry;
  }
  return putDriveJson(OD_POMODORO_STATS_FILE, pruned);
}

export async function getTask(listId, taskId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}?$expand=checklistItems`);
}

export async function updateTaskBody(listId, taskId, content) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { content, contentType: 'text' } }),
  });
}

export async function createChecklistItem(listId, taskId, displayName) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`, {
    method: 'POST',
    body: JSON.stringify({ displayName, isChecked: false }),
  });
}

export async function updateChecklistItem(listId, taskId, itemId, isChecked) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isChecked }),
  });
}

export async function renameChecklistItem(listId, taskId, itemId, displayName) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
}

export async function deleteChecklistItem(listId, taskId, itemId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'DELETE',
  });
}

// Graph non espone un campo di ordinamento per i checklistItem: l'unico modo
// per persistere un nuovo ordine è ricrearli nella sequenza voluta (l'ordine
// restituito da Graph segue quello di creazione) ed eliminare gli originali.
export async function reorderChecklistItems(listId, taskId, orderedItems) {
  const base = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;
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
export async function getReminders(startISO, endISO) {
  const d = await call(`/me/reminderView(startDateTime='${startISO}',endDateTime='${endISO}')`);
  return d?.value || [];
}

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
