// Blocco della sezione Finanze con un PIN numerico.
//
// Il resto di mente-digitale sta aperto tutto il giorno su una scrivania in
// ufficio: le altre sezioni non hanno nulla di riservato, i conti sì. Il PIN
// copre lo schermo da chi passa, e nient'altro — chi apre i DevTools legge
// IndexedDB comunque, e sei cifre si provano tutte in un istante. Per quello
// che deve fare, basta.
//
// Lo sblocco vale per la scheda del browser e scade da solo: tornare dal caffè
// e ritrovare i conti aperti perché due ore prima si era digitato il PIN
// vanificherebbe l'esercizio.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "./store/AppStore";
import { sha256 } from "./crypto";
import { pinAttivo } from "./types";

const SS_SBLOCCO = "finanze.sbloccatoFino";
const DURATA_SBLOCCO_MS = 30 * 60 * 1000;

function sbloccoValido(): boolean {
  try {
    const fino = Number(sessionStorage.getItem(SS_SBLOCCO) ?? 0);
    return Number.isFinite(fino) && Date.now() < fino;
  } catch {
    return false;
  }
}

function segnaSblocco(): void {
  try {
    sessionStorage.setItem(SS_SBLOCCO, String(Date.now() + DURATA_SBLOCCO_MS));
  } catch {
    /* sessionStorage non disponibile: si resterà bloccati a ogni rientro */
  }
}

function scadenzaVia(): void {
  try {
    sessionStorage.removeItem(SS_SBLOCCO);
  } catch {
    /* no-op */
  }
}

// Il comando «blocca» passa da un contesto e non da una funzione esportata:
// cancellare la chiave in sessionStorage non basta, perché lo stato di sblocco
// vive in PinLock e nessuno lo costringerebbe a rileggerla. Il pulsante nella
// barra delle schede deve poter richiudere davvero, non solo alla prossima
// visita.
const LockCtx = createContext<{ blocca: () => void } | null>(null);

/** Comando per richiudere la sezione, disponibile dentro l'area sbloccata. */
export function useLock(): { blocca: () => void } {
  return useContext(LockCtx) ?? { blocca: () => {} };
}

export function PinLock({ children }: { children: React.ReactNode }) {
  const { dati, caricato } = useApp();
  const [sbloccato, setSbloccato] = useState(sbloccoValido);
  const [pin, setPin] = useState("");
  const [errore, setErrore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const atteso = pinAttivo(dati.parametri);

  useEffect(() => {
    if (!sbloccato) inputRef.current?.focus();
  }, [sbloccato]);

  // Ricontrolla la scadenza quando la scheda torna in primo piano: senza
  // questo, una finestra lasciata aperta su /finanze resterebbe sbloccata
  // all'infinito, perché nessun render la costringe a riguardare l'orologio.
  useEffect(() => {
    function alRitorno() {
      if (document.visibilityState === "visible" && !sbloccoValido()) {
        setSbloccato(false);
      }
    }
    document.addEventListener("visibilitychange", alRitorno);
    return () => document.removeEventListener("visibilitychange", alRitorno);
  }, []);

  function blocca() {
    scadenzaVia();
    setSbloccato(false);
    setPin("");
  }

  if (!caricato) {
    return <div className="finanze-attesa muted">Caricamento…</div>;
  }
  if (!atteso || sbloccato) {
    return <LockCtx.Provider value={{ blocca }}>{children}</LockCtx.Provider>;
  }

  async function verifica(e: React.FormEvent) {
    e.preventDefault();
    if ((await sha256(pin)) === atteso) {
      segnaSblocco();
      setSbloccato(true);
      setErrore(false);
      setPin("");
    } else {
      setErrore(true);
      setPin("");
      inputRef.current?.focus();
    }
  }

  return (
    <div className="finanze-lock">
      <form className="finanze-lock-box" onSubmit={verifica}>
        <h2>Finanze</h2>
        <p className="muted">Inserisci il PIN per vedere i conti.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          // `one-time-code` sarebbe l'hint giusto per un PIN, ma su iOS fa
          // apparire il suggerimento «incolla codice» dagli SMS: qui non c'è
          // nessun SMS, quindi resta un campo password numerico e basta.
          placeholder="PIN"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setErrore(false);
          }}
        />
        <button className="primario" type="submit" disabled={!pin}>
          Sblocca
        </button>
        {errore && <span className="errore">PIN errato.</span>}
      </form>
    </div>
  );
}
