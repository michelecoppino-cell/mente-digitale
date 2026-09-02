import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `npm run dev:finto` — l'app in locale, senza rete e senza account.
//
// Le API Graph rispondono solo sull'URL di produzione: senza questo,
// l'interfaccia si prova dopo il merge, sui dati veri. Qui l'autenticazione e
// Graph vengono sostituiti da `src/finto/`, che tiene un OneDrive in memoria —
// lo stesso su cui girano le prove — con dentro una giornata plausibile.
//
// È una **sostituzione di file**, non un interruttore dentro l'app: nessuna
// riga di codice finto esiste nel bundle di produzione, perché quel file lì non
// viene mai importato.
const finto = !!process.env.MD_FINTO;

export default defineConfig({
  plugins: [react()],
  ...(finto ? {
    resolve: {
      alias: [{ find: /^\.\/auth$/, replacement: fileURLToPath(new URL('./src/finto/auth.js', import.meta.url)) }],
    },
  } : {}),
  // Data della build, iniettata a compile time. Serve a una domanda sola, ma
  // che da iPhone non ha altra risposta: la versione che sto guardando è
  // quella appena messa online, o Safari mi sta ancora servendo la vecchia?
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
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
