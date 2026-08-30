import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES, PREFERRED_LOGIN_HINT } from './config';

let msal = null;

// Chiave localStorage per ricordare l'account personale collegato
const PERSONAL_ID_KEY = 'md_personal_id';
// Ricorda anche lo username, per passarlo come loginHint e saltare lo
// chooser Microsoft anche su un dispositivo/browser senza cache locale
const PERSONAL_USERNAME_KEY = 'md_personal_username';

// Il tenantId dei Microsoft Account personali (MSA) è sempre questo
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

// Traccia l'ultimo motivo per cui è scattato un redirect di login: su iPhone
// senza Mac collegato non c'è modo di leggere la console, quindi lo teniamo
// qui per poterlo mostrare nella schermata di login stessa.
const AUTH_DEBUG_KEY = 'md_auth_debug';

// Ultimo rinnovo silenzioso riuscito: da solo dice quasi tutto. Se la
// disconnessione arriva sessanta minuti dopo l'ultimo rinnovo riuscito, il
// refresh token non è mai stato usato; se arriva dopo un giorno, è il tetto
// delle 24 ore dei refresh token SPA.
const AUTH_OK_KEY = 'md_auth_last_ok';

// Momento dell'ultimo accesso interattivo davvero fatto a mano. Con l'ultimo
// rinnovo riuscito qui sopra dice per quanto è durata la sessione, e serve
// anche quando di errore non ce n'è nessuno: la schermata di login compare
// anche quando l'account non c'è più in cache, e quella non è una scadenza —
// è la memoria del sito svuotata.
const AUTH_LOGIN_KEY = 'md_auth_login_at';

function logAuthRedirect(e) {
  try {
    localStorage.setItem(AUTH_DEBUG_KEY, JSON.stringify({
      t: new Date().toISOString(),
      errorCode: e?.errorCode || null,
      // Il sotto-codice è quello che distingue «il refresh token è scaduto»
      // da «Microsoft vuole rivederti in faccia»: senza, dalla schermata di
      // login si legge sempre e solo `interaction_required`.
      subError: e?.subError || null,
      message: e?.errorMessage || String(e),
      lastOk: localStorage.getItem(AUTH_OK_KEY) || null,
    }));
  } catch { /* storage non disponibile */ }
}

function logAuthOk() {
  try { localStorage.setItem(AUTH_OK_KEY, new Date().toISOString()); } catch { /* storage non disponibile */ }
}

export function getLastAuthDebug() {
  try { return JSON.parse(localStorage.getItem(AUTH_DEBUG_KEY) || 'null'); } catch { return null; }
}

/**
 * Fotografia di com'è messa l'autenticazione su questo dispositivo, da
 * mostrare nella schermata di login. Su iPhone è l'unica strada: non c'è
 * console da leggere, e la schermata di login da sola non distingue le due
 * cose che la fanno comparire — un rinnovo fallito (c'è un errore) e una
 * cache sparita (non c'è niente, nemmeno l'errore).
 * @returns {{lastError: ReturnType<typeof getLastAuthDebug>, lastOk: string|null,
 *   loginAt: string|null, storageAvailable: boolean, hasMsalCache: boolean,
 *   standalone: boolean}}
 */
export function getAuthDiagnostics() {
  let storageAvailable = true;
  let lastOk = null;
  let loginAt = null;
  let hasMsalCache = false;
  try {
    lastOk = localStorage.getItem(AUTH_OK_KEY);
    loginAt = localStorage.getItem(AUTH_LOGIN_KEY);
    // MSAL tiene le sue chiavi in localStorage e ci mette dentro il clientId.
    // Se non ce n'è nessuna, l'account non è «scaduto»: è stato cancellato.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.includes(CLIENT_ID) || k.startsWith('msal.')) { hasMsalCache = true; break; }
    }
  } catch {
    storageAvailable = false;
  }
  return {
    lastError: getLastAuthDebug(),
    lastOk,
    loginAt,
    storageAvailable,
    hasMsalCache,
    // Safari e l'app aperta dall'icona sulla Home hanno due memorie separate:
    // sapere da quale delle due si sta guardando evita di scambiare «devo
    // accedere anche qui» per «la sessione è scaduta».
    standalone: window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches,
  };
}

