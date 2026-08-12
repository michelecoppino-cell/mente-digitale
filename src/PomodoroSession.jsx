// @ts-check
// Sessione Pomodoro a livello di app.
//
// Il timer che vive dentro PlannerView smette di esistere quando si cambia
// vista: se il Pomodoro deve accompagnare il lavoro dal Piano fino al workbook
// della sezione, la sessione non può stare dentro la pagina che la avvia.
// Qui c'è solo lo stato — la barra che lo mostra è dentro AppShell, montata
// una volta sola sopra il contenuto della rotta.
//
// Una sessione per volta: avviarne una nuova sostituisce la precedente.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PomodoroContext, PomodoroTickContext, sessionElapsedMs } from './pomodoroContext';

const STORAGE_KEY = 'md_pomodoro_session_v1';

/** @returns {import('./pomodoroContext').PomodoroSessionState|null} */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** @param {import('./pomodoroContext').PomodoroSessionState|null} s */
function writeStored(s) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* localStorage pieno o negato: la sessione resta solo in memoria */ }
}

/** @param {{ children: import('react').ReactNode }} props */
export function PomodoroProvider({ children }) {
  const [session, setSession] = useState(readStored);
  // Un tick al secondo serve solo mentre il timer gira: a sessione ferma o
  // assente non c'è nulla da far avanzare.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session || session.state !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => { writeStored(session); }, [session]);

  const start = useCallback((/** @type {Partial<import('./pomodoroContext').PomodoroSessionState>} */ opts = {}) => {
    setNow(Date.now());
    setSession({
      startedAt: new Date().toISOString(),
      durationMin: opts.durationMin ?? 25,
      taskId: opts.taskId ?? null,
      taskTitle: opts.taskTitle ?? null,
      sectionId: opts.sectionId ?? null,
      sectionName: opts.sectionName ?? null,
      state: 'running',
      elapsedMs: 0,
      resumedAt: Date.now(),
    });
  }, []);

  const pause = useCallback(() => {
    setSession(s => (!s || s.state === 'paused') ? s : ({
      ...s,
      state: /** @type {'paused'} */ ('paused'),
      elapsedMs: sessionElapsedMs(s, Date.now()),
      resumedAt: null,
    }));
  }, []);

  const resume = useCallback(() => {
    setNow(Date.now());
    setSession(s => (!s || s.state === 'running') ? s : ({
      ...s,
      state: /** @type {'running'} */ ('running'),
      resumedAt: Date.now(),
    }));
  }, []);

  const stop = useCallback(() => setSession(null), []);

  // La sessione e i comandi cambiano solo quando cambia davvero qualcosa; il
  // tempo trascorso vive nel contesto del tick, letto solo da chi lo mostra
  // (vedi PomodoroTickContext).
  const value = useMemo(() => ({
    session,
    start, pause, resume, stop,
  }), [session, start, pause, resume, stop]);

  return (
    <PomodoroContext.Provider value={value}>
      <PomodoroTickContext.Provider value={sessionElapsedMs(session, now)}>
        {children}
      </PomodoroTickContext.Provider>
    </PomodoroContext.Provider>
  );
}
