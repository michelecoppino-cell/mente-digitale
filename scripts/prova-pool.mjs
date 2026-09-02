// Prova del serbatoio delle attività (src/poolAttivita.js).
//
//   npm run prova-pool
//
// Il pool non è più uno stato tenuto a mano ma una lettura della cache di
// query, e quello che va provato è proprio questo: che scrivere in un posto
// solo basti, e che i due casi limite si comportino come devono — una lista mai
// letta in cui si aggiunge qualcosa, e una lista mai letta da cui si toglie.
//
// Niente React: il hook è due righe attorno a `componiPool`, che è la parte con
// dentro le decisioni.

import { creaTabellone } from './finto-onedrive.mjs';

const { verifica, fine } = creaTabellone();

const { queryClient, qk } = await import('../src/queryClient.js');
const { componiPool, cambiaAttivitaInPool, aggiungiAlPool } = await import('../src/poolAttivita.js');

const liste = [
  { id: 'l1', displayName: 'STI2573' },
  { id: 'l2', displayName: 'Casa' },
];

/** @param {string} id @param {string} titolo */
const attivita = (id, titolo) => ({ id, titolo, stato: 'next', sottoattivita: [] });

function pulisci() {
  queryClient.clear();
}

console.log('\nQuello che c\'è, e quello che non c\'è ancora\n');

pulisci();
verifica(componiPool(liste) === null, 'senza nessuna lista letta il pool è null, non vuoto');

queryClient.setQueryData(qk.tasks('l1'), []);
verifica(Array.isArray(componiPool(liste)) && componiPool(liste).length === 0,
  'una lista letta e vuota fa un pool vuoto: «niente da fare», non «sto caricando»');

pulisci();
queryClient.setQueryData(qk.tasks('l1'), [attivita('a', 'Prima')]);
queryClient.setQueryData(qk.tasks('l2'), [attivita('b', 'Seconda')]);
const pool = componiPool(liste);
verifica(pool.length === 2, 'le liste lette si sommano');
verifica(pool[0]._listId === 'l1' && pool[1]._listId === 'l2',
  'e restano nell\'ordine delle liste');
verifica(pool[0]._listName === 'STI2573', 'ogni attività si porta dietro la sua lista');

// Il nome della lista si riattacca a ogni lettura: rinominare una consegna —
// che è come si sposta la sua scadenza — non deve lasciare in giro il vecchio.
const dopoRinomina = componiPool([{ id: 'l1', displayName: '2573.A60-261231' }, liste[1]]);
verifica(dopoRinomina[0]._listName === '2573.A60-261231',
  'una lista rinominata si vede subito nel pool');

console.log('\nUna scrittura sola, e chi legge la vede\n');

pulisci();
queryClient.setQueryData(qk.tasks('l1'), [attivita('a', 'Prima')]);
cambiaAttivitaInPool('l1', a => a.filter(t => t.id !== 'a'));
verifica(componiPool(liste).length === 0, 'togliere un\'attività la toglie dal pool');

queryClient.setQueryData(qk.tasks('l1'), [attivita('a', 'Prima')]);
cambiaAttivitaInPool('l1', a => a.map(t => ({ ...t, titolo: 'Rinominata' })));
verifica(componiPool(liste)[0].titolo === 'Rinominata', 'e modificarla la modifica');

console.log('\nUna lista che non è ancora stata letta\n');

// Togliere da un elenco che non si conosce vorrebbe dire scrivere `[]` e
// dichiarare vuota una lista magari piena, nascondendone le attività fino alla
// lettura vera.
pulisci();
cambiaAttivitaInPool('l1', a => a.filter(t => t.id !== 'boh'));
verifica(componiPool(liste) === null,
  'una modifica a una lista mai letta non se la inventa vuota');

// Aggiungere invece deve poterla cominciare: una consegna creata poco fa non è
// mai stata letta, e catturarci dentro qualcosa deve farlo comparire subito.
pulisci();
aggiungiAlPool('l1', attivita('nuova', 'Catturata al volo'));
verifica(componiPool(liste)?.length === 1,
  'catturare in una lista appena creata la fa comparire lo stesso');

aggiungiAlPool('l1', { ...attivita('nuova', 'Catturata al volo'), titolo: 'Corretta' });
const dopo = componiPool(liste);
verifica(dopo.length === 1 && dopo[0].titolo === 'Corretta',
  'e rimetterci lo stesso id aggiorna la riga invece di sdoppiarla');

aggiungiAlPool(null, attivita('x', 'Senza lista'));
verifica(componiPool(liste).length === 1, 'un\'attività senza lista non finisce da nessuna parte');

fine();

// La cache di query programma la sua pulizia a sette giorni per ogni query
// scritta, e quei timer tengono in piedi il processo. Qui il lavoro è finito:
// si esce, invece di restare appesi a un giardinaggio che non serve a nessuno.
process.exit(process.exitCode || 0);
