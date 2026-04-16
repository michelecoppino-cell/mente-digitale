/**
 * generate-news.mjs
 * Scarica RSS ANSA (mondo, cronaca, Friuli), chiama Claude API,
 * salva il briefing strutturato in public/news-summary.json.
 *
 * Env richieste: ANTHROPIC_API_KEY
 * Node 18+ (usa fetch globale)
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FEEDS = {
  mondo:  'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
  italia: 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml',
  friuli: 'https://www.ansa.it/friuliveneziagiulia/notizie/friuliveneziagiulia_rss.xml',
};

// ── Parsing RSS con regex (no dipendenze) ────────────────────────────────────
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() : '';
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

async function fetchFeed(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MenteDigitale-NewsBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ── Gemini API (gratuita fino a 1500 req/giorno) ────────────────────────────
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY non impostato — aggiungilo come GitHub Secret');

  // Prova gemini-2.0-flash, fallback su gemini-1.5-flash
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastErr;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    console.log(`  Provo modello: ${model}`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(60000),
      });

      const data = await r.json();

      if (!r.ok) {
        console.warn(`  ${model} → HTTP ${r.status}: ${data.error?.message || r.statusText}`);
        lastErr = new Error(`${model} HTTP ${r.status}: ${data.error?.message}`);
        continue;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) { lastErr = new Error(`${model}: risposta vuota`); continue; }

      console.log(`  ✓ ${model} OK`);
      return text;
    } catch(e) {
      console.warn(`  ${model} → errore: ${e.message}`);
      lastErr = e;
    }
  }

  throw lastErr || new Error('Tutti i modelli Gemini hanno fallito');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('[generate-news] Avvio...');

  const feeds = {};
  for (const [key, url] of Object.entries(FEEDS)) {
    try {
      const xml = await fetchFeed(url);
      feeds[key] = parseRss(xml, key === 'mondo' ? 20 : 12);
      console.log(`  [${key}] ${feeds[key].length} articoli recenti`);
    } catch (e) {
      console.warn(`  [${key}] Errore: ${e.message}`);
      feeds[key] = [];
    }
  }

  const fmt = (items) => items.map((i, n) =>
    `${n + 1}. ${i.title}${i.desc ? ' — ' + i.desc : ''}`
  ).join('\n');

  const prompt = `Sei un giornalista italiano. Analizza queste notizie delle ultime 24 ore.

NOTIZIE INTERNAZIONALI (scegli le 4 più importanti per il mondo):
${fmt(feeds.mondo)}

NOTIZIE ITALIA (scegli le 2 più rilevanti per l'Italia):
${fmt(feeds.italia)}

NOTIZIE FRIULI VENEZIA GIULIA (scegli le 2 più importanti):
${fmt(feeds.friuli)}

Rispondi SOLO con JSON valido, zero testo prima o dopo il JSON:
{
  "mondo": [
    {"title": "titolo breve max 7 parole", "summary": "2-3 frasi in italiano che spiegano la notizia"},
    {"title": "...", "summary": "..."},
    {"title": "...", "summary": "..."},
    {"title": "...", "summary": "..."}
  ],
  "italia": [
    {"title": "...", "summary": "..."},
    {"title": "...", "summary": "..."}
  ],
  "friuli": [
    {"title": "...", "summary": "..."},
    {"title": "...", "summary": "..."}
  ]
}`;

  console.log('[generate-news] Chiamo Gemini Flash...');
  const text = await callGemini(prompt);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Risposta Claude non contiene JSON');

  const sections = JSON.parse(jsonMatch[0]);

  const output = {
    generatedAt: new Date().toISOString(),
    sections,
  };

  const outPath = join(__dirname, '..', 'public', 'news-summary.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[generate-news] ✓ Salvato → ${outPath}`);
  console.log(`  mondo:${sections.mondo?.length || 0} italia:${sections.italia?.length || 0} friuli:${sections.friuli?.length || 0}`);
}

run().catch(e => { console.error('[generate-news] ERRORE:', e.message); process.exit(1); });
