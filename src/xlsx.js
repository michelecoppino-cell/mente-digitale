// @ts-check
// Un file `.xlsx` vero, scritto a mano.
//
// Serviva perché il Programma esce dallo studio: la matrice si manda ai
// colleghi, e quello che i colleghi aprono è Excel. Un CSV non basta — perde i
// fogli, la riga dei mesi, i totali e il blocco dei riquadri, cioè tutto quello
// che rende leggibile una tabella da cinquanta colonne.
//
// **Senza librerie.** `xlsx` e `exceljs` pesano fra i 400 kB e il megabyte di
// JavaScript, e questa app si apre da un telefono: sarebbero il pacchetto più
// grosso dell'intero progetto per una cosa che si fa due volte al mese. Un
// `.xlsx` è uno zip di file XML, e le due parti che servono davvero — lo zip
// senza compressione e un foglio con le celle in chiaro — stanno in duecento
// righe che si leggono.
//
// **Niente compressione e niente sharedStrings.** Lo zip «store» è un'intestazione
// e i byte così come sono: nessun deflate da scrivere, e un file da qualche
// centinaio di kB che Excel apre uguale. Le stringhe stanno dentro la cella
// (`inlineStr`) invece che in una tabella a parte: la tabella condivisa serve a
// non ripetere le stesse parole mille volte, e qui le parole sono i nomi di
// dieci persone.
//
// Puro — da righe a byte, nessuna rete e nessun DOM — ed è per questo che si
// prova.

const codifica = new TextEncoder();

// ── Lo zip ──────────────────────────────────────────────────────────────────

/** La tabella del CRC32, calcolata una volta sola. @type {Uint32Array|null} */
let tabellaCrc = null;

/** @returns {Uint32Array} */
function crcTabella() {
  if (tabellaCrc) return tabellaCrc;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  tabellaCrc = t;
  return t;
}

