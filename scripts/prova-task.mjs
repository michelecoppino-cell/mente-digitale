// Prova di src/taskStore.js: i task su file nostri, contro un OneDrive finto.
//
//   npm run prova-task

import { montaFintoOnedrive, importaModulo, creaTabellone } from './finto-onedrive.mjs';

const finto = montaFintoOnedrive();
const { contenuto, esiste } = finto;
const { verifica, fine } = creaTabellone();

const api = await importaModulo('api.js');
const store = await importaModulo('taskStore.js');

function pulisci() {
  finto.pulisci();
  api._driveVersions.clear(); api._migrationTried.clear(); api._cartellePronte.clear();
}

/** Una lista con dentro qualche task, come punto di partenza. */
async function conListaEQualcheTask(quanti = 4) {
  pulisci();
  const lista = await store.creaLista('STI2573', { id: 'lista-1' });
  for (let i = quanti; i >= 1; i--) await store.creaTask(lista.id, { titolo: `Attività ${i}` });
  return lista;
}

console.log('\nListe\n');

pulisci();
const inbox = await store.creaLista('Attività', { id: 'inbox-1', inbox: true });
await store.creaLista('STI2573', { id: 'lista-1' });
verifica(esiste('mente-digitale/task/_liste.json'), 'il registro nasce in task/');
verifica(esiste('mente-digitale/task/sti2573.json'), 'il file della lista prende il nome della lista');
let liste = await store.elencoListe();
verifica(liste.length === 2, 'le liste registrate si rileggono');
verifica(liste.find(l => l.id === inbox.id)?.wellknownListName === 'defaultList',
  'l\'Inbox si riconosce come prima');

// Due liste con lo stesso nome non devono scrivere sullo stesso file.
await store.creaLista('STI2573 bis', { id: 'lista-2' });
verifica(esiste('mente-digitale/task/sti2573-bis.json'), 'nomi diversi, file diversi');

// Rinominare una lista è come si sposta la scadenza di una consegna.
await store.rinominaLista('lista-1', 'STI2573.Consegna-260915');
liste = await store.elencoListe();
verifica(liste.find(l => l.id === 'lista-1')?.displayName === 'STI2573.Consegna-260915',
  'la rinomina si vede nel registro');
verifica(contenuto('task/sti2573.json').listName === 'STI2573.Consegna-260915',
  'e anche dentro il file, che resta dov\'era');

console.log('\nTask\n');

let lista = await conListaEQualcheTask();
let tasks = await store.leggiTask(lista.id);
verifica(tasks.length === 4, 'i task si rileggono');
verifica(tasks[0]._listId === lista.id && tasks[0]._listName === 'STI2573',
  'ogni task sa da che lista viene');
verifica(contenuto('task/sti2573.json').version === 1, 'il file porta la versione dello schema');

// La scrittura sola: stato, persona e stima cambiano insieme. È il punto della
// migrazione — su To-Do lo stato stava su due campi e serviva una PATCH per
// ciascuno, con il mezzo salvataggio possibile in mezzo.
const uno = tasks[0];
const dopo = await store.aggiornaTask(lista.id, uno.id, {
  stato: 'delegated', persona: 'Sara', stimaMin: 45, sveglia: '15:30', contesto: 'lavoro',
});
verifica(dopo.stato === 'delegated' && dopo.persona === 'Sara', 'stato e persona in una scrittura sola');
const riletto = (await store.leggiTask(lista.id)).find(t => t.id === uno.id);
verifica(riletto.stimaMin === 45 && riletto.sveglia === '15:30' && riletto.contesto === 'lavoro',
  'stima, sveglia e contesto sono campi, non marker');
verifica(riletto.modificatoIl > riletto.creatoIl || riletto.modificatoIl >= riletto.creatoIl,
  'la modifica lascia la sua data');

// Completare mette la data del completamento; disfarlo la toglie.
await store.aggiornaTask(lista.id, uno.id, { stato: 'done' });
verifica(!!(await store.leggiTask(lista.id)).find(t => t.id === uno.id).completatoIl,
  'completare data il task');
await store.aggiornaTask(lista.id, uno.id, { stato: 'next' });
verifica((await store.leggiTask(lista.id)).find(t => t.id === uno.id).completatoIl === null,
  'disfare il completamento toglie la data');

