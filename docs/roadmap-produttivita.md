# Roadmap: Pomodoro, Eisenhower, GTD, Daily Review in Mente Digitale

> **Nota di aggiornamento.** Questo è il documento di pianificazione di una
> sessione passata, lasciato com'era scritto allora. Il punto 1 — la matrice di
> Eisenhower — è stato costruito e poi **rimosso**: avere insieme il flusso GTD
> a colonne e i quadranti voleva dire due modi di dire la stessa cosa sullo
> stesso task. Oggi lo stato di un'attività è la colonna in cui sta, e basta.
> Del marker `[EIS:Qn]` resta solo la ripulitura delle note vecchie, in
> `taskModel.noteText`.
>
> Stessa sorte, più tardi, per il punto 2 — il **Pomodoro**. Timer, barra di
> sessione, colonna della concentrazione nel Piano e file di statistiche su
> OneDrive sono stati tolti tutti: misurare i quarti d'ora era diventato un
> secondo lavoro accanto al lavoro, e il Piano dice già quando una cosa si fa e
> per quanto. Al posto del bottone che avviava una sessione, nel dettaglio di
> un'attività c'è «Apri il workbook», che porta alla sezione. Il resto del
> documento vale ancora.

## Contesto

Sessione precedente: mappatura generale di GTD/Eisenhower/PARA/Time Blocking/Pomodoro
sull'architettura di "Mente Digitale" (dashboard React+Vite che unifica OneNote, To-Do e
Calendar via Graph API, con Pianificatore giornaliero già maturo in `PlannerView.jsx`).

L'utente ha ristretto lo scope al prossimo giro di lavoro a **4 funzionalità concrete**,
descrivendo anche il flusso d'uso quotidiano immaginato:

> Ogni mattina apro la mente digitale, do un'occhiata generale, poi passo al Piano. Prima di
> organizzare la giornata, smisto secondo Eisenhower i task non ancora classificati (scrivendo
> una stringa nelle note del task di To-Do), poi trascino i task incasellati sulla timeline di
> oggi. Per catturare nuovi pensieri durante il giorno uso un pulsante "+" che apre il diagramma
> di flusso GTD "Chiarire" e mi guida a decidere se diventa una nota OneNote, un task, o altro.
> Vorrei anche una campanella in alto a destra che mi segnala proposte di task generate da
> email/MOM/routine, da approvare o scartare.

**Questo è ancora un documento di pianificazione — nessun codice va scritto in questa sessione.**
Definisce cosa costruire e dove, per un'implementazione successiva.

### Decisioni già prese con l'utente
- **Eisenhower**: quadrante salvato come stringa nelle note del task To-Do (es. `[EIS:Q1]`),
  non come categoria Graph.
- **Campanella/Daily Review**: le proposte si rigenerano all'apertura dell'app e quando si preme
  il pulsante "↺ Aggiorna tutto" già esistente in `App.jsx` — nessuna Action schedulata separata.
- **GTD Chiarire**: si usa il diagramma classico di David Allen (non azionabile → Cestino/Forse un
  giorno/Riferimento; azionabile → <2 min fallo subito, altrimenti Delega o Pianifica).

## Funzioni Graph già disponibili in `src/api.js` (da riusare)

`getTodoLists`, `getTodoTasks`, `createTask(listId, title)`, `getTask`, `updateTaskBody`,
`createChecklistItem`, `getCalendarEvents`, `getRecentEmails`, `getNotebooks`, `getSections`,
`getPages`. **Mancano** (da aggiungere): creazione pagina OneNote (`createNotePage`), e un
`createTask` esteso con `body`/`dueDate` opzionali (oggi accetta solo il titolo).

---

## 1. Eisenhower — triage mattutino

**Flusso**: prima di organizzare la giornata, l'utente passa in rassegna i task non ancora
etichettati e li assegna a un quadrante; poi torna al Pianificatore e li trascina sulla timeline.

