const DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: '#0f1418',
  font: {family: 'Segoe UI, DejaVu Sans, Arial', size: 11, color: '#c6ccd4'},
  margin: {l:55, r:15, t:34, b:38},
  legend: {orientation:'h', yanchor:'bottom', y:1.0, x:0, font:{size:10}, bgcolor:'rgba(0,0,0,0)'},
  xaxis: {gridcolor:'#20262c', zeroline:false, color:'#9aa4af'},
  yaxis: {gridcolor:'#20262c', zeroline:false, color:'#9aa4af'},
};

function layout(overrides={}, height=320) {
  return {...DARK_LAYOUT, height, ...overrides};
}

export const charts = {
  plot(el, data, layoutOpts, height=320) {
    if (!el) return;
    Plotly.newPlot(el, data, layout(layoutOpts, height), {responsive:true, displayModeBar:false});
  },
  
  trajectory(el, frames, additions, aim, floor) {
    if (!el || !frames || !frames.length) return;
    const t = frames.map(f => f.t_min);
    
    const traces = [
      {x:t, y:frames.map(f=>f.T_bath_C), name:'Bath °C', line:{color:'#ff6a34'}},
      {x:t, y:frames.map(f=>f.M_solid_t), name:'Solid (t)', xaxis:'x2', yaxis:'y2', line:{color:'#8792a0'}},
      {x:t, y:frames.map(f=>f.pct_C), name:'Carbon %', xaxis:'x3', yaxis:'y3', line:{color:'#f0a83c'}},
      {x:t, y:frames.map(f=>f.slag_FeO_pct), name:'Slag FeO %', xaxis:'x4', yaxis:'y4', line:{color:'#a08a5a'}},
      {x:t, y:frames.map(f=>f.Q_bath_to_scrap_kW), name:'Melt kW', xaxis:'x5', yaxis:'y5', line:{color:'#33d17a'}},
      {x:t, y:frames.map(f=>f.SEC_kWh_t), name:'SEC kWh/t', xaxis:'x6', yaxis:'y6', line:{color:'#4fa8d8'}}
    ];
    
    const lo = layout({
      grid: {rows:2, cols:3, pattern:'independent'},
      showlegend: false
    }, 600);
    Plotly.newPlot(el, traces, lo, {responsive:true, displayModeBar:false});
  },
  
  physicsPlots(el, frames, energy) {
    if (!el || !frames || !frames.length) return;
    const t = frames.map(f => f.t_min);
    const traces = [
      {x:t, y:frames.map(f=>f.Q_useful_kW), name:'Useful kW', line:{color:'#ff6a34'}},
      {x:t, y:frames.map(f=>f.Q_wall_kW), name:'Wall Loss kW', xaxis:'x2', yaxis:'y2', line:{color:'#e5484d'}},
      {x:t, y:frames.map(f=>f.E_kWh), name:'Total kWh', xaxis:'x3', yaxis:'y3', line:{color:'#4fa8d8'}},
      {x:t, y:frames.map(f=>f.SEC_kWh_t), name:'SEC kWh/t', xaxis:'x4', yaxis:'y4', line:{color:'#33d17a'}}
    ];
    const lo = layout({grid: {rows:2, cols:2, pattern:'independent'}, showlegend:false}, 500);
    Plotly.newPlot(el, traces, lo, {responsive:true, displayModeBar:false});
  }
};
