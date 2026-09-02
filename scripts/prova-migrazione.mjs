// Prova della migrazione dei task da Microsoft To-Do ai file nostri.
//
//   npm run prova-migrazione
//
// A fianco dell'OneDrive finto c'è un To-Do finto con dentro il campionario di
// quello che si trova davvero in un archivio cresciuto negli anni: marker di
// stima e di sveglia, righe della persona, il vecchio marker della matrice di
// Eisenhower, sottoattività, task spuntati vecchi e recenti.

import { montaFintoOnedrive, importaModulo, creaTabellone } from './finto-onedrive.mjs';

const finto = montaFintoOnedrive();
const { contenuto, esiste } = finto;
const { verifica, fine } = creaTabellone();

const ieri = new Date(Date.now() - 86_400_000).toISOString();
const treAnniFa = new Date(Date.now() - 1100 * 86_400_000).toISOString();

const LISTE = [
  { id: 'lista-inbox', displayName: 'Attività', wellknownListName: 'defaultList' },
  { id: 'lista-sti',   displayName: 'STI2573' },
];

const TASK = {
  'lista-inbox': [
    { id: 'i1', title: 'Cosa buttata dentro', status: 'notStarted', createdDateTime: ieri },
  ],
  'lista-sti': [
    {
      id: 't1', title: 'Rivedere relazione fondazioni', status: 'waitingOnOthers',
      body: { content: 'Delegato a: Sara\n[MIN:45] [SVEGLIA:15:30] Guardare i tabulati.' },
      categories: ['Lavoro'], dueDateTime: { dateTime: '2026-09-01T00:00:00.0000000', timeZone: 'UTC' },
      createdDateTime: treAnniFa, lastModifiedDateTime: ieri,
      checklistItems: [
        { id: 'c1', displayName: 'Leggere il calcolo', isChecked: true },
        { id: 'c2', displayName: 'Chiamare il geologo', isChecked: false },
      ],
    },
    {
      id: 't2', title: 'Chiedere il collaudo', status: 'notStarted',
      body: { content: 'Da chiedere a: Luca' }, createdDateTime: ieri,
    },
    {
      id: 't3', title: 'Aspetto il documento', status: 'waitingOnOthers',
      body: { content: 'In attesa da: Comune' }, createdDateTime: ieri,
    },
    {
      id: 't4', title: 'Un giorno forse', status: 'deferred',
      body: { content: '[EIS:Q4] Ci penso più avanti.' }, createdDateTime: ieri,
    },
    {
      id: 't5', title: 'Scadenza assicurazione', status: 'notStarted',
      body: { content: 'reminder-src:AAMkEVENTO:2026-09-01T08:00:00.000Z' }, createdDateTime: ieri,
    },
    {
      id: 't6', title: 'Fatta ieri', status: 'completed',
      completedDateTime: ieri, createdDateTime: ieri,
    },
    {
      id: 't7', title: 'Fatta tre anni fa', status: 'completed',
      completedDateTime: treAnniFa, createdDateTime: treAnniFa,
    },
  ],
};

// Il To-Do finto: sola lettura, perché la migrazione non deve toccarlo.
let scrittureSuTodo = 0;
finto.aggiungiRotta((percorso, opt, risposta) => {
  if (!percorso.startsWith('/me/todo/')) return null;
  if ((opt.method || 'GET') !== 'GET') { scrittureSuTodo++; return risposta(200, {}); }
  if (percorso === '/me/todo/lists') return risposta(200, { value: LISTE });
  const m = percorso.match(/^\/me\/todo\/lists\/([^/?]+)\/tasks/);
  if (m) return risposta(200, { value: TASK[m[1]] || [] });
  return risposta(404, { error: { code: 'itemNotFound' } });
});

const api = await importaModulo('api.js');
const migrazione = await importaModulo('taskMigrazione.js');
const store = await importaModulo('taskStore.js');

function pulisci() {
  finto.pulisci();
  api._dimenticaDrive();
}

console.log('\nLa passata\n');

pulisci();
const esito = await migrazione.migraTaskDaTodo();
verifica(esito.liste === 2, 'tutte le liste sono passate');
verifica(esito.task === 7, `i task aperti e i completati recenti sono passati (${esito.task}: 1 in Inbox, 6 in STI2573)`);
verifica(esito.completatiSaltati === 1, 'lo spuntato di tre anni fa è rimasto indietro');
verifica(scrittureSuTodo === 0, 'su To-Do non è stato scritto niente');
verifica(esiste('mente-digitale/task/_liste.json') && esiste('mente-digitale/task/sti2573.json'),
  'i file esistono');

console.log('\nConfronto a campione\n');

const tasks = await store.leggiTask('lista-sti');
const perId = id => tasks.find(t => t.id === id);

verifica(tasks.every(t => TASK['lista-sti'].some(o => o.id === t.id)), 'gli id sono quelli di To-Do');

const t1 = perId('t1');
verifica(t1.stato === 'delegated' && t1.persona === 'Sara', 'la riga «Delegato a:» diventa stato + persona');
verifica(t1.stimaMin === 45, 'il marker [MIN:45] diventa un campo');
verifica(t1.sveglia === '15:30', 'il marker [SVEGLIA:15:30] diventa un campo');
verifica(t1.contesto === 'lavoro', 'la categoria diventa il contesto');
verifica(t1.scadenza === '2026-09-01', 'la scadenza resta una data');
verifica(t1.nota === 'Guardare i tabulati.', 'la nota resta il solo testo, senza marker');
verifica(t1.sottoattivita.length === 2 && t1.sottoattivita[0].fatta === true,
  'le sottoattività entrano nel task');
verifica(t1.creatoIl === treAnniFa && t1.modificatoIl === ieri, 'le date di To-Do si conservano');

verifica(perId('t2').stato === 'ask' && perId('t2').persona === 'Luca', '«Da chiedere a:» diventa ask');
verifica(perId('t3').stato === 'waiting' && perId('t3').persona === 'Comune', '«In attesa da:» diventa waiting');
verifica(perId('t4').stato === 'someday' && perId('t4').nota === 'Ci penso più avanti.',
  'deferred diventa someday e il vecchio [EIS:Q4] sparisce');
verifica(perId('t5').origineScadenza === 'reminder-src:AAMkEVENTO:2026-09-01T08:00:00.000Z'
  && perId('t5').nota === '',
  'il riferimento della scadenza ricorrente diventa un campo suo');
verifica(perId('t6').stato === 'done' && perId('t6').completatoIl === ieri, 'lo spuntato recente resta spuntato');

const inbox = await store.leggiTask('lista-inbox');
verifica(inbox[0].stato === 'inbox', 'i task della lista di default nascono in Inbox');
verifica((await store.elencoListe()).find(l => l.id === 'lista-inbox')?.wellknownListName === 'defaultList',
  'e la lista di default resta riconoscibile come Inbox');

console.log('\nRilanciarla non fa danni\n');

// Nel frattempo il file è stato modificato dall'app: una seconda passata
// riporta la fotografia di To-Do, senza sdoppiare niente.
await store.aggiornaTask('lista-sti', 't2', { stato: 'next', persona: null });
const secondo = await migrazione.migraTaskDaTodo();
verifica(secondo.task === 7, 'la seconda passata riscrive gli stessi task');
verifica((await store.leggiTask('lista-sti')).length === 6, 'senza sdoppiarne nessuno');
verifica((await store.elencoListe()).length === 2, 'e senza sdoppiare le liste');
verifica(contenuto('task/_liste.json').liste.filter(l => l.id === 'lista-sti').length === 1,
  'il registro resta con una voce per lista');

fine();
