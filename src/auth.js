import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config';

let msal = null;

export async function initAuth() {
  msal = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: REDIRECT_URI,
    },
    cache: { cacheLocation: 'localStorage' }
  });
  await msal.initialize();
  try {
    await msal.handleRedirectPromise();
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
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      return msal.acquireTokenRedirect({ scopes: SCOPES });
    }
    throw e;
  }
}
