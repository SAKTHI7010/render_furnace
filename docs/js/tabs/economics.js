import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading } from '../main.js';

let initialized = false;

export function activate() {
  const panel = document.getElementById('tab-economics');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Economics — savings, payback &amp; CO₂</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
        <div>
          <div class="slider-row"><div class="slider-label">Annual output (t/yr)</div><input type="range" id="eco-out" min="5000" max="200000" step="1000" value="40000"><div class="slider-val" id="eco-out-val">40,000</div></div>
          <div class="slider-row"><div class="slider-label">SEC saving (kWh/t)</div><input type="range" id="eco-save" min="10" max="100" step="1" value="40"><div class="slider-val" id="eco-save-val">40</div></div>
          <div class="slider-row"><div class="slider-label">Licence (₹ lakh)</div><input type="range" id="eco-price" min="5" max="40" step="1" value="20"><div class="slider-val" id="eco-price-val">20</div></div>
        </div>
        <button class="btn btn-primary" id="btn-eco-compute">Compute</button>
      </div>
      <div class="kpi-grid" id="eco-kpis"></div>
      <div class="thin-note" id="eco-note" style="margin:8px 0;"></div>
      <div class="section-title-sm" style="margin-top:10px;">Scenario comparison</div>
      <div id="eco-scenarios" style="overflow-x:auto;"></div>
      <div class="section-title-sm" style="margin-top:10px;">Engine economics detail</div>
      <div id="eco-engine" style="overflow-x:auto;"></div>`;

    document.getElementById('eco-out').addEventListener('input', e => {
      document.getElementById('eco-out-val').textContent = parseInt(e.target.value).toLocaleString('en-IN');
    });
    document.getElementById('eco-save').addEventListener('input', e => {
      document.getElementById('eco-save-val').textContent = e.target.value;
    });
    document.getElementById('eco-price').addEventListener('input', e => {
      document.getElementById('eco-price-val').textContent = e.target.value;
    });
    document.getElementById('btn-eco-compute').addEventListener('click', runEconomics);
    initialized = true;
  }
  if (!state.economicsResult) runEconomics();
  else renderEconomics(state.economicsResult);
}

async function runEconomics() {
  showLoading(true);
  try {
    const res = await api.economics({
      plant: state.plant,
      t_per_year: parseInt(document.getElementById('eco-out').value),
      sec_saving_kWh_t: parseInt(document.getElementById('eco-save').value),
      licence_INR_lakh: parseInt(document.getElementById('eco-price').value),
    });
    state.economicsResult = res;
    renderEconomics(res);
  } catch(e) {
    document.getElementById('eco-kpis').innerHTML = `<div style="color:#e5484d;grid-column:1/-1;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderEconomics(res) {
  const saving = res.annual_saving_INR || 0;
  const cr = saving / 1e7;
  document.getElementById('eco-kpis').innerHTML = [
    kpi('Annual saving', `₹${cr.toFixed(2)} cr`, `at ₹${(res.tariff||7).toFixed(1)}/kWh`),
    kpi('Payback', `${(res.payback_months||0).toFixed(1)} mo`, 'energy alone'),
    kpi('CO₂ avoided', `${(res.co2_avoided_t_yr||0).toLocaleString('en-IN',{maximumFractionDigits:0})} t/yr`, `at ${(res.ef||0.712).toFixed(3)}`),
    kpi('Headroom left', `${(res.headroom_kWh_t||0).toFixed(0)} kWh/t`, `above ${(res.floor_kWh_t||0).toFixed(0)}`),
  ].join('');

  document.getElementById('eco-note').textContent =
    `At ₹${(res.tariff||7).toFixed(1)}/kWh (mid-band Indian HT industrial). Energy alone — yield, alloy and reduced reblows are additional. Simple payback is arithmetic; realised payback is normally quoted as 4–12 months as savings ramp up.`;

  // Scenarios table
  const scenarios = res.scenarios || [];
  let scHtml = '<table><thead><tr><th>Annual output</th><th>30 kWh/t</th><th>50 kWh/t</th><th>80 kWh/t</th></tr></thead><tbody>';
  scenarios.forEach(s => {
    scHtml += `<tr><td>${s.annual_output}</td><td>${s.saving_30}</td><td>${s.saving_50}</td><td>${s.saving_80}</td></tr>`;
  });
  scHtml += '</tbody></table>';
  document.getElementById('eco-scenarios').innerHTML = scHtml;

  // Engine details
  const eng = res.engine_details || {};
  let engHtml = '<table><thead><tr><th>Engine economics metric</th><th>Value</th></tr></thead><tbody>';
  Object.entries(eng).forEach(([k,v]) => {
    engHtml += `<tr><td>${k}</td><td>${v}</td></tr>`;
  });
  engHtml += '</tbody></table>';
  document.getElementById('eco-engine').innerHTML = engHtml;
}
