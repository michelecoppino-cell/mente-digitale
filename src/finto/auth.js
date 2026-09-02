// L'autenticazione, in finto.
//
// Ha la stessa forma di `src/auth.js` — stessi nomi, stesse promesse — ma non
// parla con nessuno: risponde subito con un account inventato e un token che
// non serve a niente, perché dall'altra parte c'è il finto Graph e non
// Microsoft.
//
// `vite.config.js` la mette al posto di quella vera quando si avvia
// `npm run dev:finto`, e in nessun altro caso. La build di produzione non la
// vede nemmeno: non è un interruttore dentro l'app, è un altro file al posto
// di quello — così non c'è nessuna riga di codice finto che possa finire
// online per sbaglio.

import { montaFintoOnedrive } from './drive.js';
import { montaFintoGraph } from './graph.js';

// Il finto Graph si monta qui, all'import, e non in una funzione da ricordarsi
// di chiamare: `api.js` importa `./auth`, quindi questo file viene valutato
// prima di qualunque richiesta. Se lo si montasse dentro `initAuth()`, le
// letture partite prima troverebbero il `fetch` vero e uscirebbero davvero
// sulla rete.
const finto = montaFintoOnedrive();
montaFintoGraph(finto);

// Comoda dalla console del browser: `window.__finto.archivio` per vedere cosa
// è stato scritto, `__finto.richieste` per le chiamate fatte.
if (typeof window !== 'undefined') {
  /** @type {any} */ (window).__finto = finto;
  console.info(
    '%cmente-digitale · finto OneDrive',
    'color:#d4a44a;font-weight:600',
    '\nNessuna rete, nessun account. I dati sono inventati e vivono in memoria:'
    + ' ricaricare la pagina li riporta come erano.'
    + '\nDalla console: __finto.archivio, __finto.richieste',
  );
}

const ACCOUNT = {
  homeAccountId: 'finto.account',
  username: 'finto@esempio.it',
  name: 'Finto',
  tenantId: '9188040d-6c67-4c5b-b112-36a304b66dad',
  idTokenClaims: {},
};

export async function initAuth() { return null; }
export function getAccount() { return ACCOUNT; }
export async function login() { return ACCOUNT; }
export async function cambiaAccount() { return ACCOUNT; }
export async function trySsoSilent() { return ACCOUNT; }
export async function reconnect() { return ACCOUNT; }
export function isInteractionRequired() { return false; }
export function onInteractionRequired() { return () => {}; }
export function startTokenKeepAlive() { return () => {}; }
export function getLastAuthDebug() { return null; }

export function getToken() {
  return Promise.resolve({ token: 'finto', expiresOn: Date.now() + 3_600_000 });
}

export function getAuthDiagnostics() {
  return {
    lastError: null, lastOk: null, lastRefresh: null, loginAt: null,
    storageAvailable: true, accounts: 1, ricordato: true, storageFull: null,
    storageKb: 0, msalKeys: 0, msalInv: 'finto', trail: [], standalone: false,
  };
}
