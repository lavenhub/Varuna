"""Phase 1 smoke test -- runs the real pipeline end to end on synthetic data.

    python scripts/synthetic_demo.py

Every stage (despeckle, wind gate, segmentation, geometry, age/weathering,
OpenOil reverse ensemble, AIS scoring) is the real module; only the input
scene, forcing fields, and AIS tracks are synthetic. This exists to prove the
plumbing before Sentinel-1/CMEMS/ERA5/AIS accounts are set up (README Phase 0)
and before Phase 2's fine-tuned segmenter replaces the classical baseline.
Windows note: this conda env's NumPy/SciPy link against Intel MKL, and the
pip-installed PyTorch CUDA wheel bundles its own separate copy of Intel's
OpenMP runtime (libiomp5md.dll). Two copies of that DLL in one process is a
known Windows crash source (hits inside numpy.linalg.lstsq via OpenDrift's
oil-database init). The two env vars below are the standard workaround --
they MUST be set before numpy/scipy/opendrift/torch are imported anywhere in
the process, hence they're first in this file, ahead of even the stdlib
imports below.
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import matplotlib.pyplot as plt

from varuna.pipeline import run_synthetic_incident


def main():
    result = run_synthetic_incident()

    print("=== Varuna synthetic Phase 1 run ===")
    print(f"Slick area: {result.geometry.area_m2:,.0f} m^2, elongation {result.geometry.elongation:.2f}")
    print(f"Estimated age: {result.age.hours_since_release:.1f}h "
          f"(+/- {result.age.uncertainty_hours:.1f}h)")
    print(f"Origin-cone centroid: {result.origin_lat:.4f} N, {result.origin_lon:.4f} E "
          f"at {result.origin_time.isoformat()}")
    print("\nRanked suspects:")
    for b in result.suspects:
        print(f"  {b.mmsi}: total={b.total:.3f}  {b.as_dict()}")

    out_path = Path(__file__).resolve().parent.parent / "data" / "interim" / "synthetic_demo_mask.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.imsave(out_path, result.mask, cmap="viridis")
    print(f"\nSaved segmentation mask to {out_path}")


if __name__ == "__main__":
    main()
