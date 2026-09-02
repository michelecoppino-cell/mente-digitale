// @ts-nocheck — non ancora controllato dai tipi. È un debito dichiarato, non
// una scelta: vedi la nota in jsconfig.json. Si toglie questa riga, si
// sistema quello che salta fuori, e il file entra col resto.
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  loadDiaryIndex, loadDiaryMonth, saveDiaryEntry, deleteDiaryEntry, loadIdentityDoc,
} from './api';
import {
  DIARY_TYPES, MOOD_LABELS, ENERGY_LABELS, EVENING_QUESTIONS, AI_PRESETS,
  makeEntry, eveningText, filterEntries, allTags, lastDays, seedForDate,
  monthKey, shiftMonth, humanDate, buildAiExport, dateKey, SEEDS, SVUOTA_TESTA_METHOD,
} from './diary';
import { addPhotos, removePhotos, getDiaryPhotoUrl, MAX_PHOTOS_PER_ENTRY } from './diaryPhotos';
import DiaryImport from './DiaryImport';
import { useEscape } from './useEscape';
import './DiaryPanel.css';

// Bozza in corso: lo svuota testa è la modalità in cui è più facile perdere
// dieci minuti di scrittura chiudendo per sbaglio la finestra, quindi il testo
// vive anche su localStorage finché non viene salvato (o lasciato andare).
const DRAFT_KEY = 'md_diary_draft';

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function saveDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage pieno */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* no-op */ }
}

