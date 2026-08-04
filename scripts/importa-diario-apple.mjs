// Importa l'esportazione del Diario di Apple (iPhone) nel formato del Diario
// di Mente Digitale.
//
//   node scripts/importa-diario-apple.mjs AnnotazioniDiarioApple.zip
//
// Produce una cartella pronta da copiare dentro `mente-digitale/` su OneDrive:
// i file mensili `mente-digitale-diario-YYYY-MM.json`, l'indice dei mesi e le
// foto convertite in `diario-foto/`. Nessuna scrittura sul tuo OneDrive: il
// trasferimento resta un copia-incolla fatto da te, e finché non lo fai puoi
// controllare il risultato.
//
// L'export di Apple è una pagina HTML per voce, generata da Cocoa: struttura
// fissa e prevedibile (pageHeader, reflectionPrompt, assetGrid, title,
// bodyText), che è il motivo per cui qui bastano delle regex e non serve un
// parser HTML vero. Le foto sono HEIC — illeggibili fuori da Safari — quindi
// la conversione in JPEG è il pezzo che rende l'archivio davvero visibile
// ovunque, ed è anche il motivo per cui questa è una procedura da PC e non un
// bottone dentro l'app.
//
// Rieseguirlo sullo stesso archivio è sicuro: id delle voci e nomi delle foto
// derivano dal contenuto dell'export, quindi un secondo giro aggiorna le
// stesse voci invece di duplicarle.

import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { makeEntry, extractTags } from '../src/diary.js';

// ── Opzioni ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  out: 'import-diario',
  tag: 'iphone',
  maxLato: 1600,
  qualita: 82,
  tuttiGliAsset: false,
  dryRun: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--tag') opts.tag = argv[++i];
    else if (a === '--max-lato') opts.maxLato = Number(argv[++i]);
    else if (a === '--qualita') opts.qualita = Number(argv[++i]);
    else if (a === '--tutti-gli-asset') opts.tuttiGliAsset = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--aiuto' || a === '--help' || a === '-h') opts.aiuto = true;
    else if (a.startsWith('--')) throw new Error(`Opzione sconosciuta: ${a}`);
    else opts.input = a;
  }
  return opts;
}

const AIUTO = `
Importa l'esportazione del Diario di Apple nel Diario di Mente Digitale.

  node scripts/importa-diario-apple.mjs <archivio.zip | cartella> [opzioni]

Opzioni
  --out <cartella>     dove scrivere il risultato (default: import-diario)
  --tag <nome>         tag applicato alle voci importate (default: iphone,
                       "-" per non metterne nessuno)
  --tutti-gli-asset    importa anche le schede generate da iOS: mappe dei
                       luoghi, allenamenti, stato d'animo, contatti
  --max-lato <px>      lato lungo massimo delle foto (default: 1600)
  --qualita <1-100>    qualità JPEG (default: 82)
  --dry-run            analizza e riporta senza scrivere niente

Prima di eseguire, se hai già delle voci nel Diario di Mente Digitale, copia
i file mente-digitale-diario-*.json da OneDrive nella cartella di --out: lo
script li unisce invece di ignorarli.

Al termine, copia il contenuto di --out dentro la cartella mente-digitale/
del tuo OneDrive, unendo le cartelle quando il sistema lo chiede.
`;

// ── Dipendenze di conversione immagini ──────────────────────────────────────
// Caricate a richiesta: chi apre il repo per lavorare sull'app non deve avere
// niente di compilato installato per fare `npm run dev`.

async function caricaConvertitori() {
  try {
    const [{ default: sharp }, { default: heicConvert }] = await Promise.all([
      import('sharp'),
      import('heic-convert'),
    ]);
    return { sharp, heicConvert };
  } catch {
    throw new Error(
      'Mancano le librerie per convertire le foto.\n' +
      'Installale con:  npm install\n' +
      '(oppure, senza toccare package.json:  npm install --no-save sharp heic-convert)'
    );
  }
}

// ── Lettura dell'archivio ───────────────────────────────────────────────────

/**
 * Estrae uno .zip in una cartella temporanea.
 *
 * Scritto a mano invece di appoggiarsi a `unzip` o `tar`: il tar di Linux non
 * legge gli zip (quello di macOS e Windows sì) e `unzip` non è installato
 * ovunque, mentre questo funziona su qualsiasi PC con Node e senza librerie.
 * Uno zip è un elenco in fondo al file (la "central directory") che punta ai
 * dati compressi; qui si legge quello e si scompatta voce per voce.
 */
