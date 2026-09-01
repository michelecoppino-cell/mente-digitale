import { useState, useEffect, useMemo } from 'react';
import { loadIdentityDoc, saveIdentityDoc } from './api';
import { parseWishGroups, WISH_TITLE_RE } from './wishes';
import { qk, queryClient } from './queryClient';
import { useEscape } from './useEscape';

const OCRA = '#d4a44a';

const DEFAULT_BUSSOLA = {
  sections: [
    {
      title: 'CHI SONO',
      content: `Non ho certezza su cosa sia la vita, ma so certamente che merita di essere vissuta.
So che il frastuono di questa società mi scentra, per cui dare valore a questa vita, per viverla come merita, ho bisogno di ritornare a me stesso. Di seguito ciò che ritengo importante ricordare a me stessa

1. Le mie priorità sono
La prima è la famiglia, quella non la posso delegare...posso farmi aiutare dai nonni o dall'asilo ma è il centro della mia vita
La seconda sono io, se non funziono e non sono sereno/felice tutto il resto non funziona
La terza è il lavoro...se non funziono economicamente non tengo su la famiglia
La quarta è la crescita personale
La quinta è la socialità
La sesta è l'attività fisica

2. Accetto l'errore, credo sia demonizzato in questo mondo ma io mi permetto di sbagliare. Il mio obiettivo è molto avanti, e per arrivarci commetterò degli sbagli. Se ogni passo avrò timore di calpestare una mina non mi muoverò

3. L'inganno della felicità è l'idea di doverlo sempre cercare nel futuro. La felicità è un modo di vivere il presente. La chiave di questa felicità è la consapevolezza che la vita è una somma di istanti, ogni istante preso come frazione di secondo, è inevitabile. La felicità deriva dalla completa accettazione dell'istante che stai vivendo, tutto ciò che lo compone.
Con la felicità si fa tutto al meglio.

4. Voglio essere una madre per il mondo, non concentrarmi sulle differenze con chi ho a fianco, no alla competizione, no al prevalere. Posso comprendere tutti, non per sentirmi migliore di loro, ma per sentirmi loro fratello. Fra 100 anni nessuno di noi ci sarà e tutti col nostro vissuto ci indirizziamo verso la felicità.`,
    },
    {
      title: 'COSA VOGLIO',
      content: `── ESSERE ────────────────────────────

  · Essere più felice
  · Volermi bene — lo merito
  · Piacermi come persona
  · Sentirmi un adulto
  · Amare la vita
  · Essere grato
  · Rimuovere odio, invidia e competizione
  · Voler bene al prossimo
  · Essere utile per gli altri

── FAMIGLIA & RELAZIONI ──────────────

  · Costruire una bella famiglia
  · Essere un buon padre
  · Dimostrare il mio amore per Sara
  · Avere un rapporto più vero con la mia famiglia

── MENTE & CRESCITA ──────────────────

  · Continuare a interrogarmi sui 100 desideri
  · Andare a fondo in me stesso
  · Avere il controllo della mia testa e del mio corpo
  · Dare un senso alle mie giornate
  · Riprendere a studiare
  · Avere più cultura
  · Informarmi con continuità sull'attualità
  · Dedicare del tempo la sera alla scrittura

── LAVORO ────────────────────────────

  · Appassionarmi al lavoro, renderlo più Mio
  · Viverlo con meno ansia
  · Smettere di preoccuparmi per il futuro finanziario

── CORPO & BENESSERE ─────────────────

  · Piacermi fisicamente ed essere in forma
  · Dormire bene e svegliarmi con energia
  · Saper nuotare
  · Saper sciare

── VITA & SPAZIO ─────────────────────

  · Avere una casa con giardino e orto
  · Avere un cane
  · Cucinare al barbecue
  · Avere più conoscenza in cucina
  · Conoscere i vini
  · Conoscere meglio il territorio
  · Avere un outfit vario che mi faccia sentire a mio agio
  · Riempire il tempo libero con passioni mie

── SOGNI ─────────────────────────────

  · Andare in Thailandia
  · Andare in America`,
    },
    {
      title: 'COSA FACCIO PER ME',
      content: `Pratiche quotidiane per ritornare a me stesso:

  ◦ Camminare scalzo — per scaricare
  ◦ Isha Kriya
  ◦ Shambavi
  ◦ Yoga della sera`,
    },
  ],
};

const DEFAULT_VISIONE = {
  sections: [
    {
      title: 'LA VISIONE',
      content: '',
    },
  ],
};

