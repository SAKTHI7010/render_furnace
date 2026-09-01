import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-ekf');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Virtual Sensor — Extended Kalman Filter temperature estimator</div>
      <div class="thin-note" style="margin-bottom:8px;">Default result is pre-computed and loads instantly. A live run recomputes the Kalman filter (finite-difference Jacobians over 34 states ≈ 1 min).</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
        <div>
          <div class="slider-row"><div class="slider-label">True η electrical</div><input type="range" id="ekf-eta" min="0.8" max="1.0" step="0.01" value="0.90"><div class="slider-val" id="ekf-eta-val">0.90</div></div>
          <div class="slider-row"><div class="slider-label">True wall-loss scale</div><input type="range" id="ekf-ua" min="0.8" max="1.8" step="0.05" value="1.35"><div class="slider-val" id="ekf-ua-val">1.35</div></div>
          <div class="slider-row"><div class="slider-label">Immersion dips</div><input type="range" id="ekf-dips" min="1" max="6" step="1" value="3"><div class="slider-val" id="ekf-dips-val">3</div></div>
        </div>
        <button class="btn" id="btn-ekf-run">Run live (~1 min)</button>
      </div>
      <div class="kpi-grid" id="ekf-kpis"></div>
      <div id="ekf-chart" style="margin-top:8px; background:#0f1418; border:1px solid #232c33; min-height:380px;"></div>`;

    ['ekf-eta','ekf-ua','ekf-dips'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => document.getElementById(id+'-val').textContent = parseFloat(el.value).toFixed(id==='ekf-dips'?0:2));
    });
    document.getElementById('btn-ekf-run').addEventListener('click', () => runEkf(false));
    initialized = true;
  }
  if (!state.ekfResult) runEkf(true);
  else renderEkf(state.ekfResult);
}

async function runEkf(useCached) {
  showLoading(true);
  try {
    const res = await api.ekf({
      plant: state.plant,
      true_eta: parseFloat(document.getElementById('ekf-eta').value),
      true_UA_scale: parseFloat(document.getElementById('ekf-ua').value),
      n_dips: parseInt(document.getElementById('ekf-dips').value),
      use_cached: useCached,
    });
    state.ekfResult = res;
    renderEkf(res);
  } catch (e) {
    document.getElementById('ekf-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderEkf(res) {
  document.getElementById('ekf-kpis').innerHTML = [
    kpi('Final error °C', res.final_error_C != null ? `${res.final_error_C.toFixed(1)}` : '—', 'est − truth'),
    kpi('η̂ electrical', res.eta_final?.toFixed(3) || '—', 'converged'),
    kpi('σ_T end °C', res.sigma_end?.toFixed(1) || '—', 'uncertainty'),
    kpi('Dips used', res.n_dips?.toString() || '—', 'measurements'),
  ].join('');

  const dark = {gridcolor:'#20262c', zeroline:false, color:'#9aa4af'};
  const t = res.t_min || [];
  const sigma = res.sigma_T || [];

  const traces = [
    // Panel 1: Temperature - confidence band
    {x:[...t, ...t.slice().reverse()],
     y:[...sigma.map((s,i)=>(res.T_est_C[i]||0)+2*s), ...sigma.slice().reverse().map((s,i)=>(res.T_est_C[res.T_est_C.length-1-i]||0)-2*s)],
     fill:'toself', fillcolor:'rgba(255,106,52,0.15)', line:{width:0}, name:'±2σ confidence', xaxis:'x1', yaxis:'y1'},
    {x:t, y:res.T_true_C||[], name:'true (hidden)', line:{color:'#cfd6dd',width:2}, xaxis:'x1', yaxis:'y1'},
    {x:t, y:res.T_est_C||[], name:'EKF estimate', line:{color:'#ff6a34',width:2}, xaxis:'x1', yaxis:'y1'},
    {x:res.dip_t_min||[], y:res.dip_T_C||[], mode:'markers', marker:{color:'#4fa8d8',size:8,symbol:'diamond'}, name:'immersion dip', xaxis:'x1', yaxis:'y1'},
    // Panel 2: Parameters
    {x:res.theta_t_min||[], y:res.theta_eta||[], name:'η electrical', line:{color:'#ff6a34',width:1.5}, xaxis:'x2', yaxis:'y2'},
    {x:res.theta_t_min||[], y:res.theta_UA_scale||[], name:'UA wall-loss scale', line:{color:'#4fa8d8',width:1.5}, xaxis:'x2', yaxis:'y2'},
  ];

  const layout = {
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'#0f1418',
    font:{family:'Segoe UI,Arial',size:10,color:'#c6ccd4'},
    margin:{l:50,r:30,t:30,b:38},
    height:380,
    grid:{rows:1, columns:2, pattern:'independent'},
    xaxis:{...dark, title:{text:'Time (min)',font:{size:9}}},
    xaxis2:{...dark, title:{text:'Time (min)',font:{size:9}}},
    yaxis:{...dark, title:{text:'Temperature (°C)',font:{size:9}}},
    yaxis2:{...dark, title:{text:'Parameter value',font:{size:9}}},
    legend:{orientation:'h', yanchor:'bottom', y:1.02, x:0, font:{size:9}, bgcolor:'rgba(0,0,0,0)'},
    annotations:[
      {text:'Bath temperature — truth vs EKF estimate', xref:'paper', yref:'paper', x:0.22, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
      {text:'Tracked parameters converging to truth', xref:'paper', yref:'paper', x:0.78, y:1.01, showarrow:false, font:{color:'#e9edf0',size:10}},
    ],
  };
  Plotly.newPlot('ekf-chart', traces, layout, {responsive:true, displayModeBar:false});
}
