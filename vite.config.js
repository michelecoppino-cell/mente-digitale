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
          if (id.includes('d3')) return 'd3';
          if (id.includes('@azure/msal-browser')) return 'msal';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
})
