/**
 * sync-calendar.mjs
 * Legge mail non lette con oggetto "calendario", crea eventi e le segna come lette.
 * Usato da GitHub Actions — nessuna dipendenza, Node 18+.
 *
 * Env richieste: MS_REFRESH_TOKEN
 * Env opzionale: GH_TOKEN + GH_REPO (per aggiornare il segreto automaticamente)
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const TIMEZONE  = 'Europe/Rome';

// ── Token ────────────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  const rt = process.env.MS_REFRESH_TOKEN;
  if (!rt) throw new Error('MS_REFRESH_TOKEN non impostato');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: rt,
      scope: 'Mail.ReadWrite Calendars.ReadWrite offline_access',
    }),
  });

  if (!res.ok) {
    const e = await res.json();
    throw new Error(`Token refresh fallito: ${e.error_description || e.error}`);
  }

  const data = await res.json();

  // Salva il nuovo refresh token su file — il workflow lo rilegge e aggiorna il segreto
  if (data.refresh_token) {
    writeFileSync(join(__dirname, '.new-refresh-token'), data.refresh_token, 'utf8');
  }

  return data.access_token;
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
  const lines   = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isoRe   = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const dtLines = lines.filter(l => isoRe.test(l));
  const txtLines= lines.filter(l => !isoRe.test(l));
  return {
    title: txtLines[0] || 'Evento',
    start: dtLines[0]?.substring(0, 19) ?? null,
    end:   dtLines[1]?.substring(0, 19) ?? dtLines[0]?.substring(0, 19) ?? null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('[sync-calendar] Avvio...');

  const token = await refreshAccessToken();
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Cerca mail non lette con oggetto esatto "calendario"
  const mailRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$filter=isRead eq false and subject eq 'calendario'` +
    `&$select=id,subject,body,receivedDateTime&$top=50`,
    { headers: h }
  );
  if (!mailRes.ok) {
    const e = await mailRes.json();
    throw new Error(`Errore lettura mail: ${e.error?.message}`);
  }

  const mails = (await mailRes.json()).value || [];
  console.log(`[sync-calendar] ${mails.length} mail da elaborare.`);

  let created = 0, skipped = 0;

  for (const mail of mails) {
    const { title, start, end } = parseBody(mail.body);

    if (!start) {
      console.log(`  [SKIP] Nessuna data — mail del ${mail.receivedDateTime}`);
      skipped++;
    } else {
      const evRes = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          subject: title,
          start: { dateTime: start, timeZone: TIMEZONE },
          end:   { dateTime: end,   timeZone: TIMEZONE },
        }),
      });
      if (evRes.ok) {
        console.log(`  ✓ "${title}"  ${start.substring(0,16)} → ${end.substring(11,16)}`);
        created++;
      } else {
        const e = await evRes.json();
        console.log(`  ✗ Errore per "${title}": ${e.error?.message}`);
      }
    }

    // Segna sempre come letta (anche se skippata) per non riprocessarla
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${mail.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ isRead: true }),
    });
  }

  console.log(`[sync-calendar] Completato — creati: ${created}, saltati: ${skipped}.`);
}

run().catch(e => { console.error('[sync-calendar] ERRORE:', e.message); process.exit(1); });
