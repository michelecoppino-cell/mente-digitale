import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config';

let msal = null;

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
      storeAuthStateInCookie: true,  // fondamentale per Safari iOS
    },
    system: {
      allowNativeBroker: false,
    }
  });
  await msal.initialize();
  try {
    const result = await msal.handleRedirectPromise();
    if (result) {
      // Salva token appena ricevuto
      console.log('Login completato:', result.account?.username);
    }
  } catch(e) {
    console.error('Redirect error:', e);
  }
  return msal;
}

export function getAccount() {
  return msal?.getAllAccounts()[0] || null;
}

export async function login() {
  return msal.loginRedirect({ scopes: SCOPES });
}

export async function getToken() {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account });
    // Rinnova proattivamente se scade entro 5 minuti
    const exp = r.expiresOn?.getTime() || 0;
    const now = Date.now();
    if (exp - now < 5 * 60 * 1000) {
      try {
        const fresh = await msal.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh: true });
        return fresh.accessToken;
      } catch(e2) {}
    }
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      return msal.acquireTokenRedirect({ scopes: SCOPES });
    }
    throw e;
  }
}
