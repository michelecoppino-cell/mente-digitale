// @ts-check
// Oggi: la home, di sola lettura.
//
// L'app si apriva sulla mappa mentale — una vista dello spazio, non del tempo.
// Aprendo il portatile la domanda però è «cosa succede oggi», e la risposta
// stava sparsa fra tre pannelli da aprire a mano. Qui non c'è niente di nuovo
// da salvare: è una lettura delle strutture che già esistono (il piano del
// giorno, il calendario, le attività), messe in fila nell'ordine in cui
// servono.
//
// Nessuna lista è "di Oggi": tutto è una query sul giorno corrente.
//
// ── La forma della scheda ──────────────────────────────────────────────────
// Due metà. A sinistra la **giornata operativa**: quello che ha un'ora, in un
// elenco solo — un appuntamento e un'azione programmata sono la stessa cosa
// alle 15:30, e tenerli in due riquadri voleva dire ricomporre a mente la
// giornata leggendo due colonne. Sotto, «In arrivo»: i giorni che vengono.
// A destra la **vita**: gli obiettivi del mese, il movimento, quello che c'è
// da leggere e vedere; e in una colonna sua, della stessa larghezza, i tre
// riquadri riservati.
//
// La metà sinistra sta in una schermata sola e non allunga la pagina: se
// l'elenco non ci sta, scorre dentro il suo riquadro. Una scheda che si apre
// la mattina e resta aperta tutto il giorno deve avere sempre la stessa forma,
// e una pagina che si allunga di mezzo schermo il martedì è una pagina in cui
// ci si perde.
//
// Prima era una colonna sola di riquadri scollegati, e i giorni senza blocchi
// programmati lasciavano mezza schermata vuota. La divisione non è estetica:
// la metà sinistra invecchia nell'arco della giornata, la metà destra
// nell'arco del mese, e tenerle vicine ma separate è quello che permette alla
// scheda di avere sempre la stessa forma anche quando l'agenda è vuota.
//
// ── I riquadri riservati ───────────────────────────────────────────────────
// Bussola, Finanze e Diario. Sono i tre riquadri che non si vogliono lasciare
// leggere alle spalle di chi lavora, e stanno in una colonna sola: un velo per
// colonna invece di tre veli sparsi in mezzo alle cose pubbliche. Larga come
// quella accanto e non più stretta: sono i tre riquadri con dentro le cifre e
// le frasi intere, e in 280px andavano a capo tutti. Partono
// visibili e si coprono con un tocco — il verso del gesto, e il perché, stanno
// in riservati.js.
//
// ── Il rituale del mattino ─────────────────────────────────────────────────
// L'unico pannello che si apre da solo: la prima volta che si entra qui in una
// giornata, chiede se movimento, meditazione e yoga sono stati fatti. Il perché
// del momento e delle caselle già despuntate sta in rituale.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  loadCoda, loadDiaryIndex, loadDiaryMonth, loadIdentityDoc, loadObiettivi, loadRituale,
} from './api';
import { parseWishes, wishSection, wishOfTheDay } from './wishes';
import { entryOfTheDay, dailyIndex, excerpt, monthKey, shiftMonth } from './diary';
import { taskContext, taskStatus, contextColor, inboxListId, indexScheduled } from './taskModel';
import {
  MAX_IN_CODA, MAX_IN_CORSO, dominio, etichettaAvanzamento, etichettaTipo, inCoda, inCorso, quota,
} from './coda';
import { giorniRestanti, meseDi, obiettiviDelMese, risolvi } from './obiettivi';
import SensitiveCard from './SensitiveCard';
import { Matita } from './Matita';
import MovimentoCard from './MovimentoCard';
import { useRegistroMovimento } from './registroMovimento';
import ObiettiviModal from './ObiettiviModal';
import CodaModal from './CodaModal';
import RitualeMattino from './RitualeMattino';
import { useRiservatiVisibili } from './riservati';
import { readPref, writePref } from './viewPrefs';
import { caricaRiepilogoOggi } from './finanze/riepilogoOggi';
import './TodayView.css';

