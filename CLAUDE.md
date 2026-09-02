# Mente Digitale — istruzioni per chi ci lavora

PWA personale, React 19 + Vite, sito statico su Cloudflare Pages. **Nessun
backend**: il browser parla direttamente con Microsoft Graph. Nessuna chiamata a
API AI a pagamento — dove serve l'AI l'app compone un prompt e lo mette negli
appunti.

Il **README** racconta il perché di ogni cosa ed è la fonte vera: 980 righe,
scritte per essere lette. Questo file è l'altra metà — cosa non si può rompere,
e come si lavora — e sta in una pagina apposta.

## Comandi

```bash
npm run dev         # server di sviluppo, contro il OneDrive vero
npm run dev:finto   # l'app in locale, senza rete e senza account
npm run typecheck   # tsc su jsconfig (JSDoc + checkJs)
npm run lint        # eslint
npm run build       # build di produzione in dist/
npm run prova       # le prove, contro un OneDrive finto in memoria
```

`npm run prova` non chiede né rete né account: gira sempre, ovunque, in pochi
secondi. La CI esegue tutti e quattro i comandi a ogni push e ogni PR.

## Prima di aprire una PR

1. `npm run typecheck && npm run lint && npm run build && npm run prova` — tutti
   verdi. Non è una formalità: contro il OneDrive vero l'app si prova solo in
   produzione, perché le API Graph rispondono solo su quell'URL.
2. Se hai toccato l'interfaccia, aprila: `npm run dev:finto` monta l'app sopra
   un OneDrive finto in memoria, con dentro una giornata plausibile. Nessuna
   rete, nessun account, e i dati veri restano dove sono.
3. Niente push diretto su `main`: branch, PR, merge.
4. Se hai toccato uno degli strati provati (`graphCore.js`, `api.js`,
   `taskStore.js`, `taskMigrazione.js`, `paraConfig.js`, `poolAttivita.js`, `programma.js`,
   `programmaStore.js`),
   aggiungi la verifica che avrebbe
   intercettato quello che hai corretto. Le prove si sono rotte una volta e
   nessuno se n'è accorto per settimane: è successo perché nessuna misura
   diceva che erano rotte.

## Le cose che non si toccano

**Un componente si importa.** `no-undef` non prende i nomi dentro il JSX — per
quello c'è `react/jsx-no-undef`, ed è acceso apposta: un componente spostato in
un altro file e non importato passerebbe tipi, lint e build senza una parola, e
si scoprirebbe a schermo bianco dopo il merge, perché l'app si prova solo in
produzione.

**Il serbatoio delle attività si scrive in un posto solo.** Le attività aperte
stanno nella cache di query, una voce per lista, e il pool è una lettura di
quella (`poolAttivita.js`). Non tenerne una copia in uno stato React o in un
`ref`: c'erano, e tenerle in pari a mano era la classe di difetti da cui
nascevano le schermate che mostravano la versione di prima.

**Un'attività ha uno e un solo stato.** Otto stati, la colonna in cui appare è
*derivata* da lì e non è mai un'etichetta salvata a parte. Due non sono un
campo, e non devono diventarlo: `inbox` è *la lista in cui il task sta*,
`scheduled` è *avere un blocco nel piano del giorno*. La mappatura sta in
`taskModel.js`, i campi in `taskStore.js`.

**Gli id delle attività non si rigenerano mai.** I blocchi in `daily-plans`, le
sveglie già suonate e la deduplica delle scadenze ricorrenti citano i task per
id. Spostare un'attività fra liste è uno spostamento vero (`spostaTask`), non un
crea-e-cancella.

**Ogni scrittura su OneDrive passa da `putDriveJson`.** Legge l'ETag, manda
`If-Match`, e sul 412 rilegge e riapplica. Chi scrive un documento che un altro
dispositivo può aver toccato nel frattempo passa un `reapply` — è così che il
diario scritto dal telefono non cancella quello scritto dal portatile. Chi non
lo passa riceve un errore invece di sovrascrivere in silenzio: è voluto.

**MSAL resta fissato alla `3.30.0` esatta, senza `^`.** Dalla v4 in poi MSAL
cifra la cache e tiene la chiave in un cookie di sessione: su iPhone la sessione
del browser finisce ogni volta che iOS chiude l'app aperta dall'icona, e
all'avvio dopo MSAL butta la cache perché «cifrata con un'altra chiave».
L'accesso sparisce senza un errore e senza che niente smetta di compilare. Il
perché per esteso è nel README e in `auth.js`.

**Il refresh token è monouso e ruota.** Due rinnovi forzati insieme sono due
riscatti dello stesso token: il primo invalida il secondo, e MSAL si porta via
l'account. Da qui la coda in `auth.js`, il lucchetto fra le istanze
(`md_auth_refresh_lock`) e la regola di non forzare mai un rinnovo all'avvio.

**`localStorage` è uno solo, e ci vive anche l'account.** Quando finisce lo
spazio `setItem` smette di funzionare per tutti, MSAL compreso, e l'accesso
sparisce. Per questo la cache delle query ha un tetto (`PERSIST_BUDGET`) e
butta le query più grosse invece di riempire il cassetto.

