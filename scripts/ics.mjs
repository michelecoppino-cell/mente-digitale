// Il lettore di un calendario ICS: da un file `.ics` alle occorrenze vere,
// espanse, nella finestra che interessa.
//
// Serve a `sync-calendario-lavoro.mjs`, ed è **puro**: niente rete, niente
// file, niente Graph. Prende una stringa e restituisce oggetti — che è la sola
// ragione per cui si può provare (`npm run prova-ics`), ed è la lezione della
// sincronizzazione precedente, che leggeva mail e non si poteva provare senza
// una casella vera.
//
// Cosa legge e cosa no. Legge quello che c'è nel calendario di un ufficio:
// eventi con l'ora e di tutto il giorno, serie ricorrenti giornaliere,
// settimanali, mensili e annuali con INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY, le
// occorrenze cancellate (EXDATE), quelle spostate o modificate una per una
// (RECURRENCE-ID) e gli appuntamenti annullati (STATUS:CANCELLED). Non legge
// allegati, partecipanti, promemoria e fusi esotici: di un calendario in sola
// lettura interessano titolo, giorno e ora.

// ── Fusi ────────────────────────────────────────────────────────────────────
// Un ICS di Outlook scrive `TZID=W. Europe Standard Time`, cioè il nome
// Windows del fuso, non quello IANA. Qui c'è la manciata che può capitare a un
// calendario italiano; tutto il resto ricade su Europe/Rome, ed è la scelta
// giusta per il caso d'uso: un calendario di lavoro di uno studio in Friuli è
// scritto nell'ora di Roma, e sbagliare fuso di un'ora è meglio che rifiutare
// l'evento.
const FUSI_WINDOWS = {
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'gmt standard time': 'Europe/London',
  'utc': 'UTC',
};

const FUSO_DI_CASA = 'Europe/Rome';

/** @param {string|null|undefined} tzid @returns {string} un fuso IANA */
export function fusoIana(tzid) {
  const grezzo = (tzid || '').trim();
  if (!grezzo) return FUSO_DI_CASA;
  const windows = FUSI_WINDOWS[grezzo.toLowerCase()];
  if (windows) return windows;
  // Un nome IANA si riconosce dalla barra, e si prova a usarlo davvero: se
  // Intl non lo conosce solleva, e allora vale la regola di casa.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: grezzo });
    return grezzo;
  } catch { return FUSO_DI_CASA; }
}

/** Di quanto quel fuso è avanti su UTC in quell'istante, in minuti. */
function offsetMinuti(istanteMs, zona) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(istanteMs)).map(x => [x.type, x.value]));
  const comeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (comeUtc - istanteMs) / 60000;
}

/**
 * L'istante UTC di un orario scritto sull'orologio di un fuso.
 *
 * Due passate e non una: l'offset dipende dall'istante, e l'istante è quello
 * che si sta cercando. La prima passata usa l'offset "sbagliato" per avere un
 * istante vicino, la seconda quello giusto. È il modo standard di invertire un
 * orologio locale, e serve perché nella notte del cambio d'ora l'offset di
 * mezzogiorno non è quello di mezzanotte.
 *
 * @param {number} muroMs  `Date.UTC(...)` dei componenti letti sull'orologio
 * @param {string} zona
 * @returns {number} millisecondi UTC
 */
export function daOrologioAUtc(muroMs, zona) {
  const primo = muroMs - offsetMinuti(muroMs, zona) * 60000;
  return muroMs - offsetMinuti(primo, zona) * 60000;
}

// ── Righe ───────────────────────────────────────────────────────────────────

/**
 * Le righe di un ICS, ricucite. Il formato spezza le righe lunghe a 75 ottetti
 * e continua quella dopo con uno spazio (o una tabulazione) davanti: senza
 * ricucirle, un oggetto lungo arriva tagliato a metà.
 * @param {string} testo
 * @returns {string[]}
 */
