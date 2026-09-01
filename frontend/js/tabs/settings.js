import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-settings');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Settings — plant &amp; process configuration</div>
      <div class="thin-note" style="margin-bottom:8px;">These set the aim and economic basis used by the advisory, endpoint checks and economics. Adjust to match your plant, then Apply.</div>
      <div style="display:grid;grid-template-columns:0.55fr 0.45fr;gap:12px;">
        <div>
          <form id="settings-form">
            <div class="form-row"><label>Tap temperature aim (°C)</label><input type="number" id="s-tap" value="1620" step="1"></div>
            <div class="form-row"><label>Carbon aim — minimum (%)</label><input type="number" id="s-clo" value="0.050" step="0.001" style="width:120px;"></div>
            <div class="form-row"><label>Carbon aim — maximum (%)</label><input type="number" id="s-chi" value="0.250" step="0.001" style="width:120px;"></div>
            <div class="form-row"><label>Rated power (kW)</label><input type="number" id="s-power" value="8000" step="100"></div>
            <div class="form-row"><label>Electricity tariff (₹/kWh)</label><input type="number" id="s-tariff" value="7.000" step="0.001" style="width:120px;"></div>
            <div class="form-row"><label>Grid emission factor (tCO₂/MWh)</label><input type="number" id="s-ef" value="0.7120" step="0.0001" style="width:120px;"></div>
            <div class="form-row"><label>Baseline SEC (kWh/t)</label><input type="number" id="s-sec" value="600" step="1"></div>
            <div style="margin-top:10px;">
              <button type="submit" class="btn btn-primary">Apply settings</button>
            </div>
          </form>
          <div id="settings-msg" style="margin-top:8px; font-size:12px;"></div>
        </div>
        <div>
          <div class="section-title-sm" id="settings-plant-label">Active plant configuration: —</div>
          <div id="settings-config-table" style="overflow-x:auto; margin-top:6px;"></div>
        </div>
      </div>`;

    document.getElementById('settings-form').addEventListener('submit', e => { e.preventDefault(); applySettings(); });
    initialized = true;
  }
  loadCurrentConfig();
}

function loadCurrentConfig() {
  const cfg = state.configs[state.plant] || {};
  document.getElementById('settings-plant-label').textContent = `Active plant configuration: ${state.plant}`;

  // Pre-fill form from config
  if (cfg['Tap aim (°C)'] != null) document.getElementById('s-tap').value = cfg['Tap aim (°C)'];
  if (cfg['Tariff (₹/kWh)'] != null) document.getElementById('s-tariff').value = cfg['Tariff (₹/kWh)'].toFixed(3);
  if (cfg['Grid EF (tCO₂/MWh)'] != null) document.getElementById('s-ef').value = cfg['Grid EF (tCO₂/MWh)'].toFixed(4);
  if (cfg['Baseline SEC (kWh/t)'] != null) document.getElementById('s-sec').value = cfg['Baseline SEC (kWh/t)'];
  if (cfg['Rated power (kW)'] != null) document.getElementById('s-power').value = cfg['Rated power (kW)'];

  // Render config table
  let html = '<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>';
  Object.entries(cfg).forEach(([k,v]) => {
    html += `<tr><td>${k}</td><td>${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : v}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('settings-config-table').innerHTML = html;
}

function applySettings() {
  // Store settings in state for use in API calls
  state.settings = {
    tap_temperature_C: parseFloat(document.getElementById('s-tap').value),
    aim_C_lo_pct: parseFloat(document.getElementById('s-clo').value),
    aim_C_hi_pct: parseFloat(document.getElementById('s-chi').value),
    rated_power_kW: parseFloat(document.getElementById('s-power').value),
    tariff_INR_per_kWh: parseFloat(document.getElementById('s-tariff').value),
    grid_EF_tCO2_per_MWh: parseFloat(document.getElementById('s-ef').value),
    baseline_SEC_kWh_per_t: parseFloat(document.getElementById('s-sec').value),
  };
  // Clear cached results so next tab visit re-runs with new settings
  state.trajResult = null;
  state.physicsResult = null;
  state.validationResult = null;

  const msg = document.getElementById('settings-msg');
  msg.style.color = '#5fe3a3';
  msg.textContent = '✓ Settings applied — advisory & economics updated';
  setTimeout(() => { msg.textContent = ''; }, 3000);
}
