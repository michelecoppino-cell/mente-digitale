// Modelli condivisi dell'app, come typedef JSDoc centralizzati.
//
// Questo file non esporta nulla a runtime: serve solo a dare un nome unico ai
// "contratti impliciti" sparsi nel codice (i campi decorati come _listName /
// _calColor, il marker testuale [MIN:n], la forma dei blocchi del piano con
// subSteps) così che editor e `npm run typecheck` possano segnalare in anticipo
// un campo rinominato o un payload malformato — i punti dove oggi un refactoring
// romperebbe qualcosa in silenzio.
//
// Uso da un altro file: `@param {import('./types').TodoTask} task`.

export {};

// ─────────────────────────────────────────────────────────────────────────────
// Tipi grezzi Microsoft Graph (la forma restituita dalle chiamate in api.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coppia data/ora di Graph. `dateTime` è una stringa ISO-like che nell'app può
 * arrivare senza suffisso 'Z' (vedi localToUtcDateTime in api.js).
 * @typedef {Object} GraphDateTime
 * @property {string} dateTime
 * @property {string} [timeZone]
 */

/**
 * Corpo di un task/evento To-Do o Outlook.
 * @typedef {Object} ItemBody
 * @property {string} content
 * @property {string} [contentType]
 */

/**
 * Taccuino OneNote. `_color` è la decorazione applicata dall'app (override
 * utente o colore assegnato per indice), non un campo nativo di Graph.
 * @typedef {Object} Notebook
 * @property {string} id
 * @property {string} displayName
 * @property {string} [_color]
 */

/**
 * Sezione OneNote. `_color` come per Notebook è una decorazione dell'app.
 * `links.oneNoteClientUrl` è il link `onenote:` che apre la sezione nell'app
 * desktop: Graph lo restituisce su sezioni e pagine.
 * @typedef {Object} OneNoteLinks
 * @property {{ href: string }} [oneNoteClientUrl]
 * @property {{ href: string }} [oneNoteWebUrl]
 *
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} displayName
 * @property {string} [_color]
 * @property {OneNoteLinks} [links]
 */

/**
 * Pagina OneNote (metadati; il contenuto HTML si prende con getPageContentHtml).
 * @typedef {Object} Page
 * @property {string} id
 * @property {string} [title]
 * @property {number} [level]
 * @property {number} [order]
 * @property {string} [lastModifiedDateTime]
 * @property {OneNoteLinks} [links]
 */

/**
 * Lista di Microsoft To-Do (nell'app mappa 1:1 su un'Area / progetto PARA).
 * `wellknownListName` vale 'defaultList' sulla lista predefinita di To-Do:
 * è quella che il flusso GTD tratta come Inbox.
 * @typedef {Object} TodoList
 * @property {string} id
 * @property {string} displayName
 * @property {string} [wellknownListName]
 */

/**
 * Task di Microsoft To-Do. I campi `_listName` / `_listId` sono decorazioni
 * aggiunte dall'app quando il task viene messo nel pool globale, per sapere da
 * quale lista proviene senza doverlo riassociare.
 * Il flusso GTD dell'app si legge da qui: `status` porta next/waiting/someday/done
 * (vedi taskModel.js), `categories` il contesto, `checklistItems` le
 * sottoattività. Solo la stima di durata non ha un campo nativo e sta nelle
 * note come marker [MIN:n].
 * @typedef {Object} TodoTask
 * @property {string} id
 * @property {string} title
 * @property {string} [status]        `notStarted` | `inProgress` | `waitingOnOthers` | `deferred` | `completed`
 * @property {string} [importance]    `low` | `normal` | `high`
 * @property {ItemBody} [body]        note del task; ospita il marker [MIN:n], la riga «In attesa da:» e reminder-src
 * @property {GraphDateTime|null} [dueDateTime]
 * @property {string} [createdDateTime]
 * @property {string} [lastModifiedDateTime]
 * @property {string} [completedDateTime]
 * @property {string[]} [categories]  contesto dell'attività (Lavoro / Personale / Famiglia)
 * @property {ChecklistItem[]} [checklistItems]
 * @property {string} [_listName]
 * @property {string} [_listId]
 */

/**
 * Voce di checklist di un task To-Do.
 * @typedef {Object} ChecklistItem
 * @property {string} id
 * @property {string} displayName
 * @property {boolean} isChecked
 */

/**
 * Proprietario di un calendario (usato per distinguere calendari propri da
 * quelli condivisi da altri).
 * @typedef {Object} CalendarOwner
 * @property {string} [address]
 * @property {string} [name]
 */

/**
 * Calendario Outlook.
 * @typedef {Object} Calendar
 * @property {string} id
 * @property {string} [name]
 * @property {string} [color]
 * @property {boolean} [isDefaultCalendar]
 * @property {CalendarOwner} [owner]
 */

