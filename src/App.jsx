import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { initAuth, getAccount, login, trySsoSilent, getAuthDiagnostics, onInteractionRequired, isInteractionRequired, reconnect, startTokenKeepAlive, cambiaAccount } from './auth';
import { getNotebooks, getSections, getPages, getRecentEmails, getPageContentHtml, markOneNoteTagDone, getReminders, getCalendarEvents, invalidateCalendarsCache, loadColorSettings, saveColorSettings, migrateLegacyDriveFiles, loadPlannerConfig, loadDailyPlans, saveDailyPlans, provaConnessione } from './api';
import { elencoListe, leggiTask, leggiTaskAperti, creaTask, aggiornaTask, creaLista, rinominaLista } from './taskStore';
import { migraSeServe } from './taskMigrazione';
import { getMarker, setMarker, clearMarkers } from './markers';
import { queryClient, qk, STALE } from './queryClient';
import { extractEmailCandidates, extractOneNoteCandidates } from './dailyReview';
import { parseReminderSubject, reminderMarker, hasReminderMarker } from './deadlineReminders';
import { shadeColor, DEFAULT_CONFIG } from './plannerShared';
import { listsForSection, sectionNameForList } from './paraConfig';
import IdentityPanel from './IdentityPanel';
import SearchOverlay from './SearchOverlay';
import Panel from './Panel';
import GtdClarifyModal from './GtdClarifyModal';
import ColorSettingsModal from './ColorSettingsModal';
import QuickCapture from './QuickCapture';
import { captureContextFor } from './captureContext';
import AppShell from './AppShell';
import ShortcutsPanel from './ShortcutsPanel';
import TodayView from './TodayView';
import { personRoleFor, taskPerson, STATUS_LABELS } from './taskModel';
import { pushUndo } from './undo';
import { COLORS, BUILD_TIME, PREFERRED_LOGIN_HINT } from './config';
import UndoToast from './UndoToast';
import SvegliaAlert from './SvegliaAlert';
import { useSveglie } from './useSveglie';
import './App.css';
import { ymd } from './tempo.js';

// ── Le viste, caricate quando ci si va ──────────────────────────────────────
//
// «Oggi» è la vista che si apre: dall'icona sulla schermata Home, da un
// segnalibro, da `/`. Le altre cinque si raggiungono con un tocco sul menù, e
// fino a quel tocco non c'è ragione che stiano nel primo scaricamento — che su
// un telefono in giro, sulla rete misurata dalla prova di connessione, è
// l'unica attesa che si vede davvero.
//
// Il peso non era piccolo: la Mappa si porta dietro D3 (115 kB), il Piano è il
// file più grosso dell'app, e insieme a Diario, Sezioni e Attività facevano
// più della metà del pacchetto iniziale. Adesso «Oggi» ne scarica la metà, e
// ogni altra vista arriva quando la si apre — una volta sola, poi resta in
// cache come ogni altro chunk.
//
// **Cosa NON cambia: quello che «Oggi» mostra di suo.** Il riquadro del Diario
// e le azioni della giornata non vengono da questi file — vengono da
// `diary.js` e `taskModel.js`, moduli piccoli che TodayView importa
// direttamente e che restano nel primo scaricamento come prima. `DiaryPanel` è
// la vista del Diario a schermo intero, `ActivityBoard` sono le cinque colonne
// del flusso: due schermate intere che «Oggi» non apre. Il dato è lo stesso e
// arriva dalla stessa cache di query, prima come dopo.
const MindMap = lazy(() => import('./MindMap'));
const PlannerView = lazy(() => import('./PlannerView'));
const DiaryPanel = lazy(() => import('./DiaryPanel'));
const SectionsView = lazy(() => import('./SectionsView'));
const ActivityBoard = lazy(() => import('./ActivityBoard'));
const FinanzeSection = lazy(() => import('./finanze/FinanzeSection'));

const DEFAULT_COLOR_SETTINGS = { notebooks: {}, sections: {} };

// Applica gli override di colore (persistiti, vedi initColorSettings /
// applyColorSettings) a un taccuino o alle sue sezioni, mutandoli sul posto —
// stessa convenzione già in uso per nb._color prima di questa feature, così
// tutte le viste che leggono nb._color/sec._color vedono da subito il colore
// scelto dall'utente invece di quello assegnato automaticamente per indice.
function applyNotebookColor(nb, index, overrides) {
  nb._color = overrides.notebooks[nb.id] || COLORS[index % COLORS.length];
}

function applySectionColors(nb, sections, overrides) {
  (sections || []).forEach((s, i) => {
    s._color = overrides.sections[s.id] || shadeColor(nb._color || '#888', i);
  });
}

const REVIEW_SEEN_TTL = 7 * 24 * 60 * 60 * 1000;      // 7 giorni
const NOTES_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;    // fallback alla prima scansione: ultime 48h
const REVIEW_LAST_CHECK_KEY = 'review_last_check';
const REVIEW_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const REVIEW_PAGES_CAP = 40; // tetto di sicurezza sulle pagine il cui contenuto viene scaricato per intero

const DEADLINE_LAST_CHECK_KEY = 'deadline_reminders_last_check';
const DEADLINE_LAST_CHECK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 giorni
const DEADLINE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;     // fallback alla prima scansione: ultimi 7 giorni

// I file dell'app sono passati dalla root di OneDrive alla cartella
// `mente-digitale/`, e i registri che crescono di un file al mese (diario e
// movimento) sono poi scesi in una sottocartella loro. Lo spostamento dei file
// già esistenti gira una volta per browser, in sottofondo: non blocca il
// caricamento e, se fallisce, il marker non viene scritto e si riprova al
// prossimo avvio (nel frattempo i singoli file vengono comunque recuperati
// dalla migrazione pigra in api.js).
// Il flag sta su localStorage e non tra i marker: quelli vengono azzerati da
// "Aggiorna tutto" (clearMarkers), e rifare la scansione della root a ogni
// refresh manuale sarebbe una richiesta sprecata.
// La chiave porta il numero della disposizione: chi aveva già fatto la
// migrazione in cartella deve rifare la passata per le sottocartelle.
const DRIVE_MIGRATION_KEY = 'md_drive_folder_migrated_2';

function runDriveMigrationOnce() {
  try { if (localStorage.getItem(DRIVE_MIGRATION_KEY)) return; } catch { /* storage non disponibile */ }
  migrateLegacyDriveFiles()
    .then(moved => {
      try { localStorage.setItem(DRIVE_MIGRATION_KEY, '1'); } catch { /* no-op */ }
      if (moved) console.info(`OneDrive: sistemati ${moved} file in mente-digitale/`);
    })
    .catch(e => console.error('migrazione cartella OneDrive', e));
}

// Scorciatoie dalla schermata Home di iPhone: /gtd.html e /diario.html sono
// due pagine che, lanciate dalla loro icona, rimbalzano qui con `?apri=…`.
// Servono perché iOS ignora gli `shortcuts` del manifest: l'unico modo di
// avere due icone distinte è avere due pagine distinte da aggiungere alla Home.
function launchIntent() {
  try {
    return new URLSearchParams(window.location.search).get('apri');
  } catch { return null; }
}

// Modo della Mappa (taccuini | para) — vedi mapViewMode in App.
const MAP_VIEW_MODE_KEY = 'md_map_view_mode_v1';

function readMapViewMode() {
  try {
    const saved = localStorage.getItem(MAP_VIEW_MODE_KEY);
    return saved === 'para' || saved === 'workbook' ? saved : 'workbook';
  } catch { return 'workbook'; }
}

function suggestionSignature(a) {
  return `${a.source || 'email'}::${a.title || ''}::${a.extractedAction || ''}`;
}

function markSuggestionSeen(sig) {
  const seen = getMarker('review_seen') || [];
  if (!seen.includes(sig)) {
    setMarker('review_seen', [...seen, sig].slice(-300), REVIEW_SEEN_TTL);
  }
}

// cutoffMs: timestamp assoluto, non una durata — così la Daily Review può
// scansionare solo le pagine modificate dall'ultimo controllo riuscito in poi
// (vedi refreshDailyReview), invece di rifare sempre l'intera finestra delle
// ultime 48h. Copertura più ampia nel tempo, senza riscaricare da capo il
// contenuto di pagine già viste.
function filterRecentPages(pages, cutoffMs) {
  return pages
    .filter(p => p.lastModifiedDateTime && new Date(p.lastModifiedDateTime).getTime() >= cutoffMs)
    .sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
}

// L'endpoint "flat" /me/onenote/pages risponde 400 sugli account Microsoft
// personali (MSA), a prescindere dai parametri della query. Si aggregano invece
// le pagine passando per taccuini → sezioni → pagine, gli stessi endpoint già
// usati con successo altrove nell'app (MindMap, Panel).
//
// Riusa le cache già popolate (localStorage + pagesCache in memoria) invece di
// riscaricare da Graph l'elenco pagine di ogni sezione a ogni avvio: era il
// costo di rete più grosso dell'app, duplicava il lavoro della preload queue.
// Le pagine modificate di recente si individuano comunque via
// lastModifiedDateTime, presente anche nelle copie in cache.
// Lettura via TanStack Query che rispecchia il vecchio `cacheGet(...) || (fetch
// + cacheSet(...))`: con forceRefresh forza il refetch (staleTime 0), altrimenti
// riusa il dato in cache se ancora fresco. La persistenza su localStorage e la
// dedup delle richieste sono gestite dal query client (vedi queryClient.js).
function fetchCached(queryKey, queryFn, staleTime, forceRefresh = false) {
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime: forceRefresh ? 0 : staleTime });
}

