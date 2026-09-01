import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading, pill } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-ml');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Machine Learning — hybrid physics + GP residual endpoint model</div>
      <div class="thin-note" style="margin-bottom:8px;">The hybrid model = the SAME physics engine used on the Operator Console, plus a Gaussian-process residual head. Physics predicts, ML corrects, and gates itself off until it proves out-of-time improvement.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
        <div>
          <div class="slider-row"><div class="slider-label">Train fraction</div><input type="range" id="ml-split" min="0.5" max="0.85" step="0.01" value="0.70"><div class="slider-val" id="ml-split-val">0.70</div></div>
          <div class="slider-row"><div class="slider-label">Live heats</div><input type="range" id="ml-n" min="20" max="80" step="1" value="40"><div class="slider-val" id="ml-n-val">40</div></div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" id="btn-ml-cached">Train on cached data</button>
          <button class="btn" id="btn-ml-live">Generate live (slow)</button>
        </div>
      </div>
      <div id="ml-pill" style="margin-bottom:8px;"></div>
      <div class="kpi-grid" id="ml-kpis"></div>
      <div id="ml-chart" style="margin-top:8px; background:#0f1418; border:1px solid #232c33; min-height:380px;"></div>`;

    ['ml-split','ml-n'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => document.getElementById(id+'-val').textContent = parseFloat(el.value).toFixed(id==='ml-n'?0:2));
    });
    document.getElementById('btn-ml-cached').addEventListener('click', () => runMl(false));
    document.getElementById('btn-ml-live').addEventListener('click', () => runMl(true));
    initialized = true;
  }
  if (!state.mlResult) runMl(false);
  else renderMl(state.mlResult);
}

async function runMl(live) {
  showLoading(true);
  try {
    const split = parseFloat(document.getElementById('ml-split').value);
    const n = parseInt(document.getElementById('ml-n').value);
    const res = live
      ? await api.mlGenerate({plant: state.plant, split_frac: split, n_heats: n})
      : await api.mlTrain({plant: state.plant, split_frac: split, use_cached: true});
    state.mlResult = res;
    renderMl(res);
  } catch (e) {
    document.getElementById('ml-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderMl(res) {
  const m = res.metrics || {};
  const kind = m.ml_T_active ? 'ok' : 'warn';
  const pillText = `maturity: ${m.maturity||'—'} · T-ML ${m.ml_T_active?'active':'gated off'} · C-ML ${m.ml_C_active?'active':'gated off'} (${m.n_train||0} train / ${m.n_test||0} test)`;
  document.getElementById('ml-pill').innerHTML = pill(pillText, kind);

  const fmt = x => (x != null && !isNaN(x)) ? x.toFixed(0) : '—';
  document.getElementById('ml-kpis').innerHTML = [
    kpi('T hit ±15°C', fmt(m.T_hit_15C)+'%', `phys ${fmt(m.T_hit_15C_phys)}%`),
    kpi('T MAE °C', m.T_MAE_C?.toFixed(1) || '—', 'hybrid'),
    kpi('C hit ±0.02%', fmt(m.C_hit_002)+'%', `phys ${fmt(m.C_hit_002_phys)}%`),
    kpi('C MAE %', m.C_MAE?.toFixed(3) || '—', 'hybrid'),
  ].join('');

  const p = res.pred || [];
  if (!p.length) return;
  const dark = {gridcolor:'#20262c', zeroline:false, color:'#9aa4af'};
  const allT = [...p.map(r=>r.T_true_C), ...p.map(r=>r.T_pred_C), ...p.map(r=>r.T_phys_C)].filter(v=>v!=null);
  const lo = Math.min(...allT)-10, hi = Math.max(...allT)+10;

  const traces = [
    // Panel 1: Scatter predicted vs actual
    {x:[lo,hi], y:[lo,hi], mode:'lines', line:{color:'#9aa4af',dash:'dash'}, showlegend:false, xaxis:'x1', yaxis:'y1'},
    {x:p.map(r=>r.T_true_C), y:p.map(r=>r.T_phys_C), mode:'markers', marker:{color:'#8792a0',symbol:'x',size:8}, name:'physics', xaxis:'x1', yaxis:'y1'},
    {x:p.map(r=>r.T_true_C), y:p.map(r=>r.T_pred_C), mode:'markers', marker:{color:'#ff6a34',size:9}, name:'hybrid', xaxis:'x1', yaxis:'y1'},
    // Panel 2: Bar errors
    {type:'bar', x:p.map(r=>r.heat-0.2), y:p.map(r=>r.T_pred_C-r.T_true_C), width:0.4, marker:{color:'#ff6a34'}, name:'hybrid', xaxis:'x2', yaxis:'y2'},
    {type:'bar', x:p.map(r=>r.heat+0.2), y:p.map(r=>r.T_phys_C-r.T_true_C), width:0.4, marker:{color:'#8792a0'}, name:'physics', xaxis:'x2', yaxis:'y2'},
    {x:[p[0]?.heat, p[p.length-1]?.heat], y:[-15,-15], fill:'tonexty', fillcolor:'rgba(51,209,122,0.08)', line:{width:0}, showlegend:false, xaxis:'x2', yaxis:'y2', y0:15},
  ];

  const layout = {
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
    font:{family:'Segoe UI,Arial',size:10,color:'#c6ccd4'},
    margin:{l:50,r:30,t:30,b:38},
    height:380,
    grid:{rows:1, columns:2, pattern:'independent'},
    xaxis:{...dark, title:{text:'actual °C',font:{size:9}}},
    xaxis2:{...dark, title:{text:'test heat',font:{size:9}}},
    yaxis:{...dark, title:{text:'predicted °C',font:{size:9}}},
    yaxis2:{...dark, title:{text:'pred − actual °C',font:{size:9}}},
    legend:{orientation:'h', yanchor:'bottom', y:1.02, x:0, font:{size:9}, bgcolor:'rgba(0,0,0,0)'},
    annotations:[
      {text:'Temperature — predicted vs actual', xref:'paper', yref:'paper', x:0.22, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
      {text:'Test-set temperature error', xref:'paper', yref:'paper', x:0.78, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
    ],
  };
  Plotly.newPlot('ml-chart', traces, layout, {responsive:true, displayModeBar:false});
}
