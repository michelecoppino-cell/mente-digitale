/**
 * mente-graph.mjs
 * Lo strato Microsoft Graph della mente digitale, fuori dal browser.
 *
 * È il gemello da riga di comando di `src/api.js`: stessi endpoint, stessi
 * nomi di file su OneDrive, stessa cartella `mente-digitale/`. La differenza è
 * solo l'autenticazione — qui non c'è MSAL, c'è un refresh token, come già fa
 * `sync-calendar.mjs` da GitHub Actions.
 *
 * Nessuna dipendenza, Node 18+.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
export const TIMEZONE = 'Europe/Rome';

// Gli scope del CLI: tutto in lettura come l'app, scrittura solo dove serve
// (attività su To-Do, file dell'app su OneDrive — cioè diario e piani).
// `sync-calendar.mjs` ne usa altri e più stretti: i due token restano separati.
export const MENTE_SCOPE = [
  'offline_access',
  'Files.ReadWrite',
  'Tasks.ReadWrite',
  'Notes.Read',
  'Notes.Read.All',
  'Calendars.Read',
  'Mail.Read',
].join(' ');

// Il file dove il CLI tiene il proprio refresh token quando gira in locale.
// È in .gitignore: non deve finire nel repo per nessun motivo.
export const TOKEN_FILE = join(__dirname, '.mente-refresh-token');

// ── Refresh token ────────────────────────────────────────────────────────────

// Un .env minimale (KEY=valore, righe vuote e # ignorati): serve solo a non
// costringere a esportare la variabile a ogni shell nuova. Non sovrascrive
// mai una variabile già presente nell'ambiente.
function loadDotEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

/**
 * Da dove arriva il refresh token, in ordine: variabile dedicata, file locale,
 * variabile di `sync-calendar` come ultima spiaggia (funziona solo se quel
 * token è stato preso con gli scope del CLI).
 * @returns {{ token: string, source: 'env'|'file' }}
 */
function resolveRefreshToken() {
  loadDotEnv();
  if (process.env.MENTE_REFRESH_TOKEN) return { token: process.env.MENTE_REFRESH_TOKEN, source: 'env' };
  if (existsSync(TOKEN_FILE)) {
    const t = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return { token: t, source: 'file' };
  }
  if (process.env.MS_REFRESH_TOKEN) return { token: process.env.MS_REFRESH_TOKEN, source: 'env' };
  throw new Error(
    'Nessun refresh token. Prendine uno con:\n' +
    '  node scripts/get-refresh-token.mjs --mente\n' +
    'e salvalo in scripts/.mente-refresh-token (o in MENTE_REFRESH_TOKEN).'
  );
}

/** @type {{ token: string, exp: number }|null} */
let _access = null;

/** @returns {Promise<string>} */
export async function getAccessToken() {
  if (_access && Date.now() < _access.exp) return _access.token;

  const { token: refreshToken, source } = resolveRefreshToken();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      scope: MENTE_SCOPE,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(
      `Token rifiutato — ${String(detail).split('\n')[0]}\n` +
      'Se parla di consenso o di scope mancanti, rifai:\n' +
      '  node scripts/get-refresh-token.mjs --mente'
    );
  }

  // Il refresh token ruota: se è arrivato dal file lo si riscrive, altrimenti
  // fra qualche settimana quello vecchio smette di funzionare senza motivo
  // apparente. Se arriva dall'ambiente non possiamo fare niente: lo diciamo.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    if (source === 'file') writeFileSync(TOKEN_FILE, data.refresh_token, 'utf8');
    else writeFileSync(join(__dirname, '.new-refresh-token'), data.refresh_token, 'utf8');
  }

  _access = {
    token: data.access_token,
    exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
  };
  return _access.token;
}

// ── Chiamate ─────────────────────────────────────────────────────────────────

