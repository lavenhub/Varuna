"""OILY trajectory simulation engine.

Conceptually mirrors the layering NOAA's PyGNOME uses (Environment -> Movers ->
Weatherers -> Output) without cloning it. OILY's own decomposition:

    DriftModel        — the mover: V_oil = V_current + C_w · V_wind
    DiffusionModel    — turbulent spreading (Fickian), grows the slick + decays
                        surface intensity over time (a light "weathering" proxy)
    UncertaintyModel  — the modelled spread envelope around the central track
    coastline check   — map/shoreline interaction (beaching), via global-land-mask
    TrajectoryEngine  — the interface every engine implements

The engine integrates the slick position *timestep by timestep* (forward Euler
with a great-circle displacement each step) and records a dense trajectory, not
a straight line between endpoints. ``SimpleOilyEngine`` is the transparent
deterministic implementation shipped today; ``PyGNOMEEngine`` is a documented,
not-yet-implemented seam so a real Lagrangian ensemble can be dropped in behind
the same interface without touching the API or the web client.

Everything this module produces is labelled SIMULATED upstream — it is a
model-based estimate, not an observation.
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import geo

# Empirical windage coefficient (fraction of wind speed imparted to a surface
# slick) — the ~3% value standard in operational oil-spill drift modelling.
DEFAULT_WINDAGE = 0.03
# Horizontal turbulent diffusion coefficient (m²/s), mid-range for coastal water.
DIFFUSION_COEFF_M2S = 2.0
# Beyond this travel distance a land-mask hit is genuine beaching rather than the
# spill's own coastal cell being flagged land by the 1 km raster.
MIN_TRAVEL_KM = 3.0

MODEL_VERSION = "varuna-drift-v1"


@dataclass
class TrajectoryInput:
    lat: float
    lon: float
    current_speed: float          # m/s
    current_direction: float      # deg, "toward" convention (0=N, 90=E)
    wind_speed: float             # m/s
    wind_direction: float         # deg, "toward"
    spill_area_km2: float
    windage: float = DEFAULT_WINDAGE
    duration_hours: float = 72.0
    time_step_minutes: float = 15.0
    diffusion: bool = True
    uncertainty: bool = True
    start_time: Optional[str] = None


@dataclass
class DensePoint:
    timestamp: str
    hours: float
    lat: float
    lon: float
    velocity: float
    direction: float
    distance_km: float
    uncertainty_km: float
    intensity: float
    status: str


@dataclass
class Waypoint:
    hours: float
    lat: float
    lon: float
    distance_km: float
    uncertainty_km: float
    beached: bool


@dataclass
class TrajectoryResult:
    points: list[DensePoint]
    waypoints: list[Waypoint]
    uncertainty_radius_km: list[float]
    uncertainty_polygon: list[list[float]]
    uncertainty_confidence: float
    speed: float
    direction_deg: float
    u_oil: float
    v_oil: float
    windage: float
    beached: bool
    beached_at_hours: Optional[float]
    diffusion_coeff: float
    engine: str
    model_version: str
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Component models
# --------------------------------------------------------------------------
class DriftModel:
    """The mover. Resolves current + windage into a single slick velocity vector.

        u = speed · sin(dir)      (east component)
        v = speed · cos(dir)      (north component)
        V_oil = V_current + C_w · V_wind
    """

    def __init__(self, windage: float = DEFAULT_WINDAGE):
        self.windage = windage

    def velocity(self, inp: TrajectoryInput) -> tuple[float, float, float, float]:
        cu = inp.current_speed * math.sin(math.radians(inp.current_direction))
        cv = inp.current_speed * math.cos(math.radians(inp.current_direction))
        wu = inp.wind_speed * math.sin(math.radians(inp.wind_direction))
        wv = inp.wind_speed * math.cos(math.radians(inp.wind_direction))
        u = cu + self.windage * wu
        v = cv + self.windage * wv
        speed = math.hypot(u, v)
        direction = (math.degrees(math.atan2(u, v)) + 360) % 360
        return u, v, speed, direction


class DiffusionModel:
    """Fickian spreading. Adds a sqrt(2·D·t) radius term and decays the relative
    surface intensity as the fixed mass spreads over a growing area — a light
    weathering proxy so 'concentration' falls off down-track."""

    def __init__(self, coeff_m2s: float = DIFFUSION_COEFF_M2S, enabled: bool = True):
        self.coeff = coeff_m2s if enabled else 0.0
        self.enabled = enabled

    def spread_radius_km(self, seconds: float) -> float:
        if not self.enabled:
            return 0.0
        return math.sqrt(2.0 * self.coeff * max(0.0, seconds)) / 1000.0

    def intensity(self, base_radius_km: float, seconds: float) -> float:
        """Relative peak surface intensity (1.0 at t=0), = A0 / (A0 + A_spread)."""
        a0 = math.pi * max(base_radius_km, 0.05) ** 2
        r = self.spread_radius_km(seconds)
        a_spread = math.pi * r ** 2
        return round(a0 / (a0 + a_spread), 4) if (a0 + a_spread) > 0 else 1.0


class UncertaintyModel:
    """The modelled spread envelope. Radius grows with the slick's initial size,
    ~12% of distance travelled (advection error under a constant assumed field),
    a small per-hour term, and the diffusion spread radius."""

    def __init__(self, base_radius_km: float, confidence: float = 0.80):
        self.base = base_radius_km
        self.confidence = confidence

    def radius_km(self, distance_km: float, hours: float, diffusion_km: float) -> float:
        return round(self.base + distance_km * 0.12 + hours * 0.05 + diffusion_km, 3)


# --------------------------------------------------------------------------
# Engine interface + implementations
# --------------------------------------------------------------------------
class TrajectoryEngine(ABC):
    name: str
    model_version: str

    @abstractmethod
    def simulate(self, inp: TrajectoryInput) -> TrajectoryResult:
        ...


def reporting_hours(duration_hours: float) -> list[float]:
    base = [0, 6, 12, 24, 48, 72]
    hrs = [h for h in base if h <= duration_hours]
    if not hrs or hrs[-1] != duration_hours:
        hrs.append(round(duration_hours, 2))
    return hrs


class SimpleOilyEngine(TrajectoryEngine):
    """Transparent deterministic engine: constant-field forward integration with
    diffusion, an uncertainty envelope and coastline beaching."""

    name = "SimpleOilyEngine"
    model_version = MODEL_VERSION

    def simulate(self, inp: TrajectoryInput) -> TrajectoryResult:
        drift = DriftModel(inp.windage)
        u, v, speed, direction = drift.velocity(inp)
        base_radius = math.sqrt(max(inp.spill_area_km2, 0.0) / math.pi)
        diffusion = DiffusionModel(enabled=inp.diffusion)
        uncertainty = UncertaintyModel(base_radius)

        dt_h = max(1.0, inp.time_step_minutes) / 60.0
        start = _parse_time(inp.start_time)
        speed_kmh = speed * 3.6
        max_h = inp.duration_hours

        notes = [
            "Constant-field forward integration: the current + wind field is held "
            "steady over the horizon, so the track is a modelled estimate, not a forecast "
            "of the true time-varying field.",
            f"V_oil = V_current + C_w·V_wind with C_w = {inp.windage}.",
        ]

        points: list[DensePoint] = []
        beached = False
        beached_at: Optional[float] = None
        last_lat, last_lon = inp.lat, inp.lon
        frozen_lat, frozen_lon, frozen_dist = inp.lat, inp.lon, 0.0

        # t = 0 origin point
        points.append(DensePoint(
            timestamp=_iso(start, 0), hours=0.0, lat=round(inp.lat, 6), lon=round(inp.lon, 6),
            velocity=round(speed, 4), direction=round(direction, 1), distance_km=0.0,
            uncertainty_km=round(base_radius, 3), intensity=1.0, status="afloat",
        ))

        steps = int(math.ceil(max_h / dt_h))
        for k in range(1, steps + 1):
            t = min(round(k * dt_h, 4), max_h)
            secs = t * 3600.0
            if not beached:
                dist = speed_kmh * t
                lat, lon = geo.destination(inp.lat, inp.lon, direction, dist)
                on_land = dist > MIN_TRAVEL_KM and geo.is_land(lat, lon)
                if on_land:
                    beached = True
                    beached_at = t
                    frozen_lat, frozen_lon = last_lat, last_lon
                    frozen_dist = speed_kmh * max(0.0, t - dt_h)
                    notes.append(f"Slick reaches the coastline at ~{t:.2f} h and beaches (stays on shore).")
                else:
                    last_lat, last_lon = lat, lon
                    frozen_lat, frozen_lon, frozen_dist = lat, lon, dist

            plat, plon, pdist = (frozen_lat, frozen_lon, frozen_dist)
            diff_km = diffusion.spread_radius_km(secs)
            points.append(DensePoint(
                timestamp=_iso(start, t),
                hours=t,
                lat=round(plat, 6),
                lon=round(plon, 6),
                velocity=0.0 if beached else round(speed, 4),
                direction=round(direction, 1),
                distance_km=round(pdist, 3),
                uncertainty_km=uncertainty.radius_km(pdist, t, diff_km),
                intensity=diffusion.intensity(base_radius, secs),
                status="beached" if (beached and beached_at is not None and t >= beached_at) else "afloat",
            ))
            if t >= max_h:
                break

        # Coarse reporting-hour waypoints (nearest dense point at/after each hour).
        waypoints: list[Waypoint] = []
        for h in reporting_hours(max_h):
            p = _point_at(points, h)
            waypoints.append(Waypoint(
                hours=h, lat=p.lat, lon=p.lon, distance_km=p.distance_km,
                uncertainty_km=p.uncertainty_km,
                beached=beached and beached_at is not None and h >= beached_at,
            ))

        # Uncertainty envelope: a corridor polygon = forward edge of each
        # waypoint circle down one side and back the other, closed into a ring.
        radii = [w.uncertainty_km for w in waypoints]
        polygon = _corridor_polygon(waypoints)

        return TrajectoryResult(
            points=points,
            waypoints=waypoints,
            uncertainty_radius_km=radii,
            uncertainty_polygon=polygon if inp.uncertainty else [],
            uncertainty_confidence=uncertainty.confidence,
            speed=round(speed, 4),
            direction_deg=round(direction, 1),
            u_oil=round(u, 4),
            v_oil=round(v, 4),
            windage=inp.windage,
            beached=beached,
            beached_at_hours=round(beached_at, 2) if beached_at is not None else None,
            diffusion_coeff=diffusion.coeff,
            engine=self.name,
            model_version=self.model_version,
            notes=notes,
        )


class PyGNOMEEngine(TrajectoryEngine):
    """Seam for a real Lagrangian particle ensemble (e.g. NOAA PyGNOME) behind
    the same interface. Not implemented — OILY does not use PyGNOME today and
    does not claim to. Wiring one in is purely additive: implement simulate()
    and register it in SimulationEngine._engines."""

    name = "PyGNOMEEngine"
    model_version = "pygnome-adapter-v0"

    def simulate(self, inp: TrajectoryInput) -> TrajectoryResult:  # pragma: no cover
        raise NotImplementedError(
            "PyGNOME adapter not wired in. OILY currently ships SimpleOilyEngine "
            "(varuna-drift-v1). This engine exists as an extension point only."
        )


class SimulationEngine:
    """Orchestrator the service calls. Selects a TrajectoryEngine by name and
    returns its result. Defaults to the transparent SimpleOilyEngine."""

    def __init__(self):
        self._engines: dict[str, TrajectoryEngine] = {
            SimpleOilyEngine.name: SimpleOilyEngine(),
            PyGNOMEEngine.name: PyGNOMEEngine(),
        }

    def run(self, inp: TrajectoryInput, engine: str = SimpleOilyEngine.name) -> TrajectoryResult:
        impl = self._engines.get(engine, self._engines[SimpleOilyEngine.name])
        return impl.simulate(inp)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _parse_time(iso: Optional[str]) -> datetime:
    if iso:
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _iso(start: datetime, hours: float) -> str:
    return (start + timedelta(hours=hours)).isoformat(timespec="seconds")


def _point_at(points: list[DensePoint], hours: float) -> DensePoint:
    for p in points:
        if p.hours >= hours - 1e-6:
            return p
    return points[-1]


def _corridor_polygon(waypoints: list[Waypoint]) -> list[list[float]]:
    """Build a closed polygon hugging the left edge of the track out to the last
    waypoint, then back along the right edge — the modelled spread corridor."""
    if len(waypoints) < 2:
        if waypoints:
            return geo.circle_polygon(waypoints[0].lat, waypoints[0].lon,
                                      max(waypoints[0].uncertainty_km, 0.5))
        return []
    left: list[list[float]] = []
    right: list[list[float]] = []
    for i, w in enumerate(waypoints):
        # local bearing along the track
        if i < len(waypoints) - 1:
            nxt = waypoints[i + 1]
        else:
            nxt = w
        brg = _local_bearing(w, nxt) if (nxt is not w) else _local_bearing(waypoints[i - 1], w)
        r = max(w.uncertainty_km, 0.3)
        llat, llon = geo.destination(w.lat, w.lon, (brg - 90) % 360, r)
        rlat, rlon = geo.destination(w.lat, w.lon, (brg + 90) % 360, r)
        left.append([round(llat, 6), round(llon, 6)])
        right.append([round(rlat, 6), round(rlon, 6)])
    return left + list(reversed(right)) + [left[0]]


def _local_bearing(a: Waypoint, b: Waypoint) -> float:
    y = math.sin(math.radians(b.lon - a.lon)) * math.cos(math.radians(b.lat))
    x = math.cos(math.radians(a.lat)) * math.sin(math.radians(b.lat)) - math.sin(
        math.radians(a.lat)
    ) * math.cos(math.radians(b.lat)) * math.cos(math.radians(b.lon - a.lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


ENGINE = SimulationEngine()
