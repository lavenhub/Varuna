"""Run after Phase 0 env setup to confirm the stack is actually usable
before spending time on data download or training.

    python scripts/check_system.py

Windows note: works around a conda-MKL / pip-torch OpenMP DLL conflict --
see scripts/synthetic_demo.py's docstring for why this is needed here too.
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import importlib
import shutil


def check(name, fn):
    try:
        result = fn()
        print(f"[OK]   {name}: {result}")
    except Exception as e:
        print(f"[FAIL] {name}: {e}")


def torch_cuda():
    torch = importlib.import_module("torch")
    if not torch.cuda.is_available():
        return "torch installed but CUDA not available — check driver/CUDA wheel match"
    name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    return f"{name}, {vram_gb:.1f} GB VRAM, torch {torch.__version__}"


def gdal_rasterio():
    rasterio = importlib.import_module("rasterio")
    return f"rasterio {rasterio.__version__}, GDAL backend OK"


def opendrift_ok():
    od = importlib.import_module("opendrift")
    return f"opendrift {od.version.__version__ if hasattr(od, 'version') else 'installed'}"


def movingpandas_ok():
    mpd = importlib.import_module("movingpandas")
    return f"movingpandas installed ({mpd.__file__})"


def smp_ok():
    smp = importlib.import_module("segmentation_models_pytorch")
    return f"segmentation-models-pytorch {smp.__version__}"


def ollama_ok():
    if shutil.which("ollama") is None:
        raise RuntimeError("ollama CLI not found on PATH — install from ollama.com if using the local agent")
    return "ollama CLI found"


if __name__ == "__main__":
    print("Varuna system check\n" + "-" * 40)
    check("PyTorch + CUDA", torch_cuda)
    check("GDAL / rasterio", gdal_rasterio)
    check("OpenDrift", opendrift_ok)
    check("MovingPandas", movingpandas_ok)
    check("segmentation-models-pytorch", smp_ok)
    check("Ollama (optional, agent layer)", ollama_ok)
