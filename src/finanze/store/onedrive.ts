// Sincronizzazione del backup Finanze su OneDrive.
//
// Quando Finanze era un'app a sé stante questo file conteneva una seconda
// istanza MSAL, con un proprio Application (client) ID da registrare su Azure e
// lo scope `Files.ReadWrite.AppFolder`. Dentro mente-digitale quella istanza non
// può esistere: due `PublicClientApplication` sulla stessa pagina si contendono
// `handleRedirectPromise()` e il login torna indietro a metà. Qui resta solo un
// adattatore sottile sopra `api.js`, che usa il login Microsoft già fatto
// dall'app e scrive nella stessa cartella `mente-digitale/` di tutti gli altri
// file. Nessun client id da configurare, nessun secondo consenso.

import { loadFinanze, saveFinanze } from "../../api";
import { getAccount } from "../../auth";
import { DatiApp } from "../types";
import { importaDati } from "./io";
import { segnaModificaLocale } from "./sync";

/**
 * True se c'è un account Microsoft collegato. Le funzioni qui sotto vanno
 * chiamate solo in questo caso: senza account `getToken()` solleva.
 */
export function collegato(): boolean {
  return !!getAccount();
}

/**
 * Salva (sovrascrive) il backup nella cartella dell'app su OneDrive, marcandolo
 * con l'istante di scrittura. Allinea anche il marcatore locale: il remoto ora
 * coincide con quello che c'è nel browser, quindi al prossimo avvio non va
 * ri-scaricato.
 */
export async function salvaSuOneDrive(dati: DatiApp): Promise<void> {
  const salvatoIl = new Date().toISOString();
  await saveFinanze({ ...dati, salvatoIl });
  segnaModificaLocale(salvatoIl);
}

/**
 * Scarica il backup da OneDrive normalizzato, o null se non ne esiste ancora
 * uno. La normalizzazione (`importaDati`) tollera snapshot di versioni diverse
 * e campi mancanti, esattamente come l'import di un file JSON a mano.
 */
export async function scaricaDaOneDrive(): Promise<DatiApp | null> {
  const raw = await loadFinanze();
  if (!raw) return null;
  return importaDati(raw);
}
