// Prova del briefing del mattino (src/briefing.js).
//
//   npm run prova-briefing
//
// È il modulo su cui gira la scheda «Briefing» e che il CLI usa per scrivere il
// documento: puro, senza rete, quindi si prova per intero. Le cose che questa
// prova esiste per non far succedere sono tre, e sono tutte cose che a schermo
// non si vedrebbero:
//
//  - un briefing di ieri che si legge come quello di stamattina;
//  - una proposta approvata che finisce sopra una riunione già in calendario;
//  - un documento scritto da una versione vecchia che fa sparire la scheda
//    invece di mostrare quello che c'è.

import { importaModulo, creaTabellone } from './finto-onedrive.mjs';

const { verifica, fine } = creaTabellone();
const {
  normalizzaBriefing, etaBriefing, eDelGiorno, contaProposte, conEsito,
  primaOraLibera, bloccoDaProposta, quantoCE, inOra, inMinuti,
  VERSIONE_BRIEFING, AREE_NOTIZIE, AREE_CURIOSITA,
} = await importaModulo('briefing.js');

/** @param {object} campi */
const doc = campi => normalizzaBriefing({
  version: VERSIONE_BRIEFING,
  data: '2026-09-15',
  scrittoIl: '2026-09-15T05:00:00.000Z',
  giornata: 'Due riunioni e il plinto da chiudere.',
  ...campi,
});

console.log('\nLa forma del documento\n');

{
  const d = doc({
    proposte: [{ titolo: 'Mail ad Alfio', perche: 'sblocca ABS', ora: '09:00', durataMin: 120 }],
    notizie: { mondo: ['una'], friuli: ['due'] },
    curiosita: { professionali: ['tre'] },
    recap: ['ieri è rimasta indietro la A60'],
  });
  verifica(d?.proposte[0].id === 'p1', 'una proposta senza id ne prende uno dalla sua posizione');
  verifica(d?.proposte[0].esito === null, 'e nasce senza esito: niente è già deciso');
  verifica(d?.notizie.europa.length === 0 && d?.notizie.friuli.length === 1,
    "le quattro aree ci sono sempre, anche quando una è vuota");
  verifica(d?.curiosita.riflessioni.length === 0, 'e così le due metà delle curiosità');
  verifica(AREE_NOTIZIE.length === 4 && AREE_CURIOSITA.length === 2,
    'le aree sono dichiarate una volta sola, e la vista le legge da lì');
}

{
  const d = doc({ proposte: [{ titolo: 'Senza ora', perche: 'perché sì', ora: '25:00', durataMin: -5 }] });
  verifica(d?.proposte[0].ora === '', "un'ora impossibile diventa nessun'ora invece di finire a schermo");
  verifica(d?.proposte[0].durataMin === 30, 'e una durata assurda ricade sulla mezz\'ora');
}

{
  // La forma vecchia: il briefing era un paragrafo solo, senza sezioni. Deve
  // diventare un briefing con dentro quella prosa, non una schermata vuota.
  const vecchio = normalizzaBriefing({ version: 1, data: '2026-09-15', testo: 'Il recap di una volta.' });
  verifica(vecchio?.giornata === 'Il recap di una volta.', 'un documento della versione di prima si legge lo stesso');
  verifica(vecchio?.proposte.length === 0 && vecchio?.notizie.mondo.length === 0,
    'con le sezioni nuove vuote, invece che assenti');
}

{
  verifica(normalizzaBriefing(null) === null, 'niente non è un briefing');
  verifica(normalizzaBriefing({ data: '2026-09-15' }) === null,
    'e nemmeno un documento senza niente dentro: mostrarlo darebbe una schermata che sembra funzionante');
}

console.log('\nDi che giorno è\n');

{
  const d = doc({});
  verifica(eDelGiorno(d, '2026-09-15') === true, 'il briefing di oggi è di oggi');
  verifica(eDelGiorno(d, '2026-09-16') === false, 'quello di ieri no, e la vista lo dirà');
  verifica(eDelGiorno(null, '2026-09-15') === false, 'e senza documento non si finge di averne uno');

  const adesso = new Date('2026-09-15T08:00:00.000Z');
  const eta = etaBriefing(d, adesso);
  verifica(eta?.ore === 3 && eta.vecchio === false, 'tre ore dopo è ancora quello di stamattina');
  verifica(etaBriefing(d, new Date('2026-09-16T02:00:00.000Z'))?.vecchio === true,
    'ventun ore dopo è vecchio, e lo dice');
  verifica(etaBriefing({ scrittoIl: 'ieri mattina' }) === null,
    'una data che non è una data non diventa un numero di ore inventato');
}

