import { useRef, useState } from "react";
import { useApp } from "../store/AppStore";
import { esportaJson, importaJson } from "../store/io";
import { collegato, salvaSuOneDrive, scaricaDaOneDrive } from "../store/onedrive";
import { sha256 } from "../crypto";
import { Mutuo, datiVuoti, pinAttivo } from "../types";
import { statoMutuo } from "../engine/mutuo";
import { euro, toIso, uid } from "../util";
import { Info } from "../components/Info";

export function Impostazioni() {
  const { dati, aggiorna, sostituisci } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nuovaCat, setNuovaCat] = useState("");
  const [pin1, setPin1] = useState("");
  const [esitoPin, setEsitoPin] = useState("");
  const [esitoImport, setEsitoImport] = useState("");

  const p = dati.parametri;

  // ---------- OneDrive ----------
  // Niente più login, client id e scollegamento: l'accesso a Graph è quello di
  // mente-digitale, già fatto prima ancora di arrivare qui. Restano i due
  // comandi manuali e l'interruttore dell'auto-salvataggio.
  const [odMsg, setOdMsg] = useState("");
  const [odBusy, setOdBusy] = useState(false);

  async function odAzione(fn: () => Promise<void>) {
    setOdBusy(true);
    setOdMsg("");
    try {
      await fn();
    } catch (err) {
      setOdMsg("Errore: " + (err as Error).message);
    } finally {
      setOdBusy(false);
    }
  }

  function odSalva() {
    void odAzione(async () => {
      await salvaSuOneDrive(dati);
      setOdMsg("Backup salvato su OneDrive.");
    });
  }

  function odCarica() {
    void odAzione(async () => {
      const d = await scaricaDaOneDrive();
      if (!d) {
        setOdMsg("Nessun backup trovato su OneDrive.");
        return;
      }
      sostituisci(d);
      setOdMsg(`Caricati ${d.transazioni.length} movimenti da OneDrive.`);
    });
  }

  function setParam(patch: Partial<typeof p>) {
    aggiorna((d) => ({ ...d, parametri: { ...d.parametri, ...patch } }));
  }

  // ---------- Categorie ----------
  function aggiungiCat() {
    const nome = nuovaCat.trim();
    if (!nome || dati.categorie.some((c) => c.nome === nome)) return;
    aggiorna((d) => ({
      ...d,
      categorie: [...d.categorie, { nome, tipo: "spesa" }],
    }));
    setNuovaCat("");
  }
  function rimuoviCat(nome: string) {
    aggiorna((d) => ({
      ...d,
      categorie: d.categorie.filter((c) => c.nome !== nome),
    }));
  }
  function descriviCat(nome: string, descrizione: string) {
    aggiorna((d) => ({
      ...d,
      categorie: d.categorie.map((c) =>
        c.nome === nome ? { ...c, descrizione: descrizione || undefined } : c,
      ),
    }));
  }

  // ---------- Backup ----------
  function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = importaJson(String(reader.result));
        sostituisci(d);
        setEsitoImport(`Importati ${d.transazioni.length} movimenti.`);
      } catch (err) {
        setEsitoImport("Errore: " + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function svuota() {
    if (confirm("Cancellare TUTTI i dati? Esporta prima un backup.")) {
      sostituisci(datiVuoti());
    }
  }

  // ---------- PIN ----------
  async function impostaPin() {
    if (!pin1) {
      setEsitoPin("Scrivi un PIN di almeno 4 cifre, oppure togli il blocco.");
      return;
    }
    if (pin1.length < 4) {
      setEsitoPin("Troppo corto: servono almeno 4 cifre.");
      return;
    }
    setParam({ pinHash: await sha256(pin1), pinDisattivato: false });
    setEsitoPin("PIN aggiornato. Vale dal prossimo blocco.");
    setPin1("");
  }

  function togliPin() {
    setParam({ pinDisattivato: true });
    setEsitoPin("Blocco rimosso: la sezione si apre senza PIN.");
    setPin1("");
  }

  return (
    <>
      <div className="card">
        <h3>Backup dati</h3>
        <p className="muted">
          I dati restano solo in questo browser. Esporta un file JSON per fare
          backup o spostarli su un altro dispositivo (es. cartella OneDrive).
        </p>
        <div className="riga-azioni">
          <button className="primario" onClick={() => esportaJson(dati)}>
            Esporta JSON
          </button>
          <button
            className="secondario"
            onClick={() => fileRef.current?.click()}
          >
            Importa JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={onImport}
            style={{ display: "none" }}
          />
          <button className="secondario" onClick={svuota}>
            Svuota tutto
          </button>
          {esitoImport && <span className="muted">{esitoImport}</span>}
        </div>
      </div>

      <div className="card">
        <h3>Sincronizza con OneDrive</h3>
        <p className="muted">
          Il backup va in <b>mente-digitale/mente-digitale-finanze.json</b> sul
          tuo OneDrive, insieme agli altri file dell'app, così è disponibile su
          ogni dispositivo senza passare file a mano. Usa l'accesso Microsoft
          già fatto da mente-digitale: non c'è niente da collegare.
        </p>
        {collegato() ? (
          <>
            <div className="riga-azioni">
              <button className="primario" onClick={odSalva} disabled={odBusy}>
                Salva su OneDrive
              </button>
              <button
                className="secondario"
                onClick={odCarica}
                disabled={odBusy}
              >
                Carica da OneDrive
              </button>
              {odMsg && <span className="muted">{odMsg}</span>}
            </div>
            <label
              className="riga-azioni"
              style={{ marginTop: 12, alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={p.oneDriveAutoSync ?? false}
                onChange={(e) =>
                  setParam({ oneDriveAutoSync: e.target.checked })
                }
                style={{ width: "auto" }}
              />
              Salva automaticamente su OneDrive a ogni modifica
            </label>
          </>
        ) : (
          <p className="muted">
            Nessun account Microsoft collegato in questa sessione: accedi da
            mente-digitale e il salvataggio si riattiva da sé.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Migrare il vecchio backup</h3>
        <p className="muted">
          Quando Finanze era un'app separata il backup viveva in{" "}
          <b>Apps/Finanze/finanze.json</b>, una cartella che questa app non può
          più leggere (usava un permesso diverso). Per portare qui i dati basta
          una volta sola: apri la vecchia app, <b>Esporta JSON</b>, poi{" "}
          <b>Importa JSON</b> qui sopra. Da quel momento la sincronizzazione
          riparte da questa cartella.
        </p>
      </div>

      <div className="card">
        <h3>Parametri</h3>
        <div className="form-griglia">
          <label className="campo">
            Saldo iniziale — data
            <input
              type="date"
              value={p.saldoInizialeData}
              onChange={(e) => setParam({ saldoInizialeData: e.target.value })}
            />
          </label>
          <label className="campo">
            Saldo iniziale — valore (€)
            <input
              type="number"
              value={p.saldoInizialeValore}
              onChange={(e) =>
                setParam({ saldoInizialeValore: Number(e.target.value) })
              }
            />
          </label>
          <label className="campo">
            Data di nascita
            <input
              type="date"
              value={p.dataNascita}
              onChange={(e) => setParam({ dataNascita: e.target.value })}
            />
          </label>
          <label className="campo">
            Inflazione annua (es. 0.02 = 2%)
            <input
              type="number"
              step="0.005"
              value={p.inflazione}
              onChange={(e) => setParam({ inflazione: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <MutuiCard />

      <div className="card">
        <h3>Categorie</h3>
        <p className="muted">
          La <b>descrizione</b> di ogni categoria (esempi, negozi tipici, parole
          chiave) viene inclusa nel prompt di <b>Categorizza con Claude</b>:
          più è precisa, migliore è la categorizzazione automatica.
        </p>
        <div className="riga-azioni" style={{ marginBottom: 12 }}>
          <input
            placeholder="Nuova categoria…"
            value={nuovaCat}
            onChange={(e) => setNuovaCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aggiungiCat()}
          />
          <button className="secondario" onClick={aggiungiCat}>
            Aggiungi
          </button>
        </div>
        <div className="lista-categorie">
          {dati.categorie.map((c) => (
            <div key={c.nome} className="cat-riga">
              <div className="cat-nome">
                {c.nome}
                <button
                  onClick={() => rimuoviCat(c.nome)}
                  title="Rimuovi categoria"
                  className="cat-rimuovi"
                >
                  ✕
                </button>
              </div>
              <input
                className="cat-descr"
                placeholder="Descrizione / esempi per la categorizzazione…"
                value={c.descrizione ?? ""}
                onChange={(e) => descriviCat(c.nome, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>PIN della sezione</h3>
        <p className="muted">
          La sezione Finanze si apre con un PIN numerico e si richiude da sola
          dopo mezz'ora (o subito, col pulsante <b>Blocca</b> nella barra delle
          schede). Serve a non lasciare i conti in chiaro su uno schermo aperto
          in ufficio: non è una cifratura, chi ha accesso al browser e sa cosa
          cercare i dati li trova comunque.
        </p>
        <div className="riga-azioni">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Nuovo PIN (min. 4 cifre)"
            value={pin1}
            onChange={(e) => {
              setPin1(e.target.value.replace(/\D/g, ""));
              setEsitoPin("");
            }}
          />
          <button className="secondario" onClick={impostaPin}>
            Salva PIN
          </button>
          {pinAttivo(p) && (
            <button className="secondario" onClick={togliPin}>
              Togli il blocco
            </button>
          )}
          {esitoPin && <span className="muted">{esitoPin}</span>}
        </div>
      </div>
    </>
  );
}

// ---------- Mutui / immobili ----------

function MutuiCard() {
  const { dati, aggiorna } = useApp();
  const mutui = dati.mutui ?? [];
  const oggi = toIso(new Date());

  function mod(id: string, patch: Partial<Mutuo>) {
    aggiorna((d) => ({
      ...d,
      mutui: (d.mutui ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }
  function aggiungi() {
    aggiorna((d) => ({
      ...d,
      mutui: [
        ...(d.mutui ?? []),
        {
          id: uid(),
          descrizione: "Mutuo casa",
          importo: 100000,
          tasso: 0.03,
          durataMesi: 300,
          dataInizio: oggi.slice(0, 8) + "01",
        },
      ],
    }));
  }
  function elimina(id: string) {
    aggiorna((d) => ({
      ...d,
      mutui: (d.mutui ?? []).filter((m) => m.id !== id),
    }));
  }

  const numOr = (v: number | undefined) => (v === undefined ? "" : v);

  return (
    <div className="card">
      <h3>Mutui / immobili</h3>
      <p className="muted">
        Un mutuo non è una spesa piena: la <b>quota capitale</b> delle rate
        diventa equity dell'immobile (patrimonio), solo la{" "}
        <b>quota interessi</b> è un costo. Configura qui il piano; poi nei{" "}
        <b>Movimenti</b> marca le rate col tipo <b>Mutuo</b> (non "Giro":
        anche l'anticipo va lasciato come uscita normale, l'equity la calcola
        il piano da qui). Nella <b>Proiezione</b> ricordati di includere la
        rata nelle spese mensili degli scenari.
      </p>
      {mutui.map((m) => {
        const s = statoMutuo(m, oggi);
        return (
          <div key={m.id} className="mutuo-blocco">
            <div className="form-griglia">
              <label className="campo">
                Descrizione
                <input
                  value={m.descrizione ?? ""}
                  onChange={(e) => mod(m.id, { descrizione: e.target.value })}
                />
              </label>
              <label className="campo">
                Capitale finanziato (€)
                <input
                  type="number"
                  value={numOr(m.importo)}
                  onChange={(e) =>
                    mod(m.id, { importo: Number(e.target.value) })
                  }
                />
              </label>
              <label className="campo">
                TAN annuo (es. 0.032 = 3,2%)
                <input
                  type="number"
                  step="0.001"
                  value={numOr(m.tasso)}
                  onChange={(e) => mod(m.id, { tasso: Number(e.target.value) })}
                />
              </label>
              <label className="campo">
                Durata (mesi)
                <input
                  type="number"
                  value={numOr(m.durataMesi)}
                  onChange={(e) =>
                    mod(m.id, { durataMesi: Number(e.target.value) })
                  }
                />
              </label>
              <label className="campo">
                Prima rata
                <input
                  type="date"
                  value={m.dataInizio}
                  onChange={(e) => mod(m.id, { dataInizio: e.target.value })}
                />
              </label>
              <label className="campo">
                Anticipo versato (€)
                <input
                  type="number"
                  value={numOr(m.anticipo)}
                  onChange={(e) =>
                    mod(m.id, {
                      anticipo:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="campo">
                Valore immobile (€, opzionale)
                <input
                  type="number"
                  value={numOr(m.valoreImmobile)}
                  onChange={(e) =>
                    mod(m.id, {
                      valoreImmobile:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <p className="muted" style={{ margin: "10px 0 0" }}>
              Rata calcolata: <b>{euro(s.rata, true)}</b>/mese
              <Info>
                Piano francese: rata = C × i / (1 − (1+i)<sup>−n</sup>) con C ={" "}
                {euro(m.importo, true)}, i = TAN/12 ={" "}
                {((m.tasso / 12) * 100).toFixed(3)}%, n = {m.durataMesi} mesi.
              </Info>{" "}
              · Rate versate: <b>{s.rateVersate}</b> di {m.durataMesi} · Debito
              residuo: <b>{euro(s.debitoResiduo)}</b> · Equity oggi:{" "}
              <b>{euro(s.equity)}</b>
              <Info>
                <b>Equity</b> = anticipo + capitale rimborsato dalle rate
                scadute.
                <br />
                {euro(m.anticipo ?? 0, true)} +{" "}
                {euro(s.capitaleRimborsato, true)} = <b>{euro(s.equity, true)}</b>
                <br />
                Interessi pagati finora: {euro(s.interessiPagati, true)}.
                {m.valoreImmobile !== undefined && (
                  <>
                    <br />
                    Equity a valore di mercato: {euro(m.valoreImmobile, true)}{" "}
                    − {euro(s.debitoResiduo, true)} ={" "}
                    {euro(m.valoreImmobile - s.debitoResiduo, true)} (solo
                    informativo: nel patrimonio si usa il costo, più prudente).
                  </>
                )}
              </Info>
              <button
                className="cat-rimuovi"
                style={{ marginLeft: 8 }}
                title="Rimuovi mutuo"
                onClick={() => elimina(m.id)}
              >
                ✕
              </button>
            </p>
          </div>
        );
      })}
      <button
        className="secondario"
        style={{ marginTop: 4 }}
        onClick={aggiungi}
      >
        + Aggiungi mutuo
      </button>
    </div>
  );
}
