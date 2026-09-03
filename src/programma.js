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

import { settimanaIso, settimaneTra, meseDellaSettimana, spostaSettimane, lunediDellaSettimana, ymd } from './tempo.js';
import { buildListName, groupKeyForSection } from './paraConfig.js';
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
 * @property {string|null} sezione    il **nome** della sezione OneNote della commessa
 * @property {string|null} sezioneId  il suo id, per arrivarci con un click
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
 * @property {string[]} risorse            a chi la daresti: una previsione, non un
 *   impegno, e possono essere in più d'uno — un calcolo lo fanno in due, e
 *   fingere che sia di uno solo obbliga a sdoppiare la voce per far comparire
 *   la seconda riga nella matrice
 * @property {string|null} risorsa          la prima di `risorse`, scritta solo perché un
 *   dispositivo con la versione di prima non butti via le altre riscrivendo il
 *   file: si legge da `risorse`, mai da qui
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
 * **La voce sta in coda, e può non esserci.** Le celle scritte prima che la
 * matrice sapesse delle voci sono ore date al pacchetto e basta: hanno tre
 * segmenti, restano valide, e continuano a leggersi come «ore del pacchetto,
 * senza voce». Aggiungere il quarto segmento in coda invece che in mezzo è
 * quello che rende vero tutto questo senza riscrivere un file su OneDrive — e
 * `const [r, p, s] = chiave.split('|')` continua a dire quello che diceva.
 *
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string} settimana 'YYYY-Www'
 * @param {string|null} [voceId]  la voce su cui cadono le ore; senza, sono del pacchetto
 * @returns {string}
 */
export function chiaveCarico(risorsa, pacchettoId, settimana, voceId = null) {
  return voceId
    ? `${risorsa}|${pacchettoId}|${settimana}|${voceId}`
    : `${risorsa}|${pacchettoId}|${settimana}`;
}

/** @param {string} chiave @returns {{ risorsa: string, pacchettoId: string, settimana: string, voceId: string|null }} */
export function leggiChiaveCarico(chiave) {
  const [risorsa, pacchettoId, settimana, voceId] = chiave.split('|');
  return { risorsa, pacchettoId, settimana, voceId: voceId || null };
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

/**
 * Le persone che una voce propone, da qualunque forma arrivi il file: `risorse`
 * (l'elenco di adesso), o `risorsa` (la stringa di prima). Nomi ripuliti, senza
 * doppioni e senza vuoti — un elenco che contiene due volte la stessa persona
 * sarebbe due righe che si contendono la stessa cella.
 * @param {any} raw
 * @returns {string[]}
 */
function leggiRisorseProposte(raw) {
  const grezze = Array.isArray(raw?.risorse) ? raw.risorse : [raw?.risorsa];
  /** @type {string[]} */
  const nomi = [];
  for (const g of grezze) {
    const nome = testoONull(g);
    if (nome && !nomi.includes(nome)) nomi.push(nome);
  }
  return nomi;
}

/** @param {any} raw @returns {Voce} */
export function normalizzaVoce(raw) {
  const ore = Math.max(0, numero(raw?.ore, 0));
  const finestra = raw?.finestra?.da && raw?.finestra?.a
    ? { da: String(raw.finestra.da), a: String(raw.finestra.a) }
    : null;
  const risorse = leggiRisorseProposte(raw);
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
    // Le proposte sono un elenco, e prima erano una stringa: un file scritto
    // ieri porta `risorsa`, uno di oggi `risorse`, e tutt'e due si leggono.
    // `risorsa` continua a uscire, la prima dell'elenco, finché tutti i
    // dispositivi non hanno la versione nuova — vedi il debito in CLAUDE.md.
    risorse,
    risorsa: risorse[0] ?? null,
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
    // Tre segmenti sono le celle di prima — ore del pacchetto, senza voce —
    // quattro quelle con la voce in coda. Tutto il resto non è una chiave.
    const pezzi = k.split('|').length;
    if (ore > 0 && (pezzi === 3 || pezzi === 4)) carico[k] = ore;
  }
  // Le ore dei contenitori si rifanno **anche in lettura**, non solo dopo una
  // modifica. Sono una somma derivata: se il file ne porta una vecchia — perché
  // l'ha scritta una versione di prima, o una mano — la vista mostrerebbe un
  // totale che non torna con le righe che ha sotto, che è esattamente la classe
  // di difetti per cui `risommaContenitori` esiste. Derivare in un posto solo
  // vuol dire derivare anche qui.
  return risommaContenitori({
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
      // La sezione si tiene **per nome**, non per id: è il nome che regge la
      // convenzione PARA (`2573-ABS` → liste `2573.A60-…`), ed è quello che
      // resta vero se un giorno la sezione viene ricreata altrove. L'id sta
      // accanto solo per aprirla con un click, e può anche mancare.
      sezione: testoONull(c.sezione),
      sezioneId: testoONull(c.sezioneId),
    },
    risorse: (Array.isArray(raw?.risorse) ? raw.risorse : []).map(normalizzaRisorsa).filter((/** @type {Risorsa} */ r) => r.nome),
    pacchetti: (Array.isArray(raw?.pacchetti) ? raw.pacchetti : []).map(normalizzaPacchetto),
    voci: (Array.isArray(raw?.voci) ? raw.voci : []).map(normalizzaVoce),
    carico,
  });
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

/**
 * Toglie un pacchetto. Le sue voci e le sue celle **non si buttano**: passano a
 * un altro pacchetto, o restano senza — cancellare un pacchetto con dentro
 * quaranta voci e trecento ore a piano sarebbe l'unico gesto irreversibile di
 * tutto il pannello, e non c'è ragione perché lo sia.
 *
 * Le celle si fondono per somma: se la persona aveva ore in tutti e due i
 * pacchetti nella stessa settimana, il totale della sua settimana non cambia —
 * ed è il numero su cui si colora la riga.
 *
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @param {{ spostaSu?: string|null }} [opts]  dove vanno voci e celle; null = senza pacchetto
 * @returns {DocProgramma}
 */
export function senzaPacchetto(doc, pacchettoId, opts = {}) {
  const spostaSu = opts.spostaSu || null;
  /** @type {Record<string, number>} */
  const carico = {};
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const { risorsa, pacchettoId: suo, settimana, voceId } = leggiChiaveCarico(chiave);
    if (suo !== pacchettoId) { carico[chiave] = (carico[chiave] || 0) + ore; continue; }
    // Senza una destinazione le celle se ne vanno: non esiste una riga «senza
    // pacchetto» nella matrice, e tenerle vorrebbe dire ore invisibili che
    // continuano a pesare sui totali.
    if (!spostaSu) continue;
    const nuova = chiaveCarico(risorsa, spostaSu, settimana, voceId);
    carico[nuova] = (carico[nuova] || 0) + ore;
  }
  return {
    ...doc,
    pacchetti: doc.pacchetti.filter(p => p.id !== pacchettoId),
    voci: doc.voci.map(v => (v.pacchettoId === pacchettoId ? { ...v, pacchettoId: spostaSu } : v)),
    carico,
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
 * Cambiare nome a una persona **non è** una patch al suo nome: il nome sta
 * dentro le chiavi del carico e dentro le proposte delle voci, e
 * riscriverlo in un posto solo lascerebbe un mese di ore appese a una persona
 * che non esiste più. Qui si sposta tutto insieme, o niente.
 * @param {DocProgramma} doc
 * @param {string} da
 * @param {string} a
 * @returns {DocProgramma}
 */
export function conRisorsaRinominata(doc, da, a) {
  const nuovo = String(a || '').trim();
  if (!nuovo || nuovo === da) return doc;
  /** @type {Record<string, number>} */
  const carico = {};
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const { risorsa, pacchettoId, settimana, voceId } = leggiChiaveCarico(chiave);
    const k = risorsa === da ? chiaveCarico(nuovo, pacchettoId, settimana, voceId) : chiave;
    carico[k] = (carico[k] || 0) + ore;
  }
  return {
    ...doc,
    // Se il nome nuovo è già di un'altra persona le due si fondono in una: due
    // righe con lo stesso nome sarebbero due righe che si contendono le stesse
    // celle.
    risorse: doc.risorse
      .map(r => (r.nome === da ? { ...r, nome: nuovo } : r))
      .filter((r, i, tutte) => tutte.findIndex(x => x.nome === r.nome) === i),
    voci: doc.voci.map(v => (v.risorse.includes(da)
      // Il nome nuovo può già essere fra le proposte: allora quella vecchia
      // sparisce e basta, invece di comparire due volte.
      ? normalizzaVoce({ ...v, risorse: v.risorse.map(n => (n === da ? nuovo : n)) })
      : v)),
    carico,
  };
}

