from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from backend.utils import E, json_safe, stride, cached_get_config, cached_run_heat

router = APIRouter(prefix="/api/trajectory")

class ScheduleItem(BaseModel):
    material: str
    time_min: float
    mass_kg: float

class TrajRequest(BaseModel):
    plant: str
    charge_t: float
    power_kW: float
    carbon_pct: float
    copper_pct: float
    schedule: List[ScheduleItem]

@router.post("")
def run_trajectory(req: TrajRequest):
    cfg = cached_get_config(req.plant)
    sched_tuple = tuple((a.material, round(a.time_min, 2), round(a.mass_kg, 2)) for a in req.schedule)
    
    # High speed cached run_heat (dt=5.0 gives 2.5x speedup and LRU cache makes repeat visits 0.001s)
    res = cached_run_heat(
        req.plant, req.charge_t * 1000.0, req.power_kW,
        req.carbon_pct, req.copper_pct, sched_tuple, dt=5.0
    )
    
    frames = res.df.to_dict(orient="records")
    floor = E.theoretical_floor_kWh_t(cfg)
    
    return json_safe({
        "frames": stride(frames),
        "tap_min": res.tap_min,
        "endpoint": res.endpoint,
        "sec_kWh_t": frames[-1]["SEC_kWh_t"] if frames else 0,
        "floor_kWh_t": floor,
        "ledger_pct": res.ledger_max_pct,
        "additions": [{"material": a.material, "time_min": a.time_min, "mass_kg": a.mass_kg} for a in req.schedule]
    })
