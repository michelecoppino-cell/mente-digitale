// @ts-check
// Il ciclo di vita delle sveglie: guarda l'orologio, decide chi deve suonare,
// e fa suonare.
//
// Un solo posto in tutta l'app tiene questo ciclo (App.jsx lo monta una volta):
// due copie vorrebbero dire due suoni sovrapposti e due notifiche per la
// stessa sveglia.
//
// Il controllo gira ogni 20 secondi e non a un timer piazzato sull'ora esatta,
// per il motivo per cui esiste RITARDO_MAX_MIN in sveglie.js: un `setTimeout`
// di due ore non sopravvive a uno standby del portatile né alla scheda messa a
// dormire dal browser. Guardare che ore sono, spesso, funziona sempre — anche
// dopo che la macchina si è svegliata con tre ore di ritardo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { taskAlarm } from './taskModel';
import {
  sveglieDaSuonare, leggiSuonate, scriviSuonate, suona, notifica,
} from './sveglie';

const INTERVALLO_MS = 20_000;

/**
 * @param {import('./taskStore').Task[]|null} tasks  tutte le attività aperte
 * @returns {{
 *   attive: { task: import('./taskStore').Task, ora: string, key: string }[],
 *   chiudi: (key: string) => void,
 *   chiudiTutte: () => void,
 * }}
 */
export function useSveglie(tasks) {
  const [attive, setAttive] = useState(/** @type {any[]} */ ([]));

  // Le attività cambiano di continuo (ogni patch rifà il pool): tenerle in un
  // ref invece che fra le dipendenze dell'effetto evita di smontare e
  // rimontare l'intervallo a ogni respiro dell'app.
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const suonateRef = useRef(/** @type {Set<string>} */ (new Set()));
  const stopSuonoRef = useRef(/** @type {(() => void)|null} */ (null));
  const notificheRef = useRef(/** @type {Notification[]} */ ([]));

  useEffect(() => { suonateRef.current = leggiSuonate(); }, []);

  const zittisci = useCallback(() => {
    stopSuonoRef.current?.();
    stopSuonoRef.current = null;
    for (const n of notificheRef.current) { try { n.close(); } catch { /* già chiusa */ } }
    notificheRef.current = [];
  }, []);

  useEffect(() => {
    function controlla() {
      const nuove = sveglieDaSuonare(tasksRef.current || [], taskAlarm, suonateRef.current);
      if (!nuove.length) return;

      // Segnate come suonate *subito*, prima ancora di mostrarle: se non lo
      // fossero, il controllo dopo venti secondi le troverebbe di nuovo e
      // farebbe partire un secondo suono sopra il primo.
      for (const s of nuove) suonateRef.current.add(s.key);
      scriviSuonate(suonateRef.current);

      setAttive(prev => [...prev, ...nuove]);

      stopSuonoRef.current?.();
      stopSuonoRef.current = suona();

      for (const s of nuove) {
        const n = notifica(`⏰ ${s.ora} — ${s.task.titolo}`, s.task._listName || 'Mente digitale');
        // Un clic sulla notifica riporta davanti la finestra: è il gesto che
        // ci si aspetta, e senza di esso la notifica dice che c'è qualcosa
        // ma non dove.
        if (n) { n.onclick = () => { try { window.focus(); } catch { /* negato */ } }; notificheRef.current.push(n); }
      }
    }

    controlla();
    const id = setInterval(controlla, INTERVALLO_MS);
    return () => { clearInterval(id); zittisci(); };
  }, [zittisci]);

  const chiudi = useCallback((/** @type {string} */ key) => {
    setAttive(prev => {
      const rest = prev.filter(s => s.key !== key);
      if (!rest.length) zittisci();
      return rest;
    });
  }, [zittisci]);

  const chiudiTutte = useCallback(() => { zittisci(); setAttive([]); }, [zittisci]);

  return { attive, chiudi, chiudiTutte };
}
