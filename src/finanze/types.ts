// Modello dati dell'app. Ricalca la struttura dei fogli dell'Excel di partenza,
// riorganizzata in modo piu' pulito e senza formule fragili.

/** Un movimento del conto (foglio "Transazioni"). */
export interface Transazione {
  id: string;
  /** Data operazione (ISO yyyy-mm-dd). */
  data: string;
  tipologia?: string; // Tipologia (Bonifico, POS, ...)
  causale?: string; // Causale / descrizione
  stato?: string; // Eseguito / In attesa
  entrate?: number; // colonna F
  uscite?: number; // colonna G
  /** Flag "fattura" (Excel: colonna H = "x"). Il movimento e' un incasso da fattura. */
  fattura?: boolean;
  /** Flag "tasse" (Excel: colonna I = "x"). Il movimento e' un pagamento di tasse. */
  tasse?: boolean;
  /**
   * Flag "trasferimento": il movimento non e' una vera spesa/entrata ma uno
   * spostamento di denaro verso un altro conto o strumento (es. giroconto,
   * PAC su Scalable). NON conta come spesa nell'analisi e non "sparisce" dal
   * patrimonio: resta nel totale come capitale investito.
   */
  trasferimento?: boolean;
  /** Categoria di spesa/entrata (Excel: colonna J). */
  categoria?: string;
  note?: string; // colonna K
  /**
   * Movimento annullato: resta visibile in elenco (grigio e barrato) per non
   * perderne traccia, ma viene ignorato da OGNI calcolo (saldo, analisi,
   * proiezione, totali) come se non esistesse.
   */
  annullata?: boolean;
  /**
   * Giroconto interno tra due conti PROPRI (es. bonifico da banca A a banca
   * B, con i CSV di entrambe caricati). Le due gambe si annullano nel saldo;
   * nell'analisi non sono ne' spese ne' entrate; NON è capitale investito.
   */
  girocontoInterno?: boolean;
  /**
   * Rata di mutuo: non è una spesa piena. La quota capitale (dal piano di
   * ammortamento configurato in Impostazioni) diventa equity dell'immobile;
   * solo la quota interessi conta come spesa nell'analisi.
   */
  mutuo?: boolean;
  /** Conto/banca di provenienza (assegnato all'import del CSV). */
  conto?: string;
  /**
   * Solo per movimenti con flag "tasse": come l'importo pagato si ripartisce
   * tra Inarcassa e Imposta (IRPEF/imposta sostitutiva) e a quale anno di
   * competenza va imputato. Di solito una riga sola, ma un versamento puo'
   * coprire il saldo dell'anno precedente + l'acconto di quello in corso:
   * in quel caso si divide su piu' righe (una per anno). Serve a calcolare
   * il "pagato" reale da confrontare con gli importi dichiarati nel foglio
   * tasse per anno.
   */
  allocazioneTasse?: AllocazioneTasse[];
  /**
   * Solo per movimenti con flag "tasse": ripartizione confermata e non più da
   * ricontrollare. Blocca la riga in "Verifica pagamenti" (non più
   * modificabile per sbaglio) e la esclude dal conteggio "da completare"
   * anche se resta un residuo non allocato (es. un piccolo extra dovuto al
   * circuito di pagamento scelto).
   */
  tasseCompletato?: boolean;
}

/** Quota di un pagamento tasse imputata a un anno (foglio "Transazioni", verifica pagamenti). */
export interface AllocazioneTasse {
  anno: number;
  inarcassa?: number;
  imposta?: number;
}

/** Categoria di spesa/entrata (foglio "Dati"). */
export interface Categoria {
  nome: string;
  colore?: string;
  tipo?: "spesa" | "entrata";
  /**
   * Descrizione/esempi della categoria: serve a "istruire" Claude nella
   * categorizzazione automatica (viene inclusa nel prompt).
   */
  descrizione?: string;
}

