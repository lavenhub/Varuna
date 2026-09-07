"""Sentinel-1 GRD preprocessing chain: calibration -> despeckle -> land/wind mask.

Phase 1 (baseline): implement calibrate_to_sigma0 and despeckle so the
classical threshold baseline in detect/segment.py has something real to run
on. Phase 2 reuses the same chain to feed the fine-tuned model.
"""
import numpy as np


def calibrate_to_sigma0(digital_numbers: np.ndarray, calibration_lut: np.ndarray) -> np.ndarray:
    """Convert raw DN to sigma-nought (dB). calibration_lut comes from the
    Sentinel-1 GRD product's own annotation XML (per-band LUT), not a constant.

    TODO: parse the product's calibration annotation (via `rasterio` +
    the .SAFE XML, or snappy/pyroSAR) instead of assuming a flat LUT.
    """
    sigma0_linear = (digital_numbers.astype(np.float64) ** 2) / (calibration_lut ** 2)
    with np.errstate(divide="ignore"):
        return 10 * np.log10(sigma0_linear)


def despeckle_lee_sigma(sigma0_db: np.ndarray, window: int = 7, sigma_thresh: float = 0.9,
                         equivalent_looks: float = 1.0) -> np.ndarray:
    """Refined Lee-sigma speckle filter, adapted for backscatter supplied in dB.

    Speckle is multiplicative in the *linear* domain, so filtering happens
    there: convert dB -> linear, compute the local mean/variance in a moving
    window, trim outliers to a `sigma_thresh`-sigma band around the local mean
    (the "sigma" step -- suppresses edges/point targets from corrupting the
    local statistics), then blend the trimmed value toward the local mean by
    the classic minimum-mean-square-error Lee weight before converting back
    to dB.

    `equivalent_looks` should come from the product's real ENL metadata for a
    faithful noise model -- defaults to 1.0 (single-look) as a conservative
    placeholder; using the product's actual ENL will under-smooth less.
    """
    from scipy.ndimage import uniform_filter

    linear = 10.0 ** (sigma0_db / 10.0)
    mean = uniform_filter(linear, size=window)
    mean_sq = uniform_filter(linear ** 2, size=window)
    local_var = np.clip(mean_sq - mean ** 2, 0, None)
    local_std = np.sqrt(local_var)

    trimmed = np.clip(linear, mean - sigma_thresh * local_std, mean + sigma_thresh * local_std)

    noise_var = mean ** 2 / max(equivalent_looks, 1e-6)
    weight = local_var / (local_var + noise_var + 1e-12)
    filtered_linear = mean + weight * (trimmed - mean)
    filtered_linear = np.clip(filtered_linear, 1e-6, None)

    return 10.0 * np.log10(filtered_linear)


def wind_plausibility_gate(sigma0_db: np.ndarray, wind_speed_ms: np.ndarray,
                            low: float = 2.0, high: float = 10.0) -> np.ndarray:
    """Slicks only dampen backscatter in the 2-10 m/s wind window (literature
    consensus, see the SOTA review). Returns a boolean mask of pixels where a
    dark patch is physically plausible as a slick candidate at all.
    """
    return (wind_speed_ms >= low) & (wind_speed_ms <= high)
