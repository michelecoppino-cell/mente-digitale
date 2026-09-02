# Il calendario di lavoro dentro Mente Digitale

Come far comparire nel Piano e in «Oggi» gli appuntamenti del calendario
aziendale, quando il tenant **non lo condivide** con l'account personale.

---

## Perché è un problema, e cosa lo risolve davvero

L'app parla con Microsoft Graph come l'**account personale**. Il calendario di
lavoro sta su un altro tenant, che non lo condivide: quell'account non lo vedrà
mai. Non c'è niente da correggere nel codice — è un limite dell'account, non un
difetto.

Quindi la domanda vera non è «come lo leggo», ma **«quale canale l'azienda
lascia aperto?»**. Ce n'è uno solo, ed è quello che si usava già: la posta.

### Le strade valutate

| Strada | Perché no |
|---|---|
| **Condivisione del calendario** con l'account personale | Bloccata dall'amministratore. È il punto di partenza |
| **Feed ICS pubblicato** (Outlook → «Pubblica un calendario») | È una condivisione anonima con un altro nome: lo stesso criterio che blocca la prima blocca questa. Resta supportata nel codice, se un giorno la aprissero |
| **Secondo account MSAL nell'app** (leggere il tenant di lavoro da Graph) | Serve registrare l'app sul tenant aziendale e il consenso dell'amministratore. Se l'amministratore concede qualcosa, concede la condivisione — che è mille volte più semplice |
| **Power Automate** dal lavoro al calendario personale | Le policy DLP di quasi tutti i tenant bloccano il connettore verso account personali. E riporta i difetti della sincronizzazione a eventi: doppioni, cancellazioni che non arrivano, roba da ripulire a mano |
| **Leggere l'ICS dal browser** | Impossibile senza un backend: quegli indirizzi non mandano gli header CORS, e la richiesta viene bloccata prima di partire. Questa app apposta non ha un backend |
| **File in una cartella cloud personale dal PC di lavoro** | OneDrive personale sul PC aziendale di solito non c'è o è bloccato. E se ci fosse, sarebbe la stessa cosa di quella scelta, con un pezzo in più che si può rompere |
| ✅ **Mail come trasporto di un'istantanea intera** | Usa il solo canale già consentito, e non ha nessuno dei difetti della vecchia sincronizzazione via mail — vedi sotto |

### «Ma la mail non l'avevamo già provata, e si rompeva?»

Sì, e **il difetto non era la posta: era la sincronizzazione a eventi.**

| Prima | Adesso |
|---|---|
| Una mail **per ogni evento** creato o modificato | **Una mail ogni due ore con l'agenda intera** |
| Una mail persa = un buco che nessun giro successivo recupera | Una mail persa = niente. Conta solo l'ultima, e la prossima riporta tutto |
| Il **corpo** letto con espressioni regolari | Un **allegato `.ics`**, cioè un formato con una grammatica, letto da un parser provato |
| Modifica = «cancella e ricrea»: su un errore restano due copie o zero | Non esiste il concetto di modifica: si riscrive tutta la finestra |
| Scriveva **dentro** il calendario personale, da ripulire a mano | Scrive **un file**, che l'app legge. Si spegne cancellandolo |
| Segnava le mail come lette e le spostava | Non tocca la casella: sulla posta ha solo `Mail.Read` |

Il meccanismo è lo stesso di uno specchio: **ogni giro riscrive tutto da capo**.
Cancellazioni e spostamenti arrivano gratis — non sono nell'ultimo `.ics`,
quindi non compaiono.

```
Outlook di lavoro ──(mail ogni 2h, .ics allegato)──▶ casella personale
                                                            │
                                            GitHub Action ◀──┘ (legge l'ultima)
                                                  │
                                                  ▼
                                      OneDrive: calendario-lavoro.json
                                                  │
                                                  ▼
                                         l'app, in sola lettura
```

### Il punto debole, e come si vede

Se il PC di lavoro resta spento, l'ultima mail invecchia e **l'agenda a schermo
resta quella di ieri**. Un calendario vuoto si nota, uno vecchio no: per questo
l'app dichiara l'età dello specchio. Dopo cinque ore senza una mail nuova,
nel filtro «Calendari ▾» del Piano compare *«fermo da N ore»*, e la stessa cosa
è scritta sulla scheda di ogni evento di lavoro.

---

## 1. Sul PC di lavoro

Serve una cosa sola: mandarsi l'agenda per mail, da soli, ogni due ore. È il
tasto **«Invia calendario tramite e-mail»** che Outlook ha già, premuto da un
compito pianificato. Nessun permesso da chiedere, niente da installare.

1. Copia `scripts/calendario-lavoro/Invia-Calendario.ps1` sul PC di lavoro,
   per esempio in `C:\Strumenti\`.

2. **Provalo a mano** (PowerShell, senza diritti da amministratore):

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Strumenti\Invia-Calendario.ps1 -A tuo.indirizzo@personale.it
   ```

   Deve stampare `Esportato: … (N KB)` e `Inviata a …`, e la mail deve arrivare
   con oggetto `CALENDARIO-LAVORO 2026-09-02 09:00` e un `.ics` allegato.

