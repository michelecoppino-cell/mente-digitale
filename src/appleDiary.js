// @ts-check
// Lettura dell'esportazione del Diario di Apple: solo logica pura, nessun
// accesso al disco e nessuna chiamata di rete.
//
// Sta in src/ e non in scripts/ perché la usano in due: lo script da PC
// (`scripts/importa-diario-apple.mjs`) e l'importazione dentro l'app, che gira
// sul telefono. Un solo parser per entrambi significa che una voce importata
// dall'iPhone e la stessa voce importata dal PC producono lo stesso risultato,
// stesso id compreso — che è la ragione per cui rifare l'import non duplica
// niente.
//
// L'export di Apple è una pagina HTML per voce generata da Cocoa: struttura
// fissa e prevedibile (pageHeader, reflectionPrompt, assetGrid, title,
// bodyText), che è il motivo per cui qui bastano delle regex e non serve un
// parser HTML vero.

/** @typedef {{ id: string, tipi: string[], html: string, file: string|null, didascalia: string, quando: number|null }} AppleAsset */
/** @typedef {{ nome: string, data: string|null, titolo: string, domanda: string, testo: string, asset: AppleAsset[] }} AppleVoce */

// ── ZIP ─────────────────────────────────────────────────────────────────────

/**
 * Scompatta uno zip in memoria.
 *
 * Scritto a mano invece di appoggiarsi a una libreria o a un comando di
 * sistema: il `tar` di Linux non legge gli zip, `unzip` non è installato
 * ovunque, e nel browser non c'è niente del genere. Uno zip è un elenco in
 * fondo al file (la "central directory") che punta ai dati compressi: si legge
 * quello e si scompatta voce per voce.
 *
 * La decompressione arriva da fuori perché i due mondi la fanno in modo
 * diverso: `zlib.inflateRawSync` su Node, `DecompressionStream` nel browser.
 *
 * @param {Uint8Array} bytes
 * @param {(compresso: Uint8Array) => Uint8Array|Promise<Uint8Array>} inflateRaw
 * @returns {Promise<Map<string, Uint8Array>>} percorso nello zip → contenuto
 */
export async function unzip(bytes, inflateRaw) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Map<string, Uint8Array>} */
  const out = new Map();

  // Fine della central directory: firma 0x06054b50, cercata dal fondo perché
  // può avere in coda un commento di lunghezza variabile.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Non sembra un file .zip valido.');

  const nVoci = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const nomi = new TextDecoder('utf-8');

  for (let i = 0; i < nVoci; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const dimCompressa = dv.getUint32(p + 20, true);
    const lunNome = dv.getUint16(p + 28, true);
    const lunExtra = dv.getUint16(p + 30, true);
    const lunCommento = dv.getUint16(p + 32, true);
    const offsetLocale = dv.getUint32(p + 42, true);
    const nome = nomi.decode(bytes.subarray(p + 46, p + 46 + lunNome));
    p += 46 + lunNome + lunExtra + lunCommento;

    // I metadati di macOS non servono a niente qui.
    if (nome.endsWith('/') || nome.startsWith('__MACOSX/') || nome.split('/').pop()?.startsWith('._')) continue;

    // L'intestazione locale ripete nome ed extra con lunghezze proprie: i dati
    // cominciano dopo quelle, non dopo quelle della central directory.
    const lunNomeL = dv.getUint16(offsetLocale + 26, true);
    const lunExtraL = dv.getUint16(offsetLocale + 28, true);
    const inizio = offsetLocale + 30 + lunNomeL + lunExtraL;
    const dati = bytes.subarray(inizio, inizio + dimCompressa);

    out.set(nome, metodo === 0 ? dati : await inflateRaw(dati));
  }
  return out;
}

// ── Da HTML a testo ─────────────────────────────────────────────────────────

/** @type {Record<string, string>} */
const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** @param {string} s @returns {string} */
function decodifica(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (intero, corpo) => {
    if (corpo[0] === '#') {
      const code = corpo[1] === 'x' || corpo[1] === 'X'
        ? parseInt(corpo.slice(2), 16)
        : parseInt(corpo.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : intero;
    }
    return ENTITA[corpo.toLowerCase()] ?? intero;
  });
}

