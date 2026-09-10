// Prova del flusso a otto stati (src/taskModel.js) sulla forma nuova dei task.
//
//   npm run prova-flusso
//
// È la verifica che la vista Attività si comporta come prima su tutti e otto
// gli stati: sette sono un campo, l'ottavo — `scheduled` — resta la presenza di
// un blocco nel piano, e `inbox` resta la lista in cui il task si trova.

import { importaModulo, creaTabellone } from './finto-onedrive.mjs';

const { verifica, fine } = creaTabellone();
const { taskStatus, taskPerson, taskEstimateMin, taskAlarm, taskContext, inboxListId, indexScheduled, isSlipped, applicaSottoattivita, DEFAULT_ESTIMATE_MIN } =
  await importaModulo('taskModel.js');

const LISTA_INBOX = 'lista-inbox';
const liste = [
  { id: LISTA_INBOX, displayName: 'Attività', wellknownListName: 'defaultList' },
  { id: 'lista-sti', displayName: 'STI2573' },
];
const inbox = inboxListId(liste);
verifica(inbox === LISTA_INBOX, 'la lista di default è riconosciuta come Inbox');

/** @param {object} campi */
const task = campi => ({
  id: 't', titolo: 'Una cosa', stato: 'next', persona: null, contesto: null,
  stimaMin: null, sveglia: null, scadenza: null, nota: '', origineScadenza: null,
  sottoattivita: [], creatoIl: '2026-08-01T08:00:00Z', modificatoIl: '2026-08-01T08:00:00Z',
  completatoIl: null, _listId: 'lista-sti', ...campi,
});

const piano = {
  '2026-09-01': { blocks: [{ id: 'b1', taskId: 'programmata', startTime: '09:00', endTime: '10:00' }] },
};
const scheduledIds = new Set(indexScheduled(piano).keys());
const ctx = { scheduledIds, inboxListId: inbox };

console.log('\nGli otto stati\n');

verifica(taskStatus(task({ _listId: LISTA_INBOX }), ctx) === 'inbox', 'inbox: sta nella lista Inbox');
verifica(taskStatus(task({}), ctx) === 'next', 'next: fattibile e basta');
verifica(taskStatus(task({ stato: 'ask', persona: 'Luca' }), ctx) === 'ask', 'ask: da chiedere a qualcuno');
verifica(taskStatus(task({ stato: 'waiting', persona: 'Comune' }), ctx) === 'waiting', 'waiting: aspetti qualcuno');
verifica(taskStatus(task({ stato: 'delegated', persona: 'Sara' }), ctx) === 'delegated', 'delegated: l\'ha in mano un altro');
verifica(taskStatus(task({ id: 'programmata' }), ctx) === 'scheduled', 'scheduled: ha un blocco nel piano');
verifica(taskStatus(task({ stato: 'someday' }), ctx) === 'someday', 'someday: non adesso');
verifica(taskStatus(task({ stato: 'done' }), ctx) === 'done', 'done: fatta');

console.log('\nLe precedenze\n');

// Sono le stesse di prima: quello che è più specifico vince.
verifica(taskStatus(task({ id: 'programmata', _listId: LISTA_INBOX }), ctx) === 'scheduled',
  'una programmata resta programmata anche se sta in Inbox');
verifica(taskStatus(task({ id: 'programmata', stato: 'waiting', persona: 'Sara' }), ctx) === 'waiting',
  'un\'attesa resta un\'attesa anche con un blocco nel piano');
verifica(taskStatus(task({ id: 'programmata', stato: 'done' }), ctx) === 'done',
  'una fatta resta fatta');
verifica(taskStatus(task({ stato: 'ask', persona: 'Luca', _listId: LISTA_INBOX }), ctx) === 'inbox',
  'finché sta in Inbox, è da chiarire');
verifica(taskStatus(task({ stato: 'inbox' }), ctx) === 'next',
  'chiarita e spostata, torna una prossima azione qualunque');
verifica(taskStatus(task({}), {}) === 'next', 'senza contesto lo stato scritto vale così com\'è');

console.log('\nQuello che il task porta con sé\n');

