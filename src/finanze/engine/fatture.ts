// Calcolo fiscale del regime forfettario a partire dalle fatture emesse.
// Replica, senza formule fragili, i fogli annuali "ELENCO FATTURE" dell'Excel:
// da ogni fattura si ricavano netto, bollo, contributo integrativo Inarcassa e
// totale; sommando l'anno si ottengono imponibile, imposta sostitutiva e
// Inarcassa (soggettivo + integrativo + maternità). Questi tre valori
// (fatturato, imposta, inarcassa) sono gli stessi che la scheda "Tasse"
// usava digitati a mano: qui vengono calcolati e riusati, senza duplicazioni.

import { AnnoTasse, Fattura } from "../types";

// ---------- Parametri del regime forfettario (ingegnere, ATECO 74.90.93) ----------
/** Coefficiente di redditività ATECO: quota del volume d'affari che fa imponibile. */
export const COEFF_ATECO = 0.78;
/** Aliquota dell'imposta sostitutiva (15%; 5% i primi 5 anni, ma qui è a regime). */
export const ALIQUOTA_IMPOSTA = 0.15;
/** Contributo integrativo Inarcassa: 4% su (netto + bollo), riaddebitato al cliente. */
export const ALIQUOTA_INTEGRATIVO = 0.04;
/** Aliquota base del contributo soggettivo Inarcassa (×2 = 14,5% pieno, ×1 = 7,25% ridotto). */
export const ALIQUOTA_SOGGETTIVO = 0.0725;
/**
 * Contributo soggettivo minimo annuo. Inarcassa lo rivaluta ogni anno (es.
 * 2026: 2.785€): questa costante è un valore fisso unico per tutti gli anni,
 * quindi è un'approssimazione — non modella la crescita storica del minimo
 * anno per anno. Non alzarla al valore corrente senza gestire i minimi
 * per-anno, altrimenti si "riscrivono" (in alto) gli importi storici reali
 * delle fatture già chiuse.
 */
export const MIN_SOGGETTIVO = 780;
/** Contributo integrativo minimo annuo. Stessa avvertenza di MIN_SOGGETTIVO. */
export const MIN_INTEGRATIVO = 231.5;
/** Contributo maternità di default. */
export const MATERNITA_DEFAULT = 72;
/** Marca da bollo e soglia oltre la quale è dovuta. */
export const BOLLO = 2;
export const BOLLO_SOGLIA = 77.47;

// ---------- Calcoli per singola fattura ----------

/** Giorni effettivamente lavorati: giorni lavorativi del mese − ferie/malattia
 * + giorni extra + giorni spostati dal mese precedente. Mai negativo. */
export function giorniEffettiviFattura(f: Fattura): number {
  const g = (f.giorni ?? 0) - (f.ferie ?? 0) + (f.extra ?? 0) + (f.spostati ?? 0);
  return Math.max(0, g);
}

/** Netto imponibile: calcolato dalle giornate se richiesto, altrimenti il valore digitato. */
export function nettoFattura(f: Fattura): number {
  if (f.daGiornate) {
    return giorniEffettiviFattura(f) * (f.prezzoGiorno ?? 0);
  }
  return f.netto ?? 0;
}

/** Marca da bollo effettiva: quella indicata, o il default per soglia. */
export function bolloFattura(f: Fattura): number {
  if (f.bollo !== undefined) return f.bollo;
  return nettoFattura(f) > BOLLO_SOGLIA ? BOLLO : 0;
}

/** Contributo integrativo Inarcassa 4% su (netto + bollo); zero se estero. */
export function integrativoFattura(f: Fattura): number {
  if (f.estero) return 0;
  return ALIQUOTA_INTEGRATIVO * (nettoFattura(f) + bolloFattura(f));
}

/** Totale incassato dalla fattura: netto + IVA + integrativo + bollo. */
export function totaleFattura(f: Fattura): number {
  return nettoFattura(f) + (f.iva ?? 0) + integrativoFattura(f) + bolloFattura(f);
}

// ---------- Calcolo annuo ----------

