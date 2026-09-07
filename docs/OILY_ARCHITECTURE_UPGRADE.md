# OILY — Architecture Upgrade Engineering Report

Turning OILY from "an AI dashboard with a map" into an operational oil-spill
intelligence platform where **every number is produced by a service and is
traceable to its inputs and model**. Architecture benchmarked against NOAA's
GNOME/PyGNOME layering (Environment → Movers → Weatherers → Output) — *borrowed
as a pattern, not cloned, and OILY does not use or claim to use PyGNOME.*

Date: 2026-09-07

---

## 1. What was found in the existing application

- **Frontend**: TanStack Start (React 19, SSR + server functions), TanStack
  Router/Query, Tailwind v4, shadcn/Radix, Leaflet + Three.js. Mature and clean.
- **Real** already: SAR detection (DeepLabV3+/ResNet34), NOAA-trained impact
  regressor, live Open-Meteo telemetry, OSM Overpass nearby features, a
  land-aware physics drift endpoint. A genuine deterministic engine in
  `engine.ts`.
- **Gaps** (the targets): no server-side persistence — incidents/results lived in
  `localStorage` pretending to be backend state; **no simulation as a stored
  object** with an ID and a real trajectory (drift was recomputed per render as 6
  coarse points); calculations split between browser `engine.ts` and Python with
  no single source of truth; history was **synthetic** (PRNG-generated); no
  audit/OBSERVED-MODELLED-ESTIMATED-SIMULATED discipline; two diverging repo
  copies.

## 2. Architecture changes

- **New backend service layer** `src/varuna/oily/` in the FastAPI process
  (mounted under `/api`), separated from the ML/science code, decomposed the way
  the brief asked: Incident → Environment → Movement → Fate → Impact → Response →
  Output.
- **Persistence**: SQLite behind a repository interface (`repo.py`) — the only
  module that speaks SQL. First-class tables: `incidents`,
  `environmental_snapshots`, `simulations`, `trajectory_points`,
  `impact_assessments`, `response_plans`, `response_resources`. Swappable to
  PostgreSQL/PostGIS by changing `db._connect()` only.
- **Simulation engine** (`simulation.py`): a `TrajectoryEngine` interface with
  `SimpleOilyEngine` (shipping) and a documented `PyGNOMEEngine` seam. Component
  models: `DriftModel` (mover), `DiffusionModel` (Fickian spreading + intensity
  decay), `UncertaintyModel` (spread envelope). Real timestep-by-timestep
  forward integration with great-circle displacement and coastline beaching.
- **Frontend API layer** `src/api/*` (client, incidents, environment,
  simulations, impact, history, response, ml, meta) — typed, one endpoint string
  per call, no scattered `fetch`. The store now loads incidents from the backend
  (source of truth) with the localStorage seed as offline fallback.
- **Repo consolidation**: `sih-26` (apostrophe-free, buildable) is canonical for
  the frontend; `sih'26` retained only for docs/model/PDFs.

## 3. APIs added

See the endpoint table at the bottom.

## 4. Calculations implemented (real, server-side)

- **Drift/trajectory**: `V_oil = V_current + C_w·V_wind` resolved to components,
  integrated in 15-min steps over 72 h with a spherical destination formula;
  stops at first land contact (global-land-mask). Produces a **dense 289-point
  path**, coarse waypoints, and a corridor **uncertainty polygon**.
- **Diffusion**: `sqrt(2·D·t)` spread radius (D = 2 m²/s) growing the uncertainty
  envelope; relative surface intensity `A0/(A0+A_spread)` decays down-track.
- **Impact**: headline score from the real NOAA-trained regressor (held-out MAE
  1.80 / R² 0.984); on top, a factor decomposition, a "Why is this X?" reason
  list, coastline-exposure timing derived from the **real simulated trajectory**,
  and a full inputs→model→output audit.
- **Response**: deterministic rule engine → ranked actions with timing/reasoning,
  manpower estimate, and resources matched against the DB inventory
  (AVAILABLE/LIMITED).
- **Chat**: rule-routed answers grounded strictly in the structured context; each
  answer returns a `grounding` map of the exact values used. No LLM invents
  numbers.
- **Similarity**: region/volume/oil-type/persistence/cause/proximity scoring over
  the real NOAA dataset, with per-match reasons.

## 5. Real vs demo/simulated

| Element | Status |
|---|---|
| SAR oil detection | **Real ML** (validated mIoU 0.625) |
| Environmental impact score | **Real ML** regressor (NOAA data, R² 0.984) |
| Historical incidents (2,076) | **Real** NOAA OR&R dataset |
| Wind / current / wave / temp | **Real live** Open-Meteo (labelled MODELLED — NWP/ocean model, not observations) |
| Nearby ecological features | **Real** OpenStreetMap Overpass |
| Distance-to-coast / beaching | **Real** global-land-mask 1 km raster |
| Drift trajectory | **SIMULATED** — transparent deterministic engine (labelled) |
| Uncertainty envelope | **Modelled** estimate (explicitly labelled, not validated) |
| Response plan / manpower | Deterministic rules / **planning estimates** (labelled) |
| Persistence | SQLite (Postgres-ready) |

