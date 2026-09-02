// Prova dei due modi in cui una cosa entra qui dentro: **scritta a mano** sulla
// riga di cattura, e **arrivata da sola** perché una scadenza si avvicina.
//
//   npm run prova-cattura
//
// Sono due pezzi puri — nessuna rete, nessun account — e nessuno dei due era
// provato. Il secondo ha smesso di funzionare senza che niente lo dicesse: era
// un meccanismo a eventi, la finestra dei promemoria poteva chiudersi mentre
// l'app era spenta, e non c'era una misura che dicesse che l'ultima scadenza
// non era mai comparsa. Adesso il conto è a stato, e sta qui sotto.

import { importaModulo, creaTabellone } from './finto-onedrive.mjs';

const { verifica, fine } = creaTabellone();

const cattura = await importaModulo('captureParse.js');
const scadenze = await importaModulo('deadlineReminders.js');
const tempo = await importaModulo('tempo.js');

console.log('\nI giorni si contano sul calendario\n');

// Non sommando millisecondi: il giorno del cambio d'ora dura ventitré ore, e
// 86 400 000 millisecondi dopo un lunedì di fine marzo è ancora quel lunedì.
verifica(tempo.spostaGiorni('2026-03-28', 1) === '2026-03-29', 'il giorno prima dell\'ora legale');
verifica(tempo.spostaGiorni('2026-03-29', 1) === '2026-03-30', 'e quello dell\'ora legale');
verifica(tempo.spostaGiorni('2026-01-01', -1) === '2025-12-31', 'indietro si scavalca l\'anno');
verifica(tempo.spostaGiorni('2026-09-03', 30) === '2026-10-03', 'e trenta giorni sono trenta giorni');

console.log('\nLa riga di cattura\n');

const liste = [
  { id: 'l-2573', label: '2573 · A60-Fondazioni', name: '2573-A60' },
  { id: 'l-casa', label: 'CASA', name: 'AREA-CASA' },
];
const oggi = new Date(2026, 8, 2);   // mercoledì 2 settembre 2026

let letta = cattura.parseCapture('Rivedere relazione @2573 !domani ~45', liste, { today: oggi });
verifica(letta.title === 'Rivedere relazione', 'i token che risolvono spariscono dal titolo');
verifica(letta.destination?.id === 'l-2573', 'la sezione si riconosce dal pezzo scritto');
verifica(letta.dueDate === '2026-09-03' && letta.estimateMin === 45, 'scadenza e stima sono campi');

// L'invariante di sicurezza: un parser che mangia pezzi di titolo è peggio di
// un parser che non fa niente.
letta = cattura.parseCapture('Chiamare @fabbro per il cancello', liste, { today: oggi });
verifica(letta.title === 'Chiamare @fabbro per il cancello' && !letta.destination,
  'un token che non risolve resta testo');

// L'ora si legge **solo** scrivendo un evento. Su un\'attività quel numero è
// parte del titolo, e toglierlo sarebbe la cosa peggiore che possa fare.
letta = cattura.parseCapture('Chiamare il fabbro 8:30', liste, { today: oggi });
verifica(letta.title === 'Chiamare il fabbro 8:30' && letta.oraInizio === null,
  'in un\'attività l\'orario è testo e resta nel titolo');

letta = cattura.parseCapture('Riunione cantiere !giovedi 9:30-11', liste, { today: oggi, modo: 'evento' });
verifica(letta.title === 'Riunione cantiere', 'in un evento invece l\'ora è un campo');
verifica(letta.dueDate === '2026-09-03', 'il giorno della settimana è la prossima occorrenza');
verifica(letta.oraInizio === '09:30' && letta.oraFine === '11:00', 'e l\'intervallo si legge intero');

letta = cattura.parseCapture('Dentista 15.00', liste, { today: oggi, modo: 'evento' });
verifica(letta.oraInizio === '15:00' && letta.oraFine === null, 'il punto vale come i due punti, e senza fine la fine non si inventa');

letta = cattura.parseCapture('Riunione @2573 !domani 9:00', liste, { today: oggi, modo: 'evento' });
verifica(letta.title === 'Riunione @2573' && letta.destination === null,
  'in un evento il token della lista non si legge: non c\'è nessuna lista in cui possa finire');

letta = cattura.parseCapture('Ferie', liste, { today: oggi, modo: 'evento' });
verifica(letta.oraInizio === null, 'un evento senza ora resta senza ora — è di tutto il giorno');

console.log('\nCome si scrive una scadenza ricorrente\n');

verifica(scadenze.parseReminderSubject('[AREA-AUTO] Bollo')?.anticipoGiorni === scadenze.ANTICIPO_DEFAULT,
  'senza anticipo vale quello di default');
verifica(scadenze.parseReminderSubject('[AREA-AUTO +30g] Bollo')?.anticipoGiorni === 30, '+30g sono trenta giorni');
verifica(scadenze.parseReminderSubject('[AREA-AUTO +6s] Bollo')?.anticipoGiorni === 42, '+6s sono sei settimane');
verifica(scadenze.parseReminderSubject('[AREA-SALUTE +2m] Visita')?.anticipoGiorni === 60, '+2m sono due mesi');
verifica(scadenze.parseReminderSubject('[AREA-AUTO +30g] Bollo')?.listName === 'AREA-AUTO',
  'e l\'anticipo si stacca dal nome della lista');
