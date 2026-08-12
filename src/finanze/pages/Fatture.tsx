// Scheda Fatture: elenco delle fatture emesse (o stimate) per anno, con il
// calcolo fiscale del regime forfettario + Inarcassa. È la fonte da cui la
// scheda "Tasse" eredita fatturato, Inarcassa e imposta di ogni anno: qui si
// inseriscono le fatture, lì (e in Saldo/Proiezione) i numeri vengono riusati.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../store/AppStore";
import { AnnoTasse, Fattura } from "../types";
import {
  calcolaAnno,
  anniConFatture,
  analisiComplessiva,
  nettoFattura,
  bolloFattura,
  integrativoFattura,
  totaleFattura,
  giorniEffettiviFattura,
  MATERNITA_DEFAULT,
} from "../engine/fatture";
import { euro, uid, giorniLavorativiDelMese } from "../util";
import { Info } from "../components/Info";
import { Pannello } from "../components/Pannello";
import { Modale } from "../components/Modale";

/** Colore per i valori reali presi da un anno "chiuso" (distinti dalle stime). */
const COLORE_CHIUSO = "#b279a2";

export function Fatture() {
  const { dati, aggiorna } = useApp();
  const fatture = useMemo(() => dati.fatture ?? [], [dati.fatture]);
  const anni = useMemo(() => anniConFatture(fatture), [fatture]);

  // Config fiscale dell'anno (regime ridotto + maternità) presa da AnnoTasse.
  const cfgAnno = (anno: number): AnnoTasse | undefined =>
    dati.tasse.find((t) => t.anno === anno);

  const calcoli = useMemo(
    () =>
      anni.map((anno) => {
        const c = cfgAnno(anno);
        return calcolaAnno(anno, fatture, {
          ridotta: c?.inarcassaRidotta,
          maternita: c?.maternita,
        });
      }),
    [anni, fatture, dati.tasse],
  );

  // ---------- Mutazioni ----------
  function modificaFattura(id: string, patch: Partial<Fattura>) {
    aggiorna((d) => ({
      ...d,
      fatture: (d.fatture ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function eliminaFattura(id: string) {
    aggiorna((d) => ({ ...d, fatture: (d.fatture ?? []).filter((f) => f.id !== id) }));
  }

  function aggiungiFattura(anno: number) {
    // Numerazione: prosegue dal numero più alto dell'anno, se numerico.
    const dellAnno = fatture.filter((f) => f.anno === anno);
    const maxNum = dellAnno.reduce((m, f) => {
      const n = Number(f.numero);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const nuova: Fattura = {
      id: uid(),
      anno,
      numero: String(maxNum + 1),
      dataEmissione: `${anno}-01-31`,
      netto: 0,
      // Nuova fattura: parte come "stimata" (bozza modificabile). Diventa
      // "reale" (e si blocca) solo quando l'utente lo indica esplicitamente.
      stimata: true,
    };
    aggiorna((d) => ({ ...d, fatture: [...(d.fatture ?? []), nuova] }));
  }

  function aggiungiAnno() {
    const nuovo = anni.length ? Math.max(...anni) + 1 : new Date().getFullYear();
    aggiungiFattura(nuovo);
  }

  function modificaConfigAnno(anno: number, patch: Partial<AnnoTasse>) {
    aggiorna((d) => {
      const esiste = d.tasse.some((t) => t.anno === anno);
      return {
        ...d,
        tasse: esiste
          ? d.tasse.map((t) => (t.anno === anno ? { ...t, ...patch } : t))
          : [...d.tasse, { anno, ...patch }],
      };
    });
  }

  // Cambia l'anno di un record AnnoTasse manuale (anno senza fatture).
  function rinominaAnnoManuale(vecchio: number, nuovo: number) {
    if (!nuovo || nuovo === vecchio) return;
    aggiorna((d) => ({
      ...d,
      tasse: d.tasse.map((t) => (t.anno === vecchio ? { ...t, anno: nuovo } : t)),
    }));
  }

  function eliminaAnnoManuale(anno: number) {
    aggiorna((d) => ({ ...d, tasse: d.tasse.filter((t) => t.anno !== anno) }));
  }

  function aggiungiAnnoManuale() {
    // Propone l'anno mancante più vicino (di solito uno prima del più vecchio).
    const esistenti = new Set([
      ...anni,
      ...dati.tasse.map((t) => t.anno),
    ]);
    let nuovo = anni.length ? Math.min(...anni) - 1 : new Date().getFullYear();
    while (esistenti.has(nuovo)) nuovo -= 1;
    aggiorna((d) => ({ ...d, tasse: [...d.tasse, { anno: nuovo }] }));
  }

  const analisi = useMemo(
    () => analisiComplessiva(dati.tasse, fatture),
    [dati.tasse, fatture],
  );

  const numOr = (v: number | undefined) => (v === undefined ? "" : v);

  if (fatture.length === 0) {
    return (
      <div className="card">
        <h3>Fatture</h3>
        <p className="muted">
          Registra qui le tue fatture (regime forfettario). Da questi dati
          vengono calcolati fatturato, Inarcassa e imposta sostitutiva di ogni
          anno, che la scheda <b>Tasse</b> eredita automaticamente. Puoi marcare
          ogni fattura come <b>reale</b> (emessa) o <b>stimata</b> (previsionale)
          per proiettare l'anno in corso.
        </p>
        <button className="primario" onClick={aggiungiAnno}>
          + Aggiungi la prima fattura
        </button>
      </div>
    );
  }

  return (
    <>
      {/* -------- Analisi complessiva -------- */}
      <div className="card">
        <h3>Analisi complessiva</h3>
        <p className="muted" style={{ marginTop: -4 }}>
          Riepilogo del lavoro anno per anno: fatturato, tasse e — soprattutto —
          quanto resta netto al mese. Il <b>netto/mese</b> è (netto in tasca +
          entrate extra non tassate − spese) diviso 12 (o 13, per confronto con
          un dipendente). Puoi aggiungere anni interamente <b>manuali</b> (es.
          2020) e compilarli a mano. Per gli anni con fatture, fatturato,
          Inarcassa e imposta sono stimati; se marchi l'anno come <b>chiuso</b>{" "}
          nella scheda Tasse, qui compare invece il valore reale (in{" "}
          <span style={{ color: COLORE_CHIUSO, fontWeight: 600 }}>colore</span>).
        </p>
        <div className="tabella-wrap">
          <table>
            <thead>
              <tr>
                <th>Anno</th>
                <th className="num">Fatturato</th>
                <th className="num">Inarcassa</th>
                <th className="num">
                  Imposta
                  <Info>
                    Solo l'<b>imposta sostitutiva</b> (15%) calcolata dalle
                    fatture: è lo stesso valore che vedi nella scheda{" "}
                    <b>Tasse</b>. Lì la colonna "Imposta" somma però anche gli{" "}
                    <b>aggiuntivi</b> (es. cedolare secca sull'affitto), che qui
                    non compaiono perché riguardano redditi non presenti in
                    questa tabella: per questo l'imposta di Tasse può risultare
                    più alta di quella indicata qui.
                  </Info>
                </th>
                <th className="num">
                  Entrate extra
                  <Info>
                    Entrate dell'anno NON soggette a tasse (rimborsi, lavoretti
                    occasionali…): non toccano il calcolo fiscale ma si sommano
                    al netto/mese.
                  </Info>
                </th>
                <th className="num">
                  Spese
                  <Info>
                    Spese dell'anno da sottrarre dal netto/mese (es. costi
                    professionali non deducibili nel forfettario).
                  </Info>
                </th>
                <th className="num">Netto totale</th>
                <th className="num">Netto/mese 12</th>
                <th className="num">Netto/mese 13</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {analisi.map((r) => (
                <tr key={r.anno}>
                  <td>
                    {r.haFatture ? (
                      <b>{r.anno}</b>
                    ) : (
                      <input
                        type="number"
                        style={{ width: 64 }}
                        value={r.anno}
                        title="Anno manuale: puoi cambiarlo"
                        onChange={(e) =>
                          rinominaAnnoManuale(r.anno, Number(e.target.value) || r.anno)
                        }
                      />
                    )}
                  </td>
                  {/* Fatturato: calcolato se ci sono fatture, altrimenti a mano */}
                  {r.haFatture ? (
                    <td className="num">
                      <ValoreStima
                        valore={r.fatturato}
                        chiuso={r.fatturatoDaChiuso}
                        voce="fatturato"
                      />
                      {!r.fatturatoDaChiuso && r.fatturatoStimato > 0 && (
                        <span
                          className="muted"
                          style={{ display: "block", fontSize: 11 }}
                          title="Parte da fatture stimate"
                        >
                          di cui stim. {euro(r.fatturatoStimato)}
                        </span>
                      )}
                    </td>
                  ) : (
                    <CellaEuroEdit
                      valore={cfgAnno(r.anno)?.fatturato}
                      onSet={(v) => modificaConfigAnno(r.anno, { fatturato: v })}
                    />
                  )}
                  {/* Inarcassa */}
                  {r.haFatture ? (
                    <td className="num">
                      <ValoreStima valore={r.inarcassa} chiuso={r.inarcassaDaChiuso} voce="Inarcassa" />
                    </td>
                  ) : (
                    <CellaEuroEdit
                      valore={cfgAnno(r.anno)?.inarcassa}
                      onSet={(v) => modificaConfigAnno(r.anno, { inarcassa: v })}
                    />
                  )}
                  {/* Imposta */}
                  {r.haFatture ? (
                    <td className="num">
                      <ValoreStima valore={r.imposta} chiuso={r.impostaDaChiuso} voce="imposta" />
                    </td>
                  ) : (
                    <CellaEuroEdit
                      valore={cfgAnno(r.anno)?.irpef}
                      onSet={(v) => modificaConfigAnno(r.anno, { irpef: v })}
                    />
                  )}
                  {/* Entrate extra / Spese: sempre editabili */}
                  <CellaEuroEdit
                    valore={cfgAnno(r.anno)?.entrateExtra}
                    onSet={(v) => modificaConfigAnno(r.anno, { entrateExtra: v })}
                  />
                  <CellaEuroEdit
                    valore={cfgAnno(r.anno)?.spese}
                    onSet={(v) => modificaConfigAnno(r.anno, { spese: v })}
                  />
                  <td className="num">
                    <b>{euro(r.nettoInTasca, true)}</b>
                  </td>
                  <td className="num">{euro(r.nettoMensile12)}</td>
                  <td className="num">{euro(r.nettoMensile13)}</td>
                  <td>
                    {!r.haFatture && (
                      <button
                        className="secondario"
                        style={{ padding: "2px 8px" }}
                        title="Rimuovi questo anno manuale/ipotetico"
                        onClick={() => eliminaAnnoManuale(r.anno)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="secondario" onClick={aggiungiAnnoManuale}>
            + Aggiungi anno manuale
          </button>
        </div>
      </div>

      {/* -------- Sezioni per anno (dalla più recente) -------- */}
      {anni.map((anno) => {
        const c = calcoli.find((x) => x.anno === anno)!;
        const cfg = cfgAnno(anno);
        const dellAnno = fatture
          .filter((f) => f.anno === anno)
          .sort((a, b) => b.dataEmissione.localeCompare(a.dataEmissione));
        return (
          <Pannello
            key={anno}
            titolo={`Anno ${anno}`}
            apertoDefault={anno === anni[0]}
            extra={
              <span className="muted" style={{ fontSize: 13 }}>
                {euro(c.fatturato)} · netto {euro(c.nettoMensile12)}/mese
              </span>
            }
          >
            {/* Config fiscale dell'anno */}
            <div className="form-griglia" style={{ marginBottom: 12 }}>
              <label className="campo" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cfg?.inarcassaRidotta ?? false}
                  onChange={(e) =>
                    modificaConfigAnno(anno, {
                      inarcassaRidotta: e.target.checked || undefined,
                    })
                  }
                />
                Inarcassa ridotta (soggettivo 7,25%)
                <Info>
                  Se attivo il contributo soggettivo è al 7,25% invece del
                  14,5%. Tipico dei primi anni di attività o sotto soglia.
                </Info>
              </label>
              <label className="campo">
                Contributo maternità €
                <input
                  type="number"
                  step="1"
                  style={{ width: 120 }}
                  placeholder={String(MATERNITA_DEFAULT)}
                  value={numOr(cfg?.maternita)}
                  onChange={(e) =>
                    modificaConfigAnno(anno, {
                      maternita:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>

            {/* Elenco fatture */}
            <div className="tabella-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nr</th>
                    <th>Tipo</th>
                    <th>Data</th>
                    <th>Destinatario</th>
                    <th className="num">
                      Giorni lav.
                      <Info>
                        Giorni lavorativi del mese − ferie/malattia + giorni
                        extra + giorni spostati dal mese precedente. Premi il
                        valore per aprire il pop-up e modificare i singoli
                        campi.
                      </Info>
                    </th>
                    <th className="num">Prezzo/gg €</th>
                    <th className="num">Netto €</th>
                    <th className="num">Bollo €</th>
                    <th className="num">
                      Integr. 4%
                      <Info>
                        Contributo integrativo Inarcassa: 4% su (netto + bollo),
                        addebitato al cliente. Zero per le fatture estero.
                      </Info>
                    </th>
                    <th className="num">Totale €</th>
                    <th style={{ textAlign: "center" }}>Estero</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dellAnno.map((f) => (
                    <RigaFattura
                      key={f.id}
                      f={f}
                      onSet={(patch) => modificaFattura(f.id, patch)}
                      onElimina={() => eliminaFattura(f.id)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={4}>Totale fatturato</th>
                    <th></th>
                    <th></th>
                    <th className="num">{euro(c.fatturato, true)}</th>
                    <th className="num">{euro(c.bolli, true)}</th>
                    <th className="num">{euro(c.integrativoGrezzo, true)}</th>
                    <th className="num">{euro(c.incassato, true)}</th>
                    <th colSpan={2}></th>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: 10 }}>
              <button className="secondario" onClick={() => aggiungiFattura(anno)}>
                + Aggiungi fattura {anno}
              </button>
            </div>

            {/* Quadro fiscale dell'anno */}
            <div className="stat-griglia" style={{ marginTop: 16 }}>
              <VoceCalcolo
                etichetta="Imponibile"
                valore={c.imponibile}
                info={
                  <>
                    Coefficiente ATECO 78% × volume d'affari (fatturato + bolli).
                    <br />
                    0,78 × {euro(c.volumeAffari, true)} = <b>{euro(c.imponibile, true)}</b>
                  </>
                }
              />
              <VoceCalcolo
                etichetta="Inarcassa totale"
                valore={c.inarcassa}
                info={
                  <>
                    Soggettivo {euro(c.soggettivo, true)} + integrativo{" "}
                    {euro(c.integrativo, true)} + maternità {euro(c.maternita, true)}.
                    {c.ridotta && <> Regime ridotto (7,25%).</>}
                  </>
                }
              />
              <VoceCalcolo
                etichetta="Imposta sostitutiva"
                valore={c.imposta}
                info={
                  <>
                    15% × (imponibile − Inarcassa).
                    <br />
                    0,15 × ({euro(c.imponibile, true)} − {euro(c.inarcassa, true)}) ={" "}
                    <b>{euro(c.imposta, true)}</b>
                  </>
                }
              />
              <VoceCalcolo
                etichetta="Netto in tasca"
                valore={c.nettoTotale}
                forte
                info={
                  <>
                    Totale incassato − imposta − Inarcassa.
                    <br />
                    {euro(c.incassato, true)} − {euro(c.imposta, true)} −{" "}
                    {euro(c.inarcassa, true)} = <b>{euro(c.nettoTotale, true)}</b>
                  </>
                }
              />
            </div>
          </Pannello>
        );
      })}

      <div style={{ marginTop: 12 }}>
        <button className="secondario" onClick={aggiungiAnno}>
          + Aggiungi anno
        </button>
      </div>
    </>
  );
}

/** Una voce del quadro fiscale (riquadro con etichetta, valore e spiegazione). */
function VoceCalcolo({
  etichetta,
  valore,
  info,
  forte,
}: {
  etichetta: string;
  valore: number;
  info: ReactNode;
  forte?: boolean;
}) {
  return (
    <div className="stat">
      <div className="etichetta">
        {etichetta}
        <Info>{info}</Info>
      </div>
      <div className="valore" style={forte ? { color: "var(--entrata)" } : undefined}>
        {euro(valore, true)}
      </div>
    </div>
  );
}

/** Riga editabile di una fattura; le giornate lavorate si aprono in un pop-up. */
function RigaFattura({
  f,
  onSet,
  onElimina,
}: {
  f: Fattura;
  onSet: (patch: Partial<Fattura>) => void;
  onElimina: () => void;
}) {
  const [modaleAperto, setModaleAperto] = useState(false);
  const netto = nettoFattura(f);
  const bollo = bolloFattura(f);
  const integr = integrativoFattura(f);
  const tot = totaleFattura(f);
  // Fattura "reale" (non più stimata): bloccata, non modificabile per errore.
  const bloccata = !f.stimata;

  function apriModaleGiornate() {
    // Prima apertura: propone i giorni lavorativi del mese della fattura.
    // Se poi l'utente lo modifica, il valore scritto resta (non viene più
    // ricalcolato automaticamente).
    if (f.giorni === undefined) {
      onSet({ giorni: giorniLavorativiDelMese(f.dataEmissione) });
    }
    setModaleAperto(true);
  }

  function attivaGiornate() {
    const attivo = !f.daGiornate;
    onSet({ daGiornate: attivo || undefined });
    if (attivo) apriModaleGiornate();
  }

  function toggleReale() {
    if (bloccata) {
      // Da reale a stimata: sblocca di nuovo la fattura alla modifica, va avvisato.
      const ok = confirm(
        `La fattura ${f.numero ?? ""} è segnata come "Reale". Rimettendola "Stimata" tornerà modificabile: continuare?`,
      );
      if (!ok) return;
      onSet({ stimata: true });
    } else {
      onSet({ stimata: undefined });
    }
  }

  return (
    <>
      <tr>
        <td>
          <input
            type="text"
            style={{ width: 48 }}
            value={f.numero ?? ""}
            disabled={bloccata}
            onChange={(e) => onSet({ numero: e.target.value || undefined })}
          />
        </td>
        <td>
          <button
            className="secondario"
            style={{ padding: "2px 8px", whiteSpace: "nowrap" }}
            title={
              bloccata
                ? "Fattura reale: bloccata. Clicca per rimetterla stimata e modificarla"
                : "Fattura realmente emessa o solo stimata"
            }
            onClick={toggleReale}
          >
            {f.stimata ? "Stimata" : "Reale"}
          </button>
        </td>
        <td>
          <input
            type="date"
            value={f.dataEmissione}
            disabled={bloccata}
            onChange={(e) => onSet({ dataEmissione: e.target.value })}
          />
        </td>
        <td>
          <input
            type="text"
            style={{ width: 120 }}
            value={f.destinatario ?? ""}
            disabled={bloccata}
            onChange={(e) => onSet({ destinatario: e.target.value || undefined })}
          />
        </td>
        <td className="num">
          {f.daGiornate ? (
            <button
              className="secondario"
              style={{ padding: "2px 6px", whiteSpace: "nowrap" }}
              title="Modifica giorni lavorativi, ferie/malattia ed extra"
              onClick={apriModaleGiornate}
            >
              <b>{formattaGiorni(giorniEffettiviFattura(f))}</b>
            </button>
          ) : (
            <span className="muted">—</span>
          )}
          <button
            className="secondario"
            style={{ padding: "1px 6px", marginLeft: 4, fontSize: 11 }}
            title="Calcola il netto dalle giornate lavorate"
            disabled={bloccata}
            onClick={attivaGiornate}
          >
            gg
          </button>
        </td>
        <td className="num">
          <CampoPrezzoGiorno
            valore={f.prezzoGiorno}
            disabled={bloccata}
            onSet={(v) => onSet({ prezzoGiorno: v })}
          />
        </td>
        <td className="num">
          {f.daGiornate ? (
            <b>{euro(netto, true)}</b>
          ) : (
            <input
              type="number"
              step="0.01"
              style={{ width: 90 }}
              value={f.netto ?? ""}
              disabled={bloccata}
              onChange={(e) =>
                onSet({ netto: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          )}
        </td>
        <td className="num">
          <input
            type="number"
            step="0.01"
            style={{ width: 60 }}
            placeholder={String(bollo)}
            value={f.bollo ?? ""}
            disabled={bloccata}
            onChange={(e) =>
              onSet({ bollo: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </td>
        <td className="num muted">{euro(integr, true)}</td>
        <td className="num">
          <b>{euro(tot, true)}</b>
        </td>
        <td style={{ textAlign: "center" }}>
          <input
            type="checkbox"
            checked={!!f.estero}
            disabled={bloccata}
            onChange={(e) => onSet({ estero: e.target.checked || undefined })}
          />
        </td>
        <td>
          <span className="riga-azioni" style={{ gap: 4 }}>
            <button
              className="secondario"
              style={{ padding: "2px 6px" }}
              onClick={onElimina}
            >
              ✕
            </button>
          </span>
        </td>
      </tr>
      {modaleAperto && (
        <Modale
          titolo={`Giornate — fattura ${f.numero ?? ""} (${f.dataEmissione})`}
          onClose={() => setModaleAperto(false)}
        >
          <div className="form-griglia">
            <CampoGiorno
              etichetta="Giorni lavorativi"
              valore={f.giorni}
              disabled={bloccata}
              onSet={(v) => onSet({ giorni: v })}
            />
            <CampoGiorno
              etichetta="Ferie / malattia"
              valore={f.ferie}
              disabled={bloccata}
              onSet={(v) => onSet({ ferie: v })}
            />
            <CampoGiorno
              etichetta="Giorni extra"
              valore={f.extra}
              disabled={bloccata}
              onSet={(v) => onSet({ extra: v })}
            />
            <CampoGiorno
              etichetta="Spostati dal mese prec."
              valore={f.spostati}
              disabled={bloccata}
              onSet={(v) => onSet({ spostati: v })}
            />
          </div>
        </Modale>
      )}
    </>
  );
}

/** Formatta i giorni (possono avere mezze giornate) senza zeri decimali inutili. */
function formattaGiorni(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
}

/**
 * Campo prezzo/giorno: input di testo (non "number") per poter digitare le
 * cifre liberamente senza dover usare le freccette di incremento. Tiene un
 * testo locale mentre si scrive, cosi' un punto/virgola decimale a fine
 * digitazione non viene "rimangiato" dal valore numerico gia' salvato.
 */
function CampoPrezzoGiorno({
  valore,
  onSet,
  disabled,
}: {
  valore: number | undefined;
  onSet: (v: number | undefined) => void;
  disabled?: boolean;
}) {
  const [testo, setTesto] = useState(valore === undefined ? "" : String(valore));

  useEffect(() => {
    setTesto(valore === undefined ? "" : String(valore));
  }, [valore]);

  function scrivi(v: string) {
    const pulito = v.replace(",", ".");
    if (pulito !== "" && !/^\d*\.?\d*$/.test(pulito)) return; // ignora caratteri non numerici
    setTesto(v);
    if (pulito === "" || pulito === ".") {
      onSet(undefined);
    } else if (!pulito.endsWith(".")) {
      onSet(Number(pulito));
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      style={{ width: 70 }}
      value={testo}
      disabled={disabled}
      onChange={(e) => scrivi(e.target.value)}
    />
  );
}

/** Cella con importo €, editabile (usata per gli anni manuali ed extra/spese). */
function CellaEuroEdit({
  valore,
  onSet,
}: {
  valore: number | undefined;
  onSet: (v: number | undefined) => void;
}) {
  return (
    <td className="num">
      <input
        type="number"
        step="0.01"
        style={{ width: 92 }}
        value={valore === undefined ? "" : valore}
        onChange={(e) => onSet(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </td>
  );
}

/**
 * Mostra un valore fiscale stimato dalle fatture; se proviene da un anno
 * "chiuso" (valore reale dichiarato in Tasse) lo colora e spiega il perché al
 * passaggio del mouse.
 */
function ValoreStima({
  valore,
  chiuso,
  voce,
}: {
  valore: number;
  chiuso: boolean;
  voce: string;
}) {
  if (!chiuso) return <>{euro(valore, true)}</>;
  return (
    <b
      style={{ color: COLORE_CHIUSO }}
      title={`Valore reale di ${voce}: l'anno è segnato "chiuso" nella scheda Tasse, quindi qui si usa l'importo davvero dichiarato invece della stima calcolata dalle fatture.`}
    >
      {euro(valore, true)}
    </b>
  );
}

function CampoGiorno({
  etichetta,
  valore,
  onSet,
  step = "0.5",
  disabled,
}: {
  etichetta: string;
  valore: number | undefined;
  onSet: (v: number | undefined) => void;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <label className="campo">
      {etichetta}
      <input
        type="number"
        step={step}
        style={{ width: 110 }}
        value={valore ?? ""}
        disabled={disabled}
        onChange={(e) => onSet(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}
