// Motore della proiezione futura. Continua la curva del saldo reale ("potere
// d'acquisto") verso il futuro usando gli scenari di entrate/uscite
// (SpeseEntrateFuturi) e la crescita degli investimenti (Investimenti), il
// tutto in termini REALI (al netto dell'inflazione).
//
// Il patrimonio e' scomposto in tre parti, cosi' il "liquido" e' davvero
// liquido (il capitale investito non ci finisce dentro):
//
//   liquido(t)   = ultimo saldo reale
//                  + risparmi mensili (netto - spesa)
//                  - spese grosse
//                  - versamenti negli investimenti (quando escono dal conto)
//                  + tranche che maturano (a pensione: capitale + interessi tornano liquidi)
//   investito(t) = capitale attualmente vincolato negli investimenti attivi
//   guadagni(t)  = interessi COMPOSTI maturati (non ancora realizzati)
//   patrimonio   = liquido + investito + guadagni
//
// Assunzione: il capitale gia' investito prima dell'inizio della proiezione e'
// considerato fuori dal saldo liquido di partenza (i trasferimenti verso i
// depositi sono gia' usciti dal conto). I versamenti FUTURI, invece, vengono
// dedotti dal liquido quando avvengono.
//
// Il capitale investito NON rientra nel liquido alla scadenza (dataFine): quella
// data ferma solo i versamenti del PAC. Il capitale resta investito e continua a
// rendere fino alla pensione, quando l'intera tranche matura e torna liquida
// (cosi' si "realizza" e si tassa solo alla fine). Se dataFine cade dopo la
// pensione, la maturazione avviene a dataFine.

import {
  AnnoTasse,
  EventoFuturo,
  Investimento,
  Mutuo,
  Parametri,
  Transazione,
} from "../types";
import { calcolaSaldo } from "./saldo";
import { equityImmobili } from "./mutuo";

export interface PuntoProiezione {
  data: string; // yyyy-mm-01
  eta: number;
  liquido: number;
  investito: number;
  guadagni: number;
  /** Equity immobiliare: anticipo + capitale rimborsato dei mutui. */
  immobile: number;
  totale: number;
}

export interface ProiezioneRisultato {
  punti: PuntoProiezione[];
  patrimonioOggi?: number;
  capitalePensione?: number;
  dataPensione?: string;
  renditaAnnua?: number;
  renditaMensile?: number;
  /** Liquidita' minima raggiunta lungo la proiezione (se <0 lo scenario non si autofinanzia). */
  liquiditaMinima?: number;
  /**
   * Plusvalenza latente negli investimenti alla data di pensione: valore
   * composto dei contributi versati entro la pensione meno i contributi stessi.
   * E' l'unica parte del capitale soggetta a tassa sul capital gain (come un
   * ETF: si tassa solo il guadagno, non il capitale versato ne' il liquido).
   */
  guadagniPensione?: number;
  /**
   * Quota del capitale a pensione che e' plusvalenza tassabile
   * (guadagniPensione / capitalePensione). La rendita va tassata solo su questa
   * frazione: il resto (capitale versato, liquido, equity immobiliare) non paga
   * capital gain al prelievo.
   */
  quotaTassabilePensione?: number;
}

const MS_ANNO = 365.25 * 86400000;

