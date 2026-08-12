// Motore del saldo reale. Replica, in forma piu' pulita, la catena di
// correzione del foglio "Saldo" dell'Excel:
//
//   grezzo         = saldo iniziale + cumulato (entrate - uscite) dai movimenti
//   nettoTasse     = grezzo - "manca da pagare" tasse a quella data
//   potereAcquisto = nettoTasse - incassi fattura a blocco + incassi fattura spalmati sul mese
//
// Il "manca da pagare" tasse e' lo stesso della scheda Tasse (confrontoTasse):
// per ogni anno la quota maturata giorno-per-giorno (Inarcassa + Imposta
// dichiarate) meno i pagamenti gia' ripartiti, azzerata per le voci segnate
// "Chiuso". Cosi' il gap tra "saldo grezzo" e "netto tasse" coincide, giorno
// per giorno, col "manca da pagare oggi" mostrato nella scheda Tasse.

import { AnnoTasse, Parametri, Transazione } from "../types";
import { confrontoTasse } from "./tasse";

export interface PuntoSaldo {
  data: string; // ISO
  grezzo: number;
  nettoTasse: number;
  potereAcquisto: number;
  /** Capitale cumulato trasferito su altri conti/investimenti (giroconti/PAC). */
  investito: number;
  /** Patrimonio totale: netto tasse + capitale investito (i trasferimenti non "spariscono"). */
  totale: number;
  /** Saldo grezzo cumulato per singolo conto (entrate-uscite di quel conto, senza tasse). */
  perConto: Record<string, number>;
}

