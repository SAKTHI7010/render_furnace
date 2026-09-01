"""Shared backend utilities."""
from __future__ import annotations
import math, sys
from pathlib import Path
from typing import Any, List

ROOT = Path(__file__).resolve().parents[1]
for _p in (ROOT, ROOT / 'app' / 'lib'):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import engine as E  # noqa

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
