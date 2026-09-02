// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
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

// L'ultima volta che il refresh token è stato *speso davvero*. Distinguerlo
// dall'ultima acquisizione riuscita è tutta la differenza fra le due diagnosi:
// `acquireTokenSilent` risponde anche solo leggendo la cache, quindi
// «ultima acquisizione» dice soltanto fino a quando l'app è stata usata. Se qui
// non c'è niente e la sessione è morta, il refresh token non è mai entrato in
// gioco.
const AUTH_REFRESH_KEY = 'md_auth_last_refresh';

// Lucchetto condiviso fra le istanze dell'app. Le tre icone sulla schermata
// Home aprono la stessa app sulla stessa origine: memoria in comune, ma
// ognuna con il suo MSAL in pagina. La coda qui sotto serializza i rinnovi
// dentro una pagina sola, e fra pagine diverse non può niente — due rinnovi
// forzati insieme sono due riscatti dello stesso refresh token, che è monouso
// e ruota: il primo invalida il secondo, e chi perde si porta via l'account
// dalla cache condivisa. Da lì la schermata di login, senza che nessuno abbia
// visto scadere niente.
const REFRESH_LOCK_KEY = 'md_auth_refresh_lock';
const REFRESH_LOCK_TTL = 20_000;

// La scatola nera: le ultime cose successe all'autenticazione, in ordine.
// Un errore solo, quello dell'ultima volta, dice cosa è andato storto ma non
// cosa stava succedendo intorno — e su iPhone «cosa stava succedendo intorno»
// è tutto: quante volte l'app è stata riavviata, quanti riscatti sono partiti,
// se fra l'ultimo riuscito e la disconnessione l'app è stata aperta di nuovo.
const TRAIL_KEY = 'md_auth_trail';
const TRAIL_MAX = 8;

/** @param {string} evento */
function traccia(evento) {
  try {
    const prima = JSON.parse(localStorage.getItem(TRAIL_KEY) || '[]');
    const dopo = [...(Array.isArray(prima) ? prima : []), { t: new Date().toISOString(), e: evento }];
    localStorage.setItem(TRAIL_KEY, JSON.stringify(dopo.slice(-TRAIL_MAX)));
  } catch { /* storage non disponibile */ }
}

/**
 * Inventario di quello che MSAL tiene in `localStorage`, per tipo. Il totale da
 * solo non basta: fra le sue chiavi ce ne sono un paio di puro indice, che
 * restano lì anche quando non c'è più niente dentro. Sapere se manca il
 * refresh token o manca tutto è la differenza fra due diagnosi diverse.
 *
 * Solo nomi di chiave, mai contenuti: qui dentro non passa nessun token.
 * @returns {{tot: number, rt: number, at: number, id: number}}
 */
function inventarioMsal() {
  const inv = { tot: 0, rt: 0, at: 0, id: 0 };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      // Le credenziali hanno il clientId nel nome; l'entità account no — la
      // sua chiave è `<id>-login.windows.net-<realm>`, e contando solo il
      // clientId restava fuori proprio lei.
      const suaMsal = k.includes(CLIENT_ID) || k.startsWith('msal.')
        || /-login\.(windows|microsoftonline)\./.test(k);
      if (!suaMsal) continue;
      inv.tot++;
      if (k.includes('refreshtoken')) inv.rt++;
      else if (k.includes('accesstoken')) inv.at++;
      else if (k.includes('idtoken')) inv.id++;
    }
  } catch { /* storage non disponibile */ }
  return inv;
}

/** @param {{tot: number, rt: number, at: number, id: number}} inv */
function descriviInventario(inv) {
  return `${inv.tot} chiavi (rt${inv.rt} at${inv.at} id${inv.id})`;
}

/** Quante chiavi in `localStorage` appartengono a MSAL. */
function chiaviMsal() {
  return inventarioMsal().tot;
}

