# La mente digitale a voce, dall'auto

Come mettere in piedi il **connettore remoto**: lo stesso server MCP che gira
sul tuo computer, ma raggiungibile in HTTPS, così l'app Claude — telefonata
compresa — può leggere e scrivere la mente digitale mentre guidi.

---

## Perché serviva un'altra strada

`scripts/mente-mcp.mjs` è un processo che il client avvia **sul tuo disco** e
chiude con la chat. Funziona dal terminale e dalla scheda Code dell'app
desktop, e non funziona da nessun'altra parte — non perché manchi una
configurazione, ma perché una pipe fra due processi sulla stessa macchina non è
raggiungibile da un telefono.

La modalità voce dell'app usa i **connettori dell'account**, cioè server MCP
remoti in HTTPS: gli stessi strumenti della chat scritta, chiamati mentre
parli. Quindi per usare la mente digitale guidando serviva esattamente questo,
e nient'altro: lo stesso server, un altro trasporto.

Due cose da sapere prima di cominciare, perché cambiano le aspettative:

- **Claude chiede il permesso** prima di usare uno strumento connesso. A voce
  si risponde a voce, ma è un giro di parole in più per ogni azione.
- **Non tutto quello che torna appare a schermo.** Un elenco lungo lo si sente
  riassunto. È il motivo per cui dal connettore escono quattordici strumenti e
  non ventuno: vedi *Cosa esce di casa*, più sotto.

### Cosa gira dove

```
        il tuo computer                          Cloudflare
   ┌───────────────────────┐              ┌────────────────────────┐
   │  Claude Code / Code   │              │  worker/index.js       │
   │         │             │              │    OAuth + /mcp        │
   │  mente-mcp.mjs (pipe) │              │         │              │
   └─────────┼─────────────┘              └─────────┼──────────────┘
             │      21 strumenti                    │  14 strumenti
             └──────────────┬───────────────────────┘
                            ▼
              scripts/mente-mcp-nucleo.mjs      gli strumenti e il protocollo
              scripts/mente-comandi.mjs         le operazioni e le regole
              src/graphCore.js, taskStore.js…   i file su OneDrive
```

Le due strade **convivono**: quella sul computer non cambia e non va spenta.
Sono usi diversi — da tastiera si vuole tutto, guidando si vuole poco e
dicibile.

---

## Cosa esce di casa

| | |
|---|---|
| Guardare | `oggi`, `agenda`, `piano`, `piano_arco`, `attivita_lista`, `sezioni`, `obiettivi_leggi` |
| Scrivere | `attivita_crea`, `attivita_stato`, `piano_aggiungi`, `piano_togli`, `evento_crea`, `diario_scrivi`, `sezione_crea` |

Restano sul computer: tutto OneNote (`note_*`), `diario_leggi`,
`obiettivi_scrivi` e `identita`. Il perché sta scritto accanto all'elenco, in
`scripts/mente-mcp-nucleo.mjs` (`NOMI_DA_VOCE`): in breve, ogni strumento in più
è tempo di attesa in telefonata, e le cose che si scrivono pensandoci non si
dettano in tangenziale.

Da qui non si cancella niente, come dal computer. È una regola del progetto, non
un'omissione.

---

## Metterlo in piedi

Serve un account Cloudflare (il piano gratuito basta: il connettore fa qualche
decina di richieste al giorno, il limite è centomila) e Node sul computer.

### 1. Un token Microsoft solo per il Worker

```bash
node scripts/get-refresh-token.mjs --remoto
```

**Non copiare il token del computer.** Il refresh token ruota a ogni uso: due
copie della stessa chiave in due posti si invalidano a vicenda, ed è la stessa
ragione per cui il README dice di rifare il giro su un secondo computer invece
di copiare il file.

`--remoto` chiede **meno scope**: `Files.ReadWrite` e `Calendars.ReadWrite`,
senza posta e senza OneNote. Nessuno dei quattordici strumenti ne ha bisogno, e
un token che vive fuori da casa deve poter fare solo quello che gli serve.

### 2. L'archivio

```bash
cd worker
npx wrangler kv namespace create MENTE
```

Stampa un `id`: incollalo in `worker/wrangler.toml` al posto di `DA_RIEMPIRE`.

Ci finiscono dentro il token di Microsoft (che ruota), i client registrati, i
codici usa-e-getta e i token del connettore.

### 3. I segreti