/**
 * Evento di Calendario. I campi `_calId` / `_calName` / `_calColor` / `_isShared`
 * sono decorazioni aggiunte da getCalendarEvents per ricordare da quale
 * calendario proviene ogni evento dopo il merge multi-calendario.
 * @typedef {Object} CalendarEvent
 * @property {string} id
 * @property {string} [subject]
 * @property {GraphDateTime} [start]
 * @property {GraphDateTime} [end]
 * @property {boolean} [isAllDay]
 * @property {string} [webLink]
 * @property {ItemBody} [body]
 * @property {string} [_calId]
 * @property {string} [_calName]
 * @property {string} [_calColor]
 * @property {boolean} [_isShared]
 */

/**
 * Voce di reminderView: un preavviso di evento che scatta in una finestra.
 * @typedef {Object} Reminder
 * @property {string} eventId
 * @property {string} [eventSubject]
 * @property {GraphDateTime} [eventStartTime]
 */

/**
 * Indirizzo email (mittente di un messaggio Outlook).
 * @typedef {Object} EmailAddress
 * @property {string} [address]
 * @property {string} [name]
 */

/**
 * Messaggio Outlook (solo i campi letti dalla Daily Review).
 * @typedef {Object} EmailMessage
 * @property {string} [subject]
 * @property {any} [from]   di norma `{ emailAddress: EmailAddress }`, ma gestito difensivamente anche come stringa
 * @property {string} [bodyPreview]
 * @property {string} [receivedDateTime]
 * @property {boolean} [isRead]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Modelli di dominio dell'app
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Override colore scelti dall'utente, persistiti su OneDrive (color-settings).
 * @typedef {Object} ColorSettings
 * @property {Record<string, string>} notebooks   notebookId -> hex
 * @property {Record<string, string>} sections    sectionId  -> hex
 */

/**
 * Candidato prodotto dalla Daily Review (da email o da tag "Da fare" OneNote).
 * @typedef {Object} ReviewCandidate
 * @property {'email'|'onenote'} source
 * @property {string} title
 * @property {string} [meta]
 * @property {string} extractedAction
 * @property {number} [score]
 * @property {string} [pageId]           solo source 'onenote'
 * @property {string|null} [elementId]   solo source 'onenote'
 * @property {string} [originalTagHtml]  solo source 'onenote'
 */

/**
 * Titolo scadenza estratto da un subject "[NOME-LISTA] Titolo".
 * @typedef {Object} ParsedReminder
 * @property {string} listName
 * @property {string} title
 */

/**
 * Un "progetto" del Piano: raggruppa una o più liste To-Do sotto un colore.
 * @typedef {Object} ProjectConfig
 * @property {string} key
 * @property {string} name
 * @property {string} color
 * @property {string[]} todoListNames
 */

/**
 * Configurazione del Piano (persistita su OneDrive, planner-config).
 * `hiddenCalendarIds` a null = nessuna preferenza salvata (default), altrimenti
 * l'elenco esplicito dei calendar id nascosti.
 * @typedef {Object} PlannerConfig
 * @property {ProjectConfig[]} projects
 * @property {string} workdayStart
 * @property {string} workdayEnd
 * @property {string[]|null} hiddenCalendarIds
 */

/**
 * Sotto-passo (checklist) di un blocco-task del Piano.
 * @typedef {Object} SubStep
 * @property {string} id
 * @property {string} title
 * @property {boolean} completed
 */

/**
 * Blocco-task piazzato nella griglia del Piano: nasce da un task To-Do e ne
 * denormalizza titolo/lista/colore al momento del drop (non insegue modifiche
 * successive al task).
 * @typedef {Object} PlanBlock
 * @property {string} id
 * @property {string} taskId
 * @property {string} taskTitle
 * @property {string} [listId]
 * @property {string} [listName]
 * @property {string|null} projectKey
 * @property {string} projectColor
 * @property {string} startTime        "HH:MM"
 * @property {string} endTime          "HH:MM"
 * @property {boolean} completed
 * @property {string|null} [completedAt]
 * @property {SubStep[]} subSteps
 * @property {number} [pomodoros]
 */

/**
 * Nota libera ancorata dentro un blocco Workbook.
 * @typedef {Object} WorkbookNote
 * @property {string} id
 * @property {string} text
 * @property {number} top
 */

/**
 * Blocco Workbook piazzato nella griglia del Piano: vive come evento reale sul
 * calendario "Workbook" dedicato. `id` è l'id dell'evento Graph (o un id
 * temporaneo prima che Graph risponda alla creazione).
 * @typedef {Object} WorkbookBlock
 * @property {string} id
 * @property {string} workbookId
 * @property {string|null} subWorkbookId
 * @property {string} label
 * @property {string} color
 * @property {string} startTime        "HH:MM"
 * @property {string} endTime          "HH:MM"
 * @property {WorkbookNote[]} [notes]
 */

/**
 * Sotto-workbook (foglia dell'albero categorie Workbook).
 * @typedef {Object} SubWorkbook
 * @property {string} id
 * @property {string} name
 * @property {string} [color]
 */