// Il Diario è una scheda come Oggi, Piano e Attività: sta nel contenuto della
// rotta, non in una finestra sopra il resto dell'app. Resta a tutto schermo
// solo mentre si scrive — lì l'interfaccia deve sparire, ed è il punto.
export default function DiaryPanel() {
  const [view, setView] = useState('home');   // home | write | sera | ai | importa
  const [quickMood, setQuickMood] = useState(false);
  const [writeType, setWriteType] = useState('svuota-testa');
  const [entries, setEntries] = useState([]);
  const [months, setMonths] = useState([]);        // mesi noti dall'indice
  const [loadedMonths, setLoadedMonths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [resumeDraft, setResumeDraft] = useState(loadDraft);

  // Caricamento iniziale, riusato dopo un'importazione: l'indice è cambiato e
  // le voci nuove stanno in mesi che nessuno ha ancora chiesto.
  function ricarica() {
    const thisMonth = monthKey();
    const prevMonth = shiftMonth(thisMonth, -1);
    setLoading(true);
    setLoadFailed(false);
    return Promise.all([loadDiaryIndex(), loadDiaryMonth(thisMonth), loadDiaryMonth(prevMonth)])
      .then(([idx, a, b]) => {
        setMonths(idx.months);
        // Dedup per id: a cavallo di mezzanotte del primo del mese, o dopo un
        // salvataggio andato a buon fine due volte, la stessa voce può trovarsi
        // in entrambi i file caricati.
        const byId = new Map([...a, ...b].map(e => [e.id, e]));
        setEntries([...byId.values()]);
        setLoadedMonths([thisMonth, prevMonth]);
      })
      // Un errore di rete non deve mostrare un diario vuoto: da lì un
      // salvataggio successivo riscriverebbe il mese azzerandolo.
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { ricarica(); }, []);

  async function loadOlderMonth() {
    const older = months.filter(m => !loadedMonths.includes(m)).sort().reverse()[0];
    if (!older) return;
    const more = await loadDiaryMonth(older);
    setEntries(prev => [...prev, ...more]);
    setLoadedMonths(prev => [...prev, older]);
  }

  // Dopo aver importato anni di voci dal diario dell'iPhone, arrivare al 2024
  // un mese per volta sarebbe una trentina di clic: qui si prende tutto quello
  // che l'indice conosce in un colpo solo.
  async function loadAllMonths() {
    const restanti = months.filter(m => !loadedMonths.includes(m));
    if (!restanti.length) return;
    setLoadingAll(true);
    try {
      const caricati = await Promise.all(restanti.map(loadDiaryMonth));
      setEntries(prev => [...prev, ...caricati.flat()]);
      setLoadedMonths(prev => [...prev, ...restanti]);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoadingAll(false);
    }
  }

  async function persist(entry) {
    const updated = await saveDiaryEntry(entry);
    const ym = entry.date.slice(0, 7);
    setEntries(prev => [...prev.filter(e => e.date.slice(0, 7) !== ym), ...updated]);
    setMonths(prev => (prev.includes(ym) ? prev : [...prev, ym].sort()));
    setLoadedMonths(prev => (prev.includes(ym) ? prev : [...prev, ym]));
    clearDraft();
    setResumeDraft(null);
    setView('home');
  }

  async function handleDelete(entry) {
    const updated = await deleteDiaryEntry(entry);
    const ym = entry.date.slice(0, 7);
    setEntries(prev => [...prev.filter(e => e.date.slice(0, 7) !== ym), ...updated]);
    // Le immagini vivono fuori dal JSON del mese: senza questo resterebbero
    // su OneDrive per sempre, senza più niente che le citi.
    removePhotos(entry.photos || []);
  }

  function startWrite(type) {
    setWriteType(type);
    setView(type === 'sera' ? 'sera' : 'write');
  }

  const hasOlder = months.some(m => !loadedMonths.includes(m));

  // Escape torna alla timeline dalle due sotto-viste che non chiedono niente:
  // l'esportazione per l'AI e l'importazione dal Diario di Apple, dove si
  // guarda e basta e l'unica uscita era il bottone «Indietro». Non dalle
  // schermate di scrittura: da lì si esce con conserva, cassetto o lascia
  // andare, e un tasto che butta via un foglio pieno non ci va.
  useEscape(view === 'ai' || view === 'importa', () => setView('home'));

  return (
    <div className="diary-page">
      {view === 'home' && (
        <DiaryHome
          entries={entries}
          loading={loading}
          loadFailed={loadFailed}
          resumeDraft={resumeDraft}
          hasOlder={hasOlder}
          monthsLeft={months.filter(m => !loadedMonths.includes(m)).length}
          loadingAll={loadingAll}
          onLoadOlder={loadOlderMonth}
          onLoadAll={loadAllMonths}
          onStart={startWrite}
          onResume={() => { setWriteType(resumeDraft?.type || 'svuota-testa'); setView('write'); }}
          onDiscardDraft={() => {
            removePhotos(resumeDraft?.photos || []);
            clearDraft();
            setResumeDraft(null);
          }}
          onOpenAi={() => setView('ai')}
          onOpenImport={() => setView('importa')}
          onOpenQuickMood={() => setQuickMood(true)}
          onDelete={handleDelete}
        />
      )}
      {view === 'write' && (
        <DiaryWriter
          type={writeType}
          initial={resumeDraft?.type === writeType ? resumeDraft : null}
          onSave={persist}
          onCancel={() => setView('home')}
        />
      )}
      {view === 'sera' && (
        <EveningRitual onSave={persist} onCancel={() => setView('home')} />
      )}
      {view === 'ai' && (
        <AiExport entries={entries} onBack={() => setView('home')} />
      )}
      {view === 'importa' && (
        <DiaryImport
          onBack={() => setView('home')}
          onImported={ricarica}
        />
      )}
      {quickMood && (
        <QuickMoodModal
          onSave={async entry => { await persist(entry); setQuickMood(false); }}
          onClose={() => setQuickMood(false)}
        />
      )}
    </div>
  );
}

// ── Home: timeline, ricerca, ingressi alle modalità ─────────────────────────

function DiaryHome({
  entries, loading, loadFailed, resumeDraft, hasOlder, monthsLeft, loadingAll,
  onLoadOlder, onLoadAll, onStart, onResume, onDiscardDraft, onOpenAi, onOpenImport, onOpenQuickMood, onDelete,
}) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(null);
  const [includeSealed, setIncludeSealed] = useState(false);

  const visible = useMemo(
    () => filterEntries(entries, { query, tag, includeSealed }),
    [entries, query, tag, includeSealed],
  );
  const tags = useMemo(() => allTags(entries).slice(0, 12), [entries]);
  const wroteToday = entries.some(e => e.date === dateKey());

  return (
    <div className="diary-panel">
      <div className="diary-header">
        <span className="diary-title">Diario</span>
        <div className="diary-header-actions">
          <button className="diary-ghost-btn" onClick={onOpenQuickMood} title="Registra solo umore ed energia, senza scrivere">
            🎚️ Umore/energia
          </button>
          <button className="diary-ghost-btn" onClick={onOpenAi} title="Prepara il testo da incollare in una chat AI">
            Copia per l'AI
          </button>
        </div>
      </div>

      <div className="diary-body">
        {(resumeDraft?.text?.trim() || resumeDraft?.photos?.length > 0) && (
          <div className="diary-draft-banner">
            <span>Hai una scrittura non salvata di {DIARY_TYPES[resumeDraft.type]?.label?.toLowerCase()}.</span>
            <div>
              <button className="diary-ghost-btn" onClick={onResume}>Riprendi</button>
              <button className="diary-link-btn" onClick={onDiscardDraft}>Scarta</button>
            </div>
          </div>
        )}

        <div className="diary-modes">
          <button className="diary-mode-card" onClick={() => onStart('svuota-testa')}>
            <span className="diary-mode-icon">🌬️</span>
            <span className="diary-mode-label">Svuota testa</span>
            <span className="diary-mode-desc">Scrivi di getto. La domanda è solo un invito.</span>
          </button>
          <button className="diary-mode-card" onClick={() => onStart('sera')}>
            <span className="diary-mode-icon">🕯️</span>
            <span className="diary-mode-label">Rituale della sera</span>
            <span className="diary-mode-desc">Tre domande, tre gratitudini, umore ed energia.</span>
          </button>
          <button className="diary-mode-card" onClick={() => onStart('libero')}>
            <span className="diary-mode-icon">✍️</span>
            <span className="diary-mode-label">Scrittura libera</span>
            <span className="diary-mode-desc">Solo il foglio, per quando sai già di cosa parlare.</span>
          </button>
        </div>

        <div className="diary-import-entry">
          <button className="diary-link-btn" onClick={onOpenImport}>
            Importa dal Diario dell'iPhone
          </button>
        </div>

        {!wroteToday && !loading && !loadFailed && (
          <div className="diary-nudge">Oggi non hai ancora scritto niente.</div>
        )}

        <MoodTrend entries={entries} />

        <div className="diary-filters">
          <input
            className="diary-search"
            placeholder="Cerca nel diario…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <label className="diary-checkbox" title="Mostra anche le voci chiuse nel cassetto">
            <input type="checkbox" checked={includeSealed} onChange={e => setIncludeSealed(e.target.checked)} />
            cassetto
          </label>
        </div>
        {tags.length > 0 && (
          <div className="diary-tags">
            {tags.map(t => (
              <button
                key={t}
                className={`diary-tag${tag === t ? ' active' : ''}`}
                onClick={() => setTag(tag === t ? null : t)}
              >#{t}</button>
            ))}
          </div>
        )}

        {loading && <div className="diary-status">Caricamento…</div>}
        {loadFailed && (
          <div className="diary-status error">
            Errore nel caricamento del diario. Chiudi e riprova — non scrivere ora, per non rischiare
            di sovrascrivere le voci esistenti.
          </div>
        )}
        {!loading && !loadFailed && visible.length === 0 && (
          <div className="diary-status">Nessuna voce{query || tag ? ' per questo filtro' : ' ancora'}.</div>
        )}

        {visible.map(e => <DiaryEntryCard key={e.id} entry={e} onDelete={onDelete} />)}

        {!loading && hasOlder && (
          <div className="diary-more">
            <button className="diary-ghost-btn" onClick={onLoadOlder} disabled={loadingAll}>
              Carica mese precedente
            </button>
            {monthsLeft > 1 && (
              <button className="diary-link-btn" onClick={onLoadAll} disabled={loadingAll}>
                {loadingAll ? 'Carico…' : `Carica tutto (${monthsLeft} mesi)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DiaryEntryCard({ entry, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const long = entry.text.length > 260;

  return (
    <div className={`diary-entry${entry.sealed ? ' sealed' : ''}`}>
      <div className="diary-entry-head">
        <span className="diary-entry-date">{humanDate(entry.date)}</span>
        <span className="diary-entry-meta">
          {DIARY_TYPES[entry.type]?.icon} {DIARY_TYPES[entry.type]?.label}
          {entry.mood ? ` · umore ${entry.mood}/5` : ''}
          {entry.energy ? ` · energia ${entry.energy}/5` : ''}
          {entry.sealed ? ' · 🔒 cassetto' : ''}
        </span>
      </div>
      <div className={`diary-entry-text${long && !expanded ? ' clamped' : ''}`}>{entry.text}</div>
      {long && (
        <button className="diary-link-btn" onClick={() => setExpanded(x => !x)}>
          {expanded ? 'Riduci' : 'Leggi tutto'}
        </button>
      )}
      <PhotoStrip photos={entry.photos} />
      {entry.gratitude?.length > 0 && (
        <ul className="diary-gratitude">
          {entry.gratitude.map((g, i) => <li key={i}>{g}</li>)}
        </ul>
      )}
      <div className="diary-entry-foot">
        {entry.tags?.map(t => <span key={t} className="diary-tag static">#{t}</span>)}
        {confirming ? (
          <span className="diary-confirm">
            Eliminare per sempre?
            <button className="diary-link-btn danger" onClick={() => onDelete(entry)}>Sì</button>
            <button className="diary-link-btn" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <button className="diary-link-btn diary-entry-del" onClick={() => setConfirming(true)}>Elimina</button>
        )}
      </div>
    </div>
  );
}

// ── Foto ────────────────────────────────────────────────────────────────────
// Le voci conservano solo il nome del file; l'URL scaricabile si chiede a
// OneDrive alla prima visualizzazione e resta in cache per la sessione (vedi
// api.js). Finché non arriva si mostra un riquadro vuoto, non uno spinner:
// una griglia che pulsa mentre si rilegge il diario è rumore.
function DiaryPhotoImg({ photo, className, onClick }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getDiaryPhotoUrl(photo.name)
      .then(u => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [photo.name]);

  if (failed) return <div className={`${className} diary-photo-missing`} title="Foto non trovata su OneDrive">⃠</div>;
  if (!url) return <div className={`${className} diary-photo-loading`} />;
  return (
    <img
      className={className}
      src={url}
      alt={photo.caption || 'Foto del diario'}
      loading="lazy"
      onClick={onClick}
    />
  );
}

// Griglia di sole miniature per la timeline: il tocco apre la foto a schermo
// intero, dove la didascalia si legge per intero.
function PhotoStrip({ photos }) {
  const [openIndex, setOpenIndex] = useState(null);
  if (!photos?.length) return null;
  return (
    <>
      <div className="diary-photo-strip">
        {photos.map((p, i) => (
          <button key={p.name} className="diary-photo-thumb-btn" onClick={() => setOpenIndex(i)}>
            <DiaryPhotoImg photo={p} className="diary-photo-thumb" />
          </button>
        ))}
      </div>
      {openIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function PhotoLightbox({ photos, index, onIndex, onClose }) {
  const photo = photos[index];

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onClose]);

  return (
    <div className="diary-lightbox" onClick={onClose}>
      <button className="diary-lightbox-close" onClick={onClose}>✕</button>
      {index > 0 && (
        <button
          className="diary-lightbox-nav prev"
          onClick={e => { e.stopPropagation(); onIndex(index - 1); }}
        >‹</button>
      )}
      <figure className="diary-lightbox-figure" onClick={e => e.stopPropagation()}>
        <DiaryPhotoImg photo={photo} className="diary-lightbox-img" />
        {photo.caption?.trim() && <figcaption>{photo.caption}</figcaption>}
      </figure>
      {index < photos.length - 1 && (
        <button
          className="diary-lightbox-nav next"
          onClick={e => { e.stopPropagation(); onIndex(index + 1); }}
        >›</button>
      )}
    </div>
  );
}

// Selettore usato mentre si scrive: le foto partono verso OneDrive subito,
// non al salvataggio, così una voce lunga non finisce per aspettare l'upload
// nel momento in cui la si vuole solo chiudere. Il prezzo è che una voce
// abbandonata può lasciare file caricati: per questo "Lascia andare" e
// "Indietro" li ripuliscono.
function PhotoPicker({ photos, onChange, disabled }) {
  const [busy, setBusy] = useState(null);      // { done, total }
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function pick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';                        // permette di riscegliere lo stesso file
    if (!files.length) return;
    const room = MAX_PHOTOS_PER_ENTRY - photos.length;
    if (room <= 0) {
      setError(`Massimo ${MAX_PHOTOS_PER_ENTRY} foto per voce.`);
      return;
    }
    const chosen = files.slice(0, room);
    setError(files.length > room ? `Ne ho prese ${room}: il massimo è ${MAX_PHOTOS_PER_ENTRY} per voce.` : null);
    setBusy({ done: 0, total: chosen.length });
    const { photos: added, failed } = await addPhotos(chosen, (done, total) => setBusy({ done, total }));
    setBusy(null);
    if (added.length) onChange([...photos, ...added]);
    if (failed) setError(`${failed} ${failed === 1 ? 'foto non caricata' : 'foto non caricate'}. Riprova.`);
  }

  function removeAt(i) {
    const [gone] = photos.slice(i, i + 1);
    onChange(photos.filter((_, idx) => idx !== i));
    removePhotos([gone]);
  }

  function setCaption(i, caption) {
    onChange(photos.map((p, idx) => (idx === i ? { ...p, caption } : p)));
  }

  return (
    <div className="diary-photos">
      <div className="diary-photo-edit-grid">
        {photos.map((p, i) => (
          <div key={p.name} className="diary-photo-edit">
            <DiaryPhotoImg photo={p} className="diary-photo-thumb" />
            <button className="diary-photo-remove" onClick={() => removeAt(i)} title="Togli questa foto">✕</button>
            <input
              className="diary-photo-caption"
              placeholder="didascalia"
              value={p.caption || ''}
              onChange={e => setCaption(i, e.target.value)}
            />
          </div>
        ))}
        {photos.length < MAX_PHOTOS_PER_ENTRY && (
          <button
            className="diary-photo-add"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || !!busy}
          >
            {busy ? `${busy.done}/${busy.total}…` : '＋ foto'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={pick}
      />
      {error && <div className="diary-photo-error">{error}</div>}
    </div>
  );
}

// Andamento dell'umore degli ultimi 30 giorni: una riga sola, senza assi né
// numeri — serve a notare una deriva, non a misurarla.
function MoodTrend({ entries }) {
  const points = lastDays(entries, 30)
    .filter(e => e.mood && !e.sealed)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (points.length < 3) return null;

  const W = 260, H = 34;
  const step = W / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - ((p.mood - 1) / 4) * (H - 6) - 3).toFixed(1)}`)
    .join(' ');

  return (
    <div className="diary-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="diary-trend-label">umore · ultimi 30 giorni</span>
    </div>
  );
}

// ── Svuota testa / scrittura libera ─────────────────────────────────────────

const TIMER_CHOICES = [0, 5, 10];

function DiaryWriter({ type, initial, onSave, onCancel }) {
  // La scrittura libera è la pagina di chi sa già di cosa vuole parlare: solo
  // il campo di testo. Niente timer, niente domanda, niente sfumatura sulle
  // righe precedenti, correttore acceso — qui rileggere e correggere è
  // esattamente ciò che si vuole poter fare, al contrario dello svuota testa.
  const isRitual = type === 'svuota-testa';
  const [text, setText] = useState(initial?.text || '');
  const [photos, setPhotos] = useState(initial?.photos || []);
  const [minutes, setMinutes] = useState(0);
  const [left, setLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [seedListOpen, setSeedListOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const areaRef = useRef(null);
  // La domanda è un invito, non un compito: si sceglie dall'elenco (una che
  // funziona si vuole poter ritrovare), si può togliere, e comunque sbiadisce
  // da sola appena si inizia a scrivere.
  const [seed, setSeed] = useState(() => (isRitual ? seedForDate() : null));
  // Su iPhone la tastiera copre il fondo della pagina senza che il layout se ne
  // accorga: la finestra CSS resta alta come tutto lo schermo e i pulsanti
  // finiscono sotto i tasti. visualViewport è l'unica misura che tiene conto
  // della tastiera, quindi l'altezza della schermata di scrittura la segue.
  const [vvHeight, setVvHeight] = useState(() => window.visualViewport?.height || null);

  useEffect(() => { areaRef.current?.focus(); }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setVvHeight(vv.height);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  function chooseSeed(s) {
    setSeed(s);
    setSeedListOpen(false);
  }

  // Bozza salvata a intervalli, non a ogni tasto: scrivere di getto non deve
  // trascinarsi dietro una scrittura su localStorage per carattere.
  //
  // L'intervallo va acceso una volta e lasciato correre. Prima aveva `text`
  // fra le dipendenze, quindi ogni tasto lo spegneva e lo riaccendeva da capo:
  // i tre secondi ripartivano da zero a ogni lettera, e la bozza si salvava
  // solo se ci si fermava tre secondi buoni. Che è l'esatto contrario di come
  // si usa questa schermata — lo svuota testa chiede di scrivere senza
  // staccare per cinque o dieci minuti, ed erano cinque o dieci minuti senza
  // che niente venisse messo al sicuro. Le ultime parole scritte si leggono da
  // un ref, così l'intervallo non ha bisogno di ricominciare per vederle.
  const bozzaRef = useRef({ type, text, photos });
  useEffect(() => { bozzaRef.current = { type, text, photos }; }, [type, text, photos]);
  useEffect(() => {
    const id = setInterval(() => {
      const b = bozzaRef.current;
      if (b.text.trim() || b.photos.length) saveDraft(b);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!minutes) return;
    const id = setInterval(() => setLeft(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [minutes]);

  function chooseTimer(m) {
    setMinutes(m);
    setLeft(m * 60);
  }

  // Una voce di sole foto è legittima: a volte la giornata è un'immagine e
  // basta, e la didascalia arriva mesi dopo o mai.
  const empty = !text.trim() && !photos.length;

  async function finish(sealed) {
    if (empty) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(makeEntry({ type, text, seed, sealed, photos }));
    } catch {
      setError('Non sono riuscito a salvare. Il testo è ancora qui: riprova.');
      setSaving(false);
    }
  }

  function release() {
    // "Lascia andare": la voce non viene mai scritta su OneDrive. La bozza
    // locale si cancella subito, l'animazione è solo il tempo di respirare.
    // Le foto invece erano già state caricate mentre si scriveva: lasciar
    // andare deve portarsi via anche quelle, o il gesto sarebbe una bugia.
    clearDraft();
    removePhotos(photos);
    setReleasing(true);
    setTimeout(onCancel, 1400);
  }

  const timeUp = minutes > 0 && left === 0;

  return (
    <div
      className={`diary-writer${releasing ? ' releasing' : ''}`}
      style={vvHeight ? { height: vvHeight } : undefined}
    >
      <div className="diary-writer-top">
        <span className="diary-writer-mode">
          {DIARY_TYPES[type]?.icon} {DIARY_TYPES[type]?.label}
          {isRitual && (
            <button
              className={`diary-help-btn${helpOpen ? ' active' : ''}`}
              onClick={() => setHelpOpen(o => !o)}
              title="Come funziona e da dove viene"
            >come funziona</button>
          )}
        </span>
        {isRitual && (
          <div className="diary-writer-timer">
            {minutes > 0 && (
              <span className={`diary-countdown${timeUp ? ' done' : ''}`}>
                {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
              </span>
            )}
            {TIMER_CHOICES.map(m => (
              <button
                key={m}
                className={`diary-timer-btn${minutes === m ? ' active' : ''}`}
                onClick={() => chooseTimer(m)}
              >{m === 0 ? 'senza timer' : `${m} min`}</button>
            ))}
          </div>
        )}
      </div>

      {helpOpen && <MethodHelp onClose={() => setHelpOpen(false)} />}

      {seed && (
        <div className={`diary-seed${text.trim() && !seedListOpen ? ' faded' : ''}`}>
          <button
            className="diary-seed-text"
            onClick={() => setSeedListOpen(o => !o)}
            title="Scegli un'altra domanda"
          >
            {seed} <span className="diary-seed-caret">▾</span>
          </button>
          <button className="diary-seed-btn" onClick={() => setSeed(null)} title="Scrivi senza domanda">✕</button>
        </div>
      )}
      {isRitual && !seed && !seedListOpen && (
        <div className="diary-seed no-seed">
          <button className="diary-seed-btn" onClick={() => setSeedListOpen(true)}>
            scegli una domanda
          </button>
        </div>
      )}
      {seedListOpen && (
        <div className="diary-seed-list">
          {SEEDS.map(s => (
            <button
              key={s}
              className={`diary-seed-option${s === seed ? ' active' : ''}`}
              onClick={() => chooseSeed(s)}
            >{s}</button>
          ))}
        </div>
      )}

      <div className={`diary-writer-area${isRitual ? '' : ' plain'}`}>
        <textarea
          ref={areaRef}
          className="diary-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={isRitual
            ? 'Scrivi. Non rileggere, non correggere.'
            : 'Racconta.'}
          spellCheck={!isRitual}
        />
      </div>

      {/* Nello svuota testa le foto stanno sotto il foglio e non lo
          interrompono: lì il vincolo è la mano che non si ferma. */}
      <PhotoPicker photos={photos} onChange={setPhotos} disabled={saving} />

      {timeUp && <div className="diary-timeup">Il tempo è finito. Puoi fermarti quando vuoi.</div>}
      {error && <div className="diary-error">{error}</div>}

      <div className={`diary-writer-actions${confirmRelease ? ' confirming' : ''}`}>
        {confirmRelease ? (
          <>
            <span className="diary-release-q">Lasciare andare questo testo senza salvarlo?</span>
            <button className="diary-ghost-btn danger" onClick={release}>Sì, lascia andare</button>
            <button className="diary-link-btn" onClick={() => setConfirmRelease(false)}>Annulla</button>
          </>
        ) : (
          <>
            <button className="diary-link-btn" onClick={onCancel} disabled={saving}>Indietro</button>
            <button className="diary-link-btn" onClick={() => setConfirmRelease(true)} disabled={saving || empty}>
              Lascia andare
            </button>
            <button className="diary-ghost-btn" onClick={() => finish(true)} disabled={saving || empty}
              title="Salvata ma tenuta fuori dalla timeline e dall'export">
              Nel cassetto
            </button>
            <button className="diary-primary-btn" onClick={() => finish(false)} disabled={saving || empty}>
              {saving ? '…' : 'Conserva'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Pannello richiudibile con le istruzioni della pagina e le pratiche da cui
// arriva: chi scrive di getto per la prima volta merita di sapere perché gli
// si chiede di non correggere e perché c'è un timer.
function MethodHelp({ onClose }) {
  return (
    <div className="diary-help">
      <div className="diary-help-head">
        <span className="diary-help-title">Come funziona questa pagina</span>
        <button className="diary-seed-btn" onClick={onClose}>✕</button>
      </div>
      <ul className="diary-help-list">
        {SVUOTA_TESTA_METHOD.howTo.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
      <div className="diary-help-title">Da dove viene</div>
      {SVUOTA_TESTA_METHOD.sources.map(s => (
        <div key={s.title} className="diary-help-source">
          <div className="diary-help-source-title">{s.title}</div>
          <div className="diary-help-source-who">{s.who}</div>
          <div className="diary-help-source-what">{s.what}</div>
        </div>
      ))}
    </div>
  );
}

// ── Rituale della sera ──────────────────────────────────────────────────────

function EveningRitual({ onSave, onCancel }) {
  const [answers, setAnswers] = useState({ nutrito: '', svuotato: '', lascio: '' });
  const [gratitude, setGratitude] = useState(['', '', '']);
  const [photos, setPhotos] = useState([]);
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const filled = Object.values(answers).some(v => v.trim())
    || gratitude.some(g => g.trim())
    || photos.length > 0;

  function cancel() {
    removePhotos(photos);
    onCancel();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(makeEntry({
        type: 'sera',
        text: eveningText(answers),
        answers,
        gratitude,
        photos,
        mood,
        energy,
      }));
    } catch {
      setError('Non sono riuscito a salvare. Riprova.');
      setSaving(false);
    }
  }

  return (
    <div className="diary-panel diary-evening">
      <div className="diary-header">
        <span className="diary-title">🕯️ Rituale della sera</span>
        <button className="diary-close" onClick={cancel}>✕</button>
      </div>
      <div className="diary-body">
        {EVENING_QUESTIONS.map(q => (
          <div key={q.key} className="diary-field">
            <label className="diary-label">{q.label}</label>
            <textarea
              className="diary-input"
              rows={3}
              value={answers[q.key]}
              onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="diary-field">
          <label className="diary-label">Tre cose per cui sono grato</label>
          {gratitude.map((g, i) => (
            <input
              key={i}
              className="diary-input diary-input-line"
              value={g}
              onChange={e => setGratitude(prev => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
            />
          ))}
        </div>

        <div className="diary-field">
          <label className="diary-label">Le foto della giornata</label>
          <PhotoPicker photos={photos} onChange={setPhotos} disabled={saving} />
        </div>

        <Slider label="Umore" value={mood} labels={MOOD_LABELS} onChange={setMood} />
        <Slider label="Energia" value={energy} labels={ENERGY_LABELS} onChange={setEnergy} />

        {error && <div className="diary-error">{error}</div>}
        <div className="diary-writer-actions">
          <button className="diary-link-btn" onClick={cancel} disabled={saving}>Indietro</button>
          <button className="diary-primary-btn" onClick={handleSave} disabled={saving || !filled}>
            {saving ? '…' : 'Chiudi la giornata'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, labels, onChange }) {
  return (
    <div className="diary-field">
      <label className="diary-label">{label}: <span className="diary-slider-value">{labels[value]}</span></label>
      <input
        type="range" min="1" max="5" step="1"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="diary-slider"
      />
    </div>
  );
}

// Finestra piccola per registrare solo umore ed energia, senza dover
// scrivere: la stessa cosa che sta nel rituale della sera, ma raggiungibile
// in ogni momento della giornata invece che solo a fine giornata.
function QuickMoodModal({ onSave, onClose }) {
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(makeEntry({ type: 'stato', text: '', mood, energy }));
    } catch {
      setError('Non sono riuscito a salvare. Riprova.');
      setSaving(false);
    }
  }

  return (
    <div className="diary-quick-overlay" onClick={onClose}>
      <div className="diary-quick-modal" onClick={e => e.stopPropagation()}>
        <div className="diary-header">
          <span className="diary-title">🎚️ Umore ed energia</span>
          <button className="diary-close" onClick={onClose}>✕</button>
        </div>
        <div className="diary-body">
          <Slider label="Umore" value={mood} labels={MOOD_LABELS} onChange={setMood} />
          <Slider label="Energia" value={energy} labels={ENERGY_LABELS} onChange={setEnergy} />
          {error && <div className="diary-error">{error}</div>}
          <div className="diary-writer-actions">
            <button className="diary-link-btn" onClick={onClose} disabled={saving}>Annulla</button>
            <button className="diary-primary-btn" onClick={handleSave} disabled={saving}>
              {saving ? '…' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Export per l'AI ─────────────────────────────────────────────────────────

const PERIODS = [
  { id: 'today', label: 'Oggi', days: 1 },
  { id: '7',     label: '7 giorni', days: 7 },
  { id: '30',    label: '30 giorni', days: 30 },
  { id: 'all',   label: 'Tutto il caricato', days: null },
];

function AiExport({ entries, onBack }) {
  const [periodId, setPeriodId] = useState('7');
  const [presetId, setPresetId] = useState(AI_PRESETS[0].id);
  const [withBussola, setWithBussola] = useState(true);
  const [bussola, setBussola] = useState(null);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    if (!withBussola || bussola) return;
    loadIdentityDoc('bussola').then(setBussola).catch(() => setBussola(null));
  }, [withBussola, bussola]);

  const period = PERIODS.find(p => p.id === periodId);
  const preset = AI_PRESETS.find(p => p.id === presetId);
  const selected = useMemo(() => {
    const base = filterEntries(entries, {});   // il cassetto resta fuori dall'export
    return period.days ? lastDays(base, period.days) : base;
  }, [entries, period]);

  const markdown = useMemo(() => buildAiExport({
    entries: selected,
    preset,
    bussola: withBussola ? bussola : null,
    periodLabel: period.label.toLowerCase(),
  }), [selected, preset, withBussola, bussola, period]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard negata (permessi, contesto non sicuro): si seleziona il
      // testo così resta comunque un Ctrl+C di distanza.
      previewRef.current?.select();
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diario-${dateKey()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="diary-panel">
      <div className="diary-header">
        <span className="diary-title">Copia per l'AI</span>
        <button className="diary-close" onClick={onBack}>✕</button>
      </div>
      <div className="diary-body">
        <div className="diary-field">
          <label className="diary-label">Periodo</label>
          <div className="diary-chips">
            {PERIODS.map(p => (
              <button key={p.id} className={`diary-chip${periodId === p.id ? ' active' : ''}`} onClick={() => setPeriodId(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="diary-field">
          <label className="diary-label">Che tipo di risposta voglio</label>
          <div className="diary-chips">
            {AI_PRESETS.map(p => (
              <button key={p.id} className={`diary-chip${presetId === p.id ? ' active' : ''}`} onClick={() => setPresetId(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="diary-preset-ask">{preset.ask}</div>
        </div>

        <label className="diary-checkbox">
          <input type="checkbox" checked={withBussola} onChange={e => setWithBussola(e.target.checked)} />
          includi la Bussola (chi sono, cosa voglio)
        </label>

        <div className="diary-export-count">
          {selected.length} {selected.length === 1 ? 'voce' : 'voci'} · {markdown.length.toLocaleString('it-IT')} caratteri
        </div>

        <textarea ref={previewRef} className="diary-preview" value={markdown} readOnly spellCheck={false} />

        <div className="diary-writer-actions">
          <button className="diary-link-btn" onClick={onBack}>Indietro</button>
          <button className="diary-ghost-btn" onClick={download}>Scarica .md</button>
          <button className="diary-primary-btn" onClick={copy}>{copied ? 'Copiato ✓' : 'Copia negli appunti'}</button>
        </div>
        <div className="diary-privacy">
          Il diario resta sul tuo OneDrive: esce dal dispositivo solo quando sei tu a incollarlo.
        </div>
      </div>
    </div>
  );
}
