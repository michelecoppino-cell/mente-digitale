// Wrapper minimale su IndexedDB: salva l'intero stato dell'app come un
// singolo record. Nessuna dipendenza esterna. I dati restano solo nel browser.

import { DatiApp } from "../types";

const DB_NAME = "finanze";
const STORE = "stato";
const KEY = "principale";

function apri(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function caricaDati(): Promise<DatiApp | null> {
  const db = await apri();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as DatiApp) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function salvaDati(dati: DatiApp): Promise<void> {
  const db = await apri();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dati, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
