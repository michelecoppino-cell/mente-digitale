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
const excel = await importaModulo('programmaExcel.js');
const foglio = await importaModulo('xlsx.js');
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

console.log('\nLe due strade per scrivere una voce\n');

// I campi separati e l'incolla devono finire nello stesso posto: se fossero due
// implementazioni, col tempo racconterebbero due cose diverse. Qui si prova che
// leggere il testo e creare le voci sono davvero due pezzi dello stesso giro.
const righeLette = pg.leggiRigheVoci('D20 Impianti | Schemi | 40 | Sara\nsolo titolo');
verifica(righeLette.righe.length === 2 && righeLette.righe[0].ore === 40,
  'il testo diventa righe strutturate');
verifica(righeLette.righe[1].titolo === 'solo titolo' && righeLette.righe[1].pacchetto === '',
  'una colonna sola resta un titolo, non un pacchetto');

const daCampi = pg.conVociDaRighe(doc, righeLette.righe);
const daTesto = pg.conVociIncollate(doc, 'D20 Impianti | Schemi | 40 | Sara\nsolo titolo');
verifica(daCampi.aggiunte === daTesto.aggiunte && daCampi.pacchettiNuovi.length === daTesto.pacchettiNuovi.length,
  'i campi separati e l\'incolla producono la stessa cosa');

console.log('\nSistemare quello che si è già scritto\n');

pulisci();
const seconda = await store.creaProgramma('Ponte Tagliamento', {
  codice: '', oreVendute: 800, inizio: '2026-01-05', fine: '2026-12-25', sezione: '2600-PONTE',
});
let d2 = await store.cambiaProgramma(seconda.id, d => {
  let x = pg.conPacchetto(d, { nome: 'Spalle' });
  x = pg.conPacchetto(x, { nome: 'Impalcato' });
  x = pg.conRisorsa(x, 'Marco', 35);
  return pg.conVoci(x, [
    { titolo: 'Spalla ovest', ore: 40, pacchettoId: x.pacchetti[0].id, risorsa: 'Marco' },
    { titolo: 'Travi', ore: 60, pacchettoId: x.pacchetti[1].id },
  ]);
});
const [spalle, impalcato] = d2.pacchetti;

d2 = await store.cambiaProgramma(seconda.id, d => {
  let x = pg.conCarico(d, pg.chiaveCarico('Marco', spalle.id, '2026-W10'), 10);
  return pg.conCarico(x, pg.chiaveCarico('Marco', impalcato.id, '2026-W10'), 5);
});

// Togliere un pacchetto è l'unico gesto che potrebbe portarsi via quaranta voci
// e trecento ore: le voci passano, e le celle si fondono per somma, così il
// totale della settimana di quella persona non cambia.
const fuso = pg.senzaPacchetto(d2, spalle.id, { spostaSu: impalcato.id });
verifica(fuso.pacchetti.length === 1 && fuso.voci.every(v => v.pacchettoId === impalcato.id),
  'togliendo un pacchetto le sue voci passano a quello scelto');
verifica(pg.oreCella(fuso, 'Marco', impalcato.id, '2026-W10') === 15,
  'e le sue celle si sommano a quelle di destinazione');
verifica(pg.oreRisorsaSettimana(fuso, 'Marco', '2026-W10') === 15,
  'quindi il totale della settimana di quella persona non cambia');

const senzaDestinazione = pg.senzaPacchetto(d2, spalle.id);
verifica(senzaDestinazione.voci.some(v => v.titolo === 'Spalla ovest' && v.pacchettoId === null),
  'senza destinazione le voci restano, senza pacchetto');
verifica(pg.oreCarico(senzaDestinazione) === 5,
  'ma le celle se ne vanno: non esiste una riga senza pacchetto in cui vivere');

// Rinominare una persona in un posto solo lascerebbe un mese di ore appese a
// una che non esiste più: il nome sta anche nelle chiavi del carico.
const rinominato = pg.conRisorsaRinominata(d2, 'Marco', 'Marco Rossi');
verifica(rinominato.risorse[0].nome === 'Marco Rossi'
  && pg.oreCella(rinominato, 'Marco Rossi', spalle.id, '2026-W10') === 10,
  'rinominando una persona si spostano anche le sue ore');
verifica(rinominato.voci.find(v => v.titolo === 'Spalla ovest').risorsa === 'Marco Rossi',
  'e le voci che la proponevano');

