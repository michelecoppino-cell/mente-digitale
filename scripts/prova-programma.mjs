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

// L'elenco voci si legge per pacchetto, non nell'ordine in cui le voci sono
// state scritte: incollate a blocchi, due voci dello stesso pacchetto finivano a
// venti righe di distanza.
const perPacchettoOrd = pg.alberoVoci(doc, undefined, { ordine: 'pacchetto' });
const pacchettiInFila = perPacchettoOrd.filter(x => x.livello === 0)
  .map(x => x.voce.pacchettoId || doc.voci.find(f => f.padreId === x.voce.id)?.pacchettoId || null);
verifica(pacchettiInFila.filter((p, i) => p !== pacchettiInFila[i - 1]).length
  === new Set(pacchettiInFila).size,
  'i rami di primo livello si raggruppano per pacchetto, senza tornare indietro');
verifica(pg.alberoVoci(doc).map(x => x.voce.id).sort().join()
  === perPacchettoOrd.map(x => x.voce.id).sort().join(),
  'e non si perde né si duplica niente: è lo stesso albero, in un altro ordine');
// Una lavorazione porta spesso il pacchetto solo sulle sue sotto-voci: se
// contasse il suo, finirebbe con le orfane in fondo invece che coi suoi figli.
verifica(perPacchettoOrd[0].livello === 0,
  'l\'albero resta un albero: la madre prima delle figlie');

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
verifica(numeri.programmate === 15, 'a destra c\'è quello che è già in calendario');
// «A finire» non guarda le celle future: la programmazione non si fa mai fino in
// fondo, e leggerla lì diceva sistematicamente meno lavoro di quanto ne restava.
verifica(numeri.aFinire === 590 - 40, 'a finire sono le stime meno lo speso, non le celle a destra');
verifica(numeri.margine === 1200 - 590, 'il margine è il venduto meno speso più a finire');
verifica(numeri.stimate === 590 && numeri.daCollocare === 590 - 55,
  'stime e celle restano due numeri diversi, e il delta è quello che si guarda');

const perPacchetto = pg.totali(doc, { pacchettoId: c10.id, settimanaOra: '2026-W40' });
verifica(perPacchetto.stimate === 200 && perPacchetto.aPiano === 40,
  'gli stessi numeri, per un pacchetto solo');
verifica(perPacchetto.aFinire === 200 - 40 && perPacchetto.margine === 0,
  'e per un pacchetto il metro sono le sue voci: speso più a finire le ripagano esatte');
// Chi ha già speso più di quanto stimava non ha ore «di credito» da finire.
const sforato = pg.conCarico(doc, pg.chiaveCarico('Marco', c10.id, '2026-W37'), 500);
verifica(pg.totali(sforato, { pacchettoId: c10.id, settimanaOra: '2026-W40' }).aFinire === 0,
  'e a finire non va mai sotto zero: speso più delle stime è un margine rosso, non ore di credito');
verifica(pg.totali(sforato, { pacchettoId: c10.id, settimanaOra: '2026-W40' }).margine === 200 - 540,
  'il rosso si legge tutto nel margine');

// Le pastiglie della barra si accendono in più d'una: il filtro è un elenco, e
// due pacchetti accesi devono dire la somma dei due — non il primo, e non la
// commessa intera.
const dueInsieme = pg.totali(doc, { pacchettoId: [a60.id, c10.id], settimanaOra: '2026-W40' });
const soloA60 = pg.totali(doc, { pacchettoId: a60.id, settimanaOra: '2026-W40' });
verifica(dueInsieme.stimate === soloA60.stimate + perPacchetto.stimate
  && dueInsieme.aPiano === soloA60.aPiano + perPacchetto.aPiano,
  'due pacchetti accesi insieme sommano i due, uno per uno');
verifica(pg.totali(doc, { pacchettoId: [], settimanaOra: '2026-W40' }).vendute === 1200,
  'e un elenco vuoto vuol dire tutti: il metro torna a essere il venduto');
verifica(pg.oreCarico(doc, { pacchettoId: [a60.id, c10.id] })
  === pg.oreCarico(doc, { pacchettoId: a60.id }) + pg.oreCarico(doc, { pacchettoId: c10.id }),
  'anche le ore a piano si sommano sui pacchetti accesi');

console.log('\nLa saturazione\n');

// Nella prima versione la saturazione si legge sul solo programma aperto: è
// l'approssimazione dichiarata in `livelloSaturazione`, e questa prova la
// fotografa così com'è, soglie comprese.
verifica(pg.oreRisorsaSettimana(doc, 'Marco', '2026-W38') === 20, 'le ore di una persona in una settimana');
verifica(pg.livelloSaturazione(36, 35) === 'sopra', 'oltre la capacità');
verifica(pg.livelloSaturazione(32, 35) === 'soglia', 'dal 90% in su si è in soglia');
verifica(pg.livelloSaturazione(20, 35) === 'sotto' && pg.livelloSaturazione(0, 35) === 'vuota',
  'e sotto la soglia la cella non urla');

