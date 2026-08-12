import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store/AppStore";
import { Transazione } from "../types";
import { euro, numero, parseNumeroIt, uid, mappaColoriConto } from "../util";
import {
  parseCsv,
  indovinaMappatura,
  righeATransazioni,
  scartaDuplicati,
  MappaturaCsv,
} from "../store/io";

type Tipo =
  | ""
  | "entrate"
  | "uscite"
  | "trasferimenti"
  | "interni"
  | "mutuo"
  | "annullate";

/** Marcatura speciale di un movimento (mutuamente esclusiva). */
type TipoSpeciale = "" | "giro" | "interno" | "mutuo";

function tipoSpecialeDi(t: Transazione): TipoSpeciale {
  return t.trasferimento
    ? "giro"
    : t.girocontoInterno
      ? "interno"
      : t.mutuo
        ? "mutuo"
        : "";
}

/** Patch per impostare la marcatura speciale (una esclude le altre). */
function patchTipoSpeciale(v: TipoSpeciale): Partial<Transazione> {
  return {
    trasferimento: v === "giro" || undefined,
    girocontoInterno: v === "interno" || undefined,
    mutuo: v === "mutuo" || undefined,
    // le marcature speciali non hanno categoria di spesa
    ...(v ? { categoria: undefined } : {}),
  };
}

/** Campo su cui ordinare la tabella, con direzione (come l'ordinamento colonna di Excel). */
type CampoOrdine = "data" | "causale" | "entrate" | "uscite" | "categoria" | "tipo" | "note";
type OrdineColonna = { campo: CampoOrdine; dir: "asc" | "desc" } | null;

/** Valore selezionabile in un filtro "a lista" (checkbox) sullo stile di Excel. */
type VoceLista = { valore: string; etichetta: string };

/** Costruisce il comparatore per l'ordinamento corrente; senza ordinamento esplicito
 * si mantiene il comportamento storico (più recenti in cima). */
function costruisciComparatore(
  ordine: OrdineColonna,
): (a: Transazione, b: Transazione) => number {
  if (!ordine) return (a, b) => b.data.localeCompare(a.data);
  const segno = ordine.dir === "asc" ? 1 : -1;
  return (a, b) => {
    let va: string | number;
    let vb: string | number;
    switch (ordine.campo) {
      case "entrate":
        va = a.entrate ?? 0;
        vb = b.entrate ?? 0;
        break;
      case "uscite":
        va = a.uscite ?? 0;
        vb = b.uscite ?? 0;
        break;
      case "causale":
        va = (a.causale ?? "").toLowerCase();
        vb = (b.causale ?? "").toLowerCase();
        break;
      case "categoria":
        va = (a.categoria ?? "").toLowerCase();
        vb = (b.categoria ?? "").toLowerCase();
        break;
      case "tipo":
        va = tipoSpecialeDi(a);
        vb = tipoSpecialeDi(b);
        break;
      case "note":
        va = (a.note ?? "").toLowerCase();
        vb = (b.note ?? "").toLowerCase();
        break;
      default:
        va = a.data;
        vb = b.data;
    }
    if (va < vb) return -segno;
    if (va > vb) return segno;
    return 0;
  };
}

/** Azioni applicabili in blocco ai movimenti selezionati. */
const AZIONI_BULK: { id: string; nome: string; patch: Partial<Transazione> }[] = [
  { id: "annulla", nome: "Annulla voci", patch: { annullata: true } },
  { id: "ripristina", nome: "Ripristina voci", patch: { annullata: undefined } },
  { id: "giro", nome: "Segna Giro (investimenti)", patch: patchTipoSpeciale("giro") },
  {
    id: "interno",
    nome: "Segna giroconto interno",
    patch: patchTipoSpeciale("interno"),
  },
  { id: "mutuo", nome: "Segna rata mutuo", patch: patchTipoSpeciale("mutuo") },
  {
    id: "tipo-no",
    nome: "Togli marcatura (Giro/Interno/Mutuo)",
    patch: {
      trasferimento: undefined,
      girocontoInterno: undefined,
      mutuo: undefined,
    },
  },
  { id: "fatt-si", nome: "Segna come fattura", patch: { fattura: true } },
  { id: "fatt-no", nome: "Togli fattura", patch: { fattura: undefined } },
  { id: "tasse-si", nome: "Segna come tasse", patch: { tasse: true } },
  { id: "tasse-no", nome: "Togli tasse", patch: { tasse: undefined } },
];

// Riconoscimento della banca dal tracciato del CSV: ogni banca esporta con le
// sue intestazioni di colonna, quindi la firma dell'header identifica il conto.
// La associazione tracciato -> conto viene ricordata in localStorage e
// riproposta automaticamente agli import successivi.
const LS_CONTI_CSV = "finanze.contoPerTracciato";

function firmaTracciato(header: string[]): string {
  return header.map((h) => h.trim().toLowerCase()).join("|");
}

function contoRicordato(header: string[]): string {
  try {
    const m = JSON.parse(localStorage.getItem(LS_CONTI_CSV) ?? "{}") as Record<
      string,
      string
    >;
    return m[firmaTracciato(header)] ?? "";
  } catch {
    return "";
  }
}

function ricordaConto(header: string[], conto: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(LS_CONTI_CSV) ?? "{}") as Record<
      string,
      string
    >;
    m[firmaTracciato(header)] = conto;
    localStorage.setItem(LS_CONTI_CSV, JSON.stringify(m));
  } catch {
    /* localStorage non disponibile: ignora */
  }
}

function giorniTra(a: string, b: string): number {
  return (
    Math.abs(
      new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime(),
    ) / 86400000
  );
}

/**
 * Cerca coppie di movimenti che sembrano giroconti interni: stesso importo,
 * direzioni opposte, conti DIVERSI (entrambi assegnati), entro 4 giorni.
 * Ogni movimento entra al massimo in una coppia.
 */
function trovaCoppieInterne(
  transazioni: Transazione[],
): [Transazione, Transazione][] {
  const libera = (t: Transazione) =>
    !t.annullata && !t.trasferimento && !t.girocontoInterno && !t.mutuo && !!t.conto;
  const uscite = transazioni.filter((t) => t.uscite && libera(t));
  const entrate = transazioni.filter((t) => t.entrate && libera(t));
  const usate = new Set<string>();
  const coppie: [Transazione, Transazione][] = [];
  for (const u of uscite) {
    const e = entrate.find(
      (e) =>
        !usate.has(e.id) &&
        e.conto !== u.conto &&
        e.entrate === u.uscite &&
        giorniTra(u.data, e.data) <= 4,
    );
    if (e) {
      usate.add(e.id);
      coppie.push([u, e]);
    }
  }
  return coppie;
}

