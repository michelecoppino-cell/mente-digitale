// Stima delle tasse maturate in un periodo, spalmando il totale annuo
// dichiarato (pannello "Tasse") giorno per giorno invece di usare i
// pagamenti reali: quelli sono spesso concentrati in poche rate irregolari
// e non riflettono quanto "costano" le tasse in un intervallo qualsiasi.

import { AllocazioneTasse, AnnoTasse, Transazione } from "../types";

/** Totale tasse dichiarato per l'anno: importi reali se presenti, altrimenti stima da fatturato x aliquota. */
export function stimaAnnoTasse(t: AnnoTasse): number {
  const totale = (t.inarcassa ?? 0) + (t.irpef ?? 0) + (t.aggiuntivi ?? 0);
  if (totale > 0) return totale;
  if (t.fatturato && t.tassazione) return t.fatturato * t.tassazione;
  return 0;
}

function annoBisestile(anno: number): boolean {
  return (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0;
}

function giorniAnno(anno: number): number {
  return annoBisestile(anno) ? 366 : 365;
}

/** Numero del giorno nell'anno (1 = 1 gennaio) di una data ISO yyyy-mm-dd. */
function giornoDelAnno(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const inizio = new Date(y, 0, 1);
  const data = new Date(y, m - 1, d);
  return Math.floor((data.getTime() - inizio.getTime()) / 86400000) + 1;
}

/**
 * Quota dell'anno effettivamente trascorsa alla data `asOf` (ISO yyyy-mm-dd):
 * 1 per gli anni già conclusi, 0 per quelli futuri, giorni-trascorsi /
 * giorni-anno per l'anno in corso. Usa i giorni reali dell'anno (366 se
 * bisestile), così le tasse maturano sul calendario esatto.
 */
export function frazioneTrascorsa(anno: number, asOfISO: string): number {
  const annoOggi = Number(asOfISO.slice(0, 4));
  if (anno < annoOggi) return 1;
  if (anno > annoOggi) return 0;
  return Math.min(1, giornoDelAnno(asOfISO) / giorniAnno(anno));
}

/**
 * Ripartizione di un movimento tasse tra Inarcassa/Imposta e anno di
 * competenza. Se non ancora compilata, una riga sola sull'anno della data del
 * movimento, con importi da compilare (quindi pagato = 0 finché non si allocano).
 */
export function allocazioneDi(t: Transazione): AllocazioneTasse[] {
  return t.allocazioneTasse && t.allocazioneTasse.length > 0
    ? t.allocazioneTasse
    : [{ anno: Number(t.data.slice(0, 4)) }];
}

/** Riga del confronto "previsto vs pagato" per un anno, a una certa data. */
export interface ConfrontoAnnoTasse {
  anno: number;
  previstoInarcassa: number;
  pagatoInarcassa: number;
  previstoImposta: number;
  pagatoImposta: number;
  previstoTotale: number;
  pagatoTotale: number;
  /** Quota dell'anno maturata alla data (1 per gli anni passati). */
  frazione: number;
  inarcassaChiuso: boolean;
  impostaChiuso: boolean;
  daVersareInarcassa: number;
  daVersareImposta: number;
  daVersareTotale: number;
  note: string;
}

/**
 * Confronto "previsto vs pagato" per anno, alla data `asOf` (ISO). È l'UNICA
 * fonte del "manca da pagare": la usano sia la scheda Tasse sia il motore del
 * saldo, così i due numeri coincidono per costruzione.
 *
 * - previsto = Inarcassa (contributo) e Imposta (IRPEF + aggiuntivi, es.
 *   cedolare secca) dichiarate per l'anno (`righe`, già fuse con le fatture da
 *   `tasseConFatture`);
 * - pagato = ripartizione Inarcassa/Imposta dei movimenti "tasse" con data ≤
 *   asOf (solo la parte effettivamente allocata: un eventuale residuo non conta);
 * - "da versare" = quota maturata a oggi (previsto × frazione) − pagato,
 *   AZZERATA per le voci segnate "Chiuso" (Inarcassa e/o Imposta).
 */
export function confrontoTasse(
  righe: AnnoTasse[],
  transazioni: Transazione[],
  asOfISO: string,
): ConfrontoAnnoTasse[] {
  // Pagato per anno = somma delle ripartizioni dei movimenti tasse fino a asOf.
  const pagatoPerAnno = new Map<number, { inarcassa: number; imposta: number }>();
  for (const t of transazioni) {
    if (!t.tasse || t.annullata || t.data > asOfISO) continue;
    for (const a of allocazioneDi(t)) {
      if (!a.anno) continue;
      const riga = pagatoPerAnno.get(a.anno) ?? { inarcassa: 0, imposta: 0 };
      riga.inarcassa += a.inarcassa ?? 0;
      riga.imposta += a.imposta ?? 0;
      pagatoPerAnno.set(a.anno, riga);
    }
  }

  const anni = new Set<number>([...righe.map((t) => t.anno), ...pagatoPerAnno.keys()]);
  return [...anni].sort((a, b) => a - b).map((anno) => {
    const dich = righe.find((t) => t.anno === anno);
    const previstoInarcassa = dich?.inarcassa ?? 0;
    // "Imposta" = IRPEF/imposta sostitutiva + aggiuntivi (es. cedolare secca
    // sull'affitto): sono imposte reali che maturano pro-quota come il resto e
    // si versano/allocano insieme nell'F24, quindi entrano nella stessa voce.
    const previstoImposta = (dich?.irpef ?? 0) + (dich?.aggiuntivi ?? 0);
    const pag = pagatoPerAnno.get(anno) ?? { inarcassa: 0, imposta: 0 };
    const frazione = frazioneTrascorsa(anno, asOfISO);
    const inarcassaChiuso = dich?.inarcassaChiuso ?? false;
    const impostaChiuso = dich?.impostaChiuso ?? false;
    // "Chiuso" congela il residuo a zero: l'anno è considerato saldato per
    // quella voce, a prescindere dal calcolo grezzo (maturato − pagato).
    const daVersareInarcassa = inarcassaChiuso
      ? 0
      : previstoInarcassa * frazione - pag.inarcassa;
    const daVersareImposta = impostaChiuso
      ? 0
      : previstoImposta * frazione - pag.imposta;
    return {
      anno,
      previstoInarcassa,
      pagatoInarcassa: pag.inarcassa,
      previstoImposta,
      pagatoImposta: pag.imposta,
      previstoTotale: previstoInarcassa + previstoImposta,
      pagatoTotale: pag.inarcassa + pag.imposta,
      frazione,
      inarcassaChiuso,
      impostaChiuso,
      daVersareInarcassa,
      daVersareImposta,
      daVersareTotale: daVersareInarcassa + daVersareImposta,
      note: dich?.note ?? "",
    };
  });
}

/** Giorno precedente a una data ISO yyyy-mm-dd. */
function giornoPrima(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Tasse maturate stimate dall'inizio dei tempi fino al giorno incluso: gli
 * anni precedenti a quello del giorno contano per intero, quello del giorno
 * per la quota-parte dei giorni gia' trascorsi.
 */
function tasseMaturateAl(tasse: AnnoTasse[], iso: string): number {
  const anno = Number(iso.slice(0, 4));
  let tot = 0;
  for (const t of tasse) {
    if (!t.anno) continue;
    if (t.anno > anno) continue;
    const stima = stimaAnnoTasse(t);
    if (t.anno < anno) tot += stima;
    else tot += (stima * giornoDelAnno(iso)) / giorniAnno(t.anno);
  }
  return tot;
}

/** Tasse stimate maturate nell'intervallo [daISO, aISO] (entrambi inclusi). */
export function tasseStimatePeriodo(
  tasse: AnnoTasse[],
  daISO: string,
  aISO: string,
): number {
  return tasseMaturateAl(tasse, aISO) - tasseMaturateAl(tasse, giornoPrima(daISO));
}
