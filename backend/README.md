# Varuna — SIH26143 local build

Oil-spill detection → reverse-drift hindcast → AIS vessel attribution, built to run
entirely on a single RTX 4060 Laptop (8GB VRAM) / Ryzen 7 7435HS / 24GB RAM machine.

See the full research study and architecture rationale in the published report
(Varuna Spillwatch artifact) for *why* each component below was chosen.

## Hardware envelope this project is designed against

- GPU: 8GB VRAM — segmentation and vessel-detection models only, kept to
  ResNet34/EfficientNet-B0-class encoders or frozen-encoder SAM variants.
- CPU/RAM: 8C/16T, 24GB — carries all AIS/GeoPandas/MovingPandas work and the
  entire OpenDrift/OpenOil physics engine (CPU-only, no GPU needed).
- Disk: don't bulk-download full-year global AIS dumps; filter at the source
  (aisstream.io region/time filters, or MarineCadastre state/year slices).

## Phase 0 — Environment

```bash
# Install Miniforge first (conda-forge distribution), then:
conda env create -f environment.yml
conda activate varuna
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

Register accounts (free) and stash credentials in a local `.env` (gitignored):
- CMEMS — https://marine.copernicus.eu (ocean currents + Stokes drift)
- CDS / ERA5 — https://cds.climate.copernicus.eu (winds; use ERA5T for near-real-time)
- Copernicus Data Space — https://dataspace.copernicus.eu (Sentinel-1 GRD)
- aisstream.io — free WebSocket API key (global AIS, covers Indian waters)

Email the Krestenitis/M4D dataset request today (mikrestenitis@iti.gr via
https://m4d.iti.gr/oil-spill-detection-dataset/) — it's manually approved, not
an instant download.

### Known Windows gotcha

This env's conda-forge NumPy/SciPy link against Intel MKL, and the pip
CUDA wheel for PyTorch bundles its own separate copy of Intel's OpenMP
runtime (`libiomp5md.dll`). Two copies in one process crash hard (access
violation inside `numpy.linalg.lstsq`, surfaced via OpenDrift's oil-database
init). Every real entrypoint in this repo sets the standard workaround
(`KMP_DUPLICATE_LIB_OK=TRUE`, `MKL_THREADING_LAYER=SEQUENTIAL`) at the very
top of the file, before any other import — if you add a new entrypoint,
copy that pattern before importing numpy/scipy/opendrift/torch.

## Phase 1 — Baseline demo (no training)

Goal: prove the full pipeline plumbing end-to-end before any model exists.

1. `src/varuna/preprocess/sar_preprocess.py` — calibrate + despeckle a sample scene
2. Classical dark-spot threshold (Otsu/adaptive) + wind-envelope gate stands in
   for the segmenter — see `segment.py`'s `ClassicalBaseline`
3. `src/varuna/hindcast/drift.py` — real OpenDrift/OpenOil reverse run on the
   resulting polygon, forced by real CMEMS/ERA5 data
4. `src/varuna/attribute/ais_ingest.py` + `scoring.py` — real AIS tracks, real
   scoring formula
5. `src/varuna/app/streamlit_app.py` — `streamlit run src/varuna/app/streamlit_app.py`

## Phase 2 — Real segmentation (fine-tuning)

Dataset: Zenodo Trujillo-Acatitla set (Part III small split first, then Part I,
~47GB, VV+VH σ⁰ dB, 2048×2048 TIFF — tile to 512×512 before training).

Recipe (fits in ~4-5GB VRAM on the RTX 4060):
- `segmentation_models_pytorch.DeepLabV3Plus` or `UnetPlusPlus`, encoder
  `resnet34` or `efficientnet-b0`, ImageNet-pretrained
- Input: VV+VH 2-channel, 512×512 tiles
- Loss: `λ1·Focal(γ=2) + λ2·Dice`
- Batch size 8, AMP (`torch.cuda.amp`), cosine LR schedule, ~40-60 epochs
- Augmentation: flip/rotate/brightness (albumentations)

## Phase 3 — Vessel detection

Use the AllenAI `sar_vessel_detect` xView3 baseline weights for inference
directly — don't fine-tune locally unless Phase 2 is done early and time allows.

## Phase 4 — Agentic narrator (presentation layer)

`src/varuna/agent/narrator.py` — a 3-tool agent (score breakdown, slick
geometry, drift-cone stats) over a local Ollama model (Llama 3.2 3B / Phi-3-mini)
so the live demo doesn't depend on venue internet. It narrates the pipeline's
own numbers; it never invents one.

## Phase 5 — Physics visualization polish

Animate the real OpenDrift particle ensemble (Folium `TimestampedGeoJson` or
Plotly) converging backward to the origin cone — bake a GIF for slides, keep a
live replay slider in Streamlit.

## Phase 6 — Evidence export

Combine mask, cone map, suspect table, and agent narrative into a single
PDF/HTML case file per incident.
