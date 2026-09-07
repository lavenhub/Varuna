"""Historical intelligence — served from the real NOAA dataset.

Replaces the web client's synthetic PRNG-generated history with the actual
``oil_spill_environmental_master_v2.csv`` (4,379 NOAA Office of Response &
Restoration incident records, 1957–2026). Records with valid coordinates and a
documented severity class are exposed as comparable historical cases, and
similarity to a live incident is scored on region, release size, oil type,
persistence, cause and geographic proximity — each match carrying the reasons it
was chosen. Similarity is a heuristic comparison of characteristics, not a
scientific equivalence.
"""
from __future__ import annotations

import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parents[3]           # .../all model
_PROJECT_ROOT = _REPO_ROOT.parent.parent                    # .../sih'26

_CSV_CANDIDATES = [
    os.environ.get("OILY_HISTORY_CSV", ""),
    str(_PROJECT_ROOT / "enviromental impact" / "oil_spill_environmental_master_v2 (1).csv"),
    str(_PROJECT_ROOT / "enviromental impact" / "oil_spill_environmental_master_v2.csv"),
    str(_REPO_ROOT / "data" / "oil_spill_environmental_master_v2.csv"),
]

_SEVERITY_MAP = {
    "very low (q1)": "LOW", "low (q2)": "LOW", "moderate (q3)": "MEDIUM",
    "high (q4)": "HIGH", "very high (q5)": "CRITICAL",
}
_CAUSE_MAP = {
    "vessel_casualty": "Vessel casualty / collision", "unknown_source": "Unknown",
    "pipeline_or_wellhead": "Pipeline or wellhead", "fixed_facility": "Fixed facility",
    "natural_event": "Natural event / seep", "land_transport": "Land transport",
    "derelict_or_wreck": "Derelict / wreck",
}
_GROUP_NAMES = {
    1.0: "Group I (gasoline/light)", 2.0: "Group II (diesel/light crude)",
    3.0: "Group III (medium crude)", 4.0: "Group IV (heavy crude/fuel oil)",
    5.0: "Group V (residual/sinking oil)",
}


def _csv_path() -> Optional[str]:
    for p in _CSV_CANDIDATES:
        if p and Path(p).exists():
            return p
    return None


@lru_cache(maxsize=1)
def _records() -> list[dict]:
    path = _csv_path()
    if not path:
        return []
    import pandas as pd

    df = pd.read_csv(path)
    df = df[df["latitude"].notna() & df["longitude"].notna() & df["impact_severity_class"].notna()]
    out: list[dict] = []
    for _, r in df.iterrows():
        sev = _SEVERITY_MAP.get(str(r.get("impact_severity_class", "")).strip().lower(), "MEDIUM")
        persistence = "Persistent" if str(r.get("oil_persistence_class", "")).strip().lower() == "persistent" else "Non-persistent"
        vol = r.get("max_ptl_release_tonnes")
        vol = float(vol) if pd.notna(vol) else 0.0
        oil_type = _oil_type(r)
        cause = _CAUSE_MAP.get(str(r.get("source_category", "")).strip().lower(), "Unknown")
        coast_band = r.get("coast_proximity_band")
        out.append({
            "id": str(r.get("incident_id") or f"HIST-{len(out)}"),
            "name": str(r.get("incident_name") or "Unnamed incident").split(";")[0].strip(),
            "location": str(r.get("location") or r.get("country") or "—"),
            "region": str(r.get("marine_region") or "Other / open ocean"),
            "date": str(r.get("incident_date") or ""),
            "oilType": oil_type,
            "persistence": persistence,
            "volumeTonnes": round(vol, 1),
            "cause": cause,
            "coastalStatus": str(coast_band) if pd.notna(coast_band) else "Not resolved",
            "impact": sev,
            "lat": round(float(r["latitude"]), 4),
            "lon": round(float(r["longitude"]), 4),
            "environmentalImpactScore": (round(float(r["environmental_impact_score"]), 1)
                                         if pd.notna(r.get("environmental_impact_score")) else None),
            "distanceToCoastKm": (round(float(r["distance_to_coast_km"]), 1)
                                  if pd.notna(r.get("distance_to_coast_km")) else None),
            "response": ("Containment booming and mechanical recovery" if persistence == "Persistent"
                         else "Monitoring with natural attenuation"),
            "outcome": str(r.get("impact_score_explanation") or _default_outcome(sev)),
            "source": "NOAA OR&R incident record (oil_spill_environmental_master_v2.csv)",
        })
    return out


