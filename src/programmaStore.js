// @ts-check
// I programmi di commessa su OneDrive: il registro, un documento per commessa,
// e le scritture che due dispositivi possono fare insieme.
//
//   programmi/_registro.json    l'elenco: id, nome, file, se è acceso
//   programmi/<slug>.json       una commessa intera
//
// **Un documento per commessa.** È l'unità che si apre, si legge e si salva
// tutta insieme: la matrice di una commessa da sei mesi con sei risorse sta in
// qualche decina di kB, e spezzarla per settimane vorrebbe dire inventare una
// concorrenza fra pezzi che si guardano sempre insieme.
//
// Qui non c'è nessuna regola sul contenuto: le regole stanno in `programma.js`,
// che non tocca la rete ed è il file su cui girano le prove. Questo modulo sa
// solo dove stanno i file e come si scrivono in due.
//
// Il flag `attivo` nel registro è la risposta a «un pannello dedicato solo per
// le commesse che seguo adesso»: la colonna di sinistra mostra quelle accese,
// le altre restano su disco e si riaccendono quando servono.

import {
  VERSIONE, FILE_REGISTRO, normalizzaProgramma, normalizzaRegistro,
  fileLibero, nuovoId, conCarico,
} from './programma.js';

/**
 * Come si arriva ai file. Lo stesso disegno di `taskStore.usaDrive()`: l'app
 * passa da `api.js`, il CLI e il server MCP da `scripts/mente-graph.mjs`, le
 * prove dal OneDrive finto — e le regole restano una copia sola.
 *
 * @typedef {object} Drive
 * @property {(percorso: string, seAssente: any) => Promise<any>} leggi
 * @property {(percorso: string, dati: any, opts?: { reapply?: (fresco: any) => any }) => Promise<any>} scrivi
 */

/** @type {Drive|null} */
let _drive = null;

/** @param {Drive} drive */
export function usaDrive(drive) { _drive = drive; }

/** @returns {Promise<Drive>} */
async function drive() {
  if (!_drive) {
    // Importare `api.js` da Node vorrebbe dire tirarsi dietro MSAL, che è roba
    // da browser: si carica solo quando serve davvero.
    const api = await import('./api.js');
    _drive = { leggi: api.getDriveJson, scrivi: api.putDriveJson };
  }
  return _drive;
}

/** @param {string} percorso @param {any} seAssente */
const leggiDoc = async (percorso, seAssente) => (await drive()).leggi(percorso, seAssente);
/** @param {string} percorso @param {any} dati @param {any} [opts] */
const scriviDoc = async (percorso, dati, opts) => (await drive()).scrivi(percorso, dati, opts);

/** @typedef {import('./programma.js').ProgrammaRegistrato} ProgrammaRegistrato */
/** @typedef {import('./programma.js').DocProgramma} DocProgramma */

const adesso = () => new Date().toISOString();

// ── Il registro ──────────────────────────────────────────────────────────────

/** @returns {Promise<{ version: number, programmi: ProgrammaRegistrato[] }>} */
export async function leggiRegistro() {
  return normalizzaRegistro(await leggiDoc(FILE_REGISTRO, null));
}

/**
 * @param {{ programmi: ProgrammaRegistrato[] }} registro
 * @param {{ reapply?: (fresco: any) => any }} [opts]
 */
export async function scriviRegistro(registro, opts) {
  return scriviDoc(FILE_REGISTRO, { version: VERSIONE, programmi: registro.programmi }, opts);
}

/**
 * Una commessa nuova, col suo documento già scritto.
 * @param {string} nome
 * @param {Partial<import('./programma.js').Commessa>} [commessa]
 * @returns {Promise<ProgrammaRegistrato>}
 */
