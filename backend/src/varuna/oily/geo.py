"""Geodesy helpers shared across the OILY services (drift integration, exposure
intersection, nearby-feature bearings). Kept dependency-light (numpy only) so
any service can use them without pulling in the ML stack.
"""
from __future__ import annotations

import math

import numpy as np

EARTH_R_KM = 6371.0088
_COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
               "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(deg: float | None) -> str:
    if deg is None:
        return "—"
    return _COMPASS_16[round((deg % 360) / 22.5) % 16]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(a)))


def destination(lat: float, lon: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    """Great-circle destination point given a start, bearing and distance.

    Uses the spherical forward formula (not a flat dlat/dlon approximation) so
    the integrated trajectory stays accurate over the full 72 h horizon and at
    high latitudes."""
    ang = distance_km / EARTH_R_KM
    br = math.radians(bearing_deg)
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(ang) + math.cos(p1) * math.sin(ang) * math.cos(br))
    l2 = l1 + math.atan2(
        math.sin(br) * math.sin(ang) * math.cos(p1),
        math.cos(ang) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def bearing_compass(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    y = math.sin(math.radians(lon2 - lon1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon2 - lon1))
    deg = (math.degrees(math.atan2(y, x)) + 360) % 360
    return compass(deg)


def circle_polygon(lat: float, lon: float, radius_km: float, segments: int = 24) -> list[list[float]]:
    """A closed lat/lon ring approximating a circle of given radius — used for
    uncertainty envelopes and spill footprints on the map."""
    ring = []
    for i in range(segments + 1):
        b = 360.0 * i / segments
        plat, plon = destination(lat, lon, b, radius_km)
        ring.append([round(plat, 6), round(plon, 6)])
    return ring


def distance_to_coast_km(lat: float, lon: float, max_radius_km: float = 500.0,
                         step_km: float = 2.0) -> tuple[float, bool]:
    """Ring-search outward until the land/ocean boundary is crossed, using the
    global-land-mask 1 km raster. Returns (distance_km, is_ocean_point). Mirrors
    the inference API's own implementation so both agree.
    """
    from global_land_mask import globe

    is_ocean = not bool(globe.is_land(lat, lon))
    target_is_land = is_ocean
    radius = step_km
    while radius <= max_radius_km:
        n = max(8, int(2 * math.pi * radius / step_km))
        angles = np.linspace(0, 2 * math.pi, n, endpoint=False)
        dlat = (radius * np.cos(angles)) / 111.32
        dlon = (radius * np.sin(angles)) / (111.32 * max(0.1, math.cos(math.radians(lat))))
        is_land = globe.is_land(lat + dlat, lon + dlon)
        hit = is_land if target_is_land else ~is_land
        if bool(np.any(hit)):
            return round(radius, 1), is_ocean
        radius += step_km
    return max_radius_km, is_ocean


def is_land(lat: float, lon: float) -> bool:
    from global_land_mask import globe

    return bool(globe.is_land(lat, lon))
