// @ts-check
// Daily Review senza AI: euristiche locali, gratuite e deterministiche per
// individuare candidati a diventare task, sia da email Outlook che da pagine
// OneNote — nessuna chiamata a servizi esterni, nessun costo.
//
// ── Una proposta dice perché è una proposta ─────────────────────────────────
//
// Prima ogni riga mostrava solo l'oggetto dell'email, e chi la guardava doveva
// indovinare cosa ci facesse lì: senza il motivo, una proposta è
// indistinguibile da una riga a caso, e il gesto giusto («questa sì, questa
// no») diventa una scommessa. Il punteggio c'era già — era la somma dei
// segnali — ma restava un numero dentro il codice. Adesso i segnali si
// portano dietro il loro nome (`motivi`), il punteggio è quanti sono, e quello
// che ha fatto emergere la riga si legge nella riga stessa.

// ── Email ───────────────────────────────────────────────────────────────────
// Non potendo "riassumere" con un LLM, si presenta l'oggetto originale come
// titolo del task (modificabile dall'utente prima di crearlo): il lavoro
// dell'euristica è scegliere QUALI email meritano attenzione, non riscriverle.

const NOISE_SENDER_RE = /no-?reply|notifications?|newsletter|mailer-daemon|do-?not-?reply|automated|marketing/i;
const NOISE_SUBJECT_RE = /unsubscribe|iscriviti|newsletter|% di sconto|saldi|offerta speciale|digest settimanale/i;

/**
 * Le parole che fanno di un'email una richiesta, raggruppate per come si
 * leggono nella riga: il motivo mostrato è il nome del gruppo, non la parola
 * che ha fatto scattare il confronto. «scaden» da solo, letto in un elenco di
 * motivi, non spiega niente; «parla di una scadenza» sì.
 */
const GRUPPI_AZIONE = [
  { motivo: 'parla di una scadenza', parole: ['entro il', 'entro oggi', 'entro domani', 'scaden', 'deadline', 'in attesa di'] },
  { motivo: 'chiede qualcosa', parole: ['per favore', 'per cortesia', 'potresti', 'puoi', 'potete', 'serve', 'richiesta', 'da fare'] },
  { motivo: 'chiede di mandare o confermare', parole: ['conferma', 'invia', 'manda', 'firmare', 'firma'] },
  { motivo: 'chiede una revisione', parole: ['revisiona', 'rivedi', 'approvazione'] },
  { motivo: 'dice che è urgente', parole: ['urgente', 'asap', 'azione richiesta', 'action required'] },
  { motivo: 'è un sollecito', parole: ['follow up', 'ricorda', 'reminder'] },
];

/**
 * Quante volte lo stesso oggetto, dallo stesso mittente, fa di quel filo un
 * **flusso automatico** invece che una richiesta.
 *
 * È la regola che toglie di mezzo le mail dello specchio del calendario di
 * lavoro: il PC di lavoro si manda l'agenda ogni due ore, e nel pannello
 * comparivano cinque righe identiche intitolate «calendario» — non una
 * proposta ciascuna, la stessa proposta cinque volte, e nessuna delle cinque
 * era una cosa da fare. Il filtro non le nomina: nomina la forma che hanno
 * tutte le mail di servizio che si ripetono, qualunque oggetto abbiano.
 */
const RIPETIZIONI_FLUSSO = 3;

/**
 * L'oggetto ridotto a quello che non cambia da un invio all'altro: niente
 * date, niente ore, niente numeri, niente `Re:`/`I:`/`Fwd:`. Serve solo a
 * riconoscere due invii dello stesso filo, non si mostra da nessuna parte.
 * @param {string} subject
 * @returns {string}
 */
