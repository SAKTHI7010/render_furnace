from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/economics")

class EconRequest(BaseModel):
    plant: str
    t_per_year: float
    sec_saving_kWh_t: float
    licence_INR_lakh: float

@router.post("")
def run_economics(req: EconRequest):
    cfg = E.get_config(req.plant)
    sm = E.config_summary(cfg)
    tariff = sm["Tariff (₹/kWh)"]
    ef = sm["Grid EF (tCO₂/MWh)"]
    base = sm["Baseline SEC (kWh/t)"]
    floor = E.theoretical_floor_kWh_t(cfg)
    
    annual = req.t_per_year * req.sec_saving_kWh_t * tariff
    payback = (req.licence_INR_lakh * 1e5) / annual * 12 if annual > 0 else float("inf")
    co2 = req.t_per_year * req.sec_saving_kWh_t / 1000 * ef
    headroom = max(base - req.sec_saving_kWh_t - floor, 0)
    
    scenarios = []
    for o in (30000, 50000, 100000):
        scenarios.append({
            "annual_output": o,
            "saving_30": o * 30 * tariff,
            "saving_50": o * 50 * tariff,
            "saving_80": o * 80 * tariff
        })
        
    engine = {}
    try:
        ec = E.economics_summary(cfg, base, base - req.sec_saving_kWh_t, req.t_per_year)
        engine = {k: v for k, v in ec.items()}
    except:
        pass
        
    return json_safe({
        "annual_saving_INR": annual,
        "payback_months": payback,
        "co2_avoided_t_yr": co2,
        "headroom_kWh_t": headroom,
        "tariff": tariff,
        "floor_kWh_t": floor,
        "baseline_sec": base,
        "scenarios": scenarios,
        "engine_details": engine
    })