function logAuthRedirect(e, kind = 'silenzioso') {
  try {
    localStorage.setItem(AUTH_DEBUG_KEY, JSON.stringify({
      t: new Date().toISOString(),
      // Quale tentativo è fallito: il rinnovo programmato, una chiamata
      // qualunque, o il controllo all'avvio. Senza, un errore registrato non
      // dice se l'app stava lavorando o dormendo.
      kind,
      errorCode: e?.errorCode || e?.name || null,
      // Il sotto-codice è quello che distingue «il refresh token è scaduto»
      // da «Microsoft vuole rivederti in faccia»: senza, dalla schermata di
      // login si legge sempre e solo `interaction_required`.
      subError: e?.subError || null,
      message: e?.errorMessage || String(e),
      lastOk: localStorage.getItem(AUTH_OK_KEY) || null,
    }));
  } catch { /* storage non disponibile */ }
}

function logAuthOk(forced) {
  try {
    const ora = new Date().toISOString();
    localStorage.setItem(AUTH_OK_KEY, ora);
    if (forced) localStorage.setItem(AUTH_REFRESH_KEY, ora);
  } catch { /* storage non disponibile */ }
}

/** @returns {boolean} true se il lucchetto è nostro e possiamo rinnovare. */
function takeRefreshLock() {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    const t = raw ? Number(raw) : NaN;
    // Un lucchetto vecchio è un lucchetto di una pagina che non c'è più: si
    // scavalca, altrimenti una scheda chiusa a metà rinnovo bloccherebbe le
    // altre per sempre.
    if (Number.isFinite(t) && Date.now() - t < REFRESH_LOCK_TTL) return false;
    localStorage.setItem(REFRESH_LOCK_KEY, String(Date.now()));
    return true;
  } catch {
    // Senza storage non c'è nemmeno il problema delle istanze multiple.
    return true;
  }
}

function releaseRefreshLock() {
  try { localStorage.removeItem(REFRESH_LOCK_KEY); } catch { /* storage non disponibile */ }
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
 *   lastRefresh: string|null, loginAt: string|null, storageAvailable: boolean,
 *   accounts: number, ricordato: boolean, storageFull: string|null,
 *   storageKb: number, msalKeys: number, msalInv: string,
 *   trail: {t: string, e: string}[],
 *   standalone: boolean}}
 */
export function getAuthDiagnostics() {
  let storageAvailable = true;
  let lastOk = null;
  let lastRefresh = null;
  let loginAt = null;
  let ricordato = false;
  let storageFull = null;
  let storageKb = 0;
  /** @type {{t: string, e: string}[]} */
  let trail = [];
  try {
    lastOk = localStorage.getItem(AUTH_OK_KEY);
    lastRefresh = localStorage.getItem(AUTH_REFRESH_KEY);
    loginAt = localStorage.getItem(AUTH_LOGIN_KEY);
    ricordato = !!localStorage.getItem(PERSONAL_ID_KEY);
    storageFull = localStorage.getItem('md_storage_full');
    try { trail = JSON.parse(localStorage.getItem(TRAIL_KEY) || '[]'); } catch { trail = []; }
    // Quanto pesa tutto quello che l'app tiene in `localStorage`. È la stessa
    // dispensa in cui MSAL mette l'account: se è piena, il token appena
    // ruotato non trova posto dove essere scritto, e l'accesso salta.
    let caratteri = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      caratteri += k.length + (localStorage.getItem(k) || '').length;
    }
    storageKb = Math.round(caratteri / 1024);
  } catch {
    storageAvailable = false;
  }
  // Quanti account vede MSAL adesso: è la domanda giusta, e la conta delle
  // chiavi in localStorage non la rispondeva — MSAL lascia lì il suo scheletro
  // (`msal.account.keys` e compagnia) anche dopo aver rimosso l'account, e
  // quello scheletro faceva dire «l'account è ancora in memoria» quando non
  // c'era più.
  const accounts = msal ? msal.getAllAccounts().length : 0;
  return {
    lastError: getLastAuthDebug(),
    lastOk,
    lastRefresh,
    loginAt,
    storageAvailable,
    accounts,
    // Il dispositivo ricorda di aver fatto un accesso: se lo ricorda e MSAL
    // non ha account, l'account è stato rimosso, non è scaduto.
    ricordato,
    // Quando la cache dei dati ha trovato lo spazio finito: è il sospetto
    // numero uno per un account sparito senza errori, perché lo spazio che
    // manca a lei manca anche a MSAL.
    storageFull,
    storageKb,
    msalKeys: chiaviMsal(),
    msalInv: descriviInventario(inventarioMsal()),
    trail,
    // Safari e l'app aperta dall'icona sulla Home hanno due memorie separate:
    // sapere da quale delle due si sta guardando evita di scambiare «devo
    // accedere anche qui» per «la sessione è scaduta».
    standalone: window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches,
  };
}