export function srotolaRighe(testo) {
  const righe = String(testo || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  /** @type {string[]} */
  const fuori = [];
  for (const riga of righe) {
    if ((riga.startsWith(' ') || riga.startsWith('\t')) && fuori.length) {
      fuori[fuori.length - 1] += riga.slice(1);
    } else if (riga.length) {
      fuori.push(riga);
    }
  }
  return fuori;
}

/** `DTSTART;TZID=Europe/Rome:20260902T090000` → nome, parametri, valore. */
function leggiRiga(riga) {
  const duePunti = riga.indexOf(':');
  if (duePunti < 0) return null;
  const testa = riga.slice(0, duePunti);
  const valore = riga.slice(duePunti + 1);
  const pezzi = testa.split(';');
  /** @type {Record<string,string>} */
  const parametri = {};
  for (const p of pezzi.slice(1)) {
    const uguale = p.indexOf('=');
    if (uguale > 0) parametri[p.slice(0, uguale).toUpperCase()] = p.slice(uguale + 1).replace(/^"|"$/g, '');
  }
  return { nome: pezzi[0].toUpperCase(), parametri, valore };
}

/** Il testo di un valore ICS: le sequenze di escape tornano caratteri. */
function testo(valore) {
  return String(valore || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Una data ICS.
 * @param {string} valore  `20260902`, `20260902T090000`, `20260902T070000Z`
 * @param {Record<string,string>} parametri
 * @returns {{ muroMs: number, tuttoIlGiorno: boolean, zona: string }|null}
 */
export function leggiData(valore, parametri = {}) {
  const v = String(valore || '').trim();
  const soloGiorno = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (soloGiorno) {
    return {
      muroMs: Date.UTC(+soloGiorno[1], +soloGiorno[2] - 1, +soloGiorno[3]),
      tuttoIlGiorno: true,
      zona: 'UTC',
    };
  }
  const conOra = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!conOra) return null;
  return {
    muroMs: Date.UTC(+conOra[1], +conOra[2] - 1, +conOra[3], +conOra[4], +conOra[5], +conOra[6]),
    tuttoIlGiorno: false,
    // Con la Z in coda l'orario è già UTC e non c'è niente da convertire.
    zona: conOra[7] ? 'UTC' : fusoIana(parametri.TZID),
  };
}

/**
 * @typedef {object} EventoIcs
 * @property {string} uid
 * @property {string} titolo
 * @property {{ muroMs: number, tuttoIlGiorno: boolean, zona: string }|null} inizio
 * @property {{ muroMs: number, tuttoIlGiorno: boolean, zona: string }|null} fine
 * @property {string} rrule
 * @property {number[]} exdate       gli inizi (muroMs) da saltare
 * @property {number|null} ricorrenzaDi  RECURRENCE-ID: quale occorrenza sostituisce
 * @property {boolean} annullato
 */

/**
 * I VEVENT di un ICS, grezzi: nessuna ricorrenza ancora espansa.
 * @param {string} testoIcs
 * @returns {EventoIcs[]}
 */
export function leggiIcs(testoIcs) {
  /** @type {EventoIcs[]} */
  const eventi = [];
  /** @type {EventoIcs|null} */
  let corrente = null;
  // Dentro un VTIMEZONE ci sono altri DTSTART e altre RRULE, che non c'entrano
  // niente con gli eventi: senza saltarlo si leggerebbero come tali.
  let dentroFuso = false;

  for (const riga of srotolaRighe(testoIcs)) {
    const letta = leggiRiga(riga);
    if (!letta) continue;
    const { nome, parametri, valore } = letta;

    if (nome === 'BEGIN' && valore.toUpperCase() === 'VTIMEZONE') { dentroFuso = true; continue; }
    if (nome === 'END' && valore.toUpperCase() === 'VTIMEZONE') { dentroFuso = false; continue; }
    if (dentroFuso) continue;

    if (nome === 'BEGIN' && valore.toUpperCase() === 'VEVENT') {
      corrente = {
        uid: '', titolo: '', inizio: null, fine: null,
        rrule: '', exdate: [], ricorrenzaDi: null, annullato: false,
      };
      continue;
    }
    if (nome === 'END' && valore.toUpperCase() === 'VEVENT') {
      if (corrente?.inizio) eventi.push(corrente);
      corrente = null;
      continue;
    }
    if (!corrente) continue;

    switch (nome) {
      case 'UID': corrente.uid = valore.trim(); break;
      case 'SUMMARY': corrente.titolo = testo(valore); break;
      case 'DTSTART': corrente.inizio = leggiData(valore, parametri); break;
      case 'DTEND': corrente.fine = leggiData(valore, parametri); break;
      case 'RRULE': corrente.rrule = valore.trim(); break;
      case 'EXDATE':
        for (const pezzo of valore.split(',')) {
          const d = leggiData(pezzo, parametri);
          if (d) corrente.exdate.push(d.muroMs);
        }
        break;
      case 'RECURRENCE-ID': corrente.ricorrenzaDi = leggiData(valore, parametri)?.muroMs ?? null; break;
      case 'STATUS': if (valore.trim().toUpperCase() === 'CANCELLED') corrente.annullato = true; break;
      default: break;
    }
  }
  return eventi;
}

// ── Ricorrenze ──────────────────────────────────────────────────────────────

const GIORNI = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270101T000000Z` → oggetto. */
function leggiRrule(rrule) {
  /** @type {Record<string,string>} */
  const parti = {};
  for (const pezzo of String(rrule || '').split(';')) {
    const uguale = pezzo.indexOf('=');
    if (uguale > 0) parti[pezzo.slice(0, uguale).toUpperCase()] = pezzo.slice(uguale + 1);
  }
  if (!parti.FREQ) return null;
  return {
    freq: parti.FREQ.toUpperCase(),
    interval: Math.max(1, Number(parti.INTERVAL || 1)),
    count: parti.COUNT ? Number(parti.COUNT) : null,
    until: parti.UNTIL ? (leggiData(parti.UNTIL)?.muroMs ?? null) : null,
    byday: (parti.BYDAY || '').split(',').filter(Boolean),
    bymonthday: (parti.BYMONTHDAY || '').split(',').filter(Boolean).map(Number),
  };
}

/** Il tetto di occorrenze generate per serie: una guardia, non un limite vero. */
const MAX_OCCORRENZE = 2000;

/**
 * Gli inizi (in millisecondi d'orologio) di una serie, dentro la finestra.
 *
 * Si cammina sul calendario con `Date.UTC` sui componenti dell'orologio, non
 * sommando millisecondi: così una serie settimanale resta alle nove anche
 * quando in mezzo passa il cambio dell'ora, perché la conversione in UTC
 * avviene dopo, occorrenza per occorrenza.
 *
 * @param {number} inizioMs   il DTSTART, in millisecondi d'orologio
 * @param {string} rrule
 * @param {number} finestraFineMs  oltre non serve generare
 * @returns {number[]}
 */
export function occorrenzeDi(inizioMs, rrule, finestraFineMs) {
  const regola = leggiRrule(rrule);
  if (!regola) return [inizioMs];

  const base = new Date(inizioMs);
  const ora = [base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()];
  /** @param {number} a @param {number} m @param {number} g */
  const punto = (a, m, g) => Date.UTC(a, m, g, ora[0], ora[1], ora[2]);

  const fine = regola.until != null ? Math.min(regola.until, finestraFineMs) : finestraFineMs;
  /** @type {number[]} */
  const fuori = [];
  /** @param {number} ms */
  const aggiungi = ms => {
    if (ms < inizioMs || ms > fine) return;
    if (!fuori.includes(ms)) fuori.push(ms);
  };

  if (regola.freq === 'DAILY') {
    for (let i = 0, ms = inizioMs; ms <= fine && i < MAX_OCCORRENZE; i++) {
      aggiungi(ms);
      ms = punto(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + (i + 1) * regola.interval);
    }
  } else if (regola.freq === 'WEEKLY') {
    const giorni = regola.byday.length
      ? regola.byday.map(d => GIORNI[d.slice(-2).toUpperCase()]).filter(d => d !== undefined)
      : [base.getUTCDay()];
    // Il lunedì della settimana del primo evento: da lì si cammina di
    // `interval` settimane e dentro ognuna si prendono i giorni chiesti.
    const lunedi = punto(base.getUTCFullYear(), base.getUTCMonth(),
      base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
    for (let s = 0; s < MAX_OCCORRENZE; s++) {
      const partenza = new Date(lunedi);
      const settimana = punto(partenza.getUTCFullYear(), partenza.getUTCMonth(),
        partenza.getUTCDate() + s * 7 * regola.interval);
      if (settimana > fine) break;
      for (const g of giorni) {
        const d = new Date(settimana);
        aggiungi(punto(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((g + 6) % 7)));
      }
    }
  } else if (regola.freq === 'MONTHLY') {
    const giorniDelMese = regola.bymonthday.length ? regola.bymonthday : [base.getUTCDate()];
    // `3TU` = il terzo martedì. È la forma con cui si scrivono le riunioni
    // ricorrenti, e senza di essa metà delle serie mensili sparirebbe.
    const ordinali = regola.byday
      .map(d => /^(-?\d)?([A-Za-z]{2})$/.exec(d.trim()))
      .filter(Boolean)
      .map(m => ({ n: Number(m[1] || 1), giorno: GIORNI[m[2].toUpperCase()] }));
    for (let i = 0; i < MAX_OCCORRENZE; i++) {
      const mese = base.getUTCMonth() + i * regola.interval;
      const primo = punto(base.getUTCFullYear(), mese, 1);
      if (primo > fine) break;
      const d0 = new Date(primo);
      if (ordinali.length) {
        for (const { n, giorno } of ordinali) {
          if (giorno === undefined) continue;
          const scarto = (giorno - d0.getUTCDay() + 7) % 7;
          const giorniNelMese = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)).getUTCDate();
          const quanti = Math.floor((giorniNelMese - 1 - scarto) / 7) + 1;
          const indice = n > 0 ? n - 1 : quanti + n;
          if (indice < 0 || indice >= quanti) continue;
          aggiungi(punto(d0.getUTCFullYear(), d0.getUTCMonth(), 1 + scarto + indice * 7));
        }
      } else {
        for (const g of giorniDelMese) {
          const candidato = punto(d0.getUTCFullYear(), d0.getUTCMonth(), g);
          // Il 31 in un mese di trenta giorni scivolerebbe al primo del mese
          // dopo: quell'occorrenza non esiste e va saltata, non spostata.
          if (new Date(candidato).getUTCMonth() === d0.getUTCMonth()) aggiungi(candidato);
        }
      }
    }
  } else if (regola.freq === 'YEARLY') {
    for (let i = 0; i < MAX_OCCORRENZE; i++) {
      const ms = punto(base.getUTCFullYear() + i * regola.interval, base.getUTCMonth(), base.getUTCDate());
      if (ms > fine) break;
      aggiungi(ms);
    }
  } else {
    return [inizioMs];
  }

  fuori.sort((a, b) => a - b);
  return regola.count ? fuori.slice(0, regola.count) : fuori;
}

/** `2026-09-02T07:00:00` da un istante UTC. */
function istanteUtc(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

/** `2026-09-02` da un orario d'orologio. */
function giornoDiOrologio(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @typedef {object} Occorrenza
 * @property {string} id           stabile fra un giro e l'altro: uid + inizio
 * @property {string} subject
 * @property {string} start        `YYYY-MM-DDTHH:MM:SS` UTC, o `YYYY-MM-DD` se tutto il giorno
 * @property {string} end
 * @property {boolean} isAllDay
 */

/**
 * Da un ICS alle occorrenze dentro la finestra, ordinate.
 *
 * @param {string} testoIcs
 * @param {{ da: Date, a: Date }} finestra
 * @returns {Occorrenza[]}
 */
export function occorrenzeIcs(testoIcs, { da, a }) {
  const eventi = leggiIcs(testoIcs);
  const daMs = da.getTime();
  const aMs = a.getTime();

  // Le eccezioni per UID: un'occorrenza spostata o cancellata a mano arriva
  // come un VEVENT a parte con lo stesso UID e un RECURRENCE-ID.
  /** @type {Map<string, Map<number, import('./ics.mjs').EventoIcs>>} */
  const eccezioni = new Map();
  for (const e of eventi) {
    if (e.ricorrenzaDi == null) continue;
    if (!eccezioni.has(e.uid)) eccezioni.set(e.uid, new Map());
    eccezioni.get(e.uid).set(e.ricorrenzaDi, e);
  }

  /** @type {Occorrenza[]} */
  const fuori = [];
  /** @type {Set<string>} */
  const viste = new Set();

  /** @param {import('./ics.mjs').EventoIcs} e @param {number} muroMs */
  const scrivi = (e, muroMs) => {
    if (e.annullato || !e.inizio) return;
    const durata = e.fine ? e.fine.muroMs - e.inizio.muroMs : (e.inizio.tuttoIlGiorno ? 86_400_000 : 3_600_000);
    let start, end, inizioMs;
    if (e.inizio.tuttoIlGiorno) {
      inizioMs = muroMs;
      start = giornoDiOrologio(muroMs);
      end = giornoDiOrologio(muroMs + durata);
    } else {
      inizioMs = daOrologioAUtc(muroMs, e.inizio.zona);
      start = istanteUtc(inizioMs);
      end = istanteUtc(daOrologioAUtc(muroMs + durata, e.inizio.zona));
    }
    // La finestra si guarda sull'inizio: un evento cominciato prima e ancora
    // in corso è un caso che a un calendario di appuntamenti non capita, e
    // tenerlo vorrebbe dire espandere ogni serie dall'inizio dei tempi.
    if (inizioMs < daMs || inizioMs > aMs) return;
    const id = `${e.uid}|${start}`;
    if (viste.has(id)) return;
    viste.add(id);
    fuori.push({ id, subject: e.titolo || '(senza titolo)', start, end, isAllDay: e.inizio.tuttoIlGiorno });
  };

  for (const e of eventi) {
    if (e.ricorrenzaDi != null) continue;   // le eccezioni si scrivono sotto
    if (!e.inizio) continue;
    if (!e.rrule) { scrivi(e, e.inizio.muroMs); continue; }

    // La serie si espande fino alla fine della finestra, con un margine: le
    // occorrenze si generano sull'orologio e si spostano di un'ora quando
    // cambia l'ora legale.
    const limite = aMs + 2 * 86_400_000;
    const mieEccezioni = eccezioni.get(e.uid);
    for (const muroMs of occorrenzeDi(e.inizio.muroMs, e.rrule, limite)) {
      if (e.exdate.includes(muroMs)) continue;
      const eccezione = mieEccezioni?.get(muroMs);
      if (eccezione) scrivi(eccezione, eccezione.inizio?.muroMs ?? muroMs);
      else scrivi(e, muroMs);
    }
  }

  // Le eccezioni di serie che nella finestra non hanno una occorrenza base
  // (spostate da prima a dentro la finestra): senza questo giro sparirebbero.
  for (const perUid of eccezioni.values()) {
    for (const e of perUid.values()) if (e.inizio) scrivi(e, e.inizio.muroMs);
  }

  return fuori.sort((x, y) => x.start.localeCompare(y.start));
}
