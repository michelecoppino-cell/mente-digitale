// @ts-check
// Da dove vengono i risultati della ricerca.
//
// Prima ce n'era una sola, e in fondo alla finestra c'era scritto: «La ricerca
// copre i dati già caricati». Era vero e onesto, e voleva dire che ⌘K non
// trovava una voce di diario, non trovava una mail, e non trovava la pagina di
// un taccuino che non si era ancora aperto in quella sessione.
//
// Le sorgenti sono ora quattro, in ordine di quanto costano:
//
//   comandi   in memoria, immediati — ⌘K non serve solo a trovare, serve a fare
//   locale    sezioni, pagine e attività già in memoria: immediato
//   diario    i file del mese su OneDrive, con la cache del query client
//   posta     Graph, su richiesta e con un respiro fra le battute
//
// Le prime due rispondono mentre si scrive, le altre due arrivano dopo e si
// aggiungono in fondo, ognuna sotto la sua intestazione. Nessuna blocca le
// altre: una ricerca che aspetta la rete per mostrare quello che ha già in mano
// è una ricerca che si smette di usare.
//
// Fuori restano i movimenti di Finanze, di proposito: stanno dietro un PIN, e
// farli comparire in un elenco globale vorrebbe dire aggirare la sola ragione
// per cui il PIN esiste.
import { searchMessages, loadDiaryIndex, loadDiaryMonth } from './api';
import { queryClient, qk, STALE } from './queryClient';
import { filterEntries, monthKey, shiftMonth, humanDate } from './diary';

/** Sotto due caratteri non si cerca: qualunque testo darebbe mille risultati. */
export const MIN_QUERY = 2;

/** Quanti caratteri prima di disturbare la rete. */
const MIN_REMOTE_QUERY = 3;

/**
 * @typedef {Object} SearchHit
 * @property {'command'|'section'|'page'|'task'|'diary'|'mail'} type
 * @property {string} id
 * @property {string} label
 * @property {string} [sub]
 * @property {string} [color]
 * @property {number} score
 * @property {any} [data]
 */

/**
 * Quanto bene una stringa risponde alla domanda. 0 = non risponde.
 * @param {string|null|undefined} text
 * @param {string} q
 * @returns {number}
 */
function score(text, q) {
  const t = (text || '').toLowerCase();
  if (!t) return 0;
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  // Inizio di parola: «bol» trova «pagare bolletta» meglio di «carambola».
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 2;
  return t.includes(q) ? 1 : 0;
}

/**
 * I comandi: quello che si può *fare* da qui. Il punteggio è alto di proposito —
 * chi scrive «diario» e preme invio vuole aprire il Diario, non la prima pagina
 * che contiene quella parola.
 *
 * @param {string} q
 * @param {{ id: string, label: string, hint?: string, keys?: string[], run: () => void }[]} commands
 * @returns {SearchHit[]}
 */
export function commandHits(q, commands) {
  /** @type {SearchHit[]} */
  const out = [];
  for (const c of commands || []) {
    const s = Math.max(score(c.label, q), score(c.hint || '', q) ? 1 : 0);
    if (s) out.push({ type: 'command', id: c.id, label: c.label, sub: c.hint, score: s + 3, data: c });
  }
  return out;
}

/**
 * Sezioni, pagine OneNote e attività già in memoria.
 * @param {string} q
 * @param {{ notebooks: any[], sectionsMap: Record<string, any[]>, pagesCache: any, tasks: any[] }} sources
 * @returns {SearchHit[]}
 */
export function localHits(q, { notebooks, sectionsMap, pagesCache, tasks }) {
  /** @type {SearchHit[]} */
  const out = [];

  for (const nb of notebooks || []) {
    for (const sec of sectionsMap?.[nb.id] || []) {
      const s = score(sec.displayName, q);
      if (s) {
        out.push({
          type: 'section', id: `sec:${sec.id}`, label: sec.displayName,
          sub: nb.displayName, color: sec._color || nb._color, score: s + 1,
          data: { section: sec, nb },
        });
      }
      for (const p of pagesCache?.current?.[sec.id] || []) {
        const ps = score(p.title, q);
        if (ps) {
          out.push({
            type: 'page', id: `page:${p.id}`, label: p.title || 'Senza titolo',
            sub: `${nb.displayName} › ${sec.displayName}`, color: nb._color, score: ps,
            data: { page: p },
          });
        }
      }
    }
  }

  for (const t of tasks || []) {
    const s = score(t.title, q);
    if (s) {
      out.push({
        type: 'task', id: `task:${t.id}`, label: t.title,
        sub: t._listName, score: s + (t.importance === 'high' ? 1 : 0),
        data: { task: t },
      });
    }
  }

  return out;
}

