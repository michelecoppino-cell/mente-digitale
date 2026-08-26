# Mente Digitale

Dashboard personale (PWA) che unifica l'ecosistema Microsoft 365 in un'unica "mente digitale":
una mappa mentale interattiva dei taccuini OneNote, un pianificatore giornaliero collegato a
Microsoft To-Do e al calendario Outlook, e un diario con supporto AI via copia-incolla.

## Funzionalità

- **Mappa mentale (D3)** — taccuini e sezioni OneNote come grafo force-directed navigabile;
  badge con il numero di task aperti per sezione; "orb" centrale con documenti identitari
  (Bussola / Visione) salvati su OneDrive.
- **Pannello sezione** — pagine OneNote, task To-Do della lista omonima e link OneDrive
  per la sezione selezionata.
- **Pianificatore giornaliero** — drag & drop dei task su una timeline a slot di 30 minuti,
  vista giorno/settimana, eventi del calendario in sola lettura, sottostep ridimensionabili,
  piani salvati su OneDrive. Candidati task estratti da email ed email OneNote con euristiche
  locali (`src/dailyReview.js`), senza chiamate AI.
- **Oggi** — la home. Cosa c'è adesso (o subito dopo), l'agenda del calendario in sola lettura, le
  azioni programmate per il giorno, e a lato ricorrenze, diario e due riquadri ancora bloccati.
  Non ha una lista propria: è tutto una query sul giorno corrente.
- **Sezioni** — la plancia operativa di una sezione PARA in cinque colonne: pagine OneNote,
  percorsi (cartelle, dischi di rete e link come pastiglie: le categorie OneDrive e Web aprono
  il collegamento, tutte le altre copiano il percorso), attività della sezione — che si
  trascinano sulla giornata per programmarle, come nel Piano e sullo stesso piano — il
  dettaglio di quella scelta e la giornata di oggi. L'elenco delle sezioni si toglie di mezzo
  appena se ne apre una. Una commessa con più **consegne** (liste To-Do annidate per nome,
  vedi sotto) le mostra come gruppi a tendina, ognuno con la sua scadenza; il `+` in testata
  ne crea una nuova, e un'attività si sposta da una consegna all'altra trascinandola.
  È dove atterra il Pomodoro avviato dal Piano.
- **Attività** — le cinque colonne del flusso GTD (Inbox · Prossime azioni · In attesa · Programmate · Un giorno):
  la colonna *è* lo stato, e trascinare una card fra colonne lo cambia su Microsoft To-Do. Un clic su una
  card apre il pannello di dettaglio — note, sottoattività, stima, scadenza, stato.
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
| `#/sezioni/:id` | Plancia della sezione: OneNote, percorsi, attività, dettaglio, oggi |
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

Quando però dove va la cosa **si sa già**, i due passi sono un giro a vuoto: si
cattura in Inbox per ripescarla dopo e rimetterla dove si sapeva fin dall'inizio.
Per questo la destinazione si può dire sulla stessa riga della cattura, e allora
il task nasce direttamente in sezione, saltando il chiarimento:

```
Rivedere relazione fondazioni @2573 !domani ~45
```

| Token | Cosa dice | Esempi |
|---|---|---|
| `@nome` | la lista To-Do di destinazione | `@2573`, `@ris-auto`, `@casa` |
| `!data` | la scadenza | `!oggi`, `!domani`, `!ven`, `!31/12`, `!2026-09-01` |
| `~n` | la stima, che diventa `[MIN:n]` | `~45`, `~90m`, `~2h` |

Scrivere `@` apre l'elenco delle sezioni, che si stringe man mano — frecce per
scegliere, `Invio` per scegliere e catturare in un gesto solo. L'ordine a elenco
vuoto è quello d'uso recente: le cose si buttano quasi sempre negli stessi tre o
quattro posti.

E quando la sezione è **già aperta a schermo** — la plancia di `#/sezioni/:id` —
non serve nemmeno scriverla: viene proposta da sola, e la chip la mostra accesa
col suo nome. La rotta dà una sezione OneNote, ma un task vive in una lista
To-Do, e una commessa può avere più consegne: quindi non si propone «la lista
della sezione», che spesso non esiste — si propongono **tutte le sue liste**, la
più usata di recente in cima e le altre a una freccia di distanza, sotto
l'intestazione della commessa. La proposta si smentisce come qualsiasi altra
destinazione: scrivendo `@`, scegliendone un'altra, o scegliendo Inbox apposta.
Il legame rotta → liste sta in `src/captureContext.js`.

Dire la destinazione resta **facoltativo**, ed è il punto: chi non scrive niente
batte `Invio` e cattura in Inbox esattamente come prima. Un token viene tolto dal
titolo **solo se ha risolto** — `@mario` dove nessuna sezione si chiama così
resta testo e il task va in Inbox — perché un parser che si mangia pezzi di
titolo è peggio di un parser che non fa niente. La sintassi sta in
`src/captureParse.js`, l'elenco in `src/DestinationPicker.jsx`.