async function collectAllOneNotePages(pagesCacheRef) {
  // ensureQueryData riusa il dato già in cache (anche "vecchio") senza
  // rivalidarlo: la Daily Review vuole solo aggregare le pagine già viste, non
  // riscaricare da Graph l'elenco di ogni sezione a ogni avvio.
  const notebooks = await queryClient.ensureQueryData({
    queryKey: qk.notebooks(), queryFn: getNotebooks, staleTime: STALE.notebooks,
  });
  const allPages = [];
  for (const nb of notebooks) {
    let sections;
    try {
      sections = await queryClient.ensureQueryData({
        queryKey: qk.sections(nb.id), queryFn: () => getSections(nb.id), staleTime: STALE.sections,
      });
    } catch (e) { console.error('sections', nb.displayName, e); continue; }
    for (const sec of sections) {
      let pages = pagesCacheRef?.current?.[sec.id] || queryClient.getQueryData(qk.pages(sec.id));
      if (!pages) {
        try {
          pages = await queryClient.ensureQueryData({
            queryKey: qk.pages(sec.id), queryFn: () => getPages(sec.id), staleTime: STALE.pages,
          });
          if (pagesCacheRef?.current) pagesCacheRef.current[sec.id] = pages;
        } catch (e) { console.error('pages', sec.displayName, e); continue; }
        // Throttle solo quando si è davvero interrogato Graph
        await new Promise(r => setTimeout(r, 100));
      }
      allPages.push(...pages);
    }
  }
  return allPages;
}

// ── La diagnosi in fondo alla schermata di login ───────────────────────────
//
// Prima si vedeva solo se c'era un errore registrato, e l'errore c'è in un
// caso solo: il rinnovo silenzioso ha provato ed è stato respinto. Ma questa
// schermata compare anche quando in cache l'account non c'è più — Safari che
// svuota la memoria del sito, oppure la stessa app aperta da un'altra icona,
// che ha la sua memoria separata — e in quel caso di errore non ce n'è
// nessuno: restava una schermata muta, cioè la cosa peggiore da guardare da un
// telefono, dove console non ce n'è. Adesso una riga c'è sempre, e dice quale
// dei due casi è.