/** 'YYYY-MM-DD' locale. */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Minuti da mezzanotte di una "HH:MM". */
function t2m(/** @type {string} */ t) {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

function fmtHours(/** @type {number} */ min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** L'ora di inizio di un evento Graph, come "HH:MM". */
function evTime(/** @type {any} */ iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** I minuti da mezzanotte di un evento Graph; -1 se dura tutto il giorno. */
function evMin(/** @type {any} */ iso) {
  if (!iso) return -1;
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.getHours() * 60 + d.getMinutes();
}

/** La data locale 'YYYY-MM-DD' di un evento Graph. */
function evDate(/** @type {any} */ iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return todayStr(d);
}

/** Iniziali per il cerchietto delle ricorrenze. */
function initials(/** @type {string} */ name) {
  return (name || '?')
    .replace(/complean\w*\s+(di\s+)?/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}

const RECURRENCE_RE = /complean|ricorrenz|anniversar|onomastic/i;

/** Una ricorrenza è un evento come gli altri, solo che torna ogni anno. */
function isRecurrence(/** @type {any} */ e) {
  return RECURRENCE_RE.test(e._calName || '') || RECURRENCE_RE.test(e.subject || '');
}

/** "ven 22" — l'etichetta di una data futura in agenda. */
function fmtDayLabel(/** @type {string} */ ymd) {
  return new Date(ymd + 'T00:00:00')
    .toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })
    .replace('.', '');
}

/** "25 ago" — una data breve, per le righe di servizio. */
function fmtBreve(/** @type {string} */ ymd) {
  return new Date(ymd + 'T00:00:00')
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
    .replace('.', '');
}

/** "martedì 12 marzo 2024" — la data per esteso, in testa a una voce di diario
 *  aperta: lì l'anno conta, perché il senso di rileggersi è la distanza. */
function fmtLungo(/** @type {string} */ ymd) {
  return new Date(ymd + 'T00:00:00')
    .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Giorni interi fra due 'YYYY-MM-DD'. */
function daysBetween(/** @type {string} */ from, /** @type {string} */ to) {
  return Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86_400_000);
}

// Quanto lontano guarda la parte «in arrivo» dell'agenda. Le due finestre sono
// diverse di proposito: un appuntamento fra tre settimane non è cosa di oggi e
// sta nel Piano, mentre un compleanno fra tre settimane è esattamente il tipo
// di cosa che si vuole vedere in anticipo, perché richiede di preparare
// qualcosa.
const AHEAD_APPOINTMENTS = 7;
const AHEAD_RECURRENCES = 30;
const AHEAD_MAX_ROWS = 5;

/**
 * Giorni consecutivi di diario che finiscono oggi (o ieri: la giornata non è
 * ancora finita, e azzerare la striscia alle 00:01 sarebbe una punizione per
 * qualcosa che non è ancora successo).
 * @param {string[]} dates  'YYYY-MM-DD', anche ripetute
 * @returns {number}
 */
function diaryStreak(dates) {
  const set = new Set(dates);
  const today = new Date();
  let cursor = new Date(today);
  if (!set.has(todayStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(todayStr(cursor))) return 0;
  }
  let n = 0;
  while (set.has(todayStr(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/**
 * Carica quel tanto di diario che serve alla striscia: mese corrente e
 * precedente. Oltre non serve — una striscia più lunga di due mesi si
 * racconta lo stesso come «60 giorni di fila».
 *
 * Tiene solo le **date**, non i testi: servono alla striscia, alle sette
 * barrette e all'obiettivo «diario ogni giorno», e nessuna delle tre ha
 * bisogno di sapere cosa c'è scritto. Il testo si legge altrove e solo dopo il
 * PIN (vedi useVoceDelGiorno).
 */
function useDiarioDate() {
  const [stato, setStato] = useState(/** @type {{date: string[], index: any}|null} */ (null));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadDiaryIndex();
        const wanted = [monthKey(), shiftMonth(monthKey(), -1)];
        const months = wanted.filter(m => !index?.months || index.months.includes(m));
        const dates = [];
        for (const m of months) {
          const entries = await loadDiaryMonth(m);
          for (const e of entries || []) if (e?.date && !e.sealed) dates.push(e.date);
        }
        if (!cancelled) setStato({ date: dates, index });
      } catch (e) {
        console.error('striscia diario', e);
        if (!cancelled) setStato({ date: [], index: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return stato;
}

/**
 * Una lettura da OneDrive tenuta per tutta la sessione, con un modo di
 * rileggerla dopo una scrittura.
 *
 * Serve due volte identica — obiettivi e coda — e sono due file che si aprono
 * a ogni ingresso in «Oggi» e cambiano una volta ogni tanto: rileggerli
 * passando da un'altra vista e tornando sarebbe una richiesta buttata via.
 * @template T
 * @param {() => Promise<T>} leggi
 * @param {T} vuoto
 * @returns {{ dato: T, aggiorna: (d: T) => void }}
 */
function useDatoOneDrive(leggi, vuoto) {
  const [dato, setDato] = useState(/** @type {T} */ (vuoto));
  useEffect(() => {
    let annullato = false;
    leggi()
      .then(d => { if (!annullato) setDato(d); })
      .catch(e => { console.error('lettura OneDrive', e); });
    return () => { annullato = true; };
    // `leggi` è una funzione importata, stabile fra i render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { dato, aggiorna: useCallback((/** @type {T} */ d) => setDato(d), []) };
}

/** Il giorno in cui il rituale del mattino è già stato proposto. */
const PREF_RITUALE = 'oggi.rituale.propostoIl.v1';

/**
 * Il rituale del mattino, letto una volta per sessione.
 *
 * Ha un hook suo e non usa useDatoOneDrive per un motivo che conta: qui `null`
 * deve restare distinguibile da `{}`. Il pannello che si apre da solo decide
 * quali giorni tappare guardando quello che manca nel documento, e aprirlo
 * prima che il documento sia arrivato vorrebbe dire dichiarare scoperti dei
 * giorni già compilati — e riscriverli come «non fatto».
 */
function useRituale() {
  const [doc, setDoc] = useState(/** @type {Record<string, import('./types').RitualeGiorno>|null} */ (null));
  useEffect(() => {
    let annullato = false;
    loadRituale()
      .then(d => { if (!annullato) setDoc(d); })
      .catch(e => {
        console.error('rituale', e);
        // Un errore di lettura non deve far scrivere: con un documento finto
        // vuoto il pannello tapperebbe tre giorni che magari erano compilati.
        if (!annullato) setDoc(null);
      });
    return () => { annullato = true; };
  }, []);
  return { doc, setDoc };
}

/**
 * @param {Object} props
 * @param {Record<string, import('./types').DayPlan>} props.plans
 * @param {import('./types').TodoTask[]} props.tasks
 * @param {import('./types').TodoList[]} [props.todoLists]
 * @param {import('./types').CalendarEvent[]} props.calendarEvents
 * @param {(block: any) => void} props.onCompleteBlock
 * @param {(which: 'bussola'|'visione'|'desideri') => void} props.onOpenIdentity
 */
export default function TodayView({ plans, tasks, todoLists, calendarEvents, onCompleteBlock, onOpenIdentity }) {
  // Un tick al minuto: basta a far passare la giornata sotto le righe — quali
  // sono già passate, e il cambio di data a mezzanotte — senza ricaricare.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = todayStr(now);
  const ym = meseDi(today);
  const { docs: identityDocs } = useIdentityDocs();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const diario = useDiarioDate();

  // Le sessioni di movimento si leggono qui e non dentro il riquadro: servono
  // anche agli obiettivi del mese («Palestra 7/12»), e leggerle due volte
  // vorrebbe dire due richieste per lo stesso file e due verità che possono
  // divergere fra un riquadro e quello accanto.
  const registro = useRegistroMovimento(today);
  const { dato: obiettiviDoc, aggiorna: aggiornaObiettivi } = useDatoOneDrive(loadObiettivi, /** @type {any} */ ({}));
  const { dato: coda, aggiorna: aggiornaCoda } = useDatoOneDrive(loadCoda, /** @type {import('./types').VoceCoda[]} */ ([]));
  const { doc: rituale, setDoc: setRituale } = useRituale();

  const [modale, setModale] = useState(/** @type {'obiettivi'|'coda'|null} */ (null));

  // Il rituale del mattino si apre da solo una volta per giornata. La
  // condizione si calcola durante il render e non dentro un effetto: aprire un
  // pannello non è sincronizzarsi con un sistema esterno, è una conseguenza di
  // quello che si sa già — il giorno di oggi, il giorno dell'ultima proposta, e
  // se i due file sono arrivati.
  //
  // Si aspettano davvero: aprirlo con il registro ancora in volo vorrebbe dire
  // caselle despuntate su sessioni già registrate, cioè chiedere di rispondere
  // a una domanda a cui si è già risposto.
  const [propostoIl, setPropostoIl] = useState(() => readPref(PREF_RITUALE, null));
  // `auto` distingue il pannello che si apre da solo la mattina da quello
  // riaperto a mano: cambia la frase in cima, non il resto.
  const [ritualeAMano, setRitualeAMano] = useState(false);

  const ritualePronto = rituale !== null && registro.voci !== null;
  const ritualeAperto = ritualeAMano
    ? { auto: false }
    : (ritualePronto && propostoIl !== today ? { auto: true } : null);

  function chiudiRituale() {
    // La giornata si segna alla chiusura e non all'apertura: chi ricarica la
    // pagina prima di rispondere se lo ritrova davanti, che è il
    // comportamento giusto per una domanda che va fatta una volta al giorno.
    writePref(PREF_RITUALE, today);
    setPropostoIl(today);
    setRitualeAMano(false);
  }

  const blocks = useMemo(
    () => [...(plans?.[today]?.blocks || [])].sort((a, b) => t2m(a.startTime) - t2m(b.startTime)),
    [plans, today]
  );

  const taskById = useMemo(() => new Map((tasks || []).map(t => [t.id, t])), [tasks]);

  // Quante cose aspettano di essere chiarite: è il numero che decide se vale
  // la pena passare dall'Inbox oggi. Sta in testata e non in un riquadro
  // perché non è una cosa da leggere, è una cosa da fare (o da non fare).
  const daChiarire = useMemo(() => {
    const inbox = inboxListId(todoLists || []);
    if (!inbox) return 0;
    const scheduledIds = new Set(indexScheduled(plans).keys());
    return (tasks || []).filter(t => taskStatus(t, { scheduledIds, inboxListId: inbox }) === 'inbox').length;
  }, [tasks, todoLists, plans]);

  // Agenda e Ricorrenze erano due riquadri lontani fra loro, ma sono la stessa
  // cosa: eventi del calendario Microsoft, tagliati su due finestre di tempo
  // diverse. Tenerli separati voleva dire che il compleanno di oggi finiva
  // nella colonna di destra, in mezzo a quelli fra tre settimane, invece che in
  // agenda accanto agli altri impegni della giornata. Qui c'è una sola
  // cronologia: prima oggi, poi quello che arriva.
  const { events, ahead, aheadTotale } = useMemo(() => {
    const all = (calendarEvents || [])
      .map(e => ({ e, date: evDate(e.start?.dateTime), rec: isRecurrence(e) }))
      .filter(x => x.date >= today)
      .sort((a, b) => (a.e.start?.dateTime || '').localeCompare(b.e.start?.dateTime || ''));
    const futuri = all.filter(x => {
      const gap = daysBetween(today, x.date);
      if (gap <= 0) return false;
      return gap <= (x.rec ? AHEAD_RECURRENCES : AHEAD_APPOINTMENTS);
    });
    return {
      events: all.filter(x => x.date === today),
      ahead: futuri.slice(0, AHEAD_MAX_ROWS),
      aheadTotale: futuri.length,
    };
  }, [calendarEvents, today]);

  // La giornata in un elenco solo. Un appuntamento delle 15:30 e un'azione
  // programmata alle 15:30 sono la stessa cosa per chi legge: due riquadri
  // separati obbligavano a ricomporre la giornata a mente, alternando lo
  // sguardo fra due colonne di orari. Gli eventi di tutto il giorno stanno in
  // cima, che è dove stanno anche in un calendario.
  const righeOggi = useMemo(() => {
    /** @type {{chiave: string, min: number, evento: any, rec: boolean, blocco: any}[]} */
    const righe = [
      ...events.map(({ e, rec }) => ({
        chiave: `ev-${e.id}`,
        min: e.isAllDay ? -1 : evMin(e.start?.dateTime),
        evento: e,
        rec,
        blocco: null,
      })),
      ...blocks.map(b => ({
        chiave: `az-${b.id}`,
        min: t2m(b.startTime),
        evento: null,
        rec: false,
        blocco: b,
      })),
    ];
    // A parità di ora l'appuntamento viene prima dell'azione: l'ora di un
    // evento è un vincolo preso con qualcun altro, quella di un blocco è una
    // decisione che si può ancora spostare.
    return righe.sort((a, b) => a.min - b.min || ((a.blocco ? 1 : 0) - (b.blocco ? 1 : 0)));
  }, [events, blocks]);

  const plannedMin = blocks.reduce((sum, b) => sum + Math.max(0, t2m(b.endTime) - t2m(b.startTime)), 0);
  const fatte = blocks.filter(b => b.completed).length;
  const dateLabel = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  const summary = [
    `${events.length} ${events.length === 1 ? 'evento' : 'eventi'}`,
    `${blocks.length} ${blocks.length === 1 ? 'azione programmata' : 'azioni programmate'}`,
    plannedMin ? `${fmtHours(plannedMin)} pianificate` : null,
  ].filter(Boolean).join(' · ');

  // I registri da cui gli obiettivi derivabili prendono il loro numero: sono
  // gli stessi dati che disegnano gli altri riquadri, non una seconda lettura.
  const registri = useMemo(() => ({
    movimento: registro.voci || [],
    diario: diario?.date || [],
    coda,
  }), [registro.voci, diario, coda]);

  const obiettivi = useMemo(
    () => obiettiviDelMese(obiettiviDoc, ym).map(o => risolvi(o, registri, ym, today)),
    [obiettiviDoc, ym, registri, today]
  );

  return (
    <div className="today">
      <header className="today-head">
        <div>
          <h1 className="today-date">{dateLabel[0].toUpperCase() + dateLabel.slice(1)}</h1>
          <p className="today-summary">{summary}</p>
        </div>
        <div className="today-head-right">
          {daChiarire > 0 && (
            <Link className="today-pill" to="/attivita">
              <span className="today-pill-dot" />
              {daChiarire} {daChiarire === 1 ? 'cosa da chiarire' : 'cose da chiarire'}
            </Link>
          )}
        </div>
      </header>

      <div className="today-grid">
        {/* ── Metà operativa: le cose che hanno un'ora ────────────────────── */}
        <div className="today-col">
          {/* ── Oggi: agenda e azioni, in un elenco solo ────────────────── */}
          <section className="today-block today-oggi">
            <div className="today-block-head">
              <span className="eyebrow">Oggi · agenda e azioni</span>
              {blocks.length > 0 && (
                <span className="today-block-conta">
                  {fatte} su {blocks.length} {fatte === 1 ? 'fatta' : 'fatte'}
                  {plannedMin ? ` · ${fmtHours(plannedMin)}` : ''}
                </span>
              )}
            </div>
            <div className="today-lista">
              {righeOggi.length === 0 && (
                <p className="today-empty">Niente in agenda, e nessuna azione programmata.</p>
              )}
              {righeOggi.map(riga => (
                riga.evento
                  ? <EventRow key={riga.chiave} event={riga.evento} recurrence={riga.rec} passato={riga.min >= 0 && riga.min < nowMin} />
                  : <AzioneRow
                      key={riga.chiave}
                      blocco={riga.blocco}
                      task={taskById.get(riga.blocco.taskId)}
                      passato={riga.min < nowMin}
                      onCompleta={onCompleteBlock}
                    />
              ))}
            </div>
          </section>

          {/* ── In arrivo ──────────────────────────────────────────────── */}
          <section className="today-block today-arrivo">
            <div className="today-block-head">
              <span className="eyebrow">In arrivo</span>
              {aheadTotale > ahead.length && (
                <span className="today-block-conta">{aheadTotale} entro trenta giorni</span>
              )}
            </div>
            <div className="today-lista">
              {ahead.length === 0 && <p className="today-empty">Niente nei prossimi giorni.</p>}
              {ahead.map(({ e, date, rec }) => (
                <EventRow
                  key={`${e.id}-${date}`}
                  event={e}
                  recurrence={rec}
                  day={fmtDayLabel(date)}
                  soon={daysBetween(today, date) <= 1}
                />
              ))}
            </div>
          </section>
        </div>

        {/* ── Metà vita: quello che invecchia nell'arco di un mese ────────── */}
        <div className="today-vita">
          <div className="today-col-vita">
            <ObiettiviCard
              obiettivi={obiettivi}
              ym={ym}
              oggi={today}
              onCambia={() => setModale('obiettivi')}
            />

            <MovimentoCard
              today={today}
              calendarEvents={calendarEvents}
              registro={registro}
              rituale={rituale}
              onApriRituale={() => setRitualeAMano(true)}
            />

            <CodaCard voci={coda} onApri={() => setModale('coda')} />
          </div>

          {/* Tre riquadri, un velo solo: quello che non si legge alle spalle
              sta tutto nella stessa colonna. */}
          <div className="today-col-riservati">
            <BussolaCard docs={identityDocs} today={today} onOpenIdentity={onOpenIdentity} />
            <FinanzeCard />
            <DiarioCard diario={diario} today={today} />
          </div>
        </div>
      </div>

      {modale === 'obiettivi' && (
        <ObiettiviModal
          oggi={today}
          coda={coda}
          onSalvato={aggiornaObiettivi}
          onChiudi={() => setModale(null)}
        />
      )}
      {modale === 'coda' && (
        <CodaModal onSalvato={aggiornaCoda} onChiudi={() => setModale(null)} />
      )}
      {ritualeAperto && rituale !== null && (
        <RitualeMattino
          oggi={today}
          doc={rituale}
          voci={registro.voci || []}
          auto={ritualeAperto.auto}
          onSalvato={({ doc, creati, cancellati }) => {
            setRituale(doc);
            // Il registro si aggiorna in locale invece di rileggerlo: i file
            // li abbiamo appena scritti noi, e una seconda richiesta a
            // OneDrive per sapere quello che sappiamo già farebbe aspettare
            // le barre della settimana a metà animazione.
            const tolti = new Set(cancellati.map(v => v.id));
            registro.setVoci(prev => [...(prev || []).filter(v => !tolti.has(v.id)), ...creati]);
          }}
          onChiudi={chiudiRituale}
        />
      )}
    </div>
  );
}

/**
 * Una riga di agenda. È la stessa forma per un appuntamento di oggi, per un
 * compleanno di oggi e per uno fra tre settimane: cambia solo cosa sta nella
 * colonna di sinistra (l'ora, oppure il giorno) e il cerchietto con le
 * iniziali, che è il segno che distingue una ricorrenza da un impegno.
 * @param {Object} props
 * @param {any} props.event
 * @param {boolean} props.recurrence
 * @param {string} [props.day]  etichetta del giorno, per le righe «in arrivo»
 * @param {boolean} [props.soon]
 * @param {boolean} [props.passato]  già passato: nell'elenco di oggi si spegne
 */
function EventRow({ event, recurrence, day, soon, passato }) {
  const when = day || (event.isAllDay ? 'tutto il giorno' : evTime(event.start?.dateTime));
  return (
    <div className={`today-event${recurrence ? ' recurrence' : ''}${day ? ' ahead' : ''}${passato ? ' passato' : ''}`}>
      <span className={`today-event-time${soon ? ' soon' : ''}`}>{when}</span>
      {recurrence && <span className="today-rec-badge">{initials(event.subject || '')}</span>}
      <span className="today-event-title">{event.subject || '(senza titolo)'}</span>
      <span className="today-event-cal">{event._calName}</span>
    </div>
  );
}

/**
 * Una riga di azione programmata, nello stesso elenco degli appuntamenti.
 *
 * L'ora sta a sinistra come negli eventi, nella stessa colonna larga uguale:
 * è quello che permette di leggere la giornata scorrendo una colonna sola,
 * invece di cercare l'orario ora a destra ora a sinistra. Quello che distingue
 * le due righe è la casella — un evento non si completa, un'azione sì.
 * @param {Object} props
 * @param {any} props.blocco
 * @param {import('./types').TodoTask} [props.task]
 * @param {boolean} [props.passato]
 * @param {(block: any) => void} props.onCompleta
 */
function AzioneRow({ blocco, task, passato, onCompleta }) {
  const ctx = taskContext(task || /** @type {any} */ ({}));
  return (
    <div className={`today-action${blocco.completed ? ' done' : ''}${passato && !blocco.completed ? ' passato' : ''}`}>
      <span className="today-action-time">{blocco.startTime}</span>
      <button
        className="today-check"
        onClick={() => !blocco.completed && onCompleta(blocco)}
        disabled={blocco.completed}
        aria-label={blocco.completed ? 'Completata' : 'Segna come completata'}>
        {blocco.completed && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 12.5 9.5 18 20 6.5" />
          </svg>
        )}
      </button>
      <span className="today-action-title">{blocco.taskTitle}</span>
      {blocco.listName && (
        <span
          className="today-action-chip"
          style={/** @type {import('react').CSSProperties} */ ({ '--chip': contextColor(ctx) })}>
          {blocco.listName}
        </span>
      )}
    </div>
  );
}

/**
 * La testata di un riquadro: il titolo con la sua matita, e sotto la riga di
 * servizio.
 *
 * La riga di servizio — «4 gg alla fine», «3 in corso · 8 in coda» — stava a
 * destra sulla stessa riga del titolo, ed è lì che andava a sbattere contro la
 * matita. Scesa sotto diventa quello che è sempre stata: un sottotitolo, non
 * un secondo titolo che si contende la riga.
 * @param {{ eyebrow: string, meta?: import('react').ReactNode, matita?: {onClick?: () => void, to?: string, title: string} }} props
 */
function CardHead({ eyebrow, meta, matita }) {
  return (
    <div className="today-card-head">
      <div className="today-card-titolo">
        <span className="eyebrow">{eyebrow}</span>
        {matita && <Matita {...matita} />}
      </div>
      {meta ? <span className="today-card-meta">{meta}</span> : null}
    </div>
  );
}

/**
 * Una barra di avanzamento da tre pixel: la stessa forma per gli obiettivi,
 * per le letture e per i cento desideri.
 * @param {{ quota: number, colore?: string }} props
 */
function Barra({ quota, colore }) {
  return (
    <span className="today-barra">
      <i style={{ width: `${Math.max(0, Math.min(1, quota)) * 100}%`, background: colore }} />
    </span>
  );
}

/**
 * Gli obiettivi del mese: da tre a sei righe che dicono dove si vuole
 * arrivare entro il trentuno.
 *
 * Non è un elenco di cose da fare — quelle stanno in To-Do e hanno una loro
 * vista. È la domanda opposta: non «cosa faccio adesso» ma «di questo mese,
 * cosa voglio poter dire alla fine». Per questo sta nella metà destra, con le
 * cose che invecchiano lentamente, e per questo la riga di servizio dice i
 * giorni che restano: è l'unica cosa che cambia da sola.
 * @param {Object} props
 * @param {ReturnType<typeof risolvi>[]} props.obiettivi
 * @param {string} props.ym
 * @param {string} props.oggi
 * @param {() => void} props.onCambia
 */
function ObiettiviCard({ obiettivi, ym, oggi, onCambia }) {
  const restano = giorniRestanti(ym, oggi);
  const nomeMese = new Date(`${ym}-01T00:00:00`).toLocaleDateString('it-IT', { month: 'long' });

  return (
    <section className="today-card today-obiettivi">
      <CardHead
        eyebrow={`Obiettivi di ${nomeMese}`}
        meta={restano > 0 ? `${restano} ${restano === 1 ? 'giorno' : 'gg'} alla fine` : 'mese chiuso'}
        matita={{ onClick: onCambia, title: 'Cambia gli obiettivi' }}
      />

      {obiettivi.length === 0 ? (
        <p className="today-empty">Nessun obiettivo per questo mese.</p>
      ) : (
        <div className="today-ob-griglia">
          {obiettivi.map(o => (
            <div className="today-ob" key={o.id}>
              <div className="today-ob-riga">
                <span className="today-ob-titolo" title={o.titolo}>{o.titolo}</span>
                <span className="today-ob-num">{o.fatti}/{o.totale}</span>
              </div>
              {/* Fuori passo è rosso, il resto è ocra. Non c'è un verde per
                  «in anticipo»: essere avanti non è una notizia, essere
                  indietro sì. */}
              <Barra quota={o.quota} colore={o.fuoriPasso ? 'var(--danger)' : undefined} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * «Da leggere e vedere»: quello che si sta leggendo, e quello che aspetta.
 *
 * Erano due cose separate nella testa prima che nell'app — le letture da una
 * parte, i link messi da parte dall'altra — ma la domanda è una: *cosa avevo
 * detto che volevo leggere o vedere?*. In corso a sinistra perché è quello che
 * si finisce; la coda a destra perché è quello che si sceglie.
 * @param {{ voci: import('./types').VoceCoda[], onApri: () => void }} props
 */
function CodaCard({ voci, onApri }) {
  const correnti = inCorso(voci).slice(0, MAX_IN_CORSO);
  const attesa = inCoda(voci).slice(0, MAX_IN_CODA);
  const nCorso = inCorso(voci).length;
  const nCoda = inCoda(voci).length;

  return (
    <section className="today-card today-coda">
      <CardHead
        eyebrow="Da leggere e vedere"
        meta={`${nCorso} in corso · ${nCoda} in coda`}
        matita={{ onClick: onApri, title: 'Apri la coda' }}
      />

      {voci.length === 0 ? (
        <p className="today-empty">Niente in lettura. Un link incollato qui dentro diventa una riga.</p>
      ) : (
        <div className="today-coda-griglia">
          <div className="today-coda-col">
            <span className="today-sotto">In corso</span>
            {correnti.length === 0 && <p className="today-empty">Niente aperto.</p>}
            {correnti.map((v, i) => (
              <div className="today-lettura" key={v.id}>
                <div className="today-lettura-riga">
                  <span className="today-lettura-titolo" title={v.titolo}>{v.titolo}</span>
                  <span className="today-tag">{etichettaTipo(v.tipo)}</span>
                </div>
                <div className="today-lettura-meta">
                  <span>{v.fonte || dominio(v.url) || ''}</span>
                  <span>{etichettaAvanzamento(v)}</span>
                </div>
                {/* Piena solo la prima: è quella più vicina alla fine, e la
                    fine è l'unico modo in cui una coda si accorcia. */}
                <Barra quota={quota(v)} colore={i === 0 ? undefined : 'var(--accent-line)'} />
              </div>
            ))}
          </div>

          <div className="today-coda-col">
            <span className="today-sotto">In coda</span>
            {attesa.length === 0 && <p className="today-empty">Coda vuota.</p>}
            {attesa.map(v => (
              <div className="today-coda-riga" key={v.id}>
                <span className={`today-coda-titolo${v.url ? '' : ' spenta'}`} title={v.titolo}>{v.titolo}</span>
                {v.url
                  ? <span className="today-coda-dom">{dominio(v.url)}</span>
                  : <span className="today-tag">{etichettaTipo(v.tipo)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// La Bussola sta su OneDrive e cambia una volta ogni tanto: una volta letta
// resta qui per tutta la sessione, così passare da Oggi a un'altra vista e
// tornare non rifà la chiamata.
//
// Si legge un documento solo, e non più anche la Visione: da quando il
// riquadro non ne mostra l'assaggio, quella lettura era mezza schermata di
// testo scaricata per non mostrarla a nessuno. La porta della Visione resta —
// apre il documento intero, che è il posto in cui si legge davvero.
/** @type {{bussola: any}|null} */
let identityMemo = null;

/** @returns {{docs: {bussola: any}|null}} */
function useIdentityDocs() {
  const [docs, setDocs] = useState(identityMemo);
  useEffect(() => {
    if (identityMemo) return;
    let cancelled = false;
    loadIdentityDoc('bussola')
      .catch(() => null)
      .then(bussola => {
        identityMemo = { bussola };
        if (!cancelled) setDocs(identityMemo);
      });
    return () => { cancelled = true; };
  }, []);
  return { docs };
}

/** Bussola: la rosa dei venti — la porta del documento che dà il nome al riquadro. */
function CompassIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.2 8.8l-1.9 4.5-4.5 1.9 1.9-4.5z" />
    </svg>
  );
}

/** Visione: un occhio — quello che si vede da qui a dieci anni. */
function VisionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/**
 * I cento desideri: il numero e basta.
 *
 * Era un elenco puntato, cioè il disegno di una lista qualsiasi accanto a due
 * simboli che dicevano una cosa precisa. «100» dice il nome del documento —
 * quello per cui il riquadro tiene una barra che si riempie — senza chiedere
 * di indovinare.
 */
function CentoIcon() {
  return <span className="today-cento" aria-hidden="true">100</span>;
}

/**
 * Bussola: il desiderio del giorno, dove sto andando, e le tre porte.
 *
 * Erano due riquadri: «I cento desideri» e «Bussola», uno sopra l'altro nella
 * stessa colonna. Ma leggono lo stesso documento — i cento desideri sono una
 * sezione della Bussola, non un altro testo — e da quando entrambi sono dietro
 * il PIN, tenerli separati voleva dire due veli identici in fila, due bottoni
 * «Inserisci il PIN» a due centimetri l'uno dall'altro, e due volte la stessa
 * etichetta per la stessa cosa.
 *
 * Fusi, l'ordine dice quello che conta: il desiderio di oggi in alto, perché è
 * la riga che si guarda tutti i giorni; e in fondo le tre porte, per quando si
 * vuole leggere un documento intero.
 *
 * Ne compare un desiderio solo. Quaranta righe in colonna sono un elenco da
 * scorrere; una riga sola è una cosa a cui pensare.
 *
 * L'assaggio di Visione — le prime 130 lettere del documento — non c'è più.
 * Era sempre lo stesso incipit, tagliato a metà parola, e dopo una settimana
 * non lo si leggeva più: tre righe di altezza spese per una frase imparata a
 * memoria, in una colonna in cui il Diario finiva fuori schermo.
 * @param {{ docs: any, today: string, onOpenIdentity?: (which: 'bussola'|'visione'|'desideri') => void }} props
 */
function BussolaCard({ docs, today, onOpenIdentity }) {
  const wishes = useMemo(() => parseWishes(wishSection(docs?.bussola)?.content || ''), [docs]);
  const wish = wishOfTheDay(wishes, today);

  return (
    <SensitiveCard
      className="today-bussola"
      eyebrow="Bussola"
      nota="Il desiderio di oggi e le porte dei documenti.">
      {!docs && <p className="today-empty">…</p>}
      {docs && (
        wish
          ? <p className="today-compass-wish">{wish.text}</p>
          : <p className="today-empty">Ancora nessun desiderio scritto.</p>
      )}
      {/* Il gruppo del desiderio a sinistra, quanti ne sono scritti a destra:
          due dati diversi che stavano in fila separati da un punto, e si
          leggevano come una frase sola. Ai due capi della riga si vede subito
          che sono due cose — e «39/100» è la stessa forma di «4/12» degli
          obiettivi, che è quello che è: un contatore con un traguardo. */}
      {wish && (
        <div className="today-compass-count">
          <span>{wish.group || ''}</span>
          {wishes.length > 0 && <span className="today-compass-num">{wishes.length}/100</span>}
        </div>
      )}

      {/* Quanto manca ai cento. La frase sotto («39 su 100 desideri scritti»)
          non c'è più: diceva a parole quello che la barra disegna e il
          contatore qui sopra scrive in cifre. */}
      {wishes.length > 0 && <Barra quota={wishes.length / 100} colore="var(--accent-line)" />}

      <div className="today-compass-links">
        <button type="button" onClick={() => onOpenIdentity?.('bussola')} title="La Bussola" aria-label="La Bussola"><CompassIcon /></button>
        <button type="button" onClick={() => onOpenIdentity?.('visione')} title="La Visione" aria-label="La Visione"><VisionIcon /></button>
        <button type="button" onClick={() => onOpenIdentity?.('desideri')} title="I cento desideri" aria-label="I cento desideri"><CentoIcon /></button>
      </div>
    </SensitiveCard>
  );
}

// I colori delle cifre sono gli stessi della scheda Saldo — grigio per il
// grezzo, blu per il netto tasse, verde per il patrimonio. Ripetuti qui a mano
// e non importati: stanno in Saldo.tsx dentro il chunk di Finanze, e tirarsi
// dietro mezzo megabyte di recharts per tre stringhe esadecimali sarebbe il
// contrario di quello che fa `caricaRiepilogoOggi`.
const COLORI_SALDO = {
  grezzo: '#8a94a6',
  nettoTasse: '#4c78a8',
  totale: '#54a24b',
};

/** 'YYYY-MM-DD' → "12 mar 2026". */
function fmtDataDato(/** @type {string} */ iso) {
  return new Date(iso + 'T00:00:00')
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace('.', '');
}

/**
 * Finanze in Oggi: il patrimonio in evidenza, tre cifre di contorno e la porta
 * della sezione.
 *
 * Prima qui non compariva nessun numero — solo un invito a entrare — e il
 * riquadro occupava spazio senza dire niente. Le cifre ci sono, ma dietro il
 * PIN: sono le stesse del «Riepilogo (oggi)» della scheda Saldo, calcolate
 * dalla stessa catena e caricate solo dopo lo sblocco.
 */
function FinanzeCard() {
  const visibile = useRiservatiVisibili();
  // Un solo stato e non due (dato + «sto caricando»): il caricamento è
  // semplicemente «sbloccato ma esito ancora null», e tenerlo in un booleano
  // a parte vorrebbe dire accenderlo dentro l'effetto, cioè un render in più
  // a ogni sblocco.
  /** @typedef {{ tipo: 'ok', riep: import('./finanze/riepilogoOggi').RiepilogoOggi } | { tipo: 'vuoto' } | { tipo: 'errore' }} EsitoFinanze */
  const [esito, setEsito] = useState(/** @type {EsitoFinanze|null} */ (null));

  useEffect(() => {
    if (!visibile) return;
    let annullato = false;
    caricaRiepilogoOggi()
      .then(r => { if (!annullato) setEsito(r ? { tipo: 'ok', riep: r } : { tipo: 'vuoto' }); })
      .catch(e => {
        console.error('riepilogo finanze', e);
        if (!annullato) setEsito({ tipo: 'errore' });
      });
    return () => { annullato = true; };
  }, [visibile]);

  return (
    <SensitiveCard
      className="today-finanze-card"
      eyebrow="Finanze"
      azione={{ to: '/finanze', title: 'Apri Finanze' }}
      nota="Patrimonio, saldo grezzo e netto tasse all'ultimo dato.">
      {esito === null && <p className="today-empty">Calcolo in corso…</p>}
      {esito?.tipo === 'errore' && <p className="today-empty">Non sono riuscito a leggere i dati.</p>}
      {esito?.tipo === 'vuoto' && <p className="today-empty">Nessun movimento importato.</p>}
      {esito?.tipo === 'ok' && (
        /* Quattro righe uguali: etichetta a sinistra, cifra a destra. Il
           patrimonio stava fuori dalla fila, in corpo 20 — ma la dimensione è
           un modo di dire «guarda questa e non le altre», e le altre tre sono
           quelle che la spiegano. Resta verde, che basta a distinguerla.
           In cima la data: dice a quando sono ferme le tre cifre sotto, e una
           cifra di cui non si sa la data non si sa nemmeno leggere. */
        <div className="today-fin-righe">
          <FinRiga etichetta="Ultimo dato" valore={fmtDataDato(esito.riep.ultimoDato)} />
          <FinRiga etichetta="Patrimonio + immobili" valore={esito.riep.totaleConImmobili} colore={COLORI_SALDO.totale} />
          <FinRiga etichetta="Saldo grezzo" valore={esito.riep.grezzo} colore={COLORI_SALDO.grezzo} />
          <FinRiga etichetta="Netto tasse" valore={esito.riep.nettoTasse} colore={COLORI_SALDO.nettoTasse} />
        </div>
      )}
    </SensitiveCard>
  );
}

/**
 * Una riga del riepilogo: etichetta a sinistra, cifra a destra.
 * @param {{ etichetta: string, valore: string, colore?: string }} props
 */
function FinRiga({ etichetta, valore, colore }) {
  return (
    <div className="today-fin-riga">
      <span className="today-fin-etichetta">{etichetta}</span>
      <span className="today-fin-valore" style={colore ? { color: colore } : undefined}>{valore}</span>
    </div>
  );
}

/**
 * Legge una voce di diario vera da rileggere oggi.
 *
 * Il mese da cui pescarla si sceglie con la data e non a caso, come il
 * desiderio del giorno: due giorni diversi danno due mesi diversi, ma dentro
 * la stessa giornata la voce non cambia sotto gli occhi. Pescare dall'indice
 * intero e non dagli ultimi due mesi è metà del senso della cosa — l'interesse
 * di rileggersi cresce con la distanza, e una voce di due anni fa vale dieci
 * volte quella di martedì.
 *
 * Se il mese scelto non ha niente da rileggere si passa al successivo, e si
 * gira in tondo fino a farne il giro. È il motivo per cui il riquadro era
 * tornato a dire «Ancora niente da rileggere» pur avendo un archivio pieno:
 * un mese può esistere nell'indice ed essere vuoto — voci tutte nel cassetto,
 * un mese aperto e mai scritto, una riga rimasta senza testo — e con un
 * tentativo solo bastava che la data ne pescasse uno per mandare via la voce
 * del giorno fino all'indomani.
 *
 * I mesi si leggono uno alla volta e ci si ferma al primo che dà una voce: il
 * caso normale è che sia il primo, e leggerli tutti insieme vorrebbe dire
 * scaricare dieci anni di diario per mostrarne tre righe.
 *
 * Si carica **solo se il riquadro è scoperto**: è l'unico posto di «Oggi» in
 * cui il testo del diario esce da OneDrive, e come per Finanze non deve
 * uscirne affatto finché il riquadro è coperto.
 * @param {any} index          l'indice dei mesi del diario
 * @param {string} today
 * @param {boolean} attivo     il riquadro è visibile
 */
function useVoceDelGiorno(index, today, attivo) {
  // I mesi in ordine di tentativo: si parte da quello che sceglie la data —
  // così due giorni diversi danno due mesi diversi — e si prosegue in tondo.
  const mesi = useMemo(() => {
    const tutti = index?.months || [];
    if (!tutti.length) return [];
    const primo = dailyIndex(today, tutti.length);
    return tutti.map((/** @type {any} */ _, /** @type {number} */ i) => tutti[(primo + i) % tutti.length]);
  }, [index, today]);

  // `undefined` = sto ancora leggendo, `null` = non c'è niente da rileggere.
  // Due stati e non uno perché «carico…» e «non hai ancora scritto niente»
  // sono due cose diverse da dire, e la seconda è quella che invita a
  // scrivere.
  // Il risultato porta con sé la chiave della ricerca che l'ha prodotto: se il
  // giorno cambia a mezzanotte, o l'indice arriva dopo, la voce vecchia non
  // vale più — e dirlo con un confronto durante il render costa meno di un
  // setState in cima all'effetto, che sarebbe un render buttato via a ogni
  // giro.
  const chiave = mesi.length ? `${today}|${mesi[0]}|${mesi.length}` : '';
  const [trovato, setTrovato] = useState(/** @type {{chiave: string, voce: any}|null} */ (null));

  useEffect(() => {
    if (!attivo || !chiave) return;
    let annullato = false;
    (async () => {
      for (const mese of mesi) {
        /** @type {any} */
        let voce = null;
        try {
          voce = entryOfTheDay(await loadDiaryMonth(mese) || [], today);
        } catch (e) {
          console.error('voce del giorno', e);
        }
        if (annullato) return;
        if (voce) { setTrovato({ chiave, voce }); return; }
      }
      setTrovato({ chiave, voce: null });
    })();
    return () => { annullato = true; };
    // `mesi` è ricalcolato dagli stessi ingressi di `chiave`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave, today, attivo]);

  // Indice non ancora arrivato: si sta leggendo, non è vuoto. Prima qui si
  // rispondeva `null`, e il riquadro dichiarava l'archivio vuoto per la
  // frazione di secondo prima che l'indice atterrasse.
  if (!index) return undefined;
  if (!mesi.length) return null;
  if (trovato?.chiave !== chiave) return undefined;
  return trovato.voce;
}

/**
 * Diario: una voce di ieri o di due anni fa, e la striscia dei sette giorni.
 *
 * Era un invito e basta — «Due righe su com'è andata…» — cioè un bottone
 * travestito da riquadro. Un invito non si legge due volte: dopo la prima
 * settimana quello spazio non diceva più niente.
 *
 * Adesso dice una cosa vera: una delle voci già scritte, scelta con la data
 * come il desiderio del giorno. È lo stesso meccanismo dei cento desideri e per
 * la stessa ragione — l'archivio del diario esiste per essere riletto, e un
 * archivio che si apre solo se lo si va a cercare non viene riletto mai.
 *
 * E per questo sta fra i riquadri riservati insieme a Finanze e alla Bussola:
 * nel momento in cui ha smesso di mostrare un invito e ha cominciato a
 * mostrare quello che si è scritto una sera, è diventato la cosa più privata
 * della schermata che sta aperta tutto il giorno sulla scrivania — quella da
 * coprire con un tocco quando si alza lo sguardo e sta arrivando qualcuno.
 * @param {{ diario: {date: string[], index: any}|null, today: string }} props
 */
function DiarioCard({ diario, today }) {
  const visibile = useRiservatiVisibili();
  const voce = useVoceDelGiorno(diario?.index, today, visibile);
  const [aperta, setAperta] = useState(false);

  const date = useMemo(() => diario?.date || [], [diario]);
  const streak = useMemo(() => (diario ? diaryStreak(date) : null), [diario, date]);
  const ultima = useMemo(() => (date.length ? [...date].sort()[date.length - 1] : null), [date]);

  // I sette giorni fino a oggi: una barretta piena per ogni giorno con una
  // voce. Sette e non trenta perché la domanda è «sto scrivendo in questi
  // giorni», non «quanto ho scritto quest'anno».
  const settimana = useMemo(() => {
    const set = new Set(date);
    const out = [];
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      out.push({ g: todayStr(d), pieno: set.has(todayStr(d)) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [date, today]);

  return (
    <SensitiveCard
      className="today-diario-card"
      eyebrow="Diario"
      azione={{ to: '/diario', title: 'Apri il Diario' }}
      nota="La striscia dei sette giorni e una voce da rileggere.">
      {/* Via «Due righe su com'è andata…»: era un invito, e sotto c'è una voce
          vera. Un invito a scrivere in cima a una cosa scritta si legge come
          un'etichetta di quello che sta sotto, e non lo era. */}
      <div className="today-diary-week" aria-hidden="true">
        {settimana.map(x => (
          <span key={x.g} className={`today-diary-tacca${x.pieno ? ' pieno' : ''}`} />
        ))}
      </div>

      {voce === undefined && <p className="today-empty">…</p>}
      {voce === null && <p className="today-empty">Ancora niente da rileggere.</p>}
      {/* Nel riquadro ci stanno centodieci lettere, e una sera raccontata si
          taglia sempre a metà: il bottone apre la voce intera senza portare
          via da «Oggi». Aprire il Diario per leggere fino in fondo la riga che
          è comparsa da sola vuol dire cambiare schermata per finire una
          frase — e chi cambia schermata non torna. */}
      {voce && (
        <button type="button" className="today-diary-voce" onClick={() => setAperta(true)} title="Leggi la voce intera">
          <span className="today-diary-quando">
            {fmtBreve(voce.date)}
            <span className="today-diary-espandi" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h6v6M20 4l-7.5 7.5" />
                <path d="M10 20H4v-6M4 20l7.5-7.5" />
              </svg>
            </span>
          </span>
          <span className="today-diary-testo">«{excerpt(voce.text, 110)}»</span>
        </button>
      )}

      <span className="today-micro">
        {[
          streak === null ? '…' : streak > 0 ? `${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila` : 'Ricomincia la striscia',
          ultima ? `ultima voce ${fmtBreve(ultima)}` : null,
        ].filter(Boolean).join(' · ')}
      </span>

      {aperta && voce && <VoceIntera voce={voce} onChiudi={() => setAperta(false)} />}
    </SensitiveCard>
  );
}

/**
 * La voce del giorno per intero, sopra la scheda.
 *
 * Riusa l'involucro dei moduli di «Oggi» (.mq-overlay / .mq-sheet) come fanno
 * gli obiettivi e la coda: un quarto aspetto per la quarta finestrella
 * sarebbe stato un quarto modo di chiudere. Qui però non c'è niente da
 * salvare — si legge e si chiude — e infatti l'unico comando è «Chiudi».
 * @param {{ voce: any, onChiudi: () => void }} props
 */
function VoceIntera({ voce, onChiudi }) {
  useEffect(() => {
    function suTasto(/** @type {KeyboardEvent} */ e) { if (e.key === 'Escape') onChiudi(); }
    window.addEventListener('keydown', suTasto);
    return () => window.removeEventListener('keydown', suTasto);
  }, [onChiudi]);

  return (
    <div className="mq-overlay" onClick={onChiudi}>
      <div className="mq-sheet today-voce-sheet" onClick={e => e.stopPropagation()}>
        <div className="mq-head">
          <span className="mq-title">Diario</span>
          <span className="mq-date">{fmtLungo(voce.date)}</span>
        </div>

        {/* I capoversi restano capoversi: una sera scritta di getto ha degli a
            capo, e appiattirli in un blocco solo la rende una cosa che non si
            legge. */}
        <div className="today-voce-testo">
          {(voce.text || '').split(/\n{2,}/).map((/** @type {string} */ p, /** @type {number} */ i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="mq-actions">
          <button type="button" className="mq-annulla" onClick={onChiudi}>Chiudi</button>
          <Link className="mq-salva" to="/diario">Apri il Diario</Link>
        </div>
      </div>
    </div>
  );
}
