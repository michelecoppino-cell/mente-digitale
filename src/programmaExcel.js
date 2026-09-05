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
  celleConsuntivo, chiaveCarico, settimaneDellaMatrice, oreSottoRiga, oreRisorsaSettimana, riepilogoPacchetti,
  alberoVoci, vociDiPacchetto, figlieDi, eFoglia, slug,
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
 * Le celle delle settimane di una riga, più il totale in coda.
 *
 * Lo stile resta anche sulle celle vuote: è la griglia, e a colonne alterne un
 * buco senza bordi si legge come la fine della tabella.
 *
 * @param {number[]} ore   le ore della riga, settimana per settimana
 * @returns {import('./xlsx.js').Cella[]}
 */
function celleOre(ore) {
  return [
    ...ore.map(o => ({ v: o || '', s: STILE.ore })),
    { v: ore.reduce((s, o) => s + o, 0) || '', s: STILE.ore },
  ];
}

/**
 * Una riga tutta ocra e senza testo, larga quanto la tabella: è quello che
 * stacca una persona dalla successiva, o una lavorazione dall'altra. Serve
 * perché un foglio da cinquanta colonne si legge scorrendo in orizzontale, e
 * senza una fascia piena il punto in cui finisce un gruppo si perde fra righe
 * che si somigliano tutte.
 * @param {number} quante  quante colonne ha la tabella
 * @returns {import('./xlsx.js').Riga}
 */
const separatore = quante => Array.from({ length: quante }, () => ({ v: '', s: STILE.separatore }));

/**
 * Le righe del foglio «Persone»: per ognuna una riga di totale, e sotto **una
 * riga per ogni lavoro in cui ha delle ore**, con pacchetto, Oggetto e Attività
 * scritti per esteso su quella stessa riga.
 *
 * **Perché una riga sola e non tre.** Prima il foglio ricalcava l'albero — una
 * riga per il pacchetto, una per l'Oggetto, una per l'Attività — e le prime due
 * erano quasi sempre vuote da parte a parte, perché i numeri stanno solo
 * nell'ultimo livello: tre righe per dire un dato, e su cinquanta settimane il
 * dato finiva a schermate di distanza dal nome del pacchetto che lo descrive.
 * Adesso le colonne si ripetono — due Attività dello stesso pacchetto scrivono
 * due volte pacchetto e Oggetto — ed è esattamente quello che rende la tabella
 * ordinabile e filtrabile in Excel, che è la cosa che con l'albero non si
 * poteva fare.
 *
 * **Quello che non è sceso fino in fondo tiene la sua riga.** Ore date al
 * pacchetto e che nessuna voce reclama, oppure date a un Oggetto senza scendere
 * su un'Attività: sono righe con le colonne di destra vuote, non ore da
 * spalmare su una voce scelta a caso. Indovinare è quello che qui non si fa, e
 * lasciarle fuori sarebbe peggio — sparirebbero dal foglio in silenzio.
 *
 * **Le righe di totale restano vuote nella colonna del pacchetto**, ed è quello
 * che le rende riconoscibili rientrando: una riga senza pacchetto è una somma,
 * e una somma non si reimporta — si ricalcola.
 *
 * È anche il foglio che rientra: chi corregge una settimana corregge il numero
 * che vede, e `leggiOreRegistrate` rilegge queste stesse righe.
 *
 * @param {DocProgramma} doc
 * @param {string[]} settimane
 * @param {string} settimanaOra
 * @returns {import('./xlsx.js').Riga[]}
 */
