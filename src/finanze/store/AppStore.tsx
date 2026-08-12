// Contesto React che tiene lo stato dell'app e lo persiste su IndexedDB.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { DatiApp, datiVuoti } from "../types";
import { caricaDati, salvaDati } from "./db";
import { segnaModificaLocale, ultimaModificaLocale } from "./sync";
import { collegato, salvaSuOneDrive, scaricaDaOneDrive } from "./onedrive";

interface Ctx {
  dati: DatiApp;
  caricato: boolean;
  /** Messaggio informativo dopo un sync automatico da OneDrive (o null). */
  avvisoSync: string | null;
  /** Chiude il messaggio di sync. */
  chiudiAvvisoSync: () => void;
  /** Aggiorna lo stato (immutabile) e persiste su IndexedDB. */
  aggiorna: (mut: (d: DatiApp) => DatiApp) => void;
  /** Sostituisce integralmente lo stato (import). */
  sostituisci: (d: DatiApp) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [dati, setDati] = useState<DatiApp>(datiVuoti);
  const [caricato, setCaricato] = useState(false);
  const [avvisoSync, setAvvisoSync] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerOneDrive = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True appena l'utente modifica qualcosa: il sync all'avvio non deve mai
  // sovrascrivere modifiche fatte mentre il download era in corso.
  const modificato = useRef(false);

  useEffect(() => {
    let attivo = true;
    caricaDati()
      .then((d) => {
        if (!attivo) return;
        if (d) setDati(d);
        void bootstrapOneDrive(d, () => attivo);
      })
      .finally(() => setCaricato(true));
    return () => {
      attivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Bootstrap OneDrive all'apertura della sezione: se il backup remoto e' piu'
   * recente dell'ultima modifica locale, lo carica. Tutto in background e in
   * modo silenzioso: gli errori non bloccano l'uso (il dato locale resta
   * valido).
   *
   * Non c'e' piu' niente da inizializzare: il login Microsoft e' gia' stato
   * fatto dall'app che ci contiene, e la sezione Finanze viene montata solo a
   * sessione aperta. Basta controllare che un account ci sia.
   */
  async function bootstrapOneDrive(
    locale: DatiApp | null,
    ancoraAttivo: () => boolean,
  ) {
    if (!collegato()) return;

    try {
      const remoto = await scaricaDaOneDrive();
      if (!remoto || !ancoraAttivo()) return;

      // Carica il remoto solo se e' certamente piu' recente: serve il suo
      // `salvatoIl` e un marcatore locale piu' vecchio. Se il marcatore manca
      // ma esistono gia' dati locali, non rischiare di sovrascriverli.
      const marcatore = ultimaModificaLocale();
      const localeVuoto = !locale || locale.transazioni.length === 0;
      const remotoPiuNuovo =
        !!remoto.salvatoIl && (!marcatore || remoto.salvatoIl > marcatore);
      const daCaricare = localeVuoto
        ? remoto.transazioni.length > 0
        : remotoPiuNuovo && !!marcatore;

      if (!daCaricare) {
        if (!marcatore) segnaModificaLocale(); // d'ora in poi il confronto funziona
        return;
      }
      if (modificato.current || !ancoraAttivo()) return;

      setDati(remoto);
      void salvaDati(remoto);
      segnaModificaLocale(remoto.salvatoIl);
      setAvvisoSync(
        `Dati aggiornati da OneDrive (${remoto.transazioni.length} movimenti).`,
      );
    } catch (e) {
      console.warn("Sincronizzazione OneDrive all'avvio non riuscita:", e);
    }
  }

  // Auto-salvataggio su OneDrive (debounce piu' lungo del salvataggio locale,
  // per non moltiplicare le chiamate di rete). Silenzioso: gli errori non
  // bloccano l'uso dell'app (il dato locale e' comunque salvato).
  function sincronizzaOneDrive(d: DatiApp) {
    if (!d.parametri.oneDriveAutoSync || !collegato()) return;
    if (timerOneDrive.current) clearTimeout(timerOneDrive.current);
    timerOneDrive.current = setTimeout(() => {
      void salvaSuOneDrive(d).catch((e) =>
        console.warn("Auto-salvataggio OneDrive non riuscito:", e),
      );
    }, 3000);
  }

  // Persistenza con debounce per non scrivere su ogni tasto.
  function persisti(d: DatiApp) {
    modificato.current = true;
    segnaModificaLocale();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void salvaDati(d);
    }, 300);
    sincronizzaOneDrive(d);
  }

  function aggiorna(mut: (d: DatiApp) => DatiApp) {
    setDati((prev) => {
      const next = mut(prev);
      persisti(next);
      return next;
    });
  }

  function sostituisci(d: DatiApp) {
    modificato.current = true;
    segnaModificaLocale();
    setDati(d);
    void salvaDati(d);
    sincronizzaOneDrive(d);
  }

  return (
    <AppCtx.Provider
      value={{
        dati,
        caricato,
        avvisoSync,
        chiudiAvvisoSync: () => setAvvisoSync(null),
        aggiorna,
        sostituisci,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fuori da AppProvider");
  return c;
}