export async function initAuth() {
  // initAuth viene chiamata una volta sola dal boot dell'app, ma in StrictMode
  // l'effetto parte due volte: una seconda PublicClientApplication sullo stesso
  // clientId significa due cache che si sovrascrivono a vicenda, ed è uno dei
  // modi in cui una sessione valida sembra sparire.
  if (msal) return msal;
  msal = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: REDIRECT_URI,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: true, // fondamentale per Safari iOS
    },
    system: {
      allowNativeBroker: false,
      // I 6 secondi di default per l'iframe nascosto del rinnovo silenzioso
      // sono tarati su un desktop: su iPhone in rete mobile scadono prima che
      // Microsoft risponda, e un timeout viene trattato come «serve il login».
      iframeHashTimeout: 12_000,
      loadFrameTimeout: 12_000,
    },
  });
  await msal.initialize();

  try {
    const result = await msal.handleRedirectPromise();
    if (result?.account) {
      rememberAccount(result.account);
      // Si è appena tornati da Microsoft: è questo il momento in cui la
      // sessione comincia, ed è da qui che si misura quanto dura.
      try { localStorage.setItem(AUTH_LOGIN_KEY, new Date().toISOString()); } catch { /* storage non disponibile */ }
    }
  } catch (e) {
    console.error('Redirect error:', e);
  }

  return msal;
}

// Da chiamare in background (senza await) quando non c'è un account in
// cache: se la sessione Microsoft nel browser è ancora attiva, autentica
// senza mostrare nulla, altrimenti risolve a null e resta lo schermo di
// login classico. Non va mai atteso prima del primo render: l'iframe
// nascosto verso Microsoft può metterci diversi secondi.
export async function trySsoSilent() {
  try {
    const result = await msal.ssoSilent({ scopes: SCOPES, loginHint: getLoginHint() });
    rememberAccount(result.account);
    setInteractionRequired(false);
    return result.account;
  } catch {
    return null;
  }
}

function rememberAccount(account) {
  localStorage.setItem(PERSONAL_ID_KEY, account.homeAccountId);
  localStorage.setItem(PERSONAL_USERNAME_KEY, account.username);
}

function getLoginHint() {
  return localStorage.getItem(PERSONAL_USERNAME_KEY) || PREFERRED_LOGIN_HINT;
}

// Account personale: usa ID salvato; fallback all'account MSA; fallback al primo
export function getAccount() {
  if (!msal) return null;
  const all = msal.getAllAccounts();
  const id = localStorage.getItem(PERSONAL_ID_KEY);
  if (id) {
    const acc = all.find(a => a.homeAccountId === id);
    if (acc) return acc;
  }
  // Se non c'è ID salvato, preferisci l'account MSA (personale)
  const msa = all.find(a => a.tenantId === MSA_TENANT);
  if (msa) return msa;
  return all[0] || null;
}

export async function login() {
  // Passa un hint per saltare lo chooser Microsoft (che altrimenti propone
  // tutti gli account con sessione attiva nel browser).
  return msal.loginRedirect({ scopes: SCOPES, loginHint: getLoginHint() });
}

// ── Sessione scaduta: si avvisa, non si scaraventa fuori ────────────────────
//
// Prima, il primo errore "serve interazione" faceva partire un
// acquireTokenRedirect da dentro una fetch qualunque: la pagina spariva verso
// Microsoft nel mezzo di quello che si stava facendo, e siccome ogni schermata
// fa una decina di chiamate Graph in parallelo, bastava un token stanco perché
// succedesse in continuazione. Ora il redirect parte solo da un gesto
// dell'utente (il bottone «Riconnetti»), e nel frattempo l'app resta in piedi
// con i dati che ha già.
const listeners = new Set();
let interactionRequired = false;

/** @returns {boolean} true se serve un nuovo accesso interattivo */
export function isInteractionRequired() { return interactionRequired; }

/** @param {(needed: boolean) => void} fn @returns {() => void} */
export function onInteractionRequired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setInteractionRequired(v) {
  if (interactionRequired === v) return;
  interactionRequired = v;
  listeners.forEach(fn => { try { fn(v); } catch { /* listener rotto */ } });
}

/** Riporta l'utente su Microsoft — da chiamare solo da un click. */
export async function reconnect() {
  const account = getAccount();
  return msal.acquireTokenRedirect(
    account ? { scopes: SCOPES, account } : { scopes: SCOPES, loginHint: getLoginHint() }
  );
}

// Una sola richiesta di token alla volta, sempre. Senza questo, le dieci
// chiamate Graph che parte una schermata all'apertura facevano dieci
// acquireTokenSilent in parallelo: dieci iframe verso Microsoft, che su Safari
// finiscono in timeout a vicenda e producono l'errore che poi portava al login.
//
// Il rinnovo forzato aveva una scappatoia da questa coda, ed è la scappatoia
// che costava la sessione: allo scadere dell'ora tutte le chiamate in volo
// prendono 401 insieme e chiedono tutte un token fresco: altrettanti riscatti
// dello stesso refresh token nello stesso istante. I refresh token rilasciati
// a una SPA sono monouso e ruotano — il primo riscatto invalida gli altri, e
// quello che torna indietro è «serve interazione», cioè lo schermo di login
// un'ora tondo dopo l'accesso. Adesso i forzati si accodano e, se ne sono
// arrivati più d'uno, condividono lo stesso rinnovo.
/** @typedef {{token: string, expiresOn: number}} TokenResult */
/** @type {Promise<TokenResult>|null} */
let inFlight = null;
/** @type {Promise<TokenResult>|null} */
let inFlightForced = null;
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/** Esegue `fn` dopo che l'acquisizione precedente ha finito, comunque sia andata. */
function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

