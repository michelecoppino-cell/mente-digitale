/**
 * Cloudflare Pages Function — /api/briefing
 * Riceve { section: 'mondo'|'italia'|'friuli' }, scarica RSS ANSA,
 * chiama Gemini Flash e restituisce { items, generatedAt }.
 *
 * Env richiesta: GEMINI_API_KEY (secret in Cloudflare Pages)
 * Chiave gratuita: aistudio.google.com
 */

const FEEDS = {
  mondo:  'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
  italia: 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml',
  friuli: 'https://www.ansa.it/friuliveneziagiulia/notizie/friuliveneziagiulia_rss.xml',
};

const COUNTS = { mondo: 5, italia: 3, friuli: 3 };

const PROMPTS = {
  mondo:  'internazionali (focus sulle più importanti per il mondo)',
  italia: 'italiane (cronaca e politica)',
  friuli: 'del Friuli Venezia Giulia',
};

// ── Parsing RSS ───────────────────────────────────────────────────────────────
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m
    ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
    : '';
}

function parseRss(xml, maxItems = 20) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  const cutoff = Date.now() - 26 * 3600 * 1000; // ultime 26h
  let m;
  while ((m = re.exec(xml)) !== null && items.length < maxItems) {
    const block = m[1];
    const pubDate = extractTag(block, 'pubDate');
    try { if (pubDate && new Date(pubDate).getTime() < cutoff) continue; } catch {}
    const title = extractTag(block, 'title');
    const desc  = extractTag(block, 'description').slice(0, 200);
    if (title) items.push({ title, desc });
  }
  return items;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const json = r => new Response(JSON.stringify(r), {
    headers: { 'Content-Type': 'application/json' },
  });
  const err = (msg, status = 500) => new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json' },
  });

  try {
    const body = await context.request.json();
    const section = body?.section;

    if (!FEEDS[section]) return err('Sezione non valida', 400);

    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) return err('GEMINI_API_KEY non configurata — aggiungila nei secret di Cloudflare Pages');

    // Scarica RSS
    const rssRes = await fetch(FEEDS[section], {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MenteDigitale/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!rssRes.ok) return err(`RSS non raggiungibile (HTTP ${rssRes.status})`);
    const xml = await rssRes.text();
    const items = parseRss(xml, 20);

    if (!items.length) return json({ items: [], generatedAt: new Date().toISOString() });

    const count = COUNTS[section];
    const label = PROMPTS[section];
    const news  = items.map((i, n) => `${n + 1}. ${i.title}${i.desc ? ' — ' + i.desc : ''}`).join('\n');

    const prompt = `Sei un giornalista italiano. Dalle seguenti notizie ${label} delle ultime 24h, scegli le ${count} più importanti e riassumile.

${news}

Rispondi SOLO con un array JSON valido, zero testo prima o dopo:
[
  {"title": "titolo breve max 7 parole", "summary": "2-3 frasi in italiano che spiegano la notizia"},
  ...
]`;

    // Chiama Gemini Flash (gratuito)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!geminiRes.ok) {
      const e = await geminiRes.json().catch(() => ({}));
      return err(`Gemini API ${geminiRes.status}: ${e.error?.message || geminiRes.statusText}`);
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return err('Risposta Gemini non contiene JSON valido');

    const result = JSON.parse(match[0]);
    return json({ items: result, generatedAt: new Date().toISOString() });

  } catch (e) {
    return err(e.message);
  }
}
