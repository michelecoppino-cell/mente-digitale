/**
 * mente-mcp.mjs
 * La mente digitale come server MCP (Model Context Protocol).
 *
 * Espone le stesse operazioni di `mente.mjs` come strumenti che un client —
 * Claude Code, l'app desktop — può chiamare da solo durante una conversazione.
 * La differenza con la riga di comando è solo l'involucro: le operazioni, e le
 * regole su cosa si può scrivere, stanno in `mente-comandi.mjs`.
 *
 * Parla JSON-RPC 2.0 su stdio, un messaggio per riga. Il protocollo è
 * implementato a mano — sono un centinaio di righe, e il progetto non ha
 * dipendenze: non è il caso di aggiungerne una per un handshake e tre metodi.
 *
 * Il client lo avvia e lo chiude: non è un servizio che resta acceso.
 *
 *   node scripts/mente-mcp.mjs        (non si lancia a mano: lo lancia il client)
 *
 * Nessuna dipendenza, Node 18+.
 */

import { createInterface } from 'readline';
import * as mente from './mente-comandi.mjs';
import {
  TASK_STATUSES, CONTEXTS, STATI_SCRIVIBILI, STATI_CREABILI, TIPI_DIARIO, GRANULARITY_MEMO_LINE,
} from './mente-comandi.mjs';

const SERVER = { name: 'mente-digitale', version: '1.0.0' };
const PROTOCOL_DEFAULT = '2025-06-18';

// ── Strumenti ────────────────────────────────────────────────────────────────
// Le descrizioni sono quello che il modello legge per decidere se un tool
// serve: dicono cosa restituisce e, dove conta, cosa NON fa.

const stringa = /** @param {string} description */ description => ({ type: 'string', description });