/** Dati fiscali per anno (foglio "Tasse"): forfettario + Inarcassa. */
export interface AnnoTasse {
  anno: number;
  inarcassa?: number; // D - contributo Inarcassa dell'anno
  irpef?: number; // E - IRPEF / imposta sostitutiva
  aggiuntivi?: number; // F - aggiuntivi ipotizzati
  fatturato?: number; // J - fatturato dell'anno
  tassazione?: number; // K - aliquota (decimale, es. 0.1865)
  /**
   * Inarcassa in regime ridotto per quest'anno: il contributo soggettivo è al
   * 7,25% invece del 14,5% (i primi anni di attività o sotto soglia). Se
   * l'anno ha delle fatture, questo flag guida il calcolo del contributo.
   */
  inarcassaRidotta?: boolean;
  /** Contributo maternità Inarcassa dell'anno (default 72€), usato dal calcolo da fatture. */
  maternita?: number;
  /**
   * Entrate extra dell'anno NON soggette a tasse (es. rimborsi, lavoretti
   * occasionali fuori partita IVA): non entrano nel calcolo fiscale ma vengono
   * sommate al netto nel calcolo del netto/mese dell'Analisi complessiva.
   */
  entrateExtra?: number;
  /**
   * Spese dell'anno da sottrarre nel calcolo del netto/mese dell'Analisi
   * complessiva (es. spese professionali non deducibili nel forfettario).
   */
  spese?: number;
  /**
   * Anno chiuso per Inarcassa/Imposta: se spuntato, l'importo di quella voce
   * non viene più conteggiato in "Da versare" nella tabella "Previsto vs
   * pagato" (né nei totali), anche se il calcolo grezzo darebbe un residuo.
   */
  inarcassaChiuso?: boolean;
  impostaChiuso?: boolean;
  /** Nota libera per l'anno (tabella "Previsto vs pagato"). */
  note?: string;
}

/**
 * Una fattura emessa (o stimata) in regime forfettario, con contabilità
 * Inarcassa. Ricalca una riga dell'"ELENCO FATTURE" dei fogli annuali
 * dell'Excel. Il netto può essere digitato a mano oppure calcolato dalle
 * giornate lavorate × prezzo giornaliero.
 */
export interface Fattura {
  id: string;
  /** Anno di competenza (la "scheda" a cui appartiene). */
  anno: number;
  /** Numero progressivo della fattura (libero, anche testo). */
  numero?: string;
  /** Data di emissione (ISO yyyy-mm-dd). */
  dataEmissione: string;
  /** Cliente/destinatario. */
  destinatario?: string;
  /**
   * Fattura solo stimata/previsionale (non ancora realmente emessa). Serve a
   * proiettare il totale dell'anno pur distinguendo il già-fatturato dal
   * previsto. Assente/false = realmente emessa.
   */
  stimata?: boolean;
  /** Imponibile netto della prestazione (colonna "Netto"). */
  netto?: number;
  /** IVA (di norma 0 nel forfettario). */
  iva?: number;
  /**
   * Marca da bollo. Se assente vale 2€ quando il netto supera 77,47€, 0
   * altrimenti (soglia di legge).
   */
  bollo?: number;
  /** Prestazione verso l'estero: niente contributo integrativo Inarcassa 4%. */
  estero?: boolean;
  note?: string;
  /**
   * Se true il netto è calcolato dalle giornate: netto = (giorni − ferie +
   * extra + spostati) × prezzoGiorno. Replica le colonne M/N/O/P/Q dell'Excel.
   */
  daGiornate?: boolean;
  giorni?: number; // giorni lavorativi del mese
  ferie?: number; // ferie / malattia
  extra?: number; // giorni extra (weekend, ecc.)
  spostati?: number; // giorni spostati dal mese precedente
  prezzoGiorno?: number; // tariffa giornaliera
}

/** Evento della proiezione futura (foglio "SpeseEntrateFuturi"). */
export interface EventoFuturo {
  id: string;
  descrizione: string;
  dataInizio: string; // ISO
  dataFine?: string; // ISO (se assente, fino all'evento successivo)
  fatturatoMensile?: number; // G
  aliquota?: number; // per calcolare l'entrata netta H = G*(1-aliquota)
  spesaMensile?: number; // I
  /** Spesa grossa una-tantum in dataInizio (Excel: colonna L). */
  spesaGrossa?: number;
}

/** Tranche di investimento (foglio "Investimenti"). */
export interface Investimento {
  id: string;
  descrizione?: string;
  dataInizio: string; // ISO
  dataFine: string; // ISO
  capitale: number; // D - capitale iniziale
  /** Tasso annuo (reale, gia' al netto di inflazione/tasse a seconda della scelta). */
  interesse: number; // E
  /** Piano di accumulo: importo aggiunto periodicamente (opzionale). */
  versamentoPeriodico?: number;
  /** Ogni quanti mesi si aggiunge il versamento (es. 12 = ogni anno). */
  frequenzaMesi?: number;
}