/**
 * Access token per Graph, con la sua scadenza vera.
 * @param {boolean} [forceRefresh] ignora la cache MSAL e rinnova davvero
 * @returns {Promise<TokenResult>}
 */
export function getToken(forceRefresh = false) {
  if (forceRefresh) {
    if (inFlightForced) return inFlightForced;
    const p = enqueue(() => acquire(true)).finally(() => { if (inFlightForced === p) inFlightForced = null; });
    inFlightForced = p;
    return p;
  }
  if (inFlight) return inFlight;
  const p = enqueue(() => acquire(false)).finally(() => { if (inFlight === p) inFlight = null; });
  inFlight = p;
  return p;
}

async function acquire(forceRefresh) {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh });
    return onAcquired(r);
  } catch (e) {
    if (!(e instanceof InteractionRequiredAuthError)) throw e;
    // Secondo tentativo silenzioso per un'altra strada: se il cookie di
    // sessione Microsoft nel browser è ancora buono, ssoSilent riesce dove
    // il refresh token in cache ha smesso di funzionare — ed è invisibile.
    // Su Safari con «Impedisci tracciamento tra siti» l'iframe non vede il
    // cookie e questa strada non porta da nessuna parte: è il rinnovo
    // programmato qui sotto che tiene in piedi la sessione, non lei.
    try {
      const r = await msal.ssoSilent({ scopes: SCOPES, loginHint: getLoginHint() });
      rememberAccount(r.account);
      return onAcquired(r);
    } catch { /* niente da fare in silenzio */ }
    logAuthRedirect(e);
    setInteractionRequired(true);
    throw e;
  }
}

/**
 * @param {{accessToken: string, expiresOn?: Date|null}} r
 * @returns {TokenResult}
 */
function onAcquired(r) {
  const expiresOn = r.expiresOn ? r.expiresOn.getTime() : Date.now() + 55 * 60_000;
  setInteractionRequired(false);
  logAuthOk();
  scheduleRenew(expiresOn);
  return { token: r.accessToken, expiresOn };
}

// ── Rinnovo prima della scadenza ────────────────────────────────────────────
//
// L'access token dura un'ora, il refresh token che c'è dietro molto di più: la
// differenza fra le due cose si vede solo se qualcuno usa il secondo prima che
// scada il primo. Finora nessuno lo faceva — si aspettava il 401 — e il 401
// arriva sempre nel momento peggiore, cioè mentre la schermata sta caricando
// tutto insieme. Qui il rinnovo parte cinque minuti prima, da solo.

const RENEW_MARGIN_MS = 5 * 60_000;
/** @type {ReturnType<typeof setTimeout>|null} */
let renewTimer = null;
let expiresAt = 0;

function scheduleRenew(expiresOn) {
  expiresAt = expiresOn;
  if (renewTimer) clearTimeout(renewTimer);
  // Mai sotto il mezzo minuto: se Microsoft restituisce un token già quasi
  // scaduto, un rinnovo immediato in cascata non aiuterebbe nessuno.
  const delay = Math.max(30_000, expiresOn - Date.now() - RENEW_MARGIN_MS);
  renewTimer = setTimeout(() => { getToken(true).catch(() => {}); }, delay);
}

/**
 * Tiene viva la sessione: rinnovo programmato prima della scadenza, e un
 * rinnovo al ritorno sull'app. Il timer da solo non basta su iPhone — quando
 * il telefono sospende la pagina i timer non scattano, e al ritorno il token
 * è vecchio di ore. Da chiamare una volta sola, dopo initAuth.
 * @returns {() => void}
 */
export function startTokenKeepAlive() {
  function refreshIfStale() {
    if (document.visibilityState !== 'visible') return;
    if (!getAccount()) return;
    // Rinnova prima che la schermata parta con le sue chiamate a Graph: il
    // token vecchio le farebbe fallire tutte insieme in 401.
    if (Date.now() < expiresAt - RENEW_MARGIN_MS) return;
    getToken(true).catch(() => {});
  }
  document.addEventListener('visibilitychange', refreshIfStale);
  window.addEventListener('online', refreshIfStale);
  refreshIfStale();
  return () => {
    document.removeEventListener('visibilitychange', refreshIfStale);
    window.removeEventListener('online', refreshIfStale);
    if (renewTimer) clearTimeout(renewTimer);
  };
}
