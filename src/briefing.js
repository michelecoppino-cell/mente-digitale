// @ts-check
// Il briefing del mattino: il documento che il compito delle cinque scrive su
// OneDrive e che la scheda «Briefing» legge.
//
// Sta qui, puro e senza rete, per la stessa ragione di `programma.js`: lo
// leggono in tre — la vista dell'app, il CLI e il server MCP — e una regola
// scritta in tre posti diventa tre regole diverse nel giro di un mese. Qui ci
// girano le prove (`npm run prova-briefing`).
//
// **Il documento è uno solo e vale un giorno.** Non se ne tiene la cronologia:
// un briefing è di stamattina o non è niente, e quello che merita di restare
// si scrive nel diario. Da qui la regola che attraversa tutto il file: prima di
// mostrare qualcosa si guarda *di che giorno è*, perché un briefing di ieri
// messo a schermo senza dirlo si legge come se fosse fresco — ed è l'unico modo
// in cui questo meccanismo può mentire.

/**
 * @typedef {object} Proposta
 * @property {string} id            stabile dentro la giornata: ci si appende l'esito
 * @property {string} titolo        cosa fare, come lo si direbbe
 * @property {string|null} attivita l'id dell'attività vera, quando la proposta ne ha una
 * @property {string|null} lista    la lista in cui quell'attività sta
 * @property {string} ora           'HH:MM' suggerita
 * @property {number} durataMin
 * @property {string} perche        perché proprio questa: è la parte che si legge davvero
 * @property {'approvata'|'scartata'|null} esito
 * @property {string|null} esitoIl
 */

/**
 * @typedef {object} Briefing
 * @property {number} version
 * @property {string} data          'YYYY-MM-DD': il giorno di cui parla
 * @property {string} scrittoIl     ISO
 * @property {string[]} fonti       cosa è stato guardato davvero
 * @property {string} giornata      com'è fatta la giornata, in prosa
 * @property {Proposta[]} proposte
 * @property {string[]} recap       gli ultimi giorni: cosa è rimasto indietro
 * @property {{ mondo: string[], europa: string[], italia: string[], friuli: string[] }} notizie
 * @property {{ professionali: string[], riflessioni: string[] }} curiosita
 * @property {string} domanda       la domanda con cui si chiude
 */

export const VERSIONE_BRIEFING = 2;

/** Oltre queste ore un briefing non è più «di stamattina», e lo si dice. */
export const ORE_PRIMA_DI_DIRLO = 18;

/** Le aree delle notizie, nell'ordine in cui si leggono: dal largo al vicino. */
export const AREE_NOTIZIE = /** @type {const} */ ([
  { chiave: 'mondo', label: 'Dal mondo' },
  { chiave: 'europa', label: "Dall'Europa" },
  { chiave: 'italia', label: "Dall'Italia" },
  { chiave: 'friuli', label: 'Dal Friuli' },
]);

/** Le due metà delle curiosità: il mestiere, e tutto il resto. */
export const AREE_CURIOSITA = /** @type {const} */ ([
  { chiave: 'professionali', label: 'Per il mestiere' },
  { chiave: 'riflessioni', label: 'Da pensarci' },
]);

/** @param {any} v @returns {string} */
const testo = v => (typeof v === 'string' ? v.trim() : '');

/** @param {any} v @returns {string[]} */
const righe = v => (Array.isArray(v) ? v.map(testo).filter(Boolean) : []);

/**
 * Porta alla forma corrente qualunque cosa si trovi nel file, compresa la
 * prima versione — che era un paragrafo solo, senza proposte né sezioni.
 *
 * Un briefing vecchio non si butta e non fa errore: diventa un briefing con la
 * sola prosa dentro. È la stessa scelta di `normalizzaTask`, e vale per la
 * stessa ragione: il file su OneDrive lo scrive una macchina che può essere
 * ferma a una versione di due settimane fa.
 *
 * @param {any} raw
 * @returns {Briefing|null} null se non c'è proprio niente da mostrare
 */
