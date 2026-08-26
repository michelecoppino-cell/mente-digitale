// Stato di sblocco della sezione Finanze, condiviso da tutta l'app.
//
// Prima viveva dentro PinLock: bastava, finché l'unica cosa dietro il PIN era
// /finanze. Da quando anche «Oggi» mostra dei conti — e i cento desideri, che
// sono privati per un altro motivo — lo stato deve stare fuori da un
// componente solo: sbloccare in un riquadro e ritrovare l'altro ancora
// oscurato sarebbe chiedere lo stesso PIN due volte nella stessa schermata.
//
// Il PIN non protegge i dati: chi apre i DevTools legge IndexedDB comunque.
// Copre lo schermo da chi passa vicino alla scrivania, e per quello basta.

import { useSyncExternalStore } from "react";

const SS_SBLOCCO = "finanze.sbloccatoFino";
const DURATA_SBLOCCO_MS = 30 * 60 * 1000;

/** Ogni quanto si ricontrolla la scadenza a scheda in primo piano. */
const TICK_MS = 30_000;

function leggiScadenza(): number {
  try {
    const fino = Number(sessionStorage.getItem(SS_SBLOCCO) ?? 0);
    return Number.isFinite(fino) ? fino : 0;
  } catch {
    return 0;
  }
}

/** True se lo sblocco di questa scheda è ancora valido. */
export function sbloccoValido(): boolean {
  return Date.now() < leggiScadenza();
}

// Lo snapshot vive qui e non dentro sbloccoValido(): useSyncExternalStore
// pretende che due letture consecutive senza notifica diano lo stesso valore,
// e un confronto con Date.now() non lo garantisce.
let stato = sbloccoValido();
const ascoltatori = new Set<() => void>();

function ricalcola() {
  const nuovo = sbloccoValido();
  if (nuovo === stato) return;
  stato = nuovo;
  for (const l of ascoltatori) l();
}

let timer: ReturnType<typeof setInterval> | null = null;

function alRitorno() {
  if (document.visibilityState === "visible") ricalcola();
}

function iscrivi(l: () => void): () => void {
  ascoltatori.add(l);
  if (ascoltatori.size === 1) {
    timer = setInterval(ricalcola, TICK_MS);
    document.addEventListener("visibilitychange", alRitorno);
  }
  return () => {
    ascoltatori.delete(l);
    if (ascoltatori.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", alRitorno);
    }
  };
}

function istantanea(): boolean {
  return stato;
}

/** Apre l'area riservata per i prossimi 30 minuti di questa scheda. */
export function sblocca(): void {
  try {
    sessionStorage.setItem(SS_SBLOCCO, String(Date.now() + DURATA_SBLOCCO_MS));
  } catch {
    /* sessionStorage non disponibile: si resterà bloccati a ogni rientro */
  }
  ricalcola();
}

/** Richiude subito, senza aspettare la scadenza. */
export function blocca(): void {
  try {
    sessionStorage.removeItem(SS_SBLOCCO);
  } catch {
    /* no-op */
  }
  ricalcola();
}

/**
 * Verifica un PIN contro quello configurato nei parametri salvati.
 *
 * Gli import sono dinamici di proposito: questo modulo lo importa anche
 * «Oggi», che sta nel bundle d'avvio, e il modello dati di Finanze (con le
 * categorie di default) non deve pesare su una schermata che nella maggior
 * parte delle aperture non mostra nemmeno un numero.
 */
export async function verificaPin(pin: string): Promise<boolean> {
  const [db, cripto, tipi] = await Promise.all([
    import("./store/db"),
    import("./crypto"),
    import("./types"),
  ]);
  const dati = await db.caricaDati();
  const atteso = tipi.pinAttivo(dati?.parametri ?? tipi.datiVuoti().parametri);
  if (!atteso) return true; // blocco disattivato: sblocco esplicito
  return (await cripto.sha256(pin)) === atteso;
}

/** React: `true` finché lo sblocco di questa scheda è valido. */
export function useSbloccato(): boolean {
  return useSyncExternalStore(iscrivi, istantanea, istantanea);
}
