// Motore di analisi spese/entrate. Replica la logica del foglio "AnalisiSpese":
// somma le uscite per categoria e per mese (equivalente ai SUMIFS dell'Excel).

import { Mutuo, Transazione } from "../types";
import { annoMese } from "../util";
import { interessiDelMese } from "./mutuo";

export interface RigaMese {
  mese: string; // yyyy-mm
  perCategoria: Record<string, number>; // uscite per categoria
  totaleUscite: number;
  totaleEntrate: number;
  tasse: number; // uscite con flag tasse
  trasferimenti: number; // uscite con flag trasferimento (giroconti/investimenti)
  /** Quota capitale delle rate di mutuo (investimento, non spesa). */
  mutuoCapitale: number;
}

export interface AnalisiRisultato {
  mesi: RigaMese[];
  categorie: string[];
  totalePerCategoria: Record<string, number>;
  totaleUscite: number;
  totaleEntrate: number;
  totaleTasse: number;
  totaleTrasferimenti: number;
  /** Quota capitale complessiva delle rate di mutuo nel periodo. */
  totaleMutuoCapitale: number;
}

const SENZA_CATEGORIA = "(non categorizzato)";
/** Categoria sintetica in cui finisce la quota interessi delle rate di mutuo. */
export const CAT_MUTUO_INTERESSI = "Mutuo (interessi)";

