// @ts-check
// Il Programma di commessa: le ore vendute, i pacchetti in cui si dividono, le
// persone che le fanno e le settimane in cui succede.
//
// Sta **sopra** le attività e non è un secondo tipo di attività. Il Piano è la
// giornata — fasce da mezz'ora, blocchi trascinati, l'orologio; il Programma è
// i mesi — settimane, ore aggregate, persone. Non si toccano, e l'unico punto
// di contatto è la voce attivata, che genera un'attività vera e da lì in poi si
// limita a raccontare cosa le sta succedendo.
//
// Il guscio è quello di Sezioni — elenco a sinistra che si chiude, colonne di
// lavoro, dettaglio a destra — ma **copiato nelle classi, non importato**:
// `SectionsView` è mille righe cucite addosso alla sua vista, e spezzarlo per
// riusarne il telaio vorrebbe dire accoppiare due pannelli che non hanno
// nient'altro in comune. Le misure e i token invece sono gli stessi, ed è
// quello che fa somigliare le due schermate.
//
// Il rischio dichiarato — «costruisco la struttura e poi non me ne faccio
// niente» — è tenuto basso per costruzione: **nessun'altra vista dipende da
// questa**. Se il Programma venisse abbandonato resterebbero un file JSON e una
// voce di menù, e le attività già attivate vivono benissimo da sole: non sanno
// nemmeno di essere nate qui.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryClient, qk, STALE } from './queryClient';
import {
  leggiRegistro, leggiProgramma, cambiaProgramma, creaProgramma, aggiornaRegistrazione, salvaCelle,
} from './programmaStore';
import {
  totali, settimaneDellaMatrice, oreVoci, statoVoce, conVoceAggiornata, conVoci,
  conVociIncollate, conVoceAttivata, conPacchettoAggiornato, conCarico, pacchettiCheSforano,
  daCollocarePerPacchetto,
} from './programma';
import { creaTask, eliminaTask } from './taskStore';
import { settimanaIso } from './tempo.js';
import Matrice from './programma/Matrice.jsx';
import { oreBrevi } from './programma/formato.js';
import ElencoVoci from './programma/ElencoVoci.jsx';
import DettaglioVoce from './programma/DettaglioVoce.jsx';
import AttivaVoce from './programma/AttivaVoce.jsx';
import IncollaVoci from './programma/IncollaVoci.jsx';
import { useMediaQuery } from './useMediaQuery';
import Skeleton from './Skeleton';
import './ProgrammaView.css';

/** @typedef {import('./programma').DocProgramma} DocProgramma */
/** @typedef {import('./programma').Voce} Voce */

/** Il numero con lo spazio fra le migliaia: 1 200, non 1200. */
const conMigliaia = (/** @type {number} */ n) => (
  Math.round(n).toLocaleString('it-IT').replace(/\u00a0/g, '\u202f'));

/** Il margine col segno sempre scritto: `+ 84 h`, `− 84 h`. */
const conSegno = (/** @type {number} */ n) => (
  `${n < 0 ? '−' : '+'} ${conMigliaia(Math.abs(n))} h`);

/**
 * @param {object} props
 * @param {{ id: string, displayName: string }[]} props.todoLists
 * @param {import('./taskStore').Task[]} props.tasks   il pool delle attività aperte
 * @param {boolean} props.poolPronto
 * @param {(nome: string) => Promise<{ id: string, displayName: string }>} props.onCreateDeliverable
 * @param {(listId: string, task: import('./taskStore').Task) => void} props.onTaskCreato
 * @param {(listId: string, taskId: string) => void} props.onTaskRimosso
 */
