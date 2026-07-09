import { useState, useEffect, useRef } from 'react';
import { loadPomodoroStats, savePomodoroStats } from './api';
import './PomodoroTimer.css';

const WORK_MIN  = 25;
const BREAK_MIN = 5;
const AWAY_THRESHOLD_S = 5; // ignora alt-tab accidentali sotto questa soglia

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function notify(title, body) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') new Notification(title, { body });
    });
  }
}

// Tre beep ravvicinati invece di uno solo — un singolo bip di 0.35s passa
// facilmente inosservato se non si sta guardando lo schermo in quel preciso
// istante.
function beepBurst(times = 3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      const start = ctx.currentTime + i * 0.5;
      gain.gain.setValueAtTime(0.2, start);
      osc.start(start);
      osc.stop(start + 0.35);
      if (i === times - 1) osc.onended = () => ctx.close();
    }
  } catch { /* audio non disponibile — ignora */ }
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Timer Pomodoro 25/5 agganciato a un blocco specifico della timeline.
// Al termine di ogni fase mostra un overlay a tutta pagina che resta finché
// non viene chiuso a mano (non basta il beep o la Notification del browser,
// spesso silenziosa a tab attiva) e fa lampeggiare il titolo della tab.
// Durante il lavoro traccia le interruzioni (cambi di tab) per stimare i
// minuti di concentrazione reale, salvati come statistiche giornaliere su
// OneDrive.
//
// La fascia oraria "attiva" (lavoro o uno dei tre tipi di pausa) viene
// chiusa e salvata subito quando cambia tipo, invece di aspettare la fine
// di un pomodoro intero: prima, se l'utente non completava mai un ciclo
// pieno, nessuna fascia veniva mai persistita e la colonna restava vuota.
// `onActiveIntervalChange` inoltre notifica il parent della fascia ancora
// aperta così la colonna può disegnarla live, crescente verso "adesso".
export default function PomodoroTimer({ onClose, onCycleComplete, onRunningChange, onSessionClosed, onActiveIntervalChange }) {
  const [phase, setPhase]         = useState('working'); // 'working' | 'break'
  const [secondsLeft, setSeconds] = useState(WORK_MIN * 60);
  const [running, setRunning]     = useState(true);
  const [activeType, setActiveType] = useState('focus'); // 'focus' | 'personal' | 'office' | 'client'
  const [phaseEndInfo, setPhaseEndInfo] = useState(null); // { phase, focusedMinutes, interruptions } | null
  const [todayStats, setTodayStats] = useState(null);
  const intervalRef = useRef(null);
  const endAtRef = useRef(null); // timestamp assoluto di fine fase, per non derivare dal conteggio dei tick
  const titleFlashRef = useRef(null);
  const originalTitleRef = useRef(document.title);
  const hiddenAtRef = useRef(null);
  const distractedSecondsRef = useRef(0);
  const interruptionsRef = useRef(0);
  // Fascia oraria (wall-clock) attualmente aperta — usata per disegnare la
  // barra nella colonna Pomodoro del Piano (a differenza di focusedMinutes,
  // qui conta il tempo reale trascorso: solo la pausa esplicita, senza
  // scegliere un tipo, apre un vero buco).
  const activeStartRef = useRef(null);
  const activeTypeRef  = useRef('focus');

  useEffect(() => {
    if (Notification?.permission === 'default') Notification.requestPermission();
  }, []);

  // Il timer parte già running=true in fase 'working': apre il primo
  // sotto-intervallo al mount.
  useEffect(() => {
    activeStartRef.current = Date.now();
    activeTypeRef.current = 'focus';
    onActiveIntervalChange?.({ start: activeStartRef.current, type: 'focus' });
    // Se il widget viene chiuso mentre una fascia è ancora aperta, la salva
    // comunque invece di perderla — altrimenti chiudere a metà pomodoro non
    // lascia mai traccia sulla timeline.
    return () => { closeInterval(); };
  }, []); // eslint-disable-line

  useEffect(() => {
    loadPomodoroStats()
      .then(stats => setTodayStats(stats?.[todayKey()] || { pomodori: 0, focusedMinutes: 0, interruptions: 0 }))
      .catch(e => console.error('load pomodoro stats', e));
  }, []);

  // Traccia le interruzioni solo durante una fase di lavoro attiva.
  useEffect(() => {
    function onVisibilityChange() {
      if (phase !== 'working' || !running) return;
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current) {
        const awaySeconds = (Date.now() - hiddenAtRef.current) / 1000;
        hiddenAtRef.current = null;
        if (awaySeconds >= AWAY_THRESHOLD_S) {
          distractedSecondsRef.current += awaySeconds;
          interruptionsRef.current += 1;
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [phase, running]);

  // Il conto alla rovescia si basa su un timestamp di fine assoluto, non su un
  // decremento per tick: i browser rallentano/saltano i setInterval quando la
  // tab è in background, e contare -1 per tick fa "perdere" quel tempo per
  // sempre (il timer sembra rallentare ogni volta che si riapre la tab).
  // Ricalcolando da Date.now() ad ogni tick il timer si autocorregge.
  useEffect(() => {
    if (!running) return;
    endAtRef.current = Date.now() + secondsLeft * 1000;
    intervalRef.current = setInterval(() => {
      const remaining = Math.round((endAtRef.current - Date.now()) / 1000);
      if (remaining > 0) {
        setSeconds(remaining);
      } else {
        setSeconds(0);
        handlePhaseEnd();
      }
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, phase]); // eslint-disable-line

  // Lampeggio del titolo della tab finché l'utente non chiude l'overlay di
  // fine fase — visibile anche se si è passati ad un'altra tab/finestra.
  useEffect(() => {
    if (!phaseEndInfo) {
      clearInterval(titleFlashRef.current);
      document.title = originalTitleRef.current;
      return;
    }
    const alertTitle = phaseEndInfo.phase === 'working' ? '🍅 Pomodoro finito!' : '☕ Pausa finita!';
    let on = false;
    titleFlashRef.current = setInterval(() => {
      document.title = on ? originalTitleRef.current : alertTitle;
      on = !on;
    }, 1000);
    return () => clearInterval(titleFlashRef.current);
  }, [phaseEndInfo]);

  async function persistSessions(sessions) {
    if (!sessions.length) return;
    try {
      const stats = await loadPomodoroStats();
      const key = todayKey();
      const prev = stats[key] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const next = { ...prev, sessions: [...(prev.sessions || []), ...sessions] };
      stats[key] = next;
      await savePomodoroStats(stats);
      setTodayStats(next);
    } catch (e) { console.error('save pomodoro session', e); }
  }

  async function persistCycleStats(focusedMinutes, interruptions) {
    try {
      const stats = await loadPomodoroStats();
      const key = todayKey();
      const prev = stats[key] || { pomodori: 0, focusedMinutes: 0, interruptions: 0, sessions: [] };
      const next = {
        ...prev,
        pomodori: prev.pomodori + 1,
        focusedMinutes: prev.focusedMinutes + focusedMinutes,
        interruptions: prev.interruptions + interruptions,
      };
      stats[key] = next;
      await savePomodoroStats(stats);
      setTodayStats(next);
    } catch (e) { console.error('save pomodoro stats', e); }
  }

  // Chiude la fascia oraria attualmente aperta (se c'è) e la salva subito
  // come sessione — non aspetta più la fine di un pomodoro intero.
  async function closeInterval() {
    if (!activeStartRef.current) return;
    const session = {
      start: new Date(activeStartRef.current).toISOString(),
      end: new Date().toISOString(),
      type: activeTypeRef.current,
    };
    activeStartRef.current = null;
    onActiveIntervalChange?.(null);
    onSessionClosed?.(session);
    await persistSessions([session]);
  }

  // Chiude la fascia in corso e ne apre una nuova del tipo scelto: usata sia
  // per riprendere il lavoro ('focus') sia per segnare una pausa personale,
  // un'interruzione ufficio o cliente. Solo il lavoro fa scorrere il conto
  // alla rovescia — le pause lo mettono in pausa ma restano visibili e
  // colorate sulla timeline invece di lasciare un buco.
  async function switchTo(type) {
    await closeInterval();
    activeStartRef.current = Date.now();
    activeTypeRef.current = type;
    setActiveType(type);
    onActiveIntervalChange?.({ start: activeStartRef.current, type });
    const nextRunning = type === 'focus';
    setRunning(nextRunning);
    onRunningChange?.(nextRunning);
  }

  async function handlePhaseEnd() {
    beepBurst();
    if (phase === 'working') {
      await closeInterval();
      const distractedSeconds = distractedSecondsRef.current;
      const interruptions = interruptionsRef.current;
      // Usa il tempo di lavoro effettivamente trascorso (non sempre WORK_MIN
      // intero: la fase può finire anche prima, se l'utente salta alla
      // pausa manualmente col bottone "Inizia pausa ora").
      const elapsedMinutes = (WORK_MIN * 60 - secondsLeft) / 60;
      const focusedMinutes = Math.max(0, elapsedMinutes - distractedSeconds / 60);
      distractedSecondsRef.current = 0;
      interruptionsRef.current = 0;
      onCycleComplete?.({ focusedMinutes, interruptions });
      await persistCycleStats(focusedMinutes, interruptions);
      notify('Pomodoro completato 🍅', 'Pausa di 5 minuti — stacca un attimo.');
      setPhaseEndInfo({ phase: 'working', focusedMinutes, interruptions });
      setPhase('break');
      setSeconds(BREAK_MIN * 60);
      setRunning(false);
    } else {
      notify('Pausa finita', 'Pronto per un altro pomodoro?');
      setPhaseEndInfo({ phase: 'break' });
      setPhase('working');
      setSeconds(WORK_MIN * 60);
      setRunning(false);
    }
  }

  function dismissPhaseEnd() {
    const resumingWork = phaseEndInfo?.phase === 'break';
    setPhaseEndInfo(null);
    setRunning(true);
    if (resumingWork) {
      activeStartRef.current = Date.now();
      activeTypeRef.current = 'focus';
      setActiveType('focus');
      onActiveIntervalChange?.({ start: activeStartRef.current, type: 'focus' });
    }
  }

  // Unico punto in cui la pausa/ripresa del lavoro è una scelta esplicita
  // dell'utente (a differenza delle pause automatiche di fine fase): notifica
  // il parent così può chiudere/riaprire il pannello sezione e
  // sbloccare/bloccare il Piano. Una pausa "secca" (senza scegliere un tipo)
  // resta un vuoto sulla timeline, come le pause automatiche di fine ciclo.
  function toggle() {
    if (running && activeType === 'focus') {
      closeInterval();
      setRunning(false);
      onRunningChange?.(false);
    } else {
      switchTo('focus');
    }
  }

  // Forza subito la fine della fase corrente (lavoro→pausa o pausa→lavoro)
  // invece di aspettare che il conto alla rovescia arrivi a zero: copre i
  // casi in cui la pausa va iniziata prima o terminata prima del previsto.
  // Passa dallo stesso `handlePhaseEnd` del fine-fase automatico, così
  // overlay, notifiche e statistiche restano coerenti in entrambi i casi.
  function skipPhase() {
    clearInterval(intervalRef.current);
    handlePhaseEnd();
  }

  return (
    <>
      {phaseEndInfo && (
        <div className="pomodoro-alert-overlay" onClick={dismissPhaseEnd}>
          <div className="pomodoro-alert-card" onClick={e => e.stopPropagation()}>
            <div className="pomodoro-alert-icon">{phaseEndInfo.phase === 'working' ? '🍅' : '☕'}</div>
            <div className="pomodoro-alert-title">
              {phaseEndInfo.phase === 'working' ? 'Pomodoro completato!' : 'Pausa finita'}
            </div>
            <div className="pomodoro-alert-body">
              {phaseEndInfo.phase === 'working'
                ? `${Math.round(phaseEndInfo.focusedMinutes)} min di concentrazione${phaseEndInfo.interruptions ? ` · ${phaseEndInfo.interruptions} distrazioni` : ''}. Pausa di 5 minuti.`
                : 'Pronto per un altro pomodoro?'}
            </div>
            <button className="pomodoro-btn" onClick={dismissPhaseEnd}>
              {phaseEndInfo.phase === 'working' ? '☕ Inizia la pausa' : '🍅 Continua'}
            </button>
          </div>
        </div>
      )}
      <div className="pomodoro-widget">
        <div className="pomodoro-header">
          <span className={`pomodoro-phase ${phase} ${activeType}`}>
            {activeType === 'personal' ? '🟡 Pausa personale'
              : activeType === 'office' ? '🟣 Interruzione ufficio'
              : activeType === 'client' ? '🔵 Interruzione cliente'
              : phase === 'working' ? '🍅 Lavoro' : '☕ Pausa'}
          </span>
          <button className="pomodoro-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        <div className="pomodoro-time">{fmt(secondsLeft)}</div>
        <div className="pomodoro-actions">
          <button className="pomodoro-btn" onClick={toggle}>
            {running && activeType === 'focus' ? '⏸ Pausa' : '▶ Riprendi lavoro'}
          </button>
          {phase === 'working' ? (
            <button
              className="pomodoro-btn pomodoro-btn-secondary"
              onClick={skipPhase}
              title="Inizia subito la pausa, senza aspettare la fine del conto alla rovescia"
            >☕ Pausa ora</button>
          ) : (
            <button
              className="pomodoro-btn pomodoro-btn-secondary"
              onClick={skipPhase}
              title="Termina subito la pausa e torna al lavoro"
            >🍅 Fine pausa</button>
          )}
        </div>
        <div className="pomodoro-breaks">
          <button
            className={`pomodoro-break-btn personal${activeType === 'personal' ? ' active' : ''}`}
            onClick={() => switchTo('personal')} title="Pausa personale">Personale</button>
          <button
            className={`pomodoro-break-btn office${activeType === 'office' ? ' active' : ''}`}
            onClick={() => switchTo('office')} title="Interruzione ufficio">Ufficio</button>
          <button
            className={`pomodoro-break-btn client${activeType === 'client' ? ' active' : ''}`}
            onClick={() => switchTo('client')} title="Interruzione cliente">Cliente</button>
        </div>
        {todayStats && (
          <div className="pomodoro-stats">
            Oggi: {todayStats.pomodori} pomodori · {Math.round(todayStats.focusedMinutes)} min concentrato
            {todayStats.interruptions > 0 && ` · ${todayStats.interruptions} distrazioni`}
          </div>
        )}
      </div>
    </>
  );
}
