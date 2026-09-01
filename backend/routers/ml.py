from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe
import asyncio
from concurrent.futures import ThreadPoolExecutor

router = APIRouter(prefix="/api/ml")
_executor = ThreadPoolExecutor(max_workers=2)

class MLTrainRequest(BaseModel):
    plant: str
    split_frac: float
    use_cached: bool

class MLGenRequest(BaseModel):
    plant: str
    split_frac: float
    n_heats: int

@router.post("/train")
async def ml_train(req: MLTrainRequest):
    cfg = E.get_config(req.plant)
    err_msg = "No cached dataset found"
    d = None
    if req.use_cached:
        try:
            d = E.load_cached_dataset()
            if d is None:
                err_msg = "load_cached_dataset returned None"
        except Exception as e:
            err_msg = f"Exception loading cache: {type(e).__name__}: {str(e)}"

    if d is None:
        return {"error": err_msg}

    # Run heavy ML training in thread pool so the event loop stays free
    def _do_train():
        return E.train_hybrid(cfg, d, split_frac=req.split_frac)

    loop = asyncio.get_event_loop()
    ml = await loop.run_in_executor(_executor, _do_train)
    return json_safe({
        "metrics": ml.metrics,
        "pred": ml.pred_df.to_dict(orient="records")
    })

@router.post("/generate")
async def ml_generate(req: MLGenRequest):
    cfg = E.get_config(req.plant)
    # Cap at 30 heats max to keep Render free-tier under ~2 minutes
    n = min(req.n_heats, 30)

    def _do_generate():
        d = E.generate_dataset(cfg, n_heats=n, seed=0)
        ml = E.train_hybrid(cfg, d, split_frac=req.split_frac)
        return ml

    loop = asyncio.get_event_loop()
    ml = await loop.run_in_executor(_executor, _do_generate)
    return json_safe({
        "metrics": ml.metrics,
        "pred": ml.pred_df.to_dict(orient="records"),
        "n_heats_used": n,
    })
