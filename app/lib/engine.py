"""
SmartMelt Studio — engine bridge.

Everything the Streamlit UI shows comes through this module. It calls the REAL
`smartmelt` package (physics core, EKF virtual sensor, hybrid ML, charge-mix LP,
MPC, drift monitor) and returns tidy pandas/numpy structures the pages render.

No physics lives here — this is a thin, cached adapter so the app never
re-implements the model and never drifts from the validated library.
"""
from __future__ import annotations

import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# Make the package importable whether the app is launched from repo root or /app
_HERE = Path(__file__).resolve()
_PKG_ROOT = _HERE.parents[2]  # .../smartmelt_model
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

import smartmelt as sm  # noqa: E402
from smartmelt import (  # noqa: E402
    FurnaceModel,
    HeatInputs,
    VirtualPlant,
    HybridEndpointModel,
    ChargeMixOptimiser,
    Material,
    MeltMPC,
    build_default_ekf,
    load_config,
)
from smartmelt.physics import make_addition  # noqa: E402
from smartmelt.thermo import KELVIN  # noqa: E402

CONFIG_DIR = _PKG_ROOT / "configs"
VERSION = getattr(sm, "__version__", "0.5.0")


# ────────────────────────────────────────────────────────────────────────────
# Config discovery
# ────────────────────────────────────────────────────────────────────────────
def available_configs() -> Dict[str, Path]:
    out = {}
    if CONFIG_DIR.exists():
        for p in sorted(CONFIG_DIR.glob("*.yaml")):
            out[p.stem] = p
    return out


def get_config(path_or_name):
    cfgs = available_configs()
    if path_or_name in cfgs:
        return load_config(str(cfgs[path_or_name]))
    return load_config(str(path_or_name))


def config_summary(cfg) -> Dict[str, object]:
    """Human-readable snapshot of the plant file for the sidebar / Home."""
    g = cfg.geometry
    e = cfg.economics
    th = cfg.thermal
    return {
        "Furnace type": getattr(cfg.plant, "furnace_type", "IF"),
        "Heat size (t)": round(getattr(cfg.plant, "heat_size_kg", 12000) / 1000, 1),
        "Tap aim (°C)": getattr(cfg.plant, "tap_temperature_C", 1620),
        "Rated power (kW)": getattr(cfg.electrical, "rated_power_kW", None),
        "Tariff (₹/kWh)": e.tariff_INR_per_kWh,
        "Grid EF (tCO₂/MWh)": e.grid_EF_tCO2_per_MWh,
        "Baseline SEC (kWh/t)": e.baseline_SEC_kWh_per_t,
        "L_fusion (kJ/kg)": th.L_fusion_kJ_kg,
        "Metal species": ", ".join(cfg.metal_species),
        "Slag species": ", ".join(cfg.slag_species),
    }


# ────────────────────────────────────────────────────────────────────────────
# Charge presets & additions
# ────────────────────────────────────────────────────────────────────────────
DEFAULT_CHARGE_COMP = {
    "C": 0.006, "Si": 0.0022, "Mn": 0.0035,
    "P": 0.00035, "S": 0.0003, "Cu": 0.002,
}

ADDITION_LIBRARY = {
    # flux / slag formers (into slag)
    "Lime (92% CaO)":   dict(kind="lime",       comp={"CaO": 0.92, "SiO2": 0.04}, into="slag"),
    "Dolomite":         dict(kind="dolomite",   comp={"CaO": 0.55, "MgO": 0.38},  into="slag"),
    "Fluorspar (CaF2)": dict(kind="lime",       comp={"CaF2": 0.90, "SiO2": 0.05}, into="slag"),
    "Bauxite (Al2O3)":  dict(kind="lime",       comp={"Al2O3": 0.55, "SiO2": 0.10}, into="slag"),
    # oxidisers / coolants (into slag – release O to bath)
    "Mill scale (FeO)": dict(kind="mill_scale", comp={"FeO": 0.97, "SiO2": 0.02}, into="slag"),
    "Iron ore (Fe2O3)": dict(kind="mill_scale", comp={"Fe2O3": 0.95, "SiO2": 0.03}, into="slag"),
    # ferro-alloys & recarburiser (into metal)
    "FeSi75":           dict(kind="FeSi75",     comp={"Si": 0.75, "Fe": 0.25},    into="metal"),
    "FeSi45":           dict(kind="FeSi75",     comp={"Si": 0.45, "Fe": 0.55},    into="metal"),
    "SiMn":             dict(kind="SiMn",       comp={"Si": 0.18, "Mn": 0.65, "Fe": 0.17}, into="metal"),
    "FeMn (HC)":        dict(kind="FeMn",       comp={"Mn": 0.78, "C": 0.06, "Fe": 0.16}, into="metal"),
    "FeCr (HC)":        dict(kind="FeMn",       comp={"Cr": 0.65, "C": 0.06, "Fe": 0.29}, into="metal"),
    "Carburiser":       dict(kind="carburiser", comp={"C": 0.99},                 into="metal"),
    "Aluminium (deox)": dict(kind="FeSi75",     comp={"Al": 0.98, "Fe": 0.02},    into="metal"),
    # metallic charge materials (into metal)
    "DRI / sponge":     dict(kind="DRI",        comp={"Fe": 0.86, "FeO": 0.08, "C": 0.02}, into="metal"),
    "Pig iron":         dict(kind="pig_iron",   comp={"Fe": 0.94, "C": 0.042, "Si": 0.01}, into="metal"),
    "HBI":              dict(kind="DRI",        comp={"Fe": 0.90, "FeO": 0.05, "C": 0.015}, into="metal"),
    "Hot heel (return)":dict(kind="pig_iron",   comp={"Fe": 0.985, "C": 0.004},   into="metal"),
}


