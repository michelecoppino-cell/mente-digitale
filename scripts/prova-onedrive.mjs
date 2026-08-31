// Prova dello strato OneDrive di src/api.js: concorrenza (ETag e If-Match) e
// disposizione dei file in cartelle, con la migrazione da dove stavano prima.
//
//   npm run prova-onedrive
//
// Non serve una connessione né un account: OneDrive è finto e vive in memoria.
// `src/api.js` si importa così com'è, con la sola sostituzione del modulo di
// autenticazione (che vorrebbe un browser) e con le funzioni interne riesposte
// in fondo: la prova gira sul codice vero, non su una copia che può divergere.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

const sorgente = (await readFile(join(radice, 'src/api.js'), 'utf8'))
  .replace(
    "import { getToken } from './auth';",
    'const getToken = async () => ({ token: "prova", expiresOn: Date.now() + 3_600_000 });'
  ) + '\nexport { putDriveJson, getDriveJson, _driveVersions, _migrationTried, _cartellePronte };\n';

const {
  putDriveJson, getDriveJson, migrateLegacyDriveFiles,
  loadDiaryMonth, saveDiaryEntry,
  _driveVersions, _migrationTried, _cartellePronte,
} = await import('data:text/javascript;base64,' + Buffer.from(sorgente, 'utf8').toString('base64'));

// ── OneDrive finto ──────────────────────────────────────────────────────────
// Uno spazio piatto di percorsi dalla root del drive, come li vede Graph.

/** @type {Map<string, { testo?: string, etag?: string, cartella?: boolean, id: string }>} */
let archivio = new Map();
let progressivo = 0;
let esponeEtag = true;           // il GET del contenuto espone l'header ETag?
let ifMatchInservibile = false;  // il server risponde 412 a qualunque If-Match
let falliti = 0;

function risposta(status, corpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
  };
}
const nonTrovato = () => risposta(404, { error: { code: 'itemNotFound', message: 'non esiste' } });

function scriviFile(percorso, testo) {
  const etag = `"E${++progressivo}"`;
  archivio.set(percorso, { testo, etag, id: `id${++progressivo}` });
  return etag;
}
function creaCartella(percorso) {
  if (archivio.has(percorso)) return null;
  archivio.set(percorso, { cartella: true, id: `id${++progressivo}` });
  return percorso;
}
const perId = id => [...archivio.entries()].find(([, v]) => v.id === id);
const figli = cartella => [...archivio.entries()]
  .filter(([p, v]) => p.startsWith(cartella + '/') && !p.slice(cartella.length + 1).includes('/'))
  .map(([p, v]) => ({ id: v.id, name: p.slice(cartella.length + 1), file: v.cartella ? undefined : {} }));

