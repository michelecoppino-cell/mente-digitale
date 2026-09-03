/**
 * worker/archivio.js
 * Il refresh token Microsoft custodito in KV, per il connettore remoto.
 *
 * È l'altra faccia di `scripts/mente-token-file.mjs`: stessa forma
 * (`ArchivioToken` in `mente-graph.mjs`), un posto diverso in cui tenere la
 * chiave. Sul computer è un file accanto agli script; qui è una voce in un
 * archivio chiave-valore, perché un Worker non ha un disco.
 *
 * Due cose che qui vanno pensate e sul disco no.
 *
 * **KV non è immediatamente coerente.** Una scrittura può metterci fino a un
 * minuto a essere vista da tutti, e il refresh token Microsoft *ruota a ogni
 * uso*: due richieste ravvicinate possono leggere lo stesso token, riscattarlo
 * due volte, e la seconda si sente rispondere `invalid_grant` — cioè
 * l'accesso sparisce, e non torna da solo. Per questo il token di prima non si
 * butta (`ms:refresh:prec`): Microsoft lo accetta ancora per una breve
 * finestra di grazia, e `getAccessToken` ci riprova una volta prima di
 * arrendersi.
 *
 * **L'access token si tiene.** Ogni richiesta può trovare un'istanza nuova del
 * Worker, e senza una cache condivisa si riscatterebbe il refresh token a ogni
 * domanda fatta a voce: decine di rotazioni al giorno, cioè decine di
 * occasioni di perderlo. Con la cache si riscatta una volta all'ora scarsa.
 *
 * Il token vive qui e non sul tuo computer: è il prezzo dichiarato di avere un
 * connettore raggiungibile mentre guidi. Per questo ne vuole uno suo, con meno
 * scope degli altri — `node scripts/get-refresh-token.mjs --remoto`.
 */

import { MENTE_SCOPE_REMOTO } from '../scripts/mente-graph.mjs';

const K_REFRESH = 'ms:refresh';
const K_PRECEDENTE = 'ms:refresh:prec';
const K_ACCESSO = 'ms:access';

/** Il minimo che Cloudflare KV accetta come scadenza. */
const TTL_MINIMO = 60;

/**
 * L'archivio chiave-valore, per quel poco che ce ne serve. Scritto qui invece
 * di tirarsi dietro i tipi di Cloudflare: sono tre metodi, e il progetto non
 * ha dipendenze.
 * @typedef {object} ArchivioKv
 * @property {(chiave: string) => Promise<string|null>} get
 * @property {(chiave: string, valore: string, opzioni?: { expirationTtl?: number }) => Promise<void>} put
 * @property {(chiave: string) => Promise<void>} delete
 */

/**
 * @param {{ MENTE: ArchivioKv, MENTE_REFRESH_TOKEN?: string }} env
 * @returns {import('../scripts/mente-graph.mjs').ArchivioToken}
 */
export function archivioSuKv(env) {
  return {
    scope: MENTE_SCOPE_REMOTO,

    async leggi() {
      // Il segreto è il seme: serve al primo giro, quando in KV non c'è ancora
      // niente. Da lì in poi comanda KV, perché il token ruota e un segreto
      // non si riscrive da solo.
      const salvato = await env.MENTE.get(K_REFRESH);
      if (salvato) return salvato;
      if (env.MENTE_REFRESH_TOKEN) return env.MENTE_REFRESH_TOKEN;
      throw new Error(
        'Nessun refresh token nel Worker. Prendine uno con:\n' +
        '  node scripts/get-refresh-token.mjs --remoto\n' +
        'e mettilo con: npx wrangler secret put MENTE_REFRESH_TOKEN'
      );
    },

    leggiPrecedente() {
      return env.MENTE.get(K_PRECEDENTE);
    },

    async scrivi(nuovo) {
      const corrente = await env.MENTE.get(K_REFRESH);
      if (corrente && corrente !== nuovo) await env.MENTE.put(K_PRECEDENTE, corrente);
      await env.MENTE.put(K_REFRESH, nuovo);
    },

    async leggiAccesso() {
      const grezzo = await env.MENTE.get(K_ACCESSO);
      if (!grezzo) return null;
      try {
        const { token, scadenza } = JSON.parse(grezzo);
        return token && scadenza ? { token, scadenza } : null;
      } catch {
        return null;
      }
    },

    async scriviAccesso(token, scadenza) {
      const secondi = Math.floor((scadenza - Date.now()) / 1000);
      if (secondi < TTL_MINIMO) return;   // sta per scadere: non vale la scrittura
      await env.MENTE.put(K_ACCESSO, JSON.stringify({ token, scadenza }), {
        expirationTtl: secondi,
      });
    },
  };
}