/**
 * Mutuo su un immobile (piano di ammortamento francese). Serve a trattare il
 * mutuo da investimento e non da spesa: la quota capitale delle rate diventa
 * equity dell'immobile (patrimonio), solo la quota interessi resta una spesa.
 */
export interface Mutuo {
  id: string;
  descrizione?: string;
  /** Capitale finanziato dalla banca. */
  importo: number;
  /** TAN annuo (decimale, es. 0.032 = 3,2%). */
  tasso: number;
  /** Durata del piano in mesi (es. 300 = 25 anni). */
  durataMesi: number;
  /** Mese della prima rata (ISO, es. 2024-06-01). */
  dataInizio: string;
  /** Anticipo/caparra pagati di tasca: equity immediata dell'immobile. */
  anticipo?: number;
  /** Valore di mercato dell'immobile (solo informativo). */
  valoreImmobile?: number;
}

/** Parametri globali editabili. */
export interface Parametri {
  /** Punto di partenza noto del saldo (Excel: Saldo!C2). */
  saldoInizialeData: string;
  saldoInizialeValore: number;
  /** Data di nascita, per calcolare l'eta' nella proiezione. */
  dataNascita: string;
  /** Inflazione annua usata per portare tutto in potere d'acquisto reale. */
  inflazione: number;
  /** Eta' a cui stimare il capitale per la pensione integrativa (default 67). */
  etaPensione?: number;
  /** Tasso di prelievo annuo per stimare la rendita integrativa (default 0.04 = 4%). */
  tassoRendita?: number;
  /**
   * Coefficiente di trasformazione per la stima (informativa) della pensione
   * Inarcassa col metodo contributivo: pensione annua = montante × coeff.
   * Dipende dall'eta' di pensionamento (default ~0.055). Editabile.
   */
  coeffTrasformazioneInarcassa?: number;
  /**
   * Aliquota di tassazione della rendita integrativa post-pensione (default
   * 0.15 = 15%, tipico di un fondo pensione, riducibile fino al 9%). Serve a
   * mostrare la rendita anche al netto delle tasse. Se 0, la rendita e' gia'
   * considerata netta.
   */
  aliquotaRendita?: number;
  /**
   * Hash SHA-256 del PIN che blocca la sezione Finanze dentro mente-digitale.
   * Assente = sezione aperta. Non e' una protezione crittografica dei dati (chi
   * apre i DevTools legge IndexedDB comunque): serve a non lasciare i conti in
   * chiaro sullo schermo quando l'app resta aperta in ufficio.
   */
  pinHash?: string;
  /**
   * PIN disattivato di proposito. Serve a distinguere «non l'ho mai impostato»
   * da «l'ho tolto io»: senza questo flag, `pinHash` assente sarebbe ambiguo e
   * il blocco dovrebbe scegliere tra restare aperto per sbaglio (su un dato
   * salvato prima che il PIN esistesse) o non potersi piu' togliere.
   */
  pinDisattivato?: boolean;
  /**
   * @deprecated Hash della vecchia password del gate a pagina intera, rimosso
   * quando Finanze e' diventato una sezione di mente-digitale (l'accesso e' il
   * login Microsoft). Conservato solo per non perdere il campo importando un
   * backup vecchio; al primo import viene promosso a `pinHash` se questo manca.
   */
  passwordHash?: string;
  /**
   * @deprecated Application (client) ID della registrazione Azure dedicata,
   * quando Finanze era un'app a sé. Ora si usa il login Microsoft di
   * mente-digitale: il campo sopravvive solo nei backup vecchi.
   */
  oneDriveClientId?: string;
  /** Se true, salva il backup su OneDrive automaticamente a ogni modifica. */
  oneDriveAutoSync?: boolean;
}

/** L'intero stato dell'app: un solo oggetto JSON esportabile/importabile. */
export interface DatiApp {
  versione: number;
  /**
   * Momento (ISO) in cui questo snapshot e' stato salvato su OneDrive. Serve a
   * confrontare backup locale e remoto all'avvio per caricare il piu' recente.
   */
  salvatoIl?: string;
  transazioni: Transazione[];
  categorie: Categoria[];
  tasse: AnnoTasse[];
  /** Fatture emesse/stimate (regime forfettario). Alimentano fatturato e tasse per anno. */
  fatture?: Fattura[];
  eventiFuturi: EventoFuturo[];
  investimenti: Investimento[];
  /** Mutui/immobili (equity conteggiata nel patrimonio). */
  mutui?: Mutuo[];
  parametri: Parametri;
}

