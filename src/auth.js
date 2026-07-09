import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config';

let msal = null;

// Chiave localStorage per ricordare l'account personale collegato
const PERSONAL_ID_KEY = 'md_personal_id';

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
      localStorage.setItem(PERSONAL_ID_KEY, result.account.homeAccountId);
    }
  } catch (e) {
    console.error('Redirect error:', e);
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

export async function login() {
  return msal.loginRedirect({ scopes: SCOPES });
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
