"""AIS ingestion: aisstream.io (live/global, primary feed for Indian waters)
and MarineCadastre historical CSV (US-only, validation/demo case studies),
plus a synthetic generator for the Phase 1 smoke test.

Keep bounding-box + time-window filtering at the source -- do not pull full
feeds into the 24GB-RAM box.
"""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd


@dataclass
class AISPing:
    mmsi: str
    lat: float
    lon: float
    sog_knots: float
    cog_deg: float
    timestamp: datetime


def load_marinecadastre_csv(csv_path: str, bbox: tuple[float, float, float, float],
                             start: datetime, end: datetime, chunksize: int = 200_000) -> list[AISPing]:
    """Stream a MarineCadastre AccessAIS CSV export in chunks, filtering to
    bbox+window as each chunk is read -- these exports run tens of GB per
    zone/year, so never load the full file before filtering.

    Expected columns (MarineCadastre's documented AccessAIS schema): MMSI,
    BaseDateTime, LAT, LON, SOG, COG.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    pings: list[AISPing] = []

    for chunk in pd.read_csv(csv_path, chunksize=chunksize, parse_dates=["BaseDateTime"]):
        mask = (
            chunk["LAT"].between(min_lat, max_lat)
            & chunk["LON"].between(min_lon, max_lon)
            & chunk["BaseDateTime"].between(start, end)
        )
        for row in chunk.loc[mask].itertuples(index=False):
            pings.append(AISPing(
                mmsi=str(row.MMSI), lat=float(row.LAT), lon=float(row.LON),
                sog_knots=float(row.SOG), cog_deg=float(row.COG),
                timestamp=row.BaseDateTime.to_pydatetime(),
            ))
    return pings


async def stream_aisstream(api_key: str, bbox: tuple[float, float, float, float],
                            duration_seconds: int) -> list[AISPing]:
    """Collect live AIS pings from aisstream.io for `duration_seconds` inside
    `bbox`. Uses the `websockets` package directly -- no dedicated SDK needed.

    NOTE: aisstream.io's exact message schema (field names/nesting under
    MetaData / Message.PositionReport) should be checked against their
    current docs before relying on this in the live demo -- APIs shift.
    """
    import asyncio
    import websockets

    min_lon, min_lat, max_lon, max_lat = bbox
    subscribe_message = {
        "APIKey": api_key,
        "BoundingBoxes": [[[min_lat, min_lon], [max_lat, max_lon]]],
        "FilterMessageTypes": ["PositionReport"],
    }

    pings: list[AISPing] = []
    async with websockets.connect("wss://stream.aisstream.io/v0/stream") as ws:
        await ws.send(json.dumps(subscribe_message))
        deadline = asyncio.get_event_loop().time() + duration_seconds
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(deadline - asyncio.get_event_loop().time(), 0.1))
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            report = msg.get("Message", {}).get("PositionReport")
            meta = msg.get("MetaData", {})
            if report is None:
                continue
            pings.append(AISPing(
                mmsi=str(meta.get("MMSI", "")),
                lat=float(report.get("Latitude", meta.get("latitude", 0.0))),
                lon=float(report.get("Longitude", meta.get("longitude", 0.0))),
                sog_knots=float(report.get("Sog", 0.0)),
                cog_deg=float(report.get("Cog", 0.0)),
                timestamp=datetime.utcnow(),
            ))
    return pings


def synthetic_ais_tracks(origin_lon: float, origin_lat: float, origin_time: datetime,
                          n_vessels: int = 6, seed: int = 0) -> dict[str, list[AISPing]]:
    """Phase 1 smoke-test data: a handful of straight-line vessel tracks, one
    of which is made to pass close to (origin_lon, origin_lat) around
    origin_time so the scoring pipeline has a plausible "true suspect" to
    surface, and the rest are decoys further away or outside the time window.
    Not real data -- exists purely to exercise ais_ingest -> scoring end to
    end before real AIS access is wired up.
    """
    rng = np.random.default_rng(seed)
    tracks: dict[str, list[AISPing]] = {}

    for i in range(n_vessels):
        mmsi = f"4000000{i}"
        is_suspect = i == 0
        # suspect passes within ~0.05 deg (~5km) of the origin at origin_time;
        # decoys are offset further in space and/or time
        lon_offset = rng.uniform(-0.02, 0.02) if is_suspect else rng.uniform(0.3, 1.5) * rng.choice([-1, 1])
        lat_offset = rng.uniform(-0.02, 0.02) if is_suspect else rng.uniform(0.3, 1.5) * rng.choice([-1, 1])
        time_offset_h = rng.uniform(-1, 1) if is_suspect else rng.uniform(6, 48) * rng.choice([-1, 1])

        pings = []
        for step in range(-6, 7):  # +/- 6 hourly pings around the pass time
            t = origin_time + timedelta(hours=time_offset_h + step)
            pings.append(AISPing(
                mmsi=mmsi,
                lon=origin_lon + lon_offset + step * rng.uniform(-0.01, 0.01),
                lat=origin_lat + lat_offset + step * rng.uniform(-0.01, 0.01),
                sog_knots=float(rng.uniform(8, 16)),
                cog_deg=float(rng.uniform(0, 360)),
                timestamp=t,
            ))
        tracks[mmsi] = pings

    return tracks
