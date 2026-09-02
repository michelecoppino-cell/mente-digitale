// @ts-check
import { getToken } from './auth';
import { CARTELLA_APP, creaDrive } from './graphCore.js';
import { ymd } from './tempo.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Quanto si aspetta una singola richiesta prima di considerarla persa. Venti
// secondi sono lunghi per una rete che funziona e corti per una che si è
// piantata, che è esattamente la distinzione che serve: i tentativi sono tre,
// quindi nel caso peggiore un minuto e poi un errore vero, invece dell'attesa
// infinita di prima.
const TIMEOUT_MS = 20_000;

/** Il file su cui si fa la prova: il registro delle liste, che c'è sempre. */
const FILE_PROVA = 'task/_liste.json';

/**
 * Solo il nome dell'host di un URL. I file di OneDrive non stanno su
 * graph.microsoft.com: i metadati sì, il contenuto no — quello arriva da una
 * storage con un nome tutto suo. Se una rete lascia passare l'uno e non
 * l'altra, senza il nome dell'host non c'è modo di accorgersene.
 * @param {string} url
 */
function hostDi(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

// Cache token in memoria per evitare acquireTokenSilent ad ogni chiamata
/** @type {string|null} */
let _cachedToken = null;
let _cachedTokenExp = 0;

/**
 * Il token vale fino alla scadenza che dichiara lui, meno un minuto di
 * margine. Prima qui c'erano 45 minuti fissi «tanto il token MS dura un'ora»:
 * ma acquireTokenSilent restituisce il token che ha in cache, che può essere
 * già vecchio di cinquanta minuti — e da lì partiva una raffica di 401.
 * @param {boolean} [forceRefresh]
 * @returns {Promise<string>}
 */
async function getTokenCached(forceRefresh = false) {
  if (!forceRefresh && _cachedToken && Date.now() < _cachedTokenExp) return _cachedToken;
  const { token, expiresOn } = await getToken(forceRefresh);
  _cachedToken = token;
  // Due minuti di margine, non uno: su rete mobile una schermata che parte
  // con dieci chiamate insieme può impiegarcene più di uno, e un token che
  // scade a metà del giro le fa fallire tutte in 401 nello stesso istante.
  _cachedTokenExp = expiresOn - 120_000;
  return token;
}

export function invalidateTokenCache() { _cachedToken = null; _cachedTokenExp = 0; }

/**
 * Chiamata a Microsoft Graph con retry/backoff, un giro extra sul 401 (token
 * fresco) e gestione di 429/503/504. Accetta path relativi (`/me/...`) o URL
 * assoluti (i @odata.nextLink di paginazione).
 *
 * Restituisce la Response e non il JSON gia' letto perche' i file su OneDrive
 * hanno bisogno anche degli header — l'ETag della versione letta, che e' cio'
 * su cui si regge il controllo di concorrenza in scrittura. Chi vuole solo il
 * corpo usa `call`.
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {number} [retries]
 * @returns {Promise<Response>}
 */
async function callRaw(path, options = {}, retries = 3) {
  // Accetta anche URL assoluti: i link di paginazione @odata.nextLink di Graph
  // arrivano già completi di host.
  const url = path.startsWith('https://') ? path : GRAPH + path;
  let retried401 = false;
  // L'ultimo esito che ha fatto ritentare. Senza, «tentativi esauriti» non dice
  // di che morte si e' morti: 429 e' Graph che chiede di rallentare, 503 e 504
  // sono suoi problemi, e da un telefono e' l'unica cosa che si legge.
  /** @type {number|null} */
  let ultimoStatus = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    let r;
    // Il guinzaglio della richiesta. `fetch` non ne ha uno suo: su iPhone una
    // connessione che si impianta — il wi-fi che c'è ma non porta da nessuna
    // parte, il passaggio a rete mobile con una tacca — lascia la promise
    // pendente per sempre, e chi l'aspetta aspetta per sempre. Da fuori è
    // un'app che dice «Caricamento…» e non finisce mai: non un errore, e
    // quindi nemmeno un ripiego sulla copia in cache. Meglio un tentativo
    // troncato e rifatto che un'attesa senza fine.
    const guinzaglio = new AbortController();
    const scadenza = setTimeout(() => guinzaglio.abort(), TIMEOUT_MS);
    try {
      const token = await getTokenCached(retried401);
      r = await fetch(url, {
        ...options,
        signal: guinzaglio.signal,
        // Gli header dei chiamanti si sommano ai nostri invece di sostituirli:
        // `If-Match` deve poter viaggiare senza portarsi via l'Authorization.
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          .../** @type {Record<string,string>} */ (options.headers || {}),
        },
      });
    } catch (e) {
      const scaduta = /** @type {any} */ (e)?.name === 'AbortError';
      if (attempt === retries - 1) {
        // Un AbortError nudo — o il «Load failed» di Safari — non dicono
        // niente a chi legge dal telefono. Qui diventano la frase che il
        // pannello mostrerà, e ci va dentro l'host: quando le richieste a un
        // host passano e a un altro no, è l'host la diagnosi.
        throw scaduta
          ? new Error(`${hostDi(url)}: nessuna risposta entro ${TIMEOUT_MS / 1000}s`)
          : new Error(`${hostDi(url)}: ${/** @type {any} */ (e)?.message || String(e)}`);
      }
      await new Promise(res => setTimeout(res, (attempt + 1) * 1000));
      continue;
    } finally {
      clearTimeout(scadenza);
    }
    if (r.status === 204) return r;
    // Il token cachato può risultare scaduto (es. dopo una pausa lunga):
    // invalida la cache e riprova una volta sola con un token fresco prima
    // di arrendersi con un errore secco. Il giro extra non consuma uno dei
    // tentativi normali (altrimenti un 401 all'ultimo giro usciva con
    // "tentativi esauriti" senza aver mai provato il token fresco).
    // «Fresco» vuol dire forceRefresh: svuotare la sola cache locale faceva
    // richiedere a MSAL lo stesso identico token che Graph aveva appena
    // rifiutato, e il giro extra non serviva a niente.
    if (r.status === 401 && !retried401) {
      retried401 = true;
      invalidateTokenCache();
      attempt--;
      continue;
    }
    if (r.status === 429 || r.status === 503 || r.status === 504) {
      ultimoStatus = r.status;
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
    return r;
  }
  // Il percorso senza query: da telefono la riga e' larga quanto lo schermo, e
  // sessanta caratteri di `$select` coprono la sola cosa che conta.
  const dove = path.split('?')[0];
  throw new Error(
    `Graph ${ultimoStatus ?? 'error'}: tentativi esauriti per ${dove}`
  );
}