/** Testo leggibile da un frammento HTML, conservando righe ed elenchi.
 *  @param {string} frammento @returns {string} */
export function testo(frammento) {
  return decodifica(
    frammento
      // Gli a capo che Cocoa mette *fra* i tag non sono testo: contarli
      // aggiunge una riga vuota fra un elemento di elenco e il successivo.
      .replace(/>\s+</g, '><')
      .replace(/<br\s*\/?>/gi, '\n')
      // Elenchi: una riga per voce, senza righe vuote in mezzo. L'a capo lo
      // mette l'apertura del `<li>`, quindi la chiusura non deve aggiungerne
      // un altro.
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<blockquote[^>]*>/gi, '\n> ')
      // I paragrafi invece restano staccati: è così che si leggeva la voce
      // sull'iPhone, ed è quello che rende rileggibile un testo lungo.
      .replace(/<\/(p|div|ul|ol|blockquote|h\d)>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Testo di un `<div class="…">…</div>` non annidato.
 *  @param {string} html @param {string} classe @returns {string} */
function divTesto(html, classe) {
  const re = new RegExp(`<div[^>]*class=["']${classe}["'][^>]*>([\\s\\S]*?)</div>`, 'i');
  const m = html.match(re);
  return m ? testo(m[1]) : '';
}

// ── Date ────────────────────────────────────────────────────────────────────

const MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** 'giovedì 11 giugno 2026' → '2026-06-11'
 *  @param {string} intestazione @returns {string|null} */
function dataDaIntestazione(intestazione) {
  const m = intestazione.toLowerCase().match(/(\d{1,2})\s+([a-zàéèìòù]+)\s+(\d{4})/);
  if (!m) return null;
  const mese = MESI.indexOf(m[2]);
  if (mese < 0) return null;
  const p = /** @param {number} n */ n => String(n).padStart(2, '0');
  return `${m[3]}-${p(mese + 1)}-${p(Number(m[1]))}`;
}

// Apple conta i secondi dal 1° gennaio 2001: è il timestamp che accompagna le
// foto nei file .json di Resources, e l'unico modo di sapere a che ora della
// giornata è stata scritta una voce.
const EPOCA_APPLE = Date.UTC(2001, 0, 1);

/** @param {number} secondi @returns {Date} */
export function dataDaAppleEpoch(secondi) {
  return new Date(EPOCA_APPLE + secondi * 1000);
}

/** 'YYYY-MM-DD' nel fuso locale, come fa il resto del Diario.
 *  @param {Date} d @returns {string} */
function giornoLocale(d) {
  const p = /** @param {number} n */ n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Allegati ────────────────────────────────────────────────────────────────

export const TIPI_FOTO = new Set(['assetType_photo', 'assetType_livePhoto']);

/** @param {AppleAsset} a @returns {boolean} */
export function eFoto(a) {
  return a.tipi.some(t => TIPI_FOTO.has(t));
}

/** @param {AppleAsset} a @returns {boolean} */
export function eVideo(a) {
  return a.tipi.includes('assetType_video') || /\.(mov|mp4|m4v)$/i.test(a.file || '');
}

/**
 * Ritaglia i singoli riquadri della griglia degli allegati. Ogni riquadro
 * comincia con `<div id="UUID" class="gridItem …">`: si spezza lì invece di
 * cercare la chiusura, che è annidata e cambia da tipo a tipo.
 * @param {string} grigliaHtml
 */
function ritagliaAsset(grigliaHtml) {
  const inizio = /<div id="([^"]+)" class="gridItem ([^"]*)"/g;
  /** @type {{ id: string, classi: string, da: number }[]} */
  const punti = [];
  let m;
  while ((m = inizio.exec(grigliaHtml))) punti.push({ id: m[1], classi: m[2], da: m.index });
  return punti.map((p, i) => ({
    id: p.id,
    tipi: p.classi.split(/\s+/).filter(c => c.startsWith('assetType_')),
    html: grigliaHtml.slice(p.da, i + 1 < punti.length ? punti[i + 1].da : undefined),
  }));
}

/** Didascalia da quello che iOS ha disegnato sopra il riquadro.
 *  @param {{ html: string }} asset @param {any} meta */
function didascaliaAsset(asset, meta) {
  const pezzi = [
    divTesto(asset.html, 'activityType'),
    divTesto(asset.html, 'gridItemOverlayHeader'),
    divTesto(asset.html, 'activityMetrics').replace(/\s*·\s*/g, ' · '),
    divTesto(asset.html, 'gridItemOverlayFooter'),
  ].filter(Boolean);

  // Le mappe portano i luoghi in un .json a fianco, non nell'HTML.
  if (meta?.visits?.length) {
    const luoghi = [...new Set(meta.visits.map(/** @param {any} v */ v => v.placeName || v.city).filter(Boolean))];
    if (luoghi.length) pezzi.push(luoghi.join(', '));
  }
  return [...new Set(pezzi)].join(' · ');
}

// ── Lettura di una voce ─────────────────────────────────────────────────────

/**
 * @param {string} html      contenuto del file della voce
 * @param {string} nome      nome del file senza estensione (usato per l'id)
 * @param {(assetId: string) => any} sidecar  legge il .json a fianco di un allegato
 * @returns {AppleVoce}
 */
export function leggiVoce(html, nome, sidecar) {
  const corpo = html.split('<body>')[1] || html;

  const intestazione = divTesto(corpo, 'pageHeader');
  const data = dataDaIntestazione(intestazione) || (nome.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null);

  const griglia = corpo.match(/<div class="assetGrid">([\s\S]*?)<div class=['"]title['"]/i);
  const asset = (griglia ? ritagliaAsset(griglia[1]) : []).map(a => {
    const meta = sidecar(a.id);
    return {
      ...a,
      file: a.html.match(/src="\.\.\/Resources\/([^"]+)"/)?.[1] || null,
      didascalia: didascaliaAsset(a, meta),
      quando: typeof meta?.date === 'number' ? meta.date : null,
    };
  });

  return {
    nome,
    data,
    titolo: divTesto(corpo, 'title'),
    domanda: divTesto(corpo, 'reflectionPrompt'),
    testo: testo(corpo.split(/<div class=['"]bodyText['"]>/i)[1] || ''),
    asset,
  };
}

/**
 * Il Diario non ha un campo titolo: quello di Apple diventa la prima riga,
 * che è poi come lo si leggeva sull'iPhone.
 * @param {AppleVoce} voce @returns {string}
 */
export function testoVoce(voce) {
  return [voce.titolo, voce.testo].filter(t => t && t.trim()).join('\n\n');
}

/**
 * Ora del giorno: quella della prima foto, ma solo se è dello stesso giorno
 * della voce. Capita spesso di allegare la foto di ieri a quello che si scrive
 * oggi, e un orario preso da lì manderebbe la voce in timeline nel giorno
 * sbagliato. Altrimenti mezzogiorno: un'ora neutra è più onesta di una
 * precisione che l'export non ha.
 * @param {AppleVoce} voce @returns {string} ISO
 */
export function tsVoce(voce) {
  const scatti = voce.asset
    .map(a => a.quando)
    .filter(/** @returns {q is number} */ q => typeof q === 'number')
    .map(dataDaAppleEpoch)
    .filter(d => giornoLocale(d) === voce.data)
    .sort((a, b) => +a - +b);
  return (scatti[0] || new Date(`${voce.data}T12:00:00`)).toISOString();
}

/**
 * Id stabile, derivato dal nome del file nell'export: due import dello stesso
 * archivio — da PC o da telefono — producono lo stesso id, quindi il secondo
 * aggiorna le voci invece di sdoppiarle.
 * @param {string} nome @returns {Promise<string>}
 */
export async function idVoce(nome) {
  const dati = new TextEncoder().encode(nome);
  const hash = await crypto.subtle.digest('SHA-1', dati);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `dap${hex.slice(0, 12)}`;
}
