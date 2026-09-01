import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading } from '../main.js';
import { getHeatSpec } from './operator.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-physics');
  if (!initialized) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="section-title" style="flex:1;">Physics &amp; Energy — heat-flow audit</div>
        <button class="btn" id="btn-phys-run">↻ Use operator's heat</button>
      </div>
      <div class="kpi-grid" id="phys-kpis"></div>
      <div id="phys-chart" style="margin-top:8px; background:#0f1418; border:1px solid #232c33; min-height:520px;"></div>`;
    document.getElementById('btn-phys-run').addEventListener('click', () => runPhysics(true));
    initialized = true;
  }
  runPhysics(false);
}

async function runPhysics(force) {
  if (!force && state.physicsResult) { renderPhysics(state.physicsResult); return; }
  const spec = getHeatSpec();
  showLoading(true);
  try {
    const res = await api.physics({
      plant: state.plant,
      charge_t: spec.charge_t,
      power_kW: spec.power_kW,
      carbon_pct: spec.carbon_pct,
      copper_pct: spec.copper_pct,
      schedule: [],
    });
    state.physicsResult = res;
    renderPhysics(res);
  } catch (e) {
    document.getElementById('phys-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderPhysics(res) {
  const en = res.energy || {};
  const floor = res.floor_kWh_t || 0;
  const uf = (en.useful_fraction || 0) * 100;
  document.getElementById('phys-kpis').innerHTML = [
    kpi('Element ledger %', res.ledger_pct?.toFixed(2) ?? '—', 'worst species'),
    kpi('First-law closure %', en.residual_pct != null ? `${en.residual_pct > 0 ? '+' : ''}${en.residual_pct.toFixed(1)}%` : '—', 'in − out'),
    kpi('Final SEC', res.sec_kWh_t?.toFixed(0) ?? '—', `floor ${floor.toFixed(0)}`),
    kpi('Useful fraction %', uf.toFixed(0), 'of grid input'),
  ].join('');

  const frames = res.frames || [];
  if (!frames.length) return;
  const t = frames.map(f => f.t_min);
  const dark = { gridcolor: '#20262c', zeroline: false, color: '#9aa4af' };

  // --- Panel 1: Heat-flow breakdown through the heat ---
  const hfKeys = [
    ['Q_useful_kW', '#ff6a34', 'useful (to metal)'],
    ['Q_wall_kW',   '#a08a5a', 'lining loss'],
    ['Q_rad_kW',    '#e5484d', 'radiation'],
    ['Q_chem_kW',   '#33d17a', 'chemical'],
    ['Q_offgas_kW', '#4fa8d8', 'off-gas'],
  ];
  const hfTraces = hfKeys
    .filter(([k]) => frames[0]?.[k] != null)
    .map(([k, c, n]) => ({ x: t, y: frames.map(f => f[k]), name: n, line: { color: c, width: 1.4 }, xaxis: 'x1', yaxis: 'y1' }));

  // --- Panel 2: Energy split waterfall (grid → losses → to steel) ---
  const total = en.grid_kWh || frames[frames.length - 1]?.E_kWh || 0;
  const parts = [
    ['converter',  en.converter_loss_kWh || 0],
    ['coil water', en.coil_water_loss_kWh || 0],
    ['lining',     en.lining_loss_kWh    || 0],
    ['radiation',  en.radiation_loss_kWh  || 0],
    ['off-gas',    en.offgas_loss_kWh    || 0],
  ];
  const useful = en.useful_melt_kWh || 0;
  const wfLabels = ['grid in', ...parts.map(p => p[0]), 'to steel'];
  const wfVals   = [total, ...parts.map(p => -p[1]), useful];
  let cum = 0;
  const bases = [], heights = [], wfColors = [];
  wfVals.forEach((v, i) => {
    if (i === 0)                    { bases.push(0);     heights.push(v);  wfColors.push('#ff6a34'); cum = v; }
    else if (i === wfVals.length-1) { bases.push(0);     heights.push(v);  wfColors.push('#4fa8d8'); }
    else                            { bases.push(cum+v); heights.push(-v); wfColors.push('#e5484d'); cum += v; }
  });
  const barTrace = {
    type: 'bar', x: wfLabels, y: heights, base: bases,
    marker: { color: wfColors }, name: 'energy split',
    showlegend: false, xaxis: 'x2', yaxis: 'y2'
  };

  // --- Panel 3: Element reaction rates ---
  const rateTraces = [];
  const rateDefs = [['rate_C','#ff6a34','C'],['rate_Si','#4fa8d8','Si'],['rate_Mn','#33d17a','Mn'],['rate_P','#a08a5a','P']];
  const hasRates = rateDefs.some(([k]) => frames[0]?.[k] != null);
  if (hasRates) {
    rateDefs.filter(([k]) => frames[0]?.[k] != null).forEach(([k,c,n]) => {
      rateTraces.push({ x: t, y: frames.map(f => f[k]), name: n, line: { color: c, width: 1.3 }, xaxis: 'x3', yaxis: 'y3' });
    });
  } else {
    // Fallback: numerical gradient of composition
    [['C','#ff6a34'],['Si','#4fa8d8'],['Mn','#33d17a']].filter(([el]) => frames[0]?.[`pct_${el}`] != null).forEach(([el,c]) => {
      const grad = frames.map((f, i) => {
        if (i === 0) return 0;
        const dt = frames[i].t_min - frames[i-1].t_min;
        return dt > 0 ? (f[`pct_${el}`] - frames[i-1][`pct_${el}`]) / dt : 0;
      });
      rateTraces.push({ x: t, y: grad, name: `d${el}/dt`, line: { color: c, width: 1.3 }, xaxis: 'x3', yaxis: 'y3' });
    });
  }
  rateTraces.push({ x: [t[0], t[t.length-1]], y: [0, 0], line: { color: '#6b757f', width: 0.6 }, showlegend: false, xaxis: 'x3', yaxis: 'y3' });

  // --- Panel 4: Cumulative energy input vs useful ---
  const e4Traces = [
    { x: t, y: frames.map(f => f.E_kWh), name: 'grid input', line: { color: '#ff6a34', width: 1.6 }, xaxis: 'x4', yaxis: 'y4' }
  ];
  if (frames[0]?.Q_useful_kW != null) {
    const dt_h = frames.map((f, i) => i === 0 ? 0 : (f.t_min - frames[i-1].t_min) / 60);
    let cuAcc = 0;
    const cumUseful = frames.map((f, i) => { cuAcc += Math.max(0, f.Q_useful_kW || 0) * dt_h[i]; return cuAcc; });
    e4Traces.push({ x: t, y: cumUseful, name: 'useful (to metal)', line: { color: '#33d17a', width: 1.6 }, xaxis: 'x4', yaxis: 'y4' });
    // fill between losses (grid - useful)
    const yCombined = [...frames.map(f => f.E_kWh), ...cumUseful.slice().reverse()];
    const xCombined = [...t, ...t.slice().reverse()];
    e4Traces.push({ x: xCombined, y: yCombined, fill: 'toself', fillcolor: 'rgba(229,72,77,0.12)', line: { width: 0 }, name: 'losses', showlegend: true, xaxis: 'x4', yaxis: 'y4' });
  }

  const allTraces = [...hfTraces, barTrace, ...rateTraces, ...e4Traces];
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#0f1418',
    font: { family: 'Segoe UI,Arial', size: 10, color: '#c6ccd4' },
    margin: { l: 52, r: 30, t: 35, b: 55 }, height: 520,
    grid: { rows: 2, columns: 2, pattern: 'independent', roworder: 'top to bottom' },
    xaxis:  { ...dark, title: { text: 'Time (min)',   font: { size: 9 } } },
    xaxis2: { ...dark },
    xaxis3: { ...dark, title: { text: 'Time (min)',   font: { size: 9 } } },
    xaxis4: { ...dark, title: { text: 'Time (min)',   font: { size: 9 } } },
    yaxis:  { ...dark, title: { text: 'Heat flow (kW)',             font: { size: 9 } } },
    yaxis2: { ...dark, title: { text: 'Energy (kWh)',               font: { size: 9 } } },
    yaxis3: { ...dark, title: { text: 'Rate (wt %/min)',            font: { size: 9 } } },
    yaxis4: { ...dark, title: { text: 'Cumulative energy (kWh)',    font: { size: 9 } } },
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, x: 0, font: { size: 9 }, bgcolor: 'rgba(0,0,0,0)' },
    annotations: [
      { text: 'Heat-flow breakdown through the heat', xref: 'paper', yref: 'paper', x: 0.22, y: 1.01, showarrow: false, font: { color: '#e9edf0', size: 10 } },
      { text: 'Energy split — grid input to tapped steel', xref: 'paper', yref: 'paper', x: 0.78, y: 1.01, showarrow: false, font: { color: '#e9edf0', size: 10 } },
      { text: 'Element reaction rates', xref: 'paper', yref: 'paper', x: 0.22, y: 0.47, showarrow: false, font: { color: '#e9edf0', size: 10 } },
      { text: 'Cumulative energy: input vs useful', xref: 'paper', yref: 'paper', x: 0.78, y: 0.47, showarrow: false, font: { color: '#e9edf0', size: 10 } },
    ],
  };
  Plotly.newPlot('phys-chart', allTraces, layout, { responsive: true, displayModeBar: false });
}
