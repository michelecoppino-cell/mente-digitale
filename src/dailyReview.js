// Daily Review senza AI: euristiche locali, gratuite e deterministiche per
// individuare candidati a diventare task, sia da email Outlook che da pagine
// OneNote — nessuna chiamata a servizi esterni, nessun costo.

// ── Email ───────────────────────────────────────────────────────────────────
// Non potendo "riassumere" con un LLM, si presenta l'oggetto originale come
// titolo del task (modificabile dall'utente prima di crearlo): il lavoro
// dell'euristica è scegliere QUALI email meritano attenzione, non riscriverle.

const NOISE_SENDER_RE = /no-?reply|notifications?|newsletter|mailer-daemon|do-?not-?reply|automated|marketing/i;
const NOISE_SUBJECT_RE = /unsubscribe|iscriviti|newsletter|% di sconto|saldi|offerta speciale|digest settimanale/i;

const ACTION_KEYWORDS = [
  'entro il', 'entro oggi', 'entro domani', 'scaden', 'per favore', 'per cortesia',
  'potresti', 'puoi', 'potete', 'serve', 'conferma', 'invia', 'manda', 'urgente',
  'follow up', 'ricorda', 'reminder', 'deadline', 'asap', 'azione richiesta',
  'action required', 'richiesta', 'da fare', 'revisiona', 'rivedi', 'approvazione',
  'in attesa di', 'firmare', 'firma',
];

export function extractEmailCandidates(emails, max = 6) {
  return (emails || [])
    .map(e => {
      const from = (e.from?.emailAddress?.address || e.from || '').toLowerCase();
      const subject = e.subject || '';
      const preview = e.bodyPreview || '';
      const haystack = `${subject} ${preview}`.toLowerCase();

      if (!subject.trim()) return null;
      if (NOISE_SENDER_RE.test(from) || NOISE_SUBJECT_RE.test(haystack)) return null;

      let score = e.isRead ? 0 : 1;
      for (const kw of ACTION_KEYWORDS) if (haystack.includes(kw)) score += 1;
      if (subject.trim().endsWith('?')) score += 1;
      if (score === 0) return null;

      return {
        source: 'email',
        title: subject,
        meta: from,
        extractedAction: subject.trim().slice(0, 120),
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// ── OneNote ─────────────────────────────────────────────────────────────────
// Riusa il tag nativo "Da fare" di OneNote (scorciatoia Ctrl+1): quando lo
// applichi a una riga durante una riunione, quella riga diventa automaticamente
// un candidato task — segnale esplicito e affidabile al 100%, l'utente ha già
// deciso lui stesso che quella riga è un'azione. Nessuna euristica necessaria,
// nessun testo "indovinato". Richiede solo l'abitudine di taggare le righe
// azionabili mentre si prendono appunti.
const TODO_PARAGRAPH_RE = /<p[^>]*data-tag="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi;

function stripInlineHtml(fragment) {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractOneNoteCandidates(pagesWithHtml, max = 8) {
  const out = [];
  for (const p of (pagesWithHtml || [])) {
    const html = p.html || '';
    TODO_PARAGRAPH_RE.lastIndex = 0;
    let m;
    while ((m = TODO_PARAGRAPH_RE.exec(html))) {
      const tag = m[1] || '';
      if (!tag.includes('to-do') || tag.includes('completed')) continue;
      const text = stripInlineHtml(m[2]);
      if (!text) continue;
      out.push({
        source: 'onenote',
        title: p.title || 'Senza titolo',
        meta: p.lastModifiedDateTime ? p.lastModifiedDateTime.slice(0, 10) : '',
        extractedAction: text.slice(0, 120),
      });
    }
  }
  return out.slice(0, max);
}
