"""Orchestrates preprocess -> detect -> hindcast -> attribute into one call.

`run_synthetic_incident()` is the Phase 1 smoke test: every stage is the real
module (not a mock), but the input scene, currents/winds, and AIS tracks are
synthetically generated so the whole chain can be proven out today, without
waiting on Sentinel-1/CMEMS/ERA5/AIS account registrations.

`run_real_scene_incident()` is Phase 2's upgrade: detection now runs the
actual fine-tuned model on a real, held-out Sentinel-1 scene from the Zenodo
validation split. Hindcast forcing and AIS are still synthetic (Phase 0's
CMEMS/ERA5/AIS accounts aren't wired up yet) -- swap those generators for real
loaders next; none of the downstream scoring logic needs to change either
time, which is exactly why detect/hindcast/attribute are kept decoupled.
"""
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from varuna.preprocess.sar_preprocess import despeckle_lee_sigma, wind_plausibility_gate
from varuna.detect.segment import ClassicalBaseline, FineTunedSegmenter, largest_polygon_geometry, SlickGeometry
from varuna.hindcast import weathering, drift
from varuna.attribute.ais_ingest import synthetic_ais_tracks, AISPing
from varuna.attribute.scoring import score_vessel, rank_suspects, ScoreBreakdown


@dataclass
class IncidentResult:
    mask: np.ndarray
    geometry: SlickGeometry
    age: weathering.AgeEstimate
    origin_lon: float
    origin_lat: float
    origin_time: datetime
    suspects: list[ScoreBreakdown]
    tracks: dict[str, list[AISPing]]
    bbox: tuple[float, float, float, float]  # (min_lon, min_lat, max_lon, max_lat) the scene's footprint was projected onto


