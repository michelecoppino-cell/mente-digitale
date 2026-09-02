// @ts-check
// La scheda della commessa: i dati che prima non si potevano più toccare.
//
// Nella prima versione una commessa nasceva da un `prompt()` col solo nome, e
// da lì in poi ore vendute, date, pacchetti e risorse erano **scrivibili solo
// per effetto collaterale** — un pacchetto nasceva incollando voci, una risorsa
// nascendo dentro una riga incollata — e non erano correggibili in nessun modo.
// Un pannello in cui si può solo aggiungere è un pannello che dopo due
// settimane è pieno di roba sbagliata e si smette di aprire.
//
// Quindi qui c'è tutto quello che si aggiusta: la commessa, le persone, i
// pacchetti. Le tre cose stanno in una scheda sola e non in tre posti diversi
// perché si sistemano nello stesso momento — la mezz'ora in cui si mette in
// piedi il programma, e poi quasi mai più.
import { useState } from 'react';
import {
  conCommessa, conPacchetto, conPacchettoAggiornato, senzaPacchetto,
  conRisorsa, conRisorsaAggiornata, conRisorsaRinominata, senzaRisorsa,
  oreVoci, oreCarico, ORE_SETTIMANA_DEFAULT,
} from '../programma.js';
import CampoSezione from './CampoSezione.jsx';
import { oreBrevi } from './formato.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {{ id: string, displayName: string }[]} props.sezioni
 * @param {() => void} [props.onCaricaSezioni]
 * @param {(muta: (doc: DocProgramma) => DocProgramma) => void} props.onCambia
 * @param {(nome: string) => void} props.onRinomina  il nome sta anche nel registro
 * @param {() => void} props.onSpegni
 * @param {() => void} props.onEsporta
 */