function anniTra(da: Date, a: Date): number {
  return (a.getTime() - da.getTime()) / MS_ANNO;
}
function inizioMese(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function chiaveMese(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Contributo {
  data: Date;
  importo: number;
}

/** Elenco dei versamenti di una tranche: capitale iniziale + eventuali versamenti periodici. */
function contributiDi(inv: Investimento): Contributo[] {
  const inizio = new Date(inv.dataInizio + "T00:00:00");
  const fine = new Date(inv.dataFine + "T00:00:00");
  const out: Contributo[] = [{ data: inizio, importo: inv.capitale || 0 }];
  if (inv.versamentoPeriodico && inv.frequenzaMesi) {
    const d = new Date(inizio);
    d.setMonth(d.getMonth() + inv.frequenzaMesi);
    while (d < fine) {
      out.push({ data: new Date(d), importo: inv.versamentoPeriodico });
      d.setMonth(d.getMonth() + inv.frequenzaMesi);
    }
  }
  return out;
}

/** Capitale e guadagni composti di una tranche attiva al tempo t (0 se non attiva). */
function statoInvestimento(
  inv: Investimento,
  contributi: Contributo[],
  t: Date,
  maturita: Date,
): { capitale: number; guadagni: number } {
  const inizio = new Date(inv.dataInizio + "T00:00:00");
  // Attiva finche' non entra nel mese di maturazione (poi e' liquida). Il
  // capitale resta investito e continua a rendere fino alla maturazione, che
  // non avviene mai prima della pensione (vedi calcolaProiezione).
  if (t < inizio || t >= inizioMese(maturita)) return { capitale: 0, guadagni: 0 };
  let capitale = 0;
  let guadagni = 0;
  for (const c of contributi) {
    if (c.data > t) continue;
    capitale += c.importo;
    const anni = anniTra(c.data, t);
    if (anni > 0) guadagni += c.importo * (Math.pow(1 + inv.interesse, anni) - 1);
  }
  return { capitale, guadagni };
}

/** Valore a maturazione di una tranche (capitale + interessi composti fino a `maturita`). */
function valoreMaturato(
  inv: Investimento,
  contributi: Contributo[],
  maturita: Date,
): number {
  let v = 0;
  for (const c of contributi) {
    const anni = anniTra(c.data, maturita);
    v += c.importo * Math.pow(1 + inv.interesse, Math.max(0, anni));
  }
  return v;
}

export function calcolaProiezione(
  transazioni: Transazione[],
  tasse: AnnoTasse[],
  eventi: EventoFuturo[],
  investimenti: Investimento[],
  par: Parametri,
  mutui: Mutuo[] = [],
): ProiezioneRisultato {
  const saldo = calcolaSaldo(transazioni, tasse, par);
  const startIso = saldo.ultimo?.data ?? par.saldoInizialeData;
  const startValore = saldo.ultimo?.potereAcquisto ?? par.saldoInizialeValore ?? 0;
  const startProj = new Date(startIso + "T00:00:00");

  // Capitale gia' trasferito su altri conti/investimenti (giroconti/PAC): non e'
  // nel liquido di partenza (e' gia' uscito dal conto) ma fa parte del
  // patrimonio. Lo portiamo avanti come base di "investito" costante, cosi' non
  // sparisce dalla proiezione. Modellare la sua crescita e' compito delle
  // tranche in "Investimenti".
  const investitoBase = saldo.ultimo?.investito ?? 0;

  const nascita = new Date(par.dataNascita + "T00:00:00");
  const etaPensione = par.etaPensione ?? 67;
  const dataPensione = new Date(nascita);
  dataPensione.setFullYear(nascita.getFullYear() + etaPensione);

  // Precalcolo contributi, deduzioni dal liquido e maturazioni per mese.
  const contributiPer = new Map<string, Contributo[]>();
  const maturitaPer = new Map<string, Date>();
  const deduzioni = new Map<string, number>();
  const maturazioni = new Map<string, number>();
  let orizzonte = new Date(dataPensione);

  for (const inv of investimenti) {
    const contribs = contributiDi(inv);
    contributiPer.set(inv.id, contribs);
    const fine = new Date(inv.dataFine + "T00:00:00");
    // Il capitale non torna mai liquido prima della pensione: la scadenza
    // (dataFine) ferma solo i versamenti del PAC, mentre il capitale resta
    // investito e continua a rendere fino alla pensione (o fino a dataFine se
    // questa e' successiva). Cosi' si "realizza" e si tassa solo alla fine.
    const maturita = fine > dataPensione ? fine : dataPensione;
    maturitaPer.set(inv.id, maturita);
    if (maturita > orizzonte) orizzonte = maturita;
    // Versamenti futuri: escono dal liquido nel loro mese.
    for (const c of contribs) {
      if (c.data >= startProj) {
        const k = chiaveMese(c.data);
        deduzioni.set(k, (deduzioni.get(k) ?? 0) + c.importo);
      }
    }
    // Maturazione: capitale + interessi tornano liquidi nel mese di maturazione.
    const km = chiaveMese(maturita);
    maturazioni.set(
      km,
      (maturazioni.get(km) ?? 0) + valoreMaturato(inv, contribs, maturita),
    );
  }

  const eventiOrd = [...eventi].sort((a, b) =>
    a.dataInizio.localeCompare(b.dataInizio),
  );
  eventiOrd.forEach((e) => {
    const d = new Date((e.dataFine ?? e.dataInizio) + "T00:00:00");
    if (d > orizzonte) orizzonte = d;
  });

  // Assicura che la proiezione copra il mese successivo alla pensione, cosi' il
  // "capitale a pensione" viene sempre registrato anche quando non ci sono
  // eventi futuri che estendono l'orizzonte oltre quella data.
  const dopoPensione = new Date(
    dataPensione.getFullYear(),
    dataPensione.getMonth() + 1,
    1,
  );
  if (dopoPensione > orizzonte) orizzonte = dopoPensione;

  function eventoAttivo(mese: Date): EventoFuturo | undefined {
    let att: EventoFuturo | undefined;
    for (const e of eventiOrd) {
      if (new Date(e.dataInizio + "T00:00:00") <= mese) att = e;
      else break;
    }
    return att;
  }

  const punti: PuntoProiezione[] = [];
  let liquido = startValore;
  let liquiditaMinima = liquido;
  let capitalePensione: number | undefined;
  let pensioneRegistrata = false;

  const cursore = inizioMese(startProj);
  cursore.setMonth(cursore.getMonth() + 1);

  while (cursore <= orizzonte) {
    const k = chiaveMese(cursore);

    // Risparmio mensile dello scenario attivo.
    const ev = eventoAttivo(cursore);
    if (ev) {
      const netto = (ev.fatturatoMensile ?? 0) * (1 - (ev.aliquota ?? 0));
      liquido += netto - (ev.spesaMensile ?? 0);
    }
    // Spese grosse del mese.
    for (const e of eventiOrd) {
      if (!e.spesaGrossa) continue;
      const d = new Date(e.dataInizio + "T00:00:00");
      if (d.getFullYear() === cursore.getFullYear() && d.getMonth() === cursore.getMonth())
        liquido -= e.spesaGrossa;
    }
    // Flussi verso/da investimenti.
    liquido -= deduzioni.get(k) ?? 0;
    liquido += maturazioni.get(k) ?? 0;

    // Stock investito e guadagni.
    let investito = investitoBase;
    let guadagni = 0;
    for (const inv of investimenti) {
      const s = statoInvestimento(
        inv,
        contributiPer.get(inv.id)!,
        cursore,
        maturitaPer.get(inv.id)!,
      );
      investito += s.capitale;
      guadagni += s.guadagni;
    }

    if (liquido < liquiditaMinima) liquiditaMinima = liquido;

    // Equity immobiliare dei mutui (anticipo + capitale rimborsato). La rata
    // e' un flusso di cassa che deve stare nelle spese mensili degli scenari:
    // qui si aggiunge solo lo stock di capitale che si accumula.
    const immobile = mutui.length > 0 ? equityImmobili(mutui, k) : 0;

    const totale = liquido + investito + guadagni + immobile;

    punti.push({
      data: `${k}-01`,
      eta: Math.round(anniTra(nascita, cursore) * 10) / 10,
      liquido: Math.round(liquido),
      investito: Math.round(investito),
      guadagni: Math.round(guadagni),
      immobile: Math.round(immobile),
      totale: Math.round(totale),
    });

    if (!pensioneRegistrata && cursore >= dataPensione) {
      capitalePensione = totale;
      pensioneRegistrata = true;
    }
    cursore.setMonth(cursore.getMonth() + 1);
  }

  const tassoRendita = par.tassoRendita ?? 0.035;
  const renditaAnnua =
    capitalePensione !== undefined ? capitalePensione * tassoRendita : undefined;

  // Plusvalenza latente a pensione: per ogni tranche, il valore composto dei
  // contributi versati entro la pensione meno i contributi stessi. E' la sola
  // parte tassabile al prelievo (capital gain). Il capitale gia' investito
  // prima della proiezione (investitoBase) e' portato avanti "piatto", quindi
  // la sua eventuale crescita va modellata come tranche: qui non genera
  // plusvalenza (scelta conservativa: meno tasse stimate, non di piu').
  let guadagniPensione = 0;
  for (const inv of investimenti) {
    const contribs = contributiPer.get(inv.id)!;
    for (const c of contribs) {
      if (c.data > dataPensione) continue;
      const anni = Math.max(0, anniTra(c.data, dataPensione));
      guadagniPensione += c.importo * (Math.pow(1 + inv.interesse, anni) - 1);
    }
  }
  const quotaTassabilePensione =
    capitalePensione && capitalePensione > 0
      ? Math.min(1, Math.max(0, guadagniPensione / capitalePensione))
      : 0;

  return {
    punti,
    patrimonioOggi: punti[0]?.totale,
    capitalePensione,
    dataPensione: `${dataPensione.getFullYear()}-${String(dataPensione.getMonth() + 1).padStart(2, "0")}-01`,
    renditaAnnua,
    renditaMensile: renditaAnnua !== undefined ? renditaAnnua / 12 : undefined,
    liquiditaMinima,
    guadagniPensione,
    quotaTassabilePensione,
  };
}

/** Riduce i punti mensili per il grafico (uno ogni `passo` mesi, ultimo incluso). */
export function campionaMesi(
  punti: PuntoProiezione[],
  passo = 3,
): PuntoProiezione[] {
  if (punti.length <= passo) return punti;
  const out: PuntoProiezione[] = [];
  for (let i = 0; i < punti.length; i += passo) out.push(punti[i]);
  const ultimo = punti[punti.length - 1];
  if (out[out.length - 1]?.data !== ultimo.data) out.push(ultimo);
  return out;
}
