// @ts-check
// Il titolo di un blocco scritto in verticale, nella colonna etichetta.
//
// Sta in un file suo e non insieme alle misure della griglia perché è un
// componente, e un file che esporta sia componenti sia costanti rompe il
// ricaricamento a caldo di Vite: quella regola di lint dice esattamente questo.

/** @param {{ text: string, layout: {fontSize: number, lines: number}|null, className?: string }} props */
export function VerticalTitle({ text, layout, className }) {
  if (!layout) return <span className={className}>{text}</span>;
  return (
    <span
      className={className}
      style={{
        fontSize: layout.fontSize,
        whiteSpace: layout.lines === 2 ? 'normal' : 'nowrap',
        width: layout.lines === 2 ? Math.ceil(layout.fontSize * 2.6) : undefined,
      }}>
      {text}
    </span>
  );
}