export function righeMatrice(doc, settimane, settimanaOra) {
  /** @type {import('./xlsx.js').Riga[]} */
  const righe = [];
  const larghezza = 4 + settimane.length + 1;

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

  // Chi non ha ore non compare, e il separatore lo sa: contare sull'indice
  // avrebbe messo una fascia ocra subito sotto l'intestazione ogni volta che la
  // prima persona dell'elenco non ha niente in queste settimane.
  let gia = false;
  for (const risorsa of doc.risorse) {
    // Le ore del pacchetto sono tutte le sue: quelle date al pacchetto e quelle
    // finite su una voce. Leggere la sola cella a tre segmenti faceva un foglio
    // in cui la riga di totale non era la somma di quelle sotto.
    const suoi = doc.pacchetti.filter(p => settimane.some(w => oreSottoRiga(doc, risorsa.nome, p.id, null, w) > 0));
    if (!suoi.length) continue;
    if (gia) righe.push(separatore(larghezza));
    gia = true;

    const totali = settimane.map(w => oreRisorsaSettimana(doc, risorsa.nome, w));
    righe.push([
      { v: risorsa.nome, s: STILE.totale },
      '', '', '',
      ...totali.map(o => ({ v: o || '', s: STILE.totale })),
      { v: totali.reduce((s, o) => s + o, 0) || '', s: STILE.totale },
    ]);

    for (const p of suoi) {
      // Due livelli e non di più: sotto l'Attività non c'è una quarta colonna, e
      // una sotto-sotto-voce resta contata dentro la sua — `oreSottoRiga` dà
      // sempre il totale del ramo, quindi la somma torna comunque.
      //
      // Solo il lavoro in cui questa persona ha davvero delle ore: l'elenco
      // completo delle voci è il foglio Voci, e ripeterlo sotto ogni persona
      // farebbe dieci volte le righe con dentro delle colonne vuote.
      const dettaglio = vociDiPacchetto(doc, p.id, 2)
        .map(({ voce, livello }) => ({
          voce,
          livello,
          ore: settimane.map(w => oreSottoRiga(doc, risorsa.nome, p.id, voce.id, w)),
        }))
        .filter(d => d.ore.some(o => o > 0));

      /** Quello che alla riga resta dopo le sue figlie, settimana per settimana.
       * @param {number[]} ore @param {{ ore: number[] }[]} figlie */
      const resto = (ore, figlie) => ore.map((o, i) => o - figlie.reduce((s, f) => s + f.ore[i], 0));

      const madri = dettaglio.filter(d => d.livello === 0);
      const orePacchetto = settimane.map(w => oreSottoRiga(doc, risorsa.nome, p.id, null, w));
      const restoPacchetto = resto(orePacchetto, madri);
      // Le ore rimaste sul pacchetto vengono per prime: sono il lavoro non
      // ancora descritto, e leggerle in cima dice subito quanto ne manca.
      if (restoPacchetto.some(o => o > 0)) righe.push(['', p.nome, '', '', ...celleOre(restoPacchetto)]);

      for (const madre of madri) {
        // Le figlie di una lavorazione sono le righe di secondo livello che la
        // seguono nell'albero: `vociDiPacchetto` le dà in ordine, madre e poi
        // figlie, ed è l'ordine in cui il foglio le scrive.
        const dopo = dettaglio.indexOf(madre) + 1;
        const figlie = [];
        for (let j = dopo; j < dettaglio.length && dettaglio[j].livello > 0; j++) figlie.push(dettaglio[j]);
        const restoMadre = resto(madre.ore, figlie);
        if (!figlie.length || restoMadre.some(o => o > 0)) {
          righe.push(['', p.nome, madre.voce.titolo, '', ...celleOre(figlie.length ? restoMadre : madre.ore)]);
        }
        for (const figlia of figlie) {
          righe.push(['', p.nome, madre.voce.titolo, figlia.voce.titolo, ...celleOre(figlia.ore)]);
        }
      }
    }
  }

  const perSettimana = settimane.map(w => doc.risorse.reduce((s, r) => s + oreRisorsaSettimana(doc, r.nome, w), 0));
  righe.push(separatore(larghezza));
  righe.push([
    { v: 'Totale settimana', s: STILE.totale },
    '', '', '',
    ...perSettimana.map(o => ({ v: o || '', s: STILE.totale })),
    { v: perSettimana.reduce((s, o) => s + o, 0) || '', s: STILE.totale },
  ]);
  return righe;
}