export default function ProgrammaView({
  todoLists, tasks, poolPronto, onCreateDeliverable, onTaskCreato, onTaskRimosso,
}) {
  const { programmaId } = useParams();
  const navigate = useNavigate();
  const stretto = useMediaQuery('(max-width: 860px)');

  const registro = useQuery({
    queryKey: qk.programmi(),
    queryFn: () => leggiRegistro(),
    staleTime: STALE.programmi,
  });
  const programmi = registro.data?.programmi || [];
  const accesi = programmi.filter(p => p.attivo);
  const scelto = programmi.find(p => p.id === programmaId) || accesi[0] || null;

  const documento = useQuery({
    queryKey: qk.programma(scelto?.id || ''),
    queryFn: () => leggiProgramma(/** @type {string} */ (scelto?.id)),
    staleTime: STALE.programma,
    enabled: !!scelto,
  });
  const doc = documento.data || null;

  const [railChiuso, setRailChiuso] = useState(true);
  const [pacchettoScelto, setPacchettoScelto] = useState(/** @type {string|null} */ (null));
  const [scheda, setScheda] = useState(/** @type {'matrice'|'voci'} */ ('matrice'));
  const [voceScelta, setVoceScelta] = useState(/** @type {string|null} */ (null));
  const [selezione, setSelezione] = useState(/** @type {string[]} */ ([]));
  const [attivaAperta, setAttivaAperta] = useState(false);
  const [soloScoperte, setSoloScoperte] = useState(false);
  const [salvataggio, setSalvataggio] = useState(/** @type {'fermo'|'salvo'|'salvato'|'errore'} */ ('fermo'));
  const [toast, setToast] = useState(/** @type {{ testo: string, annulla: () => void, apri?: () => void }|null} */ (null));

  const settimanaOra = settimanaIso();
  const settimane = useMemo(() => (doc ? settimaneDellaMatrice(doc, settimanaOra) : []), [doc, settimanaOra]);
  const attivitaAperte = useMemo(() => new Set(tasks.map(t => t.id)), [tasks]);

  // ── Le scritture ───────────────────────────────────────────────────────────
  // Le celle si accumulano qui e partono insieme dopo 800ms: la matrice si
  // compila a raffica, e una `putDriveJson` per ogni cifra battuta vorrebbe
  // dire una richiesta di rete ogni tasto. Il documento in cache si aggiorna
  // subito, così quello che si vede è sempre quello che si è appena scritto.
  const pendenti = useRef(/** @type {Record<string, number>} */ ({}));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  const pilaAnnulla = useRef(/** @type {Record<string, number>[]} */ ([]));

  const scarica = useCallback(async () => {
    if (!scelto) return;
    const daScrivere = pendenti.current;
    pendenti.current = {};
    if (!Object.keys(daScrivere).length) return;
    setSalvataggio('salvo');
    try {
      const aggiornato = await salvaCelle(scelto.id, daScrivere);
      // Quello che è stato battuto mentre la scrittura era in volo non deve
      // sparire sotto la risposta del server: si rimette sopra.
      queryClient.setQueryData(qk.programma(scelto.id), (
        Object.entries(pendenti.current).reduce((d, [k, o]) => conCarico(d, k, o), aggiornato)));
      setSalvataggio('salvato');
    } catch (e) {
      // Le celle tornano in coda: un errore di rete non deve costare quello che
      // si è appena scritto.
      pendenti.current = { ...daScrivere, ...pendenti.current };
      setSalvataggio('errore');
      console.warn('Programma: salvataggio non riuscito', e);
      timer.current = setTimeout(scarica, 5000);
    }
  }, [scelto]);

  // Quello che è in coda si scrive uscendo dalla vista: senza, cambiare
  // schermata entro gli 800 millisecondi butterebbe via l'ultima cella.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); scarica(); }, [scarica]);

  /** @param {Record<string, number>} celle */
  function scriviCelle(celle) {
    if (!scelto || !doc) return;
    // Per l'annulla si tiene il valore *di prima* di ogni cella toccata.
    pilaAnnulla.current = [
      ...pilaAnnulla.current.slice(-19),
      Object.fromEntries(Object.keys(celle).map(k => [k, doc.carico[k] || 0])),
    ];
    applica(celle);
  }

  /** @param {Record<string, number>} celle */
  function applica(celle) {
    if (!scelto) return;
    queryClient.setQueryData(qk.programma(scelto.id), (/** @type {DocProgramma|undefined} */ prec) => (
      prec ? Object.entries(celle).reduce((d, [k, o]) => conCarico(d, k, o), prec) : prec));
    Object.assign(pendenti.current, celle);
    setSalvataggio('salvo');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(scarica, 800);
  }

  function annulla() {
    const ultimo = pilaAnnulla.current.pop();
    if (ultimo) applica(ultimo);
  }

  /**
   * Una modifica al documento che non sono celle. Prima si svuota la coda del
   * carico: `cambiaProgramma` rilegge il file, e quello che non è ancora
   * arrivato su OneDrive verrebbe scavalcato dalla risposta.
   * @param {(doc: DocProgramma) => DocProgramma} muta
   */
  async function cambia(muta) {
    if (!scelto) return;
    if (timer.current) clearTimeout(timer.current);
    await scarica();
    queryClient.setQueryData(qk.programma(scelto.id), (/** @type {DocProgramma|undefined} */ prec) => (
      prec ? muta(prec) : prec));
    try {
      const aggiornato = await cambiaProgramma(scelto.id, muta);
      queryClient.setQueryData(qk.programma(scelto.id), aggiornato);
    } catch (e) {
      console.warn('Programma: modifica non riuscita', e);
      documento.refetch();
    }
  }

  // ── L'attivazione ──────────────────────────────────────────────────────────

  /**
   * Genera le attività vere. La voce non diventa il task: lo **genera**, e il
   * legame va in una direzione sola — la voce cita il task per id, il task non
   * sa niente del programma.
   * @param {Voce[]} voci
   * @param {{ risorsePerVoce: Record<string, string>, scadenza: string, listId: string|null, nomeLista: string }} dati
   */
  async function attiva(voci, dati) {
    if (!doc) return;
    const pacchettoId = voci[0]?.pacchettoId || null;
    // La lista nasce qui e solo qui: un pacchetto senza attivazioni non deve
    // lasciare una lista vuota nella vista Attività.
    const lista = dati.listId
      ? todoLists.find(l => l.id === dati.listId)
      : await onCreateDeliverable(dati.nomeLista);
    if (!lista) return;

    /** @type {{ voce: Voce, task: import('./taskStore').Task }[]} */
    const creati = [];
    for (const voce of voci) {
      const persona = (dati.risorsePerVoce[voce.id] || '').trim();
      const task = await creaTask(lista.id, {
        titolo: voce.titolo,
        // A qualcun altro è una delega vera, con la sua colonna in Attività; a
        // te è semplicemente la prossima cosa da fare.
        stato: persona ? 'delegated' : 'next',
        persona: persona || null,
        contesto: 'lavoro',
        scadenza: dati.scadenza || null,
        stimaMin: voce.ore ? Math.round(voce.ore * 60) : null,
        nota: voce.nota || '',
      });
      onTaskCreato(lista.id, task);
      creati.push({ voce, task });
    }

    await cambia(d => {
      let x = creati.reduce((acc, { voce, task }) => conVoceAttivata(acc, voce.id, {
        taskId: task.id,
        listId: lista.id,
        risorsa: (dati.risorsePerVoce[voce.id] || '').trim() || null,
      }), d);
      // Da adesso il pacchetto sa qual è la sua lista, e le prossime
      // attivazioni non la ricreano.
      if (pacchettoId && !d.pacchetti.find(p => p.id === pacchettoId)?.listId) {
        x = conPacchettoAggiornato(x, pacchettoId, { listId: lista.id });
      }
      return x;
    });

    setAttivaAperta(false);
    setSelezione([]);
    setToast({
      testo: creati.length > 1
        ? `${creati.length} attività create in ${lista.displayName}`
        : `Attività creata: ${creati[0].task.titolo}${creati[0].task.persona ? ` → ${creati[0].task.persona}` : ''}`,
      apri: () => navigate('/attivita'),
      // La sicurezza di questo gesto è tutta qui: nessuna conferma prima,
      // l'annulla dopo. Cancella i task appena creati e riporta le voci a
      // «prevista».
      annulla: async () => {
        for (const { task } of creati) {
          await eliminaTask(lista.id, task.id).catch(() => {});
          onTaskRimosso(lista.id, task.id);
        }
        await cambia(d => creati.reduce((acc, { voce }) => conVoceAggiornata(acc, voce.id, {
          taskId: null, listId: null, attivataIl: null,
        }), d));
        setToast(null);
      },
    });
  }

  // Il toast dura otto secondi: il tempo di accorgersi di aver attivato la
  // voce sbagliata, non tanto da restare lì mentre se ne attivano altre dieci.
  useEffect(() => {
    if (!toast) return undefined;
    const via = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(via);
  }, [toast]);

  // ── Le viste ───────────────────────────────────────────────────────────────

  if (registro.isLoading) return <div className="pg"><Skeleton /></div>;

  if (!scelto) {
    return (
      <div className="pg pg-vuoto">
        <div className="pg-benvenuto">
          <h2 className="pg-benvenuto-titolo">Il programma di una commessa</h2>
          <p className="pg-empty">
            Quante ore sono vendute, come si dividono in pacchetti, chi le fa e in che settimana.
            Le voci restano qui finché non le assegni: prima di allora non stanno nel pool, non
            scadono e non suonano.
          </p>
          <button
            type="button"
            className="pg-btn pg-btn-accento"
            onClick={async () => {
              const nome = prompt('Nome della commessa (es. 2573 · Sottopasso ferroviario)');
              if (!nome) return;
              const creata = await creaProgramma(nome, {});
              await registro.refetch();
              navigate(`/programma/${creata.id}`);
            }}
          >
            Comincia una commessa
          </button>
        </div>
      </div>
    );
  }

  const numeri = doc ? totali(doc, { pacchettoId: pacchettoScelto, settimanaOra }) : null;
  const pacchetto = doc?.pacchetti.find(p => p.id === pacchettoScelto) || null;
  const voce = doc?.voci.find(v => v.id === voceScelta) || null;
  const statoDellaVoce = voce ? statoVoce(voce, attivitaAperte, poolPronto) : null;
  const sfori = doc && numeri && numeri.margine < 0 ? pacchettiCheSforano(doc) : [];
  const daCollocare = doc ? daCollocarePerPacchetto(doc) : new Map();

  return (
    <div className="pg">
      {railChiuso ? (
        <button type="button" className="pg-rail-chiuso" onClick={() => setRailChiuso(false)} title="Apri l'elenco dei programmi">
          <span className="pg-rail-freccia">›</span>
          <span className="pg-rail-verticale">{scelto.nome}</span>
        </button>
      ) : (
        <div className="pg-rail">
          <div className="pg-rail-testa">
            <span className="eyebrow eyebrow-accent">Programmi attivi</span>
            <button type="button" className="pg-chiudi" onClick={() => setRailChiuso(true)} aria-label="Chiudi l'elenco">‹</button>
          </div>
          <div className="pg-rail-corpo">
            {accesi.map(p => (
              <div key={p.id}>
                <button
                  type="button"
                  className={`pg-rail-voce${p.id === scelto.id ? ' scelta' : ''}`}
                  onClick={() => { navigate(`/programma/${p.id}`); setPacchettoScelto(null); setRailChiuso(true); }}
                >
                  <span className="pg-rail-nome">{p.nome}</span>
                  {p.id === scelto.id && doc && <span className="pg-rail-ore">{conMigliaia(doc.commessa.oreVendute)} h</span>}
                </button>
                {p.id === scelto.id && doc?.pacchetti.map(pk => (
                  <button
                    type="button"
                    key={pk.id}
                    className={`pg-rail-pacchetto${pacchettoScelto === pk.id ? ' scelto' : ''}`}
                    onClick={() => { setPacchettoScelto(x => (x === pk.id ? null : pk.id)); setRailChiuso(true); }}
                  >
                    <span className="pg-punto" style={pk.colore ? { background: pk.colore } : undefined} />
                    <span className="pg-rail-nome">{pk.nome}</span>
                    <span className="pg-rail-ore">{oreBrevi(oreVoci(doc, v => v.pacchettoId === pk.id))}</span>
                  </button>
                ))}
              </div>
            ))}

            {programmi.some(p => !p.attivo) && (
              <div className="pg-rail-spenti">
                <div className="eyebrow">Spenti</div>
                {programmi.filter(p => !p.attivo).map(p => (
                  <button
                    type="button"
                    key={p.id}
                    className="pg-rail-spento"
                    onClick={async () => { await aggiornaRegistrazione(p.id, { attivo: true }); registro.refetch(); }}
                  >
                    {p.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pg-centro">
        <header className="pg-testata">
          <div className="pg-testata-riga">
            <div className="pg-testata-nome">
              <h1 className="pg-commessa">{doc?.commessa.nome || scelto.nome}</h1>
              <div className="pg-commessa-meta">
                {doc?.commessa.inizio && doc?.commessa.fine
                  ? `${doc.commessa.inizio} → ${doc.commessa.fine} · ${settimane.length} settimane`
                  : `${settimane.length} settimane`}
                {doc ? ` · ${doc.risorse.length} risorse` : ''}
              </div>
            </div>
            <span className="pg-testata-sp" />
            {numeri && (
              <div className="pg-numeri">
                <div className="pg-margine-blocco">
                  <div className={`pg-margine${numeri.margine < 0 ? ' negativo' : ''}`}>{conSegno(numeri.margine)}</div>
                  <div className="eyebrow">margine{pacchetto ? ` ${pacchetto.nome}` : ''}</div>
                </div>
                <div className="pg-controllo">
                  <span>vendute <b>{conMigliaia(numeri.vendute)}</b></span>
                  <span>stimate <b>{conMigliaia(numeri.stimate)}</b></span>
                  <span>speso <b>{conMigliaia(numeri.speso)}</b></span>
                  <span>a finire <b>{conMigliaia(numeri.aFinire)}</b></span>
                </div>
              </div>
            )}
          </div>

          {sfori.length > 0 && (
            <div className="pg-dove">
              il rosso viene da {sfori.map(s => `${s.pacchetto.nome} (+${oreBrevi(s.sforo)})`).join(' e ')}
            </div>
          )}

          {doc && doc.pacchetti.length > 0 && (
            <div className="pg-chip-riga">
              <span className="eyebrow">pacchetti</span>
              {doc.pacchetti.map(p => (
                <button
                  type="button"
                  key={p.id}
                  className={`pg-chip${pacchettoScelto === p.id ? ' scelto' : ''}`}
                  onClick={() => setPacchettoScelto(x => (x === p.id ? null : p.id))}
                >
                  <span className="pg-punto" style={p.colore ? { background: p.colore } : undefined} />
                  {p.nome}
                  {(daCollocare.get(p.id) || 0) > 0 && <span className="pg-chip-resto">{oreBrevi(daCollocare.get(p.id) || 0)}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="pg-schede">
            {!stretto && (
              <button
                type="button"
                className={`pg-scheda${scheda === 'matrice' ? ' scelta' : ''}`}
                onClick={() => setScheda('matrice')}
              >
                Matrice
              </button>
            )}
            <button
              type="button"
              className={`pg-scheda${scheda === 'voci' || stretto ? ' scelta' : ''}`}
              onClick={() => setScheda('voci')}
            >
              Elenco voci
            </button>
            <span className="pg-testata-sp" />
            <span className="pg-salvataggio">
              {salvataggio === 'salvo' && 'salvo…'}
              {salvataggio === 'salvato' && 'salvato'}
              {salvataggio === 'errore' && 'non salvato — riprovo'}
            </span>
          </div>
        </header>

        {/* Il delta fra le voci e le celle, sempre a schermo: è la domanda del
            coordinatore, e l'unico modo di tenere due dati veri senza
            inseguirli a mano. A zero non compare — un contatore fermo è
            rumore. */}
        {numeri && numeri.daCollocare !== 0 && (
          <div className="pg-delta">
            <span>voci {conMigliaia(numeri.stimate)} · a piano {conMigliaia(numeri.aPiano)}</span>
            {' · '}
            <button
              type="button"
              className="pg-delta-link"
              onClick={() => { setScheda('voci'); setSoloScoperte(true); }}
            >
              {conMigliaia(Math.abs(numeri.daCollocare))} h {numeri.daCollocare > 0 ? 'da collocare' : 'a piano in più delle voci'}
            </button>
          </div>
        )}

        {!doc ? (
          <div className="pg-corpo"><Skeleton /></div>
        ) : stretto ? (
          <div className="pg-corpo">
            <p className="pg-empty pg-solo-portatile">La matrice si apre da portatile.</p>
            <ElencoVoci
              doc={doc}
              attivita={tasks}
              poolPronto={poolPronto}
              voceScelta={voceScelta}
              pacchettoScelto={pacchettoScelto}
              selezione={selezione}
              onSelezione={setSelezione}
              onScegli={setVoceScelta}
              onAttivaBlocco={() => setAttivaAperta(true)}
            />
          </div>
        ) : scheda === 'matrice' ? (
          <Matrice
            doc={doc}
            settimane={settimane}
            settimanaOra={settimanaOra}
            pacchettoScelto={pacchettoScelto}
            onCelle={scriviCelle}
            onAnnulla={annulla}
            onSceltaRiga={(_risorsa, pacchettoId) => setPacchettoScelto(pacchettoId)}
          />
        ) : (
          <div className="pg-corpo">
            <ElencoVoci
              doc={doc}
              attivita={tasks}
              poolPronto={poolPronto}
              voceScelta={voceScelta}
              pacchettoScelto={pacchettoScelto}
              selezione={selezione}
              onSelezione={setSelezione}
              onScegli={id => { setVoceScelta(id); setAttivaAperta(false); }}
              onAttivaBlocco={() => setAttivaAperta(true)}
              soloScoperte={soloScoperte}
              incolla={(
                <IncollaVoci
                  doc={doc}
                  pacchettoScelto={pacchettoScelto}
                  onIncolla={testo => cambia(d => conVociIncollate(d, testo, { pacchettoId: pacchettoScelto }).doc)}
                />
              )}
            />
          </div>
        )}
      </div>

      {doc && voce && statoDellaVoce && (
        <DettaglioVoce
          key={voce.id}
          doc={doc}
          voce={voce}
          stato={statoDellaVoce}
          task={tasks.find(t => t.id === voce.taskId) || null}
          settimane={settimane}
          onPatch={patch => cambia(d => conVoceAggiornata(d, voce.id, patch))}
          onScomponi={figlie => cambia(d => conVoci(d, figlie.map(f => ({
            titolo: f.titolo, ore: f.ore, oreIniziali: f.ore,
            padreId: voce.id, pacchettoId: voce.pacchettoId, risorsa: voce.risorsa,
          }))))}
          onChiudi={() => { setVoceScelta(null); setAttivaAperta(false); }}
          onApriAttiva={() => setAttivaAperta(true)}
          onApriAttivita={() => navigate('/attivita')}
          attiva={attivaAperta && (
            <AttivaVoce
              doc={doc}
              voci={selezione.length > 1
                ? doc.voci.filter(v => selezione.includes(v.id))
                : [voce]}
              todoLists={todoLists}
              onCrea={dati => attiva(
                selezione.length > 1 ? doc.voci.filter(v => selezione.includes(v.id)) : [voce],
                dati,
              )}
              onChiudi={() => setAttivaAperta(false)}
            />
          )}
        />
      )}

      {/* L'attivazione in blocco dall'elenco: la selezione c'è ma nessuna voce
          è aperta nel dettaglio, quindi il modulo sta per conto suo. */}
      {doc && attivaAperta && !voce && selezione.length > 0 && (
        <aside className="pg-dettaglio">
          <div className="pg-col-head">
            <span className="eyebrow eyebrow-accent">Attiva in blocco</span>
            <button type="button" className="pg-chiudi" onClick={() => setAttivaAperta(false)} aria-label="Chiudi">✕</button>
          </div>
          <div className="pg-dettaglio-corpo">
            <AttivaVoce
              doc={doc}
              voci={doc.voci.filter(v => selezione.includes(v.id))}
              todoLists={todoLists}
              onCrea={dati => attiva(doc.voci.filter(v => selezione.includes(v.id)), dati)}
              onChiudi={() => setAttivaAperta(false)}
            />
          </div>
        </aside>
      )}

      {toast && (
        <div className="pg-toast">
          <span>{toast.testo}</span>
          {toast.apri && <button type="button" className="pg-toast-azione" onClick={toast.apri}>Apri</button>}
          <button type="button" className="pg-toast-azione" onClick={toast.annulla}>Annulla</button>
        </div>
      )}
    </div>
  );
}
