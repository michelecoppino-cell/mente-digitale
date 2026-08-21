/**
 * get-refresh-token.mjs
 * Esegui UNA SOLA VOLTA in locale per ottenere il refresh token.
 * Richiede Node 18+, nessuna dipendenza.
 *
 *   node scripts/get-refresh-token.mjs           token per sync-calendar (Actions)
 *   node scripts/get-refresh-token.mjs --mente    token per il CLI mente.mjs
 *
 * I due token restano separati: quello di sync-calendar vive come segreto su
 * GitHub e può fare pochissimo (mail e calendario), quello del CLI vive solo
 * sulla macchina di chi lo usa e arriva fino a diario e attività.
 */

import { CLIENT_ID, MENTE_SCOPE, TOKEN_FILE } from './mente-graph.mjs';

const MENTE      = process.argv.includes('--mente');
const SCOPE      = MENTE ? MENTE_SCOPE : 'Mail.ReadWrite Calendars.ReadWrite offline_access';

async function main() {
  // 1 — Richiedi device code
  const dcRes = await fetch(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    }
  );
  const dc = await dcRes.json();
  if (!dc.device_code) throw new Error(dc.error_description || JSON.stringify(dc));

  console.log('\n' + dc.message + '\n');

  // 2 — Polling finché l'utente non accede
  const interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));

    const tokRes = await fetch(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
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
      console.log('✓ Autenticato!\n');
      console.log('━'.repeat(60));
      console.log(MENTE
        ? `REFRESH TOKEN — salvalo in ${TOKEN_FILE}\n(oppure esportalo come MENTE_REFRESH_TOKEN):\n`
        : 'REFRESH TOKEN — copialo come segreto GitHub MS_REFRESH_TOKEN:\n');
      console.log(tok.refresh_token);
      console.log('━'.repeat(60));
      return;
    }
    if (tok.error && tok.error !== 'authorization_pending') {
      throw new Error(tok.error_description || tok.error);
    }
  }

  throw new Error('Timeout — riprova da capo.');
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
