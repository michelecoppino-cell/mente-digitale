# Mente Digitale

Dashboard personale (PWA) che unifica l'ecosistema Microsoft 365 in un'unica "mente digitale":
una mappa mentale interattiva dei taccuini OneNote, un pianificatore giornaliero collegato al
calendario Outlook, e un diario con supporto AI via copia-incolla. Le attività sono file JSON
su OneDrive, nostri.

## Funzionalità

- **Mappa mentale (D3)** — taccuini e sezioni OneNote come grafo force-directed navigabile;
  badge con il numero di task aperti per sezione; "orb" centrale con documenti identitari
  (Bussola / Visione) salvati su OneDrive.
- **Pannello sezione** — pagine OneNote, attività della lista omonima e link OneDrive
  per la sezione selezionata.
- **Pianificatore giornaliero** — drag & drop dei task su una timeline a slot di 30 minuti,
  vista giorno/settimana, eventi del calendario in sola lettura, sottostep ridimensionabili,
  piani salvati su OneDrive. Candidati task estratti da email ed email OneNote con euristiche
  locali (`src/dailyReview.js`), senza chiamate AI. Da telefono il Piano si legge e basta: il
  trascinamento è il gesto di uno schermo largo, e pianificare col pollice vorrebbe dire un
  gesto diverso — la proposta sta in `docs/proposta-piano-da-telefono.md`, non è costruita.
- **Oggi** — la home, divisa in due metà. A sinistra la **giornata operativa**: «Oggi · agenda e
  azioni», cioè appuntamenti del calendario e azioni programmate in un elenco solo ordinato per
  ora, e sotto «In arrivo» con i giorni che vengono. A destra la **vita**: gli obiettivi del mese,
  il movimento, quello che c'è da leggere e vedere; e in una colonna sua i tre riquadri riservati
  — Bussola, Finanze e Diario. Da desktop la scheda sta in una schermata sola: quello che non ci
  sta scorre dentro il suo elenco, la pagina non si allunga. Non ha una lista propria: è tutto
  una query sul giorno corrente.
- **Obiettivi del mese** — da tre a sei righe con una barra ciascuna, liberi e diversi ogni mese.
  Quello che l'app già conta (sessioni di movimento, giorni di diario, pagine di un libro) non si
  scrive a mano: l'obiettivo dichiara una `fonte` e il numero si deriva. Le frecce in testata al
  modulo spostano il mese: fino a un anno avanti, per scrivere un obiettivo quando ci si pensa
  invece di aspettare il primo del mese, e fino a sei mesi indietro per correggere un numero
  contato a mano. In «Oggi» compaiono sempre e solo quelli del mese corrente. Su OneDrive in
  `mente-digitale-obiettivi.json`, raccolti per mese.
- **Da leggere e vedere** — libri, serie, film, corsi, articoli e PDF in un elenco solo, diviso
  fra «in corso» e «in coda». Un indirizzo incollato diventa una riga da sé: dominio come fonte,
  ultimo pezzo del percorso come titolo. Su OneDrive in `mente-digitale-coda.json`.
- **Movimento** — allenamento, meditazione e yoga: la settimana a barre, un bersaglio settimanale
  per famiglia, e il confronto fra le sessioni programmate in un calendario dedicato e quelle
  davvero registrate. Il registro sta su OneDrive (`mente-digitale/movimento/movimento-YYYY-MM.json`), il
  calendario si legge soltanto.
- **Rituale del mattino** — l'unico pannello che si apre da solo: la prima volta che si entra in
  «Oggi» in una giornata chiede se movimento, meditazione e yoga sono stati fatti. Le tre caselle
  nascono despuntate con la motivazione già scelta («non sono riuscito», o «sono andato a dormire
  troppo tardi», «lavorato», «Claude»): confermare un no costa un tocco, e un no motivato è un
  dato, non un silenzio. Spuntare una casella scrive una sessione vera nel registro del Movimento.
  Si corregge in qualunque momento della giornata dalla riga «Il mattino» nel riquadro Movimento,
  e i giorni in cui l'app non è stata aperta (fino a tre indietro) vengono compilati come «non
  fatto» — dichiarandolo in cima al pannello. Su OneDrive in `mente-digitale-rituale.json`.
- **Sezioni** — la plancia operativa di una sezione PARA in cinque colonne: pagine OneNote,
  percorsi (cartelle, dischi di rete e link come pastiglie: le categorie OneDrive e Web aprono
  il collegamento, tutte le altre copiano il percorso), attività della sezione — che si
  trascinano sulla giornata per programmarle, come nel Piano e sullo stesso piano — il
  dettaglio di quella scelta e la giornata di oggi. L'elenco delle sezioni si toglie di mezzo
  appena se ne apre una. Una commessa con più **consegne** (liste annidate per nome,
  vedi sotto) le mostra come gruppi a tendina, ognuno con la sua scadenza; il `+` in testata
  ne crea una nuova, e un'attività si sposta da una consegna all'altra trascinandola.
  Le attività che hanno già un blocco nel piano — in un giorno qualunque — si leggono in
  grigio, col giorno e l'ora nel titolo: la colonna dice a colpo d'occhio cosa resta da
  collocare, senza rimettere a piano due volte la stessa cosa.
  In fondo alla colonna, fuori dalle consegne, due elenchi a parte raccolti per persona:
  **da chiedere** e **delegati**. Dentro una consegna direbbero «manca questo pezzo», che
  è falso — il pezzo è in mano a qualcuno, e quello che serve sapere è a chi, per tutta la
  commessa insieme.
- **Attività** — le cinque colonne del flusso GTD (Inbox · Prossime azioni · In attesa · Programmate · Un giorno):
  la colonna *è* lo stato, e trascinare una card fra colonne lo cambia. Un clic su una
  card apre il pannello di dettaglio — note, sottoattività, stima, scadenza, stato.
  In fondo a due colonne ci sono altrettante **aree**: *Da chiedere* sotto le prossime azioni e
  *Delegati* sotto le attese. Non sono colonne nuove — sono lo stesso punto del flusso con dentro
  una persona — e lì il raggruppamento cambia: per nome invece che per sezione, così quando si becca
  Sara si vede in un colpo tutto quello che le si deve chiedere. I nomi che ricorrono stanno in
  `src/persone.json` e nel pannello arrivano come pastiglie da toccare.
- **Diario** (voce *Diario* nel menù, `⌘J`) — tre modalità distinte: *svuota testa* a schermo
  intero (timer 5/10 min, domanda selezionabile dall'elenco o rimovibile, righe che sbiadiscono
  mentre scrivi, pannello "come funziona" con il metodo e le fonti), *rituale della sera* (tre
  domande, gratitudini, umore ed energia) e *scrittura libera*, che è solo il foglio — niente
  timer, niente domanda, niente sfumatura, correttore acceso. Ogni voce esce con conserva /
  chiudi nel cassetto / lascia andare senza salvare. Ogni voce può portarsi dietro fino a otto
  **foto** con didascalia (una voce di sole foto è valida): l'immagine viene ridotta a 1600 px sul
  dispositivo e salvata come file in `mente-digitale/diario-foto/` su OneDrive — nel JSON del mese
  finisce solo il nome. Timeline con ricerca e tag. Il bottone
  **Copia per l'AI** compone il markdown di un periodo (con la Bussola come contesto) da
  incollare in una chat AI per chiedere supporto. Voci salvate su OneDrive in file mensili;
  il diario non passa da alcuna funzione server. Diario e cattura sono sempre
  raggiungibili dal menù, da qualunque vista.

- **Finanze** — contabilità personale, saldo reale e proiezione futura, assorbita dall'app
  omonima che prima viveva per conto suo. Nel menù è **una** voce; dentro, sette schede
  (saldo, analisi spese, proiezione, fatture, tasse, movimenti, impostazioni) che sono rotte
  vere, quindi indirizzabili e con il tasto indietro funzionante. Vedi sotto.

### Finanze

I dati stanno in **IndexedDB**, non su Microsoft Graph come il resto dell'app: sono un
singolo snapshot JSON (movimenti categorizzati, fatture, anni fiscali, mutui, parametri)
con la stessa forma del file di export. Il backup va su OneDrive in
`mente-digitale/mente-digitale-finanze.json`, con l'accesso Microsoft già fatto dall'app —
niente secondo login, niente registrazione Azure dedicata.