**Il CLI e il server MCP scrivono sugli stessi file.** Le regole stanno in
`scripts/mente-comandi.mjs`, che importa `taskModel.js`, `paraConfig.js`,
`obiettivi.js` e `diary.js` da `src/`. Una regola sulle attività si cambia lì
dentro, non in due posti.

**Da fuori non si cancella niente, e calendario, OneNote e piani si leggono
soltanto.** È una regola del CLI e del server MCP, non un'omissione: sono le
cose che non si ricostruiscono da una cronologia.

## Dove sta cosa

| | |
|---|---|
| `src/graphCore.js` | i file su OneDrive: cartella, percorsi, ETag, 412, migrazioni. Il trasporto si inietta |
| `src/api.js` | Microsoft Graph dal browser: MSAL, tentativi, e tutte le letture che non sono file |
| `src/taskStore.js` | le attività su file nostri: registro delle liste, un file per lista |
| `src/taskModel.js` | il flusso GTD: stati, persone, granularità |
| `src/paraConfig.js` | i nomi PARA e le consegne annidate (`2573.A60-260831`) |
| `src/auth.js` | MSAL, la coda dei token, il rinnovo programmato, la scatola nera |
| `src/queryClient.js` | TanStack Query, le chiavi, la persistenza col suo tetto |
| `src/poolAttivita.js` | il serbatoio delle attività: una lettura della cache, non uno stato |
| `src/use*.js` | i pezzi che stavano in `App.jsx` e non c'entravano con lui: la campanella, le scadenze ricorrenti, i colori, le sveglie |
| `src/programma.js` | il Programma di commessa: i conti, le chiavi del carico, lo stato derivato di una voce. Niente rete, niente React: è il file su cui girano le prove |
| `src/programmaStore.js` | gli stessi programmi su OneDrive: registro, un documento per commessa, `reapply` che unisce per chiave |
| `src/programma/` | la vista: la matrice e la sua tastiera, l'elenco voci, il dettaglio, attiva, incolla in massa |
| `src/planner/` | la griglia del Piano (misure, colori, conti) e i suoi componenti: settimana, mese, capacità, modale evento |
| `src/tokens.css` | colori, tipografia, spazi, raggi — la sola fonte |
| `src/tempo.js` | il giorno locale, l'ora, le durate — scritti una volta sola |
| `src/finanze/` | isola TypeScript, dati in IndexedDB, backup su OneDrive |
| `scripts/mente-graph.mjs` | lo stesso nucleo fuori dal browser, con un refresh token invece di MSAL |
| `src/finto/` | il OneDrive finto: quello su cui girano le prove, e quello che `dev:finto` monta nel browser |

Le rotte stanno nell'**hash** (`#/oggi`, `#/piano`, …) e non nel path: il sito è
statico, e senza `_redirects` un ricaricamento su `/piano` chiederebbe al server
un file che non esiste.

«Oggi» è la vista che si apre e sta nel primo scaricamento. Le altre — Piano,
Attività, Sezioni, Diario, Finanze, Mappa — arrivano con `lazy()`, e una vista
nuova si aggiunge così: quello che «Oggi» non apre non deve pesare sull'avvio
del telefono. Attenzione a cosa si sposta: il riquadro del Diario e le azioni
della giornata che «Oggi» mostra non vengono da `DiaryPanel` e `ActivityBoard`
ma da `diary.js` e `taskModel.js`, che restano nel chunk d'avvio.

## Come si scrive qui

I commenti dicono **perché**, non cosa, e spesso raccontano com'era prima e
perché non andava. Non è decorazione: è il modo in cui questo progetto ricorda
le decisioni, ed è la ragione per cui si può rientrarci dopo mesi. Un commento
che ripete il codice si toglie; uno che spiega una scelta non ovvia si scrive
anche se è lungo.

Il progetto è **in italiano**: commenti, nomi nuovi, interfaccia, messaggi di
commit. Il codice più vecchio ha ancora nomi inglesi (`handleSubmit`, `t2m`) e
si traducono quando si tocca quel pezzo, non in una passata a parte. Gli
identificatori che vengono da Graph restano com'erano.

I messaggi di commit sono una frase in minuscolo che dice cosa cambia per chi
usa l'app, e sotto il perché.

## Debito dichiarato

Cose note, già decise, da non riscoprire:

- **`// @ts-nocheck`** (`grep -rl "@ts-nocheck" src`). È un elenco che si
  accorcia una riga per volta, non un permesso: un file nuovo nasce
  controllato. Vedi la nota in `jsconfig.json`.
- **`PlannerView.jsx`, 2.200 righe.** Quello che restava dopo aver separato la
  griglia e i quattro componenti in `src/planner/`: la vista Giorno, il
  trascinamento, il ridimensionamento, i filtri e i salvataggi. Il prossimo
  pezzo è lo stato del trascinamento in un hook suo.
- **Il PIN delle Finanze non è cifratura, ed è giusto così.** SHA-256 senza
  sale di sei cifre, e l'hash viaggia dentro il backup su OneDrive. Non è una
  svista da correggere: serve a coprire lo schermo da chi passa vicino alla
  scrivania, e per quello basta. Irrobustirlo — sale, PBKDF2, l'hash fuori dal
  documento sincronizzato — costerebbe il PIN da rimettere e la sincronizzazione
  fra dispositivi, cioè peggiorerebbe l'unica cosa che deve fare. L'unica cosa
  da sapere: chi riceve un export ha anche il PIN.
