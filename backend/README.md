# SmartMelt FastAPI backend

From the repository root run:

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

It exposes the existing validated engine at `POST /api/heat`, plus `GET /api/health` and `GET /api/configs`.
