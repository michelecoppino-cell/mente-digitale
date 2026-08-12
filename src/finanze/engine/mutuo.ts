// Motore del mutuo: piano di ammortamento alla francese (rata costante).
// Serve a trattare il mutuo da investimento e non da spesa: di ogni rata,
// la quota capitale rimborsa il debito e diventa equity dell'immobile
// (patrimonio), mentre la quota interessi e' il costo vero del finanziamento.
//
//   rata          = C * i / (1 - (1+i)^-n)      con i = TAN/12, n = durata mesi
//   interessi(k)  = debito residuo prima della rata k * i
//   capitale(k)   = rata - interessi(k)
//   equity        = anticipo + capitale rimborsato cumulato

import { Mutuo } from "../types";

/** Rata mensile costante del piano francese. */
export function rataMensile(m: Mutuo): number {
  if (!m.importo || !m.durataMesi || m.durataMesi <= 0) return 0;
  const i = (m.tasso ?? 0) / 12;
  if (i === 0) return m.importo / m.durataMesi;
  return (m.importo * i) / (1 - Math.pow(1 + i, -m.durataMesi));
}

export interface StatoMutuo {
  rata: number;
  /** Rate gia' scadute entro il mese richiesto (0..durataMesi). */
  rateVersate: number;
  capitaleRimborsato: number;
  interessiPagati: number;
  debitoResiduo: number;
  /** Equity dell'immobile: anticipo + capitale rimborsato. */
  equity: number;
  estinto: boolean;
}

/** Numero di rate scadute entro il mese `annoMese` (la prima cade nel mese di dataInizio). */
function rateEntro(m: Mutuo, annoMese: string): number {
  const [y0, m0] = m.dataInizio.slice(0, 7).split("-").map(Number);
  const [y, mm] = annoMese.split("-").map(Number);
  if (!y0 || !m0 || !y || !mm) return 0;
  const n = (y - y0) * 12 + (mm - m0) + 1;
  return Math.max(0, Math.min(m.durataMesi, n));
}

/**
 * `quando` precede l'acquisto? Se e' un mese soltanto ("yyyy-mm", il caso
 * della proiezione futura mese-per-mese) confrontiamo per mese. Se e' una
 * data completa (yyyy-mm-dd, il caso del saldo storico giorno-per-giorno)
 * confrontiamo il giorno esatto: altrimenti, per i giorni tra l'inizio del
 * mese e il giorno reale di acquisto, si conterebbero insieme sia il
 * contante ancora sul conto sia l'equity dell'immobile (doppio conteggio).
 */
function primaDellAcquisto(quando: string, m: Mutuo): boolean {
  if (quando.length <= 7) return quando < m.dataInizio.slice(0, 7);
  return quando < m.dataInizio;
}

/** Stato del mutuo a fine del mese/giorno indicato (accetta "yyyy-mm" o una data ISO). */
export function statoMutuo(m: Mutuo, quando: string): StatoMutuo {
  const rata = rataMensile(m);
  // Prima dell'acquisto l'immobile non e' ancora nel patrimonio: ne'
  // l'anticipo ne' il capitale rimborsato contano come equity.
  if (primaDellAcquisto(quando, m)) {
    return {
      rata,
      rateVersate: 0,
      capitaleRimborsato: 0,
      interessiPagati: 0,
      debitoResiduo: m.importo,
      equity: 0,
      estinto: false,
    };
  }
  const n = rateEntro(m, quando.slice(0, 7));
  const i = (m.tasso ?? 0) / 12;
  let debito = m.importo;
  let capitale = 0;
  let interessi = 0;
  for (let k = 0; k < n; k++) {
    const qi = debito * i;
    const qc = Math.min(rata - qi, debito);
    debito -= qc;
    capitale += qc;
    interessi += qi;
  }
  return {
    rata,
    rateVersate: n,
    capitaleRimborsato: capitale,
    interessiPagati: interessi,
    debitoResiduo: debito,
    equity: (m.anticipo ?? 0) + capitale,
    estinto: n >= m.durataMesi,
  };
}

/** Quota interessi della rata che scade nel mese indicato (0 se fuori piano). */
export function interessiDelMese(m: Mutuo, annoMese: string): number {
  const n = rateEntro(m, annoMese);
  if (n <= 0) return 0;
  // Debito residuo dopo n-1 rate, poi interessi della n-esima.
  const rata = rataMensile(m);
  const i = (m.tasso ?? 0) / 12;
  let debito = m.importo;
  for (let k = 0; k < n - 1; k++) {
    debito -= Math.min(rata - debito * i, debito);
  }
  return debito * i;
}

/** Equity complessiva di tutti i mutui alla data/mese indicati. */
export function equityImmobili(mutui: Mutuo[], quando: string): number {
  let tot = 0;
  for (const m of mutui) tot += statoMutuo(m, quando).equity;
  return tot;
}
