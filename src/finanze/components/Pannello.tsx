import type { ReactNode } from "react";

/**
 * Card richiudibile con tendina: usata per gli editor di scenari e
 * investimenti, che di default restano chiusi per non ingombrare la vista.
 */
export function Pannello({
  titolo,
  sottotitolo,
  extra,
  apertoDefault = false,
  children,
}: {
  titolo: string;
  sottotitolo?: string;
  /** Contenuto allineato a destra nell'intestazione, visibile anche da chiuso (es. un badge). */
  extra?: ReactNode;
  apertoDefault?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card pannello" open={apertoDefault}>
      <summary>
        <span className="pannello-freccia" aria-hidden="true">
          ▸
        </span>
        <span className="pannello-titolo-riga">
          <span>
            {titolo}
            {sottotitolo && <span className="muted pannello-sotto"> {sottotitolo}</span>}
          </span>
          {extra}
        </span>
      </summary>
      <div className="pannello-corpo">{children}</div>
    </details>
  );
}
