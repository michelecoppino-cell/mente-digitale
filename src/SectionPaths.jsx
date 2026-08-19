// @ts-check
// «Percorsi» — la colonna della scheda sezione in cui stanno le cartelle, i
// dischi di rete e i link di un progetto.
//
// Prima era il riquadro OneDrive: una riga per link, ognuna con quattro
// bottoncini, in colonna. Con dodici percorsi la colonna diventava un elenco
// da scorrere, e per copiare un percorso bisognava trovare il quadratino
// giusto in fondo alla riga. Qui sono pastiglie: quattro per riga, il clic
// sulla pastiglia è il gesto (copia il percorso, o apre il collegamento se è
// OneDrive), e la matita è una sola per tutta la colonna.
import { useEffect, useRef, useState } from 'react';
import {
  CAT_DEFAULT, CAT_DRIVE, KNOWN_CATS,
  categoriesOf, copyToClipboard, loadLocalLinks, normalizeLinks, opensLink,
  persistSectionLinks, saveLocalLinks, serializeLink,
} from './odLinks';
import { loadODLinksFromCloud } from './api';

/** Quanto resta accesa la pastiglia dopo un clic, e quanto dura il messaggio
 *  in fondo allo schermo. */
const FLASH_MS = 900;
const TOAST_MS = 1600;

/** L'icona della pastiglia: nuvola per OneDrive, mondo per il web, cartella
 *  per tutto il resto. Sono i tre posti in cui può stare un percorso. */
function pillIcon(/** @type {import('./odLinks').PathLink} */ p) {
  if (p.cats.includes(CAT_DRIVE)) return '☁';
  if (p.cats.includes('Web')) return '⊕';
  return '🗀';
}

/** La riga di aiuto accanto al nome della categoria: dice cosa succede al clic
 *  prima che si clicchi, invece di lasciarlo scoprire. */
function catHint(/** @type {string} */ cat) {
  return opensLink([cat]) ? 'clic = apre il collegamento' : 'clic = copia percorso';
}

/**
 * @param {Object} props
 * @param {string} props.sectionId
 */
