// Stima GREZZA e puramente informativa della pensione pubblica Inarcassa
// (previdenza obbligatoria degli ingegneri) col metodo contributivo. Serve solo
// a dare un ORDINE DI GRANDEZZA di quanto verra' dalla cassa, da affiancare —
// non da sommare ciecamente — alla rendita integrativa costruita col capitale.
//
//   montante  = per ogni anno (passato dalle fatture, futuro dagli scenari)
//               contributo soggettivo (aliquota PIENA, vedi sotto) + 50% del
//               contributo integrativo, capitalizzato fino a pensione al tasso
//               di rivalutazione REALE di Inarcassa (vedi sotto).
//   pensione  = montante × coefficiente di trasformazione (dipende dall'eta'
//               di pensionamento; parametro editabile, default ~5,5%).
//
// Regime ridotto (7,25% invece di 14,5%, primi anni di attivita'): riduce SOLO
// il versamento in cassa. Inarcassa accredita la differenza come "contributo
// figurativo", quindi il montante si costruisce sempre all'aliquota PIENA
// indipendentemente dal regime realmente applicato quell'anno (verificato su
// un estratto conto/simulazione reale: gli anni a regime ridotto mostrano un
// "Figurativo Soggettivo" che raddoppia esattamente il versato, riportandolo
// alla piena aliquota). Qui si ignora percio' il flag storico "ridotta".
//
// Contributo integrativo (4% in fattura): dal 2013 una quota-parte confluisce
// nel montante individuale ("retrocessione"), il resto finanzia la cassa. La
// quota e' inversamente proporzionale all'anzianita' al 31/12/2012: per chi
// (come chi usa quest'app, tipicamente) non era ancora iscritto a quella data
// la quota e' il 50%, che qui si usa come default fisso.
//
// Rivalutazione: il montante NON matura interessi in senso classico, ma si
// rivaluta ogni anno in base alla media mobile quinquennale del PIL nominale
// italiano — storicamente inferiore all'inflazione. Da una simulazione
// ufficiale Inarcassa On Line si ricava un tasso NOMINALE implicito di
// ~0,66%/anno per i decenni futuri: molto piu' basso dell'inflazione attesa,
// quindi in termini REALI (le uniche unita' di misura usate in quest'app) il
// montante perde potere d'acquisto anno dopo anno in attesa della pensione —
// l'opposto degli Investimenti dell'app, che girano gia' a tasso reale
// positivo. E' una differenza strutturale reale, non un'approssimazione da
// correggere: e' cosi' che funziona il sistema contributivo.
//
// ATTENZIONE: il sistema previdenziale puo' cambiare (aliquote, coefficienti,
// eta', rivalutazione, sostenibilita' della cassa). Questa e' una stima
// grezza, da prendere con le pinze e NON come entrata garantita.

import { EventoFuturo, Fattura, Parametri } from "../types";
import {
  anniConFatture,
  calcolaAnno,
  COEFF_ATECO,
  ALIQUOTA_SOGGETTIVO,
  MIN_SOGGETTIVO,
  ALIQUOTA_INTEGRATIVO,
  MIN_INTEGRATIVO,
} from "./fatture";

export interface StimaInarcassa {
  /** Montante contributivo REALE (potere d'acquisto di oggi) a pensione. */
  montante: number;
  /** Anni di contribuzione considerati (passati + proiettati). */
  anniContribuzione: number;
  /** Anno stimato di pensionamento (nascita + eta' pensione). */
  annoPensione: number;
  /** Coefficiente di trasformazione applicato. */
  coeff: number;
  /** Pensione annua stimata (lorda). */
  pensioneAnnua: number;
  /** Pensione mensile su 13 mensilita'. */
  pensioneMensile: number;
  /** Tasso di rivalutazione REALE annuo usato per capitalizzare il montante (tipicamente negativo). */
  rivalutazioneReale: number;
}

/** Coefficiente di trasformazione di default (indicativo, eta' ~67-70). */
export const COEFF_TRASFORMAZIONE_DEFAULT = 0.055;

/** Quota del contributo integrativo che confluisce nel montante individuale
 * (retrocessione) per chi non aveva anzianita' Inarcassa al 31/12/2012. */
