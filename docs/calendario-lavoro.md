# Il calendario di lavoro dentro Mente Digitale

Come far comparire nel Piano e in «Oggi» gli appuntamenti del calendario
aziendale, che l'account personale non può vedere.

Il perché di questa strada — e perché la sincronizzazione via mail si rompeva
sempre — sta nel README (§ *Il calendario di lavoro*) e in testa a
`scripts/sync-calendario-lavoro.mjs`. Qui c'è solo cosa fare.

---

## In due parole

Una GitHub Action legge il **feed ICS** del calendario di lavoro e ne scrive uno
**specchio** su OneDrive. L'app legge quel file e mostra gli eventi come un
calendario in più, in sola lettura. Nel calendario personale non si scrive
niente.

```
Calendario di lavoro ──(ICS)──▶ GitHub Action ──▶ OneDrive ──▶ app
     (aziendale)                 ogni 2 ore      calendario-lavoro.json
```

---

## 1. L'indirizzo del feed

### Se l'azienda lascia pubblicare i calendari (il caso normale)

Da **Outlook sul web**, con l'account di lavoro:

1. Impostazioni (⚙) → **Calendario** → **Calendari condivisi**
2. Sotto **Pubblica un calendario**: scegli il calendario, e come autorizzazioni
   **«Può visualizzare tutti i dettagli»**
3. **Pubblica**
4. Copia il link che finisce in **`.ics`** (quello accanto dice `.html` ed è la
   pagina web: non serve)

L'indirizzo è lungo e contiene una chiave casuale. Vale quanto la lettura del
calendario: chi ce l'ha vede gli appuntamenti, quindi va trattato come una
password — sta in un segreto GitHub, non nel repository.

### Se la voce «Pubblica un calendario» non c'è

L'amministratore l'ha disattivata (`Set-SharingPolicy` con la condivisione
anonima esclusa). Tre strade, in ordine di preferenza:

1. **Chiedere all'amministratore** di abilitare la pubblicazione per la sola
   casella — è la cosa più pulita, e non concede niente ad altri.
2. **Da Outlook desktop sul PC di lavoro**: Calendario → tasto destro sul
   calendario → **Condividi** → **Pubblica online**. Alcuni tenant la lasciano
   qui anche quando dal web non compare.
3. **Un ICS auto-prodotto**: qualunque cosa che, sul PC di lavoro, esporti il
   calendario in un `.ics` raggiungibile via HTTPS (una cartella sincronizzata
   con un link pubblico, una Power Automate schedulata che scrive il file). Lo
   script non chiede altro che un indirizzo che risponda con un ICS.

Quello che **non** si è fatto, e perché:

- **Un secondo account MSAL nell'app.** Vorrebbe dire registrare l'app anche
  sul tenant aziendale e chiedere il consenso dell'amministratore. Se
  l'amministratore lo dà, la condivisione del calendario è più semplice da
  ottenere; se non lo dà, non serve a niente.
- **Leggere l'ICS dal browser.** Non si può: quell'indirizzo non manda gli
  header CORS, e la richiesta viene bloccata prima di partire. Servirebbe un
  proxy, cioè un backend — che questa app apposta non ha.
- **Power Automate che copia gli eventi sul calendario personale.** Riporta i
  problemi della sincronizzazione a eventi (doppioni, cancellazioni che non
  arrivano, roba scritta dentro il calendario personale da ripulire a mano), e
  in più le policy DLP di molti tenant bloccano proprio il connettore verso
  account personali.

---

## 2. I due segreti su GitHub

Repository → **Settings** → **Secrets and variables** → **Actions** → *New
repository secret*.

| Segreto | Cosa contiene |
|---|---|
| `CALENDARIO_LAVORO_ICS` | l'indirizzo del feed. Più di uno: **uno per riga**. Un nome davanti alla barra verticale se vuoi scegliere come si chiama: `Studio\|https://outlook.office365.com/owa/calendar/…/calendar.ics` |
| `MENTE_REFRESH_TOKEN` | il refresh token del CLI — lo stesso del README, § *Il token*. Si prende con `node scripts/get-refresh-token.mjs` |

C'è anche un terzo segreto, facoltativo ma consigliato:

| `GH_PAT` | un token GitHub con permesso sui segreti del repository. Serve a **riscrivere `MENTE_REFRESH_TOKEN` a ogni giro**: il refresh token Microsoft ruota a ogni rinnovo, e senza questo fra qualche settimana quello vecchio smette di funzionare senza un motivo apparente. Senza `GH_PAT` la Action funziona lo stesso, ma il token va rifatto a mano ogni tanto |

---

## 3. Il primo giro

Repository → **Actions** → **Calendario di lavoro** → **Run workflow**.

Il log dice, per ogni fonte, quanti eventi ha letto. Poi:

- ricarica l'app e apri il **Piano**;
- **Calendari ▾** deve mostrare una riga **Lavoro** col numero degli eventi;
- se il numero è zero o la riga non c'è, il log dell'Action dice perché.

Da lì in poi gira da sola ogni due ore nei giorni e nelle ore di lavoro.

---

## Quello che si può e non si può fare

- Gli eventi si **vedono** ovunque si vedano gli altri: Piano (giorno, settimana,
  mese), «Oggi», la settimana in arrivo. Prendono il loro colore dal filtro
  «Calendari ▾» come tutti.
- **Non si modificano e non si cancellano**: cliccandone uno si apre una scheda
  che lo dice. Non è una limitazione da togliere — lo specchio si riscrive
  intero ogni paio d'ore, quindi qualunque modifica fatta qui sparirebbe entro
  due ore e in silenzio. Si modificano nel calendario di lavoro, e tornano in
  pari al giro dopo.
- **Non ci si può programmare sopra un blocco**: il Piano tratta questi eventi
  come qualsiasi altro evento del calendario, cioè come occupato.

## Quando qualcosa non torna

| Sintomo | Cosa guardare |
|---|---|
| La riga «Lavoro» non compare nel filtro | Lo specchio non esiste: la Action non è mai andata a buon fine. Guarda il log |
| «la risposta non è un calendario ICS» | Il link è scaduto o è stato ripubblicato: da Outlook, **Annulla pubblicazione** e ripubblica, poi aggiorna il segreto |
| Gli eventi ci sono ma sono di un'ora sbagliata | Il feed dichiara un fuso che non conosciamo: aggiungilo a `FUSI_WINDOWS` in `scripts/ics.mjs` (tutto quello che non riconosce ricade sull'ora di Roma) |
| Una serie ricorrente compare solo la prima volta | Una regola di ricorrenza che il lettore non copre: aggiungila a `occorrenzeDi()` e a `scripts/prova-ics.mjs`, che gira senza rete |
| Il token smette di funzionare dopo qualche settimana | Manca `GH_PAT`, quindi il segreto non viene riscritto: rifai il token e aggiungi il PAT |
