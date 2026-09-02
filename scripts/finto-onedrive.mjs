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
      // Il drive del nucleo espone già `_dimenticaDrive`: non c'è più niente di
      // privato da tirare fuori a forza.
      // Gli import fra moduli dell'app si rilegano ai moduli già costruiti: sia
      // quelli statici in testa al file, sia quelli a richiesta con l'estensione
      // (`import('./api.js')`, con cui taskStore carica il suo trasporto).
      // I `import('./types')` dei commenti JSDoc non si toccano: non sono
      // import veri e non hanno l'estensione.
      //
      // L'estensione negli statici è facoltativa perché nel codice lo è: i
      // moduli che anche Node importa davvero — diary, paraConfig, api — la
      // scrivono, perché il risolutore di Node la pretende; gli altri no,
      // perché a Vite non serve. Qui vanno rilegati entrambi, e prima
      // l'espressione ne vedeva una forma sola: un `from './tempo.js'` restava
      // com'era e da un modulo `data:` non si risolve niente di relativo.
      const statici = [...testo.matchAll(/^import\b[^;]*?from '\.\/([\w-]+)(\.js)?'/gm)];
      const dinamici = [...testo.matchAll(/import\('\.\/([\w-]+)\.js'\)/g)].map(m => m[1]);
      for (const rif of [...new Set([...statici.map(m => m[1]), ...dinamici])]) {
        const url = await urlDi(`${rif}.js`);
        testo = testo.replaceAll(`from './${rif}'`, `from '${url}'`)
                     .replaceAll(`from './${rif}.js'`, `from '${url}'`)
                     .replaceAll(`import('./${rif}.js')`, `import('${url}')`);
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
    // Il contenuto dei file si legge come testo, non come JSON già letto:
    // `scaricaJson` fa `r.text()` e poi il parse, per distinguere un file
    // vuoto da un file con dentro `null`.
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
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

  // I file di OneDrive non stanno su graph.microsoft.com: i metadati sì, il
  // contenuto no — quello arriva da una storage con un host suo, tramite un
  // URL pre-autenticato che Graph mette in `@microsoft.graph.downloadUrl`.
  // Anche qui è un host a parte, e la richiesta che ci arriva non porta né
  // token né header nostri: è esattamente la forma che l'app usa dal vero, e
  // quindi l'unica su cui provarla abbia senso.
  const HOST_CONTENUTO = 'https://prova-storage.onedrive/scarica/';
  const urlContenuto = percorso => HOST_CONTENUTO + encodeURIComponent(percorso);

  // Le richieste arrivate, in ordine. Servono a provare quello che non si vede
  // dal contenuto dell'archivio: che una lettura non ne ha fatta una seconda,
  // che un file mai esistito non si ritenta a ogni giro, che quattro letture
  // insieme chiedono lo stesso file una volta sola.
  /** @type {{ metodo: string, percorso: string }[]} */
  const richieste = [];

  globalThis.fetch = async (url, opt = {}) => {
    const metodo = opt.method || 'GET';
    richieste.push({ metodo, percorso: String(url).replace('https://graph.microsoft.com/v1.0', '') });
    const indirizzo = String(url);

    if (indirizzo.startsWith(HOST_CONTENUTO)) {
      const voce = archivio.get(decodeURIComponent(indirizzo.slice(HOST_CONTENUTO.length)));
      return voce ? risposta(200, voce.testo) : nonTrovato();
    }

    const senzaHost = indirizzo.replace('https://graph.microsoft.com/v1.0', '');

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
    if (metodo === 'GET') {
      if (!file) return nonTrovato();
      // `esponeEtag: false` mette in scena un item senza eTag né cTag: è da lì
      // che l'app prende la versione letta, e senza deve accorgersi di un
      // conflitto confrontando il contenuto.
      return risposta(200, {
        id: file.id,
        ...(stato.esponeEtag ? { eTag: file.etag, cTag: 'c:' + file.etag } : {}),
        '@microsoft.graph.downloadUrl': urlContenuto(decodificato),
      });
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
    /** Le richieste arrivate finora, in ordine. */
    get richieste() { return richieste; },
    /** Quante richieste hanno toccato un percorso (sottostringa). */
    quante: (pezzo, metodo) => richieste.filter(
      r => r.percorso.includes(pezzo) && (!metodo || r.metodo === metodo)).length,
    stato,
    scriviFile,
    /** Aggiunge una rotta consultata prima di quelle del drive. */
    aggiungiRotta: fn => rotte.push(fn),
    pulisci() {
      archivio = new Map();
      richieste.length = 0;
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
