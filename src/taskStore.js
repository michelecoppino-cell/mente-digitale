// @ts-check
// I task su file nostri, in `mente-digitale/task/` su OneDrive.
//
// Qui non c'è nessun campo piegato ad altro uso: lo stato è un campo, la
// persona è un campo, la stima e la sveglia sono campi. È tutta la differenza
// con Microsoft To-Do, dove metà del lavoro era spiegare come aggirare
// l'assenza di un posto dove mettere le cose (vedi i marker in taskModel.js).
//
// La disposizione:
//
//   task/_liste.json      il registro delle liste: id, nome, file, ordine
//   task/<slug>.json      una lista, con dentro i suoi task
//
// **Un file per lista, non per commessa.** La lista è già la granularità del
// codice: coincide con la chiave di cache `qk.tasks(listId)` e con `_listId`,
// che nell'app compare sempre come metà della coppia `(listId, taskId)`. Tenendo
// questa granularità, `_listId` diventa il nome del file e tutto il codice che
// ragiona per lista continua a ragionare per lista.
//
// **Nessun file indice dei task.** La vista Attività è trasversale alle liste e
// le servono tutti i file, ma un indice è una cache che si disallinea — la
// stessa classe di bug già vista fra le tre copie della cache in App.jsx,
// stavolta su OneDrive e fra due dispositivi. Le liste si leggono tutte, come
// si fa oggi.
//
// **Gli id non si rigenerano.** Quelli che arrivano da To-Do restano quelli di
// To-Do: i blocchi in `daily-plans` referenziano i task per id, e così le
// sveglie già suonate e la deduplica delle scadenze ricorrenti. Rigenerarli
// scollegherebbe il Piano da tutto ciò che è già programmato.

import { getDriveJson, putDriveJson, percorsoTask } from './api';

/** La versione dello schema che questo codice scrive. */
export const VERSIONE = 1;

/** Il registro delle liste. */
export const FILE_REGISTRO = percorsoTask('_liste.json');

/**
 * @typedef {object} ListaRegistrata
 * @property {string} id           l'id della lista (da To-Do, o generato)
 * @property {string} nome         il nome visibile, che è anche il nome PARA
 * @property {string} file         percorso del file dei task, relativo alla cartella dell'app
 * @property {boolean} [inbox]     la lista trattata come Inbox
 * @property {string} [creatoIl]
 */

/**
 * @typedef {object} Sottoattivita
 * @property {string} id
 * @property {string} titolo
 * @property {boolean} fatta
 */

/**
 * Un'attività. `stato` è uno degli otto del flusso meno `scheduled`, che non è
 * un campo: resta derivato dalla presenza di un blocco in `daily-plans`,
 * esattamente come prima. Un task ha uno e un solo stato.
 *
 * @typedef {object} Task
 * @property {string} id
 * @property {string} titolo
 * @property {'inbox'|'next'|'ask'|'waiting'|'delegated'|'someday'|'done'} stato
 * @property {string|null} persona     chi devi sentire: a chi chiedere, da chi aspetti, a chi hai delegato
 * @property {string|null} contesto    'lavoro' | 'personale' | 'famiglia'
 * @property {number|null} stimaMin
 * @property {string|null} sveglia     'HH:MM', un'ora di oggi
 * @property {string|null} scadenza    'YYYY-MM-DD'
 * @property {string} nota             testo pulito, senza marker da spogliare
 * @property {string|null} origineScadenza  quale occorrenza di quale evento ha
 *   generato il task, per le scadenze ricorrenti: serve a non ricrearlo a ogni
 *   scansione (vedi deadlineReminders.js). Non è testo per chi legge, è un
 *   riferimento, quindi non sta nella nota.
 * @property {Sottoattivita[]} sottoattivita
 * @property {string} creatoIl
 * @property {string} modificatoIl
 * @property {string|null} completatoIl
 * @property {string} [_listId]        decorazione: da quale lista viene
 * @property {string} [_listName]
 */

/**
 * @typedef {object} FileLista
 * @property {number} version
 * @property {string} listId
 * @property {string} listName
 * @property {Task[]} tasks
 */

const STATI = ['inbox', 'next', 'ask', 'waiting', 'delegated', 'someday', 'done'];