/**
 * Le sezioni di cui non si è ancora mai caricato l'elenco pagine.
 *
 * Serve a chiudere il buco dichiarato nella vecchia nota in fondo alla finestra:
 * cercare è anche il momento in cui si scopre che metà dell'archivio non è in
 * memoria. Chi chiama passa questi id alla coda di precarico, e i risultati
 * compaiono man mano che arrivano.
 *
 * @param {{ notebooks: any[], sectionsMap: Record<string, any[]>, pagesCache: any }} sources
 * @returns {string[]}
 */
export function sectionsWithoutPages({ notebooks, sectionsMap, pagesCache }) {
  const out = [];
  for (const nb of notebooks || []) {
    for (const sec of sectionsMap?.[nb.id] || []) {
      if (!pagesCache?.current?.[sec.id]) out.push(sec.id);
    }
  }
  return out;
}

// ── Diario ──────────────────────────────────────────────────────────────────
// Due mesi, che è quanto basta per «cosa avevo scritto di…» nella maggior parte
// dei casi, e quanto si può leggere senza far aspettare. I file passano dal query
// client, quindi la seconda ricerca della giornata non tocca la rete.

const DIARY_MONTHS = 2;

/** @returns {Promise<any[]>} */
async function recentDiaryEntries() {
  const wanted = [monthKey(), shiftMonth(monthKey(), -1)].slice(0, DIARY_MONTHS);
  const index = await queryClient.fetchQuery({
    queryKey: qk.diaryIndex(),
    queryFn: loadDiaryIndex,
    staleTime: STALE.diaryStreak,
  }).catch(() => null);

  const months = wanted.filter(m => !index?.months || index.months.includes(m));
  const perMonth = await Promise.all(months.map(m => queryClient.fetchQuery({
    queryKey: qk.diaryMonth(m),
    queryFn: () => loadDiaryMonth(m),
    staleTime: STALE.diaryStreak,
  }).catch(() => [])));
  return perMonth.flat();
}

/**
 * @param {string} q
 * @returns {Promise<SearchHit[]>}
 */
export async function diaryHits(q) {
  if (q.length < MIN_REMOTE_QUERY) return [];
  const entries = await recentDiaryEntries();
  // Il filtro è quello del Diario stesso: cerca nel testo, nei tag, nelle
  // gratitudini e nelle didascalie delle foto. Le voci chiuse nel cassetto
  // restano fuori, come nella timeline.
  return filterEntries(entries, { query: q }).slice(0, 6).map(e => ({
    type: /** @type {'diary'} */ ('diary'),
    id: `diary:${e.id}`,
    label: (e.text || '').trim().split('\n')[0].slice(0, 90) || '(voce senza testo)',
    sub: humanDate(e.date),
    score: 1,
    data: { entry: e },
  }));
}

// ── Posta ───────────────────────────────────────────────────────────────────

/**
 * @param {string} q
 * @returns {Promise<SearchHit[]>}
 */
export async function mailHits(q) {
  if (q.length < MIN_REMOTE_QUERY) return [];
  const messages = await searchMessages(q, 5);
  return messages.map(m => ({
    type: /** @type {'mail'} */ ('mail'),
    id: `mail:${m.id}`,
    label: m.subject || '(senza oggetto)',
    sub: [m.from?.emailAddress?.name, m.receivedDateTime ? new Date(m.receivedDateTime).toLocaleDateString('it-IT') : null]
      .filter(Boolean).join(' · '),
    score: 1,
    data: { message: m },
  }));
}

/** L'ordine in cui le famiglie di risultati compaiono. */
export const GROUP_ORDER = ['command', 'section', 'page', 'task', 'diary', 'mail'];

/** @type {Record<string, string>} */
export const GROUP_LABELS = {
  command: 'Comandi',
  section: 'Sezioni',
  page: 'Pagine OneNote',
  task: 'Attività',
  diary: 'Diario',
  mail: 'Posta',
};

/**
 * Mette in fila i risultati: per famiglia nell'ordine sopra, e dentro ciascuna
 * per punteggio. Il risultato è piatto — la navigazione con le frecce attraversa
 * le intestazioni senza fermarsi.
 * @param {SearchHit[]} hits
 * @param {number} [cap]
 * @returns {SearchHit[]}
 */
export function orderHits(hits, cap = 24) {
  return [...hits]
    .sort((a, b) => {
      const g = GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type);
      if (g) return g;
      if (b.score !== a.score) return b.score - a.score;
      return a.label.localeCompare(b.label, 'it');
    })
    .slice(0, cap);
}
