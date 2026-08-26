// @ts-check
// Cattura: una riga di testo, e il pensiero è fuori dalla testa.
//
// Il punto del passo 1 del flusso è che non chieda niente. Prima ⌘N apriva
// l'albero di decisione (dove la metto? è azionabile? in che sezione?), che è
// il passo 2: farlo mentre si sta facendo altro è il motivo per cui le cose
// non si catturano. Qui il task nasce nella lista di default di To-Do — la
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
// "Decidi ora" resta per il caso opposto: non è che si sa dove va, è che non
// si sa — apre l'albero di decisione di sempre, col testo già scritto dentro.
import { useMemo, useRef, useState } from 'react';
import { createTask } from './api';
import { inboxListId, withEstimateMarker } from './taskModel';
import { sectionRole, listLabel } from './paraConfig';
import { parseCapture, matchDestinations } from './captureParse';
import DestinationPicker from './DestinationPicker';
import { byRecentUse, pushDestMru } from './destinationMru';
import './QuickCapture.css';

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {import('./types').TodoList[]} props.todoLists
 * @param {() => void} props.onClose
 * @param {(task: import('./types').TodoTask) => void} props.onCaptured
 * @param {(text: string) => void} props.onDecideNow
 */
export default function QuickCapture({ open, todoLists, onClose, onCaptured, onDecideNow }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // La destinazione scelta a mano (clic o frecce), insieme a com'era scritto
  // il token `@` quando è stata scelta: appena si riprende a scrivere il token
  // la scelta decade, altrimenti resterebbe appiccicata a un testo che nel
  // frattempo dice un'altra cosa. `value: null` è Inbox scelta apposta.
  const [pick, setPick] = useState(/** @type {{ value: any, forQuery: string }|null} */ (null));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(/** @type {HTMLTextAreaElement|null} */ (null));
  // Il componente resta montato anche a finestra chiusa (`open` falso ⇒ render
  // nullo), quindi lo stato sopravvive fra un'apertura e l'altra: senza questo
  // azzeramento la seconda cattura partiva con `busy` o l'errore della prima.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(''); setBusy(false); setError('');
      setPick(null); setPickerOpen(false); setActiveIndex(-1);
    }
  }

  const inboxId = inboxListId(todoLists);

  // Le destinazioni sono le liste To-Do tolta l'Inbox — che è già l'opzione in
  // testa al pannello — e tolto l'archivio: in archivio non si butta niente di
  // nuovo, ci si sposta quello che è finito.
  const destinations = useMemo(() => (todoLists || [])
    .filter(l => l.id !== inboxId && sectionRole(l.displayName) !== 'archive')
    .map(l => ({ id: l.id, label: listLabel(l.displayName), name: l.displayName, role: sectionRole(l.displayName) })),
    [todoLists, inboxId]);

  // Prima lettura, senza la scelta a mano: serve a sapere *se* c'è un token
  // `@` e cosa c'è scritto dentro, che è quello che decide se la scelta
  // precedente vale ancora.
  const probe = parseCapture(text, destinations);
  const pickApplies = !!pick && pick.forQuery === probe.destQuery;
  const parsed = pickApplies
    ? parseCapture(text, destinations, { overrideDestination: pick?.value ?? null })
    : probe;

  // Il pannello si apre da solo appena si scrive `@`: è il gesto che chiede
  // «dove?», e chiederlo di nuovo con un clic sarebbe una domanda in più.
  const showPicker = pickerOpen || (probe.hasDestToken && !pickApplies);
  const items = useMemo(
    () => (probe.hasDestToken ? matchDestinations(probe.destQuery, byRecentUse(destinations)) : byRecentUse(destinations)),
    [probe.hasDestToken, probe.destQuery, destinations]);

  // La riga preselezionata riparte da capo ogni volta che cambia quello che si
  // sta cercando — col token la prima corrispondenza, senza token Inbox. Il
  // confronto è sulla query e non sull'indice che ne esce: due ricerche diverse
  // possono volere entrambe la riga 0, e allora la freccia premuta sulla prima
  // resterebbe puntata su una riga che nella seconda non c'è più.
  const destKey = probe.hasDestToken ? `@${probe.destQuery}` : '';
  const [indexFor, setIndexFor] = useState(destKey);
  if (indexFor !== destKey) {
    setIndexFor(destKey);
    setActiveIndex(probe.hasDestToken && items.length ? 0 : -1);
  }

  if (!open) return null;

  // Col pannello aperto comanda la riga evidenziata, non il token: la chip deve
  // dire dove si finisce *adesso*, comprese le frecce, o si batte Invio su una
  // destinazione e se ne legge un'altra. L'indice si rilegge sempre dentro
  // `items`, mai a memoria: la riga scelta può non esistere più.
  const highlighted = activeIndex >= 0 ? (items[activeIndex] || null) : null;
  const target = showPicker ? highlighted : parsed.destination;
  const canSubmit = !!parsed.title && !busy;

  /** @param {import('./captureParse').Destination|null} dest */
  function choose(dest) {
    setPick({ value: dest, forQuery: probe.destQuery });
    setPickerOpen(false);
    // Scegliere non è finire: quasi sempre si è a metà del titolo. Il fuoco
    // torna dove si stava scrivendo, altrimenti dopo un clic sulla
    // destinazione bisogna riprendere la riga di testo col mouse per poter
    // scrivere ancora.
    focusInput();
  }

  function focusInput() {
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
      if (showPicker) { choose(target); return; }
      onClose();
      return;
    }
    if (e.target !== inputRef.current) return;
    if (showPicker && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const last = items.length - 1;
      setActiveIndex(i => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.min(last, Math.max(-1, next));
      });
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
      if (showPicker) {
        choose(highlighted);
        captureInto(highlighted);
        return;
      }
      captureInto(target);
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
      setError('Non trovo la lista predefinita di To-Do. Scrivi «@» e scegli una sezione, o usa «Decidi ora».');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const list = (todoLists || []).find(l => l.id === listId);
      const task = await createTask(listId, next.title, {
        ...(next.estimateMin ? { body: withEstimateMarker('', next.estimateMin) } : {}),
        ...(next.dueDate ? { dueDate: next.dueDate } : {}),
      });
      if (dest) pushDestMru(listId);
      onCaptured({ ...task, _listId: listId, _listName: list?.displayName });
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
        <span className="eyebrow">Cattura</span>
        <textarea
          className="qc-input"
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Cosa ti è venuto in mente?"
          rows={3}
          autoFocus
        />

        {/* Dove finisce, scritto prima di premere Invio: la destinazione non
            deve mai essere una sorpresa a cose fatte. */}
        <div className="qc-target-row">
          <button
            type="button"
            className={`qc-target${target ? ' set' : ''}`}
            aria-expanded={showPicker}
            onClick={() => {
              setPickerOpen(o => !o);
              setActiveIndex(target ? items.findIndex(i => i.id === target.id) : -1);
              focusInput();
            }}>
            <span className="qc-target-arrow" aria-hidden="true">→</span>
            <span className="qc-target-name">{target ? target.label : 'Inbox'}</span>
            <span className="qc-target-caret" aria-hidden="true">⌄</span>
          </button>
          {parsed.dueDate && <span className="qc-chip">📅 {formatDay(parsed.dueDate)}</span>}
          {parsed.estimateMin && <span className="qc-chip">⏱ {formatMin(parsed.estimateMin)}</span>}
        </div>

        {showPicker && (
          <DestinationPicker
            items={items}
            activeIndex={activeIndex}
            onPick={choose}
            onHover={setActiveIndex}
          />
        )}

        <p className="qc-hint">
          {target
            ? 'Va dritta in sezione: niente giro dall’Inbox.'
            : 'Finisce in Inbox. La chiarisci dopo, da Attività.'}
          {' '}Scrivi <code>@</code> per la sezione, <code>!</code> per la scadenza, <code>~</code> per i minuti.
        </p>

        {error && <div className="qc-error">{error}</div>}

        <div className="qc-actions">
          <button
            className="qc-btn"
            onClick={() => { onDecideNow(text.trim()); setText(''); onClose(); }}
            disabled={busy}>
            Decidi ora
          </button>
          <button className="qc-btn primary" onClick={() => captureInto(target)} disabled={!canSubmit}>
            {busy ? 'Salvo…' : target ? 'Crea in sezione' : 'Cattura'}
          </button>
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
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h${String(rest).padStart(2, '0')}` : `${h}h`;
}
