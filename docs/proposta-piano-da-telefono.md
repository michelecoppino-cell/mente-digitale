# Proposta: pianificare la giornata dal telefono

> **Proposta, non ancora costruita.** È stata chiesta come proposta e basta: qui
> non c'è codice, e nell'app non è cambiato niente. Serve a decidere *cosa*
> costruire prima di costruirlo — e, se la risposta è «per ora niente», serve
> lo stesso, perché scrive il ragionamento invece di rifarlo fra sei mesi.
>
> La richiesta era: *pianificare la giornata dalla macchina, quindi dal
> cellulare, in un modo semplice*.

## Perché oggi non si può

Il Piano è una griglia oraria, e ci si scrive **trascinando** un'attività dal
serbatoio a sinistra su una fascia da mezz'ora. È il gesto giusto su uno schermo
largo — si vede la giornata intera, il calendario accanto, e la mano ha spazio.

Su un telefono lo stesso gesto non esiste. Sotto i 768px il serbatoio e la
griglia non stanno affiancati, e il Piano diventa una cosa che **si legge**: si
tocca un blocco e sale il foglio col dettaglio dell'attività. Non è una svista,
è una resa — trascinare in una fascia da mezz'ora con un pollice, su 375px,
richiede una precisione che nessuno ha nemmeno da fermo.

E in macchina non si è nemmeno da fermi. Si è a un semaforo, o si sta parlando
guardando la strada. Qualunque cosa richieda di **puntare** è fuori discussione;
qualunque cosa richieda di **leggere venti righe** anche.

## L'errore da non fare: portare la griglia sul telefono

La strada che viene in mente per prima è rendere la griglia usabile col dito:
zoom, fasce più alte, un long-press che «prende» il blocco e un secondo tocco
che lo posa. Si può fare, ed è la cosa sbagliata.

Sarebbe il gesto del desktop, rimpicciolito e reso più difficile. Chi lo prova
una volta in macchina non lo riprova, e a quel punto la funzione esiste ma non
la usa nessuno — che è peggio di non averla, perché sembra risolto.

**La domanda giusta non è «come si trascina da telefono» ma «cosa, della
pianificazione, va davvero fatto a mano».**

## L'idea: pianificare la giornata sono due decisioni, non una

1. **Che cosa.** Quali attività, fra le tante aperte, sono la giornata di oggi.
   E in che ordine — cosa per prima, cosa quando la testa è ancora fresca, cosa
   può stare nel pomeriggio.
2. **A che ora.** Dove cadono esattamente sull'orologio, fra una riunione e
   l'altra, con la durata di ciascuna.

La prima è una decisione umana, e non la può prendere nessun altro: dipende da
cosa scade, da con chi si è parlato ieri, da come ci si sente. **È quella che
vale la pena fare in macchina.**

La seconda è aritmetica. Le ore lavorative sono in `plannerConfig`
(`workdayStart`/`workdayEnd`), gli impegni fissi sono già sul calendario, e ogni
attività porta la sua stima nelle note (`[MIN:n]`). Dato un elenco ordinato, il
posto di ciascuna è una conseguenza — e il codice che la calcola, evitando le
sovrapposizioni, è già stato scritto per il canale MCP (`pianoAggiungi` in
`scripts/mente-comandi.mjs`).

Da telefono va fatta **solo la prima**.

## La proposta: «la scaletta»

Una schermata sola, raggiungibile da «Oggi» quando lo schermo è stretto.
Nient'altro che due elenchi, uno sopra l'altro:

```
  ┌─────────────────────────────────┐
  │  Domani ▾            [Riempi →] │   ← il giorno, e il tasto che chiude
  ├─────────────────────────────────┤
  │  LA SCALETTA                    │
  │  1  Relazione fondazioni   1h30 │   ← toccando: ✕ toglie, ↕ sposta
  │  2  Chiamare il fornitore   30m │
  │  3  Revisione tavole         2h │
  │     ─────────────── 4h su 7h30  │   ← quanto pesa, contro la giornata vera
  ├─────────────────────────────────┤
  │  DA DOVE PESCARE                │
  │  ◦ Verifica carichi        1h   │   ← un tocco e va in fondo alla scaletta
  │  ◦ Mail a Rossi            15m  │
  │  ◦ …                            │
  └─────────────────────────────────┘
```

**Le regole che la rendono usabile con un pollice:**

- **Un tocco aggiunge, in fondo.** Nessun trascinamento, nessun bersaglio da
  centrare: si tocca un'attività e finisce in coda alla scaletta. L'ordine in cui
  si tocca *è* l'ordine della giornata, e nella maggior parte dei casi è già
  quello giusto — si pensa alle cose nell'ordine in cui si faranno.
- **Nessun orologio.** In tutta la schermata non compare un'ora. Compaiono le
  durate, che si leggono senza doverle sommare, e una riga sola che dice se la
  scaletta ci sta nella giornata. È l'unica informazione che serve per fermarsi:
  *ci sta o non ci sta*.
- **Le attività già a piano non ci sono.** Le si vede in grigio in Sezioni per
  lo stesso motivo: quello che è già collocato non va ricollocato.
