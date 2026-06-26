import KpiCard from '../../components/KpiCard';
import './Tab.css';

function calcKpi(commessa) {
  const c = commessa.contratto || {};
  const oreConsumate = (commessa.ore_segnate || []).reduce((s, r) => s + (r.ore || 0), 0);
  const budgetOre = c.budget_ore || 0;
  const importoTotale = c.importo_totale || 0;
  const fatturato = c.fatturato || 0;
  const tariffaOraria = c.tariffa_oraria_media || 0;
  const dataFine = c.data_fine ? new Date(c.data_fine) : null;
  const giorniRimasti = dataFine ? Math.ceil((dataFine - new Date()) / 86400000) : null;
  const aiAperti = (commessa.mom || []).flatMap(m => (m.action_items || []).filter(a => !a.completato));
  const aiScaduti = aiAperti.filter(ai => ai.scadenza && new Date(ai.scadenza) < new Date());
  const elaboratiPendenti = (commessa.elaborati || []).filter(e => e.stato !== 'emesso' && e.stato !== 'approvato').length;
  const elaboratiTotali = (commessa.elaborati || []).length;
  const costoEffettivo = oreConsumate * tariffaOraria;
  const burnRate = fatturato > 0 ? costoEffettivo / fatturato : null;
  return {
    oreConsumate, budgetOre,
    pctOre: budgetOre > 0 ? Math.round((oreConsumate / budgetOre) * 100) : null,
    fatturato, importoTotale,
    pctBudget: importoTotale > 0 ? Math.round((fatturato / importoTotale) * 100) : null,
    burnRate: burnRate ? Math.round(burnRate * 100) / 100 : null,
    aiAperti: aiAperti.length, aiScaduti: aiScaduti.length,
    elaboratiPendenti, elaboratiTotali, giorniRimasti,
  };
}

const SEMAFORO_COLOR = { verde: '#86c07a', giallo: '#c8a96e', rosso: '#c07a7a' };
const STATO_LABEL = { ok: 'OK', attenzione: 'Attenzione', critico: 'Critico' };
const STATO_COLOR = { ok: '#86c07a', attenzione: '#c8a96e', critico: '#c07a7a' };

export default function TabDashboard({ commessa, analisi }) {
  const kpi = calcKpi(commessa);
  return (
    <div className="tab-root">
      <div className="kpi-grid">
        <KpiCard label="Ore consumate" value={kpi.oreConsumate} unit={`/ ${kpi.budgetOre}h`} sub={kpi.pctOre != null ? `${kpi.pctOre}% del budget ore` : 'Budget ore non impostato'} pct={kpi.pctOre} />
        <KpiCard label="Fatturato" value={kpi.fatturato ? `€${kpi.fatturato.toLocaleString('it-IT')}` : '—'} sub={kpi.importoTotale ? `su €${kpi.importoTotale.toLocaleString('it-IT')} totali (${kpi.pctBudget ?? '?'}%)` : 'Importo non impostato'} pct={kpi.pctBudget} />
        <KpiCard label="Burn rate" value={kpi.burnRate != null ? kpi.burnRate.toFixed(2) : '—'} sub="(costo orario / €fatturato; 1.0 = in linea)" color={kpi.burnRate == null ? undefined : kpi.burnRate > 1.2 ? '#c07a7a' : kpi.burnRate < 0.8 ? '#c8a96e' : '#86c07a'} />
        <KpiCard label="Action items aperti" value={kpi.aiAperti} sub={kpi.aiScaduti > 0 ? `${kpi.aiScaduti} scaduti!` : 'Nessuno scaduto'} color={kpi.aiScaduti > 0 ? '#c07a7a' : kpi.aiAperti > 5 ? '#c8a96e' : undefined} />
        <KpiCard label="Elaborati pendenti" value={kpi.elaboratiPendenti} sub={`su ${kpi.elaboratiTotali} totali`} color={kpi.elaboratiPendenti > 3 ? '#c8a96e' : undefined} />
        <KpiCard label="Giorni alla scadenza" value={kpi.giorniRimasti != null ? kpi.giorniRimasti : '—'} sub={commessa.contratto?.data_fine ? `Scadenza: ${new Date(commessa.contratto.data_fine).toLocaleDateString('it-IT')}` : 'Data fine non impostata'} color={kpi.giorniRimasti == null ? undefined : kpi.giorniRimasti < 30 ? '#c07a7a' : kpi.giorniRimasti < 60 ? '#c8a96e' : undefined} />
      </div>
      {analisi && (
        <div className="ai-health">
          <div className="ai-health-header">
            <h3>Analisi AI</h3>
            <span className="badge semaforo-badge" style={{ background: (SEMAFORO_COLOR[analisi.semaforo] || '#888') + '33', color: SEMAFORO_COLOR[analisi.semaforo] || '#888' }}>
              {analisi.semaforo?.toUpperCase()} — {analisi.salute_globale}/100
            </span>
          </div>
          <p className="ai-sintesi">{analisi.sintesi}</p>
          <div className="ai-aree">
            {(analisi.aree || []).map((area, i) => (
              <div key={i} className="ai-area">
                <div className="ai-area-header">
                  <span className="ai-area-nome">{area.nome}</span>
                  <span className="badge" style={{ background: (STATO_COLOR[area.stato] || '#888') + '22', color: STATO_COLOR[area.stato] || '#888' }}>{STATO_LABEL[area.stato] || area.stato}</span>
                </div>
                <div className="ai-score-bar-wrap"><div className="ai-score-bar" style={{ width: `${area.score}%`, background: STATO_COLOR[area.stato] || '#888' }} /></div>
                {area.note && <p className="ai-area-note">{area.note}</p>}
              </div>
            ))}
          </div>
          {analisi.rischi?.length > 0 && <div className="ai-section"><h4>Rischi identificati</h4><ul>{analisi.rischi.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          {analisi.raccomandazioni?.length > 0 && <div className="ai-section"><h4>Raccomandazioni</h4><ul>{analisi.raccomandazioni.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        </div>
      )}
      {!analisi && <div className="tab-hint">Vai al tab <strong>❖ AI</strong> per analizzare questa commessa con Claude.</div>}
    </div>
  );
}