/** @param {Uint8Array} dati @returns {number} */
export function crc32(dati) {
  const t = crcTabella();
  let c = 0xffffffff;
  for (let i = 0; i < dati.length; i++) c = t[(c ^ dati[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Uno zip «store»: i byte come sono, con davanti le intestazioni che dicono
 * quanto sono lunghi e che CRC hanno.
 * @param {{ nome: string, dati: Uint8Array }[]} voci
 * @returns {Uint8Array}
 */
export function zip(voci) {
  /** @type {Uint8Array[]} */
  const pezzi = [];
  /** @type {Uint8Array[]} */
  const indice = [];
  let posizione = 0;

  for (const { nome, dati } of voci) {
    const nomeBytes = codifica.encode(nome);
    const somma = crc32(dati);

    const testa = nuovoBlocco(30 + nomeBytes.length);
    testa.u32(0x04034b50);        // firma dell'intestazione locale
    testa.u16(20);                // versione minima
    testa.u16(0x0800);            // il nome del file è UTF-8
    testa.u16(0);                 // metodo: nessuna compressione
    testa.u16(0); testa.u16(0);   // ora e data: fisse, un .xlsx non le usa
    testa.u32(somma);
    testa.u32(dati.length);       // compresso
    testa.u32(dati.length);       // e non compresso: sono la stessa cosa
    testa.u16(nomeBytes.length);
    testa.u16(0);                 // niente campi extra
    testa.bytes(nomeBytes);
    pezzi.push(testa.fatto(), dati);

    const voce = nuovoBlocco(46 + nomeBytes.length);
    voce.u32(0x02014b50);         // firma della voce di indice
    voce.u16(20); voce.u16(20);
    voce.u16(0x0800); voce.u16(0);
    voce.u16(0); voce.u16(0);
    voce.u32(somma);
    voce.u32(dati.length); voce.u32(dati.length);
    voce.u16(nomeBytes.length);
    voce.u16(0); voce.u16(0);     // extra, commento
    voce.u16(0); voce.u16(0); voce.u32(0);
    voce.u32(posizione);          // dove comincia il file, contando da zero
    voce.bytes(nomeBytes);
    indice.push(voce.fatto());

    posizione += 30 + nomeBytes.length + dati.length;
  }

  const misuraIndice = indice.reduce((s, v) => s + v.length, 0);
  const coda = nuovoBlocco(22);
  coda.u32(0x06054b50);           // firma della fine dell'indice
  coda.u16(0); coda.u16(0);
  coda.u16(voci.length); coda.u16(voci.length);
  coda.u32(misuraIndice);
  coda.u32(posizione);
  coda.u16(0);

  return unisci([...pezzi, ...indice, coda.fatto()]);
}

/** Un blocco di byte scritti in ordine, little-endian come vuole lo zip. @param {number} misura */
function nuovoBlocco(misura) {
  const buf = new Uint8Array(misura);
  const vista = new DataView(buf.buffer);
  let i = 0;
  return {
    u16: (/** @type {number} */ v) => { vista.setUint16(i, v, true); i += 2; },
    u32: (/** @type {number} */ v) => { vista.setUint32(i, v, true); i += 4; },
    bytes: (/** @type {Uint8Array} */ b) => { buf.set(b, i); i += b.length; },
    fatto: () => buf,
  };
}

/** @param {Uint8Array[]} pezzi @returns {Uint8Array} */
function unisci(pezzi) {
  const misura = pezzi.reduce((s, p) => s + p.length, 0);
  const tutto = new Uint8Array(misura);
  let i = 0;
  for (const p of pezzi) { tutto.set(p, i); i += p.length; }
  return tutto;
}

// ── Il foglio ───────────────────────────────────────────────────────────────

/**
 * Una cella. `stile` è l'indice nella tavola qui sotto, e sono pochi apposta:
 * un foglio che si manda a un collega si legge per struttura — l'intestazione
 * in grassetto, i totali staccati — non per decorazione.
 *
 * @typedef {number|string|null} Valore
 * @typedef {{ v: Valore, s?: number }} Cella
 * @typedef {(Valore|Cella)[]} Riga
 */

/** Gli stili, nell'ordine in cui `styles.xml` li dichiara. */
export const STILE = {
  normale: 0,
  intestazione: 1,   // grassetto su fondo chiaro: la riga dei nomi di colonna
  ore: 2,            // numero con la mezz'ora quando c'è: 42,5 ma 15 e non 15,0
  totale: 3,         // grassetto e numero: le righe e le colonne di somma
  tenue: 4,          // grigio piccolo: la fascia dei mesi, le note
  titolo: 5,         // il nome della commessa in cima
  separatore: 6,     // fondo ocra, senza testo: la riga che stacca due gruppi
};

/** @param {string} s @returns {string} */
function xml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // I caratteri di controllo fanno rifiutare il file a Excel senza dire
    // perché: meglio perderli qui che scoprirlo dal collega.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** «A», «Z», «AA», «BX»: la lettera di colonna, che oltre la Z ha due cifre. @param {number} i */
export function lettera(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * @typedef {object} Foglio
 * @property {string} nome           il nome della linguetta
 * @property {Riga[]} righe
 * @property {number[]} [larghezze]  in caratteri, colonna per colonna
 * @property {{ riga?: number, colonna?: number }} [blocca]  quante righe e colonne restano ferme scorrendo
 */

/** @param {Riga} righe @param {number} r @returns {string} */
function rigaXml(righe, r) {
  const celle = righe.map((cella, c) => {
    const { v, s } = (cella && typeof cella === 'object' && 'v' in cella)
      ? cella
      : { v: /** @type {Valore} */ (cella), s: undefined };
    const rif = `${lettera(c)}${r + 1}`;
    const stile = s ? ` s="${s}"` : '';
    // Una cella vuota con uno stile si scrive lo stesso: è come si disegna una
    // riga di separazione — nessun testo, solo il fondo — e senza questo ramo
    // sparivano tutte insieme al loro contenuto, cioè la riga ocra non esisteva.
    // Senza stile invece non si scrive niente: un foglio pieno di celle vuote
    // dichiarate è solo peso.
    if (v === null || v === undefined || v === '') return s ? `<c r="${rif}"${stile}/>` : '';
    return typeof v === 'number' && Number.isFinite(v)
      ? `<c r="${rif}"${stile}><v>${v}</v></c>`
      : `<c r="${rif}"${stile} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  }).join('');
  return `<row r="${r + 1}">${celle}</row>`;
}

/** @param {Foglio} foglio @returns {string} */
function foglioXml(foglio) {
  const blocca = foglio.blocca;
  // Il blocco dei riquadri non è un vezzo: su cinquanta colonne, senza, si
  // scorre a destra e non si sa più di chi sia la riga che si sta leggendo —
  // che è esattamente il difetto che questa esportazione deve non avere.
  const vista = blocca
    ? `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="${blocca.colonna || 0}" ySplit="${blocca.riga || 0}" topLeftCell="${lettera(blocca.colonna || 0)}${(blocca.riga || 0) + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
  const colonne = foglio.larghezze?.length
    ? `<cols>${foglio.larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const righe = foglio.righe.map((riga, r) => rigaXml(riga, r)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${vista}${colonne}<sheetData>${righe}</sheetData></worksheet>`;
}

const STILI_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.##"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD4A44A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FFBBBBBB"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * I fogli in un file `.xlsx`.
 * @param {Foglio[]} fogli
 * @returns {Uint8Array}
 */
export function xlsx(fogli) {
  const nomi = fogli.map((f, i) => nomeFoglio(f.nome, i));
  const b = (/** @type {string} */ s) => codifica.encode(s);

  return zip([
    { nome: '[Content_Types].xml', dati: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`) },
    { nome: '_rels/.rels', dati: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
    { nome: 'xl/workbook.xml', dati: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${nomi.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`) },
    { nome: 'xl/_rels/workbook.xml.rels', dati: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`) },
    { nome: 'xl/styles.xml', dati: b(STILI_XML) },
    ...fogli.map((f, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dati: b(foglioXml(f)) })),
  ]);
}

/**
 * Il nome di una linguetta: Excel rifiuta il file — senza dire quale nome —
 * se contiene `: \ / ? * [ ]` o supera i 31 caratteri.
 * @param {string} nome
 * @param {number} i
 * @returns {string}
 */
export function nomeFoglio(nome, i) {
  const pulito = String(nome || '').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return pulito || `Foglio${i + 1}`;
}