**Decidi ora**, nella finestra di cattura, resta per il caso opposto: non che si
sappia dove va, ma che non si sappia. Apre il diagramma di chiarimento col testo
già dentro.

Allo stesso modo: il **contesto** (Lavoro / Personale / Famiglia) è in
`categories`, la **sezione** è la lista To-Do stessa, le **sottoattività** sono
i `checklistItems`, la **nota** è `body.content`.

Due cose sole non hanno una casa nativa in To-Do. La **stima di durata** sta
nelle note come marker `[MIN:45]`. La **persona che si aspetta**, quando un'attività
è in attesa, sta nella prima riga delle note come `In attesa da: Nome` — scritta
per esteso e non come codice, perché chi apre il task da To-Do legga una frase.

### Quanto dev'essere grande una cosa

Un promemoria, non un controllo: nessun avviso, nessun blocco. È il metro con
cui si decide se una cosa va spezzata, e sta scritto una volta sola in
`src/taskModel.js` (`GRANULARITY_MEMO`), da dove lo leggono il form della
consegna, la colonna Attività e le descrizioni degli strumenti MCP.

| Livello | Orientativamente |
|---|---|
| Sottoattività (`checklistItem`) | meno di **2 ore** |
| Attività (task To-Do) | meno di **2 giorni** |
| Consegna (lista annidata) | meno di **1 mese** |

Il senso è la scala: ogni livello è circa dieci volte quello sotto, così
guardando una lista si capisce a che altezza si sta ragionando. Una consegna che
dura più di un mese è un'altra commessa; un'attività da tre giorni sono più
attività travestite.

## Consegne dentro una commessa

Una lista To-Do è una sezione OneNote, per uguaglianza di nome. Ma una commessa
ha più consegne, ognuna con la sua data, e i gruppi di Microsoft To-Do non
servono a niente qui: **Graph non li espone** — `todoTaskList` non ha una
proprietà di gruppo padre, e non c'è un endpoint né in v1.0 né in beta. Quindi
la gerarchia sta nel nome, come già i prefissi PARA e il marker `[MIN:n]`:

```
GRUPPO.Consegna[-YYMMDD]

2573.A60-Fondazioni-260831   →  commessa 2573, consegna «A60-Fondazioni»,
                                scadenza 31/08/2026
```

- **Senza punto** il comportamento è quello di sempre, 1:1 col nome della
  sezione. La convenzione è opt-in: una commessa che non vuole consegne separate
  non cambia di una virgola, e nessuna lista viene mai rinominata o migrata
  automaticamente.
- **Con il punto**, la commessa è quel che sta prima del primo `.`, il resto è la
  consegna.
- La **scadenza** è solo l'ultimo segmento dopo l'ultimo `-`, e solo se è
  esattamente `\d{6}` ed è una data vera: il trattino è già dentro i nomi
  (`Coldbox-revB`), quindi tutto il resto fa parte del nome. La data non si
  mostra mai come pezzo di nome — è un campo, e si legge formattata con i giorni
  che mancano.
- **Appartenenza alla sezione**: la sezione che si chiama come la commessa,
  oppure che comincia con la commessa seguita da un carattere non alfanumerico
  (`2573` trova `2573-ABS`, `257` no). Prima il nome esatto, poi il prefisso; se
  restano più candidati non c'è collegamento — mai indovinare.

Tutto questo vive in `src/paraConfig.js` (`parseListName`, `listGroupKey`,
`listDeliverableLabel`, `listDueDate`, `sectionMatchesGroup`, `listsForSection`
e la composizione inversa `buildListName`): il nome si spezza in un punto solo.

**Nell'app**: la colonna Attività di *Sezioni* mostra le consegne come gruppi a
tendina — nome, scadenza con quanto manca (in scadenza si accende, scaduta di
più), attività aperte — e lo stato aperto/chiuso resta come lo si è lasciato. Il
`+` in testata crea una consegna con **due campi separati**, nome e data: il nome
composto lo scrive il codice, non l'utente. Cambiare la data di una consegna è
una rinomina della lista, fatta dallo stesso campo data. I colori seguono la
commessa: ogni consegna è una sfumatura del colore della sezione, così si
distinguono restando parenti.

Un'attività **si sposta da una consegna all'altra trascinandola** sul gruppo di
destinazione, che si accende quando la può accogliere — lo stesso gesto con cui
la si porta su Oggi. Microsoft To-Do non ha una «move»: il task viene ricreato
nella lista di arrivo e cancellato da quella di partenza (`moveTaskToList` in
`src/api.js`), quindi cambia id — viene riletto per intero prima di partire, o
le sottoattività resterebbero indietro. Lo spostamento si annulla dal solito
avviso in basso.

