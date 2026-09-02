// @ts-check
// I file dell'app su OneDrive: dove stanno, come si leggono, come si scrivono
// in due senza calpestarsi.
//
// Questo pezzo era scritto due volte — in `src/api.js` per il browser e in
// `scripts/mente-graph.mjs` per il CLI e il server MCP — e le due copie
// riscrivevano le stesse identiche cose: la cartella `mente-digitale/`, i
// percorsi, le sottocartelle create al bisogno, l'ETag tenuto insieme al corpo
// della versione letta, il `412` risolto rileggendo e riapplicando, i posti in
// cui un file poteva stare prima di finire dov'è adesso.
//
// Non era un doppione innocuo: **scrivono sugli stessi file**. Una correzione
// alla concorrenza applicata da una parte sola vuol dire che dall'altra due
// dispositivi si cancellano ancora a vicenda, e non c'è niente che lo dica. È
// già successo: l'app ha cambiato il modo di ottenere l'URL di download di un
// file, la copia del CLI è rimasta indietro.
//
// Le regole stanno quindi qui, una volta, e il trasporto si inietta — lo
// stesso disegno di `taskStore.usaDrive()`, che è già così proprio perché il
// CLI e l'app dovevano leggere le stesse attività. Quello che le due strade
// hanno davvero di diverso è solo come si autentica una richiesta: MSAL di
// qua, un refresh token di là.

/** La cartella in cui stanno tutti i file dell'app, dentro il OneDrive. */
export const CARTELLA_APP = 'mente-digitale';

/**
 * Come si parla con Graph. È tutto quello che questo modulo non sa fare da sé.
 *
 * @typedef {object} Trasporto
 * @property {(path: string, options?: any) => Promise<Response>} richiesta
 *   Una chiamata autenticata a Graph che torna la `Response` — servono gli
 *   header, non solo il corpo. Chi la implementa ci mette dentro il token, i
 *   tentativi e la gestione di 429/503/504.
 * @property {(url: string) => Promise<any>} scarica
 *   Legge il JSON da un URL di download già autorizzato, **senza header
 *   nostri**: quell'URL sta su un'altra origine (la storage di OneDrive) e
 *   porta l'autorizzazione nella query. Aggiungerci `Authorization` lo
 *   trasformerebbe in una richiesta preflighted che quell'host rifiuta.
 */

/**
 * @typedef {object} VersioneFile
 * @property {string|null} etag   ETag della versione letta o scritta, se noto
 * @property {string|null} body   il JSON di quella versione, per il confronto
 * @property {boolean} absent     true se il file non esiste ancora
 */

/** @param {any} data @returns {string} */
function perConfronto(data) {
  return JSON.stringify(data ?? null);
}

/**
 * Lo strato dei file, legato a un trasporto.
 *
 * Ogni istanza ha la sua memoria — versioni lette, cartelle già create,
 * migrazioni già tentate — perché è memoria di *questa* sessione con Graph: due
 * trasporti diversi sono due sessioni diverse, e mescolarle vorrebbe dire
 * mandare l'ETag di un file letto da un altro account.
 *
 * @param {Trasporto} trasporto
 */
