// @ts-check
// Logica pura del Diario: nessuna chiamata di rete, nessuno stato React.
// Qui vivono la forma di una voce, le domande-seme del rituale, i filtri di
// ricerca e — pezzo centrale della feature — la composizione del testo
// "copiabile e incollabile su un'AI" per chiedere supporto psicologico.
//
// Il diario NON passa mai da /api/*: il testo lascia il dispositivo solo
// quando è l'utente a incollarlo altrove, coerentemente con la scelta già
// fatta per il resto dei dati personali (browser ↔ Microsoft Graph, niente
// backend proprio).

/** @typedef {import('./types').DiaryEntry} DiaryEntry */

export const DIARY_TYPES = {
  'svuota-testa': { label: 'Svuota testa', icon: '🌬️' },
  'sera':         { label: 'Rituale della sera', icon: '🕯️' },
  'libero':       { label: 'Scrittura libera', icon: '✍️' },
};

export const MOOD_LABELS = ['', 'molto giù', 'giù', 'né su né giù', 'bene', 'molto bene'];
export const ENERGY_LABELS = ['', 'esausto', 'stanco', 'nella media', 'carico', 'pieno di energia'];

// Le tre domande del rituale della sera: fisse, così la risposta non è mai
// "cosa scrivo oggi" ma solo "cosa rispondo".
export const EVENING_QUESTIONS = [
  { key: 'nutrito',  label: 'Cosa mi ha nutrito oggi?' },
  { key: 'svuotato', label: 'Cosa mi ha svuotato?' },
  { key: 'lascio',   label: 'Cosa lascio andare?' },
];

// Domande-seme dello svuota testa: si mostrano come suggerimento leggero,
// mai come campo obbligatorio. Il tono è quello della Bussola (presenza,
// accettazione dell'istante, gratitudine) più che quello di un questionario.
export const SEEDS = [
  'Cosa sto trattenendo che potrei posare qui?',
  'Che rumore ho in testa in questo momento?',
  'Di cosa ho davvero bisogno adesso?',
  'Cosa sto rimandando, e cosa temo davvero di quel rimandare?',
  'Se questa giornata avesse una sola frase, quale sarebbe?',
  'Dove ho sentito il corpo oggi: tensione, calma, fame, sonno?',
  'A chi devo qualcosa che non ho ancora detto?',
  "Qual è l'istante di oggi che rifarei identico?",
  'Cosa mi sto raccontando che forse non è vero?',
  'Cosa vorrei ricordare fra dieci anni di questo periodo?',
  'Che cosa posso smettere di controllare?',
  'Per cosa sono grato, anche se piccolo?',
  'Chi vorrei essere domani mattina appena sveglio?',
  'Cosa mi ha fatto arrabbiare, e cosa proteggevo con quella rabbia?',
];

/** @param {Date} [date] @returns {string} 'YYYY-MM-DD' in ora locale */
export function dateKey(date = new Date()) {
  const d = date;
  const p = /** @param {number} n */ n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** @param {string|Date} [value] @returns {string} 'YYYY-MM' */
export function monthKey(value = new Date()) {
  if (typeof value === 'string') return value.slice(0, 7);
  return dateKey(value).slice(0, 7);
}

/** @param {string} ym @param {number} delta @returns {string} mese spostato di `delta` mesi */
export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

// Seme del giorno: deterministico sulla data, così riaprendo lo svuota testa
// più volte nello stesso giorno la domanda non cambia sotto le mani.
/** @param {string} [dk] @returns {string} */
export function seedForDate(dk = dateKey()) {
  let h = 0;
  for (const ch of dk) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return SEEDS[h % SEEDS.length];
}

const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{2,30})/gu;