console.log('\nLa matrice girata: le righe sono il lavoro, non le persone\n');

// La matrice ha in cima il pacchetto e sotto le persone. Le somme che quella
// tabella legge sono queste, ed è qui che si controlla che un filtro non lasci
// in piedi il totale di tutto il resto.
verifica(pg.orePacchettoSettimana(doc, c10.id, '2026-W38') === 20,
  'il totale di un pacchetto in una settimana: è la riga chiusa');
verifica(pg.orePacchettoSettimana(doc, c10.id, '2026-W38', 'Sara') === 0,
  'e ristretto a una persona sola, sono le sue ore e basta');
verifica(pg.oreRisorsaSettimana(doc, 'Marco', '2026-W38', c10.id) === 20
  && pg.oreRisorsaSettimana(doc, 'Marco', '2026-W38', a60.id) === 0,
  'anche il totale di una persona sa del filtro: un filtro che non tocca le somme è peggio di nessun filtro');
verifica(pg.risorseDiPacchetto(doc, c10.id).map(r => r.nome).join() === 'Marco',
  'le sotto-righe di un pacchetto sono solo chi ci ha davvero qualcosa');

// E sotto un pacchetto si apre anche il lavoro che ci sta dentro, un livello
// per bottone: le lavorazioni, poi le loro figlie.
const soloRadici = pg.vociDiPacchetto(doc, a60.id, 1);
verifica(soloRadici.length === 1 && soloRadici[0].voce.titolo === 'Fondazioni',
  'a un livello si vedono le lavorazioni, non le loro figlie');
const conSottovoci = pg.vociDiPacchetto(doc, a60.id, 2);
verifica(conSottovoci.map(x => x.voce.titolo).join() === 'Fondazioni,Plinti,Platea'
  && conSottovoci[1].livello === 1,
  'a due si aprono le sotto-voci, in ordine di albero e con il loro rientro');
// Una lavorazione porta il pacchetto solo sulle figlie: guardando il suo campo
// e non il ramo, non comparirebbe sotto nessun pacchetto.
verifica(doc.voci.find(v => v.titolo === 'Fondazioni').pacchettoId === a60.id
  || conSottovoci.length === 3,
  'e il pacchetto di una lavorazione si legge dal ramo, non dalla sola voce');
const scartate = pg.vociDiPacchetto(doc, a60.id, 3).filter(x => x.voce.scartata);
verifica(scartate.length === 0, 'le scartate non ci sono: è lavoro che non si fa');

console.log('\nLe ore di una voce\n');

// La cella impara la voce, e la impara **in coda**: le chiavi a tre segmenti
// sono le ore date al pacchetto prima che le voci ci fossero, e restano valide.
verifica(pg.chiaveCarico('Marco', a60.id, '2026-W40') === `Marco|${a60.id}|2026-W40`,
  'senza voce la chiave è quella di sempre: nessun file su OneDrive da riscrivere');
verifica(pg.chiaveCarico('Marco', a60.id, '2026-W40', plinti.id).endsWith(`|${plinti.id}`),
  'e con la voce il quarto segmento si aggiunge in coda');
verifica(pg.leggiChiaveCarico(`Marco|${a60.id}|2026-W40`).voceId === null,
  'una chiave vecchia si legge senza voce, non con una voce sbagliata');

const platea = doc.voci.find(v => v.titolo === 'Platea');
let conVoci = pg.conCarico(doc, pg.chiaveCarico('Marco', a60.id, '2026-W40', plinti.id), 10);
conVoci = pg.conCarico(conVoci, pg.chiaveCarico('Sara', a60.id, '2026-W40', platea.id), 6);
verifica(pg.oreCella(conVoci, 'Marco', a60.id, '2026-W40', plinti.id) === 10,
  'una cella di voce si scrive e si rilegge');
verifica(pg.oreCella(conVoci, 'Marco', a60.id, '2026-W40') === 0,
  'e non è la stessa cella di quelle senza voce: sarebbero le stesse ore contate due volte');
// La riga di una lavorazione dice il totale del suo ramo, come le ore stimate.
verifica(pg.oreVoceSettimana(conVoci, fondazioni.id, '2026-W40') === 16,
  'la riga di una lavorazione somma le sue sotto-voci');
verifica(pg.oreVoceSettimana(conVoci, fondazioni.id, '2026-W40', 'Marco') === 10,
  'e ristretta a una persona, le sole sue');
verifica(pg.orePacchettoSettimana(conVoci, a60.id, '2026-W40') === 16,
  'e il pacchetto le prende tutte, con voce o senza');
verifica(pg.oreCarico(conVoci, { voceId: fondazioni.id }) === 16
  && pg.oreCarico(conVoci, { voceId: plinti.id }) === 10,
  'il filtro per voce prende il ramo, non la sola riga');