/**
 * Le righe del foglio «Voci»: l'elenco di cosa c'è da fare, in colonne che si
 * chiamano come quelle del foglio Persone — Pacchetto, Oggetto, Attività — così
 * che passando da un foglio all'altro la stessa cosa abbia lo stesso nome.
 *
 * **Cinque colonne e non dieci.** Ore iniziali, Δ, finestra e stato sono la
 * storia di una voce e il suo avanzamento: si guardano nell'app, dove si
 * cambiano. Qui erano quattro colonne che nessuno ordinava e che spingevano
 * fuori schermo l'unica domanda che si fa aprendo questo foglio — chi fa cosa,
 * per quante ore.
 *
 * Una fascia ocra stacca una lavorazione dall'altra: con le sotto-voci sotto la
 * loro madre, senza una riga piena in mezzo l'elenco è una colonna sola di
 * titoli in cui non si vede dove finisce un lavoro.
 *
 * @param {DocProgramma} doc
 * @returns {import('./xlsx.js').Riga[]}
 */
export function righeVoci(doc) {
  /** @type {import('./xlsx.js').Riga[]} */
  const righe = [[
    { v: 'Pacchetto', s: STILE.intestazione },
    { v: 'Oggetto', s: STILE.intestazione },
    { v: 'Attività', s: STILE.intestazione },
    { v: 'Ore', s: STILE.intestazione },
    { v: 'Persona', s: STILE.intestazione },
  ]];
  let gia = false;
  for (const { voce, livello } of alberoVoci(doc)) {
    const pacchetto = doc.pacchetti.find(p => p.id === voce.pacchettoId);
    const contenitore = !eFoglia(doc, voce.id);
    if (livello === 0) {
      if (gia) righe.push(separatore(5));
      gia = true;
    }
    righe.push([
      pacchetto?.nome || '',
      // Due colonne invece del rientro: in Excel un rientro non si filtra e non
      // si ordina, due colonne sì.
      livello === 0 ? voce.titolo : '',
      livello === 0 ? '' : voce.titolo,
      { v: voce.ore || '', s: contenitore ? STILE.totale : STILE.ore },
      // Più persone nella stessa cella, separate da virgola: è la forma in cui
      // l'incollato le rilegge.
      voce.risorse.join(', '),
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
  righe.push([{ v: 'Per rimandare indietro le ore vere: nel foglio Persone correggi le celle della settimana finita, poi selezionale con le colonne di sinistra e la riga delle settimane, copia e incolla in Programma › Matrice › Ore registrate.', s: STILE.tenue }]);
  return righe;
}

/**
 * Il libro intero. Tre fogli, in ordine di chi li apre: il Riepilogo è la
 * pagina che si guarda in riunione, le Persone sono quelle che tornano indietro
 * con le ore vere, le Voci sono l'elenco di cosa c'è da fare.
 *
 * @param {DocProgramma} doc
 * @param {{ settimanaOra?: string, settimane?: string[] }} [opts]
 * @returns {{ nomeFile: string, byte: Uint8Array }}
 */
export function libroProgramma(doc, opts = {}) {
  const ora = opts.settimanaOra || settimanaIso();
  const settimane = opts.settimane?.length ? opts.settimane : settimaneDellaMatrice(doc, ora);

  const byte = xlsx([
    {
      nome: 'Riepilogo',
      righe: righeRiepilogo(doc, ora),
      larghezze: [30, 8, 10, 10, 10, 10, 13],
    },
    {
      // «Persone» e non «Matrice»: il foglio è una riga per persona e per
      // lavoro, e la matrice — pacchetto per settimana — è un'altra cosa, che
      // sta a schermo.
      nome: 'Persone',
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
      righe: righeVoci(doc),
      larghezze: [24, 34, 34, 8, 16],
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
 * 1. **Il rettangolo del foglio Persone** — persona, pacchetto, Oggetto,
 *    Attività, e una colonna per settimana. È quello che esce
 *    dall'esportazione, quindi è il giro che si fa davvero: si esporta, si
 *    corregge una colonna, si rimanda indietro.
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
   * @param {boolean} [letterale]  la riga è già una cella sola, e non ne assorbe altre
   */
  const metti = (persona, pacchetto, settimana, ore, riga, voceId = null, letterale = false) => {
    const r = doc.risorse.find(x => uguale(x.nome, persona));
    const p = doc.pacchetti.find(x => uguale(x.nome, pacchetto));
    if (!r || !p) { ignorate.push(riga); return; }
    if (letterale) {
      // Nel foglio piatto ogni riga è **una cella e basta**: le ore non
      // attribuite a nessuna voce hanno la loro riga, e quelle di ogni voce la
      // loro. Farle assorbire — che è quello che serve quando la riga è il
      // totale del pacchetto — vorrebbe dire che la riga del solo pacchetto
      // butta via le ore delle righe di voce che le stanno accanto nello stesso
      // incollato, e viceversa: due righe dello stesso rettangolo che si
      // cancellano a vicenda, con l'ultima che vince.
      celle[chiaveCarico(r.nome, p.id, settimana, voceId)] = ore;
    } else {
      // Un consuntivo sostituisce: se quelle ore stanno su una voce si riscrive
      // quella cella, invece di aggiungerne una sul pacchetto — due celle per la
      // stessa settimana sarebbero la settimana contata due volte. Con una voce
      // la sostituzione è ristretta al suo ramo: le altre voci del pacchetto sono
      // un altro lavoro, e non le riguarda.
      Object.assign(celle, celleConsuntivo(doc, r.nome, p.id, settimana, ore, voceId));
    }
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

    // Le due forme del foglio, e si distinguono da una cosa sola: nel foglio
    // piatto di adesso pacchetto e Oggetto stanno **sulla stessa riga**, in
    // quello a scalini di prima non capitava mai. Serve saperlo perché nel
    // primo ogni riga è una cella e nel secondo le righe di sopra sono il
    // totale di quelle di sotto — e trattare le prime come le seconde vuol dire
    // che due righe dello stesso incollato si cancellano a vicenda.
    // `primaSettimana > 2` prima di tutto: in un rettangolo con le sole persona
    // e pacchetto davanti, la terza colonna è già una settimana, e senza questa
    // guardia ogni riga con delle ore passava per una riga piatta.
    const piatto = primaSettimana > 2 && corpo.some(r => r[1] && r[2]);

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

      // Una riga di somma non si rilegge: scriverebbe la stessa settimana due o
      // tre volte, che è il margine sbagliato che si scopre tre settimane dopo.
      //
      // Si riconosce da due cose insieme: la riga sotto è più profonda **e**
      // non ripete il pacchetto. Il secondo pezzo è quello che distingue le due
      // forme del foglio. In quella di prima l'albero si scriveva a scalini —
      // pacchetto, poi Oggetto, poi Attività, ognuno con le colonne di sinistra
      // vuote — e le righe di sopra erano l'eco di quelle sotto. In quella di
      // adesso ogni riga è già una foglia e ripete pacchetto e Oggetto per
      // esteso: guardare solo la profondità avrebbe buttato via la riga delle
      // ore lasciate sul pacchetto ogni volta che dopo di lei ne veniva una
      // descritta più a fondo, cioè quasi sempre.
      const sotto = corpo[i + 1];
      if (sotto && profondita(sotto) > prof && !sotto[1]) return;
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
        // Nel foglio piatto solo la riga dell'Attività è il totale di un ramo
        // (sotto di lei possono esserci sotto-voci che il foglio non mostra):
        // quelle sopra sono già la loro cella, e non devono assorbire niente.
        metti(persona, pacchetto, settimana, ore, riga.join(' | '), voceId, piatto && prof < 3);
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
