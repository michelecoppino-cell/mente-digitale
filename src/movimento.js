// @ts-check
// Movimento: allenamento, meditazione e yoga.
//
// Qui c'è solo la logica pura — famiglie, striscia, totali della settimana,
// scala delle barre. Le letture e le scritture stanno in api.js (un file JSON
// per mese su OneDrive, come il Diario); il disegno sta in MovimentoCard.
//
// La separazione che regge tutto il resto: **il calendario tiene i programmi,
// questo registro tiene quello che è successo**. Una sessione prevista è un
// evento del calendario «Allenamenti» e non entra mai qui finché non viene
// registrata; una sessione registrata porta con sé l'id dell'evento che
// soddisfa (`daEvento`), così non le si chiede due volte se è stata fatta.
// Senza quel campo la stessa palestra comparirebbe due volte in settimana:
// una tratteggiata e una piena.

/**
 * Le tre famiglie, con i tipi che si scelgono davvero al momento di
 * registrare.
 *
 * Famiglia e tipo sono campi distinti perché rispondono a due domande diverse:
 * la famiglia decide il colore della barra e la riga di totali, il tipo è
 * quello che si tocca nel modulo. Con un campo solo, aggiungere «bici»
 * vorrebbe dire toccare ogni punto che raggruppa.
 *
 * I colori: tre tinte distinte per tonalità e chiarezza, distinguibili anche
 * senza percepire il rosso o il verde, e lontane dall'ocra dell'accento (che
 * per la regola dei token è una linea, non una campitura) e dal rosso/verde
 * semantici di errore e conferma.
 */
export const FAMIGLIE = {
  movimento: {
    label: 'Movimento',
    breve: 'Movimento',
    colore: '#c4643f',
    tipi: ['Palestra', 'Corsa', 'Bici', 'Camminata', 'Nuoto'],
    durate: [15, 30, 45, 60],
    notaEsempio: 'gambe, braccia, 6 km…',
  },
  meditazione: {
    label: 'Meditazione',
    breve: 'Medita',
    colore: '#7f8fd0',
    tipi: ['Seduta', 'Respirazione', 'Body scan'],
    durate: [5, 10, 15, 20],
    notaEsempio: 'facoltativa',
  },
  yoga: {
    label: 'Yoga',
    breve: 'Yoga',
    colore: '#4f9d8a',
    tipi: ['Flow', 'Yin', 'Mobilità'],
    durate: [20, 30, 45, 60],
    notaEsempio: 'facoltativa',
  },
};

/** @type {(keyof typeof FAMIGLIE)[]} */
export const ORDINE_FAMIGLIE = ['movimento', 'meditazione', 'yoga'];

/** Il colore di una famiglia, con una via d'uscita per i dati vecchi. */
export function coloreFamiglia(/** @type {string} */ famiglia) {
  return FAMIGLIE[/** @type {keyof typeof FAMIGLIE} */ (famiglia)]?.colore || '#868b98';
}

/** 'YYYY-MM-DD' locale. Il fuso non c'entra: è il giorno in cui l'hai fatto. */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Il mese 'YYYY-MM' di una data 'YYYY-MM-DD'. */
export function meseDi(/** @type {string} */ data) {
  return data.slice(0, 7);
}

