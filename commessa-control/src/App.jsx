import { useState, useEffect } from 'react';
import { initAuth, getAccount, login } from './auth';
import CommessaList from './views/CommessaList';
import CommessaDetail from './views/CommessaDetail';
import './App.css';

export default function App() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    initAuth().then(() => {
      setAccount(getAccount());
      setReady(true);
    });
  }, []);

  if (!ready) return <div className="app-loading">Caricamento…</div>;

  if (!account) {
    return (
      <div className="app-login">
        <div className="login-box">
          <div className="login-icon">📋</div>
          <h1>Commessa Control</h1>
          <p>Controllo tecnico e manageriale delle commesse</p>
          <button className="btn btn-primary" onClick={login}>
            Accedi con Microsoft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {selectedId ? (
        <CommessaDetail
          commessaId={selectedId}
          onBack={() => setSelectedId(null)}
          account={account}
        />
      ) : (
        <CommessaList
          onSelect={setSelectedId}
          account={account}
        />
      )}
    </div>
  );
}