/**
 * Toglie una persona dalla commessa, con le sue ore. Le voci che la
 * *proponevano* restano, senza di lei — le proposte di una voce sono una
 * previsione, non un impegno, e perdere la voce per aver tolto una riga sarebbe
 * sproporzionato.
 * @param {DocProgramma} doc
 * @param {string} nome
 * @returns {DocProgramma}
 */
export function senzaRisorsa(doc, nome) {
  /** @type {Record<string, number>} */
  const carico = {};
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    if (leggiChiaveCarico(chiave).risorsa !== nome) carico[chiave] = ore;
  }
  return {
    ...doc,
    risorse: doc.risorse.filter(r => r.nome !== nome),
    voci: doc.voci.map(v => (v.risorse.includes(nome)
      ? normalizzaVoce({ ...v, risorse: v.risorse.filter(n => n !== nome) })
      : v)),
    carico,
  };
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
  // Le celle della voce e della sua discendenza non spariscono con lei: sono
  // ore date a una persona in una settimana, e cancellarle in silenzio
  // cambierebbe il totale della commessa senza che niente lo dica. Risalgono
  // alla madre se resta, e altrimenti al pacchetto — dove la matrice le fa
  // ancora vedere.
  const madre = doc.voci.find(v => v.id === voceId)?.padreId || null;
  const risale = madre && !daTogliere.has(madre) ? madre : null;
  /** @type {Record<string, number>} */
  const carico = {};
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const c = leggiChiaveCarico(chiave);
    const k = c.voceId && daTogliere.has(c.voceId)
      ? chiaveCarico(c.risorsa, c.pacchettoId, c.settimana, risale)
      : chiave;
    carico[k] = (carico[k] || 0) + ore;
  }
  return risommaContenitori({ ...doc, voci: doc.voci.filter(v => !daTogliere.has(v.id)), carico });
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
 *
 * **La persona a cui si attiva si aggiunge alle proposte, non le sostituisce.**
 * Un task ha un delegato solo, una voce può essere di due: se attivare
 * riscrivesse l'elenco, dare a Marco la sua metà del calcolo cancellerebbe la
 * riga di Gaia dalla matrice — e con lei il posto in cui stanno le sue ore.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @param {{ taskId: string, listId: string, risorsa?: string|null }} legame
 * @returns {DocProgramma}
 */
