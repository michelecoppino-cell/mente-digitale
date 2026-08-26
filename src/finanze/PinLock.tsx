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
// vanificherebbe l'esercizio. Stato e scadenza stanno in ./sblocco, condivisi
// con i riquadri riservati della vista Oggi.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "./store/AppStore";
import { sha256 } from "./crypto";
import { pinAttivo } from "./types";
import { blocca as chiudiSblocco, sblocca, useSbloccato } from "./sblocco";

// Il comando «blocca» passa da un contesto e non da una funzione esportata
// così com'è: il pulsante nella barra delle schede deve poter richiudere
// davvero, e il contesto è già il modo in cui le schede lo raggiungono.
const LockCtx = createContext<{ blocca: () => void } | null>(null);

/** Comando per richiudere la sezione, disponibile dentro l'area sbloccata. */
export function useLock(): { blocca: () => void } {
  return useContext(LockCtx) ?? { blocca: () => {} };
}

export function PinLock({ children }: { children: React.ReactNode }) {
  const { dati, caricato } = useApp();
  const sbloccato = useSbloccato();
  const [pin, setPin] = useState("");
  const [errore, setErrore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const atteso = pinAttivo(dati.parametri);

  useEffect(() => {
    if (!sbloccato) inputRef.current?.focus();
  }, [sbloccato]);

  function blocca() {
    chiudiSblocco();
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
      sblocca();
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
