// @ts-check
// Il Programma che esce, e le ore vere che rientrano.
//
// **Perché esce.** Il programma di una commessa non è una cosa privata: si
// discute in riunione, si manda al capocommessa, si stampa. Finché l'unica
// uscita era un JSON con la data — la fotografia — l'unico modo di farlo vedere
// a un collega era fargli guardare lo schermo. Un `.xlsx` è il formato che tutti
// e dieci hanno già aperto stamattina.
//
// **Perché rientra.** Le ore davvero fatte non stanno qui: stanno nel foglio
// ore dello studio. Ribatterle a mano cinquanta celle per volta è il passaggio
// che fa smettere di aggiornare il programma, e un programma non aggiornato è
// peggio di nessun programma — dice un margine che non c'è. Quindi lo stesso
// foglio che esce rientra: si esporta, si corregge la colonna della settimana
// appena finita, si incolla.
//
// **Si incolla, non si carica.** Leggere un `.xlsx` vorrebbe dire scrivere un
// decompressore, cioè la metà difficile del formato — e servirebbe a far
// arrivare qui gli stessi numeri che il sistema operativo mette negli appunti
// appena si seleziona un rettangolo in Excel. Incollare è **più corto per chi
// lo fa** e non ha un formato da indovinare: è lo stesso gesto con cui in
// questa app entrano già le voci, le sotto-voci e i movimenti.
//
// **Un consuntivo sostituisce, non somma.** È la stessa regola di
// `conSpesoRipartito`: le ore vere di una settimana sono la risposta
// definitiva su quella settimana, e sommarle a quelle previste raddoppierebbe
// tutto ogni volta che si reincolla lo stesso foglio.
//
// Puro: da un documento a delle righe, e da del testo a delle celle. Nessuna
// rete, nessun React — è il file su cui girano le prove.

import { xlsx, STILE } from './xlsx.js';
import {
  celleConsuntivo, settimaneDellaMatrice, oreSottoRiga, oreRisorsaSettimana, riepilogoPacchetti,
  alberoVoci, vociDiPacchetto, figlieDi, eFoglia, statoVoce, ETICHETTE_STATO, slug,
} from './programma.js';
import { lunediDellaSettimana, meseDellaSettimana, settimanaIso, ymd } from './tempo.js';

/** @typedef {import('./programma.js').DocProgramma} DocProgramma */
/** @typedef {import('./programma.js').Voce} Voce */

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** @param {string} settimana 'YYYY-Www' */
const nomeMese = settimana => MESI[Number(meseDellaSettimana(settimana).slice(5, 7)) - 1] || '';

