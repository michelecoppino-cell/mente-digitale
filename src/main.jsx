import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import './index.css'
import App from './App.jsx'

// HashRouter e non BrowserRouter: l'app è servita come sito statico, e con le
// rotte nel path un ricaricamento su /piano — o l'apertura dall'icona PWA —
// chiederebbe al server un file che non esiste. Con l'hash la rotta non lascia
// mai il client, e le due pagine-scorciatoia (/gtd.html, /diario.html)
// restano file veri.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
)
