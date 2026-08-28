// @ts-check
// Shell di navigazione: rail a sinistra, topbar, e il contenuto della rotta
// corrente.
//
// Prima la navigazione era una manciata di booleani in App.jsx (plannerOpen,
// diaryOpen, scheduleOpen…): nessuna vista aveva un indirizzo, il tasto
// indietro usciva dall'app e ricaricando si tornava sempre alla mappa. Qui le
// destinazioni sono sei rotte vere.
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useMediaQuery } from './useMediaQuery';
import './AppShell.css';

/**
 * Le destinazioni del menù, nell'ordine in cui compaiono nel rail.
 *
 * Finanze sta in fondo e vale per una voce sola: dentro ha sette schede
 * (saldo, spese, tasse, fatture…) che vivono in una barra propria, non qui —
 * portarle nel rail avrebbe raddoppiato il menù principale per una parte sola
 * dell'app. Vedi finanze/FinanzeSection.tsx.
 */
const DESTINATIONS = [
  { to: '/oggi',     label: 'Oggi',     icon: 'sun' },
  { to: '/piano',    label: 'Piano',    icon: 'calendar' },
  { to: '/attivita', label: 'Attività', icon: 'check' },
  { to: '/sezioni',  label: 'Sezioni',  icon: 'book' },
  { to: '/diario',   label: 'Diario',   icon: 'candle' },
  { to: '/mappa',    label: 'Mappa',    icon: 'map' },
  { to: '/finanze',  label: 'Finanze',  icon: 'euro' },
];

const RAIL_COLLAPSED_KEY = 'md_rail_collapsed_v1';

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
    // Il simbolo dell'euro e non un portafoglio: un portafoglio a 17px è un
    // rettangolo arrotondato con una riga dentro, cioè il calendario di
    // «Piano». L'arco aperto con le due sbarre invece non somiglia a nulla
    // altro nel rail.
    case 'euro': return (
      <svg {...common}><path d="M17.4 6.9a6.6 6.6 0 1 0 0 10.2" /><path d="M4.6 10.6h8.2M4.6 13.4h8.2" /></svg>
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
      <svg {...common} strokeWidth={2}><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></svg>
    );
    default: return null;
  }
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
  const narrow = useMediaQuery('(max-width: 860px)');

  useEffect(() => { localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // Un solo comando, un solo handler: da telefono apre e chiude il drawer, da
  // desktop riduce e riespande il rail. Il bottone è disegnato due volte —
  // in testa al rail e in topbar — ma non se ne vede mai più di uno: quello
  // del rail è fuori schermo finché il drawer è chiuso, quello della topbar
  // sparisce sopra gli 860px.
  function toggleMenu() {
    if (narrow) setDrawerOpen(o => !o);
    else setCollapsed(c => !c);
  }

  const menuBtnTitle = narrow
    ? (drawerOpen ? 'Chiudi il menù' : 'Apri il menù')
    : (collapsed ? 'Espandi il menù' : 'Riduci il menù');

  return (
    <div className={`shell${collapsed ? ' rail-collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="shell-scrim" onClick={() => setDrawerOpen(false)} />

      <nav className="rail" aria-label="Navigazione principale">
        <button className="rail-menu tap-44" onClick={toggleMenu} title={menuBtnTitle}>
          <Icon name="menu" />
          <span className="rail-label">Menù</span>
        </button>

        {/* Da telefono la cattura non sta qui: è il comando che si usa più
            spesso di tutti, e seppellirlo nel drawer voleva dire tre tocchi
            (panino, Cattura, scrivi) per un gesto che dev'essere uno solo.
            Sopra gli 860px il rail è sempre a schermo e il posto è questo. */}
        {!narrow && (
          <button
            className="rail-capture"
            onClick={() => { onCapture(); setDrawerOpen(false); }}
            title="Cattura un pensiero (⌘N)">
            <Icon name="plus" />
            <span className="rail-label">Cattura</span>
            <kbd className="rail-kbd">⌘N</kbd>
          </button>
        )}

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

        {/* Nel piede resta solo Impostazioni: «Taccuini · PARA» portava alla
            stessa rotta della voce Mappa, e il commutatore Taccuini/PARA che
            preselezionava è già in topbar quando si è su /mappa. */}
        <div className="rail-foot">
          <button className="rail-item" onClick={() => { onOpenSettings?.(); setDrawerOpen(false); }} title="Impostazioni">
            <Icon name="settings" />
            <span className="rail-label">Impostazioni</span>
          </button>
        </div>
      </nav>

      <div className="shell-main">
        <header className="shell-topbar">
          <button className="shell-drawer-btn tap-44" onClick={toggleMenu} title={menuBtnTitle}>
            <Icon name="menu" />
          </button>

          {/* Il «+» del rail, portato in topbar da telefono: la cattura resta
              a un tocco anche quando il rail è chiuso nel drawer. */}
          {narrow && (
            <button
              className="shell-capture-btn tap-44"
              onClick={() => { onCapture(); setDrawerOpen(false); }}
              title="Cattura un pensiero">
              <Icon name="plus" />
            </button>
          )}

          <div className="shell-topbar-actions">{topbar}</div>
        </header>
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