const delegata = task({ stato: 'delegated', persona: 'Sara', modificatoIl: '2026-08-20T09:00:00Z' });
const persona = taskPerson(delegata);
verifica(persona?.role === 'delegated' && persona.who === 'Sara', 'la persona porta il suo ruolo');
verifica(persona?.since === '2026-08-20T09:00:00Z', 'e da quando');
verifica(taskPerson(task({ stato: 'next', persona: 'Sara' })) === null,
  'senza uno stato che la preveda, la persona non è un ruolo');
verifica(taskPerson(task({ stato: 'waiting' })) === null, 'e uno stato senza nome non inventa nessuno');

verifica(taskEstimateMin(task({ stimaMin: 45 })) === 45, 'la stima è quella detta');
verifica(taskEstimateMin(task({})) === DEFAULT_ESTIMATE_MIN, 'chi non l\'ha detta prende la mezz\'ora');
verifica(taskAlarm(task({ sveglia: '15:30' })) === '15:30', 'la sveglia è un\'ora del giorno');
verifica(taskContext(task({ contesto: 'lavoro' })) === 'lavoro', 'il contesto è un campo');

console.log('\nProgrammate scivolate\n');

const piazzamento = { date: '2026-08-01', completed: false };
verifica(isSlipped(piazzamento, '2026-09-01') === true, 'un blocco passato e non finito è scivolato');
verifica(isSlipped({ ...piazzamento, completed: true }, '2026-09-01') === false, 'se è stato fatto, no');

console.log('\nI sotto-passi scritti da fuori\n');

// La prova che mancava: i sotto-passi si leggevano dal CLI e dal server MCP ma
// non si scrivevano, e spezzare un'attività a voce finiva in una nota.

const partenza = [{ id: 's1', titolo: 'Disegni', fatta: false }, { id: 's2', titolo: 'Calcoli', fatta: true }];

const aggiunto = applicaSottoattivita(partenza, { aggiungi: ['Relazione'] });
verifica(aggiunto.sottoattivita.length === 3 && aggiunto.aggiunte[0] === 'Relazione',
  'un sotto-passo nuovo si aggiunge in coda');
verifica(partenza.length === 2, 'e l\'elenco di partenza resta com\'era: la funzione è pura');
verifica(aggiunto.sottoattivita[2].id === undefined,
  'al nuovo l\'id non lo inventa qui: glielo dà normalizzaTask scrivendo il file');

const doppio = applicaSottoattivita(partenza, { aggiungi: ['disegni'] });
verifica(doppio.sottoattivita.length === 2 && doppio.gia[0] === 'disegni',
  'un titolo che c\'è già non si ripete: ridire la stessa cosa non raddoppia l\'elenco');

const spuntato = applicaSottoattivita(partenza, { fatte: ['dise'] });
verifica(spuntato.sottoattivita[0].fatta === true && spuntato.spuntate[0] === 'Disegni',
  'un pezzo di testo basta a spuntare il passo giusto');
verifica(applicaSottoattivita(partenza, { fatte: ['calc'] }).spuntate.length === 0,
  'spuntare quello che era già fatto non conta come cambiamento');
verifica(applicaSottoattivita(partenza, { aperte: ['calc'] }).sottoattivita[1].fatta === false,
  'e si può riaprire');

let ambiguo = null;
try { applicaSottoattivita([{ titolo: 'Calcolo travi' }, { titolo: 'Calcolo pilastri' }], { fatte: ['calcolo'] }); }
catch (e) { ambiguo = e.message; }
verifica(!!ambiguo && ambiguo.includes('2'), 'un pezzo di testo che ne prende due è un errore, non una scelta a caso');

let assente = null;
try { applicaSottoattivita(partenza, { aperte: ['fondazioni'] }); } catch (e) { assente = e.message; }
verifica(!!assente, 'e uno che non esiste non si inventa');

const insieme = applicaSottoattivita(partenza, { aggiungi: ['Relazione'], fatte: ['relaz'] });
verifica(insieme.sottoattivita[2].fatta === true,
  'aggiungere e spuntare nella stessa scrittura funziona: prima si aggiunge, poi si spunta');

fine();