export async function initAuth() {
  // Fotografia PRIMA di toccare MSAL. È la misura che decide fra le due
  // spiegazioni rimaste per un account che sparisce senza errori: se qui le
  // chiavi ci sono e dopo `initialize()` non ci sono più, è MSAL a fare
  // pulizia all'avvio; se mancano già da qui, sono sparite mentre l'app era
  // chiusa, e allora è il telefono. Finora la conta veniva fatta solo dopo, e
  // le due cose erano indistinguibili.
  const primaDiTutto = inventarioMsal();
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
    // ── Perché qui la versione di MSAL è fissata alla 3 ────────────────────
    //
    // Dalla v4 in poi MSAL non scrive più i token in chiaro in `localStorage`:
    // li **cifra**, e tiene la chiave di cifratura in un *cookie di sessione*
    // (`msal.cache.encryption`, scadenza 0, cioè muore con la sessione del
    // browser). All'avvio, se quel cookie non c'è più, MSAL ne genera uno nuovo
    // con un id nuovo, rilegge la cache, trova dati cifrati con un id diverso e
    // — parole sue — «It must be removed because it is from a previous
    // session»: cancella account e credenziali, in silenzio, prima ancora che
    // l'app possa accorgersene.
    //
    // Su iPhone succede di continuo: `localStorage` sopravvive, ma la sessione
    // del browser finisce ogni volta che iOS chiude l'app aperta dall'icona. Da
    // fuori: «l'accesso è durato quindici minuti», senza un errore, senza una
    // scadenza, senza che nessun rinnovo sia stato tentato.
    //
    // L'unica eccezione prevista sono gli accessi «persistenti», che MSAL
    // riconosce dalla claim `signin_state` dell'id token. Ma quella claim la
    // mette Entra, non gli account Microsoft personali: rispondere «Sì» a
    // «Rimani connesso?» con un account personale non la fa comparire, e la
    // cache resta cifrata comunque. Provato sul telefono: risposto sì, e la
    // sessione è morta lo stesso dopo un quarto d'ora.
    //
    // Sulla 3 il `LocalStorage` di MSAL è un guscio sottile su
    // `window.localStorage`: scrive in chiaro, e l'accesso sopravvive alla
    // chiusura dell'app. La versione è fissata esatta, senza `^`: un
    // aggiornamento a v4 o v5 rimetterebbe in piedi il problema in silenzio,
    // senza che niente smetta di compilare.
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
      traccia(`accesso a mano · ${descriviSigninState(result.account.idTokenClaims)}`);
      // Si è appena tornati da Microsoft: è questo il momento in cui la
      // sessione comincia, ed è da qui che si misura quanto dura.
      try { localStorage.setItem(AUTH_LOGIN_KEY, new Date().toISOString()); } catch { /* storage non disponibile */ }
    }
  } catch (e) {
    console.error('Redirect error:', e);
  }

  // L'account c'era e non c'è più: le nostre chiavi sono ancora qui, quindi la
  // memoria del sito non è stata svuotata — è MSAL che ha rimosso l'account
  // dalla sua cache, cosa che fa quando un riscatto del refresh token torna
  // indietro rifiutato. Senza questa riga la schermata di login compariva
  // muta: nessun rinnovo era stato tentato *in questa pagina*, quindi non
  // c'era niente da registrare.
  const dopoInit = inventarioMsal();
  traccia(`avvio: ${msal.getAllAccounts().length} account · prima ${descriviInventario(primaDiTutto)} · dopo ${descriviInventario(dopoInit)}`);
  try {
    if (localStorage.getItem(PERSONAL_ID_KEY) && msal.getAllAccounts().length === 0) {
      const prima = getLastAuthDebug();
      const ok = localStorage.getItem(AUTH_OK_KEY);
      // Un errore già registrato dopo l'ultima acquisizione riuscita dice più
      // di questo: è quello vero, e non va sovrascritto.
      if (!prima || (ok && prima.t < ok)) {
        logAuthRedirect({ errorCode: 'account_rimosso_dalla_cache', errorMessage: 'MSAL non ha più account, ma il dispositivo ne ricordava uno' }, 'avvio');
      }
    }
  } catch { /* storage non disponibile */ }

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
  // Senza storage non si ricorda niente, e va bene: la sessione dura quanto la
  // scheda. Quello che non va bene è sollevare — questa funzione sta dentro
  // `trySsoSilent`, dove un'eccezione qualunque diventa «nessun account», e un
  // accesso silenzioso perfettamente riuscito veniva buttato via perché non
  // c'era dove annotarlo.
  try {
    localStorage.setItem(PERSONAL_ID_KEY, account.homeAccountId);
    localStorage.setItem(PERSONAL_USERNAME_KEY, account.username);
  } catch { /* navigazione privata, o cookie bloccati */ }
}