export function firmaOggetto(subject) {
  return String(subject || '')
    .toLowerCase()
    .replace(/^\s*((re|r|i|fw|fwd|tr|aw)\s*:\s*)+/i, '')
    .replace(/\d+/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {any} e @returns {string} l'indirizzo del mittente, minuscolo */
function indirizzoMittente(e) {
  return String(e?.from?.emailAddress?.address || e?.from || '').toLowerCase();
}

/** @param {any} e @returns {string} il nome del mittente, o l'indirizzo se non c'è */
function nomeMittente(e) {
  return String(e?.from?.emailAddress?.name || '').trim() || indirizzoMittente(e);
}

/**
 * I segnali che questa email chiede qualcosa. Vuoto vuol dire «non è una
 * proposta»: nessun segnale, nessuna riga.
 * @param {import('./types').EmailMessage} e
 * @returns {string[]}
 */
export function motiviEmail(e) {
  const subject = e.subject || '';
  const haystack = `${subject} ${e.bodyPreview || ''}`.toLowerCase();
  /** @type {string[]} */
  const motivi = [];
  if (!e.isRead) motivi.push('non letta');
  for (const g of GRUPPI_AZIONE) {
    if (g.parole.some(p => haystack.includes(p))) motivi.push(g.motivo);
  }
  if (subject.trim().endsWith('?')) motivi.push('è una domanda');
  return motivi;
}

/**
 * @param {import('./types').EmailMessage[]|null|undefined} emails
 * @param {number} [max]
 * @returns {import('./types').ReviewCandidate[]}
 */
export function extractEmailCandidates(emails, max = 6) {
  // Prima si contano i fili: mittente + oggetto ridotto alla sua firma. Serve
  // a due cose, e vanno fatte prima di guardare la singola email — un
  // messaggio da solo non può sapere di essere il quinto uguale.
  /** @type {Map<string, number>} */
  const quantiNelFilo = new Map();
  for (const e of emails || []) {
    const chiave = `${indirizzoMittente(e)}::${firmaOggetto(e.subject || '')}`;
    quantiNelFilo.set(chiave, (quantiNelFilo.get(chiave) || 0) + 1);
  }

  /** @type {Set<string>} */
  const filiGiaPresi = new Set();
  /** @type {import('./types').ReviewCandidate[]} */
  const proposte = [];

  for (const e of emails || []) {
    const subject = e.subject || '';
    if (!subject.trim()) continue;
    const mittente = indirizzoMittente(e);
    const haystack = `${subject} ${e.bodyPreview || ''}`.toLowerCase();
    if (NOISE_SENDER_RE.test(mittente) || NOISE_SUBJECT_RE.test(haystack)) continue;

    const chiave = `${mittente}::${firmaOggetto(subject)}`;
    // Un filo che si ripete tre volte o più è un flusso di servizio.
    if ((quantiNelFilo.get(chiave) || 0) >= RIPETIZIONI_FLUSSO) continue;
    // E anche sotto quella soglia, dello stesso filo si propone un messaggio
    // solo — le email arrivano già dalla più recente alla più vecchia, quindi
    // è la più recente. Due righe identiche non sono due decisioni.
    if (filiGiaPresi.has(chiave)) continue;

    const motivi = motiviEmail(e);
    if (!motivi.length) continue;
    filiGiaPresi.add(chiave);

    proposte.push({
      source: 'email',
      title: subject,
      meta: mittente,
      mittente: nomeMittente(e),
      quando: e.receivedDateTime || '',
      link: e.webLink || '',
      motivi,
      extractedAction: subject.trim().slice(0, 120),
      score: motivi.length,
    });
  }

  return proposte
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, max);
}

// ── OneNote ─────────────────────────────────────────────────────────────────
// Riusa il tag nativo "Da fare" di OneNote (scorciatoia Ctrl+1): quando lo
// applichi a una riga durante una riunione, quella riga diventa automaticamente
// un candidato task — segnale esplicito e affidabile al 100%, l'utente ha già
// deciso lui stesso che quella riga è un'azione. Nessuna euristica necessaria,
// nessun testo "indovinato". Richiede solo l'abitudine di taggare le righe
// azionabili mentre si prendono appunti.
/**
 * Il punteggio di una riga «Da fare»: sopra a quello di qualunque email,
 * perché non viene da un'euristica ma da una scelta esplicita.
 */
const SCORE_ONENOTE = 99;

const TODO_PARAGRAPH_RE = /<p([^>]*)data-tag="([^"]*)"([^>]*)>([\s\S]*?)<\/p>/gi;
const ID_ATTR_RE = /\bid="([^"]*)"/;

/** @param {string} fragment @returns {string} */
function stripInlineHtml(fragment) {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {(import('./types').Page & { html?: string })[]|null|undefined} pagesWithHtml
 * @param {number} [max]
 * @returns {import('./types').ReviewCandidate[]}
 */
export function extractOneNoteCandidates(pagesWithHtml, max = 8) {
  /** @type {import('./types').ReviewCandidate[]} */
  const out = [];
  for (const p of (pagesWithHtml || [])) {
    const html = p.html || '';
    TODO_PARAGRAPH_RE.lastIndex = 0;
    let m;
    while ((m = TODO_PARAGRAPH_RE.exec(html))) {
      const [fullMatch, preAttrs, tag, postAttrs, inner] = m;
      if (!tag.includes('to-do') || tag.includes('completed')) continue;
      const text = stripInlineHtml(inner);
      if (!text) continue;
      const idMatch = ID_ATTR_RE.exec(preAttrs) || ID_ATTR_RE.exec(postAttrs);
      out.push({
        source: 'onenote',
        title: p.title || 'Senza titolo',
        meta: p.lastModifiedDateTime ? p.lastModifiedDateTime.slice(0, 10) : '',
        quando: p.lastModifiedDateTime || '',
        // Il motivo è uno e non è un'euristica: quella riga l'ha segnata una
        // persona con Ctrl+1. Si scrive lo stesso, perché una riga senza
        // motivo, in mezzo alle altre, sembra indovinata come le altre — e il
        // punteggio la porta davanti alle email per la stessa ragione: un
        // segnale scelto a mano vale più di qualunque parola indovinata.
        motivi: ['riga «Da fare» segnata in OneNote'],
        score: SCORE_ONENOTE,
        extractedAction: text.slice(0, 120),
        pageId: p.id,
        elementId: idMatch ? idMatch[1] : null,
        originalTagHtml: fullMatch,
      });
    }
  }
  return out.slice(0, max);
}
