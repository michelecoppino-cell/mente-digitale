import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Il service worker sta in public/ — quindi non passa dal bundle — ma ha bisogno
// di due cose che solo la build conosce: l'elenco degli asset con hash prodotti
// (per poter buttare via quelli delle build precedenti invece di accumularli) e
// un numero che cambi, perché un worker identico byte per byte non viene
// rimpiazzato dal browser e la potatura non girerebbe mai.
//
// La sostituzione avviene in `closeBundle`, dopo che Vite ha copiato public/ in
// dist/: prima di quel momento dist/sw.js non esiste ancora.
function serviceWorkerAssets() {
  /** @type {string[]} */
  let assets = []
  return {
    name: 'sw-assets',
    apply: /** @type {'build'} */ ('build'),
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle).map(name => `/${name}`)
    },
    closeBundle() {
      const swPath = resolve('dist/sw.js')
      if (!existsSync(swPath)) return
      const buildId = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 12)
      // replaceAll e non replace: il primo segnaposto compariva anche nel
      // commento in testa al file, e una sostituzione sola finiva lì invece che
      // nella costante.
      const out = readFileSync(swPath, 'utf8')
        .replaceAll('__BUILD_ID__', buildId)
        .replaceAll("'__ASSETS__'", JSON.stringify(JSON.stringify(assets)))
      writeFileSync(swPath, out)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorkerAssets()],
  build: {
    rollupOptions: {
      output: {
        // Separa i vendor pesanti dal codice app: cache del browser più stabile
        // tra i deploy e download in parallelo
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Prima di 'd3': recharts si porta dietro mezzo d3 (scale, shape) via
          // victory-vendor. Senza questa riga finiva in 'vendor', che il primo
          // caricamento scarica sempre — e i 200 kB dei grafici di Finanze
          // sarebbero arrivati anche a chi apre l'app su «Oggi», vanificando il
          // lazy import della sezione.
          if (id.includes('recharts') || id.includes('victory-vendor')) return 'recharts';
          if (id.includes('d3')) return 'd3';
          if (id.includes('@azure/msal-browser')) return 'msal';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
})