# A broad scrap/charge library for the charge-mix optimiser and manual blending.
# Compositions are wt-fraction; prices ₹/kg are indicative and operator-editable.
# yield_ = metallic recovery; energy = kWh/kg to melt & superheat that stream.
# Sources for typical assays: steel-scrap grade specifications (ISRI / BIS),
# secondary-steelmaking practice; tramp Cu/Sn are the grade-limiting elements.
SCRAP_LIBRARY = [
    dict(name="Shredded auto",      price=42.0, Fe=0.955, Cu=0.0035, Sn=0.0012, C=0.003, Mn=0.006, yield_=0.94, energy=0.62),
    dict(name="HMS #1",             price=39.0, Fe=0.970, Cu=0.0018, Sn=0.0004, C=0.004, Mn=0.005, yield_=0.94, energy=0.60),
    dict(name="HMS #2",             price=35.0, Fe=0.955, Cu=0.0040, Sn=0.0010, C=0.006, Mn=0.006, yield_=0.92, energy=0.63),
    dict(name="Bushling (clean)",   price=48.0, Fe=0.980, Cu=0.0008, Sn=0.0002, C=0.002, Mn=0.004, yield_=0.96, energy=0.58),
    dict(name="Busheling prime",    price=50.0, Fe=0.982, Cu=0.0006, Sn=0.0001, C=0.002, Mn=0.003, yield_=0.96, energy=0.57),
    dict(name="Plate & structural", price=41.0, Fe=0.972, Cu=0.0015, Sn=0.0003, C=0.010, Mn=0.008, yield_=0.95, energy=0.60),
    dict(name="Turnings/borings",   price=30.0, Fe=0.930, Cu=0.0030, Sn=0.0008, C=0.015, Mn=0.006, yield_=0.88, energy=0.70),
    dict(name="Cast iron scrap",    price=37.0, Fe=0.930, Cu=0.0020, Sn=0.0005, C=0.035, Mn=0.006, yield_=0.94, energy=0.55),
    dict(name="Pig iron",           price=46.0, Fe=0.945, Cu=0.0003, Sn=0.0001, C=0.042, Mn=0.004, yield_=0.97, energy=0.55),
    dict(name="DRI / sponge iron",  price=36.0, Fe=0.860, Cu=0.0002, Sn=0.0000, C=0.020, Mn=0.001, yield_=0.90, energy=0.72),
    dict(name="HBI",                price=38.0, Fe=0.900, Cu=0.0002, Sn=0.0000, C=0.015, Mn=0.001, yield_=0.92, energy=0.68),
    dict(name="Bundles/baled",      price=33.0, Fe=0.950, Cu=0.0028, Sn=0.0009, C=0.005, Mn=0.006, yield_=0.90, energy=0.66),
    dict(name="Tin-plate/light",    price=26.0, Fe=0.930, Cu=0.0015, Sn=0.0050, C=0.004, Mn=0.005, yield_=0.85, energy=0.72),
    dict(name="Rail crop",          price=44.0, Fe=0.968, Cu=0.0010, Sn=0.0002, C=0.060, Mn=0.011, yield_=0.96, energy=0.58),
    dict(name="Rebar crop",         price=40.0, Fe=0.970, Cu=0.0020, Sn=0.0004, C=0.025, Mn=0.009, yield_=0.95, energy=0.59),
    dict(name="Home/internal scrap",price=32.0, Fe=0.975, Cu=0.0012, Sn=0.0002, C=0.008, Mn=0.007, yield_=0.96, energy=0.58),
    dict(name="Cr-alloy scrap",     price=70.0, Fe=0.820, Cu=0.0010, Sn=0.0002, C=0.008, Mn=0.006, Cr=0.16, yield_=0.95, energy=0.60),
]


@dataclass
class AdditionSpec:
    material: str
    time_min: float
    mass_kg: float


def build_additions(specs: List[AdditionSpec]) -> List:
    adds = []
    for sp in specs:
        lib = ADDITION_LIBRARY[sp.material]
        comp = _normalise_oxides(lib["comp"])
        adds.append(make_addition(sp.time_min * 60.0, sp.mass_kg,
                                  comp, lib["kind"], into=lib["into"]))
    return adds


# ────────────────────────────────────────────────────────────────────────────
# Core: run one heat and tidy every diagnostic into a single DataFrame
# ────────────────────────────────────────────────────────────────────────────
@dataclass
class HeatResult:
    df: pd.DataFrame                 # per-time-step tidy frame
    endpoint: Dict[str, float]
    energy: Dict[str, float]
    ledger_max_pct: float
    ledger_df: pd.DataFrame
    tap_min: float
    undissolved_kg: float
    meta: Dict[str, object] = field(default_factory=dict)


def run_heat(
    cfg,
    charge_kg: float,
    comp: Dict[str, float],
    power_kW: float,
    hot_heel_frac: float = 0.08,
    additions: Optional[List] = None,
    dt: float = 2.0,
    t_end_min: float = 160.0,
    power_drop_at_min: Optional[float] = 70.0,
    power_drop_kW: Optional[float] = None,
    stop_on_tap: bool = True,
) -> HeatResult:
    """Simulate a single heat with a simple two-stage power program."""
    m = FurnaceModel(cfg)
    x0 = m.initial_state(charge_kg, comp, hot_heel_kg=hot_heel_frac * charge_kg)

    p_hi = power_kW
    p_lo = power_drop_kW if power_drop_kW is not None else max(power_kW * 0.55, 1000.0)
    t_drop = (power_drop_at_min or 1e9) * 60.0

    def P(t):
        return p_hi if t < t_drop else p_lo

    u = HeatInputs(P, lambda t: 0.0, additions or [])

    tap_C = getattr(cfg.plant, "tap_temperature_C", 1620)

    def stop(t, x):
        return (x[m.iTb] - KELVIN) >= tap_C and x[m.iMs] < 0.02 * charge_kg

    tr = m.simulate(x0, u, t_end_min * 60.0, dt=dt,
                    stop_fn=stop if stop_on_tap else None)

    df = _tidy_trajectory(m, tr, cfg)
    ep = m.endpoint(tr)
    en = dict(m.energy_audit(tr, dt=dt))
    # Add a first-law closure the pages can read as 'residual_pct'. The audit
    # reports gross terms; closure = (energy_in − energy_out) / energy_in.
    try:
        e_in = en.get("grid_kWh", 0.0) + en.get("chemical_in_kWh", 0.0)
        e_out = (en.get("useful_melt_kWh", 0.0)
                 + en.get("converter_loss_kWh", 0.0)
                 + en.get("coil_water_loss_kWh", 0.0)
                 + en.get("lining_loss_kWh", 0.0)
                 + en.get("radiation_loss_kWh", 0.0)
                 + en.get("offgas_loss_kWh", 0.0))
        en["residual_pct"] = 100.0 * (e_in - e_out) / e_in if e_in > 0 else float("nan")
    except Exception:
        en["residual_pct"] = float("nan")
    lb = m.element_balance(tr, u, charge_kg, comp, hot_heel_kg=hot_heel_frac * charge_kg)
    ledger_max = float(np.abs(lb["closure_pct"]).max()) if "closure_pct" in lb else float("nan")

    return HeatResult(
        df=df, endpoint=ep, energy=en,
        ledger_max_pct=ledger_max, ledger_df=lb,
        tap_min=float(tr.t[-1] / 60.0), undissolved_kg=float(tr.undissolved_kg),
        meta={"charge_kg": charge_kg, "power_kW": power_kW, "tap_aim_C": tap_C},
    )


