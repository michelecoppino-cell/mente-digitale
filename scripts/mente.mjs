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
import { impostaArchivioToken } from './mente-graph.mjs';
import { archivioSuFile } from './mente-token-file.mjs';

// Il token sta su questa macchina: un file accanto agli script, o l'ambiente.
// Lo strato Graph non lo cerca da sé — gira anche in un Worker, dove un file
// non c'è — quindi glielo dice chi lo avvia.
impostaArchivioToken(archivioSuFile());

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

/**
 * Come `s`, ma quello che è stato detto vuoto resta vuoto: `--nota ""` toglie
 * la nota, e distinguerlo da «non l'ho detto» è tutta la differenza fra
 * correggere un campo e perderlo. Una bandiera nuda (`--nota` e basta) non
 * vuol dire niente, e infatti non passa.
 * @param {string|true|undefined} v @returns {string|undefined}
 */
const sv = v => (typeof v === 'string' ? v.trim() : undefined);

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
      if (sub === 'mese') return mente.pianoArco({ mese: s(opts.mese) || s(opts.data), arco: 'mese' });
      if (sub === 'aggiungi') {
        return mente.pianoAggiungi({
          attivita: resto[1], ora: resto[2] || s(opts.ora),
          data: s(opts.data), durataMin: n(opts.durata),
          sottoPassi: opts['sotto-passi'] === true,
        });
      }
      if (sub === 'sposta') {
        return mente.pianoSposta({
          attivita: resto[1], ora: resto[2] || s(opts.ora),
          data: s(opts.data), daData: s(opts['da-data']), durataMin: n(opts.durata),
        });
      }
      if (sub === 'togli') return mente.pianoTogli({ attivita: resto[1], data: s(opts.data) });
      // `piano auto` non scrive: stampa una bozza da leggere, e quello che
      // convince si mette a piano con `piano aggiungi`, una riga per volta.
      if (sub === 'auto') {
        return mente.pianoAuto({
          data: s(opts.data), dalle: s(opts.dalle), alle: s(opts.alle),
          sezione: s(opts.sezione), contesto: s(opts.contesto),
          pausaMin: n(opts.pausa), massimo: n(opts.massimo),
        });
      }
      throw new Error(`piano: sottocomando sconosciuto "${sub}" (giorno, settimana, mese, auto, aggiungi, sposta, togli)`);

    // Il recap: senza testo lo legge, con --testo (o da stdin) lo scrive. È il
    // comando che gira alle cinque dentro Claude Code sul PC sempre acceso —
    // vedi docs/recap-mattina.md.
    case 'recap':
      if (!sub || sub === 'leggi') return mente.recapLeggi({ data: s(opts.data) });
      if (sub === 'scrivi') {
        return mente.recapScrivi({
          testo: s(opts.testo) || await leggiStdin(),
          data: s(opts.data), titolo: s(opts.titolo), fonti: s(opts.fonti),
        });
      }
      throw new Error(`recap: sottocomando sconosciuto "${sub}" (leggi, scrivi)`);

    case 'posta':
      return mente.posta({ giorni: n(opts.giorni), massimo: n(opts.massimo) });

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

    case 'programma':
      if (sub === 'ore') {
        return mente.programmaOre({
          commessa: s(opts.commessa) || resto[1],
          persona: s(opts.persona), pacchetto: s(opts.pacchetto), voce: s(opts.voce),
          settimana: s(opts.settimana), data: s(opts.data), ore: n(opts.ore),
        });
      }
      // Quello che resta è il nome della commessa: `programma 2573` e
      // `programma leggi 2573` sono la stessa domanda, e la prima è quella che
      // si scrive davvero.
      return mente.programma({
        commessa: s(opts.commessa) || (sub === 'leggi' ? resto.slice(1) : resto).join(' ').trim() || undefined,
        persona: s(opts.persona), settimane: n(opts.settimane),
      });

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
          sottoattivita: s(opts.sotto),
        });
      }
      if (sub === 'stato' || sub === 'completa') {
        return mente.attivitaStato({
          attivita: resto[1],
          stato: sub === 'completa' ? 'done' : resto[2],
          persona: s(opts.persona) || s(opts.attesa),
          sottoAggiungi: s(opts['sotto-aggiungi']),
          sottoFatta: s(opts['sotto-fatta']),
          sottoAperta: s(opts['sotto-aperta']),
        });
      }
      // `attivita sotto <attività>` è la stessa scrittura senza toccare lo
      // stato: il gesto di tutti i giorni è spuntare un passo, non spostare
      // l'attività, e chiederlo con «stato» in mezzo si sbaglia.
      if (sub === 'sotto') {
        return mente.attivitaStato({
          attivita: resto[1],
          sottoAggiungi: s(opts.aggiungi) || resto.slice(2).join(' ').trim() || undefined,
          sottoFatta: s(opts.fatta),
          sottoAperta: s(opts.aperta),
        });
      }
      if (sub === 'modifica') {
        return mente.attivitaModifica({
          attivita: resto[1],
          titolo: s(opts.titolo), nota: sv(opts.nota), sezione: s(opts.sezione),
          contesto: sv(opts.contesto), stimaMin: n(opts.stima), scadenza: sv(opts.scadenza),
        });
      }
      // `--conferma` è una bandiera, cioè `true`: qui diventa il booleano che
      // `attivitaElimina` pretende scritto a parte.
      if (sub === 'elimina') {
        return mente.attivitaElimina({ attivita: resto[1], conferma: opts.conferma === true });
      }
      throw new Error(`attivita: sottocomando sconosciuto "${sub}" (lista, crea, stato, sotto, completa, modifica, elimina)`);

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
  programma [commessa]            ore vendute, stimate, spese e margine, e il
            [--persona "Nome"]    carico settimanale delle persone. Senza
            [--settimane N]       commessa: quelle accese
  obiettivi [--mese YYYY-MM]      gli obiettivi del mese e a che punto sono
  recap [--data YYYY-MM-DD]       il recap del mattino, con quanti anni ha
  posta [--giorni N]              le email che sembrano chiedere qualcosa
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
                         [--sotto "primo passo; secondo passo"]
  attivita stato <id|titolo> <${STATI_SCRIVIBILI.join('|')}> [--persona "Nome"]
                         [--sotto-aggiungi "…; …"] [--sotto-fatta "…"] [--sotto-aperta "…"]
  attivita sotto <id|titolo> "primo passo; secondo passo"
                         [--fatta "pezzo di testo"] [--aperta "pezzo di testo"]
  attivita completa <id|titolo>
  attivita modifica <id|titolo> [--titolo "…"] [--nota "…"] [--sezione s]
                         [--contesto c] [--stima 45] [--scadenza YYYY-MM-DD]
                         (un'opzione vuota — --scadenza "" , --stima 0 — toglie
                          quello che c'era; senza l'opzione il campo resta)
  attivita elimina <id|titolo> --conferma
                         (non cancella: va nel Cestino e fuori dalle prossime
                          azioni; si rimette con «attivita modifica --sezione»)
  sezione crea "NOME"  |  sezione crea --commessa 2573 --consegna ABS --scadenza YYYY-MM-DD

  piano auto [--data YYYY-MM-DD] [--dalle 09:00] [--alle 13:00]
             [--sezione s] [--contesto c] [--pausa 10] [--massimo 5]
                (una bozza di giornata: non scrive niente)

  piano aggiungi <id|titolo> <HH:MM> [--data YYYY-MM-DD] [--durata 45] [--sotto-passi]
                (con --sotto-passi il blocco si porta dentro le sottoattività
                 ancora aperte, da spuntare poi dal Piano)
  piano sposta <id|titolo> [HH:MM] [--data YYYY-MM-DD] [--da-data YYYY-MM-DD] [--durata 45]
  piano togli <id|titolo> [--data YYYY-MM-DD]

  programma ore --commessa 2573 --persona "Marco" --pacchetto "A30" --ore 24
                [--settimana YYYY-Www | --data YYYY-MM-DD] [--voce "Plinti"]
                (sostituisce le ore di quella settimana, non ci si somma;
                 --ore 0 toglie la cella)
  obiettivi scrivi --mese YYYY-MM [--obiettivi '[{"titolo":"…","totale":12}]']
                (senza --obiettivi legge il JSON da stdin; da 3 a 6 righe,
                 sostituiscono quelle del mese)

  evento crea "oggetto" [--data YYYY-MM-DD] [--inizio HH:MM] [--fine HH:MM | --durata 60]
                        [--tutto-il-giorno] [--luogo "…"] [--note "…"]
                        [--promemoria 15] [--calendario "Nome"]

  note crea "titolo" --sezione X [--testo "…"]      (senza --testo legge da stdin)
  note aggiungi <id | titolo --sezione X> [--testo "…"]
  recap scrivi [--testo "…"] [--data YYYY-MM-DD] [--titolo "…"] [--fonti a,b]
                (senza --testo legge da stdin; sostituisce il recap di ieri)
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
fanno le cose. Il Programma di commessa è un piano ancora più in alto: quante
ore vale una commessa, in che pacchetti si divide, e chi le fa in che settimana.
Da qui se ne legge il quadro e se ne scrivono le ore; le voci, le scomposizioni
e le attivazioni si fanno nell'app, dove c'è la matrice.

Una commessa può avere più consegne, una lista To-Do ciascuna con la sua
scadenza (nome GRUPPO.Consegna-YYMMDD). --sezione accetta sia il nome della
commessa — e allora vale per tutte le sue consegne — sia quello di una consegna
sola. Per creare un'attività la consegna va indicata: «tutta la commessa» non è
un posto in cui scrivere.

Le taglie, orientativamente: ${GRANULARITY_MEMO_LINE.replace('Orientativamente: ', '')}

Le stesse operazioni sono disponibili come server MCP (scripts/mente-mcp.mjs),
per usarle da una chat invece che da un terminale.

Autenticazione: refresh token in scripts/.mente-refresh-token o in
MENTE_REFRESH_TOKEN. Per ottenerlo: node scripts/get-refresh-token.mjs
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
