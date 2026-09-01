from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/chargemix")

class OptimiseRequest(BaseModel):
    plant: str
    target_t: float
    C_lo: float
    C_hi: float
    cu_ceiling: float
    sn_ceiling: float

class EvaluateRequest(BaseModel):
    plant: str
    weights: Dict[str, float]

@router.get("/materials")
def list_materials():
    # Return with *100 percentage values so frontend doesn't need to scale
    mats = []
    for m in E.default_materials():
        mats.append({
            "name":    m["name"],
            "price":   m["price"],
            "Fe_pct":  round(m.get("Fe", 0) * 100, 3),
            "Cu_pct":  round(m.get("Cu", 0) * 100, 4),
            "Sn_pct":  round(m.get("Sn", 0) * 100, 4),
            "C_pct":   round(m.get("C",  0) * 100, 3),
            "Mn_pct":  round(m.get("Mn", 0) * 100, 3),
        })
    return json_safe({"materials": mats})

@router.post("/optimise")
def optimise_mix(req: OptimiseRequest):
    cfg  = E.get_config(req.plant)
    mats = E.default_materials()
    res, shadow, rows = E.solve_charge_mix(
        cfg, mats, req.target_t,
        {"C": (req.C_lo, req.C_hi)},
        cu_limit=req.cu_ceiling,
        tramp_limits={"Sn": req.sn_ceiling}
    )

    if not getattr(res, "feasible", False):
        return json_safe({"feasible": False, "message": getattr(res, "message", "Infeasible")})

    bath = getattr(res, "predicted_bath_pct", {})
    # rows is a list of dicts with keys: "Material", "kg", "% of charge"
    blend = []
    if rows:
        for r in rows:
            blend.append({
                "material":     r.get("Material", ""),
                "kg":           round(float(r.get("kg", 0)), 2),
                "pct_of_charge": round(float(r.get("% of charge", 0)), 2),
            })

    shadow_cu = None
    if shadow:
        v = shadow.get("Cu")
        if v is not None:
            shadow_cu = float(v)

    return json_safe({
        "feasible":       True,
        "cost_INR_per_t": getattr(res, "cost_INR_per_t_liquid", 0),
        "energy_kWh":     getattr(res, "energy_kWh", 0),
        "predicted_bath": bath,
        "blend":          blend,
        "shadow_price_Cu": shadow_cu,
        "message":        "Feasible"
    })

@router.post("/evaluate")
def evaluate_mix(req: EvaluateRequest):
    cfg  = E.get_config(req.plant)
    mats = E.default_materials()
    res  = E.evaluate_manual_mix(cfg, mats, req.weights)

    if not res.get("feasible"):
        return json_safe({"feasible": False})

    total = sum(req.weights.values())
    blend = [
        {"material": name, "kg": round(kg, 2), "pct_of_charge": round(100 * kg / total if total else 0, 2)}
        for name, kg in sorted(req.weights.items(), key=lambda kv: -kv[1])
        if kg > 0
    ]

    return json_safe({
        "feasible":       True,
        "cost_INR_per_t": res["cost_INR_per_t_liquid"],
        "liquid_t":       res["liquid_t"],
        "energy_kWh":     res["energy_kWh"],
        "predicted_bath": res["predicted_bath_pct"],
        "blend":          blend,
    })
