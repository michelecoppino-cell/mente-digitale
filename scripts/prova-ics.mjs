// Prova del lettore ICS e dello specchio del calendario di lavoro.
//
//   npm run prova-ics
//
// È la prova che alla sincronizzazione di prima mancava del tutto, e non per
// distrazione: quella leggeva il corpo di una mail, e per provarla serviva una
// casella con dentro le mail giuste. Si è rotta più volte senza che niente lo
// dicesse. Questo pezzo invece è una funzione da stringa a oggetti, e si prova
// senza rete, senza account e senza calendario.

import { creaTabellone } from './finto-onedrive.mjs';
import {
  srotolaRighe, leggiData, leggiIcs, occorrenzeDi, occorrenzeIcs, fusoIana, daOrologioAUtc,
} from './ics.mjs';
import { leggiFonti } from './sync-calendario-lavoro.mjs';
import { eventiDiLavoro, normalizzaDocumento } from '../src/calendarioLavoro.js';

const { verifica, fine } = creaTabellone();

const FINESTRA = { da: new Date('2026-01-01T00:00:00Z'), a: new Date('2027-06-30T00:00:00Z') };

/** Un calendario minimo attorno ai VEVENT passati. */
const calendario = (...eventi) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', ...eventi, 'END:VCALENDAR',
].join('\r\n');

console.log('\nLe righe, i fusi, le date\n');

// Il formato spezza le righe lunghe e continua quella dopo con uno spazio: chi
// non le ricuce si ritrova gli oggetti tagliati a metà, ed è il genere di
// difetto che si vede solo sull'evento con il titolo lungo.
verifica(srotolaRighe('SUMMARY:Riunione di canti\r\n ere').join('|') === 'SUMMARY:Riunione di cantiere',
  'le righe spezzate si ricuciono');
verifica(srotolaRighe('A:1\r\n\r\nB:2').length === 2, 'e le righe vuote spariscono');

verifica(fusoIana('W. Europe Standard Time') === 'Europe/Berlin', 'il nome Windows del fuso si traduce');
verifica(fusoIana('Europe/Rome') === 'Europe/Rome', 'un nome IANA passa com\'è');
verifica(fusoIana('Fuso Inventato') === 'Europe/Rome', 'e uno che non esiste ricade sull\'ora di casa');

// Le nove del mattino sono le 07:00 UTC d'estate e le 08:00 d'inverno: se la
// conversione ignorasse l'ora legale, metà anno gli appuntamenti sarebbero
// disegnati un'ora fuori posto.
const estate = daOrologioAUtc(Date.UTC(2026, 6, 15, 9, 0, 0), 'Europe/Rome');
const inverno = daOrologioAUtc(Date.UTC(2026, 0, 15, 9, 0, 0), 'Europe/Rome');
verifica(new Date(estate).toISOString().startsWith('2026-07-15T07:00'), 'le 9 di luglio sono le 07:00 UTC');
verifica(new Date(inverno).toISOString().startsWith('2026-01-15T08:00'), 'le 9 di gennaio sono le 08:00 UTC');

verifica(leggiData('20260902').tuttoIlGiorno === true, 'una data senza ora è tutto il giorno');
verifica(leggiData('20260902T070000Z').zona === 'UTC', 'la Z in coda dice che è già UTC');
verifica(leggiData('non è una data') === null, 'e quello che non è una data non lo diventa');

console.log('\nLe ricorrenze\n');

const giovedi9 = Date.UTC(2026, 8, 3, 9, 0, 0);   // giovedì 3 settembre 2026
const limite = Date.UTC(2026, 11, 31);

verifica(occorrenzeDi(giovedi9, 'FREQ=WEEKLY;BYDAY=TH;COUNT=4', limite).length === 4,
  'COUNT taglia la serie dove dice');
