import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useApp } from "../store/AppStore";
import { EventoFuturo, Investimento } from "../types";
import { calcolaProiezione, campionaMesi } from "../engine/proiezione";
import { tasseConFatture } from "../engine/fatture";
import { stimaPensioneInarcassa } from "../engine/inarcassa";
import { euro, uid, numRecharts } from "../util";
import { Info } from "../components/Info";
import { Pannello } from "../components/Pannello";

const COL_LIQ = "#4c78a8"; // liquido
const COL_CAP = "#8a94a6"; // capitale investito
const COL_GAIN = "#54a24b"; // guadagni
const COL_IMM = "#b279a2"; // equity immobiliare (mutui)

export function Proiezione() {
  const { dati, aggiorna } = useApp();
  const p = dati.parametri;

  const ris = useMemo(
    () =>
      calcolaProiezione(
        dati.transazioni,
        tasseConFatture(dati.tasse, dati.fatture),
        dati.eventiFuturi,
        dati.investimenti,
        dati.parametri,
        dati.mutui ?? [],
      ),
    [dati],
  );

  const datiGrafico = useMemo(() => campionaMesi(ris.punti, 3), [ris.punti]);

  function setParam(patch: Partial<typeof p>) {
    aggiorna((d) => ({ ...d, parametri: { ...d.parametri, ...patch } }));
  }

  const annoPensione = ris.dataPensione?.slice(0, 4);

  // Rendita integrativa: la stima dell'engine è LORDA (tasso di prelievo sul
  // capitale). L'imposta si applica SOLO sulla plusvalenza latente (come un ETF:
  // si tassa il guadagno, non il capitale versato né il liquido né l'immobile),
  // quindi moltiplichiamo l'aliquota per la sola quota tassabile del capitale.
  const aliquotaRendita = p.aliquotaRendita ?? 0.15;
  const quotaTassabile = ris.quotaTassabilePensione ?? 0;
  const aliquotaEffettiva = aliquotaRendita * quotaTassabile;
  const renditaNettaAnnua =
    ris.renditaAnnua !== undefined
      ? ris.renditaAnnua * (1 - aliquotaEffettiva)
      : undefined;

  // Stima informativa della pensione pubblica Inarcassa (da prendere con le
  // pinze: il sistema può cambiare). Affiancata, non sommata, alla rendita.
  const inarcassa = useMemo(
    () => stimaPensioneInarcassa(dati.fatture, dati.parametri, dati.eventiFuturi),
    [dati.fatture, dati.parametri, dati.eventiFuturi],
  );
  const coperturaTotaleMese =
    renditaNettaAnnua !== undefined && inarcassa
      ? renditaNettaAnnua / 12 + inarcassa.pensioneAnnua / 12
      : undefined;

  if (dati.eventiFuturi.length === 0 && dati.investimenti.length === 0) {
    return (
      <>
        <div className="card">
          <h3>Proiezione futura</h3>
          <p className="muted">
            Non ci sono ancora scenari futuri. Aggiungi eventi (entrate/uscite
            previste, spese grosse) e investimenti per stimare la ricchezza
            futura e la pensione integrativa. Se hai il backup JSON con i dati
            dell'Excel, importalo da <b>Impostazioni</b>.
          </p>
        </div>
        <Pannello titolo="Scenari entrate/uscite" apertoDefault>
          <EditorEventi />
        </Pannello>
        <Pannello titolo="Investimenti" apertoDefault>
          <EditorInvestimenti />
        </Pannello>
      </>
    );
  }

  return (
    <>
      <div className="stat-griglia">
        <div className="stat">
          <div className="etichetta">
            Patrimonio netto oggi
            <Info>
              Punto di partenza della proiezione: liquido attuale (dalla pagina{" "}
              <b>Saldo reale</b>, curva potere d'acquisto) + capitale investito
              + guadagni maturati + equity immobiliare dei mutui, al primo mese
              proiettato.
            </Info>
          </div>
          <div className="valore">{euro(ris.patrimonioOggi)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            liquido + investimenti
          </div>
        </div>
        <div className="stat">
          <div className="etichetta">
            Capitale a {p.etaPensione ?? 67} anni
            <Info>
              Proiezione mese per mese fino al {annoPensione}: liquido (+
              risparmi degli scenari − spese grosse − versamenti negli
              investimenti) + capitale versato + interessi composti al tasso
              reale di ogni tranche. Tutto in € di oggi (inflazione già
              scontata nei tassi).
            </Info>
          </div>
          <div className="valore">{euro(ris.capitalePensione)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            nel {annoPensione}, in € di oggi
          </div>
        </div>
        <div className="stat">
          <div className="etichetta">
            Rendita integrativa /anno — LORDA
            <Info>
              <b>Rendita lorda</b> = capitale a pensione × tasso di prelievo.
              <br />
              {euro(ris.capitalePensione, true)} ×{" "}
              {((p.tassoRendita ?? 0.035) * 100).toFixed(1)}% ={" "}
              <b>{euro(ris.renditaAnnua, true)}</b>/anno
            </Info>
          </div>
          <div className="valore">{euro(ris.renditaAnnua)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            ~{euro(ris.renditaMensile)}/mese · prelievo{" "}
            {((p.tassoRendita ?? 0.035) * 100).toFixed(1)}% · <b>non ancora tassata</b>
          </div>
        </div>
        <div className="stat">
          <div className="etichetta">
            Rendita netta stimata /anno
            <Info>
              L'imposta ({(aliquotaRendita * 100).toFixed(0)}%) colpisce <b>solo
              la plusvalenza</b> (come un ETF): il capitale versato, il liquido e
              l'equity immobiliare non pagano capital gain al prelievo. Quota
              tassabile del capitale = <b>{(quotaTassabile * 100).toFixed(0)}%</b>{" "}
              → aliquota effettiva {(aliquotaEffettiva * 100).toFixed(1)}%.
              <br />
              {euro(ris.renditaAnnua, true)} × (1 −{" "}
              {(aliquotaEffettiva * 100).toFixed(1)}%) ={" "}
              <b>{euro(renditaNettaAnnua, true)}</b>/anno
            </Info>
          </div>
          <div className="valore" style={{ color: COL_GAIN }}>
            {euro(renditaNettaAnnua)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            ~{euro(renditaNettaAnnua !== undefined ? renditaNettaAnnua / 12 : undefined)}
            /mese · tassa {(aliquotaRendita * 100).toFixed(0)}% sui soli guadagni
          </div>
        </div>
      </div>

      {ris.liquiditaMinima !== undefined && ris.liquiditaMinima < 0 && (
        <div className="card" style={{ borderColor: "var(--uscita)" }}>
          <p style={{ margin: 0 }}>
            ⚠️ In alcuni mesi la <b>liquidità scende sotto zero</b> (minimo{" "}
            {euro(ris.liquiditaMinima)}): con queste ipotesi lo scenario non si
            autofinanzia — i versamenti negli investimenti o le spese grosse
            superano i risparmi disponibili.
          </p>
        </div>
      )}

      <div className="card">
        <div className="form-griglia" style={{ marginBottom: 4 }}>
          <label className="campo">
            Età pensione
            <input
              type="number"
              value={p.etaPensione ?? 67}
              onChange={(e) => setParam({ etaPensione: Number(e.target.value) })}
            />
          </label>
          <label className="campo">
            Tasso rendita (es. 0.035 = 3,5%)
            <input
              type="number"
              step="0.005"
              value={p.tassoRendita ?? 0.035}
              onChange={(e) => setParam({ tassoRendita: Number(e.target.value) })}
            />
          </label>
          <label className="campo">
            Tassazione rendita (es. 0.15 = 15%)
            <input
              type="number"
              step="0.01"
              value={p.aliquotaRendita ?? 0.15}
              onChange={(e) =>
                setParam({ aliquotaRendita: Number(e.target.value) })
              }
            />
          </label>
          <label className="campo">
            Inflazione annua (già scontata nei tassi reali)
            <input
              type="number"
              step="0.005"
              value={p.inflazione}
              onChange={(e) => setParam({ inflazione: Number(e.target.value) })}
            />
          </label>
          <label className="campo">
            Coeff. trasformazione Inarcassa (es. 0.055)
            <input
              type="number"
              step="0.001"
              value={p.coeffTrasformazioneInarcassa ?? 0.055}
              onChange={(e) =>
                setParam({ coeffTrasformazioneInarcassa: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Tutti i valori sono in <b>potere d'acquisto di oggi</b>: entrate e
          rendimenti sono già al netto dell'inflazione. La <b>rendita lorda</b>{" "}
          (tasso di prelievo sul capitale) <b>non è tassata</b>; la{" "}
          <b>rendita netta</b> applica l'aliquota <b>solo alla plusvalenza</b>{" "}
          (capital gain, tipico di un ETF: ~26%). Per un fondo pensione la
          tassazione sarebbe ~15% (fino al 9%), ma da forfettario i versamenti
          non sono deducibili.
        </p>
      </div>

      {inarcassa && (
        <div className="card">
          <div className="stat-griglia">
            <div className="stat">
              <div className="etichetta">
                Pensione Inarcassa stimata /anno
                <Info>
                  Stima <b>grezza e informativa</b> col metodo contributivo:
                  montante = per ogni anno (passato dalle fatture, futuro dagli
                  scenari) contributo soggettivo ad <b>aliquota piena</b> + 50%
                  dell'integrativo (il regime ridotto riduce solo il versamento
                  in cassa, non il montante: Inarcassa accredita la differenza
                  come "figurativo"), capitalizzato fino a pensione al{" "}
                  <b>tasso di rivalutazione reale di Inarcassa</b> (
                  {(inarcassa.rivalutazioneReale * 100).toFixed(2)}%/anno — il
                  montante si rivaluta al PIL nominale, storicamente sotto
                  l'inflazione, quindi perde potere d'acquisto in attesa della
                  pensione: l'opposto degli Investimenti, già a tasso reale).
                  Pensione = montante × {(inarcassa.coeff * 100).toFixed(1)}%.
                  <br />
                  {euro(inarcassa.montante, true)} montante ·{" "}
                  {inarcassa.anniContribuzione} anni di contribuzione.
                </Info>
              </div>
              <div className="valore">{euro(inarcassa.pensioneAnnua)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                ~{euro(inarcassa.pensioneMensile)}/mese (su 13) · a{" "}
                {inarcassa.annoPensione}
              </div>
            </div>
            <div className="stat">
              <div className="etichetta">
                Copertura totale stimata /mese
                <Info>
                  Rendita integrativa netta + pensione Inarcassa stimata, al
                  mese. È un <b>ordine di grandezza</b>: la parte Inarcassa non è
                  garantita e il sistema può cambiare.
                </Info>
              </div>
              <div className="valore" style={{ color: COL_GAIN }}>
                {euro(coperturaTotaleMese)}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                integrativa {euro(renditaNettaAnnua !== undefined ? renditaNettaAnnua / 12 : undefined)}{" "}
                + Inarcassa {euro(inarcassa.pensioneMensile)}
              </div>
            </div>
          </div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            ⚠️ La pensione Inarcassa è una <b>stima ottimistica-neutra</b>
            (montante rivalutato ~inflazione ⇒ ~0 reale; solo contributo
            soggettivo). Aliquote, coefficienti, età e sostenibilità della cassa
            possono cambiare: <b>non</b> considerarla un'entrata certa.
          </p>
        </div>
      )}

      <div className="proiezione-griglia">
        <div className="card colonna-grafico">
        <h3>Ricchezza futura stimata</h3>
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <AreaChart
              data={datiGrafico}
              margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bordo)" />
              <XAxis
                dataKey="data"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(v: string) => v.slice(0, 4)}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(v) => euro(v)}
                width={80}
              />
              <Tooltip
                formatter={(v: unknown) => euro(numRecharts(v))}
                labelFormatter={(l: unknown) => String(l).slice(0, 7)}
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--bordo)",
                  borderRadius: 8,
                  color: "var(--testo)",
                }}
              />
              <Legend />
              {ris.dataPensione && (
                <ReferenceLine
                  x={
                    datiGrafico.find((d) => d.data >= ris.dataPensione!)?.data
                  }
                  stroke="var(--muted)"
                  strokeDasharray="4 4"
                  label={{
                    value: `pensione (${p.etaPensione ?? 67})`,
                    fontSize: 11,
                    fill: "var(--muted)",
                    position: "top",
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="liquido"
                name="Liquido"
                stackId="1"
                stroke={COL_LIQ}
                fill={COL_LIQ}
                fillOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="investito"
                name="Capitale investito"
                stackId="1"
                stroke={COL_CAP}
                fill={COL_CAP}
                fillOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="guadagni"
                name="Guadagni investimenti"
                stackId="1"
                stroke={COL_GAIN}
                fill={COL_GAIN}
                fillOpacity={0.5}
              />
              {(dati.mutui?.length ?? 0) > 0 && (
                <Area
                  type="monotone"
                  dataKey="immobile"
                  name="Immobile (equity)"
                  stackId="1"
                  stroke={COL_IMM}
                  fill={COL_IMM}
                  fillOpacity={0.5}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          L'area totale è il patrimonio netto: <b>liquido</b> (cash disponibile,
          già al netto di versamenti e spese grosse), <b>capitale investito</b>{" "}
          (vincolato, include i giroconti/PAC già trasferiti), <b>guadagni</b>{" "}
          (interessi composti){(dati.mutui?.length ?? 0) > 0 && (
            <>
              {" "}e <b>immobile</b> (anticipo + capitale del mutuo rimborsato,
              che cresce rata dopo rata — la rata va inclusa nelle spese degli
              scenari)
            </>
          )}. Il capitale resta investito fino alla pensione: solo lì le
          tranche maturano e tornano nel liquido.
        </p>
        </div>

        <div className="colonna-editor">
          <Pannello
            titolo={`Scenari entrate/uscite (${dati.eventiFuturi.length})`}
            sottotitolo="· apri per modificare"
          >
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Modifica i valori: il grafico si aggiorna in tempo reale.
            </p>
            <EditorEventi />
          </Pannello>
          <Pannello
            titolo={`Investimenti (${dati.investimenti.length})`}
            sottotitolo="· apri per modificare"
          >
            <EditorInvestimenti />
          </Pannello>
        </div>
      </div>
    </>
  );
}

// ---------- Editor eventi ----------

function EditorEventi() {
  const { dati, aggiorna } = useApp();
  const eventi = [...dati.eventiFuturi].sort((a, b) =>
    a.dataInizio.localeCompare(b.dataInizio),
  );

  function mod(id: string, patch: Partial<EventoFuturo>) {
    aggiorna((d) => ({
      ...d,
      eventiFuturi: d.eventiFuturi.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    }));
  }
  function aggiungi() {
    aggiorna((d) => ({
      ...d,
      eventiFuturi: [
        ...d.eventiFuturi,
        {
          id: uid(),
          descrizione: "Nuovo evento",
          dataInizio: new Date().toISOString().slice(0, 10),
          aliquota: 0.22,
        },
      ],
    }));
  }
  function elimina(id: string) {
    aggiorna((d) => ({
      ...d,
      eventiFuturi: d.eventiFuturi.filter((e) => e.id !== id),
    }));
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="tabella-wrap">
        <table>
          <thead>
            <tr>
              <th>Descrizione</th>
              <th>Da</th>
              <th className="num">Fatt./mese</th>
              <th className="num">Aliquota</th>
              <th className="num">Spesa/mese</th>
              <th className="num">Spesa grossa</th>
              <th className="num">Risparmio/mese</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {eventi.map((e) => {
              const netto = (e.fatturatoMensile ?? 0) * (1 - (e.aliquota ?? 0));
              const risp = netto - (e.spesaMensile ?? 0);
              return (
                <tr key={e.id}>
                  <td>
                    <input
                      style={{ width: 180 }}
                      value={e.descrizione}
                      onChange={(ev) => mod(e.id, { descrizione: ev.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={e.dataInizio}
                      onChange={(ev) => mod(e.id, { dataInizio: ev.target.value })}
                    />
                  </td>
                  <CellaN v={e.fatturatoMensile} set={(v) => mod(e.id, { fatturatoMensile: v })} />
                  <CellaN v={e.aliquota} step={0.001} w={64} set={(v) => mod(e.id, { aliquota: v })} />
                  <CellaN v={e.spesaMensile} set={(v) => mod(e.id, { spesaMensile: v })} />
                  <CellaN v={e.spesaGrossa} set={(v) => mod(e.id, { spesaGrossa: v })} />
                  <td className="num" style={{ color: risp >= 0 ? "var(--entrata)" : "var(--uscita)" }}>
                    <b>{euro(risp)}</b>
                  </td>
                  <td>
                    <button className="secondario" style={{ padding: "2px 8px" }} onClick={() => elimina(e.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="secondario" style={{ marginTop: 10 }} onClick={aggiungi}>
        + Aggiungi evento
      </button>
    </div>
  );
}

// ---------- Editor investimenti ----------

function EditorInvestimenti() {
  const { dati, aggiorna } = useApp();
  const inv = [...dati.investimenti].sort((a, b) =>
    a.dataInizio.localeCompare(b.dataInizio),
  );

  function mod(id: string, patch: Partial<Investimento>) {
    aggiorna((d) => ({
      ...d,
      investimenti: d.investimenti.map((i) =>
        i.id === id ? { ...i, ...patch } : i,
      ),
    }));
  }
  function aggiungi() {
    aggiorna((d) => ({
      ...d,
      investimenti: [
        ...d.investimenti,
        {
          id: uid(),
          descrizione: "Nuovo investimento",
          dataInizio: new Date().toISOString().slice(0, 10),
          dataFine: new Date(Date.now() + 5 * 365 * 86400000)
            .toISOString()
            .slice(0, 10),
          capitale: 5000,
          interesse: 0.03,
        },
      ],
    }));
  }
  function elimina(id: string) {
    aggiorna((d) => ({
      ...d,
      investimenti: d.investimenti.filter((i) => i.id !== id),
    }));
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="tabella-wrap">
        <table>
          <thead>
            <tr>
              <th>Descrizione</th>
              <th>Da</th>
              <th>A</th>
              <th className="num">Capitale</th>
              <th className="num">Tasso reale</th>
              <th className="num">Versam. ric.</th>
              <th className="num">Ogni (mesi)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inv.map((i) => (
              <tr key={i.id}>
                <td>
                  <input
                    style={{ width: 150 }}
                    value={i.descrizione ?? ""}
                    onChange={(e) => mod(i.id, { descrizione: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={i.dataInizio}
                    onChange={(e) => mod(i.id, { dataInizio: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={i.dataFine}
                    onChange={(e) => mod(i.id, { dataFine: e.target.value })}
                  />
                </td>
                <CellaN v={i.capitale} set={(v) => mod(i.id, { capitale: v ?? 0 })} />
                <CellaN v={i.interesse} step={0.001} w={64} set={(v) => mod(i.id, { interesse: v ?? 0 })} />
                <CellaN v={i.versamentoPeriodico} set={(v) => mod(i.id, { versamentoPeriodico: v })} />
                <CellaN v={i.frequenzaMesi} w={64} set={(v) => mod(i.id, { frequenzaMesi: v })} />
                <td>
                  <button className="secondario" style={{ padding: "2px 8px" }} onClick={() => elimina(i.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="secondario" style={{ marginTop: 10 }} onClick={aggiungi}>
        + Aggiungi investimento
      </button>
      <p className="muted" style={{ fontSize: 12 }}>
        Il <b>tasso reale</b> è già al netto dell'inflazione. Per un piano di
        accumulo, compila "Versamento ricorrente" e "Ogni (mesi)" — es. 8500
        ogni 12 mesi. La colonna <b>"A"</b> (scadenza) ferma solo i versamenti:
        il capitale resta comunque investito e continua a rendere fino alla
        pensione.
      </p>
    </div>
  );
}

// ---------- Cella numerica riutilizzabile ----------

function CellaN({
  v,
  set,
  step = 0.01,
  w = 90,
}: {
  v: number | undefined;
  set: (v: number | undefined) => void;
  step?: number;
  w?: number;
}) {
  return (
    <td className="num">
      <input
        type="number"
        step={step}
        style={{ width: w }}
        value={v === undefined ? "" : v}
        onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </td>
  );
}
