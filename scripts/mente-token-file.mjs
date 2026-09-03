/**
 * mente-token-file.mjs
 * Il refresh token custodito su questa macchina: un file accanto agli script,
 * o una variabile d'ambiente, o un `.env` nella radice.
 *
 * Stava dentro `mente-graph.mjs`, ed è uscito quando lo stesso nucleo ha
 * dovuto girare anche dentro un Cloudflare Worker: là `fs` non esiste, e un
 * import statico in testa a un modulo basta a far fallire il bundle. Adesso
 * `mente-graph.mjs` non sa dove sta il token — glielo si dice con
 * `impostaArchivioToken` — e tutto quello che tocca il disco è qui.
 *
 * Chi gira su Node lo monta in una riga:
 *
 *   import { impostaArchivioToken } from './mente-graph.mjs';
 *   import { archivioSuFile } from './mente-token-file.mjs';
 *   impostaArchivioToken(archivioSuFile());
 *
 * Nessuna dipendenza, Node 18+.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Il file dove il CLI tiene il proprio refresh token quando gira in locale.
 * È in .gitignore: non deve finire nel repo per nessun motivo.
 */
export const TOKEN_FILE = join(__dirname, '.mente-refresh-token');

// Un .env minimale (KEY=valore, righe vuote e # ignorati): serve solo a non
// costringere a esportare la variabile a ogni shell nuova. Non sovrascrive
// mai una variabile già presente nell'ambiente.
function loadDotEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

/**
 * Da dove arriva il refresh token, in ordine: variabile dedicata, file locale,
 * e per ultima la variabile della vecchia sincronizzazione via mail — che non
 * esiste più, ma il segreto può essere ancora in giro e funziona se è stato
 * preso con gli scope del CLI.
 * @returns {{ token: string, source: 'env'|'file' }}
 */
function resolveRefreshToken() {
  loadDotEnv();
  if (process.env.MENTE_REFRESH_TOKEN) return { token: process.env.MENTE_REFRESH_TOKEN, source: 'env' };
  if (existsSync(TOKEN_FILE)) {
    const t = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return { token: t, source: 'file' };
  }
  if (process.env.MS_REFRESH_TOKEN) return { token: process.env.MS_REFRESH_TOKEN, source: 'env' };
  throw new Error(
    'Nessun refresh token. Prendine uno con:\n' +
    '  node scripts/get-refresh-token.mjs\n' +
    'e salvalo in scripts/.mente-refresh-token (o in MENTE_REFRESH_TOKEN).'
  );
}

/**
 * L'archivio del token per chi gira su questa macchina.
 * @returns {import('./mente-graph.mjs').ArchivioToken}
 */
export function archivioSuFile() {
  /** @type {'env'|'file'|null} */
  let sorgente = null;

  return {
    leggi() {
      const { token, source } = resolveRefreshToken();
      sorgente = source;
      return token;
    },

    // Il refresh token ruota: se è arrivato dal file lo si riscrive, altrimenti
    // fra qualche settimana quello vecchio smette di funzionare senza motivo
    // apparente. Se arriva dall'ambiente non possiamo riscriverlo dove sta:
    // lo si lascia accanto, che almeno non vada perso.
    scrivi(nuovo) {
      if (sorgente === 'file') writeFileSync(TOKEN_FILE, nuovo, 'utf8');
      else writeFileSync(join(__dirname, '.new-refresh-token'), nuovo, 'utf8');
    },
  };
}