verifica(occorrenzeDi(giovedi9, 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20260918T000000Z', limite).length === 3,
  'e UNTIL pure');
verifica(occorrenzeDi(giovedi9, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=3', limite)
  .map(ms => new Date(ms).toISOString().slice(0, 10)).join(' ') === '2026-09-03 2026-09-17 2026-10-01',
  'una settimana sì e una no salta la settimana di mezzo');
verifica(occorrenzeDi(giovedi9, 'FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4', limite)
  .map(ms => new Date(ms).toISOString().slice(0, 10)).join(' ') === '2026-09-03 2026-09-07 2026-09-10 2026-09-14',
  'due giorni a settimana danno due occorrenze a settimana');
verifica(occorrenzeDi(giovedi9, 'FREQ=DAILY;COUNT=3', limite).length === 3, 'la serie giornaliera cammina di un giorno');

// Il 31 in un mese di trenta giorni non esiste: scivolare al primo del mese
// dopo sarebbe inventare un appuntamento che nessuno ha messo in agenda.
const trentuno = Date.UTC(2026, 0, 31, 9, 0, 0);
const mensili = occorrenzeDi(trentuno, 'FREQ=MONTHLY;COUNT=3', Date.UTC(2026, 11, 31))
  .map(ms => new Date(ms).toISOString().slice(0, 10));
verifica(!mensili.includes('2026-03-03') && mensili[1] === '2026-03-31',
  'il 31 salta i mesi che non ce l\'hanno invece di scivolare');

verifica(occorrenzeDi(giovedi9, 'FREQ=MONTHLY;BYDAY=1TH;COUNT=3', limite)
  .map(ms => new Date(ms).toISOString().slice(0, 10)).join(' ') === '2026-09-03 2026-10-01 2026-11-05',
  '«il primo giovedì del mese» cade dove deve');
verifica(occorrenzeDi(giovedi9, 'FREQ=MONTHLY;BYDAY=-1TH;COUNT=2', limite)
  .map(ms => new Date(ms).toISOString().slice(0, 10)).join(' ') === '2026-09-24 2026-10-29',
  'e «l\'ultimo giovedì» si conta dalla fine');
verifica(occorrenzeDi(giovedi9, 'FREQ=YEARLY;COUNT=2', Date.UTC(2028, 0, 1))
  .map(ms => new Date(ms).toISOString().slice(0, 10)).join(' ') === '2026-09-03 2027-09-03',
  'la serie annuale torna lo stesso giorno');

console.log('\nUn calendario intero\n');

const ics = calendario(
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16011028T030000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:serie',
  'SUMMARY:Riunione di cantiere',
  'DTSTART;TZID=W. Europe Standard Time:20260903T090000',
  'DTEND;TZID=W. Europe Standard Time:20260903T103000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=5',
  'EXDATE;TZID=W. Europe Standard Time:20260917T090000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:serie',
  'RECURRENCE-ID;TZID=W. Europe Standard Time:20260910T090000',
  'SUMMARY:Riunione spostata',
  'DTSTART;TZID=W. Europe Standard Time:20260910T140000',
  'DTEND;TZID=W. Europe Standard Time:20260910T150000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ferie',
  'SUMMARY:Ferie',
  'DTSTART;VALUE=DATE:20260910',
  'DTEND;VALUE=DATE:20260912',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:annullato',
  'SUMMARY:Sopralluogo annullato',
  'STATUS:CANCELLED',
  'DTSTART;TZID=W. Europe Standard Time:20260904T090000',
  'DTEND;TZID=W. Europe Standard Time:20260904T100000',
  'END:VEVENT',
);

// Il VTIMEZONE contiene un DTSTART e una RRULE che non sono di nessun evento:
// leggerli come tali riempirebbe il calendario di occorrenze del 1601.
verifica(leggiIcs(ics).length === 4, 'il blocco del fuso non conta come un evento');

const occorrenze = occorrenzeIcs(ics, FINESTRA);
const titoli = occorrenze.map(o => `${o.start} ${o.subject}`);

verifica(!titoli.some(t => t.includes('annullato')), 'un evento annullato non compare');
verifica(!titoli.some(t => t.startsWith('2026-09-17')), 'l\'occorrenza tolta con EXDATE non compare');
verifica(titoli.some(t => t === '2026-09-10T12:00:00 Riunione spostata'),
  'l\'occorrenza spostata compare alla sua ora nuova');
verifica(!titoli.some(t => t === '2026-09-10T07:00:00 Riunione di cantiere'),
  'e quella vecchia non resta accanto — era il doppione della sincronizzazione di prima');
verifica(occorrenze.filter(o => o.subject === 'Riunione di cantiere').length === 3,
  'delle cinque della serie ne restano tre');

const ferie = occorrenze.find(o => o.subject === 'Ferie');
verifica(ferie?.isAllDay === true && ferie.start === '2026-09-10', 'le ferie sono un evento di tutto il giorno');

// Lo stesso file letto due volte deve dare gli stessi id, o lo specchio
// cambierebbe a ogni giro anche quando il calendario non cambia.
const rilettura = occorrenzeIcs(ics, FINESTRA);
verifica(rilettura.map(o => o.id).join('|') === occorrenze.map(o => o.id).join('|'),
  'gli id sono stabili fra due letture dello stesso calendario');

// Fuori finestra non si genera niente: una serie senza fine altrimenti
// riempirebbe il file di occorrenze del 2043.
const infinita = calendario(
  'BEGIN:VEVENT', 'UID:sempre', 'SUMMARY:Stand-up',
  'DTSTART;TZID=Europe/Rome:20260105T083000',
  'DTEND;TZID=Europe/Rome:20260105T084500',
  'RRULE:FREQ=DAILY', 'END:VEVENT',
);
const brevi = occorrenzeIcs(infinita, { da: new Date('2026-03-01'), a: new Date('2026-03-08') });
verifica(brevi.length === 7 && brevi[0].start.startsWith('2026-03-01'),
  'una serie senza fine si ferma ai bordi della finestra');

console.log('\nGli indirizzi dei feed\n');

verifica(leggiFonti('https://x/y.ics')[0].nome === 'Lavoro', 'un indirizzo nudo prende il nome di default');
verifica(leggiFonti('Studio|https://x/y.ics')[0].nome === 'Studio', 'e col nome davanti prende quello');
verifica(leggiFonti('webcal://x/y.ics')[0].url === 'https://x/y.ics', 'webcal:// diventa https://');
verifica(leggiFonti('a\nhttps://x/y.ics').length === 1, 'quello che non è un indirizzo si scarta');
verifica(leggiFonti(undefined).length === 0, 'e senza variabile non c\'è nessuna fonte');

console.log('\nLo specchio letto dall\'app\n');

const doc = normalizzaDocumento({
  version: 1, aggiornatoIl: '2026-09-02T06:00:00Z', fonti: [],
  eventi: [
    { id: 'a', subject: 'Riunione', start: '2026-09-03T07:00:00', end: '2026-09-03T08:30:00', isAllDay: false },
    { id: 'b', subject: 'Ferie', start: '2026-12-24', end: '2026-12-27', isAllDay: true },
  ],
});
const dentro = eventiDiLavoro(doc, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
verifica(dentro.length === 1 && dentro[0].subject === 'Riunione', 'la finestra taglia quello che non ci sta');
verifica(dentro[0].start.dateTime === '2026-09-03T07:00:00' && dentro[0].start.timeZone === 'UTC',
  'e l\'evento esce nella forma di Graph, come lo aspetta il Piano');
verifica(dentro[0]._soloLettura === true, 'con il segno che ne vieta la modifica');
verifica(normalizzaDocumento(null).eventi.length === 0, 'un file che non c\'è è uno specchio vuoto, non un errore');

fine();