function IconPencil() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/**
 * Bussola, Visione e i cento desideri.
 *
 * I desideri sono una sezione del documento della Bussola, non un file loro:
 * spostarli avrebbe voluto dire due file da tenere allineati, e l'esportazione
 * del Diario per l'AI legge la Bussola intera per dare contesto — dividerla le
 * avrebbe tolto metà del senso. Quello che cambia è la porta: «i cento
 * desideri» ha un bottone suo e si apre da solo, senza le altre due sezioni
 * intorno, perché è l'unica parte che si guarda tutti i giorni.
 *
 * @param {{ open: 'bussola'|'visione'|'desideri'|null, onClose: () => void }} props
 */
export default function IdentityPanel({ open, onClose }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open) {
      setDoc(null);
      setEditing(false);
      setDraft(null);
      setSaveError(null);
      setLoadFailed(false);
      return;
    }
    const quale = open === 'desideri' ? 'bussola' : open;
    // La copia dell'ultimo caricamento va in pagina subito: è la stessa cache
    // da cui «Oggi» pesca il desiderio del giorno, e senza questa riga il
    // pannello ripartiva da «Caricamento…» anche per un documento che sullo
    // schermo accanto era già scritto.
    const inCache = queryClient.getQueryData(qk.identita(quale));
    if (inCache) setDoc(inCache);
    setLoading(!inCache);
    setLoadFailed(false);
    loadIdentityDoc(quale)
      .then(data => {
        // null = file non ancora creato (404): i default sono un punto di
        // partenza legittimo. Un errore transitorio invece NON deve mostrare
        // i default: un "Salva" successivo sovrascriverebbe il documento vero.
        setDoc(data || (open === 'visione' ? DEFAULT_VISIONE : DEFAULT_BUSSOLA));
        if (data) queryClient.setQueryData(qk.identita(quale), data);
      })
      .catch(() => { if (!inCache) setLoadFailed(true); })
      .finally(() => setLoading(false));
  }, [open]);

  function handleClose() {
    setEditing(false);
    onClose();
  }

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(doc)));
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setSaveError(null);
  }

  function updateSection(i, field, value) {
    setDraft(prev => ({
      ...prev,
      sections: prev.sections.map((s, idx) => idx === i ? { ...s, [field]: value } : s),
    }));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Si salva sempre il documento intero, anche quando se ne stava
      // guardando una sezione sola: le altre sono nel draft, intatte.
      const quale = open === 'desideri' ? 'bussola' : open;
      await saveIdentityDoc(quale, draft);
      setDoc(draft);
      // Anche nella cache condivisa: è da lì che «Oggi» legge il desiderio del
      // giorno, e una Bussola salvata che sulla home resta quella di ieri è
      // una modifica che sembra non aver preso.
      queryClient.setQueryData(qk.identita(quale), draft);
      setEditing(false);
      setDraft(null);
    } catch {
      setSaveError('Errore durante il salvataggio. Riprova.');
    } finally {
      setSaving(false);
    }
  }

  const modalTitle = open === 'desideri' ? 'I cento desideri'
    : open === 'visione' ? 'La Visione'
    : 'La Bussola';

  // Quali sezioni del documento si vedono. Gli indici sono quelli veri: la
  // modifica scrive nel documento intero, così le sezioni che non si stanno
  // guardando non rischiano di sparire al salvataggio.
  const shown = useMemo(() => {
    const sections = (editing ? draft : doc)?.sections || [];
    return sections
      .map((/** @type {any} */ s, /** @type {number} */ i) => i)
      .filter((/** @type {number} */ i) => {
        const isWishes = WISH_TITLE_RE.test(sections[i].title || '');
        if (open === 'desideri') return isWishes;
        if (open === 'bussola') return !isWishes;
        return true;
      });
  }, [doc, draft, editing, open]);

  // Escape chiude. Non mentre si sta scrivendo: da lì si esce con «Annulla»,
  // che è una decisione, non un tasto premuto per sbaglio a metà di una frase.
  useEscape(!!open && !editing, handleClose);

  if (!open) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#0d0f17',
        border: `1px solid ${OCRA}3a`,
        borderRadius: 14,
        width: 'min(660px, 92vw)',
        maxHeight: '84vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 20px',
          borderBottom: `1px solid ${OCRA}28`,
          flexShrink: 0,
        }}>
          <span style={{ color: OCRA, fontSize: 14, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {modalTitle}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!editing ? (
              !loadFailed && doc && <button
                onClick={startEdit}
                title="Modifica"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: OCRA, opacity: 0.65, padding: '4px 6px', borderRadius: 6, transition: 'opacity .15s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0.65}
              >
                <IconPencil />
              </button>
            ) : (
              <>
                <button
                  onClick={cancelEdit}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '4px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  Annulla
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: OCRA, border: 'none', cursor: saving ? 'default' : 'pointer',
                    color: '#111', padding: '4px 14px', borderRadius: 6,
                    fontSize: 12, fontWeight: 700, opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? '…' : 'Salva'}
                </button>
              </>
            )}
            <button
              onClick={handleClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '4px 6px', fontSize: 17, lineHeight: 1, marginLeft: 4 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '22px 26px', flex: 1 }}>
          {loading ? (
            <div style={{ color: '#555', textAlign: 'center', padding: 48, fontSize: 13 }}>Caricamento…</div>
          ) : loadFailed ? (
            <div style={{ color: '#e07070', textAlign: 'center', padding: 48, fontSize: 13 }}>
              Errore nel caricamento del documento. Chiudi e riprova.
            </div>
          ) : editing ? (
            <>
              {shown.map(i => draft.sections[i]).map((section, n) => {
                const i = shown[n];
                return (
                <div key={i} style={{ marginBottom: 30 }}>
                  <input
                    value={section.title}
                    onChange={e => updateSection(i, 'title', e.target.value)}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: `1px solid ${OCRA}55`,
                      color: OCRA, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                      textTransform: 'uppercase', marginBottom: 10,
                      padding: '3px 0', outline: 'none', fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  <textarea
                    value={section.content}
                    onChange={e => updateSection(i, 'content', e.target.value)}
                    rows={Math.max(5, (section.content.match(/\n/g) || []).length + 2)}
                    style={{
                      width: '100%', background: '#13151f',
                      border: '1px solid #2a2d3a', borderRadius: 7,
                      color: '#c4c4cc', fontSize: 13, lineHeight: 1.75,
                      padding: '10px 13px', resize: 'vertical', outline: 'none',
                      fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                  />
                </div>
                );
              })}
              {saveError && (
                <div style={{ color: '#e07070', fontSize: 12, marginTop: -10, marginBottom: 10 }}>
                  {saveError}
                </div>
              )}
            </>
          ) : (
            shown.length === 0 ? (
              <div style={{ color: '#3a3d4a', fontSize: 13, fontStyle: 'italic', padding: '32px 0' }}>
                {open === 'desideri'
                  ? 'Nella Bussola non c\'è ancora una sezione «Cosa voglio».'
                  : 'Ancora vuoto — clicca la matita per aggiungere contenuto.'}
              </div>
            ) : (
              shown.map(i => {
                const section = doc.sections[i];
                return (
                  <div key={i} style={{ marginBottom: 30 }}>
                    {/* Nella vista dei soli desideri il titolo della sezione è
                        già quello del modale: ripeterlo sarebbe una riga persa
                        in cima a un elenco che è tutto quello che c'è. */}
                    {open !== 'desideri' && (
                      <div style={{
                        color: OCRA, fontSize: 11, fontWeight: 700,
                        letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
                      }}>
                        {section.title}
                      </div>
                    )}
                    {!section.content ? (
                      <div style={{ color: '#3a3d4a', fontSize: 13, fontStyle: 'italic' }}>
                        Ancora vuoto — clicca la matita per aggiungere contenuto.
                      </div>
                    ) : open === 'desideri' ? (
                      <WishList content={section.content} />
                    ) : (
                      <div style={{ color: '#c0c0c8', fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {section.content}
                      </div>
                    )}
                  </div>
                );
              })
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * I desideri come elenco, non come blocco di testo con dentro delle barre di
 * trattini. I gruppi li ha scritti lui nel documento: qui diventano
 * intestazioni vere, e il conteggio dice a che punto sono i cento.
 * @param {{ content: string }} props
 */
function WishList({ content }) {
  const groups = parseWishGroups(content);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <div style={{ color: '#6a6e7c', fontSize: 12, marginBottom: 22 }}>
        {total} {total === 1 ? 'desiderio scritto' : 'desideri scritti'}
        {total < 100 && ` · ne mancano ${100 - total} ai cento`}
      </div>
      {groups.map((g, i) => (
        <div key={i} style={{ marginBottom: g.title ? 24 : 0 }}>
          {g.title && (
            <div style={{
              color: OCRA, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', opacity: 0.75, marginBottom: 8,
            }}>
              {g.title}
            </div>
          )}
          {g.items.map((item, j) => (
            <div key={j} style={{
              display: 'flex', gap: 10, alignItems: 'baseline',
              color: '#c0c0c8', fontSize: 13, lineHeight: 1.7, padding: '3px 0',
            }}>
              <span style={{ color: OCRA, opacity: 0.5, flex: '0 0 auto' }}>·</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
