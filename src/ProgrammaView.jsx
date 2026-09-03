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
// **Le quattro schede sono l'ordine in cui si lavora**, non quattro pagine
// pari: Matrice e Elenco voci sono il lavoro di tutti i giorni, Riepilogo è la
// domanda del coordinatore («come sta messa tutta la commessa»), Impostazioni è
// la mezz'ora in cui si mette in piedi il programma e poi quasi mai più. Nella
// prima versione le ultime due non c'erano, e il risultato era un pannello in
// cui si poteva solo aggiungere: nessun modo di creare una seconda commessa,
// di correggere un pacchetto, di vedere l'insieme, di dire quante ore erano già
// state spese.
//
// Il rischio dichiarato — «costruisco la struttura e poi non me ne faccio
// niente» — è tenuto basso per costruzione: **nessun'altra vista dipende da
// questa**. Se il Programma venisse abbandonato resterebbero un file JSON e una
// voce di menù, e le attività già attivate vivono benissimo da sole: non sanno
// nemmeno di essere nate qui.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient, qk, STALE } from './queryClient';
import {
  leggiRegistro, leggiProgramma, cambiaProgramma, creaProgramma, aggiornaRegistrazione, salvaCelle,
} from './programmaStore';
import {
  totali, settimaneDellaMatrice, settimaneDellePersone, oreVoci, statoVoce,
  conVoceAggiornata, conVoci,
  conVociDaRighe, conVoceAttivata, conPacchettoAggiornato, conCommessa, conCarico,
  senzaVoce, pacchettiCheSforano, daCollocarePerPacchetto, esportazione,
} from './programma';
import { creaTask, eliminaTask } from './taskStore';
import { settimanaIso } from './tempo.js';
import Matrice from './programma/Matrice.jsx';
import MatricePersone from './programma/MatricePersone.jsx';
import { oreBrevi } from './programma/formato.js';
import ElencoVoci from './programma/ElencoVoci.jsx';
import DettaglioVoce from './programma/DettaglioVoce.jsx';
import AttivaVoce from './programma/AttivaVoce.jsx';
import NuoveVoci from './programma/NuoveVoci.jsx';
import NuovaCommessa from './programma/NuovaCommessa.jsx';
import SchedaCommessa from './programma/SchedaCommessa.jsx';
import Riepilogo from './programma/Riepilogo.jsx';
import Istruzioni from './programma/Istruzioni.jsx';
import OreRegistrate from './programma/OreRegistrate.jsx';
import { libroProgramma } from './programmaExcel.js';
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
 * @param {{ id: string, displayName: string }[]} [props.sezioni]  le sezioni OneNote, per il collegamento
 * @param {() => void} [props.onCaricaSezioni]  le sezioni si caricano su richiesta
 * @param {(nome: string) => Promise<{ id: string, displayName: string }>} props.onCreateDeliverable
 * @param {(listId: string, task: import('./taskStore').Task) => void} props.onTaskCreato
 * @param {(listId: string, taskId: string) => void} props.onTaskRimosso
 */
