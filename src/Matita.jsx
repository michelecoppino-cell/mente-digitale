// @ts-check
// La matita: la porta di un riquadro di «Oggi», accanto al titolo.
//
// Sta in un file suo e non dentro TodayView perché la usa anche
// SensitiveCard — l'involucro dei riquadri riservati — che TodayView importa
// a sua volta: tenerla di là voleva dire un anello fra i due moduli.
import { Link } from 'react-router-dom';

/** La matita: il segno che da qui si va a modificare. */
function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

/**
 * La porta di un riquadro: una matita accanto al titolo.
 *
 * Erano righe intere in fondo ai riquadri — «Cambia gli obiettivi →», «Apri la
 * coda →», «Registra una sessione →» — ocra, cioè della tinta che in questa
 * app vuol dire «qui si tocca». Cinque righe per dire cinque volte la stessa
 * cosa, e ognuna costava un'altezza a quello che il riquadro doveva mostrare.
 * La matita la dice in tredici pixel, nel punto in cui si sta già guardando
 * per capire di che riquadro si tratta, e il nome per esteso resta nel title e
 * in aria-label — non è un'icona da indovinare, è un'icona da riconoscere.
 * @param {{ onClick?: () => void, to?: string, title: string }} props
 */
export function Matita({ onClick, to, title }) {
  if (to) {
    return (
      <Link className="today-matita" to={to} title={title} aria-label={title}>
        <PencilIcon />
      </Link>
    );
  }
  return (
    <button type="button" className="today-matita" onClick={onClick} title={title} aria-label={title}>
      <PencilIcon />
    </button>
  );
}
