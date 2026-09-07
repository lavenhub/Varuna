"""HTTP inference service exposing the Phase 2 fine-tuned segmenter to the
Oily frontend (a separate Node/TanStack Start process). This is the
integration seam between the two codebases: the frontend's `classifyImage`
server function (src/lib/oily/api.functions.ts) makes an HTTP call here
instead of running the old deterministic-mock classifier.

Run with:

    .venv311\\Scripts\\python.exe -m uvicorn varuna.app.inference_api:app --port 8000

(from `model_for_spill_detection/all model`, with `src` on PYTHONPATH -- see
scripts/run_api.py for a wrapper that sets that up plus the Windows MKL/OpenMP
workaround below.)

Accepted uploads
-----------------
Real Sentinel-1 SAR imagery only (per project decision) -- two shapes:

1. A calibrated GeoTIFF with 1 or 2 bands of VV/VH backscatter already in dB
   (matches the Zenodo training set exactly) -- read via rasterio, used as-is.
2. A standard 8-bit grayscale SAR *preview* image (.png/.jpg/.tif export --
   what most people actually have access to, not a raw calibrated product).
   These don't carry dB values, so they're linearly rescaled onto the
   model's expected dB window (dark pixel = low backscatter = oil-plausible,
   matching the normal visual convention for SAR imagery).

Single-band input of either kind is duplicated across both channels, mirroring
varuna.detect.dataset._read_vv_vh's fallback for the same situation.
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import base64
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from varuna.detect.segment import FineTunedSegmenter, OIL, largest_polygon_geometry, largest_region_bbox

CHECKPOINT_PATH = os.environ.get("VARUNA_CHECKPOINT", "models/segmenter_best.pt")
IMPACT_MODEL_PATH = os.environ.get("VARUNA_IMPACT_MODEL", "models/impact_model.joblib")
DB_MIN, DB_MAX = -40.0, 15.0

app = FastAPI(title="Varuna SAR Oil-Spill Detection API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # server-to-server call from the frontend's Node process; permissive for local dev
    allow_methods=["*"],
    allow_headers=["*"],
)

_segmenter: FineTunedSegmenter | None = None
_impact_model = None  # loaded lazily: {"model": sklearn Pipeline, "test_mae": float, "test_r2": float, "n_train": int}


def get_segmenter() -> FineTunedSegmenter:
    global _segmenter
    if _segmenter is None:
        if not Path(CHECKPOINT_PATH).exists():
            raise HTTPException(500, f"checkpoint not found at {CHECKPOINT_PATH}")
        _segmenter = FineTunedSegmenter(CHECKPOINT_PATH)
    return _segmenter


def get_impact_model():
    global _impact_model
    if _impact_model is None:
        if not Path(IMPACT_MODEL_PATH).exists():
            raise HTTPException(
                500,
                f"impact model not found at {IMPACT_MODEL_PATH} -- run "
                "scripts/train_impact_model.py first",
            )
        from joblib import load

        _impact_model = load(IMPACT_MODEL_PATH)
    return _impact_model


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float
    score: float


class DetectionResponse(BaseModel):
    """Shaped to drop straight into the frontend's MLPrediction type
    (src/lib/oily/types.ts) -- see MODEL_INTEGRATION_PLAN.md for the field
    mapping. Extra fields beyond that type (geometry*, maskPngBase64) are
    additive and safe for the current frontend to ignore.
    """
    model: str
    classification: str  # "oil_spill" | "background"
    confidence: float
    spillProbability: float
    backgroundProbability: float
    segmentationAvailable: bool
    estimatedAreaKm2: float
    boxes: list[BoundingBox]
    geometryAreaM2: float | None = None
    geometryElongation: float | None = None
    maskPngBase64: str | None = None
    sourcePreviewPngBase64: str | None = None
    annotatedJpegBase64: str | None = None


def _looks_like_db(arr: np.ndarray) -> bool:
    """Heuristic: real calibrated Sentinel-1 sigma0 dB values are almost
    always negative (typical sea clutter: -25 to -5 dB; oil slicks push
    further negative still). An 8-bit preview image's raw values are always
    in [0, 255]. If nothing in the array is meaningfully negative, it's a
    rendered preview, not a calibrated product.
    """
    return bool(np.nanmin(arr) < -1.0)


def _rescale_preview_to_db(arr: np.ndarray) -> np.ndarray:
    """Map an 8-bit-range preview image onto the model's dB window, dark ->
    low (oil-plausible), bright -> high (open-sea-plausible), matching how
    these previews are conventionally rendered.
    """
    arr = arr.astype(np.float32)
    lo, hi = float(np.nanmin(arr)), float(np.nanmax(arr))
    if hi - lo < 1e-6:
        hi = lo + 1.0
    norm = (arr - lo) / (hi - lo)  # -> [0, 1]
    return DB_MIN + norm * (DB_MAX - DB_MIN)


def _load_vv_vh_from_bytes(data: bytes) -> np.ndarray:
    """Returns a (2, H, W) float32 array of VV/VH backscatter in dB, from
    either a calibrated multi-band GeoTIFF or a standard preview image.
    """
    import rasterio
    from rasterio.io import MemoryFile

    try:
        with MemoryFile(data) as memfile, memfile.open() as src:
            arr = src.read().astype(np.float32)  # (bands, H, W)
    except rasterio.errors.RasterioIOError:
        arr = None

    if arr is None or arr.size == 0:
        from PIL import Image

        img = Image.open(io.BytesIO(data)).convert("L")
        arr = np.asarray(img, dtype=np.float32)[np.newaxis, ...]  # (1, H, W)

    if not _looks_like_db(arr):
        arr = _rescale_preview_to_db(arr)

    if arr.shape[0] == 1:
        arr = np.repeat(arr, 2, axis=0)
    return arr[:2].astype(np.float32)


def _mask_to_png_base64(mask: np.ndarray) -> str:
    from PIL import Image

    binary = (mask == OIL).astype(np.uint8) * 255
    buf = io.BytesIO()
    Image.fromarray(binary, mode="L").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _source_to_png_base64(vv_band_db: np.ndarray) -> str:
    """Render the analyzed VV band as a normal viewable grayscale PNG
    (2nd-98th percentile contrast stretch, matching streamlit_app.py's
    sar_to_rgba convention). Browsers can't display raw multi-band GeoTIFFs
    or calibrated float arrays inline -- this is what the frontend shows
    instead of the original upload, so a real Sentinel-1 product looks like
    a normal SAR quicklook regardless of source format.
    """
    from PIL import Image

    lo, hi = np.percentile(vv_band_db, [2, 98])
    norm = np.clip((vv_band_db - lo) / (hi - lo + 1e-6), 0, 1)
    img = (norm * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img, mode="L").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _annotated_jpeg_base64(vv_band_db: np.ndarray, mask: np.ndarray) -> str:
    """Bake the real detected region directly into a single flattened JPEG:
    the same contrast-stretched grayscale scene as _source_to_png_base64,
    with the actual segmentation mask (not an approximate box) highlighted --
    a translucent red fill over every detected pixel plus a solid outline
    around its boundary. This is what the frontend displays and stores on the
    incident, so "where the model found oil" is visible in the image itself
    rather than a separately-positioned overlay element.
    """
    from PIL import Image, ImageFilter

    lo, hi = np.percentile(vv_band_db, [2, 98])
    norm = np.clip((vv_band_db - lo) / (hi - lo + 1e-6), 0, 1)
    gray = (norm * 255).astype(np.uint8)
    rgb = np.stack([gray, gray, gray], axis=-1).astype(np.float32)

    oil = mask == OIL
    if oil.any():
        # Translucent red fill over the detected region.
        fill = np.array([255.0, 40.0, 40.0])
        alpha = 0.45
        rgb[oil] = rgb[oil] * (1 - alpha) + fill * alpha

        # Solid outline: pixels that are oil but border a non-oil pixel.
        oil_img = Image.fromarray((oil.astype(np.uint8) * 255), mode="L")
        eroded = oil_img.filter(ImageFilter.MinFilter(3))
        edge = oil & (np.asarray(eroded) == 0)
        rgb[edge] = [255.0, 60.0, 60.0]

    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
    # Downscale to a max dimension so the result is a clean, browser-friendly
    # JPEG that fits comfortably in the frontend's localStorage (a full
    # 2048x2048 image base64-encodes to several MB and can blow the quota,
    # silently dropping the stored image on the dashboard). 1024px stays sharp.
    MAX_DIM = 1024
    if max(out.size) > MAX_DIM:
        scale = MAX_DIM / max(out.size)
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


class ImpactRequest(BaseModel):
    latitude: float
    longitude: float
    oilPersistence: str  # "Persistent" | "Non-persistent"
    volumeTonnes: float


class ImpactComponent(BaseModel):
    label: str
    value: float
    note: str


class ImpactResponse(BaseModel):
    """Real, data-backed replacement for the frontend's calculateImpact()
    heuristic -- see scripts/train_impact_model.py. score/severity map
    directly onto the frontend's ImpactAssessment/RiskLevel types.
    """
    score: float
    severity: str  # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    distanceToCoastKm: float
    isOceanPoint: bool
    components: list[ImpactComponent]
    modelTestMae: float
    modelTestR2: float
    modelTrainingRows: int


EARTH_KM_PER_DEG = 111.32


def _distance_to_coast_km(lat: float, lon: float, max_radius_km: float = 500.0, step_km: float = 2.0) -> tuple[float, bool]:
    """Step outward from (lat, lon) in a coarse ring search until crossing the
    land/ocean boundary, using the same 1km world land/ocean raster approach
    the source dataset's own methodology describes (see the dataset PDF).
    Returns (distance_km, is_ocean_point). If already on land, distance is 0
    and the ring search instead finds the nearest *water* pixel (mirroring
    how the dataset handles inland source points like pipelines).
    """
    from global_land_mask import globe

    is_ocean = not bool(globe.is_land(lat, lon))
    target_is_land = is_ocean  # searching for the opposite of the start point

    radius = step_km
    while radius <= max_radius_km:
        n_samples = max(8, int(2 * np.pi * radius / step_km))
        angles = np.linspace(0, 2 * np.pi, n_samples, endpoint=False)
        dlat = (radius * np.cos(angles)) / EARTH_KM_PER_DEG
        dlon = (radius * np.sin(angles)) / (EARTH_KM_PER_DEG * max(0.1, np.cos(np.radians(lat))))
        lats = lat + dlat
        lons = lon + dlon
        is_land = globe.is_land(lats, lons)
        hit = is_land if target_is_land else ~is_land
        if hit.any():
            return round(radius, 1), is_ocean
        radius += step_km
    return max_radius_km, is_ocean


@app.post("/impact/predict", response_model=ImpactResponse)
def predict_impact(req: ImpactRequest):
    bundle = get_impact_model()
    model = bundle["model"]

    distance_km, is_ocean = _distance_to_coast_km(req.latitude, req.longitude)
    tropical = abs(req.latitude) <= 30.0  # coral/mangrove climate range proxy, matching the dataset's own definition

    row = pd.DataFrame([{
        "max_ptl_release_tonnes_log": np.log1p(max(0.0, req.volumeTonnes)),
        "distance_to_coast_km_log": np.log1p(distance_km),
        "abs_latitude": abs(req.latitude),
        "oil_persistence_class": req.oilPersistence,
        "is_ocean_point": str(int(is_ocean)),
        "coral_climate_range": str(int(tropical)),
        "mangrove_climate_range": str(int(tropical)),
    }])
    score = float(np.clip(model.predict(row)[0], 0.0, 100.0))
    severity = (
        "CRITICAL" if score >= 85 else "HIGH" if score >= 70 else "MEDIUM" if score >= 45 else "LOW"
    )

    return ImpactResponse(
        score=round(score, 1),
        severity=severity,
        distanceToCoastKm=distance_km,
        isOceanPoint=is_ocean,
        components=[
            ImpactComponent(
                label="Distance to Coast",
                value=distance_km,
                note=f"{'Offshore' if is_ocean else 'Coastal/inland source'} — nearest shoreline crossing found by land/ocean raster search",
            ),
            ImpactComponent(
                label="Oil Persistence",
                value=1.0 if req.oilPersistence == "Persistent" else 0.0,
                note=f"{req.oilPersistence} oil, {req.volumeTonnes:,.0f} t",
            ),
            ImpactComponent(
                label="Sensitive Habitat Range",
                value=1.0 if tropical else 0.0,
                note="Within coral/mangrove climate band (|lat| ≤ 30°)" if tropical else "Outside coral/mangrove climate band",
            ),
        ],
        modelTestMae=bundle["test_mae"],
        modelTestR2=bundle["test_r2"],
        modelTrainingRows=bundle["n_train"],
    )


# --------------------------------------------------------------------------
# Real nearby-features lookup (OpenStreetMap Overpass API)
# --------------------------------------------------------------------------

class NearbyFeature(BaseModel):
    category: str  # "fishing_harbour" | "protected_area" | "mangrove" | "coral_reef"
    name: str
    lat: float
    lon: float
    distanceKm: float
    bearing: str  # compass direction from the spill to the feature


class NearbyRequest(BaseModel):
    latitude: float
    longitude: float
    radiusKm: float = 90.0


class NearbyResponse(BaseModel):
    distanceToCoastKm: float
    isOceanPoint: bool
    features: list[NearbyFeature]
    source: str


_COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlmb = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return float(2 * r * np.arcsin(min(1.0, np.sqrt(a))))


def _bearing_compass(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    y = np.sin(np.radians(lon2 - lon1)) * np.cos(np.radians(lat2))
    x = np.cos(np.radians(lat1)) * np.sin(np.radians(lat2)) - np.sin(np.radians(lat1)) * np.cos(
        np.radians(lat2)
    ) * np.cos(np.radians(lon2 - lon1))
    deg = (np.degrees(np.arctan2(y, x)) + 360) % 360
    return _COMPASS_16[round(deg / 22.5) % 16]


# Overpass category -> query fragments. Kept small and specific so the query
# stays within Overpass's free public-instance timeout.
_OVERPASS_CATEGORIES: dict[str, list[str]] = {
    "fishing_harbour": [
        'node["leisure"="marina"]',
        'node["seamark:type"="harbour"]',
        'way["harbour"="yes"]',
        'node["man_made"="pier"]',
    ],
    "protected_area": [
        'way["leisure"="nature_reserve"]',
        'way["boundary"="protected_area"]',
        'node["leisure"="nature_reserve"]',
    ],
    "mangrove": ['way["natural"="wetland"]["wetland"="mangrove"]'],
    "coral_reef": ['way["natural"="reef"]', 'node["natural"="reef"]'],
}


def _query_overpass(lat: float, lon: float, radius_m: int) -> list[dict]:
    import urllib.parse
    import urllib.request

    fragments = []
    for cat, selectors in _OVERPASS_CATEGORIES.items():
        for sel in selectors:
            fragments.append(f'{sel}(around:{radius_m},{lat},{lon});')
    query = f"[out:json][timeout:25];({''.join(fragments)});out tags center 60;"

    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter", data=data, headers={"User-Agent": "Varuna/1.0"}
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        payload = json.loads(resp.read().decode())
    return payload.get("elements", [])


def _classify_osm(tags: dict) -> str | None:
    if tags.get("wetland") == "mangrove":
        return "mangrove"
    if tags.get("natural") == "reef":
        return "coral_reef"
    if tags.get("leisure") == "nature_reserve" or tags.get("boundary") == "protected_area":
        return "protected_area"
    if (
        tags.get("leisure") == "marina"
        or tags.get("seamark:type") == "harbour"
        or tags.get("harbour") == "yes"
        or tags.get("man_made") == "pier"
    ):
        return "fishing_harbour"
    return None


_CATEGORY_LABELS = {
    "fishing_harbour": "Fishing harbour / port",
    "protected_area": "Protected area / sanctuary",
    "mangrove": "Mangrove wetland",
    "coral_reef": "Coral reef",
}


@app.post("/environment/nearby", response_model=NearbyResponse)
def environment_nearby(req: NearbyRequest):
    """Real named coastal/ecological features near a spill, from OpenStreetMap
    via the Overpass API — the nearest fishing harbour, protected-area/wildlife
    sanctuary, mangrove wetland and coral reef, each with real distance and
    bearing. Powers the Impact page's "nearest affected features" panel.
    """
    distance_km, is_ocean = _distance_to_coast_km(req.latitude, req.longitude)
    radius_m = int(req.radiusKm * 1000)

    try:
        elements = _query_overpass(req.latitude, req.longitude, radius_m)
    except Exception as e:
        raise HTTPException(502, f"OpenStreetMap Overpass lookup failed: {e}")

    # Nearest feature per category.
    best: dict[str, NearbyFeature] = {}
    for el in elements:
        tags = el.get("tags", {})
        category = _classify_osm(tags)
        if category is None:
            continue
        center = el if "lat" in el else el.get("center")
        if not center or "lat" not in center:
            continue
        flat, flon = float(center["lat"]), float(center["lon"])
        dist = _haversine_km(req.latitude, req.longitude, flat, flon)
        if category not in best or dist < best[category].distanceKm:
            best[category] = NearbyFeature(
                category=category,
                name=tags.get("name") or f"Unnamed {_CATEGORY_LABELS[category].lower()}",
                lat=round(flat, 5),
                lon=round(flon, 5),
                distanceKm=round(dist, 1),
                bearing=_bearing_compass(req.latitude, req.longitude, flat, flon),
            )

    features = sorted(best.values(), key=lambda f: f.distanceKm)
    return NearbyResponse(
        distanceToCoastKm=distance_km,
        isOceanPoint=is_ocean,
        features=features,
        source="OpenStreetMap Overpass API",
    )


# --------------------------------------------------------------------------
# Land-aware drift forecast (physics + coastline beaching)
# --------------------------------------------------------------------------

class DriftRequest(BaseModel):
    latitude: float
    longitude: float
    currentSpeed: float  # m/s
    currentDirection: float  # deg, "toward" convention
    windSpeed: float  # m/s
    windDirection: float  # deg
    spillAreaKm2: float
    windage: float = 0.03


class DriftPoint(BaseModel):
    hours: int
    lat: float
    lon: float
    distanceKm: float
    uncertaintyKm: float
    beached: bool


class DriftResponse(BaseModel):
    uOil: float
    vOil: float
    speed: float
    directionDeg: float
    windageCoefficient: float
    points: list[DriftPoint]
    beached: bool
    beachedAtHours: float | None
    source: str


FORECAST_HOURS = [0, 6, 12, 24, 48, 72]


def _destination(lat: float, lon: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    dlat = (distance_km * np.cos(np.radians(bearing_deg))) / 110.574
    dlon = (distance_km * np.sin(np.radians(bearing_deg))) / (111.32 * np.cos(np.radians(lat)))
    return lat + dlat, lon + dlon


@app.post("/drift/forecast", response_model=DriftResponse)
def drift_forecast(req: DriftRequest):
    """Physics drift forecast that respects the coastline: V_oil = V_current +
    C_w*V_wind (the same model the frontend engine uses), but walked forward in
    fine steps and *stopped at first land contact* — real oil beaches on the
    shore, it does not continue inland. Uses the global-land-mask 1km raster to
    detect the crossing. Returns the standard forecast hours with positions
    clamped at the beaching point, plus a beached flag/time.
    """
    from global_land_mask import globe

    cw = req.windage
    cur_u = req.currentSpeed * np.sin(np.radians(req.currentDirection))
    cur_v = req.currentSpeed * np.cos(np.radians(req.currentDirection))
    wind_u = req.windSpeed * np.sin(np.radians(req.windDirection))
    wind_v = req.windSpeed * np.cos(np.radians(req.windDirection))
    u_oil = cur_u + cw * wind_u
    v_oil = cur_v + cw * wind_v
    speed = float(np.hypot(u_oil, v_oil))
    direction = float((np.degrees(np.arctan2(u_oil, v_oil)) + 360) % 360)
    base_radius = float(np.sqrt(max(req.spillAreaKm2, 0.0) / np.pi))

    # Walk forward in 0.25 h steps; freeze position once the slick reaches land.
    # A spill's own coordinates often fall in a raster cell flagged "land"
    # (the 1km mask can't resolve a slick sitting just off a coast), so we
    # ignore land contact until the slick has travelled MIN_TRAVEL_KM — beyond
    # that coastal-ambiguity zone, hitting land means genuine beaching and the
    # oil stays put on the shore (which is the physically correct behaviour).
    MIN_TRAVEL_KM = 3.0
    dt = 0.25
    beached = False
    beached_at: float | None = None
    frozen_lat, frozen_lon, frozen_dist = req.latitude, req.longitude, 0.0

    positions: dict[int, tuple[float, float, float]] = {0: (req.latitude, req.longitude, 0.0)}
    t = 0.0
    last_lat, last_lon = req.latitude, req.longitude
    max_h = FORECAST_HOURS[-1]
    while t < max_h:
        t = round(t + dt, 3)
        if not beached:
            dist = speed * 3.6 * t
            lat, lon = _destination(req.latitude, req.longitude, direction, dist)
            on_land = dist > MIN_TRAVEL_KM and bool(globe.is_land(lat, lon))
            if on_land:
                beached = True
                beached_at = t
                # freeze at the last water position (the shoreline it beaches on)
                frozen_lat, frozen_lon = last_lat, last_lon
                frozen_dist = speed * 3.6 * max(0.0, t - dt)
            else:
                last_lat, last_lon = lat, lon
                frozen_lat, frozen_lon, frozen_dist = lat, lon, dist
        # record whenever we cross a reporting hour
        for h in FORECAST_HOURS:
            if h not in positions and t >= h:
                positions[h] = (frozen_lat, frozen_lon, frozen_dist)
    for h in FORECAST_HOURS:
        positions.setdefault(h, (frozen_lat, frozen_lon, frozen_dist))

    points = []
    for h in FORECAST_HOURS:
        plat, plon, pdist = positions[h]
        points.append(
            DriftPoint(
                hours=h,
                lat=round(plat, 5),
                lon=round(plon, 5),
                distanceKm=round(pdist, 2),
                uncertaintyKm=round(base_radius + pdist * 0.12 + h * 0.05, 2),
                beached=beached and beached_at is not None and h >= beached_at,
            )
        )

    return DriftResponse(
        uOil=round(u_oil, 4),
        vOil=round(v_oil, 4),
        speed=round(speed, 4),
        directionDeg=round(direction, 1),
        windageCoefficient=cw,
        points=points,
        beached=beached,
        beachedAtHours=round(beached_at, 2) if beached_at is not None else None,
        source="Varuna physics drift + global-land-mask coastline",
    )


# --------------------------------------------------------------------------
# OILY operational services (incidents, simulations, environment, impact
# composition, historical intelligence, response, chat). Mounted here so the
# whole platform runs in one process for the demo; the router is self-contained
# (see varuna.oily) and could be split into its own service unchanged.
# --------------------------------------------------------------------------
from varuna.oily.api import router as oily_router  # noqa: E402
from varuna.oily import db as oily_db  # noqa: E402

app.include_router(oily_router)


@app.on_event("startup")
def _oily_startup():
    oily_db.init_db()


@app.get("/health")
def health():
    result: dict = {"status": "ok"}
    try:
        result["oily_storage"] = oily_db.storage_info()
    except Exception as e:  # pragma: no cover
        result["oily_storage"] = {"error": str(e)}
    try:
        seg = get_segmenter()
        result["segmenter"] = {"device": seg.device, "checkpoint": CHECKPOINT_PATH, "val_miou": seg.val_miou}
    except HTTPException as e:
        result["segmenter"] = {"error": e.detail}
    try:
        bundle = get_impact_model()
        result["impact_model"] = {
            "test_mae": bundle["test_mae"], "test_r2": bundle["test_r2"], "n_train": bundle["n_train"],
        }
    except HTTPException as e:
        result["impact_model"] = {"error": e.detail}
    return result


@app.post("/detect", response_model=DetectionResponse)
async def detect(file: UploadFile = File(...)):
    seg = get_segmenter()
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")

    try:
        vv_vh_db = _load_vv_vh_from_bytes(data)
    except Exception as e:
        raise HTTPException(400, f"could not read uploaded image as SAR raster: {e}")

    h, w = vv_vh_db.shape[1:]
    mask, prob = seg.segment(vv_vh_db, return_prob=True)

    geometry = largest_polygon_geometry(mask, pixel_area_m2=100.0)
    bbox = largest_region_bbox(mask)
    has_oil = geometry is not None

    if has_oil:
        row_min, col_min, row_max, col_max = bbox
        spill_probability = float(prob[mask == OIL].mean())
        box = BoundingBox(
            x=col_min / w, y=row_min / h,
            w=(col_max - col_min) / w, h=(row_max - row_min) / h,
            score=round(spill_probability, 3),
        )
        boxes = [box]
    else:
        spill_probability = float(prob.mean())
        boxes = []

    miou = seg.val_miou
    model_name = (
        f"Varuna SAR Segmenter (DeepLabV3+/resnet34, val mIoU {miou:.3f})"
        if miou is not None
        else "Varuna SAR Segmenter (DeepLabV3+/resnet34)"
    )

    return DetectionResponse(
        model=model_name,
        classification="oil_spill" if has_oil else "background",
        confidence=round(spill_probability, 4),
        spillProbability=round(spill_probability, 4),
        backgroundProbability=round(1.0 - spill_probability, 4),
        segmentationAvailable=True,
        estimatedAreaKm2=round((geometry.area_m2 / 1e6) if has_oil else 0.0, 3),
        boxes=boxes,
        geometryAreaM2=geometry.area_m2 if has_oil else None,
        geometryElongation=geometry.elongation if has_oil else None,
        maskPngBase64=_mask_to_png_base64(mask),
        sourcePreviewPngBase64=_source_to_png_base64(vv_vh_db[0]),
        annotatedJpegBase64=_annotated_jpeg_base64(vv_vh_db[0], mask),
    )
