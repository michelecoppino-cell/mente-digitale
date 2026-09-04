// Prova di quello che sopravvive alla chiusura dell'app: la cache di query
// scritta su `localStorage`, e la domanda del mattino.
//
//   npm run prova-cache
//
// Due difetti che si vedevano solo dal telefono, e nessuna misura li diceva.
//
// Il primo: di tutta l'app, il **calendario** era l'unica cosa che alla
// riapertura non c'era mai. Il tetto sulla cache si difendeva buttando via le
// query più grosse, e le più grosse sono sempre le due finestre di eventi —
// ogni evento porta un id di Graph, un `webLink` e l'id del calendario, cioè
// stringhe da centinaia di caratteri. Adesso le finestre si potano ai giorni
// attorno a oggi invece di sparire, e la copia ridotta si dichiara vecchia.
//
// Il secondo: il pannello del mattino chiedeva più volte al giorno, perché
// l'unica cosa che diceva «l'ho già chiesto» era una riga di `localStorage`.
//
// Pure tutt'e due: `src/cachePersistenza.js` e `src/rituale.js` si importano
// così come sono, senza browser e senza rete.

import { creaTabellone } from './finto-onedrive.mjs';
import {
  GIORNI_AVANTI, GIORNI_INDIETRO, serializzaEntroIlBudget, snellisciCalendari,
} from '../src/cachePersistenza.js';
import { giaRisposto, giornoVuoto, pianoSalvataggio } from '../src/rituale.js';
import { spostaGiorni } from '../src/tempo.js';

const { verifica, fine } = creaTabellone();

const OGGI = '2026-09-04';

/** Un evento nella forma in cui arriva da Graph, con le stringhe lunghe che ha davvero. */
function evento(giorno, n) {
  return {
    id: 'AAMkAG' + String(n).padStart(4, '0') + 'x'.repeat(140),
    subject: `Appuntamento ${n}`,
    start: { dateTime: `${giorno}T09:00:00.0000000`, timeZone: 'UTC' },
    end:   { dateTime: `${giorno}T10:00:00.0000000`, timeZone: 'UTC' },
    isAllDay: false,
    webLink: 'https://outlook.office365.com/owa/?itemid=' + 'y'.repeat(180) + '&exvsurl=1',
    _calId: 'AQMkAD' + 'z'.repeat(120),
    _calName: 'Calendario',
    _calColor: 'auto',
    _isShared: false,
    _calMode: 'calendarView',
  };
}

/** Una query disidratata come la scrive TanStack. */
function query(chiave, dati, dataUpdatedAt = 1_000_000) {
  return { queryKey: [chiave], queryHash: `["${chiave}"]`, state: { data: dati, dataUpdatedAt, status: 'success' } };
}

/** Una finestra di eventi da `da` a `a` giorni rispetto a oggi, uno al giorno. */
function finestra(da, a) {
  const eventi = [];
  for (let i = da; i <= a; i++) eventi.push(evento(spostaGiorni(OGGI, i), i));
  return eventi;
}

console.log('\nLa finestra del calendario si pota, non sparisce\n');

{
  const stato = { queries: [query('calEventsBulk', finestra(-90, 90))] };
  const potato = snellisciCalendari(stato, OGGI);
  const tenuti = potato.queries[0].state.data;
  const giorni = tenuti.map(e => e.start.dateTime.slice(0, 10));

  verifica(tenuti.length === GIORNI_INDIETRO + GIORNI_AVANTI + 1,
    `restano i giorni attorno a oggi (${tenuti.length} su 181)`);
  verifica(giorni.includes(OGGI), 'oggi c\'è');
  verifica(giorni.includes(spostaGiorni(OGGI, 30)), 'e anche il mese prossimo');
  verifica(!giorni.includes(spostaGiorni(OGGI, 89)), 'tre mesi avanti no');
  verifica(!giorni.includes(spostaGiorni(OGGI, -89)), 'tre mesi indietro nemmeno');
  verifica(potato.queries[0].state.dataUpdatedAt === 0,
    'e la copia ridotta si dichiara vecchia, così la lettura vera parte comunque');
  verifica(stato.queries[0].state.data.length === 181,
    'la cache in memoria resta intera: si pota solo la copia da scrivere');
}

