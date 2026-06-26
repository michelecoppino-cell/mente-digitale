import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config';

let msal = null;
const ACCOUNT_ID_KEY = 'cc_account_id';

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
      storeAuthStateInCookie: true,
    },
    system: { allowNativeBroker: false },
  });
  await msal.initialize();
  try {
    const result = await msal.handleRedirectPromise();
    if (result?.account) localStorage.setItem(ACCOUNT_ID_KEY, result.account.homeAccountId);
  } catch (e) {
    console.error('Redirect error:', e);
  }
  return msal;
}

export function getAccount() {
  if (!msal) return null;
  const all = msal.getAllAccounts();
  const id = localStorage.getItem(ACCOUNT_ID_KEY);
  if (id) {
    const acc = all.find(a => a.homeAccountId === id);
    if (acc) return acc;
  }
  return all[0] || null;
}

export async function login() {
  return msal.loginRedirect({ scopes: SCOPES });
}

export async function logout() {
  const account = getAccount();
  localStorage.removeItem(ACCOUNT_ID_KEY);
  return msal.logoutRedirect({ account });
}

export async function getToken() {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      return msal.acquireTokenRedirect({ scopes: SCOPES });
    }
    throw e;
  }
}
