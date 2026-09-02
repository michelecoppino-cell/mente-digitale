// Come si montano i moduli dell'app dentro una prova.
//
// Il finto OneDrive sta in `src/finto/drive.js` — è lo stesso che
// `npm run dev:finto` monta nel browser, e da qui si riesporta. Qui restano le
// due cose che valgono solo da Node: caricare i moduli di `src/` sostituendo
// il modulo di autenticazione (che vorrebbe un browser), e il tabellone degli
// esiti.
//
// I moduli si importano così come sono: le prove girano sul codice vero, non
// su una copia che può divergere.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Il finto OneDrive vero e proprio sta in `src/finto/drive.js`: lo stesso file
// che `npm run dev:finto` monta nel browser. Da qui si riesporta, così le
// prove continuano a importarlo da dove l'hanno sempre importato.
export { montaFintoOnedrive } from '../src/finto/drive.js';

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
      // Anche gli import che risalgono di una cartella (`planner/griglia.js`
      // che importa `../tempo.js`): i moduli di `src/` non stanno tutti sullo
      // stesso piano, e un `..` lasciato com'era è un modulo che da un URL
      // `data:` non si risolve — la prova moriva prima della prima verifica.
      const statici = [...testo.matchAll(/^import\b[^;]*?from '(\.\.?\/[\w-]+(?:\/[\w-]+)*)(\.js)?'/gm)].map(m => m[1]);
      const dinamici = [...testo.matchAll(/import\('(\.\.?\/[\w-]+(?:\/[\w-]+)*)\.js'\)/g)].map(m => m[1]);
      for (const rif of new Set([...statici, ...dinamici])) {
        // Il riferimento è relativo al modulo che lo scrive, non a `src/`.
        const url = await urlDi(join(dirname(nome), rif) + (rif.endsWith('.js') ? '' : '.js'));
        testo = testo.replaceAll(`from '${rif}'`, `from '${url}'`)
                     .replaceAll(`from '${rif}.js'`, `from '${url}'`)
                     .replaceAll(`import('${rif}.js')`, `import('${url}')`);
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
