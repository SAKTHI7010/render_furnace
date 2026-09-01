export function activate() {
  const panel = document.getElementById('tab-about');
  if (panel._rendered) return;
  panel._rendered = true;
  panel.innerHTML = `
    <h1 style="color:#ff6a34; font-size:24px; margin-bottom:10px;">🔥 SmartMelt Studio</h1>
    <p style="max-width:860px; line-height:1.6; margin-bottom:12px;">
      Hybrid physics + machine-learning melt optimisation for induction, arc and basic-oxygen steelmaking.
      This browser application is a faithful rendering of the full operator and manager console over the validated SmartMelt engine.
      It is advisory-only — it reads and computes, and never writes to a control system.
    </p>
    <p class="thin-note" style="margin-bottom:16px;">Plant identities are anonymised (Industry-X = MSME IF pilot, Industry-Y = integrated BOF).</p>

    <h2 style="color:#f3f6f8; font-size:15px; margin-bottom:8px;">What each tab does</h2>
    <ul style="max-width:860px; line-height:1.7; color:#c6ccd4; padding-left:18px; margin-bottom:16px;">
      <li><b style="color:#e9edf0;">Operator Console</b> — start a heat, select playback speed, inject any flux, ferro-alloy or recarburiser at the current simulated time, watch the 3D furnace and streaming KPIs, and tap the heat.</li>
      <li><b style="color:#e9edf0;">Process Trajectory</b> — the same actual heat in six panels: temperatures, inventories, chemistry, slag/basicity, heat flows and energy.</li>
      <li><b style="color:#e9edf0;">Physics &amp; Energy</b> — heat-flow ledger, first-law audit and energy split from grid input to tapped steel.</li>
      <li><b style="color:#e9edf0;">Virtual Sensor</b> — Extended Kalman Filter using intermittent immersion dips to estimate bath temperature and hidden furnace efficiency.</li>
      <li><b style="color:#e9edf0;">Machine Learning</b> — physics plus a gated residual ML head, with out-of-time performance against physics alone.</li>
      <li><b style="color:#e9edf0;">Drift Monitor</b> — PSI alarms when incoming scrap or practice changes.</li>
      <li><b style="color:#e9edf0;">Charge-Mix</b> — 17-stream least-cost optimiser and manual charge evaluation with Cu/Sn constraints.</li>
      <li><b style="color:#e9edf0;">Economics</b> — savings, payback and CO₂ using the active plant tariff and emission factor.</li>
      <li><b style="color:#e9edf0;">Heat Log</b> — session audit trail and CSV export.</li>
      <li><b style="color:#e9edf0;">Settings</b> — plant aims, power, tariff, grid factor and baseline SEC.</li>
      <li><b style="color:#e9edf0;">Validation</b> — verified-parameter audit plus live conservation test.</li>
    </ul>

    <h2 style="color:#f3f6f8; font-size:15px; margin-bottom:8px;">The engine behind the GUI</h2>
    <pre style="background:#12171b; border:1px solid #232c33; padding:10px 14px; border-radius:4px; font:12px/1.6 Consolas,monospace; color:#8fd0f0; overflow-x:auto; max-width:860px; margin-bottom:16px;">physics.py    first-principles furnace model (mass, energy, kinetics, refractory)
thermo.py     Wagner activities, equilibria, theoretical energy floor
ekf.py        Extended Kalman virtual temperature sensor
ml.py         hybrid GP-residual + GBM endpoint model, drift monitor
chargemix.py  least-cost charge LP with tramp shadow prices
mpc.py        receding-horizon power / tap-time advice
advisory.py   bilingual traffic-light operator guidance
simulator.py  virtual plant for rehearsal &amp; ML data generation
metrics.py    hit-rates, PSI, economics
calibrate.py  per-plant calibration</pre>

    <h2 style="color:#f3f6f8; font-size:15px; margin-bottom:8px;">Verified parameters (v0.5 literature pass)</h2>
    <pre style="background:#12171b; border:1px solid #232c33; padding:10px 14px; border-radius:4px; font:12px/1.6 Consolas,monospace; color:#8fd0f0; overflow-x:auto; max-width:860px; margin-bottom:16px;">latent heat of fusion   272 → 247 kJ/kg           CRC Handbook 104th ed.
(FeO)+[C]→Fe+CO         1.89 → 1.39 MJ/kg FeO      Turkdogan; Fruehan MSTS
FeSi75 heat of solution −1150 → −3511 kJ/kg        Sigworth &amp; Elliott 1974
carburiser              +2500 → +1883 kJ/kg C      graphite dissolution
grid emission factor    0.82 → 0.712 tCO₂/MWh      CEA v21.0, FY2024-25</pre>

    <h2 style="color:#f3f6f8; font-size:15px; margin-bottom:8px;">How to run (local dev)</h2>
    <pre style="background:#12171b; border:1px solid #232c33; padding:10px 14px; border-radius:4px; font:12px/1.6 Consolas,monospace; color:#8fd0f0; overflow-x:auto; max-width:860px; margin-bottom:16px;"># Backend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (open in browser)
# Set window.SMARTMELT_API_URL = 'http://localhost:8000' in browser console
# Or serve frontend/ with any static server, e.g.:
npx serve frontend/</pre>

    <p class="thin-note" style="max-width:860px;">
      Figures are indicative until sized against a plant's audited baseline.
      This tool supports operators and managers; it does not replace metallurgical judgement or plant safety systems.
    </p>`;
}
