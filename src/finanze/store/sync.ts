// Marcatore dell'ultima modifica ai dati locali, usato per decidere se il
// backup su OneDrive e' piu' recente di quello nel browser. Va tenuto in
// localStorage (sincrono e leggero) perche' serve prima che IndexedDB carichi.
//
// Il marcatore viene aggiornato:
//  - a ogni modifica locale (con l'ora corrente);
//  - dopo un salvataggio su OneDrive (con il `salvatoIl` scritto nel backup);
//  - dopo un caricamento da OneDrive (con il `salvatoIl` del backup caricato).
// Cosi' un backup remoto risulta "piu' nuovo" solo se scritto da un altro
// dispositivo dopo l'ultima attivita' su questo.

const LS_ULTIMA_MODIFICA = "finanze.ultimaModificaLocale";

export function segnaModificaLocale(iso?: string): void {
  try {
    localStorage.setItem(LS_ULTIMA_MODIFICA, iso ?? new Date().toISOString());
  } catch {
    /* localStorage non disponibile: ignora */
  }
}

export function ultimaModificaLocale(): string | null {
  try {
    return localStorage.getItem(LS_ULTIMA_MODIFICA);
  } catch {
    return null;
  }
}
