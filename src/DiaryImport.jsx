// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
import { useState, useRef } from 'react';
import { saveDiaryEntries, uploadDiaryPhoto } from './api';
import { makeEntry, extractTags } from './diary';
import { shrinkImage } from './diaryPhotos';
import {
  unzip, leggiVoce, testoVoce, tsVoce, idVoce, eFoto, eVideo,
} from './appleDiary';

// Importazione dell'esportazione del Diario di Apple, fatta dal telefono.
//
// Esiste anche la versione da PC (scripts/importa-diario-apple.mjs), che resta
// la strada buona per archivi enormi. Questa serve al caso normale: lo zip è
// arrivato sull'iPhone e da lì non si può né scompattare comodamente né
// copiare a mano dentro una cartella di OneDrive. Qui si sceglie il file da
// "File" e basta — l'app è già autenticata sul OneDrive giusto, quindi le voci
// finiscono dove le cerca il Diario.
//
// Le foto sono HEIC: su iPhone è un vantaggio, perché Safari le decodifica di
// suo e la conversione in JPEG avviene sul telefono senza librerie. Su un
// browser che non le sa leggere vengono saltate e contate, invece di caricare
// file che poi nessuno riuscirebbe a vedere.

const TAG_IMPORT = 'iphone';

/** DecompressionStream esiste su Safari 16.4+ e su ogni browser recente. */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Questo browser non sa scompattare gli zip. Aggiorna iOS, o usa lo script da PC.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Dallo zip alle voci di Apple, senza ancora toccare OneDrive. */
async function leggiArchivio(file) {
  const contenuto = await unzip(new Uint8Array(await file.arrayBuffer()), inflateRaw);

  // Il testo delle voci e i .json degli allegati si leggono subito; i binari
  // restano compressi in memoria finché non servono davvero.
  const decoder = new TextDecoder('utf-8');
  const risorse = new Map();
  const pagine = [];
  for (const [percorso, dati] of contenuto) {
    const nome = percorso.split('/').pop() || '';
    if (percorso.includes('/Entries/') && nome.endsWith('.html')) {
      pagine.push({ nome: nome.replace(/\.html$/, ''), html: decoder.decode(dati) });
    } else if (percorso.includes('/Resources/')) {
      risorse.set(nome, dati);
    }
  }
  if (!pagine.length) throw new Error("Non trovo nessuna voce: è davvero l'esportazione del Diario?");

  const sidecar = id => {
    const dati = risorse.get(`${id}.json`);
    if (!dati) return null;
    try { return JSON.parse(decoder.decode(dati)); } catch { return null; }
  };

  pagine.sort((a, b) => (a.nome < b.nome ? -1 : 1));
  const voci = pagine.map(p => leggiVoce(p.html, p.nome, sidecar)).filter(v => v.data);
  return { voci, risorse };
}

// Quante foto verranno caricate davvero, per dire in anticipo quanto durerà:
// contano solo quelle presenti nell'archivio, non quelle a cui una voce
// rimanda e basta.
function contaFoto(voci, risorse, tuttiGliAsset) {
  return voci.reduce((n, v) => n + v.asset.filter(
    a => a.file && risorse.has(a.file) && !eVideo(a) && (tuttiGliAsset || eFoto(a)),
  ).length, 0);
}

