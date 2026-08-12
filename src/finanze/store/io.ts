// Import/export: JSON dell'app (backup completo) e CSV dei movimenti bancari.

import { DatiApp, Transazione, VERSIONE_DATI, datiVuoti } from "../types";
import { parseDataIso, parseNumeroIt, uid } from "../util";

// ---------- Export / Import JSON (backup completo) ----------

export function esportaJson(dati: DatiApp): void {
  const blob = new Blob([JSON.stringify(dati, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const oggi = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `finanze-${oggi}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Normalizza uno snapshot gia' deserializzato. Separata da `importaJson` perche'
 * il backup su OneDrive arriva da Graph gia' come oggetto: farne un round-trip
 * in stringa solo per riparsarlo sarebbe sprecato.
 */
export function importaDati(raw: unknown): DatiApp {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as DatiApp).transazioni)
  ) {
    throw new Error("File non valido: manca l'elenco transazioni.");
  }
  const grezzo = raw as Partial<DatiApp>;
  // Merge con struttura vuota per tollerare versioni diverse / campi mancanti.
  const base = datiVuoti();
  return {
    ...base,
    ...grezzo,
    versione: VERSIONE_DATI,
    parametri: { ...base.parametri, ...(grezzo.parametri ?? {}) },
  };
}

export function importaJson(testo: string): DatiApp {
  return importaDati(JSON.parse(testo));
}

// ---------- Deduplica ----------

/** Firma di un movimento per riconoscere i duplicati (data + importi + causale). */
export function firmaTransazione(t: Transazione): string {
  return [
    t.data,
    t.entrate ?? "",
    t.uscite ?? "",
    (t.causale ?? "").trim().toLowerCase(),
  ].join("|");
}

/** Rimuove dai `nuovi` i movimenti gia' presenti in `esistenti`. */
export function scartaDuplicati(
  nuovi: Transazione[],
  esistenti: Transazione[],
): { unici: Transazione[]; duplicati: number } {
  const viste = new Set(esistenti.map(firmaTransazione));
  const unici: Transazione[] = [];
  let duplicati = 0;
  for (const t of nuovi) {
    const f = firmaTransazione(t);
    if (viste.has(f)) {
      duplicati++;
    } else {
      viste.add(f); // evita anche duplicati interni allo stesso file
      unici.push(t);
    }
  }
  return { unici, duplicati };
}

// ---------- Parser CSV ----------

/** Rileva il separatore piu' probabile guardando la prima riga. */
function rilevaSeparatore(riga: string): string {
  const candidati = [";", ",", "\t"];
  let migliore = ";";
  let max = -1;
  for (const c of candidati) {
    const n = riga.split(c).length;
    if (n > max) {
      max = n;
      migliore = c;
    }
  }
  return migliore;
}

/** Parser CSV che gestisce campi tra virgolette e separatore configurabile. */
export function parseCsv(testo: string): string[][] {
  const t = testo.replace(/^﻿/, ""); // rimuove BOM
  const primaRiga = t.split(/\r?\n/)[0] ?? "";
  const sep = rilevaSeparatore(primaRiga);

  const righe: string[][] = [];
  let campo = "";
  let riga: string[] = [];
  let inVirgolette = false;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inVirgolette) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          inVirgolette = false;
        }
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      inVirgolette = true;
    } else if (ch === sep) {
      riga.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      riga.push(campo);
      campo = "";
      if (riga.some((c) => c.trim() !== "")) righe.push(riga);
      riga = [];
    } else {
      campo += ch;
    }
  }
  if (campo !== "" || riga.length > 0) {
    riga.push(campo);
    if (riga.some((c) => c.trim() !== "")) righe.push(riga);
  }
  return righe;
}

export type MappaturaCsv = {
  data: number;
  entrate: number;
  uscite: number;
  tipologia?: number;
  causale?: number;
  stato?: number;
  /** Colonna unica importo con segno (alternativa a entrate/uscite). */
  importo?: number;
};

/** Prova a indovinare la mappatura colonne dagli header. */
export function indovinaMappatura(header: string[]): MappaturaCsv {
  const norm = header.map((h) => h.toLowerCase().trim());
  const usate = new Set<number>();
  // Ogni colonna viene assegnata a un solo campo: senza esclusione,
  // "operazione" matcherebbe anche "data operazione" già usata per la data.
  const trova = (...chiavi: string[]) => {
    const i = norm.findIndex(
      (h, idx) => !usate.has(idx) && chiavi.some((k) => h.includes(k)),
    );
    if (i >= 0) usate.add(i);
    return i;
  };

  const data = trova("data operazione", "data valuta", "data contabile", "data");
  const entrate = trova("entrate", "accrediti", "avere", "entrata");
  const uscite = trova("uscite", "addebiti", "dare", "uscita");
  const importo = trova("importo", "amount");
  const causale = trova("causale", "descrizione", "dettagli", "description");
  const tipologia = trova("tipologia", "tipo", "operazione");
  const stato = trova("stato", "status");

  return {
    data: data < 0 ? 0 : data,
    entrate,
    uscite,
    importo: entrate < 0 && uscite < 0 ? importo : -1,
    tipologia: tipologia < 0 ? undefined : tipologia,
    causale: causale < 0 ? undefined : causale,
    stato: stato < 0 ? undefined : stato,
  };
}

/** Converte le righe CSV (senza header) in transazioni secondo la mappatura. */
export function righeATransazioni(
  righe: string[][],
  m: MappaturaCsv,
): Transazione[] {
  const out: Transazione[] = [];
  for (const r of righe) {
    const data = parseDataIso(r[m.data]);
    if (!data) continue;

    let entrate = m.entrate >= 0 ? parseNumeroIt(r[m.entrate]) : undefined;
    let uscite = m.uscite >= 0 ? parseNumeroIt(r[m.uscite]) : undefined;

    if (m.importo !== undefined && m.importo >= 0) {
      const imp = parseNumeroIt(r[m.importo]);
      if (imp !== undefined) {
        if (imp >= 0) entrate = imp;
        else uscite = Math.abs(imp);
      }
    }
    // Le uscite sono sempre positive (come nell'Excel: colonna G).
    if (uscite !== undefined) uscite = Math.abs(uscite);
    if (entrate !== undefined) entrate = Math.abs(entrate);

    if (entrate === undefined && uscite === undefined) continue;

    out.push({
      id: uid(),
      data,
      tipologia: m.tipologia !== undefined ? r[m.tipologia]?.trim() : undefined,
      causale: m.causale !== undefined ? r[m.causale]?.trim() : undefined,
      stato: m.stato !== undefined ? r[m.stato]?.trim() : undefined,
      entrate,
      uscite,
    });
  }
  return out;
}