/**
 * Com'è messa la claim, non solo il suo verdetto. Serve a non ritrovarsi
 * un'altra volta davanti a «non persistente» senza sapere se la claim dicesse
 * di no o non ci fosse proprio: sugli account Microsoft personali `signin_state`
 * non arriva affatto, ed è una diagnosi diversa da «l'utente ha risposto no».
 * @param {Record<string, unknown>|undefined} claims
 */
function descriviSigninState(claims) {
  const stato = claims?.signin_state;
  if (stato === undefined) return 'signin_state assente';
  if (!Array.isArray(stato)) return `signin_state non è una lista`;
  return `signin_state: ${stato.join(',') || 'vuota'}`;
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

/**
 * Rientra scegliendo l'account a mano. È l'opposto di `login()`: là l'hint
 * serve a saltare lo chooser, qui lo si vuole vedere.
 *
 * Serve perché di account Microsoft ce n'è più d'uno, e ognuno ha il suo
 * OneDrive: entrato con quello sbagliato, l'app funziona benissimo e non
 * trova niente — nessun errore, tutti i riquadri vuoti, che è la diagnosi
 * più difficile di tutte. L'hint ricordato va tolto prima, o riporterebbe
 * dritti all'account da cui si sta cercando di uscire.
 */
export async function cambiaAccount() {
  try {
    localStorage.removeItem(PERSONAL_ID_KEY);
    localStorage.removeItem(PERSONAL_USERNAME_KEY);
  } catch { /* storage non disponibile */ }
  return msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
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

// Quanto si aspetta un'acquisizione di token prima di dichiararla persa.
//
// Serve perché qui sopra c'è una coda: un'acquisizione sola tiene in attesa
// tutte le altre, e tutte le chiamate a Graph aspettano un token. Se
// `acquireTokenSilent` non torna — su Safari succede con l'iframe verso
// Microsoft, che con «Impedisci tracciamento tra siti» può restare appeso —
// non si blocca una richiesta: si blocca l'app intera, in silenzio e per
// sempre. Trenta secondi sono abbondanti per un rinnovo vero; oltre, è
// meglio un errore che un'attesa senza fine.
const TOKEN_TIMEOUT = 30_000;

/**
 * @template T
 * @param {Promise<T>} promessa
 * @param {string} cosa
 * @returns {Promise<T>}
 */
function conScadenza(promessa, cosa) {
  return new Promise((risolvi, rifiuta) => {
    const t = setTimeout(() => {
      traccia(`${cosa}: nessuna risposta entro ${TOKEN_TIMEOUT / 1000}s`);
      rifiuta(new Error(`${cosa}: nessuna risposta entro ${TOKEN_TIMEOUT / 1000}s`));
    }, TOKEN_TIMEOUT);
    promessa.then(
      v => { clearTimeout(t); risolvi(v); },
      e => { clearTimeout(t); rifiuta(e); },
    );
  });
}

/**
 * Access token per Graph, con la sua scadenza vera.
 * @param {boolean} [forceRefresh] ignora la cache MSAL e rinnova davvero
 * @returns {Promise<TokenResult>}
 */
export function getToken(forceRefresh = false) {
  if (forceRefresh) {
    if (inFlightForced) return inFlightForced;
    // La scadenza sta *dentro* la coda, non attorno: è la coda che deve
    // ripartire quando un'acquisizione non torna. Attorno, chi aspetta
    // riceverebbe sì il suo errore, ma il posto in fila resterebbe occupato
    // dall'acquisizione appesa e tutte le successive aspetterebbero lei.
    const p = enqueue(() => conScadenza(acquire(true), 'Rinnovo del token'))
      .finally(() => { if (inFlightForced === p) inFlightForced = null; });
    inFlightForced = p;
    return p;
  }
  if (inFlight) return inFlight;
  const p = enqueue(() => conScadenza(acquire(false), 'Token Microsoft'))
    .finally(() => { if (inFlight === p) inFlight = null; });
  inFlight = p;
  return p;
}

async function acquire(forceRefresh) {
  const account = getAccount();
  if (!account) throw new Error('Non autenticato');
  // Se un'altra istanza dell'app sta già spendendo il refresh token, non se ne
  // spende un secondo: si aspetta che finisca e si legge quello che ha messo
  // nella cache condivisa. Rinnovare in due è il modo più veloce di restare
  // fuori tutti e due.
  let locked = false;
  if (forceRefresh) {
    locked = takeRefreshLock();
    if (!locked) {
      await new Promise(res => setTimeout(res, 3_000));
      forceRefresh = false;
    }
  }
  try {
    const r = await msal.acquireTokenSilent({ scopes: SCOPES, account, forceRefresh });
    return onAcquired(r, forceRefresh);
  } catch (e) {
    // Ogni fallimento va scritto, non solo quelli che chiedono interazione.
    // Prima gli altri uscivano da qui senza lasciare traccia — ed erano
    // proprio quelli, perché è su un `invalid_grant` che MSAL si porta via
    // l'account dalla cache: la schermata di login arrivava senza motivo
    // registrato, che è il caso peggiore da leggere da un telefono.
    logAuthRedirect(e, forceRefresh ? 'rinnovo forzato' : 'silenzioso');
    traccia(`${forceRefresh ? 'rinnovo' : 'token'} fallito: ${e?.errorCode || e?.name || 'ignoto'}`);
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
      return onAcquired(r, true);
    } catch { /* niente da fare in silenzio */ }
    setInteractionRequired(true);
    throw e;
  } finally {
    if (locked) releaseRefreshLock();
  }
}

/**
 * @param {{accessToken: string, expiresOn?: Date|null}} r
 * @param {boolean} [forced] true se il refresh token è stato speso davvero
 * @returns {TokenResult}
 */
function onAcquired(r, forced = false) {
  const expiresOn = r.expiresOn ? r.expiresOn.getTime() : Date.now() + 55 * 60_000;
  setInteractionRequired(false);
  logAuthOk(forced);
  traccia(forced ? 'rinnovo riuscito' : 'token dalla cache');
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
    // Appena avviati non si sa ancora quando scade il token che MSAL ha in
    // cache: `expiresAt` è zero, e la guardia qui sotto lo leggeva come «è
    // scaduto da sempre», forzando un riscatto del refresh token a ogni
    // singolo lancio dell'app. Che è il modo più efficace di perderlo: il
    // refresh token è monouso e ruota, quindi il vecchio muore nell'istante in
    // cui Microsoft emette il nuovo — e se la risposta non torna indietro
    // (pagina sospesa da iOS mentre si guarda altro, rete mobile che cade) il
    // nuovo non viene scritto da nessuna parte. Vecchio morto, nuovo mai
    // arrivato: l'accesso è finito, e nessuno ha visto un errore.
    //
    // Una lettura non forzata invece non spende niente: prende il token dalla
    // cache di MSAL e ci dice quando scade, così la prossima volta la guardia
    // ha un numero vero su cui ragionare.
    if (!expiresAt) { getToken(false).catch(() => {}); return; }
    // Offline il riscatto non può che fallire, e fallire costa: si aspetta il
    // `online`, che è già in ascolto qui sotto.
    if (navigator.onLine === false) return;
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
