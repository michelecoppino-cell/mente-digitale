// @ts-check
// «Da leggere e vedere»: libri, serie, film, corsi, articoli e PDF, in un
// elenco solo.
//
// Erano due cose separate nella testa prima ancora che nell'app — le letture
// in corso da una parte, i link messi da parte dall'altra — ma la domanda che
// ci si fa è una: *cosa avevo detto che volevo leggere o vedere?*. Un libro a
// pagina 142 e un articolo salvato ieri rispondono alla stessa domanda, e
// tenerli in due posti vuol dire che uno dei due non si guarda mai.
//
// Qui c'è solo logica pura. Il file sta su OneDrive (`coda.json`, un elenco
// unico: qualche decina di righe, che non è un dato che cresce senza fine —
// quello che è finito si toglie, ed è metà del senso di una coda).
//
// Tre stati e non due: `corso` è quello che si sta leggendo adesso — al
// massimo una manciata di cose — `coda` è quello che aspetta, `finito` è la
// memoria di quello che è stato letto. Senza `finito` la sola via d'uscita
// sarebbe cancellare, e cancellare un libro appena finito è la ragione per cui
// gli elenchi di letture non dicono mai quanto si è letto.

/** @typedef {import('./types').VoceCoda} VoceCoda */

/**
 * I tipi, con l'unità di misura del loro avanzamento.
 *
 * L'unità non è decorazione: «142/312» su un libro sono pagine, su una serie
 * sono episodi, e scriverlo cambia se il numero si capisce a colpo d'occhio o
 * va interpretato.
 */
export const TIPI = {
  libro:     { label: 'libro',     unita: 'pagine',  prefisso: '' },
  serie:     { label: 'serie',     unita: 'episodi', prefisso: 'ep ' },
  film:      { label: 'film',      unita: '',        prefisso: '' },
  corso:     { label: 'corso',     unita: 'lezioni', prefisso: '' },
  articolo:  { label: 'articolo',  unita: '',        prefisso: '' },
  pdf:       { label: 'pdf',       unita: 'pagine',  prefisso: '' },
};

/** @type {(keyof typeof TIPI)[]} */
export const ORDINE_TIPI = ['libro', 'serie', 'film', 'corso', 'articolo', 'pdf'];

/** Quante voci «in corso» e quante «in coda» stanno nel riquadro di Oggi. */
export const MAX_IN_CORSO = 3;
export const MAX_IN_CODA = 7;

/** L'etichetta del tipo, con una via d'uscita per i dati scritti a mano. */
export function etichettaTipo(/** @type {string} */ tipo) {
  return TIPI[/** @type {keyof typeof TIPI} */ (tipo)]?.label || tipo || 'voce';
}

/**
 * Il dominio di un link, senza «www.» — è quello che si legge a destra di un
 * articolo in coda, e dice da solo se è una cosa da leggere in due minuti o
 * una lettura seria.
 * @param {string|undefined} url
 * @returns {string}
 */
export function dominio(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * L'avanzamento come si legge: «142/312», «ep 3/5», «4/9». Vuoto se la voce
 * non tiene il conto — non tutto si misura, e un film è finito o non lo è.
 * @param {VoceCoda} v
 */
export function etichettaAvanzamento(v) {
  const a = v.avanzamento;
  if (!a || !a.totale) return '';
  const prefisso = TIPI[/** @type {keyof typeof TIPI} */ (v.tipo)]?.prefisso || '';
  return `${prefisso}${a.fatti || 0}/${a.totale}`;
}

/** Quanto è avanti una voce, da 0 a 1. Senza conteggio vale 0. */
export function quota(/** @type {VoceCoda} */ v) {
  const a = v.avanzamento;
  if (!a || !a.totale) return 0;
  return Math.min(1, Math.max(0, (a.fatti || 0) / a.totale));
}

/**
 * Le voci in corso, dalla più avanti alla più indietro.
 *
 * L'ordine è quello e non «l'ultima toccata» perché la riga in cima è quella
 * che si finisce prima, e finire è l'unico modo in cui una coda si accorcia.
 * @param {VoceCoda[]} voci
 * @returns {VoceCoda[]}
 */
export function inCorso(voci) {
  return (voci || [])
    .filter(v => v.stato === 'corso')
    .sort((a, b) => quota(b) - quota(a));
}

/**
 * Le voci in attesa, dall'ultima aggiunta alla prima.
 *
 * Dal più recente e non dal più vecchio: quello che si è salvato ieri è quello
 * che ancora interessa. Il fondo della coda invecchia, e va bene così — è lì
 * che si va a potare.
 * @param {VoceCoda[]} voci
 * @returns {VoceCoda[]}
 */
export function inCoda(voci) {
  return (voci || [])
    .filter(v => v.stato === 'coda')
    .sort((a, b) => (b.aggiunto || '').localeCompare(a.aggiunto || ''));
}

/** Le voci finite, dalla più recente: la memoria di quello che è stato letto. */
export function finite(voci) {
  return (voci || [])
    .filter(v => v.stato === 'finito')
    .sort((a, b) => (b.aggiunto || '').localeCompare(a.aggiunto || ''));
}

/** Un id stabile e leggibile, come quelli del Movimento e degli obiettivi. */
export function nuovoId() {
  return `cd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Una voce nuova, coi campi facoltativi normalizzati.
 * @param {{ titolo: string, tipo?: string, fonte?: string, url?: string, stato?: string,
 *           fatti?: number, totale?: number }} dati
 * @returns {VoceCoda}
 */
export function nuovaVoce({ titolo, tipo = 'articolo', fonte = '', url = '', stato = 'coda', fatti = 0, totale = 0 }) {
  /** @type {VoceCoda} */
  const v = {
    id: nuovoId(),
    titolo: (titolo || '').trim(),
    tipo,
    stato: /** @type {any} */ (stato),
    aggiunto: new Date().toISOString(),
  };
  if (fonte.trim()) v.fonte = fonte.trim();
  if (url.trim()) v.url = url.trim();
  if (totale > 0) {
    v.avanzamento = {
      fatti: Math.max(0, Math.round(fatti || 0)),
      totale: Math.round(totale),
      unita: TIPI[/** @type {keyof typeof TIPI} */ (tipo)]?.unita || '',
    };
  }
  return v;
}

/**
 * Una voce ricavata da un link incollato: il dominio diventa la fonte, e
 * l'ultimo pezzo dell'indirizzo il titolo di partenza.
 *
 * Non si scarica la pagina per leggerne il titolo vero: vorrebbe dire una
 * richiesta a un sito qualunque da dentro l'app, e tutto il resto dei dati
 * personali non esce dal giro browser ↔ Microsoft. Un titolo così è brutto ma
 * riconoscibile, e si corregge scrivendoci sopra.
 * @param {string} url
 * @returns {VoceCoda}
 */
export function daUrl(url) {
  const host = dominio(url);
  let coda = '';
  try {
    coda = decodeURIComponent(new URL(url).pathname)
      .split('/').filter(Boolean).pop() || '';
  } catch { /* un indirizzo che non si legge resta senza titolo */ }
  const titolo = coda
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return nuovaVoce({
    titolo: titolo ? titolo[0].toUpperCase() + titolo.slice(1) : host || url,
    tipo: /\.pdf($|\?)/i.test(url) ? 'pdf' : 'articolo',
    fonte: host,
    url,
  });
}

/** Se una stringa è soltanto un indirizzo, e niente altro. */
export function soloUrl(/** @type {string} */ testo) {
  const t = (testo || '').trim();
  return /^https?:\/\/\S+$/i.test(t);
}