/**
 * Workbook (nodo dell'albero categorie Workbook).
 * @typedef {Object} Workbook
 * @property {string} id
 * @property {string} name
 * @property {string} [color]
 * @property {SubWorkbook[]} subWorkbooks
 */

/**
 * Piano di un giorno (blocchi-task), persistito su OneDrive (daily-plans).
 * @typedef {Object} DayPlan
 * @property {string} date
 * @property {PlanBlock[]} blocks
 * @property {any[]} [emailExtractedActions]
 */

/**
 * Piano Workbook di un giorno (blocchi Workbook), speculare a DayPlan.
 * @typedef {Object} WorkbookDayPlan
 * @property {string} date
 * @property {WorkbookBlock[]} blocks
 */

/**
 * Voce di diario, persistita su OneDrive in file mensili (vedi api.js,
 * `mente-digitale/mente-digitale-diario-YYYY-MM.json`). `sealed` = voce "chiusa nel cassetto":
 * salvata ma tenuta fuori dalla timeline e dall'export, ritrovabile solo
 * cercandola esplicitamente.
 * @typedef {Object} DiaryEntry
 * @property {string} id
 * @property {string} ts                       ISO completo del momento di scrittura
 * @property {string} date                     'YYYY-MM-DD' locale
 * @property {'svuota-testa'|'sera'|'libero'} type
 * @property {string} text
 * @property {number|null} mood                1..5
 * @property {number|null} energy              1..5
 * @property {string[]} tags
 * @property {string[]} gratitude
 * @property {Record<string, string>|null} answers   risposte del rituale della sera
 * @property {string|null} seed                domanda-seme mostrata quel giorno
 * @property {boolean} sealed
 * @property {DiaryPhoto[]} photos             foto allegate, salvate a parte su OneDrive
 */

/**
 * Una sessione di movimento, meditazione o yoga — qualcosa che è **stato
 * fatto**. Quello che è solo programmato non sta qui: vive nel calendario
 * «Allenamenti», e le due cose non si mescolano mai (vedi movimento.js).
 * @typedef {Object} Movimento
 * @property {string} id
 * @property {string} date                     'YYYY-MM-DD' locale
 * @property {string} famiglia                 'movimento' | 'meditazione' | 'yoga'
 * @property {string} tipo                     Palestra, Corsa, Seduta, Flow…
 * @property {number} durataMin
 * @property {string} [nota]                   libera: «gambe + core», «6 km»
 * @property {string} [daEvento]               id dell'evento di calendario che questa
 *                                             sessione soddisfa, se registrata con «Fatta»
 * @property {string} createdAt                ISO del momento di registrazione
 */

/**
 * L'indice dei mesi che contengono voci di Movimento, più le due preferenze
 * della scheda: quale calendario porta le sessioni programmate, e quante
 * sessioni a settimana ci si è dati per famiglia.
 * @typedef {Object} MovimentoIndex
 * @property {string[]} months
 * @property {string|null} [calendarId]
 * @property {string|null} [calendarName]
 * @property {Record<string, number>} [bersagli]  sessioni a settimana per famiglia
 */

/**
 * Un obiettivo del mese. `fatti` e `fonte` si escludono: o il numero lo si
 * scrive a mano, o lo si deriva da un registro che l'app già tiene (vedi
 * obiettivi.js). Vivono tutti in un file solo su OneDrive, raccolti per mese:
 * `{ "2026-08": [ ... ] }`.
 * @typedef {Object} Obiettivo
 * @property {string} id
 * @property {string} titolo
 * @property {number} totale                   il bersaglio del mese
 * @property {number} [fatti]                  scritto a mano, quando non c'è fonte
 * @property {string} [unita]                  'pagine', 'sessioni'… solo per leggere meglio
 * @property {string} [fonte]                  'movimento' | 'movimento:yoga' | 'diario' | 'lettura:<id>'
 */

/**
 * Una voce di «Da leggere e vedere»: un libro, una serie, un film, un corso,
 * un articolo o un PDF. Tutte insieme in `coda.json` su OneDrive.
 * @typedef {Object} VoceCoda
 * @property {string} id
 * @property {string} titolo
 * @property {string} tipo                     'libro'|'serie'|'film'|'corso'|'articolo'|'pdf'
 * @property {'corso'|'coda'|'finito'} stato
 * @property {string} [fonte]                  autore, rete, dominio…
 * @property {string} [url]
 * @property {{ fatti: number, totale: number, unita: string }} [avanzamento]
 * @property {string} aggiunto                 ISO del momento in cui è entrata
 */

/**
 * Riferimento a un'immagine in `mente-digitale/diario-foto/`: nel JSON del mese
 * viaggia solo il nome del file, mai i byte.
 * @typedef {Object} DiaryPhoto
 * @property {string} name                     nome del file su OneDrive
 * @property {string} [caption]
 * @property {number} [w]
 * @property {number} [h]
 */
