// @ts-check
// Le sveglie delle attività: la logica, senza React.
//
// Una sveglia è un'ora del giorno scritta nelle note di un'attività come
// `[SVEGLIA:hh:mm]` (vedi taskModel.js). Non è una scadenza — quella è un
// giorno, e To-Do ce l'ha già — ma il momento in cui si vuole essere
// richiamati: «alle 15:30 questa cosa». Sta nelle note e non in un file
// nostro perché così viaggia con l'attività su To-Do, si legge dal telefono e
// non c'è niente da tenere in pari.
//
// Il PC deve accorgersene anche quando la mente digitale non è la finestra
// davanti: perciò l'avviso è tre cose insieme — un pannello a tutto schermo,
// una notifica di sistema e un suono — e chi le mette in fila è
// `useSveglie.js`. Qui restano solo le funzioni pure, che si possono leggere
// e correggere senza pensare al ciclo di vita di un componente.

import { ymd } from './tempo';

/** Le ore proposte come pastiglie: fra quanto suona, non a che ora. */
export const SVEGLIA_CHOICES = [
  { min: 5,   label: 'fra 5 min' },
  { min: 15,  label: 'fra 15 min' },
  { min: 30,  label: 'fra 30 min' },
  { min: 60,  label: "fra un'ora" },
];

/** @param {Date} d @returns {string} "HH:MM" */
export function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** @param {Date} d @returns {string} "YYYY-MM-DD" nel fuso locale */
export const dayKey = ymd;

/**
 * L'ora che si ottiene aggiungendo `min` minuti a adesso, arrotondata al
 * minuto: è quello che scrivono le pastiglie «fra 15 min».
 * @param {number} min
 * @param {Date} [now]
 * @returns {string} "HH:MM"
 */
export function hhmmIn(min, now = new Date()) {
  return hhmm(new Date(now.getTime() + min * 60_000));
}

/**
 * Minuti dalla mezzanotte di un "HH:MM". null se non è un orario.
 * @param {string|null|undefined} s
 * @returns {number|null}
 */
export function minutesOf(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * L'identità di una singola suonata: la stessa sveglia di ieri e quella di
 * oggi sono due, la stessa sveglia guardata due volte oggi è una. È la chiave
 * con cui si ricorda di aver già suonato.
 * @param {string} taskId
 * @param {string} ora   "HH:MM"
 * @param {string} giorno "YYYY-MM-DD"
 * @returns {string}
 */
export function ringKey(taskId, ora, giorno) {
  return `${giorno}|${taskId}|${ora}`;
}

// Quanto indietro si guarda. Una sveglia delle 9:00 aperta alle 9:02 deve
// ancora suonare — l'app può essere stata aperta un attimo dopo, o il portatile
// essersi risvegliato. Una delle 9:00 aperta alle 11 no: a quel punto non è più
// un avviso, è un rimprovero.
export const RITARDO_MAX_MIN = 10;

/**
 * Le sveglie che devono suonare adesso: le attività non completate la cui ora
 * è arrivata (o è passata da poco) e che non hanno già suonato oggi.
 *
 * @param {import('./taskStore').Task[]} tasks
 * @param {(t: import('./taskStore').Task) => string|null} alarmOf  legge l'ora dal task
 * @param {Set<string>} suonate  le chiavi già suonate (vedi ringKey)
 * @param {Date} [now]
 * @returns {{ task: import('./taskStore').Task, ora: string, key: string }[]}
 */
export function sveglieDaSuonare(tasks, alarmOf, suonate, now = new Date()) {
  const oraOra = now.getHours() * 60 + now.getMinutes();
  const giorno = dayKey(now);
  const out = [];
  for (const t of tasks || []) {
    if (t?.stato === 'done') continue;
    const ora = alarmOf(t);
    const min = minutesOf(ora);
    if (min === null || !ora) continue;
    const ritardo = oraOra - min;
    if (ritardo < 0 || ritardo > RITARDO_MAX_MIN) continue;
    const key = ringKey(t.id, ora, giorno);
    if (suonate.has(key)) continue;
    out.push({ task: t, ora, key });
  }
  return out;
}

// ── Memoria delle suonate ────────────────────────────────────────────────────
// Su localStorage, perché è per forza per macchina: la sveglia serve a farsi
// sentire *qui*, e una suonata sul portatile non deve zittire quella sul fisso.
// Si tengono solo le chiavi di oggi e di ieri — di più non serve a niente.

const STORAGE_KEY = 'md_sveglie_suonate_v1';

/**
 * @param {Date} [now]
 * @returns {Set<string>}
 */
export function leggiSuonate(now = new Date()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return new Set();
    const ieri = dayKey(new Date(now.getTime() - 86_400_000));
    const oggi = dayKey(now);
    return new Set(list.filter(k => typeof k === 'string' && (k.startsWith(oggi) || k.startsWith(ieri))));
  } catch { return new Set(); }
}

