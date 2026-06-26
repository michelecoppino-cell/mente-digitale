import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

let _token = null;
let _tokenExp = 0;

async function getTokenCached() {
  if (_token && Date.now() < _tokenExp) return _token;
  _token = await getToken();
  _tokenExp = Date.now() + 45 * 60 * 1000;
  return _token;
}

async function call(path, options = {}, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const token = await getTokenCached();
      const r = await fetch(GRAPH + path, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...options,
      });
      if (r.status === 204) return null;
      if (r.status === 429 || r.status === 503 || r.status === 504) {
        const wait = parseInt(r.headers.get('Retry-After') || '0') * 1000 || (attempt + 1) * 1500;
        await new Promise(res => setTimeout(res, wait));
        continue;
      }
      if (!r.ok) throw new Error(`Graph error ${r.status}: ${await r.text().catch(() => '')}`);
      return r.json();
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise(res => setTimeout(res, (attempt + 1) * 1000));
    }
  }
}

async function putFile(filename, data) {
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}/me/drive/root:/${filename}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!r.ok) throw new Error(`OneDrive save error ${r.status}`);
  return r.json();
}

// ── OneDrive Commesse ──────────────────────────────────────────────────────────

const INDEX_FILE = 'commessa-control-index.json';

export async function loadCommesseIndex() {
  try {
    return await call(`/me/drive/root:/${INDEX_FILE}:/content`);
  } catch {
    return { version: 1, commesse: [] };
  }
}

export async function saveCommesseIndex(data) {
  return putFile(INDEX_FILE, { ...data, aggiornata_il: new Date().toISOString() });
}

export async function loadCommessa(id) {
  try {
    return await call(`/me/drive/root:/commessa-control-${id}.json:/content`);
  } catch {
    return null;
  }
}

export async function saveCommessa(id, data) {
  return putFile(`commessa-control-${id}.json`, { ...data, aggiornata_il: new Date().toISOString() });
}

// ── Microsoft To-Do ────────────────────────────────────────────────────────────

export async function getTodoLists() {
  const d = await call('/me/todo/lists');
  return d?.value || [];
}

export async function createTodoList(name) {
  return call('/me/todo/lists', {
    method: 'POST',
    body: JSON.stringify({ displayName: name }),
  });
}

export async function createTaskFull(listId, { title, dueDateTime, notes }) {
  return call(`/me/todo/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      ...(dueDateTime ? { dueDateTime: { dateTime: dueDateTime + 'T12:00:00', timeZone: 'Europe/Rome' } } : {}),
      ...(notes ? { body: { content: notes, contentType: 'text' } } : {}),
    }),
  });
}
