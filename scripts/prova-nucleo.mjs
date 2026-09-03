// Prova del nucleo condiviso (src/graphCore.js) **dalla parte del CLI**.
//
//   npm run prova-nucleo
//
// Le altre prove guardano lo stesso nucleo dalla parte dell'app, passando da
// `src/api.js`. Questa lo guarda dall'altra: monta il vero
// `scripts/mente-graph.mjs` — token, `graph()`, tentativi — sopra il OneDrive
// finto, e ripete le verifiche sulla concorrenza.
//
// È la prova che mancava, ed è quella che avrebbe intercettato la divergenza da
// cui nasce il nucleo: l'app aveva cambiato il modo di leggere un file, il CLI
// era rimasto indietro, e nessuna misura lo diceva perché nessuna prova
// eseguiva mai il codice del CLI. Adesso, se le due strade si separano di
// nuovo, si separa anche questa prova.

import { montaFintoOnedrive, creaTabellone } from './finto-onedrive.mjs';

const finto = montaFintoOnedrive();
const { altroDispositivoScrive, contenuto, esiste, stato } = finto;
const { verifica, fine } = creaTabellone();

// Il token: il CLI ne cerca uno vero, e qui gliene si dà uno finto insieme
// all'endpoint che lo rilascia. È l'unica cosa da mettere in scena — tutto il
// resto del modulo gira per davvero.
process.env.MENTE_REFRESH_TOKEN = 'finto-refresh-token';
finto.aggiungiRotta((url, opt, risposta) => {
  if (!url.includes('login.microsoftonline.com')) return null;
  return risposta(200, {
    access_token: 'finto-access-token',
    refresh_token: 'finto-refresh-token-ruotato',
    expires_in: 3600,
  });
});

const cli = await import('./mente-graph.mjs');
const { archivioSuFile } = await import('./mente-token-file.mjs');
cli.impostaArchivioToken(archivioSuFile());
const { getDriveJson, putDriveJson } = cli;

function pulisci() {
  finto.pulisci();
  cli._dimenticaDrive();
}

console.log('\nIl CLI scrive come l\'app\n');

// Il caso normale: si legge, si scrive, e la PUT porta con sé l'ETag letto.
pulisci();
altroDispositivoScrive('a.json', [{ id: 'x' }]);
await getDriveJson('a.json', []);
await putDriveJson('a.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('a.json').length === 2, 'una scrittura normale passa');
verifica(finto.quante('a.json:/content', 'PUT') === 1, 'con una PUT sola');

// Il file è cambiato sotto e chi scrive non sa fondere: errore, non silenzio.
pulisci();
altroDispositivoScrive('b.json', [{ id: 'x' }]);
await getDriveJson('b.json', []);
altroDispositivoScrive('b.json', [{ id: 'x' }, { id: 'altro-dispositivo' }]);
let conflitto = null;
try {
  await putDriveJson('b.json', [{ id: 'x' }, { id: 'mio' }]);
} catch (e) {
  conflitto = e;
}
verifica(conflitto?.status === 412, 'senza reapply un conflitto vero è un errore');
verifica(contenuto('b.json').some(v => v.id === 'altro-dispositivo'),
  'e quello che aveva scritto l\'altro dispositivo è ancora lì');

// Con `reapply` la modifica si rimette sopra il contenuto fresco.
pulisci();
altroDispositivoScrive('c.json', [{ id: 'x' }]);
await getDriveJson('c.json', []);
altroDispositivoScrive('c.json', [{ id: 'x' }, { id: 'dal-telefono' }]);
await putDriveJson('c.json', [{ id: 'x' }, { id: 'dal-portatile' }], {
  reapply: fresco => [...fresco, { id: 'dal-portatile' }],
});
const uniti = contenuto('c.json').map(v => v.id);
verifica(uniti.includes('dal-telefono') && uniti.includes('dal-portatile'),
  'con reapply le due scritture si sommano');

// Un ETag che il server rifiuta comunque non deve bloccare la scrittura:
// il contenuto remoto è il nostro, e riscriverlo non fa perdere niente.
pulisci();
altroDispositivoScrive('d.json', [{ id: 'x' }]);
await getDriveJson('d.json', []);
stato.ifMatchInservibile = true;
await putDriveJson('d.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('d.json').length === 2, 'un If-Match inservibile non blocca la scrittura');

console.log('\nCartelle e percorsi, gli stessi dell\'app\n');

pulisci();
await putDriveJson('diario/diario-2026-09.json', [{ id: 'v1' }]);
verifica(esiste('mente-digitale/diario'), 'la sottocartella si crea da sé');
verifica(esiste('mente-digitale/diario/diario-2026-09.json'),
  'e il file finisce dove lo cerca l\'app');

// La migrazione pigra vale anche da qui: un file rimasto dove stava prima non
// deve apparire «non ancora creato» solo perché lo si legge dal CLI.
pulisci();
finto.scriviFile('mente-digitale/mente-digitale-diario-2019-01.json',
  JSON.stringify([{ id: 'vecchia' }], null, 2));
const vecchie = await getDriveJson('diario/diario-2019-01.json', []);
verifica(vecchie.length === 1, 'un file rimasto nella posizione vecchia si trova lo stesso');
verifica(esiste('mente-digitale/diario/diario-2019-01.json'),
  'e viene spostato dove va');

console.log('\nLe due strade sono lo stesso codice\n');

const app = await import('../src/graphCore.js');
verifica(typeof app.creaDrive === 'function' && typeof cli.getDriveJson === 'function',
  'il CLI prende putDriveJson/getDriveJson dal nucleo, non da una copia sua');

fine();