const senzaMarco = pg.senzaRisorsa(d2, 'Marco');
verifica(senzaMarco.risorse.length === 0 && pg.oreCarico(senzaMarco) === 0,
  'togliere una persona si porta via le sue ore');
verifica(senzaMarco.voci.find(v => v.titolo === 'Spalla ovest').risorsa === null,
  'ma non le voci che la proponevano: la risorsa di una voce è una previsione');

console.log('\nLe ore già spese, per pacchetto\n');

// Del passato non si sa la distribuzione, si sa il totale: un numero per
// pacchetto e persona, spalmato all'indietro. Il totale è vero, la
// distribuzione è dichiaratamente approssimata.
const passate = pg.settimanePassate(d2, '2026-W11');
verifica(passate[0] === '2026-W02' && passate[passate.length - 1] === '2026-W10',
  'le settimane passate vanno dall\'inizio della commessa a prima di quella corrente');

const conSpeso = pg.conSpesoRipartito(d2, {
  risorsa: 'Marco', pacchettoId: spalle.id, ore: 90, settimane: passate,
});
verifica(pg.oreCarico(conSpeso, { pacchettoId: spalle.id, risorsa: 'Marco' }) === 90,
  'novanta ore spalmate fanno novanta ore');
verifica(pg.spesoPerRisorsa(conSpeso, spalle.id, passate).get('Marco') === 90,
  'e si rileggono per persona, che è quello che il campo mostra già scritto');

// Riscrivere il consuntivo è una correzione, non un'aggiunta: sommare
// vorrebbe dire raddoppiare le ore ogni volta che si cambia idea.
const corretto = pg.conSpesoRipartito(conSpeso, {
  risorsa: 'Marco', pacchettoId: spalle.id, ore: 50, settimane: passate,
});
verifica(pg.oreCarico(corretto, { pacchettoId: spalle.id, risorsa: 'Marco' }) === 50,
  'riscriverlo sostituisce invece di sommarsi');
verifica(pg.oreCella(corretto, 'Marco', impalcato.id, '2026-W10') === 5,
  'e non tocca gli altri pacchetti');

console.log('\nTutta la commessa in una tabella\n');

// I numeri si leggevano un pacchetto alla volta: per sapere come stava messa
// tutta la commessa bisognava cliccarli uno per uno e sommare a mente.
const conOrfana = pg.conVoci(d2, [{ titolo: 'Coordinamento', ore: 12 }]);
const riep = pg.riepilogoPacchetti(conOrfana, { settimanaOra: '2026-W11' });
verifica(riep.righe.length === 3, 'una riga per pacchetto, più le voci senza pacchetto');
verifica(riep.righe[riep.righe.length - 1].pacchettoId === null
  && riep.righe[riep.righe.length - 1].stimate === 12,
  'le voci senza pacchetto esistono e pesano: non vederle darebbe un totale che non torna');
verifica(riep.righe.reduce((s, r) => s + r.stimate, 0) === riep.totale.stimate,
  'la colonna delle stimate somma al totale');
verifica(riep.totale.speso === 15 && riep.totale.aFinire === 0,
  'speso e a finire sono la matrice tagliata in due dalla settimana di oggi');

console.log('\nIl collegamento con la sezione\n');

// È il collegamento che decide come si chiamano le liste: da lì la sezione se
// le ritrova da sola, senza che nessuno le ricucia a mano.
verifica(pg.gruppoCommessa(d2) === '2600-PONTE', 'senza codice la commessa è la sua sezione');
verifica(pg.nomeListaProposto(d2, spalle) === '2600-PONTE.Spalle-261225',
  'e la lista di un pacchetto prende quel nome, con la scadenza della commessa');
const conCodice = pg.conCommessa(d2, { codice: '2600' });
verifica(pg.gruppoCommessa(conCodice) === '2600', 'un codice scritto a mano scavalca la sezione');

console.log('\nLa fotografia col giorno nel nome\n');

const foto = pg.esportazione(d2, { giorno: '2026-03-12' });
verifica(foto.nomeFile === 'ponte-tagliamento-2026-03-12.json',
  'il nome del file porta la data: due fotografie non si coprono a vicenda');
verifica(pg.normalizzaProgramma(foto.dati).voci.length === d2.voci.length,
  'ed è rileggibile: è lo stesso schema del documento');


console.log('\nIl carico di una persona su tutte le commesse\n');