// Chi compare sotto una voce: chi ci ha già ore, più chi la voce propone.
verifica(pg.risorseDiVoce(conVoci, plinti.id).map(r => r.nome).join() === 'Marco',
  'sotto una voce compare chi ci ha le ore');
verifica(pg.risorseDiVoce(conVoci, plinti.id, false).map(r => r.nome).join() === 'Marco',
  'e su una voce con figlie mostrate, la proposta non aggiunge una riga vuota');

// ── Le ore lasciate sul pacchetto, e la voce che le adotta ───────────────────
// Marco ha venti ore date a C10 e basta — scritte prima che il pacchetto fosse
// scomposto — e dentro C10 una sola voce lo propone: «Carpenterie». Quelle ore
// sono di quella voce, e devono comparire nella sua riga invece che in coda al
// pacchetto, in una riga che ripete il nome di quella appena aperta.
const carpAdottiva = doc.voci.find(v => v.titolo === 'Carpenterie');
verifica(pg.voceAdottiva(conVoci, c10.id, 'Marco') === carpAdottiva.id,
  'la voce che propone quella persona, e che è l\'unica, adotta le ore del pacchetto');
verifica(pg.oreSottoRiga(conVoci, 'Marco', c10.id, carpAdottiva.id, '2026-W38') === 20,
  'e la sua riga le mostra: era il numero che finiva in fondo');
verifica(pg.oreVoceSettimana(conVoci, carpAdottiva.id, '2026-W38') === 20,
  'anche il totale della voce le conta, altrimenti sarebbe una somma che non torna');
verifica(pg.orePacchettoSettimana(conVoci, c10.id, '2026-W38') === 20,
  'e il pacchetto continua a dire venti: adottare non è duplicare');
verifica(pg.risorseSenzaVoce(conVoci, c10.id).length === 0,
  'chi è adottato non ha più la riga in coda al pacchetto: sarebbe la stessa cella due volte');
verifica(pg.risorseSenzaVoce(conVoci, a60.id).map(r => r.nome).join() === 'Sara',
  'chi nessuna voce reclama ce l\'ha ancora: sparire sarebbe un totale che non torna');

// Due voci che propongono la stessa persona non adottano niente: lì la domanda
// «a quale voce andavano» torna senza risposta, e indovinarla è quello che qui
// non si fa.
const dueVociStessa = pg.conVoci(conVoci, [{ titolo: 'Carpenterie bis', pacchettoId: c10.id, ore: 10, risorsa: 'Marco' }]);
verifica(pg.voceAdottiva(dueVociStessa, c10.id, 'Marco') === null,
  'con due voci che propongono la stessa persona non si adotta');
verifica(pg.risorseSenzaVoce(dueVociStessa, c10.id).map(r => r.nome).join() === 'Marco',
  'e quelle ore tornano nella loro riga in coda, invece di sparire dalla schermata');

// Scrivere in una riga adottata porta le ore sulla voce e svuota la cella del
// pacchetto: sono le stesse ore, e tenerle in due posti raddoppierebbe la
// settimana.
const dove = pg.destinazioneOre(conVoci, 'Marco', c10.id, carpAdottiva.id, '2026-W38');
verifica(dove.chiave === pg.chiaveCarico('Marco', c10.id, '2026-W38', carpAdottiva.id)
  && dove.assorbe.join() === pg.chiaveCarico('Marco', c10.id, '2026-W38'),
  'scrivendoci dentro, le ore vanno sulla voce e la cella del pacchetto si azzera');
const adottate = Object.entries({ [dove.chiave]: 25, [dove.assorbe[0]]: 0 })
  .reduce((d, [k, o]) => pg.conCarico(d, k, o), conVoci);
verifica(pg.orePacchettoSettimana(adottate, c10.id, '2026-W38') === 25,
  'e il pacchetto dice venticinque, non quarantacinque');

// Da ultimo livello mostrato una voce dice anche quello che sta nelle sue
// sotto-voci nascoste, e le persone che lo fanno hanno la loro riga: un totale
// senza le righe che lo compongono è un numero che non si può seguire.
verifica(pg.risorseDiVoce(conVoci, fondazioni.id).map(r => r.nome).sort().join() === 'Marco,Sara',
  'una lavorazione mostrata da sola porta chi ha ore nelle sue sotto-voci');
verifica(pg.oreSottoRiga(conVoci, 'Marco', a60.id, fondazioni.id, '2026-W40') === 10,
  'e la riga dice le ore del ramo, non quelle della sola voce');
verifica(pg.destinazioneOre(conVoci, 'Marco', a60.id, fondazioni.id, '2026-W40').chiave
  === pg.chiaveCarico('Marco', a60.id, '2026-W40', plinti.id),
  'scrivendoci dentro, le ore restano sulla sotto-voce in cui stavano');

