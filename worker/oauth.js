/**
 * worker/oauth.js
 * Chi può parlare col connettore.
 *
 * Un server MCP remoto sta su internet, e su internet ci arriva chiunque: qui
 * dietro c'è il OneDrive personale, quindi la porta ha una serratura. La
 * serratura che i connettori di Claude sanno aprire è OAuth 2.1 nella forma
 * che la specifica MCP descrive, ed è quella che c'è qui — scritta a mano,
 * come il resto del progetto, perché sono tre endpoint e un paio di hash.
 *
 * Il giro, per intero:
 *
 *   1. Claude chiama /mcp senza credenziali e riceve un 401 che dice dove sono
 *      scritte le regole (`WWW-Authenticate`);
 *   2. legge i due documenti in /.well-known/ e scopre chi rilascia i permessi;
 *   3. si registra da solo (/register) — non c'è nessun client ID da incollare
 *      a mano da nessuna parte;
 *   4. apre /authorize nel browser: una pagina, un campo, la passphrase. È
 *      l'unico momento in cui una persona deve fare qualcosa, e succede una
 *      volta sola;
 *   5. scambia il codice per un token (/token, con PKCE), e da lì in poi ogni
 *      chiamata a /mcp porta quel token.
 *
 * Un dettaglio che non è pignoleria: i token non si salvano in chiaro, si
 * salva il loro SHA-256. Chi leggesse l'archivio non troverebbe niente da
 * riusare — e l'archivio è il posto in cui vive già la chiave del OneDrive.
 */

// ── Durate ───────────────────────────────────────────────────────────────────
// Il codice dura un minuto perché è solo un passaggio di mano. L'access token
// un'ora, come quello di Microsoft. Il refresh del connettore tre mesi: è la
// cosa che evita di rifare il login dal telefono ogni settimana.
const VITA_CODICE = 60;
const VITA_ACCESSO = 3600;
const VITA_REFRESH = 90 * 24 * 3600;

/** Quanti tentativi sbagliati di passphrase, e per quanto si resta chiusi. */
const TENTATIVI_MAX = 8;
const FINESTRA_TENTATIVI = 900;

const K_TENTATIVI = 'auth:tentativi';

// ── Cose piccole ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();

/** @param {ArrayBuffer|Uint8Array} buf */
function base64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Una stringa casuale che non si indovina. @param {number} [byte] */
function casuale(byte = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byte)));
}

/** @param {string} testo @returns {Promise<string>} */
async function sha256(testo) {
  return base64url(await crypto.subtle.digest('SHA-256', enc.encode(testo)));
}

/**
 * Confronto che non racconta quanto si è arrivati vicini. Con una passphrase
 * corta il tempo di un confronto normale è un'informazione, e regalarla non
 * costa niente a chi attacca.
 * @param {string} a @param {string} b
 */
function ugualiACiechi(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** @param {any} corpo @param {number} [status] @param {Record<string,string>} [headers] */
export const json = (corpo, status = 200, headers = {}) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers },
});

// ── I due documenti che Claude legge da solo ─────────────────────────────────

/** @param {string} origine */
export const metadataRisorsa = origine => json({
  resource: `${origine}/mcp`,
  authorization_servers: [origine],
  scopes_supported: ['mente'],
  bearer_methods_supported: ['header'],
});

