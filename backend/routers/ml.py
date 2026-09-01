from fastapi import APIRouter
from pydantic import BaseModel
from backend.utils import E, json_safe

router = APIRouter(prefix="/api/ml")

class MLTrainRequest(BaseModel):
    plant: str
    split_frac: float
    use_cached: bool

class MLGenRequest(BaseModel):
    plant: str
    split_frac: float
    n_heats: int

@router.post("/train")
def ml_train(req: MLTrainRequest):
    cfg = E.get_config(req.plant)
    err_msg = "No cached dataset found"
    if req.use_cached:
        try:
            d = E.load_cached_dataset()
            if d is None:
                err_msg = "load_cached_dataset returned None"
        except Exception as e:
            err_msg = f"Exception loading cache: {type(e).__name__}: {str(e)}"

    if d is None:
        return {"error": err_msg}
    
    ml = E.train_hybrid(cfg, d, split_frac=req.split_frac)
    return json_safe({
        "metrics": ml.metrics,
        "pred": ml.pred_df.to_dict(orient="records")
    })

@router.post("/generate")
def ml_generate(req: MLGenRequest):
    cfg = E.get_config(req.plant)
    d = E.generate_dataset(cfg, n_heats=req.n_heats, seed=0)
    ml = E.train_hybrid(cfg, d, split_frac=req.split_frac)
    return json_safe({
        "metrics": ml.metrics,
        "pred": ml.pred_df.to_dict(orient="records")
    })
