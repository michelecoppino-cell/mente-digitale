// Prova delle operazioni che scrivono da fuori l'app (`scripts/mente-comandi.mjs`),
// contro un OneDrive finto in memoria.
//
//   npm run prova-comandi
//
// Le altre prove guardano i moduli puri (il flusso, il Programma, la cattura) o
// il trasporto (il connettore remoto). Questa guarda le tre scritture che
// toccano insieme le attività e il piano del giorno, dove il difetto non è un
// conto sbagliato ma **due verità per la stessa cosa**:
//
//  - correggere un titolo e lasciarlo vecchio dentro il blocco già a piano;
//  - buttare via un'attività e lasciarle addosso l'ora che aveva;
//  - comporre una giornata scavalcando una riunione, o scrivendola invece di
//    proporla.
//
// Sono tutte cose che, contro il OneDrive vero, si scoprirebbero guardando il
// Piano il giorno dopo.

import { montaFintoOnedrive, creaTabellone } from './finto-onedrive.mjs';
import { montaFintoGraph } from '../src/finto/graph.js';
import * as mente from './mente-comandi.mjs';
import { impostaArchivioToken, loadDailyPlans, saveDailyPlans } from './mente-graph.mjs';

const { verifica, fine } = creaTabellone();

// ── La scena ─────────────────────────────────────────────────────────────────

const finto = montaFintoOnedrive();
montaFintoGraph(finto);   // liste, attività, piani e calendario già dentro

finto.aggiungiRotta((url, opzioni, risposta) => {
  if (!url.includes('login.microsoftonline.com')) return null;
  return risposta(200, {
    access_token: 'finto-access-token',
    refresh_token: 'finto-refresh-token',
    expires_in: 3600,
  });
});

// Il token in memoria: qui non c'è un disco da toccare, e non serve.
impostaArchivioToken({ leggi: () => 'finto-refresh-token', scrivi: () => {} });

const PIANI = 'mente-digitale-daily-plans.json';
/** @param {string} giorno */
const blocchiDi = giorno => finto.contenuto(PIANI)[giorno]?.blocks || [];
/** @param {string} rel */
const file = rel => finto.contenuto(`task/${rel}`);