/** Il mese precedente a 'YYYY-MM'. */
export function mesePrecedente(/** @type {string} */ ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * I sette giorni della settimana che contiene `data`, da lunedì a domenica.
 * Lunedì e non domenica: è la settimana come la conta chi vive in Italia, ed è
 * già la convenzione del Piano.
 * @param {string} data 'YYYY-MM-DD'
 * @returns {string[]}
 */
export function settimanaDi(data) {
  const d = new Date(data + 'T00:00:00');
  // getDay(): 0 = domenica. Lo spostamento per arrivare a lunedì è quindi 6
  // per la domenica e giorno-1 per tutti gli altri.
  const indice = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - indice);
  const giorni = [];
  for (let i = 0; i < 7; i++) {
    giorni.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return giorni;
}

/** Le iniziali dei giorni, nello stesso ordine di settimanaDi. */
export const INIZIALI_GIORNI = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

/**
 * Giorni consecutivi con almeno una sessione che finiscono oggi — o ieri: la
 * giornata non è finita, e azzerare la striscia alle 00:01 sarebbe una
 * punizione per qualcosa che non è ancora successo. È la stessa regola della
 * striscia del Diario, e deve restarlo: due strisce nella stessa colonna che
 * contano in modo diverso sarebbero indifendibili.
 * @param {string[]} date  'YYYY-MM-DD', anche ripetute
 * @param {string} [oggi]
 * @returns {number}
 */
export function striscia(date, oggi = ymd()) {
  const set = new Set(date);
  const cursore = new Date(oggi + 'T00:00:00');
  if (!set.has(ymd(cursore))) {
    cursore.setDate(cursore.getDate() - 1);
    if (!set.has(ymd(cursore))) return 0;
  }
  let n = 0;
  while (set.has(ymd(cursore))) {
    n++;
    cursore.setDate(cursore.getDate() - 1);
  }
  return n;
}

/**
 * Sessioni e minuti in un insieme di giorni.
 * @param {import('./types').Movimento[]} voci
 * @param {string[]} giorni
 */
export function totali(voci, giorni) {
  const set = new Set(giorni);
  let sessioni = 0;
  let minuti = 0;
  for (const v of voci) {
    if (!set.has(v.date)) continue;
    sessioni++;
    minuti += v.durataMin || 0;
  }
  return { sessioni, minuti };
}

/**
 * Sessioni e minuti per famiglia, in un insieme di giorni.
 *
 * Serve al riquadro di «Oggi», che dice «Palestra 2/3» famiglia per famiglia:
 * il totale unico non basta più, perché tre meditazioni da dieci minuti e tre
 * allenamenti da un'ora sono la stessa riga solo se non si guarda.
 * @param {import('./types').Movimento[]} voci
 * @param {string[]} giorni
 * @returns {Record<string, { sessioni: number, minuti: number }>}
 */
export function totaliPerFamiglia(voci, giorni) {
  const set = new Set(giorni);
  /** @type {Record<string, { sessioni: number, minuti: number }>} */
  const out = {};
  for (const f of ORDINE_FAMIGLIE) out[f] = { sessioni: 0, minuti: 0 };
  for (const v of voci) {
    if (!set.has(v.date)) continue;
    const riga = (out[v.famiglia] ||= { sessioni: 0, minuti: 0 });
    riga.sessioni++;
    riga.minuti += v.durataMin || 0;
  }
  return out;
}

/**
 * Il bersaglio settimanale di una famiglia: quello scelto, oppure zero.
 *
 * Zero non è «nessun dato mancante» ma una scelta legittima — chi non medita
 * non deve darsi un bersaglio di meditazione per far funzionare il riquadro —
 * e si legge come «3» senza denominatore invece che come «3/0».
 * @param {import('./types').MovimentoIndex|null} indice
 * @param {string} famiglia
 * @returns {number}
 */
export function bersaglioDi(indice, famiglia) {
  const n = indice?.bersagli?.[famiglia];
  return typeof n === 'number' && n > 0 ? Math.round(n) : 0;
}

/** "2h15", "45min" — la durata come la direbbe una persona. */
export function fmtDurata(/** @type {number} */ min) {
  if (!min) return '0min';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * Le note usate di recente, per suggerirle come tag nel modulo.
 *
 * Dopo due settimane «gambe» si sceglie con un tocco invece di riscriverlo:
 * è lo stesso servizio che destinationMru.js fa alla cattura rapida, sulla
 * stessa idea che una nota libera diventa un vocabolario da sola.
 * @param {import('./types').Movimento[]} voci
 * @param {string} famiglia
 * @param {number} [max]
 * @returns {string[]}
 */
export function noteRecenti(voci, famiglia, max = 6) {
  /** @type {string[]} */
  const viste = [];
  const ordinate = [...voci].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const v of ordinate) {
    const nota = (v.nota || '').trim();
    if (!nota || v.famiglia !== famiglia) continue;
    if (!viste.includes(nota)) viste.push(nota);
    if (viste.length >= max) break;
  }
  return viste;
}

/**
 * Altezza in pixel di un segmento, dentro una colonna alta `maxPx`.
 *
 * La scala non si adatta alla settimana ma a una soglia fissa (`PIENO_MIN`
 * minuti riempiono la colonna): con una scala relativa, una settimana da dieci
 * minuti in croce disegnerebbe le stesse barre alte di una da cinque ore, e il
 * riquadro racconterebbe una bugia consolatoria proprio nelle settimane in cui
 * serve dire la verità. Oltre la soglia si taglia: la differenza fra due ore e
 * tre in un grafico alto 44px non la vede nessuno.
 */
const PIENO_MIN = 90;
const MIN_PX = 5;

/**
 * @param {number} minuti
 * @param {number} maxPx
 * @returns {number}
 */
export function altezzaSegmento(minuti, maxPx) {
  if (!minuti) return 0;
  const q = Math.min(1, minuti / PIENO_MIN);
  return Math.max(MIN_PX, Math.round(q * maxPx));
}

/** Un id stabile e leggibile: la data più quattro caratteri di caso. */
export function nuovoId(/** @type {string} */ data) {
  return `mv_${data}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Costruisce una voce nuova, con i campi facoltativi normalizzati: chi la
 * salva non deve ricordarsi di ripulire la nota o di togliere `daEvento`
 * quando non c'è.
 * @param {{ date: string, famiglia: string, tipo: string, durataMin: number, nota?: string, daEvento?: string|null }} dati
 * @returns {import('./types').Movimento}
 */
export function nuovaVoce({ date, famiglia, tipo, durataMin, nota, daEvento }) {
  /** @type {import('./types').Movimento} */
  const voce = {
    id: nuovoId(date),
    date,
    famiglia,
    tipo,
    durataMin: Math.max(0, Math.round(durataMin || 0)),
    createdAt: new Date().toISOString(),
  };
  const pulita = (nota || '').trim();
  if (pulita) voce.nota = pulita;
  if (daEvento) voce.daEvento = daEvento;
  return voce;
}