export function creaDrive(trasporto) {
  const { richiesta, scarica } = trasporto;

  /** Il corpo JSON di una chiamata (null sul 204). @param {string} path @param {any} [options] */
  async function chiama(path, options) {
    const r = await richiesta(path, options);
    return r.status === 204 ? null : r.json();
  }

  // ── Percorsi ─────────────────────────────────────────────────────────────
  // I percorsi sono relativi alla cartella dell'app e possono contenere una
  // sottocartella: 'mente-digitale-bussola.json', 'diario/diario-2026-08.json'.

  /** @param {string} relPath @returns {string} */
  function drivePath(relPath) {
    return `/me/drive/root:/${CARTELLA_APP}/${relPath}`;
  }

  // ── Cartelle create al primo bisogno ─────────────────────────────────────
  // Una volta per sessione e per cartella: il 409 «esiste già» è l'esito
  // normale dopo la prima volta in assoluto.

  /** @type {Map<string, Promise<any>>} */
  const cartellePronte = new Map();

  /**
   * @param {string} [sub] sottocartella dentro quella dell'app; assente = l'app
   * @returns {Promise<any>}
   */
  function ensureFolder(sub) {
    const chiave = sub || '';
    let pronta = cartellePronte.get(chiave);
    if (!pronta) {
      const genitore = sub ? `/me/drive/root:/${CARTELLA_APP}:/children` : '/me/drive/root/children';
      const nome = sub || CARTELLA_APP;
      pronta = (sub ? ensureFolder() : Promise.resolve())
        .then(() => chiama(genitore, {
          method: 'POST',
          body: JSON.stringify({ name: nome, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        }))
        .catch(e => {
          if (/** @type {any} */ (e)?.status === 409) return null;
          cartellePronte.delete(chiave);   // errore vero (rete, permessi): si riproverà
          throw e;
        });
      cartellePronte.set(chiave, pronta);
    }
    return pronta;
  }

  /** La cartella che serve per scrivere un certo file. @param {string} relPath */
  function ensureFolderFor(relPath) {
    const i = relPath.indexOf('/');
    return ensureFolder(i < 0 ? undefined : relPath.slice(0, i));
  }

  // ── Dove un file poteva stare prima ──────────────────────────────────────
  // Dal più recente al più vecchio: la cartella dell'app senza sottocartella (e
  // col prefisso nel nome), e prima ancora la root del OneDrive.

  /** @param {string} relPath @returns {string[]} percorsi rispetto alla root del drive */
  function percorsiPrecedenti(relPath) {
    const i = relPath.indexOf('/');
    if (i < 0) return [relPath];   // file fisso: prima della cartella stava in root
    const nomeVecchio = `mente-digitale-${relPath.slice(i + 1)}`;
    return [`${CARTELLA_APP}/${nomeVecchio}`, nomeVecchio];
  }

  // Migrazione pigra: al primo 404 sul percorso nuovo si prova a spostare il
  // file da dove stava prima, con un PATCH — spostamento vero lato Graph, non
  // copia più cancellazione, quindi nessuna finestra in cui il dato esiste in
  // due posti o in nessuno; e nella stessa chiamata anche la rinomina.
  //
  // Un tentativo solo per file: quelli mai esistiti — il mese di diario di un
  // mese in cui non si è scritto — non devono costare una richiesta a ogni
  // lettura.
  /** @type {Set<string>} */
  const migrazioniTentate = new Set();

  /** @param {string} relPath @returns {Promise<boolean>} true se il file è stato spostato */
  async function migraFileVecchio(relPath) {
    if (migrazioniTentate.has(relPath)) return false;
    migrazioniTentate.add(relPath);
    const i = relPath.indexOf('/');
    const sub = i < 0 ? null : relPath.slice(0, i);
    const nome = i < 0 ? relPath : relPath.slice(i + 1);
    try {
      await ensureFolderFor(relPath);
    } catch {
      return false;
    }
    for (const vecchio of percorsiPrecedenti(relPath)) {
      try {
        await chiama(`/me/drive/root:/${vecchio}`, {
          method: 'PATCH',
          body: JSON.stringify({
            parentReference: { path: `/drive/root:/${CARTELLA_APP}${sub ? '/' + sub : ''}` },
            name: nome,
          }),
        });
        return true;
      } catch {
        // Non era lì (404) o lo spostamento è fallito: si prova il posto prima.
      }
    }
    // Nessun file da migrare: si prosegue col percorso nuovo, che è comunque la
    // sola fonte di verità da qui in poi.
    return false;
  }

  // ── Concorrenza ──────────────────────────────────────────────────────────
  // Il meccanismo classico: si tiene l'ETag della versione letta, lo si manda
  // come `If-Match` in scrittura, e sul 412 si rilegge, si riapplica la
  // modifica sul contenuto fresco e si riscrive. Un solo giro, poi l'errore
  // sale.
  //
  // Una cautela in più: insieme all'ETag si tiene anche il **corpo** della
  // versione su cui si sta lavorando. Serve a distinguere, su un 412, il
  // conflitto vero — qualcuno ha scritto davvero — da un ETag semplicemente
  // inutilizzabile: se il contenuto fresco è identico a quello che avevamo, non
  // c'è niente da fondere e si riscrive. E a poter controllare la concorrenza
  // anche quando l'ETag non c'è affatto: in quel caso, prima di scrivere, si
  // confronta il contenuto remoto con la nostra base. Meglio un confronto sul
  // contenuto che niente.

  /** Versione nota di ogni file toccato in questa sessione. @type {Map<string, VersioneFile>} */
  const versioni = new Map();

  /**
   * @param {string} filename
   * @param {string|null} etag
   * @param {any} data
   * @param {boolean} [absent]
   */
  function ricordaVersione(filename, etag, data, absent = false) {
    versioni.set(filename, {
      etag: etag || null,
      body: absent ? null : perConfronto(data),
      absent,
    });
  }

  /**
   * I metadati dell'item, con dentro l'URL di download e l'ETag.
   *
   * Senza `$select`, e non è una svista. Chiedendo esplicitamente
   * `@microsoft.graph.downloadUrl` fra i campi, su questo OneDrive personale
   * l'annotazione non torna affatto — la prova di connessione dal telefono lo
   * ha mostrato in chiaro: «nessun URL di download» sulla richiesta con
   * `$select`, e l'URL puntualmente presente in quella senza. Costava una
   * seconda richiesta di ripiego per ogni file letto, che su una rete da quasi
   * sette secondi a richiesta è un'attesa raddoppiata per niente. I metadati
   * interi sono qualche riga di JSON in più e una richiesta in meno.
   * @param {string} filename
   * @returns {Promise<any|null>} null se il file non c'è
   */
  async function itemDiFile(filename) {
    try {
      return await chiama(drivePath(filename));
    } catch (e) {
      if (/** @type {any} */ (e)?.status === 404) return null;
      throw e;
    }
  }

  /**
   * Legge un file insieme al suo ETag e registra la versione letta. Sul 404
   * prova la migrazione dalla posizione vecchia prima di dichiarare il file
   * inesistente.
   *
   * Due richieste invece di una — prima i metadati, poi il contenuto — e non è
   * un costo aggiunto per niente: la prima è una normale risposta di Graph
   * (nessun redirect da seguire con i nostri header al seguito) e porta l'ETag
   * autorevole dell'item, quello che prima costava comunque una richiesta in
   * più ogni volta che il GET del contenuto non esponeva l'header. La seconda
   * non ha bisogno di token.
   * @param {string} filename
   * @returns {Promise<{ data: any, etag: string|null, absent: boolean }>}
   */
  async function leggiFile(filename) {
    let item = await itemDiFile(filename);
    if (!item && await migraFileVecchio(filename)) item = await itemDiFile(filename);
    if (!item) {
      ricordaVersione(filename, null, null, true);
      return { data: null, etag: null, absent: true };
    }
    const etag = item.eTag || item.cTag || null;
    const url = item['@microsoft.graph.downloadUrl'];
    // Senza URL non si legge, e «non si legge» non deve mai diventare «il file
    // è vuoto»: un documento letto vuoto verrebbe poi riscritto vuoto, e lì si
    // perde roba.
    if (!url) throw new Error(`${filename}: OneDrive non dà un URL di download`);
    const data = await scarica(url);
    ricordaVersione(filename, etag, data);
    return { data, etag, absent: false };
  }

  /**
   * Una sola PUT, con `If-Match` se abbiamo un ETag. Aggiorna la versione nota
   * con l'ETag che Graph restituisce nell'item scritto.
   * @param {string} filename
   * @param {any} data
   * @param {string|null} etag
   * @returns {Promise<any>}
   */
  async function scriviUnaVolta(filename, data, etag) {
    const r = await richiesta(`${drivePath(filename)}:/content`, {
      method: 'PUT',
      headers: etag ? { 'If-Match': etag } : {},
      body: JSON.stringify(data, null, 2),
    });
    const item = r.status === 204 ? null : await r.json();
    ricordaVersione(filename, item?.eTag || item?.cTag || null, data);
    return item;
  }

  /** @param {string} filename @returns {Error & { status?: number, conflict?: boolean }} */
  function erroreDiConflitto(filename) {
    const err = /** @type {Error & { status?: number, conflict?: boolean }} */ (
      new Error(`${filename} è stato modificato altrove: ricarica prima di salvare`)
    );
    err.status = 412;
    err.conflict = true;
    return err;
  }

  /**
   * Il file remoto non è più quello su cui ci eravamo basati (o non lo
   * sappiamo, perché l'ETag mancava): si rilegge e si decide.
   * @param {string} filename
   * @param {any} data
   * @param {VersioneFile} nota
   * @param {{ reapply?: (fresco: any) => any }} opts
   * @returns {Promise<any>}
   */
  async function risolviConflitto(filename, data, nota, opts) {
    const fresco = await leggiFile(filename);
    const corpoFresco = fresco.absent ? null : perConfronto(fresco.data);

    if (corpoFresco === nota.body) {
      // Nessuno ha toccato niente: l'ETag era vecchio o inservibile, non c'è
      // nessun conflitto da risolvere. Si riscrive sulla versione appena letta.
      try {
        return await scriviUnaVolta(filename, data, fresco.etag);
      } catch (e) {
        if (/** @type {any} */ (e)?.status !== 412) throw e;
        // Un 412 anche qui vuol dire che l'If-Match su questo file non è
        // utilizzabile. Il contenuto remoto lo abbiamo appena letto ed era il
        // nostro: scrivere non fa perdere niente a nessuno.
        console.warn(`If-Match non utilizzabile su ${filename}: scrittura senza precondizione`);
        return scriviUnaVolta(filename, data, null);
      }
    }

    if (!opts.reapply) {
      versioni.delete(filename);   // la prossima lettura riparte pulita
      throw erroreDiConflitto(filename);
    }

    // Conflitto vero e sanabile: si rimette la modifica sul contenuto fresco e
    // si riscrive. Un solo giro: se anche questa PUT trova il file cambiato
    // sotto, l'errore sale.
    const unito = opts.reapply(fresco.absent ? null : fresco.data);
    return scriviUnaVolta(filename, unito, fresco.etag);
  }

  /**
   * Legge un file JSON della cartella dell'app.
   *
   * Distingue «file non ancora creato» (404 → `seAssente`) dagli errori
   * transitori (rete, 401…), che vengono propagati: senza questa distinzione un
   * errore momentaneo farebbe ripartire i chiamanti da un contenuto vuoto che,
   * al salvataggio successivo, sovrascriverebbe il file remoto cancellando
   * tutto lo storico.
   * @template T
   * @param {string} filename
   * @param {T} seAssente
   * @returns {Promise<any>}
   */
  async function getDriveJson(filename, seAssente) {
    const { data, absent } = await leggiFile(filename);
    return absent ? seAssente : data;
  }

  /**
   * Scrive un file JSON nella cartella dell'app, con controllo di concorrenza.
   *
   * `reapply` è il modo che il chiamante ha di dire come si rimette la propria
   * modifica sopra un contenuto più fresco: riceve il documento appena riletto
   * e restituisce quello da scrivere. Chi non lo passa — perché scrive il
   * documento intero e non saprebbe fondere niente — su un conflitto vero
   * riceve un errore con `status: 412`, invece di cancellare il lavoro
   * dell'altro dispositivo in silenzio.
   *
   * @param {string} filename
   * @param {any} data
   * @param {{ reapply?: (fresco: any) => any }} [opts]
   * @returns {Promise<any>}
   */
  async function putDriveJson(filename, data, opts = {}) {
    await ensureFolderFor(filename);
    const nota = versioni.get(filename);

    // Mai letto in questa sessione, o file che sappiamo non esistere: non c'è
    // una base su cui fondare un confronto, si scrive e basta.
    if (!nota || nota.absent) return scriviUnaVolta(filename, data, null);

    if (nota.etag) {
      try {
        return await scriviUnaVolta(filename, data, nota.etag);
      } catch (e) {
        if (/** @type {any} */ (e)?.status !== 412) throw e;
      }
    }
    return risolviConflitto(filename, data, nota, opts);
  }

  return {
    drivePath,
    ensureFolder,
    ensureFolderFor,
    /** I metadati di un file, o null se non c'è. La prova di connessione li
     *  chiede da sé: sono il passo che sta su Graph, mentre il contenuto sta
     *  su un altro host, e separarli è tutta la diagnosi. */
    itemDiFile,
    leggiFile,
    getDriveJson,
    putDriveJson,
    /** Dice che quel file è già stato spostato: lo usa la migrazione in blocco. */
    segnaMigrato: (/** @type {string} */ relPath) => migrazioniTentate.add(relPath),
    /**
     * Butta la memoria di questa sessione — versioni, cartelle, migrazioni
     * tentate. Serve alle prove, che mettono in scena più drive uno dopo
     * l'altro sullo stesso modulo.
     */
    dimentica() {
      versioni.clear();
      cartellePronte.clear();
      migrazioniTentate.clear();
    },
    /** Solo per le prove: cosa il drive ricorda di aver letto. */
    _versioni: versioni,
    /** Solo per le prove: quali file hanno già tentato la migrazione. */
    _migrazioniTentate: migrazioniTentate,
  };
}
