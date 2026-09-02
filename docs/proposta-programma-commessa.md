# Proposta: il Programma di commessa

> **Proposta, non ancora costruita.** Qui non c'è codice e nell'app non è
> cambiato niente. Serve a decidere *cosa* costruire — e a portare il
> ragionamento al passaggio con Claude Design senza rifarlo da capo.
>
> La richiesta era: *sono coordinatore dell'ingegneria su una commessa da un
> anno, devo fare l'analisi delle ore a finire divise per pacchetti e assegnare
> le cose alle risorse un po' alla volta. Voglio scrivere tutto l'elenco subito,
> ma non voglio che diventino subito task veri, o mi riempio di rumore con cose
> che faremo fra due mesi.*

## Il problema, detto bene

Le attività della Mente Digitale sono **cose da fare adesso**: stanno in una
lista, hanno uno stato, compaiono nel pool, si trascinano nel Piano. Una
commessa da un anno ha duecento cose da fare di cui centottanta cominciano fra
mesi. Metterle tutte fra le attività vuol dire spegnere lo strumento: il pool
smette di essere «cosa faccio oggi» e diventa un archivio.

Ma il pezzo che manca non è nemmeno un elenco di task futuri. È un'altra cosa,
che oggi vive negli Excel: **quanto costa questa commessa, come si divide in
pacchetti, chi la fa, e quanto manca**. Un piano, non delle attività.

Quindi non serve un secondo tipo di task. Serve uno strato **sopra**, e un
gesto che lo unisce a quello che c'è già.

## L'idea in una riga

**Una voce di programma non è un'attività, e non lo diventa mai — ne *genera*
una, il giorno in cui la assegni.** Quel giorno la voce resta dov'è e comincia
a raccontare cosa sta succedendo al task che ha generato.

Prima dell'attivazione la voce non esiste da nessuna parte tranne che nel
Programma: non è nel pool, non è nel Piano, non suona, non scade. Zero rumore,
per costruzione — non per un filtro che qualcuno si ricorda di applicare.

## Perché non è un doppione del Piano

Il Piano è la **giornata**: fasce da mezz'ora, blocchi trascinati, l'orologio.
Il Programma è **l'anno**: settimane, ore aggregate, persone. Non si toccano, e
l'unico punto di contatto è il task attivato, che dal Piano si comporta come
qualunque altro.

## Cosa c'è già e non va rifatto

La Mente Digitale ha già tutto lo strato dell'esecuzione:

- lo stato `delegated` e il campo `persona` — la delega è già un concetto vero,
  con la sua colonna in Attività;
- `scadenza` — è così che sai quando qualcuno deve aver finito;
- `stimaMin` — la stima di un'attività;
- la convenzione `2573.A60-Fondazioni-260831` in `paraConfig.js` — commessa,
  consegna, scadenza, già lette dal nome della lista;
- `DestinationPicker`, il pool, il dettaglio task.

Il Programma non ridefinisce niente di tutto questo. Ci si appoggia.

## I dati

Un documento per commessa, su OneDrive come tutto il resto: `putDriveJson`,
ETag, `If-Match`, `reapply` (il programma si tocca dal portatile e dal telefono,
quindi il `reapply` non è opzionale).

```
programmi/_registro.json    { version, programmi: [{ id, nome, file, attivo }] }
programmi/<id>.json         { version, commessa, risorse, pacchetti, voci, carico }
```

Il flag `attivo` nel registro è la risposta a «un pannello dedicato solo per le
sezioni che attivo»: la colonna di sinistra mostra quelli accesi, gli altri
restano su disco.

### La commessa

```
commessa: {
  nome, codice,
  oreVendute,            // il numero contrattuale: è il metro di tutto
  inizio, fine,          // 'YYYY-MM-DD' — danno l'ampiezza della matrice
  settimaneDa, settimaneA // scavalco manuale dell'orizzonte, quando serve
}
```

### Le risorse

Non un'anagrafica nuova: **le stesse stringhe del campo `persona` dei task**,
così un task delegato e una riga della matrice parlano della stessa persona
senza tabelle di conversione. Qui la risorsa porta solo quello che il programma
aggiunge:

```
risorse: [{ nome, oreSettimana }]     // oreSettimana: la capacità, default 35
```

La capacità non è un dettaglio: senza, una matrice risorsa × settimana ti dice
quante ore hai messo, mai se sono troppe. Ed è il motivo per cui la saturazione
va letta **sommando tutti i programmi attivi**: una persona è satura o no nella
sua settimana, non dentro una commessa.

### I pacchetti (i sotto-progetti)

```
pacchetti: [{ id, nome, listId | null, colore }]
```