/** @returns {string} */
const adesso = () => new Date().toISOString();

/** Un id nuovo, per quello che nasce da qui in poi. @returns {string} */
export function nuovoId() {
  return globalThis.crypto?.randomUUID?.() ?? `md-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizzazione
// ─────────────────────────────────────────────────────────────────────────────
// Ogni file porta un `version` dal primo giorno, prima ancora che serva: senza,
// la prima volta che si vorrà rinominare o ristrutturare un campo ci si
// troverebbe file scritti in mesi diversi con forme diverse e nessun modo di
// distinguerli. La lettura porta qualunque versione trovata alla forma
// corrente, la scrittura riscrive sempre nella corrente.

/** @param {any} raw @returns {Sottoattivita} */
function normalizzaSottoattivita(raw) {
  return {
    id: String(raw?.id || nuovoId()),
    titolo: String(raw?.titolo ?? raw?.displayName ?? ''),
    fatta: !!(raw?.fatta ?? raw?.isChecked),
  };
}

/**
 * @param {any} raw
 * @returns {Task}
 */
export function normalizzaTask(raw) {
  const creato = typeof raw?.creatoIl === 'string' ? raw.creatoIl : adesso();
  const stato = STATI.includes(raw?.stato) ? raw.stato : 'next';
  const stima = Number(raw?.stimaMin);
  return {
    id: String(raw?.id ?? nuovoId()),
    titolo: String(raw?.titolo ?? ''),
    stato: /** @type {Task['stato']} */ (stato),
    persona: raw?.persona ? String(raw.persona) : null,
    contesto: raw?.contesto ? String(raw.contesto) : null,
    stimaMin: Number.isFinite(stima) && stima > 0 ? Math.round(stima) : null,
    sveglia: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw?.sveglia || '') ? raw.sveglia : null,
    scadenza: /^\d{4}-\d{2}-\d{2}$/.test(raw?.scadenza || '') ? raw.scadenza : null,
    nota: typeof raw?.nota === 'string' ? raw.nota : '',
    origineScadenza: raw?.origineScadenza ? String(raw.origineScadenza) : null,
    sottoattivita: Array.isArray(raw?.sottoattivita) ? raw.sottoattivita.map(normalizzaSottoattivita) : [],
    creatoIl: creato,
    modificatoIl: typeof raw?.modificatoIl === 'string' ? raw.modificatoIl : creato,
    completatoIl: stato === 'done' ? (raw?.completatoIl || creato) : null,
  };
}

/**
 * @param {any} raw
 * @param {{ listId: string, listName?: string }} contesto
 * @returns {FileLista}
 */
export function normalizzaFileLista(raw, contesto) {
  return {
    version: VERSIONE,
    listId: String(raw?.listId || contesto.listId),
    listName: String(raw?.listName || contesto.listName || ''),
    tasks: Array.isArray(raw?.tasks) ? raw.tasks.map(normalizzaTask) : [],
  };
}

/** @param {any} raw @returns {{ version: number, liste: ListaRegistrata[] }} */
export function normalizzaRegistro(raw) {
  /** @type {any[]} */
  const liste = Array.isArray(raw?.liste) ? raw.liste : [];
  return {
    version: VERSIONE,
    liste: liste
      .filter(l => l?.id && l?.file)
      .map(l => ({
        id: String(l.id),
        nome: String(l.nome ?? ''),
        file: String(l.file),
        ...(l.inbox ? { inbox: true } : {}),
        ...(l.creatoIl ? { creatoIl: String(l.creatoIl) } : {}),
      })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nomi dei file
// ─────────────────────────────────────────────────────────────────────────────
// Il file di una lista si chiama come la lista, così la cartella si legge
// aprendo OneDrive. Il registro resta però l'unica autorità sul legame fra id e
// file: se una rinomina non riesce a rinominare anche il file, il registro
// continua a puntare dove il file sta davvero.

/** @param {string} nome @returns {string} */
export function slug(nome) {
  const pulito = (nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // via gli accenti
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return pulito || 'lista';
}

/**
 * Un nome di file libero, dentro la cartella dei task.
 * @param {string} nome
 * @param {ListaRegistrata[]} esistenti
 * @returns {string}
 */
export function fileLibero(nome, esistenti) {
  const presi = new Set(esistenti.map(l => l.file));
  const base = slug(nome);
  let candidato = percorsoTask(`${base}.json`);
  for (let n = 2; presi.has(candidato); n++) candidato = percorsoTask(`${base}-${n}.json`);
  return candidato;
}

// ─────────────────────────────────────────────────────────────────────────────
// Il registro delle liste
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {Promise<{ version: number, liste: ListaRegistrata[] }>} */
export async function leggiRegistro() {
  return normalizzaRegistro(await getDriveJson(FILE_REGISTRO, null));
}

/**
 * @param {{ version: number, liste: ListaRegistrata[] }} registro
 * @param {{ reapply?: (fresco: any) => any }} [opts]
 * @returns {Promise<any>}
 */
export async function scriviRegistro(registro, opts) {
  return putDriveJson(FILE_REGISTRO, { ...registro, version: VERSIONE }, opts);
}

/**
 * Le liste come le vede il resto dell'app: stessa forma che aveva `getTodoLists`,
 * così il codice che ragiona per lista non deve cambiare vocabolario.
 * @returns {Promise<import('./types').TodoList[]>}
 */
export async function elencoListe() {
  const { liste } = await leggiRegistro();
  return liste.map(l => ({
    id: l.id,
    displayName: l.nome,
    ...(l.inbox ? { wellknownListName: 'defaultList' } : {}),
  }));
}

/**
 * @param {string} nome
 * @param {{ inbox?: boolean, id?: string }} [opts]
 * @returns {Promise<import('./types').TodoList>}
 */
export async function creaLista(nome, opts = {}) {
  const registro = await leggiRegistro();
  const esistente = registro.liste.find(l => l.nome === nome);
  if (esistente) return { id: esistente.id, displayName: esistente.nome };

  /** @type {ListaRegistrata} */
  const nuova = {
    id: opts.id || nuovoId(),
    nome,
    file: fileLibero(nome, registro.liste),
    ...(opts.inbox ? { inbox: true } : {}),
    creatoIl: adesso(),
  };
  await scriviFileLista({ version: VERSIONE, listId: nuova.id, listName: nome, tasks: [] }, nuova.file);
  await scriviRegistro({ ...registro, liste: [...registro.liste, nuova] }, {
    // Se nel frattempo è nata un'altra lista da un altro dispositivo, la nostra
    // si aggiunge alle sue invece di cancellarle.
    reapply: fresco => {
      const base = normalizzaRegistro(fresco);
      if (base.liste.some(l => l.id === nuova.id)) return base;
      return { ...base, liste: [...base.liste, { ...nuova, file: fileLibero(nome, base.liste) }] };
    },
  });
  return { id: nuova.id, displayName: nome, ...(opts.inbox ? { wellknownListName: 'defaultList' } : {}) };
}

/**
 * Rinominare una lista è come si sposta la scadenza di una consegna: la data
 * sta nel nome (vedi paraConfig.js). Il file resta dov'è — il registro sa dove
 * — perché rinominarlo non aggiunge niente e può fallire per conto suo.
 * @param {string} listId
 * @param {string} nome
 * @returns {Promise<import('./types').TodoList>}
 */
export async function rinominaLista(listId, nome) {
  const registro = await leggiRegistro();
  const rinomina = /** @param {ListaRegistrata[]} liste */ liste =>
    liste.map(l => (l.id === listId ? { ...l, nome } : l));
  await scriviRegistro({ ...registro, liste: rinomina(registro.liste) }, {
    reapply: fresco => {
      const base = normalizzaRegistro(fresco);
      return { ...base, liste: rinomina(base.liste) };
    },
  });

  // Anche dentro il file, dove serve solo a leggerlo da solo.
  const voce = registro.liste.find(l => l.id === listId);
  if (voce) {
    const file = await leggiFileLista(listId, voce);
    await scriviFileLista({ ...file, listName: nome }, voce.file, {
      reapply: fresco => ({ ...normalizzaFileLista(fresco, { listId }), listName: nome }),
    });
  }
  return { id: listId, displayName: nome };
}

/** @param {string} listId @returns {Promise<ListaRegistrata>} */
async function vociDiLista(listId) {
  const { liste } = await leggiRegistro();
  const voce = liste.find(l => l.id === listId);
  if (!voce) throw new Error(`Lista sconosciuta: ${listId}`);
  return voce;
}

// ─────────────────────────────────────────────────────────────────────────────
// I task di una lista
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} listId
 * @param {ListaRegistrata} [voce] se la si ha già, per non rileggere il registro
 * @returns {Promise<FileLista>}
 */
export async function leggiFileLista(listId, voce) {
  const v = voce || await vociDiLista(listId);
  const raw = await getDriveJson(v.file, null);
  return normalizzaFileLista(raw, { listId, listName: v.nome });
}

// Un file di task che si svuota per sbaglio è una consegna intera che sparisce.
// La cronologia versioni di OneDrive ci sarebbe comunque, ma è un recupero da
// fare a mano, quindi la scrittura si rifiuta di far crollare un file di colpo:
// il calo grosso deve essere dichiarato dal chiamante che sta cancellando.
const CALO_SOSPETTO = 0.5;
const CALO_MINIMO = 3;   // sotto questa soglia i cali sono normali

/**
 * @param {string} percorso
 * @param {number} prima  quanti task c'erano
 * @param {number} dopo   quanti ce ne sarebbero
 */
function controllaCalo(percorso, prima, dopo) {
  if (prima >= CALO_MINIMO && dopo < prima * CALO_SOSPETTO) {
    throw new Error(
      `Scrittura rifiutata su ${percorso}: da ${prima} task a ${dopo}. ` +
      'Se la cancellazione è voluta, dichiarala (consentiCalo).'
    );
  }
}

/**
 * @param {FileLista} file
 * @param {string} percorso
 * @param {{ reapply?: (fresco: any) => any, consentiCalo?: boolean, prima?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function scriviFileLista(file, percorso, opts = {}) {
  const daScrivere = { ...file, version: VERSIONE };
  if (!opts.consentiCalo) {
    // Quanti task c'erano: se il chiamante ha appena letto il file lo sa già, e
    // rileggerlo qui sarebbe una richiesta in più a ogni salvataggio.
    const prima = opts.prima ?? normalizzaFileLista(
      await getDriveJson(percorso, null), { listId: file.listId }
    ).tasks.length;
    controllaCalo(percorso, prima, daScrivere.tasks.length);
  }
  const { reapply } = opts;
  return putDriveJson(percorso, daScrivere, reapply ? { reapply } : undefined);
}

/**
 * I task di una lista, decorati con la lista da cui vengono — come li vuole il
 * pool globale dell'app.
 * @param {string} listId
 * @returns {Promise<Task[]>}
 */
export async function leggiTask(listId) {
  const voce = await vociDiLista(listId);
  const file = await leggiFileLista(listId, voce);
  return file.tasks.map(t => ({ ...t, _listId: listId, _listName: voce.nome }));
}

/**
 * Tutti i task di tutte le liste. Le liste si leggono in parallelo: sono una
 * ventina di file piccoli, ed è la stessa cosa che l'app fa oggi lista per lista.
 * @returns {Promise<Task[]>}
 */
export async function leggiTuttiITask() {
  const { liste } = await leggiRegistro();
  const perLista = await Promise.all(liste.map(async voce => {
    const file = await leggiFileLista(voce.id, voce);
    return file.tasks.map(t => ({ ...t, _listId: voce.id, _listName: voce.nome }));
  }));
  return perLista.flat();
}

/**
 * Cambia i task di una lista in un colpo solo. `muta` riceve i task come sono
 * adesso e restituisce quelli da scrivere; viene richiamata sul contenuto
 * fresco se nel frattempo ha scritto un altro dispositivo, così la modifica si
 * riapplica invece di cancellare la sua.
 *
 * È qui che si vede il guadagno vero della migrazione: stato, persona, stima e
 * sveglia cambiano insieme, in una scrittura sola. Su To-Do lo stato era
 * spalmato su due campi e serviva una PATCH per ciascuno — se la seconda
 * falliva, il task restava con «Delegato a: Sara» nelle note e `notStarted`
 * come stato, e compariva in Prossime azioni col nome di qualcuno dentro.
 *
 * @param {string} listId
 * @param {(tasks: Task[]) => Task[]} muta
 * @param {{ consentiCalo?: boolean }} [opts]
 * @returns {Promise<Task[]>} i task come sono stati scritti
 */
export async function cambiaTask(listId, muta, opts = {}) {
  const voce = await vociDiLista(listId);
  const file = await leggiFileLista(listId, voce);
  const aggiornati = muta(file.tasks);
  await scriviFileLista({ ...file, tasks: aggiornati }, voce.file, {
    ...opts,
    prima: file.tasks.length,
    reapply: fresco => {
      const base = normalizzaFileLista(fresco, { listId, listName: voce.nome });
      const rifatti = muta(base.tasks);
      if (!opts.consentiCalo) controllaCalo(voce.file, base.tasks.length, rifatti.length);
      return { ...base, tasks: rifatti };
    },
  });
  return aggiornati.map(t => ({ ...t, _listId: listId, _listName: voce.nome }));
}

/**
 * @param {string} listId
 * @param {Partial<Task> & { titolo: string }} dati
 * @returns {Promise<Task>}
 */
export async function creaTask(listId, dati) {
  const ora = adesso();
  const task = normalizzaTask({ stato: 'next', ...dati, id: dati.id || nuovoId(), creatoIl: ora, modificatoIl: ora });
  await cambiaTask(listId, tasks => [task, ...tasks]);
  const voce = await vociDiLista(listId);
  return { ...task, _listId: listId, _listName: voce.nome };
}

/**
 * Una modifica sola, con dentro tutto quello che cambia.
 * @param {string} listId
 * @param {string} taskId
 * @param {Partial<Task>} patch
 * @returns {Promise<Task|null>}
 */
export async function aggiornaTask(listId, taskId, patch) {
  /** @type {Task|null} */
  let scritto = null;
  await cambiaTask(listId, tasks => tasks.map(t => {
    if (t.id !== taskId) return t;
    const unito = normalizzaTask({ ...t, ...patch, id: t.id, creatoIl: t.creatoIl, modificatoIl: adesso() });
    // Il completamento porta la sua data, e toglierlo la toglie.
    if (unito.stato === 'done' && t.stato !== 'done') unito.completatoIl = unito.modificatoIl;
    scritto = unito;
    return unito;
  }));
  return scritto;
}

/**
 * @param {string} listId
 * @param {string} taskId
 * @returns {Promise<void>}
 */
export async function eliminaTask(listId, taskId) {
  // Cancellare è il caso in cui il file si accorcia sul serio: dichiarato.
  await cambiaTask(listId, tasks => tasks.filter(t => t.id !== taskId), { consentiCalo: true });
}

/**
 * Sposta un task in un'altra lista — cioè, nel modello PARA dell'app, in
 * un'altra sezione.
 *
 * Prima si scrive nella destinazione, poi si toglie dall'origine: un errore a
 * metà lascia un doppione invece di far sparire il task. La differenza con
 * prima è che il doppione è **lo stesso task**, stesso id, in due liste: si
 * riconosce e si ripulisce. Su To-Do lo spostamento ricreava il task e ne
 * nasceva uno nuovo, con un id nuovo, che il Piano non riconosceva più.
 *
 * @param {string} daListId
 * @param {string} aListId
 * @param {string} taskId
 * @returns {Promise<Task|null>}
 */
export async function spostaTask(daListId, aListId, taskId) {
  if (daListId === aListId) return null;
  const origine = await leggiFileLista(daListId);
  const task = origine.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task non trovato in ${daListId}: ${taskId}`);

  const spostato = { ...task, modificatoIl: adesso() };
  await cambiaTask(aListId, tasks =>
    tasks.some(t => t.id === taskId) ? tasks.map(t => (t.id === taskId ? spostato : t)) : [spostato, ...tasks]
  );
  await cambiaTask(daListId, tasks => tasks.filter(t => t.id !== taskId), { consentiCalo: true });

  const voce = await vociDiLista(aListId);
  return { ...spostato, _listId: aListId, _listName: voce.nome };
}