/**
 * @param {Set<string>} suonate
 * @param {Date} [now]
 */
export function scriviSuonate(suonate, now = new Date()) {
  try {
    const ieri = dayKey(new Date(now.getTime() - 86_400_000));
    const oggi = dayKey(now);
    const tenute = [...suonate].filter(k => k.startsWith(oggi) || k.startsWith(ieri));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tenute));
  } catch { /* storage pieno o negato: le sveglie ricominceranno da capo */ }
}

// ── Il suono ─────────────────────────────────────────────────────────────────
// Sintetizzato invece che caricato da un file: nessun asset da servire e da
// tenere nella cache offline, e un'onda quadra a due note è esattamente quel
// che serve — deve farsi sentire, non essere bella.

/**
 * Tre rintocchi. Restituisce una funzione che li ferma, perché il pannello
 * dell'avviso deve poter tacere appena lo si chiude.
 * @returns {() => void}
 */
export function suona() {
  /** @type {any} */
  const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
  if (!Ctx) return () => {};
  /** @type {AudioContext} */
  let ctx;
  try {
    ctx = new Ctx();
  } catch { return () => {}; }
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.connect(gain);

  const t0 = ctx.currentTime;
  // Due note alternate, tre volte: un rintocco solo si confonde con una
  // notifica qualunque del sistema.
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.55;
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.18);
    // Rampe esponenziali: uno 0 secco fa "click" negli altoparlanti.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
  }
  osc.start(t0);
  osc.stop(t0 + 1.8);

  return () => {
    try { osc.stop(); } catch { /* già fermo */ }
    try { ctx.close(); } catch { /* già chiuso */ }
  };
}

// ── Notifica di sistema ──────────────────────────────────────────────────────
// L'unica parte che arriva anche quando la mente digitale è in un'altra scheda
// o dietro un'altra finestra — che è il caso normale: se si sta lavorando,
// davanti c'è il lavoro, non il pianificatore.

/** @returns {boolean} */
export function notificheSupportate() {
  return typeof Notification !== 'undefined';
}

/** @returns {'granted'|'denied'|'default'|'unsupported'} */
export function statoNotifiche() {
  if (!notificheSupportate()) return 'unsupported';
  return /** @type {any} */ (Notification.permission);
}

/** @returns {Promise<boolean>} */
export async function chiediNotifiche() {
  if (!notificheSupportate()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

/**
 * @param {string} titolo
 * @param {string} corpo
 * @returns {Notification|null}
 */
export function notifica(titolo, corpo) {
  if (!notificheSupportate() || Notification.permission !== 'granted') return null;
  try {
    // `requireInteraction` la lascia sullo schermo finché non la si tocca:
    // una notifica che sparisce da sola dopo cinque secondi è esattamente
    // quello che una sveglia non deve fare.
    return new Notification(titolo, { body: corpo, requireInteraction: true, tag: 'mente-sveglia' });
  } catch { return null; }
}