// Le sottoattività sono un campo: riordinarle è riordinare un array. Su To-Do
// bisognava ricrearle tutte in ordine e cancellare le originali.
await store.aggiornaTask(lista.id, uno.id, {
  sottoattivita: [{ id: 's1', titolo: 'Prima', fatta: false }, { id: 's2', titolo: 'Seconda', fatta: true }],
});
let sotto = (await store.leggiTask(lista.id)).find(t => t.id === uno.id).sottoattivita;
verifica(sotto.length === 2 && sotto[1].fatta === true, 'le sottoattività stanno dentro il task');

console.log('\nSpostamenti e cancellazioni\n');

lista = await conListaEQualcheTask();
await store.creaLista('Personale', { id: 'lista-2' });
const daSpostare = (await store.leggiTask(lista.id))[0];
const spostato = await store.spostaTask(lista.id, 'lista-2', daSpostare.id);
verifica(spostato.id === daSpostare.id, 'lo spostamento non rigenera l\'id');
verifica((await store.leggiTask('lista-2')).length === 1, 'il task è nella lista di destinazione');
verifica(!(await store.leggiTask(lista.id)).some(t => t.id === daSpostare.id), 'e non più in quella di partenza');

const rimasti = await store.leggiTask(lista.id);
await store.eliminaTask(lista.id, rimasti[0].id);
verifica((await store.leggiTask(lista.id)).length === rimasti.length - 1, 'cancellare toglie un task');

// Un file di task che si svuota per sbaglio è una consegna intera che sparisce.
lista = await conListaEQualcheTask(6);
let errore = null;
try {
  await store.cambiaTask(lista.id, () => []);
} catch (e) { errore = e; }
verifica(/Scrittura rifiutata/.test(errore?.message || ''), 'un crollo improvviso di task viene rifiutato');
verifica((await store.leggiTask(lista.id)).length === 6, 'e il file resta quello di prima');
await store.cambiaTask(lista.id, () => [], { consentiCalo: true });
verifica((await store.leggiTask(lista.id)).length === 0, 'se la cancellazione è dichiarata, passa');

console.log('\nDue dispositivi\n');

// L'altro dispositivo aggiunge un task mentre noi ne modifichiamo un altro:
// devono restare tutti e due.
lista = await conListaEQualcheTask();
const nostri = await store.leggiTask(lista.id);
const file = contenuto('task/sti2573.json');
finto.altroDispositivoScrive('task/sti2573.json', {
  ...file,
  tasks: [{ id: 'dal-telefono', titolo: 'Scritta dal telefono', stato: 'next' }, ...file.tasks],
});
await store.aggiornaTask(lista.id, nostri[1].id, { stato: 'waiting', persona: 'Luca' });
const finali = await store.leggiTask(lista.id);
verifica(finali.some(t => t.id === 'dal-telefono'), 'il task dell\'altro dispositivo non si perde');
verifica(finali.find(t => t.id === nostri[1].id)?.persona === 'Luca', 'e la nostra modifica arriva lo stesso');

console.log('\nVersione dello schema\n');

// Un file scritto da una versione futura, o con campi mancanti, si legge
// comunque: la normalizzazione porta tutto alla forma corrente.
pulisci();
await store.creaLista('Vecchia', { id: 'lista-1' });
finto.altroDispositivoScrive('task/vecchia.json', {
  version: 99,
  listId: 'lista-1',
  tasks: [
    { id: 'a', titolo: 'Senza campi' },
    { id: 'b', titolo: 'Stato ignoto', stato: 'boh', stimaMin: 'tanto', sveglia: '99:99' },
  ],
});
const letti = await store.leggiTask('lista-1');
verifica(letti[0].stato === 'next' && letti[0].sottoattivita.length === 0 && letti[0].nota === '',
  'i campi mancanti prendono un valore sensato');
verifica(letti[1].stato === 'next' && letti[1].stimaMin === null && letti[1].sveglia === null,
  'i valori senza senso non entrano in memoria');
await store.aggiornaTask('lista-1', 'a', { titolo: 'Riscritta' });
verifica(contenuto('task/vecchia.json').version === 1, 'e la scrittura riporta il file alla versione corrente');

fine();