/** @type {{ name: string, description: string, schema: any, sola_lettura: boolean, run: (a: any) => Promise<{data:any,text:string}> }[]} */
const TOOLS = [
  {
    name: 'oggi',
    description:
      'Il quadro del giorno: eventi del calendario, blocchi del piano, quante attività ci sono per stato ' +
      'e quali sono programmate in giorni passati e mai chiuse. È il punto di partenza per "come sta andando".',
    sola_lettura: true,
    schema: { type: 'object', properties: { data: stringa('Giorno da guardare, YYYY-MM-DD. Default: oggi.') } },
    run: a => mente.oggi(a),
  },
  {
    name: 'agenda',
    description: 'Gli eventi del calendario Outlook nei prossimi giorni. Sola lettura: da qui non si creano eventi.',
    sola_lettura: true,
    schema: {
      type: 'object',
      properties: {
        giorni: { type: 'integer', description: 'Quanti giorni guardare avanti. Default 7.' },
        data: stringa('Giorno di partenza, YYYY-MM-DD. Default: oggi.'),
      },
    },
    run: a => mente.agenda(a),
  },
  {
    name: 'piano',
    description:
      'I blocchi del piano di un giorno: orario, attività, sottopassi e cosa è già stato chiuso. ' +
      'Sola lettura: programmare un\'attività si fa trascinandola nell\'app.',
    sola_lettura: true,
    schema: { type: 'object', properties: { data: stringa('Giorno, YYYY-MM-DD. Default: oggi.') } },
    run: a => mente.piano(a),
  },
  {
    name: 'sezioni',
    description:
      'Le sezioni PARA: le liste di Microsoft To-Do con quante attività aperte hanno, e i taccuini ' +
      'OneNote con le loro sezioni. Utile per sapere quali nomi di sezione esistono prima di filtrare o creare. ' +
      'Le liste sono raccolte per commessa: una commessa può avere più consegne, una lista ciascuna ' +
      '(nome GRUPPO.Consegna-YYMMDD), e ogni consegna porta la sua scadenza.',
    sola_lettura: true,
    schema: { type: 'object', properties: {} },
    run: () => mente.sezioni(),
  },
  {
    name: 'attivita_lista',
    description:
      'Le attività con il loro stato nel flusso GTD, sezione, consegna, contesto, stima, scadenza, note e ' +
      `sottoattività. Stati: ${TASK_STATUSES.join(', ')}. Ogni attività porta un id: serve per cambiarle stato. ` +
      "Quando la commessa ha più consegne, ogni attività dice a quale appartiene e quando quella consegna scade.",
    sola_lettura: true,
    schema: {
      type: 'object',
      properties: {
        stato: { type: 'string', enum: [...TASK_STATUSES], description: 'Filtra per stato del flusso.' },
        sezione: stringa(
          'Filtra per sezione (nome anche parziale della lista To-Do). Il nome di una commessa ' +
          'vale per tutte le sue consegne: «2573» prende anche 2573.A60 e 2573.B10.'),
        contesto: { type: 'string', enum: CONTEXTS.map(c => c.key), description: 'Filtra per contesto.' },
        includiFatte: { type: 'boolean', description: 'Include anche le attività completate. Default false.' },
      },
    },
    run: a => mente.attivitaLista(a),
  },
  {
    name: 'attivita_crea',
    description:
      "Crea un'attività su Microsoft To-Do. Senza sezione finisce in Inbox con il solo titolo, che è il modo " +
      'giusto di catturare al volo; con una sezione può nascere già chiarita (stato, stima, contesto, scadenza). ' +
      GRANULARITY_MEMO_LINE,
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['titolo'],
      properties: {
        titolo: stringa("Titolo dell'attività."),
        sezione: stringa(
          'Sezione in cui creare (nome anche parziale della lista To-Do). Serve fuori da Inbox. ' +
          'Se la commessa ha più consegne va indicata la consegna: «tutta la commessa» non è un posto ' +
          'in cui scrivere.'),
        stato: { type: 'string', enum: [...STATI_CREABILI], description: 'Default: inbox senza sezione, next con sezione.' },
        stimaMin: { type: 'integer', description: 'Stima di durata in minuti.' },
        scadenza: stringa('Scadenza, YYYY-MM-DD.'),
        contesto: { type: 'string', enum: CONTEXTS.map(c => c.key), description: 'Contesto GTD.' },
        nota: stringa('Testo della nota.'),
        attesa: stringa('Nome della persona attesa. Solo con stato waiting.'),
      },
    },
    run: a => mente.attivitaCrea(a),
  },
  {
    name: 'attivita_stato',
    description:
      `Sposta un'attività nel flusso: ${STATI_SCRIVIBILI.join(', ')}. L'attività si indica con un pezzo del suo ` +
      'id o del suo titolo, purché identifichi una sola attività. «inbox» e «scheduled» non si impostano da qui: ' +
      'il primo è la lista di default, il secondo un blocco nel piano.',
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['attivita', 'stato'],
      properties: {
        attivita: stringa("Id (anche solo l'inizio) o pezzo di titolo dell'attività."),
        stato: { type: 'string', enum: [...STATI_SCRIVIBILI], description: 'Nuovo stato.' },
      },
    },
    run: a => mente.attivitaStato(a),
  },
  {
    name: 'diario_leggi',
    description:
      'Le voci del diario personale, dalla più recente. Si può chiedere un mese preciso o gli ultimi N giorni, ' +
      'cercare un testo o filtrare per tag. Le voci "nel cassetto" restano fuori se non le si chiede.',
    sola_lettura: true,
    schema: {
      type: 'object',
      properties: {
        giorni: { type: 'integer', description: 'Ultimi N giorni. Default 14.' },
        mese: stringa('Un mese preciso, YYYY-MM. Alternativo a giorni.'),
        cerca: stringa('Cerca questo testo nelle voci.'),
        tag: stringa('Filtra per tag (senza #).'),
        includiCassetto: { type: 'boolean', description: 'Include le voci chiuse nel cassetto. Default false.' },
      },
    },
    run: a => mente.diarioLeggi(a),
  },
  {
    name: 'diario_scrivi',
    description:
      'Aggiunge una voce al diario, salvata su OneDrive nel file del suo mese come se fosse stata scritta ' +
      "dall'app. I tag si possono passare o lasciare che vengano ricavati dagli #hashtag nel testo.",
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['testo'],
      properties: {
        testo: stringa('Il testo della voce.'),
        tipo: { type: 'string', enum: [...TIPI_DIARIO], description: 'Default: libero.' },
        data: stringa('Giorno della voce, YYYY-MM-DD. Default: oggi.'),
        tag: { type: 'array', items: { type: 'string' }, description: 'Tag, senza #.' },
        umore: { type: 'integer', description: 'Da 1 a 5.' },
        energia: { type: 'integer', description: 'Da 1 a 5.' },
        gratitudine: { type: 'array', items: { type: 'string' }, description: 'Cose per cui si è grati.' },
        cassetto: { type: 'boolean', description: 'Salva la voce fuori dalla timeline. Default false.' },
      },
    },
    run: a => mente.diarioScrivi(a),
  },
  {
    name: 'note_pagine',
    description: "Le pagine OneNote di una sezione, con data di modifica e id. Sola lettura.",
    sola_lettura: true,
    schema: {
      type: 'object',
      required: ['sezione'],
      properties: { sezione: stringa('Nome anche parziale della sezione OneNote.') },
    },
    run: a => mente.notePagine(a),
  },
  {
    name: 'note_leggi',
    description: 'Il testo di una pagina OneNote, per id oppure per titolo indicando anche la sezione. Sola lettura.',
    sola_lettura: true,
    schema: {
      type: 'object',
      required: ['pagina'],
      properties: {
        pagina: stringa('Id della pagina, oppure il suo titolo (in quel caso serve anche la sezione).'),
        sezione: stringa('Sezione in cui cercare il titolo.'),
      },
    },
    run: a => mente.noteLeggi(a),
  },
  {
    name: 'identita',
    description:
      'I documenti identitari salvati su OneDrive: la Bussola (chi sono, valori, pratiche) e la Visione. ' +
      'Sono il contesto giusto quando la domanda riguarda direzione, scelte o come sta andando la vita, ' +
      'non le cose da fare. Sola lettura.',
    sola_lettura: true,
    schema: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: ['bussola', 'visione'], description: 'Default: bussola.' } },
    },
    run: a => mente.identita(a),
  },
];