export default function ProgrammaView({
  todoLists, tasks, poolPronto, sezioni = [], onCaricaSezioni,
  onCreateDeliverable, onTaskCreato, onTaskRimosso,
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
  const [scheda, setScheda] = useState(/** @type {'matrice'|'persone'|'voci'|'riepilogo'|'impostazioni'} */ ('matrice'));
  const [voceScelta, setVoceScelta] = useState(/** @type {string|null} */ (null));
  const [selezione, setSelezione] = useState(/** @type {string[]} */ ([]));
  const [attivaAperta, setAttivaAperta] = useState(false);
  const [soloScoperte, setSoloScoperte] = useState(false);
  const [nuovaAperta, setNuovaAperta] = useState(false);
  const [guidaAperta, setGuidaAperta] = useState(false);
  const [oreAperte, setOreAperte] = useState(false);
  const [salvataggio, setSalvataggio] = useState(/** @type {'fermo'|'salvo'|'salvato'|'errore'} */ ('fermo'));
  const [toast, setToast] = useState(/** @type {{ testo: string, annulla?: () => void, apri?: () => void }|null} */ (null));

  const settimanaOra = settimanaIso();
  const settimane = useMemo(() => (doc ? settimaneDellaMatrice(doc, settimanaOra) : []), [doc, settimanaOra]);

  // ── La vista per persona ──────────────────────────────────────────────────
  // Vuole tutti i programmi accesi, non solo quello aperto: è tutto il punto —
  // una sovrapposizione sta *fra* due commesse, e dentro una non si vede. I
  // documenti si chiedono solo quando la scheda è aperta (`enabled`), e sono
  // le stesse chiavi di cache del documento singolo: aperta la scheda dopo
  // aver girato fra le commesse, quelle già lette non si rileggono.
  const documentiAccesi = useQueries({
    queries: accesi.map(p => ({
      queryKey: qk.programma(p.id),
      queryFn: () => leggiProgramma(p.id),
      staleTime: STALE.programma,
      enabled: scheda === 'persone',
    })),
  });
  const programmiLetti = accesi
    .map((p, i) => ({ id: p.id, nome: p.nome, doc: documentiAccesi[i]?.data }))
    .filter(/** @returns {x is { id: string, nome: string, doc: DocProgramma }} */ x => !!x.doc);
  const personeInCaricamento = documentiAccesi.some(q => q.isLoading);
  const settimanePersone = programmiLetti.length
    ? settimaneDellePersone(programmiLetti.map(p => p.doc), settimanaOra)
    : [];
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

  // ── La commessa ────────────────────────────────────────────────────────────

  /**
   * Una commessa nuova. Prima si arrivava qui solo dalla schermata di
   * benvenuto, cioè **una volta sola**: creato il primo programma il bottone
   * spariva con la schermata, e non c'era nessun altro modo di farne un
   * secondo. Adesso il gesto sta nella colonna di sinistra, che è dove si
   * scelgono le commesse.
   * @param {{ nome: string, commessa: Partial<import('./programma').Commessa> }} dati
   */
  async function creaCommessa({ nome, commessa }) {
    const creata = await creaProgramma(nome, commessa);
    await registro.refetch();
    setNuovaAperta(false);
    setPacchettoScelto(null);
    setVoceScelta(null);
    // Si arriva in Impostazioni: una commessa appena nata non ha né persone né
    // pacchetti, e la matrice sarebbe una griglia vuota senza righe.
    setScheda('impostazioni');
    navigate(`/programma/${creata.id}`);
  }

  /** Il nome sta in due posti — il registro e il documento — e cambiano insieme. @param {string} nome */
  async function rinomina(nome) {
    if (!scelto) return;
    await cambia(d => conCommessa(d, { nome }));
    await aggiornaRegistrazione(scelto.id, { nome });
    registro.refetch();
  }

  async function spegni() {
    if (!scelto) return;
    const id = scelto.id;
    await aggiornaRegistrazione(id, { attivo: false });
    const { data } = await registro.refetch();
    const resta = (data?.programmi || []).find(p => p.attivo && p.id !== id);
    setScheda('matrice');
    navigate(resta ? `/programma/${resta.id}` : '/programma');
    setToast({
      testo: 'Commessa spenta: il documento resta su OneDrive',
      annulla: async () => { await aggiornaRegistrazione(id, { attivo: true }); registro.refetch(); setToast(null); },
    });
  }

  /**
   * La fotografia del giorno. Il documento vive già su OneDrive e non ha
   * bisogno di essere salvato: questo serve a portarsi via il programma
   * *com'era* il giorno in cui lo si è mandato — e senza la data nel nome due
   * fotografie si coprirebbero a vicenda.
   */
  function esporta() {
    if (!doc) return;
    const { nomeFile, dati } = esportazione(doc);
    scaricaFile(nomeFile, new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' }));
  }

  /**
   * Lo stesso programma in un foglio di calcolo: tre fogli, e il primo è quello
   * che si guarda in riunione.
   *
   * È l'altra metà del giro delle ore vere — si esporta, si corregge la colonna
   * della settimana finita, si rimanda indietro da «Ore registrate» — e per
   * questo il foglio Matrice esce nella stessa forma in cui rientra. Il perché
   * per esteso è in `programmaExcel.js`.
   */
  function esportaExcel() {
    if (!doc) return;
    const { nomeFile, byte } = libroProgramma(doc, { settimanaOra, settimane, attivitaAperte });
    scaricaFile(nomeFile, new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (byte))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
  }

  /** @param {string} nomeFile @param {Blob} blob */
  function scaricaFile(nomeFile, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeFile;
    a.click();
    URL.revokeObjectURL(url);
    setToast({ testo: `Scaricato ${nomeFile}` });
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

  const modali = (
    <>
      {nuovaAperta && (
        <NuovaCommessa
          sezioni={sezioni}
          onCaricaSezioni={onCaricaSezioni}
          onCrea={creaCommessa}
          onChiudi={() => setNuovaAperta(false)}
        />
      )}
      {guidaAperta && <Istruzioni onChiudi={() => setGuidaAperta(false)} />}
      {oreAperte && doc && (
        <OreRegistrate
          doc={doc}
          settimane={settimane}
          onChiudi={() => setOreAperte(false)}
          onApplica={celle => {
            // Passano dalla stessa strada di una cella battuta a mano: la coda
            // che scrive a raffiche, e la pila dell'annulla che le riprende
            // tutte insieme con ⌘Z.
            scriviCelle(celle);
            setOreAperte(false);
            setScheda('matrice');
            setToast({ testo: `${Object.keys(celle).length} celle aggiornate con le ore vere — ⌘Z annulla` });
          }}
        />
      )}
    </>
  );

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
          <div className="pg-due-bottoni">
            <button type="button" className="pg-btn pg-btn-accento" onClick={() => setNuovaAperta(true)}>
              Comincia una commessa
            </button>
            <button type="button" className="pg-btn" onClick={() => setGuidaAperta(true)}>Come si usa</button>
          </div>
          {programmi.length > 0 && (
            <div className="pg-rail-spenti">
              <div className="eyebrow">Spente</div>
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
        {modali}
      </div>
    );
  }

  const numeri = doc ? totali(doc, { pacchettoId: pacchettoScelto, settimanaOra }) : null;
  const pacchetto = doc?.pacchetti.find(p => p.id === pacchettoScelto) || null;
  const voce = doc?.voci.find(v => v.id === voceScelta) || null;
  const statoDellaVoce = voce ? statoVoce(voce, attivitaAperte, poolPronto) : null;
  const sfori = doc && numeri && numeri.margine < 0 ? pacchettiCheSforano(doc) : [];
  const daCollocare = doc ? daCollocarePerPacchetto(doc) : new Map();

  // I passaggi che mancano perché il pannello dica qualcosa. Spariscono da soli
  // man mano che si fanno: una lista di cose da fare che resta lì per sempre
  // diventa arredamento, e smette di essere letta.
  const passiMancanti = doc ? [
    !doc.commessa.oreVendute && { testo: 'Dì quante ore sono vendute', dove: 'impostazioni' },
    !doc.risorse.length && { testo: 'Aggiungi le persone', dove: 'impostazioni' },
    !doc.pacchetti.length && { testo: 'Crea i pacchetti', dove: 'impostazioni' },
    !doc.voci.length && { testo: 'Scrivi o incolla le voci', dove: 'voci' },
  ].filter(/** @returns {p is { testo: string, dove: 'impostazioni'|'voci' }} */ p => !!p) : [];

  /** L'elenco delle voci, con in fondo il modulo per scriverne di nuove. */
  const elenco = doc && (
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
        <NuoveVoci
          doc={doc}
          pacchettoScelto={pacchettoScelto}
          titolo="Voci nuove"
          etichetta="Aggiungi"
          onAggiungi={righe => cambia(d => conVociDaRighe(d, righe, { pacchettoId: pacchettoScelto }).doc)}
        />
      )}
    />
  );

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
                  onClick={() => { navigate(`/programma/${p.id}`); setPacchettoScelto(null); setVoceScelta(null); setRailChiuso(true); }}
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

            {/* Il gesto che mancava del tutto: creata la prima commessa, la
                schermata di benvenuto spariva e con lei l'unico bottone che
                sapeva farne una. */}
            <button type="button" className="pg-rail-nuova" onClick={() => setNuovaAperta(true)}>
              + Nuova commessa
            </button>

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
                {doc?.commessa.sezione ? ` · ${doc.commessa.sezione}` : ''}
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
                  {/* «A finire» sono le stime meno lo speso, non le celle
                      future: la programmazione qui non si fa mai completa, e
                      contare quella direbbe sempre meno lavoro di quanto ne
                      resta. Le celle future restano a schermo accanto, come
                      «programmate», perché sono l'altra domanda — quanto di
                      quel lavoro è già in calendario. */}
                  <span>a finire <b>{conMigliaia(numeri.aFinire)}</b></span>
                  <span className="muted">programmate <b>{conMigliaia(numeri.programmate)}</b></span>
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
              {pacchettoScelto && (
                <button type="button" className="pg-chip" onClick={() => setPacchettoScelto(null)}>tutti ✕</button>
              )}
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
            {/* La stessa matrice letta per persona invece che per commessa:
                accanto a Matrice perché è la sua altra metà, non una quinta
                pagina. Vedi programma/MatricePersone.jsx. */}
            {!stretto && (
              <button
                type="button"
                className={`pg-scheda${scheda === 'persone' ? ' scelta' : ''}`}
                onClick={() => setScheda('persone')}
                title="Il carico di ogni persona su tutte le commesse accese"
              >
                Persone
              </button>
            )}
            <button
              type="button"
              className={`pg-scheda${scheda === 'voci' || (stretto && scheda === 'matrice') ? ' scelta' : ''}`}
              onClick={() => setScheda('voci')}
            >
              Elenco voci
            </button>
            <button
              type="button"
              className={`pg-scheda${scheda === 'riepilogo' ? ' scelta' : ''}`}
              onClick={() => setScheda('riepilogo')}
            >
              Riepilogo
            </button>
            <button
              type="button"
              className={`pg-scheda${scheda === 'impostazioni' ? ' scelta' : ''}`}
              onClick={() => setScheda('impostazioni')}
            >
              Impostazioni
            </button>
            <span className="pg-testata-sp" />
            {/* Il programma esce e rientra. Stanno qui e non in Impostazioni
                perché non sono la mezz'ora in cui si mette in piedi il
                programma: l'esportazione si fa prima di ogni riunione, e le ore
                vere rientrano ogni lunedì. */}
            <button type="button" className="pg-guida" onClick={esportaExcel} title="Tre fogli: riepilogo, matrice, voci">
              ↓ Excel
            </button>
            <button
              type="button"
              className="pg-guida"
              onClick={() => setOreAperte(true)}
              title="Incolla le ore davvero fatte: sostituiscono quelle previste"
            >
              ↑ Ore registrate
            </button>
            <span className="pg-salvataggio">
              {salvataggio === 'salvo' && 'salvo…'}
              {salvataggio === 'salvato' && 'salvato'}
              {salvataggio === 'errore' && 'non salvato — riprovo'}
            </span>
            <button type="button" className="pg-guida" onClick={() => setGuidaAperta(true)} title="Come si usa il Programma">
              ? come si usa
            </button>
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

        {passiMancanti.length > 0 && doc && (
          <div className="pg-passi-riga">
            <span className="eyebrow">da fare per cominciare</span>
            {passiMancanti.map(p => (
              <button type="button" key={p.testo} className="pg-chip" onClick={() => setScheda(p.dove)}>
                {p.testo}
              </button>
            ))}
          </div>
        )}

        {!doc ? (
          <div className="pg-corpo"><Skeleton /></div>
        ) : scheda === 'impostazioni' ? (
          <div className="pg-corpo">
            <SchedaCommessa
              doc={doc}
              sezioni={sezioni}
              onCaricaSezioni={onCaricaSezioni}
              onCambia={cambia}
              onRinomina={rinomina}
              onSpegni={spegni}
              onEsporta={esporta}
            />
          </div>
        ) : scheda === 'riepilogo' ? (
          <div className="pg-corpo">
            <Riepilogo
              doc={doc}
              settimanaOra={settimanaOra}
              pacchettoScelto={pacchettoScelto}
              onScegliPacchetto={setPacchettoScelto}
              onCambia={cambia}
            />
          </div>
        ) : stretto ? (
          <div className="pg-corpo">
            <p className="pg-empty pg-solo-portatile">La matrice si apre da portatile.</p>
            {elenco}
          </div>
        ) : scheda === 'persone' ? (
          <MatricePersone
            programmi={programmiLetti}
            settimane={settimanePersone}
            settimanaOra={settimanaOra}
            inCaricamento={personeInCaricamento}
            pacchettoScelto={pacchettoScelto}
            nomePacchetto={pacchetto?.nome || ''}
            onApriCommessa={id => { navigate(`/programma/${id}`); setScheda('matrice'); setPacchettoScelto(null); }}
          />
        ) : scheda === 'matrice' ? (
          <Matrice
            doc={doc}
            settimane={settimane}
            settimanaOra={settimanaOra}
            pacchettoScelto={pacchettoScelto}
            onCelle={scriviCelle}
            onAnnulla={annulla}
            onSceltaRiga={(_risorsa, pacchettoId) => setPacchettoScelto(pacchettoId)}
            onSceltaVoce={id => { setVoceScelta(id); setAttivaAperta(false); }}
          />
        ) : (
          <div className="pg-corpo">{elenco}</div>
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
          onCancella={() => {
            setVoceScelta(null);
            setSelezione(sel => sel.filter(id => id !== voce.id));
            cambia(d => senzaVoce(d, voce.id));
          }}
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
          {toast.annulla && <button type="button" className="pg-toast-azione" onClick={toast.annulla}>Annulla</button>}
        </div>
      )}

      {modali}
    </div>
  );
}
