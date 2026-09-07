# Varuna ↔ Oily Integration Plan

Status: **detection endpoint integrated, verified working end-to-end, and accuracy-validated against real Sentinel-1 data (mIoU 0.625, 90.4% confidence real positive detection — see §6).** Hindcast/attribution/narrator are separate Varuna capabilities, planned but not wired in.

---

## 1. What Varuna actually is

`model_for_spill_detection/all model` is a full multi-stage Python pipeline ("Varuna"), not just a classifier:

| Stage | File | Status |
|---|---|---|
| Preprocess | `src/varuna/preprocess/sar_preprocess.py` | Real (calibration, despeckle, wind gate) |
| **Detect** | `src/varuna/detect/segment.py` | **Real, trained checkpoint** — DeepLabV3+/ResNet34, 2-channel VV+VH input, val mIoU **0.565** (`models/segmenter_best.pt`) |
| Hindcast | `src/varuna/hindcast/{drift,weathering}.py` | Real OpenDrift/OpenOil reverse-drift physics; age estimation is a placeholder fixed window |
| Attribute | `src/varuna/attribute/{ais_ingest,scoring}.py` | Real scoring formula; AIS ingestion has real loaders + a synthetic generator for demos |
| Agent | `src/varuna/agent/narrator.py` | **Stub** — raises `NotImplementedError` |
| Vessel detect | `src/varuna/detect/vessel_detect.py` | **Stub** — raises `NotImplementedError` |
| App | `src/varuna/app/streamlit_app.py` | A separate Streamlit demo UI — not the Oily frontend |

**This integration covers the Detect stage only** — the piece the user confirmed is ready ("model to detect the oilspills in sar images is ready"). Hindcast/attribution are a much larger, separately-scoped integration (see §6).

## 2. The core mismatch, and how it's resolved

The trained model expects a **2-channel Sentinel-1 VV+VH backscatter array in dB** (`(2, H, W)` float32, matching the Zenodo Trujillo-Acatitla training set), tiled at 512×512. It does **not** take a generic photo. The frontend's `/detect` page accepts image uploads — per your decision, scoped to **real SAR imagery only**.

Two real-world SAR input shapes are supported by the new inference layer:

1. **Calibrated GeoTIFF** (1 or 2 bands, already in dB) — read via `rasterio`, used as-is.
2. **Standard 8-bit grayscale SAR preview image** (`.png`/`.jpg`/`.tif` — what most people can actually get their hands on, not a raw calibrated product) — linearly rescaled onto the model's dB window (dark pixel → low backscatter → oil-plausible, matching normal SAR visual convention).

Single-band input is duplicated across both channels either way (mirrors the existing `_read_vv_vh` fallback in `dataset.py`).

## 3. Architecture

```
Browser (upload SAR image)
   │  FileReader → data: URL
   ▼
Oily frontend (Node/TanStack Start, port 8081 dev)
   │  src/services/mlService.ts        — strips the data: URL prefix
   │  src/lib/oily/api.functions.ts    — classifyImage server fn
   │      fetch(`${VARUNA_API_URL}/detect`, { method: "POST", body: FormData })
   ▼  (plain HTTP, server-to-server — no CORS involved)
Varuna inference API (Python/FastAPI, port 8000)
   │  src/varuna/app/inference_api.py
   │      load image → VV/VH dB array → FineTunedSegmenter.segment(return_prob=True)
   │      → largest_polygon_geometry() + largest_region_bbox()
   ▼
JSON response → mapped straight onto the frontend's MLPrediction type
```