/**
 * Chiamata a Graph con retry su 429/503/504 e un giro extra sul 401, come
 * `call` in src/api.js. Accetta path relativi o i @odata.nextLink assoluti.
 * @param {string} path
 * @param {RequestInit & { raw?: boolean }} [options]
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
export async function graph(path, options = {}, retries = 3) {
  const { raw, ...init } = options;
  const url = path.startsWith('https://') ? path : GRAPH + path;
  let retried401 = false;

  for (let attempt = 0; attempt < retries; attempt++) {
    let r;
    try {
      const token = await getAccessToken();
      r = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: `outlook.timezone="${TIMEZONE}"`,
          ...(init.headers || {}),
        },
      });
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await sleep((attempt + 1) * 1000);
      continue;
    }

    if (r.status === 204) return null;
    if (r.status === 401 && !retried401) {
      retried401 = true;
      _access = null;
      attempt--;
      continue;
    }
    if (r.status === 429 || r.status === 503 || r.status === 504) {
      const retryAfter = r.headers.get('Retry-After');
      await sleep(retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 1000);
      continue;
    }
    if (!r.ok) {
      let detail = '';
      try {
        const body = await r.json();
        if (body?.error?.message) {
          detail = ` — ${body.error.code ? body.error.code + ': ' : ''}${body.error.message}`;
        }
      } catch { /* corpo non-JSON */ }
      const err = new Error(`Graph error ${r.status}${detail}`);
      err.status = r.status;
      throw err;
    }
    return raw ? r.text() : r.json();
  }
  throw new Error(`Graph: tentativi esauriti per ${path}`);
}

/** @param {number} ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Segue @odata.nextLink e concatena i `.value`.
 * @param {string} path
 * @param {number} [maxPages]
 * @returns {Promise<any[]>}
 */
export async function graphPaged(path, maxPages = 10) {
  const out = [];
  let next = path;
  for (let i = 0; i < maxPages && next; i++) {
    const d = await graph(next);
    out.push(...(d?.value || []));
    next = d?.['@odata.nextLink'] || null;
  }
  return out;
}

// ── File dell'app su OneDrive ────────────────────────────────────────────────
// Stessa cartella e stessi nomi dell'app: il CLI legge e scrive gli stessi
// file, non una copia parallela.

const OD_FOLDER = 'mente-digitale';

/** @param {string} filename @returns {string} */
function drivePath(filename) {
  return `/me/drive/root:/${OD_FOLDER}/${filename}`;
}