export default function DiaryImport({ onBack, onImported }) {
  const [archivio, setArchivio] = useState(null);   // { voci, risorse }
  const [soloTesti, setSoloTesti] = useState(false);
  const [tuttiGliAsset, setTuttiGliAsset] = useState(false);
  const [stato, setStato] = useState(null);         // { fase, fatte, totale }
  const [esito, setEsito] = useState(null);
  const [errore, setErrore] = useState(null);
  const inputRef = useRef(null);

  async function scegli(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrore(null);
    setEsito(null);
    setStato({ fase: 'Leggo l\'archivio…' });
    try {
      setArchivio(await leggiArchivio(file));
    } catch (err) {
      setErrore(err.message || 'Non sono riuscito a leggere questo file.');
      setArchivio(null);
    } finally {
      setStato(null);
    }
  }

  async function importa() {
    setErrore(null);
    const conto = { voci: 0, foto: 0, saltate: 0, mancanti: 0 };
    const entries = [];
    const totaleFoto = soloTesti ? 0 : contaFoto(archivio.voci, archivio.risorse, tuttiGliAsset);

    try {
      for (const voce of archivio.voci) {
        const photos = [];
        if (!soloTesti) {
          for (const a of voce.asset) {
            if (!a.file || eVideo(a)) continue;
            if (!eFoto(a) && !tuttiGliAsset) continue;
            const dati = archivio.risorse.get(a.file);
            if (!dati) { conto.mancanti++; continue; }

            setStato({ fase: 'Carico le foto', fatte: conto.foto + conto.saltate, totale: totaleFoto });
            const blob = new Blob([dati]);
            const { blob: jpeg, ext } = await shrinkImage(blob);
            // ext diverso da jpg significa che il browser non ha saputo
            // decodificare l'HEIC: caricarlo comunque darebbe una foto che poi
            // non si vede, quindi si conta e si va avanti.
            if (ext !== 'jpg') { conto.saltate++; continue; }

            const name = `${a.id}.jpg`;
            try {
              await uploadDiaryPhoto(jpeg, name);
              photos.push({ name, caption: a.didascalia || '' });
              conto.foto++;
            } catch {
              conto.saltate++;
            }
          }
        }

        const text = testoVoce(voce);
        if (!text.trim() && !photos.length) continue;

        entries.push(makeEntry({
          id: await idVoce(voce.nome),
          ts: tsVoce(voce),
          date: voce.data,
          type: 'libero',
          text,
          seed: voce.domanda || null,
          tags: [...new Set([TAG_IMPORT, ...extractTags(text)])],
          photos,
        }));
        conto.voci++;
      }

      setStato({ fase: 'Salvo le voci su OneDrive…' });
      const mesi = await saveDiaryEntries(entries);
      setEsito({ ...conto, mesi: mesi.length });
      onImported?.();
    } catch (err) {
      setErrore(
        `${err.message || 'Importazione interrotta.'} ` +
        'Quello che era già stato caricato resta: rilanciando l\'import le voci si aggiornano, non si sdoppiano.'
      );
    } finally {
      setStato(null);
    }
  }

  const voci = archivio?.voci || [];
  const periodo = voci.length
    ? `${voci.map(v => v.data).sort()[0]} → ${voci.map(v => v.data).sort().at(-1)}`
    : '';
  const foto = archivio ? contaFoto(voci, archivio.risorse, tuttiGliAsset) : 0;

  return (
    <div className="diary-panel">
      <div className="diary-header">
        <span className="diary-title">Importa dall'iPhone</span>
        <button className="diary-close" onClick={onBack}>✕</button>
      </div>

      <div className="diary-body">
        {!archivio && !esito && (
          <>
            <p className="diary-import-intro">
              Sul telefono: apri l'app <b>Diario</b> → Impostazioni → <b>Esporta</b>, salva lo zip
              in File, poi scegli qui quel file. Non serve scompattarlo.
            </p>
            <button className="diary-primary-btn" onClick={() => inputRef.current?.click()} disabled={!!stato}>
              {stato ? stato.fase : "Scegli l'archivio .zip"}
            </button>
          </>
        )}

        {archivio && !esito && (
          <>
            <div className="diary-import-riepilogo">
              <div><b>{voci.length}</b> {voci.length === 1 ? 'voce' : 'voci'} nell'archivio</div>
              <div className="diary-import-dettaglio">{periodo}</div>
              <div className="diary-import-dettaglio">
                {soloTesti
                  ? 'nessuna foto: solo i testi'
                  : `${foto} ${foto === 1 ? 'immagine' : 'immagini'} da convertire e caricare`}
              </div>
            </div>

            <label className="diary-checkbox">
              <input type="checkbox" checked={soloTesti} onChange={e => setSoloTesti(e.target.checked)} />
              solo i testi, le foto le aggiungo dopo
            </label>
            {!soloTesti && (
              <label className="diary-checkbox">
                <input type="checkbox" checked={tuttiGliAsset} onChange={e => setTuttiGliAsset(e.target.checked)} />
                anche le schede di iOS: mappe, allenamenti, stato d'animo
              </label>
            )}

            {stato && (
              <div className="diary-status">
                {stato.fase}{stato.totale ? ` ${stato.fatte}/${stato.totale}` : '…'}
              </div>
            )}
            {errore && <div className="diary-error">{errore}</div>}

            <div className="diary-writer-actions">
              <button className="diary-link-btn" onClick={onBack} disabled={!!stato}>Indietro</button>
              <button className="diary-primary-btn" onClick={importa} disabled={!!stato}>
                {stato ? '…' : 'Importa nel Diario'}
              </button>
            </div>
            <div className="diary-privacy">
              Le voci vengono scritte sul tuo OneDrive, nella cartella mente-digitale.
              Reimportare lo stesso archivio non crea doppioni: le voci si aggiornano.
            </div>
          </>
        )}

        {esito && (
          <>
            <div className="diary-import-riepilogo">
              <div><b>{esito.voci}</b> voci importate in {esito.mesi} {esito.mesi === 1 ? 'mese' : 'mesi'}</div>
              {!soloTesti && <div className="diary-import-dettaglio">{esito.foto} foto caricate</div>}
              {esito.saltate > 0 && (
                <div className="diary-import-dettaglio">
                  {esito.saltate} immagini saltate: questo browser non le sa convertire.
                  Riprova da Safari sull'iPhone, o usa lo script da PC.
                </div>
              )}
              {esito.mancanti > 0 && (
                <div className="diary-import-dettaglio">{esito.mancanti} allegati non erano nell'archivio</div>
              )}
            </div>
            <div className="diary-writer-actions">
              <button className="diary-primary-btn" onClick={onBack}>Vai al Diario</button>
            </div>
          </>
        )}

        {errore && !archivio && <div className="diary-error">{errore}</div>}

        <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={scegli} />
      </div>
    </div>
  );
}
