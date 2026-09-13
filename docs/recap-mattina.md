# Il recap del mattino

Alle cinque, su un PC che resta acceso, un Claude Code non interattivo guarda
calendario, posta e attività e scrive due o tre paragrafi su com'è messa la
giornata. Al risveglio si apre una chat a voce e si chiede di leggerlo: la
risposta è già pronta, non c'è niente da aspettare mentre si fa colazione, e da
lì si comincia a ragionare — cosa spostare, chi richiamare, cosa dire di no.

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
sono otto chiamate: un minuto o due. Un minuto con il telefono in mano e gli
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
Start-ScheduledTask -TaskName "Mente digitale — recap del mattino"
Get-Content "$env:LOCALAPPDATA\mente-digitale\recap\recap-$(Get-Date -f yyyy-MM-dd).log"
```

Poi, da qualunque altra parte:

```bash
node scripts/mente.mjs recap          # o, a voce, «leggimi il recap»
```

Se il server MCP è registrato con un nome diverso da `mente`, va detto:
`.\Recap-Mattina.ps1 -Server altronome`. Il nome entra negli strumenti
(`mcp__mente__oggi`), e sono quelli che lo script dichiara uno per uno.

### A sessione bloccata

È il punto che fa fallire questo genere di cose, e va guardato prima e non dopo.
Il compito è registrato con **S4U**: Windows lo avvia a nome tuo senza
conservare la password, e funziona a schermo bloccato e a utente scollegato. Se i
criteri di dominio lo negano — succede — si rifà con `-ConPassword`, che la
password la chiede una volta e la lascia custodire a Windows.

Se invece i criteri uccidono i processi dell'utente allo screen lock, non c'è
opzione che tenga: il compito va su un'altra macchina sempre accesa. Al recap non
cambia niente, perché legge e scrive su OneDrive.

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

Da 150 a 250 parole, in prosa, senza elenchi: verrà letto ad alta voce, e un
elenco ad alta voce non si ricorda. Le ore come si dicono, «alle nove e mezza».

Cambiare cosa contiene vuol dire cambiare `prompt-recap.md`: niente codice, e
nessun compito da registrare di nuovo.

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
e `recap` in scrittura. Basta questo, e vale la pena che sia un elenco e non un
permesso in bianco: è un processo che gira di notte, senza nessuno davanti allo
schermo, e l'elenco è la risposta alla domanda «cosa può combinare».

Non tocca attività, piano, calendario, diario e OneNote. Le decisioni si prendono
dopo, al risveglio, nella conversazione che comincia dal recap.
