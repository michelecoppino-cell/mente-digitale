# Programma di commessa — come si usa, e cosa manca

Compagno dei due documenti che l'hanno progettato:
`proposta-programma-commessa.md` (il modello dei dati e il perché) e
`programma-commessa-istruzioni.md` (la forma, le misure, i gesti). Questo dice
**come si guida quello che è stato costruito** e, in fondo, **cosa resta da
fare** — scritto per essere il punto di partenza di una sessione nuova.

Stato: prima versione, sul branch `claude/project-management-dashboard-6kwmy8`.
`typecheck`, `lint`, `build` e `prova` (8 suite) verdi.

---

## Provarlo senza toccare i dati veri

```bash
npm run dev:finto      # OneDrive finto in memoria, nessuna rete, nessun account
```

Poi `#/programma`, oppure la voce **Programma** nel menù di sinistra (l'icona a
tre barre sfalsate). Dentro c'è già una commessa finta — *2573 · Sottopasso
ferroviario*, 1 200 ore vendute, tre risorse, quattro pacchetti, un po' di ore
sparse attorno a oggi e una voce già attivata — perché una matrice vuota non
dice se il disegno regge.

Sui dati veri (`npm run dev`, o in produzione) la prima apertura mostra la
schermata «Comincia una commessa». Da lì si crea; per riempirla, vedi
«Il primo giro su una commessa vera» più sotto.

---

## Le tre zone

**Sinistra — i programmi.** L'elenco di quelli accesi, e sotto quello scelto i
suoi pacchetti con le ore. Scelto un programma **la colonna si chiude** e resta
una striscia da 36px col nome in verticale: alla matrice servono tutti i pixel.
I pacchetti restano raggiungibili come **chip sotto la testata** — click filtra
matrice e testata su quel pacchetto, secondo click torna a tutta la commessa.

**Testata — i cinque numeri.** Il margine grande a destra (`+ 946 h`), e sotto
i quattro di controllo che lo spiegano: vendute, stimate, speso, a finire.
Margine negativo → rosso, e sotto una riga che dice **da dove** viene.
Sotto ancora, il delta sempre a schermo: `voci 886 · a piano 254 · 632 h da
collocare` — cliccabile, porta all'elenco voci filtrato.

**Destra — il dettaglio**, che compare solo quando una voce è selezionata.

---

## La matrice

Una colonna per settimana ISO (`W36` e la data del lunedì), una riga per
persona. Si apre già posizionata sulla **settimana corrente**, che è la colonna
con la linea ocra in cima: taglia la matrice in due, a sinistra lo speso, a
destra la previsione. È il taglio che dà senso a «speso» e «a finire» in
testata.

- **riga chiusa** = totale della persona su tutta la commessa in quella
  settimana. Si colora sulla saturazione: nessun fondo sotto il 90 % della sua
  capacità, velatura ocra col filo sotto fra il 90 e il 100 %, velatura rossa
  con la linea più spessa oltre;
- **click sul nome** (o `Spazio`) apre la persona in una sotto-riga per
  pacchetto. **Si scrive solo lì**: una riga chiusa non ha una destinazione, e
  scrivendoci sopra la riga si apre invece di dare un errore. L'unica eccezione
  è la persona che ha un pacchetto solo, dove la destinazione è ovvia;
- una cella vuota è **vuota**: niente zeri, niente trattini.

### I gesti, tutti da tastiera

| | |
|---|---|
| frecce | muovono la cella attiva |
| una cifra | entra in scrittura e sostituisce (interi e mezze ore: `4`, `4.5`, `4,5`) |
| `Invio` / `↓` | conferma e scende · `Tab` / `→` conferma e va a destra |
| `Esc` | annulla quello che stavi battendo |
| `Backspace` | svuota le celle selezionate |
| `⇧`+frecce, o trascinare col mouse | selezionano un rettangolo |
| una cifra con un intervallo selezionato | apre la barretta con **due scelte**: lo stesso numero in ogni settimana (`Invio`) o quel totale spalmato (`⌥Invio`), col risultato già calcolato |
| quadratino in basso a destra della cella | trascinato in orizzontale **ripete** il valore (solo orizzontale) |
| `⌘Z` / `Ctrl+Z` | annulla, ultime 20 modifiche |
| `Spazio` | apre/chiude la riga della persona |