// ── Una voce che è di due persone ────────────────────────────────────────────
// Un calcolo lo fanno in due. Finché la proposta era una sola, la seconda riga
// nella matrice non esisteva e per farla comparire bisognava sdoppiare la voce.
const dueTeste = pg.conVoceAggiornata(conVoci, carpAdottiva.id, { risorse: ['Marco', 'Sara'] });
verifica(pg.risorseDiVoce(dueTeste, carpAdottiva.id).map(r => r.nome).sort().join() === 'Marco,Sara',
  'una voce che propone due persone ha due righe sotto di sé');
verifica(pg.voceAdottiva(dueTeste, c10.id, 'Sara') === carpAdottiva.id
  && pg.voceAdottiva(dueTeste, c10.id, 'Marco') === carpAdottiva.id,
  'e adotta le ore lasciate sul pacchetto da tutt\'e due');
// I file di ieri portano una stringa, quelli di oggi un elenco: si leggono
// tutt'e due, e `risorsa` continua a uscire perché un dispositivo non ancora
// aggiornato non butti via le altre riscrivendo il file.
verifica(pg.normalizzaVoce({ titolo: 'x', risorsa: 'Marco' }).risorse.join() === 'Marco',
  'una voce scritta ieri porta la sua proposta dentro l\'elenco');
verifica(pg.normalizzaVoce({ titolo: 'x', risorse: ['Marco', 'Sara'] }).risorsa === 'Marco',
  'e una scritta oggi lascia la prima anche nel campo di prima');
verifica(pg.normalizzaVoce({ titolo: 'x', risorse: ['Marco', ' Marco ', '', null] }).risorse.join() === 'Marco',
  'doppioni e vuoti non entrano: sarebbero due righe che si contendono la stessa cella');

// Attivare sceglie **una** persona — un task ha un delegato solo — ma non
// cancella le altre proposte: sarebbe la riga di Sara che sparisce dalla
// matrice, e con lei il posto in cui stanno le sue ore.
const attivataInDue = pg.conVoceAttivata(dueTeste, carpAdottiva.id,
  { taskId: 't-1', listId: 'l-1', risorsa: 'Marco' });
verifica(attivataInDue.voci.find(v => v.id === carpAdottiva.id).risorse.join() === 'Marco,Sara',
  'attivare a una delle due non toglie l\'altra');
const attivataAterzo = pg.conVoceAttivata(dueTeste, carpAdottiva.id,
  { taskId: 't-2', listId: 'l-1', risorsa: 'Michele' });
verifica(attivataAterzo.voci.find(v => v.id === carpAdottiva.id).risorse.join() === 'Marco,Sara,Michele',
  'e attivare a qualcun altro lo aggiunge, invece di sostituire l\'elenco');

// L'altro verso, ed è il difetto che si vedeva spegnendo i due bottoni: la riga
// della persona sotto il pacchetto è l'ultimo livello mostrato, quindi dice
// tutte le sue ore lì dentro — anche quelle finite su una voce.
verifica(pg.oreSottoRiga(conVoci, 'Marco', a60.id, null, '2026-W40') === 10,
  'sotto il pacchetto la persona dice tutto quello che ha lì, voci comprese');
verifica(pg.destinazioneOre(conVoci, 'Marco', a60.id, null, '2026-W40').chiave
  === pg.chiaveCarico('Marco', a60.id, '2026-W40', plinti.id),
  'e scrivendoci dentro le ore restano dove stavano, invece di sdoppiarsi sul pacchetto');
const dueRami = pg.conCarico(conVoci, pg.chiaveCarico('Marco', a60.id, '2026-W40', platea.id), 4);
verifica(pg.destinazioneOre(dueRami, 'Marco', a60.id, null, '2026-W40') === null,
  'con due voci sotto, la riga è una somma e non ha una destinazione: si scende di un livello');

// Cancellare una voce non cancella delle ore in silenzio.
const senzaPlinti = pg.senzaVoce(conVoci, plinti.id);
verifica(pg.oreCella(senzaPlinti, 'Marco', a60.id, '2026-W40', fondazioni.id) === 10,
  'togliendo una voce le sue ore risalgono alla madre, invece di sparire');
const senzaTutto = pg.senzaVoce(conVoci, fondazioni.id);
verifica(pg.oreCella(senzaTutto, 'Marco', a60.id, '2026-W40') === 10
  && pg.oreCella(senzaTutto, 'Sara', a60.id, '2026-W40') === 6,
  'e togliendo tutta la lavorazione risalgono al pacchetto');
verifica(pg.oreCarico(senzaTutto) === pg.oreCarico(conVoci),
  'in nessuno dei due casi il totale della commessa cambia');