export interface CalcoloAnno {
  anno: number;
  /** Numero di fatture (reali + stimate). */
  numFatture: number;
  /** Σ netto di tutte le fatture dell'anno. */
  fatturato: number;
  /** Σ netto delle sole fatture realmente emesse. */
  fatturatoReale: number;
  /** Σ netto delle sole fatture stimate. */
  fatturatoStimato: number;
  /** Σ bolli. */
  bolli: number;
  /** Σ contributo integrativo grezzo (prima del minimo). */
  integrativoGrezzo: number;
  /** Volume d'affari = fatturato + bolli. */
  volumeAffari: number;
  /** Imponibile = coeff. ATECO × volume d'affari. */
  imponibile: number;
  /** Contributo soggettivo Inarcassa. */
  soggettivo: number;
  /** Contributo integrativo Inarcassa (col minimo applicato). */
  integrativo: number;
  /** Contributo maternità. */
  maternita: number;
  /** Totale Inarcassa (soggettivo + integrativo + maternità). */
  inarcassa: number;
  /** Imposta sostitutiva = 15% × (imponibile − Inarcassa). */
  imposta: number;
  /** Totale incassato (Σ totale fatture). */
  incassato: number;
  /** Netto in tasca = incassato − imposta − Inarcassa. */
  nettoTotale: number;
  /** Aliquota media sul fatturato (imposta + soggettivo + maternità)/fatturato. */
  aliquotaMedia: number;
  /** Netto mensile su 12 e su 13 mensilità. */
  nettoMensile12: number;
  nettoMensile13: number;
  /** Se l'anno è in regime Inarcassa ridotto. */
  ridotta: boolean;
}

/**
 * Calcola il quadro fiscale dell'anno dalle sue fatture. `cfg` porta le due
 * variabili storiche (regime ridotto Inarcassa e importo maternità): di norma
 * arrivano dal record AnnoTasse dello stesso anno.
 */
export function calcolaAnno(
  anno: number,
  fatture: Fattura[],
  cfg?: { ridotta?: boolean; maternita?: number },
): CalcoloAnno {
  const dellAnno = fatture.filter((f) => f.anno === anno);
  let fatturato = 0;
  let fatturatoReale = 0;
  let fatturatoStimato = 0;
  let bolli = 0;
  let integrativoGrezzo = 0;
  let incassato = 0;
  for (const f of dellAnno) {
    const netto = nettoFattura(f);
    fatturato += netto;
    if (f.stimata) fatturatoStimato += netto;
    else fatturatoReale += netto;
    bolli += bolloFattura(f);
    integrativoGrezzo += integrativoFattura(f);
    incassato += totaleFattura(f);
  }

  const volumeAffari = fatturato + bolli;
  const imponibile = COEFF_ATECO * volumeAffari;
  const ridotta = cfg?.ridotta ?? false;
  const soggettivo =
    Math.max(MIN_SOGGETTIVO, ALIQUOTA_SOGGETTIVO * imponibile) * (ridotta ? 1 : 2);
  const integrativo = Math.max(MIN_INTEGRATIVO, integrativoGrezzo);
  const maternita = cfg?.maternita ?? MATERNITA_DEFAULT;
  const inarcassa = soggettivo + integrativo + maternita;
  const imposta = Math.max(0, ALIQUOTA_IMPOSTA * (imponibile - inarcassa));
  const nettoTotale = incassato - imposta - inarcassa;
  const aliquotaMedia = fatturato > 0 ? (imposta + soggettivo + maternita) / fatturato : 0;
  const nettoMensile12 = nettoTotale / 12;

  return {
    anno,
    numFatture: dellAnno.length,
    fatturato,
    fatturatoReale,
    fatturatoStimato,
    bolli,
    integrativoGrezzo,
    volumeAffari,
    imponibile,
    soggettivo,
    integrativo,
    maternita,
    inarcassa,
    imposta,
    incassato,
    nettoTotale,
    aliquotaMedia,
    nettoMensile12,
    nettoMensile13: (nettoMensile12 * 12) / 13,
    ridotta,
  };
}

/** Anni distinti presenti nelle fatture, dal più recente al meno recente. */
export function anniConFatture(fatture: Fattura[]): number[] {
  const anni = new Set<number>();
  for (const f of fatture) anni.add(f.anno);
  return [...anni].sort((a, b) => b - a);
}

