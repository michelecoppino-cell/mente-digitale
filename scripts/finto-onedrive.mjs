// Un OneDrive finto, in memoria, per le prove degli strati che ci scrivono
// sopra (src/api.js e src/taskStore.js).
//
// Serve a due cose: far girare le prove senza connessione né account, e poter
// mettere in scena quello che dal vero non si riesce a provocare a comando —
// l'altro dispositivo che scrive mentre noi teniamo il file aperto, l'header
// ETag che non arriva, il server che rifiuta ogni If-Match.
//
// I moduli dell'app si importano così come sono, sostituendo solo il modulo di
// autenticazione (che vorrebbe un browser): le prove girano sul codice vero,
// non su una copia che può divergere.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const STUB_AUTH = 'const getToken = async () => ({ token: "prova", expiresOn: Date.now() + 3_600_000 });';

/** @param {string} testo @returns {string} */
const comeModulo = testo => 'data:text/javascript;base64,' + Buffer.from(testo, 'utf8').toString('base64');

// I moduli si costruiscono una volta sola e si legano fra loro: se `api.js`
// venisse ricostruito per ogni import, taskStore e taskMigrazione parlerebbero
// con due copie diverse — e due registri di ETag diversi.
/** @type {Map<string, Promise<string>>} */
const _urlModuli = new Map();

/** @param {string} nome @returns {Promise<string>} */
function urlDi(nome) {
  let url = _urlModuli.get(nome);
  if (!url) {
    url = (async () => {
      let testo = await readFile(join(src, nome), 'utf8');
      testo = testo.replace("import { getToken } from './auth';", STUB_AUTH);
      if (nome === 'api.js') testo += '\nexport { _driveVersions, _migrationTried, _cartellePronte };\n';
      // Gli import fra moduli dell'app si rilegano ai moduli già costruiti.
      const riferiti = [...testo.matchAll(/from '\.\/([\w-]+)'/g)].map(m => m[1]);
      for (const rif of [...new Set(riferiti)]) {
        testo = testo.replaceAll(`from './${rif}'`, `from '${await urlDi(`${rif}.js`)}'`);
      }
      return comeModulo(testo);
    })();
    _urlModuli.set(nome, url);
  }
  return url;
}

/**
 * Importa un modulo di src/ con l'autenticazione finta e gli import fra moduli
 * dell'app rilegati fra loro.
 * @param {string} nome   es. 'taskStore.js'
 * @returns {Promise<any>}
 */
export async function importaModulo(nome) {
  return import(await urlDi(nome));
}

/**
 * Mette in piedi il finto OneDrive rimpiazzando `fetch`.
 * @returns {{
 *   archivio: Map<string, any>,
 *   pulisci: () => void,
 *   scriviFile: (percorso: string, testo: string) => string,
 *   altroDispositivoScrive: (relPath: string, dati: any) => void,
 *   contenuto: (relPath: string) => any,
 *   esiste: (percorso: string) => boolean,
 *   stato: { esponeEtag: boolean, ifMatchInservibile: boolean },
 * }}
 */
