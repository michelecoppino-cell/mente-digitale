import { useState, useEffect } from 'react';
import { initAuth, getAccount, login } from './auth';
import { getNotebooks, getSections } from './api';
import MindMap from './MindMap';
import Panel from './Panel';
import { COLORS } from './config';
import './App.css';

export default function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [notebooks, setNotebooks] = useState([]);
  const [sectionsMap, setSectionsMap] = useState({});
  const [selected, setSelected] = useState(null);
  const [sync, setSync] = useState({ state: 'idle', label: 'Non connesso' });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    initAuth().then(() => {
      const acc = getAccount();
      setAccount(acc);
      setReady(true);
      if (acc) load();
    });
  }, []);

  async function handleLogin() {
    try {
      await login();
      setAccount(getAccount());
      load();
    } catch (e) { console.error(e); }
  }

  async function load() {
    setSync({ state: 'loading', label: 'Caricamento…' });
    try {
      const nbs = await getNotebooks();
      nbs.forEach((nb, i) => nb._color = COLORS[i % COLORS.length]);
      setNotebooks(nbs);
      setSync({ state: 'ok', label: `${nbs.length} taccuini · aggiornato ora` });
    } catch {
      setSync({ state: 'error', label: 'Errore caricamento' });
    }
  }

  async function handleExpandNotebook(nb) {
    if (sectionsMap[nb.id]) return;
    setSync({ state: 'loading', label: 'Caricamento sezioni…' });
    try {
      const sects = await getSections(nb.id);
      setSectionsMap(prev => ({ ...prev, [nb.id]: sects }));
      setSync({ state: 'ok', label: 'Aggiornato' });
    } catch {
      setSync({ state: 'error', label: 'Errore sezioni' });
    }
  }

  if (!ready) return null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="logo">Mente Digitale</h1>
          <span className="header-sub">OneNote · fase 1</span>
        </div>
        <div className="header-right">
          <div className="zoom-controls">
            <button className="zoom-btn" onClick={() => setZoom(z => Math.max(0.15, +(z - 0.2).toFixed(2)))}>−</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="zoom-btn" onClick={() => setZoom(z => Math.min(5, +(z + 0.2).toFixed(2)))}>+</button>
            <button className="zoom-btn" style={{fontSize:11,padding:'0 8px',width:'auto'}} onClick={() => setZoom(1)}>↺</button>
          </div>
          <div className="sync-status">
            <div className={`sync-dot ${sync.state}`} />
            <span>{sync.label}</span>
          </div>
        </div>
      </header>

      {!account ? (
        <div className="login-screen">
          <div className="login-card">
            <div className="login-title">Benvenuto</div>
            <div className="login-desc">
              Accedi con il tuo account Microsoft per caricare<br />
              i tuoi taccuini OneNote automaticamente.
            </div>
            <button className="login-btn" onClick={handleLogin}>
              <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Accedi con Microsoft
            </button>
            <div className="login-note">
              Solo permessi di lettura · nessun dato salvato
            </div>
          </div>
        </div>
      ) : (
        <div className="canvas-area">
          <MindMap
            notebooks={notebooks}
            sectionsMap={sectionsMap}
            onSelectNotebook={nb => setSelected({ type: 'notebook', data: nb, nb })}
            onSelectSection={(s, nb) => setSelected({ type: 'section', data: s, nb })}
            onExpandNotebook={handleExpandNotebook}
            externalZoom={zoom}
            onZoomChange={setZoom}
          />
          <Panel
            selected={selected}
            sectionsMap={sectionsMap}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}
