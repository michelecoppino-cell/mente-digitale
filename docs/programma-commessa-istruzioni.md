# Programma di commessa — istruzioni di costruzione

Compagno di `docs/proposta-programma-commessa.md`, che resta la fonte del
**modello dei dati** e del **perché**. Questo file decide la **forma**: le
misure, i gesti, la tastiera, i colori, e in che ordine costruire. Dove i due
documenti divergono, vince questo — la proposta lasciava sei cose aperte al
passaggio di design e qui sono chiuse.

Vincoli di scala su cui è dimensionato tutto (commessa reale di riferimento):
**5-8 risorse, 10-15 pacchetti, 3-6 mesi** — cioè 13-26 colonne di settimana.
Non 52. Questo è il motivo per cui lo zoom mensile non è nella v1: a 26 colonne
la matrice ci sta su un portatile e aggregare per mese nasconderebbe il dato
utile.

## Cosa entra nella v1

Matrice editabile · Attiva (genera l'attività) · Scomponi in figlie · Incolla in
massa · il delta voci ↔ carico sempre a schermo.

**Fuori dalla v1, dichiarato adesso:** saturazione sommata su tutti i programmi
attivi (nella v1 la saturazione si legge sul solo programma aperto), zoom
mensile, vista telefono completa, timesheet, dipendenze, costi in euro.

## 0. I paletti del progetto

Da `CLAUDE.md`, non negoziabili:

- rotta nell'hash: `#/programma`, montata con `lazy()` — non deve pesare
  sull'avvio;
- file nuovi **type-checked**: nessun `@ts-nocheck`, JSDoc come il resto;
- ogni scrittura passa da `putDriveJson` **con `reapply`** — il programma si
  tocca da portatile e telefono;
- niente push su `main`: branch, PR, e `typecheck && lint && build && prova`
  verdi;
- italiano: nomi, commenti, interfaccia, commit;
- colori solo da `src/tokens.css`. L'accento è **ocra** (`--accent #d4a44a`) e
  vale la regola del file: *una linea, un bordo, una velatura al 10%, mai una
  campitura piena su un'area grande*. La matrice è l'area grande per
  definizione: nessuna cella viene mai riempita di accento pieno.

## 1. File nuovi

```
src/programma.js              modello puro: settimane ISO, chiavi, conti, parse. TESTATO
src/programmaStore.js         registro + documento su OneDrive, reapply
src/ProgrammaView.jsx         guscio, testata, schede
src/ProgrammaView.css         classi pg-*
src/programma/Matrice.jsx     la matrice e la sua tastiera
src/programma/ElencoVoci.jsx  la seconda scheda
src/programma/DettaglioVoce.jsx
src/programma/AttivaVoce.jsx  il popover di attivazione
src/programma/IncollaVoci.jsx
```

`programma.js` non importa React e non tocca la rete: è il file su cui girano le
prove. Se una funzione ha bisogno del DOM o di `fetch`, sta nel posto sbagliato.

La settimana ISO (numero, lunedì della settimana, elenco fra due date) va in
`src/tempo.js` se lì c'è già la famiglia dei conti sul giorno locale — il giorno
e l'ora sono scritti una volta sola e la settimana è la stessa materia.
Altrimenti in `programma.js`, esportata.

Dati e strutture: **esattamente** quelli della proposta (`commessa`, `risorse`,
`pacchetti`, `voci`, `carico` come mappa piatta sparsa `risorsa|pacchettoId|YYYY-Www`).
Non ridisegnarli.

## 2. Il guscio

Tre colonne, la grammatica visiva di Sezioni. **Non** importare
`SectionsView.jsx` e non spezzarlo: sono 49k righe accoppiate alla loro vista.
Si copiano le **classi** in `ProgrammaView.css` col prefisso `pg-`, tenendo le
stesse misure e gli stessi token, così le due viste si somigliano senza
dipendere l'una dall'altra. Riferimenti utili in `SectionsView.css`: `.sv-cols`,
`.sv-col`, `.sv-col-head`, `.sv-col-label`, `.sv-col-body`, `.sv-col-detail`.

**Sinistra — 258px, `--bg-rail`.** I programmi con `attivo: true`, e sotto
ciascuno i suoi pacchetti con il pallino del colore e le ore. Scelto un
programma **la colonna si chiude** (come in Sezioni) e resta una striscia di
36px con il chevron per riaprirla: alla matrice servono tutti i pixel. I
pacchetti, chiusa la colonna, diventano una **fila di chip** sotto la testata —
lo stesso elenco, in orizzontale: click = filtra la matrice e la testata su quel
pacchetto, secondo click = torna a tutta la commessa.

**Centro.** Testata + due schede: **Matrice** ed **Elenco voci**.

**Destra — 306px, `--surface-2`.** Il dettaglio della voce selezionata. Non
esiste se non c'è una selezione: la colonna entra da destra e la matrice si
restringe (transizione `var(--t)`, nessun overlay).

## 3. La testata

Cinque numeri, ma non pari: **il margine è grande, gli altri quattro sono la
riga di controllo che lo spiega.**

```
┌──────────────────────────────────────────────────────────────────┐
│ 2573 · Sottopasso ferroviario                    ▸ pacchetti (12)│
│                                                                  │
│   + 84 h  margine          vendute 1 200 · stimate 1 116         │
│                            speso 430 · a finire 686              │
└──────────────────────────────────────────────────────────────────┘
```

- il margine in `--fs-row` × 2 circa (28-30px), `font-variant-numeric:
  tabular-nums`, con il segno sempre esplicito: `+ 84 h` / `− 84 h`;
- i quattro numeri di controllo in `--fs-meta`, etichetta in `.eyebrow` sotto il
  numero, su due righe da due;
- **margine positivo:** numero in `--text`, nessun colore. Non è un premio;
- **margine negativo:** numero in `--danger`, e sotto una riga sola in
  `--fs-micro` che dice *dove*: `il rosso viene da A60 (+50) e A70 (+34)` —
  i due pacchetti che sforano di più. Un margine negativo senza il dove
  costringe a cercarlo a mano, ed è la prima cosa che si vuole sapere;
- **nessuna barra di avanzamento.** Speso e a finire non sono un progresso
  verso il 100%: sono due stime che si sommano contro un contratto, e una barra
  suggerirebbe che riempirla sia l'obiettivo.

Con un pacchetto selezionato: **gli stessi cinque numeri per il pacchetto**, e
accanto al margine il delta voci ↔ carico:

```
   + 12 h  margine A60      voci 320 · a piano 280 · 40 h da collocare
```

«**da collocare**», non «non allocato». È un lavoro che manca, non un errore, e
si scrive in `--muted`; passa in `--accent` solo se ci si clicca sopra, perché è
un filtro: click → scheda Elenco voci, filtrata sulle voci di quel pacchetto
senza ore a piano.

Se il delta è zero la frase **non compare**. Un contatore fermo a zero è rumore.

## 4. La matrice

### Geometria

| | |
|---|---|
| colonna risorsa | 220px, `position: sticky; left: 0`, fondo `--surface` |
| colonna settimana | 52px (min 44px), testo a destra, `tabular-nums` |
| colonna totale | 64px, sticky a destra, `--surface`, testo `--text-3` |
| altezza riga | 32px |
| testata colonne | due fasce: mese (`mar`, `apr`) su `--fs-micro` `--muted`, e sotto `W12` con la data del lunedì in `--fs-micro` |
| riga totali | in fondo, `position: sticky; bottom: 0`, bordo alto `--line` |

Le 32px di riga sono sotto il `--tap` di 44: **è un'eccezione dichiarata**,
perché questa vista è da portatile e non esiste su telefono (§8). Non
propagarla ad altro.

La fascia del mese non è decorazione: con 26 colonne è l'unico modo di sapere
dove si è senza contare le settimane.

L'ampiezza va da `commessa.inizio` a `commessa.fine`, scavalcabile con
`settimaneDa`/`settimaneA`. **La settimana corrente** ha il fondo appena più
chiaro (`--surface`), la data in `--accent` e una linea di 2px `--accent-line`
in cima alla colonna che scende per tutta l'altezza: è il taglio fra speso e a
finire, cioè la cosa che dà senso ai numeri della testata.

All'apertura la matrice scorre in modo che la settimana corrente stia a un
terzo da sinistra: si vuole vedere un po' di passato e molto futuro.

### Righe

Chiusa, una riga per risorsa: il **totale della persona per settimana** su tutta
la commessa. Aperta (chevron, o Space sulla riga), si spezza in una sotto-riga
per pacchetto — solo i pacchetti in cui quella persona ha ore, più una riga
vuota `+ pacchetto` per aggiungerne uno.

- riga risorsa aperta: nome in `--text`, valori in `--text-3` (sono una somma,
  non un dato che si scrive), bordo basso `--accent-line`;
- sotto-riga: rientro 16px, pallino 7×7 del colore del pacchetto, nome in
  `--text-2`, valori in `--text` — **si scrive solo qui**;
- chiusa, i valori sono editabili solo se la persona ha un pacchetto unico;
  altrimenti scrivere in una riga chiusa non ha una destinazione, e la cella
  rifiuta l'input aprendo la riga. Non un errore: l'apertura *è* la risposta.

Cella vuota: **vuota**. Nessuno zero, nessun trattino.

### Saturazione

Colore sul confronto fra il totale della persona in quella settimana e la sua
`oreSettimana` (default 35), **sul solo programma aperto** nella v1 — e la nota
va scritta in chiaro nel codice, perché è l'approssimazione che si vorrà togliere.

| | |
|---|---|
| < 90% | nessun fondo, valore `--text` |
| 90-100% | velatura `--accent-tint`, bordo basso 1px `--accent-line` |
| > 100% | velatura `rgba(192,122,122,.12)`, bordo basso 2px `--danger`, valore `--danger` |

Tre stati, letti dal **bordo basso** oltre che dal fondo: la velatura al 12% su
una cella di 52px è al limite del percepibile, la linea no. Sulla riga risorsa
chiusa la saturazione si vede; sulle sotto-righe no — una persona è satura, un
pacchetto non lo è.

### Scrivere nelle celle — i tre gesti

Sono i gesti che si fanno cento volte: vanno tutti e tre, e vanno da tastiera.

**1. Digita e passa.** Le frecce muovono la cella attiva. Una cifra entra in
edit e sostituisce; `Tab`/`→` conferma e va a destra, `Enter`/`↓` conferma e va
sotto, `Esc` annulla, `Backspace` svuota. Ammessi interi e mezze ore (`4`,
`4.5`, `4,5`); tutto il resto si rifiuta senza svuotare la cella.

**2. Seleziona un intervallo e spalma.** `Shift`+frecce, o trascinamento del
mouse, selezionano un rettangolo (bordo 1px `--accent`, fondo `--accent-tint`).
Digitando un numero compare una barretta inline sopra la selezione con due
scelte, e il risultato già scritto:

```
  40  →  [ 40 h in ogni settimana ]  [ 40 h in tutto = 5 h × 8 ]
            Enter                        ⌥Enter
```

Non si indovina quale delle due voglia: si mostrano entrambe col numero
calcolato. La ripartizione «in tutto» va a mezze ore, e il resto si appoggia
sulle **prime** settimane — davanti si sa qualcosa in più che in fondo.

**3. Trascina il bordo per ripetere.** Il quadratino in basso a destra della
cella (o della selezione) si trascina in orizzontale e ripete il valore. Solo
orizzontale: verso il basso vorrebbe dire duplicare le ore di una persona su
un'altra, che non è mai quello che si intende.

**Annulla obbligatorio.** `⌘Z`/`Ctrl+Z` sulla matrice, pila locale delle ultime
20 modifiche. Un trascinamento sbagliato riscrive un mese in un secondo, e
senza annulla la matrice diventa una cosa che si tocca con paura.

### Salvataggio

Le celle si accumulano in locale e si scrivono con un debounce di 800ms in
**una** `putDriveJson`. Il `reapply` unisce **per chiave**, non per documento: il
carico è una mappa piatta apposta, quindi chi ha scritto da un altro dispositivo
mantiene le sue celle e le nostre vincono solo dove abbiamo toccato. Chiavi con
valore `0` si **cancellano** dalla mappa invece di salvare uno zero — la mappa
resta sparsa, che è il motivo per cui esiste in quella forma.

Indicatore di stato accanto al titolo della scheda, in `--fs-micro`
`--muted`: `salvato` / `salvo…` / `non salvato — riprovo`. Niente spinner.

## 5. La scheda Elenco voci

Seconda scheda accanto a Matrice, non una colonna: le voci si leggono a tutta
larghezza e si selezionano a decine.

Una riga per voce, gerarchia a rientro per `padreId`:

```
│ A60 Fondazioni                          360 h   410 h ▲+50    3 voci
│  ▏ Calcolo plinti P1-P4        Marco     80 h    ⟶ attiva
│  ▏ Relazione geotecnica        —        120 h    prevista
│  ▏ Verifica cedimenti          Anna      40 h    ✓ fatta
```

Lo **stato derivato** si legge prima del titolo, per forma e per parola, non per
colore:

| stato | segno | testo |
|---|---|---|
| prevista | bordo sinistro 2px `--line` | titolo `--text-2` |
| attiva | bordo sinistro 2px `--accent` + velatura `--accent-tint` | titolo `--text`, e a destra lo stato del task letto dal pool (`delegata a Marco`, `in attesa`, `nel piano di giovedì`) |
| fatta | bordo sinistro 2px `--ok` + spunta | titolo `--muted` |
| scartata | opacità .45 | titolo `--disabled`, nascosta di default |

Una voce con figlie è un **contenitore**: `ore` è la somma delle figlie e non si
scrive; la cifra è in `--text-3`, e accanto il delta con `oreIniziali`
(`▲+50` in `--accent`, `▼−20` in `--muted`) — il delta non è un allarme, è
informazione, e va in accento solo verso l'alto.

Filtri in una riga sola sopra l'elenco: pacchetto · risorsa · stato · «senza ore
a piano». Selezione multipla con checkbox e `Shift`+click → **Attiva in blocco**
(§7). È il gesto del lunedì mattina e non è un extra.

## 6. La colonna di dettaglio

Titolo (editabile in linea), stato derivato in cima come pastiglia, poi:
pacchetto, ore, `oreIniziali` in sola lettura, risorsa proposta, finestra
(due tendine di settimana), note (textarea che cresce).

In fondo, i due gesti, e nient'altro:

```
   [ Scomponi ]   [ Attiva… ]
```

Se la voce è già attiva, `Attiva…` è sostituito da un collegamento al dettaglio
dell'attività vera (`Apri l'attività ›`) — da lì in poi il programma **racconta**
e non comanda. Se la voce ha figlie, `Attiva…` non c'è: si attiva solo una
foglia, e sotto i bottoni sta il memo di `taskModel.js`
(`GRANULARITY_MEMO_LINE`) in `--fs-micro`. È il posto giusto per ricordare
quanto è grande un'attività.

## 7. Scomponi e Attiva

**Scomponi** — non un modale: sotto la voce si apre un campo multiriga, una
figlia per riga, con la sintassi `titolo | ore`. Alla conferma le figlie nascono
tutte insieme, `ore` del padre diventa la loro somma, `oreIniziali` del padre
non si tocca mai. Se la somma delle figlie è diversa dalle ore del padre, la
differenza si mostra in `--muted` prima di confermare: `410 h di figlie contro
360 h — il padre passa a 410`. Si conferma sapendo cosa cambia.

**Attiva** — popover ancorato al bottone, tre campi già compilati:

- **risorsa**: `voce.risorsa`, con il `DestinationPicker` che si scrive e si
  stringe (stesso schema, non una `<select>`);
- **scadenza**: il venerdì della settimana `finestra.a`, o oggi + 2 settimane;
- **lista**: `pacchetto.listId` se c'è; altrimenti il nome **proposto** dalla
  convenzione PARA di `paraConfig.js` (`2573.A60-Fondazioni-260831`), scritto in
  chiaro con la nota `la lista non esiste ancora, la creo`. La creazione è
  visibile prima di avvenire.

Un solo bottone primario, `Crea l'attività` (`⌘Enter`). Stato del task:
`delegated` + `persona` se la risorsa è un'altra persona, `next` se è tua.

**Impossibile per sbaglio, veloce dieci volte di fila.** Le due cose stanno
insieme così: nessun passaggio di conferma — la sicurezza è **l'annulla**. Alla
creazione un toast per 8 secondi con il titolo del task creato, `Apri` e
`Annulla`; l'annulla cancella il task e riporta la voce a prevista. E il popover
non si chiude: passa alla voce successiva dell'elenco con `Attiva e prossima`,
così dieci attivazioni sono dieci `⌘Enter`.

In blocco: un popover solo per l'intera selezione, con una riga per voce e la
risorsa modificabile riga per riga; scadenza e lista comuni. Alla conferma le
attività si creano in sequenza e il toast finale dice quante
(`7 attività create · Annulla`).

## 8. Telefono

`#/programma` sotto gli 860px mostra: colonna di sinistra, elenco voci,
dettaglio. **Nessuna matrice, nessun surrogato.** Se lo spazio non basta, la
scheda Matrice non compare e al suo posto sta una riga sola: `la matrice si
apre da portatile`. Non un Gantt in miniatura: sarebbe illeggibile e si
correggerebbero celle sbagliate con il pollice.

## 9. Ordine di lavoro

Una PR per riga, ognuna verde e provabile da sola con `npm run dev:finto`.

1. **`programma.js` + prove.** Settimane ISO fra due date, chiavi del carico,
   somme (speso / a finire / margine), delta voci ↔ carico, stato derivato di
   una voce, spalmatura di N ore su k settimane, parse dell'incolla in massa.
   Nessuna interfaccia. Le prove sono la specifica dei conti.
2. **`programmaStore.js` + un programma finto in `src/finto/`.** Registro,
   lettura, scrittura con `reapply` che unisce per chiave. Prova: due scritture
   concorrenti sullo stesso documento non si mangiano le celle.
3. **Guscio + testata**, dati veri, matrice ancora in sola lettura.
4. **Matrice editabile**: i tre gesti, la tastiera, l'annulla, il debounce.
   La PR più grossa: se cresce troppo, si spezza in «lettura + navigazione da
   tastiera» e «scrittura».
5. **Elenco voci + dettaglio + Scomponi.**
6. **Attiva**, singola e in blocco, col toast di annullamento.
7. **Incolla in massa**: casella con `pacchetto | titolo | ore | risorsa`,
   anteprima di quante voci e quanti pacchetti nuovi prima di confermare. I
   pacchetti sconosciuti si creano; nessuna lista viene creata qui — le liste
   nascono solo attivando.

Nel README, un paragrafo nella sezione delle viste: cos'è il Programma, perché
non è il Piano, e la frase che rende il rischio accettabile — **nessun'altra
vista dipende da questo**: se il Programma viene abbandonato restano un JSON e
una voce di menu, e le attività già attivate non sanno nemmeno di essere nate lì.

## 10. Le tre cose da non sbagliare

1. **Voci e celle non si derivano l'una dall'altra.** Sono due dati veri, e il
   valore del pannello è il delta fra loro sempre a schermo. Chi in futuro
   proporrà di spalmare le voci automaticamente sulle settimane sta proponendo
   di cancellare il motivo per cui questo esiste.
2. **La voce non diventa mai un'attività: ne genera una.** Il legame è in una
   direzione sola, `voce.taskId`; il task non sa nulla del programma.
3. **Prima dell'attivazione una voce non esiste da nessuna parte** tranne che
   qui. Non nel pool, non nel Piano, non suona, non scade. Zero rumore per
   costruzione — non per un filtro che qualcuno si ricorda di applicare.
