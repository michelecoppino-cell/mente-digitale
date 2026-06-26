import { useState } from 'react';
import './Tab.css';

export default function TabAI({ commessa, analisi, onAnalisi, onSuggestTasks }) {
  const [analyzingStatus, setAnalyzingStatus]   = useState('idle');
  const [suggestingStatus, setSuggestingStatus] = useState('idle');
  const [reportStatus, setReportStatus]         = useState('idle');
  const [report, setReport]                     = useState(null);
  const [copied, setCopied]                     = useState(false);

  async function handleAnalyze() {
    setAnalyzingStatus('loading');
    try {
      const res = await fetch('/api/project-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'analyze', commessa }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      onAnalisi(data);
      setAnalyzingStatus('done');
    } catch (e) { setAnalyzingStatus('error'); alert('Errore analisi: ' + e.message); }
  }

  async function handleSuggest() {
    setSuggestingStatus('loading');
    try {
      const res = await fetch('/api/project-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'suggest-tasks', commessa }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSuggestingStatus('done');
      onSuggestTasks(data.suggerimenti || []);
    } catch (e) { setSuggestingStatus('error'); alert('Errore suggerimenti: ' + e.message); }
  }

  async function handleReport() {
    setReportStatus('loading');
    try {
      const res = await fetch('/api/project-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate-report', commessa, analisi }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setReport(data.report || '');
      setReportStatus('done');
    } catch (e) { setReportStatus('error'); alert('Errore report: ' + e.message); }
  }

  function copyReport() {
    navigator.clipboard.writeText(report || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="tab-root">
      <div className="ai-actions-row">
        <div className="ai-action-card">
          <div className="ai-action-icon">🔍</div>
          <div className="ai-action-info"><h4>Analizza Progetto</h4><p>Claude analizza KPI, MOM, elaborati e genera una valutazione di salute con semaforo e raccomandazioni.</p></div>
          <button className={`btn ${analyzingStatus === 'loading' ? 'btn-ghost' : 'btn-primary'}`} onClick={handleAnalyze} disabled={analyzingStatus === 'loading'}>
            {analyzingStatus === 'loading' ? 'Analisi…' : analyzingStatus === 'done' ? '↺ Rianalizza' : 'Analizza'}
          </button>
        </div>
        <div className="ai-action-card">
          <div className="ai-action-icon">✅</div>
          <div className="ai-action-info"><h4>Suggerisci Task</h4><p>Genera task concreti basati su action items aperti, elaborati pendenti e scadenze — da aggiungere a Microsoft To-Do.</p></div>
          <button className={`btn ${suggestingStatus === 'loading' ? 'btn-ghost' : 'btn-primary'}`} onClick={handleSuggest} disabled={suggestingStatus === 'loading'}>
            {suggestingStatus === 'loading' ? 'Generazione…' : 'Suggerisci Task'}
          </button>
        </div>
        <div className="ai-action-card">
          <div className="ai-action-icon">📄</div>
          <div className="ai-action-info"><h4>Genera Report</h4><p>Produce un report di stato in markdown pronto per essere condiviso o incollato in un documento.</p></div>
          <button className={`btn ${reportStatus === 'loading' ? 'btn-ghost' : 'btn-primary'}`} onClick={handleReport} disabled={reportStatus === 'loading'}>
            {reportStatus === 'loading' ? 'Generazione…' : 'Genera Report'}
          </button>
        </div>
      </div>
      {!commessa.todo_list_id && (
        <div className="ai-warning">⚠ Nessuna lista To-Do configurata per questa commessa. I task suggeriti non potranno essere salvati finché non viene creata la lista. Modifica la commessa per associarla.</div>
      )}
      {report && (
        <div className="ai-report">
          <div className="ai-report-header"><h4>Report di stato</h4><button className="btn btn-ghost btn-sm" onClick={copyReport}>{copied ? '✓ Copiato' : '📋 Copia'}</button></div>
          <pre className="ai-report-text">{report}</pre>
        </div>
      )}
      {analyzingStatus === 'done' && analisi && <div className="tab-hint" style={{ color: '#86c07a' }}>✓ Analisi completata — i risultati sono nel tab Dashboard.</div>}
    </div>
  );
}
