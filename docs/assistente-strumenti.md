# Un assistente solo, tre connettori

Questo file non lo legge nessun programma: è la copia versionata di quello che
sta nella **memoria di Claude**, area «Strumenti e flusso di lavoro». La memoria
vive su claude.ai e non si può scrivere da qui — quando cambia, si cambia lì e
si riporta qui, così la versione buona ha un posto in cui stare e una
cronologia.

Il problema che risolve: tre connettori attivi (mente digitale, Microsoft 365,
Gmail) e una richiesta detta a voce non dice mai da quale passare. Senza una
mappa, il contesto va ripetuto ogni volta.

Le preferenze generali portano solo una riga — quelle si caricano in **ogni**
conversazione, anche quando si parla d'altro, e i dettagli tecnici lì sono peso
morto. Il dettaglio sta qui, e si legge quando serve.

## La riga nelle preferenze generali

> Per richieste operative su attività, calendario, mail, diario o commesse,
> consulta prima la memoria «Strumenti e flusso di lavoro» e segui la mappa di
> instradamento lì descritta.

## Chi sono i connettori

**Mente digitale** (connettore personalizzato) — l'archivio personale, ed è il
centro. Attività e sezioni, piano del giorno/settimana/mese, calendari, diario,
obiettivi del mese, Programma di commessa. Ci passa **tutto il lavoro
principale che non sia posta**: task, programmi e OneNote di STI stanno
sull'account personale, non sul tenant aziendale. E ci passa **tutto il lavoro
secondario**, che è su Microsoft 365 personale e per questo dal connettore M365
non si vede.

**Microsoft 365** (`michele.coppino@sti-corporate.com`) — solo il lavoro
principale, e in pratica due cose: la **posta Outlook** e, di rado,
**OneDrive/SharePoint aziendale**. Niente task, niente OneNote, niente
programmi: quelli non stanno lì.

**Gmail** — posta personale.

**I calendari** si guardano sulla mente digitale: è dove stanno tutti insieme.

### In una riga

> Posta di STI → Microsoft 365. Posta personale → Gmail. Tutto il resto —
> attività, piano, calendari, diario, obiettivi, commesse, lavoro secondario →
> mente digitale.

## Dentro la mente digitale

- Nessuno strumento cancella: si sposta, si chiude, non si distrugge. Le
  cancellazioni si fanno dall'app.
- Il calendario di lavoro STI è uno **specchio in sola lettura**: si vede, non
  si scrive. Un impegno nuovo su quel calendario si crea da Outlook.
- Una sezione è una lista; una commessa può avere più consegne,
  `GRUPPO.Consegna-YYMMDD`, dove le ultime sei cifre sono la scadenza. «Tutta
  la commessa» non è un posto in cui scrivere: serve la consegna.
- Granularità: sottoattività meno di 2 ore, attività meno di 2 giorni, consegna
  meno di un mese. Quello che non ci sta si spezza, e lo si dice.
- Mettere a piano è dare un'ora a un'attività in un giorno; un evento è un'ora
  fissa che riguarda anche altri. Non sono la stessa cosa.
- Le sottoattività si creano e si spuntano da qui: `attivita_crea` con l'elenco,
  `attivita_stato` con `sottoAggiungi`, `sottoFatta`, `sottoAperta`.
- Diario e obiettivi: scrivere sì; rileggere in profondità e riscrivere, no —
  quelle sono cose da seduti.
- Programma di commessa: le ore di una settimana **sostituiscono**, non si
  sommano.

## Regole trasversali

- Le mail non partono senza che siano state lette: bozza, poi conferma. Vale su
  Outlook come su Gmail.
- Una richiesta che tocca due mondi si fa dove ogni pezzo è di casa, e si dice
  cosa è finito dove: l'evento su Microsoft 365, l'attività di preparazione
  sulla mente digitale.
- Il lavoro secondario non ha un connettore di posta: la sua corrispondenza si
  chiede, non si cerca su M365 o su Gmail.
- Risposte corte e dicibili in auto o al telefono; complete alla scrivania.