export function conVoceAttivata(doc, voceId, legame) {
  const voce = doc.voci.find(v => v.id === voceId);
  const scelta = testoONull(legame.risorsa);
  return conVoceAggiornata(doc, voceId, {
    taskId: legame.taskId,
    listId: legame.listId,
    ...(scelta && voce && !voce.risorse.includes(scelta)
      ? { risorse: [...voce.risorse, scelta] }
      : {}),
    attivataIl: adesso(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Le voci nuove: quattro campi, o centocinquanta righe incollate
// ─────────────────────────────────────────────────────────────────────────────
// Senza l'incolla il caricamento iniziale ferma tutto alla seconda commessa:
// duecento voci scritte una alla volta non le scrive nessuno. Senza i campi
// separati si ferma alla **prima**: alla prima voce nessuno ha voglia di
// imparare una sintassi con le barre verticali. Servono tutti e due, e portano
// allo stesso posto — quindi la lettura del testo e la creazione delle voci
// sono due funzioni, non una.

/**
 * @typedef {object} RigaVoce
 * @property {string} pacchetto  il **nome**, non l'id: chi scrive non conosce gli id
 * @property {string} titolo
 * @property {number} ore
 * @property {string} risorsa  una persona, o più d'una separate da virgola
 */

/** «120», «120h», «120,5»: le ore si scrivono come vengono in mente. @param {any} v */
function oreScritte(v) {
  return Math.max(0, numero(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''), 0));
}

/**
 * Righe `pacchetto | titolo | ore | risorsa` (tabulazioni o barre verticali) in
 * righe strutturate. Con `semplice` le colonne sono solo `titolo | ore` — la
 * scomposizione, che non ha né pacchetto (è quello della madre) né risorsa (si
 * decide attivando).
 *
 * È separata da `conVociDaRighe` perché **i modi di scrivere una voce sono
 * due**: incollare centocinquanta righe da un Excel, e compilare quattro campi
 * quando la voce è una sola. Il secondo non deve passare per una sintassi con
 * le barre verticali — è quello che rendeva difficile la prima riga di tutte —
 * quindi il testo si legge qui e le voci si creano di là, e i due modi
 * arrivano allo stesso posto.
 *
 * @param {string} testo
 * @param {{ semplice?: boolean }} [opts]
 * @returns {{ righe: RigaVoce[], scartate: string[] }}
 */
export function leggiRigheVoci(testo, opts = {}) {
  const semplice = !!opts.semplice;
  /** @type {RigaVoce[]} */
  const righe = [];
  /** @type {string[]} */
  const scartate = [];
  for (const riga of String(testo || '').split(/\r?\n/)) {
    if (!riga.trim()) continue;
    const campi = riga.split(/\t|\|/).map(c => c.trim());
    if (semplice) {
      const [titolo, ore] = campi;
      if (!titolo) { scartate.push(riga); continue; }
      righe.push({ pacchetto: '', titolo, ore: oreScritte(ore), risorsa: '' });
      continue;
    }
    // Una colonna sola è il caso più comune di tutti: un elenco di titoli
    // copiato da una mail. Non deve essere un errore.
    const [primo, secondo, terzo, quarto] = campi;
    const unaColonna = campi.filter(c => c).length === 1;
    const titolo = unaColonna ? primo : secondo;
    if (!titolo) { scartate.push(riga); continue; }
    righe.push({
      pacchetto: unaColonna ? '' : (primo || ''),
      titolo,
      ore: oreScritte(terzo),
      risorsa: (quarto || '').trim(),
    });
  }
  return { righe, scartate };
}

/**
 * Righe strutturate in voci vere. I pacchetti nominati e non ancora esistenti
 * vengono creati, e le persone nominate entrano fra le risorse: sono le due
 * cose che, dovendole fare a mano prima, fermavano il caricamento iniziale.
 *
 * @param {DocProgramma} doc
 * @param {RigaVoce[]} righe
 * @param {{ pacchettoId?: string|null }} [opts] il pacchetto per le righe che non lo dicono
 * @returns {{ doc: DocProgramma, aggiunte: number, pacchettiNuovi: string[] }}
 */
export function conVociDaRighe(doc, righe, opts = {}) {
  let risultato = doc;
  /** @type {Partial<Voce>[]} */
  const voci = [];
  /** @type {string[]} */
  const pacchettiNuovi = [];

  for (const riga of righe) {
    const titolo = String(riga?.titolo || '').trim();
    if (!titolo) continue;
    const nomePacchetto = String(riga?.pacchetto || '').trim();

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

    const ore = Math.max(0, numero(riga?.ore, 0));
    // «Marco, Gaia»: una voce può essere di due, e chi incolla un Excel le
    // scrive nella stessa cella, non in due colonne che non esistono.
    const risorse = String(riga?.risorsa || '').split(/[,;]/)
      .map(n => n.trim()).filter((n, i, tutti) => n && tutti.indexOf(n) === i);
    for (const nome of risorse) risultato = conRisorsa(risultato, nome);
    voci.push({ titolo, ore, oreIniziali: ore, pacchettoId, risorse });
  }

  return { doc: conVoci(risultato, voci), aggiunte: voci.length, pacchettiNuovi };
}

/**
 * Il testo incollato, fino in fondo: si legge e si scrive in un colpo solo.
 *
 * @param {DocProgramma} doc
 * @param {string} testo
 * @param {{ pacchettoId?: string|null }} [opts] il pacchetto per le righe che non lo dicono
 * @returns {{ doc: DocProgramma, aggiunte: number, pacchettiNuovi: string[], scartate: string[] }}
 */
export function conVociIncollate(doc, testo, opts = {}) {
  const { righe, scartate } = leggiRigheVoci(testo);
  return { ...conVociDaRighe(doc, righe, opts), scartate };
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
 * Il pacchetto di un ramo: quello della voce, o — se non ce l'ha — il primo che
 * si trova scendendo. Una lavorazione scomposta porta spesso il pacchetto solo
 * sulle sue sotto-voci, e ordinare per pacchetto lasciando quelle madri tutte
 * insieme in fondo darebbe l'elenco meno leggibile dei due.
 * @param {DocProgramma} doc @param {Voce} voce @returns {string|null}
 */
function pacchettoDelRamo(doc, voce) {
  if (voce.pacchettoId) return voce.pacchettoId;
  for (const f of figlieDi(doc, voce.id)) {
    const suo = pacchettoDelRamo(doc, f);
    if (suo) return suo;
  }
  return null;
}

/**
 * Le voci di un pacchetto, in ordine di albero e potate a una profondità.
 *
 * Serve alla matrice, che sotto la riga di un pacchetto sa aprire anche il
 * lavoro che c'è dentro — le lavorazioni, e a un altro clic le sotto-voci.
 * Il pacchetto di un ramo si legge come in `alberoVoci`: dal ramo, non dalla
 * singola voce, perché una lavorazione porta spesso il pacchetto solo sulle sue
 * figlie e altrimenti non comparirebbe sotto nessuno.
 *
 * `profondita` è quanti livelli si mostrano: 1 le sole lavorazioni di primo
 * livello, 2 anche le loro figlie, e così via. Le scartate non ci sono: sono
 * lavoro che non si fa, e nella tabella del quando peserebbero come il resto.
 *
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @param {number} [profondita]
 * @returns {{ voce: Voce, livello: number }[]}
 */
export function vociDiPacchetto(doc, pacchettoId, profondita = 1) {
  /** @type {{ voce: Voce, livello: number }[]} */
  const fila = [];
  /** @param {Voce} v @param {number} livello */
  const scendi = (v, livello) => {
    if (v.scartata) return;
    fila.push({ voce: v, livello });
    if (livello + 1 < profondita) for (const f of figlieDi(doc, v.id)) scendi(f, livello + 1);
  };
  for (const r of vociRadice(doc)) {
    if (pacchettoDelRamo(doc, r) === pacchettoId) scendi(r, 0);
  }
  return fila;
}

/**
 * Le voci in ordine di albero — la madre, poi le sue figlie — con la
 * profondità, che è il rientro con cui l'elenco le mostra.
 *
 * **Con `ordine: 'pacchetto'` i rami di primo livello si raggruppano per
 * pacchetto**, nell'ordine in cui i pacchetti stanno nella commessa, e le voci
 * senza pacchetto vanno in fondo. Dentro un pacchetto l'ordine del file non si
 * tocca: è l'ordine in cui le voci sono state scritte, e vuol dire qualcosa.
 * Il senso è che l'elenco si legge come si legge la commessa — un pacchetto per
 * volta — anche quando le voci sono arrivate mescolate da un incollato.
 *
 * @param {DocProgramma} doc
 * @param {(v: Voce) => boolean} [tieni]
 * @param {{ ordine?: 'file'|'pacchetto' }} [opts]
 * @returns {{ voce: Voce, livello: number }[]}
 */
export function alberoVoci(doc, tieni, opts = {}) {
  /** @type {{ voce: Voce, livello: number }[]} */
  const fila = [];
  /** @param {Voce} v @param {number} livello */
  const scendi = (v, livello) => {
    fila.push({ voce: v, livello });
    if (livello < 6) for (const f of figlieDi(doc, v.id)) scendi(f, livello + 1);
  };

  let radici = vociRadice(doc);
  if (opts.ordine === 'pacchetto') {
    const posto = new Map(doc.pacchetti.map((p, i) => [p.id, i]));
    const chiave = (/** @type {Voce} */ v) => {
      const suo = pacchettoDelRamo(doc, v);
      return suo === null ? Number.MAX_SAFE_INTEGER : (posto.get(suo) ?? Number.MAX_SAFE_INTEGER - 1);
    };
    // `sort` è stabile: a parità di pacchetto resta l'ordine del file.
    radici = [...radici].sort((a, b) => chiave(a) - chiave(b));
  }
  for (const r of radici) scendi(r, 0);
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
 * `voceId` prende il **ramo**: la voce e la sua discendenza, perché le ore di
 * una lavorazione sono quelle delle sue sotto-voci, come le stime.
 *
 * @param {{ pacchettoId?: string|null, risorsa?: string|null, voceId?: string|null, da?: string|null, a?: string|null }} [filtro]
 * @returns {number}
 */
export function oreCarico(doc, filtro = {}) {
  const ramo = filtro.voceId ? ramoVoce(doc, filtro.voceId) : null;
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const [risorsa, pacchettoId, settimana, voceId] = chiave.split('|');
    if (ramo && !(voceId && ramo.has(voceId))) continue;
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
 * **Lo speso è la matrice a sinistra della settimana di oggi**: quelle celle si
 * correggono con quanto è andato davvero quando ci si passa sopra (o in blocco,
 * dal consuntivo del riepilogo). Un dato solo, nessun secondo inserimento — è
 * la stessa approssimazione che si fa a mente guardando un Excel, ed è
 * abbastanza per decidere.
 *
 * **«A finire» sono le ore stimate meno quelle spese, non le celle a destra.**
 * Prima era la matrice futura, e leggeva bene solo su una commessa programmata
 * fino in fondo: qui la programmazione si ferma dove serve, quindi «a finire»
 * diceva sistematicamente meno del lavoro che restava, e il margine ne usciva
 * ottimista. Le stime invece ci sono sempre — sono le voci — e quello che resta
 * da fare è quello che le voci pesano meno quello che si è già speso. Mai
 * negativo: chi ha già speso più di quanto stimava non ha ore «di credito» da
 * finire, ha un margine rosso, ed è là che si legge.
 *
 * Restano tutt'e due i mondi, e servono a due domande diverse:
 * `programmate` sono le celle da qui in avanti (quanto lavoro è in calendario),
 * `aFinire` è quanto ne resta secondo le stime. Il loro delta, per costruzione,
 * è `daCollocare`.
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
  const programmate = oreCarico(doc, { pacchettoId, da: ora });
  const aFinire = Math.max(0, stimate - speso);
  const aPiano = speso + programmate;
  // Quanto costerà in tutto: quello che è già andato più quello che le stime
  // dicono che manca. È il numero da cui si misura il margine, perché è il solo
  // che non dipende da quanto avanti si è arrivati a programmare.
  const previsione = speso + aFinire;
  // Il metro è il numero contrattuale. Per un pacchetto non esiste un venduto
  // suo: lì il metro sono le sue voci, ed è il delta con le celle a contare.
  const vendute = pacchettoId ? stimate : doc.commessa.oreVendute;

  return {
    vendute,
    stimate,
    speso,
    programmate,
    aFinire,
    aPiano,
    previsione,
    margine: vendute - previsione,
    daCollocare: stimate - aPiano,
  };
}

/**
 * Gli stessi cinque numeri, **una riga per pacchetto e una per tutta la
 * commessa**.
 *
 * Nella prima versione i numeri si leggevano un pacchetto alla volta,
 * scegliendolo dalle pastiglie: per rispondere a «come sta messa tutta la
 * sezione» bisognava cliccarli uno per uno e sommare a mente. È esattamente la
 * domanda per cui il pannello esiste, quindi qui c'è la tabella intera.
 *
 * L'ultima riga sono le voci senza pacchetto: esistono, pesano sulle ore
 * stimate, e non vederle vorrebbe dire un totale che non torna con la somma
 * della colonna.
 *
 * @param {DocProgramma} doc
 * @param {{ settimanaOra?: string }} [opts]
 * @returns {{ righe: RigaRiepilogo[], totale: ReturnType<typeof totali> }}
 */
export function riepilogoPacchetti(doc, opts = {}) {
  const ora = opts.settimanaOra || settimanaIso();
  /** @type {RigaRiepilogo[]} */
  const righe = doc.pacchetti.map(p => ({
    pacchettoId: p.id,
    nome: p.nome,
    colore: p.colore,
    listId: p.listId,
    voci: doc.voci.filter(v => v.pacchettoId === p.id && !v.scartata && eFoglia(doc, v.id)).length,
    ...totali(doc, { pacchettoId: p.id, settimanaOra: ora }),
  }));

  const senza = doc.voci.filter(v => !v.pacchettoId && !v.scartata && eFoglia(doc, v.id));
  if (senza.length) {
    const stimate = oreVoci(doc, v => !v.pacchettoId);
    righe.push({
      pacchettoId: null,
      nome: 'senza pacchetto',
      colore: null,
      listId: null,
      voci: senza.length,
      // Il carico si scrive solo su una riga di pacchetto: queste ore non
      // stanno in nessuna settimana per costruzione, ed è il dato utile. Da
      // fare c'è tutto — niente di speso, niente in calendario.
      vendute: stimate, stimate, speso: 0, programmate: 0, aFinire: stimate,
      aPiano: 0, previsione: stimate, margine: 0, daCollocare: stimate,
    });
  }

  return { righe, totale: totali(doc, { settimanaOra: ora }) };
}

/**
 * @typedef {object} RigaRiepilogo
 * @property {string|null} pacchettoId  null è la riga delle voci senza pacchetto
 * @property {string} nome
 * @property {string|null} colore
 * @property {string|null} listId
 * @property {number} voci
 * @property {number} vendute
 * @property {number} stimate
 * @property {number} speso
 * @property {number} programmate  le celle da questa settimana in avanti
 * @property {number} aFinire      stimate meno speso, mai negativo
 * @property {number} aPiano
 * @property {number} previsione   speso + a finire
 * @property {number} margine
 * @property {number} daCollocare
 */

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
 * Dentro una commessa il conto è per forza quello della commessa. La domanda
 * vera — «questa persona è satura?» — non ha una risposta dentro un solo
 * documento, e ha la sua vista: `caricoPersone()` somma tutti i programmi
 * accesi, ed è lì che si vede se la stessa settimana è stata data due volte.
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
 * Le ore di una cella: risorsa, pacchetto, settimana e — se le ore sono di una
 * voce — la voce. Un solo posto in cui la chiave si compone, così la vista non
 * la scrive a mano.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string} settimana
 * @param {string|null} [voceId]
 * @returns {number}
 */
export function oreCella(doc, risorsa, pacchettoId, settimana, voceId = null) {
  return doc.carico[chiaveCarico(risorsa, pacchettoId, settimana, voceId)] || 0;
}

/**
 * Il percorso di una voce, dalla radice fino a lei.
 *
 * Serve a capire dove attaccare delle ore in un albero potato: le ore di una
 * sotto-voce che non si sta mostrando devono comunque comparire, sommate nel
 * nodo più profondo che si vede. Il giro è limitato, come dappertutto qui: un
 * `padreId` che gira su sé stesso è un file corrotto, non un motivo per
 * bloccare la vista.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @returns {Voce[]}
 */
export function catenaVoce(doc, voceId) {
  /** @type {Voce[]} */
  const catena = [];
  let corrente = doc.voci.find(v => v.id === voceId) || null;
  for (let giro = 0; corrente && giro < 8; giro++) {
    catena.unshift(corrente);
    corrente = corrente.padreId ? (doc.voci.find(v => v.id === corrente?.padreId) || null) : null;
  }
  return catena;
}

/**
 * Una voce e tutta la sua discendenza, per id.
 *
 * Serve dappertutto dove una riga chiusa deve dire il totale di quello che ha
 * sotto: le ore di «10.1 Compressore» sono le sue più quelle di «Calcolo»,
 * «Casseri» e «Armature», esattamente come le stime.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @returns {Set<string>}
 */
export function ramoVoce(doc, voceId) {
  const dentro = new Set([voceId]);
  for (let giro = 0; giro < 8; giro++) {
    const prima = dentro.size;
    for (const v of doc.voci) if (v.padreId && dentro.has(v.padreId)) dentro.add(v.id);
    if (dentro.size === prima) break;
  }
  return dentro;
}

/**
 * Le ore di un **ramo di voci** in una settimana: la voce e la sua discendenza,
 * su tutte le persone o su una sola. È il numero della riga di una voce nella
 * matrice — chiusa o aperta che sia, dice sempre il totale di quello che c'è
 * sotto, come le ore stimate.
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @param {string} settimana
 * @param {string|null} [risorsa]
 * @returns {number}
 */
export function oreVoceSettimana(doc, voceId, settimana, risorsa = null) {
  const ramo = ramoVoce(doc, voceId);
  const voce = doc.voci.find(v => v.id === voceId);
  const suoPacchetto = voce ? pacchettoDelRamo(doc, voce) : null;
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const c = leggiChiaveCarico(chiave);
    if (c.settimana !== settimana) continue;
    if (risorsa && c.risorsa !== risorsa) continue;
    if (c.voceId) {
      if (ramo.has(c.voceId)) somma += ore;
      continue;
    }
    // Le ore lasciate sul pacchetto che una voce di questo ramo adotta: sono
    // già quelle che la matrice mostra nella sua riga, e una riga di totale
    // che non conta le celle che ha sotto è la somma che non torna.
    if (c.pacchettoId !== suoPacchetto) continue;
    const adottiva = voceAdottiva(doc, c.pacchettoId, c.risorsa);
    if (adottiva && ramo.has(adottiva)) somma += ore;
  }
  return somma;
}

/**
 * Le persone che compaiono sotto una voce.
 *
 * Da **ultimo livello mostrato** (`conProposta`): chi ha ore in tutto il ramo —
 * le sotto-voci nascoste ci sono sommate, e una riga di totale senza le righe
 * che la fanno è un numero che non si può seguire — più la persona che la voce
 * *propone* — una, o più d'una — così la riga in cui mettere la prima ora esiste
 * già e non bisogna aggiungerla a mano. Tutte e tredici le risorse sotto ogni sotto-voce
 * sarebbero invece una tabella che non si legge.
 * Su una voce che ha sotto di sé altre righe la proposta non si conta: lì le
 * ore si scrivono nelle figlie, e una riga vuota in mezzo sarebbe un invito a
 * scrivere le stesse ore due volte. Chi però ci ha già messo delle ore resta
 * visibile a qualunque profondità — sono ore vere, e nasconderle sarebbe un
 * totale che non torna.
 *
 * @param {DocProgramma} doc
 * @param {string} voceId
 * @param {boolean} [conProposta]
 * @returns {Risorsa[]}
 */
export function risorseDiVoce(doc, voceId, conProposta = true) {
  // Da ultimo livello mostrato la voce prende anche chi ha ore nelle sue
  // sotto-voci nascoste: sono ore che il suo totale conta già, e senza la loro
  // riga si vedrebbe un numero di cui sotto non c'è traccia.
  const ramo = conProposta ? ramoVoce(doc, voceId) : null;
  const con = new Set();
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    if (!ore) continue;
    const c = leggiChiaveCarico(chiave);
    if (c.voceId && (ramo ? ramo.has(c.voceId) : c.voceId === voceId)) con.add(c.risorsa);
  }
  const voce = doc.voci.find(v => v.id === voceId);
  if (conProposta) for (const nome of voce?.risorse || []) con.add(nome);
  // Chi ha ore lasciate sul pacchetto che una voce di questo ramo adotta ha una
  // riga anche qui: sono ore vere, il totale della voce le conta già, e senza
  // la loro riga si vedrebbe un numero di cui sotto non c'è traccia.
  const suoPacchetto = voce ? pacchettoDelRamo(doc, voce) : null;
  if (suoPacchetto) {
    for (const [chiave, ore] of Object.entries(doc.carico)) {
      if (!ore) continue;
      const c = leggiChiaveCarico(chiave);
      if (c.voceId || c.pacchettoId !== suoPacchetto) continue;
      const adottiva = voceAdottiva(doc, suoPacchetto, c.risorsa);
      if (adottiva && (ramo ? ramo.has(adottiva) : adottiva === voceId)) con.add(c.risorsa);
    }
  }
  return doc.risorse.filter(r => con.has(r.nome));
}

/**
 * Le persone che hanno ore date **al pacchetto e basta**, senza una voce.
 *
 * Sono le celle scritte prima che la matrice sapesse delle voci. Non si
 * migrano: nessuno può dire, al posto di chi le ha scritte, a quale voce
 * andassero. Restano dove sono, e la loro riga compare sotto il pacchetto
 * anche quando si sta guardando per voci — sparire in silenzio sarebbe un
 * totale che non torna e nessuno che lo dice.
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @returns {Risorsa[]}
 */
export function risorseSenzaVoce(doc, pacchettoId) {
  const con = new Set();
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    if (!ore) continue;
    const c = leggiChiaveCarico(chiave);
    if (c.pacchettoId !== pacchettoId || c.voceId) continue;
    // Adottate da una voce: la loro riga è già lì sotto, e ripeterla qui in
    // coda sarebbe la stessa cella mostrata due volte.
    if (voceAdottiva(doc, pacchettoId, c.risorsa)) continue;
    con.add(c.risorsa);
  }
  return doc.risorse.filter(r => con.has(r.nome));
}

// ─────────────────────────────────────────────────────────────────────────────
// Le ore lasciate sul pacchetto, e la voce che le adotta
// ─────────────────────────────────────────────────────────────────────────────
// Le celle a tre segmenti sono ore date al pacchetto e basta: quelle scritte
// prima che la matrice sapesse delle voci, e quelle che ci arrivano dal
// consuntivo. Finivano tutte in coda al pacchetto, in righe a parte marcate
// «sul pacchetto», perché nessuno poteva dire al posto di chi le aveva scritte
// a quale voce andassero.
//
// **La voce però lo dice.** Una voce porta la persona che la fa: se dentro un
// pacchetto una sola voce propone Riccardo, «Riccardo, A10, W39» e «Riccardo,
// Calcolo, W39» sono la stessa frase detta con meno parole. Scomporre un
// pacchetto e vedersi le sue ore restare in fondo, in righe che ripetono i nomi
// di quelle appena aperte, rende illeggibile proprio la schermata che si è
// appena aperta — e lascia la riga della voce a zero mentre quella del
// pacchetto dice quaranta.
//
// **Adottare non riscrive niente sul file.** La chiave resta a tre segmenti
// finché qualcuno non scrive in quella riga: allora la cella della voce prende
// il valore e quella del pacchetto si azzera, perché sono le stesse ore e
// tenerle in due posti vorrebbe dire contarle due volte. Il totale del
// pacchetto non cambia mai — è sempre la somma delle chiavi, con voce o senza.
//
// **Se le voci che propongono la stessa persona sono due, non si adotta.** Lì
// la domanda «a quale voce andavano» torna senza risposta, e indovinarla è
// esattamente quello che qui non si fa.

/**
 * La voce che adotta le ore lasciate sul pacchetto da una persona: quella —
 * una sola — che dentro quel pacchetto la propone.
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @param {string} risorsa
 * @returns {string|null}
 */
export function voceAdottiva(doc, pacchettoId, risorsa) {
  if (!pacchettoId || !risorsa) return null;
  const candidate = doc.voci.filter(v => (
    !v.scartata && v.risorse.includes(risorsa) && pacchettoDelRamo(doc, v) === pacchettoId));
  return candidate.length === 1 ? candidate[0].id : null;
}

/**
 * Le chiavi del carico che cadono **sotto una riga di persona** della matrice:
 * la sua cella, quelle delle sotto-voci che non si stanno mostrando, e — se
 * questa voce le adotta — quelle lasciate sul pacchetto.
 *
 * Con `voceId` a `null` la riga è la persona sotto il pacchetto, cioè l'ultimo
 * livello mostrato quando le voci sono spente: lì ci cade tutto quello che ha
 * su quel pacchetto, voci comprese.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string|null} voceId
 * @param {string} settimana
 * @returns {string[]}
 */
function celleSottoRiga(doc, risorsa, pacchettoId, voceId, settimana) {
  const ramo = voceId ? ramoVoce(doc, voceId) : null;
  // Adottate qui se la voce che le adotta sta in questo ramo: da ultimo
  // livello mostrato una riga dice anche quello che ha nelle sotto-voci
  // nascoste, e le ore adottate non fanno eccezione.
  const adottiva = voceAdottiva(doc, pacchettoId, risorsa);
  const adotta = Boolean(ramo && adottiva && ramo.has(adottiva));
  /** @type {string[]} */
  const chiavi = [];
  for (const chiave of Object.keys(doc.carico)) {
    const c = leggiChiaveCarico(chiave);
    if (c.risorsa !== risorsa || c.pacchettoId !== pacchettoId || c.settimana !== settimana) continue;
    if (ramo && !(c.voceId ? ramo.has(c.voceId) : adotta)) continue;
    chiavi.push(chiave);
  }
  return chiavi;
}

/**
 * Le ore che una riga di persona mostra: la somma di quello che ha sotto.
 *
 * È il numero della cella nella matrice, ed è sempre un totale del ramo — come
 * per le righe di voce. Prima la riga leggeva la sua sola chiave: bastava
 * spegnere «voci» per vedere il pacchetto dire quaranta e la persona sotto di
 * lui zero, che è un totale che non torna e nessuno che lo dice.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string|null} voceId
 * @param {string} settimana
 * @returns {number}
 */
export function oreSottoRiga(doc, risorsa, pacchettoId, voceId, settimana) {
  return celleSottoRiga(doc, risorsa, pacchettoId, voceId, settimana)
    .reduce((somma, chiave) => somma + (doc.carico[chiave] || 0), 0);
}

/**
 * Dove finiscono le ore scritte in una riga di persona, e quali celle si porta
 * via. Una sola destinazione: la riga mostra un totale, e scrivere dentro un
 * totale vuol dire «da adesso sono queste», non sommarcisi.
 *
 * La destinazione è la cella più profonda che quelle ore hanno già — le ore
 * adottate tornano alla loro voce, quelle di una sotto-voce nascosta restano
 * dov'erano — e le altre si azzerano nello stesso colpo, perché sono le stesse
 * ore: lasciarle vorrebbe dire raddoppiare la settimana.
 *
 * `null` quando sotto la riga ci sono **due voci diverse** con delle ore: lì la
 * destinazione non esiste, e sceglierla al posto di chi scrive vorrebbe dire
 * cancellare un'attribuzione che qualcuno aveva fatto. La risposta è aprire un
 * livello, come per le righe di somma.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string|null} voceId
 * @param {string} settimana
 * @returns {{ chiave: string, assorbe: string[] }|null}
 */
export function destinazioneOre(doc, risorsa, pacchettoId, voceId, settimana) {
  const propria = chiaveCarico(risorsa, pacchettoId, settimana, voceId);
  const sotto = celleSottoRiga(doc, risorsa, pacchettoId, voceId, settimana)
    .filter(k => (doc.carico[k] || 0) > 0);
  const voci = new Set(sotto.map(k => leggiChiaveCarico(k).voceId).filter(Boolean));
  if (voci.size > 1) return null;
  // Senza ore su nessuna voce si scrive nella cella della riga — con una
  // eccezione: se una voce di qui sotto adotta quella persona, le ore vanno
  // lì. È lo stesso posto in cui la matrice le sta già mostrando, ed è dove il
  // lavoro è davvero descritto.
  const ramo = voceId ? ramoVoce(doc, voceId) : null;
  const adottiva = voceAdottiva(doc, pacchettoId, risorsa);
  const dove = voci.size === 1
    ? /** @type {string} */ ([...voci][0])
    : ((adottiva && (!ramo || ramo.has(adottiva))) ? adottiva : voceId);
  const chiave = dove ? chiaveCarico(risorsa, pacchettoId, settimana, dove) : propria;
  const assorbe = [...new Set([propria, ...sotto])]
    .filter(k => k !== chiave && (doc.carico[k] || 0) > 0);
  return { chiave, assorbe };
}

/**
 * Le celle da scrivere perché una persona abbia **esattamente** quelle ore su
 * un pacchetto in una settimana. È la regola del consuntivo — sostituisce, non
 * somma — scritta in un posto solo, e la usano tutt'e due i modi in cui le ore
 * vere rientrano: il campo del riepilogo e il rettangolo incollato.
 *
 * Quando quelle ore stanno su una voce si riscrive quella cella, invece di
 * aggiungerne una sul pacchetto: due celle per la stessa settimana sarebbero
 * la settimana contata due volte, ed è la cosa che si scopre dal margine
 * sbagliato tre settimane dopo.
 *
 * Con due voci sotto, il consuntivo resta la risposta definitiva su quella
 * settimana e va sul pacchetto: del passato si sa il totale, non su quale voce
 * sia caduto. Le celle di voce si azzerano — sono le stesse ore, appena
 * corrette.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} pacchettoId
 * @param {string} settimana
 * @param {number} ore
 * @returns {Record<string, number>}
 */
export function celleConsuntivo(doc, risorsa, pacchettoId, settimana, ore) {
  /** @type {Record<string, number>} */
  const celle = {};
  const dove = destinazioneOre(doc, risorsa, pacchettoId, null, settimana);
  if (dove) {
    for (const k of dove.assorbe) celle[k] = 0;
    celle[dove.chiave] = ore;
    return celle;
  }
  for (const k of celleSottoRiga(doc, risorsa, pacchettoId, null, settimana)) celle[k] = 0;
  celle[chiaveCarico(risorsa, pacchettoId, settimana)] = ore;
  return celle;
}

/**
 * Il totale di una persona in una settimana, dentro questa commessa: è il
 * numero su cui si colora la cella, e con un pacchetto scelto è il totale
 * *dentro quel pacchetto* — perché un filtro deve valere anche per le somme,
 * altrimenti la riga dice una cosa e le celle un'altra.
 * @param {DocProgramma} doc
 * @param {string} risorsa
 * @param {string} settimana
 * @param {string|null} [pacchettoId]  quando c'è, solo le ore di quel pacchetto
 * @returns {number}
 */
export function oreRisorsaSettimana(doc, risorsa, settimana, pacchettoId = null) {
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const [r, p, s] = chiave.split('|');
    if (r === risorsa && s === settimana && (!pacchettoId || p === pacchettoId)) somma += ore;
  }
  return somma;
}