**Honesty note for the demo:** the real NOAA-trained model rates the primary demo
incident (OILY-1042) at **~45 / LOW–MEDIUM**, not the legacy heuristic's "82 /
HIGH". We kept the honest model number. The incident's operational `risk` field
(HIGH) is separate triage. This is a strength: "the score comes from a model, and
here is its held-out accuracy," not a hand-set number.

## 6. Data sources currently used

NOAA OR&R incident dataset (impact model + history), Open-Meteo Marine + Forecast
(live env), OpenStreetMap Overpass (nearby features), global-land-mask
(coast/beaching), Zenodo Sentinel-1 (detection model training).

## 7. Not yet connected to real external data

- Drift uses a **constant** assumed field (not time-varying CMEMS/ERA5). The
  `PyGNOMEEngine` seam is where a real Lagrangian ensemble would plug in.
- Live wind is NWP model output labelled MODELLED, not station OBSERVED.
- AIS vessel attribution and the narrator/vessel-detect stages remain Varuna
  stubs (out of scope here).

## 8. How this differs from a generic AI dashboard

Every headline number is produced by a named service, persisted with an ID and a
`model_version`, and carries a provenance label + an inputs→model→output audit.
The map renders backend simulation output (dense polyline + uncertainty polygon),
not a decorative animation. "Where does this number come from?" is answerable for
the trajectory, the impact score, the coastline ETA, the manpower figure and the
similarity percentage.

## 9. Endpoint reference

| METHOD | ENDPOINT | PURPOSE | REQUEST | RESPONSE |
|---|---|---|---|---|
| GET | /api/incidents | List incidents | — | Incident[] |
| POST | /api/incidents | Create incident (+ env snapshot) | IncidentCreate | Incident |
| GET | /api/incidents/{id} | Get incident | — | Incident |
| PATCH | /api/incidents/{id} | Update incident | patch | Incident |
| GET | /api/incidents/{id}/similar | Similar historical cases | ?limit | SimilarCase[] |
| GET | /api/incidents/{id}/simulations | Sims for incident | — | Simulation[] |
| GET | /api/incidents/history | Real NOAA history | ?limit | HistoricalRecord[] |
| GET | /api/incidents/history/{id} | One historical record | — | HistoricalRecord |
| GET | /api/environment/{id} | Env field (live, stored) | — | EnvironmentResponse |
| POST | /api/environment/telemetry | Live telemetry at a coord | {lat,lon} | Telemetry |
| POST | /api/simulations | Create + run stored simulation | SimulationCreate | {simulationId,status,modelVersion} |
| GET | /api/simulations/{id} | Simulation metadata | — | SimulationSummary |
| GET | /api/simulations/{id}/trajectory | Dense path + waypoints + uncertainty | — | TrajectoryResponse |
| POST | /api/simulations/scenario | What-If baseline vs scenario | {incidentId,scenario} | ScenarioResult |
| POST | /api/impact/calculate | Model-backed impact + factors + audit | {incidentId} | ImpactResult |
| POST | /api/response/generate | Deterministic response plan | {incidentId} | ResponsePlan |
| POST | /api/response/chat | Grounded assistant | {incidentId,question} | ChatResponse |
| GET | /api/resources | Response-resource inventory | — | Resource[] |
| GET | /api/meta | Model versions, storage, dataset info | — | MetaResponse |
| POST | /detect | SAR oil detection (existing) | multipart image | DetectionResponse |
| POST | /impact/predict | Impact regressor (existing) | ImpactRequest | ImpactResponse |
| POST | /environment/nearby | OSM nearby features (existing) | {lat,lon} | NearbyResponse |
| POST | /drift/forecast | Land-aware drift (existing) | DriftRequest | DriftResponse |
| GET | /health | Health + storage info | — | dict |

## 10. Recommended demo sequence

1. Detect → upload SAR image (or "Use Demo Image") → real model classifies.
2. Confirm → incident **persisted server-side** (real ID, live env snapshot).
3. Open Incident Command → timeline + quick actions.
4. Drift Simulation → stored `SIM-…`, 289-step trajectory, uncertainty corridor,
   audit panel ("where this trajectory comes from").
5. Environmental Impact → model-backed score, factor decomposition, "Why is this
   X?", inputs→model→output audit, real held-out MAE/R².
6. History → 2,076 real NOAA records; open one for its NOAA record.
7. Emergency Response → ranked actions vs live resource availability.
8. Response Assistant → "why high priority / how much manpower" → grounded answer
   with a `grounding` map.
9. What-If → change wind ×2, re-run → baseline vs scenario trajectories compared.

## 11. Limitations to disclose

- Drift is a transparent deterministic model over a **constant** field — a
  decision-support estimate, not a validated operational forecast.
- Uncertainty is a **modelled** envelope, not statistically validated.
- Live wind is NWP model output (MODELLED), not station observations.
- Impact severity is **estimated exposure/severity**, not measured ecological
  damage; the demo incident scores ~45 on the real model.
- Persistence is SQLite (single-node); Postgres/PostGIS is a config swap.

## 12. Running it

```powershell
# Backend (FastAPI + OILY services), from "model_for_spill_detection/all model"
.\.venv311\Scripts\python.exe scripts\run_api.py --port 8000   # DB auto-creates at data/oily.db

# Frontend, from sih-26/frontend
bun run dev      # or: npm run dev ; defaults OILY_API_URL to http://127.0.0.1:8000
```
