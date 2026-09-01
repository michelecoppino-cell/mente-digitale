// @ts-check
// Gli obiettivi del mese: da tre a sei righe che dicono dove si vuole arrivare
// entro il trentuno.
//
// Qui c'è solo logica pura — avanzamento, passo, derivazione dai registri che
// l'app già tiene. La lettura e la scrittura stanno in api.js (`obiettivi.json`
// su OneDrive, un solo file: gli obiettivi di un mese sono sei righe, e
// dodici mesi di sei righe sono ancora un file piccolo, al contrario del
// Diario e del Movimento che crescono senza fine).
//
// Le due idee che reggono il modello:
//
// 1. **Gli obiettivi sono liberi.** Non c'è un elenco di obiettivi
//    «disponibili» da cui scegliere: ogni mese si scrivono i suoi, e possono
//    essere di lavoro o di vita. Un obiettivo è un titolo, un totale e un
//    numero fatto — niente di più, perché tutto quello che si aggiunge è una
//    cosa in più da compilare il primo del mese, cioè un motivo per non
//    compilarlo affatto.
//
// 2. **Quello che l'app già conta non si conta a mano.** «Diario ogni giorno»
//    o «Palestra 12 volte» sono numeri che stanno già nel registro del Diario
//    e in quello del Movimento: chiederli di nuovo vorrebbe dire tenere due
//    verità sullo stesso fatto, e quella scritta a mano perderebbe subito.
//    Per questo un obiettivo può dichiarare una `fonte` invece del campo
//    `fatti`, e il numero si deriva a ogni apertura di «Oggi».

import { meseDi } from './tempo.js';

/** @typedef {import('./types').Obiettivo} Obiettivo */

/** Sotto i tre è un elenco della spesa, sopra i sei non è più una scelta. */
export const MIN_OBIETTIVI = 3;
export const MAX_OBIETTIVI = 6;

/**
 * Le fonti derivabili. La chiave è quello che finisce nel JSON; `etichetta` è
 * come la si sceglie nel modulo, `unita` come si legge nel riquadro.
 */
export const FONTI = {
  'movimento':             { etichetta: 'Sessioni di movimento', unita: 'sessioni' },
  'movimento:movimento':   { etichetta: 'Solo allenamenti',      unita: 'sessioni' },
  'movimento:meditazione': { etichetta: 'Solo meditazioni',      unita: 'sessioni' },
  'movimento:yoga':        { etichetta: 'Solo yoga',             unita: 'sessioni' },
  'diario':                { etichetta: 'Giorni di diario',      unita: 'giorni' },
};

/** Le fonti fisse, in ordine di modulo. Le letture si aggiungono a parte. */
export const ORDINE_FONTI = /** @type {(keyof typeof FONTI)[]} */ ([
  'movimento', 'movimento:movimento', 'movimento:meditazione', 'movimento:yoga', 'diario',
]);

/** 'YYYY-MM' del mese di una data 'YYYY-MM-DD' — vedi tempo.js. Resta
 *  esportato da qui perché è da `obiettivi` che «Oggi» lo importa. */
export { meseDi };

