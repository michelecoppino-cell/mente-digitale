// La sezione Finanze: una sola voce nel rail, sette schede dentro.
//
// Finanze nasceva come app a sé, con la propria sidebar di sette voci. Portarle
// tutte nel rail di mente-digitale avrebbe raddoppiato il menù principale per
// una parte sola dell'app, quindi qui il rail ne vede una e le sette vivono in
// una barra di schede sotto il titolo.
//
// Le schede sono rotte vere (`/finanze/tasse`, non uno `useState`) per la
// stessa ragione per cui il resto dell'app ha smesso di navigare a booleani:
// così il tasto indietro torna alla scheda precedente invece di uscire dalla
// sezione, un ricaricamento non riporta sempre al saldo, e `/finanze/movimenti`
// è un indirizzo da mettere in un collegamento.

import { lazy, Suspense } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import { AppProvider, useApp } from "./store/AppStore";
import { PinLock, useLock } from "./PinLock";
import "./finanze.css";

// Una scheda alla volta, non tutte e sette.
//
// La sezione intera è già caricata a richiesta da App.jsx — è la ragione per
// cui recharts non pesa sull'avvio di «Oggi» — ma dentro la sezione le sette
// pagine erano import statici, e quindi un unico blocco: aprire il Saldo
// scaricava anche i movimenti, le fatture, le tasse e le impostazioni.
//
// Contano soprattutto due cose. Movimenti da solo è un terzo del codice della
// sezione (2300 righe) e non tocca i grafici; e dei grafici hanno bisogno solo
// tre schede su sette — Saldo, Analisi spese e Proiezione — mentre le altre
// quattro si trascinavano dietro un quarto di megabyte di recharts per
// mostrare delle tabelle.
//
// Il `<Suspense>` che le avvolge c'era già: era un'attesa messa lì per dei
// figli pigri che non erano mai arrivati.
const Saldo = lazy(() => import("./pages/Saldo").then((m) => ({ default: m.Saldo })));
const AnalisiSpese = lazy(() => import("./pages/AnalisiSpese").then((m) => ({ default: m.AnalisiSpese })));
const Proiezione = lazy(() => import("./pages/Proiezione").then((m) => ({ default: m.Proiezione })));
const Fatture = lazy(() => import("./pages/Fatture").then((m) => ({ default: m.Fatture })));
const Tasse = lazy(() => import("./pages/Tasse").then((m) => ({ default: m.Tasse })));
const Movimenti = lazy(() => import("./pages/Movimenti").then((m) => ({ default: m.Movimenti })));
const Impostazioni = lazy(() => import("./pages/Impostazioni").then((m) => ({ default: m.Impostazioni })));

type IdScheda =
  | "saldo"
  | "analisi"
  | "proiezione"
  | "fatture"
  | "tasse"
  | "movimenti"
  | "impostazioni";

const SCHEDE: { id: IdScheda; nome: string; render: () => React.ReactNode }[] = [
  { id: "saldo", nome: "Saldo reale", render: () => <Saldo /> },
  { id: "analisi", nome: "Analisi spese", render: () => <AnalisiSpese /> },
  { id: "proiezione", nome: "Proiezione", render: () => <Proiezione /> },
  { id: "fatture", nome: "Fatture", render: () => <Fatture /> },
  { id: "tasse", nome: "Tasse", render: () => <Tasse /> },
  { id: "movimenti", nome: "Movimenti", render: () => <Movimenti /> },
  { id: "impostazioni", nome: "Impostazioni", render: () => <Impostazioni /> },
];

const PREDEFINITA: IdScheda = "saldo";

/** Avviso mostrato quando all'apertura sono arrivati dati piu' recenti da OneDrive. */
function BannerSync() {
  const { avvisoSync, chiudiAvvisoSync } = useApp();
  if (!avvisoSync) return null;
  return (
    <div className="card banner-info finanze-banner">
      <span>{avvisoSync}</span>
      <button className="secondario" onClick={chiudiAvvisoSync}>
        OK
      </button>
    </div>
  );
}

/**
 * La barra delle schede. Su schermo stretto scorre in orizzontale invece di
 * andare a capo: sette voci su due righe mangerebbero mezzo telefono prima di
 * arrivare al contenuto.
 */
function BarraSchede() {
  const { blocca } = useLock();
  return (
    <div className="finanze-schede">
      <div className="finanze-schede-lista">
        {SCHEDE.map((s) => (
          <NavLink
            key={s.id}
            to={`/finanze/${s.id}`}
            className={({ isActive }) =>
              `finanze-scheda${isActive ? " attiva" : ""}`
            }
          >
            {s.nome}
          </NavLink>
        ))}
      </div>
      <button
        className="finanze-blocca"
        onClick={blocca}
        title="Richiudi la sezione con il PIN"
      >
        Blocca
      </button>
    </div>
  );
}

function Contenuto({ scheda }: { scheda: IdScheda }) {
  return (
    <>
      <BarraSchede />
      <div className="finanze-pagina">
        <BannerSync />
        {SCHEDE.find((s) => s.id === scheda)?.render()}
      </div>
    </>
  );
}

export default function FinanzeSection() {
  const { sezione } = useParams();
  const scheda = SCHEDE.find((s) => s.id === sezione)?.id;

  // Indirizzo senza scheda (o con una scheda inventata): si atterra sul saldo,
  // sostituendo la voce nella cronologia così il tasto indietro non rimbalza
  // fra il redirect e la pagina da cui si veniva.
  if (!scheda) return <Navigate to={`/finanze/${PREDEFINITA}`} replace />;

  return (
    <div className="finanze-root">
      <AppProvider>
        <PinLock>
          <Suspense fallback={<div className="finanze-attesa muted">Caricamento…</div>}>
            <Contenuto scheda={scheda} />
          </Suspense>
        </PinLock>
      </AppProvider>
    </div>
  );
}
