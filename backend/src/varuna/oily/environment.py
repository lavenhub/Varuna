"""Environment service: the single provider of wind / current / wave / sea-temp
for an incident, with an explicit data-provenance label on every field.

Live values come from Open-Meteo's free (no-key) Forecast + Marine APIs. Those
are numerical-model outputs, not in-situ station readings, so they are labelled
**MODELLED** — not OBSERVED — to keep the platform honest about what the numbers
are (see the project's OBSERVED/MODELLED/ESTIMATED/SIMULATED discipline). When
the live call is unreachable the service falls back to the incident's last stored
environmental snapshot, carrying that snapshot's own status label; if there is
none, it returns a clearly-labelled ESTIMATED placeholder rather than inventing
plausible numbers.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from . import repo

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _get_json(url: str, params: dict, timeout: float = 12.0) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": "OILY/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_live(lat: float, lon: float) -> Optional[dict]:
    """Return live conditions in the app's m/s convention, or None on failure.

    dataStatus is MODELLED: Open-Meteo serves NWP + ocean-model output, not
    station observations.
    """
    try:
        marine = _get_json(MARINE_URL, {
            "latitude": lat, "longitude": lon,
            "current": "wave_height,ocean_current_velocity,ocean_current_direction",
        })
        weather = _get_json(FORECAST_URL, {
            "latitude": lat, "longitude": lon,
            "current": "wind_speed_10m,wind_direction_10m,temperature_2m",
        })
    except Exception:
        return None

    mc = marine.get("current", {})
    wc = weather.get("current", {})
    kmh_to_ms = lambda v: round(v / 3.6, 2) if v is not None else None
    return {
        "currentSpeed": kmh_to_ms(mc.get("ocean_current_velocity")),
        "currentDirection": round(mc["ocean_current_direction"]) if mc.get("ocean_current_direction") is not None else None,
        "windSpeed": kmh_to_ms(wc.get("wind_speed_10m")),
        "windDirection": round(wc["wind_direction_10m"]) if wc.get("wind_direction_10m") is not None else None,
        "waveHeight": mc.get("wave_height"),
        "temperature": wc.get("temperature_2m"),
        "source": "Open-Meteo Marine + Forecast (live NWP/ocean model)",
        "dataStatus": "MODELLED",
        "observationTime": wc.get("time") or _now(),
        "confidence": 0.75,
    }


def get_environment(incident_id: str, lat: float, lon: float, *, store: bool = True) -> dict:
    """Resolve the current environmental field for an incident, preferring live
    data and persisting it as a snapshot when fetched."""
    live = fetch_live(lat, lon)
    if live is not None:
        if store:
            repo.add_snapshot(
                incident_id=incident_id,
                wind_speed=live["windSpeed"], wind_direction=live["windDirection"],
                current_speed=live["currentSpeed"], current_direction=live["currentDirection"],
                wave_height=live["waveHeight"], sea_temperature=live["temperature"],
                data_source=live["source"], data_status=live["dataStatus"],
                confidence=live["confidence"], observation_time=live["observationTime"],
            )
        return _shape(incident_id, live)

    # Fallback 1: last stored snapshot for this incident.
    snap = repo.latest_snapshot(incident_id)
    if snap is not None:
        return _shape(incident_id, {
            "currentSpeed": snap["current_speed"], "currentDirection": snap["current_direction"],
            "windSpeed": snap["wind_speed"], "windDirection": snap["wind_direction"],
            "waveHeight": snap["wave_height"], "temperature": snap["sea_temperature"],
            "source": (snap["data_source"] or "stored snapshot") + " (cached — live unreachable)",
            "dataStatus": snap["data_status"] or "MODELLED",
            "observationTime": snap["observation_time"],
            "confidence": snap["confidence"] or 0.5,
        })

    # Fallback 2: explicit ESTIMATED placeholder, never silent fabrication.
    return _shape(incident_id, {
        "currentSpeed": None, "currentDirection": None, "windSpeed": None,
        "windDirection": None, "waveHeight": None, "temperature": None,
        "source": "No live or stored data available", "dataStatus": "ESTIMATED",
        "observationTime": None, "confidence": 0.2,
    })


def _shape(incident_id: str, c: dict) -> dict:
    return {
        "incidentId": incident_id,
        "timestamp": _now(),
        "observationTime": c.get("observationTime"),
        "wind": {"speed": c["windSpeed"], "direction": c["windDirection"], "unit": "m/s"},
        "current": {"speed": c["currentSpeed"], "direction": c["currentDirection"], "unit": "m/s"},
        "wave": {"value": c["waveHeight"], "unit": "m"},
        "temperature": {"value": c["temperature"], "unit": "C"},
        "source": c["source"],
        "dataStatus": c["dataStatus"],
        "confidence": c["confidence"],
        # Flat telemetry mirror for callers that want the raw m/s fields.
        "telemetry": {
            "currentSpeed": c["currentSpeed"], "currentDirection": c["currentDirection"],
            "windSpeed": c["windSpeed"], "windDirection": c["windDirection"],
            "waveHeight": c["waveHeight"], "temperature": c["temperature"],
            "source": c["source"], "dataStatus": c["dataStatus"],
        },
    }
