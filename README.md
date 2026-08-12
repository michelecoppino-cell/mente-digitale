# Mente Digitale

Dashboard personale (PWA) che unifica l'ecosistema Microsoft 365 in un'unica "mente digitale":
una mappa mentale interattiva dei taccuini OneNote, un pianificatore giornaliero collegato a
Microsoft To-Do e al calendario Outlook, il flusso GTD delle attività, un diario e la
contabilità personale.

## Funzionalità

- **Mappa mentale (D3)** — taccuini e sezioni OneNote come grafo force-directed navigabile;
  badge con il numero di task aperti per sezione; "orb" centrale con documenti identitari
  (Bussola / Visione) salvati su OneDrive.
- **Pannello sezione** — pagine OneNote, task To-Do della lista omonima e link OneDrive
  per la sezione selezionata.
- **Pianificatore giornaliero** — drag & drop dei task su una timeline a slot di 30 minuti,
  vista giorno/settimana, eventi del calendario in sola lettura, sottostep ridimensionabili,
  piani salvati su OneDrive.
- **Oggi** — la home. Cosa c'è adesso (o subito dopo), l'agenda del calendario in sola lettura, le
  azioni programmate per il giorno, e a lato ricorrenze, diario e due riquadri ancora bloccati.
  Non ha una lista propria: è tutto una query sul giorno corrente.
- **Sezioni** — il workbook di una sezione PARA in tre colonne: pagine OneNote, file OneDrive,
  attività della sezione. È dove atterra il Pomodoro avviato dal Piano.
- **Attività** — le cinque colonne del flusso GTD (Inbox · Prossime azioni · In attesa · Programmate · Un giorno):
  la colonna *è* lo stato, e trascinare una card fra colonne lo cambia su Microsoft To-Do. Un clic su una
  card apre il pannello di dettaglio — note, sottoattività, stima, scadenza, stato.
  Il diagramma di *Chiarire* (dalla cattura o da una card di Inbox) può chiedere un
  parere: «Dove la metterei io» propone ramo, destinazione, titolo azionabile e stima,
  e apre la foglia già compilata — la conferma resta tua. Compare solo con la chiave
  configurata (vedi *Variabili d'ambiente*).
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
  incollare in una chat AI per chiedere supporto — e, se il deploy ha una chiave configurata,
  la stessa richiesta si può fare da lì con **Chiedi qui**, leggendo la risposta nell'app.
  Voci salvate su OneDrive in file mensili: il diario esce dal dispositivo solo quando sei tu
  a incollarlo o a premere quel pulsante. Diario e cattura sono sempre
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

Un tema solo, scuro, sempre — anche in **Finanze**, che arrivando da un'app a sé
seguiva la modalità del sistema operativo: con il Mac in chiaro si passava da
«Oggi» nero a «Finanze» bianca toccando una voce di menù. Ora la sua palette
(`src/finanze/finanze.css`) porta gli stessi valori dei token, accento ocra e
carattere Inter compresi.

I caratteri (Playfair Display, Inter) sono caricati con un `<link>` in
`index.html`, non con un `@import` dentro il CSS: dentro il foglio dell'app
sarebbero una richiesta in fila dopo il suo download, invece che in parallelo.

## Prestazioni

**Una vista, un pezzo.** Ogni destinazione è un chunk a sé, caricato alla prima
visita (`lazy` in `App.jsx`): l'app si apre su «Oggi», che è una lettura di dati
già in memoria, e non ha motivo di far scaricare prima la mappa mentale con d3,
la griglia del Piano, il Diario e la board delle Attività. Il primo caricamento
è passato da 272 kB di JS + 128 kB di CSS a 107 kB + 49 kB; d3 (115 kB) e
recharts (358 kB) non stanno più sul percorso critico. Piano e Attività vengono
poi precaricate in sottofondo, così il primo click resta immediato.

**Il sottofondo aspetta il suo turno.** Le letture d'avvio (taccuini, liste,
colori) partono insieme invece che una dopo l'altra. Tutto ciò che non serve al
primo schermo — pagine OneNote, eventi del calendario, Daily Review, scadenze —
è appeso a `requestIdleCallback` (`src/idle.js`) e non a `setTimeout` con numeri
scelti a mano: parte quando il browser è fermo, non mentre sta ancora
disegnando. Anche la serializzazione della cache su localStorage passa da lì.

**Il tempo del Pomodoro sta in un contesto suo** (`PomodoroTickContext`): prima
era nello stesso oggetto della sessione, quindi ogni componente che leggeva il
contesto — App compreso, che di suo usa solo `start` e `stop` — si ridisegnava
una volta al secondo, griglia del Piano inclusa.

## Accessibilità

- **`useDialog`** (`src/useDialog.js`) dà a ogni modale le tre cose che le
  servono: Escape che chiude da qualunque punto, Tab che resta dentro, e il
  fuoco che torna al comando che l'ha aperta.