/**
 * Il totale di un pacchetto in una settimana, su tutte le persone o su una
 * sola: è il numero della riga chiusa nella matrice, che adesso ha in cima il
 * pacchetto e non la persona.
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @param {string} settimana
 * @param {string|null} [risorsa]  quando c'è, solo le sue ore
 * @returns {number}
 */
export function orePacchettoSettimana(doc, pacchettoId, settimana, risorsa = null) {
  let somma = 0;
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const [r, p, s] = chiave.split('|');
    if (p === pacchettoId && s === settimana && (!risorsa || r === risorsa)) somma += ore;
  }
  return somma;
}

/**
 * Le persone che hanno ore in un pacchetto: le sotto-righe che si aprono sotto
 * la sua. È il gemello di `pacchettiDiRisorsa`, girato — e come quello tiene
 * dentro anche chi è solo *proposto* su una voce, perché è lì che si va a
 * scrivere la prima ora.
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @returns {Risorsa[]}
 */
export function risorseDiPacchetto(doc, pacchettoId) {
  const con = new Set(Object.keys(doc.carico)
    .map(k => k.split('|'))
    .filter(([, p]) => p === pacchettoId)
    .map(([r]) => r));
  for (const v of doc.voci) {
    if (v.pacchettoId === pacchettoId) for (const nome of v.risorse) con.add(nome);
  }
  return doc.risorse.filter(r => con.has(r.nome));
}

