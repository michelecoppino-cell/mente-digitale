// @ts-check
// Le ore vere che rientrano.
//
// Il giro è quello dichiarato in `programmaExcel.js`: si esporta il foglio, si
// corregge la colonna della settimana appena chiusa con quello che è successo
// davvero, si torna qui e si incolla. Fin qui la matrice si compilava a mano e
// basta: una previsione che nessuno correggeva, e quindi un margine che dopo
// due mesi non voleva più dire niente.
//
// **Si vede cosa cambia prima che cambi.** Un consuntivo sostituisce le celle
// che tocca, e sostituire è irreversibile in un modo che scrivere una cella non
// è: qui si sta per riscrivere un mese di ore di quattro persone in un gesto.
// Quindi il riquadro conta le celle, le persone e le settimane, dice quante ore
// c'erano e quante ce ne saranno, ed elenca le righe che non ha capito —
// **prima**, non dopo. Il bottone si accende solo quando c'è qualcosa da
// applicare.
//
// L'annulla resta quello della matrice (⌘Z): le celle passano da `onCelle`
// come tutte le altre, quindi la pila dell'annulla le prende senza saperne
// niente.
import { useState } from 'react';
import { leggiOreRegistrate, differenza } from '../programmaExcel.js';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string[]} props.settimane            l'orizzonte, per risolvere «W36» senza anno
 * @param {(celle: Record<string, number>) => void} props.onApplica
 * @param {() => void} props.onChiudi
 */
export default function OreRegistrate({ doc, settimane, onApplica, onChiudi }) {
  const [testo, setTesto] = useState('');

  const lettura = testo.trim() ? leggiOreRegistrate(doc, testo, { settimane }) : null;
  const quante = lettura ? Object.keys(lettura.celle).length : 0;
  const { prima, dopo } = lettura ? differenza(doc, lettura.celle) : { prima: 0, dopo: 0 };

  return (
    <div className="pg-velo" onMouseDown={e => { if (e.target === e.currentTarget) onChiudi(); }}>
      <div className="pg-modale pg-modale-largo" onKeyDown={e => { if (e.key === 'Escape') onChiudi(); }}>
        <div className="pg-col-head">
          <span className="eyebrow eyebrow-accent">Ore registrate</span>
          <button type="button" className="pg-chiudi" onClick={onChiudi} aria-label="Chiudi">✕</button>
        </div>

        <div className="pg-modale-corpo">
          <p className="pg-memo">
            Incolla dal foglio ore. Vanno bene tutte e due le forme: il
            <b> rettangolo della Matrice</b> come esce dall&apos;esportazione — persona, pacchetto e
            una colonna per settimana, intestazione compresa — oppure righe sciolte
            <code> persona | pacchetto | settimana | ore</code>.
          </p>
          <p className="pg-memo">
            Le ore incollate <b>sostituiscono</b> quelle che ci sono: sono un consuntivo, non
            un&apos;aggiunta. Una cella lasciata vuota non si tocca, così si può correggere una
            settimana sola senza azzerare le altre.
          </p>

          <textarea
            className="pg-incolla-campo pg-incolla-alto"
            autoFocus
            value={testo}
            onChange={e => setTesto(e.target.value)}
            placeholder={`Persona\tPacchetto\t${settimane[0] || '2026-W36'}\n${doc.risorse[0]?.nome || 'Marco'}\n\t${doc.pacchetti[0]?.nome || 'B10 Fondazioni'}\t31`}
          />

          {lettura && (
            <div className="pg-lettura">
              {quante === 0 ? (
                <p className="pg-empty">
                  Niente di riconoscibile. Serve una riga di intestazione con le settimane, o
                  quattro colonne per riga.
                </p>
              ) : (
                <>
                  <div className="pg-lettura-conti">
                    <span><b>{lettura.sostituite}</b> {lettura.sostituite === 1 ? 'cella cambia' : 'celle cambiano'}</span>
                    <span>{lettura.persone.length} {lettura.persone.length === 1 ? 'persona' : 'persone'}</span>
                    <span>{lettura.settimane.length} {lettura.settimane.length === 1 ? 'settimana' : 'settimane'}</span>
                    <span className={dopo > prima ? 'pg-lettura-su' : ''}>
                      {oreBrevi(prima)} h → <b>{oreBrevi(dopo)} h</b>
                    </span>
                  </div>
                  <div className="pg-lettura-chi">
                    {lettura.persone.join(', ')}
                    {lettura.settimane.length > 0 && ` · ${lettura.settimane[0]}`}
                    {lettura.settimane.length > 1 && ` → ${lettura.settimane[lettura.settimane.length - 1]}`}
                  </div>
                </>
              )}

              {/* Quello che non si è capito si dice. In un consuntivo una riga
                  persa in silenzio è un margine sbagliato che poi nessuno sa da
                  dove venga. */}
              {lettura.ignorate.length > 0 && (
                <div className="pg-lettura-scartate">
                  <div className="eyebrow">
                    {lettura.ignorate.length === 1
                      ? 'una riga non capita'
                      : `${lettura.ignorate.length} righe non capite`}
                    {' — persona o pacchetto che qui non esistono'}
                  </div>
                  {lettura.ignorate.slice(0, 6).map((riga, i) => <div key={i} className="pg-scartata">{riga}</div>)}
                  {lettura.ignorate.length > 6 && <div className="pg-scartata">…e altre {lettura.ignorate.length - 6}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pg-incolla-piede">
          <button type="button" className="pg-btn" onClick={onChiudi}>Annulla</button>
          <button
            type="button"
            className="pg-btn pg-btn-accento"
            disabled={quante === 0}
            onClick={() => { if (lettura) onApplica(lettura.celle); }}
          >
            {quante === 0
              ? 'Applica'
              : `Applica a ${lettura?.sostituite || quante} ${(lettura?.sostituite || quante) === 1 ? 'cella' : 'celle'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