def _pixel_to_lonlat(row: float, col: float, shape: tuple[int, int],
                      bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    """bbox = (min_lon, min_lat, max_lon, max_lat). Simple linear mapping --
    fine for a small scene; swap for the real product's affine geotransform
    (via rasterio) once working with actual Sentinel-1 GRD products.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    n_rows, n_cols = shape
    lon = min_lon + (col / n_cols) * (max_lon - min_lon)
    lat = max_lat - (row / n_rows) * (max_lat - min_lat)  # row 0 = top = max_lat
    return lon, lat


def _make_synthetic_scene(shape=(200, 200), sea_db=-12.0, slick_db=-20.0, noise_db=1.0, seed=0):
    rng = np.random.default_rng(seed)
    sigma0 = sea_db + rng.normal(0, noise_db, size=shape)

    # elongated elliptical dark patch, roughly centered, mimicking a real slick's shape
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    cy, cx = shape[0] * 0.55, shape[1] * 0.45
    major, minor, theta = 40, 10, np.deg2rad(25)
    ct, st = np.cos(theta), np.sin(theta)
    x_rot = (xx - cx) * ct + (yy - cy) * st
    y_rot = -(xx - cx) * st + (yy - cy) * ct
    ellipse = (x_rot / major) ** 2 + (y_rot / minor) ** 2 <= 1.0
    sigma0[ellipse] = slick_db + rng.normal(0, noise_db * 0.5, size=ellipse.sum())

    wind_speed = np.full(shape, 5.0) + rng.normal(0, 0.3, size=shape)  # inside the 2-10 m/s plausibility window
    return sigma0, wind_speed


def _hindcast_and_attribute(geometry: SlickGeometry, mask_shape: tuple[int, int],
                             bbox: tuple[float, float, float, float],
                             incident_time: datetime, seed: int) -> tuple[float, float, datetime, list, dict]:
    """Shared by both incident paths: geometry in -> (origin, suspects, tracks)
    out. Detection differs (classical vs. fine-tuned); everything downstream
    of a detected polygon is identical, which is the point of keeping these
    stages decoupled.
    """
    origin_lon_guess, origin_lat_guess = _pixel_to_lonlat(
        geometry.centroid_row, geometry.centroid_col, mask_shape, bbox)

    age = weathering.estimate_age(geometry.area_m2, geometry.elongation, mean_contrast_db=-8.0)
    _ = weathering.un_weather_volume(geometry.area_m2, age)  # computed for the evidence bundle; not needed for seeding position

    reader = drift.constant_readers(current_u_ms=-0.10, current_v_ms=0.05, wind_u_ms=3.0, wind_v_ms=-2.0)
    reverse = drift.run_reverse_ensemble(
        reader, seed_lon=origin_lon_guess, seed_lat=origin_lat_guess, seed_time=incident_time,
        search_window_hours=age.hours_since_release,
    )
    kde, (cone_lon, cone_lat) = drift.origin_cone_kde(reverse)
    origin_time = incident_time - timedelta(hours=age.hours_since_release)

    tracks = synthetic_ais_tracks(cone_lon, cone_lat, origin_time, seed=seed)
    densities_by_mmsi = {}
    for mmsi, pings in tracks.items():
        pts = np.array([[p.lon, p.lat] for p in pings]).T
        densities_by_mmsi[mmsi] = float(np.sum(kde(pts)))

    max_density = max(densities_by_mmsi.values()) or 1.0
    breakdowns = []
    for mmsi in tracks:
        proximity = densities_by_mmsi[mmsi] / max_density
        breakdowns.append(score_vessel(
            mmsi=mmsi,
            proximity_integral=proximity,
            had_ais_gap_in_window=False,
            loiter_or_speed_drop_anomaly=0.0,
            tonnage_plausibility=0.5,
        ))

    return cone_lon, cone_lat, origin_time, rank_suspects(breakdowns), tracks, age


def run_synthetic_incident(bbox: tuple[float, float, float, float] = (72.6, 18.7, 73.1, 19.2),
                            incident_time: datetime | None = None, seed: int = 0) -> IncidentResult:
    incident_time = incident_time or datetime.utcnow()

    sigma0_raw, wind_speed = _make_synthetic_scene(seed=seed)
    sigma0 = despeckle_lee_sigma(sigma0_raw, window=5, equivalent_looks=1.0)
    wmask = wind_plausibility_gate(sigma0, wind_speed)

    mask = ClassicalBaseline().segment(sigma0, wmask)
    geometry = largest_polygon_geometry(mask, pixel_area_m2=100.0)
    if geometry is None:
        raise RuntimeError("synthetic scene produced no detectable slick -- check thresholding")

    cone_lon, cone_lat, origin_time, suspects, tracks, age = _hindcast_and_attribute(
        geometry, sigma0.shape, bbox, incident_time, seed)

    return IncidentResult(
        mask=mask, geometry=geometry, age=age,
        origin_lon=cone_lon, origin_lat=cone_lat, origin_time=origin_time,
        suspects=suspects, tracks=tracks, bbox=bbox,
    )


def list_real_validation_scenes(data_root: str, category: str = "oil", val_fraction: float = 0.15,
                                 seed: int = 0, limit: int = 8):
    """Held-out (never seen during Phase 2 training) real scenes to demo the
    fine-tuned model on -- uses the exact same discover_pairs/split_pairs
    call as train.py so this is guaranteed to be validation data, not
    something the model has memorized.
    """
    from varuna.detect.dataset import discover_pairs, split_pairs

    pairs = discover_pairs(Path(data_root))
    _, val_pairs = split_pairs(pairs, val_fraction=val_fraction, seed=seed)
    return [p for p in val_pairs if p.category == category][:limit]


def run_real_scene_incident(image_path: str, segmenter: FineTunedSegmenter | None = None,
                             checkpoint_path: str = "models/segmenter_best.pt",
                             bbox: tuple[float, float, float, float] = (72.6, 18.7, 73.1, 19.2),
                             incident_time: datetime | None = None, seed: int = 0) -> IncidentResult:
    """Phase 2: real Sentinel-1 scene in, fine-tuned model detects the slick,
    everything downstream is identical to the synthetic path. `bbox` is a
    placeholder map location, not a real geotransform -- these Zenodo TIFFs
    don't carry a usable embedded geotransform (rasterio falls back to an
    identity matrix), despite the dataset description claiming they're
    georeferenced. Pass a pre-loaded `segmenter` to avoid reloading the model
    checkpoint on every call (e.g. from a cached Streamlit resource).
    """
    from varuna.detect.dataset import _read_vv_vh

    incident_time = incident_time or datetime.utcnow()
    vv_vh_db = _read_vv_vh(Path(image_path))

    segmenter = segmenter or FineTunedSegmenter(checkpoint_path)
    mask = segmenter.segment(vv_vh_db)

    geometry = largest_polygon_geometry(mask, pixel_area_m2=100.0)
    if geometry is None:
        raise RuntimeError(f"the trained model found no oil in {image_path} -- try a different validation scene")

    cone_lon, cone_lat, origin_time, suspects, tracks, age = _hindcast_and_attribute(
        geometry, mask.shape, bbox, incident_time, seed)

    return IncidentResult(
        mask=mask, geometry=geometry, age=age,
        origin_lon=cone_lon, origin_lat=cone_lat, origin_time=origin_time,
        suspects=suspects, tracks=tracks, bbox=bbox,
    )
