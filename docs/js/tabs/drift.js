import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading, pill } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-drift');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Drift Monitor — PSI population stability index</div>
      <div class="thin-note" style="margin-bottom:8px;">A pre-computed dataset checks instantly. Live generation runs the same physics simulator and introduces a copper regime change at the selected heat.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
        <div>
          <div class="slider-row"><div class="slider-label">Live heats</div><input type="range" id="drift-n" min="30" max="80" step="1" value="50"><div class="slider-val" id="drift-n-val">50</div></div>
          <div class="slider-row"><div class="slider-label">Regime change at heat</div><input type="range" id="drift-reg" min="15" max="60" step="1" value="40"><div class="slider-val" id="drift-reg-val">40</div></div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="btn-drift-cached">Check cached data</button>
          <button class="btn" id="btn-drift-live">Generate live (slow)</button>
        </div>
      </div>
      <div id="drift-pill" style="margin-bottom:8px;"></div>
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);" id="drift-kpis"></div>
      <div id="drift-chart" style="margin-top:8px; background:#0f1418; border:1px solid #232c33; min-height:380px;"></div>`;

    ['drift-n','drift-reg'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => document.getElementById(id+'-val').textContent = el.value);
    });
    document.getElementById('btn-drift-cached').addEventListener('click', () => runDrift(false));
    document.getElementById('btn-drift-live').addEventListener('click', () => runDrift(true));
    initialized = true;
  }
  if (!state.driftResult) runDrift(false);
  else renderDrift(state.driftResult);
}

async function runDrift(live) {
  showLoading(true);
  try {
    const n = parseInt(document.getElementById('drift-n').value);
    const reg = parseInt(document.getElementById('drift-reg').value);
    const res = live
      ? await api.driftGenerate({plant: state.plant, n_heats: n, regime_change_at: reg})
      : await api.driftCached({plant: state.plant});
    state.driftResult = res;
    renderDrift(res);
  } catch (e) {
    document.getElementById('drift-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderDrift(res) {
  const alarmText = res.alarm
    ? 'DRIFT ALARM — ' + (res.reasons||[]).slice(0,2).join(', ')
    : 'stable — no significant drift';
  document.getElementById('drift-pill').innerHTML = pill(alarmText, res.alarm ? 'bad' : 'ok');

  document.getElementById('drift-kpis').innerHTML = [
    kpi('Max PSI', res.psi_max?.toFixed(2) || '—', '>0.25 shift · >0.5 major'),
    kpi('Reference heats', res.n_ref?.toString() || '—', 'baseline'),
    kpi('Recent heats', res.n_recent?.toString() || '—', 'checked'),
  ].join('');

  const psiTable = (res.psi_table || []).slice(0,12);
  const driftVals = res.dataset_values || [];
  const driftCol = res.dataset_col_name || 'feature';
  const regAt = res.regime_at || 40;

  const dark = {gridcolor:'#20262c', zeroline:false, color:'#9aa4af'};
  const psiColors = psiTable.map(r => r.PSI > 0.5 ? '#e5484d' : r.PSI > 0.25 ? '#f0a83c' : '#4fa8d8');

  const traces = [
    // Panel 1: PSI horizontal bar
    {type:'bar', orientation:'h',
     x:psiTable.map(r=>r.PSI), y:psiTable.map(r=>r.feature),
     marker:{color:psiColors}, name:'PSI', xaxis:'x1', yaxis:'y1'},
    // Panel 2: Drifted variable over heats
    {x:driftVals.map((_,i)=>i), y:driftVals, mode:'lines+markers',
     marker:{color:'#ff6a34',size:4}, line:{color:'#ff6a34',width:1.5},
     name:driftCol, xaxis:'x2', yaxis:'y2'},
  ];

  const layout = {
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
    font:{family:'Segoe UI,Arial',size:10,color:'#c6ccd4'},
    margin:{l:120,r:30,t:30,b:38},
    height:380,
    grid:{rows:1, columns:2, pattern:'independent'},
    xaxis:{...dark, title:{text:'PSI',font:{size:9}}},
    xaxis2:{...dark, title:{text:'heat number',font:{size:9}}},
    yaxis:{...dark, autorange:'reversed'},
    yaxis2:{...dark, title:{text:driftCol,font:{size:9}}},
    shapes:[
      {type:'line', x0:0.25, x1:0.25, y0:0, y1:1, yref:'paper', xref:'x1', line:{color:'#f0a83c',width:1,dash:'dash'}},
      {type:'line', x0:0.5, x1:0.5, y0:0, y1:1, yref:'paper', xref:'x1', line:{color:'#e5484d',width:1,dash:'dash'}},
      {type:'line', x0:regAt, x1:regAt, y0:0, y1:1, yref:'paper', xref:'x2', line:{color:'#e5484d',width:1,dash:'dot'}},
      {type:'rect', x0:0, x1:res.n_ref||20, y0:0, y1:1, yref:'paper', xref:'x2', fillcolor:'rgba(79,168,216,0.06)', line:{width:0}},
    ],
    legend:{orientation:'h', yanchor:'bottom', y:1.02, x:0, font:{size:9}, bgcolor:'rgba(0,0,0,0)'},
    annotations:[
      {text:'Population drift by feature (PSI)', xref:'paper', yref:'paper', x:0.22, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
      {text:'The variable that moved', xref:'paper', yref:'paper', x:0.78, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
    ],
  };
  Plotly.newPlot('drift-chart', traces, layout, {responsive:true, displayModeBar:false});
}
