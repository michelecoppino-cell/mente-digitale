// @ts-check
// Il Programma di commessa: le ore vendute, i pacchetti in cui si dividono, le
// persone che le fanno e le settimane in cui succede.
//
// Sta **sopra** le attività e non è un secondo tipo di attività. Una commessa
// da un anno ha duecento cose da fare di cui centottanta cominciano fra mesi:
// metterle nel pool vorrebbe dire spegnere lo strumento con cui si decide cosa
// fare oggi. Qui invece stanno ferme, e ne esce un'attività vera solo il
// giorno in cui la si assegna a qualcuno — **la voce non diventa il task, lo
// genera**, e da lì in poi si limita a raccontare cosa gli sta succedendo.
//
// Il ragionamento per esteso è in `docs/proposta-programma-commessa.md`.
//
// La disposizione dei file segue quella delle attività, per gli stessi motivi:
//
//   programmi/_registro.json    l'elenco: id, nome, file, se è acceso
//   programmi/<slug>.json       una commessa intera
//
// **Un documento per commessa.** È l'unità che si apre, si legge e si salva
// tutta insieme: la matrice di una commessa da un anno con sei risorse sta in
// qualche decina di kB, e spezzarla per settimane vorrebbe dire inventare una
// concorrenza fra pezzi che si guardano sempre insieme.
//
// **Il legame con le attività va in una direzione sola**: la voce cita il task
// per id, il task non sa niente del programma. Regge perché gli id delle
// attività non si rigenerano mai, nemmeno spostandole di lista.

import { settimanaIso, settimaneTra, meseDellaSettimana, spostaSettimane, lunediDellaSettimana } from './tempo.js';
import { buildListName } from './paraConfig.js';
/** La cartella dei programmi, dentro quella dell'app. */
const CARTELLA = 'programmi';

/** La versione dello schema che questo codice scrive. */
export const VERSIONE = 1;

/** Il registro dei programmi. */
export const FILE_REGISTRO = `${CARTELLA}/_registro.json`;

/** La capacità di una persona quando nessuno l'ha detta: 35 ore a settimana. */
export const ORE_SETTIMANA_DEFAULT = 35;

/**
 * @typedef {object} ProgrammaRegistrato
 * @property {string} id
 * @property {string} nome
 * @property {string} file    percorso relativo alla cartella dell'app
 * @property {boolean} attivo se compare nella colonna di sinistra
 * @property {string} [creatoIl]
 */

/**
 * @typedef {object} Commessa
 * @property {string} nome
 * @property {string} codice
 * @property {number} oreVendute      il numero contrattuale: è il metro di tutto
 * @property {string|null} inizio     'YYYY-MM-DD'
 * @property {string|null} fine
 * @property {string|null} settimaneDa  scavalco manuale dell'orizzonte, 'YYYY-Www'
 * @property {string|null} settimaneA
 */

/**
 * Una risorsa non è un'anagrafica nuova: `nome` è **la stessa stringa** del
 * campo `persona` di un'attività, così un task delegato e una riga della
 * matrice parlano della stessa persona senza tabelle di conversione.
 *
 * @typedef {object} Risorsa
 * @property {string} nome
 * @property {number} oreSettimana   la capacità: senza, la matrice dice quante
 *   ore hai messo ma mai se sono troppe
 */

/**
 * Un pacchetto è un sotto-progetto. `listId` **nasce vuoto** e resta vuoto
 * finché non si attiva la prima voce: una commessa con quindici pacchetti non
 * deve creare quindici liste vuote nella vista Attività, che è esattamente il
 * rumore che il Programma esiste per evitare.
 *
 * @typedef {object} Pacchetto
 * @property {string} id
 * @property {string} nome
 * @property {string|null} listId
 * @property {string|null} colore
 */

/**
 * Una voce di programma. **Lo stato è derivato, non un campo** — vedi
 * `statoVoce()` in `programma/calcoli.js`: `scartata` è l'unica cosa scritta,
 * il resto si legge da `taskId` e dal task che quell'id nomina.
 *
 * @typedef {object} Voce
 * @property {string} id
 * @property {string} titolo
 * @property {string} nota
 * @property {string|null} pacchettoId
 * @property {string|null} padreId          la scomposizione: una voce dentro un'altra
 * @property {number} ore                   la stima corrente
 * @property {number} oreIniziali           quella del primo giorno: non si riscrive mai
 * @property {string|null} risorsa          a chi la daresti: una previsione, non un impegno
 * @property {{ da: string, a: string }|null} finestra  settimane, grossolane
 * @property {boolean} scartata
 * @property {string|null} taskId           il legame, dopo l'attivazione
 * @property {string|null} listId
 * @property {string} creatoIl
 * @property {string|null} attivataIl
 */