**Portare qui i dati della vecchia app**: quando Finanze era separata il backup viveva in
`Apps/Finanze/finanze.json`, una cartella che mente-digitale non può leggere (usava lo scope
`Files.ReadWrite.AppFolder` al posto di `Files.ReadWrite`). Si recupera una volta sola:
*Esporta JSON* dalla vecchia app, *Finanze → Impostazioni → Importa JSON* qui. Da lì in poi
la sincronizzazione riparte dalla cartella nuova.

**PIN.** La sezione si apre con un PIN numerico, si richiude da sola dopo mezz'ora e subito
col pulsante *Blocca* nella barra delle schede. Serve a non lasciare i conti in chiaro su uno
schermo aperto in ufficio: non è cifratura — i dati in IndexedDB restano leggibili a chi ha
accesso al browser e sa dove guardare, e sei cifre si provano tutte in un istante. Si cambia
o si toglie da *Finanze → Impostazioni*.

### Importare il Diario dell'iPhone

Due strade per la stessa cosa, con lo stesso parser (`src/appleDiary.js`) sotto: gli id
delle voci derivano dall'export, quindi importare due volte — o una volta per strada —
aggiorna le voci invece di sdoppiarle.

**Dal telefono** (`Diario → Importa dal Diario dell'iPhone`): si sceglie lo zip dall'app
File e l'app fa tutto, scrivendo direttamente sul OneDrive a cui è già collegata. Nessuna
estrazione, nessun passaggio da PC. Su iPhone è anche la strada migliore per le foto: Safari
decodifica gli HEIC di suo, quindi la conversione in JPEG avviene sul telefono. Un browser
che non li sa leggere le salta e lo dice, invece di caricare immagini che nessuno vedrebbe.

**Da PC**, per archivi molto grandi o per controllare il risultato prima che tocchi il
diario vero: `scripts/importa-diario-apple.mjs` converte l'esportazione dell'app **Diario di
Apple** (Impostazioni → Diario → *Esporta*) nel formato del Diario di Mente Digitale.

```bash
npm install
npm run importa-diario -- AnnotazioniDiarioApple.zip
```

Legge lo zip senza scompattarlo (lettore ZIP incluso: niente `unzip` da installare), ricava
da ogni pagina HTML data, titolo, testo e domanda di riflessione — che diventa il `seed`
della voce — e converte le foto **HEIC in JPEG** ridimensionati, il passaggio che rende
l'archivio leggibile fuori da Safari. Le voci diventano di tipo *scrittura libera*, con il
tag `iphone` per distinguerle (`--tag`).

