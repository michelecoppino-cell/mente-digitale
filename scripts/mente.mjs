/**
 * mente.mjs
 * La mente digitale da riga di comando.
 *
 * Qui c'è solo l'interfaccia: leggere gli argomenti, chiamare la funzione
 * giusta di `mente-comandi.mjs` e stampare. Le operazioni vere — e le regole su
 * cosa si può scrivere — stanno lì, condivise con il server MCP.
 *
 *   node scripts/mente.mjs aiuto
 *
 * Nessuna dipendenza, Node 18+.
 */

import * as mente from './mente-comandi.mjs';
import {
  TASK_STATUSES, CONTEXTS, STATI_SCRIVIBILI, STATI_CREABILI, TIPI_DIARIO, GRANULARITY_MEMO_LINE,
} from './mente-comandi.mjs';

// ── Argomenti ────────────────────────────────────────────────────────────────

/**
 * `--chiave valore`, `--chiave=valore`, `--flag`. Il resto è posizionale.
 * @param {string[]} argv
 * @returns {{ opts: Record<string, string|true>, args: string[] }}
 */
function parseArgv(argv) {
  /** @type {Record<string, string|true>} */
  const opts = {};
  /** @type {string[]} */
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; }
    else opts[key] = true;
  }
  return { opts, args };
}

/** @param {string|true|undefined} v @returns {string|undefined} */
const s = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** @param {string|true|undefined} v @returns {number|undefined} */
const n = v => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Il testo di una voce di diario può arrivare da stdin (`… | mente diario scrivi`). */
async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * @param {string[]} args
 * @param {Record<string, string|true>} opts
 * @returns {Promise<{ data: any, text: string }>}
 */
