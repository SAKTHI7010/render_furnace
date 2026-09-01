from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/validation")

class ValidRequest(BaseModel):
    plant: str

@router.post("")
def run_validation(req: ValidRequest):
    cfg = E.get_config(req.plant)
    specs = [
        E.AdditionSpec("Lime (92% CaO)", 10, 48),
        E.AdditionSpec("FeSi75", 45, 15),
        E.AdditionSpec("Mill scale (FeO)", 60, 150)
    ]
    r = E.run_heat(cfg, 12000, dict(E.DEFAULT_CHARGE_COMP), 5200, additions=E.build_additions(specs), dt=2.0)
    
    sm = E.config_summary(cfg)
    floor = E.theoretical_floor_kWh_t(cfg)
    
    audit_rows = [
        {"quantity": "Latent heat of fusion", "in_model": f"{sm['L_fusion (kJ/kg)']:.0f} kJ/kg", "literature": "247", "source": "CRC Handbook 104th ed."},
        {"quantity": "(FeO)+[C]→Fe+CO", "in_model": "1.39 MJ/kg FeO", "literature": "+100 kJ/mol CO", "source": "Turkdogan; Fruehan MSTS"},
        {"quantity": "FeSi75 heat of solution", "in_model": "−3511 kJ/kg", "literature": "−4681 kJ/kg Si", "source": "Sigworth & Elliott 1974"},
        {"quantity": "Carburiser heat of solution", "in_model": "+1883 kJ/kg C", "literature": "+22.6 kJ/mol", "source": "graphite dissolution"},
        {"quantity": "Grid emission factor", "in_model": f"{sm['Grid EF (tCO₂/MWh)']:.3f} tCO₂/MWh", "literature": "0.712", "source": "CEA v21.0, FY2024-25"},
        {"quantity": "Reversible melting floor", "in_model": f"{floor:.0f} kWh/t", "literature": "practical ≈500", "source": "computed, L_f=247"},
        {"quantity": "Default tariff", "in_model": f"₹{sm['Tariff (₹/kWh)']:.1f}/kWh", "literature": "₹6.0–8.5 grid", "source": "HT industrial FY25-26"},
        {"quantity": "Baseline SEC", "in_model": f"{sm['Baseline SEC (kWh/t)']:.0f} kWh/t", "literature": "550–650 scrap IF", "source": "field practice"},
    ]
    
    aim = getattr(cfg.plant, "tap_temperature_C", 1620)
    closure = r.energy.get("residual_pct", float("nan"))
    hit = abs(r.endpoint["T_C"] - aim) <= 15
    
    return json_safe({
        "audit_rows": audit_rows,
        "ledger_pct": r.ledger_max_pct,
        "closure_pct": closure,
        "endpoint_C": r.endpoint["T_C"],
        "undissolved_kg": r.undissolved_kg,
        "aim_C": aim,
        "on_aim": hit,
        "ledger_ok": r.ledger_max_pct < 1,
        "closure_ok": abs(closure) < 5,
        "ledger_df": r.ledger_df.to_dict(orient="records")
    })
