// @ts-check
// Preparazione e caricamento delle foto del Diario.
//
// Una foto scattata con l'iPhone pesa 3–5 MB e misura 4000 px sul lato lungo:
// in un diario che si rilegge dal telefono non serve a niente e costerebbe
// secondi di upload a ogni voce. Qui l'immagine viene ridotta prima di partire,
// una volta sola, sul dispositivo — il diario resta un dato che non passa da
// nessun server nostro, esattamente come il testo.

import { uploadDiaryPhoto, getDiaryPhotoUrl, deleteDiaryPhoto } from './api';

/** @typedef {import('./types').DiaryPhoto} DiaryPhoto */

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.82;
export const MAX_PHOTOS_PER_ENTRY = 8;

/** @returns {string} */
function photoId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// `imageOrientation: 'from-image'` è ciò che tiene dritte le foto dell'iPhone:
// il sensore scrive sempre in orizzontale e delega il verso all'EXIF, che il
// canvas altrimenti ignora (ritratti ruotati di 90°).
/** @param {Blob} blob @returns {Promise<{ bitmap: ImageBitmap|HTMLImageElement, w: number, h: number }>} */
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { bitmap, w: bitmap.width, h: bitmap.height };
    } catch { /* formato non decodificabile qui: si prova con <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('immagine non leggibile'));
      el.src = url;
    });
    return { bitmap: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Ridimensiona a MAX_DIM sul lato lungo e ricomprime in JPEG. Se il browser non
 * sa decodificare il file (capita con gli HEIC fuori da Safari) si tiene il file
 * originale: meglio una foto pesante che una foto persa.
 * @param {File} file
 * @returns {Promise<{ blob: Blob, ext: string, w: number, h: number }>}
 */
export async function shrinkImage(file) {
  const fallbackExt = ((file.name || '').split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
  try {
    const { bitmap, w, h } = await decode(file);
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas non disponibile');
    ctx.drawImage(/** @type {any} */ (bitmap), 0, 0, tw, th);
    if ('close' in bitmap) bitmap.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('conversione fallita');
    return { blob, ext: 'jpg', w: tw, h: th };
  } catch {
    return { blob: file, ext: fallbackExt, w: 0, h: 0 };
  }
}

/**
 * Prepara e carica una foto su OneDrive.
 * @param {File} file
 * @returns {Promise<DiaryPhoto>}
 */
export async function addPhoto(file) {
  const { blob, ext, w, h } = await shrinkImage(file);
  const name = `${photoId()}.${ext}`;
  await uploadDiaryPhoto(blob, name);
  return { name, caption: '', w, h };
}

/**
 * Carica più foto in sequenza (non in parallelo: su rete mobile un burst di
 * upload da qualche MB l'uno si ostacola da solo) riportando l'avanzamento.
 * @param {File[]} files
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ photos: DiaryPhoto[], failed: number }>}
 */
export async function addPhotos(files, onProgress) {
  /** @type {DiaryPhoto[]} */
  const photos = [];
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      photos.push(await addPhoto(files[i]));
    } catch (e) {
      console.error('upload foto diario', files[i]?.name, e);
      failed++;
    }
    onProgress?.(i + 1, files.length);
  }
  return { photos, failed };
}

/**
 * Cancella dal OneDrive le foto di una voce eliminata. Non fa fallire la
 * cancellazione della voce: al massimo resta un file orfano.
 * @param {DiaryPhoto[]} photos
 */
export async function removePhotos(photos) {
  for (const p of photos || []) {
    try { await deleteDiaryPhoto(p.name); } catch (e) { console.error('elimina foto diario', p.name, e); }
  }
}

export { getDiaryPhotoUrl };
