import { useState, useEffect } from 'react';
import { loadIdentityDoc, saveIdentityDoc } from './api';

const OCRA = '#c8a96e';

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
      content: `Voglio essere più felice
Voglio continuare a interrogarmi sui 100 desideri
Voglio dimostrare il mio amore per Sara
Voglio dedicare del tempo la sera alla scrittura
Voglio avere il controllo della mia testa e del mio corpo
Voglio avere un rapporto più vero con la mia famiglia
Voglio piacermi fisicamente ed essere in forma
Voglio costruire una bella famiglia
Voglio riempire il tempo che ho a disposizione per me
Voglio avere delle passioni con cui ritagliarmi uno spazio per me ogni giorno
Voglio essere utile per gli altri
Voglio essere un buon padre
Voglio piacermi come persona
Voglio dormire bene e svegliarmi con energia e entusiasmo
Voglio continuare ad andare a fondo in me stesso
Voglio appassionarmi al mio lavoro, trovare il modo di farlo più Mio
Voglio vivere il lavoro con meno ansia
Voglio riprendere a studiare
Voglio dare un senso alle mie giornate
Voglio riuscire a rimuovere odio, invidia e competizione per le altre persone
Voglio voler bene al prossimo
Voglio volermi bene, lo merito
Voglio amare la vita
Voglio sentirmi un adulto
Voglio avere più conoscenza in cucina
Voglio conoscere di più il territorio
Voglio conoscere i vini
Voglio avere un po' di cultura in più
Voglio informarmi con continuità sull'attualità
Voglio smetterla di preoccuparmi per il futuro finanziario
Voglio essere grato
Voglio andare in Thailandia
Voglio andare in America
Voglio avere un cane
Voglio avere un outfit vario che mi faccia sentire a mio agio
Voglio essere in forma
Voglio avere una casa
Voglio avere un giardino
Voglio avere un orto
Voglio cucinare al barbecue
Voglio saper nuotare
Voglio saper sciare`,
    },
    {
      title: 'COSA FACCIO PER ME',
      content: `camminare scalzo per scaricare,
isha krya,
shambavi,
yoga della sera,`,
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

function IconCompass() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={OCRA} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={OCRA} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export default function IdentityPanel() {
  const [open, setOpen] = useState(null); // null | 'bussola' | 'visione'
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
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
      return;
    }
    setLoading(true);
    loadIdentityDoc(open)
      .then(data => {
        setDoc(data || (open === 'bussola' ? DEFAULT_BUSSOLA : DEFAULT_VISIONE));
      })
      .catch(() => {
        setDoc(open === 'bussola' ? DEFAULT_BUSSOLA : DEFAULT_VISIONE);
      })
      .finally(() => setLoading(false));
  }, [open]);

  function handleClose() {
    setOpen(null);
    setEditing(false);
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
      await saveIdentityDoc(open, draft);
      setDoc(draft);
      setEditing(false);
      setDraft(null);
    } catch (e) {
      setSaveError('Errore durante il salvataggio. Riprova.');
    } finally {
      setSaving(false);
    }
  }

  const modalTitle = open === 'bussola' ? 'La Bussola' : 'La Visione';

  return (
    <>
      {/* Fixed center orb */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
        pointerEvents: 'none',
      }}>
        <div style={{
          width: 68,
          height: 68,
          borderRadius: '50%',
          border: `1.5px solid ${OCRA}`,
          background: 'rgba(8, 9, 16, 0.82)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          pointerEvents: 'all',
          boxShadow: `0 0 18px 2px ${OCRA}22`,
        }}>
          <button
            onClick={() => setOpen('bussola')}
            title="La Bussola — Chi sono"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 1, opacity: 0.9, transition: 'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0.9}
          >
            <IconCompass />
          </button>
          <div style={{ width: 28, height: 1, background: `${OCRA}44` }} />
          <button
            onClick={() => setOpen('visione')}
            title="La Visione"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 1, opacity: 0.9, transition: 'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0.9}
          >
            <IconEye />
          </button>
        </div>
      </div>

      {/* Modal overlay */}
      {open && (
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
            boxShadow: `0 8px 48px rgba(0,0,0,0.6)`,
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
                  <button
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
              ) : editing ? (
                <>
                  {(draft?.sections || []).map((section, i) => (
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
                          border: `1px solid #2a2d3a`, borderRadius: 7,
                          color: '#c4c4cc', fontSize: 13, lineHeight: 1.75,
                          padding: '10px 13px', resize: 'vertical', outline: 'none',
                          fontFamily: 'inherit', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}
                  {saveError && (
                    <div style={{ color: '#e07070', fontSize: 12, marginTop: -10, marginBottom: 10 }}>
                      {saveError}
                    </div>
                  )}
                </>
              ) : (
                (doc?.sections || []).map((section, i) => (
                  <div key={i} style={{ marginBottom: 30 }}>
                    <div style={{
                      color: OCRA, fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
                    }}>
                      {section.title}
                    </div>
                    {section.content ? (
                      <div style={{ color: '#c0c0c8', fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {section.content}
                      </div>
                    ) : (
                      <div style={{ color: '#3a3d4a', fontSize: 13, fontStyle: 'italic' }}>
                        Ancora vuoto — clicca la matita per aggiungere contenuto.
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
