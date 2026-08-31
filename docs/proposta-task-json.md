# Proposta: i task su JSON nostri, non su Microsoft To-Do

> **Approvata, da costruire.** Questo documento è il mandato per la
> migrazione: contiene la decisione, il perché, la forma dei dati e l'ordine
> dei passi. È scritto per essere letto da chi apre il repo senza altro
> contesto.

## La decisione

I task escono da Microsoft To-Do e diventano file JSON nostri nella cartella
`mente-digitale/` di OneDrive, con lo stesso impianto già collaudato da diario
e movimento.

Il motivo è uno solo e va detto per primo, perché è quello che rende
irrilevanti tutti gli argomenti a favore di To-Do: **l'app To-Do non viene
usata**. I task si inseriscono e si spostano sempre e solo dalla mente
digitale, anche dal telefono. To-Do quindi non è un client, è un archivio —
scelto a suo tempo per un client che non si usa. E come archivio non regge il
confronto con un file nostro.

Vale la pena essere onesti su cosa **non** è il guadagno. Non è meno codice:
`taskModel.js` perde circa 150 righe di marker e parsing, e il nuovo strato di
archiviazione con la concorrenza ne aggiunge altrettante. Il guadagno è di
**aderenza**: oggi metà di quel codice spiega come aggirare Microsoft, domani
descrive il metodo GTD. E soprattutto è **composto**: oggi aggiungere un campo
significa inventare un marker, scrivere parser e serializzatore e sperare che
nessuno lo mangi; domani è una chiave nel JSON. Ordinamento manuale,
ricorrenze proprie, dipendenze fra attività, sottoattività annidate, storico
degli spostamenti — ognuna di queste oggi è un negoziato, domani è una riga.

## Le tre fragilità che spariscono

Non sono ipotesi, sono nel codice adesso, e nascono tutte dal piegare campi
altrui:

1. **Lo stato si scrive in due PATCH.** `handleChangeTaskStatus` in `App.jsx`
   scrive prima le note e poi lo `status`. Se la seconda chiamata fallisce
   (rete, 401, 429) il task resta con `Delegato a: Sara` nelle note e
   `notStarted` come stato: compare in *Prossime azioni* con dentro il nome di
   qualcuno. Due scritture perché lo stato è spalmato su due campi che To-Do
   non sa legare fra loro.

2. **Spostare un task fra sezioni può lasciare un doppione.**
   `moveTaskToList` (`src/api.js:413`) ricrea il task nella lista di
   destinazione e poi cancella l'originale, perché Graph non ha una move. Il
   commento della funzione lo ammette: un errore a metà lascia un doppione.

3. **La persona è una regex su testo libero.** `parsePersonLine`
   (`src/taskModel.js`) cerca `^In attesa da: …$` riga per riga nel body. Se
   To-Do restituisce il body come HTML invece che come testo — cosa che non
   controlliamo — il nome sparisce e con lui lo stato `delegated`, che
   degrada silenziosamente in `waiting`.

Nessuna delle tre esiste se lo stato è un campo.

> Nota su un bug già corretto, per non confondere le acque: lo spostamento fra
> colonne che tornava indietro al ricaricamento **non** era colpa di To-Do. Era
> `updateTasksEverywhere` in `App.jsx` che aggiornava lo stato React e la
> cache di sezione ma non quella di TanStack Query, che è l'unica persistita
> su localStorage e quindi l'unica che conta all'avvio. È già corretto. Va
> ricordato perché è la prova che il problema «tre copie della stessa verità»
> esiste a prescindere dall'archivio, e la migrazione non lo risolve da sola.

## Cosa si prende in carico

Tre cose che oggi fa Graph gratis. Sono delimitate, si scrivono una volta, e
vanno scritte **prima** di migrare — non dopo.

### 1. La concorrenza

`putDriveJson` (`src/api.js:211`) oggi è un `PUT` nudo: nessun ETag, nessun
`If-Match`, **last-write-wins silenzioso**. Con To-Do non ha mai fatto danni
perché Graph fondeva campo per campo lato server; con i file fa danni subito,
e li fa in silenzio — telefono e portatile che scrivono la stessa lista a
pochi secondi di distanza, e uno dei due perde.

Serve: leggere l'ETag insieme al contenuto, mandarlo come `If-Match` sulla
`PUT`, e sul **412 Precondition Failed** rileggere il file, riapplicare la
modifica sul contenuto fresco e riscrivere. Un solo giro di retry, poi
l'errore sale.

Questo pezzo è utile **anche senza la migrazione**: diario, movimento,
daily-plans, obiettivi, coda e rituale hanno oggi esattamente lo stesso
rischio. È il primo passo proprio per questo.

### 2. Lo schema, che cambierà

Ogni file porta un campo `version` **dal primo giorno**, prima ancora che
serva. Senza, la prima volta che si vorrà rinominare o ristrutturare un campo
ci si troverà file scritti in mesi diversi con forme diverse e nessun modo di
distinguerli. È l'errore che costa di più ed è una riga.

La lettura normalizza sempre: `leggiFile()` porta qualunque versione trovata
alla forma corrente in memoria, e la scrittura riscrive sempre nella versione
corrente.

