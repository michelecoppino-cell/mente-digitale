export default function KpiCard({ label, value, unit, sub, pct, color }) {
  const barColor = color || (
    pct == null ? 'var(--accent)' :
    pct >= 90 ? '#c07a7a' :
    pct >= 70 ? '#c8a96e' :
    '#86c07a'
  );

  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: barColor }}>
        {value != null ? value : '—'}
        {unit && <span className="kpi-unit"> {unit}</span>}
      </div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
      {pct != null && (
        <div className="kpi-bar-wrap">
          <div className="kpi-bar" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
        </div>
      )}
    </div>
  );
}
