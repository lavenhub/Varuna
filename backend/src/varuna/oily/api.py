"""OILY API surface.

A single FastAPI router mounted under /api by the inference service. Every route
returns structured JSON produced by the service layer; the web client is a
visualization layer over these results. Route ordering note: the static
/incidents/history* paths are declared before /incidents/{incident_id} so
"history" is never captured as an incident id.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from . import chat, db, environment, history, impact as impact_mod, repo, response as response_mod
from .models import (
    ChatRequest, ChatResponse, Incident, IncidentCreate, ResponsePlanModel,
    SimulationCreate, SimulationCreated,
)
from .simulation import ENGINE, TrajectoryInput, TrajectoryResult

router = APIRouter(prefix="/api", tags=["oily"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _risk_from_volume(volume: float) -> str:
    return "HIGH" if volume > 300 else "MEDIUM" if volume > 80 else "LOW"


# ==========================================================================
# Incidents
# ==========================================================================
@router.get("/incidents", response_model=list[Incident])
def list_incidents():
    return repo.list_incidents()


@router.post("/incidents", response_model=Incident)
def create_incident(body: IncidentCreate):
    incident_id = repo.next_incident_id()
    detected_at = body.detectedAt or _now()
    region = body.region or (body.name.split(" ")[0] + " sector" if body.name else "Operational sector")
    repo.create_incident(
        incident_id=incident_id, name=body.name, lat=body.lat, lon=body.lon, region=region,
        oil_type=body.oilType, persistence=body.persistence, volume_tonnes=body.volumeTonnes,
        spill_area_km2=body.spillAreaKm2, cause=body.cause, status="CONFIRMED",
        risk=_risk_from_volume(body.volumeTonnes), detection_confidence=body.mlConfidence,
        detection_source=body.detectionSource, source_image=body.imageDataUrl, notes=body.notes,
        detected_at=detected_at, confirmed_at=_now(), created_by=body.createdBy,
    )
    # Load the incident's first environmental snapshot (live if reachable).
    if body.loadEnvironment:
        try:
            environment.get_environment(incident_id, body.lat, body.lon, store=True)
        except Exception:
            pass
    inc = repo.get_incident(incident_id)
    if inc is None:
        raise HTTPException(500, "incident creation failed")
    return inc


# ---- historical intelligence (declared before /{incident_id}) -------------
@router.get("/incidents/history")
def list_history(limit: int = 200):
    return history.list_history(limit=limit)


@router.get("/incidents/history/{hist_id}")
def get_history(hist_id: str):
    rec = history.get_history(hist_id)
    if rec is None:
        raise HTTPException(404, f"historical incident {hist_id} not found")
    return rec


@router.get("/incidents/{incident_id}", response_model=Incident)
def get_incident(incident_id: str):
    inc = repo.get_incident(incident_id)
    if inc is None:
        raise HTTPException(404, f"incident {incident_id} not found")
    return inc


@router.patch("/incidents/{incident_id}", response_model=Incident)
def patch_incident(incident_id: str, patch: dict):
    if repo.get_incident(incident_id) is None:
        raise HTTPException(404, f"incident {incident_id} not found")
    repo.update_incident(incident_id, patch)
    return repo.get_incident(incident_id)


@router.get("/incidents/{incident_id}/similar")
def similar_incidents(incident_id: str, limit: int = 5):
    inc = _require(incident_id)
    return history.find_similar(
        lat=inc.lat, lon=inc.lon, region=inc.region, oil_type=inc.oilType,
        persistence=inc.persistence, volume_tonnes=inc.volumeTonnes, cause=inc.cause, limit=limit,
    )


@router.get("/incidents/{incident_id}/simulations")
def list_incident_sims(incident_id: str):
    _require(incident_id)
    return [repo.simulation_summary(r) for r in repo.list_simulations(incident_id)]


# ==========================================================================
# Environment
# ==========================================================================
@router.get("/environment/{incident_id}")
def get_environment(incident_id: str):
    inc = _require(incident_id)
    return environment.get_environment(incident_id, inc.lat, inc.lon, store=True)


@router.post("/environment/telemetry")
def telemetry(body: dict):
    live = environment.fetch_live(body["latitude"], body["longitude"])
    if live is None:
        raise HTTPException(502, "Live environmental data (Open-Meteo) unreachable")
    return live


# ==========================================================================
# Simulations
# ==========================================================================
def _trajectory_input(inc: Incident, body: SimulationCreate) -> TrajectoryInput:
    t = inc.telemetry
    wind_speed = body.wind.speed if body.wind else (t.windSpeed or 0.0)
    wind_dir = body.wind.direction if body.wind else (t.windDirection or 0.0)
    cur_speed = body.current.speed if body.current else (t.currentSpeed or 0.0)
    cur_dir = body.current.direction if body.current else (t.currentDirection or 0.0)
    return TrajectoryInput(
        lat=inc.lat, lon=inc.lon,
        current_speed=cur_speed, current_direction=cur_dir,
        wind_speed=wind_speed, wind_direction=wind_dir,
        spill_area_km2=inc.spillAreaKm2 * body.volumeScale,
        windage=body.windage, duration_hours=body.durationHours,
        time_step_minutes=body.timeStepMinutes, diffusion=body.diffusion,
        uncertainty=body.uncertainty, start_time=body.startTime,
    )


def _dense_dicts(res: TrajectoryResult) -> list[dict]:
    return [{
        "timestamp": p.timestamp, "hours": p.hours, "latitude": p.lat, "longitude": p.lon,
        "velocity": p.velocity, "direction": p.direction, "distanceKm": p.distance_km,
        "uncertaintyRadiusKm": p.uncertainty_km, "intensity": p.intensity, "status": p.status,
    } for p in res.points]


def _result_summary(res: TrajectoryResult) -> dict:
    last = res.waypoints[-1] if res.waypoints else None
    return {
        "engine": res.engine, "modelVersion": res.model_version,
        "speed": res.speed, "directionDeg": res.direction_deg,
        "uOil": res.u_oil, "vOil": res.v_oil, "windageCoefficient": res.windage,
        "beached": res.beached, "beachedAtHours": res.beached_at_hours,
        "diffusionKm2PerS": res.diffusion_coeff,
        "distanceKm72h": last.distance_km if last else 0.0,
        "waypoints": [{
            "hours": w.hours, "latitude": w.lat, "longitude": w.lon,
            "distanceKm": w.distance_km, "uncertaintyKm": w.uncertainty_km, "beached": w.beached,
        } for w in res.waypoints],
        "uncertainty": {
            "enabled": bool(res.uncertainty_polygon),
            "confidence": res.uncertainty_confidence,
            "radiusKm": res.uncertainty_radius_km,
            "polygon": res.uncertainty_polygon,
            "label": "Modelled uncertainty",
        },
        "notes": res.notes,
    }


@router.post("/simulations", response_model=SimulationCreated)
def create_simulation(body: SimulationCreate):
    inc = _require(body.incidentId)
    sim_id = f"SIM-{uuid.uuid4().hex[:10]}"
    inp = _trajectory_input(inc, body)
    repo.create_simulation(
        simulation_id=sim_id, incident_id=inc.id, simulation_type=body.simulationType,
        model_version=ENGINE._engines["SimpleOilyEngine"].model_version,
        start_time=body.startTime, duration_hours=body.durationHours,
        time_step_minutes=body.timeStepMinutes, parameters=body.model_dump(),
    )
    try:
        res = ENGINE.run(inp)
        repo.save_trajectory(sim_id, _dense_dicts(res))
        repo.complete_simulation(sim_id, _result_summary(res))
    except Exception as exc:
        repo.fail_simulation(sim_id, str(exc))
        raise HTTPException(500, f"simulation failed: {exc}")
    return SimulationCreated(simulationId=sim_id, status="completed", modelVersion=res.model_version)


@router.get("/simulations/{sim_id}")
def get_simulation(sim_id: str):
    row = repo.get_simulation_row(sim_id)
    if row is None:
        raise HTTPException(404, f"simulation {sim_id} not found")
    return repo.simulation_summary(row)


@router.get("/simulations/{sim_id}/trajectory")
def get_trajectory(sim_id: str):
    row = repo.get_simulation_row(sim_id)
    if row is None:
        raise HTTPException(404, f"simulation {sim_id} not found")
    summary = repo.simulation_summary(row)["resultSummary"]
    dense = repo.get_trajectory_rows(sim_id)
    points = [{
        "timestamp": p["timestamp"], "hours": p["hours"], "latitude": p["latitude"],
        "longitude": p["longitude"], "velocity": p["velocity"], "direction": p["direction"],
        "distanceKm": p["distance_km"], "uncertaintyRadiusKm": p["uncertainty_radius_km"],
        "intensity": p["intensity"], "status": p["status"],
    } for p in dense]
    return {
        "simulationId": sim_id,
        "modelVersion": summary.get("modelVersion"),
        "engine": summary.get("engine"),
        "points": points,
        "waypoints": summary.get("waypoints", []),
        "uncertainty": summary.get("uncertainty", {}),
        "speed": summary.get("speed"),
        "directionDeg": summary.get("directionDeg"),
        "uOil": summary.get("uOil"),
        "vOil": summary.get("vOil"),
        "windageCoefficient": summary.get("windageCoefficient"),
        "beached": summary.get("beached"),
        "beachedAtHours": summary.get("beachedAtHours"),
        "diffusionKm2PerS": summary.get("diffusionKm2PerS"),
        "notes": summary.get("notes", []),
    }


@router.post("/simulations/scenario")
def scenario(body: dict):
    """What-If: run a baseline and a modified scenario through the same engine and
    return both trajectories plus the differences. Recalculates — does not animate."""
    inc = _require(body["incidentId"])
    t = inc.telemetry
    base_wind_s = t.windSpeed or 0.0
    base_wind_d = t.windDirection or 0.0
    base_cur_s = t.currentSpeed or 0.0
    base_cur_d = t.currentDirection or 0.0

    def run(wind_scale, wind_delta, cur_scale, cur_delta, vol_scale, windage):
        inp = TrajectoryInput(
            lat=inc.lat, lon=inc.lon,
            current_speed=base_cur_s * cur_scale, current_direction=base_cur_d + cur_delta,
            wind_speed=base_wind_s * wind_scale, wind_direction=base_wind_d + wind_delta,
            spill_area_km2=inc.spillAreaKm2 * vol_scale, windage=windage,
            duration_hours=body.get("durationHours", 72), time_step_minutes=body.get("timeStepMinutes", 15),
        )
        return ENGINE.run(inp)

    baseline = run(1, 0, 1, 0, 1, 0.03)
    s = body.get("scenario", {})
    scenario_res = run(
        s.get("windScale", 1.0), s.get("windDirectionDelta", 0.0),
        s.get("currentScale", 1.0), s.get("currentDirectionDelta", 0.0),
        s.get("volumeScale", 1.0), s.get("windage", 0.03),
    )

    def brief(r: TrajectoryResult) -> dict:
        last = r.waypoints[-1]
        return {
            "speed": r.speed, "directionDeg": r.direction_deg,
            "distanceKm": last.distance_km, "beached": r.beached, "beachedAtHours": r.beached_at_hours,
            "waypoints": [{"hours": w.hours, "latitude": w.lat, "longitude": w.lon,
                           "uncertaintyKm": w.uncertainty_km} for w in r.waypoints],
            "points": [{"latitude": p.lat, "longitude": p.lon, "hours": p.hours} for p in r.points],
            "uncertaintyPolygon": r.uncertainty_polygon,
        }

    b, sc = brief(baseline), brief(scenario_res)
    diffs = {
        "driftSpeedDelta": round(sc["speed"] - b["speed"], 3),
        "distanceDeltaKm": round(sc["distanceKm"] - b["distanceKm"], 2),
        "coastlineArrival": {
            "baseline": b["beachedAtHours"], "scenario": sc["beachedAtHours"],
        },
    }
    return {"baseline": b, "scenario": sc, "differences": diffs, "modelVersion": baseline.model_version}


# ==========================================================================
# Impact + response + chat
# ==========================================================================
def _quick_drift(inc: Incident) -> TrajectoryResult:
    t = inc.telemetry
    inp = TrajectoryInput(
        lat=inc.lat, lon=inc.lon,
        current_speed=t.currentSpeed or 0.0, current_direction=t.currentDirection or 0.0,
        wind_speed=t.windSpeed or 0.0, wind_direction=t.windDirection or 0.0,
        spill_area_km2=inc.spillAreaKm2,
    )
    return ENGINE.run(inp)


def _drift_summary(res: TrajectoryResult, distance_to_coast: Optional[float] = None) -> dict:
    return {
        "speed": res.speed, "directionDeg": res.direction_deg,
        "beached": res.beached, "beachedAtHours": res.beached_at_hours,
        "distanceToCoastKm": distance_to_coast,
    }


@router.post("/impact/calculate")
def calculate_impact(body: dict):
    inc = _require(body["incidentId"])
    drift = _quick_drift(inc)
    nearby = None
    if body.get("includeNearby"):
        try:
            from varuna.app.inference_api import environment_nearby, NearbyRequest
            nb = environment_nearby(NearbyRequest(latitude=inc.lat, longitude=inc.lon, radiusKm=90))
            nearby = [f.model_dump() for f in nb.features]
        except Exception:
            nearby = None
    result = impact_mod.compute_impact(
        incident_id=inc.id, lat=inc.lat, lon=inc.lon, persistence=inc.persistence,
        volume_tonnes=inc.volumeTonnes, spill_area_km2=inc.spillAreaKm2,
        ml_confidence=inc.mlConfidence, drift=_drift_summary(drift), nearby=nearby,
    )
    repo.save_impact(
        incident_id=inc.id, simulation_id=None, score=result["score"], severity=result["severity"],
        confidence=result["confidence"], factors=result["factors"],
        affected_regions=[e.get("feature") for e in result["exposures"]],
        exposure_times=result["exposures"], inputs=result["inputs"], model_version=result["modelVersion"],
    )
    return result


def _build_context(inc: Incident) -> dict:
    drift = _quick_drift(inc)
    imp = impact_mod.compute_impact(
        incident_id=inc.id, lat=inc.lat, lon=inc.lon, persistence=inc.persistence,
        volume_tonnes=inc.volumeTonnes, spill_area_km2=inc.spillAreaKm2,
        ml_confidence=inc.mlConfidence, drift=_drift_summary(drift),
    )
    telemetry = inc.telemetry.model_dump()
    plan = response_mod.generate_plan(
        incident=inc.model_dump(), impact=imp, drift=_drift_summary(drift), telemetry=telemetry,
    )
    return {"incident": inc.model_dump(), "impact": imp, "drift": _drift_summary(drift),
            "plan": plan, "telemetry": telemetry}


@router.post("/response/generate", response_model=ResponsePlanModel)
def generate_response(body: dict):
    inc = _require(body["incidentId"])
    return _build_context(inc)["plan"]


@router.post("/response/chat", response_model=ChatResponse)
def response_chat(body: ChatRequest):
    inc = _require(body.incidentId)
    ctx = _build_context(inc)
    ctx["similar"] = history.find_similar(
        lat=inc.lat, lon=inc.lon, region=inc.region, oil_type=inc.oilType,
        persistence=inc.persistence, volume_tonnes=inc.volumeTonnes, cause=inc.cause, limit=4,
    )
    return chat.answer(body.question, ctx)


@router.get("/response/suggested-questions")
def suggested_questions():
    return {"questions": chat.SUGGESTED_QUESTIONS}


# ==========================================================================
# Resources + meta
# ==========================================================================
@router.get("/resources")
def list_resources():
    return repo.list_resources()


@router.get("/meta")
def meta():
    from .simulation import MODEL_VERSION as DRIFT_V

    return {
        "modelVersions": {
            "drift": DRIFT_V,
            "impactCompose": impact_mod.MODEL_VERSION,
            "response": response_mod.MODEL_VERSION,
            "detection": "varuna-cnn-v1 (Varuna DeepLabV3+/resnet34)",
        },
        "storage": db.storage_info(),
        "history": history.dataset_info(),
        "dataStatusLegend": {
            "OBSERVED": "Direct measurement / in-situ observation",
            "MODELLED": "Numerical model output (e.g. NWP, ocean model)",
            "ESTIMATED": "Derived estimate from indirect inputs",
            "SIMULATED": "OILY simulation-engine output",
        },
    }


def _require(incident_id: str) -> Incident:
    inc = repo.get_incident(incident_id)
    if inc is None:
        raise HTTPException(404, f"incident {incident_id} not found")
    return inc
