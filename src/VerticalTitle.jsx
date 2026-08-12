// Titolo ruotato (writing-mode verticale) di un blocco "alto" — usato nella
// colonna etichetta a sx di task, eventi e blocchi workbook, sia nella vista
// Giorno che nella Settimana. `layout` arriva da verticalTitleLayout in
// plannerGrid.js: su 2 righe passa da nowrap a wrap naturale, limitando la
// larghezza a due righe di testo verticale.
export default function VerticalTitle({ text, layout, className }) {
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