def _normalise_oxides(comp):
    """Map oxide species that the slag model does not carry onto the ones it does,
    conserving the metal cation by mass. Critically, ferric oxide (Fe2O3) and
    magnetite (Fe3O4) report as FeO so that iron ore and scale both deliver
    reducible iron oxide to the slag. The 'extra' oxygen in the higher oxides is
    small and is neglected at the addition step (the reduction kinetics act on the
    FeO inventory, which is what matters for (FeO)+[C]->Fe+CO)."""
    MW = {"Fe": 55.85, "O": 16.0, "FeO": 71.85, "Fe2O3": 159.69, "Fe3O4": 231.53,
          "CaCO3": 100.09, "CaO": 56.08, "MgCO3": 84.31, "MgO": 40.30}
    out = {}
    for sp, frac in comp.items():
        if sp == "Fe2O3":
            # 1 kg Fe2O3 -> (2*71.85/159.69) kg FeO  (all iron reported as FeO)
            out["FeO"] = out.get("FeO", 0.0) + frac * (2 * MW["FeO"] / MW["Fe2O3"])
        elif sp == "Fe3O4":
            out["FeO"] = out.get("FeO", 0.0) + frac * (3 * MW["FeO"] / MW["Fe3O4"])
        elif sp == "CaCO3":
            out["CaO"] = out.get("CaO", 0.0) + frac * (MW["CaO"] / MW["CaCO3"])
        else:
            out[sp] = out.get(sp, 0.0) + frac
    return out


def make_addition_at(time_s, mass_kg, info):
    """Build an engine Addition from an ADDITION_LIBRARY entry at a given time,
    normalising oxides to species the slag model carries."""
    comp = _normalise_oxides(info["comp"])
    return make_addition(time_s, mass_kg, comp, info["kind"], into=info["into"])


def _copy_dissolution_pool(pool):
    """Cheap, mutation-safe copy of the live undissolved-addition pool."""
    return [{"add": item["add"], "m": float(item["m"])} for item in (pool or [])]


def _set_solid_composition(model, comp):
    """Restore charge composition when continuing from a saved state vector."""
    arr = np.array([comp.get(sp, 0.0) for sp in model.metal], dtype=float)
    i_fe = model.metal.index("Fe")
    if arr[i_fe] <= 0.0:
        arr[i_fe] = max(0.0, 1.0 - arr.sum())
    arr = np.maximum(arr, 0.0)
    total = float(arr.sum())
    if total <= 0.0:
        arr[:] = 0.0
        arr[i_fe] = 1.0
    else:
        arr /= total
    model.solid_comp = arr


def _simulate_frames_core(cfg, charge_t, comp, power_kW, additions=None, dt=2.0,
                          t_end_min=95.0, from_state=None, t0_s=0.0,
                          from_pool=None, collect_checkpoints=False,
                          cooperative_yield_every=0,
                          cooperative_yield_s=0.0):
    """Shared live simulator with optional exact continuation checkpoints.

    ``cooperative_yield_*`` is used only by the browser background worker.  It
    briefly yields the Python GIL at regular intervals so Streamlit can keep
    serving fragment updates while a CPU-heavy heat continuation is running.
    The physics time step and equations are unchanged.
    """
    import time as _time

    m = FurnaceModel(cfg)
    charge_kg = charge_t * 1000.0
    m._charge_comp_pct = {k: 100.0 * v for k, v in comp.items()}
    if from_state is None:
        x = m.initial_state(charge_kg, comp, hot_heel_kg=0.08 * charge_kg)
    else:
        x = np.asarray(from_state, dtype=float).copy()
        _set_solid_composition(m, comp)
    species = list(m.metal)
    u = HeatInputs(lambda t: power_kW, lambda t: 0.0, additions or [])
    # A continued state already contains all additions strictly before t0.  An
    # addition stamped exactly at t0 must still enter before the next step.
    pending = [a for a in sorted((additions or []), key=lambda a: a.time_s)
               if a.time_s >= float(t0_s) - 1e-9]
    ai = 0
    pool = _copy_dissolution_pool(from_pool)
    frames = []
    states = []
    pools = []
    t = float(t0_s)
    n = int((t_end_min * 60 - t) / dt)
    for i in range(max(n, 1)):
        while ai < len(pending) and pending[ai].time_s <= t + 1e-9:
            a = pending[ai]
            if a.into == "solid" or getattr(a, "tau_s", 0.0) <= 0.0:
                x = m._apply_addition(x, a)
            else:
                pool.append({"add": a, "m": float(a.mass_kg)})
            ai += 1
        if pool:
            x = m._release_dissolving(x, pool, dt)
        diag = {}
        x = m.step(t, x, u, dt, diag=diag)
        t += dt
        snap = state_snapshot(m, x, diag, charge_kg, species, t)
        snap["undissolved_kg"] = sum(max(0.0, float(p["m"])) for p in pool)
        frames.append(snap)
        if collect_checkpoints:
            states.append(x.copy())
            pools.append(_copy_dissolution_pool(pool))
        if cooperative_yield_every and (i + 1) % int(cooperative_yield_every) == 0:
            _time.sleep(max(0.0, float(cooperative_yield_s)))
    return frames, m, x, species, states, pools


