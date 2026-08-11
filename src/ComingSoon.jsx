// @ts-check
// Segnaposto delle destinazioni che il rail già espone ma la cui vista arriva
// più avanti nella riorganizzazione (Oggi, Sezioni).
//
// Esiste perché il menù nasce completo a sei voci: una voce che non porta da
// nessuna parte, o che porta a un'area bianca, è peggio di una che dice cosa
// ci sarà e dove andare intanto.
import { Link } from 'react-router-dom';
import './ComingSoon.css';

/**
 * @param {Object} props
 * @param {string} props.title
 * @param {string} props.description
 * @param {{ to: string, label: string }} [props.action]
 */
export default function ComingSoon({ title, description, action }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-card">
        <span className="eyebrow">In arrivo</span>
        <h1 className="coming-soon-title">{title}</h1>
        <p className="coming-soon-desc">{description}</p>
        {action && <Link className="coming-soon-action" to={action.to}>{action.label} →</Link>}
      </div>
    </div>
  );
}
