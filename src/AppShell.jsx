// @ts-check
// Shell di navigazione: rail a sinistra, barra Pomodoro persistente, topbar,
// e il contenuto della rotta corrente.
//
// Prima la navigazione era una manciata di booleani in App.jsx (plannerOpen,
// diaryOpen, scheduleOpen…): nessuna vista aveva un indirizzo, il tasto
// indietro usciva dall'app e ricaricando si tornava sempre alla mappa. Qui le
// destinazioni sono sei rotte vere.
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { usePomodoro } from './pomodoroContext';
import './AppShell.css';

/** Le sei destinazioni del menù, nell'ordine in cui compaiono nel rail. */
const DESTINATIONS = [
  { to: '/oggi',     label: 'Oggi',     icon: 'sun' },
  { to: '/piano',    label: 'Piano',    icon: 'calendar' },
  { to: '/attivita', label: 'Attività', icon: 'check' },
  { to: '/sezioni',  label: 'Sezioni',  icon: 'book' },
  { to: '/diario',   label: 'Diario',   icon: 'candle' },
  { to: '/mappa',    label: 'Mappa',    icon: 'map' },
];

const RAIL_COLLAPSED_KEY = 'md_rail_collapsed_v1';

/** Sotto questa larghezza il rail è un drawer sopra il contenuto e non una
 *  colonna che gli ruba spazio. Va tenuta allineata alle media query di
 *  AppShell.css: è la stessa soglia, scritta una volta per il layout e una
 *  per il comportamento del panino. */
const DRAWER_QUERY = '(max-width: 860px)';

/** Vero finché la finestra soddisfa la media query, e aggiornato quando
 *  cambia — ruotare il telefono o allargare la finestra deve cambiare cosa fa
 *  il panino, non solo come è disegnato il rail. */