export async function creaProgramma(nome, commessa = {}) {
  const registro = await leggiRegistro();
  /** @type {ProgrammaRegistrato} */
  const voce = {
    id: nuovoId(),
    nome,
    file: fileLibero(nome, registro.programmi),
    attivo: true,
    creatoIl: adesso(),
  };
  await scriviDoc(voce.file, normalizzaProgramma({ id: voce.id, commessa: { nome, ...commessa } }));
  await scriviRegistro({ programmi: [...registro.programmi, voce] }, {
    // Se un'altra commessa è nata da un altro dispositivo nel frattempo, la
    // nostra si aggiunge alle sue invece di cancellarle.
    reapply: fresco => {
      const base = normalizzaRegistro(fresco);
      if (base.programmi.some(p => p.id === voce.id)) return base;
      return { ...base, programmi: [...base.programmi, { ...voce, file: fileLibero(nome, base.programmi) }] };
    },
  });
  return voce;
}

/**
 * Cambia una riga del registro: il nome, o l'interruttore «attivo». Il file non
 * si rinomina — il registro sa dov'è, e rinominarlo non aggiunge niente e può
 * fallire per conto suo. È la stessa scelta di `taskStore.rinominaLista`.
 * @param {string} id
 * @param {Partial<ProgrammaRegistrato>} patch
 * @returns {Promise<ProgrammaRegistrato|null>}
 */
export async function aggiornaRegistrazione(id, patch) {
  const registro = await leggiRegistro();
  const applica = /** @param {ProgrammaRegistrato[]} elenco */ elenco =>
    elenco.map(p => (p.id === id ? { ...p, ...patch, id: p.id, file: p.file } : p));
  await scriviRegistro({ programmi: applica(registro.programmi) }, {
    reapply: fresco => ({ ...normalizzaRegistro(fresco), programmi: applica(normalizzaRegistro(fresco).programmi) }),
  });
  return applica(registro.programmi).find(p => p.id === id) || null;
}

/** @param {string} id @returns {Promise<ProgrammaRegistrato>} */
async function vocediRegistro(id) {
  const { programmi } = await leggiRegistro();
  const voce = programmi.find(p => p.id === id);
  if (!voce) throw new Error(`Programma sconosciuto: ${id}`);
  return voce;
}

// ── Il documento ─────────────────────────────────────────────────────────────

/** @param {string} id @returns {Promise<DocProgramma>} */
export async function leggiProgramma(id) {
  const voce = await vocediRegistro(id);
  return normalizzaProgramma(await leggiDoc(voce.file, null), { id });
}

/**
 * Una modifica al programma, scritta con la riapplicazione.
 *
 * `muta` è una funzione **pura** dal documento al documento: si applica al
 * documento appena letto e, se nel frattempo l'altro dispositivo ha scritto, di
 * nuovo su quello fresco. È così che le ore messe dal portatile non cancellano
 * la voce aggiunta dal telefono — e il motivo per cui da fuori non si passa mai
 * un documento intero già calcolato: quello, su un conflitto, non saprebbe
 * fondersi con niente.
 *
 * @param {string} id
 * @param {(doc: DocProgramma) => DocProgramma} muta
 * @returns {Promise<DocProgramma>}
 */
export async function cambiaProgramma(id, muta) {
  const voce = await vocediRegistro(id);
  const corrente = normalizzaProgramma(await leggiDoc(voce.file, null), { id });
  const nuovo = normalizzaProgramma(muta(corrente), { id });
  await scriviDoc(voce.file, nuovo, {
    reapply: (/** @type {any} */ fresco) => normalizzaProgramma(muta(normalizzaProgramma(fresco, { id })), { id }),
  });
  return nuovo;
}

/**
 * Le celle toccate da quando si è salvato l'ultima volta, in una sola scrittura.
 *
 * **L'unione è per chiave, non per documento**: il carico è una mappa piatta
 * apposta, quindi chi ha scritto da un altro dispositivo tiene le sue celle e
 * le nostre vincono solo dove abbiamo davvero messo le mani. Una cella a zero
 * si cancella dalla mappa invece di salvare uno zero — la mappa resta sparsa,
 * che è il motivo per cui ha questa forma.
 *
 * @param {string} id
 * @param {Record<string, number>} celle  chiave del carico → ore
 * @returns {Promise<DocProgramma>}
 */
export async function salvaCelle(id, celle) {
  const voci = Object.entries(celle);
  return cambiaProgramma(id, doc => voci.reduce((d, [chiave, ore]) => conCarico(d, chiave, ore), doc));
}