export default function SchedaCommessa({
  doc, sezioni, onCaricaSezioni, onCambia, onRinomina, onSpegni, onEsporta,
}) {
  const [pacchettoNuovo, setPacchettoNuovo] = useState('');
  const [risorsaNuova, setRisorsaNuova] = useState('');
  const [daTogliere, setDaTogliere] = useState(/** @type {string|null} */ (null));
  const [destinazione, setDestinazione] = useState('');

  const c = doc.commessa;

  return (
    <div className="pg-scheda-commessa">
      <section className="pg-blocco">
        <div className="eyebrow eyebrow-accent">La commessa</div>
        <div className="pg-griglia-campi">
          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">nome</span>
            <input
              className="pg-campo"
              defaultValue={c.nome}
              key={`nome-${doc.id}`}
              onBlur={e => e.target.value.trim() && e.target.value.trim() !== c.nome && onRinomina(e.target.value.trim())}
            />
          </label>

          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">ore vendute</span>
            <input
              className="pg-campo"
              inputMode="decimal"
              defaultValue={c.oreVendute || ''}
              key={`vendute-${doc.id}-${c.oreVendute}`}
              onBlur={e => {
                const n = Math.max(0, Number(e.target.value.replace(',', '.')) || 0);
                if (n !== c.oreVendute) onCambia(d => conCommessa(d, { oreVendute: n }));
              }}
            />
          </label>

          <div className="pg-campo-riga">
            <span className="pg-campo-etichetta">sezione</span>
            <CampoSezione
              sezioni={sezioni}
              sezione={c.sezione}
              onCarica={onCaricaSezioni}
              onCambia={scelta => onCambia(d => conCommessa(d, scelta))}
            />
          </div>

          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">codice</span>
            <input
              className="pg-campo"
              defaultValue={c.codice}
              key={`codice-${doc.id}-${c.codice}`}
              placeholder={c.sezione || '2573'}
              onBlur={e => e.target.value.trim() !== c.codice && onCambia(d => conCommessa(d, { codice: e.target.value.trim() }))}
            />
            <span className="pg-memo">vuoto = quello della sezione</span>
          </label>

          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">inizio</span>
            <input
              type="date"
              className="pg-campo"
              value={c.inizio || ''}
              onChange={e => onCambia(d => conCommessa(d, { inizio: e.target.value || null }))}
            />
          </label>

          <label className="pg-campo-riga">
            <span className="pg-campo-etichetta">fine</span>
            <input
              type="date"
              className="pg-campo"
              value={c.fine || ''}
              onChange={e => onCambia(d => conCommessa(d, { fine: e.target.value || null }))}
            />
            <span className="pg-memo">è anche la scadenza proposta alle liste</span>
          </label>
        </div>
      </section>

      {/* Le persone. Prima entravano solo di sponda — nominate dentro una riga
          incollata o attivando una voce — e una scritta male restava lì per
          sempre, con le sue ore appese a un nome che non esiste. */}
      <section className="pg-blocco">
        <div className="eyebrow eyebrow-accent">Le persone</div>
        <p className="pg-memo">
          Il nome è lo stesso che compare sulle attività delegate: scritto uguale, un task delegato
          e una riga della matrice parlano della stessa persona. La capacità serve a colorare la
          matrice quando una settimana è troppo piena.
        </p>
        <div className="pg-tabella">
          {doc.risorse.length === 0 && <p className="pg-empty">Nessuna persona: la matrice ha una riga per persona, e resta vuota finché non ce n&apos;è almeno una.</p>}
          {doc.risorse.map(r => (
            <div key={r.nome} className="pg-tabella-riga">
              <input
                className="pg-campo pg-campo-nudo pg-cresce"
                defaultValue={r.nome}
                key={`ris-${r.nome}`}
                onBlur={e => {
                  const nuovo = e.target.value.trim();
                  if (nuovo && nuovo !== r.nome) onCambia(d => conRisorsaRinominata(d, r.nome, nuovo));
                  else e.target.value = r.nome;
                }}
              />
              <input
                className="pg-campo pg-campo-nudo pg-campo-stretto"
                inputMode="decimal"
                defaultValue={r.oreSettimana}
                key={`cap-${r.nome}-${r.oreSettimana}`}
                onBlur={e => {
                  const n = Math.max(0, Number(e.target.value.replace(',', '.')) || 0);
                  if (n !== r.oreSettimana) onCambia(d => conRisorsaAggiornata(d, r.nome, { oreSettimana: n }));
                }}
              />
              <span className="pg-tabella-nota">h/settimana</span>
              <button
                type="button"
                className="pg-scarta"
                onClick={() => onCambia(d => senzaRisorsa(d, r.nome))}
                title="Toglie la persona e le sue ore. Le voci che la proponevano restano."
              >
                togli
              </button>
            </div>
          ))}
        </div>
        <div className="pg-aggiungi">
          <input
            className="pg-campo"
            value={risorsaNuova}
            placeholder="nome e cognome"
            onChange={e => setRisorsaNuova(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || !risorsaNuova.trim()) return;
              onCambia(d => conRisorsa(d, risorsaNuova.trim(), ORE_SETTIMANA_DEFAULT));
              setRisorsaNuova('');
            }}
          />
          <button
            type="button"
            className="pg-btn"
            disabled={!risorsaNuova.trim()}
            onClick={() => { onCambia(d => conRisorsa(d, risorsaNuova.trim(), ORE_SETTIMANA_DEFAULT)); setRisorsaNuova(''); }}
          >
            Aggiungi
          </button>
        </div>
      </section>

      {/* I pacchetti: rinominare, colorare, togliere. Togliere non butta via
          niente — voci e ore passano a un altro pacchetto, o restano senza. */}
      <section className="pg-blocco">
        <div className="eyebrow eyebrow-accent">I pacchetti</div>
        <p className="pg-memo">
          Un pacchetto è un sotto-progetto: è la riga della matrice, il filtro dell&apos;elenco e
          il nome della lista che nascerà attivando. Nasce senza lista apposta.
        </p>
        <div className="pg-tabella">
          {doc.pacchetti.length === 0 && <p className="pg-empty">Nessun pacchetto: le voci possono starci senza, ma la matrice non ha righe in cui scrivere le ore.</p>}
          {doc.pacchetti.map(p => (
            <div key={p.id} className="pg-tabella-riga">
              <input
                type="color"
                className="pg-colore"
                value={p.colore || '#7a8899'}
                onChange={e => onCambia(d => conPacchettoAggiornato(d, p.id, { colore: e.target.value }))}
                title="Il colore del pacchetto"
              />
              <input
                className="pg-campo pg-campo-nudo pg-cresce"
                defaultValue={p.nome}
                key={`pk-${p.id}-${p.nome}`}
                onBlur={e => {
                  const nuovo = e.target.value.trim();
                  if (nuovo && nuovo !== p.nome) onCambia(d => conPacchettoAggiornato(d, p.id, { nome: nuovo }));
                  else e.target.value = p.nome;
                }}
              />
              <span className="pg-tabella-nota">
                {oreBrevi(oreVoci(doc, v => v.pacchettoId === p.id)) || 0} h di voci ·{' '}
                {oreBrevi(oreCarico(doc, { pacchettoId: p.id })) || 0} h a piano
                {p.listId ? ' · ha una lista' : ''}
              </span>
              <button
                type="button"
                className="pg-scarta"
                onClick={() => { setDaTogliere(daTogliere === p.id ? null : p.id); setDestinazione(''); }}
              >
                togli
              </button>
            </div>
          ))}
        </div>

        {daTogliere && (
          <div className="pg-conferma">
            <span>
              Le voci e le ore di «{doc.pacchetti.find(p => p.id === daTogliere)?.nome}» vanno
            </span>
            <select className="pg-campo pg-campo-stretto-medio" value={destinazione} onChange={e => setDestinazione(e.target.value)}>
              <option value="">senza pacchetto</option>
              {doc.pacchetti.filter(p => p.id !== daTogliere).map(p => (
                <option key={p.id} value={p.id}>in {p.nome}</option>
              ))}
            </select>
            <button
              type="button"
              className="pg-btn pg-btn-accento"
              onClick={() => {
                const id = daTogliere;
                const dove = destinazione || null;
                setDaTogliere(null);
                onCambia(d => senzaPacchetto(d, id, { spostaSu: dove }));
              }}
            >
              Togli il pacchetto
            </button>
            <button type="button" className="pg-btn" onClick={() => setDaTogliere(null)}>Lascia stare</button>
            {!destinazione && (
              <span className="pg-memo">
                senza una destinazione le ore già messe in settimana si perdono: le voci restano, le celle no
              </span>
            )}
          </div>
        )}

        <div className="pg-aggiungi">
          <input
            className="pg-campo"
            value={pacchettoNuovo}
            placeholder="A60 Fondazioni"
            onChange={e => setPacchettoNuovo(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || !pacchettoNuovo.trim()) return;
              onCambia(d => conPacchetto(d, { nome: pacchettoNuovo.trim() }));
              setPacchettoNuovo('');
            }}
          />
          <button
            type="button"
            className="pg-btn"
            disabled={!pacchettoNuovo.trim()}
            onClick={() => { onCambia(d => conPacchetto(d, { nome: pacchettoNuovo.trim() })); setPacchettoNuovo(''); }}
          >
            Aggiungi
          </button>
        </div>
      </section>

      <section className="pg-blocco">
        <div className="eyebrow eyebrow-accent">Il documento</div>
        <p className="pg-memo">
          Il programma vive su OneDrive e non serve salvarlo: quello che si scrive è già scritto.
          L&apos;esportazione è un&apos;altra cosa — una fotografia col giorno nel nome, di com&apos;era
          il programma quando lo si è mandato o discusso.
        </p>
        <div className="pg-due-bottoni">
          <button type="button" className="pg-btn" onClick={onEsporta}>Esporta una fotografia (JSON)</button>
          <button type="button" className="pg-btn" onClick={onSpegni}>Spegni questa commessa</button>
        </div>
        <p className="pg-memo">
          Spegnere non cancella niente: il documento resta su OneDrive e la commessa scompare
          dalla colonna di sinistra finché non la si riaccende.
        </p>
      </section>
    </div>
  );
}
