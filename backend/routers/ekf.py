from fastapi import APIRouter
from pydantic import BaseModel
import numpy as np
from backend.utils import E, json_safe
import asyncio
from concurrent.futures import ThreadPoolExecutor

router = APIRouter(prefix="/api/ekf")
_executor = ThreadPoolExecutor(max_workers=2)

class EKFRequest(BaseModel):
    plant: str
    true_eta: float
    true_UA_scale: float
    n_dips: int
    use_cached: bool

@router.post("")
async def run_ekf(req: EKFRequest):
    cfg = E.get_config(req.plant)
    ek = None
    err_msg = "No cached EKF found"

    if req.use_cached:
        try:
            ek = E.load_default_ekf()
            if ek is None:
                err_msg = "load_default_ekf returned None"
        except Exception as e:
            err_msg = f"Exception loading EKF cache: {type(e).__name__}: {str(e)}"

    if not ek:
        if req.use_cached:
            return {"error": err_msg}

        # Run EKF in thread pool so the event loop stays free for other requests
        dip_times_min = tuple(np.linspace(30, 78, req.n_dips))

        def _do_ekf():
            return E.run_ekf_demo(
                cfg,
                true_eta=req.true_eta,
                true_UA_scale=req.true_UA_scale,
                dip_times_min=dip_times_min,
                seed=1,
                # Use larger time step to go ~2x faster (dt=10 instead of default 5)
                dt=10.0
            )

        loop = asyncio.get_event_loop()
        ek = await loop.run_in_executor(_executor, _do_ekf)

    return json_safe({
        "t_min":           ek.df["t_min"].tolist(),
        "T_true_C":        ek.df["T_true_C"].tolist(),
        "T_est_C":         ek.df["T_est_C"].tolist(),
        "sigma_T":         ek.df["sigma_T"].tolist(),
        "dip_t_min":       ek.dip_df["t_min"].tolist() if len(ek.dip_df) else [],
        "dip_T_C":         ek.dip_df["T_meas_C"].tolist() if len(ek.dip_df) else [],
        "theta_t_min":     ek.theta_path["t_min"].tolist(),
        "theta_eta":       ek.theta_path["eta_electrical"].tolist(),
        "theta_UA_scale":  ek.theta_path.get("UA_lining_scale", [1.0]*len(ek.theta_path)).tolist(),
        "final_error_C":   ek.final_error_C,
        "eta_final":       ek.theta_path["eta_electrical"].iloc[-1],
        "sigma_end":       ek.df["sigma_T"].iloc[-1],
        "n_dips":          len(ek.dip_df)
    })