def _oil_type(r) -> str:
    import pandas as pd

    commodity = r.get("commodity")
    if pd.notna(commodity) and str(commodity).strip():
        return str(commodity).strip().title()
    grp = r.get("noaa_oil_group")
    if pd.notna(grp):
        return _GROUP_NAMES.get(float(grp), "Oil")
    return "Oil (unspecified)"


def _default_outcome(sev: str) -> str:
    return {
        "LOW": "Dispersed with limited recorded shoreline impact",
        "MEDIUM": "Localised shoreline cleanup",
        "HIGH": "Sustained response operations and monitoring",
        "CRITICAL": "Major multi-season response and restoration effort",
    }.get(sev, "Response operations recorded")


def list_history(limit: Optional[int] = None) -> list[dict]:
    recs = _records()
    # Curated headline cases first (largest documented releases), then the rest.
    recs = sorted(recs, key=lambda r: r["volumeTonnes"], reverse=True)
    return recs[:limit] if limit else recs


def get_history(incident_id: str) -> Optional[dict]:
    for r in _records():
        if r["id"] == incident_id:
            return r
    return None


def dataset_info() -> dict:
    recs = _records()
    return {
        "source": "NOAA Office of Response & Restoration",
        "file": _csv_path(),
        "records": len(recs),
        "available": bool(recs),
    }


# --------------------------------------------------------------------------
# Similarity
# --------------------------------------------------------------------------
def find_similar(
    *, lat: float, lon: float, region: str, oil_type: str, persistence: str,
    volume_tonnes: float, cause: str, limit: int = 5,
) -> list[dict]:
    scored = []
    for h in _records():
        reasons: list[str] = []
        score = 0.0

        hv, iv = max(h["volumeTonnes"], 1.0), max(volume_tonnes, 1.0)
        vol_ratio = min(hv, iv) / max(hv, iv)
        score += vol_ratio * 26
        if vol_ratio > 0.45 and h["volumeTonnes"] > 0:
            reasons.append(f"Comparable release volume ({h['volumeTonnes']:,.0f} t)")

        if _norm(h["oilType"]) == _norm(oil_type):
            score += 20
            reasons.append(f"Same oil type ({h['oilType']})")
        if h["persistence"] == persistence:
            score += 16
            reasons.append(f"{persistence} oil — matching weathering behaviour")

        if _norm(h["region"]) == _norm(region):
            score += 16
            reasons.append(f"Same marine region ({h['region']})")
        else:
            dist = _haversine(lat, lon, h["lat"], h["lon"])
            score += max(0.0, 12 - dist / 900)
            if dist < 600:
                reasons.append(f"Geographically close ({dist:,.0f} km)")

        if _norm(h["cause"]) == _norm(cause) and cause and cause.lower() != "unknown":
            score += 8
            reasons.append(f"Similar cause ({h['cause']})")

        if not reasons:
            reasons.append(f"{h['impact']} severity historical case in {h['region']}")

        scored.append({
            "incidentId": h["id"],
            "name": h["name"],
            "location": h["location"],
            "region": h["region"],
            "date": h["date"],
            "oilType": h["oilType"],
            "volumeTonnes": h["volumeTonnes"],
            "similarity": round(min(0.97, score / 100 + 0.04), 2),
            "reasons": reasons[:4],
        })
    scored.sort(key=lambda s: s["similarity"], reverse=True)
    return scored[:limit]


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))
