"""Seed demo incidents + the response-resource inventory once, so the platform
has realistic operational content the moment it boots (matching the web
client's original demo set, now served from the database as the source of
truth). Idempotent: runs only when the incidents table is empty.
"""
from __future__ import annotations

from . import repo

# The primary demo incident (VARUNA-1042) plus the four supporting incidents,
# mirroring the client's original SEED_INCIDENTS so nothing regresses when the
# client switches from its localStorage seed to the API.
_DEMO_INCIDENTS = [
    dict(
        incident_id="VARUNA-1042", name="Arabian Sea Crude Oil Spill", lat=21.1, lon=72.91,
        region="Arabian Sea", oil_type="Crude Oil", persistence="Persistent",
        volume_tonnes=420, spill_area_km2=12.6, cause="Unknown", status="RESPONDING",
        risk="HIGH", detection_confidence=0.924, detection_source="Uploaded Satellite Image",
        notes="Sheen observed along south-western edge of slick. Vessel traffic in vicinity.",
        detected_at="2026-09-02T12:42:00Z",
        telemetry=dict(current_speed=0.4, current_direction=37, wind_speed=8.2,
                       wind_direction=45, wave_height=1.2, sea_temperature=28,
                       source="Regional ocean model + coastal met station", data_status="MODELLED"),
    ),
    dict(
        incident_id="VARUNA-1039", name="Gulf of Mexico Fuel Oil Release", lat=28.42, lon=-89.62,
        region="Gulf of Mexico", oil_type="Heavy Fuel Oil", persistence="Persistent",
        volume_tonnes=180, spill_area_km2=5.4, cause="Pipeline leak", status="ANALYZING",
        risk="MEDIUM", detection_confidence=0.871, detection_source="Sentinel-1 SAR scene",
        notes=None, detected_at="2026-09-02T09:15:00Z",
        telemetry=dict(current_speed=0.28, current_direction=300, wind_speed=6.1,
                       wind_direction=290, wave_height=0.9, sea_temperature=30,
                       source="Regional ocean model", data_status="MODELLED"),
    ),
    dict(
        incident_id="VARUNA-1031", name="North Sea Platform Discharge", lat=57.05, lon=2.15,
        region="North Sea", oil_type="Condensate", persistence="Non-persistent",
        volume_tonnes=850, spill_area_km2=21.2, cause="Platform equipment failure",
        status="CONTAINED", risk="LOW", detection_confidence=0.798,
        detection_source="Aerial surveillance imagery", notes=None,
        detected_at="2026-08-31T05:40:00Z",
        telemetry=dict(current_speed=0.22, current_direction=120, wind_speed=11.4,
                       wind_direction=200, wave_height=2.1, sea_temperature=13,
                       source="Operator telemetry", data_status="OBSERVED"),
    ),
    dict(
        incident_id="VARUNA-1028", name="Bay of Bengal Bunker Spill", lat=19.2, lon=85.6,
        region="Bay of Bengal", oil_type="Bunker Fuel", persistence="Persistent",
        volume_tonnes=95, spill_area_km2=3.1, cause="Vessel collision", status="CONFIRMED",
        risk="MEDIUM", detection_confidence=0.842, detection_source="Coastal drone imagery",
        notes=None, detected_at="2026-09-01T18:05:00Z",
        telemetry=dict(current_speed=0.35, current_direction=260, wind_speed=7.4,
                       wind_direction=250, wave_height=1.5, sea_temperature=29,
                       source="Regional ocean model", data_status="MODELLED"),
    ),
    dict(
        incident_id="VARUNA-1024", name="Mediterranean Tanker Discharge", lat=34.9, lon=24.2,
        region="Mediterranean Sea", oil_type="Crude Oil", persistence="Persistent",
        volume_tonnes=1200, spill_area_km2=38.7, cause="Tanker grounding", status="RESPONDING",
        risk="HIGH", detection_confidence=0.955, detection_source="Sentinel-2 optical scene",
        notes=None, detected_at="2026-08-30T22:10:00Z",
        telemetry=dict(current_speed=0.31, current_direction=15, wind_speed=9.6,
                       wind_direction=20, wave_height=1.7, sea_temperature=25,
                       source="Copernicus marine service", data_status="MODELLED"),
    ),
]

