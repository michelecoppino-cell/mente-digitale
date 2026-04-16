/**
 * sync-calendar.mjs
 * Legge mail non lette con oggetto "calendario", crea/aggiorna eventi.
 * Formato mail:
 *   Titolo evento
 *   2026-04-16T20:30:00.0000000   ← start (ISO)
 *   2026-04-17T03:00:00.0000000   ← end (ISO)
 *   AAMkAGNj...                   ← Outlook item ID (opzionale)
 *   updated | created             ← azione (opzionale, default: created)
 *
 * Usato da GitHub Actions — nessuna dipendenza, Node 18+.
 * Env richiesta: MS_REFRESH_TOKEN
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const TIMEZONE  = 'Europe/Rome';
const GRAPH     = 'https://graph.microsoft.com/v1.0';

// Prefisso usato nel body dell'evento per tenere traccia dell'ID originale
const SYNC_PREFIX = 'sync-id:';

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
  if (data.refresh_token) {
    writeFileSync(join(__dirname, '.new-refresh-token'), data.refresh_token, 'utf8');
  }
  return data.access_token;
}

// ── Parsing corpo mail ───────────────────────────────────────────────────────
const ACTIONS = new Set(['updated', 'created', 'new', 'deleted', 'cancelled']);
// Outlook item ID: base64url o base64 standard, minimo 60 char
// Includes '.' poiché alcuni ID Outlook ne contengono
const ID_RE  = /^[A-Za-z0-9+/=_.\-]{60,}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Estrae l'azione da una riga (es. "updated", "Action: updated", "Azione: updated") */
function extractAction(line) {
  const lower = line.toLowerCase().trim();
  if (ACTIONS.has(lower)) return lower;
  // "Action: updated" / "Azione: aggiornato" etc.
  const m = lower.match(/(?:action|azione)\s*[:\-]\s*(\w+)/);
  if (m && ACTIONS.has(m[1])) return m[1];
  // Riga che contiene solo la parola azione preceduta da eventuali label
  for (const a of ACTIONS) {
    if (lower.endsWith(a) && lower.length <= a.length + 20) return a;
  }
  return null;
}

function parseBody(body) {
  let text = body.content || '';
  if (body.contentType === 'html') {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Debug: mostra tutte le righe estratte
  console.log(`  [DEBUG] Righe estratte (${lines.length}):`);
  lines.forEach((l, i) => console.log(`    [${i}] ${l.substring(0, 120)}`));

  const dtLines  = lines.filter(l => ISO_RE.test(l));
  const idLine   = lines.find(l => ID_RE.test(l) && !ISO_RE.test(l));

  // Cerca azione: prima riga che "suona" come un'azione
  let detectedAction = null;
  let actLineRaw = null;
  for (const l of lines) {
    const a = extractAction(l);
    if (a) { detectedAction = a; actLineRaw = l; break; }
  }

  const txtLines = lines.filter(l =>
    !ISO_RE.test(l) &&
    !extractAction(l) &&
    !(idLine && l === idLine)
  );

  const result = {
    title:  txtLines[0] || 'Evento',
    start:  dtLines[0]?.substring(0, 19) ?? null,
    end:    dtLines[1]?.substring(0, 19) ?? dtLines[0]?.substring(0, 19) ?? null,
    extId:  idLine || null,
    action: detectedAction || 'created',
  };

  console.log(`  [DEBUG] → title="${result.title}" action="${result.action}" extId="${result.extId?.substring(0,20) ?? 'null'}…" start="${result.start}"`);
  return result;
}

// ── Cerca evento esistente per extId (tutti i calendari) ────────────────────
async function findEventByExtId(h, extId, startHint) {
  // 1. Prova lookup diretto per ID — funziona cross-calendar se extId è un Graph event ID
  try {
    const direct = await fetch(
      `${GRAPH}/me/events/${encodeURIComponent(extId)}?$select=id,subject,body`,
      { headers: h }
    );
    if (direct.ok) {
      const ev = await direct.json();
      if (ev.id) {
        console.log(`  [DEBUG] Trovato direttamente per ID: "${ev.subject}"`);
        return ev;
      }
    }
  } catch {}

  // 2. Cerca per sync-id nel body su TUTTI i calendari dell'utente
  const ref = startHint ? new Date(startHint) : new Date();
  const from = new Date(ref); from.setDate(from.getDate() - 60);
  const to   = new Date(ref); to.setDate(to.getDate() + 60);
  const params = `startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}` +
    `&$top=200&$select=id,subject,body`;

  // Recupera tutti i calendari dell'utente
  const calsRes = await fetch(`${GRAPH}/me/calendars?$select=id,name&$top=20`, { headers: h });
  const calIds = calsRes.ok
    ? (await calsRes.json()).value?.map(c => c.id) || []
    : [];

  // Cerca in ogni calendario (+ default calendarView come fallback)
  const urls = [
    `${GRAPH}/me/calendarView?${params}`,
    ...calIds.map(id => `${GRAPH}/me/calendars/${id}/calendarView?${params}`),
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: h });
      if (!r.ok) continue;
      const events = (await r.json()).value || [];
      const found = events.find(e =>
        e.body?.content?.includes(SYNC_PREFIX + extId) ||
        e.body?.content?.includes(extId)
      );
      if (found) {
        console.log(`  [DEBUG] Trovato per body match: "${found.subject}"`);
        return found;
      }
    } catch {}
  }

  return null;
}

