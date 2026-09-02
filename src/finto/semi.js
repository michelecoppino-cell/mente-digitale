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
];

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
