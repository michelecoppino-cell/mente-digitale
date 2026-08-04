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

import { mkdtempSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { makeEntry, extractTags } from '../src/diary.js';
import { unzip, leggiVoce, testoVoce, tsVoce, idVoce, eFoto, eVideo } from '../src/appleDiary.js';

// ── Opzioni ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  out: 'import-diario',
  tag: 'iphone',
  maxLato: 1600,
  qualita: 82,
  tuttiGliAsset: false,
  senzaFoto: false,
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
    else if (a === '--senza-foto') opts.senzaFoto = true;
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
  --senza-foto         importa solo i testi, senza convertire né allegare
                       nessuna immagine (le foto restano nell'archivio e si
                       possono aggiungere dopo rieseguendo senza l'opzione)
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
 * Estrae uno .zip in una cartella temporanea, usando il lettore condiviso con
 * l'app (src/appleDiary.js) e la decompressione di Node.
 */
async function estraiZip(zipPath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'diario-apple-'));
  const contenuto = await unzip(new Uint8Array(readFileSync(zipPath)), inflateRawSync);
  for (const [nome, dati] of contenuto) {
    const dest = path.join(dir, nome);
    // I percorsi che escono dalla cartella di destinazione non si scrivono
    // per principio, per quanto improbabile sia in un export di Apple.
    if (!dest.startsWith(dir + path.sep)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, dati);
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

// ── Lettura delle voci ──────────────────────────────────────────────────────
// Il parser vero sta in src/appleDiary.js, condiviso con l'importazione dentro
// l'app: qui restano solo il ponte verso il disco e le opzioni da riga di
// comando.

function leggiSidecar(id, risorseDir) {
  const p = path.join(risorseDir, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
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

  const estratto = statSync(inputAssoluto).isDirectory() ? inputAssoluto : await estraiZip(inputAssoluto);
  const radice = trovaRadice(estratto);
  const entriesDir = path.join(radice, 'Entries');
  const risorseDir = path.join(radice, 'Resources');

  const files = readdirSync(entriesDir)
    .filter(f => f.endsWith('.html') && !f.startsWith('._'))
    .sort()
    .map(f => path.join(entriesDir, f));

  console.log(`Export letto da ${radice}`);
  console.log(`${files.length} voci nell'archivio\n`);

  const voci = files.map(f => leggiVoce(
    readFileSync(f, 'utf8'),
    path.basename(f, '.html'),
    id => leggiSidecar(id, risorseDir),
  ));

  const convertitori = opts.dryRun || opts.senzaFoto ? null : await caricaConvertitori();
  const outDir = path.resolve(opts.out);
  const fotoDir = path.join(outDir, 'diario-foto');
  const scartiDir = path.join(outDir, 'media-non-importati');
  if (!opts.dryRun) {
    // La cartella delle foto solo se ci finirà qualcosa: un import di soli
    // testi non deve lasciare una cartella vuota da copiare su OneDrive.
    mkdirSync(opts.senzaFoto ? outDir : fotoDir, { recursive: true });
  }

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
      if (opts.senzaFoto || !a.file) continue;
      const sorgente = path.join(risorseDir, a.file);

      if (!existsSync(sorgente)) { conto.mancanti++; continue; }
      if (eVideo(a)) {
        // Il Diario non mostra video: si mettono da parte invece di perderli.
        conto.video++;
        if (!opts.dryRun) {
          mkdirSync(scartiDir, { recursive: true });
          copyFileSync(sorgente, path.join(scartiDir, `${voce.data}_${a.file}`));
        }
        continue;
      }
      if (!eFoto(a) && !opts.tuttiGliAsset) { conto.saltate++; continue; }

      const nomeFoto = `${a.id}.jpg`;
      if (!opts.dryRun) {
        const jpeg = await convertiImmagine(convertitori, readFileSync(sorgente), opts);
        writeFileSync(path.join(fotoDir, nomeFoto), jpeg);
      }
      foto.push({ name: nomeFoto, caption: a.didascalia || '' });
      conto.foto++;
    }

    const testoFinale = testoVoce(voce);
    if (!testoFinale.trim() && !foto.length) { conto.vuote++; continue; }

    const tagBase = opts.tag && opts.tag !== '-' ? [opts.tag] : [];
    const entry = makeEntry({
      id: await idVoce(voce.nome),
      ts: tsVoce(voce),
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
  foto convertite ...... ${opts.senzaFoto ? 'nessuna (--senza-foto)' : conto.foto}
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
"mente-digitale" sul tuo OneDrive${opts.senzaFoto ? '' : ', unendo la cartella diario-foto quando\nil sistema lo chiede'}.
Al prossimo avvio le voci sono nel Diario.${opts.senzaFoto
  ? '\n\nLe foto puoi aggiungerle dopo: rilancia senza --senza-foto e ricopia.\nLe voci non si sdoppiano, si aggiornano.'
  : ''}`);
}

main().catch(e => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