export function Movimenti() {
  const { dati, aggiorna } = useApp();
  const [importCsv, setImportCsv] = useState<{
    righe: string[][];
    header: string[];
    mappa: MappaturaCsv;
    conHeader: boolean;
    conto: string;
  } | null>(null);

  // Filtri: uno per "colonna" (data, causale, importo) + tipo e categoria.
  const [filtroTesto, setFiltroTesto] = useState("");
  const [dataDa, setDataDa] = useState("");
  const [dataA, setDataA] = useState("");
  const [importoMin, setImportoMin] = useState("");
  const [importoMax, setImportoMax] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<Tipo>("");
  const [filtroCat, setFiltroCat] = useState("");
  const [filtroConto, setFiltroConto] = useState("");

  // Filtri e ordinamento per singola colonna, sullo stile del filtro automatico
  // di Excel (menu a tendina sull'intestazione di ogni colonna).
  const [ordine, setOrdine] = useState<OrdineColonna>(null);
  const [filtroColCausale, setFiltroColCausale] = useState("");
  const [filtroColNote, setFiltroColNote] = useState("");
  const [entrateMin, setEntrateMin] = useState("");
  const [entrateMax, setEntrateMax] = useState("");
  const [usciteMin, setUsciteMin] = useState("");
  const [usciteMax, setUsciteMax] = useState("");
  // null = nessun filtro (tutti i valori inclusi); altrimenti solo i valori nel set.
  const [selCategorie, setSelCategorie] = useState<Set<string> | null>(null);
  const [selTipi, setSelTipi] = useState<Set<string> | null>(null);
  const [selConti, setSelConti] = useState<Set<string> | null>(null);
  const [selTasse, setSelTasse] = useState<Set<string> | null>(null);

  const [mostraAI, setMostraAI] = useState(false);
  const [mostraNuovo, setMostraNuovo] = useState(false);
  const [mostraCoppie, setMostraCoppie] = useState(false);
  const [esitoImport, setEsitoImport] = useState("");
  // Selezione multipla per le modifiche in blocco.
  const [selezione, setSelezione] = useState<Set<string>>(new Set());
  // Indice dell'ultima riga selezionata con click semplice: àncora per lo
  // shift+click, che seleziona l'intero intervallo come in Excel.
  const [ancoraSel, setAncoraSel] = useState<number | null>(null);
  // Su schermi piccoli i filtri partono chiusi (occupano molto spazio); su
  // desktop restano sempre visibili.
  const [filtriAperti, setFiltriAperti] = useState<boolean>(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 761px)").matches,
  );

  const categorie = dati.categorie.map((c) => c.nome);
  const numAnnullate = dati.transazioni.filter((t) => t.annullata).length;
  const numAttive = dati.transazioni.length - numAnnullate;

  // Conti/banche presenti nei dati (per badge, filtro e assegnazione).
  const conti = useMemo(() => {
    const s = new Set<string>();
    for (const t of dati.transazioni) if (t.conto) s.add(t.conto);
    return [...s].sort();
  }, [dati.transazioni]);
  const coloreConto = useMemo(() => mappaColoriConto(conti), [conti]);

  // Valori proponibili nei filtri "a lista" delle intestazioni colonna (come
  // il filtro automatico di Excel: elenco dei valori con checkbox).
  const valoriCategoriaLista: VoceLista[] = useMemo(
    () => [
      { valore: "__vuota__", etichetta: "(nessuna)" },
      ...categorie.map((c) => ({ valore: c, etichetta: c })),
    ],
    [categorie],
  );
  const valoriTipoLista: VoceLista[] = [
    { valore: "", etichetta: "—" },
    { valore: "giro", etichetta: "Giro" },
    { valore: "interno", etichetta: "Interno" },
    { valore: "mutuo", etichetta: "Mutuo" },
  ];
  const valoriTasseLista: VoceLista[] = [
    { valore: "si", etichetta: "Sì" },
    { valore: "no", etichetta: "No" },
  ];
  const valoriContoLista: VoceLista[] = useMemo(
    () => [
      { valore: "__vuoto__", etichetta: "(nessuno)" },
      ...conti.map((c) => ({ valore: c, etichetta: c })),
    ],
    [conti],
  );

  const filtrate = useMemo(() => {
    const txt = filtroTesto.toLowerCase().trim();
    // parseNumeroIt accetta anche importi scritti all'italiana ("1.234,56").
    const min = parseNumeroIt(importoMin);
    const max = parseNumeroIt(importoMax);
    const eMin = parseNumeroIt(entrateMin);
    const eMax = parseNumeroIt(entrateMax);
    const uMin = parseNumeroIt(usciteMin);
    const uMax = parseNumeroIt(usciteMax);
    const txtCausale = filtroColCausale.toLowerCase().trim();
    const txtNote = filtroColNote.toLowerCase().trim();
    return dati.transazioni
      .filter((t) => {
        if (dataDa && t.data < dataDa) return false;
        if (dataA && t.data > dataA) return false;
        if (filtroConto && t.conto !== filtroConto) return false;
        if (selConti && !selConti.has(t.conto || "__vuoto__")) return false;
        if (selCategorie && !selCategorie.has(t.categoria || "__vuota__"))
          return false;
        if (selTipi && !selTipi.has(tipoSpecialeDi(t))) return false;
        if (selTasse && !selTasse.has(t.tasse ? "si" : "no")) return false;
        if (eMin !== undefined && (t.entrate ?? 0) < eMin) return false;
        if (eMax !== undefined && (t.entrate ?? 0) > eMax) return false;
        if (uMin !== undefined && (t.uscite ?? 0) < uMin) return false;
        if (uMax !== undefined && (t.uscite ?? 0) > uMax) return false;
        if (txtCausale && !(t.causale ?? "").toLowerCase().includes(txtCausale))
          return false;
        if (txtNote && !(t.note ?? "").toLowerCase().includes(txtNote))
          return false;
        // Le annullate restano visibili in elenco (barrate) ma non compaiono
        // quando si filtra per un tipo specifico; "Annullate" le mostra da sole.
        if (filtroTipo === "annullate") return !!t.annullata;
        if (t.annullata && filtroTipo) return false;
        if (filtroTipo === "entrate" && !(t.entrate && !t.girocontoInterno))
          return false;
        if (
          filtroTipo === "uscite" &&
          !(t.uscite && !t.trasferimento && !t.girocontoInterno && !t.mutuo)
        )
          return false;
        if (filtroTipo === "trasferimenti" && !t.trasferimento) return false;
        if (filtroTipo === "interni" && !t.girocontoInterno) return false;
        if (filtroTipo === "mutuo" && !t.mutuo) return false;
        if (filtroCat) {
          if (filtroCat === "__vuote__" && (t.categoria || t.trasferimento))
            return false;
          if (
            filtroCat !== "__vuote__" &&
            filtroCat !== "__trasf__" &&
            t.categoria !== filtroCat
          )
            return false;
          if (filtroCat === "__trasf__" && !t.trasferimento) return false;
        }
        if (min !== undefined || max !== undefined) {
          const imp = t.entrate ?? t.uscite ?? 0;
          if (min !== undefined && imp < min) return false;
          if (max !== undefined && imp > max) return false;
        }
        if (txt) {
          const cerca = `${t.causale ?? ""} ${t.tipologia ?? ""} ${
            t.categoria ?? ""
          }`.toLowerCase();
          if (!cerca.includes(txt)) return false;
        }
        return true;
      })
      .sort(costruisciComparatore(ordine));
  }, [
    dati.transazioni,
    filtroTesto,
    dataDa,
    dataA,
    importoMin,
    importoMax,
    filtroTipo,
    filtroCat,
    filtroConto,
    entrateMin,
    entrateMax,
    usciteMin,
    usciteMax,
    filtroColCausale,
    filtroColNote,
    selCategorie,
    selTipi,
    selConti,
    selTasse,
    ordine,
  ]);

  // Totali del risultato filtrato: utili per rispondere a "quanto ho speso in X?".
  // Le voci annullate non contano (come ovunque nei calcoli).
  const totaliFiltrati = useMemo(() => {
    let entrate = 0;
    let uscite = 0;
    for (const t of filtrate) {
      // Coerente con l'analisi: annullate e giroconti interni non contano;
      // Giro e rate mutuo non sono spese.
      if (t.annullata || t.girocontoInterno) continue;
      if (t.entrate) entrate += t.entrate;
      if (t.uscite && !t.trasferimento && !t.mutuo) uscite += t.uscite;
    }
    return { entrate, uscite };
  }, [filtrate]);

  const nonCategorizzate = dati.transazioni.filter(
    (t) =>
      t.uscite &&
      !t.categoria &&
      !t.trasferimento &&
      !t.girocontoInterno &&
      !t.mutuo &&
      !t.annullata,
  ).length;

  const numFiltriAttivi =
    [
      filtroTesto,
      dataDa,
      dataA,
      importoMin,
      importoMax,
      filtroTipo,
      filtroCat,
      filtroConto,
      filtroColCausale,
      filtroColNote,
      entrateMin,
      entrateMax,
      usciteMin,
      usciteMax,
    ].filter(Boolean).length +
    [selCategorie, selTipi, selConti, selTasse].filter((s) => s !== null).length;
  const filtriAttivi = numFiltriAttivi > 0;

  function azzeraFiltri() {
    setFiltroTesto("");
    setDataDa("");
    setDataA("");
    setImportoMin("");
    setImportoMax("");
    setFiltroTipo("");
    setFiltroCat("");
    setFiltroConto("");
    setFiltroColCausale("");
    setFiltroColNote("");
    setEntrateMin("");
    setEntrateMax("");
    setUsciteMin("");
    setUsciteMax("");
    setSelCategorie(null);
    setSelTipi(null);
    setSelConti(null);
    setSelTasse(null);
  }

  // ---------- Import CSV ----------

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const righe = parseCsv(String(reader.result));
      if (righe.length === 0) return;
      const header = righe[0];
      setImportCsv({
        righe,
        header,
        mappa: indovinaMappatura(header),
        conHeader: true,
        // Banca riconosciuta dal tracciato (se gia' importato in passato).
        conto: contoRicordato(header),
      });
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  const anteprima = useMemo(() => {
    if (!importCsv) return [];
    const corpo = importCsv.conHeader
      ? importCsv.righe.slice(1)
      : importCsv.righe;
    return righeATransazioni(corpo, importCsv.mappa);
  }, [importCsv]);

  function confermaImport() {
    if (!importCsv) return;
    const conto = importCsv.conto.trim();
    if (!conto) return; // la banca è obbligatoria
    const { unici, duplicati } = scartaDuplicati(anteprima, dati.transazioni);
    const daAggiungere = unici.map((t) => ({ ...t, conto }));
    aggiorna((d) => ({
      ...d,
      transazioni: [...d.transazioni, ...daAggiungere],
    }));
    // Ricorda banca <-> tracciato per riconoscerla al prossimo import.
    ricordaConto(importCsv.header, conto);
    setEsitoImport(
      `Importati ${numero(unici.length)} movimenti su ${conto}` +
        (duplicati > 0 ? ` · ${numero(duplicati)} duplicati saltati` : ""),
    );
    setImportCsv(null);
  }

  // ---------- Modifica riga ----------

  function modifica(id: string, patch: Partial<Transazione>) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));
  }

  // "Cancellazione" soft: la voce resta in elenco (grigia e barrata) ma sparisce
  // da tutti i calcoli. Ripremendo si ripristina.
  function toggleAnnullata(id: string) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        t.id === id ? { ...t, annullata: t.annullata ? undefined : true } : t,
      ),
    }));
  }

  // ---------- Selezione multipla / modifiche in blocco ----------

  /**
   * Click semplice: alterna la riga e la ricorda come àncora. Shift+click (come
   * in Excel/fogli di calcolo): seleziona l'intero intervallo tra l'àncora e la
   * riga corrente (indici riferiti a `filtrate`, l'ordine mostrato in tabella).
   */
  function toggleSel(id: string, idx: number, shiftKey: boolean) {
    if (shiftKey && ancoraSel !== null) {
      const [lo, hi] = ancoraSel < idx ? [ancoraSel, idx] : [idx, ancoraSel];
      const idsRange = filtrate.slice(lo, hi + 1).map((t) => t.id);
      setSelezione((prev) => {
        const next = new Set(prev);
        idsRange.forEach((rid) => next.add(rid));
        return next;
      });
      return;
    }
    setAncoraSel(idx);
    setSelezione((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function ordina(campo: CampoOrdine, dir: "asc" | "desc") {
    setOrdine({ campo, dir });
  }

  /** Seleziona/deseleziona tutte le righe filtrate (non solo quelle visibili). */
  function toggleSelTutte() {
    setSelezione((prev) =>
      prev.size === filtrate.length
        ? new Set()
        : new Set(filtrate.map((t) => t.id)),
    );
  }

  function applicaBulk(patch: Partial<Transazione>) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        selezione.has(t.id) ? { ...t, ...patch } : t,
      ),
    }));
  }

  function applicaBulkCategoria(cat: string) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        // I trasferimenti non hanno categoria di spesa: vengono saltati.
        selezione.has(t.id) && !t.trasferimento
          ? { ...t, categoria: cat || undefined }
          : t,
      ),
    }));
  }

  function applicaBulkConto(conto: string) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        selezione.has(t.id) ? { ...t, conto: conto.trim() || undefined } : t,
      ),
    }));
  }

  /** Marca entrambe le gambe delle coppie scelte come giroconto interno. */
  function marcaCoppie(ids: Set<string>) {
    aggiorna((d) => ({
      ...d,
      transazioni: d.transazioni.map((t) =>
        ids.has(t.id) ? { ...t, ...patchTipoSpeciale("interno") } : t,
      ),
    }));
    setMostraCoppie(false);
    setEsitoImport(`Marcati ${numero(ids.size)} movimenti come giroconti interni.`);
  }

  // ---------- Aggiunta manuale ----------

  function aggiungiMovimento(t: Transazione) {
    aggiorna((d) => ({ ...d, transazioni: [...d.transazioni, t] }));
    setMostraNuovo(false);
    setEsitoImport("Movimento aggiunto.");
  }

  return (
    <>
      <div className="riga-azioni" style={{ marginBottom: 16 }}>
        <label className="secondario" style={{ display: "inline-block" }}>
          Importa CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            style={{ display: "none" }}
          />
        </label>
        <button className="secondario" onClick={() => setMostraNuovo((v) => !v)}>
          + Aggiungi movimento
        </button>
        <button
          className="secondario"
          onClick={() => setMostraAI((v) => !v)}
          disabled={nonCategorizzate === 0}
        >
          Categorizza con Claude{" "}
          {nonCategorizzate > 0 && (
            <span className="chip">{nonCategorizzate}</span>
          )}
        </button>
        {conti.length >= 2 && (
          <button
            className="secondario"
            onClick={() => setMostraCoppie((v) => !v)}
            title="Cerca coppie di movimenti uguali e opposti tra conti diversi"
          >
            Trova giroconti interni
          </button>
        )}
        <span className="muted">
          {numero(numAttive)} movimenti · {numero(nonCategorizzate)} da
          categorizzare
          {numAnnullate > 0 && <> · {numero(numAnnullate)} annullati</>}
        </span>
        {esitoImport && <span className="chip">{esitoImport}</span>}
      </div>

      {mostraNuovo && (
        <FormNuovoMovimento
          categorie={categorie}
          conti={conti}
          onAggiungi={aggiungiMovimento}
          onAnnulla={() => setMostraNuovo(false)}
        />
      )}

      {importCsv && (
        <MappaturaImport
          stato={importCsv}
          anteprima={anteprima}
          conti={conti}
          onCambia={(m) => setImportCsv({ ...importCsv, ...m })}
          onConferma={confermaImport}
          onAnnulla={() => setImportCsv(null)}
        />
      )}

      {mostraAI && <PannelloAI onChiudi={() => setMostraAI(false)} />}

      {mostraCoppie && (
        <PannelloCoppie
          transazioni={dati.transazioni}
          onMarca={marcaCoppie}
          onChiudi={() => setMostraCoppie(false)}
        />
      )}

      <button
        className="secondario filtri-toggle"
        onClick={() => setFiltriAperti((v) => !v)}
        aria-expanded={filtriAperti}
      >
        {filtriAperti ? "▾" : "▸"} Filtri
        {filtriAttivi && <span className="chip">{numFiltriAttivi}</span>}
      </button>

      {filtriAperti && (
        <div className="filtri">
          <input
            placeholder="Cerca in causale, tipologia, categoria…"
            value={filtroTesto}
            onChange={(e) => setFiltroTesto(e.target.value)}
            style={{ minWidth: 190, flex: "2 1 190px" }}
          />
          <label className="filtro-campo">
            <span>Da</span>
            <input
              type="date"
              value={dataDa}
              onChange={(e) => setDataDa(e.target.value)}
            />
          </label>
          <label className="filtro-campo">
            <span>A</span>
            <input
              type="date"
              value={dataA}
              onChange={(e) => setDataA(e.target.value)}
            />
          </label>
          <input
            inputMode="decimal"
            placeholder="€ min"
            value={importoMin}
            onChange={(e) => setImportoMin(e.target.value)}
            style={{ width: 92 }}
          />
          <input
            inputMode="decimal"
            placeholder="€ max"
            value={importoMax}
            onChange={(e) => setImportoMax(e.target.value)}
            style={{ width: 92 }}
          />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as Tipo)}
          >
            <option value="">Tutti i tipi</option>
            <option value="entrate">Entrate</option>
            <option value="uscite">Uscite</option>
            <option value="trasferimenti">Giro (investimenti)</option>
            <option value="interni">Giroconti interni</option>
            <option value="mutuo">Rate mutuo</option>
            <option value="annullate">Annullate</option>
          </select>
          {conti.length > 0 && (
            <select
              value={filtroConto}
              onChange={(e) => setFiltroConto(e.target.value)}
            >
              <option value="">Tutti i conti</option>
              {conti.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select
            value={filtroCat}
            onChange={(e) => setFiltroCat(e.target.value)}
          >
            <option value="">Tutte le categorie</option>
            <option value="__vuote__">Da categorizzare</option>
            <option value="__trasf__">Trasferimenti (giroconti)</option>
            {categorie.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {filtriAttivi && (
            <button className="secondario" onClick={azzeraFiltri}>
              Azzera filtri
            </button>
          )}
        </div>
      )}

      {selezione.size > 0 && (
        <BarraSelezione
          n={selezione.size}
          categorie={categorie}
          conti={conti}
          onCategoria={applicaBulkCategoria}
          onConto={applicaBulkConto}
          onAzione={applicaBulk}
          onDeseleziona={() => setSelezione(new Set())}
        />
      )}

      {dati.transazioni.length === 0 ? (
        <div className="card vuoto">
          Nessun movimento. Importa un CSV del tuo conto per iniziare, oppure
          carica un backup JSON da <b>Impostazioni</b>.
        </div>
      ) : (
        <TabellaMovimenti
          righe={filtrate}
          totaleAttivi={numAttive}
          totaliFiltrati={filtriAttivi ? totaliFiltrati : undefined}
          categorie={categorie}
          coloreConto={coloreConto}
          mostraConto={conti.length > 0}
          selezione={selezione}
          onToggleSel={toggleSel}
          onToggleSelTutte={toggleSelTutte}
          onModifica={modifica}
          onToggleAnnullata={toggleAnnullata}
          fc={{
            ordine,
            onOrdina: ordina,
            onCancellaOrdine: () => setOrdine(null),
            dataDa,
            setDataDa,
            dataA,
            setDataA,
            entrateMin,
            setEntrateMin,
            entrateMax,
            setEntrateMax,
            usciteMin,
            setUsciteMin,
            usciteMax,
            setUsciteMax,
            filtroColCausale,
            setFiltroColCausale,
            filtroColNote,
            setFiltroColNote,
            selCategorie,
            setSelCategorie,
            selTipi,
            setSelTipi,
            selConti,
            setSelConti,
            selTasse,
            setSelTasse,
            valoriCategoriaLista,
            valoriTipoLista,
            valoriContoLista,
            valoriTasseLista,
          }}
        />
      )}
    </>
  );
}

// ---------- Barra azioni per la selezione multipla ----------

function BarraSelezione({
  n,
  categorie,
  conti,
  onCategoria,
  onConto,
  onAzione,
  onDeseleziona,
}: {
  n: number;
  categorie: string[];
  conti: string[];
  onCategoria: (cat: string) => void;
  onConto: (conto: string) => void;
  onAzione: (patch: Partial<Transazione>) => void;
  onDeseleziona: () => void;
}) {
  const [cat, setCat] = useState("");
  const [azione, setAzione] = useState("");
  const [conto, setConto] = useState("");

  return (
    <div className="card barra-selezione">
      <b>{numero(n)} selezionati</b>
      <span className="barra-gruppo">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Categoria…</option>
          <option value="__togli__">— nessuna —</option>
          {categorie.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          className="secondario"
          disabled={!cat}
          onClick={() => onCategoria(cat === "__togli__" ? "" : cat)}
        >
          Applica
        </button>
      </span>
      <span className="barra-gruppo">
        <select value={azione} onChange={(e) => setAzione(e.target.value)}>
          <option value="">Azione…</option>
          {AZIONI_BULK.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nome}
            </option>
          ))}
        </select>
        <button
          className="secondario"
          disabled={!azione}
          onClick={() => {
            const a = AZIONI_BULK.find((x) => x.id === azione);
            if (a) onAzione(a.patch);
          }}
        >
          Applica
        </button>
      </span>
      <span className="barra-gruppo">
        <input
          list="lista-conti-bulk"
          placeholder="Conto…"
          style={{ width: 110 }}
          value={conto}
          onChange={(e) => setConto(e.target.value)}
        />
        <datalist id="lista-conti-bulk">
          {conti.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          className="secondario"
          disabled={!conto.trim()}
          onClick={() => onConto(conto)}
        >
          Assegna
        </button>
      </span>
      <button className="secondario" onClick={onDeseleziona}>
        Deseleziona
      </button>
    </div>
  );
}