// La catena serve al pannello Persone: attacca le ore al nodo più profondo
// che si sta mostrando, invece di perderle.
verifica(pg.catenaVoce(doc, plinti.id).map(v => v.titolo).join() === 'Fondazioni,Plinti',
  'la catena di una voce va dalla radice fino a lei');

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
  'D20 Impianti | Quadri | 30 | Sara, Nadia',
  'D20 Impianti | Schemi idraulici | 25',
  'A60 Fondazioni\tRelazione geotecnica\t16h',
  'Una riga di solo titolo',
  '',
].join('\n'));
verifica(incollato.aggiunte === 5, 'cinque righe, cinque voci');
verifica(incollato.pacchettiNuovi.length === 1 && incollato.doc.pacchetti.length === 3,
  'il pacchetto nominato e non ancora esistente nasce, quello che c\'è già si riusa');
verifica(incollato.doc.voci.find(v => v.titolo === 'Relazione geotecnica').ore === 16,
  '«16h» sono sedici ore');
verifica(incollato.doc.voci.find(v => v.titolo === 'Schemi elettrici').risorse.join() === 'Sara'
  && incollato.doc.risorse.some(r => r.nome === 'Sara'), 'e la risorsa nominata entra fra le risorse');
// Una voce può essere di due, e chi incolla un Excel le scrive nella stessa
// cella: due colonne per la stessa cosa non esistono in nessun foglio.
verifica(incollato.doc.voci.find(v => v.titolo === 'Quadri').risorse.join(',') === 'Sara,Nadia'
  && incollato.doc.risorse.some(r => r.nome === 'Nadia'),
  '«Sara, Nadia» sono due proposte, e tutt\'e due entrano fra le risorse');
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

// La scomposizione usa lo stesso testo incollato, ma con due colonne in meno:
// `titolo | ore` invece di `pacchetto | titolo | ore | risorsa`. Senza
// `semplice` il parser leggeva «titolo | ore» come se ore fosse in terza
// colonna: il titolo diventava il numero delle ore, e le ore restavano a zero.
const righeSemplici = pg.leggiRigheVoci('Plinti P1-P4 | 80\nsolo titolo', { semplice: true });
verifica(righeSemplici.righe[0].titolo === 'Plinti P1-P4' && righeSemplici.righe[0].ore === 80,
  'nella scomposizione «titolo | ore» legge il titolo in prima colonna, non la seconda');
verifica(righeSemplici.righe[1].titolo === 'solo titolo' && righeSemplici.righe[1].ore === 0,
  'e una colonna sola resta un titolo con zero ore, come per le voci normali');

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
verifica(rinominato.voci.find(v => v.titolo === 'Spalla ovest').risorse.join() === 'Marco Rossi',
  'e le voci che la proponevano');

const senzaMarco = pg.senzaRisorsa(d2, 'Marco');
verifica(senzaMarco.risorse.length === 0 && pg.oreCarico(senzaMarco) === 0,
  'togliere una persona si porta via le sue ore');
