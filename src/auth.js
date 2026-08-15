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

function logAuthRedirect(e) {
  try {
    localStorage.setItem(AUTH_DEBUG_KEY, JSON.stringify({
      t: new Date().toISOString(),
      errorCode: e?.errorCode || null,
      message: e?.errorMessage || String(e),
    }));
  } catch { /* storage non disponibile */ }
}

export function getLastAuthDebug() {
  try { return JSON.parse(localStorage.getItem(AUTH_DEBUG_KEY) || 'null'); } catch { return null; }
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
    if (result?.account) rememberAccount(result.account);
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

// Una sola acquisizione alla volta. Senza questo, le dieci chiamate Graph che
// parte una schermata all'apertura facevano dieci acquireTokenSilent in
// parallelo: dieci iframe verso Microsoft, che su Safari finiscono in timeout
// a vicenda e producono l'errore che poi portava al login.
/** @type {Promise<{token: string, expiresOn: number}>|null} */
let inFlight = null;

/**
 * Access token per Graph, con la sua scadenza vera.
 * @param {boolean} [forceRefresh] ignora la cache MSAL e rinnova davvero
 * @returns {Promise<{token: string, expiresOn: number}>}
 */
export function getToken(forceRefresh = false) {
  if (inFlight && !forceRefresh) return inFlight;
  const p = acquire(forceRefresh).finally(() => { if (inFlight === p) inFlight = null; });
  inFlight = p;
  return p;
}

async function acquire(forceRefresh) {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh });
    setInteractionRequired(false);
    return { token: r.accessToken, expiresOn: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 55 * 60_000 };
  } catch (e) {
    if (!(e instanceof InteractionRequiredAuthError)) throw e;
    // Secondo tentativo silenzioso per un'altra strada: se il cookie di
    // sessione Microsoft nel browser è ancora buono, ssoSilent riesce dove
    // il refresh token in cache ha smesso di funzionare — ed è invisibile.
    try {
      const r = await msal.ssoSilent({ scopes: SCOPES, loginHint: getLoginHint() });
      rememberAccount(r.account);
      setInteractionRequired(false);
      return { token: r.accessToken, expiresOn: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 55 * 60_000 };
    } catch { /* niente da fare in silenzio */ }
    logAuthRedirect(e);
    setInteractionRequired(true);
    throw e;
  }
}
