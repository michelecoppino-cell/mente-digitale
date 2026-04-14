import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES, WORK_SCOPES } from './config';

let msal = null;

// Chiavi localStorage per ricordare quale account è personale e quale aziendale
const PERSONAL_ID_KEY = 'md_personal_id';
const WORK_ID_KEY     = 'md_work_id';

// Il tenantId dei Microsoft Account personali (MSA) è sempre questo
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

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
    if (result?.account) {
      const loginType = sessionStorage.getItem('md_login_type');
      if (loginType === 'work') {
        localStorage.setItem(WORK_ID_KEY, result.account.homeAccountId);
      } else {
        localStorage.setItem(PERSONAL_ID_KEY, result.account.homeAccountId);
      }
      sessionStorage.removeItem('md_login_type');
    }
  } catch (e) {
    console.error('Redirect error:', e);
    sessionStorage.removeItem('md_login_type');
  }
  return msal;
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

// Account aziendale: solo tramite ID salvato dopo loginWork()
export function getWorkAccount() {
  if (!msal) return null;
  const id = localStorage.getItem(WORK_ID_KEY);
  if (!id) return null;
  return msal.getAllAccounts().find(a => a.homeAccountId === id) || null;
}

export async function login() {
  sessionStorage.setItem('md_login_type', 'personal');
  return msal.loginRedirect({ scopes: SCOPES });
}

// Login account aziendale — solo calendario
// Usa prompt=admin_consent per bypassare la policy di blocco utenti del tenant
export async function loginWork() {
  sessionStorage.setItem('md_login_type', 'work');
  return msal.loginRedirect({ scopes: WORK_SCOPES, prompt: 'admin_consent' });
}

export function logoutWork() {
  localStorage.removeItem(WORK_ID_KEY);
}

export async function getToken() {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      sessionStorage.setItem('md_login_type', 'personal');
      return msal.acquireTokenRedirect({ scopes: SCOPES });
    }
    throw e;
  }
}

export async function getWorkToken() {
  const account = getWorkAccount();
  if (!account) throw new Error('Account aziendale non connesso');
  try {
    const r = await msal.acquireTokenSilent({ scopes: WORK_SCOPES, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      sessionStorage.setItem('md_login_type', 'work');
      return msal.acquireTokenRedirect({ scopes: WORK_SCOPES, account });
    }
    throw e;
  }
}
