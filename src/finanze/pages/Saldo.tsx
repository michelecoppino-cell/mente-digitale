import { useMemo, useState, type ReactNode } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useApp } from "../store/AppStore";
import { calcolaSaldo, campiona, PuntoSaldo } from "../engine/saldo";
import { tasseConFatture } from "../engine/fatture";
import { equityImmobili } from "../engine/mutuo";
import { euro, toIso, mappaColoriConto, numRecharts } from "../util";
import { Info } from "../components/Info";

const COLORI = {
  grezzo: "#8a94a6",
  nettoTasse: "#4c78a8",
  totale: "#54a24b",
};

/** Palette della torta "composizione del patrimonio": validata per contrasto
 * e distinguibilità (protanopia/deuteranopia/tritanopia) sia su sfondo chiaro
 * che scuro, a differenza della palette categorica usata altrove nell'app. */
const COLORI_PATRIMONIO = {
  immobili: "#3987e5",
  etf: "#d95926",
  liquidita: "#199e70",
};

const NOME_LIQ = "Liquidità (netto tasse)";
const NOME_ETF = "PAC/ETF";
const NOME_IMM = "Immobili";
const NOME_SALDO_GREZZO = "Saldo grezzo";

export function Saldo() {
  const { dati } = useApp();
  const [da, setDa] = useState("");
  const [a, setA] = useState("");
  const [nascoste, setNascoste] = useState<Set<string>>(new Set());
  const [mostraGrezzo, setMostraGrezzo] = useState(false);
  const [mostraConti, setMostraConti] = useState(false);

  // Le tasse per anno vengono, dove disponibili, calcolate dalle fatture
  // (scheda Fatture): stessa fonte usata dalla scheda Tasse, niente doppioni.
  const tasse = useMemo(
    () => tasseConFatture(dati.tasse, dati.fatture),
    [dati.tasse, dati.fatture],
  );

  const ris = useMemo(
    () => calcolaSaldo(dati.transazioni, tasse, dati.parametri),
    [dati.transazioni, tasse, dati.parametri],
  );

  // Componenti del saldo, per le spiegazioni (i). Annullate escluse, come nei calcoli.
  const somme = useMemo(() => {
    let entrate = 0;
    let uscite = 0;
    let tassePagate = 0;
    for (const t of dati.transazioni) {
      if (t.annullata) continue;
      entrate += t.entrate ?? 0;
      uscite += t.uscite ?? 0;
      if (t.tasse && t.uscite) tassePagate += t.uscite;
    }
    return { entrate, uscite, tassePagate };
  }, [dati.transazioni]);

  // Equity immobiliare dai mutui configurati (anticipo + capitale rimborsato).
  const mutui = dati.mutui ?? [];
  const equityImmobile = useMemo(
    () => (mutui.length > 0 ? equityImmobili(mutui, toIso(new Date())) : 0),
    [mutui],
  );

  const primaData = ris.punti[0]?.data ?? "";
  const ultimaData = ris.ultimo?.data ?? "";

  // C'è almeno un trasferimento da mostrare?
  const haInvestito = (ris.ultimo?.investito ?? 0) > 0;

  const puntiRange = useMemo(() => {
    if (!da && !a) return ris.punti;
    return ris.punti.filter((p) => {
      if (da && p.data < da) return false;
      if (a && p.data > a) return false;
      return true;
    });
  }, [ris.punti, da, a]);

  const datiGraficoBase = useMemo(() => campiona(puntiRange, 7), [puntiRange]);

  // A ogni punto attacco l'equity immobiliare storica (non solo quella di oggi),
  // cosi' le bande impilate del grafico riflettono l'andamento nel tempo:
  // liquidita' (netto tasse) + PAC/ETF (investito) + immobili (equity).
  const datiGrafico = useMemo(
    () =>
      datiGraficoBase.map((p: PuntoSaldo) => {
        const equity = mutui.length > 0 ? round2(equityImmobili(mutui, p.data)) : 0;
        return {
          ...p,
          equity,
          comprensivo: round2(p.nettoTasse + p.investito + equity),
        };
      }),
    [datiGraficoBase, mutui],
  );

  const conti = ris.conti;
  const coloreConto = useMemo(() => mappaColoriConto(conti), [conti]);

  // Composizione del patrimonio ad oggi: liquidità (netto tasse), quota
  // investita in PAC/ETF (giroconti) ed equity dell'immobile, come fette di
  // una torta che sommano al 100% del patrimonio comprensivo.
  const composizione = useMemo(() => {
    const liquidita = Math.max(0, ris.ultimo?.nettoTasse ?? 0);
    const etf = Math.max(0, ris.ultimo?.investito ?? 0);
    const immobili = Math.max(0, equityImmobile);
    const totale = liquidita + etf + immobili;
    if (totale <= 0) return { totale, fette: [] as { nome: string; valore: number; colore: string }[] };
    const fette = [
      { nome: "Immobili", valore: immobili, colore: COLORI_PATRIMONIO.immobili },
      { nome: "ETF/PAC", valore: etf, colore: COLORI_PATRIMONIO.etf },
      { nome: "Liquidità", valore: liquidita, colore: COLORI_PATRIMONIO.liquidita },
    ].filter((f) => f.valore > 0);
    return { totale, fette };
  }, [ris.ultimo, equityImmobile]);

  function alternaLinea(nome: string) {
    setNascoste((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });
  }

  if (dati.transazioni.length === 0) {
    return (
      <div className="card vuoto">
        Nessun movimento. Importa i dati (CSV o backup JSON da{" "}
        <b>Impostazioni</b>) per vedere il saldo.
      </div>
    );
  }

  const u = ris.ultimo;
  const annoCorrente = new Date().getFullYear();

  function preset(nome: "tutto" | "ultimoAnno" | "ultimi3" | "annoCorrente") {
    if (nome === "tutto") {
      setDa("");
      setA("");
      return;
    }
    setA(ultimaData);
    const d = new Date(ultimaData + "T00:00:00");
    if (nome === "ultimoAnno") d.setFullYear(d.getFullYear() - 1);
    else if (nome === "ultimi3") d.setFullYear(d.getFullYear() - 3);
    else if (nome === "annoCorrente") {
      setDa(`${annoCorrente}-01-01`);
      return;
    }
    setDa(d.toISOString().slice(0, 10));
  }

  return (
    <>
      <div className="saldo-griglia">
        {/* -------- Colonna sinistra: andamento del saldo -------- */}
        <div className="card saldo-grafico-card">
          <div
            className="riga-azioni"
            style={{ justifyContent: "space-between", marginBottom: 10 }}
          >
            <h3 style={{ margin: 0 }}>Andamento del saldo</h3>
            <div className="riga-azioni" style={{ gap: 6 }}>
              <button className="secondario" onClick={() => preset("tutto")}>
                Tutto
              </button>
              <button className="secondario" onClick={() => preset("ultimoAnno")}>
                Ultimo anno
              </button>
              <button className="secondario" onClick={() => preset("ultimi3")}>
                Ultimi 3 anni
              </button>
              <button className="secondario" onClick={() => preset("annoCorrente")}>
                {annoCorrente}
              </button>
            </div>
          </div>
          <div className="riga-azioni" style={{ marginBottom: 10 }}>
            <label className="filtro-campo">
              <span>Da</span>
              <input
                type="date"
                value={da}
                min={primaData}
                max={ultimaData}
                onChange={(e) => setDa(e.target.value)}
              />
            </label>
            <label className="filtro-campo">
              <span>A</span>
              <input
                type="date"
                value={a}
                min={primaData}
                max={ultimaData}
                onChange={(e) => setA(e.target.value)}
              />
            </label>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>
            Bande impilate del patrimonio nel tempo: <b>{NOME_LIQ}</b> (soldi
            subito disponibili, tasse forfettario + Inarcassa accantonate
            giorno-per-giorno), sopra <b>{NOME_ETF}</b> (giroconti verso
            investimenti) e <b>{NOME_IMM}</b> (equity da anticipo + capitale
            rimborsato). La cima è il patrimonio complessivo.
            {conti.length > 0 && (
              <>
                {" "}
                Attiva <b>Saldi per conto</b> per l'andamento grezzo di ogni
                conto.
              </>
            )}{" "}
            Clicca la legenda per accendere/spegnere una banda.
          </p>
          <div className="riga-azioni" style={{ marginBottom: 10, gap: 16 }}>
            <label className="filtro-campo" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={mostraGrezzo}
                onChange={(e) => setMostraGrezzo(e.target.checked)}
              />
              <span>{NOME_SALDO_GREZZO}</span>
            </label>
            {conti.length > 0 && (
              <label className="filtro-campo" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={mostraConti}
                  onChange={(e) => setMostraConti(e.target.checked)}
                />
                <span>Saldi per conto</span>
              </label>
            )}
          </div>
          <div className="saldo-grafico">
            <ResponsiveContainer>
              <ComposedChart
                data={datiGrafico}
                margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bordo)" />
                <XAxis
                  dataKey="data"
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  tickFormatter={(v) => euro(v)}
                  width={64}
                />
                <Tooltip
                  formatter={(v: unknown) => euro(numRecharts(v), true)}
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--bordo)",
                    borderRadius: 8,
                    color: "var(--testo)",
                  }}
                />
                <Legend
                  onClick={(e) => alternaLinea(String(e.value))}
                  formatter={(value: string) => (
                    <span
                      style={{
                        opacity: nascoste.has(value) ? 0.4 : 1,
                        cursor: "pointer",
                      }}
                    >
                      {value}
                    </span>
                  )}
                />
                {/* Bande impilate: liquidita' (sotto) -> PAC/ETF -> immobili (sopra) */}
                <Area
                  type="monotone"
                  dataKey="nettoTasse"
                  name={NOME_LIQ}
                  stackId="p"
                  stroke={COLORI_PATRIMONIO.liquidita}
                  fill={COLORI_PATRIMONIO.liquidita}
                  fillOpacity={0.6}
                  hide={nascoste.has(NOME_LIQ)}
                  dot={false}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="investito"
                  name={NOME_ETF}
                  stackId="p"
                  stroke={COLORI_PATRIMONIO.etf}
                  fill={COLORI_PATRIMONIO.etf}
                  fillOpacity={0.6}
                  hide={nascoste.has(NOME_ETF)}
                  dot={false}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  name={NOME_IMM}
                  stackId="p"
                  stroke={COLORI_PATRIMONIO.immobili}
                  fill={COLORI_PATRIMONIO.immobili}
                  fillOpacity={0.6}
                  hide={nascoste.has(NOME_IMM)}
                  dot={false}
                  strokeWidth={1.5}
                />
                {mostraGrezzo && (
                  <Line
                    type="monotone"
                    dataKey="grezzo"
                    name={NOME_SALDO_GREZZO}
                    stroke={COLORI.grezzo}
                    strokeDasharray="4 3"
                    dot={false}
                    strokeWidth={1.5}
                  />
                )}
                {mostraConti &&
                  conti.map((c) => {
                    const nome = `Saldo ${c}`;
                    return (
                      <Line
                        key={c}
                        type="monotone"
                        dataKey={(p: PuntoSaldo & { equity: number }) => p.perConto[c]}
                        name={nome}
                        stroke={coloreConto[c]}
                        hide={nascoste.has(nome)}
                        dot={false}
                        strokeWidth={1.5}
                      />
                    );
                  })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* -------- Colonna destra: composizione + riepilogo -------- */}
        <div className="saldo-lato">
          {composizione.fette.length > 0 && (
            <div className="card">
              <div
                className="riga-azioni"
                style={{ justifyContent: "space-between", marginBottom: 4 }}
              >
                <h3 style={{ margin: 0 }}>Composizione del patrimonio (oggi)</h3>
              </div>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Totale{" "}
                <b style={{ color: "var(--testo)" }}>{euro(composizione.totale)}</b>:
                quanto è immobili (equity), quanto ETF/PAC e quanto liquidità
                netta tasse.
              </p>
              <div className="saldo-torta">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={composizione.fette}
                      dataKey="valore"
                      nameKey="nome"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={composizione.fette.length > 1 ? 2 : 0}
                      label={({ percent }: { percent?: number }) =>
                        `${Math.round((percent ?? 0) * 100)}%`
                      }
                      labelLine={false}
                    >
                      {composizione.fette.map((f) => (
                        <Cell
                          key={f.nome}
                          fill={f.colore}
                          stroke="var(--bg-card)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: unknown, n: unknown) => {
                        const val = numRecharts(v);
                        const quota = (val / composizione.totale) * 100;
                        return [
                          `${euro(val, true)} (${quota.toFixed(1)}%)`,
                          String(n),
                        ];
                      }}
                      contentStyle={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--bordo)",
                        borderRadius: 8,
                        color: "var(--testo)",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Riepilogo (oggi)</h3>
            <div className="saldo-riepilogo">
              <RigaRiep
                etichetta="Saldo grezzo"
                valore={euro(u?.grezzo)}
                info={
                  <>
                    Saldo iniziale + entrate − uscite dai movimenti (voci
                    annullate escluse).
                    <br />
                    {euro(dati.parametri.saldoInizialeValore, true)} (al{" "}
                    {dati.parametri.saldoInizialeData}) + {euro(somme.entrate, true)}{" "}
                    − {euro(somme.uscite, true)} = <b>{euro(u?.grezzo, true)}</b>
                  </>
                }
              />
              <RigaRiep
                etichetta="Netto tasse"
                valore={euro(u?.nettoTasse)}
                colore={COLORI.nettoTasse}
                info={
                  <>
                    Saldo grezzo meno il «manca da pagare» tasse a oggi, lo
                    stesso della scheda <b>Tasse</b>: per ogni anno la quota di
                    Inarcassa + Imposta maturata giorno-per-giorno meno i
                    pagamenti già ripartiti ({euro(somme.tassePagate, true)}{" "}
                    versati finora), con le voci segnate «Chiuso» escluse.
                  </>
                }
              />
              {haInvestito && (
                <RigaRiep
                  etichetta="Investito in PAC/ETF"
                  valore={euro(u?.investito)}
                  colore={COLORI_PATRIMONIO.etf}
                  info={
                    <>
                      Uscite marcate <b>Giro</b> verso PAC/ETF o altri conti:
                      escono dal conto ma restano nel patrimonio come capitale
                      investito. Distinto dall'equity immobiliare.
                    </>
                  }
                />
              )}
              {haInvestito && (
                <RigaRiep
                  etichetta="Patrimonio totale"
                  valore={euro(u?.totale)}
                  colore={COLORI.totale}
                  info={
                    <>
                      Netto tasse + investito.
                      <br />
                      {euro(u?.nettoTasse, true)} + {euro(u?.investito, true)} ={" "}
                      <b>{euro(u?.totale, true)}</b>
                    </>
                  }
                />
              )}
              {equityImmobile > 0 && (
                <RigaRiep
                  etichetta="Immobile (equity)"
                  valore={euro(equityImmobile)}
                  colore={COLORI_PATRIMONIO.immobili}
                  info={
                    <>
                      Anticipo + capitale rimborsato con le rate scadute, dal
                      piano di ammortamento dei mutui (<b>Impostazioni</b>).
                    </>
                  }
                />
              )}
              {equityImmobile > 0 && (
                <RigaRiep
                  etichetta="Patrimonio + immobili"
                  valore={euro(
                    u ? u.nettoTasse + (u.investito ?? 0) + equityImmobile : undefined,
                  )}
                  colore={COLORI.totale}
                  forte
                  info={
                    <>
                      Netto tasse + investito + equity immobiliare.
                      <br />
                      {euro(u?.nettoTasse, true)} + {euro(u?.investito ?? 0, true)} +{" "}
                      {euro(equityImmobile, true)} ={" "}
                      <b>
                        {euro(
                          u ? u.nettoTasse + (u.investito ?? 0) + equityImmobile : undefined,
                          true,
                        )}
                      </b>
                    </>
                  }
                />
              )}
              <RigaRiep etichetta="Ultimo dato" valore={u?.data ?? "—"} />
            </div>
          </div>
        </div>
      </div>

      {tasse.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Non hai ancora inserito i dati fiscali per anno: la curva "netto
            tasse" coincide col grezzo. Aggiungili nella pagina <b>Tasse</b> o
            registra le tue fatture in <b>Fatture</b>.
          </p>
        </div>
      )}
    </>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Riga compatta del riepilogo laterale: etichetta (con spiegazione) e valore. */
function RigaRiep({
  etichetta,
  valore,
  info,
  colore,
  forte,
}: {
  etichetta: string;
  valore: string;
  info?: ReactNode;
  colore?: string;
  forte?: boolean;
}) {
  return (
    <div className={"riep-riga" + (forte ? " forte" : "")}>
      <span className="riep-etichetta">
        {etichetta}
        {info && <Info>{info}</Info>}
      </span>
      <span className="riep-valore" style={colore ? { color: colore } : undefined}>
        {valore}
      </span>
    </div>
  );
}