```bash
npx wrangler secret put MENTE_REFRESH_TOKEN   # quello del punto 1
npx wrangler secret put MENTE_PASSPHRASE      # lunga: è la chiave di casa
npx wrangler secret put MENTE_BEARER          # facoltativo, vedi «se non aggancia»
```

La passphrase si digita **una volta sola**, collegando il connettore. Falla
lunga e non riusarla altrove: chi conosce l'indirizzo del Worker può provarla.
Dopo otto tentativi sbagliati la porta si chiude per un quarto d'ora.

### 4. Pubblicare

```bash
npx wrangler deploy
```

Stampa l'indirizzo, del tipo `https://mente-digitale.<account>.workers.dev`.
Un `curl` su quello risponde con due righe che dicono cos'è: se le vedi, è su.

### 5. Aggiungerlo a Claude

Impostazioni → **Connettori** → *Aggiungi connettore personalizzato* →
l'indirizzo con `/mcp` in coda:

```
https://mente-digitale.<account>.workers.dev/mcp
```

Claude apre una pagina con un campo: la passphrase. Da lì in avanti, in elenco
accanto agli altri, c'è **mente-digitale** — e in telefonata puoi dire «guarda
sulla mente digitale».

Serve un piano Pro o Max: i connettori personalizzati non ci sono nel piano
gratuito.

---

## Se non aggancia

Il flusso OAuth dei connettori personalizzati ha inciampi noti e non tutti
dipendono da questo codice. Prima di mettersi a rifare le cose:

1. **L'indirizzo finisce con `/mcp`?** Senza, Claude trova una pagina di testo
   e non un connettore.
2. **Prova i due documenti a mano**: `/.well-known/oauth-protected-resource` e
   `/.well-known/oauth-authorization-server` devono rispondere JSON, con dentro
   l'indirizzo giusto. Se l'indirizzo è sbagliato, il Worker sta rispondendo su
   un dominio diverso da quello che hai incollato.
3. **Guarda cosa succede davvero**: `npx wrangler tail` mostra le richieste in
   diretta. Se dopo l'inserimento della passphrase non arriva nessuna chiamata
   a `/token`, il giro si è interrotto dall'altra parte — non da qui.
4. **La via di scampo**: se hai messo `MENTE_BEARER`, aggiungi il connettore
   come server senza autenticazione e passa quel token come header
   `Authorization: Bearer …` nelle impostazioni avanzate del connettore. Meno
   elegante, stessa sicurezza pratica, e funziona anche se il giro OAuth non va.

## Se qualcosa smette di funzionare

| Sintomo | Cosa guardare |
|---|---|
| Ogni strumento risponde «Token rifiutato» | Il refresh token è morto (non usato per più di 90 giorni, o revocato). Rifai il punto 1 e rimetti il segreto |
| «403» su qualcosa che prima andava | Scope: il token è cucito con quelli che aveva quando l'hai preso. Se aggiungi uno strumento che tocca qualcosa di nuovo, il token va rifatto |
| Il connettore c'è ma non risponde più | `npx wrangler tail` mentre fai una domanda. Nessuna richiesta in arrivo = il problema è a monte, dalla parte di Claude |
| Hai cambiato idea | `npx wrangler delete` e il connettore sparisce. Il token Microsoft resta valido: revocalo dalle impostazioni di sicurezza dell'account Microsoft se vuoi chiudere davvero |

## Il prezzo, detto chiaro

Il refresh token del OneDrive personale **vive su Cloudflare**, non sul tuo
disco. È il costo di avere un connettore che risponde anche quando il computer
è spento — cioè esattamente quando serve, guidando. Le difese sono tre e sono
tutte qui sopra: un token dedicato, con meno scope, dietro una passphrase.

Se un giorno non ti va più bene, la strada alternativa è un tunnel
(`cloudflared`) davanti a un computer sempre acceso: il token resta a casa, e
il connettore vale quanto vale l'accensione di quella macchina.

## Le prove

```bash
npm run prova-mcp-remoto
```

Gira senza rete e senza account: il Worker è un modulo che esporta
`fetch(request, env)`, e sotto ci sono il finto OneDrive di `src/finto/` e un
KV in memoria. Fa il giro OAuth per intero come lo farebbe Claude, chiama gli
strumenti, e controlla anche che nel pacchetto non finisca niente di Node né la
libreria del login del browser. È l'unico modo di provare questa roba prima di
pubblicarla.
