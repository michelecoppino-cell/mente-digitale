/**
 * get-refresh-token.mjs
 * Esegui UNA SOLA VOLTA in locale per ottenere il refresh token.
 * Richiede Node 18+, nessuna dipendenza.
 *
 *   node scripts/get-refresh-token.mjs
 *
 * Il token serve a tutto quello che parla con Graph da fuori dal browser: il
 * CLI `mente.mjs`, il server MCP, e la GitHub Action del calendario di lavoro.
 *
 * Ce n'era un secondo, più stretto, per la vecchia sincronizzazione via mail:
 * quella non c'è più (vedi sync-calendario-lavoro.mjs), e con lei il motivo di
 * tenerne due. Gli scope sono quelli di MENTE_SCOPE, cuciti dentro il token.
 */

import { CLIENT_ID, MENTE_SCOPE, MENTE_SCOPE_REMOTO } from './mente-graph.mjs';
import { TOKEN_FILE } from './mente-token-file.mjs';

// Con `--remoto` il token è per il connettore su Cloudflare, e porta meno
// scope: là dentro nessuno strumento legge la posta, e un token che vive fuori
// da questa macchina deve poter fare solo quello che gli serve davvero.
const REMOTO = process.argv.includes('--remoto');
const SCOPE = REMOTO ? MENTE_SCOPE_REMOTO : MENTE_SCOPE;

// `--solo-token` manda sull'uscita **solo** la chiave, e tutto il resto —
// istruzioni, avvisi, il codice da digitare — sull'uscita degli errori, che
// resta a schermo. Serve per infilare il token dentro a un altro comando senza
// che passi da occhi, appunti e tastiera:
//
//   node scripts/get-refresh-token.mjs --remoto --solo-token | npx wrangler secret put MENTE_REFRESH_TOKEN
//
// Non è un vezzo: un refresh token è lungo un paio di migliaia di caratteri, e
// incollarlo a mano in un campo nascosto è il modo più facile di consegnarne
// mezzo. Chi lo fa non se ne accorge — il comando dice «Success» lo stesso — e
// si ritrova un «AADSTS9002313: request is malformed» giorni dopo, che sembra
// tutto fuorché una stringa tagliata.
const SOLO_TOKEN = process.argv.includes('--solo-token');
const dì = SOLO_TOKEN ? console.error : console.log;

async function main() {
  // 1 — Richiedi device code
  const dcRes = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    }
  );
  const dc = await dcRes.json();
  if (!dc.device_code) throw new Error(dc.error_description || JSON.stringify(dc));

  dì('\n' + dc.message + '\n');

  // 2 — Polling finché l'utente non accede
  const interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));

    const tokRes = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: CLIENT_ID,
          device_code: dc.device_code,
        }),
      }
    );
    const tok = await tokRes.json();

    if (tok.refresh_token) {
      dì('✓ Autenticato!\n');
      await diChiSei(tok.access_token);
      dì('━'.repeat(60));
      dì(REMOTO
        ? 'REFRESH TOKEN PER IL CONNETTORE REMOTO — non salvarlo qui.\n' +
          'Va nel Worker, e in nessun altro posto:\n' +
          '  npx wrangler secret put MENTE_REFRESH_TOKEN\n' +
          '(le istruzioni per esteso in docs/mente-remoto.md)\n'
        : `REFRESH TOKEN — salvalo in ${TOKEN_FILE} per usarlo da qui\n` +
          '(oppure esportalo come MENTE_REFRESH_TOKEN), e mettilo come segreto\n' +
          'GitHub MENTE_REFRESH_TOKEN per la Action del calendario di lavoro:\n');
      // Senza newline in coda: `wrangler secret put` prende quello che arriva
      // così com'è, e uno spazio bianco in fondo è un segreto diverso.
      if (SOLO_TOKEN) process.stdout.write(tok.refresh_token);
      else console.log(tok.refresh_token);
      dì('\n' + '━'.repeat(60));
      return;
    }
    if (tok.error && tok.error !== 'authorization_pending') {
      throw new Error(tok.error_description || tok.error);
    }
  }

  throw new Error('Timeout — riprova da capo.');
}

/**
 * Con quale identità è andata: si stampa **sempre**, e non è un lusso.
 *
 * Lo stesso indirizzo può esistere due volte — una come account Microsoft
 * personale e una dentro un tenant di lavoro — e chi firma il login lo decide
 * la schermata, non chi digita: su un telefono è la passkey nel portachiavi.
 * Il token esce comunque, si incolla nel Worker, e quale delle due identità
 * abbia autorizzato lo si scopre dai dati che non tornano.
 *
 * La prima versione di questa stampa parlava solo quando qualcosa non andava,
 * e infatti nel caso vero è rimasta zitta: il token remoto non ha `User.Read`,
 * quindi `/me` non risponde, e il silenzio si legge come «tutto a posto».
 * Adesso dice sempre qualcosa, anche solo il tenant.
 * @param {string} [accessToken]
 */
async function diChiSei(accessToken) {
  const MSA = '9188040d-6c67-4c5b-b112-36a304b66dad';
  if (!accessToken) return;

  let tid = '';
  let nome = '';
  try {
    const [, carico] = accessToken.split('.');
    const dati = JSON.parse(Buffer.from(carico, 'base64url').toString());
    tid = dati.tid || '';
    // Quale di questi ci sia dipende dagli scope: con quelli ridotti del
    // connettore non c'è né `upn` né il profilo, e resta solo il tenant.
    nome = dati.upn || dati.unique_name || dati.preferred_username || dati.email || '';
  } catch { /* non è un JWT leggibile: si dirà quel poco che si sa */ }

  if (!nome) {
    // Ultima carta, e vale solo dove gli scope la permettono.
    try {
      const r = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) {
        const me = await r.json();
        nome = me.userPrincipalName || me.mail || '';
      }
    } catch { /* senza rete si vive lo stesso */ }
  }

  const tipo = !tid ? 'non leggibile'
    : tid === MSA ? 'account Microsoft personale'
    : `account di lavoro o scuola (tenant ${tid})`;

  dì(`Account: ${nome || '(nome non leggibile con questi scope)'} — ${tipo}\n`);
  if (tid && tid !== MSA) {
    dì(
      '⚠  Questo non è l\'account personale. Il token funzionerà lo stesso, ma\n' +
      '   leggerà e scriverà sul OneDrive di *quell\'account*: se non è dove\n' +
      '   sta la mente digitale, rifai il login scegliendo l\'altro — e se il\n' +
      '   telefono propone una passkey, rifiutala e usa la password.\n'
    );
  }
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