function useMediaQuery(/** @type {string} */ query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * Icone di linea, disegnate a mano: il riferimento di design chiede forme
 * vere e vieta esplicitamente le emoji nell'interfaccia.
 * @param {{ name: string }} props
 */
function Icon({ name }) {
  const common = {
    width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: /** @type {'round'} */ ('round'),
    strokeLinejoin: /** @type {'round'} */ ('round'),
  };
  switch (name) {
    case 'sun': return (
      <svg {...common}><circle cx="12" cy="12" r="4.2" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></svg>
    );
    case 'calendar': return (
      <svg {...common}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3.2v3.6M16 3.2v3.6" /></svg>
    );
    case 'check': return (
      <svg {...common}><path d="M3.5 6.2 5 7.7l3-3M3.5 12.2 5 13.7l3-3M3.5 18.2 5 19.7l3-3M11 6h9.5M11 12h9.5M11 18h9.5" /></svg>
    );
    case 'book': return (
      <svg {...common}><path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H20v15.2H6.2A2.2 2.2 0 0 0 4 20.4z" /><path d="M8 7.4h7M8 11h7" /></svg>
    );
    case 'candle': return (
      <svg {...common}><path d="M12 3.2c1.6 1.7 2.4 3 2.4 4a2.4 2.4 0 1 1-4.8 0c0-1 .8-2.3 2.4-4z" /><rect x="8.6" y="11.4" width="6.8" height="9.4" rx="1.6" /></svg>
    );
    case 'map': return (
      <svg {...common}><circle cx="12" cy="12" r="2.6" /><circle cx="5" cy="6" r="1.9" /><circle cx="19" cy="6.6" r="1.9" /><circle cx="6" cy="18.4" r="1.9" /><circle cx="18.4" cy="17.6" r="1.9" /><path d="M10.1 10.6 6.5 7.4M13.8 10.9l3.6-2.9M10.3 13.7l-2.9 3.2M13.9 13.5l3.1 2.7" /></svg>
    );
    // Cursori e non un ingranaggio: a 17px un ingranaggio è la stessa
    // macchia rotonda con raggi del sole di "Oggi", e nel rail le due voci
    // finivano indistinguibili col menù ridotto a sole icone.
    case 'settings': return (
      <svg {...common}><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" /><circle cx="15" cy="7.5" r="2.1" /><circle cx="9" cy="16.5" r="2.1" /></svg>
    );
    case 'plus': return (
      <svg {...common} strokeWidth={2}><path d="M12 5.5v13M5.5 12h13" /></svg>
    );
    case 'menu': return (
      <svg {...common} strokeWidth={1.9}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    );
    case 'more': return (
      <svg {...common} strokeWidth={2}><circle cx="5.5" cy="12" r=".6" /><circle cx="12" cy="12" r=".6" /><circle cx="18.5" cy="12" r=".6" /></svg>
    );
    case 'pause': return (
      <svg {...common} strokeWidth={2}><path d="M9.5 5.5v13M14.5 5.5v13" /></svg>
    );
    case 'play': return (
      <svg {...common}><path d="M8 5.4 18.5 12 8 18.6z" /></svg>
    );
    default: return null;
  }
}

/** mm:ss a partire dai millisecondi trascorsi. */
function fmtElapsed(/** @type {number} */ ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Frazione di sessione già trascorsa, da 0 a 1. */
function sessionPct(/** @type {{durationMin: number}} */ session, /** @type {number} */ elapsedMs) {
  return Math.min(1, elapsedMs / (session.durationMin * 60_000));
}

/**
 * Barra della sessione Pomodoro. Resta montata qui, sopra il contenuto, in
 * tutte le viste finché il timer gira, e riporta al workbook con un click.
 */
function PomodoroBar() {
  const { session, elapsedMs, pause, resume, stop } = usePomodoro();
  const navigate = useNavigate();
  if (!session) return null;

  const pct = sessionPct(session, elapsedMs);

  return (
    <div className="pomo-bar">
      <button
        className="pomo-bar-main"
        onClick={() => session.sectionId && navigate(`/sezioni/${session.sectionId}`)}
        disabled={!session.sectionId}
        title={session.sectionId ? 'Torna al workbook della sezione' : undefined}>
        <span
          className="pomo-bar-dial"
          style={/** @type {import('react').CSSProperties} */ ({ '--pomo-pct': `${pct * 360}deg` })} />
        <span className="pomo-bar-time">{fmtElapsed(elapsedMs)}</span>
        <span className="pomo-bar-task">{session.taskTitle || 'Sessione di concentrazione'}</span>
        <span className="pomo-bar-meta">
          {[
            session.sectionName,
            `avviata alle ${new Date(session.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`,
          ].filter(Boolean).join(' · ')}
        </span>
      </button>
      <div className="pomo-bar-actions">
        <button
          className="pomo-bar-btn"
          onClick={session.state === 'running' ? pause : resume}>
          {session.state === 'running' ? 'Pausa' : 'Riprendi'}
        </button>
        <button className="pomo-bar-btn primary" onClick={stop}>Chiudi e completa</button>
      </div>
    </div>
  );
}

/**
 * Sessione Pomodoro compressa in una riga di topbar: quadrante, tempo, titolo.
 * Serve alla fusione da telefono — la barra intera e la topbar assieme sono
 * 100px di cromo fisso, su uno schermo da 667 è un settimo dello schermo.
 */
function PomodoroInline() {
  const { session, elapsedMs } = usePomodoro();
  const navigate = useNavigate();
  if (!session) return null;

  return (
    <button
      className="shell-pomo-inline"
      onClick={() => session.sectionId && navigate(`/sezioni/${session.sectionId}`)}
      disabled={!session.sectionId}
      title={session.sectionId ? 'Torna al workbook della sezione' : undefined}>
      <span
        className="pomo-bar-dial"
        style={/** @type {import('react').CSSProperties} */ ({ '--pomo-pct': `${sessionPct(session, elapsedMs) * 360}deg` })} />
      <span className="pomo-bar-time">{fmtElapsed(elapsedMs)}</span>
      <span className="pomo-bar-task">{session.taskTitle || 'Sessione di concentrazione'}</span>
    </button>
  );
}

/**
 * @param {Object} props
 * @param {import('react').ReactNode} props.children      contenuto della rotta corrente
 * @param {import('react').ReactNode} [props.topbar]      azioni globali in alto a destra
 * @param {() => void} props.onCapture                    apre la cattura rapida (⌘N)
 * @param {() => void} [props.onOpenSettings]
 */
export default function AppShell({ children, topbar, onCapture, onOpenSettings }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_COLLAPSED_KEY) === '1');
  // Su schermo stretto il rail è un drawer sopra il contenuto, non una colonna
  // che gli ruba larghezza.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Il menù "⋯" è legato alla sessione che l'ha aperto, non a un booleano: se
  // la sessione finisce mentre è aperto, la topbar torna larga e il menù si
  // chiude da sé, senza riaprirsi a sorpresa sulla sessione successiva.
  const [actionsOpenFor, setActionsOpenFor] = useState(/** @type {string|null} */ (null));
  const narrow = useMediaQuery(DRAWER_QUERY);
  const { session, pause, resume, stop } = usePomodoro();

  useEffect(() => { localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // Da telefono, con il pomodoro in corso, topbar e barra della sessione si
  // fondono in una riga sola: il panino e il timer accanto, e le azioni
  // globali dietro il "⋯". Fuori da questo caso restano due righe distinte.
  const merged = narrow && !!session;
  const actionsOpen = merged && actionsOpenFor === session.startedAt;
  const closeActions = () => setActionsOpenFor(null);

  // Un solo comando per il menù, sempre nello stesso posto: da telefono apre e
  // chiude il drawer, da schermo grande alterna il rail fra etichette e sole
  // icone. Prima erano due bottoni diversi — un panino che su desktop non
  // compariva mai, e una freccetta `‹` in fondo al rail.
  function toggleMenu() {
    if (narrow) setDrawerOpen(o => !o);
    else setCollapsed(c => !c);
  }

  const menuTitle = narrow
    ? (drawerOpen ? 'Chiudi il menù' : 'Apri il menù')
    : (collapsed ? 'Espandi il menù' : 'Riduci il menù');

  return (
    <div className={`shell${collapsed ? ' rail-collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="shell-scrim" onClick={() => setDrawerOpen(false)} />

      <nav className="rail" aria-label="Navigazione principale">
        <button
          className="rail-menu tap-44"
          onClick={toggleMenu}
          aria-label={menuTitle}
          title={menuTitle}>
          <Icon name="menu" />
        </button>

        <button
          className="rail-capture"
          onClick={() => { onCapture(); setDrawerOpen(false); }}
          title="Cattura un pensiero (⌘N)">
          <Icon name="plus" />
          <span className="rail-label">Cattura</span>
          <kbd className="rail-kbd">⌘N</kbd>
        </button>

        <div className="rail-nav">
          {DESTINATIONS.map(d => (
            <NavLink
              key={d.to}
              to={d.to}
              className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}
              onClick={() => setDrawerOpen(false)}
              title={d.label}>
              <Icon name={d.icon} />
              <span className="rail-label">{d.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="rail-foot">
          <button className="rail-item" onClick={() => { onOpenSettings?.(); setDrawerOpen(false); }} title="Impostazioni">
            <Icon name="settings" />
            <span className="rail-label">Impostazioni</span>
          </button>
        </div>
      </nav>

      <div className="shell-main">
        {!merged && <PomodoroBar />}
        <header className={`shell-topbar${merged ? ' merged' : ''}`}>
          {/* Lo stesso comando del panino nel rail: da telefono il rail è
              fuori schermo, quindi qui c'è l'unico appiglio per aprirlo. */}
          <button
            className="shell-drawer-btn tap-44"
            onClick={toggleMenu}
            aria-label={menuTitle}
            title={menuTitle}>
            <Icon name="menu" />
          </button>

          {merged ? (
            <>
              <PomodoroInline />
              <div className="shell-pomo-actions">
                <button
                  className="shell-icon-btn tap-44"
                  onClick={session.state === 'running' ? pause : resume}
                  aria-label={session.state === 'running' ? 'Metti in pausa' : 'Riprendi'}
                  title={session.state === 'running' ? 'Pausa' : 'Riprendi'}>
                  <Icon name={session.state === 'running' ? 'pause' : 'play'} />
                </button>
                <button
                  className="shell-icon-btn tap-44"
                  onClick={() => setActionsOpenFor(open => open ? null : session.startedAt)}
                  aria-expanded={actionsOpen}
                  aria-label="Altre azioni"
                  title="Altre azioni">
                  <Icon name="more" />
                </button>
              </div>
              {actionsOpen && (
                <>
                  <div className="shell-more-scrim" onClick={closeActions} />
                  {/* Il click su una voce chiude il menù, tranne dentro la
                      campanella: quella apre il suo elenco lì dentro, e
                      chiudere il menù lo porterebbe via con sé. */}
                  <div
                    className="shell-more-panel"
                    onClick={e => {
                      if (!(e.target instanceof Element) || !e.target.closest('.bell-wrap')) closeActions();
                    }}>
                    <button
                      className="pomo-bar-btn primary"
                      onClick={() => { stop(); closeActions(); }}>
                      Chiudi e completa
                    </button>
                    <div className="shell-more-actions">{topbar}</div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="shell-topbar-actions">{topbar}</div>
          )}
        </header>
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