console.log('\nApprovare e scartare\n');

{
  const d = doc({
    proposte: [
      { titolo: 'Prima', perche: 'a' },
      { titolo: 'Seconda', perche: 'b' },
      { titolo: 'Terza', perche: 'c' },
    ],
  });
  verifica(contaProposte(d).aperte.length === 3, 'all\'inizio sono tutte da decidere');

  const dopo = conEsito(/** @type {any} */ (d), 'p2', 'scartata', new Date('2026-09-15T07:30:00.000Z'));
  verifica(contaProposte(dopo).scartate === 1 && contaProposte(dopo).aperte.length === 2,
    'scartarne una la toglie dal conto di quelle aperte');
  verifica(dopo.proposte[1].esitoIl === '2026-09-15T07:30:00.000Z', 'e resta scritto quando');
  verifica(d?.proposte[1].esito === null,
    'il documento di partenza non è stato toccato: la funzione è pura, e chi chiama decide se salvare');

  const rimessa = conEsito(dopo, 'p2', null);
  verifica(contaProposte(rimessa).aperte.length === 3, 'e annullare la rimette in gioco');
  verifica(rimessa.proposte[1].esitoIl === null, 'senza lasciarsi dietro la data della decisione');
}

console.log('\nDove finisce una proposta approvata\n');

// La giornata come si presenta davvero: due cose già a piano, e i buchi in
// mezzo. Approvare deve incastrarsi lì, non passarci sopra.
const giornata = [
  { startTime: '09:00', endTime: '10:30' },
  { startTime: '14:00', endTime: '15:00' },
];

{
  verifica(primaOraLibera(giornata, '11:00', 60) === '11:00', 'un\'ora libera resta quella proposta');
  verifica(primaOraLibera(giornata, '09:30', 60) === '10:30',
    'un\'ora occupata scende al primo buco: chi approva vuole la cosa nella giornata, non a quell\'ora esatta');
  verifica(primaOraLibera(giornata, '13:30', 60) === '15:00',
    'e scavalca il blocco che incontra, invece di accavallarcisi');
  verifica(primaOraLibera([], '09:00', 30) === '09:00', 'in una giornata vuota non c\'è niente da scansare');
  verifica(primaOraLibera(giornata, '21:30', 60) === null,
    'e quando nella giornata non ci sta più, lo dice invece di metterla a mezzanotte');
  verifica(primaOraLibera(giornata, '', 30) === '10:30',
    'una proposta senza ora parte dalle nove e trova il primo posto buono');
}

{
  const blocco = bloccoDaProposta(
    { id: 'p1', titolo: 'Mail ad Alfio', attivita: 't-a1', lista: 'Fondazioni', ora: '09:00', durataMin: 90, perche: 'x', esito: null, esitoIl: null },
    '11:00', 'blk-1',
  );
  verifica(blocco.startTime === '11:00' && blocco.endTime === '12:30', 'il blocco dura quanto dice la proposta');
  verifica(blocco.taskId === 't-a1', 'e cita l\'attività vera, così spuntarla da «Oggi» chiude anche il task');
  verifica(blocco.taskTitle === 'Mail ad Alfio' && blocco.listName === 'Fondazioni',
    'titolo e lista si copiano adesso, come fa il Piano: il blocco è lo storico della giornata');
  verifica(blocco.completed === false && blocco.subSteps.length === 0,
    'e nasce da fare, come qualunque altro blocco');

  const senzaAttivita = bloccoDaProposta(
    { id: 'p2', titolo: 'Una cosa nuova', attivita: null, lista: null, ora: '', durataMin: 30, perche: 'x', esito: null, esitoIl: null },
    '16:00', 'blk-2',
  );
  verifica(senzaAttivita.taskId === null, 'una proposta senza attività dietro fa un blocco senza task, e va bene così');
}

console.log('\nI conti in una riga\n');

{
  const d = doc({
    proposte: [{ titolo: 'a', perche: 'b' }],
    notizie: { mondo: ['1', '2'], italia: ['3'] },
    curiosita: { professionali: ['4'], riflessioni: ['5'] },
  });
  const q = quantoCE(d);
  verifica(q.notizie === 3 && q.curiosita === 2 && q.proposte === 1, 'si sa quanto c\'è da leggere senza aprire tutto');
  verifica(inOra(inMinuti('07:45')) === '07:45', 'le ore vanno e tornano senza perdersi per strada');
}

fine();
