/**
 * sync-calendar.mjs
 * Legge mail non lette con oggetto "calendario" dalla casella personale,
 * crea gli eventi nel calendario Outlook e segna le mail come lette.
 *
 * Richiede Node.js 18+ (fetch nativo).
 * Prima esecuzione: autenticazione via browser (device code flow).
 * Esecuzioni successive: token in cache (.token-cache.json).
 */

import { PublicClientApplication } from '@azure/msal-node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, '.token-cache.json');

const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
const SCOPES    = ['Mail.ReadWrite', 'Calendars.ReadWrite'];
const TIMEZONE  = 'Europe/Rome';

// ── Cache token su file ──────────────────────────────────────────────────────
const cachePlugin = {
  beforeCacheAccess(ctx) {
    if (existsSync(CACHE_FILE))
      ctx.tokenCache.deserialize(readFileSync(CACHE_FILE, 'utf8'));
  },
  afterCacheAccess(ctx) {
    if (ctx.cacheHasChanged)
      writeFileSync(CACHE_FILE, ctx.tokenCache.serialize());
  },
};

const pca = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/consumers',
  },
  cache: { cachePlugin },
});

async function getToken() {
  const accounts = await pca.getAllAccounts();
  if (accounts.length > 0) {
    try {
      const r = await pca.acquireTokenSilent({ scopes: SCOPES, account: accounts[0] });
      return r.accessToken;
    } catch {}
  }
  // Prima volta: apri browser con device code
  const r = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: info => console.log('\n' + info.message + '\n'),
  });
  return r.accessToken;
}

// ── Parsing corpo mail ───────────────────────────────────────────────────────
function parseBody(body) {
  let text = body.content || '';
  if (body.contentType === 'html') {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  const lines  = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isoRe  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const dtLines = lines.filter(l => isoRe.test(l));
  const txtLines = lines.filter(l => !isoRe.test(l));

  return {
    title: txtLines[0] || 'Evento',
    start: dtLines[0] ? dtLines[0].substring(0, 19) : null,
    end:   dtLines[1] ? dtLines[1].substring(0, 19) : (dtLines[0] ? dtLines[0].substring(0, 19) : null),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('[sync-calendar] Avvio...');

  let token;
  try {
    token = await getToken();
  } catch (e) {
    console.error('[sync-calendar] Autenticazione fallita:', e.message);
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Cerca mail non lette con oggetto "calendario"
  const mailUrl =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$filter=isRead eq false and subject eq 'calendario'` +
    `&$select=id,subject,body,receivedDateTime` +
    `&$top=50`;

  const mailRes = await fetch(mailUrl, { headers });
  if (!mailRes.ok) {
    const err = await mailRes.json();
    console.error('[sync-calendar] Errore lettura mail:', err.error?.message);
    process.exit(1);
  }

  const mails = (await mailRes.json()).value || [];
  console.log(`[sync-calendar] ${mails.length} mail da elaborare.`);

  let created = 0, skipped = 0;

  for (const mail of mails) {
    const { title, start, end } = parseBody(mail.body);

    if (!start) {
      console.log(`  [SKIP] Nessuna data trovata — ricevuta il ${mail.receivedDateTime}`);
      skipped++;
      // Segna comunque come letta per non riprocessarla
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${mail.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ isRead: true }),
      });
      continue;
    }

    // Crea evento
    const evRes = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subject: title,
        start: { dateTime: start, timeZone: TIMEZONE },
        end:   { dateTime: end,   timeZone: TIMEZONE },
      }),
    });

    if (evRes.ok) {
      console.log(`  ✓ "${title}"  ${start.substring(0,16)} → ${end.substring(11,16)}`);
      created++;
      // Segna mail come letta
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${mail.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ isRead: true }),
      });
    } else {
      const err = await evRes.json();
      console.log(`  ✗ Errore per "${title}": ${err.error?.message}`);
    }
  }

  console.log(`[sync-calendar] Completato — creati: ${created}, saltati: ${skipped}.`);
}

run().catch(e => { console.error(e); process.exit(1); });
