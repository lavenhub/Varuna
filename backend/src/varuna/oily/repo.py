"""Repository: the only module that speaks SQL.

Everything above it (services, API, client) deals in the wire models from
``models.py``. Swapping SQLite for PostgreSQL means changing ``db._connect`` and,
at most, a few SQL literals here — no service or UI code changes.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from . import db
from .models import Incident, Telemetry


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _dump(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _load(text: Optional[str], default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return default


# --------------------------------------------------------------------------
# Incidents
# --------------------------------------------------------------------------
def _row_to_incident(row: sqlite3.Row, telemetry: Optional[Telemetry]) -> Incident:
    return Incident(
        id=row["id"],
        incidentCode=row["incident_code"],
        name=row["name"],
        lat=row["latitude"],
        lon=row["longitude"],
        region=row["region"] or "",
        oilType=row["oil_type"] or "",
        persistence=row["persistence"] or "Persistent",
        volumeTonnes=row["volume_tonnes"] or 0,
        spillAreaKm2=row["spill_area_km2"] or 0,
        cause=row["cause"] or "",
        status=row["status"],
        risk=row["risk"],
        detectedAt=row["detected_at"] or "",
        confirmedAt=row["confirmed_at"],
        mlConfidence=row["detection_confidence"] or 0,
        detectionSource=row["detection_source"] or "",
        notes=row["notes"],
        imageDataUrl=row["source_image"],
        telemetry=telemetry or Telemetry(),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )


def next_incident_id() -> str:
    with db.get_conn() as conn:
        rows = conn.execute("SELECT id FROM incidents").fetchall()
    nums = []
    for r in rows:
        try:
            nums.append(int(str(r["id"]).replace("VARUNA-", "")))
        except ValueError:
            continue
    return f"VARUNA-{max([1041, *nums]) + 1}"


def create_incident(
    *,
    incident_id: str,
    name: str,
    lat: float,
    lon: float,
    region: str,
    oil_type: str,
    persistence: str,
    volume_tonnes: float,
    spill_area_km2: float,
    cause: str,
    status: str,
    risk: str,
    detection_confidence: float,
    detection_source: str,
    source_image: Optional[str],
    notes: Optional[str],
    detected_at: str,
    confirmed_at: Optional[str],
    created_by: Optional[str],
) -> None:
    now = _now()
    with db.get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO incidents
               (id, incident_code, name, status, risk, latitude, longitude, region,
                oil_type, persistence, volume_tonnes, spill_area_km2, cause,
                detection_confidence, detection_source, source_image, notes,
                detected_at, confirmed_at, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                incident_id, incident_id, name, status, risk, lat, lon, region,
                oil_type, persistence, volume_tonnes, spill_area_km2, cause,
                detection_confidence, detection_source, source_image, notes,
                detected_at, confirmed_at, created_by, now, now,
            ),
        )


def update_incident(incident_id: str, patch: dict) -> None:
    _MAP = {
        "name": "name", "status": "status", "risk": "risk", "notes": "notes",
        "volumeTonnes": "volume_tonnes", "spillAreaKm2": "spill_area_km2",
        "oilType": "oil_type", "persistence": "persistence", "cause": "cause",
        "confirmedAt": "confirmed_at",
    }
    sets, vals = [], []
    for k, v in patch.items():
        col = _MAP.get(k)
        if col:
            sets.append(f"{col} = ?")
            vals.append(v)
    if not sets:
        return
    sets.append("updated_at = ?")
    vals.append(_now())
    vals.append(incident_id)
    with db.get_conn() as conn:
        conn.execute(f"UPDATE incidents SET {', '.join(sets)} WHERE id = ?", vals)


def get_incident(incident_id: str) -> Optional[Incident]:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if not row:
            return None
        snap = conn.execute(
            "SELECT * FROM environmental_snapshots WHERE incident_id = ? ORDER BY id DESC LIMIT 1",
            (incident_id,),
        ).fetchone()
    return _row_to_incident(row, _snap_to_telemetry(snap))


def list_incidents() -> list[Incident]:
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM incidents ORDER BY created_at DESC").fetchall()
        out = []
        for row in rows:
            snap = conn.execute(
                "SELECT * FROM environmental_snapshots WHERE incident_id = ? ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            out.append(_row_to_incident(row, _snap_to_telemetry(snap)))
    return out


# --------------------------------------------------------------------------
# Environmental snapshots
# --------------------------------------------------------------------------
def _snap_to_telemetry(snap: Optional[sqlite3.Row]) -> Optional[Telemetry]:
    if not snap:
        return None
    return Telemetry(
        currentSpeed=snap["current_speed"],
        currentDirection=snap["current_direction"],
        windSpeed=snap["wind_speed"],
        windDirection=snap["wind_direction"],
        waveHeight=snap["wave_height"],
        temperature=snap["sea_temperature"],
        source=snap["data_source"] or "unknown",
        dataStatus=snap["data_status"] or "MODELLED",
    )


def add_snapshot(
    *,
    incident_id: str,
    wind_speed: Optional[float],
    wind_direction: Optional[float],
    current_speed: Optional[float],
    current_direction: Optional[float],
    wave_height: Optional[float],
    sea_temperature: Optional[float],
    data_source: str,
    data_status: str,
    confidence: float,
    observation_time: Optional[str] = None,
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """INSERT INTO environmental_snapshots
               (incident_id, timestamp, observation_time, wind_speed, wind_direction,
                current_speed, current_direction, wave_height, sea_temperature,
                data_source, data_status, confidence)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                incident_id, _now(), observation_time, wind_speed, wind_direction,
                current_speed, current_direction, wave_height, sea_temperature,
                data_source, data_status, confidence,
            ),
        )


