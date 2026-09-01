import { api } from './api.js';
import { state } from './state.js';
import * as operatorTab   from './tabs/operator.js';
import * as trajectoryTab from './tabs/trajectory.js';
import * as physicsTab    from './tabs/physics.js';
import * as ekfTab        from './tabs/ekf.js';
import * as mlTab         from './tabs/ml.js';
import * as driftTab      from './tabs/drift.js';
import * as chargemixTab  from './tabs/chargemix.js';
import * as economicsTab  from './tabs/economics.js';
import * as heatlogTab    from './tabs/heatlog.js';
import * as settingsTab   from './tabs/settings.js';
import * as validationTab from './tabs/validation.js';
import * as aboutTab      from './tabs/about.js';

const TABS = {
  'operator':   operatorTab,
  'trajectory': trajectoryTab,
  'physics':    physicsTab,
  'ekf':        ekfTab,
  'ml':         mlTab,
  'drift':      driftTab,
  'chargemix':  chargemixTab,
  'economics':  economicsTab,
  'heatlog':    heatlogTab,
  'settings':   settingsTab,
  'validation': validationTab,
  'about':      aboutTab,
};

async function init() {
  try {
    const health = await api.health();
    document.getElementById('engine-version').textContent =
      `engine v${health.engine_version} · advisory-only`;

    const configs = await api.configs();
    state.configs = configs;
    state.plants = health.plants;
    const sel = document.getElementById('plant-select');
    health.plants.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
    sel.value = state.plant;
    sel.addEventListener('change', () => {
      state.plant = sel.value;
      // Clear cached results when plant changes
      state.trajResult = null; state.physicsResult = null;
      state.ekfResult = null; state.validationResult = null;
    });

    document.querySelectorAll('#tab-bar button').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    switchTab('operator');
    setInterval(updateStatus, 800);
  } catch (err) {
    document.getElementById('header-status').textContent = `Backend offline — ${err.message}`;
    document.getElementById('header-status').style.color = '#e5484d';
    console.error('SmartMelt init failed:', err);
  }
}

function switchTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('#tab-bar button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tab="${id}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.getElementById(`tab-${id}`);
  if (panel) panel.style.display = 'block';
  if (TABS[id]?.activate) TABS[id].activate();
}

function updateStatus() {
  const el = document.getElementById('header-status');
  if (!el) return;
  const aim = (state.configs[state.plant] || {})['Tap aim (°C)'] || 1620;
  if (!state.sessionId) {
    el.textContent = 'ready — press START HEAT';
    el.style.color = '#9aa4af';
    return;
  }
  const snap = state.frames[Math.max(0, Math.min(state.frameIdx, state.frames.length-1))];
  if (!snap) return;
  if (state.tapped) {
    const hit = Math.abs(snap.T_bath_C - aim) <= 15;
    el.textContent = `TAPPED — ${hit ? 'on aim' : `${(snap.T_bath_C-aim).toFixed(0)}°C off aim`}`;
    el.style.color = hit ? '#33d17a' : '#f0a83c';
  } else if (state.complete) {
    el.textContent = 'READY TO TAP — on temperature & fully melted';
    el.style.color = '#33d17a';
  } else {
    const pct = snap.melted_pct?.toFixed(0) || '0';
    const T = snap.T_bath_C?.toFixed(0) || '—';
    el.textContent = `melting — ${pct}% · ${T}°C · ${(aim-snap.T_bath_C).toFixed(0)}°C below tap aim`;
    el.style.color = '#f0a83c';
  }
}

export function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}

export function kpi(label, value, sub='') {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

export function pill(text, kind='ok') {
  return `<span class="pill ${kind}">${text}</span>`;
}

export function advCard(level, title, msg) {
  const col = {ok:'#33d17a', warn:'#f0a83c', bad:'#e5484d'}[level] || '#9aa4af';
  const badge = {ok:'OK', warn:'!', bad:'!!!'}[level] || '—';
  const border = level !== 'ok' ? `border-color:${col}` : '';
  return `<div class="adv-card" style="${border}"><div style="display:flex;gap:8px;align-items:flex-start"><div class="adv-badge" style="color:${col}">${badge}</div><div><div class="adv-title">${title}</div><div class="adv-msg">${msg}</div></div></div></div>`;
}

window.addEventListener('DOMContentLoaded', init);