/** @param {string} origine */
export const metadataServer = origine => json({
  issuer: origine,
  authorization_endpoint: `${origine}/authorize`,
  token_endpoint: `${origine}/token`,
  registration_endpoint: `${origine}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['mente'],
});

// ── Registrazione del client ─────────────────────────────────────────────────

/**
 * Registrazione dinamica (RFC 7591): il client si presenta e riceve un id.
 * Non c'è un segreto perché non c'è un posto sicuro dove un'app terza lo
 * terrebbe: è un client pubblico, e a difendere il giro c'è PKCE.
 * @param {Request} req @param {any} env
 */
export async function registraClient(req, env) {
  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'JSON non valido' }, 400);
  }

  const redirect_uris = Array.isArray(corpo?.redirect_uris) ? corpo.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!redirect_uris.length) {
    return json({ error: 'invalid_redirect_uri', error_description: 'Serve almeno un redirect_uri' }, 400);
  }

  const client_id = casuale(16);
  await env.MENTE.put(`oauth:client:${client_id}`, JSON.stringify({
    redirect_uris,
    client_name: typeof corpo.client_name === 'string' ? corpo.client_name.slice(0, 120) : 'sconosciuto',
    registrato: new Date().toISOString(),
  }));

  return json({
    client_id,
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, 201);
}

// ── La pagina con il campo ───────────────────────────────────────────────────

/** @param {URLSearchParams} p @param {string} [avviso] */
function paginaAutorizza(p, avviso) {
  const nascosti = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .filter(k => p.get(k))
    .map(k => `<input type="hidden" name="${k}" value="${escapeHtml(p.get(k) || '')}">`)
    .join('\n    ');

  return new Response(`<!doctype html>
<html lang="it"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mente digitale</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100dvh; padding: 24px; }
  form { width: min(360px, 100%); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 20px; opacity: .7; font-size: 14px; }
  input[type=password] { width: 100%; padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid #8888; background: transparent; color: inherit; box-sizing: border-box; }
  button { width: 100%; margin-top: 12px; padding: 12px; font-size: 16px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; }
  .avviso { color: #dc2626; font-size: 14px; margin: 12px 0 0; }
</style>
</head><body>
  <form method="post" action="/authorize">
    <h1>Mente digitale</h1>
    <p>Collega questo account Claude alla tua mente digitale.</p>
    ${nascosti}
    <input type="password" name="passphrase" placeholder="Passphrase" autofocus autocomplete="current-password" required>
    <button type="submit">Collega</button>
    ${avviso ? `<p class="avviso">${escapeHtml(avviso)}</p>` : ''}
  </form>
</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * GET /authorize — mostra la pagina, dopo aver controllato che la richiesta
 * abbia senso. Gli errori sui parametri si mostrano qui e non si rimandano
 * indietro: un redirect_uri che non conosciamo è esattamente ciò da cui
 * bisogna guardarsi.
 * @param {URL} url @param {any} env
 */
export async function mostraAutorizza(url, env) {
  const p = url.searchParams;
  const problema = await controllaRichiesta(p, env);
  if (problema) return new Response(problema, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return paginaAutorizza(p);
}

/** @param {URLSearchParams} p @param {any} env @returns {Promise<string|null>} */
async function controllaRichiesta(p, env) {
  if (p.get('response_type') !== 'code') return 'response_type non supportato: serve "code".';
  if (p.get('code_challenge_method') !== 'S256') return 'PKCE obbligatorio, e solo con S256.';
  if (!p.get('code_challenge')) return 'Manca code_challenge.';

  const clientId = p.get('client_id') || '';
  const grezzo = await env.MENTE.get(`oauth:client:${clientId}`);
  if (!grezzo) return 'client_id sconosciuto: registra il client prima (/register).';

  const redirect = p.get('redirect_uri') || '';
  const { redirect_uris } = JSON.parse(grezzo);
  if (!redirect_uris.includes(redirect)) return 'redirect_uri non è fra quelli registrati da questo client.';

  return null;
}

/**
 * POST /authorize — la passphrase. Giusta: un codice, e si torna da Claude.
 * @param {Request} req @param {any} env
 */
export async function verificaAutorizza(req, env) {
  const form = new URLSearchParams(await req.text());
  const problema = await controllaRichiesta(form, env);
  if (problema) return new Response(problema, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const tentativi = Number(await env.MENTE.get(K_TENTATIVI)) || 0;
  if (tentativi >= TENTATIVI_MAX) {
    return new Response('Troppi tentativi. Riprova fra un quarto d\'ora.', { status: 429 });
  }

  const attesa = env.MENTE_PASSPHRASE;
  if (!attesa) return new Response('Il Worker non ha una passphrase: npx wrangler secret put MENTE_PASSPHRASE', { status: 500 });

  if (!ugualiACiechi(form.get('passphrase') || '', attesa)) {
    await env.MENTE.put(K_TENTATIVI, String(tentativi + 1), { expirationTtl: FINESTRA_TENTATIVI });
    return paginaAutorizza(form, 'Passphrase sbagliata.');
  }
  await env.MENTE.delete(K_TENTATIVI);

  const codice = casuale();
  await env.MENTE.put(`oauth:code:${await sha256(codice)}`, JSON.stringify({
    clientId: form.get('client_id'),
    redirectUri: form.get('redirect_uri'),
    challenge: form.get('code_challenge'),
    resource: form.get('resource') || null,
  }), { expirationTtl: VITA_CODICE });

  const destinazione = new URL(form.get('redirect_uri') || '');
  destinazione.searchParams.set('code', codice);
  if (form.get('state')) destinazione.searchParams.set('state', form.get('state') || '');
  return Response.redirect(destinazione.toString(), 302);
}

// ── I token ──────────────────────────────────────────────────────────────────

/** @param {any} env @param {string} clientId */
async function coppiaDiToken(env, clientId) {
  const accesso = casuale();
  const refresh = casuale();
  const dati = JSON.stringify({ clientId });

  await env.MENTE.put(`oauth:tok:${await sha256(accesso)}`, dati, { expirationTtl: VITA_ACCESSO });
  await env.MENTE.put(`oauth:ref:${await sha256(refresh)}`, dati, { expirationTtl: VITA_REFRESH });

  return json({
    access_token: accesso,
    token_type: 'Bearer',
    expires_in: VITA_ACCESSO,
    refresh_token: refresh,
    scope: 'mente',
  }, 200, { 'Cache-Control': 'no-store' });
}

/**
 * POST /token — il codice diventa un token, o il refresh ne rinnova uno.
 *
 * Il refresh del connettore **non** ruota, ed è una scelta: KV impiega un
 * attimo a propagare una scrittura, e un token che cambia a ogni rinnovo su
 * un archivio così finisce per rifiutare il proprietario. Quello che ruota, e
 * che quindi va custodito con cura, è il refresh token *di Microsoft* — un
 * piano più sotto, in `archivio.js`.
 * @param {Request} req @param {any} env
 */
export async function scambiaToken(req, env) {
  const form = new URLSearchParams(await req.text());
  const tipo = form.get('grant_type');

  if (tipo === 'refresh_token') {
    const chiave = `oauth:ref:${await sha256(form.get('refresh_token') || '')}`;
    const grezzo = await env.MENTE.get(chiave);
    if (!grezzo) return json({ error: 'invalid_grant', error_description: 'Refresh token sconosciuto o scaduto' }, 400);
    return coppiaDiToken(env, JSON.parse(grezzo).clientId);
  }

  if (tipo !== 'authorization_code') {
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  const chiave = `oauth:code:${await sha256(form.get('code') || '')}`;
  const grezzo = await env.MENTE.get(chiave);
  if (!grezzo) return json({ error: 'invalid_grant', error_description: 'Codice sconosciuto o scaduto' }, 400);

  // Un codice vale una volta sola: se ne arrivano due, il secondo è qualcuno
  // che l'ha intercettato.
  await env.MENTE.delete(chiave);

  const { clientId, redirectUri, challenge } = JSON.parse(grezzo);
  if (form.get('client_id') !== clientId) {
    return json({ error: 'invalid_grant', error_description: 'Il codice non è di questo client' }, 400);
  }
  if (form.get('redirect_uri') && form.get('redirect_uri') !== redirectUri) {
    return json({ error: 'invalid_grant', error_description: 'redirect_uri diverso da quello dell\'autorizzazione' }, 400);
  }
  if (await sha256(form.get('code_verifier') || '') !== challenge) {
    return json({ error: 'invalid_grant', error_description: 'PKCE non torna' }, 400);
  }

  return coppiaDiToken(env, clientId);
}

// ── La guardia davanti a /mcp ────────────────────────────────────────────────

/**
 * Il token che accompagna una chiamata al connettore è buono?
 *
 * Oltre ai token del giro OAuth se ne accetta uno statico, se il Worker ne ha
 * uno (`MENTE_BEARER`). Non è pigrizia: il flusso dei connettori
 * personalizzati ha avuto e ha inciampi noti, e senza questa via di scampo un
 * problema dall'altra parte lascerebbe il connettore inutilizzabile senza
 * niente da fare. Se il secret non c'è, questa strada non esiste.
 * @param {Request} req @param {any} env
 */
export async function bearerValido(req, env) {
  const header = req.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;
  if (env.MENTE_BEARER && ugualiACiechi(token, env.MENTE_BEARER)) return true;
  return Boolean(await env.MENTE.get(`oauth:tok:${await sha256(token)}`));
}
