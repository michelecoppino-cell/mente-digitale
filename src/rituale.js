// @ts-check
// Il rituale del mattino: movimento, meditazione e yoga.
//
// Sono le tre cose che vanno fatte appena svegli, e quindi le tre cose su cui
// alle nove di sera non ci si ricorda più di aver risposto. Il registro del
// Movimento le sa contare benissimo, ma sa contare solo quello che è successo:
// un mese con quattro allenamenti e ventisei silenzi è indistinguibile da un
// mese in cui la scheda non è stata aperta.
//
// Da qui le due idee di questo file:
//
// 1. **Si risponde tutti i giorni, anche di no.** Il pannello si apre da solo
//    alla prima apertura della giornata, con le tre caselle già despuntate e
//    la motivazione già scelta: «non ho fatto, non sono riuscito» è la
//    risposta più frequente, e va confermata con un tocco solo. Dire di no è
//    un dato, non un buco.
//
// 2. **La verità resta una sola.** Spuntare una casella non scrive «fatto»
//    qui dentro e basta: scrive una sessione vera nel registro del Movimento
//    (con `daRituale`, così despuntandola si può togliere), che è quello da cui
//    la scheda Movimento e gli obiettivi del mese prendono i loro numeri. Qui
//    resta solo quello che il registro non sa dire: il perché di un no.
//
// Logica pura: la lettura e la scrittura stanno in api.js (`rituale.json`), il
// disegno in RitualeMattino.jsx.
import { FAMIGLIE, ORDINE_FAMIGLIE, nuovaVoce, ymd } from './movimento.js';

/**
 * Le motivazioni, nell'ordine della tendina. La prima è quella scelta di
 * default: non è la più nobile, è la più frequente — e le altre tre sono le
 * ragioni che si ripetono, averle a portata di tendina è quello che trasforma
 * un «no» in un dato invece che in un rimprovero.
 */
export const MOTIVI = [
  { chiave: 'non-riuscito', etichetta: 'Non sono riuscito' },
  { chiave: 'tardi',        etichetta: 'Sono andato a dormire troppo tardi' },
  { chiave: 'lavoro',       etichetta: 'Lavorato' },
  { chiave: 'claude',       etichetta: 'Claude' },
];

export const MOTIVO_DEFAULT = MOTIVI[0].chiave;

/** L'etichetta di una motivazione, con una via d'uscita per i dati vecchi. */
export function etichettaMotivo(/** @type {string} */ chiave) {
  return MOTIVI.find(m => m.chiave === chiave)?.etichetta || MOTIVI[0].etichetta;
}

/**
 * Quanti giorni indietro si recuperano quando la scheda non viene aperta.
 *
 * Tre e non trenta: oltre, ricostruire a memoria com'è andato un mercoledì è
 * un esercizio di fantasia, e un registro che contiene fantasie non serve più
 * a niente. Quello che sta più indietro resta semplicemente senza risposta.
 */
export const MAX_GIORNI_SCOPERTI = 3;

/** La data 'YYYY-MM-DD' di `n` giorni prima di `data`. */
export function giornoPrima(/** @type {string} */ data, /** @type {number} */ n = 1) {
  const d = new Date(data + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/**
 * I giorni passati senza risposta, dal più vecchio al più recente, al massimo
 * `max`. Oggi non c'è dentro: oggi è la riga principale del pannello, non un
 * buco da tappare.
 * @param {Record<string, import('./types').RitualeGiorno>} doc
 * @param {string} oggi
 * @param {number} [max]
 * @returns {string[]}
 */
export function giorniScoperti(doc, oggi, max = MAX_GIORNI_SCOPERTI) {
  const fuori = [];
  for (let i = 1; i <= max; i++) {
    const g = giornoPrima(oggi, i);
    if (!doc?.[g]) fuori.push(g);
  }
  return fuori.reverse();
}

/** "un", "due", "tre" — i numeri piccoli si dicono, non si scrivono in cifre. */
const A_PAROLE = ['zero', 'un', 'due', 'tre'];

/**
 * La frase che dichiara il recupero. Serve che sia esplicita: un registro che
 * si compila da solo senza dirlo è un registro di cui non ci si fida più.
 * @param {string[]} giorni
 * @returns {string}
 */
export function fraseScoperti(giorni) {
  if (!giorni.length) return '';
  const n = giorni.length;
  const quanti = A_PAROLE[n] || String(n);
  const elenco = giorni
    .map(g => new Date(g + 'T00:00:00')
      .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })
      .replace('.', ''))
    .join(', ');
  return `Non aperto da ${quanti} ${n === 1 ? 'giorno' : 'giorni'}: ${elenco} ${n === 1 ? 'compilato' : 'compilati'} come «non fatto». Correggi qui sotto quello che invece hai fatto.`;
}

