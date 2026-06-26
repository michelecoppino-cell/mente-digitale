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

export async function createTask(listId, title) {
  return call(`/me/todo/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title })
  });
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
  try { calendars = await getCalendars(); } catch {}

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
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/drive/root:/${filename}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!r.ok) throw new Error(`Save identity doc error ${r.status}`);
  return r.json();
}

// ── OneDrive Links File ──
const OD_LINKS_FILE = 'mente-digitale-links.json';

export async function loadODLinksFromCloud() {
  try {
    const d = await call(`/me/drive/root:/${OD_LINKS_FILE}:/content`);
    // Graph restituisce il contenuto raw del file
    return d;
  } catch(e) {
    // File non esiste ancora
    return null;
  }
}

export async function saveODLinksToCloud(links) {
  const json = JSON.stringify(links, null, 2);
  const token = await getTokenCached();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${OD_LINKS_FILE}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: json,
    }
  );
  if (!r.ok) throw new Error(`Save OD links error ${r.status}`);
  return r.json();
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
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/drive/root:/${OD_DAILY_PLANS_FILE}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pruned, null, 2),
  });
  if (!r.ok) throw new Error(`Save daily plans error ${r.status}`);
  return r.json();
}

export async function loadPlannerConfig() {
  try {
    return await call(`/me/drive/root:/${OD_PLANNER_CFG_FILE}:/content`);
  } catch {
    return null;
  }
}

export async function savePlannerConfig(config) {
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/drive/root:/${OD_PLANNER_CFG_FILE}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(config, null, 2),
  });
  if (!r.ok) throw new Error(`Save planner config error ${r.status}`);
  return r.json();
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
