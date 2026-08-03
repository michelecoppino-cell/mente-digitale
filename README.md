# Mente Digitale

Dashboard personale (PWA) che unifica l'ecosistema Microsoft 365 in un'unica "mente digitale":
una mappa mentale interattiva dei taccuini OneNote, un pianificatore giornaliero collegato a
Microsoft To-Do e al calendario Outlook, e un briefing di notizie generato con l'AI.

## Funzionalità

- **Mappa mentale (D3)** — taccuini e sezioni OneNote come grafo force-directed navigabile;
  badge con il numero di task aperti per sezione; "orb" centrale con documenti identitari
  (Bussola / Visione) salvati su OneDrive.
- **Pannello sezione** — pagine OneNote, task To-Do della lista omonima e link OneDrive
  per la sezione selezionata.
- **Pianificatore giornaliero** — drag & drop dei task su una timeline a slot di 30 minuti,
  vista giorno/settimana, eventi del calendario in sola lettura, sottostep ridimensionabili,
  piani salvati su OneDrive. Piano AI generato via Claude (`/api/daily-plan`) ed estrazione
  di action item dalle email.
- **Pannello attività** — task raggruppati per scadenza + calendario settimanale/mensile.
- **Briefing notizie** — riassunti AI dei feed ANSA (mondo, Italia, Friuli) via `/api/briefing`.
- **Diario** (🕯️ nell'header, `Ctrl/Cmd+J`) — "svuota testa" a schermo intero con timer e domanda
  del giorno (conserva / chiudi nel cassetto / lascia andare senza salvare), rituale della sera
  con tre domande, gratitudini e umore/energia, timeline con ricerca e tag. Il bottone
  **Copia per l'AI** compone il markdown di un periodo (con la Bussola come contesto) da
  incollare in una chat AI per chiedere supporto. Voci salvate su OneDrive in file mensili;
  il diario non passa da alcuna funzione server. Su telefono, con il Piano aperto,
  Diario e GTD restano raggiungibili come due pulsanti tondi in basso a destra.

### Due icone sulla schermata Home di iPhone

iOS ignora gli `shortcuts` del manifest: per avere più icone servono più pagine da
aggiungere alla Home. `public/gtd.html` e `public/diario.html` esistono per questo — hanno
icona, nome e status bar propri e, quando vengono lanciate dalla loro icona (`standalone`),
rimbalzano sull'app con `?apri=gtd` / `?apri=diario`, che `App.jsx` traduce nell'apertura
del pannello giusto già al primo render. Viste in Safari restano invece ferme, altrimenti
si finirebbe per aggiungere alla Home l'app invece della scorciatoia.

Per installarle: apri `/gtd.html` (e poi `/diario.html`) in Safari → Condividi →
*Aggiungi a Home*.

## Architettura

| Componente | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, D3 per la mappa |
| Autenticazione | MSAL Browser (account Microsoft personale, scope Graph in sola lettura + To-Do/Files in scrittura) |
| Dati | Microsoft Graph (OneNote, To-Do, Calendar, OneDrive, Mail) con cache localStorage a TTL. I file JSON dell'app stanno nella cartella `mente-digitale/` di OneDrive (quelli rimasti in root vengono spostati automaticamente al primo avvio) |
| Backend | Cloudflare Pages Functions (`functions/api/*`) |
| AI | Claude Haiku (`daily-plan`), Mistral (`briefing`) |
| Automazioni | GitHub Actions (`generate-news`, `sync-calendar`) |

I dati utente non transitano da alcun backend proprio: il browser parla direttamente con
Microsoft Graph; le funzioni Cloudflare ricevono solo i payload minimi necessari all'AI.

## Sviluppo

```bash
npm install
npm run dev       # dev server Vite
npm run lint      # ESLint
npm run build     # build di produzione in dist/
```

### Variabili d'ambiente (Cloudflare Pages)

| Nome | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | `/api/daily-plan` (piano AI, email, breakdown task) |
| `MISTRAL_API_KEY` | `/api/briefing` (riassunto notizie) |

### Configurazione MSAL

`src/config.js` contiene `CLIENT_ID` dell'app registrata su Entra ID e gli scope richiesti.
Il redirect URI è l'origin corrente.
