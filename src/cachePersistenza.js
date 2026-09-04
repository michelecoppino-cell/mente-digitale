// @ts-check
// Cosa della cache di query finisce su `localStorage`, e in che forma.
//
// La cache di TanStack è la ragione per cui, riaprendo l'app dal telefono, in
// pagina c'è già qualcosa mentre le letture sono in volo (vedi queryClient.js
// e useDatoPersistito.js). Ma il posto in cui sopravvive è `localStorage`, che
// è uno solo per origine e ci tiene dentro anche l'account MSAL: da qui il
// tetto (`PERSIST_BUDGET`) e la potatura di questo file.
//
// Il tetto, però, si difendeva nel modo sbagliato. Buttava via le query più
// grosse, e le più grosse sono **sempre** le due finestre di eventi del
// calendario: ±3 mesi per il Piano, −1/+18 mesi per i pannelli di sezione e le
// scadenze ricorrenti. Ogni evento porta con sé un id di Graph, un `webLink` e
// l'id del calendario — stringhe lunghe centinaia di caratteri — e mille
// eventi fanno mezzo megabyte. Risultato: di tutta l'app il calendario era
// l'unica cosa che alla riapertura non c'era mai, cioè esattamente la cosa che
// si guarda per prima la mattina. Tutto il resto sembrava funzionare, e questo
// no, senza che niente lo dicesse.
//
// La correzione è dire quali eventi vale la pena tenere invece di quante
// query ci stanno: alla riapertura si guardano oggi e i giorni attorno, non
// un appuntamento di aprile. Si conserva una finestra corta attorno a oggi —
// abbastanza per la settimana, il mese e quello dopo — e la copia ridotta si
// marca come **vecchia** (`dataUpdatedAt = 0`), così nessuno la scambia per la
// finestra intera: si vede subito, e la lettura vera parte comunque e la
// sostituisce. È la stessa idea di `fresco` in useDatoPersistito: una copia
// vecchia si mostra, non ci si scrive sopra.
//
// Puro apposta: niente `window`, niente TanStack. Le prove girano su questo
// file (`npm run prova-cache`).
import { spostaGiorni, ymd } from './tempo.js';

/**
 * Quanto spazio può prendersi la cache su `localStorage`. Un mega di JSON è
 * comodo per i dati e lascia margine abbondante a MSAL, che di suo occupa
 * qualche decina di kB — e il posto di MSAL è quello che non si può toccare:
 * quando `setItem` smette di funzionare, quello che si perde è l'accesso.
 */
export const PERSIST_BUDGET = 1_000_000;

/**
 * Le query che sono una finestra di eventi di calendario: grosse, e
 * ricostruibili con una lettura sola. Sono le uniche che si potano.
 */
export const CHIAVI_CALENDARIO = ['calEventsBulk', 'calEventiSezioni', 'workbookEventsBulk'];

/**
 * La finestra che si conserva attorno a oggi. Indietro poco — un evento
 * passato si legge per ricordarsene, non per deciderci qualcosa — e avanti due
 * mesi, che è quanto copre la vista Mese del Piano e quella del mese dopo.
 */
export const GIORNI_INDIETRO = 14;
export const GIORNI_AVANTI = 60;

/** Il giorno di un evento nella forma di Graph, o '' se non si capisce. */
export function giornoEvento(/** @type {any} */ ev) {
  return String(ev?.start?.dateTime || ev?.start?.date || '').slice(0, 10);
}

/**
 * La stessa cache, con le finestre di eventi ridotte ai giorni attorno a oggi.
 *
 * Un evento di cui non si capisce la data resta: buttare via quello che non si
 * è capito è il modo in cui le cose spariscono in silenzio, e sono pochi.
 *
 * @param {{queries?: any[]}} clientState  lo stato disidratato di TanStack
 * @param {string} oggi                    'YYYY-MM-DD'
 * @returns {{queries?: any[]}}            una copia: l'originale non si tocca
 */