globalThis.fetch = async (url, opt = {}) => {
  const metodo = opt.method || 'GET';
  const senzaHost = url.replace('https://graph.microsoft.com/v1.0', '');

  // Creazione cartelle
  if (metodo === 'POST' && senzaHost.endsWith('children')) {
    const genitore = senzaHost === '/me/drive/root/children'
      ? ''
      : (senzaHost.match(/root:\/(.+):\/children/) || [])[1] + '/';
    const nome = JSON.parse(opt.body).name;
    return creaCartella(genitore + nome)
      ? risposta(201, { id: 'cartella' })
      : risposta(409, { error: { code: 'nameAlreadyExists', message: 'esiste già' } });
  }

  // Elenco dei figli di una cartella
  if (metodo === 'GET' && senzaHost.includes('children')) {
    const cartella = senzaHost === '/me/drive/root/children?$select=id,name,file&$top=200'
      ? ''
      : (senzaHost.match(/root:\/([^:]+):\/children/) || [])[1];
    const dentro = cartella
      ? figli(cartella)
      : [...archivio.entries()]
          .filter(([p, v]) => !p.includes('/'))
          .map(([p, v]) => ({ id: v.id, name: p, file: v.cartella ? undefined : {} }));
    return risposta(200, { value: dentro });
  }

  // Spostamento / rinomina per id
  if (metodo === 'PATCH' && senzaHost.includes('/me/drive/items/')) {
    const voce = perId(senzaHost.split('/me/drive/items/')[1]);
    if (!voce) return nonTrovato();
    const b = JSON.parse(opt.body);
    const destinazione = b.parentReference.path.replace('/drive/root:', '').replace(/^\//, '');
    const nome = b.name || voce[0].split('/').pop();
    archivio.delete(voce[0]);
    archivio.set(destinazione ? `${destinazione}/${nome}` : nome, voce[1]);
    return risposta(200, { id: voce[1].id });
  }

  const percorso = (senzaHost.match(/\/me\/drive\/root:\/([^:?]+)/) || [])[1];
  if (!percorso) return nonTrovato();
  const decodificato = decodeURIComponent(percorso);
  const file = archivio.get(decodificato);

  // Spostamento / rinomina per percorso
  if (metodo === 'PATCH') {
    if (!file) return nonTrovato();
    const b = JSON.parse(opt.body);
    const destinazione = b.parentReference.path.replace('/drive/root:', '').replace(/^\//, '');
    const nome = b.name || decodificato.split('/').pop();
    archivio.delete(decodificato);
    archivio.set(destinazione ? `${destinazione}/${nome}` : nome, file);
    return risposta(200, { id: file.id });
  }
  if (metodo === 'GET' && senzaHost.includes(':/content')) {
    if (!file) return nonTrovato();
    return risposta(200, file.testo, esponeEtag ? { ETag: file.etag } : {});
  }
  if (metodo === 'GET') {   // metadati dell'item: l'ETag autorevole
    if (!file) return nonTrovato();
    return risposta(200, { id: file.id, eTag: file.etag, cTag: 'c:' + file.etag });
  }
  if (metodo === 'PUT') {
    const ifMatch = opt.headers?.['If-Match'];
    if (ifMatch && (ifMatchInservibile || !file || file.etag !== ifMatch)) {
      return risposta(412, { error: { code: 'resourceModified', message: 'ETag diverso' } });
    }
    const etag = scriviFile(decodificato, opt.body);
    return risposta(200, { id: archivio.get(decodificato).id, eTag: etag, cTag: 'c:' + etag });
  }
  return nonTrovato();
};

/** L'altro dispositivo scrive il file mentre noi lo teniamo aperto. */
function altroDispositivoScrive(relPath, dati) {
  scriviFile(`mente-digitale/${relPath}`, JSON.stringify(dati, null, 2));
}
function pulisci() {
  archivio = new Map();
  archivio.set('mente-digitale', { cartella: true, id: 'radice' });
  _driveVersions.clear(); _migrationTried.clear(); _cartellePronte.clear();
  esponeEtag = true; ifMatchInservibile = false;
}
function verifica(condizione, cosa) {
  console.log(`${condizione ? '  ok  ' : ' FALLITO '} ${cosa}`);
  if (!condizione) { falliti++; process.exitCode = 1; }
}
const contenuto = relPath => JSON.parse(archivio.get(`mente-digitale/${relPath}`).testo);
const esiste = percorso => archivio.has(percorso);

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
pulisci(); esponeEtag = false;
altroDispositivoScrive('d.json', [{ id: 'x' }]);
await getDriveJson('d.json', []);
altroDispositivoScrive('d.json', [{ id: 'x' }, { id: 'dal-telefono' }]);
errore = null;
try { await putDriveJson('d.json', [{ id: 'x' }, { id: 'mio' }]); } catch (e) { errore = e; }
verifica(errore?.status === 412, 'senza header ETag il conflitto si vede comunque');
verifica(contenuto('d.json')[1].id === 'dal-telefono', 'senza header ETag: niente sovrascrittura');

pulisci(); esponeEtag = false;
altroDispositivoScrive('e.json', [{ id: 'x' }]);
await getDriveJson('e.json', []);
await putDriveJson('e.json', [{ id: 'x' }, { id: 'y' }]);
verifica(contenuto('e.json').length === 2, 'senza header ETag e senza conflitto si scrive lo stesso');

// Se il server rifiutasse qualunque If-Match (tag di natura diversa da quella
// che si aspetta), i salvataggi non devono bloccarsi: il contenuto remoto è
// stato appena riletto ed è il nostro, quindi riscrivere non toglie niente a
// nessuno.
pulisci(); ifMatchInservibile = true;
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

// Un file mai esistito non deve costare una richiesta a ogni lettura.
pulisci();
await loadDiaryMonth('2019-01');
const primaDelSecondoGiro = archivio.size;
await loadDiaryMonth('2019-01');
verifica(_migrationTried.has('diario/diario-2019-01.json') && archivio.size === primaDelSecondoGiro,
  'un mese mai scritto si tenta di migrare una volta sola');

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

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} prove fallite.\n`);
