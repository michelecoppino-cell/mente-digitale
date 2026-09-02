// Prova del Programma di commessa: i conti puri di `src/programma.js` e i file
// di `src/programmaStore.js`, contro un OneDrive finto.
//
//   npm run prova-programma

import { montaFintoOnedrive, importaModulo, creaTabellone } from './finto-onedrive.mjs';

const finto = montaFintoOnedrive();
const { contenuto, esiste } = finto;
const { verifica, fine } = creaTabellone();

const api = await importaModulo('api.js');
const pg = await importaModulo('programma.js');
const store = await importaModulo('programmaStore.js');
const tempo = await importaModulo('tempo.js');

function pulisci() {
  finto.pulisci();
  api._dimenticaDrive();
}

console.log('\nLe settimane ISO\n');

// La settimana è una stringa, ed è la chiave del carico: se due dispositivi la
// calcolassero diversamente le celle smetterebbero di combaciare.
verifica(tempo.settimanaIso('2026-01-01') === '2026-W01', 'il primo gennaio 2026 è la W01');
verifica(tempo.settimanaIso('2027-01-01') === '2026-W53', 'il primo gennaio 2027 sta ancora nella W53 del 2026');
verifica(tempo.settimanaIso('2026-08-31') === '2026-W36', 'una settimana d\'estate, col fuso in mezzo');
verifica(tempo.lunediDellaSettimana('2026-W36') === '2026-08-31', 'e il suo lunedì torna indietro uguale');
verifica(tempo.settimaneTra('2026-W36', '2026-W38').join(' ') === '2026-W36 2026-W37 2026-W38',
  'le settimane in mezzo, comprese');
// Sommare uno al numero inventerebbe una W53 che nel 2025 non esiste.
verifica(tempo.spostaSettimane('2025-W52', 1) === '2026-W01', 'a capodanno si cammina sul calendario');
verifica(tempo.settimaneTra('2025-W51', '2026-W02').length === 4, 'e l\'intervallo scavalca l\'anno');

console.log('\nIl registro e i file\n');

pulisci();
const commessa = await store.creaProgramma('2573 ABS', { codice: '2573', oreVendute: 1200, inizio: '2026-09-01', fine: '2027-06-30' });
verifica(esiste('mente-digitale/programmi/_registro.json'), 'il registro nasce in programmi/');
verifica(esiste('mente-digitale/programmi/2573-abs.json'), 'e il file prende il nome della commessa');
let doc = await store.leggiProgramma(commessa.id);
verifica(doc.commessa.oreVendute === 1200, 'le ore vendute si rileggono');
verifica((await store.leggiRegistro()).programmi[0].attivo === true, 'un programma nasce acceso');

await store.aggiornaRegistrazione(commessa.id, { attivo: false });
verifica((await store.leggiRegistro()).programmi[0].attivo === false, 'e si può spegnere senza cancellarlo');
await store.aggiornaRegistrazione(commessa.id, { attivo: true });

console.log('\nPacchetti, risorse, voci\n');

doc = await store.cambiaProgramma(commessa.id, d => {
  let x = pg.conPacchetto(d, { nome: 'A60 Fondazioni' });
  x = pg.conPacchetto(x, { nome: 'C10 Strutture' });
  x = pg.conRisorsa(x, 'Marco', 35);
  return pg.conRisorsa(x, 'Sara', 20);
});
const [a60, c10] = doc.pacchetti;
verifica(doc.pacchetti.length === 2 && a60.listId === null,
  'un pacchetto nasce senza lista: la lista arriva alla prima attivazione');
verifica(doc.risorse.find(r => r.nome === 'Sara').oreSettimana === 20, 'la capacità è per persona');
doc = await store.cambiaProgramma(commessa.id, d => pg.conRisorsa(d, 'Marco'));
verifica(doc.risorse.length === 2, 'la stessa persona non entra due volte');

doc = await store.cambiaProgramma(commessa.id, d => pg.conVoci(d, [
  { titolo: 'Fondazioni', ore: 360, pacchettoId: a60.id },
  { titolo: 'Carpenterie', ore: 200, pacchettoId: c10.id, risorsa: 'Marco' },
]));
const fondazioni = doc.voci.find(v => v.titolo === 'Fondazioni');
verifica(fondazioni.oreIniziali === 360, 'le ore iniziali nascono uguali alla stima');
verifica(pg.statoVoce(fondazioni, new Set()) === 'prevista',
  'una voce senza task è prevista: non sta nel pool, non scade, non suona');