/**
 * Come `callRaw`, ma restituisce il corpo JSON (null sul 204).
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
async function call(path, options = {}, retries = 3) {
  const r = await callRaw(path, options, retries);
  return r.status === 204 ? null : r.json();
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

// ── I file dell'app su OneDrive ─────────────────────────────────────────────
// Cartella, percorsi, ETag, migrazione dei file rimasti dove stavano prima:
// tutto in `graphCore.js`, che le stesse regole le dà anche al CLI e al server
// MCP (`scripts/mente-graph.mjs`). Qui resta solo il trasporto — MSAL, i
// tentativi, il guinzaglio sulle richieste — che è la sola cosa che le due
// strade hanno davvero di diverso.
//
// Dentro la cartella dell'app, i registri che crescono di un file al mese hanno
// una sottocartella loro. La pressione è tutta lì: i file fissi sono una
// quindicina e non crescono, mentre diario e movimento aggiungono due file ogni
// mese, e dopo qualche anno la cartella non si guarda più. I fissi quindi
// restano in cima, dove si vedono.
const OD_FOLDER = CARTELLA_APP;

/** Sottocartelle dei registri che crescono nel tempo. Le attività ne hanno una
 *  loro, `task/`, ma il nome sta in taskStore.js, che è chi la usa. */
const SUB_DIARIO = 'diario';
const SUB_MOVIMENTO = 'movimento';
const SUB_DIARY_PHOTO = 'diario-foto';

const drive = creaDrive({ richiesta: callRaw, scarica: scaricaJson });

const { drivePath, ensureFolder, itemDiFile, getDriveJson, putDriveJson } = drive;

// Lo strato delle attività (taskStore.js) tiene i suoi file nella stessa
// cartella — `task/` — e passa da questi stessi due primitivi: stessa
// concorrenza, stessa migrazione, stesse cartelle create al bisogno.
export { getDriveJson, putDriveJson };

// Le prove mettono in scena più OneDrive uno dopo l'altro sullo stesso modulo:
// fra uno e l'altro il drive deve dimenticare quello che ha letto.
export const _dimenticaDrive = () => drive.dimentica();

