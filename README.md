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
- **Oggi** — la home. Cosa c'è adesso (o subito dopo), l'agenda del calendario in sola lettura, le
  azioni programmate per il giorno, e a lato ricorrenze, diario e due riquadri ancora bloccati.
  Non ha una lista propria: è tutto una query sul giorno corrente.
- **Sezioni** — il workbook di una sezione PARA in tre colonne: pagine OneNote, file OneDrive,
  attività della sezione. È dove atterra il Pomodoro avviato dal Piano.
- **Attività** — le cinque colonne del flusso GTD (Inbox · Prossime azioni · In attesa · Programmate · Un giorno):
  la colonna *è* lo stato, e trascinare una card fra colonne lo cambia su Microsoft To-Do. Un clic su una
  card apre il pannello di dettaglio — note, sottoattività, stima, scadenza, stato.
- **Briefing notizie** — riassunti AI dei feed ANSA (mondo, Italia, Friuli) via `/api/briefing`.
- **Diario** (voce *Diario* nel menù, `⌘J`) — tre modalità distinte: *svuota testa* a schermo
  intero (timer 5/10 min, domanda selezionabile dall'elenco o rimovibile, righe che sbiadiscono
  mentre scrivi, pannello "come funziona" con il metodo e le fonti), *rituale della sera* (tre
  domande, gratitudini, umore ed energia) e *scrittura libera*, che è solo il foglio — niente
  timer, niente domanda, niente sfumatura, correttore acceso. Ogni voce esce con conserva /
  chiudi nel cassetto / lascia andare senza salvare. Ogni voce può portarsi dietro fino a otto
  **foto** con didascalia (una voce di sole foto è valida): l'immagine viene ridotta a 1600 px sul
  dispositivo e salvata come file in `mente-digitale/diario-foto/` su OneDrive — nel JSON del mese
  finisce solo il nome. Timeline con ricerca e tag. Il bottone
  **Copia per l'AI** compone il markdown di un periodo (con la Bussola come contesto) da
  incollare in una chat AI per chiedere supporto. Voci salvate su OneDrive in file mensili;
  il diario non passa da alcuna funzione server. Diario e cattura sono sempre
  raggiungibili dal menù, da qualunque vista.

- **Finanze** — contabilità personale, saldo reale e proiezione futura, assorbita dall'app
  omonima che prima viveva per conto suo. Nel menù è **una** voce; dentro, sette schede
  (saldo, analisi spese, proiezione, fatture, tasse, movimenti, impostazioni) che sono rotte
  vere, quindi indirizzabili e con il tasto indietro funzionante. Vedi sotto.

### Finanze

I dati stanno in **IndexedDB**, non su Microsoft Graph come il resto dell'app: sono un
singolo snapshot JSON (movimenti categorizzati, fatture, anni fiscali, mutui, parametri)
con la stessa forma del file di export. Il backup va su OneDrive in
`mente-digitale/mente-digitale-finanze.json`, con l'accesso Microsoft già fatto dall'app —
niente secondo login, niente registrazione Azure dedicata.

**Portare qui i dati della vecchia app**: quando Finanze era separata il backup viveva in
`Apps/Finanze/finanze.json`, una cartella che mente-digitale non può leggere (usava lo scope
`Files.ReadWrite.AppFolder` al posto di `Files.ReadWrite`). Si recupera una volta sola:
*Esporta JSON* dalla vecchia app, *Finanze → Impostazioni → Importa JSON* qui. Da lì in poi
la sincronizzazione riparte dalla cartella nuova.

**PIN.** La sezione si apre con un PIN numerico, si richiude da sola dopo mezz'ora e subito
col pulsante *Blocca* nella barra delle schede. Serve a non lasciare i conti in chiaro su uno
schermo aperto in ufficio: non è cifratura — i dati in IndexedDB restano leggibili a chi ha
accesso al browser e sa dove guardare, e sei cifre si provano tutte in un istante. Si cambia
o si toglie da *Finanze → Impostazioni*.

### Importare il Diario dell'iPhone

Due strade per la stessa cosa, con lo stesso parser (`src/appleDiary.js`) sotto: gli id
delle voci derivano dall'export, quindi importare due volte — o una volta per strada —
aggiorna le voci invece di sdoppiarle.

**Dal telefono** (`Diario → Importa dal Diario dell'iPhone`): si sceglie lo zip dall'app
File e l'app fa tutto, scrivendo direttamente sul OneDrive a cui è già collegata. Nessuna
estrazione, nessun passaggio da PC. Su iPhone è anche la strada migliore per le foto: Safari
decodifica gli HEIC di suo, quindi la conversione in JPEG avviene sul telefono. Un browser
che non li sa leggere le salta e lo dice, invece di caricare immagini che nessuno vedrebbe.

**Da PC**, per archivi molto grandi o per controllare il risultato prima che tocchi il
diario vero: `scripts/importa-diario-apple.mjs` converte l'esportazione dell'app **Diario di
Apple** (Impostazioni → Diario → *Esporta*) nel formato del Diario di Mente Digitale.

```bash
npm install
npm run importa-diario -- AnnotazioniDiarioApple.zip
```

Legge lo zip senza scompattarlo (lettore ZIP incluso: niente `unzip` da installare), ricava
da ogni pagina HTML data, titolo, testo e domanda di riflessione — che diventa il `seed`
della voce — e converte le foto **HEIC in JPEG** ridimensionati, il passaggio che rende
l'archivio leggibile fuori da Safari. Le voci diventano di tipo *scrittura libera*, con il
tag `iphone` per distinguerle (`--tag`).

