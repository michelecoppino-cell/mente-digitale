// @ts-check
// La migrazione dei task da Microsoft To-Do ai file nostri su OneDrive.
//
// Gira una volta sola e non cancella niente: To-Do resta esattamente com'è, ed
// è la rete di sicurezza per le settimane successive. Se la si rilancia,
// riscrive gli stessi file aggiornando per id, quindi non sdoppia niente.
//
// **Gli id dei task restano quelli di To-Do.** È la trappola più facile da non
// vedere: i blocchi in `daily-plans` referenziano i task per `taskId`, e per id
// sono indicizzate anche le sveglie già suonate e la deduplica delle scadenze
// ricorrenti. Con id nuovi il Piano si scollegherebbe da tutto ciò che è già
// programmato e le sveglie già chiuse tornerebbero a suonare.
//
// Qui vive anche la lettura dei marker — [MIN:n], [SVEGLIA:hh:mm], le righe
// «In attesa da:» / «Da chiedere a:» / «Delegato a:», e il vecchio [EIS:Qn]
// della matrice di Eisenhower che non c'è più. Vivono **solo** qui: nel codice
// corrente, dopo il ribaltamento, non ne resta traccia, perché quello che
// dicevano è diventato un campo.

import { getTodoLists, getTodoTasksCompleti } from './api';
import {
  VERSIONE, leggiRegistro, scriviRegistro, scriviFileLista, fileLibero, normalizzaTask,
} from './taskStore';

// ─────────────────────────────────────────────────────────────────────────────
// I marker, letti per l'ultima volta
// ─────────────────────────────────────────────────────────────────────────────

const MIN_MARKER_RE = /\[MIN:(\d{1,4})\]/;
const ALARM_MARKER_RE = /\[SVEGLIA:([01]\d|2[0-3]):([0-5]\d)\]/;
const EIS_MARKER_RE = /\[EIS:Q[1-4]\]/;

/** Marker della deduplica delle scadenze ricorrenti (vedi deadlineReminders.js). */
const REMINDER_SRC_RE = /reminder-src:\S+/;

const RIGHE_PERSONA = [
  { stato: 'ask',       re: /^\s*Da chiedere a:\s*(.+?)\s*$/im },
  { stato: 'waiting',   re: /^\s*In attesa da:\s*(.+?)\s*$/im },
  { stato: 'delegated', re: /^\s*Delegato a:\s*(.+?)\s*$/im },
];

/** @param {string} body @returns {{ stato: string, chi: string }|null} */
function personaDaNote(body) {
  for (const { stato, re } of RIGHE_PERSONA) {
    const m = body.match(re);
    if (m) return { stato, chi: m[1] };
  }
  return null;
}

/** Il testo della nota una volta tolti tutti i marker. @param {string} body */
function notaPulita(body) {
  let testo = body
    .replace(EIS_MARKER_RE, '')
    .replace(MIN_MARKER_RE, '')
    .replace(ALARM_MARKER_RE, '')
    .replace(REMINDER_SRC_RE, '');
  for (const { re } of RIGHE_PERSONA) testo = testo.replace(re, '');
  return testo.replace(/^[ \t\n]+/, '').trimEnd();
}

const CONTESTI = { lavoro: 'lavoro', personale: 'personale', famiglia: 'famiglia' };

// ─────────────────────────────────────────────────────────────────────────────
// Conversione di un task
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un task di To-Do come diventa nei file nostri. Ogni cosa che stava in un
 * campo piegato ad altro uso trova un campo suo.
 *
 * `scheduled` non compare: non è uno stato scritto, resta derivato dalla
 * presenza di un blocco in `daily-plans`, come prima.
 *
 * @param {import('./types').TodoTask} task
 * @param {{ inbox?: boolean }} [ctx]
 * @returns {import('./taskStore').Task}
 */
