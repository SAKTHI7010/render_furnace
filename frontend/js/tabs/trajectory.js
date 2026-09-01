import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading } from '../main.js';
import { getHeatSpec } from './operator.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-trajectory');
  if (!initialized) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="section-title" style="flex:1;" id="traj-label">Operator's heat: —</div>
        <button class="btn" id="btn-traj-run">↻ Use operator's heat</button>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);" id="traj-kpis"></div>
      <div id="traj-chart" style="margin-top:8px; background:#0f1418; border:1px solid #232c33; min-height:520px;"></div>`;
    document.getElementById('btn-traj-run').addEventListener('click', () => runTrajectory(true));
    initialized = true;
  }
  runTrajectory(false);
}

let _lastFrameCount = -1;

async function runTrajectory(force) {
  // If we have operator frames, always use them (live or post-tap)
  if (state.frames && state.frames.length > 0) {
    const fc = state.frames.length;
    if (!force && _lastFrameCount === fc) return; // nothing changed
    _lastFrameCount = fc;
    const frames = state.frames;
    const last = frames[frames.length - 1];
    renderTrajectory({
      frames,
      endpoint: { T_C: last.T_bath_C, pct_C: last.pct_C },
      tap_min: last.t_min,
      sec_kWh_t: last.SEC_kWh_t,
      floor_kWh_t: null,
      ledger_pct: null,
      additions: state.appliedAdds || []
    });
    return;
  }

  if (!force && state.trajResult) { renderTrajectory(state.trajResult); return; }

  const spec = getHeatSpec();
  showLoading(true);
  try {
    const res = await api.trajectory({
      plant: state.plant,
      charge_t: spec.charge_t,
      power_kW: spec.power_kW,
      carbon_pct: spec.carbon_pct,
      copper_pct: spec.copper_pct,
      schedule: [],
    });
    state.trajResult = res;
    renderTrajectory(res);
  } catch (e) {
    document.getElementById('traj-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderTrajectory(res) {
  const aim = (state.configs[state.plant] || {})['Tap aim (°C)'] || 1620;
  const floor = res.floor_kWh_t;
  const frames = res.frames || [];
  if (!frames.length) return;

  const isLive = state.running && !state.tapped;
  const label = (isLive ? '● LIVE' : (state.tapped ? '■ TAPPED' : "Operator's heat")) +
    ` — tap ${res.tap_min?.toFixed(0) || frames[frames.length-1].t_min?.toFixed(0)} min (${frames.length} samples)`;
  document.getElementById('traj-label').textContent = label;

  const endpoint = res.endpoint || {};
  document.getElementById('traj-kpis').innerHTML = [
    kpi('Tap °C', endpoint.T_C?.toFixed(0) || endpoint.T_bath_C?.toFixed(0) || frames[frames.length-1].T_bath_C?.toFixed(0) || '—', `aim ${aim}`),
    kpi('Carbon %', endpoint.pct_C?.toFixed(3) || frames[frames.length-1].pct_C?.toFixed(3) || '—', ''),
    kpi('Tap min', res.tap_min?.toFixed(0) || frames[frames.length-1].t_min?.toFixed(0) || '—', isLive ? 'live' : ''),
    kpi('SEC kWh/t', res.sec_kWh_t?.toFixed(0) || frames[frames.length-1].SEC_kWh_t?.toFixed(0) || '—', floor ? `floor ${floor.toFixed(0)}` : ''),
    kpi('Ledger %', res.ledger_pct != null ? res.ledger_pct.toFixed(2) : (isLive ? 'live' : '—'), isLive ? 'running' : 'closure'),
  ].join('');

  const t = frames.map(f => f.t_min);
  const dark = { gridcolor: '#20262c', zeroline: false, color: '#9aa4af', showgrid: true };
  const adds = (res.additions || []).map(a => ({
    type: 'line', x0: a.time_min, x1: a.time_min, y0: 0, y1: 1, yref: 'paper',
    line: { color: '#f0a83c', width: 1, dash: 'dot' }
  }));

  const traces = [
    // a1 – Temperatures (xaxis1, yaxis1)
    { x: t, y: frames.map(f => f.T_bath_C), name: 'bath', line: { color: '#ff6a34', width: 2 }, xaxis: 'x1', yaxis: 'y1' },
    { x: t, y: frames.map(f => f.T_solid_C), name: 'solid charge', line: { color: '#8792a0', width: 1.5 }, xaxis: 'x1', yaxis: 'y1' },
    ...(frames[0]?.T_hotface_C != null ? [{ x: t, y: frames.map(f => f.T_hotface_C), name: 'lining hot face', line: { color: '#a08a5a', width: 1, dash: 'dot' }, xaxis: 'x1', yaxis: 'y1' }] : []),
    { x: [t[0], t[t.length-1]], y: [aim, aim], name: `tap aim ${aim}`, line: { color: '#33d17a', width: 1, dash: 'dash' }, xaxis: 'x1', yaxis: 'y1' },

    // a2 – Inventories & dissolution (xaxis2, yaxis2 + yaxis3 secondary)
    { x: t, y: frames.map(f => f.M_solid_t), name: 'solid', line: { color: '#8792a0', width: 1.5 }, xaxis: 'x2', yaxis: 'y2' },
    { x: t, y: frames.map(f => f.M_liquid_t), name: 'liquid', line: { color: '#ff6a34', width: 2 }, xaxis: 'x2', yaxis: 'y2' },
    { x: t, y: frames.map(f => f.undissolved_kg), name: 'undissolved (kg)', line: { color: '#4fa8d8', width: 1 }, xaxis: 'x2', yaxis: 'y3' },

    // a3 – Bath composition (xaxis3, yaxis4)
    ...['C','Si','Mn','S'].filter(el => frames[0]?.[`pct_${el}`] != null).map((el, i) => ({
      x: t, y: frames.map(f => f[`pct_${el}`]), name: el,
      line: { color: ['#ff6a34','#4fa8d8','#33d17a','#a08a5a'][i], width: 1.5 },
      xaxis: 'x3', yaxis: 'y4'
    })),

    // a4 – Slag chemistry & basicity (xaxis4, yaxis5 + yaxis6 secondary)
    { x: t, y: frames.map(f => f.slag_FeO_pct), name: 'FeO', line: { color: '#ff6a34', width: 1.5 }, xaxis: 'x4', yaxis: 'y5' },
    { x: t, y: frames.map(f => f.B2), name: 'B2 (basicity)', line: { color: '#4fa8d8', width: 1.5 }, xaxis: 'x4', yaxis: 'y6' },

    // a5 – Heat-flow breakdown (xaxis5, yaxis7)
    ...([['Q_wall_kW','#a08a5a','lining loss'],['Q_rad_kW','#e5484d','radiation'],
         ['Q_bath_to_scrap_kW','#8792a0','bath→scrap'],['Q_chem_kW','#33d17a','chemical']]
       .filter(([k]) => frames[0]?.[k] != null)
       .map(([k,c,n]) => ({ x: t, y: frames.map(f => f[k]), name: n, line: { color: c, width: 1.4 }, xaxis: 'x5', yaxis: 'y7' }))),

    // a6 – Energy & SEC (xaxis6, yaxis8 + yaxis9 secondary)
    { x: t, y: frames.map(f => f.E_kWh), name: 'cumulative kWh', line: { color: '#8792a0', width: 1.5 }, xaxis: 'x6', yaxis: 'y8' },
    { x: t, y: frames.map(f => f.SEC_kWh_t), name: 'SEC kWh/t', line: { color: '#ff6a34', width: 1.5 }, xaxis: 'x6', yaxis: 'y9' },
    ...(floor ? [{ x: [t[0], t[t.length-1]], y: [floor, floor], name: `floor ${floor.toFixed(0)}`, line: { color: '#33d17a', width: 1, dash: 'dash' }, xaxis: 'x6', yaxis: 'y9' }] : []),
  ];

  const panelTitles = [
    { text: 'Temperatures', x: 0.13, y: 1.01 },
    { text: 'Inventories & dissolution', x: 0.50, y: 1.01 },
    { text: 'Bath composition', x: 0.87, y: 1.01 },
    { text: 'Slag chemistry & basicity', x: 0.13, y: 0.47 },
    { text: 'Heat-flow breakdown', x: 0.50, y: 0.47 },
    { text: 'Energy & specific consumption', x: 0.87, y: 0.47 },
  ];

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#0f1418',
    font: { family: 'Segoe UI,Arial', size: 10, color: '#c6ccd4' },
    margin: { l: 50, r: 55, t: 35, b: 38 }, height: 520,
    grid: { rows: 2, columns: 3, pattern: 'independent', roworder: 'top to bottom' },
    xaxis:  { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis2: { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis3: { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis4: { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis5: { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis6: { ...dark, title: { text: 'Time (min)', font: { size: 9 } } },
    yaxis:  { ...dark, title: { text: 'Temperature (°C)', font: { size: 9 } } },
    yaxis2: { ...dark, title: { text: 'Metal mass (t)', font: { size: 9 } } },
    yaxis3: { ...dark, title: { text: 'Undissolved (kg)', font: { size: 9 } }, overlaying: 'y2', side: 'right' },
    yaxis4: { ...dark, title: { text: 'Element content (wt %)', font: { size: 9 } } },
    yaxis5: { ...dark, title: { text: 'Slag FeO (wt %)', font: { size: 9 } } },
    yaxis6: { ...dark, title: { text: 'Basicity B2 (CaO/SiO₂)', font: { size: 9 } }, overlaying: 'y5', side: 'right' },
    yaxis7: { ...dark, title: { text: 'Heat flow (kW)', font: { size: 9 } } },
    yaxis8: { ...dark, title: { text: 'Cumulative energy (kWh)', font: { size: 9 } } },
    yaxis9: { ...dark, title: { text: 'Specific energy (kWh/t)', font: { size: 9 } }, overlaying: 'y8', side: 'right' },
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, x: 0, font: { size: 9 }, bgcolor: 'rgba(0,0,0,0)' },
    shapes: adds,
    annotations: panelTitles.map(p => ({
      text: p.text, xref: 'paper', yref: 'paper', x: p.x, y: p.y,
      showarrow: false, font: { color: '#e9edf0', size: 10 }
    })),
  };

  Plotly.newPlot('traj-chart', traces, layout, { responsive: true, displayModeBar: false });
}
