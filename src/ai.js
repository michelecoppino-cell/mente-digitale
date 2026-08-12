// @ts-check
// Il lato browser dell'unica funzione server: /api/claude.
//
// Due gesti, mai automatici: chiedere una proposta di destinazione per un
// pensiero appena catturato, e chiedere una risposta all'estratto del diario che
// «Copia per l'AI» compone già. In entrambi i casi il testo lascia il dispositivo
// solo quando è la persona a premere il pulsante, e l'interfaccia lo dice.
//
// Se il deploy non ha le variabili d'ambiente — o se si sta lavorando in locale
// con `npm run dev`, dove le funzioni Cloudflare non girano — `disponibile()`
// risponde falso e i due pulsanti non compaiono affatto. Un pulsante che c'è e
// non funziona è peggio di un pulsante che non c'è.
import { getToken } from './auth';

const ENDPOINT = '/api/claude';

/** `null` = non l'abbiamo ancora chiesto. La risposta non cambia a metà sessione. */
let attivo = /** @type {boolean|null} */ (null);
/** @type {Promise<boolean>|null} */
let inVolo = null;

/**
 * C'è un'AI configurata su questo deploy?
 * @returns {Promise<boolean>}
 */
export function disponibile() {
  if (attivo !== null) return Promise.resolve(attivo);
  // Due pannelli aperti in fila non devono fare due sonde.
  if (inVolo) return inVolo;
  inVolo = (async () => {
    try {
      const r = await fetch(ENDPOINT);
      // In sviluppo Vite risponde con la pagina (o con un 404): in entrambi i
      // casi qui si finisce a falso, che è la risposta giusta.
      const dati = r.ok ? await r.json() : null;
      attivo = Boolean(dati?.attivo);
    } catch {
      attivo = false;
    }
    inVolo = null;
    return attivo;
  })();
  return inVolo;
}

/**
 * @param {any} corpo
 * @returns {Promise<any>}
 */
async function chiedi(corpo) {
  const token = await getToken();
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // La funzione verifica questo token contro Graph e controlla che l'account
      // sia quello autorizzato: è ciò che tiene la chiave API al riparo da
      // chiunque trovi l'indirizzo.
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(corpo),
  });
  const dati = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dati?.errore || `L'AI non ha risposto (${r.status}).`);
  return dati;
}

/**
 * @typedef {Object} Proposta
 * @property {boolean} azionabile
 * @property {boolean} dueMinuti
 * @property {'cestino'|'falla'|'progetti'|'risorse'|'aree'} ramo
 * @property {string} destinazione   nome esatto di una lista/sezione, o ''
 * @property {string} titolo
 * @property {number} stimaMinuti
 * @property {string} perche
 */

/**
 * Un pensiero grezzo → dove sarebbe andato, secondo il diagramma di Chiarire.
 * @param {string} testo
 * @param {{ progetti: string[], risorse: string[], aree: string[] }} destinazioni
 * @returns {Promise<Proposta>}
 */
export async function proponiDestinazione(testo, destinazioni) {
  const { proposta } = await chiedi({ compito: 'chiarisci', testo, destinazioni });
  return proposta;
}

/**
 * L'estratto del diario → una risposta, dentro l'app.
 * @param {string} markdown
 * @param {string} [domanda]  qualcosa da aggiungere, oltre al preset
 * @returns {Promise<{ risposta: string, troncata: boolean }>}
 */
export function rispondiAlDiario(markdown, domanda) {
  return chiedi({ compito: 'diario', markdown, domanda });
}