/** @param {string} text @returns {string[]} tag `#cosi` estratti dal testo, senza duplicati */
export function extractTags(text) {
  /** @type {string[]} */
  const out = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text || ''))) {
    const tag = m[2].toLowerCase();
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * @param {Partial<DiaryEntry> & { text: string }} input
 * @returns {DiaryEntry}
 */
export function makeEntry(input) {
  const now = new Date();
  const text = input.text || '';
  return {
    id: input.id || `d${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    ts: input.ts || now.toISOString(),
    date: input.date || dateKey(now),
    type: input.type || 'libero',
    text,
    mood: input.mood ?? null,
    energy: input.energy ?? null,
    tags: input.tags?.length ? input.tags : extractTags(text),
    gratitude: (input.gratitude || []).filter(g => g.trim()),
    answers: input.answers || null,
    seed: input.seed || null,
    sealed: !!input.sealed,
  };
}

// Il rituale della sera è un insieme di risposte brevi: si conserva sia la
// struttura (per riproporla in lettura) sia un testo lineare, che è quello su
// cui lavorano ricerca ed export verso l'AI.
/**
 * @param {Record<string, string>} answers
 * @returns {string}
 */
export function eveningText(answers) {
  return EVENING_QUESTIONS
    .filter(q => (answers[q.key] || '').trim())
    .map(q => `${q.label}\n${answers[q.key].trim()}`)
    .join('\n\n');
}

/**
 * @param {DiaryEntry[]} entries
 * @param {{ query?: string, tag?: string|null, includeSealed?: boolean }} [opts]
 * @returns {DiaryEntry[]} ordinate dalla più recente
 */
export function filterEntries(entries, opts = {}) {
  const q = (opts.query || '').trim().toLowerCase();
  return (entries || [])
    .filter(e => (opts.includeSealed ? true : !e.sealed))
    .filter(e => (opts.tag ? (e.tags || []).includes(opts.tag) : true))
    .filter(e => !q || `${e.text} ${(e.tags || []).join(' ')} ${(e.gratitude || []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** @param {DiaryEntry[]} entries @returns {string[]} tag usati, dal più frequente */
export function allTags(entries) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of entries || []) for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

/**
 * Voci degli ultimi `days` giorni (oggi incluso).
 * @param {DiaryEntry[]} entries
 * @param {number} days
 * @returns {DiaryEntry[]}
 */
export function lastDays(entries, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffKey = dateKey(cutoff);
  return (entries || []).filter(e => e.date >= cutoffKey);
}

// ── Export per l'AI ─────────────────────────────────────────────────────────
// I preset non sono "prompt magici": sono il modo di dire all'AI che tipo di
// ascolto serve. Ognuno chiude chiedendo franchezza sui segnali seri, perché
// un diario incollato a un modello non è (e non deve fingersi) una terapia.

export const AI_PRESETS = [
  {
    id: 'ascolto',
    label: 'Ascolto',
    ask: 'Vorrei essere ascoltato, non risolto. Ti chiedo supporto psicologico nel senso più semplice: farmi sentire capito e aiutarmi a vedere più chiaro.',
    how: [
      'Rispecchia con parole tue quello che leggi, senza addolcirlo.',
      'Non darmi consigli o soluzioni finché non te li chiedo esplicitamente.',
      'Chiudi con una sola domanda, quella che secondo te sto evitando.',
    ],
  },
  {
    id: 'pattern',
    label: 'Pattern nel tempo',
    ask: 'Vorrei che leggessi queste voci come una serie, non come episodi isolati, e mi aiutassi a vedere cosa si ripete.',
    how: [
      'Indica 3 temi ricorrenti, ognuno con una breve citazione dal diario.',
      'Nota le correlazioni con umore ed energia, se ce ne sono.',
      'Dimmi che cosa è cambiato rispetto alle voci più vecchie.',
    ],
  },
  {
    id: 'pensieri',
    label: 'Pensieri e distorsioni',
    ask: "Vorrei capire come mi sto raccontando le cose: dove sto generalizzando, catastrofizzando o dandomi colpe che non sono mie.",
    how: [
      'Individua le distorsioni cognitive, citando la frase in cui compaiono.',
      'Proponi per ognuna una riformulazione più aderente ai fatti, senza toni motivazionali.',
      'Segnala anche dove invece sto vedendo giusto.',
    ],
  },
  {
    id: 'spirituale',
    label: 'Svuota testa / spirituale',
    ask: 'Non cerco analisi: cerco un compagno di silenzio che mi aiuti a posare quello che sto trattenendo.',
    how: [
      'Restituiscimi in poche righe cosa senti che sto portando, senza interpretare troppo.',
      'Aiutami a distinguere cosa dipende da me e cosa no.',
      'Proponimi un solo esercizio breve per stasera (respiro, scrittura, camminata).',
    ],
  },
];

/** @param {string} isoDate 'YYYY-MM-DD' @returns {string} */
export function humanDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** @param {any} bussolaDoc @returns {string} */
function bussolaSummary(bussolaDoc) {
  const sections = bussolaDoc?.sections || [];
  return sections
    .filter(/** @param {any} s */ s => (s.content || '').trim())
    .map(/** @param {any} s */ s => `### ${s.title}\n${s.content.trim()}`)
    .join('\n\n');
}

/**
 * Compone il markdown da incollare in una chat AI.
 * @param {{
 *   entries: DiaryEntry[],
 *   preset?: typeof AI_PRESETS[number],
 *   bussola?: any,
 *   periodLabel?: string,
 * }} opts
 * @returns {string}
 */
export function buildAiExport({ entries, preset, bussola, periodLabel }) {
  const chosen = preset || AI_PRESETS[0];
  const sorted = [...(entries || [])].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const out = [];

  out.push('# Contesto');
  out.push(
    'Quello che segue è un estratto del mio diario personale, scritto per me stesso e ' +
    'non per essere letto: il tono è grezzo, a volte contraddittorio. Te lo condivido ' +
    'io, volontariamente.'
  );

  const bus = bussolaSummary(bussola);
  if (bus) {
    out.push('\n## Chi sono, con le mie parole\n');
    out.push(bus);
  }

  out.push('\n# Cosa ti chiedo\n');
  out.push(chosen.ask);

  out.push(`\n# Diario${periodLabel ? ` — ${periodLabel}` : ''} (${sorted.length} ${sorted.length === 1 ? 'voce' : 'voci'})`);
  if (!sorted.length) {
    out.push('\n_(nessuna voce nel periodo selezionato)_');
  }
  for (const e of sorted) {
    /** @type {string[]} */
    const meta = [DIARY_TYPES[e.type]?.label || e.type];
    if (e.mood) meta.push(`umore ${e.mood}/5 (${MOOD_LABELS[e.mood]})`);
    if (e.energy) meta.push(`energia ${e.energy}/5 (${ENERGY_LABELS[e.energy]})`);
    if (e.tags?.length) meta.push(e.tags.map(t => `#${t}`).join(' '));
    out.push(`\n## ${humanDate(e.date)} — ${meta.join(' · ')}`);
    if (e.seed) out.push(`_Domanda del giorno: ${e.seed}_\n`);
    out.push(e.text.trim() || '_(voce senza testo)_');
    if (e.gratitude?.length) {
      out.push('\n**Gratitudine**');
      for (const g of e.gratitude) out.push(`- ${g}`);
    }
  }

  out.push('\n# Come vorrei che mi rispondessi\n');
  chosen.how.forEach((h, i) => out.push(`${i + 1}. ${h}`));
  out.push(
    `${chosen.how.length + 1}. Se leggi segnali che ti preoccupano davvero, dimmelo con franchezza ` +
    'invece di rassicurarmi.'
  );

  return out.join('\n');
}
