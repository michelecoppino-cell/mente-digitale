# Il recap del mattino

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

**Niente API a consumo.** Il pezzo che scrive il recap è Claude Code, che gira
sull'abbonamento: una mattina costa zero. La strada alternativa — un servizio che
chiama l'API a pagamento ogni notte — costerebbe poco, ma vorrebbe dire una
chiave da custodire fuori casa e un conto che cresce da solo mentre dormi.

**Sul PC di lavoro, che è sempre acceso.** È una VDI: non si spegne, e il server
MCP della mente digitale è già registrato lì sopra. Il recap vive su OneDrive,
quindi la macchina che lo scrive e quella da cui lo si ascolta non hanno bisogno
di essere la stessa — né di conoscersi.

**Aspettare al risveglio non si può.** Guardare calendario, posta e attività
sono otto chiamate, e i titoli del giorno sono tre ricerche sul web: un minuto o
due. Un minuto con il telefono in mano e gli
occhi ancora chiusi è tanto; alle cinque non lo è per nessuno.

## I tre pezzi

| | |
|---|---|
| `scripts/recap/prompt-recap.md` | il prompt fisso: cosa guardare, cosa scrivere, dove scriverlo. Si modifica lì e basta |
| `scripts/recap/Recap-Mattina.ps1` | passa il prompt a `claude -p`, dichiarando gli strumenti che quel processo può usare, e tiene un log |
| `scripts/recap/Registra-Compito.ps1` | registra il compito delle cinque, con la spunta che conta: anche a sessione bloccata |

Il recap finisce su OneDrive in `mente-digitale-recap.json`, **uno solo**,
riscritto ogni notte. Non se ne tiene la cronologia: un recap è di stamattina o
non è niente, e quello che merita di restare si scrive nel diario, che è il posto
delle cose che si rileggono.

## Metterlo in piedi

Sul PC sempre acceso, una volta sola:

```powershell
# 1. Claude Code c'è e il server MCP risponde
claude mcp list                      # deve dire: mente ✔ Connected

# 2. registra il compito (S4U: nessuna password conservata)
cd C:\percorso\mente-digitale\scripts\recap
powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1

# 3. provalo adesso, senza aspettare domani
Start-ScheduledTask -TaskName "Mente digitale - recap del mattino"
Get-Content "$env:LOCALAPPDATA\mente-digitale\recap\recap-$(Get-Date -f yyyy-MM-dd).log"
```

Poi, da qualunque altra parte:

```bash
node scripts/mente.mjs recap          # o, a voce, «leggimi il recap»
```

Se il server MCP è registrato con un nome diverso da `mente`, va detto:
`.\Recap-Mattina.ps1 -Server altronome`. Il nome entra negli strumenti
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
recap non arrivava da gennaio — perciò lo script lo scrive a chiare lettere, e se
una mattina il recap manca quello è il primo sospetto.

Se non riesce **nessuno** dei quattro, in ordine: riapri PowerShell come
amministratore se su quella macchina puoi; chiedi all'IT il diritto «Accedi come
processo batch» (`secpol.msc` → Assegnazione diritti utente), che è quello che
serve a S4U; oppure metti il compito su un'altra macchina sempre accesa — al
recap non cambia niente, perché legge e scrive su OneDrive.

E intanto, in ogni caso, il recap si scrive a mano quando vuoi. È anche il modo
giusto di provare tutta la catena — `claude`, il server MCP, la ricerca sul web,
la scrittura su OneDrive — senza avere ancora nessun compito registrato:

```powershell
powershell -ExecutionPolicy Bypass -File .\Recap-Mattina.ps1
```

## Cosa c'è dentro

L'ordine è quello del prompt, e non è casuale: quello che scade oggi si dice
prima di tutto il resto, e la domanda finale è una sola.

1. **Com'è fatta la giornata**: gli impegni fissi, i due che contano, le ore che
   restano libere.
