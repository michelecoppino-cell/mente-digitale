// Il calendario di lavoro dentro Mente Digitale, in sola lettura.
//
//   node scripts/sync-calendario-lavoro.mjs
//
// ── Il problema ─────────────────────────────────────────────────────────────
//
// Il calendario aziendale sta su un tenant Microsoft 365 che **non lo condivide
// con l'account personale**, e l'amministratore non apre né la condivisione né
// la pubblicazione. L'app parla con Graph come l'account personale: quel
// calendario non lo vedrà mai, e non c'è niente da correggere qui dentro —
// è un limite dell'account.
//
// Se il tenant è chiuso, l'unico modo di far uscire un dato è **un canale che
// l'azienda già consente**. Ce n'è uno solo, e lo si usava già: la posta.
//
// ── Cosa c'era prima, e perché si rompeva ───────────────────────────────────
//
// Una regola mandava **una mail per ogni evento** creato o modificato, e una
// GitHub Action leggeva le mail non lette con oggetto «calendario», ne
// interpretava il corpo (titolo, due date ISO, un id, la parola «updated») e
// creava l'evento sul calendario personale.
//
// **Il difetto non era la posta: era la sincronizzazione a eventi.**
//
//  - una mail che non parte, arriva in ritardo, finisce nello spam o viene
//    letta a mano non genera niente, e la differenza non si recupera più:
//    nessun giro successivo sa che manca qualcosa;
//  - il corpo era testo libero letto con espressioni regolari. Basta che
//    Outlook cambi il modello e il titolo diventa una data;
//  - una modifica era «cancella e ricrea», con l'originale cercato per id o,
//    in mancanza, per titolo e orario. Su un fallimento restavano due copie o
//    zero;
//  - gli eventi finivano **dentro** il calendario personale, e ogni
//    disallineamento andava ripulito a mano.
//
// ── Cosa fa adesso ──────────────────────────────────────────────────────────
//
// La posta resta il trasporto — è la sola porta aperta — ma non trasporta più
// **un evento**: trasporta **tutta la finestra**. Sul PC di lavoro un compito
// pianificato preme ogni due ore il tasto «Invia calendario tramite e-mail»
// che Outlook ha già (`scripts/calendario-lavoro/Invia-Calendario.ps1`), e
// manda alla casella personale una mail con allegato un `.ics` che contiene
// l'agenda intera. Questo script legge **l'ultima** di quelle mail, ne prende
// l'allegato e riscrive lo specchio in `mente-digitale/calendario-lavoro.json`
// sul OneDrive personale. L'app lo mostra come un calendario in più, in sola
// lettura.
//
// Cambiando cosa c'è dentro la mail cambia tutto:
//
//  - **conta solo l'ultima.** Una mail persa, in ritardo o letta a mano non
//    lascia buchi: la successiva porta di nuovo tutta la finestra. Le
//    precedenti non servono e non si toccano;
//  - cancellazioni e spostamenti arrivano gratis — non sono nell'ultimo `.ics`,
//    quindi non compaiono. Nessun «cancella e ricrea», nessun doppione;
//  - non si legge un corpo scritto a mano ma un **allegato in un formato con
//    una grammatica** (`ics.mjs`, che è provato);
//  - la casella **non si tocca**: niente da segnare come letto, niente da
//    spostare. Questo script sulla posta ha solo `Mail.Read`, e un giro
//    ripetuto due volte fa esattamente la stessa cosa;
//  - nel calendario personale non si scrive niente: se domani la cosa si
//    spegne, sparisce un file e non resta nulla da ripulire.
//
// Se il PC di lavoro resta spento, l'ultima mail invecchia: lo specchio non si
// svuota — resta l'ultima lettura riuscita, che è meglio di un'agenda vuota —
// e **la sua età si vede nell'app**, nel filtro «Calendari ▾». Uno specchio
// fermo che non lo dice sarebbe peggio di uno rotto.
//
// Resta anche la strada del **feed ICS pubblicato**, per il giorno in cui
// l'azienda la aprisse: è più semplice di tutto il resto, e questo script la
// usa se c'è. Le due fonti convivono.
//
// ── Cosa serve per farlo funzionare ─────────────────────────────────────────
//
//   CALENDARIO_LAVORO_MAIL    l'oggetto con cui arriva la mail del PC di
//                             lavoro (es. `CALENDARIO-LAVORO`). Un nome
//                             davanti alla barra verticale per scegliere come
//                             si chiama nell'app: `Studio|CALENDARIO-LAVORO`
//   CALENDARIO_LAVORO_MITTENTE  (facoltativo) da quale indirizzo deve
//                             arrivare: senza, basta l'oggetto
//   CALENDARIO_LAVORO_ICS     (facoltativo) il feed pubblicato, se esiste
//   MENTE_REFRESH_TOKEN       il token del CLI, quello di sempre
//
// Le istruzioni per esteso — e le altre strade, con il motivo per cui sono
// state scartate — stanno in `docs/calendario-lavoro.md`.