// Migrazione in blocco, in due passate: prima i file `mente-digitale-*.json`
// rimasti nella root finiscono nella cartella dell'app, poi quelli di diario e
// movimento scendono nella loro sottocartella perdendo il prefisso.
//
// La migrazione pigra di getDriveJson basterebbe a non perdere nulla, ma
// sposterebbe ogni file solo quando la funzione che lo usa viene aperta — un
// mese di diario del 2024 resterebbe dov'è finché non lo si va a rileggere.
// Questa gira una volta sola (vedi il marker in App.jsx) e sistema tutto.
/** @returns {Promise<number>} quanti file sono stati spostati */
export async function migrateLegacyDriveFiles() {
  let moved = 0;

  /**
   * @param {string} id
   * @param {string} destinazione  percorso della cartella, rispetto alla root
   * @param {string} [nome]        nuovo nome, se lo spostamento è anche rinomina
   */
  const sposta = async (id, destinazione, nome) => {
    await call(`/me/drive/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        parentReference: { path: `/drive/root:${destinazione}` },
        ...(nome ? { name: nome } : {}),
      }),
    });
    moved++;
  };

  // Passata 1: dalla root alla cartella dell'app.
  const inRoot = await callPagedValues('/me/drive/root/children?$select=id,name,file&$top=200');
  const rimasti = inRoot.filter(i => i.file && /^mente-digitale-.*\.json$/.test(i.name || ''));
  if (rimasti.length) {
    await ensureFolder();
    for (const item of rimasti) {
      try {
        await sposta(item.id, `/${OD_FOLDER}`);
      } catch (e) {
        console.error('migrazione file OneDrive', item.name, e);
      }
    }
  }

  // Passata 2: dalla cartella dell'app alle sottocartelle dei registri.
  const inCartella = await callPagedValues(
    `/me/drive/root:/${OD_FOLDER}:/children?$select=id,name,file&$top=400`
  );
  for (const item of inCartella) {
    if (!item.file) continue;
    const m = /^mente-digitale-((diario|movimento)-.*\.json)$/.exec(item.name || '');
    if (!m) continue;
    try {
      await ensureFolder(m[2]);
      await sposta(item.id, `/${OD_FOLDER}/${m[2]}`, m[1]);
      drive.segnaMigrato(`${m[2]}/${m[1]}`);
    } catch (e) {
      console.error('migrazione file OneDrive', item.name, e);
    }
  }

  return moved;
}

/**
 * Scarica un URL di download pre-autenticato di OneDrive — quello che Graph
 * mette in `@microsoft.graph.downloadUrl` — e ne legge il JSON.
 *
 * Nessun header nostro, ed e' il punto: quell'URL sta su un altro host (la
 * storage di OneDrive), porta gia' con se' l'autorizzazione nella query, e
 * mandargli `Authorization` e `Content-Type` trasforma una richiesta semplice
 * in una preflighted che quell'host non accetta. E' esattamente cio' che
 * succedeva leggendo `:/content`: Graph risponde 302 verso questo stesso URL, e
 * il browser rimanda al seguito gli header della richiesta di partenza. Safari
 * ci si e' rotto ("Load failed" su ogni file, quindi ogni riquadro vuoto),
 * mentre altrove passava.
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<any>}
 */
async function scaricaJson(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const guinzaglio = new AbortController();
    const scadenza = setTimeout(() => guinzaglio.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: guinzaglio.signal });
      if (!r.ok) {
        const err = /** @type {Error & { status?: number }} */ (
          new Error(`Download del file: ${r.status}`)
        );
        err.status = r.status;
        throw err;
      }
      const testo = await r.text();
      return testo ? JSON.parse(testo) : null;
    } catch (e) {
      // Una risposta d'errore del server e' una risposta: non la si ritenta.
      // Si ritenta solo quello che non e' arrivato — rete caduta, richiesta
      // scaduta — che dal telefono e' il caso frequente.
      if (/** @type {any} */ (e)?.status) throw e;
      if (attempt === retries - 1) {
        throw /** @type {any} */ (e)?.name === 'AbortError'
          ? new Error(`${hostDi(url)}: nessuna risposta entro ${TIMEOUT_MS / 1000}s`)
          : new Error(`${hostDi(url)}: ${/** @type {any} */ (e)?.message || String(e)}`);
      }
      await new Promise(res => setTimeout(res, (attempt + 1) * 1000));
    } finally {
      clearTimeout(scadenza);
    }
  }
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

// ── Microsoft To-Do: quel che ne resta ──────────────────────────────────────
// I task non vivono più qui: stanno nei file nostri in mente-digitale/task/
// (taskStore.js). Di To-Do restano solo queste due letture, e servono a una
// cosa sola — la migrazione una tantum (taskMigrazione.js), che legge il
// vecchio archivio per riversarlo nei file. Non si scrive più niente su To-Do:
// resta lì com'è, congelato, finché non si deciderà se cancellarlo.

/** @returns {Promise<import('./types').TodoList[]>} */
export async function getTodoLists() {
  return callPagedValues('/me/todo/lists');
}

// Tutti i task di una lista, completati compresi e con le sottoattività dentro:
// la fotografia che serve alla migrazione.
/**
 * @param {string} listId
 * @returns {Promise<import('./types').TodoTask[]>}
 */
export async function getTodoTasksCompleti(listId) {
  return callPagedValues(`/me/todo/lists/${listId}/tasks?$expand=checklistItems&$top=100`, 50);
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

// Esito del caricamento per calendario dell'ultimo giro di getCalendarEvents.
// Prima i fallimenti per singolo calendario finivano dentro un
// Promise.allSettled e venivano buttati via senza una riga di log: un
// calendario che Graph rifiuta (tipicamente un calendario condiviso da
// un'altra persona, che /me/calendars elenca comunque) restava visibile nel
// filtro "Calendari" del Piano ma senza un solo evento, e non c'era modo di
// accorgersene — men che meno da telefono, dove la console non si legge.
/**
 * @typedef {Object} CalendarFetchIssue
 * @property {string} calId
 * @property {string} name
 * @property {'ok'|'fallback'|'error'} level
 * @property {string} message
 * @property {number} count      eventi caricati nella finestra richiesta
 * @property {boolean} shared
 */
/** @type {CalendarFetchIssue[]} */
let _calFetchReport = [];

/** Esito per calendario dell'ultimo getCalendarEvents. @returns {CalendarFetchIssue[]} */
export function getCalendarFetchReport() { return _calFetchReport; }

// Un errore Graph in forma leggibile: "403 — ErrorAccessDenied: ..." è
// l'unica cosa che, letta dal telefono, dice davvero cos'è successo.
/** @param {any} e @returns {string} */
function graphErrMsg(e) {
  const m = (e?.message || String(e)).replace(/^Graph error /, '');
  return m.length > 220 ? m.slice(0, 220) + '…' : m;
}

// Ripiego per i calendari su cui calendarView non funziona: la collezione
// /events grezza, filtrata sulla finestra. calendarView chiede al server di
// espandere le ricorrenze, e sulla copia locale di un calendario condiviso da
// un'altra persona quell'espansione può essere negata (403) mentre la lettura
// degli eventi passa. In compenso qui le serie ricorrenti arrivano come
// seriesMaster, cioè una sola riga sulla prima occorrenza invece che una per
// occorrenza: è una vista parziale, e come tale viene segnalata.
/**
 * @param {string} calId
 * @param {string} startIso
 * @param {string} endIso
 * @param {number} top
 * @returns {Promise<any[]>}
 */
async function fetchCalendarEventsRaw(calId, startIso, endIso, top) {
  // Graph vuole il letterale senza millisecondi né suffisso di fuso (lo
  // interpreta come UTC): con la "Z" in coda risponde 400.
  const lit = (/** @type {string} */ iso) => iso.slice(0, 19);
  const filter = encodeURIComponent(`start/dateTime lt '${lit(endIso)}' and end/dateTime gt '${lit(startIso)}'`);
  const q = `$filter=${filter}&$orderby=start/dateTime&$top=${top}&$select=id,subject,start,end,isAllDay,webLink,type`;
  return callPagedValues(`/me/calendars/${calId}/events?${q}`);
}

/**
 * Eventi di un singolo calendario, con ripiego su /events e diagnostica.
 * @param {import('./types').Calendar} cal
 * @param {boolean} isOwn
 * @param {string} params  querystring di calendarView
 * @param {string} startIso
 * @param {string} endIso
 * @param {number} top
 * @returns {Promise<{events: any[], report: CalendarFetchIssue}>}
 */
async function fetchOneCalendar(cal, isOwn, params, startIso, endIso, top) {
  /** @param {any[]} events @param {'calendarView'|'events'} mode */
  const decorate = (events, mode) => events.map(e => ({
    ...e,
    _calId:     cal.id,
    _calName:   cal.name,
    _calColor:  cal.color,
    _isShared:  !isOwn,
    _calMode:   mode,
  }));
  /** @param {'ok'|'fallback'|'error'} level @param {string} message @param {number} count */
  const report = (level, message, count) => ({
    calId: cal.id, name: cal.name || '', level, message, count, shared: !isOwn,
  });

  try {
    const events = await callPagedValues(`/me/calendars/${cal.id}/calendarView?${params}`);
    // Un calendario condiviso che risponde "nessun evento" merita una
    // controprova: è il modo silenzioso in cui Graph dice di no.
    if (events.length === 0 && !isOwn) {
      const raw = await fetchCalendarEventsRaw(cal.id, startIso, endIso, top).catch(() => []);
      if (raw.length) {
        return {
          events: decorate(raw, 'events'),
          report: report('fallback', `calendarView non restituisce nulla su questo calendario condiviso: ${raw.length} eventi letti in modalità compatibilità (le occorrenze delle serie ricorrenti oltre la prima non compaiono).`, raw.length),
        };
      }
    }
    return { events: decorate(events, 'calendarView'), report: report('ok', '', events.length) };
  } catch (e) {
    const first = graphErrMsg(e);
    try {
      const raw = await fetchCalendarEventsRaw(cal.id, startIso, endIso, top);
      return {
        events: decorate(raw, 'events'),
        report: report('fallback', `${first} — ${raw.length} eventi letti in modalità compatibilità (le occorrenze delle serie ricorrenti oltre la prima non compaiono).`, raw.length),
      };
    } catch (e2) {
      console.error('cal events', cal.name, e, e2);
      return { events: [], report: report('error', `${first}${isOwn ? '' : ' — calendario condiviso: serve il consenso "Calendars.Read.Shared" (esci e rientra per riautorizzare).'}`, 0) };
    }
  }
}

// Esegue le fetch a gruppi invece che tutte insieme: prima erano in parallelo
// ma limitate ai primi 8 calendari, ed era un altro modo di sparire in
// silenzio (il nono calendario compariva nel filtro senza mai un evento).
//
// Esportata perché il freno è lo stesso ovunque si legga una collezione di
// file o di calendari: tutti insieme Graph risponde 429, uno per volta si
// aspetta la somma di tutte le risposte. A gruppi è la sola misura giusta, e
// va scritta una volta.
/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

/**
 * Eventi Calendario mergiati da tutti i calendari, escluso il calendario
 * Workbook dedicato. Ogni evento è decorato con
 * _calId/_calName/_calColor/_isShared/_calMode; l'esito per calendario resta
 * leggibile con getCalendarFetchReport().
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
    _calFetchReport = [];
    return callPagedValues(`/me/calendarView?${params}`);
  }

  const defaultCal = calendars.find(c => c.isDefaultCalendar) || calendars[0];
  const userEmail  = (defaultCal?.owner?.address || '').toLowerCase();

  // calendarView pagina i risultati anche quando $top chiede di più: senza
  // seguire @odata.nextLink gli eventi oltre la prima pagina (tipicamente
  // quelli più lontani nel tempo, essendo l'ordinamento per start/dateTime
  // crescente) sparivano in silenzio dalla finestra ±3 mesi.
  const results = await mapLimit(calendars, 4, cal => {
    const isOwn = !userEmail || (cal.owner?.address || '').toLowerCase() === userEmail;
    return fetchOneCalendar(cal, isOwn, params, start, end, top);
  });

  _calFetchReport = results.map(r => r.report);
  const problemi = _calFetchReport.filter(r => r.level !== 'ok');
  if (problemi.length) console.warn('calendari con eventi non caricati:', problemi);

  const allEvents = results.flatMap(r => r.events);
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

// ── OneDrive Diario ────────────────────────────────────────────────────────
// Un file per mese invece di un file unico: il diario è l'unico dato che
// cresce senza limite (e che non si può potare come piani e statistiche, dove
// si buttano le voci oltre i 90 giorni), quindi si evita di rileggere e
// riscrivere anni di scritture a ogni salvataggio.
//
// Un piccolo indice tiene la lista dei mesi che contengono voci: OneDrive non
// offre un filtro affidabile per prefisso sul nome dei file, e senza indice
// l'unico modo di sapere quali mesi esistono sarebbe tentare il GET di ognuno
// a ritroso.
// Fondere per id e' la regola di riapplicazione di Diario e Movimento: quando
// il file e' cambiato sotto (l'altro dispositivo ha scritto la sua voce), la
// nostra voce si rimette sopra il contenuto fresco invece di sostituirlo.
/**
 * @template {{ id: string }} T
 * @param {T[]} esistenti
 * @param {T[]} nuove
 * @returns {T[]}
 */
function fondiPerId(esistenti, nuove) {
  const mappa = new Map(esistenti.map(v => [v.id, v]));
  for (const v of nuove) mappa.set(v.id, v);
  return [...mappa.values()];
}

/** @param {any} data @returns {any[]} */
function comeArray(data) {
  return Array.isArray(data) ? data : [];
}

const OD_DIARY_INDEX_FILE = `${SUB_DIARIO}/diario-index.json`;

/** @param {string} ym 'YYYY-MM' @returns {string} */
function diaryMonthFile(ym) {
  return `${SUB_DIARIO}/diario-${ym}.json`;
}

/** @returns {Promise<{ months: string[] }>} */
export async function loadDiaryIndex() {
  const idx = await getDriveJson(OD_DIARY_INDEX_FILE, { months: [] });
  return { months: Array.isArray(idx?.months) ? idx.months : [] };
}

/** @param {string} ym @returns {Promise<import('./types').DiaryEntry[]>} */
export async function loadDiaryMonth(ym) {
  const data = await getDriveJson(diaryMonthFile(ym), []);
  return Array.isArray(data) ? data : [];
}

/**
 * Salva (o aggiorna, per id) una voce nel file del suo mese e registra il mese
 * nell'indice. Rilegge il mese prima di scrivere, così una voce creata da un
 * altro dispositivo nella stessa giornata non viene persa.
 * @param {import('./types').DiaryEntry} entry
 * @returns {Promise<import('./types').DiaryEntry[]>} le voci del mese aggiornate
 */
export async function saveDiaryEntry(entry) {
  const ym = entry.date.slice(0, 7);
  const existing = await loadDiaryMonth(ym);
  const i = existing.findIndex(e => e.id === entry.id);
  const updated = i >= 0
    ? existing.map(e => (e.id === entry.id ? entry : e))
    : [...existing, entry];
  await putDriveJson(diaryMonthFile(ym), updated, {
    reapply: fresco => fondiPerId(comeArray(fresco), [entry]),
  });

  const idx = await loadDiaryIndex();
  if (!idx.months.includes(ym)) {
    await putDriveJson(OD_DIARY_INDEX_FILE, { months: [...idx.months, ym].sort() }, {
      reapply: fresco => ({ months: [...new Set([...comeArray(fresco?.months), ym])].sort() }),
    });
  }
  return updated;
}

/**
 * Salva molte voci insieme: un file per mese riscritto una volta sola e
 * l'indice aggiornato alla fine.
 *
 * saveDiaryEntry costa tre o quattro richieste a voce, il che va benissimo per
 * una scrittura della sera e per niente per un'importazione da centinaia di
 * voci: da lì arriva questa. La fusione resta per id, quindi reimportare lo
 * stesso archivio aggiorna le voci invece di sdoppiarle.
 *
 * @param {import('./types').DiaryEntry[]} entries
 * @returns {Promise<string[]>} i mesi toccati
 */
export async function saveDiaryEntries(entries) {
  /** @type {Record<string, import('./types').DiaryEntry[]>} */
  const perMese = {};
  for (const e of entries) (perMese[e.date.slice(0, 7)] ||= []).push(e);

  const mesi = Object.keys(perMese).sort();
  for (const ym of mesi) {
    const esistenti = await loadDiaryMonth(ym);
    const mappa = new Map(esistenti.map(e => [e.id, e]));
    for (const e of perMese[ym]) mappa.set(e.id, e);
    /** @param {import('./types').DiaryEntry[]} voci */
    const ordina = voci => [...voci].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    await putDriveJson(diaryMonthFile(ym), ordina([...mappa.values()]), {
      reapply: fresco => ordina(fondiPerId(comeArray(fresco), perMese[ym])),
    });
  }

  const idx = await loadDiaryIndex();
  const tutti = [...new Set([...idx.months, ...mesi])].sort();
  if (tutti.length !== idx.months.length) {
    await putDriveJson(OD_DIARY_INDEX_FILE, { months: tutti }, {
      reapply: fresco => ({ months: [...new Set([...comeArray(fresco?.months), ...mesi])].sort() }),
    });
  }
  return mesi;
}

/**
 * @param {import('./types').DiaryEntry} entry
 * @returns {Promise<import('./types').DiaryEntry[]>} le voci del mese aggiornate
 */
export async function deleteDiaryEntry(entry) {
  const ym = entry.date.slice(0, 7);
  const existing = await loadDiaryMonth(ym);
  const updated = existing.filter(e => e.id !== entry.id);
  await putDriveJson(diaryMonthFile(ym), updated, {
    reapply: fresco => comeArray(fresco).filter(e => e.id !== entry.id),
  });
  return updated;
}

// ── OneDrive Movimento ─────────────────────────────────────────────────────
// Stessa impalcatura del Diario, e per la stessa ragione: è un dato che cresce
// senza limite e che non si pota, quindi un file per mese invece di uno unico
// da rileggere e riscrivere per intero a ogni sessione registrata.
//
// L'indice porta anche l'unica preferenza della scheda — quale calendario
// contiene le sessioni programmate. Sta lì e non in un file suo perché è un
// campo solo, e perché chi legge il registro ha già bisogno dell'indice: un
// secondo file vorrebbe dire una seconda richiesta a ogni apertura di «Oggi».
const OD_MOVIMENTO_INDEX_FILE = `${SUB_MOVIMENTO}/movimento-index.json`;

/** @param {string} ym 'YYYY-MM' @returns {string} */
function movimentoMonthFile(ym) {
  return `${SUB_MOVIMENTO}/movimento-${ym}.json`;
}

/** @param {any} idx @returns {import('./types').MovimentoIndex} */
function normalizzaIndiceMovimento(idx) {
  return {
    months: Array.isArray(idx?.months) ? idx.months : [],
    calendarId: idx?.calendarId ?? null,
    calendarName: idx?.calendarName ?? null,
    bersagli: (idx?.bersagli && typeof idx.bersagli === 'object') ? idx.bersagli : {},
  };
}

/** @returns {Promise<import('./types').MovimentoIndex>} */
export async function loadMovimentoIndex() {
  return normalizzaIndiceMovimento(await getDriveJson(OD_MOVIMENTO_INDEX_FILE, null));
}

/**
 * @param {import('./types').MovimentoIndex} idx
 * @param {{ reapply?: (fresco: any) => any }} [opts]
 * @returns {Promise<any>}
 */
export async function saveMovimentoIndex(idx, opts) {
  return putDriveJson(OD_MOVIMENTO_INDEX_FILE, idx, opts);
}

/** @param {string} ym @returns {Promise<import('./types').Movimento[]>} */
export async function loadMovimentoMese(ym) {
  const data = await getDriveJson(movimentoMonthFile(ym), []);
  return Array.isArray(data) ? data : [];
}

/**
 * Salva (o aggiorna, per id) una sessione nel file del suo mese e registra il
 * mese nell'indice. Rilegge il mese prima di scrivere, così una sessione
 * registrata dal telefono non viene persa da una registrata dal portatile
 * nella stessa giornata.
 * @param {import('./types').Movimento} voce
 * @returns {Promise<import('./types').Movimento[]>} le voci del mese aggiornate
 */
export async function saveMovimento(voce) {
  const ym = voce.date.slice(0, 7);
  const esistenti = await loadMovimentoMese(ym);
  const i = esistenti.findIndex(v => v.id === voce.id);
  const aggiornate = i >= 0
    ? esistenti.map(v => (v.id === voce.id ? voce : v))
    : [...esistenti, voce];
  /** @param {import('./types').Movimento[]} voci */
  const ordina = voci => [...voci].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || '')
  );
  await putDriveJson(movimentoMonthFile(ym), ordina(aggiornate), {
    reapply: fresco => ordina(fondiPerId(comeArray(fresco), [voce])),
  });

  const idx = await loadMovimentoIndex();
  if (!idx.months.includes(ym)) {
    await saveMovimentoIndex({ ...idx, months: [...idx.months, ym].sort() }, {
      // Del nostro indice conta solo il mese aggiunto: le altre preferenze
      // (calendario, bersagli) si prendono da quello fresco, che e' piu' nuovo.
      reapply: fresco => {
        const base = normalizzaIndiceMovimento(fresco);
        return { ...base, months: [...new Set([...base.months, ym])].sort() };
      },
    });
  }
  return ordina(aggiornate);
}

/**
 * @param {import('./types').Movimento} voce
 * @returns {Promise<import('./types').Movimento[]>} le voci del mese aggiornate
 */
export async function deleteMovimento(voce) {
  const ym = voce.date.slice(0, 7);
  const esistenti = await loadMovimentoMese(ym);
  const aggiornate = esistenti.filter(v => v.id !== voce.id);
  await putDriveJson(movimentoMonthFile(ym), aggiornate, {
    reapply: fresco => comeArray(fresco).filter(v => v.id !== voce.id),
  });
  return aggiornate;
}

// ── OneDrive Obiettivi del mese ────────────────────────────────────────────
// Un file solo, e non uno per mese come Diario e Movimento: gli obiettivi di
// un mese sono sei righe, e dieci anni di sei righe restano un file che si
// legge in una richiesta. La chiave è il mese 'YYYY-MM', così i mesi passati
// restano leggibili senza doverli archiviare.
const OD_OBIETTIVI_FILE = 'mente-digitale-obiettivi.json';

/** @returns {Promise<Record<string, import('./types').Obiettivo[]>>} */
export async function loadObiettivi() {
  const doc = await getDriveJson(OD_OBIETTIVI_FILE, null);
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
}

/** @param {Record<string, import('./types').Obiettivo[]>} doc @returns {Promise<any>} */
export async function saveObiettivi(doc) {
  return putDriveJson(OD_OBIETTIVI_FILE, doc);
}

// ── OneDrive «Da leggere e vedere» ─────────────────────────────────────────
// Anche questo un file solo, e per un motivo diverso: non è un registro che
// cresce, è una coda che si accorcia. Quello che è finito ci resta come
// memoria, ma se un giorno diventasse ingombrante si pota — che è esattamente
// quello che a un registro di Diario non si può fare.
const OD_CODA_FILE = 'mente-digitale-coda.json';

/** @returns {Promise<import('./types').VoceCoda[]>} */
export async function loadCoda() {
  const voci = await getDriveJson(OD_CODA_FILE, null);
  return Array.isArray(voci) ? voci : [];
}

/** @param {import('./types').VoceCoda[]} voci @returns {Promise<any>} */
export async function saveCoda(voci) {
  return putDriveJson(OD_CODA_FILE, voci);
}

// ── OneDrive Rituale del mattino ───────────────────────────────────────────
// Movimento, meditazione e yoga si fanno appena svegli, e quello che serve
// saperne alla fine del mese non è soltanto quante volte sono stati fatti: è
// **perché** nei giorni in cui non lo sono stati. Il registro del Movimento
// tiene il fatto, questo file tiene la risposta quotidiana — anche quando la
// risposta è «no, e per questo motivo».
//
// Un file solo e non uno per mese come il registro: una giornata sono tre
// righe da poche decine di byte, e dieci anni restano un file che si legge in
// una richiesta. Si pota comunque a due anni: la motivazione di un martedì di
// tre anni fa non la rilegge nessuno.
const OD_RITUALE_FILE = 'mente-digitale-rituale.json';

/** Quanto indietro si conserva il rituale, in giorni. */
const RITUALE_GIORNI = 730;

/** @returns {Promise<Record<string, import('./types').RitualeGiorno>>} */
export async function loadRituale() {
  const doc = await getDriveJson(OD_RITUALE_FILE, null);
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
}

/**
 * Scrive i giorni toccati, sopra quelli che ci sono già.
 *
 * Rilegge il file prima di scrivere, come il Diario e il Movimento: il
 * pannello si compila la mattina dal telefono e si corregge la sera dal
 * portatile, e la seconda compilazione non deve cancellare la prima.
 * @param {Record<string, import('./types').RitualeGiorno>} giorni  solo i giorni toccati
 * @returns {Promise<Record<string, import('./types').RitualeGiorno>>} il documento come è stato scritto
 */
export async function saveRituale(giorni) {
  /** @param {any} base @returns {Record<string, import('./types').RitualeGiorno>} */
  const unisciEPota = (base) => {
    const unito = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}), ...giorni };
    const taglio = new Date();
    taglio.setDate(taglio.getDate() - RITUALE_GIORNI);
    const limite = ymd(taglio);
    /** @type {Record<string, import('./types').RitualeGiorno>} */
    const potato = {};
    for (const [data, giorno] of Object.entries(unito)) {
      if (data >= limite) potato[data] = giorno;
    }
    return potato;
  };
  const potato = unisciEPota(await loadRituale());
  await putDriveJson(OD_RITUALE_FILE, potato, { reapply: fresco => unisciEPota(fresco) });
  return potato;
}

// ── Foto del diario ────────────────────────────────────────────────────────
// Le immagini non stanno dentro il JSON del mese (un file di voci non deve
// diventare da megabyte): vivono come file veri in una sottocartella, e la
// voce ne conserva solo il nome. Così una foto si può anche aprire da
// OneDrive, e cancellare una voce non obbliga a riscrivere nulla di binario.
const ensurePhotoFolder = () => ensureFolder(SUB_DIARY_PHOTO);

/** @param {string} name @returns {string} */
function photoPath(name) {
  return drivePath(`${SUB_DIARY_PHOTO}/${encodeURIComponent(name)}`);
}

/**
 * Carica un'immagine e restituisce il nome del file su OneDrive.
 * @param {Blob} blob
 * @param {string} name  nome già normalizzato dal chiamante (id + estensione)
 * @returns {Promise<string>}
 */
export async function uploadDiaryPhoto(blob, name) {
  await ensurePhotoFolder();
  const token = await getTokenCached();
  const r = await fetch(`${GRAPH}${photoPath(name)}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!r.ok) throw new Error(`Upload foto ${name} error ${r.status}`);
  return name;
}

// Graph serve i binari con un 302 verso un URL pre-autenticato, e rifollow con
// l'header Authorization fa fallire il CORS: si chiede quindi il downloadUrl
// dai metadati e si scarica quello in chiaro. Vale circa un'ora, quindi si
// tiene in cache un po' meno per non servire mai un link già scaduto.
const PHOTO_URL_TTL = 45 * 60 * 1000;
/** @type {Map<string, { url: string, at: number }>} */
const _photoUrls = new Map();

/** @param {string} name @returns {Promise<string>} URL scaricabile dell'immagine */
export async function getDiaryPhotoUrl(name) {
  const hit = _photoUrls.get(name);
  if (hit && Date.now() - hit.at < PHOTO_URL_TTL) return hit.url;
  const item = await call(`${photoPath(name)}?$select=id,name,@microsoft.graph.downloadUrl`);
  const url = item?.['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error(`Foto ${name} senza downloadUrl`);
  _photoUrls.set(name, { url, at: Date.now() });
  return url;
}

/** @param {string} name @returns {Promise<void>} */
export async function deleteDiaryPhoto(name) {
  _photoUrls.delete(name);
  try {
    await call(photoPath(name), { method: 'DELETE' });
  } catch (e) {
    // Una foto già assente non è un errore da propagare: la voce che la
    // citava sta comunque per sparire.
    if (/** @type {any} */ (e)?.status !== 404) throw e;
  }
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

// ── OneDrive Finanze ─────────────────────────────────────────────────────────
// Il backup della sezione Finanze: un unico JSON con l'intero stato (movimenti,
// fatture, tasse, parametri), lo stesso formato dell'export manuale.
//
// Prima dell'assorbimento in mente-digitale, Finanze era un'app a sé con la
// propria registrazione Azure e lo scope `Files.ReadWrite.AppFolder`, quindi il
// backup viveva in `Apps/Finanze`. Qui riusa il login e la cartella di tutto il
// resto: un solo consenso Microsoft, un solo `handleRedirectPromise`. Il vecchio
// file nell'AppFolder non è raggiungibile con questo scope e va recuperato una
// volta sola con l'import JSON.
const OD_FINANZE_FILE = 'mente-digitale-finanze.json';

/** @returns {Promise<any|null>} lo snapshot salvato, o null se non esiste ancora */
export async function loadFinanze() {
  return getDriveJson(OD_FINANZE_FILE, null);
}

/** @param {any} data @returns {Promise<any>} */
export async function saveFinanze(data) {
  return putDriveJson(OD_FINANZE_FILE, data);
}


/**
 * Tre richieste che separano i tre sospetti, da lanciare dal pannello di stato
 * quando l'app non carica e gli errori non bastano a dire di chi è la colpa.
 *
 * Sono tre host diversi dietro a un'unica frase — «non funziona» — e finché
 * non si sa quale dei tre non risponde si tira a indovinare: Graph, i metadati
 * di OneDrive (che sono ancora Graph) e la storage dei file, che è un dominio
 * a parte e può essere filtrata per conto suo da una VPN, da Private Relay o
 * da un blocco DNS sul telefono.
 *
 * @returns {Promise<{passo: string, ok: boolean, nota: string}[]>}
 */
export async function provaConnessione() {
  /** @type {{passo: string, ok: boolean, nota: string}[]} */
  const esiti = [];
  /** @param {string} passo @param {() => Promise<string>} fn */
  const prova = async (passo, fn) => {
    const t0 = Date.now();
    try {
      const nota = await fn();
      esiti.push({ passo, ok: true, nota: `${Date.now() - t0}ms · ${nota}` });
    } catch (e) {
      esiti.push({ passo, ok: false, nota: /** @type {any} */ (e)?.message || String(e) });
    }
  };

  await prova('Graph', async () => {
    const io = await call('/me?$select=userPrincipalName', {}, 1);
    return io?.userPrincipalName || 'ok';
  });

  /** @type {any} */
  let item = null;
  await prova('OneDrive · metadati', async () => {
    item = await itemDiFile(FILE_PROVA);
    return item ? 'file trovato' : 'file assente';
  });

  await prova('OneDrive · contenuto', async () => {
    if (!item) return 'niente da scaricare';
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) return 'nessun URL di download';
    await scaricaJson(url, 1);
    return hostDi(url);
  });

  return esiti;
}