Nel serbatoio del *Piano* le consegne stanno sotto l'intestazione della loro
commessa, rientrate: lì non si richiudono, perché a nascondere quello che non
serve ci pensano già i filtri PARA/taccuino/sezione in cima alla colonna.

**Da riga di comando e via MCP**: `--sezione 2573` vale per l'intera commessa
quando i risultati sono tutti consegne dello stesso gruppo (gruppi diversi
restano un'ambiguità, cioè un errore). Per *creare* un'attività la consegna va
indicata: «tutta la commessa» non è un posto in cui scrivere.

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
| Backend | Nessuno: sito statico servito da Cloudflare Pages |
| Automazioni | GitHub Actions (`sync-calendar`) |

I dati utente non transitano da alcun backend: il browser parla direttamente con Microsoft
Graph. Non ci sono chiamate a nessuna API AI a pagamento: dove serve un aiuto dell'AI (Diario,
Finanze → Movimenti) l'app compone un prompt e lo mette negli appunti con un pulsante **Copia
per l'AI** / **Categorizza con Claude**; l'utente lo incolla in una chat Claude a parte e, se
vuole, incolla qui il risultato. Nessuna chiave API, nessun costo per token lato app.

## Fuori dall'app: riga di comando e server MCP

Le stesse operazioni dell'app, senza l'app: leggere OneNote, To-Do, calendario,
piani, Bussola e diario parlando direttamente con Microsoft Graph, e scrivere in
due punti soli — una voce di diario, un'attività su To-Do. Servono a guardare i
propri dati senza aprire il browser e, soprattutto, a metterli a disposizione di
un assistente come Claude: invece di incollargli il diario a mano, lo legge lui.

Tre file, uno sopra l'altro:

| File | Cosa fa |
|---|---|
| `scripts/mente-graph.mjs` | parla con Microsoft Graph: token, retry, la cartella `mente-digitale/` su OneDrive. È il gemello di `src/api.js` senza MSAL |
| `scripts/mente-comandi.mjs` | le operazioni, una funzione ciascuna, con le regole su cosa si può scrivere |
| `scripts/mente.mjs` · `scripts/mente-mcp.mjs` | i due modi di chiamarle: un terminale, o una chat |

Le regole stanno nel mezzo, una volta sola: le due strade non possono divergere.

### Da riga di comando

```bash
node scripts/mente.mjs aiuto            # tutti i comandi
npm run mente -- oggi                   # lo stesso, via npm

node scripts/mente.mjs oggi             # agenda, piano e conteggi del giorno
node scripts/mente.mjs attivita lista --stato next --sezione Casa
node scripts/mente.mjs diario leggi --giorni 30 --tag lavoro
node scripts/mente.mjs note leggi Manutenzioni --sezione Casa

node scripts/mente.mjs attivita crea "Preventivo caldaia" --sezione Casa --stima 20
node scripts/mente.mjs diario scrivi --testo "Giornata piena." --umore 4
```

Ogni comando accetta `--json`: la stessa risposta in una forma che un programma
— o un modello — legge senza doverla interpretare a occhio.

Non è un secondo modello di dati: le attività passano da `src/taskModel.js` e le
voci di diario da `src/diary.js`, gli stessi moduli dell'app — quindi il marker
`[MIN:45]`, la riga `In attesa da:` e la forma di una voce restano quelle di
prima. Un'attività creata da qui compare su To-Do e nell'app senza differenze.

**Cosa non fa.** Calendario, OneNote, Bussola, Visione e piani del giorno si
leggono soltanto. Sono le cose che non si ricostruiscono da una cronologia, e un
comando sbagliato — o un'AI troppo sicura di sé — non deve poterle toccare.
Restano fuori anche `scheduled` e `inbox` come stati scrivibili: il primo è un
blocco nel piano, il secondo è la lista di default, e si cambiano trascinando,
nell'app. Le Finanze non ci sono affatto: vivono in IndexedDB, dentro il browser.

### Come server MCP

`scripts/mente-mcp.mjs` espone le stesse operazioni come strumenti che un client
MCP può chiamare da solo durante una conversazione: si chiede *"come sta andando
la settimana?"* e il modello sceglie `oggi`, `attivita_lista` o `diario_leggi`
invece di farsi dettare un comando. Parla JSON-RPC su stdio, protocollo scritto a
mano — un handshake e tre metodi non valgono una dipendenza in un progetto che
non ne ha.

Il client lo avvia quando serve e lo chiude con la chat: non è un servizio che
resta acceso, e a client chiuso non esiste alcun processo.

