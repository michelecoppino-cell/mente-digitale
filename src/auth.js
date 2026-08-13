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
    system: { allowNativeBroker: false },
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

export async function getToken() {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      logAuthRedirect(e);
      return msal.acquireTokenRedirect({ scopes: SCOPES, account });
    }
    throw e;
  }
}