- **«Salta al contenuto»**, primo elemento nella sequenza di tabulazione:
  prima si attraversavano panino, cattura, sette voci di menù e impostazioni
  prima di arrivare al contenuto, a ogni cambio di vista.
- I bottoni di sola icona hanno un `aria-label` — un `title` su una `✕` non
  basta, il lettore di schermo legge il glifo.
- `prefers-reduced-motion` spegne transizioni e animazioni in un blocco solo
  (`index.css`), scorrimenti compresi.

## Quando qualcosa non riesce

Le scritture verso Graph fallivano in silenzio: `catch (e) { console.error(...) }`
e la card che tornava al suo posto senza dire niente — in un'app che si usa in
mobilità, credere di aver spostato un'attività senza averlo fatto. Ora c'è un
canale di avvisi (`src/notify.js`, banner in `Toaster.jsx`, accanto a quello
dell'undo): un errore resta a schermo finché non lo si chiude, e dice cosa non è
riuscito. Sul lato rete, ogni chiamata — anche il PUT di un file su OneDrive o
il caricamento di una foto, che prima usavano `fetch` a mano — passa da
`callRaw` in `api.js`, quindi dagli stessi tentativi e dallo stesso giro extra
con un token fresco sul 401.

## Architettura

| Componente | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, react-router (hash), D3 per la mappa. Una vista per chunk, caricata a richiesta |
| Autenticazione | MSAL Browser (account Microsoft personale, scope Graph in sola lettura + To-Do/Files in scrittura) |
| Dati | Microsoft Graph (OneNote, To-Do, Calendar, OneDrive, Mail) con cache localStorage a TTL. I file JSON dell'app stanno nella cartella `mente-digitale/` di OneDrive (quelli rimasti in root vengono spostati automaticamente al primo avvio) |
| Backend | hosting statico su Cloudflare Pages, più **una** funzione: `/api/claude` |
| Automazioni | GitHub Actions (`sync-calendar`) |

Il browser parla direttamente con Microsoft Graph: OneNote, To-Do, calendario,
OneDrive, il diario e Finanze non passano da nessun server nostro, e Cloudflare
per loro serve solo i file.

L'unica eccezione è `functions/api/claude.js`, e c'è per un motivo preciso: una
chiave API non può stare nel codice del browser, dove chiunque apra gli strumenti
di sviluppo la vedrebbe. La funzione fa due cose, entrambe avviate da un pulsante
e mai da sole:

- **Chiarire assistito** — il pensiero appena catturato viene inviato al modello,
  che percorre il diagramma di *Chiarire* e propone ramo, destinazione PARA,
  titolo azionabile e stima. La proposta apre la foglia già compilata: crea
  qualcosa solo se la si conferma. Sta fra «Inbox» e «Che cos'è?», che è dove uno
  si fermerebbe a pensare.
- **Diario che risponde** — l'estratto che *Copia per l'AI* componeva per essere
  incollato altrove si può leggere qui: stesso testo, stesso preset, risposta
  dentro l'app. «Copia negli appunti» resta, e senza chiave configurata è
  l'unica strada.

La funzione si difende da sola: richiede il token Microsoft che l'app ha già in
mano, lo verifica contro Graph e accetta solo l'account elencato in
`UTENTE_AUTORIZZATO`. Senza quella variabile — o senza `ANTHROPIC_API_KEY` — si
dichiara spenta su `GET /api/claude` e l'app non mostra affatto i due pulsanti:
un pulsante che c'è e non funziona è peggio di un pulsante che non c'è. Vale
anche in sviluppo con `npm run dev`, dove le funzioni Cloudflare non girano.

Ci sono state, in passato, altre due funzioni — un piano generato con Claude
Haiku e un riassunto AI dei feed ANSA — e il README le ha descritte più a lungo
di quanto siano esistite. Quelle non sono tornate: non c'è nessuna vista del
briefing e nessuna generazione automatica del piano.

## Sviluppo

```bash
npm install
npm run dev       # dev server Vite
npm run lint      # ESLint
npm run build     # build di produzione in dist/
```

### Variabili d'ambiente (Cloudflare Pages)

Due, e servono solo alle funzioni AI. Senza di esse tutto il resto dell'app
funziona identico e i due pulsanti non compaiono.

| Variabile | Cosa contiene |
|---|---|
| `ANTHROPIC_API_KEY` | la chiave dell'API di Anthropic |
| `UTENTE_AUTORIZZATO` | il tuo indirizzo Microsoft (o l'id dell'account). Più di uno: separati da virgola |

`UTENTE_AUTORIZZATO` non è burocrazia: `/api/claude` spende soldi a ogni
chiamata, e senza quel controllo chiunque trovasse l'indirizzo potrebbe
spenderli. Vanno impostate entrambe — la funzione con una sola delle due si
considera spenta.

(Il workflow `sync-calendar` ha i propri segreti fra quelli di GitHub Actions.)

### Configurazione MSAL

`src/config.js` contiene `CLIENT_ID` dell'app registrata su Entra ID e gli scope richiesti.
Il redirect URI è l'origin corrente.