`listId` è **opzionale e nasce vuoto**. Una commessa con quindici pacchetti non
deve creare quindici liste vuote nella vista Attività: sarebbe il rumore che
questa proposta esiste per evitare. La lista nasce alla **prima attivazione** di
una voce del pacchetto, e da quel momento `listId` la ricorda. È lo stesso
principio dei prefissi PARA: la convenzione è opt-in e chi non la usa non paga
niente.

### Le voci

```
voci: [{
  id, titolo, nota,
  pacchettoId,
  padreId | null,        // la scomposizione: una voce dentro un'altra
  ore,                   // la stima corrente
  oreIniziali,           // la stima della prima volta — non si riscrive mai
  risorsa | null,        // a chi la darei: una previsione, non un impegno
  finestra: { da, a } | null,   // settimane, grossolane
  scartata,              // l'unico stato salvato
  taskId | null, listId | null  // il legame, dopo l'attivazione
}]
```

**Lo stato di una voce è derivato, non un campo.** Esattamente come `scheduled` e
`inbox` per un'attività:

| | |
|---|---|
| `taskId == null` | **prevista** — esiste solo qui |
| task aperto | **attiva** — c'è un'attività vera che la sta facendo |
| task `done` | **fatta** |
| `scartata` | **fuori** — l'unica cosa che si scrive |

Non c'è niente da tenere in pari a mano, che è la classe di difetti da cui
nascono le schermate che mostrano la versione di prima.

Il legame va in **una direzione sola**: la voce cita il task per id, il task non
sa nulla del programma. Regge perché gli id delle attività non si rigenerano
mai, nemmeno spostandole di lista.

### La scomposizione, e perché `oreIniziali`

Una voce può nascere da 360 ore. Non è un errore da impedire: all'inizio di una
commessa il dettaglio non c'è, e costringersi a inventarlo produce un piano
falso. Man mano che si capisce, la voce prende delle figlie.

Quando una voce ha figlie, **`ore` è la loro somma** — non un numero scritto a
mano che smette di tornare. Ma `oreIniziali` resta quello del primo giorno, e la
differenza fra i due è la cosa più utile che il Programma sappia dire:

> A60 Fondazioni: venduta 360h, dettagliata 410h → **+50h**

È una baseline da poveri e costa un campo.

