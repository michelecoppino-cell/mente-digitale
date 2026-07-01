// Placeholder animato mostrato durante il caricamento (righe con shimmer)
export default function Skeleton({ rows = 3, height = 13 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton-row"
          style={{ height, width: `${88 - (i % 3) * 14}%` }}
        />
      ))}
    </div>
  );
}
