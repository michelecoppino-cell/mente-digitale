/**
 * Cloudflare Pages Function — /api/daily-plan
 * Tre azioni: generate-schedule, extract-email-actions, breakdown-task
 * Usa Claude API (claude-haiku-4-5-20251001)
 *
 * Env richiesta: ANTHROPIC_API_KEY (secret in Cloudflare Pages)
 */

const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_API   = 'https://api.anthropic.com/v1/messages';

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

async function callClaude(apiKey, prompt, maxTokens = 2048) {
  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`Claude API ${res.status}: ${e.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function extractJson(text) {
  // Try array first, then object
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) return JSON.parse(arrMatch[0]);
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return JSON.parse(objMatch[0]);
  throw new Error('Risposta non contiene JSON valido');
}

// ── Action: generate-schedule ─────────────────────────────────────────────────

async function generateSchedule(apiKey, { tasks, calEvents, workdayStart, workdayEnd, date }) {
  const EIS_LABELS = { Q1: 'urgente+importante', Q2: 'importante', Q3: 'urgente', Q4: 'né urgente né importante' };
  const tasksText = (tasks || []).slice(0, 30).map((t, i) =>
    `${i+1}. [${t.listName || ''}] ${t.taskTitle}${t.importance === 'high' ? ' ★' : ''}${t.dueDate ? ` (scadenza: ${t.dueDate.slice(0,10)})` : ''}${t.eisenhower ? ` [Eisenhower: ${EIS_LABELS[t.eisenhower] || t.eisenhower}]` : ''}`
  ).join('\n');

  const eventsText = (calEvents || []).length
    ? (calEvents || []).map(e => `- ${e.startTime}–${e.endTime}: ${e.subject}`).join('\n')
    : 'Nessun appuntamento';

  const prompt = `Sei un esperto di produttività. Genera una pianificazione ottimale per un Project Manager.

Data: ${date}. Orario di lavoro: ${workdayStart}–${workdayEnd}.

APPUNTAMENTI GIÀ IN AGENDA (non sovrapporre):
${eventsText}

TASK DA PIANIFICARE:
${tasksText}

Regole:
1. Pianifica i task più importanti (★, scadenze imminenti, quadrante Eisenhower Q1/Q2) al mattino
2. Lascia almeno 15 minuti tra meeting e task
3. Raggruppa task dello stesso progetto quando possibile
4. Ogni blocco task: 30–90 minuti
5. Non sovrapporre gli appuntamenti esistenti
6. Pianifica al massimo 6–8 task

Rispondi SOLO con un array JSON valido, nessun testo prima o dopo:
[
  {
    "taskId": "id-task",
    "taskTitle": "Titolo task",
    "listId": "id-lista",
    "listName": "Nome lista",
    "projectKey": "chiave-progetto-o-null",
    "startTime": "09:00",
    "endTime": "10:00"
  }
]`;

  const text = await callClaude(apiKey, prompt, 2048);
  const blocks = extractJson(text);
  if (!Array.isArray(blocks)) throw new Error('Formato risposta non valido');
  return { blocks };
}

// ── Action: extract-email-actions ─────────────────────────────────────────────

async function extractEmailActions(apiKey, { emails }) {
  if (!emails?.length) return { actions: [] };

  const emailsText = emails.slice(0, 20).map((e, i) => {
    const from = e.from?.emailAddress?.address || e.from || '';
    return `Email ${i+1}:
Da: ${from}
Oggetto: ${e.subject || ''}
Preview: ${(e.bodyPreview || '').slice(0, 200)}`;
  }).join('\n\n');

  const prompt = `Sei un assistente che estrae action item dalle email per un Project Manager.

Analizza queste email e estrai gli action item specifici che richiedono follow-up.

${emailsText}

Regole:
1. Estrai solo action item chiari e specifici (non FYI)
2. Concentrati su scadenze, richieste e deliverable
3. Sii conciso (max 10 parole per action)
4. Al massimo 2 action per email
5. Ignora email di marketing/newsletter

Rispondi SOLO con un array JSON valido:
[
  {
    "subject": "oggetto email originale",
    "from": "email mittente",
    "snippet": "citazione rilevante dall'email (max 60 char)",
    "extractedAction": "action item conciso"
  }
]

Se non ci sono action item significativi, rispondi con [].`;

  const text = await callClaude(apiKey, prompt, 1024);
  const actions = extractJson(text);
  if (!Array.isArray(actions)) return { actions: [] };
  return { actions };
}

// ── Action: breakdown-task ────────────────────────────────────────────────────

async function breakdownTask(apiKey, { taskTitle, listName, projectKey }) {
  const prompt = `Sei un esperto di produttività. Scomponi il seguente task in 3–5 sottostep concreti e realizzabili.

Task: ${taskTitle}
Lista/Progetto: ${listName || projectKey || 'N/D'}

Regole:
1. Ogni sottostep completabile in 10–20 minuti
2. I sottostep devono essere ordinati logicamente
3. Sii specifico e orientato all'azione
4. Usa l'italiano

Rispondi SOLO con un array JSON valido:
[
  {"title": "titolo sottostep"},
  ...
]`;

  const text = await callClaude(apiKey, prompt, 512);
  const steps = extractJson(text);
  if (!Array.isArray(steps)) return { steps: [] };
  return { steps };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.ANTHROPIC_API_KEY;
    if (!apiKey) return err('ANTHROPIC_API_KEY non configurata — aggiungila nei secret di Cloudflare Pages');

    const body = await context.request.json();
    const { action, ...payload } = body;

    switch (action) {
      case 'generate-schedule':
        return json(await generateSchedule(apiKey, payload));
      case 'extract-email-actions':
        return json(await extractEmailActions(apiKey, payload));
      // Alias generalizzato: oggi analizza solo le email, in futuro aggregherà
      // anche MOM/routine — il frontend consuma lo stesso formato {actions}.
      case 'daily-review-suggestions':
        return json(await extractEmailActions(apiKey, payload));
      case 'breakdown-task':
        return json(await breakdownTask(apiKey, payload));
      default:
        return err(`Azione non valida: ${action}`, 400);
    }
  } catch (e) {
    return err(e.message);
  }
}