Si registra una volta sola, dal terminale. `--scope user` lo rende disponibile
in ogni cartella invece che solo in questo progetto, e vale sia per la CLI sia
per l'app desktop, che leggono la stessa configurazione (`~/.claude.json`, cioè
`%USERPROFILE%\.claude.json` su Windows):

```bash
claude mcp add --scope user mente -- node /percorso/assoluto/scripts/mente-mcp.mjs
claude mcp list                        # deve dire "✔ Connected"
```

Il percorso va assoluto: il client avvia il processo dalla cartella che gli pare.
Non è un problema per il token, che il server cerca accanto a sé e non nella
cartella di lavoro.

Dentro una sessione, `/mcp` — scritto da solo, è un comando e non una domanda —
elenca i server e il loro stato. Il segno che gli strumenti stanno funzionando
davvero è che nella risposta compaiono chiamate a `oggi` o `attivita_lista`, e
non comandi `node scripts/mente.mjs`.

I dodici strumenti sono gli stessi comandi: `oggi`, `agenda`, `piano`, `sezioni`,
`attivita_lista`, `attivita_crea`, `attivita_stato`, `diario_leggi`,
`diario_scrivi`, `note_pagine`, `note_leggi`, `identita`. Quelli in sola lettura
sono marcati come tali (`readOnlyHint`), così un client che chiede conferma prima
di scrivere sa quando chiederla. Nessuno cancella niente: un'attività di prova si
può spuntare, non eliminare.

#### Dove funziona e dove no

Solo dove il client può avviare un processo **su questa macchina**:

| Dove | Funziona |
|---|---|
| CLI `claude` in un terminale | sì |
| App desktop, scheda **Code**, ambiente **Local** | sì |
| App desktop, sessione **Cloud** (icona della nuvola in cima alla sessione) | no |
| App desktop, schede **Chat** e **Cowork** | no |
| claude.ai nel browser, app sul telefono | no |

Una sessione Cloud gira in un container remoto: non ha il file del token, e non
è un difetto da aggirare — se lo avesse, vorrebbe dire che il token ha lasciato
il computer. È la confusione più facile da fare, perché l'app è la stessa: la
nuvola accanto al titolo della sessione è il modo per accorgersene.

Le schede Chat e Cowork prendono i connettori dall'account claude.ai, cioè server
MCP **remoti**, raggiungibili via HTTPS. Un server stdio come questo vive sul
disco e parla su una pipe: non è raggiungibile da lì, e non c'è percorso o
configurazione che lo renda tale. Servirebbe la versione remota — il server
esposto su internet con un'autenticazione propria, e la macchina sempre accesa.

Per client MCP diversi da Claude Code — che leggono un `claude_desktop_config.json`
o simile — l'entrata è la stessa in forma JSON:

```json
{
  "mcpServers": {
    "mente": {
      "command": "node",
      "args": ["C:\\percorso\\assoluto\\scripts\\mente-mcp.mjs"]
    }
  }
}
```

### Il token

Vale per entrambe le strade. Non c'è MSAL: si usa un refresh token, come
`sync-calendar.mjs`. Se ne prende uno con gli scope giusti — tutto in lettura,
scrittura su file e attività — e lo si tiene sulla propria macchina:

```bash
node scripts/get-refresh-token.mjs --mente
```

Il token va in `scripts/.mente-refresh-token` (ignorato da git) oppure nella
variabile `MENTE_REFRESH_TOKEN`, anche da un `.env` nella radice del progetto.
Ruota a ogni uso e il file viene riscritto, quindi non scade da solo.
Resta separato dal segreto `MS_REFRESH_TOKEN` di GitHub Actions, che continua a
poter fare pochissimo: solo mail e calendario, per la sincronizzazione. Quel file
è la chiave del OneDrive personale — vale quanto la password, e non va copiato in
posti in cui non metteresti la password.

**Su un secondo computer** si rifà il giro — Node, clone, token, `claude mcp add`
— e si genera un token **nuovo** invece di copiare il file: il refresh token ruota
a ogni uso, e due macchine che si passano la stessa copia finiscono prima o poi
con una delle due che si ritrova in mano un token già rinnovato altrove.

Il codice, invece, non si aggiorna da solo: il server esegue i file che stanno su
quel disco. Dopo un `git pull` va riavviata la sessione, perché il client avvia il
processo all'inizio della chat e lo tiene fino alla fine.

## Sviluppo

```bash
npm install
npm run dev       # dev server Vite
npm run lint      # ESLint
npm run build     # build di produzione in dist/
```

### Workflow git

Niente push diretto su `main`: ogni modifica va su un branch, poi pull request
e merge su `main`. La CI (type-check, lint, build) gira su ogni push e ogni PR.

### Configurazione MSAL

`src/config.js` contiene `CLIENT_ID` dell'app registrata su Entra ID e gli scope richiesti.
Il redirect URI è l'origin corrente.
