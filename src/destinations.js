// @ts-check
// Le destinazioni del menù, in un file loro.
//
// Stavano dentro AppShell.jsx, che è il posto naturale finché a leggerle c'è
// solo il rail. Da quando le legge anche la tastiera dei comandi (⌘K) servono a
// due componenti, e un file che esporta un componente non può esportare anche
// altro senza rompere il fast refresh di Vite — la stessa ragione per cui
// pomodoroContext.js sta separato da PomodoroSession.jsx.
//
// Finanze sta in fondo e vale per una voce sola: dentro ha sette schede (saldo,
// spese, tasse, fatture…) che vivono in una barra propria, non qui — portarle nel
// rail avrebbe raddoppiato il menù principale per una parte sola dell'app.

/** @typedef {{ to: string, label: string, icon: string }} Destination */

/** @type {Destination[]} */
export const DESTINATIONS = [
  { to: '/oggi',     label: 'Oggi',     icon: 'sun' },
  { to: '/piano',    label: 'Piano',    icon: 'calendar' },
  { to: '/attivita', label: 'Attività', icon: 'check' },
  { to: '/sezioni',  label: 'Sezioni',  icon: 'book' },
  { to: '/diario',   label: 'Diario',   icon: 'candle' },
  { to: '/mappa',    label: 'Mappa',    icon: 'map' },
  { to: '/finanze',  label: 'Finanze',  icon: 'euro' },
];