def simulate_frames(cfg, charge_t, comp, power_kW, additions=None, dt=2.0,
                    t_end_min=95.0, from_state=None, t0_s=0.0):
    """Simulate a heat and return per-step snapshots for GUI playback.

    The public return contract remains unchanged.  The Streamlit console uses
    :func:`simulate_frames_live` below to retain exact continuation states.
    """
    frames, m, x, species, _, _ = _simulate_frames_core(
        cfg, charge_t, comp, power_kW, additions=additions, dt=dt,
        t_end_min=t_end_min, from_state=from_state, t0_s=t0_s)
    return frames, m, x, species


def simulate_frames_live(cfg, charge_t, comp, power_kW, additions=None, dt=2.0,
                         t_end_min=95.0, from_state=None, t0_s=0.0,
                         from_pool=None, cooperative=True):
    """Live-console simulation with state/pool checkpoints for fast additions.

    Returns ``(frames, states, pools)``.  A new material addition can therefore
    continue from the exact current state instead of recalculating the whole
    heat from minute zero.  ``states[j]`` and ``pools[j]`` correspond exactly to
    ``frames[j]``.
    """
    frames, _, _, _, states, pools = _simulate_frames_core(
        cfg, charge_t, comp, power_kW, additions=additions, dt=dt,
        t_end_min=t_end_min, from_state=from_state, t0_s=t0_s,
        from_pool=from_pool, collect_checkpoints=True,
        cooperative_yield_every=10 if cooperative else 0,
        cooperative_yield_s=0.0015 if cooperative else 0.0)
    if states:
        states = np.stack(states, axis=0)
    else:
        states = np.empty((0, 0), dtype=float)
    return frames, states, pools


def build_advisories(snap, cfg, projected_tap_C=None):
    """Produce operator advisory verdicts matching the HTML console: temperature,
    carbon, slag (B2/FeO), and specific energy. Each returns (level, title, msg)
    where level is 'ok' | 'warn' | 'bad'. Advice is actionable and metallurgical."""
    aim = getattr(cfg.plant, "tap_temperature_C", 1620)
    clo = getattr(cfg.plant, "aim_C_lo_pct", 0.05)
    chi = getattr(cfg.plant, "aim_C_hi_pct", 0.25)
    baseline = getattr(cfg.economics, "baseline_SEC_kWh_per_t", 600.0)
    out = []

    # 1) Bath temperature (use projected tap T if given, else current bath)
    T = projected_tap_C if projected_tap_C is not None else snap["T_bath_C"]
    dT = T - aim
    if abs(dT) <= 15:
        out.append(("ok", "Bath temperature", f"Tap T {T:.0f} °C on aim (±15)"))
    elif dT > 15:
        lvl = "bad" if dT > 30 else "warn"
        out.append((lvl, "Bath temperature",
                    f"Tap T {T:.0f} °C is +{dT:.0f} above aim — step power down / tap earlier"))
    else:
        lvl = "bad" if dT < -30 else "warn"
        out.append((lvl, "Bath temperature",
                    f"Tap T {T:.0f} °C is {dT:.0f} below aim — hold power / delay tap"))

    # 2) Carbon
    C = snap["pct_C"]
    if C > chi:
        lvl = "bad" if C > chi + 0.05 else "warn"
        out.append((lvl, "Carbon",
                    f"C {C:.3f}% above {chi:.2f} — add mill scale / iron ore to decarburise"))
    elif C < clo:
        out.append(("warn", "Carbon",
                    f"C {C:.3f}% below {clo:.2f} — add carburiser / recarburise"))
    else:
        out.append(("ok", "Carbon", f"C {C:.3f}% inside aim {clo:.2f}–{chi:.2f}"))

    # 3) Slag basicity B2
    b2 = snap["B2"]
    if b2 < 1.0:
        out.append(("warn", "Basicity B2",
                    f"B2 {b2:.2f} low — add lime to raise basicity (target ≥ 1.5)"))
    elif b2 > 3.0:
        out.append(("warn", "Basicity B2",
                    f"B2 {b2:.2f} high — slag stiff, check fluidity / add fluorspar"))
    else:
        out.append(("ok", "Basicity B2", f"B2 {b2:.2f} in range (CaO/SiO₂)"))

    # 4) Slag FeO level
    feo = snap["slag_FeO_pct"]
    if feo > 25:
        out.append(("bad", "Slag FeO level",
                    f"FeO {feo:.1f}% very high — over-oxidised bath, Fe yield loss; "
                    f"add carbon / reduce O₂"))
    elif feo > 15:
        out.append(("warn", "Slag FeO level",
                    f"FeO {feo:.1f}% high — check oxidation, recover Fe with carbon"))
    else:
        out.append(("ok", "Slag FeO level", f"FeO {feo:.1f}% acceptable"))

    # 5) B2 / FeO combined health
    if b2 >= 1.5 and feo <= 15:
        out.append(("ok", "B2 / FeO health", f"B2 {b2:.2f}, FeO {feo:.1f}% — well-conditioned slag"))
    else:
        out.append(("warn", "B2 / FeO health",
                    f"B2 {b2:.2f}, FeO {feo:.1f}% — adjust lime / oxidation balance"))

    # 6) Specific energy
    sec = snap["SEC_kWh_t"]
    if sec > baseline:
        out.append(("warn", "Specific energy",
                    f"{sec:.0f} kWh/t above baseline {baseline:.0f} — check power taper & lid time"))
    else:
        out.append(("ok", "Specific energy", f"{sec:.0f} kWh/t vs baseline {baseline:.0f}"))

    return out


