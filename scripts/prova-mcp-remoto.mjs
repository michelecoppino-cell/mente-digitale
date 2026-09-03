// Prova del connettore remoto (`worker/`) senza rete e senza account.
//
//   npm run prova-mcp-remoto
//
// Contro il vero questo si può provare solo dopo averlo pubblicato, e il primo
// che se ne accorgerebbe sarebbe il telefono in autostrada. Qui invece gira
// tutto: il Worker è un modulo che esporta `fetch(request, env)`, e Node ha
// Request/Response — sotto ci sono il finto OneDrive di `src/finto/` e un KV
// in memoria, e il giro OAuth si fa per intero come lo farebbe Claude.
//
// Le cose che questa prova esiste per non far succedere:
//  - il connettore si apre senza credenziali;
//  - il 401 non dice dove sono le regole, e nessun client riesce a entrare;
//  - un codice si può usare due volte, o senza il verifier di PKCE;
//  - OneNote esce di casa da una porta che doveva esporre altro;
//  - il refresh token di Microsoft ruota e il nuovo non viene salvato — che è
//    il modo di perdere l'accesso in silenzio, qualche settimana dopo.

import { montaFintoOnedrive, creaTabellone } from './finto-onedrive.mjs';
import { montaFintoGraph } from '../src/finto/graph.js';
import { TOOLS, NOMI_DA_VOCE } from './mente-mcp-nucleo.mjs';
import { impostaArchivioToken } from './mente-graph.mjs';
import { archivioSuKv } from '../worker/archivio.js';

const { verifica, fine } = creaTabellone();

// ── La scena ─────────────────────────────────────────────────────────────────

const finto = montaFintoOnedrive();
montaFintoGraph(finto);   // liste, attività, piani e calendario già dentro

// L'endpoint dei token di Microsoft: risponde a chi ha il token buono e
// ruota, come fa il vero. Quale sia «il buono» lo decide la prova, per poter
// mettere in scena anche il token stantio.
let tokenBuoni = new Set(['finto-refresh-token']);
let ruotatoIn = 'finto-refresh-token-2';
finto.aggiungiRotta((url, opzioni, risposta) => {
  if (!url.includes('login.microsoftonline.com')) return null;
  const corpo = new URLSearchParams(String(opzioni?.body || ''));
  if (!tokenBuoni.has(corpo.get('refresh_token') || '')) {
    return risposta(400, { error: 'invalid_grant', error_description: 'token già usato' });
  }
  return risposta(200, {
    access_token: 'finto-access-token',
    refresh_token: ruotatoIn,
    expires_in: 3600,
  });
});

/** Un KV in memoria che si comporta come quello di Cloudflare per quel che ci serve. */
function kvFinto() {
  /** @type {Map<string, { testo: string, scade: number }>} */
  const m = new Map();
  return {
    async get(chiave) {
      const v = m.get(chiave);
      if (!v) return null;
      if (v.scade && Date.now() > v.scade) { m.delete(chiave); return null; }
      return v.testo;
    },
    async put(chiave, testo, opzioni) {
      m.set(chiave, { testo, scade: opzioni?.expirationTtl ? Date.now() + opzioni.expirationTtl * 1000 : 0 });
    },
    async delete(chiave) { m.delete(chiave); },
    _mappa: m,
  };
}

const kv = kvFinto();
const env = {
  MENTE: kv,
  MENTE_REFRESH_TOKEN: 'finto-refresh-token',
  MENTE_PASSPHRASE: 'apriti sesamo per favore',
};

const worker = (await import('../worker/index.js')).default;

const ORIGINE = 'https://mente.example.workers.dev';
/** @param {string} percorso @param {RequestInit} [init] */
const chiedi = (percorso, init) => worker.fetch(new Request(ORIGINE + percorso, init), env);

/** @param {string} percorso @param {any} corpo @param {string} [bearer] */
const rpc = async (percorso, corpo, bearer) => chiedi(percorso, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(corpo),
});

