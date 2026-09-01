from fastapi import APIRouter
from pathlib import Path
import pandas as pd
from app.lib.engine import _PKG_ROOT

router = APIRouter(prefix="/api/debug")

@router.get("")
def check_cache():
    p1 = _PKG_ROOT / "gui" / "cache" / "dataset_60.pkl"
    p2 = _PKG_ROOT / "examples" / "heats_if_90.csv"
    
    res = {
        "pkg_root": str(_PKG_ROOT),
        "pkl_exists": p1.exists(),
        "csv_exists": p2.exists(),
        "pkl_err": None,
        "csv_err": None,
    }
    
    if p1.exists():
        try: pd.read_pickle(p1)
        except Exception as e: res["pkl_err"] = str(type(e).__name__) + ": " + str(e)
            
    if p2.exists():
        try: pd.read_csv(p2)
        except Exception as e: res["csv_err"] = str(type(e).__name__) + ": " + str(e)
            
    return res
