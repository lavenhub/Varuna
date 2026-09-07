# Varuna — Oil Spill Intelligence & Emergency Response Platform

Detects oil spills from satellite SAR imagery (deep learning), forecasts 72-hour
drift with an uncertainty envelope, scores environmental impact with a
NOAA-trained model, and generates ranked, resource-aware response plans. Built on
a layered, service-oriented architecture (inspired by NOAA's GNOME/PyGNOME) where
the frontend visualizes structured results from an API — **every number is
traceable to its inputs and model**.

> Varuna does **not** use or claim to use PyGNOME. It borrows the architectural
> pattern only and ships a transparent, deterministic simulation engine.

## Repository structure

```
frontend/   React 19 + TanStack Start (SSR) web client — map, dashboards, workflow
backend/    Python FastAPI service — detection, simulation, impact, response, history
docs/       Architecture report and integration notes
```

## Features

- **SAR oil detection** — DeepLabV3+/ResNet34 segmenter (Sentinel-1 VV+VH).
- **Drift simulation** — `V_oil = V_current + C_w·V_wind` integrated timestep-by-
  timestep with diffusion, an uncertainty corridor, and coastline beaching. Stored
  as a first-class simulation object (`TrajectoryEngine` interface; a `PyGNOMEEngine`
  seam is documented for the future).
- **Environmental impact** — score from a HistGradientBoosting regressor trained on
  NOAA OR&R incident data (held-out MAE 1.80 / R² 0.984), with a factor
  decomposition and a full inputs→model→output audit.
- **Emergency response** — deterministic rule engine + a live resource inventory.
- **Grounded assistant** — answers only from the structured incident context.
- **Historical intelligence** — similarity matching over the real NOAA dataset.
- **What-If simulator** — re-runs the engine with modified drivers.

## Tech stack

React 19 · TanStack Start / Router / Query · Tailwind v4 · Leaflet · Three.js ·
FastAPI · SQLite (Postgres-ready) · PyTorch · scikit-learn. Live data: Open-Meteo
(met/ocean), OpenStreetMap Overpass (coastal features), NOAA OR&R dataset.

## Not included in this repo (by design)

To keep the codebase lean, these are **git-ignored** and must be added locally:

- **Model weights** — `backend/models/*.pt` (SAR segmenter) and `impact_model.joblib`.
- **Datasets** — `backend/data/` (Sentinel-1 scenes) and the NOAA impact CSV.

The frontend runs and builds without them; the detection/impact endpoints require
the weights + data on the backend host.

## Running locally

**Backend** (Python 3.11):
```bash
cd backend
python -m venv .venv311 && . .venv311/Scripts/activate   # Windows: .venv311\Scripts\activate
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
python scripts/run_api.py --port 8000        # SQLite DB auto-creates at data/oily.db
```

**Frontend** (Bun or npm):
```bash
cd frontend
bun install        # or: npm install
bun run dev        # defaults OILY_API_URL / VARUNA_API_URL to http://127.0.0.1:8000
```

## Architecture

See `docs/OILY_ARCHITECTURE_UPGRADE.md` for the full engineering report, endpoint
reference, and the OBSERVED / MODELLED / ESTIMATED / SIMULATED data-provenance
model.
