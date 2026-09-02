// Prova dello strato OneDrive di src/api.js: concorrenza (ETag e If-Match) e
// disposizione dei file in cartelle, con la migrazione da dove stavano prima.
//
//   npm run prova-onedrive
//
// L'OneDrive finto e il caricamento dei moduli veri stanno in finto-onedrive.mjs.

import { montaFintoOnedrive, importaModulo, creaTabellone } from './finto-onedrive.mjs';

const finto = montaFintoOnedrive();
const { scriviFile, altroDispositivoScrive, contenuto, esiste, stato } = finto;
const { verifica, fine } = creaTabellone();

const {
  putDriveJson, getDriveJson, migrateLegacyDriveFiles,
  loadDiaryMonth, saveDiaryEntry,
  _dimenticaDrive,
} = await importaModulo('api.js');

function pulisci() {
  finto.pulisci();
  _dimenticaDrive();
}

console.log('\nConcorrenza\n');

// Il caso normale: si legge, si scrive, la PUT porta con sé l'ETag letto.
pulisci();
altroDispositivoScrive('a.json', [{ id: 'x' }]);
await getDriveJson('a.json', []);
await putDriveJson('a.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('a.json').length === 2, 'scrittura senza conflitti');

// Conflitto su un documento che non si sa fondere: l'errore sale, e soprattutto
// quello che aveva scritto l'altro dispositivo è ancora lì.
pulisci();
altroDispositivoScrive('b.json', { a: 1 });
await getDriveJson('b.json', null);
altroDispositivoScrive('b.json', { a: 1, telefono: true });
let errore = null;
try { await putDriveJson('b.json', { a: 1, portatile: true }); } catch (e) { errore = e; }
verifica(errore?.status === 412 && errore.conflict === true, 'conflitto non fondibile: errore 412');
verifica(contenuto('b.json').telefono === true && !contenuto('b.json').portatile,
  'conflitto non fondibile: il lavoro dell\'altro dispositivo resta');

// Conflitto su un documento che si sa fondere: le due scritture convivono.
pulisci();
altroDispositivoScrive('c.json', [{ id: 'x' }]);
await getDriveJson('c.json', []);
altroDispositivoScrive('c.json', [{ id: 'x' }, { id: 'dal-telefono' }]);
await putDriveJson('c.json', [{ id: 'x' }, { id: 'dal-portatile' }], {
  reapply: fresco => [...fresco, { id: 'dal-portatile' }],
});
verifica(contenuto('c.json').map(v => v.id).join(',') === 'x,dal-telefono,dal-portatile',
  'conflitto fondibile: la modifica si riapplica sul contenuto fresco');

// Se il GET del contenuto non espone l'header ETag — passa per un redirect a un
// URL di download, non è detto che lo esponga — il conflitto si vede lo stesso,
// confrontando il contenuto remoto con la base da cui eravamo partiti.
pulisci(); stato.esponeEtag = false;
altroDispositivoScrive('d.json', [{ id: 'x' }]);
await getDriveJson('d.json', []);
altroDispositivoScrive('d.json', [{ id: 'x' }, { id: 'dal-telefono' }]);
errore = null;
try { await putDriveJson('d.json', [{ id: 'x' }, { id: 'mio' }]); } catch (e) { errore = e; }
verifica(errore?.status === 412, 'senza header ETag il conflitto si vede comunque');
verifica(contenuto('d.json')[1].id === 'dal-telefono', 'senza header ETag: niente sovrascrittura');

pulisci(); stato.esponeEtag = false;
altroDispositivoScrive('e.json', [{ id: 'x' }]);
await getDriveJson('e.json', []);
await putDriveJson('e.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('e.json').length === 2, 'senza header ETag e senza conflitto si scrive lo stesso');

// Se il server rifiutasse qualunque If-Match (tag di natura diversa da quella
// che si aspetta), i salvataggi non devono bloccarsi: il contenuto remoto è
// stato appena riletto ed è il nostro, quindi riscrivere non toglie niente a
// nessuno.
pulisci(); stato.ifMatchInservibile = true;
altroDispositivoScrive('f.json', [{ id: 'x' }]);
await getDriveJson('f.json', []);
await putDriveJson('f.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('f.json').length === 2, 'If-Match inservibile: la scrittura non si blocca');

// File che non esiste ancora: si crea, senza precondizioni.
pulisci();
verifica(JSON.stringify(await getDriveJson('g.json', [])) === '[]', 'file assente: torna il valore di riserva');
await putDriveJson('g.json', [{ id: 'x' }]);
verifica(contenuto('g.json').length === 1, 'file assente: la prima scrittura lo crea');

console.log('\nCartelle e migrazione\n');

// Un mese di diario scritto prima delle sottocartelle: si legge lo stesso,
// perché al 404 sul percorso nuovo il file viene spostato e rinominato.
pulisci();
scriviFile('mente-digitale/mente-digitale-diario-2026-08.json',
  JSON.stringify([{ id: 'v1', date: '2026-08-03', ts: '2026-08-03T20:00:00Z' }], null, 2));
let voci = await loadDiaryMonth('2026-08');
verifica(voci.length === 1, 'migrazione pigra: il mese vecchio si legge');
verifica(esiste('mente-digitale/diario/diario-2026-08.json'), 'migrazione pigra: il file è nella sottocartella');
verifica(!esiste('mente-digitale/mente-digitale-diario-2026-08.json'), 'migrazione pigra: non ne resta una copia');

// Anche da prima della cartella dell'app, cioè dalla root del OneDrive.
pulisci();
scriviFile('mente-digitale-movimento-2026-07.json', JSON.stringify([{ id: 'm1' }], null, 2));
verifica((await getDriveJson('movimento/movimento-2026-07.json', [])).length === 1,
  'migrazione pigra: risale anche alla root');
verifica(esiste('mente-digitale/movimento/movimento-2026-07.json'), 'migrazione pigra: dalla root alla sottocartella');

// Un file mai esistito non deve costare una richiesta a ogni lettura: la
// migrazione dalla posizione vecchia si tenta una volta e poi non più.
pulisci();
await loadDiaryMonth('2019-01');
const dopoIlPrimoGiro = finto.richieste.length;
const patchDelPrimoGiro = finto.quante('diario-2019-01', 'PATCH');
await loadDiaryMonth('2019-01');
verifica(patchDelPrimoGiro > 0, 'la prima lettura di un mese assente prova a migrarlo');
verifica(finto.quante('diario-2019-01', 'PATCH') === patchDelPrimoGiro,
  'la seconda non ci riprova');
verifica(finto.richieste.length - dopoIlPrimoGiro < dopoIlPrimoGiro,
  'e costa meno richieste della prima');

// La scrittura crea la sottocartella se non c'è.
pulisci();
await saveDiaryEntry({ id: 'v9', date: '2026-09-01', ts: '2026-09-01T07:00:00Z' });
verifica(esiste('mente-digitale/diario'), 'la sottocartella si crea da sé');
verifica(contenuto('diario/diario-2026-09.json').length === 1, 'la voce finisce in diario/');
verifica(contenuto('diario/diario-index.json').months.join() === '2026-09', 'l\'indice sta in diario/');

// La passata unica sistema tutto insieme: root → cartella → sottocartelle.
pulisci();
scriviFile('mente-digitale-bussola.json', '{}');
scriviFile('mente-digitale-diario-2025-01.json', '[]');
scriviFile('mente-digitale/mente-digitale-movimento-2025-02.json', '[]');
scriviFile('mente-digitale/mente-digitale-diario-index.json', '{"months":["2025-01"]}');
const spostati = await migrateLegacyDriveFiles();
verifica(spostati === 5, `la passata unica sposta tutto (${spostati} spostamenti)`);
verifica(esiste('mente-digitale/mente-digitale-bussola.json'), 'i file fissi restano in cima');
verifica(esiste('mente-digitale/diario/diario-2025-01.json'), 'i mesi di diario scendono in diario/');
verifica(esiste('mente-digitale/diario/diario-index.json'), 'anche l\'indice del diario');
verifica(esiste('mente-digitale/movimento/movimento-2025-02.json'), 'e i mesi di movimento in movimento/');

fine();