# Response-resource inventory near the primary demo sector (Gujarat coast), with
# realistic availability so the response engine can report AVAILABLE / LIMITED.
_RESOURCES = [
    dict(resource_id="RES-BOOM-01", type_="Containment Boom", name="Inflatable containment boom",
         location="Hazira Response Depot", latitude=21.12, longitude=72.65, quantity=12.4,
         unit="km", availability="AVAILABLE", status="Ready"),
    dict(resource_id="RES-SKIM-01", type_="Skimmer Vessels", name="Weir/disc skimmer vessels",
         location="Hazira Response Depot", latitude=21.12, longitude=72.65, quantity=8,
         unit="vessels", availability="AVAILABLE", status="Ready"),
    dict(resource_id="RES-VESSEL-01", type_="Response Vessels", name="Multi-purpose response vessels",
         location="Surat Port", latitude=21.16, longitude=72.62, quantity=5,
         unit="vessels", availability="AVAILABLE", status="Ready"),
    dict(resource_id="RES-DRONE-01", type_="Monitoring Drones", name="Aerial monitoring drones",
         location="Mobile unit", latitude=21.1, longitude=72.9, quantity=6,
         unit="drones", availability="AVAILABLE", status="Ready"),
    dict(resource_id="RES-WILD-01", type_="Wildlife Response Units", name="Wildlife rescue & rehab units",
         location="Bharuch Coastal Station", latitude=21.7, longitude=72.98, quantity=5,
         unit="units", availability="LIMITED", status="Partial availability"),
    dict(resource_id="RES-PPL-01", type_="Response Personnel", name="Trained response personnel",
         location="Regional pool", latitude=21.1, longitude=72.8, quantity=42,
         unit="personnel", availability="AVAILABLE", status="On call"),
    dict(resource_id="RES-MON-01", type_="Environmental Monitoring Teams", name="Environmental sampling teams",
         location="State pollution board", latitude=21.2, longitude=72.83, quantity=4,
         unit="teams", availability="LIMITED", status="Partial availability"),
]


def ensure_seeded() -> None:
    """Seed the response-resource inventory. Incidents start at ZERO by default —
    the operational log begins empty and grows as spills are detected/confirmed.

    Exception: when ``OILY_SEED_DEMO`` is set (e.g. the hosted lite demo where
    image detection is disabled and users can't create incidents via upload), the
    5 demo incidents are also loaded so Drift/Impact/Response/What-If have data."""
    import os

    if not repo.list_resources():
        for res in _RESOURCES:
            repo.upsert_resource(**res)
    if os.environ.get("OILY_SEED_DEMO"):
        seed_demo_incidents()


def seed_demo_incidents() -> None:
    """Optional: load the 5 legacy demo incidents. Not called automatically."""
    if repo.count_incidents() > 0:
        return
    for inc in _DEMO_INCIDENTS:
        data = dict(inc)
        tel = data.pop("telemetry")
        repo.create_incident(
            confirmed_at=data["detected_at"], created_by="demo-seed",
            source_image=None, **data,
        )
        repo.add_snapshot(
            incident_id=data["incident_id"],
            wind_speed=tel["wind_speed"], wind_direction=tel["wind_direction"],
            current_speed=tel["current_speed"], current_direction=tel["current_direction"],
            wave_height=tel["wave_height"], sea_temperature=tel["sea_temperature"],
            data_source=tel["source"], data_status=tel["data_status"], confidence=0.7,
            observation_time=data["detected_at"],
        )
