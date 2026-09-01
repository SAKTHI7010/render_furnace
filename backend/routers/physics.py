from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from backend.utils import E, json_safe, stride

router = APIRouter(prefix="/api/physics")

class ScheduleItem(BaseModel):
    material: str
    time_min: float
    mass_kg: float

class PhysicsRequest(BaseModel):
    plant: str
    charge_t: float
    power_kW: float
    carbon_pct: float
    copper_pct: float
    schedule: List[ScheduleItem]

@router.post("")
def run_physics(req: PhysicsRequest):
    cfg = E.get_config(req.plant)
    comp = dict(E.DEFAULT_CHARGE_COMP)
    comp["C"] = req.carbon_pct / 100.0
    comp["Cu"] = req.copper_pct / 100.0
    
    specs = [E.AdditionSpec(a.material, a.time_min, a.mass_kg) for a in req.schedule]
    adds = E.build_additions(specs)
    
    res = E.run_heat(cfg, req.charge_t * 1000.0, comp, req.power_kW, additions=adds, dt=2.0)
    frames = res.df.to_dict(orient="records")
    floor = E.theoretical_floor_kWh_t(cfg)
    
    return json_safe({
        "frames": stride(frames),
        "energy": res.energy,
        "ledger_pct": res.ledger_max_pct,
        "sec_kWh_t": frames[-1]["SEC_kWh_t"] if frames else 0,
        "floor_kWh_t": floor,
        "useful_pct": res.energy.get("useful_fraction", 0) * 100
    })
