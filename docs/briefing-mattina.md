# Il briefing del mattino

Alle cinque, su un PC che resta acceso, un Claude Code non interattivo guarda
calendario, posta e attività, cerca i titoli del giorno, e scrive due o tre
paragrafi su com'è messa la giornata più una manciata di notizie in coda. Al
risveglio si apre una chat a voce e si chiede di leggerlo: la risposta è già
pronta, non c'è niente da aspettare mentre si fa colazione, e da lì si comincia a
ragionare — cosa spostare, chi richiamare, cosa dire di no, e su quale notizia
tornare.

## Perché così

**Claude non si sveglia da solo.** Non esiste un modo per cui una chat, di
notte, decida di guardare com'è messa la giornata: serve un innesco esterno, e
l'innesco è un compito pianificato di Windows.

**Niente API a consumo.** Il pezzo che scrive il briefing è Claude Code, che gira
sull'abbonamento: una mattina costa zero. La strada alternativa — un servizio che
chiama l'API a pagamento ogni notte — costerebbe poco, ma vorrebbe dire una
chiave da custodire fuori casa e un conto che cresce da solo mentre dormi.

**Sul PC di lavoro, che è sempre acceso.** È una VDI: non si spegne, e il server
MCP della mente digitale è già registrato lì sopra. Il briefing vive su OneDrive,
quindi la macchina che lo scrive e quella da cui lo si ascolta non hanno bisogno
di essere la stessa — né di conoscersi.

**Aspettare al risveglio non si può.** Guardare calendario, posta e attività
sono otto chiamate, e i titoli del giorno sono tre ricerche sul web: un minuto o
due. Un minuto con il telefono in mano e gli
occhi ancora chiusi è tanto; alle cinque non lo è per nessuno.

## I pezzi

| | |
|---|---|
| `scripts/briefing/briefing.json` | **le preferenze: quante proposte, quante notizie per area, i temi delle curiosità, la finestra oraria.** È il file da cambiare per cambiare il briefing |
| `scripts/briefing/prompt-briefing.md` | il prompt fisso: *come* si scrive il briefing. Il *cosa* sta nel JSON qui sopra |
| `scripts/briefing/Briefing-Mattina.ps1` | passa il prompt a `claude -p`, dichiarando gli strumenti che quel processo può usare, e tiene un log |
| `scripts/briefing/Registra-Compito.ps1` | registra il compito delle cinque, con la spunta che conta: anche a sessione bloccata |
| `src/briefing.js` | la forma del documento e le regole: chi è di oggi, come si approva, dove va un blocco. Puro, e ci girano le prove |
| `src/Briefing.jsx` | la scheda nell'app, da telefono e da computer: le proposte con Approva e Scarta, il resto in sola lettura |