// ── Crea evento (con extId nel body per trovarlo in futuro) ──────────────────
async function createEvent(h, { title, start, end, extId }) {
  const bodyContent = extId ? `${SYNC_PREFIX}${extId}` : '';
  const payload = {
    subject: title,
    start: { dateTime: start, timeZone: TIMEZONE },
    end:   { dateTime: end,   timeZone: TIMEZONE },
    ...(bodyContent && {
      body: { contentType: 'text', content: bodyContent }
    }),
  };

  const r = await fetch(`${GRAPH}/me/events`, {
    method: 'POST', headers: h,
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error?.message || `HTTP ${r.status}`);
  }
  return r.json();
}

// ── Elimina evento ───────────────────────────────────────────────────────────
async function deleteEvent(h, eventId) {
  const r = await fetch(`${GRAPH}/me/events/${eventId}`, {
    method: 'DELETE', headers: h,
  });
  return r.status === 204 || r.ok;
}

// ── Trova la cartella "Calendario" ───────────────────────────────────────────
async function findCalendarioFolder(h) {
  try {
    const r = await fetch(`${GRAPH}/me/mailFolders/archive/childFolders?$top=50`, { headers: h });
    if (r.ok) {
      const d = await r.json();
      const found = (d.value || []).find(f => f.displayName === 'Calendario');
      if (found) return found.id;
    }
  } catch {}

  const top = await fetch(`${GRAPH}/me/mailFolders?$top=50`, { headers: h })
    .then(r => r.ok ? r.json() : { value: [] });

  const topLevel = (top.value || []).find(f => f.displayName === 'Calendario');
  if (topLevel) return topLevel.id;

  for (const folder of (top.value || [])) {
    if (!folder.childFolderCount) continue;
    const kids = await fetch(
      `${GRAPH}/me/mailFolders/${folder.id}/childFolders?$top=50`,
      { headers: h }
    ).then(r => r.ok ? r.json() : { value: [] });
    const found = (kids.value || []).find(f => f.displayName === 'Calendario');
    if (found) return found.id;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('[sync-calendar] Avvio...');

  const token = await refreshAccessToken();
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const calendarioId = await findCalendarioFolder(h);
  console.log(calendarioId
    ? '[sync-calendar] Cartella "Calendario" trovata.'
    : '[sync-calendar] Cartella "Calendario" non trovata — mail solo lette.');

  const mailRes = await fetch(
    `${GRAPH}/me/messages` +
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

  let created = 0, updated = 0, skipped = 0;

  for (const mail of mails) {
    const { title, start, end, extId, action } = parseBody(mail.body);

    if (!start) {
      console.log(`  [SKIP] Nessuna data — mail del ${mail.receivedDateTime}`);
      skipped++;
    } else {
      try {
        if (action === 'updated' && extId) {
          // Cerca evento esistente e cancellalo
          const existing = await findEventByExtId(h, extId, start);
          if (existing) {
            await deleteEvent(h, existing.id);
            console.log(`  ↩ Cancellato vecchio "${existing.subject}"`);
          } else {
            console.log(`  ⚠ Nessun evento trovato con ID ${extId.substring(0, 20)}…`);
          }
          // Crea il nuovo evento aggiornato
          await createEvent(h, { title, start, end, extId });
          console.log(`  ✓ Aggiornato "${title}"  ${start.substring(0,16)} → ${end.substring(11,16)}`);
          updated++;

        } else if (action === 'deleted' || action === 'cancelled') {
          // Solo cancellazione
          if (extId) {
            const existing = await findEventByExtId(h, extId, start);
            if (existing) {
              await deleteEvent(h, existing.id);
              console.log(`  ✗ Cancellato "${existing.subject}"`);
            }
          }
          skipped++;

        } else {
          // Creazione normale
          await createEvent(h, { title, start, end, extId });
          console.log(`  ✓ Creato "${title}"  ${start.substring(0,16)} → ${end.substring(11,16)}`);
          created++;
        }
      } catch(e) {
        console.log(`  ✗ Errore "${title}": ${e.message}`);
        skipped++;
      }
    }

    // Marca come letta (sempre, prima di spostare — evita riprocessamento)
    await fetch(`${GRAPH}/me/messages/${mail.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ isRead: true }),
    });
    // Sposta in "Calendario" se la cartella esiste
    if (calendarioId) {
      await fetch(`${GRAPH}/me/messages/${mail.id}/move`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ destinationId: calendarioId }),
      });
    }
  }

  console.log(`[sync-calendar] Completato — creati: ${created}, aggiornati: ${updated}, saltati: ${skipped}.`);
}

run().catch(e => { console.error('[sync-calendar] ERRORE:', e.message); process.exit(1); });
