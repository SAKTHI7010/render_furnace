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
      <div id="traj-chart" style="margin-top:8px;"></div>`;
    document.getElementById('btn-traj-run').addEventListener('click', () => runTrajectory(true));
    initialized = true;
  }
  runTrajectory(false);
}

let _lastFrameCount = -1;

async function runTrajectory(force) {
  if (state.frames && state.frames.length > 0) {
    const fc = state.frames.length;
    if (!force && _lastFrameCount === fc) return;
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

// Explicit 2x3 grid domains — same as Streamlit layout
// Row 1: top half  (y: 0.56 → 1.0)
// Row 2: bottom half (y: 0.0 → 0.44)
// Columns: [0,0.29], [0.355,0.645], [0.71,1.0]
const COL = [[0, 0.29], [0.355, 0.645], [0.71, 1.0]];
const ROW = [[0.56, 1.0], [0.0, 0.44]];  // [row1_top, row2_top]

function dom(col, row) {
  return { x: COL[col], y: ROW[row] };
}

function renderTrajectory(res) {
  const aim = (state.configs[state.plant] || {})['Tap aim (°C)'] || 1620;
  const floor = res.floor_kWh_t;
  const frames = res.frames || [];
  if (!frames.length) return;

  const isLive = state.running && !state.tapped;
  const tapMin = res.tap_min || frames[frames.length - 1].t_min;
  const label = (isLive ? '● LIVE' : (state.tapped ? '■ TAPPED' : "Operator's heat")) +
    ` — tap ${tapMin.toFixed(0)} min (${frames.length} samples)`;
  document.getElementById('traj-label').textContent = label;

  const endpoint = res.endpoint || {};
  const lastF = frames[frames.length - 1];
  document.getElementById('traj-kpis').innerHTML = [
    kpi('Tap °C',    endpoint.T_C?.toFixed(0) || lastF.T_bath_C?.toFixed(0) || '—', `aim ${aim}`),
    kpi('Carbon %',  endpoint.pct_C?.toFixed(3) || lastF.pct_C?.toFixed(3) || '—', ''),
    kpi('Tap min',   tapMin.toFixed(0), isLive ? 'live' : ''),
    kpi('SEC kWh/t', res.sec_kWh_t?.toFixed(0) || lastF.SEC_kWh_t?.toFixed(0) || '—', floor ? `floor ${floor.toFixed(0)}` : ''),
    kpi('Ledger %',  res.ledger_pct != null ? res.ledger_pct.toFixed(2) : '—', 'closure'),
  ].join('');

  const t = frames.map(f => f.t_min);
  const dark = { gridcolor: '#20262c', zeroline: false, color: '#9aa4af', showgrid: true };

  // Addition vertical lines
  const adds = (res.additions || []).map(a => ({
    type: 'line', x0: a.time_min, x1: a.time_min, y0: 0, y1: 1, yref: 'paper',
    line: { color: '#f0a83c', width: 1, dash: 'dot' }
  }));

  // ─── TRACES ───────────────────────────────────────────────
  const traces = [
    // ── Panel 0,0: Temperatures (x1/y1) ──
    { x: t, y: frames.map(f => f.T_bath_C),    name: 'bath',            line: { color: '#ff6a34', width: 2 },              xaxis: 'x1', yaxis: 'y1' },
    { x: t, y: frames.map(f => f.T_solid_C),   name: 'solid charge',    line: { color: '#8792a0', width: 1.5 },            xaxis: 'x1', yaxis: 'y1' },
    ...(frames[0]?.T_hotface_C != null
      ? [{ x: t, y: frames.map(f => f.T_hotface_C), name: 'lining hot face', line: { color: '#a08a5a', width: 1, dash: 'dot' }, xaxis: 'x1', yaxis: 'y1' }]
      : []),
    { x: [t[0], t[t.length-1]], y: [aim, aim], name: `tap aim ${aim}`, line: { color: '#33d17a', width: 1, dash: 'dash' }, xaxis: 'x1', yaxis: 'y1', showlegend: false },

    // ── Panel 0,1: Inventories & dissolution (x2/y2 main, y3 secondary) ──
    { x: t, y: frames.map(f => f.M_solid_t),       name: 'solid (t)',           line: { color: '#8792a0', width: 1.5 }, xaxis: 'x2', yaxis: 'y2' },
    { x: t, y: frames.map(f => f.M_liquid_t),      name: 'liquid (t)',          line: { color: '#ff6a34', width: 2 },   xaxis: 'x2', yaxis: 'y2' },
    { x: t, y: frames.map(f => f.undissolved_kg),  name: 'undissolved (kg)',    line: { color: '#4fa8d8', width: 1.5 }, xaxis: 'x2', yaxis: 'y3' },

    // ── Panel 0,2: Bath composition (x3/y4) ──
    { x: t, y: frames.map(f => f.pct_C),  name: 'C',  line: { color: '#ff6a34', width: 1.5 }, xaxis: 'x3', yaxis: 'y4' },
    { x: t, y: frames.map(f => f.pct_Si), name: 'Si', line: { color: '#4fa8d8', width: 1.5 }, xaxis: 'x3', yaxis: 'y4' },
    { x: t, y: frames.map(f => f.pct_Mn), name: 'Mn', line: { color: '#33d17a', width: 1.5 }, xaxis: 'x3', yaxis: 'y4' },
    ...(frames[0]?.pct_S != null
      ? [{ x: t, y: frames.map(f => f.pct_S),  name: 'S',  line: { color: '#a08a5a', width: 1.2 }, xaxis: 'x3', yaxis: 'y4' }]
      : []),

    // ── Panel 1,0: Slag chemistry & basicity (x4/y5 main, y6 secondary) ──
    { x: t, y: frames.map(f => f.slag_FeO_pct), name: 'FeO (wt%)',   line: { color: '#ff6a34', width: 1.5 }, xaxis: 'x4', yaxis: 'y5' },
    { x: t, y: frames.map(f => f.B2),           name: 'B2 (CaO/SiO₂)', line: { color: '#4fa8d8', width: 1.5 }, xaxis: 'x4', yaxis: 'y6' },

    // ── Panel 1,1: Heat-flow breakdown (x5/y7) ──
    ...[['Q_wall_kW','#a08a5a','lining loss'], ['Q_rad_kW','#e5484d','radiation'],
        ['Q_bath_to_scrap_kW','#8792a0','bath→scrap'], ['Q_chem_kW','#33d17a','chemical']]
      .filter(([k]) => frames[0]?.[k] != null)
      .map(([k, c, n]) => ({ x: t, y: frames.map(f => f[k]), name: n, line: { color: c, width: 1.4 }, xaxis: 'x5', yaxis: 'y7' })),

    // ── Panel 1,2: Energy & SEC (x6/y8 main, y9 secondary) ──
    { x: t, y: frames.map(f => f.E_kWh),     name: 'cumul. kWh',  line: { color: '#8792a0', width: 1.5 }, xaxis: 'x6', yaxis: 'y8' },
    { x: t, y: frames.map(f => f.SEC_kWh_t), name: 'SEC kWh/t',   line: { color: '#ff6a34', width: 1.5 }, xaxis: 'x6', yaxis: 'y9' },
    ...(floor ? [{ x: [t[0],t[t.length-1]], y: [floor,floor], name: `floor ${floor.toFixed(0)}`, line: { color: '#33d17a', width: 1, dash: 'dash' }, xaxis: 'x6', yaxis: 'y9', showlegend: false }] : []),
  ];

  // ─── LAYOUT ───────────────────────────────────────────────
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor:  '#0f1418',
    font:   { family: 'Segoe UI,Arial', size: 10, color: '#c6ccd4' },
    margin: { l: 55, r: 55, t: 40, b: 45 },
    height: 680,

    // Row 1 x-axes
    xaxis:  { ...dark, domain: COL[0], anchor: 'y1',  title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis2: { ...dark, domain: COL[1], anchor: 'y2',  title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis3: { ...dark, domain: COL[2], anchor: 'y4',  title: { text: 'Time (min)', font: { size: 9 } } },
    // Row 2 x-axes
    xaxis4: { ...dark, domain: COL[0], anchor: 'y5',  title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis5: { ...dark, domain: COL[1], anchor: 'y7',  title: { text: 'Time (min)', font: { size: 9 } } },
    xaxis6: { ...dark, domain: COL[2], anchor: 'y8',  title: { text: 'Time (min)', font: { size: 9 } } },

    // Row 1 y-axes
    yaxis:  { ...dark, domain: ROW[0], anchor: 'x1',  title: { text: 'Temperature (°C)', font: { size: 9 } } },
    yaxis2: { ...dark, domain: ROW[0], anchor: 'x2',  title: { text: 'Metal mass (t)', font: { size: 9 } } },
    yaxis3: { ...dark, domain: ROW[0], anchor: 'x2',  title: { text: 'Undissolved (kg)', font: { size: 9 } }, overlaying: 'y2', side: 'right' },
    yaxis4: { ...dark, domain: ROW[0], anchor: 'x3',  title: { text: 'Element (wt %)', font: { size: 9 } } },
    // Row 2 y-axes
    yaxis5: { ...dark, domain: ROW[1], anchor: 'x4',  title: { text: 'Slag FeO (wt %)', font: { size: 9 } } },
    yaxis6: { ...dark, domain: ROW[1], anchor: 'x4',  title: { text: 'Basicity B2', font: { size: 9 } }, overlaying: 'y5', side: 'right' },
    yaxis7: { ...dark, domain: ROW[1], anchor: 'x5',  title: { text: 'Heat flow (kW)', font: { size: 9 } } },
    yaxis8: { ...dark, domain: ROW[1], anchor: 'x6',  title: { text: 'Cumul. energy (kWh)', font: { size: 9 } } },
    yaxis9: { ...dark, domain: ROW[1], anchor: 'x6',  title: { text: 'SEC (kWh/t)', font: { size: 9 } }, overlaying: 'y8', side: 'right' },

    legend: {
      orientation: 'h', y: 1.04, x: 0,
      font: { size: 9 }, bgcolor: 'rgba(0,0,0,0)',
      traceorder: 'normal'
    },
    shapes: adds,
    annotations: [
      { text: 'Temperatures',              xref: 'paper', yref: 'paper', x: 0.145, y: 1.035, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
      { text: 'Inventories & dissolution', xref: 'paper', yref: 'paper', x: 0.50,  y: 1.035, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
      { text: 'Bath composition',          xref: 'paper', yref: 'paper', x: 0.855, y: 1.035, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
      { text: 'Slag chemistry & basicity', xref: 'paper', yref: 'paper', x: 0.145, y: 0.475, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
      { text: 'Heat-flow breakdown',       xref: 'paper', yref: 'paper', x: 0.50,  y: 0.475, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
      { text: 'Energy & specific consumption', xref: 'paper', yref: 'paper', x: 0.855, y: 0.475, showarrow: false, font: { color: '#e9edf0', size: 11, weight: 'bold' } },
    ],
  };

  Plotly.newPlot('traj-chart', traces, layout, { responsive: true, displayModeBar: false });
}