// ── Il carico di una persona su tutte le commesse ───────────────────────────
//
// La matrice di una commessa risponde a «come sta messa questa commessa». La
// domanda che restava senza risposta è l'altra: **«a questa persona ho già
// dato quella settimana?»** — e non ha una risposta dentro un documento solo,
// perché la persona è la stessa in tutti. Finché il conto si faceva per
// commessa, sei ore qui e trentadue là si vedevano solo aprendo due schermate
// e sommando a mente: cioè non si vedevano.
//
// Sono gli stessi dati letti dall'altro verso — nessun campo nuovo, nessun
// documento nuovo, nessuna copia da tenere in pari. Il prezzo è leggere tutti
// i programmi accesi invece di uno, e per questo la vista li chiede solo
// quando la si apre.

/** Il tetto di colonne della vista per persona: oltre, non si legge più. */
const MAX_SETTIMANE_PERSONE = 60;

/**
 * Le colonne della vista per persona: l'unione degli orizzonti dei programmi
 * accesi, potata a quello che serve guardare.
 *
 * Si parte da quattro settimane fa e non dall'inizio della commessa più
 * vecchia: la domanda è sul futuro — «sto per dare due cose insieme» — e il
 * passato serve solo come riferimento di quanto si è già speso. In coda il
 * tetto: due commesse da tre anni farebbero centocinquanta colonne, che è una
 * tabella che non risponde a niente.
 *
 * @param {DocProgramma[]} docs
 * @param {string} [settimanaOra]
 * @returns {string[]}
 */