export function normalizzaBriefing(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // v1: `testo` era tutto il briefing, e non c'era altro.
  const giornata = testo(raw.giornata) || testo(raw.testo);
  const proposte = Array.isArray(raw.proposte) ? raw.proposte.map(normalizzaProposta) : [];
  const notizie = raw.notizie || {};
  const curiosita = raw.curiosita || {};

  const doc = {
    version: VERSIONE_BRIEFING,
    data: /^\d{4}-\d{2}-\d{2}$/.test(raw.data) ? raw.data : '',
    scrittoIl: testo(raw.scrittoIl),
    fonti: righe(raw.fonti),
    giornata,
    proposte,
    recap: righe(raw.recap),
    notizie: {
      mondo: righe(notizie.mondo),
      europa: righe(notizie.europa),
      italia: righe(notizie.italia),
      friuli: righe(notizie.friuli),
    },
    curiosita: {
      professionali: righe(curiosita.professionali),
      riflessioni: righe(curiosita.riflessioni),
    },
    domanda: testo(raw.domanda),
  };

  // Un documento senza niente dentro non è un briefing vuoto: è un file
  // scritto male, e mostrarlo darebbe una schermata che sembra funzionante.
  const vuoto = !doc.giornata && !doc.proposte.length && !doc.recap.length
    && !Object.values(doc.notizie).some(v => v.length)
    && !Object.values(doc.curiosita).some(v => v.length);
  return vuoto ? null : doc;
}

/** @param {any} raw @param {number} i @returns {Proposta} */
function normalizzaProposta(raw, i) {
  const durata = Number(raw?.durataMin);
  const esito = raw?.esito === 'approvata' || raw?.esito === 'scartata' ? raw.esito : null;
  return {
    // L'id lo porta il documento quando c'è; quando manca lo dà la posizione.
    // Serve stabile solo dentro la giornata — ci si appende l'esito, e il
    // documento dura fino alla notte dopo.
    id: testo(raw?.id) || `p${i + 1}`,
    titolo: testo(raw?.titolo),
    attivita: testo(raw?.attivita) || null,
    lista: testo(raw?.lista) || null,
    ora: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw?.ora || '') ? raw.ora : '',
    durataMin: Number.isFinite(durata) && durata > 0 ? Math.round(durata) : 30,
    perche: testo(raw?.perche),
    esito,
    esitoIl: esito ? (testo(raw?.esitoIl) || null) : null,
  };
}

/**
 * Quanti anni ha il briefing. Stessa regola dello specchio del calendario di
 * lavoro (`etaSpecchio`): dipende da un PC che può essere spento, e un dato che
 * può invecchiare in silenzio deve dichiarare la sua età — un briefing che
 * manca si nota, uno fermo a ieri no.
 *
 * @param {{ scrittoIl?: string }|null|undefined} doc
 * @param {Date} [adesso]
 * @returns {{ ore: number, vecchio: boolean, quando: string }|null}
 */
export function etaBriefing(doc, adesso = new Date()) {
  const quando = typeof doc?.scrittoIl === 'string' ? doc.scrittoIl : '';
  if (!quando) return null;
  const t = new Date(quando).getTime();
  if (Number.isNaN(t)) return null;
  const ore = Math.max(0, Math.round((adesso.getTime() - t) / 3_600_000));
  return { ore, vecchio: ore >= ORE_PRIMA_DI_DIRLO, quando };
}

/**
 * Il briefing è di questo giorno? È il controllo che sta davanti a tutto:
 * quello di ieri si può leggere, ma solo sapendo che è di ieri.
 * @param {{ data?: string }|null|undefined} doc
 * @param {string} giorno 'YYYY-MM-DD'
 */
export function eDelGiorno(doc, giorno) {
  return !!doc?.data && doc.data === giorno;
}

/**
 * Le proposte ancora da decidere, e il conto di quelle chiuse.
 * @param {Briefing|null|undefined} doc
 */
export function contaProposte(doc) {
  const tutte = doc?.proposte || [];
  return {
    aperte: tutte.filter(p => !p.esito),
    approvate: tutte.filter(p => p.esito === 'approvata').length,
    scartate: tutte.filter(p => p.esito === 'scartata').length,
    totale: tutte.length,
  };
}

/**
 * Il documento con l'esito di una proposta scritto dentro. **Puro**: non
 * salva niente, restituisce il documento nuovo — chi chiama decide se e quando
 * scriverlo su OneDrive.
 *
 * L'esito sta nel briefing e non altrove perché dura quanto lui: il documento
 * viene riscritto ogni notte, e una proposta scartata stamattina non ha nessun
 * motivo di sopravvivere a domani.
 *
 * @param {Briefing} doc
 * @param {string} idProposta
 * @param {'approvata'|'scartata'|null} esito  null rimette la proposta in gioco
 * @param {Date} [adesso]
 * @returns {Briefing}
 */
