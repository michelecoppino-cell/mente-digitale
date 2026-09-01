// Wrapper minimale su IndexedDB: salva l'intero stato dell'app come un
// singolo record. Nessuna dipendenza esterna. I dati restano solo nel browser.

import { DatiApp } from "../types";

const DB_NAME = "finanze";
const STORE = "stato";
const KEY = "principale";

// La connessione si apre una volta e resta. Prima ogni lettura e ogni
// salvataggio ne aprivano una nuova senza chiuderla: la scheda Movimenti
// salva a ogni modifica (con un debounce di 300 ms), quindi una sessione di
// lavoro lasciava dietro di sé decine di connessioni vive verso lo stesso
// database. Non è solo memoria sprecata — finché una connessione è aperta,
// una `versionchange` da un'altra scheda resta bloccata in attesa.
//
// Il promise è memorizzato, non il database: due salvataggi partiti insieme
// devono aspettare la stessa apertura, non aprirne due a testa. Se l'apertura
// fallisce il promise si butta, così il tentativo dopo riparte davvero.
let _connessione: Promise<IDBDatabase> | null = null;

function apri(): Promise<IDBDatabase> {
  if (_connessione) return _connessione;
  _connessione = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Se il browser chiude la connessione per conto suo (la scheda va in
      // background a lungo, un'altra scheda chiede un aggiornamento di
      // versione), la prossima operazione deve riaprirla invece di usarne una
      // morta.
      db.onclose = () => { _connessione = null; };
      db.onversionchange = () => { db.close(); _connessione = null; };
      resolve(db);
    };
    req.onerror = () => { _connessione = null; reject(req.error); };
  }).catch((e) => { _connessione = null; throw e; });
  return _connessione;
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
