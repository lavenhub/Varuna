"""Suspect-vessel scoring: S(v) = w1.proximity + w2.ais_gap + w3.anomaly + w4.tonnage

This is pure arithmetic over already-computed inputs, so unlike the other
stub modules it's fully implemented now -- nothing here depends on a trained
model or a data download.
"""
from dataclasses import dataclass


@dataclass
class ScoreWeights:
    proximity: float = 0.4
    ais_gap: float = 0.25
    behavioral_anomaly: float = 0.2
    tonnage_plausibility: float = 0.15


@dataclass
class ScoreBreakdown:
    mmsi: str
    proximity_term: float
    ais_gap_term: float
    anomaly_term: float
    tonnage_term: float
    total: float

    def as_dict(self) -> dict:
        return {
            "mmsi": self.mmsi,
            "proximity": round(self.proximity_term, 3),
            "ais_gap": round(self.ais_gap_term, 3),
            "behavioral_anomaly": round(self.anomaly_term, 3),
            "tonnage_plausibility": round(self.tonnage_term, 3),
            "total": round(self.total, 3),
        }


def score_vessel(mmsi: str, proximity_integral: float, had_ais_gap_in_window: bool,
                  loiter_or_speed_drop_anomaly: float, tonnage_plausibility: float,
                  weights: ScoreWeights = ScoreWeights()) -> ScoreBreakdown:
    """All input terms are expected pre-normalised to [0, 1] by the caller:

    - proximity_integral: cone-weighted time-integral of the vessel's track
      density inside the origin cone (from hindcast.origin_cone_kde)
    - had_ais_gap_in_window: 1.0 if the vessel had a transponder gap
      overlapping the cone's time window, else 0.0
    - loiter_or_speed_drop_anomaly: behavioral anomaly score (speed drop,
      loitering) in the relevant window
    - tonnage_plausibility: how consistent the vessel's declared/estimated
      tonnage is with the estimated spill volume (1.0 = fully consistent)
    """
    ais_gap_term = weights.ais_gap * (1.0 if had_ais_gap_in_window else 0.0)
    proximity_term = weights.proximity * proximity_integral
    anomaly_term = weights.behavioral_anomaly * loiter_or_speed_drop_anomaly
    tonnage_term = weights.tonnage_plausibility * tonnage_plausibility
    total = proximity_term + ais_gap_term + anomaly_term + tonnage_term
    return ScoreBreakdown(mmsi, proximity_term, ais_gap_term, anomaly_term, tonnage_term, total)


def rank_suspects(breakdowns: list[ScoreBreakdown]) -> list[ScoreBreakdown]:
    return sorted(breakdowns, key=lambda b: b.total, reverse=True)
