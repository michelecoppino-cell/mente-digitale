// @ts-check
// Incolla in massa: la casella in cui si buttano centocinquanta righe.
//
// Senza, il caricamento iniziale ferma tutto alla seconda commessa — duecento
// voci scritte una alla volta non le scrive nessuno — quindi è la funzione che
// decide se il Programma verrà usato davvero, non un accessorio.
//
// L'anteprima prima di confermare non è cortesia: qui dentro nascono
// **pacchetti nuovi**, e vederli elencati prima è la differenza fra una
// convenzione e un pasticcio da ripulire a mano. Nessuna lista viene creata:
// quelle nascono solo attivando.
import { useMemo, useState } from 'react';
import { conVociIncollate } from '../programma.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string|null} props.pacchettoScelto  il pacchetto per le righe che non lo dicono
 * @param {(testo: string) => Promise<void>|void} props.onIncolla
 */
export default function IncollaVoci({ doc, pacchettoScelto, onIncolla }) {
  const [testo, setTesto] = useState('');
  const [inCorso, setInCorso] = useState(false);

  // L'anteprima è la funzione vera applicata a una copia: se la mostrasse un
  // conto scritto a parte, i due potrebbero raccontare due cose diverse.
  const anteprima = useMemo(() => (
    testo.trim() ? conVociIncollate(doc, testo, { pacchettoId: pacchettoScelto }) : null
  ), [testo, doc, pacchettoScelto]);

  return (
    <div className="pg-incolla">
      <div className="eyebrow">Incolla in massa</div>
      <textarea
        className="pg-incolla-campo"
        rows={4}
        value={testo}
        placeholder={'A60 Fondazioni | Calcolo plinti P5-P8 | 60 | Marco'}
        onChange={e => setTesto(e.target.value)}
      />
      <div className="pg-incolla-piede">
        <span className="pg-incolla-sintassi">pacchetto | titolo | ore | risorsa — una riga per voce</span>
        <span className="pg-filtri-sp" />
        {anteprima && (
          <span className="pg-incolla-conto">
            {anteprima.aggiunte} voci
            {anteprima.pacchettiNuovi.length > 0 && ` · ${anteprima.pacchettiNuovi.length} pacchetti nuovi: ${anteprima.pacchettiNuovi.join(', ')}`}
            {anteprima.scartate.length > 0 && ` · ${anteprima.scartate.length} righe senza titolo, saltate`}
          </span>
        )}
        <button
          type="button"
          className="pg-btn pg-btn-accento"
          disabled={!anteprima || !anteprima.aggiunte || inCorso}
          onClick={async () => {
            setInCorso(true);
            try { await onIncolla(testo); setTesto(''); } finally { setInCorso(false); }
          }}
        >
          Aggiungi
        </button>
      </div>
    </div>
  );
}