const RETROCESSIONE_INTEGRATIVO = 0.5;

/** Rivalutazione NOMINALE annua stimata del montante (media mobile PIL, da
 * una simulazione ufficiale Inarcassa On Line). */
const RIVALUTAZIONE_NOMINALE_INARCASSA = 0.0066;

/** Contributo (soggettivo pieno + quota integrativa) dell'anno dato un fatturato ipotizzato. */
function contributoAnno(fatturato: number): number {
  const imponibile = COEFF_ATECO * fatturato;
  const soggettivo = Math.max(MIN_SOGGETTIVO, ALIQUOTA_SOGGETTIVO * 2 * imponibile);
  const integrativo = Math.max(MIN_INTEGRATIVO, ALIQUOTA_INTEGRATIVO * fatturato);
  return soggettivo + RETROCESSIONE_INTEGRATIVO * integrativo;
}

/** Fatturato annuo (fatturatoMensile x 12) dello scenario attivo a meta' anno, se presente. */
function fatturatoScenario(eventi: EventoFuturo[], anno: number): number | undefined {
  const meta = `${anno}-07-01`;
  let attivo: EventoFuturo | undefined;
  for (const e of [...eventi].sort((a, b) => a.dataInizio.localeCompare(b.dataInizio))) {
    if (e.dataInizio <= meta) attivo = e;
    else break;
  }
  return attivo?.fatturatoMensile !== undefined ? attivo.fatturatoMensile * 12 : undefined;
}

/**
 * Stima informativa della pensione Inarcassa. Restituisce `undefined` se non ci
 * sono fatture da cui ricavare lo storico dei contributi.
 */
export function stimaPensioneInarcassa(
  fatture: Fattura[] | undefined,
  par: Parametri,
  eventiFuturi: EventoFuturo[] = [],
): StimaInarcassa | undefined {
  if (!fatture || fatture.length === 0) return undefined;
  const anni = anniConFatture(fatture).sort((a, b) => a - b); // crescente

  const nascita = Number(par.dataNascita.slice(0, 4));
  const etaPensione = par.etaPensione ?? 67;
  const annoPensione = nascita + etaPensione;

  const inflazione = par.inflazione ?? 0.02;
  const rivalutazioneReale =
    (1 + RIVALUTAZIONE_NOMINALE_INARCASSA) / (1 + inflazione) - 1;

  let montante = 0;
  const contributiStorici: number[] = [];

  for (const anno of anni) {
    const c = calcolaAnno(anno, fatture, { ridotta: false });
    const contributo = c.soggettivo + RETROCESSIONE_INTEGRATIVO * c.integrativo;
    contributiStorici.push(contributo);
    const anniCapitalizzazione = Math.max(0, annoPensione - anno);
    montante += contributo * Math.pow(1 + rivalutazioneReale, anniCapitalizzazione);
  }

  // Anni futuri: usa il fatturato dello scenario attivo (eventiFuturi) se
  // disponibile, altrimenti la media degli ultimi 3 anni noti.
  const mediaUltimi3 =
    contributiStorici.slice(-3).reduce((s, v) => s + v, 0) /
    (Math.min(3, contributiStorici.length) || 1);

  const ultimoAnnoNoto = anni[anni.length - 1];
  let anniFuturi = 0;
  for (let anno = ultimoAnnoNoto + 1; anno < annoPensione; anno++) {
    const fatturato = fatturatoScenario(eventiFuturi, anno);
    const contributo = fatturato !== undefined ? contributoAnno(fatturato) : mediaUltimi3;
    const anniCapitalizzazione = Math.max(0, annoPensione - anno);
    montante += contributo * Math.pow(1 + rivalutazioneReale, anniCapitalizzazione);
    anniFuturi++;
  }

  const coeff = par.coeffTrasformazioneInarcassa ?? COEFF_TRASFORMAZIONE_DEFAULT;
  const pensioneAnnua = montante * coeff;

  return {
    montante,
    anniContribuzione: anni.length + anniFuturi,
    annoPensione,
    coeff,
    pensioneAnnua,
    pensioneMensile: pensioneAnnua / 13,
    rivalutazioneReale,
  };
}