2. **Cosa è rimasto indietro**: le attività programmate nei giorni scorsi e mai
   chiuse, le attese ferme da più di una settimana — quelle sono telefonate.
3. **Cosa scade** entro sette giorni, attività e consegne.
4. **Cosa chiede una risposta**: al massimo tre email, per mittente e argomento.
5. **Le due o tre cose che valgono la giornata**, con il perché, e — se la prima
   è spezzata in sottoattività — da quale passo si comincia.
6. **Una riga sugli obiettivi del mese**, solo se qualcosa è indietro.
7. **Una domanda sola**: cosa spostare, cosa dire di no, chi richiamare.
8. **I titoli del giorno**, staccati dal resto e in fondo: due o tre notizie dal
   mondo, due o tre dall'Europa, due o tre dall'Italia. Una frase l'una, e nessun
   commento — si sceglie parlando, dopo, su cosa tornare. Quelle che toccano il
   lavoro (edilizia, sismica, appalti, normativa, Friuli) vanno per prime nel loro
   gruppo.

Da 150 a 250 parole per la giornata, in prosa, senza elenchi: verrà letto ad alta
voce, e un elenco ad alta voce non si ricorda. L'unica eccezione sono i titoli in
coda, che sono titoli e vanno una riga l'uno. Le ore come si dicono, «alle nove e
mezza».

Le notizie arrivano da `WebSearch`, cioè da Claude Code e non dal server MCP: è
l'unico pezzo del recap che esce di casa, e l'unico che può mancare per conto
suo. Se dalla VDI il web non si raggiunge — proxy, criteri aziendali — il recap
lo **dice** e non tira fuori niente dalla memoria: una notizia inventata alle
cinque la si scopre a pranzo, parlando con qualcuno. Il campo `fonti` del recap
dice se i titoli c'erano davvero.

Cambiare cosa contiene vuol dire cambiare `prompt-recap.md`: niente codice, e
nessun compito da registrare di nuovo.

Se invece tocchi i due `.ps1`, risalvali **UTF-8 con BOM**: senza, Windows
PowerShell 5.1 li legge come ANSI, i trattini lunghi diventano tre caratteri di
cui uno è una virgoletta, e il file non parte con un errore che punta all'ultima
riga invece che al punto vero. È già successo una volta.

## Quando non arriva

**Non si rompe niente, e non lo si scopre per caso.** Il recap di ieri resta dov'è,
e chi lo rilegge se ne accorge da solo: `oggi` mostra il recap solo se è di
stamattina, altrimenti dice di che giorno è; e `recap` avvisa quando quello che
trova ha più di diciotto ore. È la stessa regola dello specchio del calendario di
lavoro — *un dato che arriva da fuori dichiara quanti anni ha* — e vale perché un
recap mancante si nota, uno fermo a ieri no.

Dove guardare, nell'ordine:

1. il log della notte, in `%LOCALAPPDATA%\mente-digitale\recap`;
2. la colonna «Risultato ultima esecuzione» dell'Utilità di pianificazione: uno
   `0x1` vuol dire che lo script è partito ed è fallito, e il perché è nel log;
3. `claude mcp list` sulla macchina: se il server MCP non risponde, non risponde
   nemmeno alle cinque;
4. il token, se il log parla di permessi: `node scripts/mente.mjs oggi` dalla
   stessa macchina lo dice in un secondo.

## Cosa questo compito può fare

Solo quello che lo script dichiara: `oggi`, `agenda`, `piano`, `piano_auto`,
`posta`, `attivita_lista`, `sezioni`, `obiettivi_leggi`, `programma` in lettura,
`recap` in scrittura, e `WebSearch`/`WebFetch` per i titoli del giorno. Basta
questo, e vale la pena che sia un elenco e non un permesso in bianco: è un processo che gira di notte, senza nessuno davanti allo
schermo, e l'elenco è la risposta alla domanda «cosa può combinare».

Non tocca attività, piano, calendario, diario e OneNote. Le decisioni si prendono
dopo, al risveglio, nella conversazione che comincia dal recap.
