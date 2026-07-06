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
  const params = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=${top}&$select=subject,start,end,isAllDay`;

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
            _calName:   cal.name,
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

export async function deleteChecklistItem(listId, taskId, itemId) {
  return call(`/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, {
    method: 'DELETE',
  });
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