**Le preferenze sono tue.** `briefing.json` si apre e si cambia senza toccare né
il prompt né gli script: quante proposte, quante notizie per ciascuna area
(zero spegne un'area), i temi delle curiosità professionali e delle
riflessioni, la finestra in cui possono cadere le proposte. Vale dalla mattina
dopo — il compito lo rilegge ogni volta.

**Dove finisce cosa.** Nella cartella del progetto non compare niente: il briefing
va su **OneDrive**, in `mente-digitale/mente-digitale-briefing.json`, accanto ai
piani e al diario; il log della notte va in
`%LOCALAPPDATA%\mente-digitale\briefing`. Il briefing è **uno solo**,
riscritto ogni notte. Non se ne tiene la cronologia: un briefing è di stamattina o
non è niente, e quello che merita di restare si scrive nel diario, che è il posto
delle cose che si rileggono.

## Dove si legge

Tre posti, e sono lo stesso documento visto da tre distanze.

**La scheda «Briefing» dell'app** (telefono e computer) è quella che conta: in
alto le proposte, ognuna con il suo perché e due bottoni — Approva e Scarta — e
sotto il resto in sola lettura. **Approvare è l'unica cosa che scrive**: mette
il blocco nel piano di oggi, con la stessa scrittura del Piano e delle Sezioni.
Se nel frattempo l'ora proposta si è occupata, il blocco scende al primo buco e
la scheda lo dice — due blocchi accavallati sono un errore, non una
sovrapposizione da disegnare.

**A voce, dal connettore**: lo strumento `briefing` lo legge per intero, `oggi`
ne porta il sunto. Da lì si legge soltanto: approvare mette un blocco nel piano,
e quello si fa guardando.

**Da terminale**: `node scripts/mente.mjs briefing`.

Niente finisce a piano da solo, da nessuno dei tre. È la regola che tiene in
piedi tutta la cosa: un piano che si riempie da solo mentre dormi è un piano di
cui non ci si fida più, e la prima volta che ci si trova dentro una cosa che non
si è messa lo si smette di guardare.

### Perché il connettore non lo vedeva

Il connettore remoto è un Worker su Cloudflare: **ha dentro il codice che ci si
è pubblicato**, non quello che sta nel repository. Uno strumento nuovo compare
da voce solo dopo un `npx wrangler deploy` — fino a quel momento le chat
continuano a parlare con la versione di prima, che quello strumento non ce
l'ha. Vedi `docs/mente-remoto.md`.

## Metterlo in piedi

Sul PC sempre acceso, una volta sola:

```powershell
# 1. Claude Code c'è e il server MCP risponde
claude mcp list                      # deve dire: mente ✔ Connected

cd C:\percorso\mente-digitale\scripts\briefing

# 2. il briefing, scritto adesso e a mano: è la prova di tutta la catena
powershell -ExecutionPolicy Bypass -File .\Briefing-Mattina.ps1

# 3. registra il compito delle cinque
powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1

# 4. e prova anche la strada del compito, che non è la stessa cosa: gira
#    senza console, senza il tuo PATH e con il suo ambiente
Start-ScheduledTask -TaskName "Mente digitale - briefing del mattino"
Get-ScheduledTaskInfo -TaskName "Mente digitale - briefing del mattino"
Get-Content "$env:LOCALAPPDATA\mente-digitale\briefing\briefing-$(Get-Date -f yyyy-MM-dd).log"
```

I passi 2 e 4 provano due cose diverse e servono tutti e due: il primo dice che
`claude`, il server MCP, la ricerca sul web e la scrittura su OneDrive
funzionano; il secondo che funzionano **anche da dentro l'Utilità di
pianificazione**, che è un ambiente diverso — altro PATH, nessuna console, e il
`LastTaskResult` di `Get-ScheduledTaskInfo` che deve dire `0`.

Poi, da qualunque altra parte:

```bash
node scripts/mente.mjs briefing          # o, a voce, «leggimi il briefing»
```

Se il server MCP è registrato con un nome diverso da `mente`, va detto:
`.\Briefing-Mattina.ps1 -Server altronome`. Il nome entra negli strumenti
(`mcp__mente__oggi`), e sono quelli che lo script dichiara uno per uno.

### A sessione bloccata, e quando Windows dice di no

È il punto che fa fallire questo genere di cose, e va guardato prima e non dopo.

Su un PC aziendale il modo migliore di registrare il compito può essere
semplicemente vietato, e lo si scopre solo provando: `Register-ScheduledTask`
risponde **«Accesso negato» (0x80070005)** e non dice cosa manca. Per questo lo
script prova in scala e **dice sempre quale livello ha ottenuto**, perché cambia
quando il compito parte davvero:

| | quando parte | |
|---|---|---|
| password (`-ConPassword`) | anche a utente scollegato | la digiti una volta, la custodisce Windows |
| S4U *(il primo che prova)* | anche a utente scollegato | nessuna password conservata; vuole il diritto «Accedi come processo batch» |
| interattivo | mentre sei collegato, **anche a schermo bloccato** | non parte se ti scolleghi davvero |
| `schtasks.exe` | come sopra | la strada vecchia, a volte l'unica che i criteri lasciano aperta |

Su una VDI il livello interattivo di solito basta: **disconnettersi non è
scollegarsi**, la sessione resta viva e alle cinque il compito parte. Ma non è la
stessa cosa, e spacciarlo per tale sarebbe il modo di scoprire a marzo che il
briefing non arrivava da gennaio — perciò lo script lo scrive a chiare lettere, e se
una mattina il briefing manca quello è il primo sospetto.

E attenzione a un'altra cosa, perché è la fonte vera dell'equivoco: **«la
macchina è sempre accesa» non vuol dire «la sessione è sempre collegata»**. Un
compito interattivo ha bisogno che l'utente sia *collegato*, non che il computer
sia acceso. Restano scoperti due casi, tutti e due normali su una VDI
aziendale: il riavvio notturno per gli aggiornamenti, dopo il quale nessuno ha
ancora fatto l'accesso; e il criterio che scollega le sessioni ferme da troppe
ore. In tutti e due i casi alle cinque non c'è nessuna sessione, e il briefing non
viene scritto — senza errori, perché il compito semplicemente non parte.

Non è un disastro e non passa inosservato: il briefing di ieri resta dov'è, `oggi`
dice che è di ieri, e si rifà a mano in un minuto. Ma se succede due mattine su
tre, la cosa da chiedere all'IT è il diritto «Accedi come processo batch», che
sposta il compito su S4U e toglie di mezzo la questione.

Se non riesce **nessuno** dei quattro, in ordine: riapri PowerShell come
amministratore se su quella macchina puoi; chiedi all'IT il diritto «Accedi come
processo batch» (`secpol.msc` → Assegnazione diritti utente), che è quello che
serve a S4U; oppure metti il compito su un'altra macchina sempre accesa — al
briefing non cambia niente, perché legge e scrive su OneDrive.

E intanto, in ogni caso, il briefing si scrive a mano quando vuoi. È anche il modo
giusto di provare tutta la catena — `claude`, il server MCP, la ricerca sul web,
la scrittura su OneDrive — senza avere ancora nessun compito registrato:

```powershell
powershell -ExecutionPolicy Bypass -File .\Briefing-Mattina.ps1
```

## Cosa c'è dentro

Il documento ha una forma, e non è un vezzo: le proposte devono poter comparire
nella scheda con un bottone accanto a ciascuna, e un paragrafo di prosa non si
può mettere in un bottone.

| | |
|---|---|
| `giornata` | com'è fatta la giornata, in prosa: impegni fissi, ore libere, cosa scade, le email che chiedono una risposta |
| `proposte` | le cose da mettere a piano oggi, ognuna con **il suo perché**, un'ora e una durata, e l'id dell'attività vera quando ce l'ha |
| `recap` | gli ultimi giorni: cosa è rimasto indietro, le attese ferme, cosa si è chiuso |
| `notizie` | `mondo`, `europa`, `italia`, `friuli` — una frase l'una, senza commento |
| `curiosita` | `professionali` (software, AI, opere interessanti e perché lo sono) e `riflessioni` (uno spunto su cui fermarsi, non un consiglio di produttività) |
| `domanda` | una sola, quella che conta stamattina |
| `fonti` | cosa è stato guardato **davvero**: quello che ha dato errore non ci finisce |

Quante cose per ciascuna sezione lo dice `briefing.json`. Il perché di ogni
proposta è obbligatorio, e lo strumento rifiuta un briefing senza: una proposta
che non dice perché non si può approvare guardandola, e il perché è la parte
che si legge davvero.

Le notizie e le curiosità arrivano da `WebSearch`, cioè da Claude Code e non dal
server MCP: è l'unico pezzo che esce di casa, e l'unico che può mancare per
conto suo. Se dalla VDI il web non si raggiunge — proxy, criteri aziendali — le
sezioni restano vuote e `fonti` non dice «notizie»: meglio una sezione vuota che
un titolo inventato alle cinque, che lo si scopre a pranzo parlando con
qualcuno.

Cambiare cosa contiene vuol dire cambiare `briefing.json` — o, per come è
scritto, `prompt-briefing.md`. Niente codice, e nessun compito da registrare di
nuovo.

Se invece tocchi i due `.ps1`, risalvali **UTF-8 con BOM**: senza, Windows
PowerShell 5.1 li legge come ANSI, i trattini lunghi diventano tre caratteri di
cui uno è una virgoletta, e il file non parte con un errore che punta all'ultima
riga invece che al punto vero. È già successo una volta.

### Come il prompt arriva a Claude

Il prompt non gli viene passato: gli viene **indicato**. Lo script lancia
`claude -p "Leggi il file …\prompt-briefing.md ed esegui alla lettera quello che
dice"`, e per questo fra gli strumenti concessi c'è anche `Read` — che serve
anche a leggere `briefing.json`.

Le altre due strade hanno tutte e due un difetto che si paga di notte. Da
**stdin** (`Get-Content prompt.md | claude -p`) su Windows il testo non arriva:
Claude parte con una richiesta vuota, risponde «dimmi pure su cosa vuoi
lavorare», esce con codice 0, e nel log resta un saluto al posto del briefing —
è esattamente come si è rotto la prima volta. Come **argomento**
(`claude -p "<seimila caratteri>"`) funziona finché il prompt è corto, ma se
`claude` è uno shim `.cmd` si passa da `cmd.exe`, dove la riga di comando si
taglia a 8191 caratteri: si romperebbe il giorno in cui il prompt cresce, senza
un errore che lo dica.

### «Ha risposto» non è «ha scritto»

Finito il giro, lo script controlla su OneDrive che il briefing sia davvero di
oggi (`node scripts/mente.mjs briefing --json`) e **fallisce se non lo è**, anche
quando Claude è uscito senza errori.

Non è pignoleria: la prima volta che questo è andato storto, Claude aveva
salutato, era uscito con codice zero, il compito risultava riuscito e su
OneDrive non c'era niente. Un compito che dice «fatto» senza aver fatto è
peggio di uno che fallisce, perché toglie l'unico segnale che avevi.

## Quando non arriva

**Non si rompe niente, e non lo si scopre per caso.** Il briefing di ieri resta dov'è,
e chi lo rilegge se ne accorge da solo: `oggi` mostra il briefing solo se è di
stamattina, altrimenti dice di che giorno è; e `briefing` avvisa quando quello che
trova ha più di diciotto ore. È la stessa regola dello specchio del calendario di
lavoro — *un dato che arriva da fuori dichiara quanti anni ha* — e vale perché un
briefing mancante si nota, uno fermo a ieri no.

Dove guardare, nell'ordine:

1. il log della notte, in `%LOCALAPPDATA%\mente-digitale\briefing`;
2. la colonna «Risultato ultima esecuzione» dell'Utilità di pianificazione: uno
   `0x1` vuol dire che lo script è partito ed è fallito, e il perché è nel log;
3. `claude mcp list` sulla macchina: se il server MCP non risponde, non risponde
   nemmeno alle cinque;
4. il token, se il log parla di permessi: `node scripts/mente.mjs oggi` dalla
   stessa macchina lo dice in un secondo.

## Cosa questo compito può fare

Solo quello che lo script dichiara: `oggi`, `agenda`, `piano`, `piano_auto`,
`posta`, `attivita_lista`, `sezioni`, `obiettivi_leggi`, `programma` in lettura,
`briefing` in scrittura, e `WebSearch`/`WebFetch` per i titoli del giorno. Basta
questo, e vale la pena che sia un elenco e non un permesso in bianco: è un processo che gira di notte, senza nessuno davanti allo
schermo, e l'elenco è la risposta alla domanda «cosa può combinare».

Non tocca attività, piano, calendario, diario e OneNote. Le decisioni si prendono
dopo, al risveglio, nella conversazione che comincia dal briefing.
