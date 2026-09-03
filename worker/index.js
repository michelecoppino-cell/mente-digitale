/**
 * worker/index.js
 * La mente digitale come connettore: lo stesso server MCP, ma in HTTPS.
 *
 * A cosa serve, in una riga: parlare con la propria mente digitale **a voce**,
 * dall'auto. La modalità telefonata dell'app Claude usa i connettori
 * dell'account, cioè server MCP remoti; il server che sta sul computer
 * (`scripts/mente-mcp.mjs`) parla su una pipe e da lì non è raggiungibile — non
 * c'è configurazione che lo renda tale, serve proprio questo.
 *
 * Non sostituisce quello sul computer: convivono. Da tastiera si vuole tutto
 * (OneNote compreso); guidando si vogliono quattordici strumenti che si
 * possono dire a voce. La differenza è una riga qui sotto (`soloDaVoce`) e
 * l'elenco in `mente-mcp-nucleo.mjs`.
 *
 * Qui dentro c'è solo il trasporto e chi può bussare:
 *
 *   worker/oauth.js     la serratura: registrazione, passphrase, token
 *   worker/archivio.js  il refresh token di Microsoft, in KV
 *   scripts/mente-mcp-nucleo.mjs   gli strumenti e il protocollo, condivisi
 *   scripts/mente-comandi.mjs      le operazioni e le regole, condivise
 *
 * Come si mette in piedi: `docs/mente-remoto.md`. Le prove girano senza rete
 * né account: `npm run prova-mcp-remoto`.
 */

import { creaServer, ISTRUZIONI_VOCE } from '../scripts/mente-mcp-nucleo.mjs';
import { impostaArchivioToken } from '../scripts/mente-graph.mjs';
import { archivioSuKv } from './archivio.js';
import {
  json, metadataRisorsa, metadataServer, registraClient,
  mostraAutorizza, verificaAutorizza, scambiaToken, bearerValido,
} from './oauth.js';

const server = creaServer({ soloDaVoce: true, istruzioni: ISTRUZIONI_VOCE });

// L'archivio si monta una volta per istanza, non a ogni richiesta: rimontarlo
// butterebbe la cache dell'access token che l'istanza ha in mano.
let montato = false;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const origine = url.origin;
    const percorso = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (!montato) {
      impostaArchivioToken(archivioSuKv(env));
      montato = true;
    }

    // I due documenti che il client legge da solo per capire come entrare.
    // Si rispondono anche col percorso della risorsa in coda
    // (/.well-known/…/mcp): la specifica lo prevede e i client lo provano.
    if (request.method === 'GET' && percorso.startsWith('/.well-known/oauth-protected-resource')) {
      return metadataRisorsa(origine);
    }
    if (request.method === 'GET' && percorso.startsWith('/.well-known/oauth-authorization-server')) {
      return metadataServer(origine);
    }

    if (percorso === '/register' && request.method === 'POST') return registraClient(request, env);
    if (percorso === '/authorize' && request.method === 'GET') return mostraAutorizza(url, env);
    if (percorso === '/authorize' && request.method === 'POST') return verificaAutorizza(request, env);
    if (percorso === '/token' && request.method === 'POST') return scambiaToken(request, env);

    if (percorso === '/mcp') {
      // Niente flusso di eventi: le risposte sono una per richiesta, e un
      // canale aperto non servirebbe a niente — nessuno strumento manda
      // notifiche di sua iniziativa.
      if (request.method !== 'POST') {
        return new Response('Solo POST.', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
      }
      if (!await bearerValido(request, env)) return nonAutorizzato(origine);
      return chiamata(request);
    }

    if (percorso === '/') {
      return new Response(
        'Mente digitale — connettore MCP.\n' +
        'Non è una pagina da guardare: è un connettore da aggiungere a Claude.\n' +
        `Endpoint: ${origine}/mcp\n`,
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    return new Response('Non c\'è niente qui.', { status: 404, headers: CORS });
  },
};

/**
 * Il 401 che avvia tutto: dice dove sono scritte le regole per entrare, e i
 * client MCP sanno leggerlo. Senza questo header il connettore non saprebbe
 * nemmeno da che parte cominciare.
 * @param {string} origine
 */
function nonAutorizzato(origine) {
  return json({ error: 'unauthorized' }, 401, {
    ...CORS,
    'WWW-Authenticate':
      `Bearer realm="mente-digitale", resource_metadata="${origine}/.well-known/oauth-protected-resource"`,
  });
}

/**
 * Un messaggio JSON-RPC dentro, uno fuori. Le notifiche non hanno risposta e
 * si chiudono con un 202: il protocollo lo prevede, e un corpo vuoto con 200
 * confonde alcuni client.
 * @param {Request} request
 */
async function chiamata(request) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON non valido' } }, 400, CORS);
  }

  // Il batch è uscito dalla specifica, ma un client che lo manda ancora non
  // deve trovare un muro: costa tre righe.
  if (Array.isArray(corpo)) {
    const esiti = (await Promise.all(corpo.map(m => server.rispondi(m)))).filter(Boolean);
    return esiti.length ? json(esiti, 200, CORS) : new Response(null, { status: 202, headers: CORS });
  }

  const msg = await server.rispondi(corpo);
  return msg ? json(msg, 200, CORS) : new Response(null, { status: 202, headers: CORS });
}
