/**
 * mente-mcp.mjs
 * La mente digitale come server MCP (Model Context Protocol), su stdio.
 *
 * Espone le stesse operazioni di `mente.mjs` come strumenti che un client —
 * Claude Code, l'app desktop — può chiamare da solo durante una conversazione.
 * La differenza con la riga di comando è solo l'involucro: le operazioni, e le
 * regole su cosa si può scrivere, stanno in `mente-comandi.mjs`.
 *
 * Da qui escono tutti e ventuno gli strumenti, OneNote compreso: questo è il
 * modo di lavorare dal computer, seduti, con lo schermo davanti. Il connettore
 * remoto (`worker/`) ne espone quattordici, perché serve a un altro uso — vedi
 * NOMI_DA_VOCE in `mente-mcp-nucleo.mjs`.
 *
 * Parla JSON-RPC 2.0 su stdio, un messaggio per riga. Il protocollo è
 * implementato a mano — sono un centinaio di righe, e il progetto non ha
 * dipendenze: non è il caso di aggiungerne una per un handshake e tre metodi.
 * Sta in `mente-mcp-nucleo.mjs`, insieme agli strumenti, perché lo stesso
 * server risponde anche in HTTPS: qui resta solo come i messaggi entrano ed
 * escono.
 *
 * Il client lo avvia e lo chiude: non è un servizio che resta acceso.
 *
 *   node scripts/mente-mcp.mjs        (non si lancia a mano: lo lancia il client)
 *
 * Nessuna dipendenza, Node 18+.
 */

import { createInterface } from 'readline';
import { creaServer } from './mente-mcp-nucleo.mjs';
import { impostaArchivioToken } from './mente-graph.mjs';
import { archivioSuFile } from './mente-token-file.mjs';

// Il token sta sul disco di questa macchina, accanto agli script. Il server lo
// cerca lì e non nella cartella di lavoro: il client avvia il processo dalla
// cartella che gli pare.
impostaArchivioToken(archivioSuFile());

const { rispondi } = creaServer();

// ── Avvio ────────────────────────────────────────────────────────────────────
// Un messaggio per riga su stdin. Su stdout esce solo JSON-RPC: qualunque
// diagnostica va su stderr, o il client non riesce più a leggere il flusso.

/** @param {any} msg */
const invia = msg => process.stdout.write(JSON.stringify(msg) + '\n');

const rl = createInterface({ input: process.stdin });

rl.on('line', line => {
  const riga = line.trim();
  if (!riga) return;
  let req;
  try {
    req = JSON.parse(riga);
  } catch {
    return invia({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'JSON non valido' } });
  }
  rispondi(req)
    .then(msg => { if (msg) invia(msg); })
    .catch(e => {
      console.error('[mente-mcp]', e);
      if (req?.id !== undefined && req?.id !== null) {
        invia({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: e.message } });
      }
    });
});

rl.on('close', () => process.exit(0));