- **Encoding**: prefisso `[EIS:Q1]`…`[EIS:Q4]` in testa al body/note del task (Q1=urgente+importante,
  Q2=importante non urgente, Q3=urgente non importante, Q4=nessuno dei due). Scritto/letto con
  `getTask`/`updateTaskBody` (già presenti, stesso pattern usato in `TaskDetailPanel` di
  `PlannerView.jsx` per le note).
- **Nuovo componente `EisenhowerTriage.jsx`** (modal a schermo intero, apribile da un bottone nel
  Pianificatore, es. accanto a "✨ Piano AI"): mostra i task senza marker (serve un fetch batch dei
  body — throttle come già fatto in `preloadAllTasks`/`SchedulePanel.load` con `setTimeout` tra
  chiamate) uno alla volta o come mazzo trascinabile in una griglia 2×2. Salva subito ad ogni
  assegnazione (no batch save, per resilienza).
- **Riuso nel Pianificatore**: parser `parseEisenhower(task)` (legge il marker dal body già
  cachato) usato per: (a) nuovo filtro quadrante nel Task Pool di `PlannerView.jsx` accanto al
  filtro progetto esistente (`planner-filters`), (b) badge colorato sul task pool item, (c) hint
  nel prompt di `generate-schedule` (`functions/api/daily-plan.js`) per dare priorità a Q1/Q2.

## 2. Pomodoro — timer legato ai blocchi del piano

**Flusso**: solo durante l'esecuzione delle attività già pianificate in timeline, non uno
strumento standalone. Timer 25/5, avviso a fine ciclo per la pausa di 5 minuti.

- **Nuovo componente `PomodoroTimer.jsx`**: widget flottante (angolo schermo), stato locale a
  macchina a stati (`idle → working → break → working…`), nessuna persistenza server necessaria
  a parte il contatore per blocco.
- **Trigger**: nuovo bottone "🍅" nei `planner-block-actions` di `PlannerView.jsx` (accanto a
  quelli già presenti "🔀 Scomponi" e "✕ Rimuovi"), avvia il timer per quel blocco.
- **Dato persistito**: campo `pomodoros` aggiunto all'oggetto `block` (lo schema è già estendibile
  in modo ad-hoc, come dimostra l'aggiunta pregressa di `subSteps`/`subSplits`); salvato tramite
  `mutatePlan`/`scheduleSave` già esistenti.
- **Avviso pausa**: Notification API del browser (richiede permesso una tantum) + suono opzionale;
  nessuna nuova infrastruttura backend.

## 3. GTD — cattura con pulsante "+" e diagramma di flusso "Chiarire"

**Flusso**: durante il giorno, l'utente cattura un pensiero/input col pulsante "+", risponde alle
domande del diagramma classico GTD, e il sistema instrada verso OneNote/To-Do/scarto.

- **Nuovo bottone "+"** in `App.jsx` header (`header-right`, vicino al bottone ricerca 🔍
  esistente) o floating action button globale, sempre visibile.
- **Nuovo componente `GtdClarifyModal.jsx`**, wizard a step che replica il diagramma standard:
  1. Input libero: "Cos'è?"
  2. "È azionabile?" → **No**: Cestino (scarta) / Forse un giorno (crea task in lista dedicata
     "📥 Forse/Un giorno") / Materiale di riferimento (crea pagina in una sezione OneNote scelta
     dall'utente — **richiede nuova funzione `createNotePage(sectionId, title, content)`** in
     `api.js`, oggi assente, via `POST /me/onenote/sections/{id}/pages`)
  3. **Sì** azionabile → "Meno di 2 minuti?" → Sì: nessuna task, solo promemoria "fallo ora" /
     No → "Puoi delegarla?" → Sì: crea task con marker `[WAIT]` nelle note / No: crea task
     normale (riusa `createTask`, eventualmente con lista/progetto preselezionati)
  4. Opzione finale: "Aggiungi subito al piano di oggi" → chiama la stessa logica di `addBlock`
     usata in `PlannerView.jsx` (va esposta/richiamata anche da fuori, es. sollevando lo stato o
     un evento globale, dato che oggi `addBlock` vive solo dentro `PlannerView`).
