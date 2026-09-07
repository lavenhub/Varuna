"""Emergency response engine — deterministic and rule-based.

The response plan is the *source of truth*: a set of ranked, reasoned actions
derived by explicit rules from the incident, the simulated trajectory, the
impact assessment and the real response-resource inventory (from the database).
No language model is involved in generating it — the chatbot only *explains*
this structured plan, it never invents recommendations. Manpower and resource
figures are planning estimates, labelled as such.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from . import repo
from .geo import compass

MODEL_VERSION = "response-rules-v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def generate_plan(
    *,
    incident: dict,          # wire Incident dict
    impact: dict,            # compute_impact() output
    drift: dict,             # {speed, directionDeg, beached, beachedAtHours}
    telemetry: dict,         # env telemetry dict
) -> dict:
    exposures = impact.get("exposures", [])
    coast = _exp(exposures, "Coastline")
    mangrove = _exp(exposures, "Mangrove")
    fishing = _exp(exposures, "Fishing")
    mpa = _exp(exposures, "Protected")

    speed = float(drift.get("speed", 0) or 0)
    direction = compass(drift.get("directionDeg"))
    persistence = incident.get("persistence", "Persistent")
    oil_type = incident.get("oilType", "oil")
    volume = float(incident.get("volumeTonnes", 0) or 0)
    area = float(incident.get("spillAreaKm2", 0) or 0)

    situation = [
        {"label": "Spill", "value": f"{volume:,.0f} tonnes"},
        {"label": "Oil", "value": f"{persistence.lower()} {oil_type.lower()}"},
        {"label": "Drift", "value": f"{speed:.2f} m/s {direction}"},
        {"label": "Wind", "value": _fmt(telemetry.get("windSpeed"), telemetry.get("windDirection"))},
        {"label": "Current", "value": _fmt(telemetry.get("currentSpeed"), telemetry.get("currentDirection"))},
        {"label": "Coastline exposure", "value": _hrs(coast)},
        {"label": "MPA exposure", "value": _hrs(mpa)},
        {"label": "Mangrove exposure", "value": _hrs(mangrove)},
    ]

    resources_inv = {r["type"]: r for r in repo.list_resources()}
    actions: list[dict] = []

    ch = coast.get("hours") if coast else None
    if ch is not None and ch <= 36:
        actions.append(_action(
            len(actions) + 1, "Protect coastline", "CRITICAL" if ch <= 20 else "HIGH",
            "HIGH", "Immediately" if ch <= 20 else f"Within {max(2, round(ch/3))} hours",
            f"Predicted coastline exposure in approximately {ch} hours.",
            ["Containment Boom", "Response Vessels", "Response Personnel"], resources_inv,
            chain=[f"{persistence} oil", f"{direction} drift", f"{speed:.2f} m/s movement",
                   f"{ch} h coastline exposure", "Sensitive habitat", "HIGH COASTAL THREAT"],
        ))

    actions.append(_action(
        len(actions) + 1, "Deploy containment", "HIGH" if persistence == "Persistent" else "MEDIUM",
        "HIGH" if persistence == "Persistent" else "MEDIUM", "Within 2 hours",
        f"{persistence} {oil_type.lower()} with a {speed:.2f} m/s drift raises the probability of continued spread.",
        ["Containment Boom", "Skimmer Vessels", "Response Personnel"], resources_inv,
        chain=[f"{volume:,.0f} t release", f"{area} km² slick", f"{speed:.2f} m/s drift", "CONTINUED SPREAD RISK"],
    ))

    mh = mangrove.get("hours") if mangrove else None
    if mh is not None and mh <= 48:
        actions.append(_action(
            len(actions) + 1, "Monitor mangrove region", "HIGH" if mh <= 24 else "MEDIUM",
            "MEDIUM", f"Before T+{max(2, round(mh - 4))} h",
            f"Predicted trajectory may intersect mangrove habitat within ≈ {mh} hours.",
            ["Monitoring Drones", "Environmental Monitoring Teams"], resources_inv,
            chain=[f"{mh} h mangrove exposure", "Persistent oil", "HABITAT VULNERABILITY"],
        ))

    fh = fishing.get("hours") if fishing else None
    if fh is not None and fh <= 60:
        actions.append(_action(
            len(actions) + 1, "Advise fishing activity", "MEDIUM", "MEDIUM", "Within 6 hours",
            f"Predicted movement intersects an active fishing region in ≈ {fh} hours.",
            ["Response Vessels"], resources_inv,
            chain=[f"{fh} h fishing exposure", "Active fleet", "LIVELIHOOD EXPOSURE"],
        ))

    mpah = mpa.get("hours") if mpa else None
    if mpah is not None:
        actions.append(_action(
            len(actions) + 1, "Notify protected-area authority", "HIGH" if mpah <= 36 else "MEDIUM",
            "MEDIUM", "Within 4 hours",
            f"A protected area lies within the predicted trajectory (≈ {mpah} hours).",
            ["Wildlife Response Units"], resources_inv,
            chain=[f"{mpah} h MPA exposure", "Protected designation", "ECOLOGICAL VULNERABILITY"],
        ))

    actions.append(_action(
        len(actions) + 1, "Increase monitoring frequency", "MEDIUM", "MEDIUM", "Continuous",
        "Conditions may change the trajectory. Recompute the drift forecast every 6 hours.",
        ["Monitoring Drones"], resources_inv,
        chain=["Model-based forecast", "Variable field", "FORECAST UNCERTAINTY"],
    ))

    manpower = _manpower(volume, ch, impact.get("score", 0))
    resources = _resource_recs(area, volume, manpower["total"], impact.get("score", 0), exposures, resources_inv)

    plan = {
        "incidentId": incident["id"],
        "priority": impact.get("severity", "MEDIUM"),
        "situation": situation,
        "actions": actions,
        "resources": resources,
        "manpower": manpower,
        "reasoning": [{"driver": r} for r in impact.get("reasons", [])],
        "summary": (f"{incident['id']} is classified {impact.get('severity','—')} priority "
                    f"(impact {impact.get('score','—')}/100). Based on the persistent/non-persistent "
                    f"classification, the {speed:.2f} m/s predicted drift {direction}, environmental "
                    f"exposure and the response-resource inventory, the ranked plan below was generated."),
        "modelVersion": MODEL_VERSION,
        "generatedAt": _now(),
    }
    repo.save_response_plan(
        incident_id=incident["id"], priority=plan["priority"], actions=actions,
        resources=resources, manpower=manpower, reasoning=plan["reasoning"],
        summary=plan["summary"], model_version=MODEL_VERSION,
    )
    return plan


def _action(rank, title, priority, sensitivity, timing, reason, resource_types, inv, chain):
    resources = []
    for t in resource_types:
        r = inv.get(t)
        avail = r["availability"] if r else "UNKNOWN"
        resources.append(f"{t} ({avail})")
    return {
        "rank": rank, "action": title, "title": title, "priority": priority,
        "reason": reason, "timeSensitivity": sensitivity, "timing": timing,
        "resources": resources, "chain": chain,
    }


def _manpower(volume: float, coast_hours: Optional[float], score: float) -> dict:
    vf = max(1, round(volume / 120))
    roles = [
        {"role": "Incident Command", "personnel": 2},
        {"role": "Containment Team", "personnel": min(24, round(4 + vf * 1.2))},
        {"role": "Shoreline Protection",
         "personnel": min(28, 8 + vf) if (coast_hours is not None and coast_hours <= 24) else 4},
        {"role": "Environmental Monitoring", "personnel": 4 if score >= 70 else 2},
        {"role": "Logistics", "personnel": 4},
    ]
    return {"roles": roles, "total": sum(r["personnel"] for r in roles)}


def _resource_recs(area, volume, personnel, score, exposures, inv) -> list[dict]:
    boom = min(12.4, round(area ** 0.5 * 2.3, 1))
    skimmers = max(1, min(8, round(volume / 150)))
    drones = 2 if score >= 70 else 1
    wildlife = 2 if any(e.get("hours") is not None and e["hours"] <= 24 for e in exposures) else 1

    def avail(t):
        r = inv.get(t)
        return (f"{r['quantity']:g} {r['unit']} {r['availability'].lower()}" if r else "unknown"), (r["availability"] if r else "UNKNOWN")

    rows = [
        ("Containment Boom", "Containment Boom", f"{boom} km"),
        ("Skimmer Vessels", "Skimmer Vessels", f"{skimmers}"),
        ("Response Personnel", "Response Personnel", f"{personnel}"),
        ("Monitoring Drones", "Monitoring Drones", f"{drones}"),
        ("Wildlife Response Units", "Wildlife Response Units", f"{wildlife}"),
    ]
    out = []
    for name, type_, rec in rows:
        a_text, a_status = avail(type_)
        out.append({"resource": name, "type": type_, "recommended": rec,
                    "available": a_text, "availability": a_status})
    return out


def _exp(exposures: list, prefix: str) -> Optional[dict]:
    for e in exposures:
        if e.get("feature", "").startswith(prefix):
            return e
    return None


def _hrs(e: Optional[dict]) -> str:
    if not e or e.get("hours") is None:
        return "Not intersected"
    return f"{e['hours']} hours"


def _fmt(speed, direction) -> str:
    if speed is None:
        return "Data unavailable"
    return f"{speed} m/s {compass(direction)}"