3. **Registra il compito pianificato**, ogni due ore a partire dalle 7:

   ```
   schtasks /Create /TN "Calendario lavoro" /SC HOURLY /MO 2 /ST 07:00 ^
     /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\Strumenti\Invia-Calendario.ps1 -A tuo.indirizzo@personale.it"
   ```

   Nell'Utilità di pianificazione la colonna **«Risultato ultima esecuzione»**
   dice se è andata: `0x0` è a posto.

> **Se non vuoi (o non puoi) usare un compito pianificato**, il meccanismo
> funziona lo stesso premendo il tasto a mano: in Outlook, **Home → Invia
> calendario tramite e-mail**, intervallo «prossimi 12 mesi», dettagli
> «Dettagli completi», oggetto che comincia con `CALENDARIO-LAVORO`. L'app
> legge sempre l'ultima mail arrivata, chiunque l'abbia mandata. Un'agenda
> aggiornata una volta al giorno è comunque meglio di nessuna agenda.

> **Sulla riservatezza:** stai mandando i dettagli dei tuoi appuntamenti alla
> tua casella personale. È esattamente quello che facevi già con la vecchia
> regola, ed è il tuo calendario — ma vale la pena saperlo, e valutare se il
> regolamento aziendale lo consente.

## 2. I segreti su GitHub

Repository → **Settings** → **Secrets and variables** → **Actions** → *New
repository secret*.

| Segreto | Cosa contiene | Serve? |
|---|---|---|
| `CALENDARIO_LAVORO_MAIL` | il marcatore con cui comincia l'oggetto: `CALENDARIO-LAVORO`. Un nome davanti alla barra verticale per scegliere come si chiama nell'app: `Studio\|CALENDARIO-LAVORO` | **sì** |
| `MENTE_REFRESH_TOKEN` | il refresh token del CLI (README, § *Il token*): `node scripts/get-refresh-token.mjs` | **sì** |
| `CALENDARIO_LAVORO_MITTENTE` | l'indirizzo di lavoro da cui deve arrivare. Senza, basta l'oggetto | consigliato |
| `GH_PAT` | un token GitHub con permesso sui segreti del repository, per **riscrivere `MENTE_REFRESH_TOKEN` a ogni giro**: quello Microsoft ruota, e senza questo fra qualche settimana smette di funzionare senza un motivo apparente | consigliato |
| `CALENDARIO_LAVORO_ICS` | un feed ICS pubblicato, il giorno che l'azienda lo consentisse. Convive con la posta | no |

## 3. Il primo giro

Repository → **Actions** → **Calendario di lavoro** → **Run workflow**.

Il log dice, per ogni fonte, quanti eventi ha letto e **di quando è il dato**:

```
[calendario-lavoro] Studio (mail): 143 eventi, del 2026-09-02T07:02.
[calendario-lavoro] Scritto: 143 eventi, 1/1 fonti.
```

Poi ricarica l'app, apri il **Piano** → **Calendari ▾**: deve esserci una riga
**Lavoro** col numero degli eventi. Da lì in poi gira da sola ogni due ore nei
giorni feriali.

---

## Quello che si può e non si può fare

- Gli eventi si **vedono** ovunque si vedano gli altri: Piano (giorno, settimana,
  mese), «Oggi», la settimana in arrivo. Prendono il loro colore dal filtro
  «Calendari ▾» come tutti.
- **Non si modificano e non si cancellano**: cliccandone uno si apre una scheda
  che lo dice. Non è una limitazione da togliere — lo specchio si riscrive
  intero ogni paio d'ore, quindi qualunque modifica fatta qui sparirebbe entro
  due ore e in silenzio.
- **Non ci si può programmare sopra un blocco**: il Piano li tratta come
  qualsiasi altro evento del calendario, cioè come tempo occupato.
- Le mail si accumulano nella casella. L'Action non le tocca apposta (`Mail.Read`
  e basta): se danno fastidio, una regola Outlook sul lato personale che le
  sposti in una cartella va benissimo — l'Action guarda le ultime quaranta mail
  ricevute, e le vede comunque.

## Quando qualcosa non torna

| Sintomo | Cosa guardare |
|---|---|
| «fermo da N ore» nel filtro «Calendari ▾» | Il PC di lavoro non manda più: Utilità di pianificazione → «Risultato ultima esecuzione». Spesso è Outlook chiuso e il PC in sospensione |
| «nessuna mail recente con oggetto …» | L'oggetto della mail non comincia col marcatore, o `CALENDARIO_LAVORO_MITTENTE` non è l'indirizzo giusto. Guarda l'oggetto vero di una mail arrivata |
| «la mail … non porta un allegato .ics» | La regola antivirus/DLP del lavoro ha tolto l'allegato in uscita. Prova a mandarla a mano da Outlook: se sparisce anche così, quella via è chiusa |
| La riga «Lavoro» non compare nel filtro | Lo specchio non esiste: l'Action non è mai andata a buon fine. Guarda il log |
| Gli eventi ci sono ma sono di un'ora sbagliata | Il `.ics` dichiara un fuso che non conosciamo: aggiungilo a `FUSI_WINDOWS` in `scripts/ics.mjs` (tutto quello che non riconosce ricade sull'ora di Roma) |
| Una serie ricorrente compare solo la prima volta | Una regola di ricorrenza che il lettore non copre: aggiungila a `occorrenzeDi()` e a `scripts/prova-ics.mjs`, che gira senza rete |
| Il token smette di funzionare dopo qualche settimana | Manca `GH_PAT`, quindi il segreto non viene riscritto: rifai il token e aggiungi il PAT |
