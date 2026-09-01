"""Shared backend utilities."""
from __future__ import annotations
import math, sys
from pathlib import Path
from typing import Any, List

ROOT = Path(__file__).resolve().parents[1]
for _p in (ROOT, ROOT / 'app' / 'lib'):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import functools

@functools.lru_cache(maxsize=8)
def cached_get_config(name: str):
    return E.get_config(name)

@functools.lru_cache(maxsize=32)
def cached_run_heat(plant: str, charge_kg: float, power_kW: float, carbon_pct: float, copper_pct: float, schedule_tuple: tuple, dt: float = 5.0):
    cfg = cached_get_config(plant)
    comp = dict(E.DEFAULT_CHARGE_COMP)
    comp["C"] = carbon_pct / 100.0
    comp["Cu"] = copper_pct / 100.0
    specs = [E.AdditionSpec(mat, t_min, kg) for mat, t_min, kg in schedule_tuple]
    adds = E.build_additions(specs)
    return E.run_heat(cfg, charge_kg, comp, power_kW, additions=adds, dt=dt)


def json_safe(v: Any) -> Any:
    if isinstance(v, dict): return {str(k): json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [json_safe(x) for x in v]
    if hasattr(v, 'item'): v = v.item()
    if isinstance(v, float) and not math.isfinite(v): return None
    return v

def stride(frames: List[dict], n: int = 900) -> List[dict]:
    if len(frames) <= n: return frames
    step = max(1, len(frames) // n)
    result = frames[::step]
    if result and result[-1] is not frames[-1]:
        result = result + [frames[-1]]
    return result