export function conEsito(doc, idProposta, esito, adesso = new Date()) {
  return {
    ...doc,
    proposte: (doc.proposte || []).map(p => (
      p.id === idProposta
        ? { ...p, esito, esitoIl: esito ? adesso.toISOString() : null }
        : p
    )),
  };
}

// ── Dal briefing al piano ────────────────────────────────────────────────────
// L'approvazione è l'unico punto in cui il briefing tocca qualcosa: mette un
// blocco nel piano del giorno, con le stesse funzioni con cui lo mette il
// Piano. Niente ci finisce da solo — è la regola di tutta questa scheda, e il
// motivo per cui le proposte sono proposte e non un piano già scritto.

/** @param {string} hhmm @returns {number} minuti dalla mezzanotte */
export function inMinuti(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** @param {number} min @returns {string} 'HH:MM' */
export function inOra(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * La prima ora libera per una proposta, a partire da quella suggerita.
 *
 * Serve perché fra la notte e il momento in cui si approva possono essere
 * successe due cose — una riunione nuova, un blocco messo a mano — e l'ora
 * proposta alle cinque può non essere più libera. Due blocchi accavallati sono
 * un errore e non una sovrapposizione da disegnare (è la regola del Piano da
 * fuori), quindi invece di rifiutare si scende al primo buco che ci sta: chi
 * approva vuole quell'attività nella giornata, non a quell'ora esatta.
 *
 * @param {{ startTime: string, endTime: string }[]} blocchi  i blocchi già nel giorno
 * @param {string} oraPreferita 'HH:MM'
 * @param {number} durataMin
 * @param {{ fino?: string }} [opts] oltre quest'ora non si cerca più (default 22:00)
 * @returns {string|null} 'HH:MM', o null se nella giornata non ci sta
 */
export function primaOraLibera(blocchi, oraPreferita, durataMin, opts = {}) {
  const fine = inMinuti(opts.fino || '22:00');
  let inizio = inMinuti(oraPreferita);
  if (!Number.isFinite(inizio)) inizio = inMinuti('09:00');

  const occupati = (blocchi || [])
    .map(b => ({ da: inMinuti(b.startTime), a: inMinuti(b.endTime) }))
    .filter(o => Number.isFinite(o.da) && Number.isFinite(o.a))
    .sort((x, y) => x.da - y.da);

  let cursore = inizio;
  // Si scorre in avanti: al primo scontro ci si sposta subito dopo il blocco
  // che lo causa, e si riprova. Gli intervalli sono pochissimi (una giornata),
  // quindi il giro semplice è anche il più leggibile.
  for (let giri = 0; giri < 64; giri++) {
    if (cursore + durataMin > fine) return null;
    const scontro = occupati.find(o => o.da < cursore + durataMin && cursore < o.a);
    if (!scontro) return inOra(cursore);
    cursore = scontro.a;
  }
  return null;
}

/**
 * Il blocco del piano che nasce da una proposta approvata. La forma è quella
 * che scrivono il Piano e la plancia delle Sezioni — stesso file, stessi campi:
 * il titolo e la lista si copiano adesso, perché il blocco è lo storico della
 * giornata e non deve cambiare se poi il task viene rinominato.
 *
 * @param {Proposta} proposta
 * @param {string} ora 'HH:MM' definitiva (vedi primaOraLibera)
 * @param {string} id  l'id del blocco, che lo dà chi chiama
 * @returns {any}
 */
export function bloccoDaProposta(proposta, ora, id) {
  const inizio = inMinuti(ora);
  return {
    id,
    taskId: proposta.attivita || null,
    taskTitle: proposta.titolo,
    listId: null,
    listName: proposta.lista || null,
    projectKey: null,
    projectColor: null,
    startTime: ora,
    endTime: inOra(inizio + proposta.durataMin),
    completed: false,
    completedAt: null,
    subSteps: [],
  };
}

/**
 * Quante cose ci sono da leggere, per dire in una riga se vale la pena aprire.
 * @param {Briefing|null|undefined} doc
 */
export function quantoCE(doc) {
  const notizie = Object.values(doc?.notizie || {}).reduce((n, v) => n + v.length, 0);
  const curiosita = Object.values(doc?.curiosita || {}).reduce((n, v) => n + v.length, 0);
  return { notizie, curiosita, proposte: (doc?.proposte || []).length };
}