export function settimaneDellePersone(docs, settimanaOra) {
  const ora = settimanaOra || settimanaIso();
  if (!docs.length) return settimaneTra(spostaSettimane(ora, -4), spostaSettimane(ora, 12));

  /** @type {string[]} */
  const estremi = [];
  for (const doc of docs) {
    const sue = settimaneDellaMatrice(doc, ora);
    if (sue.length) estremi.push(sue[0], sue[sue.length - 1]);
    // Anche le celle scritte fuori dall'orizzonte dichiarato: sono ore date a
    // qualcuno, e non vederle è esattamente il buco che questa vista chiude.
    for (const chiave of Object.keys(doc.carico)) {
      const settimana = chiave.split('|')[2];
      if (settimana) estremi.push(settimana);
    }
  }
  if (!estremi.length) return settimaneTra(spostaSettimane(ora, -4), spostaSettimane(ora, 12));

  const inizio = spostaSettimane(ora, -4);
  const da = estremi.reduce((m, w) => (w < m ? w : m), estremi[0]);
  const a = estremi.reduce((m, w) => (w > m ? w : m), estremi[0]);
  return settimaneTra(da > inizio ? da : inizio, a).slice(0, MAX_SETTIMANE_PERSONE);
}

/**
 * Un nodo dell'albero che si apre sotto una persona: la commessa, il pacchetto,
 * la voce, la sotto-voce. Una struttura sola per tutti i livelli, perché la
 * vista li disegna nello stesso modo e la profondità la decide chi guarda.
 *
 * @typedef {object} QuotaCommessa
 * @property {string} chiave            unica nella riga: serve a React e all'apri/chiudi
 * @property {'commessa'|'pacchetto'|'voce'} tipo
 * @property {string} programmaId       la commessa da cui viene, a ogni livello: il clic ci porta
 * @property {string} nome
 * @property {string|null} colore       il pacchetto, dove ce n'è uno
 * @property {Record<string, number>} ore  settimana → ore di questo nodo e di quello che ha sotto
 * @property {number} totale
 * @property {QuotaCommessa[]} figli
 */

