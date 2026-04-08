import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function call(path, options = {}) {
  const token = await getToken();
  const r = await fetch(GRAPH + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...options
  });
  if (!r.ok) throw new Error(`Graph error ${r.status}`);
  if (r.status === 204) return null;
  return r.json();
}

// ── OneNote ──
export async function getNotebooks() {
  const d = await call('/me/onenote/notebooks?includePersonalNotebooks=true&$orderby=displayName');
  return d.value;
}

export async function getSections(notebookId) {
  const d = await call(`/me/onenote/notebooks/${notebookId}/sections?$orderby=displayName`);
  return d.value;
}

export async function getPages(sectionId) {
  const d = await call(`/me/onenote/sections/${sectionId}/pages?$orderby=lastModifiedDateTime desc&$top=8`);
  return d.value;
}

// ── ToDo ──
export async function getTodoLists() {
  const d = await call('/me/todo/lists');
  return d.value;
}

export async function getTodoTasks(listId) {
  const d = await call(`/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$orderby=importance desc,createdDateTime desc&$top=20`);
  return d.value;
}

export async function getTodoTasksNoDeadline(listId) {
  const d = await call(`/me/todo/lists/${listId}/tasks?$filter=status ne 'completed' and dueDateTime eq null&$orderby=importance desc,createdDateTime desc&$top=10`);
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

// ── Calendario ──
export async function getCalendarEvents(startDate, endDate) {
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  const d = await call(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100&$select=subject,start,end,bodyPreview,isAllDay,categories`
  );
  return d.value;
}