async function esegui(args, opts) {
  const comando = args[0];
  const resto = args.slice(1);
  const sub = resto[0];

  switch (comando) {
    case 'oggi':
      return mente.oggi({ data: s(opts.data) });

    case 'agenda':
      return mente.agenda({ data: s(opts.data), giorni: n(opts.giorni) });

    case 'piano':
      if (!sub || sub === 'giorno') return mente.piano({ data: s(opts.data) });
      if (sub === 'settimana') return mente.pianoArco({ data: s(opts.data) });
      if (sub === 'mese') return mente.pianoArco({ mese: s(opts.mese) || s(opts.data) });
      if (sub === 'aggiungi') {
        return mente.pianoAggiungi({
          attivita: resto[1], ora: resto[2] || s(opts.ora),
          data: s(opts.data), durataMin: n(opts.durata),
        });
      }
      if (sub === 'togli') return mente.pianoTogli({ attivita: resto[1], data: s(opts.data) });
      throw new Error(`piano: sottocomando sconosciuto "${sub}" (giorno, settimana, mese, aggiungi, togli)`);

    case 'obiettivi':
      if (!sub || sub === 'leggi') return mente.obiettiviLeggi({ mese: s(opts.mese) });
      // Sei righe con quattro campi ciascuna non si scrivono a colpi di
      // `--flag`: da terminale arrivano come JSON, in --obiettivi o da stdin.
      if (sub === 'scrivi') {
        const grezzo = s(opts.obiettivi) || await leggiStdin();
        if (!grezzo) throw new Error('Serve l\'elenco degli obiettivi in JSON (--obiettivi o da stdin).');
        let elenco;
        try { elenco = JSON.parse(grezzo); }
        catch (e) { throw new Error(`Gli obiettivi non sono JSON valido: ${e.message}`); }
        return mente.obiettiviScrivi({ mese: s(opts.mese), obiettivi: elenco });
      }
      throw new Error(`obiettivi: sottocomando sconosciuto "${sub}" (leggi, scrivi)`);

    case 'evento':
      if (sub === 'crea') {
        return mente.eventoCrea({
          oggetto: resto.slice(1).join(' ').trim() || s(opts.oggetto),
          data: s(opts.data), inizio: s(opts.inizio), fine: s(opts.fine),
          durataMin: n(opts.durata), tuttoIlGiorno: !!opts['tutto-il-giorno'],
          luogo: s(opts.luogo), note: s(opts.note),
          promemoriaMin: n(opts.promemoria), calendario: s(opts.calendario),
        });
      }
      throw new Error(`evento: sottocomando sconosciuto "${sub || ''}" (crea)`);

    case 'sezioni':
      return mente.sezioni();

    case 'sezione':
      if (sub === 'crea') {
        return mente.sezioneCrea({
          nome: resto.slice(1).join(' ').trim() || s(opts.nome),
          commessa: s(opts.commessa), consegna: s(opts.consegna), scadenza: s(opts.scadenza),
        });
      }
      throw new Error(`sezione: sottocomando sconosciuto "${sub || ''}" (crea)`);

    case 'bussola':
      return mente.identita({ tipo: 'bussola' });

    case 'visione':
      return mente.identita({ tipo: 'visione' });

    case 'attivita':
      if (!sub || sub === 'lista') {
        return mente.attivitaLista({
          stato: s(opts.stato), sezione: s(opts.sezione),
          contesto: s(opts.contesto), includiFatte: !!opts.tutte,
        });
      }
      if (sub === 'crea') {
        return mente.attivitaCrea({
          titolo: resto.slice(1).join(' ').trim() || s(opts.titolo),
          sezione: s(opts.sezione), stato: s(opts.stato), stimaMin: n(opts.stima),
          scadenza: s(opts.scadenza), contesto: s(opts.contesto),
          nota: s(opts.nota), attesa: s(opts.persona) || s(opts.attesa),
        });
      }
      if (sub === 'stato' || sub === 'completa') {
        return mente.attivitaStato({
          attivita: resto[1],
          stato: sub === 'completa' ? 'done' : resto[2],
          persona: s(opts.persona) || s(opts.attesa),
        });
      }
      throw new Error(`attivita: sottocomando sconosciuto "${sub}" (lista, crea, stato, completa)`);

    case 'diario':
      if (!sub || sub === 'leggi') {
        return mente.diarioLeggi({
          mese: s(opts.mese), giorni: n(opts.giorni), cerca: s(opts.cerca),
          tag: s(opts.tag), includiCassetto: !!opts.cassetto,
        });
      }
      if (sub === 'scrivi') {
        return mente.diarioScrivi({
          testo: s(opts.testo) || resto.slice(1).join(' ').trim() || await leggiStdin(),
          tipo: s(opts.tipo), data: s(opts.data), tag: s(opts.tag),
          umore: n(opts.umore), energia: n(opts.energia),
          gratitudine: s(opts.gratitudine), cassetto: !!opts.cassetto,
        });
      }
      throw new Error(`diario: sottocomando sconosciuto "${sub}" (leggi, scrivi)`);

    case 'note':
      if (sub === 'pagine') return mente.notePagine({ sezione: resto.slice(1).join(' ').trim() });
      if (sub === 'leggi') {
        return mente.noteLeggi({ pagina: resto.slice(1).join(' ').trim(), sezione: s(opts.sezione) });
      }
      if (sub === 'crea') {
        return mente.noteCrea({
          sezione: s(opts.sezione),
          titolo: resto.slice(1).join(' ').trim() || s(opts.titolo),
          testo: s(opts.testo) || await leggiStdin(),
        });
      }
      if (sub === 'aggiungi') {
        return mente.noteAggiungi({
          pagina: resto.slice(1).join(' ').trim() || s(opts.pagina),
          sezione: s(opts.sezione),
          testo: s(opts.testo) || await leggiStdin(),
        });
      }
      throw new Error(`note: sottocomando sconosciuto "${sub || ''}" (pagine, leggi, crea, aggiungi)`);

    default:
      throw new Error(`Comando sconosciuto: ${comando}\n\n${AIUTO}`);
  }
}