function estraiZip(zipPath) {
  const buf = readFileSync(zipPath);
  const dir = mkdtempSync(path.join(tmpdir(), 'diario-apple-'));

  // Fine della central directory: firma 0x06054b50, cercata dal fondo perché
  // può avere in coda un commento di lunghezza variabile.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${zipPath} non sembra un file .zip valido.`);

  const nVoci = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < nVoci; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const dimCompressa = buf.readUInt32LE(p + 20);
    const lunNome = buf.readUInt16LE(p + 28);
    const lunExtra = buf.readUInt16LE(p + 30);
    const lunCommento = buf.readUInt16LE(p + 32);
    const offsetLocale = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lunNome);
    p += 46 + lunNome + lunExtra + lunCommento;

    // I metadati di macOS non servono a niente qui, e i percorsi che escono
    // dalla cartella di destinazione non si scrivono per principio.
    if (nome.startsWith('__MACOSX/') || path.basename(nome).startsWith('._')) continue;
    const dest = path.join(dir, nome);
    if (!dest.startsWith(dir + path.sep)) continue;

    if (nome.endsWith('/')) { mkdirSync(dest, { recursive: true }); continue; }

    // L'intestazione locale ripete nome ed extra con lunghezze proprie: i dati
    // cominciano dopo quelle, non dopo quelle della central directory.
    const lunNomeL = buf.readUInt16LE(offsetLocale + 26);
    const lunExtraL = buf.readUInt16LE(offsetLocale + 28);
    const inizio = offsetLocale + 30 + lunNomeL + lunExtraL;
    const dati = buf.subarray(inizio, inizio + dimCompressa);

    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, metodo === 0 ? dati : inflateRawSync(dati));
  }
  return dir;
}

/** Trova la cartella che contiene `Entries/`, anche se lo zip ha un livello in più. */
function trovaRadice(dir) {
  if (existsSync(path.join(dir, 'Entries'))) return dir;
  for (const nome of readdirSync(dir)) {
    if (nome === '__MACOSX') continue;
    const sotto = path.join(dir, nome);
    if (statSync(sotto).isDirectory() && existsSync(path.join(sotto, 'Entries'))) return sotto;
  }
  throw new Error(`Non trovo la cartella Entries/ dentro ${dir}: è davvero un export del Diario?`);
}

// ── Da HTML a testo ─────────────────────────────────────────────────────────

const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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

