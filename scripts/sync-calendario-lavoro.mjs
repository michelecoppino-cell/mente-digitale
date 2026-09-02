// Il calendario di lavoro dentro Mente Digitale, in sola lettura.
//
//   node scripts/sync-calendario-lavoro.mjs
//
// ── Il problema ─────────────────────────────────────────────────────────────
//
// Il calendario aziendale sta su un tenant Microsoft 365 che non può
// condividerlo con l'account personale, e senza condivisione l'app — che parla
// con Graph come *quell'account* — non lo vede. Restava un buco esattamente
// dove serve non averne: le ore già impegnate.
//
// ── Cosa c'era prima, e perché si rompeva ───────────────────────────────────
//
// Una regola di posta mandava una mail per ogni evento creato o modificato, e
// una GitHub Action leggeva le mail non lette con oggetto «calendario», ne
// interpretava il corpo (titolo, due date ISO, un id, la parola «updated») e
// creava l'evento sul calendario personale.
//
// Era **una sincronizzazione a eventi con un canale che perde**, e le cose che
// la rompevano non erano difetti da correggere ma la sua forma:
//
//  - una mail che non parte, arriva in ritardo, finisce nello spam o viene
//    letta a mano non genera niente, e la differenza non si recupera più:
//    nessun giro successivo sa che manca qualcosa;
//  - il corpo della mail era testo libero letto con espressioni regolari.
//    Basta che Outlook cambi il modello, o che qualcuno scriva una riga in
//    più, e il titolo diventa una data;
//  - una modifica era «cancella e ricrea», con la ricerca dell'originale fatta
//    per id o, in mancanza, per titolo e orario. Su un fallimento restavano
//    due copie o zero;
//  - gli eventi finivano **dentro** il calendario personale: ogni disallineamento
//    andava poi ripulito a mano, uno per uno.
//
// ── Cosa fa adesso ──────────────────────────────────────────────────────────
//
// Legge il feed **ICS** del calendario di lavoro — l'indirizzo che Outlook dà
// quando si pubblica un calendario — e ne scrive uno **specchio completo** in
// `mente-digitale/calendario-lavoro.json` sul OneDrive personale. L'app lo
// legge e lo mostra come un calendario in più, in sola lettura.
//
// La differenza che conta è che non è più una sincronizzazione a eventi ma
// **uno specchio a stato**: ogni giro riscrive tutta la finestra da capo.
//
//  - non c'è niente da «non perdere»: se un giro salta, quello dopo rimette
//    tutto in pari da solo;
//  - cancellazioni e spostamenti arrivano gratis — non ci sono, quindi non
//    compaiono. Nessun «cancella e ricrea», nessun doppione possibile;
//  - non si scrive **niente** nel calendario personale: se domani questa cosa
//    si spegne, sparisce un file e non resta niente da ripulire;
//  - il formato è uno standard con una grammatica, non una mail da
//    interpretare (vedi `ics.mjs`, che è provato).
//
// Se il feed è irraggiungibile il file di prima resta dov'è: si vede l'ultima
// lettura riuscita e la sua data, che è meglio di un calendario vuoto.
//
// ── Cosa serve per farlo funzionare ─────────────────────────────────────────
//
//   CALENDARIO_LAVORO_ICS   l'indirizzo (o gli indirizzi) del feed, uno per
//                           riga. Un nome davanti alla barra verticale se si
//                           vuole scegliere come si chiama:
//                              Studio|https://outlook.office365.com/owa/calendar/…/calendar.ics
//   MENTE_REFRESH_TOKEN     il token del CLI, quello di sempre
//
// Le istruzioni per ricavare l'indirizzo — e cosa fare se l'azienda ha
// disattivato la pubblicazione — stanno in `docs/calendario-lavoro.md`.

import { putDriveJson } from './mente-graph.mjs';
import { occorrenzeIcs } from './ics.mjs';

/** Dove finisce lo specchio, dentro la cartella dell'app. */
export const FILE_CALENDARIO_LAVORO = 'calendario-lavoro.json';

/** Quanto indietro e quanto avanti si guarda. */
const MESI_INDIETRO = 1;
const MESI_AVANTI = 12;

/**
 * Gli indirizzi dichiarati, con il nome che avranno nell'app.
 * @param {string|undefined} grezzo
 * @returns {{ nome: string, url: string }[]}
 */
export function leggiFonti(grezzo) {
  return String(grezzo || '')
    .split(/[\n,]/)
    .map(r => r.trim())
    .filter(Boolean)
    .map((riga, i) => {
      const barra = riga.indexOf('|');
      if (barra > 0) return { nome: riga.slice(0, barra).trim(), url: riga.slice(barra + 1).trim() };
      return { nome: i === 0 ? 'Lavoro' : `Lavoro ${i + 1}`, url: riga };
    })
    // `webcal://` è lo stesso indirizzo con un altro schema: i browser lo
    // aprono col programma di calendario, `fetch` no.
    .map(f => ({ ...f, url: f.url.replace(/^webcal:\/\//i, 'https://') }))
    .filter(f => /^https?:\/\//i.test(f.url));
}

/** @param {string} url @returns {Promise<string>} */
async function scaricaIcs(url) {
  const r = await fetch(url, { headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const testo = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(testo)) {
    // Outlook risponde con una pagina HTML quando il link non è più valido:
    // senza questo controllo il calendario si svuoterebbe in silenzio.
    throw new Error('la risposta non è un calendario ICS (link scaduto o non pubblico?)');
  }
  return testo;
}

async function run() {
  const fonti = leggiFonti(process.env.CALENDARIO_LAVORO_ICS);
  if (!fonti.length) {
    console.error('[calendario-lavoro] CALENDARIO_LAVORO_ICS non impostata: vedi docs/calendario-lavoro.md');
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
      const testo = await scaricaIcs(fonte.url);
      const occorrenze = occorrenzeIcs(testo, { da, a });
      // Il nome della fonte entra nell'id: due calendari possono contenere lo
      // stesso evento (invitati entrambi), e due righe con lo stesso id
      // sarebbero due chiavi React uguali nella griglia del Piano.
      for (const o of occorrenze) eventi.push({ ...o, id: `${fonte.nome}|${o.id}`, fonte: fonte.nome });
      relazione.push({ nome: fonte.nome, eventi: occorrenze.length, errore: null });
      riuscite++;
      console.log(`[calendario-lavoro] ${fonte.nome}: ${occorrenze.length} eventi.`);
    } catch (e) {
      relazione.push({ nome: fonte.nome, eventi: 0, errore: String(e.message || e) });
      console.error(`[calendario-lavoro] ${fonte.nome}: ${e.message || e}`);
    }
  }

  // Nessuna fonte letta vuol dire rete o link rotti, non «l'agenda è vuota»:
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

// Non gira all'import: `prova-ics.mjs` importa `leggiFonti` senza volere una
// sincronizzazione vera.
if (process.argv[1] && process.argv[1].endsWith('sync-calendario-lavoro.mjs')) {
  run().catch(e => { console.error('[calendario-lavoro] ERRORE:', e.message); process.exit(1); });
}