/**
 * @typedef {object} RigaPersona
 * @property {string} nome
 * @property {number} capacita          ore/settimana dichiarate; 0 se nessun programma lo dice
 * @property {Record<string, number>} ore  settimana → ore su tutte le commesse
 * @property {Record<string, number>} oreIntere  le stesse, senza il filtro sul pacchetto
 * @property {number} totale
 * @property {QuotaCommessa[]} commesse  l'albero che si apre sotto di lei: solo rami con ore
 * @property {string[]} sovrapposte     le settimane in cui è oltre la capacità
 */

/**
 * Il carico di ogni persona, settimana per settimana, sommato su tutti i
 * programmi passati.
 *
 * **La capacità è la più alta dichiarata.** La stessa persona può comparire in
 * due commesse con due capacità diverse — succede perché la si scrive due
 * volte, non perché lavori il doppio. Prendere la più alta è la scelta
 * prudente: colora di rosso solo chi sfora *anche* rispetto al numero più
 * generoso che qualcuno gli ha dato, e un falso allarme in questa tabella
 * varrebbe quanto nessun allarme.
 *
 * **Il filtro sul pacchetto vale anche qui.** Un pacchetto sta dentro una
 * commessa sola, quindi filtrando resta il carico che quel pacchetto dà a ogni
 * persona: è la stessa domanda della matrice, letta per riga invece che per
 * colonna. Con un filtro acceso spariscono le persone che su quel pacchetto non
 * hanno niente — un elenco di righe a zero non è una risposta — e le
 * sovrapposizioni restano quelle vere, calcolate sul carico **intero** della
 * persona: sarebbe una bugia dire che è scarica solo perché si sta guardando un
 * pacchetto per volta.
 *
 * @param {{ id: string, nome: string, doc: DocProgramma }[]} programmi
 * @param {string[]} settimane
 * `dettaglio` è quanti livelli di voce si aprono sotto il pacchetto: 0 nessuno,
 * 1 le lavorazioni, 2 anche le loro figlie. Sono gli stessi due bottoni della
 * matrice, e la stessa catena letta dall'altro capo — là si parte dal lavoro e
 * si arriva alla persona, qui si parte dalla persona e si arriva al lavoro.
 *
 * @param {{ pacchettoId?: string|null, dettaglio?: number }} [filtro]
 * @returns {RigaPersona[]}
 */
