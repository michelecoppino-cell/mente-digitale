import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function call(path, options = {}, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getToken();
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
  const d = await call(`/me/onenote/sections/${sectionId}/pages?$orderby=order&$top=100&$select=id,title,links,level,order`);
  // Solo pagine di primo livello (non sub-pagine)
  return (d.value || []).filter(p => (p.level || 0) === 0);
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

export async function getCalendarEvents(startDate, endDate) {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const d = await call(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100&$select=subject,start,end,isAllDay`
  );
  return d.value;
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
  const token = await getToken();
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
