"""Persistence layer for OILY.

Concrete storage is SQLite (zero-install, always available), but every access
goes through the repository in ``repo.py`` rather than touching SQL directly, so
the backend can be repointed at PostgreSQL/PostGIS by swapping this module's
connection factory and the handful of SQL dialect details — the service layer,
the API and the web client are all unaffected. The schema models the OILY
domain (incidents, environmental snapshots, simulations, trajectory points,
impact assessments, response plans, response resources) as first-class,
timestamped, related records with real IDs.

Set ``OILY_DB_PATH`` to override the database location (default: ``data/oily.db``
under the repo root). Set it to ``:memory:`` for ephemeral test runs.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# Repo root = .../all model  (this file is src/varuna/oily/db.py)
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DB = _REPO_ROOT / "data" / "oily.db"

DB_PATH = os.environ.get("OILY_DB_PATH", str(_DEFAULT_DB))

_lock = threading.Lock()
_initialised = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    id                  TEXT PRIMARY KEY,          -- VARUNA-1042
    incident_code       TEXT,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL,             -- DETECTED..CLOSED
    risk                TEXT NOT NULL,             -- LOW..CRITICAL
    latitude            REAL NOT NULL,
    longitude           REAL NOT NULL,
    region              TEXT,
    oil_type            TEXT,
    persistence         TEXT,                      -- Persistent | Non-persistent
    volume_tonnes       REAL,
    spill_area_km2      REAL,
    cause               TEXT,
    detection_confidence REAL,                     -- 0..1
    detection_source    TEXT,
    source_image        TEXT,                      -- data: URL or base64 (nullable)
    notes               TEXT,
    detected_at         TEXT,                      -- ISO 8601 UTC
    confirmed_at        TEXT,
    created_by          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environmental_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id         TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    timestamp           TEXT NOT NULL,             -- when the snapshot was taken/stored
    observation_time    TEXT,                      -- validity time of the field
    wind_speed          REAL,                      -- m/s
    wind_direction      REAL,                      -- deg
    current_speed       REAL,                      -- m/s
    current_direction   REAL,                      -- deg
    wave_height         REAL,                      -- m
    sea_temperature     REAL,                      -- C
    data_source         TEXT,
    data_status         TEXT,                      -- OBSERVED | MODELLED | ESTIMATED | SIMULATED
    confidence          REAL
);

CREATE TABLE IF NOT EXISTS simulations (
    id                  TEXT PRIMARY KEY,          -- SIM-...
    incident_id         TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    simulation_type     TEXT NOT NULL,             -- drift | scenario
    status              TEXT NOT NULL,             -- queued | running | completed | failed
    model_version       TEXT NOT NULL,
    start_time          TEXT,
    duration_hours      REAL,
    time_step_minutes   REAL,
    parameters          TEXT,                      -- JSON blob of the full request
    result_summary      TEXT,                      -- JSON blob of headline outputs
    created_at          TEXT NOT NULL,
    completed_at        TEXT
);

CREATE TABLE IF NOT EXISTS trajectory_points (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id       TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    seq                 INTEGER NOT NULL,          -- order within the run
    timestamp           TEXT NOT NULL,
    hours               REAL NOT NULL,
    latitude            REAL NOT NULL,
    longitude           REAL NOT NULL,
    velocity            REAL,                      -- m/s
    direction           REAL,                      -- deg
    distance_km         REAL,
    uncertainty_radius_km REAL,
    intensity           REAL,                      -- relative slick concentration 0..1
    status              TEXT                       -- afloat | beached
);
CREATE INDEX IF NOT EXISTS idx_traj_sim ON trajectory_points(simulation_id, seq);

CREATE TABLE IF NOT EXISTS impact_assessments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id         TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    simulation_id       TEXT REFERENCES simulations(id) ON DELETE SET NULL,
    score               REAL NOT NULL,
    severity            TEXT NOT NULL,
    confidence          REAL,
    factors             TEXT,                      -- JSON array
    affected_regions    TEXT,                      -- JSON array
    exposure_times      TEXT,                      -- JSON array
    inputs              TEXT,                      -- JSON: audit trail of inputs
    model_version       TEXT NOT NULL,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS response_plans (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id         TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    priority            TEXT NOT NULL,
    actions             TEXT,                      -- JSON array
    resources           TEXT,                      -- JSON array
    manpower            TEXT,                      -- JSON object
    reasoning           TEXT,                      -- JSON array
    summary             TEXT,
    model_version       TEXT NOT NULL,
    generated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS response_resources (
    resource_id         TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    name                TEXT NOT NULL,
    location            TEXT,
    latitude            REAL,
    longitude           REAL,
    quantity            REAL,
    unit                TEXT,
    availability        TEXT,                      -- AVAILABLE | LIMITED | UNAVAILABLE
    status              TEXT
);
"""


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db() -> None:
    """Create the schema (idempotent) and seed reference/demo data once."""
    global _initialised
    with _lock:
        if _initialised:
            return
        if DB_PATH != ":memory:":
            Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        with _connect(DB_PATH) as conn:
            conn.executescript(SCHEMA)
            conn.commit()
        _initialised = True
    # Seeding lives in seed.py to keep this module dependency-free; imported
    # lazily so a bare `import db` never drags in the demo data machinery.
    from . import seed

    seed.ensure_seeded()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Yield a connection with the schema guaranteed to exist."""
    if not _initialised:
        init_db()
    conn = _connect(DB_PATH)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def storage_info() -> dict:
    """Reported in /health so the UI can show where results are actually stored."""
    return {
        "engine": "sqlite",
        "path": DB_PATH,
        "postgres_ready": True,  # repository is dialect-light; swap _connect() to psycopg
    }
