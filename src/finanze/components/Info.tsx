// Icona (i) premibile accanto ai valori calcolati: apre un popover che spiega
// la formula con i numeri reali, cosi' ogni valore dell'app e' verificabile.

import { ReactNode } from "react";

export function Info({ children }: { children: ReactNode }) {
  return (
    <details className="info">
      <summary aria-label="Come viene calcolato questo valore" title="Come viene calcolato">
        i
      </summary>
      <div className="info-pop">{children}</div>
    </details>
  );
}
