import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