// ── La porta è chiusa ────────────────────────────────────────────────────────

console.log('\nLa porta, e come si dice dov\'è la chiave\n');

{
  const r = await rpc('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  verifica(r.status === 401, 'senza token il connettore risponde 401');
  const sfida = r.headers.get('WWW-Authenticate') || '';
  verifica(
    sfida.includes(`${ORIGINE}/.well-known/oauth-protected-resource`),
    'e il 401 dice dove stanno scritte le regole per entrare'
  );
}

{
  const r = await rpc('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'un-token-inventato');
  verifica(r.status === 401, 'un token inventato non apre niente');
}

{
  const risorsa = await (await chiedi('/.well-known/oauth-protected-resource')).json();
  const server = await (await chiedi('/.well-known/oauth-authorization-server')).json();
  verifica(risorsa.resource === `${ORIGINE}/mcp`, 'il documento della risorsa nomina /mcp');
  verifica(risorsa.authorization_servers[0] === ORIGINE, 'e rimanda a chi rilascia i permessi');
  verifica(server.token_endpoint === `${ORIGINE}/token`, 'il documento del server nomina /token');
  verifica(
    server.code_challenge_methods_supported.includes('S256'),
    'e chiede PKCE con S256'
  );
  // I client provano anche il percorso con la risorsa in coda.
  const inCoda = await chiedi('/.well-known/oauth-authorization-server/mcp');
  verifica(inCoda.status === 200, 'i documenti rispondono anche col percorso della risorsa in coda');
}

// ── Il giro intero, come lo fa Claude ────────────────────────────────────────

console.log('\nCollegare il connettore\n');

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const registrazione = await (await chiedi('/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Claude' }),
})).json();
verifica(Boolean(registrazione.client_id), 'il client si registra da sé e riceve un id');

// PKCE: il verifier resta dal client, del challenge non si torna indietro.
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = 'un-verifier-lungo-abbastanza-da-non-indovinarsi';
const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));

const parametri = new URLSearchParams({
  response_type: 'code',
  client_id: registrazione.client_id,
  redirect_uri: REDIRECT,
  state: 'stato-di-claude',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: `${ORIGINE}/mcp`,
});

{
  const r = await chiedi(`/authorize?${parametri}`);
  verifica(r.status === 200, 'la pagina della passphrase si apre');
  const html = await r.text();
  verifica(html.includes('name="passphrase"'), 'e ha un campo solo');
  verifica(html.includes(challenge), 'e si porta dietro il challenge di PKCE');
}

{
  const brutto = new URLSearchParams(parametri);
  brutto.set('redirect_uri', 'https://qualcun-altro.example/prendi');
  const r = await chiedi(`/authorize?${brutto}`);
  verifica(r.status === 400, 'un redirect_uri che il client non ha registrato viene rifiutato');
}

/** @param {string} passphrase */
const provaPassphrase = passphrase => chiedi('/authorize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ...Object.fromEntries(parametri), passphrase }).toString(),
});

{
  const r = await provaPassphrase('sbagliata');
  verifica(r.status === 200 && !r.headers.get('Location'), 'la passphrase sbagliata non porta da nessuna parte');
  verifica((await r.text()).includes('sbagliata'), 'e lo dice');
}

/** Una passphrase giusta, un codice nuovo. @returns {Promise<string>} */
async function codiceNuovo(annuncia = false) {
  const r = await provaPassphrase(env.MENTE_PASSPHRASE);
  if (annuncia) {
    verifica(r.status === 302, 'quella giusta riporta indietro da Claude');
    const d = new URL(r.headers.get('Location') || '');
    verifica(d.origin + d.pathname === REDIRECT, 'sul redirect_uri registrato');
    verifica(d.searchParams.get('state') === 'stato-di-claude', 'con lo state che era arrivato');
  }
  return new URL(r.headers.get('Location') || '').searchParams.get('code') || '';
}

const codice = await codiceNuovo(true);
verifica(Boolean(codice), 'e con un codice in mano');