/**
 * Fonde i valori calcolati dalle fatture dentro l'elenco AnnoTasse. Regola
 * importante: le fatture **riempiono solo i campi lasciati vuoti** in Tasse,
 * senza mai sovrascrivere un valore reale già dichiarato. Così gli anni chiusi
 * (con concordato, crediti, conguagli ecc.) mantengono i numeri veri inseriti a
 * mano, mentre gli anni/campi ancora vuoti prendono la stima dalle fatture. La
 * scheda Fatture mostra comunque sempre il calcolo "vivo" dalle fatture.
 *
 * Restano toccati solo gli anni con fatture; gli altri passano invariati.
 */
export function tasseConFatture(tasse: AnnoTasse[], fatture?: Fattura[]): AnnoTasse[] {
  if (!fatture || fatture.length === 0) return tasse;
  const perAnno = new Map<number, AnnoTasse>();
  for (const t of tasse) perAnno.set(t.anno, { ...t });

  for (const anno of anniConFatture(fatture)) {
    const base = perAnno.get(anno) ?? { anno };
    const c = calcolaAnno(anno, fatture, {
      ridotta: base.inarcassaRidotta,
      maternita: base.maternita,
    });
    // Coerenza con l'Analisi complessiva (vedi analisiComplessiva): il valore
    // reale dichiarato vince SOLO se l'anno è "chiuso" per quella voce
    // (inarcassaChiuso / impostaChiuso). Altrimenti si usa sempre il calcolo
    // "vivo" dalle fatture, così un anno non chiuso non resta ancorato a una
    // vecchia stima digitata a mano (che diventa obsoleta appena cambiano le
    // fatture) e Tasse/Saldo mostrano gli stessi numeri della scheda Fatture.
    // Il fatturato dichiarato è spesso più completo della somma delle fatture
    // registrate (arrotondamenti, righe non inserite): vale come reale quando
    // l'anno è chiuso su almeno una voce, cioè i suoi numeri sono ormai fissati.
    const chiuso = !!(base.inarcassaChiuso || base.impostaChiuso);
    perAnno.set(anno, {
      ...base,
      inarcassa:
        base.inarcassaChiuso && base.inarcassa !== undefined ? base.inarcassa : c.inarcassa,
      irpef: base.impostaChiuso && base.irpef !== undefined ? base.irpef : c.imposta,
      fatturato: chiuso && base.fatturato !== undefined ? base.fatturato : c.fatturato,
    });
  }
  return [...perAnno.values()].sort((a, b) => a.anno - b.anno);
}

/** Vero se l'anno indicato ha almeno una fattura (quindi le tasse sono calcolate). */
export function annoHaFatture(anno: number, fatture?: Fattura[]): boolean {
  return !!fatture && fatture.some((f) => f.anno === anno);
}

/** Una riga dell'Analisi complessiva (lavoro anno per anno). */
export interface RigaAnalisi {
  anno: number;
  /** L'anno ha fatture registrate (valori calcolati) o è tutto manuale. */
  haFatture: boolean;
  fatturato: number;
  fatturatoStimato: number;
  incassato: number;
  /** Inarcassa usata (reale se l'anno è "chiuso" in Tasse, altrimenti stimata). */
  inarcassa: number;
  imposta: number;
  /** L'Inarcassa mostrata viene dal valore reale dichiarato (anno chiuso). */
  inarcassaDaChiuso: boolean;
  impostaDaChiuso: boolean;
  /** Il fatturato mostrato viene dal valore reale dichiarato (anno chiuso). */
  fatturatoDaChiuso: boolean;
  nettoInTasca: number;
  entrateExtra: number;
  spese: number;
  nettoMensile12: number;
  nettoMensile13: number;
}

/**
 * Costruisce l'Analisi complessiva su tutti gli anni: quelli con fatture usano
 * i valori calcolati; quelli senza (anni manuali/ipotetici, es. 2020) usano i
 * valori digitati nel record AnnoTasse. Se un anno è marcato "chiuso" nella
 * scheda Tasse (Inarcassa e/o Imposta), si usa il valore REALE dichiarato al
 * posto della stima dalle fatture. Il netto/mese somma le entrate extra (non
 * tassate) e sottrae le spese.
 */
