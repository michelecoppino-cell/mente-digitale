// Un OneDrive finto, in memoria, al posto di Microsoft Graph.
//
// Serve a due cose, ed è per questo che sta in `src/` e non fra gli script:
//
//  - le **prove** ci girano sopra senza rete né account, e possono mettere in
//    scena quello che dal vero non si provoca a comando — l'altro dispositivo
//    che scrive mentre noi teniamo il file aperto, l'header ETag che non
//    arriva, il server che rifiuta ogni If-Match;
//  - `npm run dev:finto` lo monta **nel browser**, così l'app si può aprire e
//    usare in locale. Senza, non si può: le API Graph rispondono solo
//    sull'URL di produzione, e ogni modifica all'interfaccia si verificava
//    dopo il merge, sui dati veri.
//
// Qui dentro non c'è niente di Node: è lo stesso file da tutte e due le parti,
// perché due copie divergerebbero e la prova smetterebbe di provare quello che
// l'app fa davvero.

/**
 * Mette in piedi il finto OneDrive rimpiazzando `fetch`.
 * @returns {{
 *   archivio: Map<string, any>,
 *   richieste: { metodo: string, percorso: string }[],
 *   quante: (pezzo: string, metodo?: string) => number,
 *   pulisci: () => void,
 *   scriviFile: (percorso: string, testo: string) => string,
 *   aggiungiRotta: (fn: (percorso: string, opzioni: any, risposta: (status: number, corpo: any, headers?: any) => any) => any) => void,
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

  /** @param {number} status @param {any} corpo @param {Record<string, string>} [headers] */
  const risposta = (status, corpo, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (/** @type {string} */ k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => (typeof corpo === 'string' ? JSON.parse(corpo) : corpo),
    // Il contenuto dei file si legge come testo, non come JSON già letto:
    // `scaricaJson` fa `r.text()` e poi il parse, per distinguere un file
    // vuoto da un file con dentro `null`.
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
  });
  const nonTrovato = () => risposta(404, { error: { code: 'itemNotFound', message: 'non esiste' } });

  /** @param {string} percorso @param {string} testo @returns {string} l'ETag */
  function scriviFile(percorso, testo) {
    const etag = `"E${++progressivo}"`;
    archivio.set(percorso, { testo, etag, id: `id${++progressivo}` });
    return etag;
  }
  const creaCartella = (/** @type {string} */ percorso) => {
    if (archivio.has(percorso)) return false;
    archivio.set(percorso, { cartella: true, id: `id${++progressivo}` });
    return true;
  };
  const perId = (/** @type {string} */ id) => [...archivio.entries()].find(([, v]) => v.id === id);
  const elenco = (/** @type {string} */ cartella) => [...archivio.entries()]
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
  const urlContenuto = (/** @type {string} */ percorso) => HOST_CONTENUTO + encodeURIComponent(percorso);

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
      const nome = JSON.parse(String(opt.body)).name;
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
      return sposta(voce[0], voce[1], JSON.parse(String(opt.body)));
    }

    const percorso = (senzaHost.match(/\/me\/drive\/root:\/([^:?]+)/) || [])[1];
    if (!percorso) return nonTrovato();
    const decodificato = decodeURIComponent(percorso);
    const file = archivio.get(decodificato);

    /** @param {string} daPercorso @param {any} voce @param {any} corpo */
    function sposta(daPercorso, voce, corpo) {
      const destinazione = corpo.parentReference.path.replace('/drive/root:', '').replace(/^\//, '');
      const nome = corpo.name || daPercorso.split('/').pop();
      archivio.delete(daPercorso);
      archivio.set(destinazione ? `${destinazione}/${nome}` : nome, voce);
      return risposta(200, { id: voce.id });
    }

    if (metodo === 'PATCH') {
      if (!file) return nonTrovato();
      return sposta(decodificato, file, JSON.parse(String(opt.body)));
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
      const ifMatch = /** @type {Record<string, string>|undefined} */ (opt.headers)?.['If-Match'];
      if (ifMatch && (stato.ifMatchInservibile || !file || file.etag !== ifMatch)) {
        return risposta(412, { error: { code: 'resourceModified', message: 'ETag diverso' } });
      }
      const etag = scriviFile(decodificato, String(opt.body));
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
