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
      return mente.piano({ data: s(opts.data) });

    case 'sezioni':
      return mente.sezioni();

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
          nota: s(opts.nota), attesa: s(opts.attesa),
        });
      }
      if (sub === 'stato' || sub === 'completa') {
        return mente.attivitaStato({
          attivita: resto[1],
          stato: sub === 'completa' ? 'done' : resto[2],
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
      throw new Error(`note: sottocomando sconosciuto "${sub || ''}" (pagine, leggi)`);

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
  sezioni                         liste To-Do per commessa (con consegne, scadenze e
                                  attività aperte) e sezioni OneNote
  note pagine <sezione>           le pagine OneNote di una sezione
  note leggi <id | titolo --sezione X>
  bussola | visione               i documenti identitari

  attivita lista [--stato s] [--sezione s] [--contesto c] [--tutte]
  diario leggi [--mese YYYY-MM | --giorni N] [--cerca t] [--tag t] [--cassetto]

Scrittura
  attivita crea "titolo" [--sezione s] [--stato ${STATI_CREABILI.join('|')}]
                         [--stima 45] [--scadenza YYYY-MM-DD]
                         [--contesto ${CONTEXTS.map(c => c.key).join('|')}] [--nota "…"] [--attesa "Nome"]
  attivita stato <id|titolo> <${STATI_SCRIVIBILI.join('|')}>
  attivita completa <id|titolo>
  diario scrivi [--testo "…"] [--tipo ${TIPI_DIARIO.join('|')}] [--data YYYY-MM-DD]
                [--tag a,b] [--umore 1-5] [--energia 1-5] [--gratitudine "a|b"] [--cassetto]
                (senza --testo legge da stdin)

Globali
  --json                          esce in JSON invece che in testo

Stati del flusso: ${TASK_STATUSES.join(', ')}. Calendario, OneNote, Bussola e
piani si leggono soltanto: da qui non si scrivono, per non poter rovinare quello
che non si ricostruisce da solo.

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