const AIUTO = `mente.mjs — la mente digitale da riga di comando

  node scripts/mente.mjs <comando> [opzioni]

Lettura
  oggi [--data YYYY-MM-DD]        agenda, piano e conteggi del giorno
  agenda [--giorni N]             eventi del calendario (default 7 giorni)
  piano [--data YYYY-MM-DD]       i blocchi del piano di un giorno
  piano settimana [--data D]      la settimana che contiene quel giorno
  piano mese [--mese YYYY-MM]     un mese intero, giorno per giorno
  obiettivi [--mese YYYY-MM]      gli obiettivi del mese e a che punto sono
  sezioni                         liste per commessa (con consegne, scadenze e
                                  attività aperte) e sezioni OneNote
  note pagine <sezione>           le pagine OneNote di una sezione
  note leggi <id | titolo --sezione X>
  bussola | visione               i documenti identitari

  attivita lista [--stato s] [--sezione s] [--contesto c] [--tutte]
  diario leggi [--mese YYYY-MM | --giorni N] [--cerca t] [--tag t] [--cassetto]

Scrittura
  attivita crea "titolo" [--sezione s] [--stato ${STATI_CREABILI.join('|')}]
                         [--stima 45] [--scadenza YYYY-MM-DD]
                         [--contesto ${CONTEXTS.map(c => c.key).join('|')}] [--nota "…"] [--persona "Nome"]
  attivita stato <id|titolo> <${STATI_SCRIVIBILI.join('|')}> [--persona "Nome"]
  attivita completa <id|titolo>
  sezione crea "NOME"  |  sezione crea --commessa 2573 --consegna ABS --scadenza YYYY-MM-DD

  piano aggiungi <id|titolo> <HH:MM> [--data YYYY-MM-DD] [--durata 45]
  piano togli <id|titolo> [--data YYYY-MM-DD]
  obiettivi scrivi --mese YYYY-MM [--obiettivi '[{"titolo":"…","totale":12}]']
                (senza --obiettivi legge il JSON da stdin; da 3 a 6 righe,
                 sostituiscono quelle del mese)

  evento crea "oggetto" [--data YYYY-MM-DD] [--inizio HH:MM] [--fine HH:MM | --durata 60]
                        [--tutto-il-giorno] [--luogo "…"] [--note "…"]
                        [--promemoria 15] [--calendario "Nome"]

  note crea "titolo" --sezione X [--testo "…"]      (senza --testo legge da stdin)
  note aggiungi <id | titolo --sezione X> [--testo "…"]
  diario scrivi [--testo "…"] [--tipo ${TIPI_DIARIO.join('|')}] [--data YYYY-MM-DD]
                [--tag a,b] [--umore 1-5] [--energia 1-5] [--gratitudine "a|b"] [--cassetto]
                (senza --testo legge da stdin)

Globali
  --json                          esce in JSON invece che in testo

Stati del flusso: ${TASK_STATUSES.join(', ')}.
Gli stati ask, waiting e delegated portano una persona: --persona "Nome".
I nomi che ricorrono stanno in src/persone.json.

Niente, da qui, cancella niente: su OneNote si scrive solo in fondo a una
pagina, mai sopra a quello che c'era, e la Bussola e la Visione si leggono
soltanto. «Togliere» un'attività dal piano vuol dire toglierle l'ora, non
cancellarla.

Il piano del giorno, della settimana e del mese non sono tre piani ma tre
distanze da cui si guarda lo stesso: si compilano tutti con «piano aggiungi»,
un giorno per volta, e si rileggono con «piano settimana» e «piano mese». Gli
obiettivi del mese sono un'altra cosa: dove si vuole arrivare, non quando si
fanno le cose.

Una commessa può avere più consegne, una lista To-Do ciascuna con la sua
scadenza (nome GRUPPO.Consegna-YYMMDD). --sezione accetta sia il nome della
commessa — e allora vale per tutte le sue consegne — sia quello di una consegna
sola. Per creare un'attività la consegna va indicata: «tutta la commessa» non è
un posto in cui scrivere.

Le taglie, orientativamente: ${GRANULARITY_MEMO_LINE.replace('Orientativamente: ', '')}

Le stesse operazioni sono disponibili come server MCP (scripts/mente-mcp.mjs),
per usarle da una chat invece che da un terminale.

Autenticazione: refresh token in scripts/.mente-refresh-token o in
MENTE_REFRESH_TOKEN. Per ottenerlo: node scripts/get-refresh-token.mjs --mente
`;

async function main() {
  const { opts, args } = parseArgv(process.argv.slice(2));
  if (!args[0] || args[0] === 'aiuto' || opts.aiuto || opts.help) {
    process.stdout.write(AIUTO);
    return;
  }
  const esito = await esegui(args, opts);
  process.stdout.write(opts.json ? JSON.stringify(esito.data, null, 2) + '\n' : esito.text + '\n');
}

main().catch(e => {
  console.error('Errore: ' + e.message);
  process.exit(1);
});