/**
 * Le sessioni registrate di un giorno, per famiglia.
 * @param {import('./types').Movimento[]} voci
 * @param {string} data
 * @returns {Record<string, import('./types').Movimento[]>}
 */
export function sessioniDelGiorno(voci, data) {
  /** @type {Record<string, import('./types').Movimento[]>} */
  const out = {};
  for (const f of ORDINE_FAMIGLIE) out[f] = [];
  for (const v of voci || []) {
    if (v.date !== data) continue;
    (out[v.famiglia] ||= []).push(v);
  }
  return out;
}

/** La durata proposta per una sessione nata da una casella: la stessa che il
 *  modulo del Movimento propone di default, cioè la seconda della sua scala. */
export function durataDefault(/** @type {string} */ famiglia) {
  const durate = FAMIGLIE[/** @type {keyof typeof FAMIGLIE} */ (famiglia)]?.durate || [30];
  return durate[Math.min(1, durate.length - 1)];
}

/** Il tipo proposto per una sessione nata da una casella: il primo della sua
 *  famiglia, che è anche il più frequente (Palestra, Seduta, Flow). */
export function tipoDefault(/** @type {string} */ famiglia) {
  return FAMIGLIE[/** @type {keyof typeof FAMIGLIE} */ (famiglia)]?.tipi[0] || 'Sessione';
}

/**
 * Lo stato iniziale del pannello per un giorno: quello che dice il registro,
 * e per il resto la risposta di default («non fatto, non sono riuscito»).
 *
 * Ogni riga porta con sé anche il **cosa** e il **quanto** che la sessione
 * avrà se la casella viene spuntata: i due campi compaiono nel pannello solo a
 * casella spuntata, ma i loro valori esistono da subito — altrimenti spuntare
 * e salvare di fretta, senza toccarli, scriverebbe una sessione senza tipo e
 * senza minuti.
 *
 * Il registro vince sul file del rituale, sempre: se una sessione è stata
 * registrata dalla scheda Movimento dopo aver risposto «no» la mattina, la
 * casella deve risultare spuntata — la sessione è un fatto, la risposta della
 * mattina era una previsione.
 * @param {Record<string, import('./types').RitualeGiorno>} doc
 * @param {import('./types').Movimento[]} voci
 * @param {string} data
 * @returns {Record<string, {fatto: boolean, motivo: string, registrate: number, tipo: string, durataMin: number}>}
 */
export function statoIniziale(doc, voci, data) {
  const sessioni = sessioniDelGiorno(voci, data);
  const salvato = doc?.[data]?.famiglie || {};
  /** @type {Record<string, {fatto: boolean, motivo: string, registrate: number, tipo: string, durataMin: number}>} */
  const out = {};
  for (const f of ORDINE_FAMIGLIE) {
    const esistenti = sessioni[f] || [];
    // Se una sessione c'è già, i due campi partono dai suoi: il pannello
    // mostra quello che è scritto nel registro, non una proposta che lo
    // contraddice sotto gli occhi.
    const prima = esistenti[0];
    out[f] = {
      fatto: esistenti.length > 0 || !!salvato[f]?.fatto,
      motivo: salvato[f]?.motivo || MOTIVO_DEFAULT,
      registrate: esistenti.length,
      tipo: prima?.tipo || tipoDefault(f),
      durataMin: prima?.durataMin || durataDefault(f),
    };
  }
  return out;
}

/**
 * Il giorno «non fatto» in tutto: la risposta di default, e quella con cui si
 * tappano i giorni in cui la scheda non è stata aperta.
 * @param {boolean} [auto]
 * @returns {import('./types').RitualeGiorno}
 */
export function giornoVuoto(auto = false) {
  /** @type {Record<string, import('./types').RitualeVoce>} */
  const famiglie = {};
  for (const f of ORDINE_FAMIGLIE) famiglie[f] = { fatto: false, motivo: MOTIVO_DEFAULT };
  /** @type {import('./types').RitualeGiorno} */
  const giorno = { famiglie, compilatoIl: new Date().toISOString() };
  if (auto) giorno.auto = true;
  return giorno;
}

/**
 * Se a oggi si è già risposto, e quindi la domanda non va rifatta.
 *
 * La risposta è nel documento su OneDrive, non in un segno lasciato su questo
 * telefono, ed è questa la correzione: il pannello si apriva più volte al
 * giorno perché l'unica cosa che diceva «l'ho già chiesto» era una riga di
 * `localStorage` — che sparisce quando lo spazio finisce (ed è quello che
 * succede, vedi cachePersistenza.js), che non attraversa i dispositivi, e che
 * non viene scritta se la scheda «Oggi» si lascia senza chiudere il pannello.
 * Il documento invece è un fatto: se dentro c'è la riga di oggi, la domanda ha
 * avuto risposta — qui, o dal portatile, o stamattina prima di ricaricare.
 *
 * I giorni tappati dall'app (`auto`) non contano come risposta: sono il
 * «non fatto» messo dal recupero, e sono fatti solo per essere corretti. Oggi
 * non ne è mai uno — il recupero parte da ieri — ma la regola va scritta dove
 * si legge, non lasciata a un'invariante che qualcuno può cambiare.
 *
 * @param {Record<string, import('./types').RitualeGiorno>|null} doc
 * @param {string} oggi
 * @returns {boolean}
 */
