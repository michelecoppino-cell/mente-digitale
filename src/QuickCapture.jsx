// @ts-check
// Cattura: una riga di testo, e il pensiero è fuori dalla testa.
//
// Il punto del passo 1 del flusso è che non chieda niente. Prima ⌘N apriva
// l'albero di decisione (dove la metto? è azionabile? in che sezione?), che è
// il passo 2: farlo mentre si sta facendo altro è il motivo per cui le cose
// non si catturano. Qui il task nasce nella lista trattata come Inbox — la
// colonna Inbox — e la si chiarisce dopo, quando c'è tempo.
//
// Ma metà delle volte dove va la cosa si sa già, e allora passare dall'Inbox
// per poi ripescarla e chiarirla è lavoro doppio: sono due giri per una cosa
// sola. Per questo la destinazione si può dire sulla stessa riga, con `@`:
//
//   Rivedere relazione fondazioni @2573 !domani ~45
//
// La regola è che dire la destinazione sia facoltativo. Chi non scrive niente
// batte Invio e cattura in Inbox esattamente come prima — stesso gesto, stesso
// risultato — e chi la scrive salta il chiarimento. La sintassi completa e la
// sua unica regola di sicurezza (un token si toglie dal titolo solo se ha
// risolto) stanno in captureParse.js.
//
// E quando la sezione è già aperta a schermo — la plancia di `/sezioni/:id` —
// non serve nemmeno scriverla: viene proposta da sola, con le sue consegne in
// testa all'elenco (`captureContext.js`). Proposta, non imposta: la chip resta
// cliccabile e Inbox è sempre la prima voce.
//
// ── Perché non c'è più «Decidi ora» ─────────────────────────────────────────
//
// Il bottone apriva il diagramma GTD del chiarimento: sei domande in fila per
// decidere dove va una cosa. È il passo 2, e metterlo qui dentro era chiedere
// **proprio nel momento in cui non si vuole essere interrotti** — cioè
// rimettere l'ostacolo che la cattura serve a togliere. Il chiarimento non è
// sparito: sta dove serve, sulla colonna Inbox della vista Attività, quando ci
// si siede a smaltirla. Da lì si apre col testo già dentro, come prima.
//
// Al suo posto c'è la cosa che davvero mancava: **un evento**. Metà di quello
// che si cattura al volo non è un'attività ma un appuntamento — «riunione
// cantiere giovedì 9:30» — e per metterlo in agenda bisognava uscire, aprire
// il Piano, andare al giorno giusto e usare «+ Evento». Adesso è la stessa
// riga, letta con una domanda in più (vedi `modo` in captureParse.js):
//
//   Riunione cantiere !giovedi 9:30-11
//
// Restano quindi due cose sole, che sono le due che si fanno di getto: butto
// dentro un pensiero, o fisso un appuntamento. Quello che non si sa ancora
// come catalogare finisce in Inbox — cioè il comportamento di default, senza
// scegliere niente.
//
// ── I token si scrivono, ma non si è obbligati a scriverli ──────────────────
//
// `@sezione`, `!domani`, `~45`, `9:30-11` sono comodi su una tastiera vera e
// scomodi su un telefono: `@` e `~` stanno nella seconda schermata dei simboli,
// e per scrivere «9:30» bisogna passare ai numeri e tornare indietro. Quindi
// **ogni token ha anche un bottone**, e i due modi scrivono lo stesso valore:
// la riga di pastiglie sotto il testo dice sempre dove si finisce, quando e per
// quanto, e ognuna si tocca.
//
// La regola fra i due modi è quella che vale già per la destinazione: **una
// scelta fatta col dito vale finché la riga non dice un'altra cosa**. Si
// ricorda cosa diceva il testo quando la si è fatta, e appena quel valore
// cambia la scelta decade — altrimenti resterebbe appiccicata a un testo che
// nel frattempo dice il contrario, e si batterebbe Invio su una data leggendone
// un'altra.
import { useEffect, useMemo, useRef, useState } from 'react';
import { creaTask } from './taskStore';
import { inboxListId } from './taskModel';
import { sectionRole, listLabel } from './paraConfig';
import { parseCapture, matchDestinations } from './captureParse';
import { getCalendars } from './api';
import { salvaEvento } from './eventiCalendario';
import DestinationPicker from './DestinationPicker';
import { byRecentUse, pushDestMru } from './destinationMru';
import { useMediaQuery } from './useMediaQuery';
import './QuickCapture.css';
import { durataBreve, oraProposta, sommaOra, ymd } from './tempo.js';

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {() => void} props.onClose
 * @param {(task: import('./taskStore').Task) => void} props.onCaptured
 * @param {() => Promise<void>|void} [props.onEventoCreato]  le viste che mostrano il calendario si rileggono
 * @param {import('./captureContext').CaptureContext|null} [props.context]  la sezione aperta, se si sta guardando una
 */