def make_live_model(cfg, charge_t, comp):
    """Build a FurnaceModel + initial state for step-by-step live running.
    Returns (model, x0, metal_species). The console steps this incrementally
    and can inject additions at any moment (true interactive operation)."""
    m = FurnaceModel(cfg)
    charge_kg = charge_t * 1000.0
    x0 = m.initial_state(charge_kg, comp, hot_heel_kg=0.08 * charge_kg)
    species = list(getattr(cfg, "metal_species", ["Fe", "C", "Si", "Mn", "P", "S", "Cr", "Cu", "Ni"]))
    m._charge_comp_pct = {k: 100.0 * v for k, v in comp.items()}
    return m, x0, species, charge_kg


def state_snapshot(m, x, diag, charge_kg, species, t_s):
    """Compute the friendly KPI dict for one live state vector — using the SAME
    definitions as _tidy_trajectory so live values match the batch trajectory."""
    import numpy as _np
    Tb = x[m.iTb] - KELVIN
    Ts = x[m.iTs] - KELVIN
    metal = x[: m.nM]
    Ml = float(metal.sum())                    # liquid metal = sum of metal block
    Ms = float(x[m.iMs])                        # solid remaining
    melted = 100.0 * Ml / max(Ml + Ms, 1e-6)
    # Composition of the liquid pool. Before a real pool exists the ~1% hot heel
    # is not representative of the heat — its trace composition wobbles as it
    # exchanges with air. Until enough metal is molten we therefore report the
    # composition blended toward the charge/liquid average so the displayed
    # carbon does not drift spuriously during the solid-heating phase. Once the
    # pool is a meaningful fraction of the charge, this blend -> the pool value.
    pool_comp = {sp: 100.0 * float(metal[i]) / max(Ml, 1e-6) for i, sp in enumerate(m.metal)}
    w = float(_np.clip(Ml / max(0.20 * charge_kg, 1e-6), 0.0, 1.0))  # 0..1 as pool grows to 20%
    charge_comp = getattr(m, "_charge_comp_pct", None)
    if charge_comp is None:
        comp = pool_comp
    else:
        comp = {sp: w * pool_comp.get(sp, 0.0) + (1 - w) * charge_comp.get(sp, 0.0)
                for sp in m.metal}
    slag_names = list(m.slag)
    slag = x[m.nM: m.nM + m.nS]
    slag_kg = {slag_names[i]: float(slag[i]) for i in range(len(slag_names))}
    slag_tot = max(sum(slag_kg.values()), 0.1)
    feo_pct = 100.0 * slag_kg.get("FeO", 0.0) / slag_tot
    b2 = slag_kg.get("CaO", 0.0) / max(slag_kg.get("SiO2", 1e-6), 1e-6)
    E_kWh = float(x[m.iE])
    tt = (Ml + Ms) / 1000.0
    return dict(
        t_min=t_s / 60.0, T_bath_C=Tb, T_solid_C=Ts, melted_pct=melted,
        M_liquid_t=Ml / 1000.0, M_solid_t=Ms / 1000.0,
        pct_C=comp.get("C", 0.0), pct_Si=comp.get("Si", 0.0), pct_Mn=comp.get("Mn", 0.0),
        pct_P=comp.get("P", 0.0), pct_S=comp.get("S", 0.0),
        slag_FeO_pct=feo_pct, B2=b2, slag_total_kg=slag_tot,
        slag_FeO_kg=slag_kg.get("FeO", 0.0), slag_CaO_kg=slag_kg.get("CaO", 0.0),
        slag_SiO2_kg=slag_kg.get("SiO2", 0.0), slag_MgO_kg=slag_kg.get("MgO", 0.0),
        slag_MnO_kg=slag_kg.get("MnO", 0.0),
        E_kWh=E_kWh, SEC_kWh_t=E_kWh / max(tt, 0.1),
        Q_useful_kW=diag.get("P_use", float("nan")),
        Q_wall_kW=diag.get("Q_wall", float("nan")),
        Q_rad_kW=diag.get("Q_rad", float("nan")),
        Q_chem_kW=diag.get("Q_chem", float("nan")),
        undissolved_kg=diag.get("m_undissolved", 0.0),
    )


def _tidy_trajectory(m: FurnaceModel, tr, cfg) -> pd.DataFrame:
    """Flatten a Trajectory into a per-step DataFrame with friendly columns."""
    t = tr.t
    X = tr.X
    d = tr.diagnostics
    Ml = X[:, : m.nM].sum(axis=1)
    Ms = X[:, m.iMs]
    slag_tot = X[:, m.nM : m.nM + m.nS].sum(axis=1)

    out = {"t_min": t / 60.0, "t_s": t}
    out["T_bath_C"] = X[:, m.iTb] - KELVIN
    out["T_solid_C"] = X[:, m.iTs] - KELVIN
    out["T_hotface_C"] = d.get("T_hotface", np.full_like(t, np.nan))
    out["M_liquid_t"] = Ml / 1000.0
    out["M_solid_t"] = Ms / 1000.0
    out["melted_pct"] = 100.0 * Ml / np.maximum(Ml + Ms, 1e-6)
    out["undissolved_kg"] = d.get("m_undissolved", np.zeros_like(t))
    out["f_liquid"] = d.get("f_liq", np.full_like(t, np.nan))

    # metal composition (wt%)
    for el in m.metal:
        out[f"pct_{el}"] = 100.0 * X[:, m.metal.index(el)] / np.maximum(Ml, 1e-6)
    # slag inventory (kg) + key wt%
    for sp in m.slag:
        out[f"slag_{sp}_kg"] = X[:, m.nM + m.slag.index(sp)]
    out["slag_FeO_pct"] = 100.0 * X[:, m.nM + m.slag.index("FeO")] / np.maximum(slag_tot, 1e-6)
    out["B2"] = X[:, m.nM + m.slag.index("CaO")] / np.maximum(
        X[:, m.nM + m.slag.index("SiO2")], 1e-6)

    # energy
    out["E_kWh"] = X[:, m.iE]
    tt = (Ml + Ms) / 1000.0
    out["SEC_kWh_t"] = X[:, m.iE] / np.maximum(tt, 0.1)

    # heat flows (kW)
    for key, col in [("P_use", "Q_useful_kW"), ("Q_wall", "Q_wall_kW"),
                     ("Q_rad", "Q_rad_kW"), ("Q_s", "Q_bath_to_scrap_kW"),
                     ("Q_chem", "Q_chem_kW"), ("Q_cool", "Q_cool_kW"),
                     ("Q_gas", "Q_offgas_kW")]:
        if key in d:
            out[col] = d[key]

    # reaction rates & equilibria (diagnostics that exist)
    for key, col in [("r_C", "rate_C"), ("r_Si", "rate_Si"), ("r_Mn", "rate_Mn"),
                     ("r_P", "rate_P"), ("a_FeO", "a_FeO"), ("C_eq", "C_eq_pct"),
                     ("L_P", "L_P"), ("L_S", "L_S")]:
        if key in d:
            out[col] = d[key]

    return pd.DataFrame(out)


