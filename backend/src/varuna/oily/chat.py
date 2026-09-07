"""Response assistant — grounded, deterministic Q&A over the structured plan.

The assistant answers *only* from the incident's real, computed values
(environment, simulated trajectory, impact assessment, response plan, historical
matches). It never generates a number that isn't already in that context. Each
answer carries a ``grounding`` dict naming the exact values used, so a judge can
confirm "where does this come from?" for anything the assistant says.

This is intentionally rule-routed rather than an LLM: the source of truth is the
structured engines. (An LLM could later phrase these same grounded facts more
fluently, but must be constrained to this context — never free to invent.)
"""
from __future__ import annotations

from .geo import compass

SUGGESTED_QUESTIONS = [
    "Why is this incident high priority?",
    "What should we do first?",
    "How much manpower is estimated?",
    "Which areas are at risk?",
    "What happens if wind speed increases?",
    "Which historical spills are similar?",
]


def answer(question: str, ctx: dict) -> dict:
    q = question.lower()
    incident = ctx["incident"]
    impact = ctx["impact"]
    drift = ctx["drift"]
    plan = ctx["plan"]
    telemetry = ctx.get("telemetry", {})
    similar = ctx.get("similar", [])

    speed = float(drift.get("speed", 0) or 0)
    direction = compass(drift.get("directionDeg"))
    coast = _exp(impact.get("exposures", []), "Coastline")
    coast_h = coast.get("hours") if coast else None

    grounding = {
        "impactScore": impact.get("score"),
        "severity": impact.get("severity"),
        "driftSpeedMs": round(speed, 3),
        "driftDirection": direction,
        "coastlineExposureHours": coast_h,
        "manpowerTotal": plan.get("manpower", {}).get("total"),
    }
    base_metrics = [
        {"label": "Wind", "value": _fmt(telemetry.get("windSpeed"), telemetry.get("windDirection"))},
        {"label": "Current", "value": _fmt(telemetry.get("currentSpeed"), telemetry.get("currentDirection"))},
        {"label": "Drift", "value": f"{speed:.2f} m/s {direction}"},
        {"label": "Coastline exposure", "value": f"{coast_h} h" if coast_h is not None else "Not intersected"},
        {"label": "Oil persistence", "value": incident.get("persistence", "—")},
    ]

    if _match(q, "manpower", "personnel", "staff", "how many people", "team size"):
        mp = plan.get("manpower", {})
        return _r(
            f"For the current {impact.get('severity')} classification (impact {impact.get('score')}/100), "
            f"the planning estimate for the immediate response phase is {mp.get('total')} personnel. "
            f"Shoreline protection dominates because coastline exposure is estimated at "
            f"{coast_h if coast_h is not None else '—'} h. These are planning estimates, not committed capacity.",
            table=[{"label": r["role"], "value": f"{r['personnel']} personnel"} for r in mp.get("roles", [])],
            metrics=[{"label": "Total estimated personnel", "value": str(mp.get("total"))}],
            grounding=grounding,
        )

    if _match(q, "do first", "what should we", "first step", "priority action", "next step"):
        top = plan.get("actions", [{}])[0]
        return _r(
            f"The top-ranked action is \"{top.get('title','—')}\" ({top.get('priority','—')} priority, "
            f"{top.get('timing','—')}). {top.get('reason','')}",
            chain=top.get("chain", []), metrics=base_metrics, grounding=grounding,
        )

    if _match(q, "high priority", "why", "severity", "impact score"):
        return _r(
            f"{incident['id']} scores {impact.get('score')}/100 ({impact.get('severity')}) at "
            f"{int(impact.get('confidence',0)*100)}% confidence. In plain terms: "
            + "; ".join(impact.get("reasons", [])) + ".",
            table=[{"label": f["name"], "value": f"{int(f['contribution']*100)}%"} for f in impact.get("factors", [])],
            chain=impact.get("reasons", []), grounding=grounding,
        )

    if _match(q, "wind", "gust", "stronger"):
        alt = ctx.get("windScenario")
        if alt:
            return _r(
                f"A stronger wind raises the windage contribution and lifts combined drift from "
                f"{speed:.2f} m/s to {alt['speed']:.2f} m/s. Estimated coastline exposure shifts from "
                f"≈ {coast_h if coast_h is not None else '—'} h to ≈ "
                f"{alt.get('coastHours','—')} h — try it in the What-If simulator.",
                metrics=[
                    {"label": "Current drift", "value": f"{speed:.2f} m/s {direction}"},
                    {"label": "Stronger-wind drift", "value": f"{alt['speed']:.2f} m/s {compass(alt.get('directionDeg'))}"},
                ], grounding=grounding,
            )
        return _r(
            "A higher wind speed increases the windage term (C_w·V_wind), raising the combined drift "
            "speed and compressing the time to coastline. Open the What-If simulator to recompute the "
            "exact new trajectory.", metrics=base_metrics, grounding=grounding,
        )

    if _match(q, "areas at risk", "at risk", "exposure", "habitat", "which areas"):
        return _r(
            "Based on the simulated trajectory, these sensitive features fall within the modelled exposure "
            "envelope. Times are nearest-approach estimates and should be re-validated every 6 hours.",
            table=[{"label": e.get("feature") + (f" — {e['name']}" if e.get("name") else ""),
                    "value": (f"{e['hours']} h ({e['distanceKm']} km)" if e.get("hours") is not None
                              else (f"{e['distanceKm']} km" if e.get("distanceKm") is not None else "Not intersected"))}
                   for e in impact.get("exposures", [])],
            grounding=grounding,
        )

    if _match(q, "historical", "similar", "precedent", "past spill"):
        return _r(
            "The closest historical analogues (NOAA incident records) by volume, oil type, persistence "
            "and regional context:",
            table=[{"label": f"{int(m['similarity']*100)}% — {m['name']}",
                    "value": (m["reasons"][0] if m.get("reasons") else m["location"])}
                   for m in similar[:4]],
            grounding=grounding,
        )

    if _match(q, "resource", "boom", "skimmer", "containment"):
        return _r(
            "Recommended planning allocation for the immediate phase, matched against declared availability:",
            table=[{"label": r["resource"], "value": f"{r['recommended']} — {r['available']}"}
                   for r in plan.get("resources", [])],
            grounding=grounding,
        )

    top = plan.get("actions", [{}])[0]
    return _r(
        f"Current picture for {incident['id']}: {impact.get('severity')} priority "
        f"({impact.get('score')}/100), {incident.get('volumeTonnes',0):,.0f} t of "
        f"{incident.get('persistence','').lower()} {incident.get('oilType','').lower()}, drifting "
        f"{speed:.2f} m/s {direction}. Top action: \"{top.get('title','—')}\". Ask about priority, "
        f"first actions, manpower, resources, areas at risk, wind sensitivity or historical analogues.",
        metrics=base_metrics, grounding=grounding,
    )


def _r(text, *, metrics=None, table=None, chain=None, grounding=None) -> dict:
    return {
        "text": text,
        "metrics": metrics or [],
        "table": table or [],
        "chain": chain or [],
        "grounding": grounding or {},
    }


def _match(q: str, *keys: str) -> bool:
    return any(k in q for k in keys)


def _exp(exposures, prefix):
    for e in exposures:
        if e.get("feature", "").startswith(prefix):
            return e
    return None


def _fmt(speed, direction) -> str:
    if speed is None:
        return "Data unavailable"
    return f"{speed} m/s {compass(direction)}"