console.log('\nLa scomposizione\n');

// Una voce da 360 ore non è un errore da impedire: all'inizio il dettaglio non
// c'è. Man mano che si capisce, la voce prende delle figlie — e da quel momento
// le sue ore sono la loro somma.
doc = await store.cambiaProgramma(commessa.id, d => pg.conVoci(d, [
  { titolo: 'Plinti', ore: 120, padreId: fondazioni.id, pacchettoId: a60.id },
  { titolo: 'Platea', ore: 290, padreId: fondazioni.id, pacchettoId: a60.id },
]));
verifica(doc.voci.find(v => v.id === fondazioni.id).ore === 410, 'la madre vale la somma delle figlie');
verifica(doc.voci.find(v => v.id === fondazioni.id).oreIniziali === 360,
  'ma la baseline resta quella del primo giorno: +50h è il dato utile');
verifica(!pg.eFoglia(doc, fondazioni.id), 'un contenitore non è attivabile');
verifica(pg.oreVoci(doc) === 610, 'le ore stimate contano solo le foglie: 120 + 290 + 200');

const plinti = doc.voci.find(v => v.titolo === 'Plinti');
doc = await store.cambiaProgramma(commessa.id, d => pg.conVoceAggiornata(d, plinti.id, { ore: 100 }));
verifica(doc.voci.find(v => v.id === fondazioni.id).ore === 390, 'e si risomma a ogni modifica');

console.log('\nIl carico, e i due numeri che non devono coincidere\n');

const settimana = '2026-W40';
const chiave = pg.chiaveCarico('Marco', c10.id, settimana);
doc = await store.cambiaProgramma(commessa.id, d => pg.conCarico(d, chiave, 12));
verifica(pg.oreCella(doc, 'Marco', c10.id, settimana) === 12, 'una cella si scrive e si rilegge');
doc = await store.cambiaProgramma(commessa.id, d => pg.conCarico(d, chiave, 0));
verifica(contenuto('programmi/2573-abs.json').carico[chiave] === undefined,
  'una cella svuotata sparisce dal file invece di salvarci uno zero');

doc = await store.cambiaProgramma(commessa.id, d => {
  let x = pg.conCarico(d, pg.chiaveCarico('Marco', c10.id, '2026-W38'), 20);
  x = pg.conCarico(x, pg.chiaveCarico('Marco', c10.id, '2026-W39'), 20);
  return pg.conCarico(x, pg.chiaveCarico('Sara', a60.id, '2026-W41'), 15);
});
const numeri = pg.totali(doc, { settimanaOra: '2026-W40' });
verifica(numeri.speso === 40, 'a sinistra della settimana corrente c\'è lo speso');
verifica(numeri.aFinire === 15, 'a destra c\'è quello che manca');
verifica(numeri.margine === 1200 - 55, 'il margine è il venduto meno tutto quello che c\'è a piano');
verifica(numeri.stimate === 590 && numeri.daCollocare === 590 - 55,
  'stime e celle restano due numeri diversi, e il delta è quello che si guarda');

const perPacchetto = pg.totali(doc, { pacchettoId: c10.id, settimanaOra: '2026-W40' });
verifica(perPacchetto.stimate === 200 && perPacchetto.aPiano === 40,
  'gli stessi numeri, per un pacchetto solo');

console.log('\nLa saturazione\n');

// Nella prima versione la saturazione si legge sul solo programma aperto: è
// l'approssimazione dichiarata in `livelloSaturazione`, e questa prova la
// fotografa così com'è, soglie comprese.
verifica(pg.oreRisorsaSettimana(doc, 'Marco', '2026-W38') === 20, 'le ore di una persona in una settimana');
verifica(pg.livelloSaturazione(36, 35) === 'sopra', 'oltre la capacità');
verifica(pg.livelloSaturazione(32, 35) === 'soglia', 'dal 90% in su si è in soglia');
verifica(pg.livelloSaturazione(20, 35) === 'sotto' && pg.livelloSaturazione(0, 35) === 'vuota',
  'e sotto la soglia la cella non urla');