import { graph, putDriveJson, impostaArchivioToken } from './mente-graph.mjs';
import { archivioSuFile } from './mente-token-file.mjs';
import { occorrenzeIcs } from './ics.mjs';

// Su Actions il token arriva dal segreto, cioè dall'ambiente: l'archivio su
// file lo trova lì come lo troverebbe in un file, ed è lo stesso che usa il
// CLI. Lo strato Graph non lo cerca da sé, perché gira anche dove un disco
// non c'è (il Worker del connettore remoto).
impostaArchivioToken(archivioSuFile());

/** Dove finisce lo specchio, dentro la cartella dell'app. */
export const FILE_CALENDARIO_LAVORO = 'calendario-lavoro.json';

/** Quanto indietro e quanto avanti si guarda. */
const MESI_INDIETRO = 1;
const MESI_AVANTI = 12;

/** Fra quante mail recenti si cerca quella giusta. */
const MAIL_DA_GUARDARE = 40;

// ── Le fonti dichiarate ─────────────────────────────────────────────────────

/**
 * `Nome|valore` → `{ nome, valore }`, con un nome di ripiego quando non c'è.
 * @param {string|undefined} grezzo
 * @param {string} predefinito
 * @returns {{ nome: string, valore: string }[]}
 */
function righeConNome(grezzo, predefinito) {
  return String(grezzo || '')
    .split('\n')
    .map(r => r.trim())
    .filter(Boolean)
    .map((riga, i) => {
      const barra = riga.indexOf('|');
      if (barra > 0) return { nome: riga.slice(0, barra).trim(), valore: riga.slice(barra + 1).trim() };
      return { nome: i === 0 ? predefinito : `${predefinito} ${i + 1}`, valore: riga };
    })
    .filter(f => f.nome && f.valore);
}

/**
 * Tutte le fonti, di tutti e due i tipi. L'ordine conta solo per il nome di
 * ripiego: le due strade sono indipendenti e si sommano.
 *
 * @param {{ mail?: string, ics?: string, mittente?: string }} ambiente
 * @returns {{ tipo: 'mail'|'ics', nome: string, valore: string, mittente?: string }[]}
 */