/** Il lunedì come si scrive in un'intestazione: `03/08`. @param {string} settimana */
const giornoBreve = settimana => {
  const l = lunediDellaSettimana(settimana);
  return `${l.slice(8)}/${l.slice(5, 7)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Il foglio che esce
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le celle delle settimane di una riga della matrice, più il totale in coda.
 *
 * Vuote quando le righe qui sotto dicono già le stesse ore: i numeri stanno
 * nell'ultima riga del ramo, e una riga che ha delle figlie a schermo è la loro
 * eco. «Già le stesse» settimana per settimana e non solo in totale — se le
 * figlie non coprono tutto (delle ore lasciate sul pacchetto che nessuna voce
 * reclama, per esempio) la riga i suoi numeri li tiene, altrimenti quelle ore
 * sparirebbero dal foglio in silenzio.
 *
 * Lo stile resta anche sulle celle vuote: è la griglia, e a colonne alterne un
 * buco senza bordi si legge come la fine della tabella.
 *
 * @param {number[]} ore                       le ore della riga, settimana per settimana
 * @param {{ ore: number[] }[]} figlie         le righe che le stanno sotto, se ce ne sono
 * @returns {import('./xlsx.js').Cella[]}
 */
function celleOre(ore, figlie) {
  const eco = figlie.length > 0
    && ore.every((o, i) => o === figlie.reduce((somma, f) => somma + f.ore[i], 0));
  return [
    ...ore.map(o => ({ v: eco ? '' : (o || ''), s: STILE.ore })),
    { v: eco ? '' : (ore.reduce((s, o) => s + o, 0) || ''), s: STILE.ore },
  ];
}

/**
 * Le righe del foglio «Matrice»: la stessa forma che ha a schermo — una riga di
 * totale per persona, sotto una riga per ogni pacchetto in cui ha ore, e sotto
 * ancora il lavoro descritto: l'**Oggetto** (la lavorazione di primo livello) e
 * l'**Attività** (la sua sotto-voce). Chi guarda il foglio in riunione chiede
 * «venti ore su B10 a fare cosa?», e finché le colonne erano due la risposta
 * stava solo nel foglio Voci, cioè su un'altra pagina e senza le settimane.
 *
 * **Le righe di totale restano vuote nella colonna del pacchetto**, ed è quello
 * che le rende riconoscibili rientrando: una riga senza pacchetto è una somma,
 * e una somma non si reimporta — si ricalcola.
 *
 * **I numeri stanno solo nell'ultima riga del ramo.** È la stessa regola della
 * matrice a schermo: pacchetto, Oggetto e Attività dicono le ore dello stesso
 * lavoro viste da tre altezze, e scritte tutte e tre diventavano tre righe
 * identiche incolonnate su venti settimane — il dato e le sue due eco, senza un
 * modo di distinguerli. Quindi una riga che ha sotto di sé delle figlie lascia
 * vuote le settimane e il totale, e le ore si leggono dove il lavoro è
 * descritto per esteso.
 *
 * L'eco si spegne solo quando è davvero un'eco: se le figlie mostrate non
 * coprono tutte le ore della riga — succede quando una persona ha delle ore
 * lasciate sul pacchetto che nessuna voce reclama — la riga i suoi numeri li
 * tiene, altrimenti quelle ore sparirebbero dal foglio senza che niente lo
 * dica.
 *
 * È anche la riga che rientra: chi corregge una settimana corregge il numero
 * che vede, e `leggiOreRegistrate` legge la riga più profonda di ogni ramo.
 *
 * @param {DocProgramma} doc
 * @param {string[]} settimane
 * @param {string} settimanaOra
 * @returns {import('./xlsx.js').Riga[]}
 */
export function righeMatrice(doc, settimane, settimanaOra) {
  /** @type {import('./xlsx.js').Riga[]} */
  const righe = [];

  // Tre righe di intestazione: il mese solo quando cambia (una fascia, come a
  // schermo), la settimana ISO — che è **la chiave**, e per questo si scrive
  // per esteso invece che «W36» — e il lunedì, che è come le settimane si
  // nominano parlando.
  righe.push(['', '', '', '', ...settimane.map((w, i) => (
    i === 0 || nomeMese(w) !== nomeMese(settimane[i - 1]) ? { v: nomeMese(w), s: STILE.tenue } : ''
  )), '']);
  righe.push([
    { v: 'Persona', s: STILE.intestazione },
    { v: 'Pacchetto', s: STILE.intestazione },
    { v: 'Oggetto', s: STILE.intestazione },
    { v: 'Attività', s: STILE.intestazione },
    ...settimane.map(w => ({ v: w, s: STILE.intestazione })),
    { v: 'Totale', s: STILE.intestazione },
  ]);
  righe.push(['', { v: 'lunedì', s: STILE.tenue }, '', '',
    ...settimane.map(w => ({ v: giornoBreve(w) + (w === settimanaOra ? ' ◂' : ''), s: STILE.tenue })), '']);

  for (const risorsa of doc.risorse) {
    // Le ore del pacchetto sono tutte le sue: quelle date al pacchetto e quelle
    // finite su una voce. Leggere la sola cella a tre segmenti faceva un foglio
    // in cui la riga di totale non era la somma di quelle sotto.
    const suoi = doc.pacchetti.filter(p => settimane.some(w => oreSottoRiga(doc, risorsa.nome, p.id, null, w) > 0));
    const totali = settimane.map(w => oreRisorsaSettimana(doc, risorsa.nome, w));
    righe.push([
      { v: risorsa.nome, s: STILE.totale },
      '', '', '',
      ...totali.map(o => ({ v: o || '', s: STILE.totale })),
      { v: totali.reduce((s, o) => s + o, 0) || '', s: STILE.totale },
    ]);
    for (const p of suoi) {
      const ore = settimane.map(w => oreSottoRiga(doc, risorsa.nome, p.id, null, w));
      // Il dettaglio si calcola prima delle righe che lo mostrano: per sapere se
      // la riga del pacchetto è ancora un dato o solo l'eco di quelle sotto,
      // bisogna già sapere quali sotto ci saranno.
      //
      // Due livelli e non di più: sotto l'Attività non c'è una terza colonna, e
      // una sotto-sotto-voce resta contata dentro la sua — `oreSottoRiga` dà
      // sempre il totale del ramo, quindi la somma torna comunque.
      const dettaglio = vociDiPacchetto(doc, p.id, 2)
        .map(({ voce, livello }) => ({
          voce,
          livello,
          ore: settimane.map(w => oreSottoRiga(doc, risorsa.nome, p.id, voce.id, w)),
        }))
        // Solo il lavoro in cui questa persona ha davvero delle ore: l'elenco
        // completo delle voci è il foglio Voci, e ripeterlo sotto ogni persona
        // farebbe dieci volte le righe con dentro delle colonne vuote.
        .filter(d => d.ore.some(o => o > 0));

      righe.push([
        '',
        p.nome,
        '', '',
        ...celleOre(ore, dettaglio.filter(d => d.livello === 0)),
      ]);
      dettaglio.forEach(({ voce, livello, ore: sue }, i) => {
        // Le figlie di una lavorazione sono le righe di secondo livello che la
        // seguono, fino alla prossima di primo: `vociDiPacchetto` dà l'albero in
        // ordine, madre e poi figlie, ed è l'ordine in cui il foglio le scrive.
        const figlie = [];
        if (livello === 0) {
          for (let j = i + 1; j < dettaglio.length && dettaglio[j].livello > 0; j++) figlie.push(dettaglio[j]);
        }
        righe.push([
          '',
          // Il pacchetto resta vuoto come il nome della persona: si eredita da
          // sopra, ed è anche quello che tiene queste righe fuori dal rientro
          // quando sono una somma.
          '',
          livello === 0 ? voce.titolo : '',
          livello === 0 ? '' : voce.titolo,
          ...celleOre(sue, figlie),
        ]);
      });
    }
  }

  const perSettimana = settimane.map(w => doc.risorse.reduce((s, r) => s + oreRisorsaSettimana(doc, r.nome, w), 0));
  righe.push([
    { v: 'Totale settimana', s: STILE.totale },
    '', '', '',
    ...perSettimana.map(o => ({ v: o || '', s: STILE.totale })),
    { v: perSettimana.reduce((s, o) => s + o, 0) || '', s: STILE.totale },
  ]);
  return righe;
}

/** @param {DocProgramma} doc @param {Set<string>} attivitaAperte @returns {import('./xlsx.js').Riga[]} */
function righeVoci(doc, attivitaAperte) {
  /** @type {import('./xlsx.js').Riga[]} */
  const righe = [[
    { v: 'Pacchetto', s: STILE.intestazione },
    { v: 'Lavorazione', s: STILE.intestazione },
    { v: 'Sotto-voce', s: STILE.intestazione },
    { v: 'Ore', s: STILE.intestazione },
    { v: 'Ore iniziali', s: STILE.intestazione },
    { v: 'Δ', s: STILE.intestazione },
    { v: 'Persona', s: STILE.intestazione },
    { v: 'Da', s: STILE.intestazione },
    { v: 'A', s: STILE.intestazione },
    { v: 'Stato', s: STILE.intestazione },
  ]];
  for (const { voce, livello } of alberoVoci(doc)) {
    const pacchetto = doc.pacchetti.find(p => p.id === voce.pacchettoId);
    const contenitore = !eFoglia(doc, voce.id);
    const stato = statoVoce(voce, attivitaAperte);
    righe.push([
      pacchetto?.nome || '',
      // Due colonne invece del rientro: in Excel un rientro non si filtra e non
      // si ordina, due colonne sì.
      livello === 0 ? voce.titolo : '',
      livello === 0 ? '' : voce.titolo,
      { v: voce.ore || '', s: contenitore ? STILE.totale : STILE.ore },
      { v: voce.oreIniziali || '', s: STILE.ore },
      { v: voce.ore - voce.oreIniziali || '', s: STILE.ore },
      // Più persone nella stessa cella, separate da virgola: è la forma in cui
      // l'incollato le rilegge.
      voce.risorse.join(', '),
      voce.finestra?.da || '',
      voce.finestra?.a || '',
      contenitore ? `${doc.voci.filter(v => v.padreId === voce.id).length} sotto-voci` : ETICHETTE_STATO[stato],
    ]);
  }
  return righe;
}

/** @param {DocProgramma} doc @param {string} settimanaOra @returns {import('./xlsx.js').Riga[]} */
function righeRiepilogo(doc, settimanaOra) {
  const { righe: perPacchetto, totale } = riepilogoPacchetti(doc, { settimanaOra });
  /** @type {import('./xlsx.js').Riga[]} */
  const righe = [
    [{ v: doc.commessa.nome, s: STILE.titolo }],
    [{ v: `${doc.commessa.codice || ''} · ${doc.commessa.oreVendute} ore vendute · fotografia del ${ymd()}`, s: STILE.tenue }],
    [],
    [
      { v: 'Pacchetto', s: STILE.intestazione },
      { v: 'Voci', s: STILE.intestazione },
      { v: 'Stimate', s: STILE.intestazione },
      { v: 'Speso', s: STILE.intestazione },
      { v: 'A finire', s: STILE.intestazione },
      { v: 'Programmate', s: STILE.intestazione },
      { v: 'A piano', s: STILE.intestazione },
      { v: 'Da collocare', s: STILE.intestazione },
    ],
  ];
  for (const r of perPacchetto) {
    righe.push([r.nome, r.voci,
      { v: r.stimate || '', s: STILE.ore }, { v: r.speso || '', s: STILE.ore },
      { v: r.aFinire || '', s: STILE.ore }, { v: r.programmate || '', s: STILE.ore },
      { v: r.aPiano || '', s: STILE.ore },
      { v: r.daCollocare || '', s: STILE.ore }]);
  }
  righe.push([
    { v: 'Tutta la commessa', s: STILE.totale },
    { v: doc.voci.filter(v => !v.scartata && eFoglia(doc, v.id)).length, s: STILE.totale },
    { v: totale.stimate, s: STILE.totale }, { v: totale.speso, s: STILE.totale },
    { v: totale.aFinire, s: STILE.totale }, { v: totale.programmate, s: STILE.totale },
    { v: totale.aPiano, s: STILE.totale },
    { v: totale.daCollocare, s: STILE.totale },
  ]);
  righe.push([]);
  righe.push([{ v: 'Vendute', s: STILE.intestazione }, { v: doc.commessa.oreVendute, s: STILE.ore }]);
  // Il margine si misura sulla previsione — speso più quello che le stime dicono
  // che manca — e non sulle celle: la programmazione non si fa mai fino in
  // fondo, e misurarlo lì darebbe un margine che migliora smettendo di
  // programmare.
  righe.push([{ v: 'Speso + a finire', s: STILE.intestazione }, { v: totale.previsione, s: STILE.ore }]);
  righe.push([{ v: 'Margine', s: STILE.totale }, { v: totale.margine, s: STILE.totale }]);
  righe.push([]);
  righe.push([{ v: 'Per rimandare indietro le ore vere: nel foglio Matrice correggi le celle della settimana finita, poi selezionale con le colonne di sinistra e la riga delle settimane, copia e incolla in Programma › Matrice › Ore registrate.', s: STILE.tenue }]);
  return righe;
}

/**
 * Il libro intero. Tre fogli, in ordine di chi li apre: il Riepilogo è la
 * pagina che si guarda in riunione, la Matrice è quella che torna indietro con
 * le ore vere, le Voci sono l'elenco di cosa c'è da fare.
 *
 * @param {DocProgramma} doc
 * @param {{ settimanaOra?: string, settimane?: string[], attivitaAperte?: Set<string> }} [opts]
 * @returns {{ nomeFile: string, byte: Uint8Array }}
 */
export function libroProgramma(doc, opts = {}) {
  const ora = opts.settimanaOra || settimanaIso();
  const settimane = opts.settimane?.length ? opts.settimane : settimaneDellaMatrice(doc, ora);
  const aperte = opts.attivitaAperte || new Set();

  const byte = xlsx([
    {
      nome: 'Riepilogo',
      righe: righeRiepilogo(doc, ora),
      larghezze: [30, 8, 10, 10, 10, 10, 13],
    },
    {
      nome: 'Matrice',
      righe: righeMatrice(doc, settimane, ora),
      // Le colonne di sinistra larghe, le settimane strette: è la stessa
      // proporzione che rende leggibile la matrice a schermo.
      larghezze: [22, 26, 26, 24, ...settimane.map(() => 7.5), 9],
      // Sotto le tre righe di intestazione e a destra delle quattro colonne che
      // dicono di chi è la riga: scorrendo su cinquanta colonne restano fermi il
      // nome, il pacchetto e la settimana.
      blocca: { riga: 3, colonna: 4 },
    },
    {
      nome: 'Voci',
      righe: righeVoci(doc, aperte),
      larghezze: [24, 34, 34, 8, 10, 7, 12, 10, 10, 14],
      blocca: { riga: 1, colonna: 0 },
    },
  ]);

  return { nomeFile: `${slug(doc.commessa.nome || 'programma')}-${ymd()}.xlsx`, byte };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le ore che rientrano
// ─────────────────────────────────────────────────────────────────────────────

/** «12,5», «12.5 h», « 8 »: come le scrive chi tiene il foglio ore. @param {string} testo */
function oreScritte(testo) {
  const pulito = String(testo ?? '').trim().replace(',', '.').replace(/\s*h$/i, '');
  if (pulito === '') return null;
  if (!/^\d+(\.\d+)?$/.test(pulito)) return null;
  return Math.round(Number(pulito) * 2) / 2;
}

/**
 * Riconosce una settimana comunque sia scritta in un'intestazione: `2026-W36`
 * (com'esce), `W36` o `36` (come si abbrevia a mano), `03/08/2026` o
 * `2026-08-03` (se qualcuno ha messo la data del lunedì).
 *
 * Le forme senza anno si risolvono **contro le settimane della matrice**: un
 * `W36` da solo sarebbe di cinquant'anni diversi, dentro un orizzonte no.
 *
 * @param {string} testo
 * @param {string[]} note  le settimane che questo programma conosce
 * @returns {string|null}
 */
export function interpretaSettimana(testo, note) {
  const t = String(testo ?? '').trim();
  if (!t) return null;

  const piena = t.match(/(\d{4})-?W(\d{1,2})/i);
  if (piena) return `${piena[1]}-W${piena[2].padStart(2, '0')}`;

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return settimanaIso(`${iso[1]}-${iso[2]}-${iso[3]}`);

  // `03/08` e `03/08/2026`: giorno prima del mese, come si scrive qui.
  const italiana = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/);
  if (italiana) {
    const [, gg, mm, aa] = italiana;
    const anni = aa
      ? [aa.length === 2 ? `20${aa}` : aa]
      // Senza anno si prova con quelli dell'orizzonte: a cavallo di dicembre
      // sono due, e la settimana giusta è quella che ci sta dentro.
      : [...new Set(note.map(w => w.slice(0, 4)))];
    for (const anno of anni) {
      const w = settimanaIso(`${anno}-${mm.padStart(2, '0')}-${gg.padStart(2, '0')}`);
      if (!aa && !note.includes(w)) continue;
      return w;
    }
    return null;
  }

  const nuda = t.match(/^W?(\d{1,2})$/i);
  if (nuda) {
    const numero = nuda[1].padStart(2, '0');
    return note.find(w => w.slice(6) === numero) || null;
  }
  return null;
}

/**
 * @typedef {object} LetturaOre
 * @property {Record<string, number>} celle        chiave del carico → ore, pronte per `conCarico`
 * @property {string[]} settimane                  quelle riconosciute nell'intestazione, in ordine
 * @property {string[]} persone                    quelle toccate
 * @property {string[]} ignorate                   le righe che non si sono capite, per dirlo
 * @property {number} sostituite                   quante celle cambiano davvero
 */

/**
 * Le ore vere, incollate. Due forme, e si riconoscono da sole:
 *
 * 1. **Il rettangolo della matrice** — persona, pacchetto, e una colonna per
 *    settimana. È quello che esce dall'esportazione, quindi è il giro che si fa
 *    davvero: si esporta, si corregge una colonna, si rimanda indietro.
 * 2. **Righe sciolte** `persona | pacchetto | settimana | ore` — quello che
 *    esce da un gestionale, o che si scrive a mano per tre correzioni.
 *
 * Quello che non si capisce **non si indovina**: torna in `ignorate` e si
 * mostra. Una riga persa in silenzio, in un consuntivo, è un margine sbagliato
 * che nessuno sa da dove venga.
 *
 * @param {DocProgramma} doc
 * @param {string} testo
 * @param {{ settimane?: string[] }} [opts]
 * @returns {LetturaOre}
 */
export function leggiOreRegistrate(doc, testo, opts = {}) {
  const note = opts.settimane?.length ? opts.settimane : settimaneDellaMatrice(doc);
  const righe = String(testo || '').split(/\r?\n/).map(r => r.split('\t').map(c => c.trim()));

  /** @type {Record<string, number>} */
  const celle = {};
  /** @type {string[]} */
  const ignorate = [];
  const persone = new Set();
  const settimaneViste = new Set();

  // L'intestazione. Non per forza la prima riga incollata: chi seleziona in
  // Excel si porta dietro la fascia dei mesi, o parte una riga più su.
  //
  // **Due settimane non bastano come indizio**, e il perché è un difetto vero
  // trovato provando: in una riga sciolta `Marco | B10 | 2026-W12 | 18` il
  // numero delle ore — `18` — è anche un modo legittimo di scrivere la W18, e
  // dentro un orizzonte di cinquanta settimane la W18 esiste. Quella riga
  // passava per un'intestazione, e da lì in poi si leggeva il rettangolo che
  // non c'era: nessun errore, nessuna cella scritta.
  //
  // Quindi contano solo le forme che **non possono** essere altro (`2026-W12`,
  // o una data): due di quelle, oppure tre settimane di qualunque forma — che è
  // più colonne di quante ne abbia una riga sciolta.
  let intestazione = -1;
  /** @type {string[]} */
  let colonne = [];
  righe.forEach((riga, i) => {
    if (intestazione >= 0) return;
    const lette = riga.map(c => interpretaSettimana(c, note));
    const quante = lette.filter(Boolean).length;
    const sicure = riga.filter(c => /\d{4}-?W\d{1,2}/i.test(c) || /^\d{4}-\d{2}-\d{2}/.test(c)
      || /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(c)).length;
    if (sicure >= 2 || quante >= 3) { intestazione = i; colonne = /** @type {string[]} */ (lette); }
  });

  /**
   * @param {string} persona @param {string} pacchetto @param {string} settimana
   * @param {number} ore @param {string} riga @param {string|null} [voceId]
   */
  const metti = (persona, pacchetto, settimana, ore, riga, voceId = null) => {
    const r = doc.risorse.find(x => uguale(x.nome, persona));
    const p = doc.pacchetti.find(x => uguale(x.nome, pacchetto));
    if (!r || !p) { ignorate.push(riga); return; }
    // Un consuntivo sostituisce: se quelle ore stanno su una voce si riscrive
    // quella cella, invece di aggiungerne una sul pacchetto — due celle per la
    // stessa settimana sarebbero la settimana contata due volte. Con una voce
    // la sostituzione è ristretta al suo ramo: le altre voci del pacchetto sono
    // un altro lavoro, e non le riguarda.
    Object.assign(celle, celleConsuntivo(doc, r.nome, p.id, settimana, ore, voceId));
    persone.add(r.nome);
    settimaneViste.add(settimana);
  };

  /**
   * La voce descritta da una catena di titoli — `['Fondazioni corpo A',
   * 'Plinti']` — dentro un pacchetto. Si scende un livello per volta invece di
   * cercare il titolo ovunque: due pacchetti possono avere tutti e due una
   * lavorazione «Casseri», e indovinare quale è esattamente quello che qui non
   * si fa.
   * @param {string} pacchettoId @param {string[]} titoli
   * @returns {import('./programma.js').Voce|null}
   */
  const voceDescritta = (pacchettoId, titoli) => {
    /** @type {import('./programma.js').Voce|null} */
    let corrente = null;
    for (const titolo of titoli) {
      /** @type {import('./programma.js').Voce[]} */
      const candidate = corrente
        ? figlieDi(doc, corrente.id)
        : vociDiPacchetto(doc, pacchettoId, 1).map(x => x.voce);
      const trovata = candidate.find(v => uguale(v.titolo, titolo));
      if (!trovata) return null;
      corrente = trovata;
    }
    return corrente;
  };

  if (intestazione >= 0) {
    // Dove cominciano le settimane: nel foglio che esce sono la quinta colonna
    // (persona, pacchetto, oggetto, attività), ma un rettangolo selezionato a
    // mano — o esportato da una versione di prima — ne ha davanti due o tre.
    const primaSettimana = colonne.findIndex(Boolean);
    const corpo = righe.slice(intestazione + 1).filter(r => r.some(c => c));

    // Quanto è profonda una riga: 0 la somma di una persona, 1 il pacchetto, 2
    // l'Oggetto, 3 l'Attività. È l'ultima colonna descrittiva che ha riempito.
    /** @param {string[]} riga */
    const profondita = (riga) => {
      let quanto = 0;
      for (let c = 1; c < Math.max(primaSettimana, 2); c++) if (riga[c]) quanto = c;
      return quanto;
    };

    let persona = '';
    let pacchetto = '';
    /** i titoli delle colonne descrittive, uno per livello, ereditati come la persona
     * @type {string[]} */
    let titoli = [];

    corpo.forEach((riga, i) => {
      // La persona e il pacchetto si scrivono una volta sola, in cima al loro
      // gruppo: le righe sotto li ereditano, ed è così che escono dal foglio.
      if (riga[0]) { persona = riga[0]; pacchetto = ''; titoli = []; }
      if (riga[1]) { pacchetto = riga[1]; titoli = []; }
      const prof = profondita(riga);
      for (let c = 2; c < primaSettimana; c++) {
        if (!riga[c]) continue;
        titoli = titoli.slice(0, c - 2);
        titoli.push(riga[c]);
      }

      // Le ore stanno nell'ultima riga di ogni ramo — è come le scrive il
      // foglio che esce. Una riga che ne ha sotto una più profonda è la loro
      // somma: rileggerla scriverebbe la stessa settimana due o tre volte, che
      // è il margine sbagliato che si scopre tre settimane dopo. Vale anche per
      // i fogli esportati da una versione di prima, dove la somma i numeri li
      // portava: si legge il dettaglio, che dice le stesse ore più a fondo.
      const sotto = corpo[i + 1];
      if (sotto && profondita(sotto) > prof) return;
      // Una riga senza pacchetto è la somma di una persona: si ricalcola, non
      // si reimporta. Reimportarla scriverebbe il totale dentro un pacchetto.
      if (!prof || !pacchetto) return;
      if (/^totale/i.test(persona) || /^totale/i.test(pacchetto)) return;

      // Sotto il pacchetto, la voce di cui la riga parla. Se il titolo non si
      // riconosce le ore non si scaricano sul pacchetto: sarebbero attribuite a
      // un lavoro che nessuno ha scelto, e in un consuntivo è peggio di una
      // riga mancante — che almeno si vede.
      const p = doc.pacchetti.find(x => uguale(x.nome, pacchetto));
      /** @type {string|null} */
      let voceId = null;
      if (prof > 1) {
        const voce = p ? voceDescritta(p.id, titoli) : null;
        if (!voce) { ignorate.push(riga.join(' | ')); return; }
        voceId = voce.id;
      }

      let scritta = false;
      for (let c = 2; c < riga.length; c++) {
        const settimana = colonne[c];
        if (!settimana) continue;
        const ore = oreScritte(riga[c]);
        // Una cella lasciata vuota **non azzera**: chi corregge una settimana
        // seleziona tutto il rettangolo, e le altre colonne sono vuote perché
        // non le ha toccate, non perché quelle ore non ci siano più.
        if (ore === null) continue;
        metti(persona, pacchetto, settimana, ore, riga.join(' | '), voceId);
        scritta = true;
      }
      if (!scritta) ignorate.push(riga.join(' | '));
    });
  } else {
    // Forma 2: righe sciolte, quattro colonne. Anche con le barre verticali,
    // come tutto il resto di questo progetto.
    for (const riga of String(testo || '').split(/\r?\n/)) {
      if (!riga.trim()) continue;
      const campi = riga.split(/\t|\|/).map(c => c.trim());
      if (campi.length < 4) { ignorate.push(riga); continue; }
      const [persona, pacchetto, quando, quante] = campi;
      const settimana = interpretaSettimana(quando, note);
      const ore = oreScritte(quante);
      if (!settimana || ore === null) { ignorate.push(riga); continue; }
      metti(persona, pacchetto, settimana, ore, riga);
    }
  }

  const sostituite = Object.entries(celle).filter(([k, o]) => (doc.carico[k] || 0) !== o).length;
  return {
    celle,
    settimane: [...settimaneViste].sort(),
    persone: [...persone].sort((a, b) => a.localeCompare(b, 'it')),
    ignorate,
    sostituite,
  };
}

/**
 * Nomi che combaciano anche se scritti diversamente: «MARCO» e «Marco», o un
 * pacchetto rientrato da Excel con uno spazio in più. Non oltre — due persone
 * diverse non si fondono per somiglianza.
 * @param {string} a @param {string} b
 */
function uguale(a, b) {
  return String(a || '').trim().toLowerCase().replace(/\s+/g, ' ')
    === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Quanto cambia, in ore, rispetto a quello che c'è adesso: è il numero che si
 * mostra prima di applicare. «Sto per spostare il piano di 40 ore» è la sola
 * domanda a cui bisogna poter rispondere prima di premere.
 * @param {DocProgramma} doc
 * @param {Record<string, number>} celle
 * @returns {{ prima: number, dopo: number }}
 */
export function differenza(doc, celle) {
  let prima = 0;
  let dopo = 0;
  for (const [chiave, ore] of Object.entries(celle)) {
    prima += doc.carico[chiave] || 0;
    dopo += ore;
  }
  return { prima, dopo };
}