# ────────────────────────────────────────────────────────────────────────────
# EKF virtual sensor — track a MISMATCHED plant, assimilating immersion dips
# ────────────────────────────────────────────────────────────────────────────
@dataclass
class EKFResult:
    df: pd.DataFrame
    dip_df: pd.DataFrame
    final_error_C: float
    theta_path: pd.DataFrame


def load_default_ekf():
    """Load the pre-computed default EKF demo (ships with the package) so the
    Virtual Sensor tab opens instantly. A live EKF run recomputes finite-
    difference Jacobians over a 34-state model (~1 min); that happens only when
    the user explicitly requests it."""
    import pickle
    cache_file = Path(__file__).resolve().parents[2] / "gui" / "cache" / "ekf_default.pkl"
    if cache_file.exists():
        try:
            with open(cache_file, "rb") as f:
                d = pickle.load(f)
            return EKFResult(df=d["df"], dip_df=d["dip_df"],
                             final_error_C=d["final_error_C"], theta_path=d["theta_path"])
        except Exception:
            # Optional cache formats may depend on pyarrow. The live calculation
            # remains available and the desktop/Streamlit GUI must still open.
            return None
    return None


def load_cached_dataset():
    """Load the pre-computed virtual-plant dataset (ships with the package) so
    the Machine-Learning and Drift tabs work instantly. Live generation runs the
    full physics simulator (~3–4 s/heat) and is offered as an explicit action."""
    cache_file = Path(__file__).resolve().parents[2] / "gui" / "cache" / "dataset_60.pkl"
    if cache_file.exists():
        try:
            return pd.read_pickle(cache_file)
        except Exception:
            pass
    # Portable fallback that does not require pyarrow-backed pickle objects.
    csv_file = Path(__file__).resolve().parents[2] / "examples" / "heats_if_90.csv"
    if csv_file.exists():
        try:
            return pd.read_csv(csv_file)
        except Exception:
            pass
    return None


def run_ekf_demo(
    cfg,
    charge_kg: float = 12000.0,
    power_kW: float = 5000.0,
    true_eta: float = 0.90,
    true_UA_scale: float = 1.35,
    dip_times_min: Tuple[float, ...] = (35.0, 55.0, 72.0),
    dt: float = 5.0,
    t_end_min: float = 85.0,
    seed: int = 0,
) -> EKFResult:
    """
    A deliberately mismatched 'true' plant vs the model's prior. The EKF only
    sees noisy immersion-dip temperatures and must converge bath temperature and
    the hidden efficiency within one heat.
    """
    rng = np.random.default_rng(seed)
    comp = dict(DEFAULT_CHARGE_COMP)

    # true (hidden) plant, deliberately off the model's prior
    truth = FurnaceModel(cfg, theta={"eta_electrical": true_eta,
                                     "UA_lining_scale": true_UA_scale})
    x0t = truth.initial_state(charge_kg, comp, hot_heel_kg=0.08 * charge_kg)
    u = HeatInputs(lambda t: power_kW, lambda t: 0.0, [])
    trt = truth.simulate(x0t, u, t_end_min * 60.0, dt=dt)

    # estimator model (prior theta = 1.0) + default EKF (3 theta keys)
    nominal = FurnaceModel(cfg)
    ekf = build_default_ekf(nominal, u)
    nx = nominal.n_state
    P0 = np.zeros((nx + 3, nx + 3))
    P0[nominal.iTb, nominal.iTb] = 20.0 ** 2
    P0[nominal.iMs, nominal.iMs] = 100.0 ** 2
    for i in range(nominal.nM):
        P0[i, i] = 20.0 ** 2
    P0[nx:, nx:] = np.diag([0.05 ** 2, 0.20 ** 2, 0.25 ** 2])
    ekf.init(x0t.copy(), P0)

    sig_pyro = getattr(cfg.sensors, "sigma_T_pyrometer_C", 12.0)
    sig_dip = getattr(cfg.sensors, "sigma_T_immersion_C", 8.0)
    dip_times_s = sorted(t * 60.0 for t in dip_times_min)

    rows, dips, thetas = [], [], []
    di = 0
    stride = max(1, int(round(30.0 / dt)))            # ~30 s assimilation cadence
    for k in range(0, len(trt.t), stride):
        t = float(trt.t[k])
        ekf.predict(t, u, dt * stride)
        Tt = trt.X[k, truth.iTb] - KELVIN
        Te_before = ekf.bath_temperature_C()

        # continuous pyrometer + intermittent immersion dip
        y = np.array([
            Tt + rng.normal(0, sig_pyro),
            0.0,
            (trt.X[k, :truth.nM].sum() + trt.X[k, truth.iMs]) / 1000.0
            + rng.normal(0, 0.05),
        ])
        act = np.array([True, False, True])
        if di < len(dip_times_s) and t >= dip_times_s[di]:
            y[1] = Tt + rng.normal(0, sig_dip)
            act[1] = True
            dips.append({"t_min": t / 60.0, "T_meas_C": y[1],
                         "T_est_before_C": Te_before,
                         "sigma_before": ekf.sigma_T()})
            di += 1
        ekf.update(y, act)

        rows.append({"t_min": t / 60.0, "T_true_C": Tt,
                     "T_est_C": ekf.bath_temperature_C(),
                     "sigma_T": ekf.sigma_T()})
        thetas.append({"t_min": t / 60.0,
                       "eta_electrical": float(ekf.theta["eta_electrical"]),
                       "UA_lining_scale": float(ekf.theta["UA_lining_scale"])})

    df = pd.DataFrame(rows)
    dip_df = pd.DataFrame(dips)
    theta_df = pd.DataFrame(thetas)
    final_err = float(df["T_est_C"].iloc[-1] - df["T_true_C"].iloc[-1])
    return EKFResult(df=df, dip_df=dip_df, final_error_C=final_err, theta_path=theta_df)