/** Quanti giorni ha il mese 'YYYY-MM'. */
export function giorniDelMese(/** @type {string} */ ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Quanti giorni restano, oggi compreso: «restano 5 gg» il 27 di un mese da 31.
 * Oggi compreso perché la giornata non è ancora finita, ed è la stessa scelta
 * che fa la striscia del Diario quando non azzera il conteggio a mezzanotte.
 */
export function giorniRestanti(/** @type {string} */ ym, /** @type {string} */ oggi) {
  if (meseDi(oggi) !== ym) return 0;
  return giorniDelMese(ym) - Number(oggi.slice(8, 10)) + 1;
}

/**
 * La quota di mese già passata, da 0 a 1: è il passo con cui confrontare
 * l'avanzamento di un obiettivo.
 */
export function quotaMese(/** @type {string} */ ym, /** @type {string} */ oggi) {
  const totale = giorniDelMese(ym);
  if (meseDi(oggi) > ym) return 1;
  if (meseDi(oggi) < ym) return 0;
  return Number(oggi.slice(8, 10)) / totale;
}

/**
 * Il numero fatto di un obiettivo: quello scritto a mano, oppure quello
 * derivato dalla fonte dichiarata.
 *
 * `registri` porta i dati grezzi che «Oggi» ha già in mano — non li rilegge
 * questa funzione, che resta pura e verificabile.
 *
 * @param {Obiettivo} ob
 * @param {{ movimento?: import('./types').Movimento[], diario?: string[], coda?: import('./types').VoceCoda[] }} registri
 * @param {string} ym  'YYYY-MM' del mese dell'obiettivo
 * @returns {number}
 */
export function fattiDi(ob, registri, ym) {
  const fonte = ob.fonte;
  if (!fonte) return Math.max(0, ob.fatti || 0);

  if (fonte === 'diario') {
    // Giorni distinti, non voci: due svuota-testa nello stesso pomeriggio sono
    // un giorno di diario, non due.
    return new Set((registri.diario || []).filter(d => d.startsWith(ym))).size;
  }

  if (fonte.startsWith('movimento')) {
    const famiglia = fonte.includes(':') ? fonte.split(':')[1] : null;
    return (registri.movimento || [])
      .filter(v => v.date.startsWith(ym) && (!famiglia || v.famiglia === famiglia))
      .length;
  }

  if (fonte.startsWith('lettura:')) {
    const id = fonte.slice('lettura:'.length);
    const voce = (registri.coda || []).find(v => v.id === id);
    return voce?.avanzamento?.fatti || 0;
  }

  // Una fonte che non sappiamo leggere (scritta a mano nel JSON, o rimasta da
  // una versione futura) non è un errore da mostrare: vale zero e l'obiettivo
  // resta visibile, invece di far sparire una riga senza dire perché.
  return 0;
}

/**
 * Un obiettivo pronto da disegnare: numeri risolti, quota, e se è fuori passo.
 *
 * «Fuori passo» ha una tolleranza del 20% e non zero: un obiettivo mensile non
 * si insegue giorno per giorno — chi va in palestra il lunedì e il giovedì è
 * indietro ogni martedì, e un riquadro che lo dice in rosso ogni martedì è un
 * riquadro che si smette di guardare.
 *
 * @param {Obiettivo} ob
 * @param {{ movimento?: import('./types').Movimento[], diario?: string[], coda?: import('./types').VoceCoda[] }} registri
 * @param {string} ym
 * @param {string} oggi 'YYYY-MM-DD'
 */
export function risolvi(ob, registri, ym, oggi) {
  const totale = Math.max(1, ob.totale || 1);
  const fatti = fattiDi(ob, registri, ym);
  const quota = Math.min(1, fatti / totale);
  const passo = quotaMese(ym, oggi);
  return {
    id: ob.id,
    titolo: ob.titolo,
    unita: ob.unita || '',
    fatti,
    totale,
    quota,
    derivato: !!ob.fonte,
    completo: fatti >= totale,
    fuoriPasso: quota < passo - 0.2 && !(fatti >= totale),
  };
}

/** Un id stabile e leggibile, come quelli del Movimento. */
export function nuovoId(/** @type {string} */ ym) {
  return `ob_${ym}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Un obiettivo nuovo, con i campi facoltativi già normalizzati.
 * @param {{ ym: string, titolo?: string, totale?: number, fatti?: number, unita?: string, fonte?: string|null }} dati
 * @returns {Obiettivo}
 */
export function nuovoObiettivo({ ym, titolo = '', totale = 1, fatti = 0, unita = '', fonte = null }) {
  /** @type {Obiettivo} */
  const ob = {
    id: nuovoId(ym),
    titolo: titolo.trim(),
    totale: Math.max(1, Math.round(totale || 1)),
  };
  if (fonte) ob.fonte = fonte;
  else ob.fatti = Math.max(0, Math.round(fatti || 0));
  if (unita.trim()) ob.unita = unita.trim();
  return ob;
}

/**
 * Gli obiettivi di un mese dal documento intero, con una via d'uscita per un
 * file scritto male a mano: quello che non è un elenco vale elenco vuoto.
 * @param {Record<string, Obiettivo[]>|null} doc
 * @param {string} ym
 * @returns {Obiettivo[]}
 */
export function obiettiviDelMese(doc, ym) {
  const righe = doc?.[ym];
  return Array.isArray(righe) ? righe.filter(o => o && typeof o.titolo === 'string') : [];
}

/**
 * Gli obiettivi del mese precedente, ricopiati per il mese nuovo: i totali
 * restano, i numeri fatti ripartono da zero.
 *
 * È l'unica scorciatoia che serve davvero il primo del mese. Senza, «Palestra
 * 12 volte» va riscritto dodici volte l'anno, e alla terza non lo si riscrive
 * più — il mese comincia senza obiettivi e il riquadro resta vuoto per
 * trentuno giorni.
 * @param {Obiettivo[]} precedenti
 * @param {string} ym
 * @returns {Obiettivo[]}
 */
export function ricopia(precedenti, ym) {
  return precedenti.map(o => nuovoObiettivo({
    ym,
    titolo: o.titolo,
    totale: o.totale,
    unita: o.unita || '',
    fonte: o.fonte || null,
  }));
}
