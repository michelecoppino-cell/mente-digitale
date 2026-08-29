# Proposta: parlare con la mente digitale, dal telefono

> **Proposta, non costruita.** Qui non c'è codice e nell'app non è cambiato
> niente. È la terza riga della tabella di `proposta-piano-da-telefono.md` —
> quella liquidata con «alto, progetto a sé» — presa sul serio e misurata: cosa
> costa davvero, cosa si può provare in tre minuti prima di spendere un'ora, e
> qual è il pezzo che di solito si sottovaluta.

## La scena

Venticinque minuti di macchina, la mattina, verso l'ufficio. Non si guarda
niente e non si tocca niente. Si parla, e a voce si compila il piano della
giornata:

> — *Leggimi i task aperti di 2573.*
> — «Sulla 2573 ci sono nove attività aperte. Consegna A60, che scade venerdì:
>    relazione fondazioni, un'ora e mezza; verifica carichi, un'ora; …»
> — *Aggiungimi «chiamare il fornitore dei pali», mezz'ora. E aggiungi anche
>    «rileggere la relazione geotecnica».*
> — «Fatte. La seconda senza stima: quanto?»
> — *Un'ora. Adesso prova a ordinarmele per oggi.*
> — «Hai riunione dalle 11 alle 12. Metto: 8:30 relazione fondazioni, 10:00
>    chiamare il fornitore, 12:00 rileggere la geotecnica, 14:00 verifica
>    carichi. Restano fuori due ore di roba. Va bene?»
> — *Sì.*

Non è cattura — quella è già risolta, si detta a To-Do e arriva in Inbox. Non è
la scaletta, che è la stessa decisione presa col pollice fermo a un semaforo.
È la cosa che oggi non si può fare in nessun modo: **decidere la giornata
parlando**, con davanti i dati veri.

## Le quattro cose che devono essere vere

Perché quella conversazione esista servono quattro cose, e conviene tenerle
separate perché costano in modo molto diverso:

1. **La voce sul telefono deve poter chiamare strumenti.** Non dipende da noi.
2. **Il telefono deve poter parlare con un server MCP nostro.** Non dipende da noi.
3. **Il server deve esistere:** un indirizzo HTTPS, sempre acceso, con una
   serratura. Questo è lavoro.
4. **La conversazione deve funzionare davvero.** Questo è progetto — ed è il
   pezzo che si scopre sbagliato dopo, quando il resto è già costruito.

Le prime due si verificano in tre minuti. La terza si stima. La quarta si
ragiona adesso, perché cambia cosa costruire.

## 1 e 2 — quello che risulta oggi

Da quello che è pubblicato: la voce sull'app del telefono **usa gli strumenti
collegati** — durante una conversazione vocale può chiamare i connettori, non
solo la ricerca web. E l'app iOS **supporta i server MCP remoti**, non solo i
connettori del catalogo: un connettore personalizzato aggiunto dal sito
(Impostazioni → Connettori → *Aggiungi connettore personalizzato*, un URL HTTPS
e, volendo, un OAuth) risulta poi disponibile anche dal telefono.

Sui modelli: la voce si può portare su Haiku, Sonnet o Opus, e all'inizio era
Haiku e basta. Il punto su cui **non** mi fiderei di quello che si legge in giro
è se l'uso degli strumenti in voce valga su tutti e tre o solo sui più grandi:
le fonti secondarie si contraddicono, e la risposta cambia la scena — con Sonnet
la conversazione resta possibile ma più lenta, e «mentre guido» tollera male i
silenzi.

**La prova dei tre minuti, da fare prima di scrivere una riga di codice:** apri
la voce sul telefono con Haiku selezionato, con un connettore che hai già
(Google Calendar va benissimo), e chiedi *«cosa ho in calendario domani?»*. Se
risponde leggendo il calendario vero, il canale esiste e tutto il resto è
lavoro nostro. Se dice che non può, si riprova con Sonnet, e la risposta dice
con quale modello va progettata la conversazione — cioè quanto devono essere
corte le risposte e quanti strumenti può reggere l'elenco.

Questa prova costa zero e può risparmiare tutto il resto. È il primo passo.

## 3 — il filo che manca