// La domanda che la matrice di commessa non poteva porre: «a questa persona ho
// già dato quella settimana?». Dentro un documento solo la risposta non c'è,
// perché le due commesse sono due documenti.
const altra = await store.creaProgramma('2601 Muro', { oreVendute: 200, inizio: '2026-03-01', fine: '2026-05-31' });
const docAltra = await store.cambiaProgramma(altra.id, d => {
  let x = pg.conRisorsa(d, 'Marco', 35);
  x = pg.conRisorsa(x, 'Sara', 20);
  x = pg.conPacchetto(x, { nome: 'Verifiche' });
  const pacchetto = x.pacchetti[0];
  x = pg.conCarico(x, pg.chiaveCarico('Marco', pacchetto.id, '2026-W10'), 30);
  return pg.conCarico(x, pg.chiaveCarico('Marco', pacchetto.id, '2026-W11'), 4);
});

const settimanePersone = pg.settimaneDellePersone([corretto, docAltra], '2026-W10');
verifica(settimanePersone.includes('2026-W10') && settimanePersone.includes('2026-W11'),
  'le colonne sono l\'unione degli orizzonti dei programmi accesi');
verifica(settimanePersone[0] >= '2026-W06',
  'e non si torna indietro oltre le quattro settimane che servono da riferimento');

const righe = pg.caricoPersone(
  [{ id: 'a', nome: '2600 Ponte', doc: corretto }, { id: 'b', nome: '2601 Muro', doc: docAltra }],
  settimanePersone);
const marco = righe.find(r => r.nome === 'Marco');
verifica(!!marco, 'la persona compare una volta sola, non una per commessa');
verifica(marco.ore['2026-W10'] === pg.oreRisorsaSettimana(corretto, 'Marco', '2026-W10') + 30,
  'e le sue ore della settimana sono la somma delle due commesse');
// Dieci ore e mezza di qua, trenta di là: nessuna delle due matrici lo dice
// sovraccarico, e insieme sono quaranta ore e mezza su trentacinque.
verifica(pg.oreRisorsaSettimana(corretto, 'Marco', '2026-W10') < marco.capacita
  && marco.ore['2026-W10'] > marco.capacita,
  'la sovrapposizione si vede solo qui: dentro ogni singola commessa è sotto la capacità');
verifica(marco.commesse.length === 2 && marco.commesse[0].totale >= marco.commesse[1].totale,
  'aprendo la riga si vede da dove viene il carico, dalla commessa che pesa di più');
verifica(marco.capacita === 35, 'la capacità è la più alta fra quelle dichiarate');
verifica(marco.sovrapposte.includes('2026-W10'),
  'e la settimana in cui sfora è marcata: è tutto il motivo per cui questa vista esiste');
verifica(!marco.sovrapposte.includes('2026-W11'), 'quella in cui non sfora no');

// Una persona che sta in anagrafica ma non ha ancora ore ha comunque la sua
// riga: senza, non esisterebbe il posto in cui guardare prima di darle lavoro.
const sara = righe.find(r => r.nome === 'Sara');
verifica(!!sara && sara.totale === 0,
  'chi è in anagrafica ma non ha ore ha comunque la sua riga: è il posto in cui si guarda prima di dargliene');
verifica(pg.caricoPersone([], []).length === 0, 'e senza programmi non c\'è nessuna riga');

console.log('\nIl foglio che esce, e le ore che rientrano\n');

// La scala vera: dieci persone, sei pacchetti, un anno. È a questa scala che i
// difetti sono difetti — un foglio da tre colonne torna sempre.
pulisci();
const grande = await store.creaProgramma('2588 Ampliamento', {
  codice: '2588', oreVendute: 4200, settimaneDa: '2026-W10', settimaneA: '2026-W22',
});
let big = await store.cambiaProgramma(grande.id, d => {
  let x = d;
  for (const nome of ['B10 Fondazioni', 'C10 Carpenterie', 'D10 Sismica']) x = pg.conPacchetto(x, { nome });
  for (const nome of ['Michele', 'Marco', 'Sara', 'Luca', 'Elena', 'Giovanni', 'Chiara', 'Andrea', 'Federica', 'Stefano']) {
    x = pg.conRisorsa(x, nome, 35);
  }
  const [pkB10, pkC10] = x.pacchetti;
  x = pg.conVoci(x, [{ id: 'madre', titolo: 'Fondazioni corpo A', pacchettoId: pkB10.id, ore: 0 }]);
  const madre = x.voci[x.voci.length - 1].id;
  x = pg.conVoci(x, [
    { titolo: 'Plinti', pacchettoId: pkB10.id, padreId: madre, ore: 120, oreIniziali: 120, risorsa: 'Marco' },
    { titolo: 'Travi rovesce', pacchettoId: pkB10.id, padreId: madre, ore: 80, oreIniziali: 80, risorsa: 'Luca' },
  ]);
  x = pg.conCarico(x, pg.chiaveCarico('Marco', pkB10.id, '2026-W12'), 20);
  x = pg.conCarico(x, pg.chiaveCarico('Marco', pkC10.id, '2026-W12'), 6);
  x = pg.conCarico(x, pg.chiaveCarico('Luca', pkB10.id, '2026-W13'), 14.5);
  return x;
});
const [bigB10, bigC10] = big.pacchetti;