Attivabile è solo una **foglia**: una voce con figlie è un contenitore, e
generare un task da 360 ore vorrebbe dire mettere nel pool una cosa che non si
può fare. (Il memo in `taskModel.js` dice già quanto è grande un'attività: meno
di due giorni. Al momento dell'attivazione è il posto giusto per ricordarlo.)

### Il carico

```
carico: { '<risorsa>|<pacchettoId>|<YYYY-Www>': ore }
```

Una mappa piatta, chiave composta, valori sparsi: una commessa da un anno con
sei risorse e dieci pacchetti ha 3.000 celle possibili e forse duecento piene.
Salvare la matrice densa vorrebbe dire scrivere zeri su OneDrive per un anno.

## I due numeri che non devono coincidere

Questo è il punto che decide se il Programma è utile o è un secondo Excel.

Le ore stanno scritte in **due posti**: nella stima delle voci, e nelle celle
del carico. Non sono lo stesso dato:

- la **voce** dice *cosa c'è da fare e quanto pesa* — è il contenuto;
- la **cella** dice *quante ore di quella persona vanno lì quella settimana* —
  è il carico.

Non vanno derivate una dall'altra. Spalmare automaticamente le voci sulle
settimane produce un piano che nessuno riconosce; ricavare le stime dal carico
perde il «cosa». Quello che serve è **il delta, sempre a schermo**:

> A60 Fondazioni — voci 320h · a piano 280h · **40h non allocate**

È esattamente la domanda del coordinatore, ed è l'unico modo di tenere due dati
veri senza inseguirli a mano.

## Ore a finire, senza timesheet

Una commessa venduta a ore ha bisogno di sapere quanto è già stato speso, e
mettere in piedi un timesheet vorrebbe dire un secondo lavoro accanto al lavoro
— la stessa strada che ha ucciso il Pomodoro qui dentro (vedi
`roadmap-produttivita.md`).

**La colonna della settimana corrente taglia la matrice in due.** A sinistra c'è
il passato: quelle celle si correggono con quanto è andato davvero, quando ci si
passa sopra. A destra c'è la previsione.

```
speso     = somma delle celle fino alla settimana corrente
a finire  = somma delle celle dalla settimana corrente in poi
margine   = oreVendute − (speso + a finire)
```

Un dato solo, nessun secondo inserimento. È un'approssimazione — è la stessa che
si fa a mente guardando un Excel, ed è abbastanza per decidere.

## Cosa il Programma non fa

Deciso adesso, per non riscoprirlo:

- **niente timesheet**, per il motivo qui sopra;
- **niente dipendenze, percorso critico, livellamento automatico, calendari
  risorse**. Le finestre sono grossolane apposta: servono a decidere cosa
  attivare la settimana prossima, non a produrre un Gantt che nessuno aggiorna;
- **niente attivazione automatica**. Il Programma può *segnalare* che una
  finestra apre fra due settimane e la voce è ancora prevista. Segnala, non
  crea: il momento in cui una cosa entra nel pool è una decisione;
- **niente costi in euro**. Ore, che è come si vende e come si ragiona.

## Il pannello

Rotta `#/programma`, in `lazy()` come tutte le viste che non sono Oggi. Su un
telefono la matrice non ci sta, e non ci deve stare: la dashboard è una vista da
portatile.

Il guscio è quello di **Sezioni**, che questa forma la sa già fare:

**Colonna di sinistra — i programmi attivi.** Sotto ogni programma, i suoi
pacchetti. Si sceglie e la colonna si chiude, come in Sezioni.

**Testata — i numeri della commessa.** Vendute · stimate (somma voci) · speso ·
a finire · margine. Cinque numeri, e il margine è quello che si guarda per
primo. Quando è selezionato un pacchetto, gli stessi cinque numeri per il
pacchetto, col delta voci ↔ carico accanto.

**Centro — la matrice.** Una colonna per settimana ISO (`W12`, e sotto la data
del lunedì), una riga per risorsa. La riga chiusa dice il totale della persona
su tutta la commessa; aperta si spezza in una sotto-riga per pacchetto. Le ore
si scrivono nella cella.

- l'ampiezza va da `inizio` a `fine` della commessa, e si scavalca a mano;
- prima colonna fissa, scorrimento orizzontale, e la settimana corrente marcata;
- oltre le ~30 settimane, uno zoom che aggrega la **vista** per mese — il dato
  resta settimanale;
- la cella si colora sulla **saturazione della persona sommata su tutti i
  programmi attivi** rispetto a `oreSettimana`. Sotto, in soglia, sopra;
- una riga di totali in fondo, e la riga «non allocato» per pacchetto.

**Colonna di destra — il dettaglio della voce.** Titolo, note, pacchetto, ore,
risorsa proposta, finestra. E i due gesti che contano:

- **Scomponi** — crea figlie, e da lì la voce diventa un contenitore;
- **Attiva** — chiede risorsa, scadenza e lista (creandola se il pacchetto non
  ne ha ancora una), e genera l'attività vera: `delegated` + `persona` se la
  passi a qualcuno, `next` se è tua. Da quel momento la voce mostra lo stato del
  task letto dal pool, con un collegamento al dettaglio attività.

**L'elenco delle voci**, sotto la matrice o in una seconda scheda: filtrabile
per pacchetto, risorsa, stato derivato. Selezione multipla → attiva in blocco,
che è il gesto vero del lunedì mattina.

**Incolla in massa.** Una casella dove si buttano centocinquanta righe
`pacchetto | titolo | ore | risorsa` e diventano voci. Senza, il caricamento
iniziale ferma tutto alla seconda commessa: è la funzione che decide se lo
strumento verrà usato davvero.

## Il rischio dichiarato

«Costruisco una struttura per questa commessa e poi non me ne faccio niente.»

La mitigazione è strutturale, non di buona volontà: **nessuna altra vista
dipende dal Programma**. Se il Programma viene abbandonato restano un file JSON
e una voce di menu, e i task già attivati vivono benissimo da soli — non sanno
nemmeno di essere nati lì. Il costo di sbagliarsi è basso, ed è la ragione per
cui vale la pena provarci.

## Cosa portare a Claude Design

Il modello dei dati qui sopra è deciso. Al passaggio di design servono le cose
che il documento non può risolvere:

1. **La matrice.** È il pezzo difficile. Riga risorsa chiusa/aperta, cella
   editabile, colore della saturazione, settimana corrente, totali, e la
   leggibilità con 52 colonne. Come si dice «non allocato» senza urlare.
2. **La testata.** Cinque numeri più il margine: gerarchia, e cosa succede
   quando il margine è negativo.
3. **Le tre colonne.** Riuso vero del guscio di Sezioni, o forma sua.
4. **Il dettaglio voce**, e come si vede a colpo d'occhio la differenza fra una
   voce prevista, una attiva e una fatta — dev'essere la prima cosa che si legge.
5. **Scomponi e Attiva.** Due gesti, due forme brevi. Attiva è quello che tocca
   il resto dell'app: dev'essere impossibile farlo per sbaglio, e veloce quando
   ne fai dieci di fila.
6. **Cosa resta su telefono**: colonna di sinistra, elenco voci, dettaglio.
   Nessuna matrice.

I colori vengono da `tokens.css` e non se ne inventano di nuovi.