/** @type {Promise<any>|null} */
let _folderReady = null;
function ensureAppFolder() {
  if (!_folderReady) {
    _folderReady = graph('/me/drive/root/children', {
      method: 'POST',
      body: JSON.stringify({ name: OD_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    }).catch(e => {
      if (e?.status === 409) return null;   // esiste già: l'esito normale
      _folderReady = null;
      throw e;
    });
  }
  return _folderReady;
}

/**
 * @template T
 * @param {string} filename
 * @param {T} notFoundValue
 * @returns {Promise<T|any>}
 */
export async function getDriveJson(filename, notFoundValue) {
  try {
    return await graph(`${drivePath(filename)}:/content`);
  } catch (e) {
    if (e?.status === 404) return notFoundValue;
    throw e;
  }
}

/**
 * @param {string} filename
 * @param {any} data
 * @returns {Promise<any>}
 */
export async function putDriveJson(filename, data) {
  await ensureAppFolder();
  const token = await getAccessToken();
  const r = await fetch(`${GRAPH}${drivePath(filename)}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!r.ok) throw new Error(`Salvataggio ${filename} fallito (${r.status})`);
  return r.json();
}

// ── Diario ───────────────────────────────────────────────────────────────────

const OD_DIARY_INDEX_FILE = 'mente-digitale-diario-index.json';

/** @param {string} ym @returns {string} */
const diaryMonthFile = ym => `mente-digitale-diario-${ym}.json`;

/** @returns {Promise<{ months: string[] }>} */
export async function loadDiaryIndex() {
  const idx = await getDriveJson(OD_DIARY_INDEX_FILE, { months: [] });
  return { months: Array.isArray(idx?.months) ? idx.months : [] };
}

/** @param {string} ym @returns {Promise<any[]>} */
export async function loadDiaryMonth(ym) {
  const data = await getDriveJson(diaryMonthFile(ym), []);
  return Array.isArray(data) ? data : [];
}

/**
 * Salva (o aggiorna, per id) una voce nel file del suo mese e registra il mese
 * nell'indice. Rilegge il mese prima di scrivere: una voce scritta dall'app
 * nello stesso giorno non deve sparire.
 * @param {any} entry
 * @returns {Promise<any[]>} le voci del mese aggiornate
 */
export async function saveDiaryEntry(entry) {
  const ym = entry.date.slice(0, 7);
  const existing = await loadDiaryMonth(ym);
  const i = existing.findIndex(e => e.id === entry.id);
  const updated = i >= 0 ? existing.map(e => (e.id === entry.id ? entry : e)) : [...existing, entry];
  await putDriveJson(diaryMonthFile(ym), updated);

  const idx = await loadDiaryIndex();
  if (!idx.months.includes(ym)) {
    await putDriveJson(OD_DIARY_INDEX_FILE, { months: [...idx.months, ym].sort() });
  }
  return updated;
}

// ── Piani, documenti identitari ──────────────────────────────────────────────

/** @returns {Promise<Record<string, any>>} */
export async function loadDailyPlans() {
  return getDriveJson('mente-digitale-daily-plans.json', {});
}

/** @param {'bussola'|'visione'} type @returns {Promise<any>} */
export async function loadIdentityDoc(type) {
  return getDriveJson(`mente-digitale-${type}.json`, null);
}

// ── To-Do ────────────────────────────────────────────────────────────────────

/** @returns {Promise<any[]>} */
export async function getTodoLists() {
  return graphPaged('/me/todo/lists');
}

/**
 * I task di una lista, annotati con `_listId`/`_listName` come fa l'app:
 * lo stato del flusso dipende anche dalla lista in cui vive il task.
 * @param {{ id: string, displayName?: string }} list
 * @param {{ includeDone?: boolean }} [opts]
 * @returns {Promise<any[]>}
 */
export async function getTodoTasks(list, opts = {}) {
  const filtro = opts.includeDone ? '' : "$filter=status ne 'completed'&";
  const tasks = await graphPaged(`/me/todo/lists/${list.id}/tasks?${filtro}$top=100`);
  return tasks.map(t => ({ ...t, _listId: list.id, _listName: list.displayName }));
}

/**
 * @param {string} listId
 * @param {{ title: string, body?: string, dueDate?: string, status?: string, categories?: string[] }} payload
 * @returns {Promise<any>}
 */
export async function createTask(listId, payload) {
  const body = { title: payload.title };
  if (payload.body) body.body = { content: payload.body, contentType: 'text' };
  if (payload.dueDate) body.dueDateTime = { dateTime: `${payload.dueDate}T12:00:00`, timeZone: 'UTC' };
  if (payload.status) body.status = payload.status;
  if (payload.categories?.length) body.categories = payload.categories;
  return graph(`/me/todo/lists/${listId}/tasks`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @param {Record<string, any>} patch
 * @returns {Promise<any>}
 */
export async function patchTask(listId, taskId, patch) {
  return graph(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Calendario (sola lettura) ────────────────────────────────────────────────

/**
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<any[]>}
 */
export async function getCalendarEvents(start, end) {
  const params =
    `startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}` +
    '&$orderby=start/dateTime&$top=100&$select=id,subject,start,end,isAllDay,location';
  const eventi = await graphPaged(`/me/calendarView?${params}`);
  return eventi.sort((a, b) =>
    String(a.start?.dateTime || a.start?.date).localeCompare(String(b.start?.dateTime || b.start?.date))
  );
}

// ── OneNote (sola lettura) ───────────────────────────────────────────────────

/** @returns {Promise<any[]>} */
export async function getNotebooks() {
  return graphPaged('/me/onenote/notebooks?includePersonalNotebooks=true&$orderby=displayName');
}

/** @param {string} notebookId @returns {Promise<any[]>} */
export async function getSections(notebookId) {
  return graphPaged(`/me/onenote/notebooks/${notebookId}/sections?$orderby=displayName`);
}

/** @param {string} sectionId @returns {Promise<any[]>} */
export async function getPages(sectionId) {
  return graphPaged(`/me/onenote/sections/${sectionId}/pages?pagelevel=true&$top=100`);
}

/** @param {string} pageId @returns {Promise<string>} HTML grezzo della pagina */
export async function getPageContentHtml(pageId) {
  return graph(`/me/onenote/pages/${pageId}/content`, { raw: true });
}

/**
 * L'HTML di OneNote ridotto a testo leggibile. Non è un parser: serve solo a
 * far stare una pagina in un terminale (e in una conversazione) senza tag.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