// ── La somma dei contenitori, anche in lettura ────────────────────────────────
// La madre nasce a zero e le figlie pesano 200: se la somma si rifacesse solo
// alla modifica, un file scritto da fuori — o da una versione di prima —
// mostrerebbe una lavorazione da zero ore con dentro duecento ore di lavoro.
verifica(big.voci.find(v => v.titolo === 'Fondazioni corpo A').ore === 200,
  'le ore di una lavorazione sono la somma delle sue sotto-voci');
const dalDisco = pg.normalizzaProgramma({
  ...big,
  voci: big.voci.map(v => (v.titolo === 'Fondazioni corpo A' ? { ...v, ore: 7 } : v)),
});
verifica(dalDisco.voci.find(v => v.titolo === 'Fondazioni corpo A').ore === 200,
  'e una somma sbagliata nel file si rifà leggendola, non si mostra');

// ── Il file .xlsx ─────────────────────────────────────────────────────────────
verifica(foglio.lettera(0) === 'A' && foglio.lettera(25) === 'Z' && foglio.lettera(26) === 'AA'
  && foglio.lettera(51) === 'AZ' && foglio.lettera(52) === 'BA',
  'le colonne oltre la Z hanno due lettere: cinquanta settimane arrivano alla BA');

const libro = excel.libroProgramma(big, { settimanaOra: '2026-W13' });
verifica(libro.nomeFile.endsWith('.xlsx') && libro.nomeFile.startsWith('2588-ampliamento-'),
  'il file porta il nome della commessa e il giorno: due fotografie non si coprono');
const byte = libro.byte;
verifica(byte[0] === 0x50 && byte[1] === 0x4b && byte[2] === 0x03 && byte[3] === 0x04,
  'e comincia con PK: è uno zip, che è quello che un .xlsx è');
// La coda dell'indice va trovata dove Excel la cerca: negli ultimi 22 byte.
const coda = new DataView(byte.buffer, byte.byteLength - 22);
verifica(coda.getUint32(0, true) === 0x06054b50, 'lo zip si chiude con la fine dell\'indice');
verifica(coda.getUint16(8, true) === 8, 'e dentro ci sono otto pezzi: le quattro parti fisse, gli stili, tre fogli');
const dentro = new TextDecoder().decode(byte);
verifica(dentro.includes('2026-W12') && dentro.includes('Marco') && dentro.includes('B10 Fondazioni'),
  'le settimane, le persone e i pacchetti sono scritti in chiaro nelle celle');
verifica(dentro.includes('state="frozen"'),
  'i riquadri sono bloccati: su cinquanta colonne, senza, non si sa più di chi sia la riga');
verifica(!dentro.includes(']]>') && !/<t[^>]*>[^<]*</.test('') , 'niente resta appeso a metà');

const matrice = excel.righeMatrice(big, ['2026-W12', '2026-W13'], '2026-W13');
const rigaMarco = matrice.find(r => r[0]?.v === 'Marco');
verifica(rigaMarco && rigaMarco[1] === '', 'la riga di totale di una persona non porta un pacchetto');
verifica(rigaMarco[2].v === 26, 'e somma i suoi pacchetti: venti su B10 più sei su C10');
const rigaB10 = matrice[matrice.indexOf(rigaMarco) + 1];
verifica(rigaB10[1] === 'B10 Fondazioni' && rigaB10[2].v === 20,
  'sotto, una riga per pacchetto con le ore di quella settimana');

// ── Le ore che rientrano ─────────────────────────────────────────────────────
verifica(excel.interpretaSettimana('2026-W12', []) === '2026-W12', 'la settimana com\'esce si rilegge');
verifica(excel.interpretaSettimana('W12', ['2026-W12']) === '2026-W12',
  'e anche abbreviata, risolta contro le settimane che il programma conosce');
