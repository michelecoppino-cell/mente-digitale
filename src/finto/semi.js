// Cosa c'è dentro il finto OneDrive quando si apre `npm run dev:finto`.
//
// Non un archivio vuoto: un'app vuota non mostra niente di quello che si sta
// provando a sistemare. Qui c'è una giornata plausibile — due commesse con le
// loro consegne, qualche attività in ognuno degli stati del flusso, un piano
// del giorno con dei blocchi, appuntamenti in calendario, un mese di diario,
// gli obiettivi, la coda di letture, il movimento della settimana.
//
// Tutto inventato e tutto verosimile: sono i dati con cui si guarda se una
// schermata regge, non i dati di nessuno.

import { ymd } from '../tempo.js';

const oggi = ymd();
const g = (/** @type {number} */ quanti) => {
  const d = new Date();
  d.setDate(d.getDate() + quanti);
  return ymd(d);
};
const mese = oggi.slice(0, 7);

/** @param {string} data @param {string} ora @returns {string} */
const istante = (data, ora) => `${data}T${ora}:00`;

// ── Le liste, e le attività dentro ──────────────────────────────────────────
// Una commessa con due consegne annidate (`2573.A60-…`, vedi paraConfig.js),
// una sezione di casa, e l'Inbox.

export const LISTE = [
  { id: 'l-inbox', nome: 'Attività', file: 'task/attivita.json', inbox: true },
  { id: 'l-2573a', nome: `2573.A60-Fondazioni-${g(40).slice(2).replace(/-/g, '')}`, file: 'task/2573-a60.json' },
  { id: 'l-2573b', nome: `2573.C10-Strutture-${g(90).slice(2).replace(/-/g, '')}`, file: 'task/2573-c10.json' },
  { id: 'l-casa', nome: 'Casa', file: 'task/casa.json' },
];

/** @param {Partial<any> & { id: string, titolo: string }} t */
const task = t => ({
  stato: 'next', persona: null, contesto: 'lavoro', stimaMin: null, sveglia: null,
  scadenza: null, nota: '', origineScadenza: null, ordine: null, sottoattivita: [],
  creatoIl: istante(g(-6), '09:00'), modificatoIl: istante(g(-2), '09:00'), completatoIl: null,
  ...t,
});

/** @type {Record<string, any[]>} */
export const TASK = {
  'l-inbox': [
    task({ id: 't-i1', titolo: 'Richiamare il fornitore dei tiranti', stato: 'inbox', contesto: null }),
    task({ id: 't-i2', titolo: 'Rivedere la relazione geotecnica', stato: 'inbox', contesto: null }),
  ],
  'l-2573a': [
    task({ id: 't-a1', titolo: 'Verifica a punzonamento plinto P3', stimaMin: 90, scadenza: g(2) }),
    task({ id: 't-a2', titolo: 'Modello SAP2000: carichi di piano', stimaMin: 120,
      sottoattivita: [
        { id: 's1', titolo: 'Permanenti portati', fatta: true },
        { id: 's2', titolo: 'Variabili per destinazione', fatta: false },
      ] }),
    task({ id: 't-a3', titolo: 'Quote di imposta dal rilievo', stato: 'ask', persona: 'Sara',
      modificatoIl: istante(g(-5), '11:00') }),
    task({ id: 't-a4', titolo: 'Esito prove penetrometriche', stato: 'waiting', persona: 'ADC',
      modificatoIl: istante(g(-9), '15:00') }),
  ],
  'l-2573b': [
    task({ id: 't-b1', titolo: 'Predimensionamento travi di copertura', stimaMin: 60, scadenza: g(6) }),
    task({ id: 't-b2', titolo: 'Disegni carpenteria piano primo', stato: 'delegated', persona: 'Marco',
      modificatoIl: istante(g(-3), '10:00') }),
    task({ id: 't-b3', titolo: 'Valutare il giunto sismico col corpo B', stato: 'someday' }),
  ],
  'l-casa': [
    task({ id: 't-c1', titolo: 'Preventivo caldaia', contesto: 'personale', stimaMin: 20, scadenza: g(1) }),
    task({ id: 't-c2', titolo: 'Revisione auto', contesto: 'famiglia', scadenza: g(12) }),
  ],
};