export function montaFintoOnedrive() {
  /** @type {Map<string, any>} */
  let archivio = new Map();
  let progressivo = 0;
  const stato = { esponeEtag: true, ifMatchInservibile: false };

  const risposta = (status, corpo, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
  });
  const nonTrovato = () => risposta(404, { error: { code: 'itemNotFound', message: 'non esiste' } });

  function scriviFile(percorso, testo) {
    const etag = `"E${++progressivo}"`;
    archivio.set(percorso, { testo, etag, id: `id${++progressivo}` });
    return etag;
  }
  const creaCartella = percorso => {
    if (archivio.has(percorso)) return false;
    archivio.set(percorso, { cartella: true, id: `id${++progressivo}` });
    return true;
  };
  const perId = id => [...archivio.entries()].find(([, v]) => v.id === id);
  const elenco = cartella => [...archivio.entries()]
    .filter(([p]) => (cartella ? p.startsWith(cartella + '/') && !p.slice(cartella.length + 1).includes('/') : !p.includes('/')))
    .map(([p, v]) => ({ id: v.id, name: cartella ? p.slice(cartella.length + 1) : p, file: v.cartella ? undefined : {} }));

  /** Rotte aggiunte dalle prove (es. il finto Microsoft To-Do). @type {Function[]} */
  const rotte = [];

  globalThis.fetch = async (url, opt = {}) => {
    const metodo = opt.method || 'GET';
    const senzaHost = String(url).replace('https://graph.microsoft.com/v1.0', '');

    for (const rotta of rotte) {
      const esito = await rotta(senzaHost, opt, risposta);
      if (esito) return esito;
    }

    if (metodo === 'POST' && senzaHost.includes('children')) {
      const genitore = senzaHost === '/me/drive/root/children'
        ? '' : (senzaHost.match(/root:\/(.+):\/children/) || [])[1] + '/';
      const nome = JSON.parse(opt.body).name;
      return creaCartella(genitore + nome)
        ? risposta(201, { id: 'cartella' })
        : risposta(409, { error: { code: 'nameAlreadyExists', message: 'esiste già' } });
    }
    if (metodo === 'GET' && senzaHost.includes('children')) {
      const cartella = (senzaHost.match(/root:\/([^:]+):\/children/) || [])[1] || '';
      return risposta(200, { value: elenco(cartella) });
    }
    if (metodo === 'PATCH' && senzaHost.includes('/me/drive/items/')) {
      const voce = perId(senzaHost.split('/me/drive/items/')[1]);
      if (!voce) return nonTrovato();
      return sposta(voce[0], voce[1], JSON.parse(opt.body));
    }

    const percorso = (senzaHost.match(/\/me\/drive\/root:\/([^:?]+)/) || [])[1];
    if (!percorso) return nonTrovato();
    const decodificato = decodeURIComponent(percorso);
    const file = archivio.get(decodificato);

    function sposta(daPercorso, voce, corpo) {
      const destinazione = corpo.parentReference.path.replace('/drive/root:', '').replace(/^\//, '');
      const nome = corpo.name || daPercorso.split('/').pop();
      archivio.delete(daPercorso);
      archivio.set(destinazione ? `${destinazione}/${nome}` : nome, voce);
      return risposta(200, { id: voce.id });
    }

    if (metodo === 'PATCH') {
      if (!file) return nonTrovato();
      return sposta(decodificato, file, JSON.parse(opt.body));
    }
    if (metodo === 'GET' && senzaHost.includes(':/content')) {
      if (!file) return nonTrovato();
      return risposta(200, file.testo, stato.esponeEtag ? { ETag: file.etag } : {});
    }
    if (metodo === 'GET') {
      if (!file) return nonTrovato();
      return risposta(200, { id: file.id, eTag: file.etag, cTag: 'c:' + file.etag });
    }
    if (metodo === 'PUT') {
      const ifMatch = opt.headers?.['If-Match'];
      if (ifMatch && (stato.ifMatchInservibile || !file || file.etag !== ifMatch)) {
        return risposta(412, { error: { code: 'resourceModified', message: 'ETag diverso' } });
      }
      const etag = scriviFile(decodificato, opt.body);
      return risposta(200, { id: archivio.get(decodificato).id, eTag: etag, cTag: 'c:' + etag });
    }
    return nonTrovato();
  };

  return {
    get archivio() { return archivio; },
    stato,
    scriviFile,
    /** Aggiunge una rotta consultata prima di quelle del drive. */
    aggiungiRotta: fn => rotte.push(fn),
    pulisci() {
      archivio = new Map();
      archivio.set('mente-digitale', { cartella: true, id: 'radice' });
      stato.esponeEtag = true;
      stato.ifMatchInservibile = false;
    },
    altroDispositivoScrive: (relPath, dati) =>
      scriviFile(`mente-digitale/${relPath}`, JSON.stringify(dati, null, 2)),
    contenuto: relPath => JSON.parse(archivio.get(`mente-digitale/${relPath}`).testo),
    esiste: percorso => archivio.has(percorso),
  };
}

/** Contatore di esiti condiviso dai file di prova. */
export function creaTabellone() {
  let falliti = 0;
  return {
    verifica(condizione, cosa) {
      console.log(`${condizione ? '  ok  ' : ' FALLITO '} ${cosa}`);
      if (!condizione) { falliti++; process.exitCode = 1; }
    },
    fine() {
      console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} prove fallite.\n`);
    },
  };
}
