/**
 * Cloudflare Pages Function — /api/project-control
 * Azioni: analyze, suggest-tasks, generate-report
 * Env: ANTHROPIC_API_KEY
 */

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function callClaude(apiKey, prompt, maxTokens = 2048, model = 'claude-haiku-4-5') {
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`Claude API ${res.status}: ${e.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function extractJson(text) {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  throw new Error('Risposta non contiene JSON valido');
}

function calcKpi(commessa) {
  const c = commessa.contratto || {};
  const oreConsumate = (commessa.ore_segnate || []).reduce((s, r) => s + (r.ore || 0), 0);
  const budgetOre = c.budget_ore || 0;
  const importoTotale = c.importo_totale || 0;
  const fatturato = c.fatturato || 0;
  const tariffaOraria = c.tariffa_oraria_media || 0;
  const dataFine = c.data_fine ? new Date(c.data_fine) : null;
  const giorniRimasti = dataFine ? Math.ceil((dataFine - new Date()) / 86400000) : null;
  const actionItemsAperti = (commessa.mom || []).flatMap(m => m.action_items || []).filter(ai => !ai.completato);
  const actionItemsScaduti = actionItemsAperti.filter(ai => ai.scadenza && new Date(ai.scadenza) < new Date());
  const elaboratiPendenti = (commessa.elaborati || []).filter(e => e.stato !== 'emesso' && e.stato !== 'approvato');
  const elaboratiTotali = (commessa.elaborati || []).length;
  const costoEffettivo = oreConsumate * tariffaOraria;
  const burnRate = fatturato > 0 ? costoEffettivo / fatturato : null;
  return {
    oreConsumate, budgetOre,
    pctOre: budgetOre > 0 ? Math.round((oreConsumate / budgetOre) * 100) : null,
    fatturato, importoTotale,
    pctBudget: importoTotale > 0 ? Math.round((fatturato / importoTotale) * 100) : null,
    burnRate: burnRate ? Math.round(burnRate * 100) / 100 : null,
    actionItemsAperti: actionItemsAperti.length,
    actionItemsScaduti: actionItemsScaduti.length,
    elaboratiPendenti: elaboratiPendenti.length,
    elaboratiTotali, giorniRimasti,
    specNonConfermate: (commessa.spec_cliente || []).filter(s => s.stato !== 'confermato').length,
  };
}

async function analyzeCommessa(apiKey, { commessa }) {
  const kpi = calcKpi(commessa);
  const oggi = new Date().toISOString().slice(0, 10);
  const prompt = `Sei un esperto di Project Management tecnico. Analizza questa commessa e fornisci una valutazione strutturata.

COMMESSA: ${commessa.nome}\nCLIENTE: ${commessa.cliente}\nSTATO: ${commessa.stato}\nDATA FINE PREVISTA: ${commessa.contratto?.data_fine || 'N/D'} (oggi: ${oggi})\nGIORNI RIMANENTI: ${kpi.giorniRimasti ?? 'N/D'}

KPI CALCOLATI:
- Ore consumate: ${kpi.oreConsumate}h su ${kpi.budgetOre}h budget (${kpi.pctOre ?? 'N/D'}%)
- Fatturato: €${kpi.fatturato} su €${kpi.importoTotale} totale (${kpi.pctBudget ?? 'N/D'}%)
- Burn rate: ${kpi.burnRate ?? 'N/D'} (1.0 = in linea; >1.2 = critico)
- Action items aperti: ${kpi.actionItemsAperti} (di cui ${kpi.actionItemsScaduti} scaduti)
- Elaborati pendenti (non emessi): ${kpi.elaboratiPendenti} su ${kpi.elaboratiTotali} totali
- Specifiche cliente non confermate: ${kpi.specNonConfermate}

MOM RECENTI (ultimi 3):
${(commessa.mom || []).slice(-3).map(m => `- ${m.data}: ${m.titolo} | Action items: ${(m.action_items || []).filter(a => !a.completato).length} aperti`).join('\n') || 'Nessuno'}

Rispondi SOLO con un oggetto JSON valido:
{
  "salute_globale": <numero 0-100>,
  "semaforo": <"verde"|"giallo"|"rosso">,
  "sintesi": "<frase di sintesi in italiano, max 2 righe>",
  "aree": [
    { "nome": "Budget", "score": <0-100>, "stato": <"ok"|"attenzione"|"critico">, "note": "<breve nota>" },
    { "nome": "Avanzamento elaborati", "score": <0-100>, "stato": <"ok"|"attenzione"|"critico">, "note": "<breve nota>" },
    { "nome": "MOM / Action items", "score": <0-100>, "stato": <"ok"|"attenzione"|"critico">, "note": "<breve nota>" },
    { "nome": "Scadenze", "score": <0-100>, "stato": <"ok"|"attenzione"|"critico">, "note": "<breve nota>" },
    { "nome": "Specifiche cliente", "score": <0-100>, "stato": <"ok"|"attenzione"|"critico">, "note": "<breve nota>" }
  ],
  "rischi": ["<rischio 1>", "<rischio 2>"],
  "raccomandazioni": ["<azione 1>", "<azione 2>", "<azione 3>"]
}`;
  const text = await callClaude(apiKey, prompt, 2000, 'claude-sonnet-4-5');
  const result = extractJson(text);
  return { ...result, kpi };
}

async function suggestTasks(apiKey, { commessa }) {
  const kpi = calcKpi(commessa);
  const actionItemsAperti = (commessa.mom || []).flatMap(m =>
    (m.action_items || []).filter(ai => !ai.completato).map(ai => ({ meeting: m.titolo, ...ai }))
  );
  const elaboratiPendenti = (commessa.elaborati || []).filter(e => e.stato !== 'emesso' && e.stato !== 'approvato');
  const prompt = `Sei un PM esperto. Genera task concreti e prioritizzati per questa commessa.

COMMESSA: ${commessa.nome} (${commessa.cliente})
STATO GENERALE: ${kpi.pctOre ?? 'N/D'}% ore, ${kpi.pctBudget ?? 'N/D'}% budget, ${kpi.giorniRimasti ?? 'N/D'} giorni rimasti

ACTION ITEMS APERTI DAI MOM:
${actionItemsAperti.slice(0, 10).map(ai => `- [${ai.scadenza || 'no scadenza'}] ${ai.testo} (assegnato: ${ai.assegnato_a || 'N/D'}) — meeting: ${ai.meeting}`).join('\n') || 'Nessuno'}

ELABORATI NON EMESSI:
${elaboratiPendenti.slice(0, 8).map(e => `- [${e.stato}] ${e.codice}: ${e.titolo}`).join('\n') || 'Nessuno'}

SPECIFICHE NON CONFERMATE: ${kpi.specNonConfermate}
GIORNI ALLA SCADENZA: ${kpi.giorniRimasti ?? 'N/D'}

Genera 4-8 task concreti. Rispondi SOLO con un array JSON valido:
[
  {
    "titolo": "<titolo task conciso e orientato all'azione>",
    "contesto": "<perché questo task è necessario, max 1 frase>",
    "priorita": <"alta"|"media"|"bassa">,
    "scadenza_suggerita": "<data YYYY-MM-DD o null>",
    "note": "<note opzionali per il task in To-Do>"
  }
]`;
  const text = await callClaude(apiKey, prompt, 1500, 'claude-haiku-4-5');
  const suggerimenti = extractJson(text);
  if (!Array.isArray(suggerimenti)) return { suggerimenti: [] };
  return { suggerimenti };
}

async function generateReport(apiKey, { commessa, analisi }) {
  const kpi = analisi?.kpi || calcKpi(commessa);
  const oggi = new Date().toLocaleDateString('it-IT');
  const prompt = `Sei un PM esperto. Scrivi un report di stato commessa professionale e conciso.

COMMESSA: ${commessa.nome}\nCLIENTE: ${commessa.cliente}\nDATA REPORT: ${oggi}\nSTATO: ${commessa.stato}\nSALUTE GLOBALE: ${analisi?.semaforo?.toUpperCase() || 'N/D'} (${analisi?.salute_globale ?? 'N/D'}/100)

KPI:
- Ore: ${kpi.oreConsumate}h / ${kpi.budgetOre}h (${kpi.pctOre ?? 'N/D'}%)
- Budget: €${kpi.fatturato} / €${kpi.importoTotale} (${kpi.pctBudget ?? 'N/D'}%)
- Scadenza: ${commessa.contratto?.data_fine || 'N/D'} (${kpi.giorniRimasti ?? 'N/D'} gg)
- Action items aperti: ${kpi.actionItemsAperti} (di cui ${kpi.actionItemsScaduti} scaduti)
- Elaborati pendenti: ${kpi.elaboratiPendenti} / ${kpi.elaboratiTotali}

RISCHI:
${(analisi?.rischi || []).map(r => `- ${r}`).join('\n') || 'N/D'}

Scrivi un report di stato in italiano (max 400 parole), strutturato con sezioni:
## Stato Generale\n## Avanzamento Tecnico\n## Criticità e Rischi\n## Prossime Azioni

Usa markdown. Tono professionale ma diretto.`;
  const text = await callClaude(apiKey, prompt, 1200, 'claude-sonnet-4-5');
  return { report: text };
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.ANTHROPIC_API_KEY;
    if (!apiKey) return err('ANTHROPIC_API_KEY non configurata nei secret di Cloudflare Pages', 500);
    const body = await context.request.json();
    const { action, ...payload } = body;
    switch (action) {
      case 'analyze':         return json(await analyzeCommessa(apiKey, payload));
      case 'suggest-tasks':   return json(await suggestTasks(apiKey, payload));
      case 'generate-report': return json(await generateReport(apiKey, payload));
      default:                return err(`Azione non valida: ${action}`, 400);
    }
  } catch (e) {
    return err(e.message);
  }
}