Un valore che non si legge come numero **non svuota la cella**: resta com'era.

### Il salvataggio

Le celle si accumulano e partono insieme dopo 800 ms, in una scrittura sola.
L'indicatore accanto alle schede dice `salvo…` / `salvato` / `non salvato —
riprovo` (in quel caso riprova da solo dopo 5 secondi, e le celle non si
perdono). Uscendo dalla vista quello che è in coda si scrive comunque.

Chi scrive dall'altro dispositivo **non viene cancellato**: l'unione è per
chiave della mappa del carico, quindi le sue celle restano e le tue vincono
solo dove hai messo le mani.

---

## L'elenco voci

Seconda scheda. Una riga per voce, rientrata per `padreId`, con lo stato
derivato leggibile per forma **e** per parola:

| stato | segno | quando |
|---|---|---|
| prevista | bordo grigio | non ha ancora generato nessuna attività |
| attiva | bordo ocra + `⟶` | ha un'attività aperta; a destra cosa le sta succedendo (`delegata a Marco`) |
| fatta | bordo verde + `✓` | l'attività non è più nel pool |
| scartata | sbiadita | nascosta finché non accendi «anche le scartate» |

Filtri in alto (pacchetto, risorsa, stato, «senza ore a piano»), checkbox per la
selezione — `⇧`+click prende tutto l'intervallo — e **Attiva in blocco**.

In fondo, **Incolla in massa**: una riga per voce,
`pacchetto | titolo | ore | risorsa` (vanno bene anche le tabulazioni, e una
colonna sola è un elenco di soli titoli). L'anteprima dice quante voci e
**quali pacchetti nuovi** nascono, prima di confermare. Nessuna lista viene
creata qui.

---

## Scomponi e Attiva

**Scomponi** (dettaglio → *Scomponi*): un campo, una figlia per riga, sintassi
`titolo | ore`. Prima di confermare dice cosa cambia: *«410 h di figlie contro
360 h — il padre passa a 410»*. Da quel momento le ore del padre sono la somma
delle figlie, ma `oreIniziali` resta quella del primo giorno: la differenza
(`▲+50`) è la baseline da poveri, ed è il numero più utile del pannello.

**Attiva…** (solo su una foglia): tre campi già compilati — risorsa (si scrive
e l'elenco si stringe), scadenza (il venerdì della fine finestra, o fra due
settimane), lista (quella del pacchetto se c'è, altrimenti il nome proposto
dalla convenzione PARA, scritto in chiaro con «la lista non esiste ancora, la
creo»). `⌘Invio` crea.

Non c'è nessuna conferma prima: **la sicurezza è l'annulla**, nel toast per otto
secondi, che cancella le attività create e riporta le voci a «prevista». Con la
risorsa compilata l'attività nasce `delegated` + `persona`; senza, `next`.

---

## Il primo giro su una commessa vera

1. `#/programma` → **Comincia una commessa** (chiede il nome).
2. **Incolla in massa** l'elenco delle voci con i pacchetti: è il modo per cui
   esiste. `A30 Fondazioni | Calcolo plinti | 120 | Marco` — i pacchetti nascono
   da soli, e le risorse nominate nella quarta colonna entrano fra le risorse.
3. Apri le persone nella matrice e comincia a mettere le ore.
4. Il lunedì: elenco voci → seleziona quelle che partono → **Attiva in blocco**.

⚠️ Oggi **ore vendute, date di inizio/fine e capacità delle persone non si
scrivono da interfaccia** (vedi sotto): senza le date la matrice mostra le
sedici settimane attorno a oggi, e senza `oreVendute` il margine parte da zero.
È il primo buco da tappare.

---

## Cosa manca — la lista per la prossima sessione

In ordine di quanto pesa nell'uso vero.

1. **Un modulo «dati della commessa».** Non c'è modo di scrivere `oreVendute`,
   `codice`, `inizio`/`fine`, né lo scavalco `settimaneDa`/`settimaneA`. Il
   modello c'è già (`conCommessa`), manca solo la forma: un pannello nella
   testata, o una riga di campi sotto il nome.
