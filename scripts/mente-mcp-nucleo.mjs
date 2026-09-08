/**
 * mente-mcp-nucleo.mjs
 * Il server MCP della mente digitale senza il suo trasporto.
 *
 * Qui stanno gli strumenti — le descrizioni che il modello legge per scegliere
 * — e il dispatcher JSON-RPC. Quello che manca è come i messaggi arrivano e
 * come se ne vanno: da una pipe (`mente-mcp.mjs`, il processo che il client
 * avvia sul tuo computer) o da una richiesta HTTPS (`worker/index.js`, il
 * connettore che l'account Claude raggiunge da solo — ed è quello che rende la
 * mente digitale usabile a voce, guidando).
 *
 * Erano una cosa sola finché il trasporto era uno solo. Adesso sono due, e le
 * regole del protocollo non possono stare in tutte e due: è la stessa ragione
 * per cui le operazioni stanno in `mente-comandi.mjs` e non nei due modi di
 * chiamarle.
 *
 * Le operazioni vere, e le regole su cosa si può scrivere, restano in
 * `mente-comandi.mjs`. Qui non si decide niente: si dice al modello cosa c'è.
 *
 * Nessuna dipendenza: gira su Node 18+ e dentro un Worker.
 */

import * as mente from './mente-comandi.mjs';
import {
  TASK_STATUSES, CONTEXTS, STATI_SCRIVIBILI, STATI_CREABILI, TIPI_DIARIO, GRANULARITY_MEMO_LINE,
} from './mente-comandi.mjs';

export const SERVER = { name: 'mente-digitale', version: '1.0.0' };
const PROTOCOL_DEFAULT = '2025-06-18';

// ── Strumenti ────────────────────────────────────────────────────────────────
// Le descrizioni sono quello che il modello legge per decidere se un tool
// serve: dicono cosa restituisce e, dove conta, cosa NON fa.

const stringa = /** @param {string} description */ description => ({ type: 'string', description });


