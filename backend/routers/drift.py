from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/drift")

class DriftCachedRequest(BaseModel):
    plant: str

class DriftGenRequest(BaseModel):
    plant: str
    n_heats: int
    regime_change_at: int

@router.post("/cached")
def drift_cached(req: DriftCachedRequest):
    cfg = E.get_config(req.plant)
    try: d = E.load_cached_dataset()
    except: d = None
    if d is None: return {"error": "No cached dataset found"}
    
    dr = E.run_drift(cfg, d, ref_frac=0.5)
    cu_col = "charge_Cu_pct" if "charge_Cu_pct" in d else d.columns[0]
    return json_safe({
        "alarm": dr["alarm"],
        "reasons": dr["reasons"],
        "psi_max": dr["psi_max"],
        "n_ref": dr["n_ref"],
        "n_recent": dr["n_recent"],
        "psi_table": dr["psi_df"].to_dict(orient="records"),
        "regime_at": 40,
        "dataset_col_name": cu_col,
        "dataset_values": d[cu_col].tolist()
    })

@router.post("/generate")
def drift_generate(req: DriftGenRequest):
    cfg = E.get_config(req.plant)
    d = E.generate_dataset(cfg, n_heats=req.n_heats, seed=0, regime_change_at=req.regime_change_at)
    dr = E.run_drift(cfg, d, ref_frac=0.5)
    cu_col = "charge_Cu_pct" if "charge_Cu_pct" in d else d.columns[0]
    return json_safe({
        "alarm": dr["alarm"],
        "reasons": dr["reasons"],
        "psi_max": dr["psi_max"],
        "n_ref": dr["n_ref"],
        "n_recent": dr["n_recent"],
        "psi_table": dr["psi_df"].to_dict(orient="records"),
        "regime_at": req.regime_change_at,
        "dataset_col_name": cu_col,
        "dataset_values": d[cu_col].tolist()
    })