/**
 * @typedef {object} DocProgramma
 * @property {number} version
 * @property {string} id
 * @property {Commessa} commessa
 * @property {Risorsa[]} risorse
 * @property {Pacchetto[]} pacchetti
 * @property {Voce[]} voci
 * @property {Record<string, number>} carico  '<risorsa>|<pacchettoId>|<YYYY-Www>' → ore
 */

/** @returns {string} */
const adesso = () => new Date().toISOString();

/** Un id nuovo. @returns {string} */
export function nuovoId() {
  return globalThis.crypto?.randomUUID?.() ?? `pg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {any} v @param {number} seNo @returns {number} */
function numero(v, seNo = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : seNo;
}

/** @param {any} v @returns {string|null} */
const testoONull = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ─────────────────────────────────────────────────────────────────────────────
// La chiave del carico
// ─────────────────────────────────────────────────────────────────────────────
// Una mappa piatta e sparsa, non una matrice densa: una commessa da un anno con
// sei risorse e dieci pacchetti ha tremila celle possibili e forse duecento
// piene, e salvare la matrice intera vorrebbe dire scrivere zeri su OneDrive
// per un anno.

/**
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string} settimana 'YYYY-Www'
 * @returns {string}
 */
export function chiaveCarico(risorsa, pacchettoId, settimana) {
  return `${risorsa}|${pacchettoId}|${settimana}`;
}

/** @param {string} chiave @returns {{ risorsa: string, pacchettoId: string, settimana: string }} */
export function leggiChiaveCarico(chiave) {
  const [risorsa, pacchettoId, settimana] = chiave.split('|');
  return { risorsa, pacchettoId, settimana };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizzazione
// ─────────────────────────────────────────────────────────────────────────────
// Come per le attività: ogni file porta un `version` dal primo giorno, la
// lettura porta qualunque forma trovata a quella corrente, la scrittura scrive
// sempre nella corrente.

/** @param {any} raw @returns {Pacchetto} */
function normalizzaPacchetto(raw) {
  return {
    id: String(raw?.id || nuovoId()),
    nome: String(raw?.nome ?? ''),
    listId: testoONull(raw?.listId),
    colore: testoONull(raw?.colore),
  };
}

/** @param {any} raw @returns {Risorsa} */
function normalizzaRisorsa(raw) {
  const nome = typeof raw === 'string' ? raw : String(raw?.nome ?? '');
  return {
    nome: nome.trim(),
    oreSettimana: Math.max(0, numero(raw?.oreSettimana, ORE_SETTIMANA_DEFAULT)),
  };
}

/** @param {any} raw @returns {Voce} */
export function normalizzaVoce(raw) {
  const ore = Math.max(0, numero(raw?.ore, 0));
  const finestra = raw?.finestra?.da && raw?.finestra?.a
    ? { da: String(raw.finestra.da), a: String(raw.finestra.a) }
    : null;
  return {
    id: String(raw?.id || nuovoId()),
    titolo: String(raw?.titolo ?? ''),
    nota: String(raw?.nota ?? ''),
    pacchettoId: testoONull(raw?.pacchettoId),
    padreId: testoONull(raw?.padreId),
    ore,
    // La stima del primo giorno vale quella corrente solo la prima volta: da lì
    // in poi resta ferma, perché la differenza fra le due è la baseline.
    oreIniziali: Math.max(0, numero(raw?.oreIniziali, ore)),
    risorsa: testoONull(raw?.risorsa),
    finestra,
    scartata: !!raw?.scartata,
    taskId: testoONull(raw?.taskId),
    listId: testoONull(raw?.listId),
    creatoIl: typeof raw?.creatoIl === 'string' ? raw.creatoIl : adesso(),
    attivataIl: testoONull(raw?.attivataIl),
  };
}

/**
 * @param {any} raw
 * @param {{ id?: string }} [contesto]
 * @returns {DocProgramma}
 */
export function normalizzaProgramma(raw, contesto = {}) {
  const c = raw?.commessa || {};
  const carico = /** @type {Record<string, number>} */ ({});
  for (const [k, v] of Object.entries(raw?.carico || {})) {
    const ore = numero(v, 0);
    // Le celle a zero non si tengono: una cella svuotata deve sparire dal file,
    // non restare a occupare posto con dentro niente.
    if (ore > 0 && k.split('|').length === 3) carico[k] = ore;
  }
  return {
    version: VERSIONE,
    id: String(raw?.id || contesto.id || nuovoId()),
    commessa: {
      nome: String(c.nome ?? ''),
      codice: String(c.codice ?? ''),
      oreVendute: Math.max(0, numero(c.oreVendute, 0)),
      inizio: testoONull(c.inizio),
      fine: testoONull(c.fine),
      settimaneDa: testoONull(c.settimaneDa),
      settimaneA: testoONull(c.settimaneA),
    },
    risorse: (Array.isArray(raw?.risorse) ? raw.risorse : []).map(normalizzaRisorsa).filter((/** @type {Risorsa} */ r) => r.nome),
    pacchetti: (Array.isArray(raw?.pacchetti) ? raw.pacchetti : []).map(normalizzaPacchetto),
    voci: (Array.isArray(raw?.voci) ? raw.voci : []).map(normalizzaVoce),
    carico,
  };
}

/** @param {any} raw @returns {{ version: number, programmi: ProgrammaRegistrato[] }} */
export function normalizzaRegistro(raw) {
  const programmi = (Array.isArray(raw?.programmi) ? raw.programmi : []).map((/** @type {any} */ p) => ({
    id: String(p?.id || nuovoId()),
    nome: String(p?.nome ?? ''),
    file: String(p?.file || ''),
    // Un programma senza il flag è acceso: chi arriva da un file scritto prima
    // che il flag esistesse non deve trovare la colonna di sinistra vuota.
    attivo: p?.attivo !== false,
    ...(p?.creatoIl ? { creatoIl: String(p.creatoIl) } : {}),
  })).filter((/** @type {ProgrammaRegistrato} */ p) => p.file);
  return { version: VERSIONE, programmi };
}

/** Il nome del file di una commessa, a partire dal suo nome. @param {string} nome */
export function slug(nome) {
  const base = String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // via gli accenti
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'programma';
}

/** @param {string} nome @param {ProgrammaRegistrato[]} esistenti @returns {string} */
export function fileLibero(nome, esistenti) {
  const presi = new Set(esistenti.map(p => p.file));
  const base = slug(nome);
  let candidato = `${CARTELLA}/${base}.json`;
  for (let i = 2; presi.has(candidato); i++) candidato = `${CARTELLA}/${base}-${i}.json`;
  return candidato;
}
// ─────────────────────────────────────────────────────────────────────────────
// Le mutazioni
// ─────────────────────────────────────────────────────────────────────────────
// Funzioni pure sul documento, tutte con la stessa forma: si provano senza
// rete, e sono le stesse che `cambiaProgramma` riapplica sul contenuto fresco
// quando c'è un conflitto.

/** @param {DocProgramma} doc @param {Partial<Commessa>} patch @returns {DocProgramma} */
export function conCommessa(doc, patch) {
  return { ...doc, commessa: { ...doc.commessa, ...patch } };
}

/** @param {DocProgramma} doc @param {{ nome: string, colore?: string|null }} dati @returns {DocProgramma} */
export function conPacchetto(doc, dati) {
  const nuovo = normalizzaPacchetto({ id: nuovoId(), ...dati });
  return { ...doc, pacchetti: [...doc.pacchetti, nuovo] };
}

/** @param {DocProgramma} doc @param {string} pacchettoId @param {Partial<Pacchetto>} patch @returns {DocProgramma} */
export function conPacchettoAggiornato(doc, pacchettoId, patch) {
  return {
    ...doc,
    pacchetti: doc.pacchetti.map(p => (p.id === pacchettoId ? normalizzaPacchetto({ ...p, ...patch, id: p.id }) : p)),
  };
}

/** @param {DocProgramma} doc @param {string} nome @param {number} [oreSettimana] @returns {DocProgramma} */
export function conRisorsa(doc, nome, oreSettimana = ORE_SETTIMANA_DEFAULT) {
  const pulito = String(nome || '').trim();
  if (!pulito || doc.risorse.some(r => r.nome === pulito)) return doc;
  return { ...doc, risorse: [...doc.risorse, { nome: pulito, oreSettimana }] };
}

/** @param {DocProgramma} doc @param {string} nome @param {Partial<Risorsa>} patch @returns {DocProgramma} */
export function conRisorsaAggiornata(doc, nome, patch) {
  return { ...doc, risorse: doc.risorse.map(r => (r.nome === nome ? normalizzaRisorsa({ ...r, ...patch }) : r)) };
}

/**
 * Voci nuove, in fondo. Le ore delle voci contenitore si ricalcolano subito:
 * quando una voce ha figlie, `ore` è la loro somma e non un numero scritto a
 * mano che smette di tornare.
 * @param {DocProgramma} doc
 * @param {Partial<Voce>[]} nuove
 * @returns {DocProgramma}
 */
export function conVoci(doc, nuove) {
  const aggiunte = nuove.map(v => normalizzaVoce({ id: nuovoId(), creatoIl: adesso(), ...v }));
  return risommaContenitori({ ...doc, voci: [...doc.voci, ...aggiunte] });
}

/** @param {DocProgramma} doc @param {string} voceId @param {Partial<Voce>} patch @returns {DocProgramma} */
export function conVoceAggiornata(doc, voceId, patch) {
  return risommaContenitori({
    ...doc,
    voci: doc.voci.map(v => (v.id === voceId
      // `id`, `creatoIl` e `oreIniziali` non si riscrivono da una patch: la
      // baseline è utile solo finché resta quella del primo giorno.
      ? normalizzaVoce({ ...v, ...patch, id: v.id, creatoIl: v.creatoIl, oreIniziali: v.oreIniziali })
      : v)),
  });
}

/**
 * Toglie una voce e tutta la sua discendenza.
 *
 * Solo una voce **prevista** si cancella davvero: quella che ha già generato
 * un'attività si scarta (`scartata`), perché il task esiste per conto suo e la
 * voce è l'unica cosa che sa da dove è venuto.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @returns {DocProgramma}
 */
export function senzaVoce(doc, voceId) {
  const daTogliere = new Set([voceId]);
  // Più giri: una figlia di una figlia deve andarsene con la nonna.
  for (let i = 0; i < 8; i++) {
    const prima = daTogliere.size;
    for (const v of doc.voci) if (v.padreId && daTogliere.has(v.padreId)) daTogliere.add(v.id);
    if (daTogliere.size === prima) break;
  }
  return risommaContenitori({ ...doc, voci: doc.voci.filter(v => !daTogliere.has(v.id)) });
}

/**
 * Le ore di una cella. Zero — o una cella svuotata — toglie la chiave invece di
 * scriverci dentro uno zero.
 * @param {DocProgramma} doc
 * @param {string} chiave
 * @param {number} ore
 * @returns {DocProgramma}
 */
export function conCarico(doc, chiave, ore) {
  const carico = { ...doc.carico };
  const valore = Math.max(0, numero(ore, 0));
  if (valore > 0) carico[chiave] = valore;
  else delete carico[chiave];
  return { ...doc, carico };
}

/**
 * Le ore di una voce contenitore sono la somma delle figlie.
 *
 * Si ricalcola a ogni modifica invece di fidarsi del numero scritto: una
 * somma tenuta in pari a mano è la classe di difetti da cui nascono le
 * schermate che mostrano il totale di prima.
 * @param {DocProgramma} doc
 * @returns {DocProgramma}
 */
export function risommaContenitori(doc) {
  /** @type {Map<string, number>} */
  const sommeFiglie = new Map();
  const conFiglie = new Set(doc.voci.filter(v => v.padreId).map(v => /** @type {string} */ (v.padreId)));
  if (conFiglie.size === 0) return doc;

  // Dal basso verso l'alto: una figlia che è a sua volta contenitore deve
  // essere già sommata quando si somma sua madre. Bastano pochi giri, la
  // scomposizione non è mai profonda.
  const ore = new Map(doc.voci.map(v => [v.id, v.ore]));
  for (let giro = 0; giro < 8; giro++) {
    sommeFiglie.clear();
    for (const v of doc.voci) {
      if (!v.padreId) continue;
      sommeFiglie.set(v.padreId, (sommeFiglie.get(v.padreId) || 0) + (ore.get(v.id) || 0));
    }
    let cambiato = false;
    for (const [id, somma] of sommeFiglie) {
      if (ore.get(id) !== somma) { ore.set(id, somma); cambiato = true; }
    }
    if (!cambiato) break;
  }
  return { ...doc, voci: doc.voci.map(v => (conFiglie.has(v.id) ? { ...v, ore: ore.get(v.id) || 0 } : v)) };
}

/**
 * L'attivazione: la voce ricorda il task che ha generato.
 *
 * Il task lo crea chi ha in mano `taskStore` — qui si scrive solo il legame,
 * che è l'unica cosa che il Programma sappia di quella attività.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @param {{ taskId: string, listId: string, risorsa?: string|null }} legame
 * @returns {DocProgramma}
 */
export function conVoceAttivata(doc, voceId, legame) {
  return conVoceAggiornata(doc, voceId, {
    taskId: legame.taskId,
    listId: legame.listId,
    ...(legame.risorsa !== undefined ? { risorsa: legame.risorsa } : {}),
    attivataIl: adesso(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// L'incolla in massa
// ─────────────────────────────────────────────────────────────────────────────
// Senza, il caricamento iniziale ferma tutto alla seconda commessa: duecento
// voci scritte una alla volta non le scrive nessuno. È la funzione che decide
// se lo strumento verrà usato davvero, quindi sta nel modello e non nella
// vista — e si prova.

/**
 * Righe `pacchetto | titolo | ore | risorsa` (tabulazioni o barre verticali)
 * in voci pronte. I pacchetti nominati e non ancora esistenti vengono creati.
 *
 * @param {DocProgramma} doc
 * @param {string} testo
 * @param {{ pacchettoId?: string|null }} [opts] il pacchetto per le righe che non lo dicono
 * @returns {{ doc: DocProgramma, aggiunte: number, pacchettiNuovi: string[], scartate: string[] }}
 */
export function conVociIncollate(doc, testo, opts = {}) {
  let risultato = doc;
  /** @type {Partial<Voce>[]} */
  const voci = [];
  /** @type {string[]} */
  const pacchettiNuovi = [];
  /** @type {string[]} */
  const scartate = [];

  for (const riga of String(testo || '').split(/\r?\n/)) {
    if (!riga.trim()) continue;
    const campi = riga.split(/\t|\|/).map(c => c.trim());
    // Una colonna sola è il caso più comune di tutti: un elenco di titoli
    // copiato da una mail. Non deve essere un errore.
    const [primo, secondo, terzo, quarto] = campi;
    const unaColonna = campi.filter(c => c).length === 1;
    const nomePacchetto = unaColonna ? '' : primo;
    const titolo = unaColonna ? primo : secondo;
    if (!titolo) { scartate.push(riga); continue; }

    let pacchettoId = opts.pacchettoId || null;
    if (nomePacchetto) {
      const esistente = risultato.pacchetti.find(p => p.nome.toLowerCase() === nomePacchetto.toLowerCase());
      if (esistente) {
        pacchettoId = esistente.id;
      } else {
        risultato = conPacchetto(risultato, { nome: nomePacchetto });
        pacchettoId = risultato.pacchetti[risultato.pacchetti.length - 1].id;
        pacchettiNuovi.push(nomePacchetto);
      }
    }

    // «120», «120h», «120,5»: le ore si scrivono come vengono in mente.
    const ore = Math.max(0, numero(String(terzo ?? '').replace(',', '.').replace(/[^\d.]/g, ''), 0));
    const risorsa = testoONull(quarto);
    if (risorsa) risultato = conRisorsa(risultato, risorsa);
    voci.push({ titolo, ore, oreIniziali: ore, pacchettoId, risorsa });
  }

  return { doc: conVoci(risultato, voci), aggiunte: voci.length, pacchettiNuovi, scartate };
}

// ─────────────────────────────────────────────────────────────────────────────
// I conti
// ─────────────────────────────────────────────────────────────────────────────
// Tutti derivati, nessuno salvato — e tutti qui, perché sono la specifica del
// pannello: le prove girano su queste funzioni e non sulla vista.

/**
 * Lo stato di una voce, **derivato**: l'unica cosa scritta nel file è
 * `scartata`. Esattamente come `scheduled` e `inbox` per un'attività, la
 * colonna in cui una voce appare non è un'etichetta salvata a parte.
 *
 * @param {Voce} voce
 * @param {Set<string>} attivitaAperte  gli id delle attività ancora aperte (il pool)
 * @param {boolean} [poolPronto]  false finché il pool non è arrivato: senza di
 *   lui un task aperto e uno completato sono indistinguibili, e dichiarare
 *   «fatta» una voce che sta ancora andando è una bugia che poi si corregge da
 *   sola sotto gli occhi di chi guarda
 * @returns {'prevista'|'attiva'|'fatta'|'scartata'}
 */
export function statoVoce(voce, attivitaAperte, poolPronto = true) {
  if (voce.scartata) return 'scartata';
  if (!voce.taskId) return 'prevista';
  if (!poolPronto) return 'attiva';
  return attivitaAperte.has(voce.taskId) ? 'attiva' : 'fatta';
}

/** Le etichette dei quattro stati derivati. */
export const ETICHETTE_STATO = {
  prevista: 'prevista',
  attiva: 'attiva',
  fatta: 'fatta',
  scartata: 'scartata',
};

/** @param {DocProgramma} doc @param {string} voceId @returns {Voce[]} */
export function figlieDi(doc, voceId) {
  return doc.voci.filter(v => v.padreId === voceId);
}

/**
 * Una voce senza figlie. **Attivabile è solo una foglia**: una voce con figlie
 * è un contenitore, e generare un'attività da 360 ore vorrebbe dire mettere nel
 * pool una cosa che non si può fare.
 * @param {DocProgramma} doc @param {string} voceId
 */
export function eFoglia(doc, voceId) {
  return !doc.voci.some(v => v.padreId === voceId);
}

/** Le voci di primo livello, nell'ordine in cui stanno nel file. @param {DocProgramma} doc */
export function vociRadice(doc) {
  const ids = new Set(doc.voci.map(v => v.id));
  // Una voce la cui madre non c'è più è una radice: meglio in cima che persa
  // dentro un ramo che non esiste.
  return doc.voci.filter(v => !v.padreId || !ids.has(v.padreId));
}

/**
 * Le voci in ordine di albero — la madre, poi le sue figlie — con la
 * profondità, che è il rientro con cui l'elenco le mostra.
 * @param {DocProgramma} doc
 * @param {(v: Voce) => boolean} [tieni]
 * @returns {{ voce: Voce, livello: number }[]}
 */
export function alberoVoci(doc, tieni) {
  /** @type {{ voce: Voce, livello: number }[]} */
  const fila = [];
  /** @param {Voce} v @param {number} livello */
  const scendi = (v, livello) => {
    fila.push({ voce: v, livello });
    if (livello < 6) for (const f of figlieDi(doc, v.id)) scendi(f, livello + 1);
  };
  for (const r of vociRadice(doc)) scendi(r, 0);
  // Il filtro si applica dopo aver costruito l'albero: una figlia che passa il
  // filtro resta visibile anche se sua madre non lo passa, ed è quello che
  // serve quando si filtra per risorsa o per stato.
  return tieni ? fila.filter(({ voce }) => tieni(voce)) : fila;
}

/**
 * Le ore di un insieme di voci, contando **solo le foglie**: le ore di un
 * contenitore sono già la somma delle sue figlie, e sommarle tutte e due
 * conterebbe lo stesso lavoro due volte.
 * @param {DocProgramma} doc
 * @param {(v: Voce) => boolean} [tieni]
 * @returns {number}
 */
export function oreVoci(doc, tieni) {
  let somma = 0;
  for (const v of doc.voci) {
    if (v.scartata || !eFoglia(doc, v.id)) continue;
    if (tieni && !tieni(v)) continue;
    somma += v.ore;
  }
  return somma;
}

/**
 * Le ore a piano — le celle del carico — filtrabili per pacchetto, risorsa e
 * finestra di settimane.
 * @param {DocProgramma} doc
 * @param {{ pacchettoId?: string|null, risorsa?: string|null, da?: string|null, a?: string|null }} [filtro]
 * @returns {number}
 */
export function oreCarico(doc, filtro = {}) {
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const [risorsa, pacchettoId, settimana] = chiave.split('|');
    if (filtro.pacchettoId && pacchettoId !== filtro.pacchettoId) continue;
    if (filtro.risorsa && risorsa !== filtro.risorsa) continue;
    if (filtro.da && settimana < filtro.da) continue;
    if (filtro.a && settimana > filtro.a) continue;
    somma += ore;
  }
  return somma;
}

/**
 * I cinque numeri della testata.
 *
 * **Ore a finire senza timesheet**: la colonna della settimana corrente taglia
 * la matrice in due. A sinistra c'è il passato, e quelle celle si correggono con
 * quanto è andato davvero quando ci si passa sopra; a destra c'è la previsione.
 * Un dato solo, nessun secondo inserimento — è la stessa approssimazione che si
 * fa a mente guardando un Excel, ed è abbastanza per decidere.
 *
 * `stimate` e `aPiano` non devono coincidere e non si derivano l'una
 * dall'altra: la voce dice *cosa c'è da fare e quanto pesa*, la cella dice
 * *quante ore di quella persona vanno lì quella settimana*. Quello che serve è
 * il loro delta, sempre a schermo.
 *
 * @param {DocProgramma} doc
 * @param {{ pacchettoId?: string|null, settimanaOra?: string }} [opts]
 */
export function totali(doc, opts = {}) {
  const pacchettoId = opts.pacchettoId || null;
  const ora = opts.settimanaOra || settimanaIso();
  const tieni = pacchettoId ? (/** @type {Voce} */ v) => v.pacchettoId === pacchettoId : undefined;

  const stimate = oreVoci(doc, tieni);
  const speso = oreCarico(doc, { pacchettoId, a: spostaSettimane(ora, -1) });
  const aFinire = oreCarico(doc, { pacchettoId, da: ora });
  const aPiano = speso + aFinire;
  // Il metro è il numero contrattuale. Per un pacchetto non esiste un venduto
  // suo: lì il metro sono le sue voci, ed è il delta con le celle a contare.
  const vendute = pacchettoId ? stimate : doc.commessa.oreVendute;

  return {
    vendute,
    stimate,
    speso,
    aFinire,
    aPiano,
    margine: vendute - aPiano,
    daCollocare: stimate - aPiano,
  };
}

/**
 * Le colonne della matrice: da `inizio` a `fine` della commessa, salvo lo
 * scavalco manuale. Senza date, le sedici settimane attorno a oggi — una
 * matrice vuota e infinita non dice niente, una da quattro mesi sì.
 * @param {DocProgramma} doc
 * @param {string} [settimanaOra]
 * @returns {string[]}
 */
export function settimaneDellaMatrice(doc, settimanaOra) {
  const ora = settimanaOra || settimanaIso();
  const { inizio, fine, settimaneDa, settimaneA } = doc.commessa;
  const da = settimaneDa || (inizio ? settimanaIso(inizio) : null);
  const a = settimaneA || (fine ? settimanaIso(fine) : null);
  if (da && a && da <= a) return settimaneTra(da, a);
  return settimaneTra(spostaSettimane(ora, -4), spostaSettimane(ora, 12));
}

/**
 * Le settimane raggruppate per mese: è la fascia in cima alla matrice, e con
 * venticinque colonne è l'unico modo di sapere dove si è senza contarle.
 * @param {string[]} settimane
 * @returns {{ mese: string, settimane: string[] }[]}
 */
export function perMese(settimane) {
  /** @type {{ mese: string, settimane: string[] }[]} */
  const gruppi = [];
  for (const s of settimane) {
    const mese = meseDellaSettimana(s);
    const ultimo = gruppi[gruppi.length - 1];
    if (ultimo && ultimo.mese === mese) ultimo.settimane.push(s);
    else gruppi.push({ mese, settimane: [s] });
  }
  return gruppi;
}

/**
 * Come sta messa una persona in una settimana. Tre stati e non un numero: la
 * cella si colora, e un gradiente continuo su venticinque colonne non si legge.
 *
 * **La saturazione guarda il solo programma aperto.** Una persona è satura o no
 * nella sua settimana, non dentro una commessa — quindi il numero giusto
 * sarebbe la somma su tutti i programmi accesi. È l'approssimazione dichiarata
 * della prima versione, ed è scritta qui perché è la prima cosa da togliere: il
 * conto va fatto su un elenco di documenti, non su uno solo.
 *
 * @param {number} ore
 * @param {number} capacita
 * @returns {'vuota'|'sotto'|'soglia'|'sopra'}
 */
export function livelloSaturazione(ore, capacita) {
  if (!ore) return 'vuota';
  const tetto = capacita > 0 ? capacita : ORE_SETTIMANA_DEFAULT;
  if (ore > tetto) return 'sopra';
  if (ore >= tetto * 0.9) return 'soglia';
  return 'sotto';
}

/**
 * Le ore di una cella: risorsa, pacchetto, settimana. Un solo posto in cui la
 * chiave si compone, così la vista non la scrive a mano.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string} settimana
 * @returns {number}
 */
export function oreCella(doc, risorsa, pacchettoId, settimana) {
  return doc.carico[chiaveCarico(risorsa, pacchettoId, settimana)] || 0;
}

/**
 * Il totale di una persona in una settimana, dentro questa commessa: è quello
 * che si legge sulla riga chiusa, ed è il numero su cui si colora la cella.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} settimana
 * @returns {number}
 */
export function oreRisorsaSettimana(doc, risorsa, settimana) {
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const [r, , s] = chiave.split('|');
    if (r === risorsa && s === settimana) somma += ore;
  }
  return somma;
}

/**
 * I pacchetti in cui una persona ha ore: le sotto-righe che si aprono sotto la
 * sua. Solo quelli, più quello scelto in testata se c'è — aprire una persona su
 * quindici righe vuote sarebbe aprirla su niente.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @returns {Pacchetto[]}
 */
export function pacchettiDiRisorsa(doc, risorsa) {
  const con = new Set(Object.keys(doc.carico)
    .map(k => k.split('|'))
    .filter(([r]) => r === risorsa)
    .map(([, p]) => p));
  // Anche i pacchetti in cui la persona è solo *proposta* su una voce: è lì che
  // si va a scrivere la prima ora, e non trovare la riga vorrebbe dire
  // aprirla a mano ogni volta.
  for (const v of doc.voci) if (v.risorsa === risorsa && v.pacchettoId) con.add(v.pacchettoId);
  return doc.pacchetti.filter(p => con.has(p.id));
}

/**
 * Le ore non ancora messe in nessuna riga, pacchetto per pacchetto. Positiva
 * vuol dire lavoro che c'è ma che nessuno sta facendo in nessuna settimana.
 * @param {DocProgramma} doc
 * @returns {Map<string, number>}
 */
export function daCollocarePerPacchetto(doc) {
  /** @type {Map<string, number>} */
  const resto = new Map();
  for (const p of doc.pacchetti) {
    resto.set(p.id, oreVoci(doc, v => v.pacchettoId === p.id) - oreCarico(doc, { pacchettoId: p.id }));
  }
  return resto;
}

/**
 * Le voci che stanno per aprirsi e non sono ancora attive. Il Programma
 * **segnala, non crea**: il momento in cui una cosa entra nel pool è una
 * decisione.
 * @param {DocProgramma} doc
 * @param {Set<string>} attivitaAperte
 * @param {number} [settimaneDiPreavviso]
 * @returns {Voce[]}
 */
export function vociInArrivo(doc, attivitaAperte, settimaneDiPreavviso = 2) {
  const limite = spostaSettimane(settimanaIso(), settimaneDiPreavviso);
  return doc.voci.filter(v => (
    statoVoce(v, attivitaAperte) === 'prevista'
    && eFoglia(doc, v.id)
    && v.finestra?.da
    && v.finestra.da <= limite
  ));
}

/**
 * N ore spalmate su k settimane, a mezze ore, col resto sulle **prime**: di
 * quello che c'è davanti si sa sempre qualcosa in più che di quello in fondo.
 *
 * È il secondo dei due modi di riempire un intervallo selezionato — l'altro è
 * lo stesso numero in ogni settimana — e si mostrano tutti e due col risultato
 * già calcolato, perché quale dei due si intenda non si indovina.
 *
 * @param {number} totale
 * @param {number} quante
 * @returns {number[]}
 */
export function spalma(totale, quante) {
  if (quante <= 0) return [];
  const mezzeOre = Math.round(Math.max(0, totale) * 2);
  const base = Math.floor(mezzeOre / quante);
  const resto = mezzeOre - base * quante;
  return Array.from({ length: quante }, (_, i) => (base + (i < resto ? 1 : 0)) / 2);
}

/**
 * Le righe `titolo | ore` di una scomposizione. Stessa sintassi dell'incolla in
 * massa, meno le colonne che qui non servono: le figlie stanno nel pacchetto
 * della madre e la risorsa si decide attivando.
 * @param {string} testo
 * @returns {{ titolo: string, ore: number }[]}
 */
export function scomponiTesto(testo) {
  return String(testo || '').split(/\r?\n/).map(riga => {
    const [titolo, ore] = riga.split(/\t|\|/).map(c => c.trim());
    if (!titolo) return null;
    return { titolo, ore: Math.max(0, numero(String(ore ?? '').replace(',', '.').replace(/[^\d.]/g, ''), 0)) };
  }).filter(/** @returns {v is { titolo: string, ore: number }} */ v => !!v);
}

/**
 * I pacchetti che sforano di più le proprie voci: è il «dove» di un margine
 * negativo. Senza, il rosso in testata costringe a cercarselo a mano, ed è la
 * prima cosa che si vuole sapere.
 * @param {DocProgramma} doc
 * @param {number} [quanti]
 * @returns {{ pacchetto: Pacchetto, sforo: number }[]}
 */
export function pacchettiCheSforano(doc, quanti = 2) {
  return doc.pacchetti
    .map(pacchetto => ({ pacchetto, sforo: oreVoci(doc, v => v.pacchettoId === pacchetto.id) - somma(pacchetto.id) }))
    .filter(x => x.sforo > 0)
    .sort((a, b) => b.sforo - a.sforo)
    .slice(0, quanti);

  /** @param {string} pacchettoId */
  function somma(pacchettoId) {
    let voci = 0;
    for (const v of doc.voci) if (v.pacchettoId === pacchettoId && !v.scartata && eFoglia(doc, v.id)) voci += v.oreIniziali;
    return voci;
  }
}

/**
 * Il nome che avrà la lista di un pacchetto, se e quando ne servirà una.
 *
 * Segue la convenzione PARA di `paraConfig.js` — `2573.A60-Fondazioni-261127` —
 * e si mostra **prima** di creare: la lista nasce alla prima attivazione, e
 * vederne il nome in anticipo è ciò che rende la creazione una cosa voluta e
 * non un effetto collaterale.
 * @param {DocProgramma} doc
 * @param {Pacchetto|null|undefined} pacchetto
 * @returns {string}
 */
export function nomeListaProposto(doc, pacchetto) {
  const gruppo = doc.commessa.codice || slug(doc.commessa.nome).toUpperCase();
  const consegna = pacchetto?.nome || doc.commessa.nome || 'Programma';
  return buildListName({ gruppo, consegna, scadenza: doc.commessa.fine || null });
}

/**
 * La scadenza proposta attivando una voce: il venerdì della settimana in cui la
 * sua finestra si chiude, o fra due settimane se finestra non ce n'è.
 * @param {Voce} voce
 * @returns {string} 'YYYY-MM-DD'
 */
export function scadenzaProposta(voce) {
  const settimana = voce.finestra?.a || spostaSettimane(settimanaIso(), 2);
  const lunedi = lunediDellaSettimana(settimana);
  const venerdi = new Date(Number(lunedi.slice(0, 4)), Number(lunedi.slice(5, 7)) - 1, Number(lunedi.slice(8, 10)) + 4);
  return `${venerdi.getFullYear()}-${String(venerdi.getMonth() + 1).padStart(2, '0')}-${String(venerdi.getDate()).padStart(2, '0')}`;
}