export function caricoPersone(programmi, settimane, filtro = {}) {
  const soloPacchetto = filtro.pacchettoId || null;
  const dettaglio = filtro.dettaglio || 0;
  const finestra = new Set(settimane);
  // Con una commessa sola il suo nome è una riga che ripete il titolo della
  // pagina: si scende diretti ai pacchetti. Con due o più torna, perché lì la
  // domanda «da dove viene questo carico» comincia dalla commessa.
  const conCommessa = programmi.length > 1;
  /** @type {Map<string, RigaPersona>} */
  const persone = new Map();
  /** @type {Map<string, number>} le capacità dichiarate, la più alta vince */
  const capacita = new Map();
  /** @type {Map<string, Record<string, number>>} il carico intero, filtro o no */
  const intero = new Map();

  /** @param {string} nome @returns {RigaPersona} */
  const riga = nome => {
    let r = persone.get(nome);
    if (!r) {
      r = { nome, capacita: capacita.get(nome) || 0, ore: {}, oreIntere: {}, totale: 0, commesse: [], sovrapposte: [] };
      persone.set(nome, r);
    }
    return r;
  };

  for (const { doc } of programmi) {
    for (const r of doc.risorse) {
      if (r.oreSettimana > (capacita.get(r.nome) || 0)) capacita.set(r.nome, r.oreSettimana);
    }
  }
  // Senza filtro, prima le anagrafiche: una persona che c'è ma non ha ancora
  // ore va vista comunque, altrimenti la riga in cui scriverla non esiste.
  if (!soloPacchetto) for (const nome of capacita.keys()) riga(nome);

  for (const { id, nome, doc } of programmi) {
    for (const [chiave, ore] of Object.entries(doc.carico)) {
      if (!ore) continue;
      const { risorsa, pacchettoId, settimana, voceId } = leggiChiaveCarico(chiave);
      if (!finestra.has(settimana)) continue;
      const tutte = intero.get(risorsa) || {};
      tutte[settimana] = (tutte[settimana] || 0) + ore;
      intero.set(risorsa, tutte);
      if (soloPacchetto && pacchettoId !== soloPacchetto) continue;
      const p = riga(risorsa);
      p.ore[settimana] = (p.ore[settimana] || 0) + ore;
      p.totale += ore;

      // Il percorso di queste ore, dalla commessa fino alla voce: ogni nodo
      // lungo la strada se le somma, così una riga chiusa dice sempre il
      // totale di quello che ha sotto.
      /** @type {{ chiave: string, tipo: 'commessa'|'pacchetto'|'voce', nome: string, colore: string|null }[]} */
      const percorso = [];
      if (conCommessa) percorso.push({ chiave: id, tipo: 'commessa', nome, colore: null });
      const pacchetto = doc.pacchetti.find(x => x.id === pacchettoId);
      percorso.push({
        chiave: `${id}:${pacchettoId}`, tipo: 'pacchetto',
        nome: pacchetto?.nome || 'senza pacchetto', colore: pacchetto?.colore || null,
      });
      // Le voci si mostrano fino alla profondità chiesta: quello che sta più
      // sotto si somma nell'ultimo nodo mostrato, non sparisce.
      // Anche le ore lasciate sul pacchetto scendono nella voce che le adotta:
      // è la stessa catena della matrice letta dall'altro capo, e vederle
      // ferme sul pacchetto di qua e sotto la voce di là sarebbe due tabelle
      // che si smentiscono.
      const doveScende = voceId || voceAdottiva(doc, pacchettoId, risorsa);
      if (dettaglio && doveScende) {
        for (const v of catenaVoce(doc, doveScende).slice(0, dettaglio)) {
          percorso.push({ chiave: `${id}:${v.id}`, tipo: 'voce', nome: v.titolo, colore: pacchetto?.colore || null });
        }
      }

      let figli = p.commesse;
      for (const passo of percorso) {
        let nodo = figli.find(x => x.chiave === passo.chiave);
        if (!nodo) {
          nodo = { ...passo, programmaId: id, ore: {}, totale: 0, figli: [] };
          figli.push(nodo);
        }
        nodo.ore[settimana] = (nodo.ore[settimana] || 0) + ore;
        nodo.totale += ore;
        figli = nodo.figli;
      }
    }
  }

  /** @param {QuotaCommessa[]} nodi */
  const ordina = nodi => {
    // Quello che pesa di più in cima: aprendo una riga si vuole sapere subito
    // da dove viene il grosso.
    nodi.sort((a, b) => b.totale - a.totale);
    for (const n of nodi) ordina(n.figli);
  };

  for (const p of persone.values()) {
    // Il carico intero resta a disposizione della vista: col filtro acceso è
    // quello che decide il rosso, perché è la persona a essere sovraccarica,
    // non il pacchetto che si sta guardando.
    p.oreIntere = intero.get(p.nome) || p.ore;
    p.sovrapposte = settimane.filter(w => (p.oreIntere[w] || 0) > (p.capacita || ORE_SETTIMANA_DEFAULT));
    ordina(p.commesse);
  }

  return [...persone.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
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
  for (const v of doc.voci) if (v.risorse.includes(risorsa) && v.pacchettoId) con.add(v.pacchettoId);
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

// ─────────────────────────────────────────────────────────────────────────────
// Le ore già spese, per pacchetto
// ─────────────────────────────────────────────────────────────────────────────
// La matrice si compila cella per cella, ed è giusto così per il futuro: lì
// ogni settimana è una decisione. Per il **passato** no: quando una commessa
// entra qui dopo sei mesi di lavoro, quello che si sa è «su questo pacchetto
// Marco ha fatto circa 90 ore», non come erano distribuite. Battere quel numero
// settimana per settimana all'indietro è il passaggio che fa smettere di
// compilare, e produrrebbe comunque una precisione finta.
//
// Quindi: un numero per pacchetto e persona, spalmato all'indietro sulle
// settimane passate. Il **totale è vero**, la distribuzione è dichiaratamente
// approssimata — che è la stessa promessa delle «ore a finire senza timesheet».

/**
 * Le settimane della matrice già passate: quelle a sinistra della colonna di
 * oggi, che è dove sta lo speso.
 * @param {DocProgramma} doc
 * @param {string} [settimanaOra]
 * @returns {string[]}
 */
export function settimanePassate(doc, settimanaOra) {
  const ora = settimanaOra || settimanaIso();
  return settimaneDellaMatrice(doc, ora).filter(w => w < ora);
}

/**
 * Le ore già spese di una persona su un pacchetto, spalmate sulle settimane
 * indicate. **Sostituisce** quelle celle invece di sommarcisi: è un consuntivo,
 * cioè la risposta definitiva su quel tratto, e sommare vorrebbe dire
 * raddoppiare le ore ogni volta che si corregge il numero.
 *
 * @param {DocProgramma} doc
 * @param {{ risorsa: string, pacchettoId: string, ore: number, settimane: string[] }} dati
 * @returns {DocProgramma}
 */
export function conSpesoRipartito(doc, { risorsa, pacchettoId, ore, settimane }) {
  const nome = String(risorsa || '').trim();
  if (!nome || !pacchettoId || !settimane?.length) return doc;
  const quote = spalma(Math.max(0, numero(ore, 0)), settimane.length);
  // Chi non era ancora fra le risorse ci entra: le ore che ha già fatto sono la
  // prova migliore che ci deve stare.
  let risultato = conRisorsa(doc, nome);
  settimane.forEach((settimana, i) => {
    // La stessa regola dell'incollato: le ore vere sostituiscono quello che
    // c'era in quella settimana, anche quando stava su una voce.
    for (const [chiave, ore] of Object.entries(
      celleConsuntivo(risultato, nome, pacchettoId, settimana, quote[i] || 0))) {
      risultato = conCarico(risultato, chiave, ore);
    }
  });
  return risultato;
}

/**
 * Quanto risulta già speso adesso su un pacchetto, persona per persona: è
 * quello che il campo del consuntivo mostra già scritto, così si corregge un
 * numero invece di ricominciare da capo.
 * @param {DocProgramma} doc
 * @param {string} pacchettoId
 * @param {string[]} settimane
 * @returns {Map<string, number>}
 */
export function spesoPerRisorsa(doc, pacchettoId, settimane) {
  const dentro = new Set(settimane);
  /** @type {Map<string, number>} */
  const somme = new Map();
  for (const [chiave, ore] of Object.entries(doc.carico)) {
    const k = leggiChiaveCarico(chiave);
    if (k.pacchettoId !== pacchettoId || !dentro.has(k.settimana)) continue;
    somme.set(k.risorsa, (somme.get(k.risorsa) || 0) + ore);
  }
  return somme;
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
 * La commessa con cui si nominano le liste di questo programma.
 *
 * **La sezione vince sul nome inventato.** Un programma collegato a `2573-ABS`
 * genera liste `2573.A60-Fondazioni-270630`, che è esattamente il nome che
 * `listsForSection` ricuce alla sezione: da lì le consegne compaiono nel
 * pannello della sezione senza che nessuno le colleghi a mano. Un codice
 * scritto a mano scavalca tutto — è il caso di chi la commessa ce l'ha già in
 * testa con un numero suo — e lo slug del nome è l'ultima spiaggia.
 * @param {DocProgramma} doc
 * @returns {string}
 */
export function gruppoCommessa(doc) {
  return doc.commessa.codice
    || groupKeyForSection(doc.commessa.sezione)
    || slug(doc.commessa.nome).toUpperCase();
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
  const consegna = pacchetto?.nome || doc.commessa.nome || 'Programma';
  return buildListName({ gruppo: gruppoCommessa(doc), consegna, scadenza: doc.commessa.fine || null });
}

// ─────────────────────────────────────────────────────────────────────────────
// L'esportazione
// ─────────────────────────────────────────────────────────────────────────────
// «Ha senso esportare un json con la data?» Sì, ma non come backup: il backup
// è OneDrive, che tiene già le versioni. Serve come **fotografia**: il
// programma com'era il giorno in cui è stato mandato al cliente o discusso in
// riunione, con dentro le ore che valevano allora. Il documento non ha una
// cronologia — `putDriveJson` sovrascrive — quindi una fotografia si può solo
// prendere, e senza data nel nome due fotografie si coprono a vicenda.

/**
 * Il programma da conservare: il documento intero, più il giorno in cui è stato
 * preso. Rileggibile: è lo stesso schema che `normalizzaProgramma` accetta.
 * @param {DocProgramma} doc
 * @param {{ giorno?: string }} [opts]
 * @returns {{ nomeFile: string, dati: any }}
 */
export function esportazione(doc, opts = {}) {
  const giorno = opts.giorno || ymd();
  return {
    nomeFile: `${slug(doc.commessa.nome || 'programma')}-${giorno}.json`,
    dati: { ...doc, esportatoIl: giorno },
  };
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
