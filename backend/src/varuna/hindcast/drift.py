"""Reverse (and forward) Lagrangian drift via OpenDrift/OpenOil.

Real physics from day one -- this is the one pipeline stage that doesn't need
a fine-tuned model or downloaded training data to be genuinely correct.
OpenDrift is CPU-only, so it never competes with GPU work in detect/segment.py.

Two forcing modes:
- `constant_readers()` uses OpenDrift's built-in idealized constant-field
  reader -- no CMEMS/ERA5 download needed. This is what proves the pipeline
  plumbing end-to-end (Phase 1 baseline) before any data-access accounts are
  set up.
- `netcdf_readers()` points at real CMEMS current/Stokes-drift and ERA5 wind
  NetCDF files once Phase 0's data-source registrations are done.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np


@dataclass
class DriftEnsembleConfig:
    n_particles: int = 500
    wind_drift_factor_range: tuple[float, float] = (0.02, 0.04)
    horizontal_diffusivity: float = 10.0  # m^2/s


@dataclass
class DriftResult:
    lons: np.ndarray  # shape (n_particles, n_timesteps)
    lats: np.ndarray
    times: list[datetime]


def constant_readers(current_u_ms: float, current_v_ms: float, wind_u_ms: float, wind_v_ms: float):
    """Idealized constant-field reader, for the synthetic smoke test and for
    sanity-checking the ensemble logic in isolation from real data access.
    """
    from opendrift.readers.reader_constant import Reader

    return Reader({
        "x_sea_water_velocity": current_u_ms,
        "y_sea_water_velocity": current_v_ms,
        "x_wind": wind_u_ms,
        "y_wind": wind_v_ms,
    })


def netcdf_readers(cmems_path_or_url: str, era5_path_or_url: str):
    """Real forcing once CMEMS/ERA5 access is set up (README Phase 0).
    OpenDrift's generic CF reader handles both -- it introspects standard
    names, so no per-source parsing is needed here.
    """
    from opendrift.readers.reader_netCDF_CF_generic import Reader

    return [Reader(cmems_path_or_url), Reader(era5_path_or_url)]


def _run_one_direction(readers, seed_lon: float, seed_lat: float, seed_time: datetime,
                        duration_hours: float, direction: int, config: DriftEnsembleConfig,
                        enable_weathering: bool) -> DriftResult:
    """direction=+1 forward, direction=-1 backward. Weathering is left OFF for
    backward runs regardless of `enable_weathering` -- OpenDrift can't invert
    nonlinear evaporation/emulsification, so un-weathering is instead applied
    analytically to the seed volume beforehand (see hindcast/weathering.py).
    This function only ever seeds position/drift, not fixing that limitation.
    """
    from opendrift.models.openoil import OpenOil

    o = OpenOil(loglevel=50)
    readers_list = readers if isinstance(readers, (list, tuple)) else [readers]
    o.add_reader(readers_list)

    backward = direction < 0
    weathering_on = enable_weathering and not backward
    o.set_config("processes:evaporation", weathering_on)
    o.set_config("processes:emulsification", weathering_on)
    o.set_config("environment:fallback:horizontal_diffusivity", config.horizontal_diffusivity)

    low, high = config.wind_drift_factor_range
    per_particle_wdf = np.random.uniform(low, high, config.n_particles)

    o.seed_elements(
        lon=seed_lon, lat=seed_lat, time=seed_time,
        number=config.n_particles, radius=500,
        wind_drift_factor=per_particle_wdf,
    )

    time_step = timedelta(minutes=15 * direction)
    o.run(duration=timedelta(hours=duration_hours), time_step=time_step, time_step_output=timedelta(hours=1))

    lons, _ = o.get_property("lon")
    lats, _ = o.get_property("lat")
    times = o.get_time_array()[0]
    return DriftResult(lons=np.asarray(lons), lats=np.asarray(lats), times=list(times))


def run_reverse_ensemble(readers, seed_lon: float, seed_lat: float, seed_time: datetime,
                          search_window_hours: float,
                          config: DriftEnsembleConfig = DriftEnsembleConfig()) -> DriftResult:
    """Backward run from the detected slick polygon's centroid, seeking the
    origin. `search_window_hours` should come from the age estimate in
    weathering.py's estimate_age(), not a fixed guess.
    """
    return _run_one_direction(readers, seed_lon, seed_lat, seed_time,
                               search_window_hours, direction=-1, config=config,
                               enable_weathering=False)


def run_forward_forecast(readers, seed_lon: float, seed_lat: float, seed_time: datetime,
                          forecast_hours: float = 48.0,
                          config: DriftEnsembleConfig = DriftEnsembleConfig()) -> DriftResult:
    """Forward run for response planning -- the PS's "predict the future
    flow" requirement. Weathering stays on here; the physics is fully valid
    going forward in time.
    """
    return _run_one_direction(readers, seed_lon, seed_lat, seed_time,
                               forecast_hours, direction=+1, config=config,
                               enable_weathering=True)


def origin_cone_kde(drift_result: DriftResult, timestep_index: int = -1):
    """Kernel-density estimate of the pooled reverse-ensemble particle
    positions at a given timestep (default: the final -- i.e. earliest in
    wall-clock time -- backward step, the origin estimate). Returns the KDE
    object plus the weighted centroid, so callers can both evaluate density
    anywhere and quickly get a point estimate for display.
    """
    from scipy.stats import gaussian_kde

    lons = drift_result.lons[:, timestep_index]
    lats = drift_result.lats[:, timestep_index]
    valid = ~(np.isnan(lons) | np.isnan(lats))
    lons, lats = lons[valid], lats[valid]

    kde = gaussian_kde(np.vstack([lons, lats]))
    centroid = (float(np.mean(lons)), float(np.mean(lats)))
    return kde, centroid