// ── I taccuini OneNote, le sezioni, le pagine ───────────────────────────────

export const TACCUINI = [
  { id: 'nb-lavoro', displayName: 'Lavoro' },
  { id: 'nb-vita', displayName: 'Vita' },
];

/** @type {Record<string, {id: string, displayName: string}[]>} */
export const SEZIONI = {
  'nb-lavoro': [
    { id: 'sec-2573', displayName: '2573-ABS' },
    { id: 'sec-2601', displayName: '2601-Villa' },
  ],
  'nb-vita': [
    { id: 'sec-casa', displayName: 'Casa' },
    { id: 'sec-letture', displayName: 'Letture' },
  ],
};

/** @type {Record<string, any[]>} */
export const PAGINE = {
  'sec-2573': [
    { id: 'p-1', title: 'Verbale sopralluogo', lastModifiedDateTime: istante(g(-1), '16:20'),
      links: { oneNoteClientUrl: { href: 'onenote:finto' } } },
    { id: 'p-2', title: 'Note di calcolo — fondazioni', lastModifiedDateTime: istante(g(-4), '09:10'),
      links: { oneNoteClientUrl: { href: 'onenote:finto' } } },
  ],
  'sec-2601': [
    { id: 'p-3', title: 'Richieste della committenza', lastModifiedDateTime: istante(g(-8), '18:00'),
      links: { oneNoteClientUrl: { href: 'onenote:finto' } } },
  ],
  'sec-casa': [
    { id: 'p-4', title: 'Manutenzioni', lastModifiedDateTime: istante(g(-20), '12:00'),
      links: { oneNoteClientUrl: { href: 'onenote:finto' } } },
  ],
  'sec-letture': [],
};

// ── Il calendario ───────────────────────────────────────────────────────────

export const CALENDARI = [
  { id: 'cal-1', name: 'Calendario', color: 'lightBlue', isDefaultCalendar: true,
    owner: { address: 'finto@esempio.it' } },
  { id: 'cal-mov', name: 'Movimento', color: 'lightGreen', owner: { address: 'finto@esempio.it' } },
];

/** @param {string} id @param {string} subject @param {string} data @param {string} da @param {string} a @param {string} [calId] */
const evento = (id, subject, data, da, a, calId = 'cal-1') => ({
  id, subject,
  start: { dateTime: istante(data, da), timeZone: 'UTC' },
  end: { dateTime: istante(data, a), timeZone: 'UTC' },
  isAllDay: false,
  webLink: '#',
  _calId: calId, _calName: calId === 'cal-1' ? 'Calendario' : 'Movimento',
  _calColor: calId === 'cal-1' ? 'lightBlue' : 'lightGreen',
});

export const EVENTI = [
  evento('e-1', 'Sopralluogo cantiere ABS', oggi, '08:30', '10:00'),
  evento('e-2', 'Call con la DL', oggi, '14:30', '15:00'),
  evento('e-3', 'Palestra', oggi, '18:30', '19:30', 'cal-mov'),
  evento('e-4', 'Consegna elaborati A60', g(2), '09:00', '09:30'),
  evento('e-5', 'Riunione di coordinamento', g(3), '11:00', '12:00'),
  evento('e-6', 'Corsa', g(1), '07:00', '07:45', 'cal-mov'),
  // Una scadenza ricorrente, scritta come si scrive davvero: fra venti giorni,
  // con trenta giorni di anticipo, quindi **dovuta oggi**. Serve a poter
  // vedere il meccanismo funzionare con `dev:finto` — è la cosa che, contro il
  // OneDrive vero, si può provare solo aspettando il giorno giusto. Vedi
  // src/deadlineReminders.js.
  evento('e-7', '[Casa +30g] Revisione caldaia', g(20), '09:00', '09:30'),
];