{
  // Un evento di cui non si capisce la data resta: buttare via quello che non
  // si è capito è il modo in cui le cose spariscono in silenzio.
  const strano = { id: 'x', subject: 'senza data' };
  const potato = snellisciCalendari({ queries: [query('calEventiSezioni', [strano, evento(spostaGiorni(OGGI, 200), 1)])] }, OGGI);
  verifica(potato.queries[0].state.data.length === 1
    && potato.queries[0].state.data[0].subject === 'senza data',
    'un evento senza data leggibile si tiene');
}

{
  // Una query che non è una finestra di eventi non si tocca, nemmeno se è
  // fatta di oggetti con dentro un `start`.
  const stato = { queries: [query('dailyPlans', { '2026-01-01': { blocks: [] } })] };
  const potato = snellisciCalendari(stato, OGGI);
  verifica(potato.queries[0].state.dataUpdatedAt === 1_000_000, 'il resto della cache resta com\'è');
}

console.log('\nIl calendario sta nel tetto insieme agli altri\n');

{
  // Il caso vero: due finestre di eventi (il Piano e i pannelli di sezione)
  // che da sole sfondano il tetto, più le query piccole che servono a dipingere
  // «Oggi». Prima il calendario era sempre il primo a essere buttato via.
  const stato = {
    queries: [
      query('calEventsBulk', finestra(-90, 90)),
      query('calEventiSezioni', finestra(-30, 540)),
      query('rituale', { [OGGI]: giornoVuoto() }),
      query('obiettivi', { mese: '2026-09' }),
      query('dailyPlans', { [OGGI]: { blocks: [{ id: 'b1', startTime: '09:00' }] } }),
    ],
  };
  const budget = 300_000;
  const json = serializzaEntroIlBudget(stato, OGGI, budget);
  const scritto = JSON.parse(json);
  const chiavi = scritto.clientState.queries.map(q => q.queryKey[0]);

  verifica(json.length <= budget, `quello che si scrive sta nel tetto (${json.length} ≤ ${budget})`);
  verifica(chiavi.includes('calEventsBulk') && chiavi.includes('calEventiSezioni'),
    'e le due finestre di eventi ci sono ancora tutt\'e due');
  verifica(chiavi.includes('rituale') && chiavi.includes('dailyPlans'),
    'insieme a quello che disegna «Oggi»');
}

{
  // Se anche potando non ci si sta, si torna a buttare via query intere — la
  // difesa vera è che `localStorage` non si riempia: dentro c'è anche l'account.
  const stato = { queries: [query('calEventsBulk', finestra(-14, 60)), query('pages', 'x'.repeat(50_000))] };
  const json = serializzaEntroIlBudget(stato, OGGI, 20_000);
  verifica(json.length <= 20_000, 'con un tetto che non basta si scrive comunque qualcosa che ci sta');
}

console.log('\nLa domanda del mattino si fa una volta al giorno\n');

{
  const doc = {};
  verifica(!giaRisposto(doc, OGGI), 'appena aperto il documento, la domanda va fatta');

  // Rispondere è salvare: quello che viene scritto è la prova che si è
  // risposto, e sta su OneDrive — quindi vale anche sull'altro dispositivo.
  const { giorni } = pianoSalvataggio({ [OGGI]: {} }, []);
  const dopo = { ...doc, ...giorni };
  verifica(giaRisposto(dopo, OGGI), 'dopo il salvataggio, no');
  verifica(!giaRisposto(dopo, spostaGiorni(OGGI, 1)), 'domani sì, di nuovo');

  // I giorni tappati dall'app non sono una risposta: sono un «non fatto»
  // messo lì per essere corretto.
  const tappato = { [OGGI]: giornoVuoto(true) };
  verifica(!giaRisposto(tappato, OGGI), 'un giorno compilato dall\'app non conta come risposta');

  verifica(!giaRisposto(null, OGGI), 'e senza documento non si dà niente per risposto');
}

fine();