- **«Riempi» piazza tutto in un colpo.** Prende la giornata lavorativa, ci
  scava i buchi degli eventi del calendario, e ci lascia cadere la scaletta
  nell'ordine dato, ciascuna per la sua stima. Il risultato è un piano vero, che
  si apre nell'app e si aggiusta con un trascinamento da desktop se serve.

Quello che «Riempi» non trova posto per, resta nella scaletta con scritto
perché. Non lo comprime e non lo taglia: se cinque ore di roba non stanno in tre
ore libere, la risposta è «non ci stanno», non un piano che mente.

### Perché questa e non un modulo

Perché è un elenco di tocchi, e un elenco di tocchi si può fare guardando
altrove per metà del tempo. Non c'è niente da scrivere, niente da scegliere in
un menù a tendina, niente che vada annullato se si sbaglia — un tocco di troppo
si toglie con un altro tocco.

## E la voce?

È la risposta ovvia per la macchina, e vale la pena dire con precisione a che
punto è, perché sembra più vicina di quanto sia.

**Quello che già funziona oggi, senza costruire niente:** catturare. L'app
Microsoft To-Do sul telefono prende il dettato, e un'attività dettata a un
semaforo arriva in Inbox e la sera è nell'app. Questo pezzo è risolto, e non è
poco — metà di quello che si vorrebbe fare in macchina è buttare fuori un
pensiero, non pianificarlo.

**Quello che non funziona:** dettare *il piano*. Gli strumenti per scriverlo ci
sono — `piano_aggiungi` mette un'attività a un'ora, e una frase come «domani alle
nove la relazione» è esattamente quello che un modello sa tradurre in una
chiamata. Ma il server MCP parla su una pipe, sul disco di questo computer: dal
telefono non è raggiungibile, e non c'è configurazione che lo renda tale (il
README lo spiega per esteso in *Dove funziona e dove no*). Servirebbe la
versione remota: il server esposto su internet, con un'autenticazione propria, e
la macchina sempre accesa. È un progetto a sé, e va valutato per quello che
costa — non come «un pezzetto in più».

**Una scorciatoia che invece costa poco**, e che vale la pena tenere in mente:
la sveglia appena costruita scrive `[SVEGLIA:hh:mm]` nelle note di un'attività, e
le note di un'attività si scrivono dall'app To-Do del telefono. Lo stesso
meccanismo, con un marker diverso — `[PIANO:hh:mm]` — sarebbe un modo di dire
«questa, domani, alle nove» dal telefono senza costruire nessuna interfaccia
nuova: l'app lo leggerebbe alla prima apertura e lo trasformerebbe in un blocco
vero, togliendo il marker.

Non è bello, ed è la ragione per cui non lo propongo come prima cosa: chiede di
ricordarsi una sintassi, e le sintassi da ricordare si dimenticano. Ma è
sproporzionatamente economico rispetto a tutto il resto, e se la scaletta si
rivelasse troppo lenta da costruire, è il ripiego che tiene.

## Cosa proporrei di fare, e in che ordine

| # | Cosa | Costo | Serve a |
|---|---|---|---|
| 1 | **La scaletta**, con «Riempi» che usa ore lavorative + calendario + stime | medio | Pianificare davvero, dal telefono, in un minuto |
| 2 | Il marker `[PIANO:hh:mm]` letto all'apertura | basso | Il caso «me lo ricordo adesso», dettando a To-Do |
| 3 | Server MCP remoto | alto, progetto a sé | La voce vera: «domani alle nove la relazione» |

Il 2 è indipendente dall'1 e non lo sostituisce: uno è il momento in cui ci si
siede a decidere la giornata, l'altro è l'idea che arriva in tangenziale.

> **Aggiornamento.** Il 3 è stato poi guardato da vicino, perché è quello che
> serve alla scena della macchina: `docs/proposta-voce-dal-telefono.md` lo
> misura pezzo per pezzo. Due cose ne escono che riguardano anche questa
> proposta: la voce sul telefono gli strumenti li chiama davvero, e il calcolo
> del tasto «Riempi» qui sotto è lo stesso che serve là — conviene scriverlo
> una volta sola, in `mente-comandi.mjs`, e usarlo da tutti e due i canali.

Il 3 non lo comincerei per questo. Se un giorno lo si farà, lo si farà perché
serve tutto il canale MCP dal telefono, non solo il piano — e allora il piano
sarà uno dei motivi, non il motivo.

## La cosa che non farei

Un piano che si compila da solo. Guardando scadenze, priorità e ore libere si
potrebbe proporre la giornata intera senza chiedere niente, e sarebbe una demo
che funziona.

Ma la giornata pianificata da qualcun altro non la si segue: si apre il Piano la
mattina, si legge una scaletta in cui non ci si riconosce, e si lavora
comunque a memoria. Il valore della pianificazione **è nell'averla fatta**, non
nel documento che ne esce. La scaletta chiede tre tocchi proprio perché quei tre
tocchi sono la cosa che serve — tutto il resto, le ore comprese, l'app può farlo
da sé.