Il risultato è una cartella `import-diario/` che riproduce la struttura di OneDrive
(`diario/diario-YYYY-MM.json`, l'indice dei mesi, `diario-foto/`): l'ultimo passo è
copiarla dentro `mente-digitale/` sul OneDrive. Lo script non scrive mai sul tuo OneDrive.

Opzioni utili: `--senza-foto` per portare dentro solo i testi e occuparsi delle immagini
dopo (rilanciando senza l'opzione le stesse voci si aggiornano, non si sdoppiano),
`--dry-run` per vedere cosa farebbe, `--tutti-gli-asset` per importare anche
le schede generate da iOS (mappe dei luoghi, allenamenti con distanza e tempo, stato
d'animo), `--max-lato` e `--qualita` per il peso delle foto. I video restano fuori — il
Diario non li mostra — ma vengono copiati in `media-non-importati/` invece di sparire.
Rieseguirlo è sicuro: id delle voci e nomi delle foto derivano dall'export, quindi un
secondo giro aggiorna le stesse voci invece di duplicarle, e i file già presenti nella
cartella di destinazione vengono uniti, non sostituiti.

### Due icone sulla schermata Home di iPhone

iOS ignora gli `shortcuts` del manifest: per avere più icone servono più pagine da
aggiungere alla Home. `public/gtd.html` e `public/diario.html` esistono per questo — hanno
icona, nome e status bar propri e, quando vengono lanciate dalla loro icona (`standalone`),
rimbalzano sull'app con `?apri=gtd` / `?apri=diario`, che `App.jsx` traduce nella cattura
rapida o nella rotta del Diario già al primo render. Viste in Safari restano invece ferme, altrimenti
si finirebbe per aggiungere alla Home l'app invece della scorciatoia.

Per installarle: apri `/gtd.html` (e poi `/diario.html`) in Safari → Condividi →
*Aggiungi a Home*.

## Navigazione

Sei destinazioni, ognuna con un indirizzo proprio. Il menù è il rail a sinistra
(216 px, riducibile a sole icone, drawer su schermo stretto); in cima il pulsante
**Cattura** (`⌘N` da qualunque vista).

| Rotta | Vista |
|---|---|
| `#/oggi` | Home: agenda e azioni di oggi in un elenco, in arrivo, obiettivi, movimento, coda, riservati |
| `#/piano` | Il Piano: serbatoio, giornata a blocchi, capacità della giornata, pannello di dettaglio |
| `#/attivita` | Le cinque colonne del flusso, con la lente Scadenza (`?vista=`, `?ctx=`) |
| `#/sezioni/:id` | Plancia della sezione: OneNote, percorsi, attività, dettaglio, oggi |
| `#/diario` | Diario |
| `#/mappa` | La mappa mentale |

Le rotte stanno nell'hash e non nel path: l'app è servita come sito statico da
Cloudflare Pages e, senza un `_redirects`, un ricaricamento su `/piano`
chiederebbe al server un file che non esiste. Con l'hash la rotta non lascia mai
il client, e le due pagine-scorciatoia (`/gtd.html`, `/diario.html`) restano
file veri.

**Da telefono la barra dei comandi sta in fondo** (sotto gli 860 px). In cima era
il posto peggiore che avesse: il telefono si tiene in una mano, il pollice arriva
al bordo basso, e lassù finivano proprio i tre comandi presenti su ogni
schermata. Non è una barra nuova — è la stessa `<header>` del desktop, che la
colonna dispone in coda invece che in testa: resta nel flusso, il contenuto si
accorcia da solo e non c'è nessuna barra fissa da compensare. Il **panino sta in
mezzo** — è il comando che si tocca più spesso, e al centro ci arriva il pollice
di tutt'e due le mani — con la **cattura a sinistra** e le **azioni a destra**
(stato, campanella, scorciatoie, ricerca, aggiorna). I pannelli appesi a quelle
icone si aprono verso l'alto e a tutta larghezza: 300 px appesi a un'icona di 34
in mezzo al gruppo uscivano dal bordo dello schermo. Chi resta fisso in fondo —
la striscia della sessione scaduta, i toast, il foglietto (i) di Finanze — si
appoggia sopra la barra leggendo `--barra-bassa`, che su schermo grande vale
zero. I bottoni sono più grandi che su desktop, disegno compreso (40 px con
l'icona a 18, il panino 56×46 con l'icona a 22): là si punta col mouse, qui si
tocca col pollice, e quello che conta è quanto si vede, non solo l'area
cliccabile invisibile di `.tap-44`. Vedi `AppShell.css` e `tokens.css`.

**La barra di stato è opaca (`black`) e non trasparente**, e non è una scelta di
gusto. Con `black-translucent` iOS dà alla web app installata una finestra
ancorata in cima allo schermo ma alta quanto lo schermo *meno* la barra di
stato: su un iPhone da 844 punti, `100dvh` ne misura 797, e gli ultimi 47
restano oltre il fondo del viewport — una fascia morta sotto la barra dei
comandi che nessun CSS può raggiungere. Con la barra di stato opaca la finestra
parte sotto l'orologio e arriva fino in fondo: lo spazio torna all'app. In
cambio l'app non disegna più dietro l'orologio, che qui vuol dire `#0e1013` al
posto del nero. Il fondo del `body` è il colore della barra e non quello
dell'app, così se quella fascia ricomparisse — un'altra versione di iOS, un
altro modo di installare — leggerebbe come una continuazione della barra invece
che come una striscia nera dimenticata. Le due pagine-scorciatoia portano lo
stesso meta: è da lì che parte la finestra quando si apre la loro icona.

**Bussola**, **Finanze** e **Diario**, in Oggi, sono i tre riquadri *riservati*:
stanno in una colonna sola e **partono visibili**. Il gesto è al contrario di
com'era: si vede, e si copre con l'occhio sbarrato in testa al riquadro — nel
momento preciso in cui si alza lo sguardo e sta arrivando qualcuno, quando
«chiudi la scheda» non è una risposta. Partivano oscurati, ma la prudenza la
pagava la persona sbagliata: chiedere il PIN a ogni apertura per proteggersi
dalle due volte al mese in cui passa qualcuno vuol dire tre riquadri ciechi per
tutto il resto del tempo. Una volta nascosti ci vuole il PIN di Finanze per
riaprirli — lo stesso codice, la stessa scadenza a trenta minuti, la stessa
scheda del browser, quindi riaprirne uno riapre anche gli altri e la sezione. La
sezione Finanze, quella, resta protetta dal PIN come prima. Tutto il resto —
agenda, azioni, obiettivi, movimento, coda di letture — è in chiaro comunque,
perché non c'è niente di male a farsi leggere alle spalle quante volte si è
corso. Vedi `riservati.js`, `SensitiveCard.jsx` e `finanze/sblocco.ts`.

Il **Diario** ci è entrato quando ha smesso di essere un invito. Prima diceva
«Due righe su com'è andata…» e basta, cioè era un bottone travestito da riquadro:
un invito non si legge due volte. Adesso mostra **una voce vera già scritta**,
scelta con la data come il desiderio del giorno dei cento desideri — stesso
meccanismo e stessa ragione, perché un archivio che si apre solo se lo si va a
cercare non viene riletto mai. Il mese da cui pescarla si sceglie dall'indice
intero e non dagli ultimi due: rileggersi vale di più con la distanza. Le voci
«nel cassetto» (`sealed`) non entrano mai nel sorteggio, e il testo esce da
OneDrive **solo se il riquadro è scoperto** — come le cifre di Finanze. Le date, che servono
alla striscia e alle sette barrette, si leggono comunque: dicono quando hai
scritto, non cosa.

**Movimento** era il terzo riquadro bloccato, e lo era per davvero: non esisteva
nessuna fonte dati sugli allenamenti. Ora ce ne sono due, e la separazione fra
loro è tutta la funzione — **il calendario tiene i programmi, un registro su
OneDrive tiene quello che è successo**. Barre piene per le sessioni registrate,
tratteggiate per quelle previste e non ancora fatte. Le tre famiglie hanno una
riga ciascuna — «Movimento 2/3», «Yoga 1/2» — perché un allenamento, una
meditazione e un'ora di yoga non sono intercambiabili: un «4 su 6» unico può
voler dire una settimana piena oppure sei meditazioni da dieci minuti e nessun
allenamento. Il bersaglio settimanale si sceglie una volta dalla chiavetta in
testa al riquadro e sta nell'indice del registro, accanto al calendario; zero
vuol dire «non me lo conto», e la riga mostra solo quante ne hai fatte. Il
calendario è di sola lettura — registrare una sessione non crea, non sposta e
non cancella nessun evento. Vedi `movimento.js`, `MovimentoCard.jsx` e
`docs/proposta-movimento.md`.

Il **rituale del mattino** è la parte del Movimento che non si vede nelle barre:
il registro sa contare quello che è successo, ma un mese con quattro allenamenti
e ventisei silenzi è indistinguibile da un mese in cui la scheda non è stata
aperta. Da qui il pannello che si apre da solo alla prima apertura della
giornata, con le tre caselle già despuntate e la motivazione già scelta — perché
la risposta più frequente è «no, non sono riuscito» e confermarla deve costare un
tocco solo. La verità però resta una sola: spuntare una casella non scrive
«fatto» in un file suo, scrive una **sessione vera** nel registro (marcata
`daRituale`, così despuntandola si può togliere), che è quella da cui la scheda e
gli obiettivi prendono i numeri; nel file del rituale resta solo quello che il
registro non sa dire, cioè il perché di un no. I giorni saltati si recuperano
fino a tre indietro, compilati come «non fatto» e **dichiarati** in cima al
pannello: un registro che si compila da solo in silenzio è un registro di cui non
ci si fida più. Vedi `rituale.js` e `RitualeMattino.jsx`.

Il pannello di dettaglio del Piano porta a `#/sezioni/:id` con «Apri il
workbook»: è il passaggio che lega la programmazione al posto di lavoro.

## Il flusso di un'attività

Otto stati, un solo verso. Un'attività ne ha **uno e uno solo**, e la colonna in
cui appare è derivata da lì, mai un'etichetta salvata a parte. La mappatura sta
in `src/taskModel.js`, i campi in `src/taskStore.js`.

| Stato | Dov'è scritto |
|---|---|
| `inbox` | sta nella lista trattata come Inbox |
| `next` | `stato: 'next'` |
| `ask` | `stato: 'ask'` + `persona`: a chi chiedere |
| `waiting` | `stato: 'waiting'` + `persona`: chi si aspetta |
| `delegated` | `stato: 'delegated'` + `persona`: chi ce l'ha in mano |
| `scheduled` | ha un blocco nel piano del giorno (`daily-plans` su OneDrive) |
| `someday` | `stato: 'someday'` |
| `done` | `stato: 'done'` |

Due soli non sono un campo, e per un motivo: `inbox` è **dove** il task sta —
finché è nella lista Inbox è da chiarire — e `scheduled` è **avere un blocco nel
piano**, che è un fatto del piano, non del task. Tutto il resto si legge.

Fino a qui non era così. I task vivevano su Microsoft To-Do, e metà di
`taskModel.js` spiegava come farci stare dentro cose per cui To-Do non aveva un
posto: *da chiedere* e *delegata* non avevano uno `status` loro, quindi la
differenza fra un'attesa e una delega stava in una riga di testo nelle note
(`Delegato a: Sara`) da riconoscere con una regex. Cambiare stato voleva dire
due scritture — la riga e lo `status` — e se la seconda falliva il task restava
in *Prossime azioni* col nome di qualcuno dentro. Il perché del passaggio, per
esteso, sta in [`docs/proposta-task-json.md`](docs/proposta-task-json.md).

**Cattura** (`⌘N`) scrive solo il titolo, nella lista di default: il passo 1 non
deve chiedere niente, o le cose non si catturano. **Chiarire** è il passo 2 e
sta in un unico modale — contesto, sezione, durata, stato — ed è l'unico modo
di uscire da Inbox: un task catturato è solo testo, e per stare in un'altra
colonna gli serve almeno una sezione. Da lì passano anche le diramazioni del
metodo: sotto i due minuti si fa subito, dipende da altri diventa *In attesa*
con la persona, non adesso diventa *Un giorno*.

Quando però dove va la cosa **si sa già**, i due passi sono un giro a vuoto: si
cattura in Inbox per ripescarla dopo e rimetterla dove si sapeva fin dall'inizio.
Per questo la destinazione si può dire sulla stessa riga della cattura, e allora
il task nasce direttamente in sezione, saltando il chiarimento:

```
Rivedere relazione fondazioni @2573 !domani ~45
```

| Token | Cosa dice | Esempi |
|---|---|---|
| `@nome` | la lista di destinazione | `@2573`, `@ris-auto`, `@casa` |
| `!data` | la scadenza | `!oggi`, `!domani`, `!ven`, `!31/12`, `!2026-09-01` |
| `~n` | la stima, in minuti | `~45`, `~90m`, `~2h` |

Scrivere `@` apre l'elenco delle sezioni, che si stringe man mano — frecce per
scegliere, `Invio` per scegliere e catturare in un gesto solo. L'ordine a elenco
vuoto è quello d'uso recente: le cose si buttano quasi sempre negli stessi tre o
quattro posti.

E quando la sezione è **già aperta a schermo** — la plancia di `#/sezioni/:id` —
non serve nemmeno scriverla: viene proposta da sola, e la chip la mostra accesa
col suo nome. La rotta dà una sezione OneNote, ma un task vive in una lista, e
una commessa può avere più consegne: quindi non si propone «la lista
della sezione», che spesso non esiste — si propongono **tutte le sue liste**, la
più usata di recente in cima e le altre a una freccia di distanza, sotto
l'intestazione della commessa. La proposta si smentisce come qualsiasi altra
destinazione: scrivendo `@`, scegliendone un'altra, o scegliendo Inbox apposta.
Il legame rotta → liste sta in `src/captureContext.js`.

Dire la destinazione resta **facoltativo**, ed è il punto: chi non scrive niente
batte `Invio` e cattura in Inbox esattamente come prima. Un token viene tolto dal
titolo **solo se ha risolto** — `@mario` dove nessuna sezione si chiama così
resta testo e il task va in Inbox — perché un parser che si mangia pezzi di
titolo è peggio di un parser che non fa niente. La sintassi sta in
`src/captureParse.js`, l'elenco in `src/DestinationPicker.jsx`.

**Decidi ora**, nella finestra di cattura, resta per il caso opposto: non che si
sappia dove va, ma che non si sappia. Apre il diagramma di chiarimento col testo
già dentro.

Tutto il resto di un'attività è un campo suo: il **contesto** (Lavoro /
Personale / Famiglia) è `contesto`, la **sezione** è la lista in cui il file sta,
le **sottoattività** sono `sottoattivita`, la **nota** è `nota` — solo testo,
senza niente da spogliare —, la **stima** è `stimaMin`, la **sveglia** è
`sveglia`, la **persona** è `persona`, il posto in fila dentro la sua lista è
`ordine`. Il suo ruolo non è un campo: è lo stato,
e i tre si escludono a vicenda perché sono tre momenti della stessa cosa.

### Le persone

Sono sempre le stesse, e un nome riscritto a mano ogni volta è un nome scritto
ogni volta diverso: «ADC» e «adc» diventerebbero due gruppi nella colonna, che è
esattamente quello che il raggruppamento per persona serve a evitare. L'elenco
sta quindi in **`src/persone.json`**, versionato col resto — è lì che si aggiunge
chi manca — e nel pannello di dettaglio compare come pastiglie sopra al campo.

Un nome scritto al volo nel campo funziona lo stesso e viene ricordato in locale,
così la volta dopo l'elenco lo propone da sé; il posto stabile però resta il
JSON. Quello che si scrive viene ricondotto al nome del registro quando
corrisponde a meno di maiuscole e spazi.

### La scheda di un'attività

È la stessa ovunque la si tocchi — dal Piano, dalla vista Attività, dalla
plancia di Sezioni — perché è l'unico posto in cui un'attività si lavora davvero
(`src/TaskDetailPanel.jsx`). Tiene titolo, scadenza, quanto ci vuole, sveglia,
stato, note e sottoattività, e in fondo il bottone che porta al workbook della
sezione, incollato in basso invece di restare appeso a metà colonna sotto
l'ultima sottoattività.

**Si apre subito.** Aprirla costava due secondi di scheda grigia, e non perché
servisse leggere qualcosa che non si avesse: erano due letture da OneDrive in
fila — il registro delle liste per sapere in che file guardare, poi il file — per
un'attività che il serbatoio della vista ha già in mano per intero. Adesso si
guarda prima in casa: l'attività passata dalla vista, o la copia in cache del suo
elenco, dipinge la scheda al primo istante; la lettura vera parte lo stesso
dietro e aggiorna quello che nel frattempo non si sta scrivendo — chi comincia a
scrivere una nota non se la vede sostituire quando la risposta arriva. Il
registro delle liste, che è il primo file di ogni operazione, ha una copia in
memoria che dura mezzo minuto: cambia quando si crea o si rinomina una lista,
cioè qualche volta al mese.

In coda alla scheda c'erano anche le pagine OneNote e i file OneDrive della
sezione. Sono usciti: sono due riquadri che nessuno guarda mentre lavora a
un'attività — le pagine e i file si aprono in Sezioni, dove sono due colonne
intere — e riempirli costava una lettura delle pagine a ogni apertura di scheda,
cioè un altro pezzo di quei due secondi.

**Quanto ci vuole** ha le quattro durate di tutti i giorni come pastiglie e una
casella per tutte le altre: una cosa può durare venti minuti o tre ore, e non
c'era modo di dirlo. Si conferma uscendo dal campo o con Invio, non a ogni tasto,
o scrivere «120» ridimensionerebbe il blocco a piano tre volte.

**Lo stato** è una fila di sei icone invece di sei nomi per esteso, che in una
colonna larga trecento pixel prendevano tre righe: il triangolo del play per la
prossima azione, il calendario per la programmata, il punto di domanda per quella
da chiedere, le due lineette della pausa per quella in attesa, una persona per la
delegata, una nuvola per «un giorno». Il nome resta a un passaggio del cursore, e
quello dello stato acceso è scritto accanto alla fila. Le stesse icone tornano
**sui titoli delle categorie** — le colonne della vista Attività, le aree «Da
chiedere» e «Delegati» in fondo a due di esse, le tre righe per persona nella
colonna Attività di Sezioni — e non sulle singole righe: la colonna *è* lo stato,
e tutte le attività che ci stanno dentro lo hanno per definizione, quindi
ripeterglielo addosso una per una sarebbe un'icona ripetuta venti volte che non
distingue niente. Stanno in `src/StatusIcon.jsx` — disegni e non caratteri,
perché ⏸ e ▶ diventano emoji a colori su qualche sistema e la fila si
sfalserebbe.

### L'ordine delle attività

Dentro una lista le attività si mettono in fila **trascinandole una sopra
l'altra**: la riga rilasciata va dove sta quella su cui è caduta. Vale nel
serbatoio del Piano, nelle colonne della vista Attività e nella colonna Attività
di Sezioni — cioè in tutti i posti in cui un elenco si guarda.

Si riordina **una lista alla volta**, perché è per lista che le viste
raggruppano: trascinare una riga sopra una di un'altra consegna non è un
riordino, è uno spostamento, e quello ha già il suo gesto. E si riordina **col
mouse**: da telefono le stesse righe si trascinano già per programmarle, e due
significati sullo stesso dito vorrebbero dire un ordine cambiato per sbaglio ogni
volta che si mette qualcosa in agenda.

L'ordine è un campo del task (`ordine`, in `src/taskStore.js`), non un elenco di
id tenuto a parte: un elenco a parte è una cosa in più da tenere in pari con le
creazioni, gli spostamenti fra liste e le cancellazioni, e quando si disallinea
sono attività che spariscono dall'elenco pur essendo nel file. Dove nessuno ha
riordinato niente il campo resta vuoto e comanda il criterio della vista, che è
la scadenza: un ordine derivato dice cosa scade prima, non cosa si vuole fare
prima. Il riordino non tocca `modificatoIl` — è la data da cui si contano i
giorni di un'attesa, e alzare una riga non è aver risentito la persona — e si
annulla come tutto il resto. Vedi `src/taskOrder.js`.

### La sveglia di un'attività

Sorella di «Quanto ci vuole», nel pannello di dettaglio: là si dice quanto una
cosa dura, qui a che ora si vuole essere richiamati. Non è una scadenza — quella
è un giorno, e c'è già — ma un'ora del giorno: «alle 15:30 questa cosa». Le
pastiglie dicono *fra quanto* (5, 15, 30 minuti, un'ora) perché è così che la si
pensa. Sono due, il quarto d'ora e l'ora, più «ora» che segna questo momento:
erano quattro più il campo dell'ora e la crocetta, e sei controlli in fila
andavano a capo due volte in una colonna stretta per una cosa che si mette in un
gesto solo. Il campo accanto tiene l'ora esatta, che è quella che finisce
scritta.

Quando l'ora arriva, sul PC succedono tre cose insieme, perché la mente digitale
quasi mai è la finestra davanti:

- un **pannello a tutto schermo** che copre ogni vista, pulsa e non si chiude
  con Esc o con un clic fuori — se il gesto per zittirla fosse lo stesso con cui
  si scarta una finestra qualunque, la si zittirebbe senza averla letta;
- una **notifica di sistema**, che arriva anche da dietro un'altra finestra. Il
  permesso si chiede alla prima sveglia messa, non all'avvio dell'app;
- un **suono** di tre rintocchi, sintetizzato al volo (nessun file da servire).

Il controllo gira ogni venti secondi guardando che ore sono, e non con un timer
piazzato sull'ora esatta: un `setTimeout` di due ore non sopravvive né allo
standby del portatile né alla scheda messa a dormire dal browser. Una sveglia in
ritardo di dieci minuti suona ancora; una in ritardo di due ore no — a quel punto
non è più un avviso, è un rimprovero. Di aver già suonato ci si ricorda su
`localStorage`, quindi per macchina: una suonata sul portatile non zittisce
quella sul fisso. Vedi `sveglie.js` (la logica), `useSveglie.js` (il ciclo) e
`SvegliaAlert.jsx` (il pannello).

### Quanto dev'essere grande una cosa

Un promemoria, non un controllo: nessun avviso, nessun blocco. È il metro con
cui si decide se una cosa va spezzata, e sta scritto una volta sola in
`src/taskModel.js` (`GRANULARITY_MEMO`), da dove lo leggono il form della
consegna, la colonna Attività e le descrizioni degli strumenti MCP.

| Livello | Orientativamente |
|---|---|
| Sottoattività (`checklistItem`) | meno di **2 ore** |
| Attività | meno di **2 giorni** |
| Consegna (lista annidata) | meno di **1 mese** |

Il senso è la scala: ogni livello è circa dieci volte quello sotto, così
guardando una lista si capisce a che altezza si sta ragionando. Una consegna che
dura più di un mese è un'altra commessa; un'attività da tre giorni sono più
attività travestite.

## Consegne dentro una commessa

Una lista è una sezione OneNote, per uguaglianza di nome. Ma una commessa
ha più consegne, ognuna con la sua data, e i gruppi di liste non
servono a niente qui: **Graph non li espone** — `todoTaskList` non ha una
proprietà di gruppo padre, e non c'è un endpoint né in v1.0 né in beta. Quindi
la gerarchia sta nel nome, come già i prefissi PARA:

```
GRUPPO.Consegna[-YYMMDD]

2573.A60-Fondazioni-260831   →  commessa 2573, consegna «A60-Fondazioni»,
                                scadenza 31/08/2026
```

- **Senza punto** il comportamento è quello di sempre, 1:1 col nome della
  sezione. La convenzione è opt-in: una commessa che non vuole consegne separate
  non cambia di una virgola, e nessuna lista viene mai rinominata o migrata
  automaticamente.
- **Con il punto**, la commessa è quel che sta prima del primo `.`, il resto è la
  consegna.
- La **scadenza** è solo l'ultimo segmento dopo l'ultimo `-`, e solo se è
  esattamente `\d{6}` ed è una data vera: il trattino è già dentro i nomi
  (`Coldbox-revB`), quindi tutto il resto fa parte del nome. La data non si
  mostra mai come pezzo di nome — è un campo, e si legge formattata con i giorni
  che mancano.
- **Appartenenza alla sezione**: la sezione che si chiama come la commessa,
  oppure che comincia con la commessa seguita da un carattere non alfanumerico
  (`2573` trova `2573-ABS`, `257` no). Prima il nome esatto, poi il prefisso; se
  restano più candidati non c'è collegamento — mai indovinare.

Tutto questo vive in `src/paraConfig.js` (`parseListName`, `listGroupKey`,
`listDeliverableLabel`, `listDueDate`, `sectionMatchesGroup`, `listsForSection`
e la composizione inversa `buildListName`): il nome si spezza in un punto solo.

**Nell'app**: la colonna Attività di *Sezioni* mostra le consegne come gruppi a
tendina — nome, scadenza con quanto manca (in scadenza si accende, scaduta di
più), attività aperte — e lo stato aperto/chiuso resta come lo si è lasciato. Il
`+` in testata crea una consegna con **due campi separati**, nome e data: il nome
composto lo scrive il codice, non l'utente. Cambiare la data di una consegna è
una rinomina della lista, fatta dallo stesso campo data. I colori seguono la
commessa: ogni consegna è una sfumatura del colore della sezione, così si
distinguono restando parenti.

In fondo alla colonna stanno **tre righe per persona** — da chiedere, in attesa,
delegati — raccolte per chi ha in mano la cosa invece che per la consegna in cui
sta: quando si becca Sara si vuole sapere cosa chiederle, non a quale consegna
appartiene ogni domanda. «In attesa» mancava, ed era proprio la riga di mezzo: le
cose chieste e mai tornate indietro restavano dentro la consegna come se fossero
da fare, quando invece la palla è di qualcun altro. Le tre righe ci sono sempre,
anche a zero — è la riga stessa che ricorda di guardarci — e il numero si accende
in ocra quando c'è qualcosa che aspetta.

Accanto al nome di ogni consegna c'è un `+` che apre il campo di una **nuova
attività** in quella lista: solo il titolo, e la scheda a destra si apre da sé su
quella appena creata per il resto. Era il gesto che mancava alla colonna —
l'elenco delle cose da fare per una commessa si guardava qui e si allungava
altrove, dicendo alla cattura una destinazione che qui è già sotto il cursore.
Dove la consegna non ha intestazione (una lista sola, niente da raggruppare) il
campo è l'ultima riga dell'elenco.

Un'attività **si sposta da una consegna all'altra trascinandola** sul gruppo di
destinazione, che si accende quando la può accogliere — lo stesso gesto con cui
la si porta su Oggi. È uno spostamento vero: l'attività esce da un file ed entra
in un altro portandosi dietro tutto, id compreso (`spostaTask` in
`src/taskStore.js`). Su Microsoft To-Do non esisteva una «move» — il task veniva
ricreato nella lista di arrivo e cancellato da quella di partenza, quindi
cambiava id, e i blocchi già a piano che lo citavano restavano orfani. Lo
spostamento si annulla dal solito avviso in basso.

Nel serbatoio del *Piano* le consegne stanno sotto l'intestazione della loro
commessa, rientrate: lì non si richiudono, perché a nascondere quello che non
serve ci pensano già i filtri PARA/taccuino/sezione in cima alla colonna.

**Da riga di comando e via MCP**: `--sezione 2573` vale per l'intera commessa
quando i risultati sono tutti consegne dello stesso gruppo (gruppi diversi
restano un'ambiguità, cioè un errore). Per *creare* un'attività la consegna va
indicata: «tutta la commessa» non è un posto in cui scrivere.

## Design token

Colori, tipografia, spazi, raggi e target di tocco stanno una volta sola in
`src/tokens.css`. I CSS per componente li leggono da lì: cambiare l'accento è
una riga, non una ricerca-e-sostituzione in dieci file.

## Architettura

| Componente | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, react-router (hash), D3 per la mappa |
| Autenticazione | MSAL Browser (account Microsoft personale, scope Graph in sola lettura + Files in scrittura; di To-Do resta solo `Tasks.Read`, per la migrazione una tantum). Il CLI e il server MCP hanno un token proprio, con in più OneNote e Calendario in scrittura |
| Dati | Microsoft Graph (OneNote, Calendar, OneDrive, Mail) con cache localStorage a TTL. I file JSON dell'app — attività comprese — stanno nella cartella `mente-digitale/` di OneDrive: i fissi in cima, i registri che crescono (`diario/`, `movimento/`) e le attività (`task/`) in una sottocartella loro. Quelli rimasti dove stavano prima vengono spostati automaticamente al primo avvio |
| Backend | Nessuno: sito statico servito da Cloudflare Pages |
| Automazioni | GitHub Actions (`sync-calendar`) |

I dati utente non transitano da alcun backend: il browser parla direttamente con Microsoft
Graph. Non ci sono chiamate a nessuna API AI a pagamento: dove serve un aiuto dell'AI (Diario,
Finanze → Movimenti) l'app compone un prompt e lo mette negli appunti con un pulsante **Copia
per l'AI** / **Categorizza con Claude**; l'utente lo incolla in una chat Claude a parte e, se
vuole, incolla qui il risultato. Nessuna chiave API, nessun costo per token lato app.

## Fuori dall'app: riga di comando e server MCP

Le stesse operazioni dell'app, senza l'app: leggere OneNote, To-Do, calendario,
piani, Bussola e diario parlando direttamente con Microsoft Graph, e scrivere in
due punti soli — una voce di diario, un'attività su To-Do. Servono a guardare i
propri dati senza aprire il browser e, soprattutto, a metterli a disposizione di
un assistente come Claude: invece di incollargli il diario a mano, lo legge lui.

Tre file, uno sopra l'altro:

| File | Cosa fa |
|---|---|
| `scripts/mente-graph.mjs` | parla con Microsoft Graph: token e retry. I file su OneDrive — cartella, percorsi, ETag, migrazioni — vengono da `src/graphCore.js`, lo stesso nucleo dell'app |
| `scripts/mente-comandi.mjs` | le operazioni, una funzione ciascuna, con le regole su cosa si può scrivere |
| `scripts/mente.mjs` · `scripts/mente-mcp.mjs` | i due modi di chiamarle: un terminale, o una chat |

Le regole stanno nel mezzo, una volta sola: le due strade non possono divergere.

### Da riga di comando

```bash
node scripts/mente.mjs aiuto            # tutti i comandi
npm run mente -- oggi                   # lo stesso, via npm

node scripts/mente.mjs oggi             # agenda, piano e conteggi del giorno
node scripts/mente.mjs attivita lista --stato next --sezione Casa
node scripts/mente.mjs diario leggi --giorni 30 --tag lavoro
node scripts/mente.mjs note leggi Manutenzioni --sezione Casa

node scripts/mente.mjs attivita crea "Preventivo caldaia" --sezione Casa --stima 20
node scripts/mente.mjs attivita stato "Preventivo" ask --persona Sara
node scripts/mente.mjs diario scrivi --testo "Giornata piena." --umore 4
```

Ogni comando accetta `--json`: la stessa risposta in una forma che un programma
— o un modello — legge senza doverla interpretare a occhio.

Non è un secondo modello di dati: le attività passano da `src/taskModel.js` e le
voci di diario da `src/diary.js`, gli stessi moduli dell'app — quindi il marker
`[MIN:45]`, la riga della persona (`In attesa da:`, `Da chiedere a:`,
`Delegato a:`, con `--persona "Nome"`) e la forma di una voce restano quelle di
prima. Un'attività creata da qui compare su To-Do e nell'app senza differenze.

**Cosa non fa.** Calendario, OneNote, Bussola, Visione e piani del giorno si
leggono soltanto. Sono le cose che non si ricostruiscono da una cronologia, e un
comando sbagliato — o un'AI troppo sicura di sé — non deve poterle toccare.
Restano fuori anche `scheduled` e `inbox` come stati scrivibili: il primo è un
blocco nel piano, il secondo è la lista di default, e si cambiano trascinando,
nell'app. Le Finanze non ci sono affatto: vivono in IndexedDB, dentro il browser.

### Come server MCP

`scripts/mente-mcp.mjs` espone le stesse operazioni come strumenti che un client
MCP può chiamare da solo durante una conversazione: si chiede *"come sta andando
la settimana?"* e il modello sceglie `oggi`, `attivita_lista` o `diario_leggi`
invece di farsi dettare un comando. Parla JSON-RPC su stdio, protocollo scritto a
mano — un handshake e tre metodi non valgono una dipendenza in un progetto che
non ne ha.

Il client lo avvia quando serve e lo chiude con la chat: non è un servizio che
resta acceso, e a client chiuso non esiste alcun processo.

Si registra una volta sola, dal terminale. `--scope user` lo rende disponibile
in ogni cartella invece che solo in questo progetto, e vale sia per la CLI sia
per l'app desktop, che leggono la stessa configurazione (`~/.claude.json`, cioè
`%USERPROFILE%\.claude.json` su Windows):

```bash
claude mcp add --scope user mente -- node /percorso/assoluto/scripts/mente-mcp.mjs
claude mcp list                        # deve dire "✔ Connected"
```

Il percorso va assoluto: il client avvia il processo dalla cartella che gli pare.
Non è un problema per il token, che il server cerca accanto a sé e non nella
cartella di lavoro.

Dentro una sessione, `/mcp` — scritto da solo, è un comando e non una domanda —
elenca i server e il loro stato. Il segno che gli strumenti stanno funzionando
davvero è che nella risposta compaiono chiamate a `oggi` o `attivita_lista`, e
non comandi `node scripts/mente.mjs`.

I ventuno strumenti sono gli stessi comandi. In lettura: `oggi`, `agenda`,
`piano`, `piano_arco`, `obiettivi_leggi`, `sezioni`, `attivita_lista`,
`diario_leggi`, `note_pagine`, `note_leggi`, `identita`. In scrittura:
`attivita_crea`, `attivita_stato`, `sezione_crea`, `piano_aggiungi`,
`piano_togli`, `obiettivi_scrivi`, `evento_crea`, `note_crea`, `note_aggiungi`,
`diario_scrivi`. Quelli in sola lettura sono marcati come tali (`readOnlyHint`),
così un client che chiede conferma prima di scrivere sa quando chiederla.

Nessuno cancella niente, ed è una regola e non un'omissione: un'attività di prova
si può spuntare, non eliminare; su OneNote si scrive solo in fondo a una pagina,
mai sopra a quello che c'era; «togliere» un'attività dal piano vuol dire toglierle
l'ora, non cancellarla. La Bussola e la Visione restano in sola lettura — sono i
documenti che si scrivono pensandoci, non dettandoli a una chat.

**Il piano, alle tre distanze.** Giornaliero, settimanale e mensile non sono tre
piani ma tre distanze da cui si guarda lo stesso, come le tre viste del Piano
nell'app. Si compilano tutti con `piano_aggiungi`, un giorno per volta, e si
rileggono con `piano_arco`. Due blocchi che si accavallano sono un errore e non
una sovrapposizione da disegnare: l'app, dove si trascina e si vede la griglia,
può permetterselo; da una chat, dove si scrive alla cieca, no. Gli **obiettivi
del mese** (`obiettivi_leggi` / `obiettivi_scrivi`) sono un'altra cosa ancora:
dove si vuole arrivare entro il trentuno, non quando si fanno le cose. Si
scrivono tutti insieme — da tre a sei, come nel riquadro di «Oggi» — perché sono
un blocco solo, e aggiungerne uno per volta senza vedere gli altri è il modo di
ritrovarsene nove a metà mese.

#### Dove funziona e dove no

Solo dove il client può avviare un processo **su questa macchina**:

| Dove | Funziona |
|---|---|
| CLI `claude` in un terminale | sì |
| App desktop, scheda **Code**, ambiente **Local** | sì |
| App desktop, sessione **Cloud** (icona della nuvola in cima alla sessione) | no |
| App desktop, schede **Chat** e **Cowork** | no |
| claude.ai nel browser, app sul telefono | no |

Una sessione Cloud gira in un container remoto: non ha il file del token, e non
è un difetto da aggirare — se lo avesse, vorrebbe dire che il token ha lasciato
il computer. È la confusione più facile da fare, perché l'app è la stessa: la
nuvola accanto al titolo della sessione è il modo per accorgersene.

Le schede Chat e Cowork prendono i connettori dall'account claude.ai, cioè server
MCP **remoti**, raggiungibili via HTTPS. Un server stdio come questo vive sul
disco e parla su una pipe: non è raggiungibile da lì, e non c'è percorso o
configurazione che lo renda tale. Servirebbe la versione remota — il server
esposto su internet con un'autenticazione propria, e la macchina sempre accesa.

Per client MCP diversi da Claude Code — che leggono un `claude_desktop_config.json`
o simile — l'entrata è la stessa in forma JSON:

```json
{
  "mcpServers": {
    "mente": {
      "command": "node",
      "args": ["C:\\percorso\\assoluto\\scripts\\mente-mcp.mjs"]
    }
  }
}
```

### Il token

Vale per entrambe le strade. Non c'è MSAL: si usa un refresh token, come
`sync-calendar.mjs`. Se ne prende uno con gli scope giusti — tutto in lettura,
scrittura su attività e liste To-Do, sui file dell'app, su OneNote e sul
calendario — e lo si tiene sulla propria macchina:

```bash
node scripts/get-refresh-token.mjs --mente
```

> **Gli scope stanno dentro al token, non si chiedono a ogni chiamata.** Un token
> preso quando OneNote e il calendario erano in sola lettura continua a leggerli
> soltanto: gli strumenti nuovi risponderebbero `403` senza che nulla dica
> perché. Dopo un aggiornamento che allarga `MENTE_SCOPE` (in
> `scripts/mente-graph.mjs`) il token va rifatto con lo stesso comando qui sopra.

Il token va in `scripts/.mente-refresh-token` (ignorato da git) oppure nella
variabile `MENTE_REFRESH_TOKEN`, anche da un `.env` nella radice del progetto.
Ruota a ogni uso e il file viene riscritto, quindi non scade da solo.
Resta separato dal segreto `MS_REFRESH_TOKEN` di GitHub Actions, che continua a
poter fare pochissimo: solo mail e calendario, per la sincronizzazione. Quel file
è la chiave del OneDrive personale — vale quanto la password, e non va copiato in
posti in cui non metteresti la password.

**Su un secondo computer** si rifà il giro — Node, clone, token, `claude mcp add`
— e si genera un token **nuovo** invece di copiare il file: il refresh token ruota
a ogni uso, e due macchine che si passano la stessa copia finiscono prima o poi
con una delle due che si ritrova in mano un token già rinnovato altrove.

Il codice, invece, non si aggiorna da solo: il server esegue i file che stanno su
quel disco. Dopo un `git pull` va riavviata la sessione, perché il client avvia il
processo all'inizio della chat e lo tiene fino alla fine.

## Sviluppo

```bash
npm install
npm run dev       # dev server Vite, contro il OneDrive vero
npm run dev:finto # l'app in locale, senza rete e senza account
npm run lint      # ESLint
npm run typecheck # tipi dai JSDoc (checkJs)
npm run build     # build di produzione in dist/
npm run prova     # le prove: OneDrive finto in memoria, senza rete né account
```

### Le prove

Quattro suite, tutte contro un OneDrive finto (`scripts/finto-onedrive.mjs`):
non chiedono connessione né account Microsoft, e importano i moduli veri di
`src/` sostituendo solo l'autenticazione — così provano il codice che gira
davvero, non una copia che può divergere.

| | cosa prova |
|---|---|
| `prova-onedrive` | lo strato dei file: ETag, `If-Match`, il conflitto fra due dispositivi, le cartelle e la migrazione dai posti vecchi |
| `prova-task` | `taskStore`: liste, campi, riordino a mano, spostamenti, il rifiuto di una scrittura che svuota un file |
| `prova-migrazione` | la passata una tantum da Microsoft To-Do ai file nostri |
| `prova-flusso` | gli otto stati del flusso GTD e le loro precedenze |

Girano in CI insieme a tipi, lint e build. Prima non ci giravano, e tre suite
su quattro si erano rotte in silenzio quando `api.js` ha cambiato il modo di
leggere i file: il finto OneDrive era rimasto indietro, e nessuno se n'era
accorto perché nessuno le eseguiva.

### Provare l'app in locale

Le API Graph rispondono solo sull'URL di produzione: con `npm run dev` l'app si
apre ma non trova niente. Ogni modifica all'interfaccia si verificava quindi
dopo il merge, sui dati veri.

`npm run dev:finto` mette al posto dell'autenticazione e di Graph un **OneDrive
finto in memoria** — lo stesso su cui girano le prove — con dentro una giornata
plausibile: due commesse con le loro consegne, attività in ognuno degli stati
del flusso, un piano del giorno, appuntamenti, un mese di diario, gli obiettivi,
la coda di letture, il movimento della settimana. Tutto inventato, niente rete,
niente account. Ricaricare la pagina riporta i dati come erano; dalla console
del browser `__finto.archivio` mostra cosa è stato scritto e `__finto.richieste`
le chiamate fatte.

È una **sostituzione di file** decisa da Vite (`MD_FINTO=1`), non un
interruttore dentro l'app: nel pacchetto di produzione non c'è una riga di
codice finto, perché quei file non vengono mai importati.

### Workflow git

Niente push diretto su `main`: ogni modifica va su un branch, poi pull request
e merge su `main`. La CI (type-check, lint, build, prove) gira su ogni push e
ogni PR.

### Configurazione MSAL

`src/config.js` contiene `CLIENT_ID` dell'app registrata su Entra ID e gli scope richiesti.
Il redirect URI è l'origin corrente.

### Quanto dura l'accesso (e perché su iPhone durava un'ora)

L'access token di Microsoft vale un'ora, sempre. Quello che tiene viva la
sessione oltre l'ora è il *refresh token*, che arriva grazie allo scope
`offline_access` e viene speso in silenzio per farsi dare un access token
nuovo. Se la sessione muore puntualmente al minuto sessanta, vuol dire che
quel refresh token non è mai stato speso — non che manchi.

Tre cose lo impedivano, e sono tutte e tre nel codice, non nel portale Azure:

- **I rinnovi forzati in parallelo.** Allo scadere dell'ora tutte le chiamate
  Graph in volo prendono 401 insieme e chiedono tutte un token fresco. I
  refresh token rilasciati a una SPA sono monouso e ruotano: il primo riscatto
  invalida gli altri, e quello che torna indietro è «serve interazione». Ora
  passano tutti da una coda e ne condividono uno solo (`src/auth.js`).
- **Si aspettava il 401.** Il rinnovo adesso parte da solo cinque minuti prima
  della scadenza, e di nuovo al ritorno sull'app — su iPhone i timer non
  scattano mentre la pagina è sospesa, quindi serve anche il
  `visibilitychange` (`startTokenKeepAlive`).
- **`ssoSilent` come rete di sicurezza.** L'iframe nascosto verso Microsoft
  ha bisogno del cookie di sessione in contesto di terza parte, che Safari
  blocca con «Impedisci tracciamento tra siti»: su iPhone quella strada non
  porta da nessuna parte. Resta come tentativo, ma la sessione la tiene in
  piedi il rinnovo programmato.

Nel portale Azure c'è comunque una cosa da verificare una volta sola:
**Registrazione app → Autenticazione**, l'URI di reindirizzamento deve stare
sotto la piattaforma **Single-page application**, non sotto «Web». Sotto «Web»
Entra non abilita il CORS sull'endpoint dei token e ogni rinnovo dal browser
fallisce.

Due tetti restano, e non si spostano da qui:

- **24 ore.** È la vita massima di un refresh token rilasciato a una SPA — una
  mitigazione anti-tracciamento di Entra, non un'impostazione. Una volta al
  giorno il login interattivo ci vuole. Per andare oltre serve un client
  riservato lato server (una Function di Cloudflare Pages) che tenga lui il
  refresh token da 90 giorni, come già fanno gli script in `scripts/`.
- **7 giorni.** Safari cancella `localStorage` dei siti non visitati per una
  settimana (ITP). L'app aperta dall'icona sulla schermata Home ha il suo
  spazio separato da quello di Safari: sono due sessioni distinte, ed è
  normale doversi autenticare in tutte e due.

### Perché su iPhone l'accesso spariva, e perché MSAL è fissato alla v3

Questa è la causa vera, trovata dopo aver escluso tutte le altre, e non sta nel
nostro codice: sta in come **MSAL, dalla v4 in poi**, tiene la cache.

Non scrive più i token in chiaro in `localStorage`: li **cifra**, e tiene la
chiave di cifratura in un **cookie di sessione** — `msal.cache.encryption`, con
scadenza 0, cioè muore quando finisce la sessione del browser. All'avvio
successivo, se quel cookie non c'è più, MSAL ne genera uno nuovo con un id
nuovo, poi rilegge la cache, trova dati cifrati con un id diverso e li butta.
Parole sue, in `LocalStorage.mjs`:

> *Data was encrypted with a different key. It must be removed because it is
> from a previous session.*

Su iPhone questo succede in continuazione: `localStorage` sopravvive, ma la
sessione del browser finisce ogni volta che iOS chiude l'app aperta dall'icona.
Le chiavi restano lì fino all'avvio dopo, e a quel punto spariscono tutte
insieme — senza un errore, senza una scadenza, senza che nessun rinnovo sia
stato tentato. È esattamente quello che la scatola nera ha fotografato:

```
15:38 · avvio: 1 account · prima 1 chiavi (rt0 at0 id0) · dopo 7 chiavi (rt1 at1 id1)
15:39 · avvio: 1 account · prima 7 chiavi (rt1 at1 id1) · dopo 7 chiavi (rt1 at1 id1)
16:04 · avvio: 0 account · prima 7 chiavi (rt1 at1 id1) · dopo 1 chiavi (rt0 at0 id0)
```

Prima di `initialize()` c'era tutto; dopo, niente. Gli avvii precedenti, dentro
la stessa sessione del browser, erano andati lisci.

**L'eccezione prevista non ci riguarda.** MSAL tiene la cache in chiaro per gli
accessi *persistenti*, e persistente lo decide la claim `signin_state`
dell'id token: vale se contiene `kmsi` o `dvc_dmjd`. Ma quella claim la mette
Entra, non gli account Microsoft personali. Provato sul telefono, con l'app
reinstallata e i dati dei siti cancellati: risposto **Sì** a «Rimani connesso?»,
e la sessione è morta lo stesso dopo un quarto d'ora. Con un account personale
quella strada non esiste.

Quindi la versione di MSAL è **fissata alla 3.30.0, esatta, senza `^`**. Lì
`LocalStorage` è un guscio sottile su `window.localStorage`: scrive in chiaro, e
l'accesso sopravvive alla chiusura dell'app. Un aggiornamento a v4 o v5
rimetterebbe in piedi il problema **in silenzio**, senza che niente smetta di
compilare — è il motivo per cui la versione non ha il cancelletto davanti, e
questo paragrafo esiste.

Sulla v3 tornano valide anche `storeAuthStateInCookie`, `iframeHashTimeout`,
`loadFrameTimeout`, `navigateToLoginRequestUrl` e `allowNativeBroker`: erano
scritte nel codice, la v5 le ignorava in silenzio, e ora fanno di nuovo quello
per cui erano state messe.

La strada definitiva, se un giorno la v3 non basterà più, resta quella già
scritta più sotto: un client riservato lato server che tenga lui il refresh
token, e allora della cache del browser non importerà più niente.

### La diagnosi in fondo alla schermata di login

Da iPhone non c'è una console da leggere, quindi la schermata di login dice da
sé perché è comparsa — e adesso lo dice **sempre**, anche quando un errore non
c'è. Perché i casi sono due, e si somigliano solo da fuori:

- **C'è un errore registrato** (`interaction_required` e il suo sotto-codice):
  il rinnovo silenzioso ha provato ed è stato respinto. Qui si guarda la
  durata: un'ora tonda vuol dire che il refresh token non è mai entrato in
  gioco, un giorno che è il tetto delle 24 ore.
- **Non c'è nessun errore ma il dispositivo ricordava un accesso**: l'account
  è stato *rimosso* dalla cache MSAL, non è scaduto. È quello che MSAL fa
  quando un riscatto del refresh token torna indietro rifiutato — e se il
  rifiuto è arrivato a un'altra istanza dell'app, in questa pagina non c'era
  niente da registrare. Vedi il lucchetto qui sotto.
- **Non c'è niente del tutto**: la memoria del sito è stata svuotata (Safari,
  ITP), oppure si sta guardando da un contesto diverso — l'app aperta
  dall'icona sulla Home ha la sua memoria, separata da quella di Safari.

### La cache dei dati e l'account, nello stesso cassetto

`localStorage` è uno solo per origine, e su Safari è piccolo — qualche mega,
meno ancora per un'app aperta dall'icona sulla Home. Dentro ci finiscono due
cose che non hanno niente a che vedere fra loro: la cache di TanStack Query
(`md_rq_cache_v1` — pagine OneNote, task, eventi di calendario a ±3 mesi,
tenuti 24 ore, riscritta a ogni cambiamento) e la cache di MSAL, cioè
l'account e il refresh token.

Quando lo spazio finisce, `setItem` smette di funzionare **per tutti**. La
cache dei dati se ne fa una ragione, ha il suo try/catch; MSAL no: si ritrova
a non poter scrivere il token appena ruotato, e l'accesso sparisce senza che
nessuno abbia visto scadere niente. Da fuori sembra una sessione che dura
poco. In realtà è la cache dei dati che ha mangiato il posto dell'account — e
si vede dal fatto che la sessione muore *dopo* un po' di navigazione, non a
un'ora tonda dall'accesso.

Per questo la persistenza della cache ha un tetto (`PERSIST_BUDGET`, un mega di
JSON): se lo supera, `serializzaEntroIlBudget` butta le query più grosse finché
non ci sta. Perdere gli eventi di tre mesi vuol dire riscaricarli, perdere
l'account vuol dire rifare l'accesso: non è lo stesso prezzo. Se lo spazio
finisce lo stesso, la chiave `md_storage_full` lo registra e la schermata di
login lo dice.

### Il riscatto a ogni avvio (e perché costava l'accesso)

`startTokenKeepAlive` rinnova quando manca poco alla scadenza, e la guardia che
lo decide legge `expiresAt`. Appena avviata l'app quel numero è zero — la
scadenza del token che MSAL ha in cache non si conosce ancora — e zero veniva
letto come «scaduto da sempre»: **ogni singolo lancio dell'app forzava un
riscatto del refresh token.**

È il modo più efficace di perderlo. Il refresh token è monouso e ruota: il
vecchio muore nell'istante in cui Microsoft emette il nuovo. Se la risposta non
torna indietro — la pagina che iOS sospende perché si è guardato altro per
qualche secondo, la rete mobile che cade — il nuovo non viene scritto da
nessuna parte. Vecchio morto, nuovo mai arrivato, accesso finito, e nessun
errore da nessuna parte perché la pagina non era più viva per registrarlo.

Ora all'avvio si fa una lettura non forzata: non spende niente, prende il token
dalla cache di MSAL e riempie `expiresAt`, così dalla volta dopo la guardia ha
un numero vero. E offline non si riscatta: fallirebbe e basta.

### Quattro opzioni MSAL che non facevano niente

`src/auth.js` configurava MSAL con opzioni scritte per la v2/v3, mentre in
`package.json` c'è la v5. Un'opzione che non esiste MSAL la ignora in silenzio,
quindi da fuori sembrava tutto a posto:

- `iframeHashTimeout` e `loadFrameTimeout` → in v5 non esistono; l'attesa
  dell'iframe nascosto ora è `system.iframeBridgeTimeout`. I dodici secondi
  pensati per la rete mobile non erano mai stati applicati.
- `storeAuthStateInCookie` → non esiste più fra le `cache` options.
- `navigateToLoginRequestUrl` → in v5 è un'opzione della singola richiesta, non
  della configurazione.
- `allowNativeBroker` → si chiama `allowPlatformBroker`.

### La scatola nera

`md_auth_trail` tiene gli ultimi otto fatti dell'autenticazione — accesso a
mano, token dalla cache, rinnovo riuscito, rinnovo fallito con il suo codice, e
soprattutto l'avvio, che si porta dietro l'inventario di quello che MSAL tiene
in `localStorage` **prima** di `initialize()` e **dopo**. È la misura che
decide fra le due spiegazioni rimaste per un account che sparisce senza errori:
chiavi presenti prima e assenti dopo vuol dire che è MSAL a fare pulizia
all'avvio; chiavi già assenti prima vuol dire che sono sparite mentre l'app era
chiusa, e allora è il telefono. L'inventario distingue per tipo (`rt` refresh
token, `at` access token, `id` id token) perché un paio di chiavi MSAL sono di
puro indice e restano lì anche quando non c'è più niente dentro — contare solo
il totale faceva sembrare piena una cache vuota. Solo nomi di chiave, mai
contenuti: nel registro non passa nessun token. La schermata di
login mostra gli ultimi cinque. Un errore solo dice cosa è andato storto; la
scatola nera dice cosa stava succedendo intorno, che su un telefono — dove
l'app viene riaperta dieci volte al giorno — è la parte che spiega tutto.

