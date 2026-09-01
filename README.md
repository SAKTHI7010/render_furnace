# SmartMelt Studio

**Hybrid physics + machine-learning melt optimisation for induction steelmaking.**

Advisory-only desktop/browser console replicating the native operator GUI — physics engine, Extended Kalman virtual sensor, hybrid ML endpoint model, least-cost charge-mix, drift monitor and full economics.

---

## Running the HTML/JS/FastAPI version (recommended)

### How to run locally (Windows)

Just double-click the **`run_studio.bat`** file in the project folder!

It will start the backend and automatically open `http://localhost:8000` in your browser. The frontend is served directly by the FastAPI backend, so you only need one terminal.

If you prefer to run it manually from the terminal:
```bash
.venv\Scripts\activate
pip install -r backend\requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```
Then open **http://localhost:8000** in your browser.

---

## Running the original Streamlit app

```bash
.venv\Scripts\activate
python -m streamlit run streamlit_app.py
```

Or just double-click `run_streamlit.bat`.

---

## Project Structure

```
Inductionfurnace-main/
│
├── backend/                    ← FastAPI backend (Python)
│   ├── main.py                 ← Entry point: uvicorn backend.main:app
│   ├── utils.py                ← Shared path setup + json_safe helper
│   ├── requirements.txt
│   └── routers/
│       ├── operator.py         ← /api/operator/* (start, inject, tap, advisories)
│       ├── trajectory.py       ← /api/trajectory
│       ├── physics.py          ← /api/physics
│       ├── ekf.py              ← /api/ekf
│       ├── ml.py               ← /api/ml/train, /api/ml/generate
│       ├── drift.py            ← /api/drift/cached, /api/drift/generate
│       ├── chargemix.py        ← /api/chargemix/*
│       ├── economics.py        ← /api/economics
│       └── validation.py       ← /api/validation
│
├── frontend/                   ← Static HTML/JS/CSS (served as static site)
│   ├── index.html              ← SPA shell: header + 12 tabs
│   ├── css/
│   │   └── smartmelt.css       ← Dark theme (exact port of Streamlit CSS)
│   └── js/
│       ├── api.js              ← All fetch wrappers
│       ├── state.js            ← Global app state (session equivalent)
│       ├── furnace.js          ← Three.js 3D rotating furnace cylinder
│       ├── charts.js           ← Plotly.js dark-theme helpers
│       ├── main.js             ← Tab router + bootstrap
│       └── tabs/
│           ├── operator.js     ← Operator Console (live KPIs + 3D furnace + SVG trend)
│           ├── trajectory.js   ← Process Trajectory (6-panel Plotly)
│           ├── physics.js      ← Physics & Energy (4-panel Plotly)
│           ├── ekf.js          ← Virtual Sensor (2-panel Plotly)
│           ├── ml.js           ← Machine Learning (2-panel Plotly)
│           ├── drift.js        ← Drift Monitor (PSI bar + trend)
│           ├── chargemix.js    ← Charge-Mix (optimise / manual)
│           ├── economics.js    ← Economics (savings / payback / CO₂)
│           ├── heatlog.js      ← Heat Log (audit trail + CSV export)
│           ├── settings.js     ← Settings (plant configuration)
│           ├── validation.js   ← Validation (conservation check)
│           └── about.js        ← About / Details (static)
│
├── app/                        ← Streamlit app code
├── smartmelt/                  ← Physics engine (shared by both apps)
├── configs/                    ← Plant YAML configs
├── streamlit_app.py            ← Original Streamlit entry point
├── render.yaml                 ← Render deployment config
└── README.md                   ← This file
```

---

## Deploying to Render

The `render.yaml` file configures **two Render services**:

| Service | Type | Purpose |
|---|---|---|
| `smartmelt-api` | Web Service (Python) | FastAPI backend |
| `smartmelt-console` | Static Site | HTML/JS frontend |

### Steps

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` and creates both services
5. Set the `SMARTMELT_API_URL` environment variable on the static site to the FastAPI service URL (e.g. `https://smartmelt-api.onrender.com`)

### render.yaml

```yaml
services:
  - type: web
    name: smartmelt-api
    runtime: python
    rootDir: .
    buildCommand: pip install -r backend/requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /api/health

  - type: web
    name: smartmelt-console
    runtime: static
    rootDir: frontend
    buildCommand: ""
    staticPublishPath: .
    envVars:
      - key: SMARTMELT_API_URL
        value: https://smartmelt-api.onrender.com
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Furnace 3D | **Three.js 0.160** — rotating cylinder with liquid/slag/scrap layers |
| Charts | **Plotly.js 2.30** — all tab charts with dark theme |
| Frontend | **Vanilla HTML + ES Modules** — no build step, pure static files |
| Backend | **FastAPI + Uvicorn** — Python, runs the physics engine |
| Physics engine | **SmartMelt** — first-principles IF model, EKF, ML, charge-mix LP |

---

## API Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Engine version + plant list |
| `/api/configs` | GET | Plant configuration summaries |
| `/api/operator/start` | POST | Start a heat simulation |
| `/api/operator/inject` | POST | Inject material mid-heat |
| `/api/operator/tap` | POST | Finalise heat |
| `/api/operator/advisories` | POST | Get 6 live advisory cards |
| `/api/operator/additions` | GET | Available materials |
| `/api/trajectory` | POST | 6-panel process trajectory data |
| `/api/physics` | POST | Energy audit data |
| `/api/ekf` | POST | EKF virtual sensor run |
| `/api/ml/train` | POST | Train hybrid ML on cached data |
| `/api/ml/generate` | POST | Generate virtual heats + train |
| `/api/drift/cached` | POST | Check drift on cached data |
| `/api/drift/generate` | POST | Generate heats with regime change |
| `/api/chargemix/materials` | GET | 17-stream scrap library |
| `/api/chargemix/optimise` | POST | Least-cost blend optimisation |
| `/api/chargemix/evaluate` | POST | Evaluate manual blend |
| `/api/economics` | POST | Savings / payback / CO₂ |
| `/api/validation` | POST | Conservation check heat |