verifica(excel.interpretaSettimana('2026-03-18', []) === '2026-W12', 'una data ISO diventa la sua settimana');
verifica(excel.interpretaSettimana('16/03/2026', []) === '2026-W12', 'e una data all\'italiana pure');
verifica(excel.interpretaSettimana('ciao', ['2026-W12']) === null, 'quello che non è una settimana non lo diventa');

// Il giro vero: si esporta, si corregge la colonna della settimana finita, si
// rimanda indietro. Il rettangolo incollato ha la persona scritta una volta
// sola, sulla riga del totale, e le righe sotto la ereditano.
const rettangolo = [
  'Persona\tPacchetto\t2026-W12\t2026-W13',
  'Marco\t\t26\t',
  '\tB10 Fondazioni\t31\t',
  '\tC10 Carpenterie\t4\t',
  'Luca\t\t\t14,5',
  '\tB10 Fondazioni\t\t12',
].join('\n');
const lettura = excel.leggiOreRegistrate(big, rettangolo, { settimane: ['2026-W12', '2026-W13'] });
verifica(lettura.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12')] === 31,
  'le ore vere entrano nella cella giusta');
verifica(lettura.celle[pg.chiaveCarico('Marco', bigC10.id, '2026-W12')] === 4,
  'e la persona si trascina in giù: la riga del pacchetto non ripete il nome');
verifica(lettura.celle[pg.chiaveCarico('Luca', bigB10.id, '2026-W13')] === 12,
  'la seconda persona ricomincia da capo');
verifica(!Object.keys(lettura.celle).some(k => k.includes('|2026-W13') && k.startsWith('Marco')),
  'una cella lasciata vuota non azzera: chi corregge una settimana non tocca le altre');
verifica(!Object.values(lettura.celle).includes(26),
  'e la riga di somma della persona non si reimporta: sarebbe il totale scritto dentro un pacchetto');
verifica(lettura.sostituite === 3 && lettura.persone.join(' ') === 'Luca Marco',
  'prima di applicare si sa quante celle cambiano e di chi');

const applicato = Object.entries(lettura.celle).reduce((d, [k, o]) => pg.conCarico(d, k, o), big);
verifica(pg.oreCella(applicato, 'Marco', bigB10.id, '2026-W12') === 31,
  'un consuntivo sostituisce le ore previste, non ci si somma');
const dueVolte = Object.entries(excel.leggiOreRegistrate(applicato, rettangolo).celle)
  .reduce((d, [k, o]) => pg.conCarico(d, k, o), applicato);
verifica(pg.oreCella(dueVolte, 'Marco', bigB10.id, '2026-W12') === 31,
  'e reincollare lo stesso foglio non raddoppia niente');

const sciolte = excel.leggiOreRegistrate(big, [
  'Marco | B10 Fondazioni | 2026-W12 | 18',
  'Nessuno | B10 Fondazioni | 2026-W12 | 9',
  'due parole soltanto',
].join('\n'), { settimane: ['2026-W12', '2026-W13'] });
verifica(sciolte.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12')] === 18,
  'righe sciolte persona|pacchetto|settimana|ore: l\'altro modo di scriverle');
verifica(sciolte.ignorate.length === 2,
  'e quello che non si capisce si dice invece di sparire: in un consuntivo una riga persa è un margine sbagliato');

// Il difetto che si vede solo con un orizzonte vero: in una riga sciolta il
// numero delle ore — «18» — è anche un modo di scrivere la W18, e dentro
// cinquanta settimane la W18 esiste. Quella riga passava per un'intestazione, e
// da lì il rettangolo che non c'era: nessun errore, nessuna cella scritta.
const orizzonte = tempo.settimaneTra('2026-W01', '2026-W52');
const conW18 = excel.leggiOreRegistrate(big, `Marco | B10 Fondazioni | 2026-W12 | 18`, { settimane: orizzonte });
verifica(conW18.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12')] === 18,
  'una riga sciolta resta una riga sciolta anche se le sue ore somigliano a una settimana');
verifica(Object.keys(conW18.celle).length === 1, 'e non ne nasce una seconda cella dal nulla');

const delta = excel.differenza(big, lettura.celle);
verifica(delta.prima === 40.5 && delta.dopo === 47,
  'quanto si sta per spostare si sa prima di premere');

fine();