/** La forma che il protocollo si aspetta da tools/list. */
function elencoTools() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: { ...t.schema, additionalProperties: false },
    annotations: {
      readOnlyHint: t.sola_lettura,
      destructiveHint: false,   // nessuno strumento cancella niente
      idempotentHint: t.sola_lettura,
      openWorldHint: true,      // i dati vivono su Microsoft Graph, non qui
    },
  }));
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

/** @param {any} msg */
function invia(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/** @param {string|number} id @param {any} result */
const risposta = (id, result) => invia({ jsonrpc: '2.0', id, result });

/** @param {string|number} id @param {number} code @param {string} message */
const errore = (id, code, message) => invia({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * @param {any} req
 * @returns {Promise<void>}
 */
async function gestisci(req) {
  const { id, method, params } = req || {};

  // Le notifiche (nessun id) non vogliono risposta: `notifications/initialized`
  // è quella che arriva sempre, subito dopo l'handshake.
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      return risposta(id, {
        // Si risponde con la versione chiesta dal client quando è una stringa:
        // il server non ha stato da versionare, e così parla con tutti.
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_DEFAULT,
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          'La mente digitale di Michele: attività (Microsoft To-Do), piano del giorno, calendario, ' +
          'diario e taccuini OneNote. Si scrive solo in due punti — una voce di diario, ' +
          "un'attività (creazione e cambio di stato). Tutto il resto è in sola lettura. " +
          'Una sezione è una lista To-Do; una commessa può averne più di una, una per consegna, ' +
          'chiamata GRUPPO.Consegna-YYMMDD, dove le ultime sei cifre sono la scadenza. ' +
          GRANULARITY_MEMO_LINE,
      });

    case 'ping':
      return risposta(id, {});

    case 'tools/list':
      return risposta(id, { tools: elencoTools() });

    // Nessuna risorsa e nessun prompt: si risponde con liste vuote invece che
    // con "metodo sconosciuto", che alcuni client segnalano come errore.
    case 'resources/list':
      return risposta(id, { resources: [] });
    case 'resources/templates/list':
      return risposta(id, { resourceTemplates: [] });
    case 'prompts/list':
      return risposta(id, { prompts: [] });

    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return errore(id, -32602, `Strumento sconosciuto: ${params?.name}`);
      try {
        const esito = await tool.run(params?.arguments || {});
        return risposta(id, {
          content: [{ type: 'text', text: esito.text || '(nessun risultato)' }],
          structuredContent: esito.data ?? {},
        });
      } catch (e) {
        // Un errore dello strumento non è un errore di protocollo: torna al
        // modello come risultato, così può correggere l'argomento e riprovare.
        return risposta(id, {
          content: [{ type: 'text', text: `Errore: ${e.message}` }],
          isError: true,
        });
      }
    }

    default:
      return errore(id, -32601, `Metodo non gestito: ${method}`);
  }
}

// ── Avvio ────────────────────────────────────────────────────────────────────
// Un messaggio per riga su stdin. Su stdout esce solo JSON-RPC: qualunque
// diagnostica va su stderr, o il client non riesce più a leggere il flusso.

const rl = createInterface({ input: process.stdin });

rl.on('line', line => {
  const riga = line.trim();
  if (!riga) return;
  let req;
  try {
    req = JSON.parse(riga);
  } catch {
    return errore(0, -32700, 'JSON non valido');
  }
  gestisci(req).catch(e => {
    console.error('[mente-mcp]', e);
    if (req?.id !== undefined && req?.id !== null) errore(req.id, -32603, e.message);
  });
});

rl.on('close', () => process.exit(0));