export const VERSIONE_DATI = 1;

/**
 * PIN predefinito della sezione Finanze (SHA-256 di un codice numerico), usato
 * quando i parametri non ne portano uno.
 *
 * Il blocco fallisce *chiuso*: uno snapshot salvato prima che il PIN esistesse
 * — o un backup importato da una versione precedente — non deve lasciare i
 * conti in chiaro solo perche' gli manca un campo. Per togliere il blocco si
 * usa `pinDisattivato`, che e' una scelta esplicita.
 *
 * Il PIN non protegge i dati: chi apre i DevTools legge IndexedDB comunque, e
 * un codice a sei cifre si prova per intero in un istante. Serve a coprire lo
 * schermo da chi passa vicino alla scrivania, che e' il caso d'uso reale.
 */
export const PIN_PREDEFINITO_HASH =
  "253c28d9f77a36f8181a80c16a3aac6ce5f68f29ea262e6c127a7979bc6b4dab";

/** Hash del PIN in vigore, o null se il blocco e' stato disattivato. */
export function pinAttivo(p: Parametri): string | null {
  if (p.pinDisattivato) return null;
  return p.pinHash ?? PIN_PREDEFINITO_HASH;
}

/** Categorie di default (dal foglio "Dati" dell'Excel). Le descrizioni servono
 * a guidare la categorizzazione automatica con Claude. */
export const CATEGORIE_DEFAULT: Categoria[] = [
  {
    nome: "Spesa/casa",
    tipo: "spesa",
    descrizione:
      "Spesa alimentare e per la casa: supermercati (Esselunga, Coop, Lidl, Carrefour, Conad), alimentari, prodotti per la casa, farmacia.",
  },
  {
    nome: "Abbonamenti",
    tipo: "spesa",
    descrizione:
      "Servizi ricorrenti e addebiti automatici: streaming (Netflix, Spotify, Disney+, Prime), telefono/internet, cloud, software, palestra.",
  },
  {
    nome: "Benzina",
    tipo: "spesa",
    descrizione:
      "Carburante e rifornimenti: distributori (Q8, Eni, IP, Tamoil, Esso), colonnine di ricarica elettrica.",
  },
  {
    nome: "Auto",
    tipo: "spesa",
    descrizione:
      "Spese auto non carburante: assicurazione, bollo, manutenzione/officina, pedaggi (Telepass, autostrade), parcheggi, multe.",
  },
  {
    nome: "Cene/Ape",
    tipo: "spesa",
    descrizione:
      "Ristoranti, bar, aperitivi, pizzerie, caffe, fast food, consegne di cibo (Glovo, Deliveroo, JustEat).",
  },
  {
    nome: "Regali",
    tipo: "spesa",
    descrizione: "Regali e occasioni: compleanni, matrimoni, feste, fiori.",
  },
  {
    nome: "Ferie",
    tipo: "spesa",
    descrizione:
      "Viaggi e vacanze: hotel, voli, treni, Airbnb, noleggi, attivita turistiche.",
  },
  {
    nome: "Extra",
    tipo: "spesa",
    descrizione:
      "Spese varie che non rientrano nelle altre categorie: shopping, elettronica, tempo libero, salute.",
  },
  {
    nome: "Contanti",
    tipo: "spesa",
    descrizione: "Prelievi di contante (ATM/bancomat, prelievo sportello).",
  },
  {
    nome: "Messico/Lavoro",
    tipo: "spesa",
    descrizione: "Spese legate al lavoro o alla trasferta in Messico.",
  },
  {
    nome: "Da fare",
    tipo: "spesa",
    descrizione: "Movimenti ancora da classificare o da verificare a mano.",
  },
];

/** Stato iniziale vuoto dell'app. */
export function datiVuoti(): DatiApp {
  return {
    versione: VERSIONE_DATI,
    transazioni: [],
    categorie: CATEGORIE_DEFAULT,
    tasse: [],
    fatture: [],
    eventiFuturi: [],
    investimenti: [],
    mutui: [],
    parametri: {
      saldoInizialeData: "2017-01-01",
      saldoInizialeValore: 6400,
      dataNascita: "1994-03-22",
      inflazione: 0.02,
      etaPensione: 67,
      tassoRendita: 0.035,
      aliquotaRendita: 0.15,
    },
  };
}
