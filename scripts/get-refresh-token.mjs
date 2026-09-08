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
      await diChiSei(tok.access_token);
      console.log('━'.repeat(60));
      console.log(REMOTO
        ? 'REFRESH TOKEN PER IL CONNETTORE REMOTO — non salvarlo qui.\n' +
          'Va nel Worker, e in nessun altro posto:\n' +
          '  npx wrangler secret put MENTE_REFRESH_TOKEN\n' +
          '(le istruzioni per esteso in docs/mente-remoto.md)\n'
        : `REFRESH TOKEN — salvalo in ${TOKEN_FILE} per usarlo da qui\n` +
          '(oppure esportalo come MENTE_REFRESH_TOKEN), e mettilo come segreto\n' +
          'GitHub MENTE_REFRESH_TOKEN per la Action del calendario di lavoro:\n');
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

/**
 * Con quale identità è andata: si stampa, e non è un lusso.
 *
 * Lo stesso indirizzo può esistere due volte — una come account Microsoft
 * personale e una dentro un tenant di lavoro — e la pagina del login sceglie
 * da sé, tanto più se ad aprire è una passkey. Fin qui non se ne accorge
 * nessuno: il token esce, si incolla, e l'errore arriva giorni dopo, dal
 * telefono, come «AADSTS7000012: the grant was obtained for a different
 * tenant» — cioè dove non si può fare niente. Qui invece si vede subito, con
 * la stringa ancora sullo schermo.
 *
 * `9188040d-…` è il tenant degli account personali, l'unico che questa app
 * accetta: `/consumers` è dove va a rinnovare. Un tid diverso vuol dire
 * account sbagliato, e il token appena preso non servirà a niente.
 * @param {string} [accessToken]
 */
async function diChiSei(accessToken) {
  const MSA = '9188040d-6c67-4c5b-b112-36a304b66dad';
  if (!accessToken) return;

  let tid = '';
  try {
    const [, carico] = accessToken.split('.');
    ({ tid } = JSON.parse(Buffer.from(carico, 'base64url').toString()));
  } catch { /* non è un JWT leggibile: resta il nome, che basta */ }

  let chi = '';
  try {
    const r = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const me = await r.json();
    chi = me.userPrincipalName || me.mail || '';
  } catch { /* senza rete si vive lo stesso */ }

  if (chi) console.log(`Account: ${chi}`);
  if (tid && tid !== MSA) {
    console.log(
      '\n⚠  Questo NON è un account Microsoft personale (tenant ' + tid + ').\n' +
      '   L\'app rinnova su /consumers, quindi questo token verrà rifiutato con\n' +
      '   «the grant was obtained for a different tenant». Rifai il login e, se\n' +
      '   la pagina chiede quale account usare, scegli quello personale — con la\n' +
      '   password, non con la passkey, che tende a riportare all\'altro.\n'
    );
  }
}

main().catch(e => { console.error('Errore:', e.message); process.exit(1); });