// Lo specchio del calendario di lavoro: quello che la GitHub Action scrive
// leggendo l'ultima mail mandata dal PC di lavoro (vedi
// scripts/sync-calendario-lavoro.mjs). Qui c'è già dentro, con una lettura di
// **sette ore fa**: sopra la soglia, quindi `dev:finto` mostra anche l'avviso
// «specchio fermo» — che è la cosa che, contro il OneDrive vero, si vedrebbe
// solo il giorno in cui il PC di lavoro resta spento.
const oreFa = (/** @type {number} */ quante) =>
  new Date(Date.now() - quante * 3_600_000).toISOString();

export const CALENDARIO_LAVORO = {
  version: 1,
  aggiornatoIl: oreFa(0),
  finestra: { da: g(-30), a: g(300) },
  fonti: [{ nome: 'Studio', tipo: 'mail', eventi: 3, letturaIl: oreFa(7), errore: null }],
  eventi: [
    { id: 'Studio|w1', fonte: 'Studio', subject: 'Riunione di produzione', isAllDay: false,
      start: `${oggi}T07:00:00`, end: `${oggi}T08:00:00` },
    { id: 'Studio|w2', fonte: 'Studio', subject: 'Verifica strutturale con il collaudatore', isAllDay: false,
      start: `${g(1)}T13:00:00`, end: `${g(1)}T15:00:00` },
    { id: 'Studio|w3', fonte: 'Studio', subject: 'Corso sicurezza', isAllDay: true,
      start: g(4), end: g(5) },
  ],
};

// ── I file dell'app su OneDrive ─────────────────────────────────────────────

export const PIANI = {
  [oggi]: {
    date: oggi,
    blocks: [
      { id: 'b-1', taskId: 't-a1', listId: 'l-2573a', taskTitle: 'Verifica a punzonamento plinto P3',
        startTime: '10:30', endTime: '12:00', completed: false, listName: 'Fondazioni' },
      { id: 'b-2', taskId: 't-c1', listId: 'l-casa', taskTitle: 'Preventivo caldaia',
        startTime: '16:00', endTime: '16:30', completed: false, listName: 'Casa' },
    ],
  },
  [g(1)]: {
    date: g(1),
    blocks: [
      { id: 'b-3', taskId: 't-a2', listId: 'l-2573a', taskTitle: 'Modello SAP2000: carichi di piano',
        startTime: '09:00', endTime: '11:00', completed: false, listName: 'Fondazioni' },
    ],
  },
};

export const OBIETTIVI = {
  [mese]: [
    { id: 'o-1', titolo: 'Consegnare le fondazioni A60', totale: 4, fatti: 1, unita: 'tavole' },
    { id: 'o-2', titolo: 'Tre allenamenti a settimana', totale: 12, unita: 'sessioni', fonte: 'movimento' },
    { id: 'o-3', titolo: 'Scrivere sul diario', totale: 20, unita: 'giorni', fonte: 'diario' },
    { id: 'o-4', titolo: 'Finire il libro sul sismico', totale: 420, unita: 'pagine', fonte: 'lettura:q-1' },
  ],
};

export const CODA = [
  { id: 'q-1', titolo: 'Progettazione sismica di edifici in c.a.', tipo: 'libro',
    stato: 'corso', fonte: 'Petrini', aggiunto: istante(g(-40), '20:00'),
    avanzamento: { fatti: 130, totale: 420, unita: 'pagine' } },
  { id: 'q-2', titolo: 'Il calcestruzzo che si ripara da solo', tipo: 'articolo',
    stato: 'coda', fonte: 'ingegneri.info', url: 'https://esempio.it/articolo',
    aggiunto: istante(g(-3), '13:00') },
  { id: 'q-3', titolo: 'Il ponte', tipo: 'film', stato: 'coda',
    aggiunto: istante(g(-11), '22:30') },
];