/** Ordina gli yyyy-mm crescenti e riempie i buchi tra il primo e l'ultimo. */
function tuttiIMesi(daISO: string, aISO: string): string[] {
  const [ya, ma] = daISO.split("-").map(Number);
  const [yb, mb] = aISO.split("-").map(Number);
  const out: string[] = [];
  let y = ya;
  let m = ma;
  while (y < yb || (y === yb && m <= mb)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function analizza(
  transazioni: Transazione[],
  categorieNote: string[],
  mutui: Mutuo[] = [],
): AnalisiRisultato {
  // Le voci annullate non esistono per il calcolo.
  transazioni = transazioni.filter((t) => !t.annullata);
  if (transazioni.length === 0) {
    return {
      mesi: [],
      categorie: categorieNote,
      totalePerCategoria: {},
      totaleUscite: 0,
      totaleEntrate: 0,
      totaleTasse: 0,
      totaleTrasferimenti: 0,
      totaleMutuoCapitale: 0,
    };
  }

  const perMese = new Map<string, RigaMese>();
  const totalePerCategoria: Record<string, number> = {};
  let totaleUscite = 0;
  let totaleEntrate = 0;
  let totaleTasse = 0;
  let totaleTrasferimenti = 0;
  let totaleMutuoCapitale = 0;
  const categorieUsate = new Set<string>(categorieNote);

  // Budget interessi residuo per mese: ogni rata flaggata "mutuo" assorbe la
  // quota interessi del suo mese (dal piano di ammortamento); il resto della
  // rata e' quota capitale (investimento, non spesa).
  const interessiRestanti = new Map<string, number>();
  function quotaInteressi(mese: string, uscita: number): number {
    if (mutui.length === 0) return 0;
    let resto = interessiRestanti.get(mese);
    if (resto === undefined) {
      resto = 0;
      for (const m of mutui) resto += interessiDelMese(m, mese);
    }
    const quota = Math.min(uscita, resto);
    interessiRestanti.set(mese, resto - quota);
    return quota;
  }

  let minMese: string | undefined;
  let maxMese: string | undefined;

  for (const t of transazioni) {
    const mese = annoMese(t.data);
    if (!minMese || mese < minMese) minMese = mese;
    if (!maxMese || mese > maxMese) maxMese = mese;

    let riga = perMese.get(mese);
    if (!riga) {
      riga = {
        mese,
        perCategoria: {},
        totaleUscite: 0,
        totaleEntrate: 0,
        tasse: 0,
        trasferimenti: 0,
        mutuoCapitale: 0,
      };
      perMese.set(mese, riga);
    }

    // Giroconti interni tra conti propri: le due gambe si annullano, non sono
    // ne' spese ne' entrate. Fuori dall'analisi del tutto.
    if (t.girocontoInterno) continue;

    // I trasferimenti (giroconti/PAC) non sono spese: non entrano nelle
    // categorie ne' nel totale uscite, ma vengono tracciati a parte.
    if (t.trasferimento) {
      if (t.uscite) {
        riga.trasferimenti += t.uscite;
        totaleTrasferimenti += t.uscite;
      }
      continue;
    }

    // Rate di mutuo: solo la quota interessi e' una spesa (categoria
    // sintetica); la quota capitale e' investimento e va tracciata a parte.
    if (t.mutuo) {
      if (t.uscite) {
        const qi = quotaInteressi(mese, t.uscite);
        const qc = t.uscite - qi;
        if (qi > 0) {
          categorieUsate.add(CAT_MUTUO_INTERESSI);
          riga.perCategoria[CAT_MUTUO_INTERESSI] =
            (riga.perCategoria[CAT_MUTUO_INTERESSI] ?? 0) + qi;
          riga.totaleUscite += qi;
          totalePerCategoria[CAT_MUTUO_INTERESSI] =
            (totalePerCategoria[CAT_MUTUO_INTERESSI] ?? 0) + qi;
          totaleUscite += qi;
        }
        riga.mutuoCapitale += qc;
        totaleMutuoCapitale += qc;
      }
      continue;
    }

    if (t.uscite) {
      if (t.tasse) {
        // Le tasse non sono una spesa discrezionale: escluse dalle categorie
        // e dal totale uscite. Il loro impatto va invece stimato a parte
        // (pannello Tasse, spalmato giorno per giorno) sottraendolo dalle
        // entrate, perche' i pagamenti reali sono spesso concentrati in
        // poche rate irregolari e sballerebbero il periodo in cui cadono.
        riga.tasse += t.uscite;
        totaleTasse += t.uscite;
      } else {
        const cat = t.categoria?.trim() || SENZA_CATEGORIA;
        categorieUsate.add(cat);
        riga.perCategoria[cat] = (riga.perCategoria[cat] ?? 0) + t.uscite;
        riga.totaleUscite += t.uscite;
        totalePerCategoria[cat] = (totalePerCategoria[cat] ?? 0) + t.uscite;
        totaleUscite += t.uscite;
      }
    }
    if (t.entrate) {
      riga.totaleEntrate += t.entrate;
      totaleEntrate += t.entrate;
    }
  }

  const mesiOrdinati = tuttiIMesi(minMese!, maxMese!).map(
    (m) =>
      perMese.get(m) ?? {
        mese: m,
        perCategoria: {},
        totaleUscite: 0,
        totaleEntrate: 0,
        tasse: 0,
        trasferimenti: 0,
        mutuoCapitale: 0,
      },
  );

  const categorie = [...categorieUsate].sort((a, b) => {
    // categorie note per prime nell'ordine dato, poi le altre
    const ia = categorieNote.indexOf(a);
    const ib = categorieNote.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  return {
    mesi: mesiOrdinati,
    categorie,
    totalePerCategoria,
    totaleUscite,
    totaleEntrate,
    totaleTasse,
    totaleTrasferimenti,
    totaleMutuoCapitale,
  };
}

/** Aggrega le righe mensili per anno. */
export function perAnno(mesi: RigaMese[]): RigaMese[] {
  const map = new Map<string, RigaMese>();
  for (const r of mesi) {
    const anno = r.mese.slice(0, 4);
    let a = map.get(anno);
    if (!a) {
      a = {
        mese: anno,
        perCategoria: {},
        totaleUscite: 0,
        totaleEntrate: 0,
        tasse: 0,
        trasferimenti: 0,
        mutuoCapitale: 0,
      };
      map.set(anno, a);
    }
    for (const [cat, v] of Object.entries(r.perCategoria)) {
      a.perCategoria[cat] = (a.perCategoria[cat] ?? 0) + v;
    }
    a.totaleUscite += r.totaleUscite;
    a.totaleEntrate += r.totaleEntrate;
    a.tasse += r.tasse;
    a.trasferimenti += r.trasferimenti;
    a.mutuoCapitale += r.mutuoCapitale;
  }
  return [...map.values()].sort((x, y) => x.mese.localeCompare(y.mese));
}