### Il lucchetto fra le istanze

Le tre icone sulla schermata Home (`Mente`, `GTD`, `Diario`) aprono la stessa
app sulla stessa origine: la cache MSAL è in comune, ma ogni pagina ha il suo
MSAL. La coda dei rinnovi in `auth.js` serializza le richieste dentro una
pagina sola, e fra pagine diverse non può niente: due rinnovi forzati insieme
sono due riscatti dello stesso refresh token, che è monouso e ruota. Il primo
lo invalida per il secondo, e MSAL — vedendosi rifiutare il riscatto — toglie
l'account dalla cache condivisa. Da lì la schermata di login, per tutte e due,
senza che nessuno abbia visto scadere niente.

`md_auth_refresh_lock` in `localStorage` è il lucchetto che manca a quella
coda: chi vuole forzare un rinnovo lo prende, chi lo trova occupato aspetta
tre secondi e poi si accontenta della cache — dove nel frattempo è arrivato il
token che ha preso l'altro. Scade da solo dopo venti secondi, altrimenti una
scheda chiusa a metà rinnovo bloccherebbe le altre per sempre.

Attenzione a due righe che si somigliano e non dicono la stessa cosa:
**«ultima chiamata riuscita»** si aggiorna anche quando `acquireTokenSilent`
risponde leggendo la cache, quindi dice fino a quando l'app è stata *usata*;
**«ultimo rinnovo vero»** si scrive solo quando il refresh token è stato speso
davvero. Se lì c'è scritto «mai» e la sessione è morta, il refresh token non è
mai entrato in gioco.

Le altre righe: motivo (e durante quale tentativo), ultimo accesso fatto a
mano, quanto è durata, se si è in Safari o nell'app dall'icona, e la data
della build. L'ultima serve a una domanda che da iPhone non ha altra risposta:
sto guardando l'ultimo deploy, o Safari mi sta ancora servendo il vecchio?