# ────────────────────────────────────────────────────────────────────────────
# Virtual plant dataset + hybrid ML endpoint model
# ────────────────────────────────────────────────────────────────────────────
def generate_dataset(cfg, n_heats: int = 90, seed: int = 0,
                     regime_change_at: Optional[int] = None) -> pd.DataFrame:
    vp = VirtualPlant(cfg, seed=seed, regime_change_at=regime_change_at)
    return vp.generate(n_heats)


@dataclass
class MLResult:
    train_df: pd.DataFrame
    test_df: pd.DataFrame
    metrics: Dict[str, float]
    pred_df: pd.DataFrame           # test-set predictions vs truth


def train_hybrid(cfg, df: pd.DataFrame, split_frac: float = 0.7) -> MLResult:
    """Time-ordered split, fit the hybrid physics+GP-residual head, score on the tail.

    `predict` returns two lists of Prediction objects (temperature, carbon), each
    carrying .value (physics+ML), .sigma (calibrated), .phys (physics-only) and
    .maturity. We surface all three so the page can show the ML lift over physics.
    """
    n = len(df)
    k = max(int(n * split_frac), 5)
    train, test = df.iloc[:k].copy(), df.iloc[k:].copy()

    model = HybridEndpointModel(cfg)
    model.fit(train)
    preds_T, preds_C = model.predict(test)   # batch

    def field(objs, name, default=np.nan):
        return np.array([float(getattr(o, name, default)) for o in objs], dtype=float)

    pred_df = pd.DataFrame({
        "heat": np.arange(len(test)),
        "T_true_C": test.get("true_T_C", pd.Series(np.nan, index=test.index)).to_numpy(float),
        "T_pred_C": field(preds_T, "mean"),
        "T_phys_C": field(preds_T, "physics"),
        "T_sigma": field(preds_T, "sigma"),
        "C_true": test.get("true_C_pct", pd.Series(np.nan, index=test.index)).to_numpy(float),
        "C_pred": field(preds_C, "mean"),
        "C_phys": field(preds_C, "physics"),
        "C_sigma": field(preds_C, "sigma"),
    })

    met = _score(pred_df)
    met["maturity"] = getattr(model, "maturity", "?")
    met["ml_T_active"] = bool(getattr(model, "use_T", False))
    met["ml_C_active"] = bool(getattr(model, "use_C", False))
    met["n_train"] = k
    met["n_test"] = len(test)
    return MLResult(train_df=train, test_df=test, metrics=met, pred_df=pred_df)


def _collect_predictions(test: pd.DataFrame, preds: List) -> pd.DataFrame:
    """Normalise whatever predict() returns into T/C truth+pred columns.

    The virtual-plant dataset uses `true_T_C`/`true_C_pct` for ground truth,
    `meas_*` for the noisy measurement, and `phys_*` for the physics-only
    baseline. We compare the hybrid prediction against truth and also carry the
    physics-only baseline so the page can show the ML lift.
    """
    def col(df, *names):
        for nm in names:
            if nm in df:
                return df[nm].to_numpy(dtype=float)
        return np.full(len(df), np.nan)

    T_true = col(test, "true_T_C", "T_tap_C", "T_C")
    C_true = col(test, "true_C_pct", "pct_C", "C")
    T_phys = col(test, "phys_T_C")
    C_phys = col(test, "phys_C_pct")

    T_pred, C_pred, T_sig, C_sig = [], [], [], []
    for p in preds:
        d = p if isinstance(p, dict) else getattr(p, "__dict__", {})
        T_pred.append(_get(d, "T_pred_C", "T_C", "T"))
        C_pred.append(_get(d, "C_pred", "pct_C", "C"))
        T_sig.append(_get(d, "sigma_T", "T_sigma", default=np.nan))
        C_sig.append(_get(d, "sigma_C", "C_sigma", default=np.nan))

    return pd.DataFrame({
        "heat": np.arange(len(test)),
        "T_true_C": T_true, "T_pred_C": np.array(T_pred, dtype=float),
        "T_phys_C": T_phys,
        "C_true": C_true, "C_pred": np.array(C_pred, dtype=float),
        "C_phys": C_phys,
        "T_sigma": np.array(T_sig, dtype=float), "C_sigma": np.array(C_sig, dtype=float),
    })


def _get(d, *keys, default=np.nan):
    for k in keys:
        if k in d and d[k] is not None:
            return float(d[k])
    return default


def _score(p: pd.DataFrame) -> Dict[str, float]:
    def hit(true, pred, tol):
        m = np.isfinite(true) & np.isfinite(pred)
        if m.sum() == 0:
            return float("nan")
        return float((np.abs(true[m] - pred[m]) <= tol).mean() * 100.0)

    def mae(true, pred):
        m = np.isfinite(true) & np.isfinite(pred)
        return float(np.abs(true[m] - pred[m]).mean()) if m.sum() else float("nan")

    T, Tp, Tphys = p["T_true_C"].to_numpy(), p["T_pred_C"].to_numpy(), p.get("T_phys_C", pd.Series(np.nan)).to_numpy()
    C, Cp, Cphys = p["C_true"].to_numpy(), p["C_pred"].to_numpy(), p.get("C_phys", pd.Series(np.nan)).to_numpy()
    return {
        "T_hit_15C": hit(T, Tp, 15.0),
        "T_hit_10C": hit(T, Tp, 10.0),
        "T_MAE_C": mae(T, Tp),
        "T_hit_15C_phys": hit(T, Tphys, 15.0),
        "C_hit_002": hit(C, Cp, 0.02),
        "C_MAE": mae(C, Cp),
        "C_hit_002_phys": hit(C, Cphys, 0.02),
    }


