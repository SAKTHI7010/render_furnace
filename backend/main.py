"""SmartMelt API — FastAPI entry point."""
from __future__ import annotations
import math, sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
for _p in (ROOT, ROOT / 'app' / 'lib'):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import engine as E
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import operator, trajectory, physics, ekf, ml, drift, chargemix, economics, validation, debug

app = FastAPI(title='SmartMelt API', version=E.VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(operator.router)
app.include_router(trajectory.router)
app.include_router(physics.router)
app.include_router(ekf.router)
app.include_router(ml.router)
app.include_router(drift.router)
app.include_router(chargemix.router)
app.include_router(economics.router)
app.include_router(validation.router)
app.include_router(debug.router)

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.utils import json_safe as _json_safe

@app.get('/api/health')
def health():
    return {'status': 'ok', 'engine_version': E.VERSION, 'plants': list(E.available_configs())}

@app.get('/api/configs')
def configs():
    return {name: _json_safe(E.config_summary(E.get_config(name))) for name in E.available_configs()}

# Serve index.html at the root
@app.get("/")
def serve_index():
    return FileResponse(ROOT / "frontend" / "index.html")

# Mount the rest of the frontend directory
app.mount("/", StaticFiles(directory=ROOT / "frontend"), name="frontend")