def latest_snapshot(incident_id: str) -> Optional[sqlite3.Row]:
    with db.get_conn() as conn:
        return conn.execute(
            "SELECT * FROM environmental_snapshots WHERE incident_id = ? ORDER BY id DESC LIMIT 1",
            (incident_id,),
        ).fetchone()


# --------------------------------------------------------------------------
# Simulations + trajectory
# --------------------------------------------------------------------------
def create_simulation(
    *,
    simulation_id: str,
    incident_id: str,
    simulation_type: str,
    model_version: str,
    start_time: Optional[str],
    duration_hours: float,
    time_step_minutes: float,
    parameters: dict,
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """INSERT INTO simulations
               (id, incident_id, simulation_type, status, model_version, start_time,
                duration_hours, time_step_minutes, parameters, result_summary,
                created_at, completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                simulation_id, incident_id, simulation_type, "running", model_version,
                start_time, duration_hours, time_step_minutes, _dump(parameters),
                _dump({}), _now(), None,
            ),
        )


def complete_simulation(simulation_id: str, result_summary: dict) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE simulations SET status = ?, result_summary = ?, completed_at = ? WHERE id = ?",
            ("completed", _dump(result_summary), _now(), simulation_id),
        )


def fail_simulation(simulation_id: str, message: str) -> None:
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE simulations SET status = ?, result_summary = ? WHERE id = ?",
            ("failed", _dump({"error": message}), simulation_id),
        )


def save_trajectory(simulation_id: str, points: list[dict]) -> None:
    with db.get_conn() as conn:
        conn.executemany(
            """INSERT INTO trajectory_points
               (simulation_id, seq, timestamp, hours, latitude, longitude, velocity,
                direction, distance_km, uncertainty_radius_km, intensity, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (
                    simulation_id, i, p["timestamp"], p["hours"], p["latitude"], p["longitude"],
                    p["velocity"], p["direction"], p["distanceKm"], p["uncertaintyRadiusKm"],
                    p["intensity"], p["status"],
                )
                for i, p in enumerate(points)
            ],
        )


def get_simulation_row(simulation_id: str) -> Optional[sqlite3.Row]:
    with db.get_conn() as conn:
        return conn.execute("SELECT * FROM simulations WHERE id = ?", (simulation_id,)).fetchone()


def get_trajectory_rows(simulation_id: str) -> list[sqlite3.Row]:
    with db.get_conn() as conn:
        return conn.execute(
            "SELECT * FROM trajectory_points WHERE simulation_id = ? ORDER BY seq",
            (simulation_id,),
        ).fetchall()


def list_simulations(incident_id: str) -> list[sqlite3.Row]:
    with db.get_conn() as conn:
        return conn.execute(
            "SELECT * FROM simulations WHERE incident_id = ? ORDER BY created_at DESC",
            (incident_id,),
        ).fetchall()


def simulation_summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "incidentId": row["incident_id"],
        "simulationType": row["simulation_type"],
        "status": row["status"],
        "modelVersion": row["model_version"],
        "startTime": row["start_time"],
        "durationHours": row["duration_hours"],
        "timeStepMinutes": row["time_step_minutes"],
        "parameters": _load(row["parameters"], {}),
        "resultSummary": _load(row["result_summary"], {}),
        "createdAt": row["created_at"],
        "completedAt": row["completed_at"],
    }


# --------------------------------------------------------------------------
# Impact + response persistence (latest-wins audit records)
# --------------------------------------------------------------------------
def save_impact(
    *,
    incident_id: str,
    simulation_id: Optional[str],
    score: float,
    severity: str,
    confidence: float,
    factors: list,
    affected_regions: list,
    exposure_times: list,
    inputs: dict,
    model_version: str,
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """INSERT INTO impact_assessments
               (incident_id, simulation_id, score, severity, confidence, factors,
                affected_regions, exposure_times, inputs, model_version, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                incident_id, simulation_id, score, severity, confidence, _dump(factors),
                _dump(affected_regions), _dump(exposure_times), _dump(inputs),
                model_version, _now(),
            ),
        )


def save_response_plan(
    *,
    incident_id: str,
    priority: str,
    actions: list,
    resources: list,
    manpower: dict,
    reasoning: list,
    summary: str,
    model_version: str,
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """INSERT INTO response_plans
               (incident_id, priority, actions, resources, manpower, reasoning,
                summary, model_version, generated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                incident_id, priority, _dump(actions), _dump(resources), _dump(manpower),
                _dump(reasoning), summary, model_version, _now(),
            ),
        )


# --------------------------------------------------------------------------
# Response resources (reference inventory)
# --------------------------------------------------------------------------
def upsert_resource(
    *,
    resource_id: str,
    type_: str,
    name: str,
    location: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    quantity: float,
    unit: str,
    availability: str,
    status: str,
) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO response_resources
               (resource_id, type, name, location, latitude, longitude, quantity,
                unit, availability, status)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (resource_id, type_, name, location, latitude, longitude, quantity, unit, availability, status),
        )


def list_resources() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM response_resources ORDER BY type").fetchall()
    return [dict(r) for r in rows]


def count_incidents() -> int:
    with db.get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM incidents").fetchone()["n"]