export interface SaldoRisultato {
  punti: PuntoSaldo[];
  ultimo?: PuntoSaldo;
  /** Nomi dei conti distinti trovati nei movimenti, in ordine alfabetico. */
  conti: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDa(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function giorniNelMese(anno: number, mese1: number): number {
  return new Date(anno, mese1, 0).getDate();
}

export function calcolaSaldo(
  transazioni: Transazione[],
  tasse: AnnoTasse[],
  par: Parametri,
): SaldoRisultato {
  // Le voci annullate non esistono per il calcolo.
  transazioni = transazioni.filter((t) => !t.annullata);
  if (transazioni.length === 0) return { punti: [], conti: [] };

  const ordinate = [...transazioni].sort((a, b) => a.data.localeCompare(b.data));

  // Movimenti "tasse" (gia' senza annullate): alimentano il "pagato" ripartito
  // del confronto per anno, imputato alla data del versamento.
  const tasseMovimenti = ordinate.filter((t) => t.tasse);

  const netto = new Map<string, number>(); // entrate - uscite per giorno
  const trasferGiorno = new Map<string, number>(); // uscite flag trasferimento per giorno
  const fatturaGiorno = new Map<string, number>(); // entrate flag fattura per giorno
  const fatturaMese = new Map<string, number>(); // entrate flag fattura per mese yyyy-mm
  const nettoContoGiorno = new Map<string, Map<string, number>>(); // conto -> (giorno -> entrate-uscite)
  const conti = new Set<string>();

  for (const t of ordinate) {
    const d = t.data;
    netto.set(d, (netto.get(d) ?? 0) + (t.entrate ?? 0) - (t.uscite ?? 0));
    if (t.trasferimento && t.uscite)
      trasferGiorno.set(d, (trasferGiorno.get(d) ?? 0) + t.uscite);
    if (t.fattura && t.entrate) {
      fatturaGiorno.set(d, (fatturaGiorno.get(d) ?? 0) + t.entrate);
      const m = d.slice(0, 7);
      fatturaMese.set(m, (fatturaMese.get(m) ?? 0) + t.entrate);
    }
    if (t.conto) {
      conti.add(t.conto);
      let m = nettoContoGiorno.get(t.conto);
      if (!m) {
        m = new Map<string, number>();
        nettoContoGiorno.set(t.conto, m);
      }
      m.set(d, (m.get(d) ?? 0) + (t.entrate ?? 0) - (t.uscite ?? 0));
    }
  }
  const contiOrdinati = [...conti].sort();

  const startIso =
    par.saldoInizialeData && par.saldoInizialeData < ordinate[0].data
      ? par.saldoInizialeData
      : ordinate[0].data;
  // La serie arriva fino a OGGI anche se non ci sono movimenti recenti: le
  // tasse continuano a maturare giorno per giorno, quindi il "netto tasse" a
  // oggi (e il suo scarto dal grezzo) coincide col "manca da pagare oggi"
  // della scheda Tasse, sempre calcolato a oggi. Senza questo, la serie si
  // fermava all'ultimo movimento e lo scarto restava indietro di qualche
  // giorno di maturazione (~importo tasse annuo / 365 al giorno).
  const ultimoMovimento = ordinate[ordinate.length - 1].data;
  const oggiIso = isoDa(new Date());
  const endIso = ultimoMovimento > oggiIso ? ultimoMovimento : oggiIso;

  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");

  let cumNetto = par.saldoInizialeValore ?? 0;
  let cumTrasferito = 0;
  let cumFatturaBlocco = 0;
  let fatturaMesiCompletati = 0;
  let meseCorrente = "";
  const cumPerConto = new Map<string, number>(contiOrdinati.map((c) => [c, 0]));

  const punti: PuntoSaldo[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoDa(d);
    const mese = iso.slice(0, 7);

    cumNetto += netto.get(iso) ?? 0;
    cumTrasferito += trasferGiorno.get(iso) ?? 0;
    cumFatturaBlocco += fatturaGiorno.get(iso) ?? 0;

    if (meseCorrente && mese !== meseCorrente) {
      fatturaMesiCompletati += fatturaMese.get(meseCorrente) ?? 0;
    }
    meseCorrente = mese;

    // "Manca da pagare" tasse a questa data: identico alla scheda Tasse. Per
    // ogni anno somma (Inarcassa + Imposta) maturate a oggi meno i pagamenti
    // gia' ripartiti, con le voci "Chiuso" azzerate. Il gap tra grezzo e netto
    // tasse coincide cosi' col "manca da pagare" mostrato nella scheda Tasse.
    const daVersare = confrontoTasse(tasse, tasseMovimenti, iso).reduce(
      (s, r) => s + r.daVersareTotale,
      0,
    );

    const grezzo = cumNetto;
    const nettoTasse = grezzo - daVersare;

    const giorniMese = giorniNelMese(d.getFullYear(), d.getMonth() + 1);
    const fatturaSpalmata =
      fatturaMesiCompletati +
      ((fatturaMese.get(mese) ?? 0) * d.getDate()) / giorniMese;
    const potereAcquisto = nettoTasse - cumFatturaBlocco + fatturaSpalmata;

    // I trasferimenti hanno gia' ridotto grezzo/nettoTasse (sono usciti dal
    // conto): riaggiungendoli come "investito" il patrimonio totale non cala.
    const totale = nettoTasse + cumTrasferito;

    const perConto: Record<string, number> = {};
    for (const c of contiOrdinati) {
      const cum = (cumPerConto.get(c) ?? 0) + (nettoContoGiorno.get(c)?.get(iso) ?? 0);
      cumPerConto.set(c, cum);
      perConto[c] = round(cum);
    }

    punti.push({
      data: iso,
      grezzo: round(grezzo),
      nettoTasse: round(nettoTasse),
      potereAcquisto: round(potereAcquisto),
      investito: round(cumTrasferito),
      totale: round(totale),
      perConto,
    });
  }

  return { punti, ultimo: punti[punti.length - 1], conti: contiOrdinati };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Riduce i punti per il grafico (uno ogni `passo` giorni, ultimo incluso). */
export function campiona(punti: PuntoSaldo[], passo = 7): PuntoSaldo[] {
  if (punti.length <= passo) return punti;
  const out: PuntoSaldo[] = [];
  for (let i = 0; i < punti.length; i += passo) out.push(punti[i]);
  const ultimo = punti[punti.length - 1];
  if (out[out.length - 1]?.data !== ultimo.data) out.push(ultimo);
  return out;
}
