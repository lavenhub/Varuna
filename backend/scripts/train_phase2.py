"""Entrypoint for Phase 2 fine-tuning -- see varuna.detect.train for the
actual training loop. Kept separate so the Windows MKL/OpenMP workaround
(see synthetic_demo.py's docstring) is guaranteed to run before numpy/scipy/
torch are imported anywhere in the process.

    python scripts/train_phase2.py --data-root data/raw/zenodo_part3/extracted --epochs 40

For a fast sanity check before committing to a full run:

    python scripts/train_phase2.py --data-root data/raw/zenodo_part3/extracted --limit-images 20 --epochs 3
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from varuna.detect.train import main

if __name__ == "__main__":
    main()