export function snellisciCalendari(clientState, oggi) {
  const queries = clientState?.queries;
  if (!Array.isArray(queries)) return clientState;
  const da = spostaGiorni(oggi, -GIORNI_INDIETRO);
  const a  = spostaGiorni(oggi, GIORNI_AVANTI);

  return {
    ...clientState,
    queries: queries.map(q => {
      if (!CHIAVI_CALENDARIO.includes(q?.queryKey?.[0])) return q;
      const eventi = q?.state?.data;
      if (!Array.isArray(eventi) || eventi.length === 0) return q;
      const vicini = eventi.filter(ev => {
        const g = giornoEvento(ev);
        return !g || (g >= da && g <= a);
      });
      if (vicini.length === eventi.length) return q;
      // `dataUpdatedAt: 0` è la parte che conta: la copia ridotta è buona per
      // riempire lo schermo, non per rispondere «ce l'ho già» a chi chiede la
      // finestra intera. Segnata vecchia, la rilettura parte sempre.
      return { ...q, state: { ...q.state, data: vicini, dataUpdatedAt: 0 } };
    }),
  };
}

/**
 * Il JSON da scrivere su `localStorage`, già sotto al tetto.
 *
 * Prima si potano le finestre di eventi (è lì che sta il grosso, ed è roba che
 * si rilegge con una chiamata); solo se non basta si buttano via query intere,
 * dalla più grossa alla più piccola.
 *
 * Quali buttare si decide contando, non riscrivendo. Prima ogni query tolta
 * costava una serializzazione dell'intera cache da capo: sfoltirne dieci
 * voleva dire serializzare dieci volte un megabyte, sul filo principale e a
 * ogni salvataggio — cioè proprio quando la cache è grossa e il telefono ha
 * già poco fiato. Le misure delle singole query si prendono una volta sola,
 * si sottraggono finché il totale non rientra, e si serializza una volta.
 *
 * @param {{queries?: any[]}} clientStateGrezzo
 * @param {string} [oggi]  'YYYY-MM-DD'; di default il giorno locale
 * @param {number} [budget]
 * @returns {string} il JSON da scrivere, già sotto al budget
 */
export function serializzaEntroIlBudget(clientStateGrezzo, oggi = ymd(), budget = PERSIST_BUDGET) {
  const timestamp = Date.now();
  const clientState = snellisciCalendari(clientStateGrezzo, oggi);
  let json = JSON.stringify({ timestamp, clientState });
  if (json.length <= budget) return json;

  // Dalla più grossa alla più piccola. `size + 1` tiene conto della virgola
  // che separa una query dalla successiva nell'array serializzato: è una
  // stima, e va bene che lo sia — il controllo vero è la misura finale qui
  // sotto, questa serve solo a scegliere cosa togliere.
  const queries = [...(clientState.queries || [])]
    .map(q => ({ q, size: JSON.stringify(q).length + 1 }))
    .sort((a, b) => b.size - a.size);

  let stima = json.length;
  const tenute = new Set(queries.map(x => x.q));
  for (const { q, size } of queries) {
    if (stima <= budget) break;
    tenute.delete(q);
    stima -= size;
  }

  json = JSON.stringify({
    timestamp,
    clientState: { ...clientState, queries: [...tenute] },
  });
  // La stima può sbagliare per difetto (l'escaping di una stringa cambia
  // lunghezza fra una passata e l'altra): se dopo il taglio siamo ancora
  // sopra, si continua a togliere dalla più grossa, una serializzazione per
  // giro ma partendo da un insieme già sfoltito.
  for (const { q } of queries) {
    if (json.length <= budget || !tenute.size) break;
    if (!tenute.delete(q)) continue;
    json = JSON.stringify({
      timestamp,
      clientState: { ...clientState, queries: [...tenute] },
    });
  }
  return json;
}
