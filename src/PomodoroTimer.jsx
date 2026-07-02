import { useState, useEffect, useRef } from 'react';
import './PomodoroTimer.css';

const WORK_MIN  = 25;
const BREAK_MIN = 5;

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

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch { /* audio non disponibile — ignora */ }
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Timer Pomodoro 25/5 agganciato a un blocco specifico della timeline.
// Nessuna persistenza server: lo stato vive finché il widget resta aperto;
// il conteggio dei cicli completati viene riportato al chiamante via onCycleComplete.
export default function PomodoroTimer({ block, onClose, onCycleComplete }) {
  const [phase, setPhase]         = useState('working'); // 'working' | 'break'
  const [secondsLeft, setSeconds] = useState(WORK_MIN * 60);
  const [running, setRunning]     = useState(true);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (Notification?.permission === 'default') Notification.requestPermission();
  }, []);

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

  function handlePhaseEnd() {
    beep();
    if (phase === 'working') {
      onCycleComplete?.();
      notify('Pomodoro completato 🍅', 'Pausa di 5 minuti — stacca un attimo.');
      setPhase('break');
      setSeconds(BREAK_MIN * 60);
    } else {
      notify('Pausa finita', 'Pronto per un altro pomodoro?');
      setPhase('working');
      setSeconds(WORK_MIN * 60);
      setRunning(false);
    }
  }

  function toggle() { setRunning(r => !r); }

  function reset() {
    setRunning(false);
    setPhase('working');
    setSeconds(WORK_MIN * 60);
  }

  return (
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
    </div>
  );
}