console.log('\nSpalmare un numero su un intervallo\n');

// «40 h in tutto» su otto settimane: mezze ore, e il resto sulle prime — di
// quello che c'è davanti si sa sempre qualcosa in più.
verifica(pg.spalma(40, 8).join(' ') === '5 5 5 5 5 5 5 5', 'quaranta ore su otto settimane');
verifica(pg.spalma(10, 4).join(' ') === '2.5 2.5 2.5 2.5', 'e le mezze ore ci stanno');
const dispari = pg.spalma(10, 3);
verifica(dispari.reduce((s, v) => s + v, 0) === 10 && dispari[0] >= dispari[2],
  'il resto si appoggia sulle prime settimane, e il totale torna');

console.log('\nL\'attivazione\n');

const carpenterie = doc.voci.find(v => v.titolo === 'Carpenterie');
doc = await store.cambiaProgramma(commessa.id, d =>
  pg.conVoceAttivata(d, carpenterie.id, { taskId: 't-99', listId: 'l-99', risorsa: 'Marco' }));
const attivata = doc.voci.find(v => v.id === carpenterie.id);
verifica(attivata.taskId === 't-99' && attivata.attivataIl,
  'la voce ricorda il task che ha generato, e quando');
verifica(pg.statoVoce(attivata, new Set(['t-99'])) === 'attiva', 'con il task ancora aperto la voce è attiva');
verifica(pg.statoVoce(attivata, new Set()) === 'fatta', 'quando il task sparisce dal pool la voce è fatta');
verifica(pg.statoVoce(attivata, new Set(), false) === 'attiva',
  'ma senza il pool non si dichiara fatta niente');

console.log('\nL\'incolla in massa\n');

const incollato = pg.conVociIncollate(doc, [
  'D20 Impianti | Schemi elettrici | 40 | Sara',
  'D20 Impianti | Schemi idraulici | 25',
  'A60 Fondazioni\tRelazione geotecnica\t16h',
  'Una riga di solo titolo',
  '',
].join('\n'));
verifica(incollato.aggiunte === 4, 'quattro righe, quattro voci');
verifica(incollato.pacchettiNuovi.length === 1 && incollato.doc.pacchetti.length === 3,
  'il pacchetto nominato e non ancora esistente nasce, quello che c\'è già si riusa');
verifica(incollato.doc.voci.find(v => v.titolo === 'Relazione geotecnica').ore === 16,
  '«16h» sono sedici ore');
verifica(incollato.doc.voci.find(v => v.titolo === 'Schemi elettrici').risorsa === 'Sara'
  && incollato.doc.risorse.some(r => r.nome === 'Sara'), 'e la risorsa nominata entra fra le risorse');
verifica(incollato.doc.voci.find(v => v.titolo === 'Una riga di solo titolo').ore === 0,
  'un elenco di soli titoli non è un errore');

console.log('\nDue dispositivi insieme\n');

// La matrice si tocca dal portatile e dal telefono: le ore messe di qua non
// devono cancellare la voce aggiunta di là.
doc = await store.leggiProgramma(commessa.id);
const voceDelTelefono = { id: 'v-telefono', titolo: 'Aggiunta dall\'altro dispositivo', ore: 8, pacchettoId: a60.id };
finto.altroDispositivoScrive('programmi/2573-abs.json', {
  ...contenuto('programmi/2573-abs.json'),
  voci: [...contenuto('programmi/2573-abs.json').voci, voceDelTelefono],
});
const dopo = await store.cambiaProgramma(commessa.id, d =>
  pg.conCarico(d, pg.chiaveCarico('Sara', a60.id, '2026-W42'), 6));
verifica(dopo.voci.some(v => v.id === 'v-telefono'), 'la voce scritta dall\'altro dispositivo resta');
verifica(dopo.carico[pg.chiaveCarico('Sara', a60.id, '2026-W42')] === 6, 'e le ore appena messe pure');

console.log('\nLo scarto e la cancellazione\n');

const conFiglie = await store.cambiaProgramma(commessa.id, d => pg.senzaVoce(d, fondazioni.id));
verifica(!conFiglie.voci.some(v => [fondazioni.id, plinti.id].includes(v.id)),
  'cancellare una voce si porta via la sua discendenza');

fine();