export function daTodo(task, ctx = {}) {
  const body = task?.body?.content || '';
  const persona = personaDaNote(body);

  let stato = 'next';
  if (task.status === 'completed') stato = 'done';
  else if (task.status === 'waitingOnOthers') stato = persona?.stato === 'delegated' ? 'delegated' : 'waiting';
  else if (task.status === 'deferred') stato = 'someday';
  else if (ctx.inbox) stato = 'inbox';
  else if (persona?.stato === 'ask') stato = 'ask';

  const stima = body.match(MIN_MARKER_RE);
  const sveglia = body.match(ALARM_MARKER_RE);
  const origine = body.match(REMINDER_SRC_RE);
  const categorie = (task.categories || []).map(c => String(c).toLowerCase());

  return normalizzaTask({
    id: task.id,
    titolo: task.title || '',
    stato,
    // La persona è una sola, e il suo ruolo è già lo stato: qui resta il nome.
    persona: persona?.chi || null,
    contesto: Object.keys(CONTESTI).find(k => categorie.includes(k)) || null,
    stimaMin: stima ? parseInt(stima[1], 10) : null,
    sveglia: sveglia ? `${sveglia[1]}:${sveglia[2]}` : null,
    scadenza: (task.dueDateTime?.dateTime || '').slice(0, 10) || null,
    nota: notaPulita(body),
    // Il marker della deduplica delle scadenze ricorrenti non è una nota: è il
    // segno di quale occorrenza di quale evento ha generato il task. Diventa un
    // campo, o alla prima scansione la scadenza si ricreerebbe da capo.
    origineScadenza: origine ? origine[0] : null,
    sottoattivita: (task.checklistItems || []).map(i => ({
      id: i.id, titolo: i.displayName, fatta: !!i.isChecked,
    })),
    creatoIl: task.createdDateTime || null,
    modificatoIl: task.lastModifiedDateTime || task.createdDateTime || null,
    completatoIl: task.completedDateTime || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// La passata
// ─────────────────────────────────────────────────────────────────────────────

/** Da quanto indietro si portano dietro i task già spuntati. */
const GIORNI_COMPLETATI = 180;

/**
 * Legge tutte le liste di To-Do e i loro task e li scrive nei file. To-Do non
 * viene toccato: nessuna cancellazione, nessuna modifica.
 *
 * I completati si prendono solo dell'ultimo semestre: servono a due cose — la
 * colonna «Fatte» e la deduplica delle scadenze — e nessuna delle due guarda
 * più indietro. Un archivio di anni di spuntati peserebbe su ogni lettura.
 *
 * @param {{ giorniCompletati?: number, onAvanzamento?: (nome: string, quanti: number) => void }} [opts]
 * @returns {Promise<{ liste: number, task: number, completatiSaltati: number }>}
 */
export async function migraTaskDaTodo(opts = {}) {
  const giorni = opts.giorniCompletati ?? GIORNI_COMPLETATI;
  const limite = new Date(Date.now() - giorni * 86_400_000).toISOString();

  const listeTodo = await getTodoLists();
  const registro = await leggiRegistro();
  /** @type {import('./taskStore').ListaRegistrata[]} */
  const voci = [...registro.liste];
  let task = 0;
  let completatiSaltati = 0;

  for (const lista of listeTodo) {
    let voce = voci.find(l => l.id === lista.id);
    if (!voce) {
      voce = {
        id: lista.id,
        nome: lista.displayName,
        file: fileLibero(lista.displayName, voci),
        ...(lista.wellknownListName === 'defaultList' ? { inbox: true } : {}),
        creatoIl: new Date().toISOString(),
      };
      voci.push(voce);
    } else {
      voce.nome = lista.displayName;
    }

    const grezzi = await getTodoTasksCompleti(lista.id);
    const tenuti = grezzi.filter(t => {
      if (t.status !== 'completed') return true;
      const quando = t.completedDateTime || t.lastModifiedDateTime || '';
      if (quando >= limite) return true;
      completatiSaltati++;
      return false;
    });

    const convertiti = tenuti.map(t => daTodo(t, { inbox: !!voce.inbox }));
    // La scrittura non passa dal controllo di calo: qui il file di partenza è
    // vuoto o è la fotografia precedente della stessa lista, e un numero di
    // task minore è l'esito normale di una rilettura, non un incidente.
    await scriviFileLista(
      { version: VERSIONE, listId: lista.id, listName: lista.displayName, tasks: convertiti },
      voce.file,
      { consentiCalo: true },
    );
    task += convertiti.length;
    opts.onAvanzamento?.(lista.displayName, convertiti.length);
  }

  await scriviRegistro({ version: VERSIONE, liste: voci });
  return { liste: listeTodo.length, task, completatiSaltati };
}
