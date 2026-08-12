// Finestra pop-up centrata (overlay + box), montata fuori dalla tabella via
// portal per evitare HTML non valido (un div dentro un <tbody>/<tr>).

import { ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modale({
  titolo,
  onClose,
  children,
}: {
  titolo: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <div className="modale-overlay" onClick={onClose}>
      <div className="modale-box" onClick={(e) => e.stopPropagation()}>
        <div className="modale-header">
          <h3>{titolo}</h3>
          <button className="secondario" style={{ padding: "2px 8px" }} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