/** @param {Partial<import('../types').DiaryEntry> & { id: string }} v */
const voce = v => ({
  type: 'libero', text: '', mood: null, energy: null, tags: [], gratitude: [],
  answers: null, seed: null, sealed: false, photos: [],
  ...v,
});

export const DIARIO_MESE = [
  voce({ id: 'd-1', date: g(-2), ts: istante(g(-2), '22:10'), type: 'libero',
    text: 'Giornata di verifiche. Il modello finalmente torna: il problema era il vincolo alla base del pilastro d\'angolo, non i carichi. Tre giorni per una condizione al contorno.',
    tags: ['lavoro'], mood: 4, energy: 3 }),
  voce({ id: 'd-2', date: g(-5), ts: istante(g(-5), '21:40'), type: 'sera',
    text: 'Pomeriggio in cantiere, freddo. Il getto è venuto bene.',
    mood: 4, energy: 2, gratitude: ['Il getto finito prima della pioggia'],
    answers: { 'Cosa è andato bene?': 'Il getto.' } }),
  voce({ id: 'd-3', date: g(-9), ts: istante(g(-9), '07:30'), type: 'svuota-testa',
    text: 'Troppe cose aperte insieme. Scriverle tutte e poi decidere quale chiudere per prima.',
    seed: 'Cosa ti sta girando in testa?' }),
];

export const MOVIMENTO_MESE = [
  { id: 'm-1', date: g(-1), famiglia: 'movimento', tipo: 'Palestra', durataMin: 50,
    nota: 'gambe + core', createdAt: istante(g(-1), '19:30') },
  { id: 'm-2', date: g(-3), famiglia: 'yoga', tipo: 'Flow', durataMin: 30,
    createdAt: istante(g(-3), '07:15') },
  { id: 'm-3', date: g(-4), famiglia: 'meditazione', tipo: 'Seduta', durataMin: 15,
    createdAt: istante(g(-4), '06:50') },
  { id: 'm-4', date: g(-6), famiglia: 'movimento', tipo: 'Corsa', durataMin: 40,
    nota: '6 km', createdAt: istante(g(-6), '07:40') },
];

export const MOVIMENTO_INDICE = {
  months: [mese],
  calendarId: 'cal-mov',
  calendarName: 'Movimento',
  bersagli: { movimento: 3, meditazione: 3, yoga: 2 },
};

// La Bussola ha la forma del documento vero — sezioni con titolo e testo — ma
// il contenuto è inventato: quello vero non sta qui e non ci deve stare.
export const BUSSOLA = {
  sections: [
    { title: 'CHI SONO',
      content: 'Un testo finto al posto della Bussola vera.\n\nLe priorità, in ordine: la famiglia, me stesso, il lavoro, la crescita, la socialità, il movimento.' },
    { title: 'I CENTO DESIDERI',
      content: '1. Rivedere il mare d\'inverno\n2. Finire la casa sull\'albero\n3. Imparare a fare il pane\n4. Portare il bambino in montagna\n5. Rileggere un libro che mi è piaciuto dieci anni fa' },
  ],
};

// ── Il programma di commessa ────────────────────────────────────────────────
// Una commessa vera è larga sei mesi e ha una decina di pacchetti: senza dati
// dentro, la matrice è una griglia vuota e non dice se il disegno regge.