Il risultato è una cartella `import-diario/` che riproduce la struttura di OneDrive
(`mente-digitale-diario-YYYY-MM.json`, l'indice dei mesi, `diario-foto/`): l'ultimo passo è
copiarla dentro `mente-digitale/` sul OneDrive. Lo script non scrive mai sul tuo OneDrive.

Opzioni utili: `--senza-foto` per portare dentro solo i testi e occuparsi delle immagini
dopo (rilanciando senza l'opzione le stesse voci si aggiornano, non si sdoppiano),
`--dry-run` per vedere cosa farebbe, `--tutti-gli-asset` per importare anche
le schede generate da iOS (mappe dei luoghi, allenamenti con distanza e tempo, stato
d'animo), `--max-lato` e `--qualita` per il peso delle foto. I video restano fuori — il
Diario non li mostra — ma vengono copiati in `media-non-importati/` invece di sparire.
Rieseguirlo è sicuro: id delle voci e nomi delle foto derivano dall'export, quindi un
secondo giro aggiorna le stesse voci invece di duplicarle, e i file già presenti nella
cartella di destinazione vengono uniti, non sostituiti.

### Due icone sulla schermata Home di iPhone

iOS ignora gli `shortcuts` del manifest: per avere più icone servono più pagine da
aggiungere alla Home. `public/gtd.html` e `public/diario.html` esistono per questo — hanno
icona, nome e status bar propri e, quando vengono lanciate dalla loro icona (`standalone`),
rimbalzano sull'app con `?apri=gtd` / `?apri=diario`, che `App.jsx` traduce nella cattura
rapida o nella rotta del Diario già al primo render. Viste in Safari restano invece ferme, altrimenti
si finirebbe per aggiungere alla Home l'app invece della scorciatoia.

Per installarle: apri `/gtd.html` (e poi `/diario.html`) in Safari → Condividi →
*Aggiungi a Home*.

## Navigazione

Sei destinazioni, ognuna con un indirizzo proprio. Il menù è il rail a sinistra
(216 px, riducibile a sole icone, drawer su schermo stretto); in cima il pulsante
**Cattura** (`⌘N` da qualunque vista).

| Rotta | Vista |
|---|---|
| `#/oggi` | Home di sola lettura: adesso, agenda, azioni di oggi, recap |
| `#/piano` | Il Piano: serbatoio, giornata a blocchi, capacità della giornata, pannello di dettaglio |
| `#/attivita` | Le cinque colonne del flusso, con la lente Scadenza (`?vista=`, `?ctx=`) |
| `#/sezioni/:id` | Workbook della sezione: pagine OneNote, file OneDrive, attività |
| `#/diario` | Diario |
| `#/mappa` | La mappa mentale |

Le rotte stanno nell'hash e non nel path: l'app è servita come sito statico da
Cloudflare Pages e, senza un `_redirects`, un ricaricamento su `/piano`
chiederebbe al server un file che non esiste. Con l'hash la rotta non lascia mai
il client, e le due pagine-scorciatoia (`/gtd.html`, `/diario.html`) restano
file veri.

**Movimento** e **Finanze**, in Oggi, sono due riquadri bloccati per davvero:
nel codebase non esiste una fonte dati né per gli allenamenti né per i conti,
quindi mostrano la forma sotto un velo e dicono cosa manca, invece di inventare
numeri. Non c'è nulla da premere finché una fonte non c'è.

Sopra il contenuto vive la **barra Pomodoro**: la sessione sta a livello di app
(`PomodoroSession.jsx`), quindi il timer continua a girare — e la barra resta
visibile — anche cambiando vista. Si avvia dal pannello di dettaglio del Piano,
che porta a `#/sezioni/:id`: è il passaggio che lega la programmazione al posto
di lavoro.

## Il flusso di un'attività

Sei stati, un solo verso, letti e scritti sui campi veri di Microsoft To-Do:
chi apre lo stesso task dall'app To-Do del telefono vede lo stesso stato. La
mappatura sta in `src/taskModel.js`.

| Stato | Dove vive su To-Do |
|---|---|
| `inbox` | lista di default (`wellknownListName === 'defaultList'`) |
| `next` | `status: notStarted` |
| `waiting` | `status: waitingOnOthers` |
| `scheduled` | ha un blocco nel piano del giorno (`daily-plans` su OneDrive) |
| `someday` | `status: deferred` |
| `done` | `status: completed` |

**Cattura** (`⌘N`) scrive solo il titolo, nella lista di default: il passo 1 non
deve chiedere niente, o le cose non si catturano. **Chiarire** è il passo 2 e
sta in un unico modale — contesto, sezione, durata, stato — ed è l'unico modo
di uscire da Inbox: un task catturato è solo testo, e per stare in un'altra
colonna gli serve almeno una sezione. Da lì passano anche le diramazioni del
metodo: sotto i due minuti si fa subito, dipende da altri diventa *In attesa*
con la persona, non adesso diventa *Un giorno*.

Allo stesso modo: il **contesto** (Lavoro / Personale / Famiglia) è in
`categories`, la **sezione** è la lista To-Do stessa, le **sottoattività** sono
i `checklistItems`, la **nota** è `body.content`.

Due cose sole non hanno una casa nativa in To-Do. La **stima di durata** sta
nelle note come marker `[MIN:45]`. La **persona che si aspetta**, quando un'attività
è in attesa, sta nella prima riga delle note come `In attesa da: Nome` — scritta
per esteso e non come codice, perché chi apre il task da To-Do legga una frase.

## Design token

Colori, tipografia, spazi, raggi e target di tocco stanno una volta sola in
`src/tokens.css`. I CSS per componente li leggono da lì: cambiare l'accento è
una riga, non una ricerca-e-sostituzione in dieci file.

## Architettura

| Componente | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, react-router (hash), D3 per la mappa |
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