export default function SectionPaths({ sectionId }) {
  const [store, setStore] = useState(loadLocalLinks);
  const [editing, setEditing] = useState(false);
  // La bozza della modifica: mentre si scrive i percorsi stanno qui e non
  // nell'archivio. Salvare a ogni tasto vorrebbe dire una scrittura su OneDrive
  // per lettera battuta — la riga va sul cloud quando il campo perde il fuoco.
  const [draft, setDraft] = useState(/** @type {import('./odLinks').PathLink[]|null} */ (null));
  const [syncing, setSyncing] = useState(false);
  const [flashed, setFlashed] = useState(/** @type {number|null} */ (null));
  const [toast, setToast] = useState('');
  const [newCatFor, setNewCatFor] = useState(/** @type {number|null} */ (null));
  const flashTimer = useRef(/** @type {any} */ (null));
  const toastTimer = useRef(/** @type {any} */ (null));

  useEffect(() => {
    loadODLinksFromCloud()
      .then(cloud => { if (cloud && typeof cloud === 'object') { setStore(cloud); saveLocalLinks(cloud); } })
      .catch(e => console.error('OD links sync', e));
  }, []);

  // I timer della conferma sono legati al componente, non al percorso: uscire
  // dalla sezione mentre una pastiglia è accesa lascerebbe un setState su un
  // componente smontato.
  useEffect(() => () => { clearTimeout(flashTimer.current); clearTimeout(toastTimer.current); }, []);

  const saved = normalizeLinks(store[sectionId]);
  const paths = editing && draft ? draft : saved;
  const cats = categoriesOf(paths);
  // In modifica servono anche le categorie note ma ancora vuote: sono le
  // caselle che si possono spuntare, e senza non si potrebbe mai riempirle.
  const editCats = [...new Set([...KNOWN_CATS, ...cats])];

  /** Scrive davvero: stato, disco e OneDrive.
   *  @param {import('./odLinks').PathLink[]} next */
  async function save(next) {
    setDraft(next);
    const record = next.map(serializeLink);
    setStore(s => ({ ...s, [sectionId]: record }));
    setSyncing(true);
    const merged = await persistSectionLinks(sectionId, record, { ...store, [sectionId]: record });
    setStore(merged);
    setSyncing(false);
  }

  function flash(/** @type {number} */ index, /** @type {string} */ message) {
    clearTimeout(flashTimer.current);
    clearTimeout(toastTimer.current);
    setFlashed(index);
    setToast(message);
    flashTimer.current = setTimeout(() => setFlashed(null), FLASH_MS);
    toastTimer.current = setTimeout(() => setToast(''), TOAST_MS);
  }

  async function handlePill(/** @type {import('./odLinks').PathLink} */ p, /** @type {number} */ index) {
    const target = p.link;
    if (!target) { flash(index, 'Questo percorso è vuoto'); return; }
    if (opensLink(p.cats)) {
      window.open(target, '_blank', 'noopener');
      flash(index, `Collegamento aperto · ${p.name}`);
      return;
    }
    const ok = await copyToClipboard(target);
    // Solo la copia riuscita si annuncia: un «copiato» su appunti vuoti è
    // peggio di nessun messaggio, perché fa incollare il nulla.
    if (ok) flash(index, `Percorso copiato · ${p.name}`);
    else setToast('Non sono riuscito a copiare');
  }

  /** Solo la bozza: quello che si sta scrivendo.
   *  @param {number} index @param {Partial<import('./odLinks').PathLink>} patchObj */
  function patch(index, patchObj) {
    setDraft(paths.map((p, i) => i === index ? { ...p, ...patchObj } : p));
  }

  /** La bozza diventa l'archivio. La chiama chi esce da un campo, e la
   *  chiamano le modifiche che non si battono a tastiera. */
  function commit(next = draft) {
    // Uscire da un campo senza averlo toccato non è una modifica: senza questo
    // controllo ogni giro di Tab scriverebbe di nuovo il file su OneDrive.
    // Il confronto è sul record da scrivere, non sulla bozza: è quello che
    // finirebbe sul file, e due bozze diverse possono dare lo stesso record.
    if (next && JSON.stringify(next.map(serializeLink)) !== JSON.stringify(saved.map(serializeLink))) save(next);
  }

  function toggleCat(/** @type {number} */ index, /** @type {string} */ cat) {
    const p = paths[index];
    const on = p.cats.includes(cat);
    const next = on ? p.cats.filter(c => c !== cat) : [...p.cats, cat];
    // Un percorso senza categorie non comparirebbe da nessuna parte: togliere
    // l'ultima lo farebbe sparire dalla vista senza cancellarlo.
    const cats = next.length ? next : [CAT_DEFAULT];
    commit(paths.map((p2, i) => i === index ? { ...p2, cats } : p2));
  }

  return (
    <>
      <div className="sv-col-head">
        <span className="eyebrow sv-col-label">Percorsi</span>
        {syncing && <span className="sv-col-sync" title="Sto salvando">↑</span>}
        {editing && <span className="sv-edit-note">modalità modifica</span>}
        <button
          className={`sv-icon-btn${editing ? ' active' : ''}`}
          onClick={() => {
            if (editing) { commit(); setEditing(false); setDraft(null); }
            else { setDraft(saved); setEditing(true); }
            setNewCatFor(null);
          }}
          aria-pressed={editing}
          title={editing ? 'Esci dalla modifica' : 'Modifica i percorsi'}>
          ✎
        </button>
      </div>

      <div className="sv-col-body">
        {!editing && paths.length === 0 && (
          <p className="sv-empty">Nessun percorso · apri la matita per aggiungerne</p>
        )}

        {/* ── Vista ──────────────────────────────────────────────────────
            Un gruppo per categoria, e un percorso che ne ha due compare in
            tutte e due: le categorie sono etichette, non cartelle. */}
        {!editing && cats.map(cat => {
          const items = paths
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.cats.includes(cat));
          if (!items.length) return null;
          return (
            <div className="sv-path-group" key={cat}>
              <div className="sv-path-group-head">
                <span className="sv-path-cat">{cat}</span>
                <span className="sv-path-hint">{catHint(cat)}</span>
                <span className="sv-path-rule" />
              </div>
              <div className="sv-pills">
                {items.map(({ p, i }) => (
                  <button
                    key={`${cat}-${i}`}
                    className={`sv-pill${flashed === i ? ' flashed' : ''}`}
                    title={p.link || 'Percorso vuoto'}
                    onClick={() => handlePill(p, i)}>
                    <span className="sv-pill-icon" aria-hidden="true">{pillIcon(p)}</span>
                    <span className="sv-pill-label">
                      {flashed === i ? (opensLink(p.cats) ? 'Aperto' : 'Copiato') : p.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* ── Modifica ───────────────────────────────────────────────────
            Una scheda per percorso: nome, indirizzo e categorie. L'indirizzo è
            uno: la categoria dice già se è un link da aprire o un percorso da
            copiare, e chiedere due campi voleva dire farne compilare uno a
            vuoto ogni volta. */}
        {editing && paths.map((p, i) => (
          <div className="sv-path-card" key={i}>
            <div className="sv-path-card-top">
              <input
                className="sv-path-input"
                value={p.name}
                placeholder="Titolo"
                onChange={e => patch(i, { name: e.target.value })}
                onBlur={() => commit()}
              />
              <button
                className="sv-path-del"
                title="Elimina percorso"
                onClick={() => save(paths.filter((_, k) => k !== i))}>
                🗑
              </button>
            </div>
            {/* Un campo solo: è la categoria a dire se questo indirizzo va
                aperto nel browser o copiato negli appunti. */}
            <input
              className="sv-path-input mono"
              value={p.link}
              placeholder={opensLink(p.cats) ? 'https://…' : 'S:\\Progetti\\… oppure \\\\nas\\…'}
              onChange={e => patch(i, { link: e.target.value })}
              onBlur={() => commit()}
            />
            <div className="sv-path-cats">
              {editCats.map(c => (
                <button
                  key={c}
                  className={`sv-cat-chip${p.cats.includes(c) ? ' on' : ''}`}
                  onClick={() => toggleCat(i, c)}>
                  {c}
                </button>
              ))}
              {newCatFor === i ? (
                <input
                  autoFocus
                  className="sv-cat-new"
                  placeholder="nuova categoria"
                  onBlur={() => setNewCatFor(null)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setNewCatFor(null);
                    if (e.key !== 'Enter') return;
                    const name = e.currentTarget.value.trim();
                    if (name && !p.cats.includes(name)) {
                      commit(paths.map((p2, k) => k === i ? { ...p2, cats: [...p2.cats, name] } : p2));
                    }
                    setNewCatFor(null);
                  }}
                />
              ) : (
                <button className="sv-cat-chip add" title="Nuova categoria" onClick={() => setNewCatFor(i)}>+</button>
              )}
            </div>
          </div>
        ))}

        {editing && (
          <>
            <button
              className="sv-path-add"
              onClick={() => save([...paths, { name: 'Nuovo percorso', link: '', url: null, urlPc: null, cats: [CAT_DEFAULT] }])}>
              + nuovo percorso
            </button>
            <button className="sv-path-done" onClick={() => { commit(); setEditing(false); setDraft(null); setNewCatFor(null); }}>Fine</button>
          </>
        )}
      </div>

      {toast && <div className="sv-toast" role="status">✓ {toast}</div>}
    </>
  );
}