export function leggiFonti(ambiente = {}) {
  /** @type {{ tipo: 'mail'|'ics', nome: string, valore: string, mittente?: string }[]} */
  const fonti = [];

  const mittente = (ambiente.mittente || '').trim().toLowerCase();
  for (const f of righeConNome(ambiente.mail, 'Lavoro')) {
    fonti.push({ tipo: 'mail', nome: f.nome, valore: f.valore, ...(mittente ? { mittente } : {}) });
  }

  for (const f of righeConNome(ambiente.ics, fonti.length ? 'Lavoro pubblicato' : 'Lavoro')) {
    // `webcal://` è lo stesso indirizzo con un altro schema: i browser lo
    // aprono col programma di calendario, `fetch` no.
    const url = f.valore.replace(/^webcal:\/\//i, 'https://');
    if (/^https?:\/\//i.test(url)) fonti.push({ tipo: 'ics', nome: f.nome, valore: url });
  }

  return fonti;
}

// ── La mail ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Messaggio
 * @property {string} id
 * @property {string} [subject]
 * @property {string} [receivedDateTime]
 * @property {boolean} [hasAttachments]
 * @property {{ emailAddress?: { address?: string } }} [from]
 */

/**
 * L'ultima mail buona: oggetto che comincia col marcatore, un allegato, e —
 * se dichiarato — il mittente giusto.
 *
 * La scelta è **sull'ultima ricevuta**, non sulla prima non letta: è tutto il
 * punto dello specchio. Chi apre la mail dal telefono non consuma niente, e
 * una mail arrivata due volte non conta due volte.
 *
 * Il confronto sull'oggetto è per prefisso perché il PC di lavoro ci scrive in
 * coda l'ora dell'esportazione: serve a vedere a colpo d'occhio, nella
 * casella, quando è stata mandata l'ultima.
 *
 * @param {Messaggio[]} messaggi
 * @param {{ oggetto: string, mittente?: string }} filtro
 * @returns {Messaggio|null}
 */
export function ultimaMailBuona(messaggi, { oggetto, mittente }) {
  const atteso = String(oggetto || '').trim().toLowerCase();
  if (!atteso) return null;
  const da = (mittente || '').trim().toLowerCase();

  return (messaggi || [])
    .filter(m => m?.hasAttachments !== false)
    .filter(m => String(m?.subject || '').trim().toLowerCase().startsWith(atteso))
    .filter(m => !da || String(m?.from?.emailAddress?.address || '').toLowerCase() === da)
    .sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')))[0] || null;
}

/**
 * L'allegato che è un calendario. Outlook ne attacca spesso più d'uno (la
 * firma con l'immagine del logo è un allegato a tutti gli effetti), quindi non
 * si prende «il primo»: si prende quello che dice di essere un calendario, per
 * tipo o per estensione.
 *
 * @param {{ id?: string, name?: string, contentType?: string, '@odata.type'?: string }[]} allegati
 * @returns {any|null}
 */
export function allegatoCalendario(allegati) {
  return (allegati || []).find(a =>
    String(a?.contentType || '').toLowerCase().startsWith('text/calendar')
    || /\.ics$/i.test(String(a?.name || ''))) || null;
}

/** @param {string} b64 @returns {string} */
function daBase64(b64) {
  return Buffer.from(String(b64 || ''), 'base64').toString('utf8');
}

/**
 * Il testo ICS dell'ultima mail buona.
 * @param {{ valore: string, mittente?: string }} fonte
 * @returns {Promise<{ testo: string, ricevutaIl: string }>}
 */
async function icsDallaMail(fonte) {
  // Si guardano le mail recenti e si filtra qui, invece di chiedere a Graph un
  // `$filter` sull'oggetto: `startswith` su `subject` combinato con un
  // `$orderby` su un'altra proprietà Outlook lo rifiuta a volte con un 400
  // «InefficientFilter», e un filtro che a volte non funziona è peggio di
  // nessun filtro. Quaranta mail sono giorni, con una ogni due ore.
  const messaggi = await graph(
    '/me/messages?$select=id,subject,receivedDateTime,hasAttachments,from'
    + `&$orderby=receivedDateTime desc&$top=${MAIL_DA_GUARDARE}`
  ).then(d => d?.value || []);

  const mail = ultimaMailBuona(messaggi, { oggetto: fonte.valore, mittente: fonte.mittente });
  if (!mail) {
    throw new Error(`nessuna mail recente con oggetto «${fonte.valore}»`
      + `${fonte.mittente ? ` da ${fonte.mittente}` : ''} e un allegato`);
  }

  const allegati = await graph(
    `/me/messages/${mail.id}/attachments?$select=id,name,contentType`
  ).then(d => d?.value || []);
  const scelto = allegatoCalendario(allegati);
  if (!scelto) throw new Error(`la mail del ${mail.receivedDateTime} non porta un allegato .ics`);

  // L'elenco degli allegati non contiene i byte: quelli si chiedono uno alla
  // volta, sul singolo allegato.
  const completo = await graph(`/me/messages/${mail.id}/attachments/${scelto.id}`);
  const testo = daBase64(completo?.contentBytes);
  if (!/BEGIN:VCALENDAR/i.test(testo)) throw new Error('l\'allegato non è un calendario ICS');

  return { testo, ricevutaIl: String(mail.receivedDateTime || '') };
}

// ── Il feed pubblicato ──────────────────────────────────────────────────────

/** @param {string} url @returns {Promise<{ testo: string, ricevutaIl: string }>} */
async function icsDalFeed(url) {
  const r = await fetch(url, { headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const testo = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(testo)) {
    // Outlook risponde con una pagina HTML quando il link non è più valido:
    // senza questo controllo il calendario si svuoterebbe in silenzio.
    throw new Error('la risposta non è un calendario ICS (link scaduto o non pubblico?)');
  }
  return { testo, ricevutaIl: new Date().toISOString() };
}

// ── Il giro ─────────────────────────────────────────────────────────────────

async function run() {
  const fonti = leggiFonti({
    mail: process.env.CALENDARIO_LAVORO_MAIL,
    ics: process.env.CALENDARIO_LAVORO_ICS,
    mittente: process.env.CALENDARIO_LAVORO_MITTENTE,
  });
  if (!fonti.length) {
    console.error('[calendario-lavoro] nessuna fonte: imposta CALENDARIO_LAVORO_MAIL'
      + ' (o CALENDARIO_LAVORO_ICS). Vedi docs/calendario-lavoro.md');
    process.exit(1);
  }

  const oggi = new Date();
  const da = new Date(oggi); da.setMonth(da.getMonth() - MESI_INDIETRO);
  const a = new Date(oggi); a.setMonth(a.getMonth() + MESI_AVANTI);

  /** @type {any[]} */
  const eventi = [];
  /** @type {any[]} */
  const relazione = [];
  let riuscite = 0;

  for (const fonte of fonti) {
    try {
      const { testo, ricevutaIl } = fonte.tipo === 'mail'
        ? await icsDallaMail(fonte)
        : await icsDalFeed(fonte.valore);
      const occorrenze = occorrenzeIcs(testo, { da, a });
      // Il nome della fonte entra nell'id: due calendari possono contenere lo
      // stesso evento (invitati entrambi), e due righe con lo stesso id
      // sarebbero due chiavi React uguali nella griglia del Piano.
      for (const o of occorrenze) eventi.push({ ...o, id: `${fonte.nome}|${o.id}`, fonte: fonte.nome });
      // `letturaIl` è quando il dato è stato **prodotto**, non quando l'abbiamo
      // raccolto: con la posta sono due cose diverse, e quella che conta è la
      // prima. È il numero su cui l'app dice «lo specchio è fermo da ieri».
      relazione.push({ nome: fonte.nome, tipo: fonte.tipo, eventi: occorrenze.length, letturaIl: ricevutaIl, errore: null });
      riuscite++;
      console.log(`[calendario-lavoro] ${fonte.nome} (${fonte.tipo}): ${occorrenze.length} eventi, del ${ricevutaIl.slice(0, 16)}.`);
    } catch (e) {
      relazione.push({ nome: fonte.nome, tipo: fonte.tipo, eventi: 0, letturaIl: null, errore: String(e.message || e) });
      console.error(`[calendario-lavoro] ${fonte.nome} (${fonte.tipo}): ${e.message || e}`);
    }
  }

  // Nessuna fonte letta vuol dire posta o link rotti, non «l'agenda è vuota»:
  // riscrivere lo specchio a zero cancellerebbe a schermo una giornata piena.
  // Si esce con errore, il file resta com'era, e l'Action lo segnala.
  if (!riuscite) {
    console.error('[calendario-lavoro] nessuna fonte leggibile: lo specchio resta quello di prima.');
    process.exit(1);
  }

  const documento = {
    version: 1,
    aggiornatoIl: new Date().toISOString(),
    finestra: { da: da.toISOString().slice(0, 10), a: a.toISOString().slice(0, 10) },
    fonti: relazione,
    eventi: eventi.sort((x, y) => x.start.localeCompare(y.start)),
  };

  // Nessun `reapply`: questo documento ha **un solo scrittore**, ed è questo
  // script. Ogni giro riscrive tutta la finestra da capo, quindi non c'è
  // niente da fondere con la versione remota — la nostra è per costruzione
  // quella completa. Vedi la regola in CLAUDE.md: chi non passa un reapply
  // riceve un errore invece di sovrascrivere in silenzio, e qui l'unico modo
  // di avere un conflitto è che due Action girino insieme (impedito dal
  // `concurrency` del workflow).
  await putDriveJson(FILE_CALENDARIO_LAVORO, documento, { reapply: () => documento });

  console.log(`[calendario-lavoro] Scritto: ${eventi.length} eventi, ${riuscite}/${fonti.length} fonti.`);
  if (relazione.some(r => r.errore)) process.exitCode = 1;
}

// Non gira all'import: `prova-ics.mjs` importa le funzioni pure senza volere
// una sincronizzazione vera.
if (process.argv[1] && process.argv[1].endsWith('sync-calendario-lavoro.mjs')) {
  run().catch(e => { console.error('[calendario-lavoro] ERRORE:', e.message); process.exit(1); });
}
