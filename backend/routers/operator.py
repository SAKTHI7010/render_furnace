from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe, stride, cached_get_config
from app.background_jobs import start_simulation_job
import copy
import numpy as np
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor

router = APIRouter(prefix="/api/operator")

_SESSIONS = {}
_executor = ThreadPoolExecutor(max_workers=2)

class StartRequest(BaseModel):
    plant: str
    charge_t: float
    power_kW: float
    carbon_pct: float
    copper_pct: float

class InjectRequest(BaseModel):
    session_id: str
    frame_idx: int
    material: str
    mass_kg: float

class TapRequest(BaseModel):
    session_id: str
    frame_idx: int

class AdvisoryRequest(BaseModel):
    session_id: str
    frame_idx: int

@router.post("/start")
async def start_heat(req: StartRequest):
    cfg = cached_get_config(req.plant)
    comp = dict(E.DEFAULT_CHARGE_COMP)
    comp["C"] = req.carbon_pct / 100.0
    comp["Cu"] = req.copper_pct / 100.0
    
    def _run_job():
        job = start_simulation_job(
            cfg_obj=cfg,
            charge_t=req.charge_t,
            comp=comp,
            power_kW=req.power_kW,
            additions=[]
        )
        import time
        while not job.done():
            time.sleep(0.02)
        return job.result()

    loop = asyncio.get_event_loop()
    bundle = await loop.run_in_executor(_executor, _run_job)
    
    session_id = str(uuid.uuid4())
    _SESSIONS[session_id] = {
        "cfg": cfg, "charge_t": req.charge_t, "power_kW": req.power_kW,
        "carbon_pct": req.carbon_pct, "copper_pct": req.copper_pct,
        "plant": req.plant, "frames": bundle["frames"], 
        "states": np.asarray(bundle["states"]), "pools": bundle["pools"],
        "applied_adds": []
    }
    
    frames = bundle["frames"]
    tap_min = frames[-1]["t_min"] if frames else 0
    return json_safe({
        "session_id": session_id,
        "frames": stride(frames),
        "tap_min": tap_min,
        "endpoint": {"T_C": frames[-1]["T_bath_C"], "pct_C": frames[-1]["pct_C"]} if frames else None
    })

@router.post("/inject")
async def inject_heat(req: InjectRequest):
    sess = _SESSIONS.get(req.session_id)
    if not sess: return {"error": "session not found"}
    
    cut_i = max(0, min(req.frame_idx, len(sess["frames"]) - 1))
    cur = sess["frames"][cut_i]
    tmin = float(cur["t_min"])
    
    info = E.ADDITION_LIBRARY.get(req.material)
    if not info: return {"error": "material not found"}
    
    add = E.make_addition_at(tmin * 60.0, req.mass_kg, info)
    sess["applied_adds"].append({"material": req.material, "mass_kg": req.mass_kg, "time_min": tmin})
    
    comp = dict(E.DEFAULT_CHARGE_COMP)
    comp["C"] = sess["carbon_pct"] / 100.0
    comp["Cu"] = sess["copper_pct"] / 100.0
    
    from_state = np.asarray(sess["states"][cut_i], dtype=float).copy()
    from_pool = copy.deepcopy(sess["pools"][cut_i])
    
    def _run_inject_job():
        job = start_simulation_job(
            cfg_obj=sess["cfg"],
            charge_t=sess["charge_t"],
            comp=comp,
            power_kW=sess["power_kW"],
            additions=[add],
            from_state=from_state,
            from_pool=from_pool,
            t0_s=tmin * 60.0
        )
        import time
        while not job.done():
            time.sleep(0.02)
        return job.result()

    loop = asyncio.get_event_loop()
    bundle = await loop.run_in_executor(_executor, _run_inject_job)
    
    prefix_frames = sess["frames"][:cut_i + 1]
    prefix_states = sess["states"][:cut_i + 1]
    prefix_pools = sess["pools"][:cut_i + 1]
    
    sess["frames"] = prefix_frames + list(bundle["frames"])
    sess["states"] = np.concatenate([prefix_states, np.asarray(bundle["states"])], axis=0) if len(bundle["states"]) else prefix_states
    sess["pools"] = prefix_pools + list(bundle["pools"])
    
    return json_safe({
        "frames": stride(bundle["frames"]),
        "cut_idx": cut_i
    })

@router.post("/tap")
def tap_heat(req: TapRequest):
    sess = _SESSIONS.get(req.session_id)
    if not sess: return {"error": "session not found"}
    idx = max(0, min(req.frame_idx, len(sess["frames"]) - 1))
    snap = sess["frames"][idx]
    aim = getattr(sess["cfg"].plant, "tap_temperature_C", 1620)
    hit = abs(snap["T_bath_C"] - aim) <= 15
    
    return json_safe({
        "tap_time_min": snap["t_min"],
        "T_bath_C": snap["T_bath_C"],
        "pct_C": snap["pct_C"],
        "SEC_kWh_t": snap["SEC_kWh_t"],
        "slag_FeO_pct": snap["slag_FeO_pct"],
        "B2": snap["B2"],
        "on_aim": hit,
        "applied_adds": sess["applied_adds"]
    })

@router.get("/additions")
def list_additions():
    return json_safe({"materials": list(E.ADDITION_LIBRARY.keys())})

@router.post("/advisories")
def advisories(req: AdvisoryRequest):
    sess = _SESSIONS.get(req.session_id)
    if not sess: return {"error": "session not found"}
    idx = max(0, min(req.frame_idx, len(sess["frames"]) - 1))
    snap = sess["frames"][idx]
    frames = sess["frames"]
    
    proj = float(snap["T_bath_C"])
    if idx >= 6 and snap["melted_pct"] <= 99:
        recent = frames[max(0, idx-5):idx+1]
        dT = recent[-1]["T_bath_C"] - recent[0]["T_bath_C"]
        dt = max(recent[-1]["t_min"] - recent[0]["t_min"], 0.1)
        rate = dT / dt
        dm = recent[-1]["melted_pct"] - recent[0]["melted_pct"]
        if dm > 0.5:
            mins = (100 - snap["melted_pct"]) / (dm/dt)
            proj = float(snap["T_bath_C"] + rate * min(mins, 40))
        else:
            proj = float(snap["T_bath_C"] + rate * 5)
            
    adv = E.build_advisories(snap, sess["cfg"], projected_tap_C=proj)
    return json_safe({"advisories": adv})