// ---------- Pannello coppie di giroconti interni ----------

function PannelloCoppie({
  transazioni,
  onMarca,
  onChiudi,
}: {
  transazioni: Transazione[];
  onMarca: (ids: Set<string>) => void;
  onChiudi: () => void;
}) {
  const coppie = useMemo(() => trovaCoppieInterne(transazioni), [transazioni]);
  // Di default tutte le coppie proposte sono spuntate.
  const [escluse, setEscluse] = useState<Set<string>>(new Set());

  const scelte = coppie.filter(([u]) => !escluse.has(u.id));

  function toggle(idUscita: string) {
    setEscluse((prev) => {
      const next = new Set(prev);
      if (next.has(idUscita)) next.delete(idUscita);
      else next.add(idUscita);
      return next;
    });
  }

  return (
    <div className="card">
      <div className="riga-azioni" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Possibili giroconti interni</h3>
        <button className="secondario" onClick={onChiudi}>
          Chiudi
        </button>
      </div>
      {coppie.length === 0 ? (
        <p className="muted">
          Nessuna coppia trovata: servono un'uscita e un'entrata di pari
          importo, su conti diversi, a distanza di massimo 4 giorni (con il
          conto assegnato a entrambe).
        </p>
      ) : (
        <>
          <p className="muted">
            Stesso importo, direzioni opposte, conti diversi, entro 4 giorni.
            Le coppie marcate spariscono da spese ed entrate (il saldo resta
            corretto: si annullano da sole).
          </p>
          <div className="tabella-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Uscita</th>
                  <th>Entrata</th>
                  <th className="num">Importo</th>
                </tr>
              </thead>
              <tbody>
                {coppie.map(([u, e]) => (
                  <tr key={u.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!escluse.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                    </td>
                    <td title={u.causale}>
                      {u.data} · <b>{u.conto}</b> ·{" "}
                      {(u.causale ?? "").slice(0, 30)}
                    </td>
                    <td title={e.causale}>
                      {e.data} · <b>{e.conto}</b> ·{" "}
                      {(e.causale ?? "").slice(0, 30)}
                    </td>
                    <td className="num">{euro(u.uscite, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="riga-azioni" style={{ marginTop: 12 }}>
            <button
              className="primario"
              disabled={scelte.length === 0}
              onClick={() =>
                onMarca(new Set(scelte.flatMap(([u, e]) => [u.id, e.id])))
              }
            >
              Marca {numero(scelte.length)} coppie come giroconti interni
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Aggiunta manuale di un movimento ----------

function FormNuovoMovimento({
  categorie,
  conti,
  onAggiungi,
  onAnnulla,
}: {
  categorie: string[];
  conti: string[];
  onAggiungi: (t: Transazione) => void;
  onAnnulla: () => void;
}) {
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [causale, setCausale] = useState("");
  const [verso, setVerso] = useState<"uscita" | "entrata">("uscita");
  const [importo, setImporto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [conto, setConto] = useState("");
  const [note, setNote] = useState("");

  const imp = parseNumeroIt(importo);
  const valido = !!data && imp !== undefined && imp > 0;

  function conferma() {
    if (!valido) return;
    const v = Math.abs(imp!);
    onAggiungi({
      id: uid(),
      data,
      causale: causale.trim() || undefined,
      tipologia: "Manuale",
      entrate: verso === "entrata" ? v : undefined,
      uscite: verso === "uscita" ? v : undefined,
      categoria: categoria || undefined,
      conto: conto.trim() || undefined,
      note: note.trim() || undefined,
    });
  }

  return (
    <div className="card">
      <h3>Nuovo movimento manuale</h3>
      <p className="muted" style={{ marginTop: -4 }}>
        Per correzioni o spese non tracciate (es. contanti). Viene marcato con
        tipologia &quot;Manuale&quot;.
      </p>
      <div className="form-griglia">
        <label className="campo">
          Data
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className="campo">
          Causale
          <input
            placeholder="es. Spesa in contanti al mercato"
            value={causale}
            onChange={(e) => setCausale(e.target.value)}
          />
        </label>
        <label className="campo">
          Tipo
          <select
            value={verso}
            onChange={(e) => setVerso(e.target.value as "uscita" | "entrata")}
          >
            <option value="uscita">Uscita</option>
            <option value="entrata">Entrata</option>
          </select>
        </label>
        <label className="campo">
          Importo (€)
          <input
            inputMode="decimal"
            placeholder="es. 25,50"
            value={importo}
            onChange={(e) => setImporto(e.target.value)}
          />
        </label>
        <label className="campo">
          Categoria
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">—</option>
            {categorie.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Conto
          <input
            list="lista-conti-nuovo"
            placeholder="es. Fineco"
            value={conto}
            onChange={(e) => setConto(e.target.value)}
          />
          <datalist id="lista-conti-nuovo">
            {conti.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="campo">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="riga-azioni" style={{ marginTop: 14 }}>
        <button className="primario" onClick={conferma} disabled={!valido}>
          Aggiungi
        </button>
        <button className="secondario" onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </div>
  );
}

// ---------- Tabella ----------

/** Props del filtro/ordinamento per-colonna passate in blocco a `TabellaMovimenti`. */
type FiltriColonna = {
  ordine: OrdineColonna;
  onOrdina: (campo: CampoOrdine, dir: "asc" | "desc") => void;
  onCancellaOrdine: () => void;
  dataDa: string;
  setDataDa: (v: string) => void;
  dataA: string;
  setDataA: (v: string) => void;
  entrateMin: string;
  setEntrateMin: (v: string) => void;
  entrateMax: string;
  setEntrateMax: (v: string) => void;
  usciteMin: string;
  setUsciteMin: (v: string) => void;
  usciteMax: string;
  setUsciteMax: (v: string) => void;
  filtroColCausale: string;
  setFiltroColCausale: (v: string) => void;
  filtroColNote: string;
  setFiltroColNote: (v: string) => void;
  selCategorie: Set<string> | null;
  setSelCategorie: (s: Set<string> | null) => void;
  selTipi: Set<string> | null;
  setSelTipi: (s: Set<string> | null) => void;
  selConti: Set<string> | null;
  setSelConti: (s: Set<string> | null) => void;
  selTasse: Set<string> | null;
  setSelTasse: (s: Set<string> | null) => void;
  valoriCategoriaLista: VoceLista[];
  valoriTipoLista: VoceLista[];
  valoriContoLista: VoceLista[];
  valoriTasseLista: VoceLista[];
};

function TabellaMovimenti({
  righe,
  totaleAttivi,
  totaliFiltrati,
  categorie,
  coloreConto,
  mostraConto,
  selezione,
  onToggleSel,
  onToggleSelTutte,
  onModifica,
  onToggleAnnullata,
  fc,
}: {
  righe: Transazione[];
  totaleAttivi: number;
  totaliFiltrati?: { entrate: number; uscite: number };
  categorie: string[];
  coloreConto: Record<string, string>;
  mostraConto: boolean;
  selezione: Set<string>;
  onToggleSel: (id: string, idx: number, shiftKey: boolean) => void;
  onToggleSelTutte: () => void;
  onModifica: (id: string, patch: Partial<Transazione>) => void;
  onToggleAnnullata: (id: string) => void;
  fc: FiltriColonna;
}) {
  const LIMITE = 400;
  const visibili = righe.slice(0, LIMITE);
  const tutteSelezionate =
    righe.length > 0 && selezione.size === righe.length;
  // Il conteggio confronta solo le voci attive: le annullate sono in elenco
  // ma non "esistono".
  const attiveVisibili = righe.filter((t) => !t.annullata).length;
  // Ricorda se l'ultimo click su un checkbox riga aveva Shift premuto: il
  // click arriva prima del change, quindi lo leggiamo lì (come in Excel).
  const shiftPremuto = useRef(false);

  // ---------- Modifica manuale di un importo ----------
  // Volutamente scomoda: serve un doppio click per entrare in modifica (non
  // basta un click come per le altre celle) e, per confermare, l'utente deve
  // rispondere a un popup di conferma con il vecchio e il nuovo valore. Gli
  // importi arrivano dagli estratti conto importati: modificarli deve essere
  // un'eccezione deliberata, non un gesto accidentale.
  const [cellaInModifica, setCellaInModifica] = useState<{
    id: string;
    campo: "entrate" | "uscite";
  } | null>(null);
  const [valoreInModifica, setValoreInModifica] = useState("");

  function iniziaModificaImporto(t: Transazione, campo: "entrate" | "uscite") {
    if (t.annullata) return;
    setCellaInModifica({ id: t.id, campo });
    setValoreInModifica(t[campo] ? String(t[campo]).replace(".", ",") : "");
  }

  function annullaModificaImporto() {
    setCellaInModifica(null);
    setValoreInModifica("");
  }

  function confermaModificaImporto(t: Transazione) {
    if (!cellaInModifica || cellaInModifica.id !== t.id) return;
    const campo = cellaInModifica.campo;
    const attuale = t[campo];
    const nuovo = parseNumeroIt(valoreInModifica);
    if (nuovo === undefined || nuovo < 0 || nuovo === (attuale ?? 0)) {
      annullaModificaImporto();
      return;
    }
    const ok = confirm(
      `Confermi la modifica manuale di questo movimento?\n\n` +
        `${campo === "entrate" ? "Entrata" : "Uscita"}: ${euro(attuale, true)} → ${euro(nuovo, true)}\n\n` +
        `L'importo non corrisponderà più a quello dell'estratto conto importato.`,
    );
    if (ok) {
      onModifica(t.id, { [campo]: nuovo || undefined });
    }
    annullaModificaImporto();
  }

  return (
    <>
      <p className="muted" style={{ margin: "0 0 8px" }}>
        {attiveVisibili === totaleAttivi
          ? `${numero(totaleAttivi)} movimenti`
          : `${numero(attiveVisibili)} di ${numero(totaleAttivi)} movimenti (filtrati)`}
        {totaliFiltrati && (
          <>
            {" · "}
            <span className="entrata">
              +{euro(totaliFiltrati.entrate, true)}
            </span>{" "}
            <span className="uscita">−{euro(totaliFiltrati.uscite, true)}</span>
          </>
        )}
      </p>
      <div className="tabella-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={tutteSelezionate}
                  onChange={onToggleSelTutte}
                  title="Seleziona/deseleziona tutte le righe filtrate. Shift+click su una riga seleziona l'intervallo, come in Excel."
                />
              </th>
              <ThFiltro
                titolo="Data"
                campo="data"
                fc={fc}
                attivo={!!fc.dataDa || !!fc.dataA}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("data", "asc")}>
                        ↑ Meno recenti prima
                      </button>
                      <button onClick={() => fc.onOrdina("data", "desc")}>
                        ↓ Più recenti prima
                      </button>
                    </div>
                    <label className="filtro-campo-pop">
                      <span>Da</span>
                      <input
                        type="date"
                        value={fc.dataDa}
                        onChange={(e) => fc.setDataDa(e.target.value)}
                      />
                    </label>
                    <label className="filtro-campo-pop">
                      <span>A</span>
                      <input
                        type="date"
                        value={fc.dataA}
                        onChange={(e) => fc.setDataA(e.target.value)}
                      />
                    </label>
                    <div className="filtro-pop-azioni">
                      <button
                        className="secondario"
                        onClick={() => {
                          fc.setDataDa("");
                          fc.setDataA("");
                        }}
                      >
                        Cancella filtro
                      </button>
                      <button className="primario" onClick={chiudi}>
                        Chiudi
                      </button>
                    </div>
                  </>
                )}
              </ThFiltro>
              {mostraConto && (
                <ThFiltro
                  titolo="Conto"
                  fc={fc}
                  attivo={fc.selConti !== null}
                >
                  {(chiudi) => (
                    <FiltroListaCorpo
                      valori={fc.valoriContoLista}
                      selezionati={fc.selConti}
                      onCambia={fc.setSelConti}
                      onChiudi={chiudi}
                    />
                  )}
                </ThFiltro>
              )}
              <ThFiltro
                titolo="Causale"
                campo="causale"
                fc={fc}
                attivo={!!fc.filtroColCausale}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("causale", "asc")}>
                        A → Z
                      </button>
                      <button onClick={() => fc.onOrdina("causale", "desc")}>
                        Z → A
                      </button>
                    </div>
                    <input
                      placeholder="Contiene…"
                      value={fc.filtroColCausale}
                      autoFocus
                      onChange={(e) => fc.setFiltroColCausale(e.target.value)}
                    />
                    <div className="filtro-pop-azioni">
                      <button
                        className="secondario"
                        onClick={() => fc.setFiltroColCausale("")}
                      >
                        Cancella filtro
                      </button>
                      <button className="primario" onClick={chiudi}>
                        Chiudi
                      </button>
                    </div>
                  </>
                )}
              </ThFiltro>
              <ThFiltro
                titolo="Entrate"
                campo="entrate"
                classeNum
                fc={fc}
                attivo={!!fc.entrateMin || !!fc.entrateMax}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("entrate", "desc")}>
                        Dal più alto
                      </button>
                      <button onClick={() => fc.onOrdina("entrate", "asc")}>
                        Dal più basso
                      </button>
                    </div>
                    <label className="filtro-campo-pop">
                      <span>Min €</span>
                      <input
                        inputMode="decimal"
                        value={fc.entrateMin}
                        onChange={(e) => fc.setEntrateMin(e.target.value)}
                      />
                    </label>
                    <label className="filtro-campo-pop">
                      <span>Max €</span>
                      <input
                        inputMode="decimal"
                        value={fc.entrateMax}
                        onChange={(e) => fc.setEntrateMax(e.target.value)}
                      />
                    </label>
                    <div className="filtro-pop-azioni">
                      <button
                        className="secondario"
                        onClick={() => {
                          fc.setEntrateMin("");
                          fc.setEntrateMax("");
                        }}
                      >
                        Cancella filtro
                      </button>
                      <button className="primario" onClick={chiudi}>
                        Chiudi
                      </button>
                    </div>
                  </>
                )}
              </ThFiltro>
              <ThFiltro
                titolo="Uscite"
                campo="uscite"
                classeNum
                fc={fc}
                attivo={!!fc.usciteMin || !!fc.usciteMax}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("uscite", "desc")}>
                        Dal più alto
                      </button>
                      <button onClick={() => fc.onOrdina("uscite", "asc")}>
                        Dal più basso
                      </button>
                    </div>
                    <label className="filtro-campo-pop">
                      <span>Min €</span>
                      <input
                        inputMode="decimal"
                        value={fc.usciteMin}
                        onChange={(e) => fc.setUsciteMin(e.target.value)}
                      />
                    </label>
                    <label className="filtro-campo-pop">
                      <span>Max €</span>
                      <input
                        inputMode="decimal"
                        value={fc.usciteMax}
                        onChange={(e) => fc.setUsciteMax(e.target.value)}
                      />
                    </label>
                    <div className="filtro-pop-azioni">
                      <button
                        className="secondario"
                        onClick={() => {
                          fc.setUsciteMin("");
                          fc.setUsciteMax("");
                        }}
                      >
                        Cancella filtro
                      </button>
                      <button className="primario" onClick={chiudi}>
                        Chiudi
                      </button>
                    </div>
                  </>
                )}
              </ThFiltro>
              <ThFiltro
                titolo="Categoria"
                campo="categoria"
                fc={fc}
                attivo={fc.selCategorie !== null}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("categoria", "asc")}>
                        A → Z
                      </button>
                      <button onClick={() => fc.onOrdina("categoria", "desc")}>
                        Z → A
                      </button>
                    </div>
                    <FiltroListaCorpo
                      valori={fc.valoriCategoriaLista}
                      selezionati={fc.selCategorie}
                      onCambia={fc.setSelCategorie}
                      onChiudi={chiudi}
                    />
                  </>
                )}
              </ThFiltro>
              <ThFiltro
                titolo="Tipo"
                campo="tipo"
                fc={fc}
                attivo={fc.selTipi !== null}
                titoloIntestazione="Marcatura speciale: Giro (PAC/investimenti), giroconto Interno tra conti propri, rata Mutuo"
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("tipo", "asc")}>
                        A → Z
                      </button>
                      <button onClick={() => fc.onOrdina("tipo", "desc")}>
                        Z → A
                      </button>
                    </div>
                    <FiltroListaCorpo
                      valori={fc.valoriTipoLista}
                      selezionati={fc.selTipi}
                      onCambia={fc.setSelTipi}
                      onChiudi={chiudi}
                    />
                  </>
                )}
              </ThFiltro>
              <th>Fatt.</th>
              <ThFiltro
                titolo="Tasse"
                fc={fc}
                attivo={fc.selTasse !== null}
                titoloIntestazione="Movimento marcato come pagamento tasse/contributi"
              >
                {(chiudi) => (
                  <FiltroListaCorpo
                    valori={fc.valoriTasseLista}
                    selezionati={fc.selTasse}
                    onCambia={fc.setSelTasse}
                    onChiudi={chiudi}
                  />
                )}
              </ThFiltro>
              <ThFiltro
                titolo="Note"
                campo="note"
                fc={fc}
                attivo={!!fc.filtroColNote}
              >
                {(chiudi) => (
                  <>
                    <div className="filtro-ordina">
                      <button onClick={() => fc.onOrdina("note", "asc")}>
                        A → Z
                      </button>
                      <button onClick={() => fc.onOrdina("note", "desc")}>
                        Z → A
                      </button>
                    </div>
                    <input
                      placeholder="Contiene…"
                      value={fc.filtroColNote}
                      autoFocus
                      onChange={(e) => fc.setFiltroColNote(e.target.value)}
                    />
                    <div className="filtro-pop-azioni">
                      <button
                        className="secondario"
                        onClick={() => fc.setFiltroColNote("")}
                      >
                        Cancella filtro
                      </button>
                      <button className="primario" onClick={chiudi}>
                        Chiudi
                      </button>
                    </div>
                  </>
                )}
              </ThFiltro>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibili.map((t, idx) => (
              <tr
                key={t.id}
                className={
                  (t.trasferimento ? "riga-trasf " : "") +
                  (t.girocontoInterno ? "riga-interna " : "") +
                  (t.mutuo ? "riga-mutuo " : "") +
                  (t.annullata ? "riga-annullata" : "")
                }
              >
                <td>
                  <input
                    type="checkbox"
                    checked={selezione.has(t.id)}
                    onClick={(e) => {
                      shiftPremuto.current = e.shiftKey;
                    }}
                    onChange={() =>
                      onToggleSel(t.id, idx, shiftPremuto.current)
                    }
                  />
                </td>
                <td>{t.data}</td>
                {mostraConto && (
                  <td>
                    {t.conto && (
                      <span
                        className="chip chip-conto"
                        style={{ borderColor: coloreConto[t.conto] }}
                        title={t.conto}
                      >
                        <span
                          className="pallino"
                          style={{ background: coloreConto[t.conto] }}
                        />
                        {t.conto}
                      </span>
                    )}
                  </td>
                )}
                <td title={t.causale} className="cella-causale">
                  {(t.causale ?? "").slice(0, 46) || (
                    <span className="muted">{t.tipologia}</span>
                  )}
                </td>
                <td
                  className="num entrata cella-importo cella-importo-mod"
                  onDoubleClick={() => iniziaModificaImporto(t, "entrate")}
                  title={t.annullata ? undefined : "Doppio click per correggere l'importo"}
                >
                  {cellaInModifica?.id === t.id &&
                  cellaInModifica.campo === "entrate" ? (
                    <input
                      autoFocus
                      className="input-importo-inline"
                      inputMode="decimal"
                      value={valoreInModifica}
                      onChange={(e) => setValoreInModifica(e.target.value)}
                      onBlur={() => confermaModificaImporto(t)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") annullaModificaImporto();
                      }}
                    />
                  ) : t.entrate ? (
                    euro(t.entrate, true)
                  ) : (
                    ""
                  )}
                </td>
                <td
                  className={
                    "num cella-importo cella-importo-mod " +
                    (t.trasferimento || t.girocontoInterno || t.mutuo
                      ? "muted"
                      : "uscita")
                  }
                  onDoubleClick={() => iniziaModificaImporto(t, "uscite")}
                  title={
                    t.annullata
                      ? undefined
                      : t.trasferimento
                        ? "Giro verso investimenti (non è una spesa) · Doppio click per correggere l'importo"
                        : t.girocontoInterno
                          ? "Giroconto interno tra conti propri (non è una spesa) · Doppio click per correggere l'importo"
                          : t.mutuo
                            ? "Rata mutuo (solo la quota interessi è una spesa) · Doppio click per correggere l'importo"
                            : "Doppio click per correggere l'importo"
                  }
                >
                  {cellaInModifica?.id === t.id &&
                  cellaInModifica.campo === "uscite" ? (
                    <input
                      autoFocus
                      className="input-importo-inline"
                      inputMode="decimal"
                      value={valoreInModifica}
                      onChange={(e) => setValoreInModifica(e.target.value)}
                      onBlur={() => confermaModificaImporto(t)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") annullaModificaImporto();
                      }}
                    />
                  ) : t.uscite ? (
                    euro(t.uscite, true)
                  ) : (
                    ""
                  )}
                </td>
                <td>
                  <select
                    value={t.categoria ?? ""}
                    disabled={!!tipoSpecialeDi(t) || t.annullata}
                    onChange={(e) =>
                      onModifica(t.id, {
                        categoria: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">—</option>
                    {categorie.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={tipoSpecialeDi(t)}
                    disabled={t.annullata}
                    title="Giro: verso investimenti (PAC). Interno: tra conti propri. Mutuo: rata (capitale = investimento)."
                    onChange={(e) =>
                      onModifica(
                        t.id,
                        patchTipoSpeciale(e.target.value as TipoSpeciale),
                      )
                    }
                  >
                    <option value="">—</option>
                    <option value="giro">Giro</option>
                    <option value="interno">Interno</option>
                    <option value="mutuo">Mutuo</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={!!t.fattura}
                    disabled={t.annullata}
                    onChange={(e) =>
                      onModifica(t.id, { fattura: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={!!t.tasse}
                    disabled={t.annullata}
                    onChange={(e) =>
                      onModifica(t.id, { tasse: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    className="cella-note"
                    placeholder="…"
                    value={t.note ?? ""}
                    onChange={(e) =>
                      onModifica(t.id, { note: e.target.value || undefined })
                    }
                  />
                </td>
                <td>
                  <button
                    className="secondario"
                    style={{ padding: "2px 8px" }}
                    onClick={() => onToggleAnnullata(t.id)}
                    title={
                      t.annullata
                        ? "Ripristina questo movimento"
                        : "Annulla: resta in elenco (barrato) ma sparisce dai calcoli"
                    }
                  >
                    {t.annullata ? "↩" : "✕"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {righe.length > LIMITE && (
        <p className="muted" style={{ marginTop: 8 }}>
          Mostrate {numero(LIMITE)} di {numero(righe.length)}. Usa i filtri per
          restringere.
        </p>
      )}
    </>
  );
}

// ---------- Intestazione colonna con filtro/ordinamento (stile Excel) ----------

/** Intestazione con un menu a tendina per ordinare/filtrare quella colonna,
 * sullo stesso principio del filtro automatico di Excel. Il contenuto del
 * menu è passato come children (render prop) così ogni colonna può avere il
 * proprio corpo (intervallo date, min/max, lista di valori, "contiene…"). */
function ThFiltro({
  titolo,
  campo,
  classeNum,
  attivo,
  titoloIntestazione,
  fc,
  children,
}: {
  titolo: string;
  campo?: CampoOrdine;
  classeNum?: boolean;
  attivo?: boolean;
  titoloIntestazione?: string;
  fc: FiltriColonna;
  children: (chiudi: () => void) => React.ReactNode;
}) {
  const [aperto, setAperto] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const chiudi = () => setAperto(false);

  // Il popover va in un portal su <body> con position:fixed (coordinate
  // ricalcolate dal bottone): la tabella scrolla in orizzontale
  // (.tabella-wrap overflow-x:auto), il che clipperebbe un popover
  // posizionato normalmente dentro la cella d'intestazione.
  useEffect(() => {
    if (!aperto) return;
    function riposiziona() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    riposiziona();
    function fuori(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target))
        return;
      setAperto(false);
    }
    window.addEventListener("scroll", riposiziona, true);
    window.addEventListener("resize", riposiziona);
    document.addEventListener("mousedown", fuori);
    return () => {
      window.removeEventListener("scroll", riposiziona, true);
      window.removeEventListener("resize", riposiziona);
      document.removeEventListener("mousedown", fuori);
    };
  }, [aperto]);

  const freccia =
    campo && fc.ordine?.campo === campo
      ? fc.ordine.dir === "asc"
        ? " ▲"
        : " ▼"
      : "";
  return (
    <th className={classeNum ? "num" : undefined} title={titoloIntestazione}>
      <span className="th-riga">
        <span className="th-testo">
          {titolo}
          {freccia}
        </span>
        <button
          type="button"
          ref={btnRef}
          className={
            "th-filtro-btn" +
            (aperto ? " th-filtro-aperto" : "") +
            (attivo ? " th-filtro-attivo" : "")
          }
          title={`Filtra/ordina ${titolo}`}
          onClick={() => setAperto((v) => !v)}
        >
          ▾
        </button>
      </span>
      {aperto &&
        createPortal(
          <div
            ref={popRef}
            className="filtro-pop"
            style={{ top: pos.top, right: pos.right }}
          >
            {children(chiudi)}
          </div>,
          document.body,
        )}
    </th>
  );
}

/** Corpo del filtro "a lista" (checkbox), come il menu del filtro automatico
 * di Excel: casella di ricerca, "Seleziona tutto" e l'elenco dei valori. */
function FiltroListaCorpo({
  valori,
  selezionati,
  onCambia,
  onChiudi,
}: {
  valori: VoceLista[];
  selezionati: Set<string> | null;
  onCambia: (s: Set<string> | null) => void;
  onChiudi: () => void;
}) {
  const [cerca, setCerca] = useState("");
  const attivi = selezionati ?? new Set(valori.map((v) => v.valore));
  const filtrati = valori.filter((v) =>
    v.etichetta.toLowerCase().includes(cerca.toLowerCase()),
  );
  const tutteSelezionate =
    filtrati.length > 0 && filtrati.every((v) => attivi.has(v.valore));

  function normalizza(s: Set<string>): Set<string> | null {
    return s.size === valori.length ? null : s;
  }

  function toggleValore(v: string) {
    const next = new Set(attivi);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onCambia(normalizza(next));
  }

  function toggleTutti() {
    const next = new Set(attivi);
    if (tutteSelezionate) filtrati.forEach((v) => next.delete(v.valore));
    else filtrati.forEach((v) => next.add(v.valore));
    onCambia(normalizza(next));
  }

  return (
    <>
      <input
        placeholder="Cerca…"
        value={cerca}
        autoFocus
        onChange={(e) => setCerca(e.target.value)}
      />
      <label className="filtro-lista-voce filtro-lista-tutto">
        <input type="checkbox" checked={tutteSelezionate} onChange={toggleTutti} />
        <b>Seleziona tutto</b>
      </label>
      <div className="filtro-lista-scroll">
        {filtrati.map((v) => (
          <label key={v.valore} className="filtro-lista-voce">
            <input
              type="checkbox"
              checked={attivi.has(v.valore)}
              onChange={() => toggleValore(v.valore)}
            />
            {v.etichetta}
          </label>
        ))}
        {filtrati.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            Nessun valore trovato.
          </span>
        )}
      </div>
      <div className="filtro-pop-azioni">
        <button className="secondario" onClick={() => onCambia(null)}>
          Cancella filtro
        </button>
        <button className="primario" onClick={onChiudi}>
          Chiudi
        </button>
      </div>
    </>
  );
}

// ---------- Mappatura import ----------

function MappaturaImport({
  stato,
  anteprima,
  conti,
  onCambia,
  onConferma,
  onAnnulla,
}: {
  stato: {
    righe: string[][];
    header: string[];
    mappa: MappaturaCsv;
    conHeader: boolean;
    conto: string;
  };
  anteprima: Transazione[];
  conti: string[];
  onCambia: (m: Partial<typeof stato>) => void;
  onConferma: () => void;
  onAnnulla: () => void;
}) {
  const colonne = stato.header.map((h, i) => ({
    i,
    nome: stato.conHeader ? h || `Col ${i + 1}` : `Col ${i + 1}`,
  }));
  const set = (campo: keyof MappaturaCsv, val: number) =>
    onCambia({ mappa: { ...stato.mappa, [campo]: val } });

  const Selettore = ({
    campo,
    label,
    consentiVuoto,
  }: {
    campo: keyof MappaturaCsv;
    label: string;
    consentiVuoto?: boolean;
  }) => (
    <label className="campo">
      {label}
      <select
        value={stato.mappa[campo] ?? -1}
        onChange={(e) => set(campo, Number(e.target.value))}
      >
        {consentiVuoto && <option value={-1}>— nessuna —</option>}
        {colonne.map((c) => (
          <option key={c.i} value={c.i}>
            {c.nome}
          </option>
        ))}
      </select>
    </label>
  );

  const contoOk = stato.conto.trim() !== "";
  const riconosciuta = contoOk && contoRicordato(stato.header) === stato.conto.trim();

  return (
    <div className="card">
      <h3>Importazione CSV — controlla le colonne</h3>

      <div className="import-banca">
        <label className="campo" style={{ maxWidth: 320 }}>
          Di quale banca/conto sono questi movimenti? *
          <input
            list="lista-conti"
            placeholder="es. Fineco, Intesa…"
            value={stato.conto}
            autoFocus={!contoOk}
            onChange={(e) => onCambia({ conto: e.target.value })}
          />
          <datalist id="lista-conti">
            {conti.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          {riconosciuta ? (
            <>✓ Tracciato riconosciuto: già importato da <b>{stato.conto}</b>.</>
          ) : (
            <>
              Tutti i movimenti di questo file verranno salvati su questo
              conto. L'app ricorda il tracciato: la prossima volta la banca
              viene riconosciuta da sola.
            </>
          )}
        </span>
      </div>

      <label
        className="campo"
        style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}
      >
        <input
          type="checkbox"
          checked={stato.conHeader}
          onChange={(e) => onCambia({ conHeader: e.target.checked })}
        />
        La prima riga è un'intestazione
      </label>
      <div className="form-griglia">
        <Selettore campo="data" label="Data" />
        <Selettore campo="entrate" label="Entrate" consentiVuoto />
        <Selettore campo="uscite" label="Uscite" consentiVuoto />
        <Selettore campo="importo" label="Importo unico (con segno)" consentiVuoto />
        <Selettore campo="causale" label="Causale" consentiVuoto />
        <Selettore campo="tipologia" label="Tipologia" consentiVuoto />
      </div>

      <p className="muted" style={{ marginTop: 14 }}>
        Anteprima ({anteprima.length} movimenti riconosciuti):
      </p>
      <div className="tabella-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Causale</th>
              <th className="num">Entrate</th>
              <th className="num">Uscite</th>
            </tr>
          </thead>
          <tbody>
            {anteprima.slice(0, 5).map((t) => (
              <tr key={t.id}>
                <td>{t.data}</td>
                <td>{(t.causale ?? "").slice(0, 40)}</td>
                <td className="num">{t.entrate ? euro(t.entrate, true) : ""}</td>
                <td className="num">{t.uscite ? euro(t.uscite, true) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="riga-azioni" style={{ marginTop: 14 }}>
        <button
          className="primario"
          onClick={onConferma}
          disabled={anteprima.length === 0 || !contoOk}
          title={!contoOk ? "Indica prima la banca/conto del file" : ""}
        >
          Importa {numero(anteprima.length)} movimenti
          {contoOk && <> su {stato.conto.trim()}</>}
        </button>
        <button className="secondario" onClick={onAnnulla}>
          Annulla
        </button>
        {!contoOk && (
          <span className="muted" style={{ fontSize: 12 }}>
            ⚠ Indica la banca per procedere.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Pannello categorizzazione con Claude ----------

function PannelloAI({ onChiudi }: { onChiudi: () => void }) {
  const { dati, aggiorna } = useApp();
  const [risultato, setRisultato] = useState("");
  const [esito, setEsito] = useState("");

  // Trasferimenti, giroconti interni e rate mutuo non sono spese da
  // categorizzare; le voci annullate non esistono.
  const daFare = dati.transazioni.filter(
    (t) =>
      t.uscite &&
      !t.categoria &&
      !t.trasferimento &&
      !t.girocontoInterno &&
      !t.mutuo &&
      !t.annullata,
  );

  const prompt = buildPromptCategorizzazione(dati.categorie, daFare);

  function copia() {
    void navigator.clipboard.writeText(prompt);
    setEsito("Prompt copiato negli appunti. Incollalo su Claude.");
  }

  function applica() {
    const perId = new Map(dati.transazioni.map((t) => [t.id, t]));
    const nomiValidi = new Set(dati.categorie.map((c) => c.nome));
    let n = 0;
    let ignorate = 0;
    const patch = new Map<string, string>();
    for (const riga of risultato.split(/\r?\n/)) {
      const [id, ...resto] = riga.split(/[;,\t]/);
      const idT = id?.trim();
      const cat = resto.join(",").trim();
      if (!idT || !cat || !perId.has(idT)) continue;
      // Accetta solo categorie esistenti (match case-insensitive).
      const nome =
        [...nomiValidi].find((v) => v.toLowerCase() === cat.toLowerCase()) ??
        null;
      if (!nome) {
        ignorate++;
        continue;
      }
      patch.set(idT, nome);
      n++;
    }
    if (n > 0) {
      aggiorna((d) => ({
        ...d,
        transazioni: d.transazioni.map((t) =>
          patch.has(t.id) ? { ...t, categoria: patch.get(t.id) } : t,
        ),
      }));
    }
    setEsito(
      `Applicate ${n} categorie.` +
        (ignorate > 0 ? ` ${ignorate} righe ignorate (categoria non valida).` : ""),
    );
    setRisultato("");
  }

  return (
    <div className="card">
      <div className="riga-azioni" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Categorizzazione con Claude</h3>
        <button className="secondario" onClick={onChiudi}>
          Chiudi
        </button>
      </div>
      <p className="muted">
        {daFare.length} movimenti da categorizzare. Copia il prompt (contiene le
        categorie con le loro descrizioni), incollalo su claude.ai, poi incolla
        qui sotto le righe <code>id;categoria</code> che ottieni. Per migliorare
        i risultati, arricchisci le descrizioni delle categorie in{" "}
        <b>Impostazioni</b>.
      </p>
      <div className="riga-azioni">
        <button className="primario" onClick={copia}>
          Copia prompt
        </button>
      </div>
      <textarea
        style={{
          width: "100%",
          minHeight: 120,
          marginTop: 12,
          fontFamily: "monospace",
          fontSize: 12,
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--bordo)",
          background: "var(--bg-card)",
          color: "var(--testo)",
        }}
        placeholder="Incolla qui il risultato di Claude (righe id;categoria)…"
        value={risultato}
        onChange={(e) => setRisultato(e.target.value)}
      />
      <div className="riga-azioni" style={{ marginTop: 10 }}>
        <button
          className="primario"
          onClick={applica}
          disabled={!risultato.trim()}
        >
          Applica categorie
        </button>
        {esito && <span className="muted">{esito}</span>}
      </div>
    </div>
  );
}

/** Costruisce un prompt strutturato per far categorizzare i movimenti a Claude. */
function buildPromptCategorizzazione(
  categorie: { nome: string; descrizione?: string }[],
  daFare: Transazione[],
): string {
  const elencoCategorie = categorie
    .map((c) => (c.descrizione ? `- ${c.nome}: ${c.descrizione}` : `- ${c.nome}`))
    .join("\n");

  const righe = daFare
    .map((t) =>
      [
        t.id,
        t.data,
        (t.tipologia ?? "").replace(/;/g, ","),
        t.uscite ?? "",
        (t.causale ?? "").replace(/;/g, ",").replace(/\s+/g, " ").trim(),
      ].join(";"),
    )
    .join("\n");

  return (
    `Sei un contabile che classifica movimenti bancari italiani per una contabilità personale. ` +
    `Assegna a OGNI movimento una sola categoria tra quelle elencate, scegliendo la più probabile ` +
    `in base a causale, tipologia e importo.\n\n` +
    `CATEGORIE DISPONIBILI (usa ESATTAMENTE questi nomi, senza varianti né categorie inventate):\n` +
    `${elencoCategorie}\n\n` +
    `INDIZI UTILI:\n` +
    `- La "tipologia" aiuta: pagamento POS/carta = acquisto in negozio; addebito SEPA/RID o bonifico ricorrente = spesso abbonamenti o utenze; prelievo/ATM = Contanti.\n` +
    `- Nomi noti nella causale indirizzano la categoria (es. Esselunga→Spesa/casa, Q8→Benzina, Netflix→Abbonamenti, Telepass→Auto).\n` +
    `- Se un movimento non combacia con nessuna categoria, usa "Extra". Se è dubbio ma verificabile, usa "Da fare".\n\n` +
    `REGOLE DI RISPOSTA:\n` +
    `- Rispondi SOLO con righe nel formato "id;categoria", una per movimento.\n` +
    `- Niente intestazione, niente spiegazioni, niente altro testo.\n` +
    `- Usa esclusivamente i nomi di categoria elencati sopra.\n\n` +
    `MOVIMENTI DA CATEGORIZZARE (formato: id;data;tipologia;importo;causale):\n` +
    `${righe}`
  );
}