export function giaRisposto(doc, oggi) {
  const giorno = doc?.[oggi];
  return !!giorno && !giorno.auto;
}

/**
 * Da quello che c'è nel pannello a quello che va scritto: le sessioni da
 * creare, quelle da togliere, e i giorni del rituale.
 *
 * Si tolgono **solo** le sessioni nate da una casella (`daRituale`): una
 * sessione registrata a mano ha dentro il tipo, i minuti e una nota, e
 * despuntare una casella non è un motivo abbastanza forte per buttarli. Se ne
 * resta una, il giorno risulta fatto lo stesso — e la casella si rispunta da
 * sola alla riapertura, che è la verità.
 *
 * @param {Record<string, Record<string, {fatto: boolean, motivo: string, tipo?: string, durataMin?: number}>>} stato  per data, per famiglia
 * @param {import('./types').Movimento[]} voci   il registro com'è adesso
 * @param {boolean} [auto]                       segna i giorni come compilati dall'app
 * @returns {{ giorni: Record<string, import('./types').RitualeGiorno>, daCreare: import('./types').Movimento[], daCancellare: import('./types').Movimento[] }}
 */
export function pianoSalvataggio(stato, voci, auto = false) {
  /** @type {Record<string, import('./types').RitualeGiorno>} */
  const giorni = {};
  /** @type {import('./types').Movimento[]} */
  const daCreare = [];
  /** @type {import('./types').Movimento[]} */
  const daCancellare = [];

  for (const [data, famiglie] of Object.entries(stato)) {
    const sessioni = sessioniDelGiorno(voci, data);
    /** @type {Record<string, import('./types').RitualeVoce>} */
    const righe = {};
    for (const f of ORDINE_FAMIGLIE) {
      const scelta = famiglie[f] || { fatto: false, motivo: MOTIVO_DEFAULT, tipo: '', durataMin: 0 };
      const esistenti = sessioni[f] || [];
      let restano = esistenti.length;

      if (scelta.fatto && esistenti.length === 0) {
        const voce = nuovaVoce({
          date: data,
          famiglia: f,
          tipo: scelta.tipo || tipoDefault(f),
          durataMin: scelta.durataMin || durataDefault(f),
        });
        voce.daRituale = true;
        daCreare.push(voce);
        restano = 1;
      } else if (!scelta.fatto && esistenti.length > 0) {
        const nate = esistenti.filter(v => v.daRituale);
        daCancellare.push(...nate);
        restano = esistenti.length - nate.length;
      }

      righe[f] = restano > 0
        ? { fatto: true }
        : { fatto: false, motivo: scelta.motivo || MOTIVO_DEFAULT };
    }
    /** @type {import('./types').RitualeGiorno} */
    const giorno = { famiglie: righe, compilatoIl: new Date().toISOString() };
    if (auto) giorno.auto = true;
    giorni[data] = giorno;
  }

  return { giorni, daCreare, daCancellare };
}

/**
 * Il riassunto di un giorno in una riga, per la scheda Movimento: «yoga fatto
 * · movimento, meditazione no (lavorato)».
 * @param {Record<string, import('./types').RitualeGiorno>} doc
 * @param {string} data
 * @returns {string}
 */
export function riassuntoDelGiorno(doc, data) {
  const giorno = doc?.[data];
  if (!giorno) return '';
  const fatte = ORDINE_FAMIGLIE.filter(f => giorno.famiglie?.[f]?.fatto);
  const no = ORDINE_FAMIGLIE.filter(f => giorno.famiglie?.[f] && !giorno.famiglie[f].fatto);
  const parti = [];
  if (fatte.length) {
    parti.push(`${fatte.map(f => FAMIGLIE[f].label.toLowerCase()).join(', ')} ${fatte.length === 1 ? 'fatto' : 'fatti'}`);
  }
  if (no.length) {
    // Un motivo solo anche quando i no sono tre: quasi sempre è lo stesso, e
    // tre motivi in fila su una riga sola non li legge nessuno.
    const motivo = etichettaMotivo(giorno.famiglie[no[0]].motivo || MOTIVO_DEFAULT).toLowerCase();
    parti.push(`${no.map(f => FAMIGLIE[f].label.toLowerCase()).join(', ')} no (${motivo})`);
  }
  return parti.join(' · ');
}