Quello che c'è già è più di quanto sembri: ventuno strumenti, le regole su cosa
si può scrivere, e lo strato che parla con Microsoft. Manca **solo
l'involucro**: `mente-mcp.mjs` legge righe da `stdin` e scrive righe su
`stdout`, e un server remoto riceve POST e risponde. La logica in mezzo —
`gestisci()` — è già tutta lì.

Quattro problemi, in ordine di difficoltà crescente. Il quarto è quello vero.

### a) Il trasporto — piccolo

MCP su HTTP è lo stesso JSON-RPC in un altro vestito: `initialize`,
`tools/list`, `tools/call`, senza stato da tenere fra una chiamata e l'altra —
che è esattamente com'è scritto oggi. Il lavoro è far *tornare* la risposta a
`gestisci()` invece di scriverla con `invia()`, e metterci intorno un handler
HTTP. Sono qualche decina di righe, e non toccano né i comandi né Graph.

### b) Dove gira — una scelta, non un problema

| Dove | Per | Contro |
|---|---|---|
| Il PC di casa + un tunnel (Cloudflare Tunnel, Tailscale Funnel) | il token non lascia il computer; zero riscrittura | il PC dev'essere acceso alle otto del mattino, e in macchina non lo si accende |
| Un contenitore sempre acceso (Fly.io, una VM piccola) | acceso davvero, e ha un disco per il token | qualche euro al mese e una macchina in più da tenere aggiornata |
| Serverless (Cloudflare Pages Functions / Workers) | costo praticamente zero, niente da amministrare | niente disco: il token va in un KV, e il codice non può usare `fs` |

Il terzo, e per una ragione precisa: **`mente-graph.mjs` usa il filesystem solo
per il token.** Tutto il resto — le decine di chiamate a Graph, la paginazione,
i retry — è `fetch` e basta, e `mente-comandi.mjs` non tocca il disco per
niente. Isolare le venti righe che leggono e scrivono il refresh token dietro a
due funzioni (`leggiToken` / `scriviToken`, con un'implementazione a file per il
PC e una a KV per il server) è tutto quello che separa questo codice
dall'essere portabile. Il README, parlando d'altro, cita già «una Function di
Cloudflare Pages»: è la stessa idea, per lo stesso motivo.

### c) Il token — il dettaglio che morde dopo

Il refresh token **ruota a ogni uso**: chi lo spende deve anche riscriverlo, e
due processi che lo spendono insieme si invalidano a vicenda. Su GitHub Actions
questo è già gestito, ma là c'è una esecuzione ogni tre ore e il `concurrency`
che ne impedisce due insieme. Un server chiamato da una conversazione riceve
raffiche: sei domande in due minuti.

La forma giusta è tenere nel KV **anche l'access token**, che vale un'ora. Così
il refresh token si spende una volta ogni sessanta minuti invece che a ogni
chiamata, e la raffica non lo vede nemmeno. È una decina di righe, ma se non
c'è, il sintomo arriva la settimana dopo ed è «da ieri non funziona più
niente», senza nessun messaggio che dica perché.

### d) La serratura — la parte cara

Questo endpoint, aperto, è la chiave del OneDrive personale: legge diario,
Bussola, taccuini, e scrive su attività, calendario, OneNote e piani. Un URL
senza autenticazione non è un prototipo, è una fuga che aspetta di essere
indicizzata — gli URL finiscono nei log, nelle cronologie, nei crawler.