const g = (/** @type {number} */ quanti) => {
  const d = new Date();
  d.setDate(d.getDate() + quanti);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const oggi = g(0);

// ── La bozza della giornata ──────────────────────────────────────────────────
// Prima di ogni scrittura, perché è lo strumento che non deve scrivere: se
// scrivesse, tutto quello che viene dopo partirebbe da uno stato diverso e la
// prova lo direbbe.

console.log('\nLa bozza della giornata\n');

const primaDeiPiani = JSON.stringify(finto.contenuto(PIANI));
const bozza = await mente.pianoAuto({ data: oggi, dalle: '09:00', alle: '18:00' });

verifica(JSON.stringify(finto.contenuto(PIANI)) === primaDeiPiani,
  'comporre una giornata non scrive niente: i piani su OneDrive sono quelli di prima');
verifica(bozza.data.scritto === false && /Niente è stato scritto/.test(bozza.text),
  'e lo dice a chiare lettere, così nessuno la scambia per un piano fatto');

const proposte = bozza.data.bozza;
verifica(proposte.length > 0, 'qualcosa da proporre c\'è');

// Le ore già impegnate: i blocchi del piano e gli eventi del calendario. Chi
// compone una giornata deve vederli tutti e due.
const daPiano = blocchiDi(oggi).map((/** @type {any} */ b) => b.startTime);
verifica(
  bozza.data.occupato.some((/** @type {any} */ o) => daPiano.includes(o.dalle)),
  'quello che è già a piano risulta occupato'
);
verifica(
  bozza.data.occupato.some((/** @type {any} */ o) => /Sopralluogo|Call/.test(o.cosa)),
  'e anche le riunioni sul calendario'
);

/** @param {string} hhmm */
const min = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const scavalca = proposte.some((/** @type {any} */ p) =>
  bozza.data.occupato.some((/** @type {any} */ o) => min(p.ora) < min(o.alle) && min(o.dalle) < min(p.fine)));
verifica(!scavalca, 'e nessuna proposta ci finisce sopra');
verifica(
  proposte.every((/** @type {any} */ p) => min(p.ora) >= min('09:00') && min(p.fine) <= min('18:00')),
  'tutto sta dentro la finestra chiesta'
);

// Un'attività che ha già la sua ora non si ripropone: il suo stato è
// «programmata», e le prossime azioni sono un'altra colonna.
verifica(
  !proposte.some((/** @type {any} */ p) => blocchiDi(oggi).some((/** @type {any} */ b) => b.taskId === p.id)),
  'quello che è già a piano non viene riproposto'
);

// Il buco corto viene riempito da chi ci sta, anche se in ordine verrebbe dopo:
// mezz'ora libera è mezz'ora, e lasciarla vuota per rispetto dell'ordine non
// aiuta nessuno.
const corto = bozza.data.liberi.find((/** @type {any} */ b) => b.minuti === 30);
if (corto) {
  verifica(
    proposte.some((/** @type {any} */ p) => p.ora === corto.dalle && p.durataMin <= 30),
    'un buco corto lo prende la prima attività che ci sta, non la prima in elenco'
  );
}

{
  const solo2573 = await mente.pianoAuto({ data: oggi, sezione: '2573' });
  verifica(
    solo2573.data.bozza.every((/** @type {any} */ p) => /2573/.test(p.lista)),
    'con una sezione si pesca solo da lì'
  );
  const conMassimo = await mente.pianoAuto({ data: oggi, massimo: 1 });
  verifica(conMassimo.data.bozza.length <= 1, 'e «massimo» ferma il conto');
}

{
  let errore = null;
  try { await mente.pianoAuto({ data: oggi, dalle: '14:00', alle: '09:00' }); }
  catch (e) { errore = e; }
  verifica(Boolean(errore), 'una finestra al contrario è un errore, non una giornata vuota');
}

// ── Correggere la scheda di un'attività ──────────────────────────────────────

console.log('\nCorreggere un\'attività\n');

{
  const prima = blocchiDi(oggi).find((/** @type {any} */ b) => b.taskId === 't-a1');
  verifica(Boolean(prima), 'l\'attività da correggere ha un blocco nel piano');

  const esito = await mente.attivitaModifica({
    attivita: 't-a1',
    titolo: 'Verifica a punzonamento plinto P4',
    stimaMin: 75,
  });
  verifica(esito.data.id === 't-a1', 'correggere non rigenera l\'id');

  const task = file('2573-a60.json').tasks.find((/** @type {any} */ t) => t.id === 't-a1');
  verifica(task.titolo === 'Verifica a punzonamento plinto P4', 'il titolo nuovo è nel file');
  verifica(task.stimaMin === 75, 'e la stima pure');

  const dopo = blocchiDi(oggi).find((/** @type {any} */ b) => b.taskId === 't-a1');
  verifica(dopo.taskTitle === 'Verifica a punzonamento plinto P4',
    'e il blocco nel piano non racconta più il titolo di prima');
  verifica(dopo.startTime === prima.startTime && dopo.endTime === prima.endTime,
    'senza che il blocco cambi ora: correggere un titolo non è rifare il piano');
}

{
  // Un campo detto vuoto si toglie; uno non nominato resta. Sono due cose
  // diverse, ed è la differenza fra correggere e perdere un dato.
  const con = file('casa.json').tasks.find((/** @type {any} */ t) => t.id === 't-c2');
  verifica(Boolean(con.scadenza), 'l\'attività di partenza una scadenza ce l\'ha');
  await mente.attivitaModifica({ attivita: 't-c2', scadenza: '' });
  const senza = file('casa.json').tasks.find((/** @type {any} */ t) => t.id === 't-c2');
  verifica(senza.scadenza === null, 'una scadenza detta vuota si toglie');
  verifica(senza.titolo === con.titolo && senza.contesto === con.contesto,
    'e quello che non è stato nominato resta com\'era');
}

{
  // Cambiare sezione è uno spostamento vero: stesso id, altra lista, e il
  // blocco già a piano continua a indicare il task giusto.
  await mente.attivitaModifica({ attivita: 't-c2', sezione: '2573.C10' });
  verifica(
    !file('casa.json').tasks.some((/** @type {any} */ t) => t.id === 't-c2'),
    'l\'attività lascia la sezione di prima'
  );
  const arrivata = file('2573-c10.json').tasks.find((/** @type {any} */ t) => t.id === 't-c2');
  verifica(Boolean(arrivata), 'e arriva in quella nuova con lo stesso id');
}

{
  let errore = null;
  try { await mente.attivitaModifica({ attivita: 't-b1', contesto: 'sottacqua' }); }
  catch (e) { errore = e; }
  verifica(Boolean(errore), 'un contesto inventato è un errore');

  let vuoto = null;
  try { await mente.attivitaModifica({ attivita: 't-b1' }); }
  catch (e) { vuoto = e; }
  verifica(Boolean(vuoto), 'e una modifica che non modifica niente lo dice invece di fingere');

  const invariata = await mente.attivitaModifica({ attivita: 't-b1', stimaMin: 60 });
  verifica(invariata.data.invariata === true, 'riscrivere lo stesso valore non è un cambiamento');
}

// ── Buttare via ──────────────────────────────────────────────────────────────

console.log('\nButtare via, senza cancellare\n');

{
  let errore = null;
  try { await mente.attivitaElimina({ attivita: 't-b3' }); }
  catch (e) { errore = e; }
  verifica(Boolean(errore), 'senza conferma non si butta via niente');
  verifica(
    file('2573-c10.json').tasks.some((/** @type {any} */ t) => t.id === 't-b3'),
    'e l\'attività è ancora dov\'era'
  );
}

{
  const esito = await mente.attivitaElimina({ attivita: 't-b3', conferma: true });
  verifica(esito.data.da.stato === 'someday', 'la risposta dice lo stato che l\'attività aveva');

  const registro = finto.contenuto('task/_liste.json');
  const cestino = registro.liste.find((/** @type {any} */ l) => l.nome === mente.NOME_CESTINO);
  verifica(Boolean(cestino), 'il Cestino nasce alla prima cosa buttata');
  const dentro = finto.contenuto(cestino.file).tasks;
  verifica(dentro.some((/** @type {any} */ t) => t.id === 't-b3'), 'e ci si ritrova dentro l\'attività, con il suo id');
  verifica(
    !file('2573-c10.json').tasks.some((/** @type {any} */ t) => t.id === 't-b3'),
    'fuori dalla sezione in cui stava'
  );

  let ancora = null;
  try { await mente.attivitaElimina({ attivita: 't-b3', conferma: true }); }
  catch (e) { ancora = e; }
  verifica(Boolean(ancora), 'quello che è già nel Cestino non ci si butta due volte');
}

{
  // Un'attività buttata via non deve lasciare in giro l'ora che aveva — ma
  // quello che è già stato fatto resta scritto: il piano di un giorno passato
  // è il registro di com'è andata.
  const piani = await loadDailyPlans();
  piani[g(-1)] = {
    date: g(-1),
    blocks: [{
      id: 'b-ieri', taskId: 't-c1', listId: 'l-casa', taskTitle: 'Preventivo caldaia',
      startTime: '09:00', endTime: '09:30', completed: true, completedAt: `${g(-1)}T09:30:00`,
      subSteps: [],
    }],
  };
  await saveDailyPlans(piani);

  const esito = await mente.attivitaElimina({ attivita: 't-c1', conferma: true });
  verifica(esito.data.blocchiTolti.length === 1, 'buttandola via le si toglie l\'ora che aveva');
  verifica(
    !blocchiDi(oggi).some((/** @type {any} */ b) => b.taskId === 't-c1'),
    'il blocco aperto sparisce dal piano'
  );
  verifica(
    blocchiDi(g(-1)).some((/** @type {any} */ b) => b.taskId === 't-c1' && b.completed),
    'quello già spuntato resta: è lavoro fatto, non un\'intenzione da ripulire'
  );

  const buttata = finto.contenuto(
    finto.contenuto('task/_liste.json').liste.find((/** @type {any} */ l) => l.nome === mente.NOME_CESTINO).file
  ).tasks.find((/** @type {any} */ t) => t.id === 't-c1');
  verifica(buttata.stato === 'someday' && buttata.completatoIl === null,
    'e nel Cestino non è né una prossima azione né una cosa fatta');
}

{
  // Rimetterla a posto non vuole uno strumento suo: è la stessa modifica di
  // sempre, con la sezione di prima.
  await mente.attivitaModifica({ attivita: 't-c1', sezione: 'Casa' });
  verifica(
    file('casa.json').tasks.some((/** @type {any} */ t) => t.id === 't-c1'),
    'dal Cestino si torna indietro con attivita_modifica, e l\'id è sempre quello'
  );
}

fine();
