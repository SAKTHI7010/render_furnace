from fastapi import APIRouter
from pydantic import BaseModel
import numpy as np
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/ekf")

class EKFRequest(BaseModel):
    plant: str
    true_eta: float
    true_UA_scale: float
    n_dips: int
    use_cached: bool

@router.post("")
def run_ekf(req: EKFRequest):
    cfg = E.get_config(req.plant)
    ek = None
    if req.use_cached:
        try:
            ek = E.load_default_ekf()
        except:
            pass
            
    if not ek:
        dip_times_min = tuple(np.linspace(30, 78, req.n_dips))
        ek = E.run_ekf_demo(cfg, true_eta=req.true_eta, true_UA_scale=req.true_UA_scale, dip_times_min=dip_times_min, seed=1)
        
    return json_safe({
        "t_min": ek.df["t_min"].tolist(),
        "T_true_C": ek.df["T_true_C"].tolist(),
        "T_est_C": ek.df["T_est_C"].tolist(),
        "sigma_T": ek.df["sigma_T"].tolist(),
        "dip_t_min": ek.dip_df["t_min"].tolist() if len(ek.dip_df) else [],
        "dip_T_C": ek.dip_df["T_meas_C"].tolist() if len(ek.dip_df) else [],
        "theta_t_min": ek.theta_path["t_min"].tolist(),
        "theta_eta": ek.theta_path["eta_electrical"].tolist(),
        "theta_UA_scale": ek.theta_path.get("UA_lining_scale", [1.0]*len(ek.theta_path)).tolist(),
        "final_error_C": ek.final_error_C,
        "eta_final": ek.theta_path["eta_electrical"].iloc[-1],
        "sigma_end": ek.df["sigma_T"].iloc[-1],
        "n_dips": len(ek.dip_df)
    })