- Questo copre sia la cattura da input generici ("mi è venuto in mente ora") sia, in futuro,
  action item pre-estratti da email (punto 4).

## 4. Daily Review — campanella con proposte task

**Flusso**: all'apertura dell'app o al click su "↺ Aggiorna tutto" (`App.jsx`), un controllo
scansiona email recenti (e in futuro MOM/routine) e propone task da creare tramite un'icona a
campanella in alto a destra, con badge del conteggio.

- **Nuovo bottone campanella 🔔** in `App.jsx` header (`header-right`), con badge numerico,
  apre un pannello a tendina (pattern simile a `SearchOverlay.jsx`) con la lista delle proposte.
- **Backend**: generalizzare l'azione esistente `extract-email-actions` in
  `functions/api/daily-plan.js` (già scansiona `getRecentEmails()` via Claude) in una nuova
  azione `daily-review-suggestions` che aggrega più fonti:
  - Email recenti (già presente)
  - MOM (Minute of Meeting): note OneNote di sezioni "riunioni"/eventi calendario recenti con
    descrizione — da valutare quale sorgente reale l'utente usa per i MOM (**domanda aperta**,
    vedi sotto)
  - Routine/script quotidiani: regole configurabili lato client (es. "ogni lunedì proponi
    task settimanale X") — lista statica in `planner_config` o nuovo file `routines_config.json`
    su OneDrive, nessuna AI necessaria per queste
- **Stato client**: le proposte sono effimere (non salvate su OneDrive), tenute in uno state di
  `App.jsx` con cache TTL breve (pattern `cacheGet`/`cacheSet` già in `cache.js`), rigenerate ai
  due trigger concordati.
- **Azioni utente per proposta**: "✓ Crea task" (chiama `createTask`, eventualmente con
  lista/quadrante Eisenhower preselezionato) / "✕ Ignora".

### Domanda aperta da chiarire prima di implementare il punto 4
Cosa intende l'utente per "MOM" in questo contesto — verbali/appunti di riunione scritti a mano
in OneNote dopo un meeting? Se sì, serve capire in quale notebook/sezione li scrive di solito,
per sapere quali pagine scansionare.

---

## File coinvolti (riepilogo)

| File | Modifica |
|---|---|
| `src/App.jsx` | + bottone "+" (GTD), + bottone campanella (Daily Review), stato proposte |
| `src/PlannerView.jsx` | + filtro/badge Eisenhower nel Task Pool, + bottone 🍅 nei blocchi, + campo `pomodoros` nei blocks |
| `src/EisenhowerTriage.jsx` | **nuovo** — schermata di smistamento mattutino |
| `src/PomodoroTimer.jsx` | **nuovo** — widget timer 25/5 |
| `src/GtdClarifyModal.jsx` | **nuovo** — wizard diagramma "Chiarire" |
| `src/api.js` | + `createNotePage`, estensione `createTask` con `body`/lista opzionali |
| `functions/api/daily-plan.js` | nuova azione `daily-review-suggestions` (generalizza `extract-email-actions`) |

## Ordine consigliato di implementazione
1. Eisenhower (autonomo, riusa solo dati/API esistenti)
2. Pomodoro (autonomo, puro client-side)
3. GTD capture (introduce `createNotePage` e la logica di routing — base per il punto 4)
4. Daily Review / campanella (il più dipendente da chiarimenti su MOM/routine)

## Nota
Nessuna modifica al codice è stata fatta in questa sessione. Quando si deciderà di procedere,
si aprirà una sessione di implementazione per ciascun punto (o per tutti e 4 in sequenza),
partendo da questo documento.
