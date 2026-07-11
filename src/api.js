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
      const err = new Error(`Graph error ${r.status}${detail}`);
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
async function callPagedValues(path, maxPages = 10) {
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
  return callPagedValues(`/me/onenote/sections/${sectionId}/pages?pagelevel=true&$top=100`);
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
  return callPagedValues('/me/todo/lists');
}

export async function getTodoTasks(listId) {
  return callPagedValues(`/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$orderby=importance desc,createdDateTime desc&$top=50`);
}

// Task di una lista indipendentemente dallo stato (anche completati), solo
// id+body: usata per il controllo anti-duplicati delle scadenze ricorrenti
// (refreshDeadlineReminders in App.jsx) — getTodoTasks esclude i completati,
// e uno spuntato non deve poter essere ricreato al giro successivo.
export async function getTasksForDeadlineDedup(listId) {
  return callPagedValues(`/me/todo/lists/${listId}/tasks?$select=id,body&$top=200`);
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

// Memo in memoria della lista calendari: viene richiesta da più punti
// (ogni getCalendarEvents, il filtro calendari del Piano) ma cambia di rado.
let _calsCache = null;
let _calsCacheExp = 0;

export function invalidateCalendarsCache() { _calsCache = null; _calsCacheExp = 0; }

export async function getCalendars() {
  if (_calsCache && Date.now() < _calsCacheExp) return _calsCache;
  const d = await call('/me/calendars?$select=id,name,color,isDefaultCalendar,owner&$top=50');
  _calsCache = d.value || [];
  _calsCacheExp = Date.now() + 10 * 60 * 1000;
  return _calsCache;
}

// Cambia il colore di visualizzazione di un calendario (proprio o
// condiviso): Graph accetta solo l'enum predefinito (lightBlue, maxColor…),
// non un hex libero come per i workbook — è una preferenza personale
// dell'utente sulla propria voce di calendario, quindi funziona anche sui
// calendari condivisi da altri.
export async function updateCalendarColor(calendarId, color) {
  const res = await call(`/me/calendars/${calendarId}`, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  });
  invalidateCalendarsCache();
  return res;
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

// GET di un file JSON dalla root di OneDrive. Distingue "file non ancora
// creato" (404 → notFoundValue) dagli errori transitori (rete, 401…), che
// vengono propagati: senza questa distinzione un errore momentaneo faceva
// ripartire i chiamanti da un contenuto vuoto che, al salvataggio successivo,
// sovrascriveva il file remoto cancellando tutto lo storico.
async function getDriveJson(filename, notFoundValue) {
  try {
    return await call(`/me/drive/root:/${filename}:/content`);
  } catch (e) {
    if (e?.status === 404) return notFoundValue;
    throw e;
  }
}

// ── OneDrive Identity Docs ────────────────────────────────────────────────────
const OD_BUSSOLA_FILE = 'mente-digitale-bussola.json';
const OD_VISIONE_FILE  = 'mente-digitale-visione.json';

export async function loadIdentityDoc(type) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  return getDriveJson(filename, null);
}

export async function saveIdentityDoc(type, data) {
  const filename = type === 'bussola' ? OD_BUSSOLA_FILE : OD_VISIONE_FILE;
  return putDriveJson(filename, data);
}

// ── OneDrive Links File ──
const OD_LINKS_FILE = 'mente-digitale-links.json';

export async function loadODLinksFromCloud() {
  return getDriveJson(OD_LINKS_FILE, null);
}

export async function saveODLinksToCloud(links) {
  return putDriveJson(OD_LINKS_FILE, links);
}

// ── OneDrive Planner Files ────────────────────────────────────────────────────
const OD_DAILY_PLANS_FILE  = 'mente-digitale-daily-plans.json';
const OD_PLANNER_CFG_FILE  = 'mente-digitale-planner-config.json';

export async function loadDailyPlans() {
  return getDriveJson(OD_DAILY_PLANS_FILE, {});
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
  return getDriveJson(OD_PLANNER_CFG_FILE, null);
}

export async function savePlannerConfig(config) {
  return putDriveJson(OD_PLANNER_CFG_FILE, config);
}

// ── OneDrive Workbook Files (pianificazione settimanale a spettro ampio) ────
const OD_WORKBOOKS_FILE      = 'mente-digitale-workbooks.json';
const OD_WORKBOOK_PLANS_FILE = 'mente-digitale-workbook-plans.json';
const OD_IDEAL_WEEK_FILE     = 'mente-digitale-ideal-week.json';

export async function loadWorkbooks() {
  return getDriveJson(OD_WORKBOOKS_FILE, null);
}

export async function saveWorkbooks(data) {
  return putDriveJson(OD_WORKBOOKS_FILE, data);
}

export async function loadWorkbookPlans() {
  return getDriveJson(OD_WORKBOOK_PLANS_FILE, {});
}

export async function saveWorkbookPlans(plans) {
  // Stesso pruning a 90 giorni di saveDailyPlans, per non far crescere il file all'infinito.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const pruned = {};
  for (const [date, plan] of Object.entries(plans)) {
    if (new Date(date) >= cutoff) pruned[date] = plan;
  }
  return putDriveJson(OD_WORKBOOK_PLANS_FILE, pruned);
}

export async function loadIdealWeek() {
  return getDriveJson(OD_IDEAL_WEEK_FILE, null);
}

export async function saveIdealWeek(template) {
  return putDriveJson(OD_IDEAL_WEEK_FILE, template);
}

// ── OneDrive Pomodoro Stats ────────────────────────────────────────────────
const OD_POMODORO_STATS_FILE = 'mente-digitale-pomodoro-stats.json';

export async function loadPomodoroStats() {
  return getDriveJson(OD_POMODORO_STATS_FILE, {});
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
