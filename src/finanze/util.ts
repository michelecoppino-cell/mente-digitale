// Utility comuni: id, parsing date/numeri (anche formato italiano), formattazione.

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

/** Converte un numero in formato "1.234,56" o "1234.56" in number. */
export function parseNumeroIt(raw: string | number | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return isNaN(raw) ? undefined : raw;
  let s = raw.trim();
  if (s === "") return undefined;
  s = s.replace(/[€$\s]/g, "");
  const haComma = s.includes(",");
  const haPunto = s.includes(".");
  if (haComma && haPunto) {
    // Formato italiano: punto = migliaia, virgola = decimali
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (haComma) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

/** Converte una data in vari formati (dd/mm/yyyy, yyyy-mm-dd, ...) in ISO yyyy-mm-dd. */
export function parseDataIso(raw: string | Date | undefined | null): string | undefined {
  if (!raw) return undefined;
  if (raw instanceof Date) return toIso(raw);
  const s = raw.trim();
  if (s === "") return undefined;
  // gia' ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy o dd-mm-yyyy o dd.mm.yyyy
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? undefined : toIso(dt);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

const FMT_EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const FMT_EUR2 = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const FMT_NUM = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

/**
 * Separatore delle migliaia: apostrofo tipografico (stile svizzero, 4’000).
 * Distingue a colpo d'occhio le migliaia dalla virgola dei decimali.
 */
const SEP_MIGLIAIA = "’";

/** Inserisce il separatore ogni 3 cifre (anche sui numeri a 4 cifre). */
function raggruppa(cifre: string): string {
  return cifre.replace(/\B(?=(\d{3})+(?!\d))/g, SEP_MIGLIAIA);
}

/**
 * Formatta con Intl ma raggruppa le migliaia a mano: il locale italiano non
 * separa i numeri a 4 cifre (4000 resta "4000"), qui invece vogliamo sempre
 * il separatore (4’000).
 */
function conSeparatore(fmt: Intl.NumberFormat, n: number): string {
  const parti = fmt.formatToParts(n);
  let out = "";
  let intere = "";
  for (const p of parti) {
    if (p.type === "integer") {
      intere += p.value;
      continue;
    }
    if (p.type === "group") continue;
    if (intere) {
      out += raggruppa(intere);
      intere = "";
    }
    out += p.value;
  }
  if (intere) out += raggruppa(intere);
  return out;
}

export function euro(n: number | undefined, decimali = false): string {
  if (n === undefined || isNaN(n)) return "—";
  return conSeparatore(decimali ? FMT_EUR2 : FMT_EUR, n);
}

/** Numero intero con separatore migliaia. */
export function numero(n: number | undefined): string {
  if (n === undefined || isNaN(n)) return "—";
  return conSeparatore(FMT_NUM, n);
}

export const MESI = [
  "Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
  "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
];

/** yyyy-mm -> "Gen 2024" */
export function labelMese(annoMese: string): string {
  const [y, m] = annoMese.split("-");
  return `${MESI[parseInt(m, 10) - 1]} ${y}`;
}

/** ISO date -> "yyyy-mm" */
export function annoMese(iso: string): string {
  return iso.slice(0, 7);
}

/** yyyy-mm -> yyyy-mm-dd dell'ultimo giorno di quel mese. */
export function ultimoGiornoMese(annoMese: string): string {
  const [y, m] = annoMese.split("-").map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${annoMese}-${String(ultimo).padStart(2, "0")}`;
}

/** Numero di giorni lavorativi (lun-ven) di un mese (mese: 1 = gennaio). */
export function giorniLavorativiMese(anno: number, mese1: number): number {
  const ultimo = new Date(anno, mese1, 0).getDate();
  let n = 0;
  for (let d = 1; d <= ultimo; d++) {
    const giorno = new Date(anno, mese1 - 1, d).getDay();
    if (giorno !== 0 && giorno !== 6) n++;
  }
  return n;
}

/** ISO date (yyyy-mm-dd) -> giorni lavorativi (lun-ven) del suo mese. */
export function giorniLavorativiDelMese(dataIso: string): number {
  const [y, m] = dataIso.slice(0, 7).split("-").map(Number);
  return giorniLavorativiMese(y, m);
}

/** Palette dei badge/linee per conto (assegnata per ordine alfabetico dei conti). */
export const COLORI_CONTO = [
  "#4c78a8", "#f58518", "#54a24b", "#b279a2", "#e45756", "#72b7b2",
];

/** Mappa nome conto -> colore, stabile in base all'ordine alfabetico. */
export function mappaColoriConto(conti: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  conti.forEach((c, i) => (m[c] = COLORI_CONTO[i % COLORI_CONTO.length]));
  return m;
}

/**
 * Valore numerico da un dato di recharts.
 *
 * Dalla 3 i formatter dei tooltip dichiarano `ValueType` (numero, stringa o
 * array, eventualmente undefined) invece del numero che di fatto arriva sempre
 * dalle nostre serie: questo riporta il tipo a quello vero senza spargere cast
 * nei grafici.
 */
export function numRecharts(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}
