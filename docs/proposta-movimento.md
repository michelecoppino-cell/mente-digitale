# Proposta: la scheda «Movimento»

> Documento di proposta. Nessuna riga di codice della scheda Movimento è ancora
> scritta: oggi in `TodayView.jsx` c'è un `LockedCard` inerte, dichiarato come
> segnaposto proprio perché non esiste una fonte dati sugli allenamenti.
> Qui si decide quale fonte creare e che forma dare alla scheda.

## Cosa deve contenere

Tre famiglie di attività, non una:

| Famiglia | Esempi | Cosa conta davvero |
|---|---|---|
| **Movimento** | corsa, palestra (gambe, braccia, spalle…), bici, camminata | che sia stato fatto, quanto è durato, cosa si è allenato |
| **Meditazione** | seduta del mattino, respirazione, body scan | che sia stata fatta, quanti minuti, la striscia |
| **Yoga** | flow, yin, mobilità | che sia stato fatto, quanti minuti, il tipo |

Il minimo indispensabile per ognuna è lo stesso: **data + tipo + durata**. Tutto
il resto (la nota «corsa 6 km», «palestra gambe», il come è andata) è
facoltativo e va scritto solo quando c'è voglia — è la stessa lezione del
Diario, dove il campo obbligatorio è una riga sola e il resto è libero.

## Dove tenere i dati: JSON su OneDrive, non OneNote

**Raccomandazione: un file JSON su OneDrive, con la stessa impalcatura del
Diario** (`mente-digitale-movimento-YYYY-MM.json` + un indice dei mesi).

Perché non OneNote:

- OneNote è **testo libero in HTML**. Per sapere «quante volte in palestra
  questo mese» bisognerebbe scaricare le pagine e riparsare l'HTML a ogni
  render: è esattamente il lavoro che fa la Daily Review, e infatti è la parte
  più fragile dell'app (vedi `extractOneNoteCandidates` in `dailyReview.js`).
- Le sette barrette del riquadro in «Oggi» sono un conteggio per giorno. Su
  JSON è un `filter` da due righe; su OneNote è una catena di richieste Graph
  per taccuino → sezione → pagina → contenuto.
- OneNote non ha un campo «durata». Qualsiasi struttura si inventi (una tabella,
  un tag, `[MIN:45]`) è una convenzione fragile — e nel repo c'è già la lapide
  di una convenzione del genere: il marker `[EIS:Qn]` scritto nelle note dei
  task, rimosso e ora solo da ripulire (`docs/roadmap-produttivita.md`).

Perché JSON su OneDrive:

- L'infrastruttura c'è già e funziona: `getDriveJson` / `putDriveJson` in
  `api.js`, cartella `mente-digitale/`, un file per mese e un indice dei mesi
  esattamente come `loadDiaryMonth` / `loadDiaryIndex`.
- Sincronizza su tutti i dispositivi con l'account Microsoft già collegato:
  nessun login nuovo, nessuna dipendenza nuova.
- È leggibile e modificabile a mano, e finisce nei backup di OneDrive.
- Se un giorno serve, esportarlo in una pagina OneNote di riepilogo è banale;
  il contrario no.

Le altre due strade, per completezza:

- **IndexedDB come Finanze.** Va bene per i conti, che sono personali e legati a
  un computer; qui il dato si crea dal telefono dopo l'allenamento e si guarda
  dal portatile la mattina. Serve la sincronizzazione, quindi no.
- **Calendario Microsoft.** Tentante — c'è già `getCalendarEvents` — ma un
  allenamento *fatto* non è un evento *pianificato*: si finirebbe a distinguere
  i due a colpi di parole chiave sul titolo, come già succede per le ricorrenze
  in `TodayView`, e a sporcare l'agenda vera. Resta però un'idea buona come
  **ingresso facoltativo** (vedi fase 3).

## Il modello dati

Una voce per sessione, sullo stampo di `DiaryEntry`:

```jsonc
{
  "id": "mv_2026-08-26_a1b2",
  "date": "2026-08-26",          // 'YYYY-MM-DD' locale
  "famiglia": "movimento",       // 'movimento' | 'meditazione' | 'yoga'
  "tipo": "palestra",            // corsa | palestra | bici | camminata |
                                 // meditazione | yoga — l'elenco è configurabile
  "durataMin": 55,               // interi; il campo che alimenta i totali
  "nota": "gambe + core",        // libero, facoltativo: «corsa 6 km», «braccia»
  "tag": ["gambe", "core"],      // facoltativi, ricavati dalla nota o scelti
  "createdAt": "2026-08-26T19:40:11.000Z"
}
```