/** @param {string} code @param {Record<string,string>} extra */
const scambia = (code, extra) => chiedi('/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: registrazione.client_id,
    redirect_uri: REDIRECT,
    ...extra,
  }).toString(),
});

{
  // Un codice a testa: il primo tentativo sbagliato brucia il suo, ed è
  // voluto — un verifier che non torna vuol dire che quel codice è in mano a
  // qualcun altro, e da lì in poi non deve valere più niente.
  const sacrificabile = await codiceNuovo();
  const r = await scambia(sacrificabile, { code_verifier: 'un-verifier-qualsiasi' });
  verifica(r.status === 400, 'senza il verifier giusto il codice non vale niente');
  const ancora = await scambia(sacrificabile, { code_verifier: verifier });
  verifica(ancora.status === 400, 'e dopo un tentativo sbagliato quel codice è bruciato');
}

const gettoni = await (await scambia(codice, { code_verifier: verifier })).json();
verifica(Boolean(gettoni.access_token), 'col verifier giusto arriva un access token');
verifica(Boolean(gettoni.refresh_token), 'e un refresh token per non rifare il login ogni volta');

{
  const r = await scambia(codice, { code_verifier: verifier });
  verifica(r.status === 400, 'lo stesso codice non si usa due volte');
}

{
  const rinnovo = await (await chiedi('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: gettoni.refresh_token,
      client_id: registrazione.client_id,
    }).toString(),
  })).json();
  verifica(Boolean(rinnovo.access_token), 'il refresh token rinnova l\'accesso');
}

// ── Dentro: gli strumenti ────────────────────────────────────────────────────

console.log('\nQuello che si può fare parlando\n');

{
  const r = await rpc('/mcp', {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' },
  }, gettoni.access_token);
  const { result } = await r.json();
  verifica(result.serverInfo.name === 'mente-digitale', 'l\'handshake risponde');
  verifica(
    /voce|parlando|auto/i.test(result.instructions),
    'e le istruzioni sono quelle di chi risponderà a voce'
  );
}

const nomiRemoti = await (async () => {
  const { result } = await (await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, gettoni.access_token)).json();
  return result.tools.map(t => t.name);
})();

verifica(nomiRemoti.length === NOMI_DA_VOCE.length, `dal connettore escono ${NOMI_DA_VOCE.length} strumenti`);
verifica(
  NOMI_DA_VOCE.every(n => TOOLS.some(t => t.name === n)),
  'ogni nome dell\'elenco da voce è uno strumento che esiste davvero'
);
verifica(TOOLS.length > NOMI_DA_VOCE.length, 'e dal computer ce ne sono di più');
verifica(
  !nomiRemoti.some(n => n.startsWith('note_')),
  'OneNote non esce di casa'
);
verifica(
  !nomiRemoti.includes('obiettivi_scrivi') && !nomiRemoti.includes('diario_leggi'),
  'e nemmeno gli obiettivi da riscrivere o il diario da rileggere'
);

{
  const { result } = await (await rpc('/mcp', {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_leggi', arguments: { pagina: 'x' } },
  }, gettoni.access_token)).json();
  verifica(result === undefined, 'chiamare uno strumento che non è esposto è un errore, non un\'esecuzione');
}

{
  const { result } = await (await rpc('/mcp', {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'oggi', arguments: {} },
  }, gettoni.access_token)).json();
  verifica(!result.isError, 'lo strumento «oggi» risponde');
  verifica(typeof result.structuredContent?.data === 'string', 'e dice di che giorno parla');
}

{
  const titolo = 'Richiamare il committente';
  const { result } = await (await rpc('/mcp', {
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'attivita_crea', arguments: { titolo, stima: 15 } },
  }, gettoni.access_token)).json();
  verifica(!result.isError, 'un\'attività dettata a voce si crea');
  // Senza sezione va nell'Inbox, che è *la lista* di default — non uno stato.
  const registro = finto.contenuto('task/_liste.json');
  const inbox = registro.liste.find(l => l.inbox) || registro.liste[0];
  const dentro = finto.contenuto(inbox.file);
  verifica(
    dentro.tasks.some(t => t.titolo === titolo),
    'e finisce nel file su OneDrive, dove la trova anche l\'app'
  );
}