### 3. Il guasto nuovo

Oggi un bug rovina un task; domani può azzerare un file, cioè una consegna
intera. Due difese:

- la **cronologia versioni di OneDrive**, che c'è già e non costa niente;
- un **controllo di sanità** in scrittura: rifiutare di sovrascrivere un file
  con uno che ha drasticamente meno task, a meno che la cancellazione non sia
  esplicita. Un file di task che diventa vuoto per sbaglio non deve poter
  essere scritto.

## La forma dei dati

### I file

```
mente-digitale/
  task/
    _liste.json               il registro delle liste (ex getTodoLists)
    <slug-lista>.json         un file per lista, i task dentro
  diario/                     diario-index + diario-YYYY-MM  (spostati qui)
  movimento/                  movimento-index + movimento-YYYY-MM  (spostati qui)
  diario-foto/                già esiste
  mente-digitale-*.json       i fissi restano dove sono
```

**Un file per lista, non per progetto.** Non perché un file per commessa
sarebbe troppo grosso — con qualche centinaio di task aperti si parla di un
centinaio di kilobyte in tutto, irrilevante — ma perché la lista **è già la
granularità del codice**: coincide con `qk.tasks(listId)`, con
`tasksCache.current[listId]` e con `_listId`, che compare 73 volte in 11 file
sempre come metà della chiave composta `(listId, taskId)`. Tenendo questa
granularità, `_listId` diventa semplicemente il nome del file e tutto il
codice che oggi ragiona per lista continua a ragionare per lista.

Un file per commessa obbligherebbe invece a reinventare il livello delle
consegne, che è l'unica cosa del modello PARA che oggi funziona senza
configurazione (liste To-Do annidate per nome, vedi `paraConfig.js`).

**Niente file indice dei task.** La tentazione c'è, perché la vista Attività è
trasversale alle liste e le servono tutti i file. Ma un indice è una cache che
si disallinea, cioè esattamente la classe di bug appena corretta, stavolta su
OneDrive e fra due dispositivi. Le liste si leggono tutte, come si fa oggi. Se
il numero di richieste diventerà un problema, la leva è `$batch` di Graph (20
file per richiesta), che è un miglioramento indipendente da questa scelta.

### Il task

Forma indicativa, da rifinire scrivendo il codice — il punto è che ogni cosa
abbia un campo suo:

```jsonc
{
  "version": 1,
  "listId": "AAMkAD...",           // = nome del file, ridondante ma comodo
  "listName": "STI2573",
  "tasks": [
    {
      "id": "AAMkAD...",            // l'id ORIGINALE di To-Do — vedi sotto
      "title": "Rivedere relazione fondazioni",
      "stato": "delegated",         // inbox|next|ask|waiting|delegated|someday|done
      "persona": "Sara",            // niente più riga nelle note
      "contesto": "lavoro",         // ex categories
      "stimaMin": 45,               // ex marker [MIN:45]
      "sveglia": "15:30",           // ex marker [SVEGLIA:15:30]
      "scadenza": "2026-09-01",
      "nota": "",                   // testo pulito, senza marker da spogliare
      "sottoattivita": [{ "id": "…", "titolo": "…", "fatta": false }],
      "creatoIl": "2026-08-31T09:12:00Z",
      "modificatoIl": "2026-08-31T09:12:00Z",
      "completatoIl": null
    }
  ]
}
```

Nota che `scheduled` **non** è uno stato scritto qui: resta derivato dalla
presenza di un blocco in `daily-plans`, esattamente come oggi. Un task ha uno
e un solo stato, e la colonna è derivata — l'invariante in testa a
`taskModel.js` non cambia.

### Gli id: non rigenerarli

**Gli id dei task restano quelli di To-Do.** È la trappola più facile da non
vedere: i blocchi in `daily-plans` referenziano i task per `b.taskId` (vedi
`indexScheduled` in `taskModel.js`), e anche le sveglie già suonate e i marker
di deduplica delle scadenze ricorrenti sono indicizzati per id. Se la
migrazione assegna id nuovi, il Piano si scollega da tutto ciò che è già
programmato e le sveglie già chiuse tornano a suonare.

I task creati dopo la migrazione useranno `crypto.randomUUID()`.

## I passi, in ordine

Ogni passo lascia l'app funzionante. I primi due sono utili comunque, anche
fermandosi lì.

### Passo 1 — ETag e concorrenza su `putDriveJson`

`If-Match` in scrittura, retry sul 412 con rilettura e riapplicazione.
Riguarda `src/api.js` e vale per tutti i documenti su OneDrive, non solo i
task.

*Fatto quando:* due schede aperte sullo stesso documento che salvano a
distanza di secondi non si cancellano più a vicenda.

### Passo 2 — Le sottocartelle

`diario/` e `movimento/`, e la predisposizione di `task/`. La cartella
`mente-digitale/` cresce di due file al mese (`diario-YYYY-MM` e
`movimento-YYYY-MM`) su una quindicina di fissi, ed è quella la pressione
vera; i file fissi restano in cima, perché sono una decina e non crescono.

