// Prova del colore di un calendario (src/planner/griglia.js).
//
//   npm run prova-colori
//
// Il colore di un evento è l'unica cosa che, guardando il Piano o «Oggi»,
// distingue un compleanno da una riunione. Prima veniva solo dall'enum di
// Graph, e su un account dove nessun calendario ha un colore scelto rispondeva
// grigio per tutti: una parete di rettangoli identici. Adesso la scelta fatta
// nell'app vince, e sotto resta l'enum — sono tre righe di codice e tre modi
// di sbagliarle, quindi qui c'è la misura che lo dice.

import { importaModulo, creaTabellone } from './finto-onedrive.mjs';

const { verifica, fine } = creaTabellone();
const { calendarColor, coloreEvento, calendarSwatch } = await importaModulo('planner/griglia.js');

const scelti = { 'cal-1': '#c084a0' };

console.log('\nIl colore di un calendario\n');

verifica(calendarColor('cal-1', 'lightBlue', scelti) === '#c084a0',
  'la scelta fatta nell\'app vince sull\'enum di Graph');
verifica(calendarColor('cal-2', 'lightBlue', scelti) === calendarSwatch('lightBlue'),
  'senza una scelta resta il colore che il calendario ha in Outlook');
verifica(calendarColor('cal-2', 'auto', scelti) === '#888888',
  'e un calendario senza colore né scelta resta grigio');
verifica(calendarColor('cal-1', 'lightBlue', undefined) === calendarSwatch('lightBlue'),
  'senza il documento delle scelte non si rompe niente');
verifica(calendarColor(null, null, scelti) === '#888888',
  'né senza calendario');

console.log('\nLo stesso, partendo dall\'evento decorato da api.js\n');

verifica(coloreEvento({ _calId: 'cal-1', _calColor: 'lightBlue' }, scelti) === '#c084a0',
  'un evento prende il colore scelto per il suo calendario');
verifica(coloreEvento({ _calId: 'cal-2', _calColor: 'lightGreen' }, scelti) === calendarSwatch('lightGreen'),
  'e gli altri quello di Graph');
verifica(coloreEvento({}, scelti) === '#888888',
  'un evento senza decorazione non fa saltare la vista');

fine();