The two processes are independent — the Python API can run on another machine/port; the frontend only needs `VARUNA_API_URL` pointed at it (defaults to `http://127.0.0.1:8000` for local dev, matching what's running now).

## 4. Changes made to the model repo

- **`src/varuna/detect/segment.py`**
  - `FineTunedSegmenter.segment(..., return_prob=True)` — new optional return of the raw per-pixel sigmoid probability map alongside the thresholded mask. Default behavior (mask only) is unchanged — `pipeline.py`'s existing calls are unaffected.
  - `FineTunedSegmenter.__init__` now stores `self.val_miou` from the checkpoint metadata.
  - New `largest_region_bbox(mask, label=OIL)` helper — pixel bounding box of the largest connected region, for the API's `boxes[]` field.
- **New `src/varuna/app/inference_api.py`** — the FastAPI service described above (`/health`, `/detect`).
- **New `scripts/run_api.py`** — entrypoint that applies the repo's standard Windows MKL/OpenMP workaround (same pattern as every other entrypoint here) and starts uvicorn.
- **`inference_api.py` follow-up** — added `_source_to_png_base64()` (viewable, contrast-stretched grayscale render of the analyzed band — browsers can't display raw multi-band GeoTIFFs inline, so this is what the UI shows instead of the original upload) and `_annotated_jpeg_base64()` (the same scene with the *real* detected mask baked in as a translucent red fill + outline, not an approximate box). Both returned on every `/detect` response as `sourcePreviewPngBase64` and `annotatedJpegBase64`.

## 5. Changes made to the frontend (mock removed)

- **`src/lib/oily/api.functions.ts`** — `classifyImage`'s deterministic pseudo-random mock (`[...fileName].reduce(...)` fake confidence) is **removed entirely**. It now sends the real image bytes to the Varuna API via `fetch` and returns its real JSON response. If the Python service isn't running, it throws a clear error naming the exact command to start it, instead of silently faking a result.
- **`src/services/mlService.ts`** — signature changed from `(file, {demo})` to `(file, dataUrl)`; forwards actual image bytes instead of just `{name, size}` metadata (the mock never needed real pixels — the real model does).
- **`src/routes/detect.tsx`** — plumbing only, **no UI/flow change** (per your instruction to keep this page as-is): `runClassification` now passes the real data URL through; the `demo` flag is gone (the model doesn't special-case it); `useDemoImage` now actually `fetch()`es the demo asset and reads its real bytes instead of hardcoding a fake size, so **"Use Demo Image" now runs through the real model** end-to-end. The preview shown (and later stored on the incident) is swapped for the model's `annotatedJpegBase64` once analysis completes — always browser-viewable regardless of upload format, with the real detected region marked directly in the image. The old CSS `boxes[]` rectangle overlay was removed as redundant now that the mark is baked into the image itself.
- **`src/lib/oily/types.ts`** — `MLPrediction` gained five **optional** fields (`geometryAreaM2`, `geometryElongation`, `maskPngBase64`, `sourcePreviewPngBase64`, `annotatedJpegBase64`) so the real model's richer output has somewhere to go without breaking anything that only reads the original fields.
- **`src/routes/dashboard.tsx`** — new "Latest Detection" panel showing the most recently logged incident's image (the annotated JPEG, once re-detected under this version), confidence and area, linking to its full incident page. Both this and `/detect`'s preview use `aspect-square` containers now (the analyzed frame is always square; the previous fixed-height/`object-cover` combination was cropping a large portion of the image).

### What was *not* touched (flagged for your decision, not silently changed)

`SEED_INCIDENTS` (5 demo incidents) and `HISTORICAL_INCIDENTS` (180 synthetic historical records) in `src/lib/oily/data.ts` are also fabricated/mock content, but they're **app demo-seed data**, not the ML mock — removing them would leave the Dashboard/Incidents pages empty until real incidents are detected, which is a product decision, not an integration requirement. Left in place; say the word if you want these emptied out too.

## 6. Validated — real accuracy numbers (update: since confirmed)

The integration plumbing was verified correct and byte-exact from the start (checkpoint loads, normalization matches `train.py`'s exact convention, the browser→Node→Python round-trip tested with a byte-identity check). Initial testing with `demo-spill.jpg` (a stock SAR-look photo) and a hand-built synthetic scene both returned "background" — at the time this was flagged as inconclusive rather than a bug, since neither is genuine calibrated Sentinel-1 data. That has now been resolved with real data:

- Downloaded the Zenodo Part III test set (9.86 GB, 900 real Sentinel-1 SAR scenes across oil/lookalike/no-oil, with ground-truth masks) and extracted it to `data/raw/zenodo_part3/extracted/`.
- Ran the repo's own `scripts/evaluate_phase2.py` against it:

  | Category | Result |
  |---|---|
  | Oil | **mIoU = 0.625** (22 held-out images / 352 tiles) — better than the training-run's own reported 0.565 |
  | Lookalike | false-positive rate 1.6% |
  | No-oil | false-positive rate 0.0% |

- Fed a real oil scene (`Images/Oil/00000.tif`) through the live `/detect` API — the exact endpoint the frontend calls — and got a genuine confirmed positive: `classification: "oil_spill"`, **confidence 90.4%**, estimated area 131 km².

**Conclusion:** the trained checkpoint is genuinely good and the integration is fully correct end-to-end. The earlier "background" results on JPEG/PNG images were a real, now-documented domain-mismatch limitation (the model needs authentic calibrated Sentinel-1 backscatter, not SAR-look photos) — not an integration bug. For real testing, use genuine Sentinel-1 GRD TIFFs; the extracted validation set above has 900 labeled real examples to try.

## 7. Running it

**Python inference service** (already running in this session on port 8000):
```powershell
cd "model_for_spill_detection\all model"
py -3.11 -m venv .venv311                      # one-time
.\.venv311\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.\.venv311\Scripts\python.exe -m pip install segmentation-models-pytorch rasterio scikit-image scipy fastapi "uvicorn[standard]" python-multipart pillow numpy
.\.venv311\Scripts\python.exe scripts\run_api.py --port 8000
```

**Frontend** (already running, defaults to `http://127.0.0.1:8000`):
```powershell
cd frontend
bun run dev
# optional override: $env:VARUNA_API_URL = "http://127.0.0.1:8000"
```

Then open `/detect`, upload a real SAR image (or click "Use Demo Image"), and it now runs through the real Varuna model.

## 8. Environmental Impact model (second integration, same API service)

A second, independent real model, added to the same FastAPI service — see `scripts/train_impact_model.py` and the new `/impact/predict` endpoint in `inference_api.py`.

- **Data**: `enviromental impact/oil_spill_environmental_master_v2.csv` — 4,379 real NOAA Office of Response and Restoration incidents, 1957-2026 (see the accompanying dataset description PDF). 2,076 have a documented severity score (`environmental_impact_score = 100 × √(hazard × exposure)`, built from cited literature); 1,116 of those have every feature the model trains on with no gaps filled in (the dataset's own "leave gaps as gaps" philosophy).
- **Model**: `HistGradientBoostingRegressor` (scikit-learn), trained on real raw incident features (oil persistence, log volume, log distance-to-coast, latitude, ocean/coral/mangrove climate flags) to predict the score — deliberately *not* trained on the dataset's own `hazard_component`/`exposure_component` columns, since those already encode the closed-form formula; the model instead has to learn that relationship itself from the raw inputs, so it generalizes to new incidents. Held-out test set: **MAE 1.80 / R² 0.984** (n=224) vs. a mean-only baseline MAE of 16.56. The very high R² is expected, not overfitting — the target is a deterministic formula over these same ingredients, not a noisy measurement (the dataset PDF is explicit that "nothing here could be checked against real outcomes").
- **Distance-to-coast for a new incident**: computed server-side with `global-land-mask` (a lightweight, pure-numpy 1km-resolution world land/ocean raster) via an expanding ring search from the incident's coordinates — the same "step outward until the map flips from water to land" approach the dataset's own methodology describes.
- **Frontend wiring**: `/impact` now calls `oilyApi.predictImpact(incident)` (new `predictImpactFn` in `api.functions.ts`) and displays the real score/severity/components, with a loading state and a graceful fallback to the old JS heuristic if the Python service is unreachable. Added a "Precise Spill Location" map (crosshair marker at the incident's exact coordinates) and an "Exact Coordinates" panel (lat/lon, distance-to-coast, onshore/offshore) per your request to pin down the precise location, plus a "Model" panel showing the real held-out MAE/R²/training-row count for transparency.
- **Live environmental data**: new `fetchLiveTelemetryFn` calls the free, no-key **Open-Meteo Marine + Forecast APIs** for real current wind speed/direction, ocean current velocity/direction, wave height and sea temperature at an incident's exact coordinates. Wired into `/detect`'s `logIncident()` — new incidents now log **real live conditions** instead of the previous hardcoded placeholder telemetry (`currentSpeed: 0.4`, etc.), with a labeled fallback if the request fails.
- **Scope note**: this only replaces the heuristic on the dedicated `/impact` page and the telemetry logged for *new* incidents going forward. The Dashboard, Incidents list, and other pages that read `impact.score` still use the original JS heuristic (`engine.ts calculateImpact`) — say the word if you want those switched to the real model too.

## 8b. Live data, real geography & dashboard interactivity (this round)

- **Map tiles fixed** — CARTO's basemap now requires an API key on the free tier (was showing "API KEY REQUIRED" watermarks on every map). Switched to key-free providers: **OpenStreetMap** (default/light), **Esri World Ocean** (Impact tab), and a CSS-filtered **dark "night"** theme over OSM (Drift / incident detail / command). Each tab now uses a visually distinct basemap.
- **Trajectory rendering** — drift paths now draw as numbered waypoint markers (0,1,2…) in the theme accent colour, so the predicted path from origin outward is clearly readable on the real map.
- **`.tif` → clean marked JPEG** — the annotated detection image is now downscaled to ≤1024px (~0.5 MB vs several MB), so it reliably fits the frontend's localStorage and displays properly (full, uncropped, with the real detected slick baked in) on `/detect` and the Dashboard.
- **Impact tab — real nearby geography** — new `/environment/nearby` endpoint queries the **OpenStreetMap Overpass API** for the nearest real fishing harbour, protected-area/wildlife sanctuary, mangrove wetland and coral reef around the spill (real names, distances, bearings). Shown as labelled markers on the ocean map (with connector lines to the spill) and in a "Nearest Affected Features" list. A "Live Data Sources" panel names every API in use (NOAA model, global-land-mask, Overpass, Open-Meteo).
- **Drift tab — live recompute** — fetches real current wind/ocean-current conditions (Open-Meteo) at view time and recomputes the trajectory from them, with a "Refresh Live Data" button, a "Live" badge, a last-fetched timestamp, and a "Physics Model" panel documenting the `V_oil = V_current + C_w·V_wind` formula actually used.
- **Dashboard — dynamic** — ticking live UTC clock, a "Live Ocean Conditions" widget that auto-polls Open-Meteo every 60s for the top incident's coordinates, and a **"Recent Analysis Activity"** feed: every time the Impact or Drift tab computes a real result it's pushed to the store (`recordAnalysis`) and surfaces here — proof the tabs fetch live data and feed the dashboard.
- **History tab** — new "Recently Confirmed Incidents" panel reads live from the store, so a newly confirmed detection appears immediately.

## 8c. Land-aware drift, pro UX & map fixes (this round)

- **Maps fixed ("map data not available")** — Esri's Ocean service only serves tiles to ~zoom 13; deeper zooms returned "Map data not yet available" placeholders. Added `maxNativeZoom` per theme so Leaflet upscales real tiles instead of requesting nonexistent ones — the map is always populated now at every zoom.
- **Oil no longer drifts onto land** — new `/drift/forecast` endpoint runs the same `V_oil = V_current + C_w·V_wind` physics but walks it forward in 0.25 h steps and **stops at first land contact** (global-land-mask 1 km coastline), so the slick beaches on the shore and stays there rather than continuing inland. A coastal-ambiguity guard (`MIN_TRAVEL_KM = 3`) prevents false beaching on a spill whose own coordinates fall in a land-flagged cell. The Drift page calls this (via `driftForecastFn` / `oilyApi.driftForecast`), shows a "beaches after Nh" badge or "stays offshore", and the recent-analysis feed reflects it.
- **"Calculations happening" steppers** — new reusable `AnalysisSteps` component. Impact shows: resolving coordinates → coastal range & habitat-density band → querying sanctuaries/mangroves/reefs (OSM) → running the NOAA model. Drift shows: fetching live currents → reading wind → computing windage vector → integrating 72 h & checking coastline. Each step maps to a real async stage.
- **Professional / interactive polish** — animated count-up dashboard metrics (`CountUp`, reduced-motion aware), hover-lift metric cards, live "Live" badges, ticking clock, auto-refreshing conditions, and beaching status chips.

## 9. Suggested next phases (not started)

1. ~~Real mask overlay~~ — done: `/detect` and the Dashboard now show the real detected region baked into the image (`annotatedJpegBase64`), not an approximate box.
2. ~~Real environmental impact model~~ — done (§8).
3. **Hindcast integration** — wire `/drift` (currently a JS formula) to Varuna's real OpenDrift/OpenOil reverse-drift ensemble. Needs the CMEMS/ERA5 accounts from the README's Phase 0, plus a new API endpoint alongside `/detect`.
4. **AIS attribution** — a genuinely new frontend surface (ranked-suspect vessels), not a swap of an existing page.
5. **Narrator/vessel-detect** — both are stubs in the model repo itself; nothing to integrate yet.