Il meccanismo di migrazione **esiste già** ed è il modello da seguire:
`migrateLegacyFile` (`src/api.js:161`) sposta pigramente al primo 404, e
`migrateLegacyDriveFiles` (`src/api.js:184`) fa la passata unica. Va
generalizzato `drivePath()` per accettare una sottocartella e rifatta la
stessa migrazione un livello più in basso.

*Fatto quando:* i file di diario e movimento sono nelle loro cartelle, l'app
li legge, e un utente che apre l'app dopo l'aggiornamento non si accorge di
niente.

### Passo 3 — `taskStore.js`, con To-Do ancora sotto

Il nuovo strato di lettura/scrittura per file, con la concorrenza del passo 1
e la normalizzazione di versione. Scritto e testato **mentre la sorgente di
verità è ancora To-Do**, così nasce senza rompere niente.

*Fatto quando:* `taskStore.js` sa leggere e scrivere i file, con test o
verifica manuale, e l'app continua a girare su To-Do come prima.

### Passo 4 — La migrazione una tantum

Legge tutte le liste To-Do e i loro task, scrive i file JSON, **id
preservati**. To-Do resta esattamente com'è, non si cancella niente: è la rete
di sicurezza per le settimane successive.

*Fatto quando:* i file esistono e contengono tutti i task aperti, e un
confronto a campione fra i due archivi non trova differenze.

### Passo 5 — Ribaltare la sorgente e semplificare

L'app legge e scrive i file. Da `taskModel.js` spariscono `MIN_MARKER_RE`,
`ALARM_MARKER_RE`, `PERSON_LINE_RES`, `parseEstimate`, `withEstimateMarker`,
`parseAlarm`, `withAlarm`, `parsePersonLine`, `withPerson`, `noteText` e la
disambiguazione dentro `taskStatus`: lo stato è un campo, si legge.
`handleChangeTaskStatus` diventa una scrittura sola.

I 22 punti di `src/api.js` che chiamano `/me/todo/lists` (righe 266–1491)
vengono sostituiti dalle funzioni di `taskStore.js`. `LEGACY_EIS_MARKER_RE` e
la pulizia dei marker vecchi vanno tenute **solo** nel codice di migrazione,
non in quello corrente.

*Fatto quando:* l'app funziona interamente sui file, `npm run lint`,
`npm run typecheck` e `npm run build` sono puliti, e la vista Attività si
comporta come prima su tutti e otto gli stati.

### Passo 6 — CLI e server MCP

`scripts/mente-graph.mjs` (righe 366–417) e `scripts/mente-comandi.mjs`
parlano ancora con To-Do in 5 punti. Vanno portati anche loro, o resteranno a
leggere un archivio abbandonato.

*Fatto quando:* `npm run mente` crea, legge e sposta task sui file.

### Passo 7 — La rete di sicurezza si toglie

Solo dopo settimane di uso senza sorprese: si decide se cancellare le liste
To-Do o lasciarle lì congelate. Non è un passo tecnico, è una decisione da
prendere quando ci si arriva.

## Cosa non fare

- **Non rigenerare gli id** dei task migrati (vedi sopra).
- **Non introdurre un file indice** dei task: è la cache che si disallinea.
- **Non cancellare niente da To-Do** prima del passo 7.
- **Non saltare il passo 1**: senza ETag, la migrazione introduce perdita
  silenziosa di dati fra dispositivi.
- **Non toccare il modello delle sezioni.** «Una sezione è una lista» resta
  vero: cambia solo cosa c'è dietro la lista. `paraConfig.js`, i prefissi PARA
  e le consegne annidate per nome non si toccano.
- **Non aggiungere campi nuovi durante la migrazione.** Ordinamento manuale,
  dipendenze, sottoattività annidate: sono il motivo per cui si fa questo
  lavoro, ma vengono dopo, quando l'archivio è già cambiato. Una migrazione
  che aggiunge funzioni non si sa più se ha rotto qualcosa o se è nuova.

## Verifiche

```
npm run lint        # 24 warning preesistenti, 0 errori
npm run typecheck
npm run build
```

Nessuno dei tre deve peggiorare rispetto a `main`.

## Riferimenti nel codice

| Cosa | Dove |
|---|---|
| I 22 punti che parlano con To-Do | `src/api.js:266–1491` |
| Stato, marker, persona, parsing | `src/taskModel.js` |
| Le tre copie della cache dei task | `src/App.jsx`, `updateTasksEverywhere` |
| Caricamento task lista per lista | `src/App.jsx`, `preloadAllTasks` |
| Cambio stato con due PATCH | `src/App.jsx`, `handleChangeTaskStatus` |
| PUT senza ETag | `src/api.js:211`, `putDriveJson` |
| Migrazione file, modello da seguire | `src/api.js:161` e `:184` |
| Sezioni, prefissi PARA, consegne | `src/paraConfig.js` |
| Il flusso a otto stati, a parole | `README.md`, «Il flusso di un'attività» |
| To-Do nel CLI e nel server MCP | `scripts/mente-graph.mjs:366–417`, `scripts/mente-comandi.mjs` |