/** Testo leggibile da un frammento HTML, conservando righe ed elenchi. */
function testo(frammento) {
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
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Testo di un `<div class="...">…</div>` non annidato. */
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

/** 'giovedì 11 giugno 2026' → '2026-06-11' */
function dataDaIntestazione(intestazione) {
  const m = intestazione.toLowerCase().match(/(\d{1,2})\s+([a-zàéèìòù]+)\s+(\d{4})/);
  if (!m) return null;
  const mese = MESI.indexOf(m[2]);
  if (mese < 0) return null;
  const p = n => String(n).padStart(2, '0');
  return `${m[3]}-${p(mese + 1)}-${p(Number(m[1]))}`;
}

// Apple conta i secondi dal 1° gennaio 2001: è il timestamp che accompagna le
// foto nei file .json di Resources, e l'unico modo di sapere a che ora della
// giornata è stata scritta una voce.
const EPOCA_APPLE = Date.UTC(2001, 0, 1);

function dataDaAppleEpoch(secondi) {
  return new Date(EPOCA_APPLE + secondi * 1000);
}

/** 'YYYY-MM-DD' nel fuso di chi esegue lo script, come fa l'app. */
function giornoLocale(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Lettura di una voce ─────────────────────────────────────────────────────

/**
 * Ritaglia i singoli riquadri della griglia degli allegati. Ogni riquadro
 * comincia con `<div id="UUID" class="gridItem …">`: si spezza lì invece di
 * cercare la chiusura, che è annidata e cambia da tipo a tipo.
 */
function ritagliaAsset(grigliaHtml) {
  const inizio = /<div id="([^"]+)" class="gridItem ([^"]*)"/g;
  const punti = [];
  let m;
  while ((m = inizio.exec(grigliaHtml))) punti.push({ id: m[1], classi: m[2], da: m.index });
  return punti.map((p, i) => ({
    id: p.id,
    tipi: p.classi.split(/\s+/).filter(c => c.startsWith('assetType_')),
    html: grigliaHtml.slice(p.da, i + 1 < punti.length ? punti[i + 1].da : undefined),
  }));
}

const TIPI_FOTO = new Set(['assetType_photo', 'assetType_livePhoto']);

/** Didascalia da quello che iOS ha disegnato sopra il riquadro. */
function didascaliaAsset(asset, risorseDir) {
  const pezzi = [
    divTesto(asset.html, 'activityType'),
    divTesto(asset.html, 'gridItemOverlayHeader'),
    divTesto(asset.html, 'activityMetrics').replace(/\s*·\s*/g, ' · '),
    divTesto(asset.html, 'gridItemOverlayFooter'),
  ].filter(Boolean);

  // Le mappe portano i luoghi in un .json a fianco, non nell'HTML.
  const meta = leggiSidecar(asset.id, risorseDir);
  if (meta?.visits?.length) {
    const luoghi = [...new Set(meta.visits.map(v => v.placeName || v.city).filter(Boolean))];
    if (luoghi.length) pezzi.push(luoghi.join(', '));
  }
  return [...new Set(pezzi)].join(' · ');
}

function leggiSidecar(id, risorseDir) {
  const p = path.join(risorseDir, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function leggiVoce(fileHtml, risorseDir) {
  const html = readFileSync(fileHtml, 'utf8');
  const corpo = html.split('<body>')[1] || html;

  const intestazione = divTesto(corpo, 'pageHeader');
  const nome = path.basename(fileHtml, '.html');
  const data = dataDaIntestazione(intestazione) || (nome.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null);

  const titolo = divTesto(corpo, 'title');
  const domanda = divTesto(corpo, 'reflectionPrompt');

  const griglia = corpo.match(/<div class="assetGrid">([\s\S]*?)<div class=['"]title['"]/i);
  const asset = griglia ? ritagliaAsset(griglia[1]) : [];
  for (const a of asset) {
    a.file = a.html.match(/(?:src)="\.\.\/Resources\/([^"]+)"/)?.[1] || null;
    a.didascalia = didascaliaAsset(a, risorseDir);
    a.quando = leggiSidecar(a.id, risorseDir)?.date ?? null;
  }

  const daBody = corpo.split(/<div class=['"]bodyText['"]>/i)[1] || '';
  const testoVoce = testo(daBody);

  return { file: fileHtml, nome, data, titolo, domanda, asset, testo: testoVoce };
}

// ── Conversione delle immagini ──────────────────────────────────────────────

/**
 * HEIC → JPEG ridimensionato. sharp è la via veloce ma la sua libheif rifiuta
 * le Live Photo dell'iPhone ("Number of references in iref box exceeds the
 * security limits"), che sono proprio le foto vere: per quelle si passa da
 * heic-convert, più lento ma senza limiti, e si ridimensiona dopo.
 */
async function convertiImmagine({ sharp, heicConvert }, buffer, opts) {
  const ridimensiona = buf => sharp(buf)
    .rotate()
    .resize({ width: opts.maxLato, height: opts.maxLato, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: opts.qualita, mozjpeg: true })
    .toBuffer();

  try {
    return await ridimensiona(buffer);
  } catch {
    const jpeg = await heicConvert({ buffer, format: 'JPEG', quality: 0.92 });
    return ridimensiona(jpeg);
  }
}

// ── Scrittura in formato Mente Digitale ─────────────────────────────────────

function idVoce(nomeFile) {
  return `dap${createHash('sha1').update(nomeFile).digest('hex').slice(0, 12)}`;
}

function leggiJsonSePresente(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ── Programma ───────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.aiuto || !opts.input) {
    console.log(AIUTO);
    process.exit(opts.input ? 0 : 1);
  }

  const inputAssoluto = path.resolve(opts.input);
  if (!existsSync(inputAssoluto)) throw new Error(`Non trovo ${inputAssoluto}`);

  const estratto = statSync(inputAssoluto).isDirectory() ? inputAssoluto : estraiZip(inputAssoluto);
  const radice = trovaRadice(estratto);
  const entriesDir = path.join(radice, 'Entries');
  const risorseDir = path.join(radice, 'Resources');

  const files = readdirSync(entriesDir)
    .filter(f => f.endsWith('.html') && !f.startsWith('._'))
    .sort()
    .map(f => path.join(entriesDir, f));

  console.log(`Export letto da ${radice}`);
  console.log(`${files.length} voci nell'archivio\n`);

  const voci = files.map(f => leggiVoce(f, risorseDir));

  const convertitori = opts.dryRun ? null : await caricaConvertitori();
  const outDir = path.resolve(opts.out);
  const fotoDir = path.join(outDir, 'diario-foto');
  const scartiDir = path.join(outDir, 'media-non-importati');
  if (!opts.dryRun) mkdirSync(fotoDir, { recursive: true });

  const conto = { voci: 0, senzaData: 0, foto: 0, saltate: 0, mancanti: 0, video: 0, vuote: 0 };
  /** @type {Record<string, any[]>} */
  const perMese = {};

  for (const voce of voci) {
    if (!voce.data) {
      console.warn(`⚠ ${voce.nome}: data non riconosciuta, la salto`);
      conto.senzaData++;
      continue;
    }

    const foto = [];
    for (const a of voce.asset) {
      if (!a.file) continue;
      const sorgente = path.join(risorseDir, a.file);
      const eFoto = a.tipi.some(t => TIPI_FOTO.has(t));
      const eVideo = a.tipi.includes('assetType_video') || /\.(mov|mp4|m4v)$/i.test(a.file);

      if (!existsSync(sorgente)) { conto.mancanti++; continue; }
      if (eVideo) {
        // Il Diario non mostra video: si mettono da parte invece di perderli.
        conto.video++;
        if (!opts.dryRun) {
          mkdirSync(scartiDir, { recursive: true });
          copyFileSync(sorgente, path.join(scartiDir, `${voce.data}_${a.file}`));
        }
        continue;
      }
      if (!eFoto && !opts.tuttiGliAsset) { conto.saltate++; continue; }

      const nomeFoto = `${a.id}.jpg`;
      if (!opts.dryRun) {
        const jpeg = await convertiImmagine(convertitori, readFileSync(sorgente), opts);
        writeFileSync(path.join(fotoDir, nomeFoto), jpeg);
      }
      foto.push({ name: nomeFoto, caption: a.didascalia || '' });
      conto.foto++;
    }

    // Il Diario non ha un campo titolo: quello di Apple diventa la prima riga,
    // che è poi come lo si leggeva sull'iPhone.
    const testoFinale = [voce.titolo, voce.testo].filter(t => t && t.trim()).join('\n\n');
    if (!testoFinale.trim() && !foto.length) { conto.vuote++; continue; }

    // Ora del giorno: quella della prima foto, ma solo se è dello stesso
    // giorno della voce. Capita spesso di allegare la foto di ieri a quello
    // che si scrive oggi, e un orario preso da lì manderebbe la voce in
    // timeline nel giorno sbagliato. Altrimenti mezzogiorno: un'ora neutra è
    // più onesta di una precisione che l'export non ha.
    const scatti = voce.asset
      .map(a => a.quando)
      .filter(q => typeof q === 'number')
      .map(dataDaAppleEpoch)
      .filter(d => giornoLocale(d) === voce.data)
      .sort((a, b) => a - b);
    const ts = (scatti[0] || new Date(`${voce.data}T12:00:00`)).toISOString();

    const tagBase = opts.tag && opts.tag !== '-' ? [opts.tag] : [];
    const entry = makeEntry({
      id: idVoce(voce.nome),
      ts,
      date: voce.data,
      type: 'libero',
      text: testoFinale,
      seed: voce.domanda || null,
      tags: [...new Set([...tagBase, ...extractTags(testoFinale)])],
      photos: foto,
    });

    (perMese[voce.data.slice(0, 7)] ||= []).push(entry);
    conto.voci++;
  }

  // Unione con quello che c'è già nella cartella di destinazione, per id: chi
  // ha copiato lì i propri file da OneDrive non deve perderli, e una seconda
  // esecuzione aggiorna le voci invece di sdoppiarle.
  const mesi = Object.keys(perMese).sort();
  for (const mese of mesi) {
    const file = path.join(outDir, `mente-digitale-diario-${mese}.json`);
    const esistenti = leggiJsonSePresente(file, []);
    const mappa = new Map((Array.isArray(esistenti) ? esistenti : []).map(e => [e.id, e]));
    for (const e of perMese[mese]) mappa.set(e.id, e);
    const unite = [...mappa.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (!opts.dryRun) writeFileSync(file, JSON.stringify(unite, null, 2));
    console.log(`  ${mese}: ${perMese[mese].length} importate, ${unite.length} in totale nel mese`);
  }

  const indiceFile = path.join(outDir, 'mente-digitale-diario-index.json');
  const indice = leggiJsonSePresente(indiceFile, { months: [] });
  const tuttiIMesi = [...new Set([...(indice.months || []), ...mesi])].sort();
  if (!opts.dryRun) writeFileSync(indiceFile, JSON.stringify({ months: tuttiIMesi }, null, 2));

  console.log(`
Riepilogo
  voci importate ....... ${conto.voci}
  foto convertite ...... ${conto.foto}
  allegati generati .... ${conto.saltate} ${opts.tuttiGliAsset ? '' : '(mappe, allenamenti, stato d\'animo: --tutti-gli-asset per prenderli)'}
  video messi da parte . ${conto.video}${conto.video ? ` → ${path.relative(process.cwd(), scartiDir)}` : ''}
  allegati mancanti .... ${conto.mancanti} (file non presenti nell'archivio)
  voci senza data ...... ${conto.senzaData}
  voci vuote ........... ${conto.vuote}
`);

  if (opts.dryRun) {
    console.log('Prova a vuoto: non ho scritto niente.');
    return;
  }

  console.log(`Scritto in ${outDir}

Ultimo passo, a mano: copia il contenuto di questa cartella dentro
"mente-digitale" sul tuo OneDrive, unendo la cartella diario-foto quando il
sistema lo chiede. Al prossimo avvio le voci sono nel Diario.`);
}

main().catch(e => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
