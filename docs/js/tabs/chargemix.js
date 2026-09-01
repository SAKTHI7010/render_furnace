import { api } from '../api.js';
import { state } from '../state.js';
import { kpi, showLoading, pill } from '../main.js';

let initialized = false;
let manualWeights = {};
let materialsCache = [];

export function activate() {
  const panel = document.getElementById('tab-chargemix');
  if (!initialized) {
    panel.innerHTML = `
      <div class="section-title">Charge-Mix — 17-stream least-cost optimiser</div>
      <div style="margin-bottom:8px;">
        <label style="color:#d7dde4;font-size:12px;margin-right:12px;">
          <input type="radio" name="mix-mode" value="optimise" checked> Optimise (least cost)
        </label>
        <label style="color:#d7dde4;font-size:12px;">
          <input type="radio" name="mix-mode" value="manual"> Manual (operator sets kg)
        </label>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;">
        <div>
          <div class="slider-row"><div class="slider-label">Target liquid (t)</div><input type="range" id="mix-target" min="4" max="14" step="0.1" value="12.0"><div class="slider-val" id="mix-target-val">12.0</div></div>
          <div class="slider-row"><div class="slider-label">Min C (%)</div><input type="range" id="mix-clo" min="0" max="0.5" step="0.01" value="0.10"><div class="slider-val" id="mix-clo-val">0.10</div></div>
          <div class="slider-row"><div class="slider-label">Max C (%)</div><input type="range" id="mix-chi" min="0.1" max="1.0" step="0.01" value="0.40"><div class="slider-val" id="mix-chi-val">0.40</div></div>
          <div class="slider-row"><div class="slider-label">Cu ceiling (%)</div><input type="range" id="mix-cu" min="0.08" max="0.5" step="0.01" value="0.20"><div class="slider-val" id="mix-cu-val">0.20</div></div>
          <div class="slider-row"><div class="slider-label">Sn ceiling (%)</div><input type="range" id="mix-sn" min="0.01" max="0.50" step="0.001" value="0.03"><div class="slider-val" id="mix-sn-val">0.030</div></div>
        </div>
        <button class="btn btn-primary" id="btn-mix-solve">Solve</button>
      </div>
      <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;">
        <div>
          <div class="section-title-sm">Scrap library — 17 streams (price ₹/kg · assays wt%)</div>
          <div id="mix-materials-table" style="overflow-x:auto;max-height:460px;overflow-y:auto;"></div>
          <div class="thin-note" id="mix-mode-note">Optimise mode: the solver picks the least-cost compliant blend.</div>
        </div>
        <div>
          <div class="section-title-sm">Result — blend, bath chemistry, shadow price</div>
          <div id="mix-result"></div>
        </div>
      </div>`;

    document.getElementById('mix-target').addEventListener('input', e => {
      document.getElementById('mix-target-val').textContent = parseFloat(e.target.value).toFixed(1);
    });
    document.getElementById('mix-clo').addEventListener('input', e => {
      document.getElementById('mix-clo-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    document.getElementById('mix-chi').addEventListener('input', e => {
      document.getElementById('mix-chi-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    document.getElementById('mix-cu').addEventListener('input', e => {
      document.getElementById('mix-cu-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    document.getElementById('mix-sn').addEventListener('input', e => {
      document.getElementById('mix-sn-val').textContent = parseFloat(e.target.value).toFixed(3);
    });

    document.querySelectorAll('input[name="mix-mode"]').forEach(r =>
      r.addEventListener('change', () => { renderMaterialsTable(); })
    );
    document.getElementById('btn-mix-solve').addEventListener('click', onSolve);
    initialized = true;
    loadMaterials();
  } else {
    renderMaterialsTable(); // refresh mode
  }
}

function getMode() {
  return document.querySelector('input[name="mix-mode"]:checked')?.value || 'optimise';
}

async function loadMaterials() {
  try {
    const res = await api.chargemixMaterials();
    materialsCache = res.materials || [];
    renderMaterialsTable();
    onSolve(); // auto-solve on first load
  } catch (e) { console.error('materials load', e); }
}

function renderMaterialsTable() {
  const mode = getMode();
  let html = `<table>
    <thead><tr><th>Material</th><th>₹/kg</th><th>Fe%</th><th>Cu%</th><th>Sn%</th><th>C%</th>${mode === 'manual' ? '<th>kg</th>' : ''}</tr></thead>
    <tbody>`;
  materialsCache.forEach(m => {
    html += `<tr>
      <td>${m.name}</td>
      <td>${(m.price || 0).toFixed(1)}</td>
      <td>${(m.Fe_pct || 0).toFixed(1)}</td>
      <td>${(m.Cu_pct || 0).toFixed(3)}</td>
      <td>${(m.Sn_pct || 0).toFixed(3)}</td>
      <td>${(m.C_pct  || 0).toFixed(2)}</td>`;
    if (mode === 'manual') {
      const kg = manualWeights[m.name] || 0;
      html += `<td><input type="number" min="0" step="1" value="${kg}" style="width:70px;"
        onchange="window._mixKgChange(${JSON.stringify(m.name)}, this.value)"></td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('mix-materials-table').innerHTML = html;
  window._mixKgChange = (name, val) => { manualWeights[name] = parseFloat(val) || 0; };

  const note = mode === 'manual'
    ? 'Manual mode: enter kg in the last column, then Evaluate blend.'
    : 'Optimise mode: the solver picks the least-cost compliant blend.';
  document.getElementById('mix-mode-note').textContent = note;
  document.getElementById('btn-mix-solve').textContent = mode === 'manual' ? 'Evaluate' : 'Solve';
}

async function onSolve() {
  const mode = getMode();
  showLoading(true);
  try {
    let res;
    if (mode === 'optimise') {
      res = await api.chargemixOptimise({
        plant:       state.plant,
        target_t:    parseFloat(document.getElementById('mix-target').value),
        C_lo:        parseFloat(document.getElementById('mix-clo').value),
        C_hi:        parseFloat(document.getElementById('mix-chi').value),
        cu_ceiling:  parseFloat(document.getElementById('mix-cu').value),
        sn_ceiling:  parseFloat(document.getElementById('mix-sn').value),
      });
    } else {
      const weights = {};
      Object.entries(manualWeights).forEach(([k, v]) => { if (v > 0) weights[k] = v; });
      if (!Object.keys(weights).length) {
        document.getElementById('mix-result').innerHTML = pill('no kg set — enter manual weights', 'warn');
        showLoading(false);
        return;
      }
      res = await api.chargemixEvaluate({ plant: state.plant, weights });
    }
    res._mode = mode;
    state.mixResult = res;
    renderResult(res);
  } catch (e) {
    document.getElementById('mix-result').innerHTML = `<div style="color:#e5484d;">Error: ${e.message}</div>`;
  } finally {
    showLoading(false);
  }
}

function renderResult(res) {
  const cu   = parseFloat(document.getElementById('mix-cu')?.value || 0.20);
  const clo  = parseFloat(document.getElementById('mix-clo')?.value || 0.10);
  const chi  = parseFloat(document.getElementById('mix-chi')?.value || 0.40);
  const mode = res._mode || 'optimise';
  let html   = '';

  if (!res.feasible) {
    html = pill('infeasible — widen C window or raise a ceiling', 'bad') +
      `<p class="thin-note" style="margin-top:6px;">${res.message || ''}</p>`;
    document.getElementById('mix-result').innerHTML = html;
    return;
  }

  const bath = res.predicted_bath || {};
  const label = mode === 'optimise' ? 'feasible — least-cost compliant blend' : 'manual blend evaluated — compare with optimiser';
  html += pill(label, 'ok');

  // KPIs — match Streamlit column layout
  html += '<div class="kpi-grid" style="margin-top:8px;">';
  const costLabel = mode === 'manual' && res.liquid_t ? `${res.liquid_t.toFixed(1)} t liquid` : 'of liquid';
  html += kpi('Blend cost ₹/t', `₹${(res.cost_INR_per_t || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, costLabel);
  html += kpi('Charge energy', `${(res.energy_kWh || 0).toFixed(0)}`, 'kWh');
  html += kpi('Predicted Cu %', (bath.Cu || 0).toFixed(3), mode === 'optimise' ? `≤ ${cu.toFixed(2)}` : 'tramp');
  html += kpi('Predicted C %',  (bath.C  || 0).toFixed(3), mode === 'optimise' ? `${clo.toFixed(2)}–${chi.toFixed(2)}` : 'carbon');
  html += '</div>';

  // Blend table
  const blend = res.blend || [];
  if (blend.length) {
    html += '<div class="section-title-sm" style="margin-top:10px;">Blend</div>';
    html += '<table><thead><tr><th>Material</th><th>kg</th><th>% of charge</th></tr></thead><tbody>';
    blend.forEach(r => {
      const matName = r.material || r.Material || '—';
      const kg      = (r.kg || 0).toFixed(1);
      const pct     = (r.pct_of_charge || 0).toFixed(2);
      html += `<tr><td>${matName}</td><td>${kg}</td><td>${pct}</td></tr>`;
    });
    html += '</tbody></table>';
  }

  // Predicted bath chemistry — match Streamlit order: C, Si, Mn, Cr, Cu, Sn, Fe
  html += '<div class="section-title-sm" style="margin-top:10px;">Predicted bath chemistry</div>';
  html += '<table><thead><tr><th>Element</th><th>wt %</th></tr></thead><tbody>';
  ['C', 'Si', 'Mn', 'Cr', 'Cu', 'Sn', 'Fe'].filter(el => bath[el] != null && bath[el] > 1e-6).forEach(el => {
    html += `<tr><td>${el}</td><td>${bath[el].toFixed(4)}</td></tr>`;
  });
  html += '</tbody></table>';

  // Shadow price / info note — match Streamlit st.info() block
  if (mode === 'optimise') {
    const sh = res.shadow_price_Cu;
    if (sh && Math.abs(sh) > 1) {
      const per = Math.abs(sh) / 100;
      html += `<div class="thin-note" style="margin-top:8px;padding:6px;background:#182027;border:1px solid #232c33;">
        Copper ceiling shadow price ≈ ₹${per.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/t liquid per 0.01% relaxed. Relaxing to ${(cu + 0.01).toFixed(2)}% would save ≈ ₹${per.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/t.
      </div>`;
    } else {
      html += '<div class="thin-note" style="margin-top:8px;">Copper ceiling is not binding at this optimum — the cheapest blend already sits below it.</div>';
    }
  } else if (res.liquid_t) {
    const total = blend.reduce((s, r) => s + (r.kg || 0), 0);
    html += `<div class="thin-note" style="margin-top:8px;">Operator blend: ${total.toFixed(0)} kg charged → ${res.liquid_t.toFixed(1)} t liquid at ₹${(res.cost_INR_per_t || 0).toFixed(0)}/t.</div>`;
  }

  document.getElementById('mix-result').innerHTML = html;
}