// ── Il token di Microsoft, che ruota ─────────────────────────────────────────

console.log('\nLa chiave che cambia a ogni giro\n');

verifica(await kv.get('ms:refresh') === ruotatoIn, 'il refresh token ruotato viene salvato in KV');
verifica(Boolean(await kv.get('ms:access')), 'e l\'access token si tiene, per non riscattarlo a ogni richiesta');

{
  // Un'istanza ha scritto un attimo fa e questa legge ancora il vecchio: è il
  // caso che KV rende possibile, e che senza rete di sicurezza costa l'accesso.
  await kv.delete('ms:access');
  await kv.put('ms:refresh', 'token-che-un-altra-istanza-ha-gia-bruciato');
  await kv.put('ms:refresh:prec', 'finto-refresh-token');
  tokenBuoni = new Set(['finto-refresh-token']);
  ruotatoIn = 'finto-refresh-token-3';
  impostaArchivioToken(archivioSuKv(env));   // scorda l'access token in memoria

  const { result } = await (await rpc('/mcp', {
    jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'sezioni', arguments: {} },
  }, gettoni.access_token)).json();
  verifica(!result.isError, 'con un token stantio si riprova con quello di prima, e la richiesta passa');
  verifica(await kv.get('ms:refresh') === 'finto-refresh-token-3', 'e il token nuovo prende il posto suo');
}


// ── Quello che finirebbe nel pacchetto ───────────────────────────────────────
// Il Worker non gira su Node: niente `fs`, niente `process`, e nessuna
// libreria del browser. Sono cose che non si scoprono provando il codice — si
// scoprono al `wrangler deploy`, o peggio dopo, con un errore che non nomina
// il file che l'ha causato. Qui si cammina il grafo degli import come lo
// camminerebbe chi costruisce il pacchetto, e si guarda cosa c'è dentro.

console.log('\nQuello che finirebbe nel pacchetto\n');

{
  const { readFileSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');

  const visti = new Set();
  /** @type {string[]} */
  const guai = [];
  /** @type {string[]} */
  const daFuori = [];

  /** @param {string} file */
  function cammina(file) {
    const p = resolve(file);
    if (visti.has(p)) return;
    visti.add(p);
    const testo = readFileSync(p, 'utf8');
    const breve = p.slice(p.indexOf('/mente-digitale/') + 16);

    // Statici e a richiesta: chi costruisce il pacchetto segue tutti e due.
    for (const m of testo.matchAll(/(?:^import[^;]*?from|^import|import\()\s*'([^']+)'/gm)) {
      const rif = m[1];
      if (!rif.startsWith('.')) { daFuori.push(`${breve} → ${rif}`); continue; }
      let candidato = join(dirname(p), rif);
      if (!/\.(js|mjs)$/.test(candidato)) candidato += '.js';
      cammina(candidato);
    }
    for (const m of testo.matchAll(/\bprocess\.[a-zA-Z]/g)) guai.push(`${breve}: usa ${m[0]}…`);
  }

  cammina('worker/index.js');

  verifica(guai.length === 0, `nessun modulo del connettore tocca Node${guai.length ? ': ' + guai.join(', ') : ''}`);

  // L'unico import di libreria che si incontra è quello del login del browser,
  // su un ramo che qui non si esegue: deve essere spento nel wrangler.toml.
  const wrangler = readFileSync('worker/wrangler.toml', 'utf8');
  const nonSpenti = daFuori.filter(r => !wrangler.includes(`"${r.split(' → ')[1]}" = `));
  verifica(
    nonSpenti.length === 0,
    `ogni libreria sulla strada del connettore è aliasata via${nonSpenti.length ? ': manca ' + nonSpenti.join(', ') : ''}`
  );
}

fine();