2. **Aggiungere una risorsa e cambiarne la capacità.** Idem: `conRisorsa` e
   `conRisorsaAggiornata` esistono e sono provate, ma dalla matrice non si
   raggiungono — oggi una risorsa entra solo dalla quarta colonna
   dell'incolla in massa. Con zero risorse la matrice dice «non c'è ancora
   nessuno» e non offre nulla. **Da fare per primo insieme al punto 1.**
3. **Aggiungere un pacchetto a mano**, dargli un **colore**, rinominarlo. Oggi i
   pacchetti nascono solo dall'incolla e il colore resta nullo (il pallino è
   grigio). Le istruzioni prevedono anche una riga `+ pacchetto` in fondo alle
   sotto-righe di una persona aperta: non c'è.
4. **Spegnere/rinominare un programma.** Si può solo riaccendere uno spento
   (`aggiornaRegistrazione` è già lì).
5. **«Attiva e prossima».** Le istruzioni chiedono che il popover non si chiuda
   e salti alla voce successiva dell'elenco: adesso si chiude. Sono dieci righe
   in `ProgrammaView`, ma serve decidere cos'è «la successiva» rispetto ai
   filtri attivi.
6. **`Apri l'attività ›` porta a `#/attivita` e basta**, non alla scheda di
   quel task: non esiste un indirizzo per una singola attività. O si aggiunge
   (`#/attivita?task=`), o si apre il dettaglio dentro la vista.
7. **La sotto-riga «non allocato» nella matrice.** Il numero c'è
   (`daCollocarePerPacchetto`, ed è quello nei chip dei pacchetti), ma la riga
   in fondo alla matrice non è stata fatta: in testata c'è già il totale.
8. **`⌘Z` copre solo le celle.** Le modifiche alle voci (titolo, ore, scarto,
   scomposizione) non sono annullabili. Valuta `pushUndo` di `src/undo.js`, che
   è il meccanismo che usa il resto dell'app.
9. **Il trascinamento del quadratino usa `elementFromPoint`** per capire su
   quale colonna sei. Funziona, ma è la parte più fragile della matrice: se
   cambia la struttura del DOM smette di funzionare in silenzio. Prima o poi va
   riscritto passando gli indici, e va provato.
10. **Nessuna prova sull'interfaccia.** `scripts/prova-programma.mjs` copre il
    modello e i file (40 verifiche); la matrice, i gesti e l'attivazione si sono
    provati solo a mano su `dev:finto`.
11. **Il CLI e il server MCP non sanno niente dei programmi.**
    `scripts/mente-comandi.mjs` importa `taskModel`, `paraConfig`, `obiettivi` e
    `diary`: se serve leggere il programma da fuori, `programmaStore.js` accetta
    già un drive iniettato — è il pezzo che manca è solo il comando.

### Fuori dalla prima versione, deciso apposta (non sono buchi)

Zoom mensile della matrice · saturazione sommata su **tutti** i programmi accesi
(oggi legge il solo programma aperto, e la nota sta in chiaro dentro
`livelloSaturazione`) · matrice su telefono · timesheet · dipendenze e percorso
critico · costi in euro.

---

## Dove mettere le mani

| file | cosa c'è dentro |
|---|---|
| `src/programma.js` | i conti e le regole. Niente rete, niente React: se una funzione ha bisogno del DOM sta nel posto sbagliato |
| `src/programmaStore.js` | registro e documento su OneDrive, `reapply` che unisce per chiave |
| `src/ProgrammaView.jsx` | il guscio, la testata, il salvataggio a 800 ms, l'attivazione |
| `src/programma/Matrice.jsx` | la matrice e la sua tastiera |
| `src/programma/ElencoVoci.jsx` · `DettaglioVoce.jsx` · `AttivaVoce.jsx` · `IncollaVoci.jsx` | il resto della vista |
| `src/programma/formato.js` | come si scrivono e si leggono le ore in una cella |
| `src/finto/semi.js` | la commessa finta di `dev:finto` |
| `scripts/prova-programma.mjs` | le prove: sono la specifica dei numeri |

Le tre cose da non cambiare senza accorgersene: le voci e le celle **non si
derivano l'una dall'altra**; una voce **non diventa** un'attività, la **genera**;
prima dell'attivazione una voce non esiste da nessuna parte tranne che qui.