export default function QuickCapture({ open, todoLists, onClose, onCaptured, onEventoCreato, context = null }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Cosa si sta scrivendo. Un interruttore e non due finestre: la riga è la
  // stessa, cambia solo cosa se ne ricava.
  const [modo, setModo] = useState(/** @type {'attivita'|'evento'} */ ('attivita'));
  const [calendari, setCalendari] = useState(/** @type {any[]} */ ([]));
  const [calendarioId, setCalendarioId] = useState('');
  // Le scelte fatte col dito, ognuna insieme a cosa diceva la riga quando è
  // stata fatta: fuori da quel testo non vuol dire più niente (vedi in testa).
  const [sceltaGiorno, setSceltaGiorno] = useState(/** @type {{ valore: string|null, controTesto: string|null }|null} */ (null));
  const [sceltaOra, setSceltaOra] = useState(/** @type {{ inizio: string|null, fine: string|null, controTesto: string|null }|null} */ (null));
  const [sceltaStima, setSceltaStima] = useState(/** @type {{ valore: number|null, controTesto: number|null }|null} */ (null));
  // Quale pannello a dito è aperto. Uno solo per volta: due elenchi aperti
  // insieme, su uno schermo da telefono, sono uno che copre l'altro.
  const [pannello, setPannello] = useState(/** @type {'ora'|'stima'|null} */ (null));
  // La destinazione scelta a mano (clic o frecce), insieme a com'era scritto
  // il token `@` quando è stata scelta: appena si riprende a scrivere il token
  // la scelta decade, altrimenti resterebbe appiccicata a un testo che nel
  // frattempo dice un'altra cosa. `value: null` è Inbox scelta apposta.
  const [pick, setPick] = useState(/** @type {{ value: any, forQuery: string }|null} */ (null));
  const [pickerOpen, setPickerOpen] = useState(false);
  // La riga evidenziata, insieme alla ricerca per cui è stata scelta: fuori da
  // quella ricerca non vuol dire più niente (vedi `activeIndex` più sotto).
  const [cursor, setCursor] = useState(/** @type {{ key: string, index: number }} */ ({ key: '', index: -1 }));
  const inputRef = useRef(/** @type {HTMLTextAreaElement|null} */ (null));
  // Il dito e il mouse vogliono due cose diverse dal fuoco (vedi `focusInput`),
  // ed è una differenza di comportamento, non di aspetto: sta qui e non nel CSS.
  const dito = useMediaQuery('(pointer: coarse)');
  // Il componente resta montato anche a finestra chiusa (`open` falso ⇒ render
  // nullo), quindi lo stato sopravvive fra un'apertura e l'altra: senza questo
  // azzeramento la seconda cattura partiva con `busy` o l'errore della prima.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(''); setBusy(false); setError('');
      setPick(null); setPickerOpen(false); setCursor({ key: '', index: -1 });
      setModo('attivita');
      setSceltaGiorno(null); setSceltaOra(null); setSceltaStima(null); setPannello(null);
    }
  }

  // I calendari si chiedono solo quando servono davvero, e una volta sola: la
  // lista è memorizzata in api.js per dieci minuti, quindi passare da attività
  // a evento e ritorno non è una richiesta a testa.
  useEffect(() => {
    if (modo !== 'evento' || calendari.length) return;
    let vivo = true;
    getCalendars()
      .then(cals => { if (vivo) setCalendari(cals || []); })
      .catch(e => console.error('cattura: calendari', e));
    return () => { vivo = false; };
  }, [modo, calendari.length]);

  const inboxId = inboxListId(todoLists);

  // Le destinazioni sono le liste tolta l'Inbox — che è già l'opzione in
  // testa al pannello — e tolto l'archivio: in archivio non si butta niente di
  // nuovo, ci si sposta quello che è finito.
  const destinations = useMemo(() => (todoLists || [])
    .filter(l => l.id !== inboxId && sectionRole(l.displayName) !== 'archive')
    .map(l => ({ id: l.id, label: listLabel(l.displayName), name: l.displayName, role: sectionRole(l.displayName) })),
    [todoLists, inboxId]);

  // Prima lettura, senza la scelta a mano: serve a sapere *se* c'è un token
  // `@` e cosa c'è scritto dentro, che è quello che decide se la scelta
  // precedente vale ancora.
  const probe = parseCapture(text, destinations, { modo });
  const pickApplies = !!pick && pick.forQuery === probe.destQuery;
  const parsed = pickApplies
    ? parseCapture(text, destinations, { modo, overrideDestination: pick?.value ?? null })
    : probe;

  // Il pannello si apre da solo appena si scrive `@`: è il gesto che chiede
  // «dove?», e chiederlo di nuovo con un clic sarebbe una domanda in più. Per
  // un evento non si apre mai: la sua destinazione è il calendario, e sta nel
  // suo menù.
  const showPicker = modo === 'attivita' && (pickerOpen || (probe.hasDestToken && !pickApplies));

  // Le liste della sezione aperta vanno in testa, e non ricompaiono più sotto:
  // la stessa lista due volte nello stesso elenco è una scelta finta. Con una
  // ricerca in corso invece l'elenco è piatto — chi scrive dopo `@` sta
  // cercando altrove, o non avrebbe scritto niente.
  const contextIds = useMemo(
    () => new Set((context?.destinations || []).map(d => d.id)),
    [context]);
  const items = useMemo(() => {
    if (probe.hasDestToken) return matchDestinations(probe.destQuery, byRecentUse(destinations));
    const rest = byRecentUse(destinations).filter(d => !contextIds.has(d.id));
    return [...byRecentUse(context?.destinations || []), ...rest];
  }, [probe.hasDestToken, probe.destQuery, destinations, context, contextIds]);
  const contextCount = probe.hasDestToken ? 0 : (context?.destinations || []).length;

  // La riga preselezionata riparte da capo ogni volta che cambia quello che si
  // sta cercando — col token la prima corrispondenza, senza token Inbox — e la
  // freccia premuta vale solo dentro quella ricerca. Il confronto è sulla query
  // e non sull'indice che ne esce: due ricerche diverse possono volere entrambe
  // la riga 0, e allora la freccia premuta sulla prima resterebbe puntata su
  // una riga che nella seconda non c'è più.
  //
  // È un calcolo, non uno stato da risincronizzare: azzerarlo con una setState
  // durante il render lasciava passare un fotogramma con l'indice vecchio, e in
  // quel fotogramma la chip diceva «Inbox» mentre il token diceva già un'altra
  // cosa — battendoci sopra Invio si catturava davvero in Inbox.
  const destKey = probe.hasDestToken ? `@${probe.destQuery}` : '';
  const activeIndex = cursor.key === destKey ? cursor.index : (probe.hasDestToken && items.length ? 0 : -1);

  /** @param {number} index */
  function setActiveIndex(index) {
    setCursor({ key: destKey, index });
  }

  if (!open) return null;

  // Col pannello aperto comanda la riga evidenziata, non il token: la chip deve
  // dire dove si finisce *adesso*, comprese le frecce, o si batte Invio su una
  // destinazione e se ne legge un'altra. L'indice si rilegge sempre dentro
  // `items`, mai a memoria: la riga scelta può non esistere più.
  const highlighted = activeIndex >= 0 ? (items[activeIndex] || null) : null;
  // Senza token e senza una scelta a mano decide la sezione aperta, se c'è: è
  // la proposta, e vale finché non la si smentisce. Scrivere `@` la smentisce,
  // sceglierne un'altra pure, e scegliere Inbox apposta (`pick.value` nullo)
  // la smentisce allo stesso modo — altrimenti «no, in Inbox» non si potrebbe
  // dire, e la proposta diventerebbe un obbligo.
  const proposed = byRecentUse(context?.destinations || [])[0] || null;
  const decided = probe.hasDestToken || pickApplies;
  const target = showPicker ? highlighted : (decided ? parsed.destination : proposed);
  const fromContext = !decided && !!proposed;
  const canSubmit = !!parsed.title && !busy;

  // ── I tre valori, che vengano dalla riga o dal dito ───────────────────────
  // La scelta col dito vince finché la riga dice ancora quello che diceva
  // quando è stata fatta. Scritto una volta per tutti e tre, perché è la stessa
  // regola: non è il testo a comandare e non è il bottone, è l'ultimo dei due
  // che ha parlato.
  const giorno = sceltaGiorno && sceltaGiorno.controTesto === parsed.dueDate
    ? sceltaGiorno.valore : parsed.dueDate;
  const stimaMin = sceltaStima && sceltaStima.controTesto === parsed.estimateMin
    ? sceltaStima.valore : parsed.estimateMin;
  const oraVale = !!sceltaOra && sceltaOra.controTesto === parsed.oraInizio;
  const oraInizio = oraVale ? sceltaOra.inizio : parsed.oraInizio;

  // ── L'evento ──────────────────────────────────────────────────────────────
  // Senza giorno è oggi: è la cosa che si scrive più spesso di getto, e
  // chiedere «!oggi» per dire oggi sarebbe una domanda per niente. Senza ora è
  // un evento di tutto il giorno, che è il modo giusto di dire «quel giorno,
  // non so quando»; con l'ora ma senza fine dura quanto dice la stima, e in
  // mancanza un'ora tonda.
  const giornoEvento = giorno || ymd();
  const oraFine = oraInizio
    ? ((oraVale ? sceltaOra.fine : parsed.oraFine) || sommaOra(oraInizio, stimaMin || 60))
    : null;
  const calendarioDefault = calendari.find(c => c.isDefaultCalendar)?.id || calendari[0]?.id || '';
  const calendarioScelto = calendarioId || calendarioDefault;

  /** @param {string|null} valore */
  function scegliGiorno(valore) {
    setSceltaGiorno({ valore, controTesto: parsed.dueDate });
  }
  /** @param {string|null} inizio @param {string|null} fine */
  function scegliOra(inizio, fine) {
    setSceltaOra({ inizio, fine, controTesto: parsed.oraInizio });
  }
  /** @param {number|null} valore */
  function scegliStima(valore) {
    setSceltaStima({ valore, controTesto: parsed.estimateMin });
    setPannello(null);
  }

  // Aprire il pannello dell'ora *è* dire «a un'ora»: se non ce n'è ancora una
  // si propone la prima plausibile, così la pastiglia e i due campi dicono la
  // stessa cosa. Senza, si leggeva «tutto il giorno» sopra due campi che
  // mostravano 9:00–10:00, e si creava davvero un evento di tutto il giorno —
  // cioè la sorpresa a cose fatte che questa riga di pastiglie esiste per
  // evitare. Chi voleva davvero tutto il giorno ha il bottone lì sotto.
  function apriPannelloOra() {
    const apri = pannello !== 'ora';
    setPannello(apri ? 'ora' : null);
    setPickerOpen(false);
    if (apri && !oraInizio) scegliOra(oraProposta(giornoEvento), null);
  }

  /** @param {import('./captureParse').Destination|null} dest */
  function choose(dest) {
    setPick({ value: dest, forQuery: probe.destQuery });
    setPickerOpen(false);
    setPannello(null);
    // Scegliere non è finire: quasi sempre si è a metà del titolo. Il fuoco
    // torna dove si stava scrivendo, altrimenti dopo un clic sulla
    // destinazione bisogna riprendere la riga di testo col mouse per poter
    // scrivere ancora.
    focusInput();
  }

  // Cliccando un campo data o ora il browser lo mette a fuoco ma non apre
  // sempre il selettore: `showPicker()` lo apre davvero. Non è supportato
  // ovunque e in qualche contesto solleva, quindi si prova e basta — dove non
  // c'è, resta il comportamento normale del campo.
  /** @param {React.MouseEvent<HTMLInputElement>} e */
  function apriSelettore(e) {
    try { /** @type {any} */ (e.currentTarget).showPicker?.(); } catch { /* il browser dice di no */ }
  }

  function focusInput() {
    // **Da telefono no.** Rimettere il fuoco sulla riga fa risalire la
    // tastiera, che copre proprio l'elenco appena aperto: si toccava «Sezione»
    // e si vedeva comparire e sparire una lista dietro la tastiera. Col mouse
    // invece il fuoco deve tornare dove si stava scrivendo, perché scegliere
    // non è finire — quasi sempre si è a metà del titolo.
    if (dito) return;
    // Dopo il render, o il fuoco lo riprende il bottone appena premuto.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Il tasto si ascolta sulla finestra intera, non sulla riga di testo: la
  // scelta della destinazione porta via il fuoco a ogni clic, e Escape deve
  // chiudere anche da lì. Tutto il resto invece vale solo mentre si scrive —
  // Invio su un bottone lo preme già lui, e gestirlo due volte creerebbe due
  // task.
  /** @param {React.KeyboardEvent<HTMLDivElement>} e */
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // La prima fuga chiude il pannello, la seconda la cattura: chi ha aperto
      // le destinazioni per sbaglio non perde anche quello che ha scritto.
      if (pannello) { setPannello(null); return; }
      if (showPicker) { choose(target); return; }
      onClose();
      return;
    }
    if (e.target !== inputRef.current) return;
    if (showPicker && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const next = activeIndex + (e.key === 'ArrowDown' ? 1 : -1);
      setActiveIndex(Math.min(items.length - 1, Math.max(-1, next)));
      return;
    }
    if (showPicker && e.key === 'Tab') {
      // Tab sceglie e basta: si continua a scrivere il titolo.
      e.preventDefault();
      choose(highlighted);
      return;
    }
    // Invio manda, Maiusc+Invio va a capo: catturare è un gesto solo. Col
    // pannello aperto Invio fa le due cose insieme — sceglie e cattura — così
    // «titolo @sezione ⏎» resta un solo gesto anche con la destinazione.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (modo === 'evento') { creaEvento(); return; }
      if (showPicker) {
        choose(highlighted);
        captureInto(highlighted);
        return;
      }
      captureInto(target);
    }
  }

  // L'evento finisce su Graph passando dallo stesso `salvaEvento` del Piano —
  // stessa scrittura, stesso annulla. Riscriverlo qui vorrebbe dire due modi
  // di creare un evento che, il giorno che uno dei due cambia, divergono.
  async function creaEvento() {
    const next = parseCapture(text, destinations, { modo: 'evento' });
    if (!next.title || busy) return;
    if (!calendarioScelto) {
      setError('Non trovo un calendario su cui scrivere. Riprova fra un istante.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await salvaEvento({
        mode: 'create',
        form: {
          calendarId: calendarioScelto,
          subject: next.title,
          startDate: giornoEvento,
          endDate: giornoEvento,
          startTime: oraInizio,
          endTime: oraFine,
        },
        calendars: calendari,
        dopo: () => onEventoCreato?.(),
      });
      setText('');
      setBusy(false);
      onClose();
    } catch (e) {
      console.error('cattura evento', e);
      setError('Non è riuscito a crearlo. Riprova.');
      setBusy(false);
    }
  }

  // Sempre con la destinazione passata per argomento, mai letta dallo stato:
  // quando si sceglie e si cattura in un colpo solo (Invio col pannello
  // aperto) `pick` è appena stato impostato e `parsed` è ancora quello di
  // prima. Si rilegge la riga con la destinazione decisa e si manda quella.
  /** @param {import('./captureParse').Destination|null} dest */
  async function captureInto(dest) {
    const next = parseCapture(text, destinations, { overrideDestination: dest });
    if (!next.title || busy) return;
    const listId = dest?.id || inboxId;
    if (!listId) {
      setError('Non trovo la lista Inbox. Scrivi «@» e scegli una sezione, o usa «Decidi ora».');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const task = await creaTask(listId, {
        titolo: next.title,
        // Scadenza e stima si leggono da `giorno` e `stimaMin`, non da `next`:
        // quelli tengono conto anche di cosa è stato scelto col dito, e `next`
        // sa solo cosa c'è scritto nella riga.
        // La stima detta al volo («30m») è un campo: prima diventava un marker
        // [MIN:30] in testa alle note del task appena nato.
        ...(stimaMin ? { stimaMin } : {}),
        ...(giorno ? { scadenza: giorno.slice(0, 10) } : {}),
      });
      if (dest) pushDestMru(listId);
      onCaptured(task);
      setText('');
      setPick(null);
      setBusy(false);
      onClose();
    } catch (e) {
      console.error('cattura', e);
      setError('Non è riuscito a salvarla. Riprova.');
      setBusy(false);
    }
  }

  return (
    <div className="qc-overlay" onClick={onClose}>
      <div
        className="qc"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Cattura un pensiero">
        {/* L'interruttore in testa e non due bottoni in fondo: si sceglie
            *prima* di scrivere, perché è quello che cambia come la riga viene
            letta — e la riga la si vede cambiare mentre si scrive. */}
        <div className="qc-testa">
          <span className="eyebrow">Cattura</span>
          <div className="qc-modo">
            <button
              type="button"
              className={modo === 'attivita' ? 'attivo' : ''}
              onClick={() => { setModo('attivita'); focusInput(); }}>
              Attività
            </button>
            <button
              type="button"
              className={modo === 'evento' ? 'attivo' : ''}
              onClick={() => { setModo('evento'); setPickerOpen(false); focusInput(); }}>
              Evento
            </button>
          </div>
        </div>
        <textarea
          className="qc-input"
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={modo === 'evento' ? 'Che appuntamento è?' : 'Cosa ti è venuto in mente?'}
          rows={3}
          autoFocus
        />

        {/* Dove finisce, scritto prima di premere Invio: la destinazione non
            deve mai essere una sorpresa a cose fatte. Per un evento la
            destinazione è il calendario, e la riga dice giorno e ora.

            **Ogni pastiglia è anche un bottone.** I token si scrivono comodi da
            tastiera e scomodi col pollice, quindi qui c'è l'altra metà: si
            tocca e si sceglie, e il valore è lo stesso che scriverebbe il
            token. */}
        <div className="qc-target-row">
          {modo === 'attivita' ? (
            <button
              type="button"
              className={`qc-target${target ? ' set' : ''}`}
              aria-expanded={showPicker}
              onClick={() => {
                setPickerOpen(o => !o);
                setPannello(null);
                setActiveIndex(target ? items.findIndex(i => i.id === target.id) : -1);
                focusInput();
              }}>
              <span className="qc-target-arrow" aria-hidden="true">→</span>
              <span className="qc-target-name">{target ? target.label : 'Inbox'}</span>
              <span className="qc-target-caret" aria-hidden="true">⌄</span>
            </button>
          ) : (
            <label className="qc-target set qc-target-cal">
              <span className="qc-target-arrow" aria-hidden="true">→</span>
              <select
                className="qc-cal-select"
                value={calendarioScelto}
                onChange={e => setCalendarioId(e.target.value)}
                aria-label="Calendario">
                {calendari.length === 0 && <option value="">Calendario…</option>}
                {calendari.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {/* Il giorno passa dal calendario del sistema: da telefono è la
              rotella nativa, che è il modo migliore che esista di scegliere una
              data col pollice, e non c'è niente da disegnare. L'input copre
              tutta la pastiglia, così il tocco cade su di lui ovunque. */}
          <label className={`qc-chip qc-chip-tocca${giorno ? ' scelta' : ''}`}>
            <span aria-hidden="true">📅</span>
            <span>{giorno ? formatDay(giorno) : (modo === 'evento' ? formatDay(giornoEvento) : 'quando')}</span>
            <input
              type="date"
              className="qc-campo-sopra"
              aria-label={modo === 'evento' ? 'Giorno dell’evento' : 'Scadenza'}
              value={modo === 'evento' ? giornoEvento : (giorno || '')}
              onClick={apriSelettore}
              onChange={e => scegliGiorno(e.target.value || null)}
            />
          </label>
          {giorno && modo === 'attivita' && (
            <button type="button" className="qc-chip qc-chip-tocca" onClick={() => scegliGiorno(null)} title="Togli la scadenza">✕</button>
          )}

          {modo === 'evento' ? (
            <button
              type="button"
              className={`qc-chip qc-chip-tocca${oraInizio ? ' scelta' : ''}`}
              aria-expanded={pannello === 'ora'}
              onClick={apriPannelloOra}>
              <span aria-hidden="true">🕘</span>
              <span>{oraInizio ? `${oraInizio}–${oraFine}` : 'tutto il giorno'}</span>
              <span className="qc-target-caret" aria-hidden="true">⌄</span>
            </button>
          ) : (
            <button
              type="button"
              className={`qc-chip qc-chip-tocca${stimaMin ? ' scelta' : ''}`}
              aria-expanded={pannello === 'stima'}
              onClick={() => { setPannello(p => (p === 'stima' ? null : 'stima')); setPickerOpen(false); }}>
              <span aria-hidden="true">⏱</span>
              <span>{stimaMin ? formatMin(stimaMin) : 'quanto'}</span>
              <span className="qc-target-caret" aria-hidden="true">⌄</span>
            </button>
          )}
        </div>

        {/* L'ora di un evento: due campi e una via d'uscita. «Tutto il giorno»
            è un bottone e non una casella da spuntare perché è quello che si
            sceglie *invece* di un orario, non in aggiunta. */}
        {pannello === 'ora' && (
          <div className="qc-pannello">
            <div className="qc-ora-riga">
              <label className="qc-ora-campo">
                <span className="eyebrow">dalle</span>
                <input
                  type="time"
                  value={oraInizio || '09:00'}
                  onClick={apriSelettore}
                  onChange={e => scegliOra(e.target.value || null, oraVale ? sceltaOra.fine : parsed.oraFine)}
                />
              </label>
              <label className="qc-ora-campo">
                <span className="eyebrow">alle</span>
                <input
                  type="time"
                  value={oraFine || sommaOra(oraInizio || '09:00', 60)}
                  onClick={apriSelettore}
                  onChange={e => scegliOra(oraInizio || '09:00', e.target.value || null)}
                />
              </label>
            </div>
            <div className="qc-preset-riga">
              <button type="button" className="qc-preset" onClick={() => { scegliOra(null, null); setPannello(null); }}>
                Tutto il giorno
              </button>
              <button type="button" className="qc-preset" onClick={() => setPannello(null)}>Fatto</button>
            </div>
          </div>
        )}

        {/* La stima: non esiste un campo di sistema per una durata, quindi si
            danno i tagli che si usano davvero. Sono gli stessi che il Piano
            propone quando si ridimensiona un blocco. */}
        {pannello === 'stima' && (
          <div className="qc-pannello">
            <div className="qc-preset-riga">
              {[15, 30, 45, 60, 90, 120, 180].map(min => (
                <button
                  type="button"
                  key={min}
                  className={`qc-preset${stimaMin === min ? ' scelto' : ''}`}
                  onClick={() => scegliStima(min)}>
                  {formatMin(min)}
                </button>
              ))}
              <button type="button" className="qc-preset" onClick={() => scegliStima(null)}>—</button>
            </div>
          </div>
        )}

        {showPicker && (
          <DestinationPicker
            items={items}
            activeIndex={activeIndex}
            contextCount={contextCount}
            contextLabel={context?.label || ''}
            onPick={choose}
            onHover={setActiveIndex}
          />
        )}

        <p className="qc-hint">
          {modo === 'evento'
            ? 'Finisce in calendario. Tocca le pastiglie per giorno e ora.'
            : (fromContext
              ? 'Proposta dalla sezione che stai guardando. Cambiala se non è lì che va.'
              : target
                ? 'Va dritta in sezione: niente giro dall’Inbox.'
                : 'Finisce in Inbox. La chiarisci dopo, da Attività.')}
          {/* La sintassi dei token si dice solo dove serve: su un telefono
              `@` e `~` stanno nella seconda schermata dei simboli, e leggere
              una scorciatoia che non si userà mai è rumore. Le pastiglie
              accanto fanno le stesse tre cose, e si vedono. */}
          {!dito && (modo === 'evento'
            ? (<> Oppure scrivi <code>!</code> per il giorno e <code>9:30-11</code> per l’ora.</>)
            : (<> Oppure scrivi <code>@</code> per la sezione, <code>!</code> per la scadenza, <code>~</code> per i minuti.</>))}
        </p>

        {error && <div className="qc-error">{error}</div>}

        <div className="qc-actions">
          {modo === 'evento' ? (
            <button className="qc-btn primary" onClick={creaEvento} disabled={!canSubmit}>
              {busy ? 'Salvo…' : 'Metti in calendario'}
            </button>
          ) : (
            <button className="qc-btn primary" onClick={() => captureInto(target)} disabled={!canSubmit}>
              {busy ? 'Salvo…' : target ? 'Crea in sezione' : 'Cattura'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * `2026-08-31` → `lun 31 ago`, con oggi e domani detti per nome.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'domani';
  return date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * 45 → `45m`, 120 → `2h`, 90 → `1h30`.
 * @param {number} min
 * @returns {string}
 */
function formatMin(min) {
  return durataBreve(min);
}


