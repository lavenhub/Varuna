"""Oil-age estimation and the analytical un-weathering correction.

Two genuinely different jobs, both flagged as real research gaps in the SOTA
review -- no pretrained model exists for either anywhere in the literature:

1. estimate_age(): regress elapsed time-since-release from the segmented
   polygon's shape/contrast. No public model to fine-tune from -- train from
   scratch using MEDSLIK-II-generated weathering curves as weak-supervision
   pseudo-labels (see README Phase 2 notes). Until that regressor exists, a
   conservative fixed search window (e.g. 12-72h) is a safe placeholder --
   better to search too wide than miss the origin.

2. un_weather(): OpenDrift disables nonlinear weathering during backward
   runs (confirmed limitation, see the SOTA review), so evaporation and
   emulsification have to be reversed analytically *before* the polygon is
   seeded into the backward solver, using MEDSLIK-II's REMPEC oil-property
   curves. This is the one architectural correction that matters most for
   getting a physically honest origin estimate.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class AgeEstimate:
    hours_since_release: float
    uncertainty_hours: float


def estimate_age(polygon_area_m2: float, elongation: float, mean_contrast_db: float) -> AgeEstimate:
    """Placeholder: wide fixed window until the pseudo-labelled regressor
    (README Phase 2 stretch goal) is trained. Deliberately conservative --
    an overconfident narrow window here silently breaks Stage C.
    """
    return AgeEstimate(hours_since_release=36.0, uncertainty_hours=24.0)


# Fingas (1996, 2015) empirical evaporation coefficients: %evaporated =
# a + b*ln(t_minutes). Indicative literature values by oil class -- swap for
# MEDSLIK-II's per-oil-type REMPEC database entries when that's wired in;
# these are a defensible stand-in, not the final word.
_FINGAS_COEFFICIENTS = {
    "light_crude": (25.0, 5.5),
    "medium_crude": (12.0, 3.5),
    "heavy_crude": (5.0, 1.5),
    "diesel": (35.0, 6.5),
}


def un_weather_volume(observed_area_m2: float, age: AgeEstimate, oil_type: str = "medium_crude",
                       slick_thickness_m: float = 1e-4) -> float:
    """Estimate the originally-released volume by inverting the Fingas
    evaporation curve for the estimated age, then converting the observed
    slick area to a volume via an assumed sheen/slick thickness.

    This is intentionally the simplest defensible physical model, not a
    literature-validated per-oil-type curve -- there is no dedicated SAR
    oil-age/un-weathering model published anywhere (confirmed gap, see the
    SOTA review), so treat this function's output as a first-order estimate
    to seed the reverse ensemble with, not a forensic-grade volume claim.
    """
    a, b = _FINGAS_COEFFICIENTS.get(oil_type, _FINGAS_COEFFICIENTS["medium_crude"])
    t_minutes = max(age.hours_since_release * 60.0, 1.0)
    pct_evaporated = min(max(a + b * np.log(t_minutes), 0.0), 95.0)  # Fingas curves saturate well below 100%
    remaining_fraction = 1.0 - pct_evaporated / 100.0

    observed_volume_m3 = observed_area_m2 * slick_thickness_m
    original_volume_m3 = observed_volume_m3 / max(remaining_fraction, 0.05)
    return original_volume_m3
