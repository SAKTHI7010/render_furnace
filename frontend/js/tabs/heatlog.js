import { state, logHeat } from '../state.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-heatlog');
  if (!initialized) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div class="section-title" style="flex:1;">Heat log — audit trail</div>
        <button class="btn" id="btn-log-clear">Clear</button>
        <button class="btn" id="btn-log-export">Export CSV</button>
      </div>
      <div class="thin-note" style="margin-bottom:8px;">Every advisory shown, every action taken and every outcome lands here — the audit trail, ML training set and shared-savings evidence are the same table.</div>
      <div id="heatlog-table" style="overflow-x:auto;"></div>`;

    document.getElementById('btn-log-clear').addEventListener('click', () => {
      state.heatLog = [];
      renderLog();
    });
    document.getElementById('btn-log-export').addEventListener('click', exportCsv);
    initialized = true;
  }
  renderLog();
}

function renderLog() {
  const rows = state.heatLog;
  if (!rows.length) {
    document.getElementById('heatlog-table').innerHTML = '<div class="thin-note" style="padding:12px;">No events logged yet. Start a heat on the Operator Console.</div>';
    return;
  }
  let html = `<table><thead><tr><th>Clock</th><th>Heat min</th><th>Event</th><th>Detail</th></tr></thead><tbody>`;
  [...rows].reverse().forEach(r => {
    html += `<tr><td>${r.clock}</td><td>${r.sim_min}</td><td><b>${r.event}</b></td><td>${r.detail}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('heatlog-table').innerHTML = html;
}

function exportCsv() {
  const header = 'clock,sim_min,event,detail\n';
  const body = state.heatLog.map(r =>
    [r.clock, r.sim_min, `"${r.event}"`, `"${(r.detail||'').replace(/"/g,'""')}"`].join(',')
  ).join('\n');
  const blob = new Blob([header + body], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  a.href = url; a.download = `smartmelt_heatlog_${ts}.csv`;
  a.click(); URL.revokeObjectURL(url);
}
