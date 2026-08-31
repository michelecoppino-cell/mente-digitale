// @ts-check
// L'avviso di una sveglia: un pannello a tutto schermo che non si può non
// vedere.
//
// Una pastiglia in un angolo non basta. Quando la sveglia suona la mente
// digitale, di solito, non è la finestra davanti: perciò l'avviso è tre cose
// insieme — questo pannello, che copre tutto e pulsa; una notifica di sistema,
// che arriva anche da dietro un'altra finestra; e un suono. Le prime due le
// mette in fila `useSveglie`, questo è il pannello.
//
// Si chiude solo di proposito: nessun clic sullo sfondo, nessun Esc. Se il
// gesto per zittirla fosse lo stesso con cui si scarta una finestra qualunque,
// la si zittirebbe senza averla letta.
import { useEffect, useState } from 'react';
import './SvegliaAlert.css';

/**
 * @param {Object} props
 * @param {{ task: import('./taskStore').Task, ora: string, key: string }[]} props.sveglie
 *        le sveglie che stanno suonando: se ne accumulano più d'una quando il
 *        PC torna dallo standby con due ore già passate
 * @param {(key: string) => void} props.onChiudi         zittisce una sveglia
 * @param {() => void} props.onChiudiTutte
 * @param {(task: import('./taskStore').Task) => void} [props.onApri]  porta all'attività
 */
export default function SvegliaAlert({ sveglie, onChiudi, onChiudiTutte, onApri }) {
  const [adesso, setAdesso] = useState(() => new Date());

  // L'ora grande in cima resta viva: dice da quanto sta suonando senza doverlo
  // scrivere, e distingue a colpo d'occhio l'avviso appena arrivato da quello
  // che aspetta da un quarto d'ora.
  useEffect(() => {
    const id = setInterval(() => setAdesso(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!sveglie.length) return null;

  return (
    <div className="sveglia-scrim" role="alertdialog" aria-modal="true" aria-label="Sveglia">
      <div className="sveglia-panel">
        <div className="sveglia-ring" aria-hidden="true">⏰</div>

        <div className="sveglia-now">
          {String(adesso.getHours()).padStart(2, '0')}:{String(adesso.getMinutes()).padStart(2, '0')}
        </div>
        <p className="sveglia-eyebrow">
          {sveglie.length === 1 ? 'È l’ora di' : `${sveglie.length} sveglie insieme`}
        </p>

        <ul className="sveglia-list">
          {sveglie.map(s => (
            <li key={s.key} className="sveglia-item">
              <div className="sveglia-item-text">
                <span className="sveglia-item-title">{s.task.titolo}</span>
                <span className="sveglia-item-meta">
                  {[s.ora, s.task._listName].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="sveglia-item-actions">
                {onApri && (
                  <button
                    className="sveglia-btn"
                    onClick={() => { onApri(s.task); onChiudi(s.key); }}>
                    Vai
                  </button>
                )}
                <button className="sveglia-btn primary" onClick={() => onChiudi(s.key)}>
                  Ho capito
                </button>
              </div>
            </li>
          ))}
        </ul>

        {sveglie.length > 1 && (
          <button className="sveglia-btn wide" onClick={onChiudiTutte}>Zittisci tutte</button>
        )}
      </div>
    </div>
  );
}
