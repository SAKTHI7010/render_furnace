"""SmartMelt API — FastAPI entry point (API-only, frontend on GitHub Pages)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for _p in (ROOT, ROOT / 'app' / 'lib'):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import engine as E
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import operator, trajectory, physics, ekf, ml, drift, chargemix, economics, validation, debug
from backend.utils import json_safe as _json_safe

app = FastAPI(title='SmartMelt API', version=E.VERSION)

# Allow GitHub Pages and any origin to call this API
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

@app.get('/api/health')
def health():
    return {'status': 'ok', 'engine_version': E.VERSION, 'plants': list(E.available_configs())}

@app.get('/api/configs')
def configs():
    return {name: _json_safe(E.config_summary(E.get_config(name))) for name in E.available_configs()}

@app.get('/')
def root():
    return {'service': 'SmartMelt API', 'version': E.VERSION, 'docs': '/docs'}