export function analisiComplessiva(
  tasse: AnnoTasse[],
  fatture?: Fattura[],
): RigaAnalisi[] {
  const anni = new Set<number>();
  for (const t of tasse) anni.add(t.anno);
  for (const f of fatture ?? []) anni.add(f.anno);
  const byAnno = new Map(tasse.map((t) => [t.anno, t]));

  const rows: RigaAnalisi[] = [];
  for (const anno of [...anni].sort((a, b) => a - b)) {
    const t = byAnno.get(anno);
    const ha = annoHaFatture(anno, fatture);
    let fatturato = 0;
    let fatturatoStimato = 0;
    let incassato = 0;
    let inarcassaCalc = 0;
    let impostaCalc = 0;
    if (ha) {
      const c = calcolaAnno(anno, fatture!, {
        ridotta: t?.inarcassaRidotta,
        maternita: t?.maternita,
      });
      fatturato = c.fatturato;
      fatturatoStimato = c.fatturatoStimato;
      incassato = c.incassato;
      inarcassaCalc = c.inarcassa;
      impostaCalc = c.imposta;
    } else {
      fatturato = t?.fatturato ?? 0;
      incassato = t?.fatturato ?? 0;
      inarcassaCalc = t?.inarcassa ?? 0;
      impostaCalc = t?.irpef ?? 0;
    }
    // "Chiuso" in Tasse: il valore reale dichiarato vince sulla stima.
    const inarcassaDaChiuso = ha && !!t?.inarcassaChiuso && t?.inarcassa !== undefined;
    const impostaDaChiuso = ha && !!t?.impostaChiuso && t?.irpef !== undefined;
    const inarcassa = inarcassaDaChiuso ? t!.inarcassa! : inarcassaCalc;
    const imposta = impostaDaChiuso ? t!.irpef! : impostaCalc;
    // Il fatturato dichiarato (spesso più completo della somma delle fatture)
    // vince quando l'anno è chiuso su almeno una voce: stessa regola di
    // tasseConFatture, così scheda Fatture e scheda Tasse mostrano lo stesso
    // fatturato sia negli anni chiusi sia in quelli ancora aperti.
    const fatturatoDaChiuso =
      ha && !!(t?.inarcassaChiuso || t?.impostaChiuso) && t?.fatturato !== undefined;
    if (fatturatoDaChiuso) fatturato = t!.fatturato!;
    const nettoInTasca = incassato - inarcassa - imposta;
    const entrateExtra = t?.entrateExtra ?? 0;
    const spese = t?.spese ?? 0;
    const nettoMensile12 = (nettoInTasca + entrateExtra - spese) / 12;
    rows.push({
      anno,
      haFatture: ha,
      fatturato,
      fatturatoStimato,
      incassato,
      inarcassa,
      imposta,
      inarcassaDaChiuso,
      impostaDaChiuso,
      fatturatoDaChiuso,
      nettoInTasca,
      entrateExtra,
      spese,
      nettoMensile12,
      nettoMensile13: (nettoMensile12 * 12) / 13,
    });
  }
  return rows;
}

/**
 * Per un anno, dice quali campi fiscali sono stati **calcolati dalle fatture**
 * (perché lasciati vuoti in Tasse) e quali sono valori reali dichiarati a mano.
 * Serve alla scheda Tasse per mostrare in sola-lettura solo i campi derivati.
 */
export function campiDaFatture(
  raw: AnnoTasse | undefined,
  anno: number,
  fatture?: Fattura[],
): { inarcassa: boolean; irpef: boolean; fatturato: boolean } {
  const ha = annoHaFatture(anno, fatture);
  return {
    // Una voce è "calcolata dalle fatture" (cella grigia, sola lettura) quando
    // l'anno ha fatture e NON è chiuso per quella voce: stessa regola di
    // precedenza di tasseConFatture. Se l'anno è chiuso, in cella resta il
    // valore reale dichiarato (modificabile), non la stima calcolata.
    inarcassa: ha && !raw?.inarcassaChiuso,
    irpef: ha && !raw?.impostaChiuso,
    // Il fatturato è "reale" (dichiarato, modificabile) solo quando l'anno è
    // chiuso; altrimenti mostra il calcolo dalle fatture (grigio, sola lettura).
    fatturato: ha && !(raw?.inarcassaChiuso || raw?.impostaChiuso),
  };
}
