import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading, pill } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-validation');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Validation — verified parameters &amp; live conservation</div>
      <div class="section-title-sm" style="margin-top:6px;">Parameter audit — verified against the literature (v0.5)</div>
      <div id="val-audit-table" style="overflow-x:auto; margin-bottom:12px;"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="section-title-sm" style="flex:1;">Live conservation check (fresh heat)</div>
        <button class="btn" id="btn-val-run">Re-run</button>
      </div>
      <div id="val-pills" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
      <div id="val-chart" style="background:#0f1418; border:1px solid #232c33; min-height:220px;"></div>`;

    document.getElementById('btn-val-run').addEventListener('click', () => runValidation(true));
    initialized = true;
  }
  if (!state.validationResult) runValidation(false);
  else renderValidation(state.validationResult);
}

async function runValidation(force) {
  if (!force && state.validationResult) { renderValidation(state.validationResult); return; }
  showLoading(true);
  try {
    const res = await api.validation({plant: state.plant});
    state.validationResult = res;
    renderValidation(res);
  } catch(e) {
    document.getElementById('val-pills').innerHTML = `<div style="color:#e5484d;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderValidation(res) {
  // Audit table
  const rows = res.audit_rows || [];
  let auditHtml = '<table><thead><tr><th>Quantity</th><th>In model</th><th>Literature</th><th>Source</th></tr></thead><tbody>';
  rows.forEach(r => {
    auditHtml += `<tr><td>${r[0]||r.quantity||'—'}</td><td>${r[1]||r.in_model||'—'}</td><td>${r[2]||r.literature||'—'}</td><td>${r[3]||r.source||'—'}</td></tr>`;
  });
  auditHtml += '</tbody></table>';
  document.getElementById('val-audit-table').innerHTML = auditHtml;

  // Pill status
  const aim = res.aim_C || 0;
  const pills = [
    [`element ledger ${(res.ledger_pct||0).toFixed(2)}% < 1%`, (res.ledger_ok || res.ledger_pct < 1) ? 'ok' : 'warn'],
    [`first-law ${res.closure_pct != null ? `${res.closure_pct.toFixed(1)}%` : '—'}`, (res.closure_ok || Math.abs(res.closure_pct||0) < 5) ? 'ok' : 'warn'],
    [`endpoint ${(res.endpoint_C||0).toFixed(0)}°C`, res.on_aim ? 'ok' : 'warn'],
    [`undissolved ${(res.undissolved_kg||0).toFixed(0)} kg`, (res.undissolved_kg||0) < 5 ? 'ok' : 'warn'],
  ];
  document.getElementById('val-pills').innerHTML = pills.map(([t,k]) => pill(t,k)).join('');

  // Ledger bar chart
  const ldf = res.ledger_df || [];
  if (ldf.length) {
    const cols = Object.keys(ldf[0]);
    const idCol = cols.includes('element') ? 'element' : cols[0];
    const valCol = cols.includes('closure_pct') ? 'closure_pct' : cols[1];

    const traces = [{
      type: 'bar',
      x: ldf.map(r => r[idCol]),
      y: ldf.map(r => Math.abs(r[valCol]||0)),
      marker: {color: '#4fa8d8'},
      name: '|closure| %',
    }];
    const layout = {
      paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
      font:{family:'Segoe UI,Arial',size:10,color:'#c6ccd4'},
      margin:{l:50,r:20,t:30,b:38},
      height:220,
      xaxis:{gridcolor:'#20262c', zeroline:false, color:'#9aa4af'},
      yaxis:{gridcolor:'#20262c', zeroline:false, color:'#9aa4af', title:{text:'|closure| %',font:{size:9}}},
      title:{text:'Per-element mass-balance closure', font:{color:'#e9edf0',size:11}},
      shapes:[{type:'line', x0:-0.5, x1:ldf.length-0.5, y0:1, y1:1, line:{color:'#f0a83c',width:1,dash:'dash'}}],
    };
    Plotly.newPlot('val-chart', traces, layout, {responsive:true, displayModeBar:false});
  }
}
