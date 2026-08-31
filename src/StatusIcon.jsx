// Le icone degli stati del flusso: un segno per ciascuno, lo stesso ovunque.
//
// Nascono per una ragione di larghezza. Le pastiglie della scheda di dettaglio
// portavano il nome per esteso — «Prossima azione», «Da chiedere», «In
// attesa», «Delegata», «Un giorno» — e sei parole in fila prendevano tre righe
// dentro una colonna larga trecento pixel. Il segno ci sta in una riga sola, e
// il nome resta a un passaggio del cursore (`title`).
//
// Sono disegni e non caratteri: ⏸ e ▶ cambiano faccia da un sistema all'altro
// — su qualcuno diventano emoji a colori, larghe il doppio — e una fila di
// pastiglie quadrate si sfalserebbe. Un SVG di 24×24 in `currentColor` prende
// il colore di chi lo contiene e resta identico dappertutto.
//
// @ts-check

/**
 * @param {Object} props
 * @param {string} props.status
 * @param {number} [props.size]
 * @param {string} [props.className]
 */
export default function StatusIcon({ status, size = 14, className = '' }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: /** @type {const} */ ('round'), strokeLinejoin: /** @type {const} */ ('round'),
    className: `status-icon${className ? ` ${className}` : ''}`,
    'aria-hidden': true,
  };
  switch (status) {
    // Prossima azione: il triangolo del play. È la sola che si può far partire
    // adesso, ed è l'unico segno che vuol dire «vai».
    case 'next':
      return <svg {...common}><path d="M7 4.5 19.5 12 7 19.5Z" fill="currentColor" stroke="none" /></svg>;
    // Programmata: un giorno e un'ora, cioè un calendario.
    case 'scheduled':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    // Da chiedere: il punto di domanda, che è letteralmente la cosa da fare.
    case 'ask':
      return (
        <svg {...common}>
          <path d="M8.7 8.6a3.4 3.4 0 1 1 4.6 3.2c-.9.4-1.3 1.1-1.3 2v.7" />
          <path d="M12 18.4v.1" strokeWidth="2.6" />
        </svg>
      );
    // In attesa: le due lineette della pausa. Non è ferma per sempre — è ferma
    // finché non si muove qualcun altro.
    case 'waiting':
      return (
        <svg {...common}>
          <path d="M9.5 5v14M14.5 5v14" strokeWidth="2.6" />
        </svg>
      );
    // Delegata: una persona. Il segno dice quello che dice lo stato — non è più
    // in mano tua.
    case 'delegated':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
        </svg>
      );
    // Un giorno: la nuvola del desiderio. Sta lì, non pesa, non ha una data.
    case 'someday':
      return (
        <svg {...common}>
          <path d="M7.5 18.5A4 4 0 0 1 7.8 10.6a5 5 0 0 1 9.5 1.1 3.7 3.7 0 0 1-.6 6.8Z" />
        </svg>
      );
    // Inbox: la vaschetta della posta in arrivo, con dentro la cosa appena
    // caduta.
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
          <path d="M5.8 5.5h12.4l2.3 8v5H3.5v-5Z" />
        </svg>
      );
    case 'done':
      return <svg {...common}><polyline points="4 12.5 9.5 18 20 6.5" strokeWidth="3" /></svg>;
    default:
      return null;
  }
}
