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
import { creaDrive } from '../src/graphCore.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
export const TIMEZONE = 'Europe/Rome';

// Gli scope del CLI. Erano «tutto in lettura, scrittura solo su To-Do e sui
// file dell'app»; ora si scrive anche su OneNote e sul calendario, perché una
// mente digitale che si può solo leggere da fuori costringe comunque ad aprire
// l'app per ogni riga scritta. Ciascuno degli scope di scrittura serve a un
// gruppo preciso di operazioni, e non ce ne sono altri:
//
//   Files.ReadWrite   i file dell'app su OneDrive — attività, diario, piani
//   Notes.ReadWrite   pagine OneNote (crearne una, aggiungere in fondo)
//   Calendars.ReadWrite  eventi del calendario
//
// `sync-calendar.mjs` ne usa altri e più stretti: i due token restano separati.
// Cambiando questo elenco il refresh token va rifatto — gli scope sono cuciti
// dentro al token, non chiesti a ogni chiamata:
//   node scripts/get-refresh-token.mjs --mente
// Di Microsoft To-Do non c'è più niente: le attività sono file su OneDrive, e
// ci arrivano da Files.ReadWrite come tutto il resto.
export const MENTE_SCOPE = [
  'offline_access',
  'Files.ReadWrite',
  'Notes.ReadWrite',
  'Notes.ReadWrite.All',
  'Calendars.ReadWrite',
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
 * Con `risposta: true` restituisce la Response invece del corpo: serve a
 * leggere l'ETag di un file su OneDrive, su cui si regge il controllo di
 * concorrenza in scrittura.
 * @param {string} path
 * @param {RequestInit & { raw?: boolean, risposta?: boolean }} [options]
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
export async function graph(path, options = {}, retries = 3) {
  const { raw, risposta, ...init } = options;
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

    if (r.status === 204) return risposta ? r : null;
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
    if (risposta) return r;
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
// Stessa cartella, stessi nomi e **stesse regole** dell'app: il CLI legge e
// scrive gli stessi file, non una copia parallela.
//
// Fin qui «stesse regole» voleva dire un codice gemello ricopiato qui sotto —
// percorsi, sottocartelle, ETag, il 412 risolto rileggendo — e due copie che
// potevano divergere senza che niente lo dicesse. È già successo: l'app ha
// cambiato il modo di ottenere l'URL di download di un file e questa copia è
// rimasta indietro. Adesso le regole stanno in `src/graphCore.js` e qui si
// inietta solo il trasporto, che è la sola cosa davvero diversa: un refresh
// token invece di MSAL.
const drive = creaDrive({
  richiesta: (percorso, opzioni) => graph(percorso, { ...opzioni, risposta: true }),
  // L'URL di download è già autorizzato e sta su un'altra origine: si scarica
  // in chiaro, senza i nostri header. Qui non c'è il CORS a imporlo come nel
  // browser, ma la strada è la stessa e tanto vale che sia una sola.
  scarica: async url => {
    const r = await fetch(url);
    if (!r.ok) {
      const err = new Error(`Download del file: ${r.status}`);
      err.status = r.status;
      throw err;
    }
    const testo = await r.text();
    return testo ? JSON.parse(testo) : null;
  },
});

export const { getDriveJson, putDriveJson } = drive;

/** Solo per le prove: il drive dimentica quello che ha letto in questa sessione. */
export const _dimenticaDrive = () => drive.dimentica();

// ── Diario ───────────────────────────────────────────────────────────────────

const OD_DIARY_INDEX_FILE = 'diario/diario-index.json';

/** @param {string} ym @returns {string} */
const diaryMonthFile = ym => `diario/diario-${ym}.json`;

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

/**
 * I piani, riscritti. Come nell'app, i giorni più vecchi di 90 li si lascia
 * cadere: il file è uno solo e cresce per sempre, e un piano di quattro mesi fa
 * non lo rilegge nessuno.
 * @param {Record<string, any>} plans
 * @returns {Promise<any>}
 */
export async function saveDailyPlans(plans) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  /** @type {Record<string, any>} */
  const pruned = {};
  for (const [date, plan] of Object.entries(plans || {})) {
    if (new Date(date) >= cutoff) pruned[date] = plan;
  }
  return putDriveJson('mente-digitale-daily-plans.json', pruned);
}

/** @param {'bussola'|'visione'} type @returns {Promise<any>} */
export async function loadIdentityDoc(type) {
  return getDriveJson(`mente-digitale-${type}.json`, null);
}

// ── Obiettivi del mese ───────────────────────────────────────────────────────
// Un file solo, con dentro tutti i mesi: gli obiettivi di un mese sono da tre a
// sei righe. Stesso file dell'app (`src/obiettivi.js` per il modello).

/** @returns {Promise<Record<string, any[]>>} */
export async function loadObiettivi() {
  const doc = await getDriveJson('mente-digitale-obiettivi.json', null);
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
}

/** @param {Record<string, any[]>} doc @returns {Promise<any>} */
export async function saveObiettivi(doc) {
  return putDriveJson('mente-digitale-obiettivi.json', doc);
}

// ── Attività ─────────────────────────────────────────────────────────────────
// Le attività sono file su OneDrive, e lo strato che le legge e le scrive è
// quello dell'app: src/taskStore.js, a cui qui si dice solo da dove leggere e
// dove scrivere. Un archivio solo, una regola sola — prima il CLI e l'app
// parlavano tutti e due con To-Do e ognuno si portava dietro la propria idea di
// come si compone una nota.

import { usaDrive } from '../src/taskStore.js';

usaDrive({ leggi: getDriveJson, scrivi: putDriveJson });

export * from '../src/taskStore.js';

// ── Calendario ───────────────────────────────────────────────────────────────

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

/** I calendari collegati. Serve a sapere dove creare un evento. @returns {Promise<any[]>} */
export async function getCalendars() {
  return graphPaged('/me/calendars?$select=id,name,isDefaultCalendar,canEdit');
}

/**
 * Un evento nuovo. Gli orari si mandano come ora locale più il nome del fuso, e
 * non come UTC: se si scrive «giovedì alle 15» dev'essere le 15 sul calendario
 * di chi guarda, anche quando l'ora legale cambia fra oggi e giovedì.
 * @param {{ oggetto: string, data: string, inizio?: string, fine?: string,
 *           tuttoIlGiorno?: boolean, luogo?: string, note?: string,
 *           promemoriaMin?: number|null, calendarId?: string|null }} ev
 * @returns {Promise<any>}
 */
export async function createCalendarEvent(ev) {
  /** @type {Record<string, any>} */
  const body = { subject: ev.oggetto };
  if (ev.luogo) body.location = { displayName: ev.luogo };
  if (ev.note) body.body = { contentType: 'text', content: ev.note };

  if (ev.tuttoIlGiorno) {
    // Un evento «tutto il giorno» su Graph finisce il giorno dopo: la fine è
    // esclusiva, e mettendo lo stesso giorno l'evento non esisterebbe.
    const fine = new Date(`${ev.data}T00:00:00Z`);
    fine.setUTCDate(fine.getUTCDate() + 1);
    body.isAllDay = true;
    body.start = { dateTime: `${ev.data}T00:00:00`, timeZone: TIMEZONE };
    body.end   = { dateTime: `${fine.toISOString().slice(0, 10)}T00:00:00`, timeZone: TIMEZONE };
  } else {
    body.start = { dateTime: `${ev.data}T${ev.inizio}:00`, timeZone: TIMEZONE };
    body.end   = { dateTime: `${ev.data}T${ev.fine}:00`,   timeZone: TIMEZONE };
  }

  if (ev.promemoriaMin === null || ev.promemoriaMin === undefined) {
    // Niente: resta il default dell'account.
  } else if (ev.promemoriaMin < 0) {
    body.isReminderOn = false;
  } else {
    body.isReminderOn = true;
    body.reminderMinutesBeforeStart = Math.round(ev.promemoriaMin);
  }

  const path = ev.calendarId ? `/me/calendars/${ev.calendarId}/events` : '/me/events';
  return graph(path, { method: 'POST', body: JSON.stringify(body) });
}

// ── OneNote ──────────────────────────────────────────────────────────────────

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
 * Una pagina nuova in una sezione. OneNote non prende JSON ma un documento
 * HTML intero — `<title>` è il titolo della pagina, il `<body>` il contenuto —
 * quindi qui si spedisce `text/html` e non si passa da `graph()`, che manda
 * JSON per default.
 * @param {string} sectionId
 * @param {string} titolo
 * @param {string} html   il corpo, già HTML
 * @returns {Promise<any>}
 */
export async function createPage(sectionId, titolo, html) {
  const token = await getAccessToken();
  const doc =
    '<!DOCTYPE html><html><head>' +
    `<title>${escapeHtml(titolo)}</title>` +
    `<meta name="created" content="${new Date().toISOString()}" />` +
    `</head><body>${html}</body></html>`;
  const r = await fetch(`${GRAPH}/me/onenote/sections/${sectionId}/pages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/html' },
    body: doc,
  });
  if (!r.ok) throw new Error(`Creazione pagina OneNote fallita (${r.status}: ${(await r.text()).slice(0, 300)})`);
  return r.json();
}

/**
 * Testo aggiunto in fondo a una pagina che esiste già. OneNote non ha una
 * «modifica»: ha un elenco di comandi PATCH che agiscono su un punto della
 * pagina. `append` sul target `body` è l'unico che non possa rovinare quello
 * che c'era prima — nessun `replace`, da qui, per lo stesso motivo per cui
 * nessuno strumento cancella niente.
 * @param {string} pageId
 * @param {string} html
 * @returns {Promise<void>}
 */
export async function appendToPage(pageId, html) {
  const token = await getAccessToken();
  const r = await fetch(`${GRAPH}/me/onenote/pages/${pageId}/content`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ target: 'body', action: 'append', content: html }]),
  });
  if (!r.ok) throw new Error(`Scrittura sulla pagina OneNote fallita (${r.status}: ${(await r.text()).slice(0, 300)})`);
}

/**
 * Testo semplice in HTML per OneNote: le righe vuote separano i paragrafi, le
 * righe che cominciano con `- ` diventano un elenco. Non è un renderer di
 * Markdown — è quel poco che serve perché una nota dettata a voce arrivi su
 * OneNote con la forma che aveva.
 * @param {string} testo
 * @returns {string}
 */
export function textToHtml(testo) {
  const blocchi = String(testo || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocchi.map(b => {
    const righe = b.split('\n').filter(r => r.trim());
    if (!righe.length) return '';
    if (righe.every(r => /^\s*-\s+/.test(r))) {
      return '<ul>' + righe.map(r => `<li>${escapeHtml(r.replace(/^\s*-\s+/, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${righe.map(escapeHtml).join('<br />')}</p>`;
  }).join('') || '<p></p>';
}

/** @param {string} s @returns {string} */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
