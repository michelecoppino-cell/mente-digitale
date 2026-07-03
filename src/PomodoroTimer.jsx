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
export default function PomodoroTimer({ block, onClose, onCycleComplete }) {
  const [phase, setPhase]         = useState('working'); // 'working' | 'break'
  const [secondsLeft, setSeconds] = useState(WORK_MIN * 60);
  const [running, setRunning]     = useState(true);
  const [phaseEndInfo, setPhaseEndInfo] = useState(null); // { phase, focusedMinutes, interruptions } | null
  const [todayStats, setTodayStats] = useState(null);
  const intervalRef = useRef(null);
  const titleFlashRef = useRef(null);
  const originalTitleRef = useRef(document.title);
  const hiddenAtRef = useRef(null);
  const distractedSecondsRef = useRef(0);
  const interruptionsRef = useRef(0);

  useEffect(() => {
    if (Notification?.permission === 'default') Notification.requestPermission();
  }, []);

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

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSeconds(s => {
        if (s > 1) return s - 1;
        handlePhaseEnd();
        return 0;
      });
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

  async function persistStats(focusedMinutes, interruptions) {
    try {
      const stats = await loadPomodoroStats();
      const key = todayKey();
      const prev = stats[key] || { pomodori: 0, focusedMinutes: 0, interruptions: 0 };
      const next = {
        pomodori: prev.pomodori + 1,
        focusedMinutes: prev.focusedMinutes + focusedMinutes,
        interruptions: prev.interruptions + interruptions,
      };
      stats[key] = next;
      await savePomodoroStats(stats);
      setTodayStats(next);
    } catch (e) { console.error('save pomodoro stats', e); }
  }

  function handlePhaseEnd() {
    beepBurst();
    if (phase === 'working') {
      const distractedSeconds = distractedSecondsRef.current;
      const interruptions = interruptionsRef.current;
      const focusedMinutes = Math.max(0, WORK_MIN - distractedSeconds / 60);
      distractedSecondsRef.current = 0;
      interruptionsRef.current = 0;
      onCycleComplete?.({ focusedMinutes, interruptions });
      persistStats(focusedMinutes, interruptions);
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
    setPhaseEndInfo(null);
    setRunning(true);
  }

  function toggle() { setRunning(r => !r); }

  function reset() {
    setRunning(false);
    setPhase('working');
    setSeconds(WORK_MIN * 60);
    distractedSecondsRef.current = 0;
    interruptionsRef.current = 0;
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
          <span className={`pomodoro-phase ${phase}`}>
            {phase === 'working' ? '🍅 Lavoro' : '☕ Pausa'}
          </span>
          <button className="pomodoro-close" onClick={onClose} title="Chiudi">✕</button>
        </div>
        {block?.taskTitle && <div className="pomodoro-task">{block.taskTitle}</div>}
        <div className="pomodoro-time">{fmt(secondsLeft)}</div>
        <div className="pomodoro-actions">
          <button className="pomodoro-btn" onClick={toggle}>{running ? '⏸ Pausa' : '▶ Avvia'}</button>
          <button className="pomodoro-btn secondary" onClick={reset}>↺ Reset</button>
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