Due scelte da spiegare:

- **`famiglia` e `tipo` separati.** La famiglia decide il colore e la riga di
  totali («3 movimento · 4 meditazioni questa settimana»); il tipo è quello che
  si sceglie davvero al momento di registrare. Con un campo solo, aggiungere
  «bici» vorrebbe dire toccare ogni punto che raggruppa.
- **`nota` libera + `tag` opzionali.** La richiesta è «volendo la possibilità di
  mettere qualche nota tipo corsa, palestra gambe, braccia»: la nota copre
  quello senza obbligare a nulla. I tag si suggeriscono dalle note già scritte
  (le ultime venti, come fa `destinationMru.js` per le destinazioni della
  cattura), così dopo due settimane «gambe» si sceglie con un tocco.

File e indice, identici al Diario:

```
mente-digitale/mente-digitale-movimento-2026-08.json   // [] di voci del mese
mente-digitale/mente-digitale-movimento-index.json     // { months: [...] }
```

## Come si registra

Il gesto deve costare meno del non farlo: si registra dal telefono, in piedi,
con una mano.

1. **Riquadro «Movimento» in Oggi.** Sotto le sette barrette, tre bottoni:
   `Movimento` · `Meditazione` · `Yoga`. Un tocco apre il modulo già impostato
   su quella famiglia.
2. **Il modulo**: tipo (chip da toccare, con l'ultimo usato in testa), durata
   (chip rapidi 15 / 30 / 45 / 60 min + campo libero), nota (una riga, con i
   tag recenti sotto). Il tasto salva è uno solo, e la data è oggi finché non la
   si cambia.
3. **Modifica**: toccare una barretta apre le voci di quel giorno.

Costo tipico: due tocchi per una meditazione da 15 minuti, quattro per
«palestra, 55 min, gambe + core».

## Come si legge

- **In Oggi** (il riquadro che oggi è finto): sette barrette, una per giorno,
  colorate per famiglia e alte in proporzione ai minuti; sotto, una riga di
  contesto — «3 sessioni · 2h15 · 4 giorni di fila», nello stesso tono della
  striscia del Diario.
- **Nel Diario**: le voci del giorno compaiono in coda alla giornata, come
  contesto della scrittura serale. Non si scrive niente di nuovo: è una lettura.
- **Più avanti, una pagina propria** (`/movimento`): mesi a calendario,
  minuti per famiglia, la striscia più lunga. Da fare solo se le prime due
  viste risultano strette — non prima.

## Il riquadro in Oggi va lasciato riservato?

No. Il PIN in «Oggi» copre i cento desideri e i conti perché sono cose che non
si vogliono leggibili alle spalle in ufficio. Quante volte si è corso questa
settimana non è di quella categoria: il riquadro Movimento resta in chiaro
come agenda e diario. Se un giorno cambiasse idea basta avvolgerlo in
`<SensitiveCard>` — è già il wrapper generico usato dagli altri due.

## Piano di lavoro

| Fase | Cosa | Dove |
|---|---|---|
| 1 | Modello + persistenza: `movimento.js` (tipi, id, striscia, totali) e `loadMovimentoMese` / `saveMovimento` in `api.js`, sullo stampo del Diario | `src/movimento.js`, `src/api.js` |
| 2 | Il riquadro vero in Oggi + il modulo di registrazione | `src/TodayView.jsx`, `src/MovimentoQuickAdd.jsx` |
| 3 | *Facoltativo:* importazione dal calendario — un calendario dedicato («Allenamenti») letto con `getCalendarEvents` e proposto come voci da confermare, come fa la campanella | `src/api.js`, Daily Review |
| 4 | *Facoltativo:* pagina `/movimento` con lo storico | `src/MovimentoView.jsx` |

Le fasi 1 e 2 insieme sono la funzione completa: dopo quelle il riquadro finto
sparisce e il dato esiste. Le altre due si valutano dopo qualche settimana d'uso.
