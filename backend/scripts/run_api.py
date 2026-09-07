"""Start the Varuna SAR detection API for the Oily frontend to call.

    .venv311\\Scripts\\python.exe scripts\\run_api.py [--port 8000]

Applies the Windows MKL/OpenMP workaround before anything else imports
numpy/torch (see README's "Known Windows gotcha" and every other entrypoint
in this repo for the same pattern).
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("varuna.app.inference_api:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