/** @param {string|null|undefined} iso @returns {string} */
function oraLeggibile(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Distanza fra due istanti in forma parlata: è lei la diagnosi vera. */
function durata(daIso, aIso) {
  if (!daIso || !aIso) return null;
  const min = Math.round((new Date(aIso).getTime() - new Date(daIso).getTime()) / 60000);
  if (min < 0) return null;
  if (min < 90) return `${min} min`;
  const ore = Math.round(min / 60);
  return ore < 48 ? `${ore} ore` : `${Math.round(ore / 24)} giorni`;
}

function LoginDiagnostics() {
  const d = getAuthDiagnostics();
  // Un errore più vecchio dell'ultima chiamata riuscita è un errore da cui ci
  // si è già ripresi: mostrarlo qui vorrebbe dire dare la colpa di questa
  // disconnessione a qualcosa che era già rientrato.
  const err = d.lastError && (!d.lastOk || d.lastError.t >= d.lastOk) ? d.lastError : null;
  const motivo = err
    ? [err.errorCode, err.subError].filter(Boolean).join(' / ') || err.message
    : null;
  // Senza articolo: i valori di `kind` sono sostantivi diversi («avvio»,
  // «rinnovo forzato»), e l'articolo giusto cambia con ognuno.
  const dove = err?.kind ? ` · ${err.kind}` : '';
  // Quanto è durata: dall'accesso a mano all'ultimo rinnovo andato a buon
  // fine. Un'ora tonda vuol dire che il refresh token non è mai entrato in
  // gioco; un giorno vuol dire che è arrivato al tetto delle 24 ore che Entra
  // impone alle SPA; una settimana vuol dire che è stata Safari a fare pulizia.
  const durataSessione = durata(d.loginAt, d.lastOk || err?.t);
  // «Ultima chiamata riuscita» non è «ultimo rinnovo»: acquireTokenSilent
  // risponde anche solo leggendo la cache, quindi quell'ora dice fino a
  // quando l'app è stata usata, non fino a quando la sessione ha retto.

  return (
    <div className="login-note" style={{ opacity: 0.6, marginTop: 4, textAlign: 'left' }}>
      {!d.storageAvailable ? (
        <>La memoria del sito non è disponibile (navigazione privata, o cookie bloccati): qui l&apos;accesso non può durare oltre la sessione.</>
      ) : motivo ? (
        <>Ultima disconnessione: {motivo}{dove} ({oraLeggibile(err?.t)})</>
      ) : d.storageFull ? (
        <>Lo spazio del sito è finito ({oraLeggibile(d.storageFull)}): la cache dei dati ha occupato il posto che serviva all&apos;account.</>
      ) : d.ricordato ? (
        <>Nessun errore registrato, e MSAL non ha più l&apos;account: è stato rimosso dalla cache, non è scaduto.</>
      ) : d.loginAt ? (
        <>Nessun errore registrato: la memoria del sito è stata svuotata. Non è una scadenza — è Safari (o un&apos;altra icona, che ha la sua memoria separata).</>
      ) : (
        <>Primo accesso in questo contesto: qui non c&apos;è mai stata una sessione.</>
      )}
      {d.loginAt && <><br />Ultimo accesso a mano: {oraLeggibile(d.loginAt)}</>}
      {d.lastOk && <><br />Ultima chiamata riuscita: {oraLeggibile(d.lastOk)}</>}
      {/* Questa è la riga che conta: «rinnovo» vuol dire refresh token speso
          davvero. Se manca, l'ora dell'ultima chiamata dice solo fino a
          quando l'app è stata usata. */}
      <br />Ultimo rinnovo vero: {d.lastRefresh ? oraLeggibile(d.lastRefresh) : 'mai'}
      {durataSessione && <><br />È durata: {durataSessione}</>}
      <br />Spazio occupato: {d.storageKb} kB{d.storageFull ? ' (è stato pieno)' : ''} · {d.msalInv}
      {/* La scatola nera: cosa è successo, in ordine. Un errore solo dice cosa
          è andato storto, questa dice cosa stava succedendo intorno. */}
      {d.trail.length > 0 && (
        <>
          <br />
          {d.trail.slice(-5).map((r, i) => (
            <span key={i} style={{ display: 'block' }}>
              {new Date(r.t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {r.e}
            </span>
          ))}
        </>
      )}
      <br />{d.standalone ? 'Aperta dall\u2019icona sulla Home' : 'Aperta in Safari'} · build {oraLeggibile(BUILD_TIME)}
    </div>
  );
}

/**
 * Un errore come si racconta a chi guarda lo schermo del telefono. Lo status
 * di Graph davanti perché è la cosa che distingue i casi: 401 è la sessione,
 * 403 un permesso mai concesso, 404 un file che non c'è, 429 troppa fretta.
 * Un errore di rete non ha status, e allora conta sapere se il telefono era
 * online.
 * @param {unknown} e
 * @returns {string}
 */
function descriviErrore(e) {
  const err = /** @type {any} */ (e);
  const status = err?.status ? `${err.status} · ` : '';
  const testo = err?.message || String(e);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    ? ' (dispositivo offline)' : '';
  return `${status}${testo}${offline}`;
}

/**
 * Cosa è andato storto nell'ultimo caricamento, in chiaro. Esiste per una
 * ragione sola: da iPhone la spia di stato è un puntino di sei pixel e il suo
 * testo è nascosto sotto gli 860px (vedi .sync-label-text in App.css), quindi
 * un caricamento fallito era indistinguibile da un'app che non ha niente da
 * mostrare. Qui si tocca il puntino e si legge cosa è successo — compresa la
 * build in esecuzione, che dice se il telefono sta girando l'ultimo deploy o
 * una copia vecchia rimasta nella cache del service worker.
 * @param {{ sync: {state: string, label: string},
 *   problemi: {dove: string, messaggio: string}[], account: string|null,
 *   onChiudi: () => void, onAggiorna: () => void }} props
 */
function PannelloStato({ sync, problemi, account, onChiudi, onAggiorna }) {
  // La prova di connessione: tre richieste a tre host diversi, per sapere
  // quale dei tre non risponde invece di dedurlo.
  const [prova, setProva] = useState(/** @type {{passo: string, ok: boolean, nota: string}[]|null} */ (null));
  const [provaInCorso, setProvaInCorso] = useState(false);

  async function eseguiProva() {
    setProvaInCorso(true);
    setProva(null);
    try { setProva(await provaConnessione()); }
    catch (e) { setProva([{ passo: 'Prova', ok: false, nota: descriviErrore(e) }]); }
    finally { setProvaInCorso(false); }
  }

  // Di account Microsoft ce n'è più d'uno e ognuno ha il suo OneDrive: entrati
  // con quello sbagliato non c'è nessun errore da mostrare, solo riquadri
  // vuoti. Quando non è quello di sempre, lo si dice qui.
  const altroAccount = !!account && account !== PREFERRED_LOGIN_HINT;
  return (
    <div className="stato-dropdown" role="dialog" aria-label="Stato caricamento">
      <div className="stato-header">
        <span>{sync.label}</span>
        <button onClick={onChiudi} aria-label="Chiudi">✕</button>
      </div>
      {problemi.length === 0 && (
        <div className="stato-riga stato-ok">Nessun errore nell&rsquo;ultimo caricamento.</div>
      )}
      {problemi.map((p, i) => (
        <div className="stato-riga" key={i}>
          <div className="stato-dove">{p.dove}</div>
          <div className="stato-messaggio">{p.messaggio}</div>
        </div>
      ))}
      <div className="stato-meta">
        {/* L'account collegato: quando tutto è vuoto ma niente è in errore,
            la prima domanda è se si sta guardando il OneDrive giusto. */}
        {account || 'nessun account'}
        {altroAccount && (
          <span className="stato-avviso"> — non è {PREFERRED_LOGIN_HINT}, il suo OneDrive è un altro</span>
        )}
        <br />build {oraLeggibile(BUILD_TIME)}
        {' · '}{typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'}
      </div>
      {prova && prova.map((r, i) => (
        <div className="stato-riga" key={`prova-${i}`}>
          <div className="stato-dove">{r.ok ? '✓' : '✕'} {r.passo}</div>
          <div className={r.ok ? 'stato-ok' : 'stato-messaggio'}>{r.nota}</div>
        </div>
      ))}
      <button className="stato-aggiorna" onClick={onAggiorna}>Aggiorna tutto</button>
      <button className="stato-aggiorna" onClick={eseguiProva} disabled={provaInCorso}>
        {provaInCorso ? 'Provo…' : 'Prova connessione'}
      </button>
      <button className="stato-aggiorna" onClick={() => cambiaAccount()}>Cambia account</button>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [notebooks, setNotebooks] = useState([]);
  const [sectionsMap, setSectionsMap] = useState({});
  const [todoListsMap, setTodoListsMap] = useState({});
  const [selected, setSelected] = useState(null);
  const [sync, setSync] = useState({ state: 'idle', label: 'Non connesso' });
  // I passi del caricamento che non sono riusciti, e il pannello che li mostra.
  /** @type {[{dove: string, messaggio: string}[], Function]} */
  const [problemi, setProblemi] = useState([]);
  const [statoOpen, setStatoOpen] = useState(false);
  // La sessione Microsoft è scaduta e serve un accesso interattivo. Non è più
  // un redirect automatico: è una striscia in cima con un bottone, e finché
  // non la si tocca l'app continua a funzionare con quello che ha già in cache.
  const [needsReconnect, setNeedsReconnect] = useState(isInteractionRequired);
  const [zoom, setZoom] = useState(1);
  // La Mappa riapre come l'hai lasciata: il commutatore Taccuini/PARA è una
  // preferenza, non un parametro di sessione, e ripartire sempre da «Taccuini»
  // costringeva a rimetterlo su PARA ogni volta.
  const [mapViewMode, setMapViewMode] = useState(readMapViewMode);
  const [identityOpen, setIdentityOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // La cattura chiesta dalla scorciatoia è aperta già al primo render, non in
  // un effetto: così non si vede prima la vista sotto e poi il modale coprirla.
  const [gtdOpen, setGtdOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(() => launchIntent() === 'gtd');
  const [pendingPlannerTask, setPendingPlannerTask] = useState(null);
  const [reviewSuggestions, setReviewSuggestions] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [gtdSeedText, setGtdSeedText] = useState('');
  const [colorSettings, setColorSettings] = useState(DEFAULT_COLOR_SETTINGS);
  const [colorSettingsOpen, setColorSettingsOpen] = useState(false);
  const colorSettingsRef = useRef(DEFAULT_COLOR_SETTINGS);
  const colorSettingsLoadedRef = useRef(false);
  const notebooksRef = useRef([]);
  const pagesCache = useRef({});
  const tasksCache = useRef({});
  const [scheduledTasks, setScheduledTasks] = useState(null);
  // Config del Piano: la vista Attività ne ha bisogno per i colori di
  // progetto, altrimenti mostrerebbe quelli segnaposto del default.
  const [plannerConfig, setPlannerConfig] = useState(DEFAULT_CONFIG);
  // Le liste servono alla board (per sapere qual è l'Inbox) e al
  // chiarimento (per scegliere la sezione). todoListsRef non basta: è un ref,
  // non fa ri-renderizzare quando arriva.
  const [todoLists, setTodoLists] = useState([]);
  // I piani giornalieri decidono quali task sono `scheduled`: lo stato non è
  // sul task ma nell'esistenza di un blocco nel piano.
  const [dailyPlans, setDailyPlans] = useState({});
  // L'attività di Inbox che si sta chiarendo: il chiarimento è il diagramma
  // GTD di sempre — quello che si apre da «Decidi ora» — solo che qui parte da
  // un task già catturato invece che da una riga di testo.
  const [clarifyTask, setClarifyTask] = useState(null);
  const [sectionCalendarEvents, setSectionCalendarEvents] = useState([]);
  // Incrementato ogni volta che un evento calendario viene creato fuori dal
  // Piano (es. dal popup GTD), per far invalidare a PlannerView la sua cache
  // bulk altrimenti stale fino al TTL.
  const [calendarDirtyToken, setCalendarDirtyToken] = useState(0);
  const preloadQueueRef = useRef([]);
  const preloadRunningRef = useRef(false);
  const todoListsRef = useRef([]);

  // Tutti i nomi di sezione conosciuti: servono a capire a quale commessa
  // appartiene una lista annidata (`2573.A60` → sezione `2573-ABS`), e la
  // risposta dipende da tutte le sezioni insieme — un prefisso che ne trova
  // due non vale.
  const allSectionNames = useMemo(
    () => Object.values(sectionsMap).flat().map(s => s.displayName),
    [sectionsMap]
  );

  // Quante attività aperte per lista e per sezione. Il badge della Mappa è per
  // sezione: se la commessa ha le consegne annidate, il conto è la loro somma,
  // altrimenti una sezione con tre consegne mostrerebbe zero. Derivato dal pool
  // invece che salvato: è la stessa cosa, contata dove i task già stanno.
  const todoCountMap = useMemo(() => {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const t of scheduledTasks || []) {
      const listName = (t._listName || '').toLowerCase();
      if (!listName) continue;
      counts[listName] = (counts[listName] || 0) + 1;
    }
    for (const l of todoLists) {
      const section = sectionNameForList(l.displayName, allSectionNames);
      if (!section || section.toLowerCase() === l.displayName.toLowerCase()) continue;
      const n = counts[l.displayName.toLowerCase()] || 0;
      if (n) counts[section.toLowerCase()] = (counts[section.toLowerCase()] || 0) + n;
    }
    return counts;
  }, [scheduledTasks, todoLists, allSectionNames]);

  const navigate = useNavigate();
  const location = useLocation();

  // La sezione che si sta guardando, se si sta guardando una: la cattura la
  // propone come destinazione invece di chiedere dove va una cosa che è già
  // scritta in testata. Si ricalcola alla rotta perché è la rotta a dirlo —
  // `location.pathname` è `/sezioni/<id>` solo lì.
  const captureContext = useMemo(
    () => captureContextFor(location.pathname, notebooks, sectionsMap, todoLists),
    [location.pathname, notebooks, sectionsMap, todoLists]);

  useEffect(() => {
    /** @type {(() => void)|null} */
    let stopKeepAlive = null;
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      // Il token si rinnova da solo cinque minuti prima di scadere e al
      // ritorno sull'app: è quello che tiene viva la sessione su iPhone, dove
      // aspettare il 401 vuol dire farsi trovare con dieci chiamate Graph in
      // volo e un refresh token solo da spendere.
      stopKeepAlive = startTokenKeepAlive();
      if (acc) {
        load(false);
      } else {
        // Tentativo di SSO silenzioso in background, senza bloccare il primo
        // render: se la sessione Microsoft è ancora attiva si passa dallo
        // schermo di login senza che l'utente se ne accorga.
        trySsoSilent().then(ssoAcc => {
          if (ssoAcc) {
            setAccount(ssoAcc);
            load(false);
          }
        });
      }
    });
    return () => { if (stopKeepAlive) stopKeepAlive(); };
  }, []);

  useEffect(() => onInteractionRequired(setNeedsReconnect), []);

  // Il piano del giorno è uno e si scrive da più posti: il Piano, la plancia di
  // Sezioni, «Completa» in Oggi. Tutti passano dalla cache di query, questo
  // stato le sta dietro — senza, un blocco creato nel Piano non compariva né in
  // Oggi né nella colonna Oggi di Sezioni fino al ricaricamento dell'app,
  // perché lo stato qui veniva scritto solo all'avvio.
  useEffect(() => {
    const key = qk.dailyPlans()[0];
    return queryClient.getQueryCache().subscribe(ev => {
      if (ev?.query?.queryKey?.[0] !== key) return;
      const next = queryClient.getQueryData(qk.dailyPlans());
      if (next && typeof next === 'object') setDailyPlans(prev => prev === next ? prev : next);
    });
  }, []);

  // Tornando sull'app dopo che iPhone l'ha messa in pausa, un tentativo
  // silenzioso: molto spesso la sessione Microsoft nel browser è ancora
  // buona e la striscia sparisce da sola, senza che si sia toccato niente.
  useEffect(() => {
    if (!needsReconnect) return;
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      trySsoSilent().then(acc => { if (acc) { setNeedsReconnect(false); load(false); } });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [needsReconnect]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(MAP_VIEW_MODE_KEY, mapViewMode); } catch { /* storage non disponibile */ }
  }, [mapViewMode]);

  // Il parametro `apri` ha fatto il suo lavoro al primo render: si toglie
  // dall'URL, così chiudere il pannello e ricaricare la pagina non lo riapre.
  useEffect(() => {
    if (!launchIntent()) return;
    if (launchIntent() === 'diario') navigate('/diario', { replace: true });
    // Il pathname da solo butterebbe via anche l'hash, cioè la rotta corrente.
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scorciatoie: ⌘K ricerca globale, ⌘J diario, ⌘N cattura da qualunque vista
  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
      if (key === 'j') {
        e.preventDefault();
        navigate('/diario');
      }
      if (key === 'n') {
        e.preventDefault();
        setCaptureOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  async function handleLogin() {
    try { await login(); setAccount(getAccount()); load(false); }
    catch (e) { console.error(e); }
  }

  // ── Quello che si vede mentre l'app si ricarica ───────────────────────────
  //
  // Su iPhone l'app non resta aperta: il telefono butta via la pagina dopo
  // pochi minuti in secondo piano, e riaprire l'icona è un avvio da capo, con
  // tutti gli stati React vuoti. Fin qui il primo schermo era quello: niente
  // taccuini, niente attività, niente piano, per tutto il tempo che ci mette
  // Graph a rispondere — che dal telefono, in giro, non sono decimi di secondo.
  //
  // Eppure i dati ci sono già: la cache di query viene ripristinata da
  // localStorage prima ancora del primo render (vedi queryClient.js). Mancava
  // solo di dipingerli, invece di lasciare lo schermo vuoto ad aspettare la
  // rete. Da qui in poi si vede subito l'ultimo caricamento, e le richieste
  // che partono comunque lo sostituiscono man mano che rispondono.
  //
  // È una copia vecchia, e va bene che lo sia: è la stessa scelta già fatta
  // per la sessione scaduta — «i dati mostrati sono quelli dell'ultimo
  // caricamento» — solo applicata al caso di gran lunga più frequente, cioè
  // l'app che si riapre.
  /**
   * @param {boolean} forceRefresh su «Aggiorna tutto» le sezioni restano
   *   fuori: là si riparte apposta a taccuini chiusi, ed è riespanderli che
   *   le ricarica (vedi handleExpandNotebook).
   * @returns {boolean} se c'era qualcosa da mostrare
   */
  function dipingiUltimoCaricamento(forceRefresh) {
    let qualcosa = false;

    const overrides = queryClient.getQueryData(qk.colorSettings()) || DEFAULT_COLOR_SETTINGS;
    colorSettingsRef.current = overrides;
    setColorSettings(overrides);

    const nbs = queryClient.getQueryData(qk.notebooks());
    if (nbs?.length) {
      qualcosa = true;
      nbs.forEach((nb, i) => applyNotebookColor(nb, i, overrides));
      notebooksRef.current = nbs;
      setNotebooks(nbs);

      if (!forceRefresh) {
        const sectMap = {};
        for (const nb of nbs) {
          const sects = queryClient.getQueryData(qk.sections(nb.id));
          if (sects) {
            applySectionColors(nb, sects, overrides);
            sectMap[nb.id] = sects;
          }
        }
        if (Object.keys(sectMap).length > 0) setSectionsMap(sectMap);
      }
    }

    const lists = queryClient.getQueryData(qk.todolists());
    if (lists?.length) {
      qualcosa = true;
      todoListsRef.current = lists;
      setTodoLists(lists);
      const map = {};
      lists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
      setTodoListsMap(map);

      // Le attività dell'ultimo caricamento, lista per lista. Solo se almeno
      // una c'è: `scheduledTasks` a `null` vuol dire «sto ancora caricando» e
      // fa comparire lo scheletro, un elenco vuoto vuol dire «non c'è niente
      // da fare oggi» — e le due cose non si possono scambiare.
      const attivita = [];
      let qualcheLista = false;
      for (const l of lists) {
        const tasks = queryClient.getQueryData(qk.tasks(l.id));
        if (!tasks) continue;
        qualcheLista = true;
        tasksCache.current[l.id] = tasks;
        tasks.forEach(t => attivita.push({ ...t, _listName: l.displayName, _listId: l.id }));
      }
      if (qualcheLista) setScheduledTasks(attivita);
    }

    const plans = queryClient.getQueryData(qk.dailyPlans());
    if (plans) { qualcosa = true; setDailyPlans(plans); }

    const cfg = queryClient.getQueryData(qk.plannerConfig());
    if (cfg) setPlannerConfig(cfg);

    const eventi = queryClient.getQueryData(qk.calEventiSezioni());
    if (eventi?.length) setSectionCalendarEvents(eventi);

    return qualcosa;
  }

  async function load(forceRefresh = false) {
    // Prima di qualunque attesa: sullo schermo ci va l'ultimo caricamento.
    // L'etichetta lo dice — «Aggiornamento» è un elenco già in pagina che si
    // sta rinfrescando, «Caricamento» è uno schermo vuoto che aspetta.
    const daCache = dipingiUltimoCaricamento(forceRefresh);
    setSync({ state: 'loading', label: daCache ? 'Aggiornamento…' : 'Caricamento…' });
    runDriveMigrationOnce();

    // Svuota cache in memoria se forceRefresh
    if (forceRefresh) {
      clearMarkers();
      // Marca stale tutte le query (App + PlannerView): App le rifetcha subito
      // con staleTime 0, PlannerView alla prossima apertura/navigazione — come
      // prima faceva cacheClear() azzerando le chiavi di cache.js di entrambi.
      queryClient.invalidateQueries();
      invalidateCalendarsCache();
      pagesCache.current = {};
      tasksCache.current = {};
    }

    // I guai di questo caricamento, uno per passo che non è riuscito. Servono
    // a due cose che prima non c'erano: tenere in piedi i passi successivi
    // (uno che fallisce non porta giù gli altri) e poterli leggere dal
    // telefono, dove la spia di stato è un puntino di sei pixel senza testo.
    // Nome diverso dallo stato `problemi` che sta qui sopra, e non è pedanteria:
    // dentro `load` quel nome era ombreggiato da questa lista, e le due cose
    // sono diverse — questa è l'elenco *di questo giro*, quello è quanto il
    // pannello di stato sta mostrando adesso.
    /** @type {{dove: string, messaggio: string}[]} */
    const guai = [];
    /** @param {string} dove @param {unknown} e */
    const registraProblema = (dove, e) => {
      console.error(dove, e);
      guai.push({ dove, messaggio: descriviErrore(e) });
    };

    try {
      // Colori personalizzati (taccuini/sezioni) scelti dall'utente
      // nell'ingranaggio impostazioni — vanno applicati subito dopo aver
      // ricevuto taccuini e sezioni, prima di renderli nello stato.
      setSync({ state: 'loading', label: 'Caricamento… colori' });
      const colorCfg = await fetchCached(qk.colorSettings(), loadColorSettings, STALE.colorSettings, forceRefresh)
        .catch(e => {
          registraProblema('Colori (file su OneDrive)', e);
          return queryClient.getQueryData(qk.colorSettings()) || null;
        });
      const overrides = colorCfg || DEFAULT_COLOR_SETTINGS;
      colorSettingsRef.current = overrides;
      colorSettingsLoadedRef.current = true;
      setColorSettings(overrides);

      // Config del Piano: serve alla vista Attività per i colori di progetto.
      // Non è bloccante — se non arriva si resta sul default e i task si
      // vedono comunque, solo senza il colore del loro progetto.
      fetchCached(qk.plannerConfig(), loadPlannerConfig, STALE.plannerConfig, forceRefresh)
        .then(cfg => { if (cfg) setPlannerConfig(cfg); })
        .catch(e => console.error('planner config load', e));

      // Taccuini. Se OneNote non risponde si tiene l'ultima copia e si va
      // avanti: prima un errore qui saltava tutto il resto della funzione —
      // niente liste, niente attività, niente piano — e da iPhone il risultato
      // era un'app che si apre vuota senza dire perché.
      /** @type {any[]} */
      let nbs = [];
      setSync({ state: 'loading', label: 'Caricamento… taccuini' });
      try {
        nbs = await fetchCached(qk.notebooks(), getNotebooks, STALE.notebooks, forceRefresh);
      } catch (e) {
        registraProblema('Taccuini OneNote', e);
        nbs = queryClient.getQueryData(qk.notebooks()) || [];
      }
      nbs.forEach((nb, i) => applyNotebookColor(nb, i, overrides));
      notebooksRef.current = nbs;
      setNotebooks(nbs);

      // Le liste dei task. Se è la prima apertura dopo il passaggio ai file
      // nostri non c'è ancora niente da leggere: i task stanno solo su To-Do e
      // vanno portati di qua prima. Si chiede solo quando non se ne ha già una
      // copia in cache, altrimenti sarebbe una lettura in più a ogni avvio.
      if (!(/** @type {any[]|undefined} */ (queryClient.getQueryData(qk.todolists()))?.length)) {
        setSync({ state: 'loading', label: 'Caricamento… migrazione attività' });
        await migraSeServe().catch(e => registraProblema('Migrazione attività da To-Do', e));
      }
      setSync({ state: 'loading', label: 'Caricamento… elenco attività' });
      /** @type {any[]} */
      let lists = [];
      try {
        lists = await fetchCached(qk.todolists(), elencoListe, STALE.todolists, forceRefresh);
      } catch (e) {
        registraProblema('Elenco attività', e);
        lists = queryClient.getQueryData(qk.todolists()) || [];
      }
      todoListsRef.current = lists;
      setTodoLists(lists);
      const map = {};
      lists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
      setTodoListsMap(map);

      // Piani giornalieri: da qui esce lo stato `scheduled` delle attività.
      // Non blocca il caricamento — senza, la colonna Programmate resta vuota
      // ma il resto della board funziona.
      fetchCached(qk.dailyPlans(), loadDailyPlans, STALE.dailyPlans, forceRefresh)
        .then(plans => setDailyPlans(plans || {}))
        .catch(e => console.error('daily plans load', e));

      // Sezioni — mostra subito quelle già in cache (senza rifetch), poi si
      // espandono lazy al click. Su forceRefresh si parte vuoti e si ricarica
      // ad ogni espansione.
      const sectMap = {};
      for (const nb of nbs) {
        const cached = forceRefresh ? null : queryClient.getQueryData(qk.sections(nb.id));
        if (cached) {
          applySectionColors(nb, cached, overrides);
          sectMap[nb.id] = cached;
        }
      }
      if (Object.keys(sectMap).length > 0) setSectionsMap(sectMap);

      setProblemi(guai);
      setSync(guai.length
        ? { state: 'error', label: `Caricamento incompleto (${guai.length})` }
        : { state: 'ok', label: `${nbs.length} taccuini` });

      // Precarica task in background
      setTimeout(() => preloadAllTasks(lists, forceRefresh), 1000);

      // Precarica pagine in background
      setTimeout(() => {
        Object.entries(sectMap).forEach(([, sects]) =>
          sects.forEach(s => enqueuePagePreload(s.id, forceRefresh))
        );
      }, 2000);

      refreshDailyReview();
      refreshDeadlineReminders(lists);

      // Precarica in coda (dopo task/pagine) tutti gli eventi Calendario dei
      // prossimi mesi in un'unica chiamata: il Pannello sezione li filtra poi
      // localmente per prefisso "[NomeSezione]", senza dover interrogare
      // Graph a ogni apertura (era il collo di bottiglia lento lamentato).
      setTimeout(() => preloadSectionCalendarEvents(forceRefresh), 3000);

    } catch (e) {
      registraProblema('Caricamento', e);
      setProblemi(guai);
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  // Campanella Daily Review: proposte di task da email Outlook recenti + tag
  // "Da fare" (Ctrl+1) nelle pagine OneNote modificate di recente. Richiamata
  // all'avvio e su "↺ Aggiorna tutto". Interamente euristica/locale — nessuna
  // chiamata AI, nessun costo. Ogni proposta viene mostrata una sola volta:
  // accettata o ignorata, la sua "firma" viene ricordata (localStorage, 7
  // giorni) così non ricompare più — nessuno sforzo manuale ripetuto.
  async function refreshDailyReview() {
    setReviewLoading(true);
    try {
      const [emails, pages] = await Promise.all([
        getRecentEmails().catch(e => { console.error('recent emails', e); return []; }),
        collectAllOneNotePages(pagesCache).catch(e => { console.error('recent pages', e); return []; }),
      ]);

      // Scansiona solo le pagine modificate dall'ultimo controllo riuscito in
      // poi — non più sempre e solo le ultime 48h. Il primo avvio (o dopo una
      // pausa lunga) ricade sul lookback di 48h con un tetto di sicurezza sul
      // numero di pagine scaricate per intero; le volte successive, essendo
      // l'intervallo corto, restano leggere.
      const lastCheck = getMarker(REVIEW_LAST_CHECK_KEY);
      const cutoffMs  = lastCheck || (Date.now() - NOTES_LOOKBACK_MS);
      const recentPages = filterRecentPages(pages, cutoffMs).slice(0, REVIEW_PAGES_CAP);

      const pagesWithHtml = [];
      for (const p of recentPages) {
        try {
          const html = await getPageContentHtml(p.id);
          pagesWithHtml.push({ ...p, html });
          await new Promise(r => setTimeout(r, 120));
        } catch (e) { console.error('page content', p.title, e); }
      }

      const seen = getMarker('review_seen') || [];
      const candidates = [
        ...extractEmailCandidates(emails, 6),
        ...extractOneNoteCandidates(pagesWithHtml, 8),
      ];
      const fresh = candidates
        .map(a => ({ ...a, id: Math.random().toString(36).slice(2) + Date.now().toString(36), _sig: suggestionSignature(a) }))
        .filter(a => !seen.includes(a._sig));
      setReviewSuggestions(fresh);
      setMarker(REVIEW_LAST_CHECK_KEY, Date.now(), REVIEW_LAST_CHECK_TTL);
    } catch (e) {
      console.error('daily review', e);
    }
    setReviewLoading(false);
  }

  // Scadenze ricorrenti (assicurazioni, salute, tasse...): un evento Calendario
  // ricorrente intitolato "[NOME-LISTA] Titolo", con reminder nativo impostato
  // con l'anticipo desiderato, fa comparire un task nella lista di
  // quell'Area nel momento in cui il reminder scatta — letto tramite
  // reminderView sulla finestra dall'ultimo controllo riuscito a oggi.
  // Nessuna proposta da accettare: il task compare direttamente e resta lì
  // finché non lo si spunta.
  async function refreshDeadlineReminders(todoLists) {
    try {
      const lastCheck = getMarker(DEADLINE_LAST_CHECK_KEY);
      const startISO = new Date(lastCheck || (Date.now() - DEADLINE_LOOKBACK_MS)).toISOString();
      const endISO = new Date().toISOString();

      const reminders = await getReminders(startISO, endISO);
      if (!reminders.length) { setMarker(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL); return; }

      const listByName = new Map((todoLists || []).map(l => [l.displayName.toLowerCase(), l]));
      const tasksByListId = {};

      for (const r of reminders) {
        const parsed = parseReminderSubject(r.eventSubject);
        if (!parsed) continue;
        const list = listByName.get(parsed.listName.toLowerCase());
        if (!list) continue;

        const startIso = r.eventStartTime?.dateTime ? new Date(r.eventStartTime.dateTime).toISOString() : '';
        const marker = reminderMarker(r.eventId, startIso);

        if (!tasksByListId[list.id]) {
          tasksByListId[list.id] = await leggiTask(list.id).catch(e => { console.error('deadline tasks', list.displayName, e); return []; });
        }
        if (tasksByListId[list.id].some(t => hasReminderMarker(t, marker))) continue;

        try {
          const task = await creaTask(list.id, {
            titolo: parsed.title,
            ...(startIso ? { scadenza: startIso.slice(0, 10) } : {}),
            // Quale occorrenza di quale evento ha generato il task: è così che
            // alla scansione dopo non lo si ricrea. Prima era un marker nelle
            // note, adesso è un campo.
            origineScadenza: marker,
          });
          tasksByListId[list.id].push(task);
          setScheduledTasks(prev => [...(prev || []), { ...task, _listName: list.displayName, _listId: list.id }]);
        } catch (e) { console.error('create deadline task', parsed.title, e); }
      }

      setMarker(DEADLINE_LAST_CHECK_KEY, Date.now(), DEADLINE_LAST_CHECK_TTL);
    } catch (e) {
      console.error('deadline reminders', e);
    }
  }

  // Eventi Calendario dei prossimi mesi, precaricati in un'unica chiamata (in
  // coda dopo task/pagine, vedi load()) invece che dal Pannello sezione a ogni
  // apertura — era il collo di bottiglia lento lamentato, perché ripeteva
  // l'intera scansione multi-calendario a ogni click. Il Pannello ora filtra
  // solo localmente per prefisso "[NomeSezione]" (vedi deadlineReminders.js).
  // Un evento creato o cancellato qui dentro va scritto anche nella cache, non
  // solo nello stato: la cache è la copia che sopravvive alla chiusura
  // dell'app, e un appuntamento appena creato che alla riapertura non si vede
  // più — perché la copia salvata è di prima — sembrerebbe un salvataggio
  // andato perso.
  /** @param {(prec: any[]) => any[]} modifica */
  function aggiornaEventiSezioni(modifica) {
    setSectionCalendarEvents(prev => modifica(prev || []));
    queryClient.setQueryData(qk.calEventiSezioni(), (/** @type {any[]|undefined} */ prec) =>
      prec ? modifica(prec) : prec);
  }

  async function preloadSectionCalendarEvents(forceRefresh = false) {
    try {
      const start = new Date(); start.setMonth(start.getMonth() - 1);
      const end = new Date(); end.setMonth(end.getMonth() + 18);
      // Via fetchCached e non più con una chiamata nuda: così la finestra di
      // eventi sopravvive alla chiusura dell'app e il Pannello sezione, alla
      // riapertura, ha già i suoi appuntamenti invece di aspettare la
      // richiesta più lenta del giro.
      const events = await fetchCached(
        qk.calEventiSezioni(), () => getCalendarEvents(start, end, 250),
        STALE.calEventiSezioni, forceRefresh);
      setSectionCalendarEvents(events);
    } catch (e) { console.error('section calendar events preload', e); }
  }

  // Se il candidato viene da OneNote, spunta subito la riga "Da fare" nella
  // pagina di origine — sia che venga accettato sia che venga scartato, la
  // Daily Review l'ha comunque "gestito" e non deve ripresentarlo.
  function resolveOneNoteSuggestion(suggestion) {
    if (suggestion.source !== 'onenote') return;
    markOneNoteTagDone(suggestion.pageId, suggestion.elementId, suggestion.originalTagHtml)
      .catch(e => console.error('mark onenote tag done', e));
  }

  // "Crea task" da un suggerimento non crea più un task al volo nella prima
  // lista disponibile: apre il pannello GTD con il testo già pronto, così
  // l'utente decide lui dove posizionarlo nel flusso (Farla, Progetto,
  // Area/Ricorrenti, Risorse, Archivio...).
  function handleAcceptSuggestion(suggestion, editedText) {
    markSuggestionSeen(suggestion._sig);
    resolveOneNoteSuggestion(suggestion);
    setReviewSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    setReviewOpen(false);
    setGtdSeedText((editedText || suggestion.extractedAction || '').trim());
    setGtdOpen(true);
  }

  function handleDismissSuggestion(suggestion) {
    markSuggestionSeen(suggestion._sig);
    resolveOneNoteSuggestion(suggestion);
    setReviewSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  }

  async function preloadAllTasks(lists, forceRefresh = false) {
    const allTasks = [];
    let anyError = false;
    /** @type {{dove: string, messaggio: string}[]} */
    const problemiTask = [];
    for (const l of lists) {
      try {
        const tasks = await fetchCached(qk.tasks(l.id), () => leggiTaskAperti(l.id), STALE.tasks, forceRefresh);
        tasksCache.current[l.id] = tasks;
        tasks.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error('preload tasks', l.displayName, e);
        anyError = true;
        problemiTask.push({ dove: `Attività · ${l.displayName}`, messaggio: descriviErrore(e) });
        // Non lasciare la lista vuota per un errore transitorio (es. 401 dopo
        // una pausa lunga): ripiega sull'ultima copia in cache così l'utente
        // non vede la pianificazione sparire del tutto.
        const stale = queryClient.getQueryData(qk.tasks(l.id));
        if (stale) {
          tasksCache.current[l.id] = stale;
          stale.forEach(t => allTasks.push({ ...t, _listName: l.displayName, _listId: l.id }));
        }
      }
    }
    setScheduledTasks(allTasks);
    if (anyError) {
      // In coda a quelli del caricamento, non al loro posto: il pannello di
      // stato deve mostrare tutto quello che non è riuscito, non solo l'ultima
      // cosa andata storta.
      setProblemi(p => [...p, ...problemiTask]);
      setSync({ state: 'error', label: 'Errore aggiornamento task — dati non aggiornati' });
    }
  }

  function enqueuePagePreload(sectionId, forceRefresh = false) {
    if (!forceRefresh && pagesCache.current[sectionId]) return;
    preloadQueueRef.current.push({ sectionId, forceRefresh });
    runPreloadQueue();
  }

  async function runPreloadQueue() {
    if (preloadRunningRef.current) return;
    preloadRunningRef.current = true;
    while (preloadQueueRef.current.length > 0) {
      const { sectionId, forceRefresh } = preloadQueueRef.current.shift();
      if (!forceRefresh && pagesCache.current[sectionId]) continue;
      try {
        const cached = await fetchCached(qk.pages(sectionId), () => getPages(sectionId), STALE.pages, forceRefresh);
        pagesCache.current[sectionId] = cached;
        await new Promise(r => setTimeout(r, 400));
      } catch (e) { console.error('preload pages', sectionId, e); }
    }
    preloadRunningRef.current = false;
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    try {
      const sects = await fetchCached(qk.sections(nb.id), () => getSections(nb.id), STALE.sections);
      applySectionColors(nb, sects, colorSettingsRef.current);
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      setTimeout(() => sects.forEach(s => enqueuePagePreload(s.id)), 1500);
    } catch (e) {
      console.error('Errore sezioni', nb.displayName, e);
      setSectionsMap(prev => ({ ...prev, [nb.id]: [] }));
    }
  }

  // Salva i nuovi override colore (localStorage + OneDrive, come workbooks/
  // planner config) e ricolora subito taccuini/sezioni già in memoria, così
  // il cambiamento è visibile ovunque senza dover ricaricare la pagina.
  function applyColorSettings(next) {
    colorSettingsRef.current = next;
    setColorSettings(next);
    queryClient.setQueryData(qk.colorSettings(), next);
    if (colorSettingsLoadedRef.current) {
      saveColorSettings(next).catch(e => console.error('save color settings', e));
    }

    const nbs = notebooksRef.current;
    nbs.forEach((nb, i) => applyNotebookColor(nb, i, next));
    setNotebooks([...nbs]);

    setSectionsMap(prev => {
      Object.entries(prev).forEach(([nbId, sects]) => {
        const nb = nbs.find(n => n.id === nbId);
        if (nb) applySectionColors(nb, sects, next);
      });
      return { ...prev };
    });
  }

  function setNotebookColor(nbId, color) {
    const cur = colorSettingsRef.current;
    applyColorSettings({ notebooks: { ...cur.notebooks, [nbId]: color }, sections: cur.sections });
  }

  function setSectionColor(sectionId, color) {
    const cur = colorSettingsRef.current;
    applyColorSettings({ notebooks: cur.notebooks, sections: { ...cur.sections, [sectionId]: color } });
  }

  function resetNotebookColor(nbId) {
    const cur = colorSettingsRef.current;
    const nextNotebooks = { ...cur.notebooks };
    delete nextNotebooks[nbId];
    applyColorSettings({ notebooks: nextNotebooks, sections: cur.sections });
  }

  function resetSectionColor(sectionId) {
    const cur = colorSettingsRef.current;
    const nextSections = { ...cur.sections };
    delete nextSections[sectionId];
    applyColorSettings({ notebooks: cur.notebooks, sections: nextSections });
  }

  // Le liste di una sezione: quella omonima di sempre, più le consegne
  // annidate sotto la commessa (`2573.A60-260831` sta in `2573-ABS`, vedi
  // paraConfig.js). Sono N, non una: una commessa con tre consegne ha tre
  // liste, e il pannello le deve vedere tutte.
  function findTodoLists(sectionName) {
    return listsForSection(sectionName, todoLists, allSectionNames);
  }

  // Le sveglie guardano lo stesso pool di attività di tutto il resto: l'ora
  // sta nelle note del task (marker `[SVEGLIA:hh:mm]`), quindi non c'è niente
  // da caricare a parte — chi ha il pool ha già le sveglie.
  const sveglie = useSveglie(scheduledTasks);

  // «Vai» sull'avviso: porta alla sezione dell'attività, che è il posto da cui
  // la si fa. Se la sua lista non ha una sezione — l'Inbox, per dirne una —
  // resta la vista Attività, dove comunque si trova.
  function apriTaskDaSveglia(task) {
    const sectionName = sectionNameForList(task?._listName, allSectionNames);
    const sec = sectionName
      ? Object.values(sectionsMap || {}).flat()
          .find(x => (x.displayName || '').toLowerCase() === sectionName.toLowerCase())
      : null;
    navigate(sec ? `/sezioni/${sec.id}` : '/attivita');
  }

  function handleSelectSection(section, nb, appKey = 'onenote') {
    if (!section) { setSelected(null); return; }
    const lists = findTodoLists(section.displayName);
    // `listId`/`listName` restano la lista principale — dove nasce un'attività
    // creata dal pannello, cioè la lista omonima se c'è, altrimenti la prima
    // consegna. Chi sa gestire più consegne legge `lists`.
    const primary = lists[0] || null;
    setSelected({
      type: 'section', data: section, nb,
      lists,
      listId: primary?.id || null,
      listName: primary?.displayName || null,
      initialTab: appKey.toLowerCase(),
    });
  }

  // Una consegna nuova (o rinominata per spostarne la scadenza) cambia
  // l'elenco delle liste: senza rileggerlo, comparirebbe solo al reload.
  async function refreshTodoLists() {
    const lists = await fetchCached(qk.todolists(), elencoListe, STALE.todolists, true);
    todoListsRef.current = lists;
    setTodoLists(lists);
    const map = {};
    lists.forEach(l => { map[l.displayName.toLowerCase()] = { id: l.id, displayName: l.displayName }; });
    setTodoListsMap(map);
    return lists;
  }

  async function handleCreateDeliverable(displayName) {
    const created = await creaLista(displayName);
    await refreshTodoLists();
    return created;
  }

  async function handleRenameDeliverable(listId, displayName) {
    const renamed = await rinominaLista(listId, displayName);
    await refreshTodoLists();
    // I task portano con sé il nome della lista (`_listName`): dopo una
    // rinomina quello vecchio direbbe la scadenza sbagliata.
    setScheduledTasks(prev => (prev || []).map(t => t._listId === listId ? { ...t, _listName: displayName } : t));
    return renamed;
  }

  // Aggiorna la lista globale dei task (e la cache del Panel di sezione) dopo
  // un completamento/eliminazione/rinomina fatti dal pannello Piano, così
  // Task Pool e Panel restano coerenti senza dover
  // ricaricare tutto da Graph.
  function updateTasksEverywhere(listId, updater) {
    setScheduledTasks(prev => updater(prev || []));
    if (tasksCache.current[listId]) {
      tasksCache.current[listId] = updater(tasksCache.current[listId]);
    }
    // Anche la copia in cache della lista. È quella da cui la scheda di
    // dettaglio si dipinge appena aperta (vedi TaskDetailPanel.daMemoria) e
    // quella che si ritrova riaprendo l'app: lasciarla indietro voleva dire
    // vedere per un istante la versione di prima di ogni cosa appena
    // cambiata.
    queryClient.setQueryData(qk.tasks(listId), (/** @type {any[]|undefined} */ prec) => (
      prec ? updater(prec) : prec
    ));
  }

  // Completamento ed eliminazione hanno lo stesso effetto locale: il task
  // sparisce da pool e cache di sezione.
  function handleTaskRemoved(listId, taskId) {
    updateTasksEverywhere(listId, tasks => tasks.filter(t => t.id !== taskId));
  }

  function handleTaskPatched(listId, taskId, patch) {
    updateTasksEverywhere(listId, tasks => tasks.map(t => t.id === taskId ? { ...t, ...patch } : t));
  }

  // Simmetrico a handleTaskRemoved: rimette un task (ricreato da un undo di
  // eliminazione/completamento) nel pool globale.
  function handleTaskRestored(listId, task) {
    updateTasksEverywhere(listId, tasks => [...tasks, task]);
  }

  // ── Vista Attività: le transizioni di stato ──────────────────────────────
  // Lo stato vive nel file su OneDrive, non in memoria: si scrive prima lì e si
  // aggiorna il pool solo dopo, così una schermata che dice "In attesa"
  // corrisponde sempre a un task che nel file è davvero `waiting`.

  // Una scrittura sola. Prima ne servivano due — una per la riga della persona
  // nelle note, una per lo `status` — e se la seconda falliva il task restava
  // con «Delegato a: Sara» nelle note e `notStarted` come stato, cioè in
  // Prossime azioni col nome di qualcuno dentro. Adesso stato e persona sono
  // due campi dello stesso task e cambiano insieme.
  //
  // `persona` è il nome scelto da chi sposta — senza, si tiene quello che
  // l'attività aveva già, perché passare da «in attesa da Sara» a «delegato»
  // non deve far dimenticare Sara.
  async function handleChangeTaskStatus(task, status, persona) {
    const listId = task._listId;
    const prima = { stato: task.stato, persona: task.persona ?? null };
    const role = personRoleFor(status);
    const dopo = {
      stato: status === 'scheduled' ? 'next' : status,
      persona: role ? (persona || taskPerson(task)?.who || 'qualcuno') : null,
    };
    // Trascinare un'attività dove già sta non è un cambiamento: senza questo
    // controllo lascerebbe comunque un «annulla» che non annulla niente.
    if (dopo.stato === prima.stato && dopo.persona === prima.persona) return;
    try {
      await aggiornaTask(listId, task.id, dopo);
      handleTaskPatched(listId, task.id, dopo);
      pushUndo({
        label: `Spostata in ${STATUS_LABELS[status]}`,
        undo: async () => {
          await aggiornaTask(listId, task.id, prima);
          handleTaskPatched(listId, task.id, prima);
        },
      });
    } catch (e) {
      console.error('cambio stato attività', e);
    }
  }

  // Programmare vuol dire dare un'ora, e l'ora si dà sulla griglia: la board
  // porta al Piano sul giorno corrente con il task già in mano, invece di
  // inventare un orario per conto suo.
  function handleScheduleTask(task) {
    setPendingPlannerTask(task);
    navigate('/piano');
  }

  // Toglie il blocco dal piano di ogni giorno in cui compare: senza blocco il
  // task torna `next` da solo, perché `scheduled` non è un campo ma la
  // presenza del blocco.
  async function handleUnscheduleTask(task) {
    const previous = dailyPlans;
    const next = {};
    // Si toccano solo i giorni che quel blocco ce l'hanno davvero. Prima ogni
    // giorno veniva ricostruito comunque, e quando il task non era in nessun
    // piano il risultato era un file riscritto identico su OneDrive più un
    // «annulla» in fondo allo schermo che non annullava niente — cioè
    // un'azione dichiarata a chi guarda e mai avvenuta.
    let tolto = false;
    for (const [date, plan] of Object.entries(dailyPlans || {})) {
      const blocks = plan.blocks || [];
      const rimasti = blocks.filter(b => b.taskId !== task.id);
      if (rimasti.length === blocks.length) { next[date] = plan; continue; }
      tolto = true;
      next[date] = { ...plan, blocks: rimasti };
    }
    if (!tolto) return;
    setDailyPlans(next);
    try {
      await saveDailyPlans(next);
      queryClient.setQueryData(qk.dailyPlans(), next);
      pushUndo({
        label: 'Rimandata',
        undo: async () => {
          setDailyPlans(previous);
          await saveDailyPlans(previous);
          queryClient.setQueryData(qk.dailyPlans(), previous);
        },
      });
    } catch (e) {
      console.error('rimozione dal piano', e);
      setDailyPlans(previous);
    }
  }

  // Il piano di oggi cambiato da Sezioni: si trascina un'attività sulla
  // colonna Oggi della plancia e il blocco nasce lì. È la stessa scrittura del
  // Piano — stesso file su OneDrive, stessa cache — perché è lo stesso piano:
  // la plancia non ne tiene una copia sua.
  async function handlePlansChanged(next) {
    const previous = dailyPlans;
    setDailyPlans(next);
    try {
      await saveDailyPlans(next);
      queryClient.setQueryData(qk.dailyPlans(), next);
    } catch (e) {
      console.error('salvataggio piano da Sezioni', e);
      setDailyPlans(previous);
    }
  }

  // Completare un'azione da Oggi tocca due cose: il task nel suo file e il blocco
  // nel piano del giorno. Il blocco va segnato comunque — è lo storico della
  // giornata, e serve al Diario — anche se il task nel frattempo non esiste
  // più su Graph (cancellato dal telefono, per dire).
  async function handleCompleteBlock(block) {
    const dateStr = ymd();
    const previous = dailyPlans;
    const plan = dailyPlans?.[dateStr];
    if (!plan) return;

    const next = {
      ...dailyPlans,
      [dateStr]: {
        ...plan,
        blocks: (plan.blocks || []).map(b =>
          b.id === block.id ? { ...b, completed: true, completedAt: new Date().toISOString() } : b
        ),
      },
    };
    setDailyPlans(next);

    try {
      if (block.taskId && block.listId) {
        await aggiornaTask(block.listId, block.taskId, { stato: 'done' });
        handleTaskRemoved(block.listId, block.taskId);
      }
    } catch (e) {
      console.error('completamento task da Oggi', e);
    }

    try {
      await saveDailyPlans(next);
      queryClient.setQueryData(qk.dailyPlans(), next);
    } catch (e) {
      console.error('salvataggio piano da Oggi', e);
      setDailyPlans(previous);
    }
  }

  async function handleRefresh() {
    setSelected(null);
    setNotebooks([]);
    notebooksRef.current = [];
    setSectionsMap({});
    setScheduledTasks(null);
    await load(true);
  }

  if (!ready) return null;

  if (!account) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-title">Benvenuto</div>
          <div className="login-desc">Accedi con il tuo account Microsoft per caricare<br />i tuoi taccuini OneNote automaticamente.</div>
          <button className="login-btn" onClick={handleLogin}>
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Accedi con Microsoft
          </button>
          <div className="login-note">Solo permessi di lettura · nessun dato salvato</div>
          <LoginDiagnostics />
        </div>
      </div>
    );
  }

  // La vista Mappa è l'unica a cui serva il commutatore taccuini/PARA: tenerlo
  // sempre in topbar lo renderebbe un comando che per cinque viste su sei non
  // fa niente di visibile.
  const onMap = location.pathname.startsWith('/mappa');

  const topbar = (
    <>
      <div className="sync-wrap">
        <button
          className="sync-status tap-44"
          title={sync.label}
          aria-label={`Stato: ${sync.label}`}
          onClick={() => setStatoOpen(o => !o)}>
          <span className={`sync-dot ${sync.state}`} />
          <span className="sync-label-text">{sync.label}</span>
        </button>
        {statoOpen && (
          <PannelloStato
            sync={sync}
            problemi={problemi}
            account={account?.username || null}
            onChiudi={() => setStatoOpen(false)}
            onAggiorna={() => { setStatoOpen(false); handleRefresh(); }}
          />
        )}
      </div>
      {onMap && (
        <div className="map-view-toggle">
          <button className={mapViewMode === 'workbook' ? 'active' : ''} onClick={() => setMapViewMode('workbook')} title="Vista per taccuino">Taccuini</button>
          <button className={mapViewMode === 'para' ? 'active' : ''} onClick={() => setMapViewMode('para')} title="Vista PARA">PARA</button>
        </div>
      )}
      <div className="bell-wrap">
        <button
          className={`search-btn tap-44${reviewOpen ? ' active' : ''}${reviewSuggestions.length ? ' has-badge' : ''}`}
          onClick={() => setReviewOpen(o => !o)}
          title="Proposte Daily Review">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {reviewSuggestions.length > 0 && <span className="header-badge">{reviewSuggestions.length}</span>}
        </button>
        {reviewOpen && (
          <div className="bell-dropdown">
            <div className="bell-dropdown-header">
              <span>Daily Review</span>
              <button onClick={() => setReviewOpen(false)}>✕</button>
            </div>
            {reviewLoading && <div className="bell-empty">Analisi email e OneNote in corso…</div>}
            {!reviewLoading && reviewSuggestions.length === 0 && (
              <div className="bell-empty">Nessuna proposta al momento.</div>
            )}
            {!reviewLoading && reviewSuggestions.map(s => (
              <BellSuggestionItem
                key={s.id}
                suggestion={s}
                onAccept={handleAcceptSuggestion}
                onDismiss={handleDismissSuggestion}
              />
            ))}
          </div>
        )}
      </div>
      {/* Le scorciatoie stanno accanto alla campanella e non in Impostazioni:
          è un promemoria che si guarda una volta, non una preferenza. */}
      <ShortcutsPanel />
      <button className="search-btn tap-44" onClick={() => setSearchOpen(true)} title="Cerca (⌘K)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>
      <button className="search-btn tap-44" onClick={handleRefresh} title="Aggiorna tutto">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
          <polyline points="20.5 4 20.5 9 15.5 9" />
        </svg>
      </button>
    </>
  );

  return (
    <>
      {needsReconnect && (
        <div className="auth-banner" role="status">
          <span>Sessione Microsoft scaduta — i dati mostrati sono quelli dell'ultimo caricamento.</span>
          <button onClick={() => reconnect()}>Riconnetti</button>
        </div>
      )}
      <AppShell
        topbar={topbar}
        onCapture={() => setCaptureOpen(true)}
        onOpenSettings={() => setColorSettingsOpen(true)}>
        {/* L'attesa mentre la vista arriva. Una riga sola e non uno scheletro:
            il chunk di una vista pesa qualche decina di kB e su una rete
            normale non fa in tempo a vedersi, mentre su una lenta uno
            scheletro finto a tutta pagina somiglia troppo a un'app che si è
            aperta vuota — che è esattamente l'equivoco da evitare. */}
        <Suspense fallback={<div className="vista-attesa muted">Caricamento…</div>}>
          <Routes>
            <Route path="/oggi" element={
              <TodayView
                plans={dailyPlans}
                tasks={scheduledTasks || []}
                todoLists={todoLists}
                calendarEvents={sectionCalendarEvents}
                onCompleteBlock={handleCompleteBlock}
                onOpenIdentity={setIdentityOpen}
              />
            } />

            <Route path="/piano" element={
              <PlannerView
                open
                onClose={() => navigate('/oggi')}
                preloadedTasks={scheduledTasks || []}
                notebooks={notebooks}
                sectionsMap={sectionsMap}
                todoLists={todoLists}
                autoAddTask={pendingPlannerTask}
                onAutoAdded={() => setPendingPlannerTask(null)}
                onTaskCompleted={handleTaskRemoved}
                onTaskDeleted={handleTaskRemoved}
                onTaskRenamed={(listId, taskId, titolo) => handleTaskPatched(listId, taskId, { titolo })}
                onTaskDueChanged={(listId, taskId, scadenza) => handleTaskPatched(listId, taskId, { scadenza })}
                onTaskPatched={handleTaskPatched}
                onTaskRestored={handleTaskRestored}
                calendarDirtyToken={calendarDirtyToken}
              />
            } />

            <Route path="/attivita" element={
              <ActivityBoard
                tasks={scheduledTasks || []}
                todoLists={todoLists}
                plans={dailyPlans}
                config={plannerConfig}
                loading={scheduledTasks === null}
                notebooks={notebooks}
                sectionsMap={sectionsMap}
                onClarify={task => { setClarifyTask(task); setGtdSeedText(task.titolo || ''); setGtdOpen(true); }}
                onChangeStatus={handleChangeTaskStatus}
                onSchedule={handleScheduleTask}
                onUnschedule={handleUnscheduleTask}
                onTaskRemoved={handleTaskRemoved}
                onTaskPatched={handleTaskPatched}
                onTaskRestored={handleTaskRestored}
              />
            } />

            <Route path="/sezioni/:sectionId?" element={
              <SectionsView
                notebooks={notebooks}
                sectionsMap={sectionsMap}
                todoLists={todoLists}
                tasks={scheduledTasks || []}
                pagesCache={pagesCache}
                plans={dailyPlans}
                onPlansChanged={handlePlansChanged}
                onTaskRemoved={handleTaskRemoved}
                onTaskPatched={handleTaskPatched}
                onTaskRestored={handleTaskRestored}
                onCreateDeliverable={handleCreateDeliverable}
                onRenameDeliverable={handleRenameDeliverable}
              />
            } />

            <Route path="/diario" element={<DiaryPanel />} />

            {/* Finanze porta con sé recharts e sette pagine di tabelle: mezzo
                megabyte che non deve pesare sull'avvio di «Oggi», visto che è la
                sezione in cui si entra qualche volta al mese. L'attesa è quella
                comune a tutte le viste, qui sopra. */}
            <Route path="/finanze/:sezione?" element={<FinanzeSection />} />

            <Route path="/mappa" element={
              <div className="canvas-area">
                <MindMap
                  notebooks={notebooks}
                  sectionsMap={sectionsMap}
                  todoListsMap={todoListsMap}
                  todoCountMap={todoCountMap}
                  viewMode={mapViewMode}
                  onSelectSection={handleSelectSection}
                  onExpandNotebook={handleExpandNotebook}
                  externalZoom={zoom}
                  onZoomChange={setZoom}
                  onIdentityOpen={setIdentityOpen}
                />
              </div>
            } />

            <Route path="*" element={<Navigate to="/oggi" replace />} />
          </Routes>
        </Suspense>
      </AppShell>

      {/* Bussola e Visione sono un modale a schermo intero, non un pezzo della
          Mappa: da quando li apre anche Oggi vivono qui, fuori dalle rotte. */}
      <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(null)} />

      {/* Pannello sezione (ToDo/OneNote/OneDrive) — fisso rispetto al
          viewport, non alla rotta corrente, così resta aperto anche
          cambiando vista. Sparisce quando arriverà /sezioni/:id. */}
      <Panel
        selected={selected}
        pagesCache={pagesCache}
        tasksCache={tasksCache}
        calendarEvents={sectionCalendarEvents}
        onClose={() => setSelected(null)}
      />
      <QuickCapture
        open={captureOpen}
        todoLists={todoLists}
        context={captureContext}
        onClose={() => setCaptureOpen(false)}
        onCaptured={task => setScheduledTasks(prev => [...(prev || []), task])}
        onDecideNow={text => { setGtdSeedText(text); setGtdOpen(true); }}
      />
      <GtdClarifyModal
        open={gtdOpen}
        onClose={() => { setGtdOpen(false); setGtdSeedText(''); setClarifyTask(null); }}
        seedText={gtdSeedText}
        sourceTask={clarifyTask}
        todoLists={todoLists}
        notebooks={notebooks}
        sectionsMap={sectionsMap}
        onTaskCreated={(task, { addToday }) => {
          setScheduledTasks(prev => [...(prev || []), task]);
          if (addToday) { setPendingPlannerTask(task); navigate('/piano'); }
        }}
        onTaskRemoved={handleTaskRemoved}
        onEventCreated={event => {
          aggiornaEventiSezioni(prev => [...prev, event]);
          setCalendarDirtyToken(t => t + 1);
        }}
        onEventRemoved={eventId => {
          aggiornaEventiSezioni(prev => prev.filter(e => e.id !== eventId));
          setCalendarDirtyToken(t => t + 1);
        }}
      />
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        notebooks={notebooks}
        sectionsMap={sectionsMap}
        pagesCache={pagesCache}
        tasks={scheduledTasks || []}
        onSelectSection={(sec, nb, app) => { navigate('/mappa'); handleSelectSection(sec, nb, app); }}
      />
      <ColorSettingsModal
        open={colorSettingsOpen}
        onClose={() => setColorSettingsOpen(false)}
        notebooks={notebooks}
        sectionsMap={sectionsMap}
        overrides={colorSettings}
        onExpandNotebook={handleExpandNotebook}
        onSetNotebookColor={setNotebookColor}
        onSetSectionColor={setSectionColor}
        onResetNotebookColor={resetNotebookColor}
        onResetSectionColor={resetSectionColor}
      />
      <UndoToast />

      {/* La sveglia sta qui, in fondo e fuori da ogni rotta: deve poter
          coprire qualunque vista, compreso il Piano a schermo intero. */}
      <SvegliaAlert
        sveglie={sveglie.attive}
        onChiudi={sveglie.chiudi}
        onChiudiTutte={sveglie.chiudiTutte}
        onApri={apriTaskDaSveglia}
      />
    </>
  );
}

// Riga della campanella Daily Review: senza un LLM a ripulire il testo, il
// titolo proposto (oggetto email o riga taggata "Da fare" in OneNote) resta
// modificabile prima di creare il task.
function BellSuggestionItem({ suggestion, onAccept, onDismiss }) {
  const [text, setText] = useState(suggestion.extractedAction);

  return (
    <div className="bell-item">
      <input
        className="bell-item-input"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="bell-item-meta">
        {suggestion.source === 'onenote' ? '📓' : '📧'} {suggestion.title?.slice(0, 40)}
      </div>
      <div className="bell-item-actions">
        <button className="bell-accept-btn" onClick={() => onAccept(suggestion, text)}>✓ Crea task</button>
        <button className="bell-dismiss-btn" onClick={() => onDismiss(suggestion)}>✕</button>
      </div>
    </div>
  );
}