// Stessa regola della riga di cattura: un pezzo si toglie solo se ha risolto.
verifica(scadenze.parseReminderSubject('[AREA+X] Cosa')?.listName === 'AREA+X',
  'un «+» che non è un anticipo resta parte del nome');
verifica(scadenze.parseReminderSubject('Riunione senza parentesi') === null, 'un titolo qualunque non è una scadenza');
verifica(scadenze.parseReminderSubject('[AREA-AUTO]') === null, 'e nemmeno una parentesi senza titolo');

console.log('\nQuali scadenze sono dovute oggi\n');

const listeTodo = [{ id: 'l-auto', displayName: 'AREA-AUTO' }, { id: 'l-casa', displayName: 'AREA-CASA' }];
const evento = (subject, giorno) => ({ id: `e-${subject}-${giorno}`, subject, start: { date: giorno } });

const bollo = evento('[AREA-AUTO +30g] Bollo auto', '2026-10-01');

verifica(scadenze.scadenzeDovute([bollo], listeTodo, '2026-08-31').length === 0,
  'trentuno giorni prima è ancora troppo presto');
verifica(scadenze.scadenzeDovute([bollo], listeTodo, '2026-09-01').length === 1,
  'trenta giorni prima l\'attività è dovuta');
verifica(scadenze.scadenzeDovute([bollo], listeTodo, '2026-09-20').length === 1,
  'e resta dovuta ogni giorno fino alla scadenza — non c\'è nessun istante da non perdere');
verifica(scadenze.scadenzeDovute([bollo], listeTodo, '2026-10-05').length === 1,
  'qualche giorno dopo si crea comunque: un bollo scaduto è la cosa che si vuole ancora vedere');
verifica(scadenze.scadenzeDovute([bollo], listeTodo, '2026-11-01').length === 0,
  'passata la grazia no: sarebbe far tornare a galla quello che si era cancellato');

const dovuta = scadenze.scadenzeDovute([bollo], listeTodo, '2026-09-15')[0];
verifica(dovuta.listId === 'l-auto' && dovuta.titolo === 'Bollo auto' && dovuta.giorno === '2026-10-01',
  'l\'attività nasce nella lista giusta, col titolo giusto e la scadenza giusta');

verifica(scadenze.scadenzeDovute([evento('[AREA-INESISTENTE] Cosa', '2026-09-10')], listeTodo, '2026-09-05').length === 0,
  'un prefisso che non è nessuna lista non crea niente');

// Lo stesso evento può arrivare due volte quando lo stesso calendario è letto
// da due strade: due righe qui sarebbero due attività identiche.
verifica(scadenze.scadenzeDovute([bollo, { ...bollo, id: 'altro-id' }], listeTodo, '2026-09-15').length === 1,
  'lo stesso evento letto due volte resta una scadenza sola');

// L'evento con l'ora funziona come quello di tutto il giorno: conta il giorno.
verifica(scadenze.scadenzeDovute(
  [{ id: 'x', subject: '[AREA-CASA] Revisione caldaia', start: { dateTime: '2026-09-10T08:00:00' } }],
  listeTodo, '2026-09-05')[0]?.giorno === '2026-09-10',
  'anche un evento con l\'ora dà una scadenza al suo giorno');

console.log('\nE quali no, perché ci sono già\n');

const gia = [{ id: 't1', titolo: 'Bollo auto', scadenza: '2026-10-01', origineScadenza: dovuta.origine }];
verifica(scadenze.scadenzaGiaPresente(gia, dovuta), 'il marker la riconosce');
verifica(scadenze.scadenzaGiaPresente(
  [{ id: 't2', titolo: 'bollo auto', scadenza: '2026-10-01', origineScadenza: 'reminder-src:vecchio-id:2026-10-01' }],
  dovuta),
  'e la riconosce anche quella nata dal meccanismo di prima, che il marker ce l\'ha in un altro formato');
verifica(!scadenze.scadenzaGiaPresente(
  [{ id: 't3', titolo: 'Bollo auto', scadenza: '2025-10-01', origineScadenza: '' }], dovuta),
  'ma quella dell\'anno scorso non conta: è un\'altra occorrenza');
verifica(!scadenze.scadenzaGiaPresente([], dovuta), 'e con la lista vuota non c\'è niente da riconoscere');

console.log('\nGli eventi di una sezione\n');

// Il Pannello sezione li filtra per prefisso: col nuovo anticipo dentro la
// parentesi, un confronto di stringhe smetterebbe di riconoscere proprio
// quelli che l'anticipo ce l'hanno.
const eventiSezione = [
  evento('[AREA-AUTO] Tagliando', '2026-09-10'),
  evento('[AREA-AUTO +30g] Bollo auto', '2026-10-01'),
  evento('[AREA-CASA] Altro', '2026-09-11'),
];
verifica(scadenze.filterEventsBySectionPrefix(eventiSezione, 'AREA-AUTO').length === 2,
  'la sezione trova anche gli eventi con l\'anticipo scritto dentro');
verifica(scadenze.filterEventsBySectionPrefix(eventiSezione, '').length === 0, 'e senza sezione non trova niente');

fine();