/** @type {{ name: string, description: string, schema: any, sola_lettura: boolean, run: (a: any) => Promise<{data:any,text:string}> }[]} */
export const TOOLS = [
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
    description: 'Gli eventi del calendario Outlook nei prossimi giorni. Per crearne uno c\'è evento_crea.',
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
    name: 'evento_crea',
    description:
      "Crea un evento sul calendario Outlook. Le ore si danno locali e locali restano: «giovedì " +
      "alle 15» è le 15 sul calendario. Senza fine né durata dura un'ora; senza calendario va su " +
      "quello di default. Un evento non è un'attività: qui va quello che ha un'ora fissa e " +
      "riguarda anche altri (una riunione, un appuntamento). Quello che si deve fare e basta è " +
      "un'attività, e si mette a piano con piano_aggiungi.",
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['oggetto'],
      properties: {
        oggetto: stringa("L'oggetto dell'evento."),
        data: stringa('Giorno, YYYY-MM-DD. Default: oggi.'),
        inizio: stringa("Ora d'inizio, HH:MM. Serve, se non è tutto il giorno."),
        fine: stringa('Ora di fine, HH:MM. Alternativa a durataMin.'),
        durataMin: { type: 'integer', description: 'Durata in minuti. Default 60.' },
        tuttoIlGiorno: { type: 'boolean', description: 'Evento di giornata intera. Default false.' },
        luogo: stringa('Luogo.'),
        note: stringa("Testo nel corpo dell'evento."),
        promemoriaMin: {
          type: 'integer',
          description: 'Minuti di preavviso del promemoria. Un numero negativo lo spegne. ' +
            "Omesso, resta il default dell'account.",
        },
        calendario: stringa('Nome anche parziale del calendario. Default: quello di default.'),
      },
    },
    run: a => mente.eventoCrea(a),
  },
  {
    name: 'piano',
    description:
      'I blocchi del piano di un giorno: orario, attività, sottopassi e cosa è già stato chiuso. ' +
      'Per vedere una settimana o un mese interi c\'è piano_arco; per metterci dentro ' +
      'un\'attività, piano_aggiungi.',
    sola_lettura: true,
    schema: { type: 'object', properties: { data: stringa('Giorno, YYYY-MM-DD. Default: oggi.') } },
    run: a => mente.piano(a),
  },
  {
    name: 'piano_arco',
    description:
      'Il piano di una settimana o di un mese interi, giorno per giorno, con quante ore sono già ' +
      'a piano in ciascuno e quali giorni sono ancora liberi. È la stessa cosa di «piano» letta ' +
      'dalla distanza da cui si decide se la settimana sta in piedi. Sola lettura.',
    sola_lettura: true,
    schema: {
      type: 'object',
      properties: {
        data: stringa('Un giorno qualunque della settimana da guardare, YYYY-MM-DD. Default: oggi.'),
        mese: stringa('Un mese intero, YYYY-MM. Alternativo a data.'),
      },
    },
    run: a => mente.pianoArco(a),
  },
  {
    name: 'piano_aggiungi',
    description:
      "Mette un'attività nel piano di un giorno, a un'ora: è così che un'attività diventa " +
      '«programmata». Il giorno può essere uno qualunque — è con questo, un giorno per volta, ' +
      'che si compila il piano della settimana o del mese. Senza durata usa la stima ' +
      "dell'attività. Due blocchi che si accavallano sono un errore, non una sovrapposizione: " +
      "se all'ora chiesta c'è già qualcosa, lo dice e non scrive niente.",
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['attivita', 'ora'],
      properties: {
        attivita: stringa("Id (anche solo l'inizio) o pezzo di titolo dell'attività."),
        ora: stringa("Ora d'inizio, HH:MM."),
        data: stringa('Giorno, YYYY-MM-DD. Default: oggi.'),
        durataMin: { type: 'integer', description: "Durata in minuti. Default: la stima dell'attività." },
      },
    },
    run: a => mente.pianoAggiungi(a),
  },
  {
    name: 'piano_togli',
    description:
      "Toglie un'attività dal piano di un giorno. Non la completa e non la cancella: torna solo " +
      "a non avere un'ora. Serve anche per spostarla — si toglie e si rimette a un'altra ora.",
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['attivita'],
      properties: {
        attivita: stringa("Id o pezzo di titolo dell'attività da togliere."),
        data: stringa('Giorno, YYYY-MM-DD. Default: oggi.'),
      },
    },
    run: a => mente.pianoTogli(a),
  },
  {
    name: 'obiettivi_leggi',
    description:
      'Gli obiettivi di un mese: da tre a sei righe che dicono dove si vuole arrivare entro il ' +
      'trentuno, con quanto è già fatto. È il piano del mese nel senso che conta — non quando si ' +
      'fanno le cose, che è la griglia dei giorni. Sola lettura.',
    sola_lettura: true,
    schema: { type: 'object', properties: { mese: stringa('Mese, YYYY-MM. Default: questo.') } },
    run: a => mente.obiettiviLeggi(a),
  },
  {
    name: 'obiettivi_scrivi',
    description:
      "Scrive gli obiettivi di un mese, tutti insieme: sostituiscono quelli che c'erano. Da tre a " +
      'sei — sotto i tre è un elenco della spesa, sopra i sei non è più una scelta. Un obiettivo ' +
      "che l'app già conta da sé (movimento, diario) dichiara una `fonte` invece di `fatti`, e il " +
      'numero lo deriva. Prima di scrivere conviene leggere quelli che ci sono.',
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['obiettivi'],
      properties: {
        mese: stringa('Mese, YYYY-MM. Default: questo.'),
        obiettivi: {
          type: 'array',
          minItems: 3,
          maxItems: 6,
          description: 'Gli obiettivi del mese, da tre a sei.',
          items: {
            type: 'object',
            required: ['titolo', 'totale'],
            properties: {
              titolo: stringa("Cosa si vuole aver fatto entro fine mese."),
              totale: { type: 'integer', description: 'Il traguardo: quante volte, quante ore, quanti pezzi.' },
              fatti: { type: 'integer', description: 'Quanti già fatti. Default 0. Non si mette insieme a fonte.' },
              unita: stringa('Come si chiamano ("sessioni", "giorni", "pagine"). Facoltativa.'),
              fonte: {
                type: 'string',
                enum: ['movimento', 'movimento:movimento', 'movimento:meditazione', 'movimento:yoga', 'diario'],
                description: "Il registro dell'app da cui derivare il numero fatto, invece di dirlo a mano.",
              },
            },
          },
        },
      },
    },
    run: a => mente.obiettiviScrivi(a),
  },
  {
    name: 'sezioni',
    description:
      'Le sezioni PARA: le liste di attività con quante ne hanno di aperte, e i taccuini ' +
      'OneNote con le loro sezioni. Utile per sapere quali nomi di sezione esistono prima di filtrare o creare. ' +
      'Le liste sono raccolte per commessa: una commessa può avere più consegne, una lista ciascuna ' +
      '(nome GRUPPO.Consegna-YYMMDD), e ogni consegna porta la sua scadenza.',
    sola_lettura: true,
    schema: { type: 'object', properties: {} },
    run: () => mente.sezioni(),
  },
  {
    name: 'sezione_crea',
    description:
      'Crea una lista — che nella mente digitale è una sezione, o la consegna ' +
      'di una commessa. Per una consegna si passano commessa, nome e scadenza, e il nome lo ' +
      'compone la convenzione (GRUPPO.Consegna-YYMMDD): scritto a mano e sbagliato, non verrebbe ' +
      'letto come consegna da nessuna parte e la scadenza sparirebbe in silenzio.',
    sola_lettura: false,
    schema: {
      type: 'object',
      properties: {
        nome: stringa('Il nome per intero, per una sezione che non è una consegna.'),
        commessa: stringa('La commessa (il gruppo). Insieme a consegna.'),
        consegna: stringa('Il nome della consegna. Insieme a commessa.'),
        scadenza: stringa('Scadenza della consegna, YYYY-MM-DD. Finisce nel nome della lista.'),
      },
    },
    run: a => mente.sezioneCrea(a),
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
          'Filtra per sezione (nome anche parziale della lista). Il nome di una commessa ' +
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
      "Crea un'attività. Senza sezione finisce in Inbox con il solo titolo, che è il modo " +
      'giusto di catturare al volo; con una sezione può nascere già chiarita (stato, stima, contesto, scadenza). ' +
      GRANULARITY_MEMO_LINE,
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['titolo'],
      properties: {
        titolo: stringa("Titolo dell'attività."),
        sezione: stringa(
          'Sezione in cui creare (nome anche parziale della lista). Serve fuori da Inbox. ' +
          'Se la commessa ha più consegne va indicata la consegna: «tutta la commessa» non è un posto ' +
          'in cui scrivere.'),
        stato: { type: 'string', enum: [...STATI_CREABILI], description: 'Default: inbox senza sezione, next con sezione.' },
        stimaMin: { type: 'integer', description: 'Stima di durata in minuti.' },
        scadenza: stringa('Scadenza, YYYY-MM-DD.'),
        contesto: { type: 'string', enum: CONTEXTS.map(c => c.key), description: 'Contesto GTD.' },
        nota: stringa('Testo della nota.'),
        attesa: stringa(
          'Nome della persona. Solo con stato ask, waiting o delegated — obbligatorio con ask e delegated. ' +
          'I nomi che ricorrono stanno in src/persone.json.'),
      },
    },
    run: a => mente.attivitaCrea(a),
  },
  {
    name: 'attivita_stato',
    description:
      `Sposta un'attività nel flusso: ${STATI_SCRIVIBILI.join(', ')}. «ask» (da chiedere) e «delegated» ` +
      'portano il nome di una persona, che finisce in una riga delle note. ' +
      "L'attività si indica con un pezzo del suo " +
      'id o del suo titolo, purché identifichi una sola attività. «inbox» e «scheduled» non si impostano da qui: ' +
      'il primo è la lista di default, il secondo un blocco nel piano.',
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['attivita', 'stato'],
      properties: {
        attivita: stringa("Id (anche solo l'inizio) o pezzo di titolo dell'attività."),
        stato: { type: 'string', enum: [...STATI_SCRIVIBILI], description: 'Nuovo stato.' },
        persona: stringa(
          'Nome della persona, per gli stati ask, waiting e delegated. Senza, si tiene quella che ' +
          "l'attività aveva già."),
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
    name: 'note_crea',
    description:
      'Crea una pagina nuova in una sezione OneNote. Il testo si passa semplice: le righe vuote ' +
      'separano i paragrafi, le righe che cominciano con «- » diventano un elenco.',
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['sezione', 'titolo'],
      properties: {
        sezione: stringa('Nome anche parziale della sezione OneNote.'),
        titolo: stringa('Titolo della pagina.'),
        testo: stringa('Il contenuto. Righe vuote fra i paragrafi, «- » per gli elenchi.'),
      },
    },
    run: a => mente.noteCrea(a),
  },
  {
    name: 'note_aggiungi',
    description:
      'Aggiunge testo in fondo a una pagina OneNote che esiste già, per id oppure per titolo ' +
      'indicando anche la sezione. Solo in fondo: da qui non si sostituisce e non si cancella ' +
      'niente, perché una sostituzione sbagliata alla cieca porterebbe via appunti che non si ' +
      'ricostruiscono.',
    sola_lettura: false,
    schema: {
      type: 'object',
      required: ['pagina', 'testo'],
      properties: {
        pagina: stringa('Id della pagina, oppure il suo titolo (in quel caso serve anche la sezione).'),
        sezione: stringa('Sezione in cui cercare il titolo.'),
        testo: stringa('Il testo da aggiungere.'),
      },
    },
    run: a => mente.noteAggiungi(a),
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

// ── Quali strumenti escono di casa ───────────────────────────────────────────
// Dal computer ci sono tutti. Dal connettore remoto — cioè dal telefono, e
// soprattutto parlando mentre si guida — ce n'è una parte, ed è una scelta,
// non una limitazione tecnica:
//
//  - ogni strumento in più è una descrizione in più che il modello legge prima
//    di rispondere, e in una telefonata l'attesa si sente;
//  - OneNote è il caso peggiore: `note_leggi` può tirare dentro pagine intere
//    di appunti, che a voce diventano un risultato lungo e inguardabile;
//  - `obiettivi_scrivi` e la Bussola sono i documenti che si scrivono
//    pensandoci, non dettandoli a un microfono in tangenziale. Il README lo
//    dice già per la Bussola; qui vale uguale;
//  - `diario_leggi` no e `diario_scrivi` sì, perché in auto il diario si detta,
//    non si riascolta.
//
// Sta qui e non sparso nei ventuno strumenti perché la domanda «cosa può fare
// il connettore?» deve avere una risposta che si legge in un colpo d'occhio.
// Una prova verifica che ogni nome esista davvero (`prova-mcp-remoto.mjs`):
// un rinomino, altrimenti, svuoterebbe il connettore in silenzio.
export const NOMI_DA_VOCE = [
  'oggi', 'agenda', 'piano', 'piano_arco', 'attivita_lista', 'sezioni', 'obiettivi_leggi',
  'attivita_crea', 'attivita_stato', 'piano_aggiungi', 'piano_togli',
  'evento_crea', 'diario_scrivi', 'sezione_crea',
];

// ── Le istruzioni dell'handshake ─────────────────────────────────────────────
// Il modello le legge una volta sola, all'inizio: è lì che si dice cosa sono
// queste cose e come si tengono insieme.

export const ISTRUZIONI =
  'La mente digitale di Michele: attività (file JSON su OneDrive), piano del giorno, calendario, ' +
  'diario, obiettivi del mese e taccuini OneNote. Si legge tutto e si scrive quasi ' +
  'ovunque: attività e liste, blocchi del piano, eventi del calendario, pagine OneNote, ' +
  'voci di diario, obiettivi. Nessuno strumento cancella niente, e su OneNote si scrive ' +
  'solo in fondo a una pagina, mai sopra a quello che c\'era.\n' +
  'Una sezione è una lista; una commessa può averne più di una, una per consegna, ' +
  'chiamata GRUPPO.Consegna-YYMMDD, dove le ultime sei cifre sono la scadenza.\n' +
  "Un'attività è una cosa da fare; un evento del calendario è un'ora fissa che riguarda " +
  "anche altri. Piano del giorno, della settimana e del mese non sono tre piani ma tre " +
  "distanze da cui si guarda lo stesso: si compilano tutti con piano_aggiungi, un giorno " +
  'per volta, e si rileggono con piano_arco. Gli obiettivi del mese sono un\'altra cosa ' +
  'ancora: dove si vuole arrivare, non quando si fanno le cose.\n' +
  GRANULARITY_MEMO_LINE;

// Le stesse cose dette a chi risponderà a voce. Più corte apposta: quello che
// il modello legge qui se lo porta dietro per tutta la conversazione, e in
// telefonata la parte che conta non è la completezza ma la lunghezza della
// risposta — nessuno può leggere un elenco, e nemmeno riascoltarlo.
export const ISTRUZIONI_VOCE =
  'La mente digitale di Michele — attività, piano del giorno, calendario, diario, ' +
  'obiettivi del mese — da un telefono, spesso in auto, parlando.\n' +
  'Rispondi corto e dicibile ad alta voce: quante cose ci sono e le prime due o tre, ' +
  'non l\'elenco intero; le ore come si dicono («giovedì alle nove»), non come si scrivono. ' +
  'Chiedi solo quello che manca davvero per fare la cosa, e poi falla.\n' +
  'Una sezione è una lista; una commessa può averne più di una, una per consegna, ' +
  'chiamata GRUPPO.Consegna-YYMMDD, dove le ultime sei cifre sono la scadenza.\n' +
  "Un'attività è una cosa da fare; un evento del calendario è un'ora fissa che riguarda " +
  'anche altri. Mettere a piano vuol dire dare un\'ora a un\'attività in un giorno.\n' +
  'Da qui non si cancella niente, e OneNote, il diario da rileggere e gli obiettivi da ' +
  'riscrivere non ci sono: quelli si fanno dal computer, seduti.\n' +
  GRANULARITY_MEMO_LINE;

// ── JSON-RPC ─────────────────────────────────────────────────────────────────
// `rispondi` restituisce il messaggio invece di scriverlo da qualche parte:
// chi la chiama sa lui dove mandarlo — una riga su stdout, il corpo di una
// risposta HTTP. È il taglio che permette a stdio e HTTPS di essere lo stesso
// server.

/**
 * @param {{ soloDaVoce?: boolean, istruzioni?: string }} [config]
 * @returns {{
 *   tools: typeof TOOLS,
 *   elencoTools: () => any[],
 *   rispondi: (req: any) => Promise<any|null>,
 * }}
 */
export function creaServer(config = {}) {
  const { soloDaVoce = false, istruzioni = ISTRUZIONI } = config;
  const tools = soloDaVoce ? TOOLS.filter(t => NOMI_DA_VOCE.includes(t.name)) : TOOLS;

  /** La forma che il protocollo si aspetta da tools/list. */
  const elencoTools = () => tools.map(t => ({
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

  /** @param {string|number} id @param {any} result */
  const risposta = (id, result) => ({ jsonrpc: '2.0', id, result });

  /** @param {string|number} id @param {number} code @param {string} message */
  const errore = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  /**
   * @param {any} req
   * @returns {Promise<any|null>} il messaggio da rimandare, o null se non se ne aspetta
   */
  async function rispondi(req) {
    const { id, method, params } = req || {};

    // Le notifiche (nessun id) non vogliono risposta: `notifications/initialized`
    // è quella che arriva sempre, subito dopo l'handshake.
    if (id === undefined || id === null) return null;

    switch (method) {
      case 'initialize':
        return risposta(id, {
          // Si risponde con la versione chiesta dal client quando è una stringa:
          // il server non ha stato da versionare, e così parla con tutti.
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_DEFAULT,
          capabilities: { tools: {} },
          serverInfo: SERVER,
          instructions: istruzioni,
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
        const tool = tools.find(t => t.name === params?.name);
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

  return { tools, elencoTools, rispondi };
}