const settimana = (/** @type {number} */ quante) => {
  const d = new Date();
  d.setDate(d.getDate() + quante * 7);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const primo = new Date(t.getFullYear(), 0, 4);
  primo.setDate(primo.getDate() + 3 - ((primo.getDay() + 6) % 7));
  const n = 1 + Math.round((t.getTime() - primo.getTime()) / 86400000) / 7;
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`;
};

const PACCHETTI = [
  { id: 'pk-a20', nome: 'A20 Geotecnica', listId: null, colore: '#7fb488' },
  { id: 'pk-a30', nome: 'A30 Fondazioni', listId: 'l-2573a', colore: '#d4a44a' },
  { id: 'pk-a40', nome: 'A40 Strutture', listId: null, colore: '#a07bd0' },
  { id: 'pk-a50', nome: 'A50 Impianti', listId: null, colore: '#5b9bd5' },
];

/** @type {Record<string, number>} */
// Le prime tre colonne sono la cella; la quarta, quando c'è, è la **voce** su
// cui cadono quelle ore. Senza, sono ore date al pacchetto e basta — che è
// quello che scrive il consuntivo del passato, e quello che c'era nei file
// prima che le voci esistessero. Il seme tiene apposta tutti e due i casi: è
// l'unico modo di vedere, provando, che convivono.
const CARICO = {};
for (const [risorsa, pacchetto, da, ore, voce] of /** @type {[string, string, number, number, string?][]} */ ([
  ['Michele', 'pk-a30', -6, 8], ['Michele', 'pk-a30', -3, 12],
  ['Michele', 'pk-a30', 0, 10, 'vc-4'],
  ['Michele', 'pk-a40', 1, 14, 'vc-5'], ['Michele', 'pk-a40', 2, 16, 'vc-5'],
  ['Marco', 'pk-a30', -4, 30], ['Marco', 'pk-a30', -1, 34, 'vc-3'],
  ['Marco', 'pk-a40', 0, 36, 'vc-5'],
  ['Marco', 'pk-a40', 1, 28, 'vc-5'], ['Marco', 'pk-a40', 3, 20, 'vc-5'],
  ['Sara', 'pk-a20', -5, 18], ['Sara', 'pk-a20', -2, 16, 'vc-1'],
  ['Sara', 'pk-a50', 2, 12, 'vc-6'],
])) {
  const chiave = `${risorsa}|${pacchetto}|${settimana(da)}${voce ? `|${voce}` : ''}`;
  CARICO[chiave] = ore;
}

export const PROGRAMMI = [
  { id: 'pg-2573', nome: '2573 · Sottopasso ferroviario', file: 'programmi/2573-sottopasso.json', attivo: true },
  // La commessa grande: dieci persone, un anno, trenta sotto-voci. È quella su
  // cui si guarda se il pannello *si legge* — in fondo a questo file.
  { id: 'pg-2588', nome: '2588 · Ampliamento stabilimento', file: 'programmi/2588-ampliamento.json', attivo: true },
  { id: 'pg-2601', nome: '2601 · Villa', file: 'programmi/2601-villa.json', attivo: false },
];

/** @type {Record<string, any>} */
export const PROGRAMMA = {
  'pg-2573': {
    version: 1,
    id: 'pg-2573',
    commessa: {
      nome: '2573 · Sottopasso ferroviario', codice: '2573', oreVendute: 1200,
      inizio: g(-90), fine: g(120), settimaneDa: null, settimaneA: null,
      // Collegata alla sua sezione: è da lì che le liste prendono il nome
      // `2573.A60-…`, ed è il caso che si vuole vedere provando la vista.
      sezione: '2573-ABS', sezioneId: 'sec-2573',
    },
    risorse: [
      { nome: 'Michele', oreSettimana: 20 },
      { nome: 'Marco', oreSettimana: 35 },
      { nome: 'Sara', oreSettimana: 28 },
    ],
    pacchetti: PACCHETTI,
    voci: [
      { id: 'vc-1', titolo: 'Relazione geotecnica', nota: 'Attesa prove dal laboratorio.', pacchettoId: 'pk-a20',
        padreId: null, ore: 120, oreIniziali: 120, risorsa: 'Sara', finestra: { da: settimana(-5), a: settimana(-1) },
        scartata: false, taskId: null, listId: null, creatoIl: istante(g(-60), '09:00'), attivataIl: null },
      { id: 'vc-2', titolo: 'Fondazioni', nota: '', pacchettoId: 'pk-a30', padreId: null,
        ore: 410, oreIniziali: 360, risorsa: null, finestra: null, scartata: false,
        taskId: null, listId: null, creatoIl: istante(g(-60), '09:05'), attivataIl: null },
      { id: 'vc-3', titolo: 'Calcolo plinti P1-P4', nota: '', pacchettoId: 'pk-a30', padreId: 'vc-2',
        ore: 120, oreIniziali: 120, risorsa: 'Marco', finestra: { da: settimana(-2), a: settimana(1) },
        scartata: false, taskId: 't-a1', listId: 'l-2573a', creatoIl: istante(g(-40), '09:00'),
        attivataIl: istante(g(-10), '09:00') },
      { id: 'vc-4', titolo: 'Platea e muri di sostegno', nota: '', pacchettoId: 'pk-a30', padreId: 'vc-2',
        ore: 290, oreIniziali: 290, risorsa: null, finestra: { da: settimana(1), a: settimana(6) },
        scartata: false, taskId: null, listId: null, creatoIl: istante(g(-40), '09:02'), attivataIl: null },
      { id: 'vc-5', titolo: 'Impalcato — carpenteria', nota: '', pacchettoId: 'pk-a40', padreId: null,
        ore: 260, oreIniziali: 260, risorsa: 'Marco', finestra: { da: settimana(0), a: settimana(4) },
        scartata: false, taskId: null, listId: null, creatoIl: istante(g(-35), '10:00'), attivataIl: null },
      { id: 'vc-6', titolo: 'Drenaggio e pompe', nota: '', pacchettoId: 'pk-a50', padreId: null,
        ore: 96, oreIniziali: 96, risorsa: null, finestra: { da: settimana(3), a: settimana(8) },
        scartata: false, taskId: null, listId: null, creatoIl: istante(g(-30), '11:00'), attivataIl: null },
    ],
    carico: CARICO,
  },
  'pg-2601': {
    version: 1, id: 'pg-2601',
    // Spenta e vuota apposta: è il programma su cui si prova la scheda della
    // commessa, che prima di questa versione non esisteva e lasciava una
    // commessa così com'era nata.
    commessa: { nome: '2601 · Villa', codice: '', oreVendute: 0, inizio: null, fine: null,
      settimaneDa: null, settimaneA: null, sezione: null, sezioneId: null },
    risorse: [], pacchetti: [], voci: [], carico: {},
  },
};

// ── La commessa grande ──────────────────────────────────────────────────────
// La 2573 ha tre persone e sei voci: basta per vedere che la matrice funziona,
// non per vedere se **si legge**. Una commessa vera di studio ne ha dieci di
// persone, dieci lavorazioni scomposte in una trentina di sotto-voci, e un anno
// di settimane davanti — cioè cinquanta colonne e trenta righe aperte.
//
// È la scala a cui i difetti di leggibilità sono difetti veri: la fascia dei
// mesi che si perde, il nome che non si distingue dal pacchetto, la riga su cui
// si è che si confonde con le altre, il totale che non si sa a chi appartenga.
// Quindi sta qui dentro, e `dev:finto` la apre insieme alle altre.

const SQUADRA = [
  { nome: 'Michele', oreSettimana: 20 },
  { nome: 'Marco', oreSettimana: 35 },
  { nome: 'Sara', oreSettimana: 28 },
  { nome: 'Luca', oreSettimana: 35 },
  { nome: 'Elena', oreSettimana: 30 },
  { nome: 'Giovanni', oreSettimana: 35 },
  { nome: 'Chiara', oreSettimana: 24 },
  { nome: 'Andrea', oreSettimana: 35 },
  { nome: 'Federica', oreSettimana: 18 },
  { nome: 'Stefano', oreSettimana: 35 },
];

const PACCHETTI_G = [
  { id: 'gk-a10', nome: 'A10 Rilievi e indagini', listId: null, colore: '#7fb488' },
  { id: 'gk-a20', nome: 'A20 Geotecnica', listId: null, colore: '#5b9bd5' },
  { id: 'gk-b10', nome: 'B10 Fondazioni', listId: null, colore: '#d4a44a' },
  { id: 'gk-b20', nome: 'B20 Elevazioni', listId: null, colore: '#a07bd0' },
  { id: 'gk-c10', nome: 'C10 Carpenterie metalliche', listId: null, colore: '#c07a7a' },
  { id: 'gk-d10', nome: 'D10 Sismica e verifiche', listId: null, colore: '#6fa8a0' },
];

// Dieci lavorazioni, trenta sotto-voci:
// `[pacchetto, titolo, stima del primo giorno, risorsa, daW, aW, [figlie]]`.
//
// La stima è quella con cui la lavorazione è entrata in offerta, e resta lì:
// `ore` la rifà dalle figlie (`risommaContenitori`), `oreIniziali` no. La
// distanza fra le due è il dato che si guarda — «scomponendola è cresciuta di
// venti ore» — ed è per questo che qui i due numeri non coincidono mai.
const LAVORAZIONI = /** @type {[string, string, number, string|null, number, number, [string, number, string|null][]][]} */ ([
  ['gk-a10', 'Rilievo geometrico e restituzione', 150, 'Federica', -14, -8, [
    ['Rilievo con stazione totale', 60, 'Federica'],
    ['Restituzione piante e sezioni', 80, 'Federica'],
    ['Verifica quote con il DL', 24, 'Michele'],
  ]],
  ['gk-a20', 'Caratterizzazione geotecnica', 200, 'Sara', -12, -4, [
    ['Lettura prove penetrometriche', 40, 'Sara'],
    ['Modello di sottosuolo', 70, 'Sara'],
    ['Relazione geotecnica', 90, 'Sara'],
  ]],
  ['gk-a20', 'Risposta sismica locale', 160, 'Chiara', -6, 2, [
    ['Raccolta accelerogrammi', 30, 'Chiara'],
    ['Analisi monodimensionale', 85, 'Chiara'],
    ['Relazione RSL', 45, 'Chiara'],
  ]],
  ['gk-b10', 'Fondazioni corpo A', 400, 'Marco', -4, 6, [
    ['Predimensionamento plinti', 50, 'Marco'],
    ['Calcolo plinti P1-P12', 140, 'Marco'],
    ['Travi rovesce e collegamenti', 110, 'Luca'],
    ['Carpenterie fondazioni corpo A', 130, 'Luca'],
  ]],
  ['gk-b10', 'Fondazioni corpo B — platea', 300, 'Luca', 2, 12, [
    ['Modello platea su suolo elastico', 90, 'Luca'],
    ['Armature platea', 120, 'Andrea'],
    ['Verifiche a punzonamento', 60, 'Marco'],
  ]],
  ['gk-b20', 'Elevazioni in c.a.', 640, 'Andrea', 4, 18, [
    ['Modello globale SAP2000', 120, 'Michele'],
    ['Pilastri e setti — verifiche', 160, 'Andrea'],
    ['Solai e scale', 140, 'Elena'],
    ['Carpenterie elevazioni', 180, 'Elena'],
  ]],
  ['gk-c10', 'Copertura metallica', 480, 'Giovanni', 8, 22, [
    ['Schema statico e predimensionamento', 70, 'Giovanni'],
    ['Verifiche travi reticolari', 130, 'Giovanni'],
    ['Nodi e collegamenti bullonati', 150, 'Stefano'],
    ['Disegni officina', 160, 'Stefano'],
  ]],
  ['gk-c10', 'Controventi e baraccature', 150, 'Stefano', 14, 24, [
    ['Verifica controventi di falda', 80, 'Stefano'],
    ['Baraccature di parete', 70, 'Giovanni'],
  ]],
  ['gk-d10', 'Verifiche sismiche globali', 250, 'Michele', 10, 26, [
    ['Analisi modale e spettri NTC 2018', 100, 'Michele'],
    ['Verifiche di duttilità', 90, 'Chiara'],
    ['Spostamenti di interpiano', 60, 'Elena'],
  ]],
  ['gk-d10', 'Relazione di calcolo e consegna', 280, 'Michele', 24, 32, [
    ['Fascicolo dei calcoli', 130, 'Andrea'],
    ['Relazione generale', 90, 'Michele'],
    ['Revisione e timbri', 40, 'Michele'],
  ]],
]);

/** @type {any[]} */
const VOCI_G = [];
/** @type {Record<string, number>} */
const CARICO_G = {};

LAVORAZIONI.forEach(([pacchettoId, titolo, ore, risorsa, daW, aW, figlie], i) => {
  const madre = `gv-${i + 1}`;
  VOCI_G.push({
    id: madre, titolo, nota: '', pacchettoId, padreId: null,
    ore, oreIniziali: ore, risorsa,
    finestra: { da: settimana(daW), a: settimana(aW) },
    scartata: false, taskId: null, listId: null,
    creatoIl: istante(g(-100), '09:00'), attivataIl: null,
  });
  figlie.forEach(([sotto, oreFiglia, chi], j) => {
    // Le figlie si spartiscono la finestra della madre, in ordine: la seconda
    // comincia dove finisce la prima.
    const da = daW + Math.round(((aW - daW) * j) / figlie.length);
    const a = Math.max(da, daW + Math.round(((aW - daW) * (j + 1)) / figlie.length) - 1);
    VOCI_G.push({
      id: `gv-${i + 1}-${j + 1}`, titolo: sotto, nota: '', pacchettoId, padreId: madre,
      ore: oreFiglia, oreIniziali: oreFiglia, risorsa: chi,
      finestra: { da: settimana(da), a: settimana(a) },
      scartata: false, taskId: null, listId: null,
      creatoIl: istante(g(-100), '09:00'), attivataIl: null,
    });
    // E le loro ore finiscono nelle settimane della loro finestra: la matrice
    // si riempie come si riempirebbe davvero — un piano che copre l'anno e in
    // qualche punto sfora — invece che di celle sparse.
    if (!chi) return;
    const quante = a - da + 1;
    const perSettimana = Math.round((oreFiglia / quante) * 2) / 2;
    for (let k = 0; k < quante; k++) {
      // Le ore vanno **sulla figlia**: è dove sta la descrizione del lavoro,
      // ed è la riga in cui la matrice le fa scrivere.
      const chiave = `${chi}|${pacchettoId}|${settimana(da + k)}|gv-${i + 1}-${j + 1}`;
      CARICO_G[chiave] = (CARICO_G[chiave] || 0) + perSettimana;
    }
  });
});

/** @type {any} */
export const PROGRAMMA_GRANDE = {
  version: 1,
  id: 'pg-2588',
  commessa: {
    nome: '2588 · Ampliamento stabilimento', codice: '2588', oreVendute: 4200,
    inizio: g(-105), fine: g(240), settimaneDa: null, settimaneA: null,
    sezione: null, sezioneId: null,
  },
  risorse: SQUADRA,
  pacchetti: PACCHETTI_G,
  voci: VOCI_G,
  carico: CARICO_G,
};

// Si aggancia qui e non dentro `PROGRAMMA` più su: quella mappa è la prima cosa
// che si legge scorrendo il file, e cinquanta righe di commessa grande in mezzo
// la renderebbero illeggibile.
PROGRAMMA['pg-2588'] = PROGRAMMA_GRANDE;
