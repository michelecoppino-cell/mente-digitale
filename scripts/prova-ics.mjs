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
import { leggiFonti, ultimaMailBuona, allegatoCalendario } from './sync-calendario-lavoro.mjs';
import { eventiDiLavoro, normalizzaDocumento, etaSpecchio, avvisoSpecchioFermo } from '../src/calendarioLavoro.js';

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

console.log('\nLe fonti dichiarate\n');

verifica(leggiFonti({ ics: 'https://x/y.ics' })[0].nome === 'Lavoro', 'un indirizzo nudo prende il nome di default');
verifica(leggiFonti({ ics: 'Studio|https://x/y.ics' })[0].nome === 'Studio', 'e col nome davanti prende quello');
verifica(leggiFonti({ ics: 'webcal://x/y.ics' })[0].valore === 'https://x/y.ics', 'webcal:// diventa https://');
verifica(leggiFonti({ ics: 'a\nhttps://x/y.ics' }).length === 1, 'quello che non è un indirizzo si scarta');
verifica(leggiFonti({}).length === 0, 'e senza variabili non c\'è nessuna fonte');

verifica(leggiFonti({ mail: 'CALENDARIO-LAVORO' })[0].tipo === 'mail', 'la posta è una fonte come il feed');
verifica(leggiFonti({ mail: 'CALENDARIO-LAVORO', mittente: 'IO@Lavoro.IT' })[0].mittente === 'io@lavoro.it',
  'il mittente si confronta senza maiuscole: nessuno lo riscrive uguale due volte');
const dueFonti = leggiFonti({ mail: 'CAL', ics: 'https://x/y.ics' });
verifica(dueFonti.length === 2 && dueFonti[0].tipo === 'mail' && dueFonti[1].tipo === 'ics',
  'le due strade convivono: la posta oggi, il feed il giorno che l\'azienda lo aprisse');
verifica(dueFonti[1].nome !== dueFonti[0].nome, 'e non si chiamano uguale, o sarebbero una riga sola nel filtro');

console.log('\nQuale mail, e quale allegato\n');

const mail = (id, subject, quando, extra = {}) => ({
  id, subject, receivedDateTime: quando, hasAttachments: true,
  from: { emailAddress: { address: 'io@lavoro.it' } }, ...extra,
});
const casella = [
  mail('m1', 'CALENDARIO-LAVORO 2026-09-01 07:00', '2026-09-01T05:00:00Z'),
  mail('m2', 'CALENDARIO-LAVORO 2026-09-02 07:00', '2026-09-02T05:00:00Z'),
  mail('m3', 'Riunione di lunedì', '2026-09-02T09:00:00Z'),
  mail('m4', 'CALENDARIO-LAVORO 2026-09-02 09:00', '2026-09-02T07:00:00Z', { hasAttachments: false }),
];

// È tutto il punto dello specchio: conta **l'ultima**, non la prima non letta.
// Aprire la mail dal telefono non consuma niente, e una mail persa non lascia
// un buco perché quella dopo riporta tutta la finestra.
verifica(ultimaMailBuona(casella, { oggetto: 'CALENDARIO-LAVORO' })?.id === 'm2',
  'si prende la più recente col marcatore, non la prima');
verifica(ultimaMailBuona(casella, { oggetto: 'calendario-lavoro' })?.id === 'm2',
  'il marcatore si confronta senza maiuscole');
verifica(!ultimaMailBuona(casella, { oggetto: 'CALENDARIO-LAVORO' })?.subject.includes('09:00'),
  'una mail senza allegato non è buona, per quanto recente');
verifica(ultimaMailBuona(casella, { oggetto: 'CALENDARIO-LAVORO', mittente: 'altro@x.it' }) === null,
  'col mittente dichiarato, chiunque altro non conta');
verifica(ultimaMailBuona(casella, { oggetto: 'CALENDARIO-LAVORO', mittente: 'io@lavoro.it' })?.id === 'm2',
  'e col mittente giusto si trova lo stesso');
verifica(ultimaMailBuona(casella, { oggetto: 'ALTRA-COSA' }) === null, 'un marcatore che non c\'è non pesca niente');
verifica(ultimaMailBuona(casella, { oggetto: '' }) === null, 'e senza marcatore non si pesca a caso');

// Outlook attacca anche la firma: l'immagine del logo è un allegato a tutti
// gli effetti, e «il primo» sarebbe quello.
const allegati = [
  { id: 'a1', name: 'image001.png', contentType: 'image/png' },
  { id: 'a2', name: 'calendario-lavoro.ics', contentType: 'text/calendar; method=PUBLISH' },
];
verifica(allegatoCalendario(allegati)?.id === 'a2', 'fra gli allegati si prende il calendario, non il logo della firma');
verifica(allegatoCalendario([{ id: 'a3', name: 'agenda.ICS', contentType: 'application/octet-stream' }])?.id === 'a3',
  'e se il tipo non lo dice, lo dice l\'estensione');
verifica(allegatoCalendario([{ id: 'a1', name: 'foto.png', contentType: 'image/png' }]) === null,
  'senza calendario non si ripiega su qualcos\'altro');
verifica(allegatoCalendario([]) === null, 'e senza allegati non c\'è niente da scegliere');

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

console.log('\nQuanto è vecchio lo specchio\n');

// Il difetto che questo disegno può avere davvero: il PC di lavoro spento, e
// l'agenda a schermo che resta quella di ieri **senza dirlo**. Un calendario
// vuoto si nota, uno vecchio no.
const adesso = new Date('2026-09-02T12:00:00Z');
const conFonti = (...letture) => normalizzaDocumento({
  version: 1, aggiornatoIl: adesso.toISOString(), eventi: [],
  fonti: letture.map((letturaIl, i) => ({ nome: `F${i}`, eventi: 1, letturaIl, errore: null })),
});

verifica(etaSpecchio(conFonti('2026-09-02T10:00:00Z'), adesso)?.ore === 2, 'l\'età si conta da quando il dato è stato prodotto');
verifica(avvisoSpecchioFermo(conFonti('2026-09-02T10:00:00Z'), adesso) === '',
  'due ore non sono niente da dire: un giro saltato è normale');
verifica(avvisoSpecchioFermo(conFonti('2026-09-01T10:00:00Z'), adesso).startsWith('fermo da 26 ore'),
  'un giorno intero invece si dice');
verifica(avvisoSpecchioFermo(conFonti('2026-08-20T12:00:00Z'), adesso).includes('13 giorni'),
  'e oltre le quarantott\'ore si conta in giorni, che è come si pensa');

// Con due fonti, una ferma e una viva, il calendario a schermo è vivo: dire il
// contrario sarebbe un falso allarme, e un avviso che grida sempre si smette
// di leggerlo.
verifica(avvisoSpecchioFermo(conFonti('2026-08-01T12:00:00Z', '2026-09-02T11:00:00Z'), adesso) === '',
  'conta la fonte più fresca, non la più vecchia');

// I file scritti prima che `letturaIl` esistesse hanno solo `aggiornatoIl`.
verifica(etaSpecchio({ version: 1, aggiornatoIl: '2026-09-02T09:00:00Z', fonti: [], eventi: [] }, adesso)?.ore === 3,
  'uno specchio vecchio di formato ripiega sulla data di scrittura');
verifica(etaSpecchio(null, adesso) === null, 'e senza specchio non si inventa un\'età');
verifica(avvisoSpecchioFermo(null, adesso) === '', 'né un avviso');

fine();