Un connettore personalizzato può essere *authless*, e il segreto messo nel
percorso («l'URL lungo che non indovina nessuno») è la scorciatoia che viene in
mente: funziona, non scade mai, e non si revoca senza cambiare URL. Non la
userei per una cosa che scrive.

La strada seria è l'OAuth che il connettore già sa fare: un client id e un
client secret, e un pezzo di server che li verifichi — con un solo utente, che
sei tu. È il pezzo che costa più di tutto il resto messo insieme, ed **è la
vera ragione per cui questo è «un progetto a sé»**: non l'MCP, che è già
scritto, ma la porta.

Insieme alla serratura va la mitigazione che costa meno di tutte: **un refresh
token dedicato al telefono, con meno scope**. Gli scope stanno dentro al token e
non si chiedono a ogni chiamata, quindi un token preso senza `Notes.ReadWrite` e
senza `Mail.Read` rende il canale del telefono strutturalmente incapace di
toccare i taccuini e di leggere la posta — che in macchina non servono. Se un
giorno quel token finisce in mano a qualcuno, quello che può fare è già ridotto
per costruzione, non per buona volontà.

## 4 — la conversazione, che è la parte che si sottovaluta

Leggendo il codice con in testa quella scena in macchina, saltano fuori tre
cose. Nessuna è un dettaglio.

### Ventuno strumenti sono troppi per la voce

Sullo schermo, se il modello sceglie lo strumento sbagliato, lo si vede e si
corregge. A voce non si vede niente: si sente una risposta che parla d'altro, e
si è già persi due scambi in tangenziale. Il canale remoto dovrebbe esporne
**otto** — quelli del mattino: `sezioni`, `attivita_lista`, `attivita_crea`,
`agenda`, `oggi`, `piano`, `piano_aggiungi`, `piano_togli`. Diario, OneNote,
obiettivi del mese, Bussola restano fuori: non sono le cose che si fanno
guidando, e stare nell'elenco vuol dire essere una risposta possibile.

Non è un limite del server: è lo stesso server con un elenco più corto, deciso
da chi lo chiama.

### «Prova a ordinarmeli» oggi non esiste

Nella mente digitale non c'è **nessun posto dove sta un elenco ordinato della
giornata senza le ore**. O diventa un piano — con gli orari — o non si scrive
da nessuna parte. È lo stesso buco che la proposta della scaletta chiama «la
scaletta».

E il piano, da qui, si scrive un blocco per volta: `piano_aggiungi` vuole un'ora
precisa, rifiuta le sovrapposizioni una alla volta, e ogni chiamata rilegge
*tutte* le liste con *tutte* le attività e riscrive l'intero file dei piani. Sei
attività sono sei giri completi, e chiedere a un modello veloce di calcolare gli
orari — la riunione dalle 11, la stima di ciascuna, i buchi che restano —
mentre l'utente guarda la strada è esattamente il punto in cui inventa.

**Un solo strumento nuovo lo risolve: `piano_riempi`.** Prende un giorno e un
elenco ordinato, legge una volta, prende le ore lavorative da `plannerConfig`,
ci scava i buchi degli eventi del calendario, ci lascia cadere le attività
nell'ordine dato ciascuna per la sua stima, e scrive una volta. Restituisce cosa
ha piazzato e cosa non ci stava, con scritto perché — senza comprimere e senza
tagliare: se cinque ore di roba non stanno in tre ore libere, la risposta è «non
ci stanno».

È lo stesso identico calcolo del tasto **Riempi** della scaletta. Se si scrive
una volta sola, in `mente-comandi.mjs`, lo usano tutti e due i canali e non
possono divergere — che è la regola già seguita fra CLI e MCP. **Questo è
l'argomento più forte per fare la scaletta e la voce nello stesso ordine, o
almeno con la stessa funzione sotto.**

### La latenza è il problema vero, più dell'autenticazione

Ogni domanda costa una lettura completa: `collectTasks` prende tutte le liste
To-Do e, per ciascuna, tutte le attività aperte; il filtro «solo 2573» si
applica **dopo**, in memoria. Con trenta liste sono trenta chiamate a Graph per
rispondere a *«leggimi i task di 2573»*.

Su un PC nessuno se ne accorge. In una conversazione a voce, dove due secondi di
silenzio sono già lunghi, è la differenza fra una cosa che si usa e una che si
prova una volta.

La correzione è piccola e serve **anche alla riga di comando**: quando arriva
una sezione, risolvere prima le liste che somigliano al nome e chiedere le
attività solo di quelle. Da trenta chiamate a due o tre, senza cambiare né il
risultato né la firma.

## Il gradino intermedio, che costa un comando

C'è una via di mezzo che nessuna delle due proposte aveva nominato, e che non
richiede di costruire niente: **Remote Control**.

`claude --remote-control` (o `/remote-control` in una sessione già aperta)
registra la sessione sull'account e ne apre una finestra su claude.ai/code e
sulla scheda **Code** dell'app del telefono. La sessione **continua a girare sul
PC**, con il suo filesystem e i suoi server MCP: dal telefono si scrive dentro
una sessione che ha `mente` collegato, e i ventuno strumenti rispondono per
davvero. Il token non si muove, non c'è niente da esporre su internet, non c'è
serratura da scrivere. Serve un piano Pro o Max, il PC sveglio e il processo
`claude` acceso; se il portatile si addormenta la sessione va offline e torna da
sé quando la macchina si riprende.

*(C'è anche **Dispatch**, che dal telefono assegna un compito che gira sul
desktop. È fatto per il lavoro in background — «fallo e dimmi com'è andato» —
non per una conversazione a botta e risposta, che è quello che serve qui.)*

**Questo cambia il primo passo, e per il meglio.** Non è la macchina — la scheda
Code è una chat di testo: si detta col microfono della tastiera e si legge la
risposta, che con le mani sul volante non si fa. Ma è il banco di prova esatto:
si può provare *oggi*, dal divano o dal treno, la conversazione vera —
«leggimi i task di 2573, aggiungi questi due, ordinameli» — sugli strumenti veri
e sui dati veri.

E quello che si scopre lì vale per tutto il resto:

- se quella conversazione, per iscritto, risulta più lenta che aprire l'app, la
  voce non la salva: il problema è negli strumenti, ed è quello che dicono i tre
  punti qui sopra (ventuno strumenti, «ordinameli» che non esiste, la latenza);
- se invece funziona, il server remoto ha un motivo dimostrato invece che
  sperato, e si sa già quali otto strumenti servono e come vanno accorciate le
  risposte.

Fra le due cose, quindi, l'ordine è: **prima si prova la conversazione con
Remote Control, poi si decide se costruire il canale della voce.**

*(Una terza strada, per completezza: una sessione Cloud di Claude Code con
`MENTE_REFRESH_TOKEN` fra le variabili d'ambiente. Funziona, e non chiede il PC
acceso — ma vuol dire mettere la chiave del proprio OneDrive nella
configurazione di un servizio, e Remote Control ottiene lo stesso risultato
lasciando il token dov'è. La terrei per il caso «il PC è spento e mi serve
adesso», con un token dedicato e più stretto, non come strada principale.)*

## Quello che non farei

- **Non esporrei il server senza serratura**, nemmeno «per una settimana di
  prova». Le settimane di prova diventano mesi, e un URL che scrive su OneDrive
  non ha una versione innocua.
- **Non lascerei calcolare le ore al modello.** Il piano lo scrive
  `piano_riempi`, con l'aritmetica dalla parte del codice. Un piano con la
  riunione delle undici sopra la relazione delle undici non è un piano.
- **Non porterei tutti e ventuno gli strumenti sul canale della voce.** Il
  diario dettato guidando non è il diario, è un'altra cosa che gli somiglia.
- **Non farei passare la voce dall'app.** L'app è una SPA senza server, con
  MSAL nel browser: non c'è niente, lì, che il telefono possa chiamare. La
  strada è il canale MCP, che esiste già ed è già la stessa cosa della riga di
  comando.

## Cosa proporrei, e in che ordine

| # | Cosa | Costo | Serve a |
|---|---|---|---|
| 0 | **Remote Control**: la conversazione vera dal telefono, sugli strumenti che ci sono | un comando | Sapere se quella conversazione vale la pena, prima di tutto il resto |
| 1 | **La prova dei tre minuti**: voce + Haiku + un connettore che c'è già | zero | Sapere se il canale della voce esiste, prima di costruirlo |
| 2 | Filtrare le liste **prima** di leggere le attività | basso | Risposte in due secondi invece che in dieci — e serve anche alla CLI |
| 3 | `piano_riempi` in `mente-comandi.mjs`, esposto a MCP e a riga di comando | basso/medio | «Ordinameli» che scrive un piano vero invece di ore inventate |
| 4 | L'involucro HTTP: trasporto, token nel KV, serratura OAuth, otto strumenti | medio/alto | Il canale vero |
| 5 | Un refresh token dedicato, con meno scope | basso | Che il telefono possa fare meno del PC, per costruzione |

Il **2** e il **3** valgono anche se il 4 non si farà mai: sono migliorie al
canale che c'è, e il 3 è metà della scaletta. Il **1** costa niente e può
cambiare tutto — se la voce con Haiku non chiama gli strumenti, il 4 va
progettato per Sonnet, cioè con risposte più corte e meno giri.

Il **4** è l'unico progetto vero, e lo comincerei solo dopo che lo **0** ha detto
che quella conversazione, per iscritto, era già utile, e l'**1** che la voce
chiama gli strumenti. Sono le due domande a cui non serve scrivere codice per
rispondere, e sono le due che possono far risparmiare tutto il resto.
