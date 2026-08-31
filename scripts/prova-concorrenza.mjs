// Prova del controllo di concorrenza sui file di OneDrive (ETag + If-Match).
//
//   node scripts/prova-concorrenza.mjs
//
// Non serve una connessione né un account: OneDrive è finto e vive in memoria.
// Quello che si vuole vedere è una cosa sola, ed è il criterio con cui il passo
// è stato considerato fatto — due dispositivi che salvano lo stesso documento a
// pochi secondi di distanza non si cancellano più a vicenda.
//
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
  ) + '\nexport { putDriveJson, getDriveJson, _driveVersions };\n';

const api = await import(
  'data:text/javascript;base64,' + Buffer.from(sorgente, 'utf8').toString('base64')
);
const { putDriveJson, getDriveJson, _driveVersions } = api;

// ── OneDrive finto ──────────────────────────────────────────────────────────
/** @type {Record<string, { testo: string, etag: string }>} */
let archivio = {};
let progressivo = 0;
let esponeEtag = true;      // il GET del contenuto espone l'header ETag?
let ifMatchInservibile = false;  // il server risponde 412 a qualunque If-Match
let esiti = 0;

function risposta(status, corpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
  };
}

globalThis.fetch = async (url, opt = {}) => {
  const nome = (url.match(/root:\/mente-digitale\/([^:?]+)/) || [])[1];
  const metodo = opt.method || 'GET';
  const file = archivio[nome];

  if (url.includes('/me/drive/root/children')) return risposta(409, { error: { code: 'nameAlreadyExists' } });

  if (metodo === 'GET' && url.includes(':/content')) {
    if (!file) return risposta(404, { error: { code: 'itemNotFound', message: 'non esiste' } });
    return risposta(200, file.testo, esponeEtag ? { ETag: file.etag } : {});
  }
  if (metodo === 'GET') {   // metadati dell'item: l'ETag autorevole
    if (!file) return risposta(404, { error: { code: 'itemNotFound', message: 'non esiste' } });
    return risposta(200, { id: nome, eTag: file.etag, cTag: 'c:' + file.etag });
  }
  if (metodo === 'PUT') {
    const ifMatch = opt.headers?.['If-Match'];
    if (ifMatch && (ifMatchInservibile || !file || file.etag !== ifMatch)) {
      return risposta(412, { error: { code: 'resourceModified', message: 'ETag diverso' } });
    }
    const etag = `"E${++progressivo}"`;
    archivio[nome] = { testo: opt.body, etag };
    return risposta(200, { id: nome, eTag: etag, cTag: 'c:' + etag });
  }
  return risposta(404, { error: { code: 'itemNotFound' } });
};

/** L'altro dispositivo scrive il file mentre noi lo teniamo aperto. */
function altroDispositivoScrive(nome, dati) {
  archivio[nome] = { testo: JSON.stringify(dati, null, 2), etag: `"E${++progressivo}"` };
}
function pulisci() {
  archivio = {}; _driveVersions.clear(); esponeEtag = true; ifMatchInservibile = false;
}
function verifica(condizione, cosa) {
  console.log(`${condizione ? '  ok  ' : ' FALLITO ' } ${cosa}`);
  if (!condizione) { esiti++; process.exitCode = 1; }
}
const contenuto = nome => JSON.parse(archivio[nome].testo);

// ── Le prove ────────────────────────────────────────────────────────────────

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

console.log(esiti === 0 ? '\nTutto a posto.' : `\n${esiti} prove fallite.`);