# ────────────────────────────────────────────────────────────────────────────
# Drift monitor
# ────────────────────────────────────────────────────────────────────────────
def run_drift(cfg, df: pd.DataFrame, ref_frac: float = 0.5) -> Dict:
    """Set a reference window on the first part of the run, then check the tail
    for population drift (PSI) and prediction bias. Returns a tidy dict plus a
    per-feature PSI table."""
    from smartmelt import DriftMonitor
    k = max(int(len(df) * ref_frac), DriftMonitor.MIN_WINDOW if hasattr(DriftMonitor, "MIN_WINDOW") else 10)
    dm = DriftMonitor(cfg)
    dm.set_reference(df.iloc[:k])
    chk = dm.check(df.iloc[k:])
    psi = chk.get("psi", {})
    psi_df = pd.DataFrame(
        sorted(([f, float(v)] for f, v in psi.items()), key=lambda r: -r[1]),
        columns=["feature", "PSI"],
    )
    return {
        "psi_max": float(chk.get("psi_max", float("nan"))),
        "alarm": bool(chk.get("alarm", 0)),
        "reasons": list(chk.get("reasons", [])),
        "mape": chk.get("mape", None),
        "n_ref": k, "n_recent": len(df) - k,
        "psi_df": psi_df,
    }


# ────────────────────────────────────────────────────────────────────────────
# Charge-mix optimiser
# ────────────────────────────────────────────────────────────────────────────
def default_materials() -> List[Dict]:
    """The full scrap/charge library for the charge-mix optimiser and manual
    blending — 17 streams with indicative, operator-editable prices and assays."""
    return [dict(m) for m in SCRAP_LIBRARY]


def _to_materials(mats: List[Dict]) -> List:
    """Build engine Material objects, carrying all assay elements present."""
    elements = ("Fe", "Cu", "Sn", "C", "Mn", "Cr", "Si")
    out = []
    for mm in mats:
        comp = {k: mm[k] for k in elements if k in mm and mm[k]}
        out.append(Material(name=mm["name"], price_INR_per_kg=mm["price"],
                            composition=comp, metallic_yield=mm["yield_"],
                            energy_kWh_per_kg=mm["energy"]))
    return out


def solve_charge_mix(cfg, mats: List[Dict], target_t: float,
                     aim: Dict[str, Tuple[float, float]],
                     cu_limit: float,
                     tramp_limits: Optional[Dict[str, float]] = None
                     ) -> Tuple[object, Dict, List[Dict]]:
    materials = _to_materials(mats)
    opt = ChargeMixOptimiser(materials,
                             tariff_INR_per_kWh=cfg.economics.tariff_INR_per_kWh)
    tramp = {"Cu": cu_limit}
    if tramp_limits:
        tramp.update(tramp_limits)
    res = opt.solve(target_t * 1000.0, aim, tramp_limits=tramp)
    shadow = {}
    if getattr(res, "feasible", False):
        try:
            shadow = opt.shadow_prices(res, aim, tramp, target_t * 1000.0)
        except Exception:
            shadow = {}
    rows = _mix_rows(res, mats)
    return res, shadow, rows


def evaluate_manual_mix(cfg, mats: List[Dict], weights_kg: Dict[str, float]) -> Dict:
    """Evaluate an operator-specified blend (fixed weights) — no optimisation.
    Returns cost, liquid yield, energy and the predicted bath chemistry, so the
    operator can compare a hand-built charge against the optimiser's."""
    rows, total_cost, total_energy, liquid_kg = [], 0.0, 0.0, 0.0
    elem_kg = {}
    for mm in mats:
        w = float(weights_kg.get(mm["name"], 0.0))
        if w <= 0:
            continue
        y = mm["yield_"]
        liq = w * y
        liquid_kg += liq
        total_cost += w * mm["price"]
        total_energy += w * mm["energy"]
        for el in ("Fe", "Cu", "Sn", "C", "Mn", "Cr", "Si"):
            if el in mm:
                # recovery: metallics ~yield; tramps (Cu,Sn) fully report to metal
                rec = 1.0 if el in ("Cu", "Sn") else y
                elem_kg[el] = elem_kg.get(el, 0.0) + w * mm[el] * rec
        rows.append({"Material": mm["name"], "kg": round(w, 0)})
    if liquid_kg <= 0:
        return dict(feasible=False, message="no material selected")
    bath = {el: 100.0 * kg / liquid_kg for el, kg in elem_kg.items()}
    return dict(
        feasible=True,
        liquid_t=liquid_kg / 1000.0,
        charge_kg=sum(weights_kg.values()),
        cost_INR=total_cost,
        cost_INR_per_t_liquid=total_cost / (liquid_kg / 1000.0),
        energy_kWh=total_energy,
        predicted_bath_pct=bath,
        rows=rows,
    )


def _mix_rows(res, mats) -> List[Dict]:
    """Surface the per-material breakdown from MixResult.masses_kg."""
    masses = getattr(res, "masses_kg", None)
    if masses:
        total = sum(masses.values()) or 1.0
        return [{"Material": k, "kg": round(float(v), 0),
                 "% of charge": round(100.0 * float(v) / total, 1)}
                for k, v in masses.items() if float(v) > 0.1]
    return []


# ────────────────────────────────────────────────────────────────────────────
# Small helpers used across pages
# ────────────────────────────────────────────────────────────────────────────
def theoretical_floor_kWh_t(cfg) -> float:
    from smartmelt.thermo import theoretical_melt_energy_kWh_per_t
    return float(theoretical_melt_energy_kWh_per_t(cfg))


def economics_summary(cfg, sec_before: float, sec_after: float,
                      tonnes_per_year: float) -> Dict[str, float]:
    return dict(sm.economics(sec_before, sec_after, cfg, tonnes_per_year=tonnes_per_year))