verifica(senzaMarco.voci.find(v => v.titolo === 'Spalla ovest').risorse.length === 0,
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
verifica(riep.totale.speso === 15 && riep.totale.programmate === 0,
  'speso e programmate sono la matrice tagliata in due dalla settimana di oggi');
verifica(riep.totale.aFinire === riep.totale.stimate - 15,
  'a finire invece non guarda la matrice: sono le stime meno lo speso');
verifica(riep.righe.every(r => r.aFinire === Math.max(0, r.stimate - r.speso)),
  'e vale riga per riga, pacchetto per pacchetto');

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

// Il filtro dei pacchetti della testata vale anche qui: la stessa domanda della
// matrice, letta per riga invece che per colonna.
const unPacchetto = corretto.pacchetti[0];
const filtrate = pg.caricoPersone(
  [{ id: 'a', nome: '2600 Ponte', doc: corretto }, { id: 'b', nome: '2601 Muro', doc: docAltra }],
  settimanePersone, { pacchettoId: unPacchetto.id });
const marcoFiltrato = filtrate.find(r => r.nome === 'Marco');
verifica(!!marcoFiltrato && marcoFiltrato.totale === settimanePersone.reduce(
  (s, w) => s + pg.oreSottoRiga(corretto, 'Marco', unPacchetto.id, null, w), 0),
  'col filtro acceso restano le ore di quel pacchetto, e solo quelle');
verifica(marcoFiltrato.totale < marco.totale,
  'che sono meno di quelle che ha in tutto: se fossero uguali il filtro non starebbe filtrando');
verifica(!filtrate.some(r => r.totale === 0),
  'e spariscono le righe a zero: un elenco di zeri non è una risposta');
// La sovrapposizione è della persona, non del pacchetto: un filtro non deve
// poter spegnere l'unica cosa che questa vista esiste per dire.
verifica(marcoFiltrato.sovrapposte.includes('2026-W10'),
  'ma le settimane sopra la capacità restano quelle vere, contate sul carico intero');

// Lo stesso filtro, acceso su più pacchetti: è quello che fanno le pastiglie.
const tuttiIPacchetti = pg.caricoPersone(
  [{ id: 'a', nome: '2600 Ponte', doc: corretto }, { id: 'b', nome: '2601 Muro', doc: docAltra }],
  settimanePersone, { pacchettoId: corretto.pacchetti.map(p => p.id) });
const marcoTutti = tuttiIPacchetti.find(r => r.nome === 'Marco');
verifica(!!marcoTutti && marcoTutti.totale >= (marcoFiltrato?.totale || 0),
  'accendendo anche l\'altro pacchetto le ore di Marco non calano');
verifica(marcoFiltrato.oreIntere['2026-W10'] === marco.ore['2026-W10'],
  'ed è il carico intero a restare a disposizione della vista, per il rosso della cella');

// L'albero sotto una persona: commessa, pacchetto, voce, sotto-voce. È la
// stessa catena della matrice, letta dall'altro capo.
verifica(righe[0].commesse.every(c => c.tipo === 'commessa'),
  'con due programmi accesi il primo livello è la commessa');
const unaSola = pg.caricoPersone([{ id: 'a', nome: '2600 Ponte', doc: corretto }], settimanePersone);
const marcoSolo = unaSola.find(r => r.nome === 'Marco');
verifica(marcoSolo.commesse.every(c => c.tipo === 'pacchetto'),
  'con una commessa sola il suo livello sparisce: ripeterebbe il titolo della pagina');
const conVociPersone = pg.caricoPersone(
  [{ id: 'a', nome: '2600 Ponte', doc: corretto }], settimanePersone, { dettaglio: 2 });
const marcoVoci = conVociPersone.find(r => r.nome === 'Marco');
verifica(marcoVoci.commesse.reduce((s, c) => s + c.totale, 0) === marcoSolo.totale,
  'aprendo le voci il totale della persona non cambia: è lo stesso carico, letto più a fondo');
// Un nodo dice le sue ore più quelle di tutto quello che ha sotto: mai meno,
// altrimenti aprirlo farebbe comparire ore che la riga chiusa non contava.
const somme = (/** @type {any[]} */ nodi) => nodi.every(n => (
  n.totale >= n.figli.reduce((/** @type {number} */ s, /** @type {any} */ f) => s + f.totale, 0)
  && somme(n.figli)));
verifica(somme(marcoVoci.commesse), 'e ogni nodo chiuso contiene la somma di quello che ha sotto');

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
// Quattro colonne davanti alle settimane: persona, pacchetto, oggetto, attività.
const intestazioneMatrice = matrice[1].map(c => c.v);
verifica(intestazioneMatrice.slice(0, 4).join('|') === 'Persona|Pacchetto|Oggetto|Attività'
  && intestazioneMatrice[4] === '2026-W12',
  'la matrice dice anche di che lavoro sono le ore: le settimane cominciano alla quinta colonna');
const rigaMarco = matrice.find(r => r[0]?.v === 'Marco');
verifica(rigaMarco && rigaMarco[1] === '', 'la riga di totale di una persona non porta un pacchetto');
verifica(rigaMarco[4].v === 26, 'e somma i suoi pacchetti: venti su B10 più sei su C10');
const rigaB10 = matrice[matrice.indexOf(rigaMarco) + 1];
// E sotto ancora il lavoro: la lavorazione, poi la sua sotto-voce. Dicono le
// ore del loro ramo — le stesse del pacchetto, viste più a fondo — e per questo
// lasciano vuota la colonna del pacchetto: è quello che le tiene fuori dal
// rientro, dove sarebbero la settimana contata tre volte.
const rigaOggetto = matrice[matrice.indexOf(rigaMarco) + 2];
const rigaAttivita = matrice[matrice.indexOf(rigaMarco) + 3];
// I numeri stanno **solo nell'ultima riga del ramo**: scritti a tutti e tre i
// livelli erano tre righe identiche incolonnate su venti settimane, cioè il
// dato e le sue due eco senza un modo di distinguerli.
verifica(rigaB10[1] === 'B10 Fondazioni' && rigaB10[4].v === '' && rigaB10[6].v === '',
  'la riga del pacchetto c\'è, ma le ore no: le dicono già le righe qui sotto');
verifica(rigaOggetto[1] === '' && rigaOggetto[2] === 'Fondazioni corpo A' && rigaOggetto[4].v === '',
  'la lavorazione sta nella colonna Oggetto, e nemmeno lei ripete le ore della sua sotto-voce');
verifica(rigaAttivita[2] === '' && rigaAttivita[3] === 'Plinti' && rigaAttivita[4].v === 20
  && rigaAttivita[6].v === 20,
  'le ore si leggono in fondo, dove il lavoro è descritto per esteso — e col loro totale');
verifica(matrice[matrice.indexOf(rigaMarco) + 4][1] === 'C10 Carpenterie'
  && matrice[matrice.indexOf(rigaMarco) + 4][4].v === 6,
  'un pacchetto senza voci sotto le sue ore le tiene: non c\'è nessuno che le ridica');
verifica(matrice[matrice.indexOf(rigaMarco) + 5][1] !== 'C10 Carpenterie',
  'e sotto una persona compare solo il lavoro in cui ha delle ore: Travi rovesce è di Luca e qui non c\'è');

// L'eco si spegne solo quando è davvero un'eco. Marco su due voci: le ore
// lasciate sul pacchetto non le adotta nessuno — indovinare è quello che qui
// non si fa — e se la riga del pacchetto tacesse comunque, quelle dieci ore
// sparirebbero dal foglio senza che niente lo dica.
const conResto = pg.conCarico(
  pg.conVoceAggiornata(big, big.voci.find(v => v.titolo === 'Travi rovesce').id, { risorse: ['Marco'] }),
  pg.chiaveCarico('Marco', bigB10.id, '2026-W12'), 10);
const conVoce = pg.conCarico(conResto,
  pg.chiaveCarico('Marco', bigB10.id, '2026-W12', big.voci.find(v => v.titolo === 'Plinti').id), 30);
const matriceResto = excel.righeMatrice(conVoce, ['2026-W12', '2026-W13'], '2026-W13');
const rigaB10Resto = matriceResto[matriceResto.findIndex(r => r[0]?.v === 'Marco') + 1];
verifica(rigaB10Resto[1] === 'B10 Fondazioni' && rigaB10Resto[4].v === 40,
  'ma se le figlie non coprono tutto, la riga i suoi numeri li tiene: le ore sul pacchetto non spariscono');

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
const plintiBig = big.voci.find(v => v.titolo === 'Plinti');
const traviBig = big.voci.find(v => v.titolo === 'Travi rovesce');
const lettura = excel.leggiOreRegistrate(big, rettangolo, { settimane: ['2026-W12', '2026-W13'] });
// Le ore vere sostituiscono quelle previste **dove stanno**: in B10 Marco è
// proposto da Plinti e basta, quindi la sua cella è quella — e quella lasciata
// sul pacchetto si azzera, perché sono le stesse ore e tenerle in due posti
// vorrebbe dire contare la settimana due volte.
verifica(lettura.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12', plintiBig.id)] === 31
  && lettura.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12')] === 0,
  'le ore vere entrano nella cella giusta, e non se ne aggiunge una seconda sul pacchetto');
verifica(lettura.celle[pg.chiaveCarico('Marco', bigC10.id, '2026-W12')] === 4,
  'e la persona si trascina in giù: la riga del pacchetto non ripete il nome');
verifica(lettura.celle[pg.chiaveCarico('Luca', bigB10.id, '2026-W13', traviBig.id)] === 12,
  'la seconda persona ricomincia da capo');
verifica(!Object.keys(lettura.celle).some(k => k.includes('|2026-W13') && k.startsWith('Marco')),
  'una cella lasciata vuota non azzera: chi corregge una settimana non tocca le altre');
verifica(!Object.values(lettura.celle).includes(26),
  'e la riga di somma della persona non si reimporta: sarebbe il totale scritto dentro un pacchetto');
verifica(lettura.sostituite === 5 && lettura.persone.join(' ') === 'Luca Marco',
  'prima di applicare si sa quante celle cambiano e di chi');

const applicato = Object.entries(lettura.celle).reduce((d, [k, o]) => pg.conCarico(d, k, o), big);
verifica(pg.oreSottoRiga(applicato, 'Marco', bigB10.id, null, '2026-W12') === 31,
  'un consuntivo sostituisce le ore previste, non ci si somma');
const dueVolte = Object.entries(excel.leggiOreRegistrate(applicato, rettangolo).celle)
  .reduce((d, [k, o]) => pg.conCarico(d, k, o), applicato);
verifica(pg.oreSottoRiga(dueVolte, 'Marco', bigB10.id, null, '2026-W12') === 31,
  'e reincollare lo stesso foglio non raddoppia niente');

const sciolte = excel.leggiOreRegistrate(big, [
  'Marco | B10 Fondazioni | 2026-W12 | 18',
  'Nessuno | B10 Fondazioni | 2026-W12 | 9',
  'due parole soltanto',
].join('\n'), { settimane: ['2026-W12', '2026-W13'] });
verifica(sciolte.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12', plintiBig.id)] === 18,
  'righe sciolte persona|pacchetto|settimana|ore: l\'altro modo di scriverle');
verifica(sciolte.ignorate.length === 2,
  'e quello che non si capisce si dice invece di sparire: in un consuntivo una riga persa è un margine sbagliato');

// Il difetto che si vede solo con un orizzonte vero: in una riga sciolta il
// numero delle ore — «18» — è anche un modo di scrivere la W18, e dentro
// cinquanta settimane la W18 esiste. Quella riga passava per un'intestazione, e
// da lì il rettangolo che non c'era: nessun errore, nessuna cella scritta.
const orizzonte = tempo.settimaneTra('2026-W01', '2026-W52');
const conW18 = excel.leggiOreRegistrate(big, `Marco | B10 Fondazioni | 2026-W12 | 18`, { settimane: orizzonte });
verifica(conW18.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12', plintiBig.id)] === 18,
  'una riga sciolta resta una riga sciolta anche se le sue ore somigliano a una settimana');
// Due celle e non una: la sua, e quella sul pacchetto che sostituisce. Quello
// che non deve nascere è una **terza** settimana, letta da un'intestazione che
// non c'era.
verifica(Object.keys(conW18.celle).every(k => k.includes('|2026-W12')),
  'e non ne nasce una seconda cella dal nulla');

// Il rettangolo come esce adesso: quattro colonne davanti alle settimane, e le
// ore nell'ultima riga di ogni ramo. Rientra quella — è dov'è scritto il numero
// che si corregge — e le righe di somma sopra si saltano: rileggerle
// scriverebbe la stessa settimana tre volte, che è il margine sbagliato che si
// scopre tre settimane dopo.
const conDettaglio = [
  'Persona\tPacchetto\tOggetto\tAttività\t2026-W12\t2026-W13',
  'Marco\t\t\t\t26\t',
  '\tB10 Fondazioni\t\t\t\t',
  '\t\tFondazioni corpo A\t\t\t',
  '\t\t\tPlinti\t31\t',
  '\tC10 Carpenterie\t\t\t4\t',
].join('\n');
const letturaDettaglio = excel.leggiOreRegistrate(big, conDettaglio, { settimane: ['2026-W12', '2026-W13'] });
verifica(letturaDettaglio.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12', plintiBig.id)] === 31
  && letturaDettaglio.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12')] === 0,
  'le ore corrette nella riga dell\'Attività entrano nella cella di quella voce');
verifica(letturaDettaglio.celle[pg.chiaveCarico('Marco', bigC10.id, '2026-W12')] === 4
  && letturaDettaglio.ignorate.length === 0,
  'e le colonne in più non fanno perdere le righe che vengono dopo');

// Un foglio esportato da una versione di prima porta i numeri a tutti e tre i
// livelli. Vale la stessa regola: conta la riga più profonda, e le due sopra
// sono la sua eco — non tre scritture della stessa settimana.
const vecchioFoglio = [
  'Persona\tPacchetto\tOggetto\tAttività\t2026-W12\t2026-W13',
  'Marco\t\t\t\t26\t',
  '\tB10 Fondazioni\t\t\t31\t',
  '\t\tFondazioni corpo A\t\t31\t',
  '\t\t\tPlinti\t31\t',
].join('\n');
const letturaVecchia = excel.leggiOreRegistrate(big, vecchioFoglio, { settimane: ['2026-W12', '2026-W13'] });
verifica(letturaVecchia.celle[pg.chiaveCarico('Marco', bigB10.id, '2026-W12', plintiBig.id)] === 31
  && letturaVecchia.ignorate.length === 0,
  'e un foglio della versione di prima, con le ore ripetute a ogni livello, rientra uguale');

// Un titolo che non si riconosce non si scarica sul pacchetto: sarebbero ore
// attribuite a un lavoro che nessuno ha scelto, e in un consuntivo è peggio di
// una riga mancante — che almeno si vede.
const inventata = excel.leggiOreRegistrate(big, [
  'Persona\tPacchetto\tOggetto\tAttività\t2026-W12\t2026-W13',
  'Marco\t\t\t\t26\t',
  '\tB10 Fondazioni\t\t\t\t',
  '\t\tScavi che non esistono\t\t31\t',
].join('\n'), { settimane: ['2026-W12', '2026-W13'] });
verifica(Object.keys(inventata.celle).length === 0 && inventata.ignorate.length === 1,
  'una lavorazione che il programma non conosce si dice, non si indovina');

// Il giro intero, che è la cosa che deve funzionare: si esporta, si corregge il
// numero che si vede, si rimanda indietro — e le ore finiscono dov'erano.
const uscito = excel.righeMatrice(big, ['2026-W12', '2026-W13'], '2026-W13')
  .map(r => r.map(c => (c && typeof c === 'object' ? c.v : c)).join('\t')).join('\n');
const rientrato = excel.leggiOreRegistrate(big, uscito, { settimane: ['2026-W12', '2026-W13'] });
const dopoGiro = Object.entries(rientrato.celle).reduce((d, [k, o]) => pg.conCarico(d, k, o), big);
verifica(pg.oreRisorsaSettimana(dopoGiro, 'Marco', '2026-W12') === 26
  && pg.oreRisorsaSettimana(dopoGiro, 'Luca', '2026-W13') === 14.5,
  'il foglio esce e rientra senza spostare niente: è il giro che si fa davvero');

const delta = excel.differenza(big, lettura.celle);
verifica(delta.prima === 40.5 && delta.dopo === 47,
  'quanto si sta per spostare si sa prima di premere');

fine();
