"""Varuna demo UI. Run with:

    streamlit run src/varuna/app/streamlit_app.py

Two modes:
- Real SAR scene (Phase 2): detection runs the actual fine-tuned model
  (models/segmenter_best.pt, val mIoU 0.565) on a real, held-out Sentinel-1
  scene from the Zenodo validation split. Both the raw SAR imagery and the
  model's mask are projected onto the map as toggleable layers over the same
  placeholder footprint used for the origin estimate, so everything the user
  sees is geometrically consistent even though it isn't a real geotransform
  (these Zenodo TIFFs don't carry one -- see pipeline.py's docstring).
- Synthetic (Phase 1): the full pipeline on a synthetically generated scene,
  forcing fields, and AIS tracks -- proves the plumbing end to end.

Hindcast forcing and AIS are still synthetic in both modes until Phase 0's
CMEMS/ERA5/AIS accounts are wired up -- that's the next real-data swap, and
it won't require touching this file, since pipeline.py keeps
detect/hindcast/attribute decoupled.

Windows note: see scripts/synthetic_demo.py's docstring -- the two env vars
below work around a conda-MKL / pip-torch OpenMP DLL conflict and must be set
before numpy/scipy/opendrift/torch are imported anywhere in the process.
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import folium
import numpy as np
import streamlit as st
from streamlit_folium import st_folium

from varuna.pipeline import run_synthetic_incident, run_real_scene_incident, list_real_validation_scenes

DATA_ROOT = "data/raw/zenodo_part3/extracted"
CHECKPOINT = "models/segmenter_best.pt"
OVERLAY_RES = 1024  # downsample raster overlays to this before embedding in the map

st.set_page_config(page_title="Varuna", layout="wide", initial_sidebar_state="expanded")

# ---------------------------------------------------------------- styling --
st.html("""
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html, body, [class*="css"] { font-family: 'Public Sans', sans-serif; }
  #MainMenu, footer, header[data-testid="stHeader"] { visibility: hidden; height: 0; }
  .block-container { padding-top: 1.2rem; max-width: 1400px; }

  .vr-brandbar {
    display: flex; align-items: baseline; gap: .9rem; margin-bottom: .3rem;
    border-bottom: 1px solid #1f3433; padding-bottom: 1rem;
  }
  .vr-wordmark {
    font-family: 'Source Serif 4', serif; font-weight: 700; font-size: 2.1rem;
    color: #E7EEEE; letter-spacing: -.01em;
  }
  .vr-tagline { color: #96B0AE; font-size: .92rem; }
  .vr-badge {
    margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: .72rem;
    padding: .28rem .7rem; border-radius: 99px; white-space: nowrap; align-self: center;
  }
  .vr-badge.real { background: #2A2013; color: #E2A54A; border: 1px solid #4a3a1f; }
  .vr-badge.synthetic { background: #122a20; color: #5fd39c; border: 1px solid #204438; }

  h2, h3 { font-family: 'Source Serif 4', serif !important; }

  [data-testid="stMetric"] {
    background: #101E20; border: 1px solid #1f3433; border-radius: 10px; padding: .8rem 1rem;
  }
  [data-testid="stMetricLabel"] { color: #96B0AE; }

  .vr-suspect-card {
    background: #101E20; border: 1px solid #1f3433; border-radius: 8px;
    padding: .65rem .9rem; margin-bottom: .5rem;
  }
  .vr-suspect-card.top { border-color: #E2A54A55; background: #1a1610; }
  .vr-suspect-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .4rem; }
  .vr-suspect-mmsi { font-family: 'IBM Plex Mono', monospace; font-size: .85rem; color: #E7EEEE; font-weight: 500; }
  .vr-suspect-rank { font-size: .68rem; color: #E2A54A; font-weight: 700; letter-spacing: .04em; }
  .vr-suspect-score { font-family: 'IBM Plex Mono', monospace; font-size: .85rem; color: #4FD1D9; }
  .vr-bar-track { background: #0a1416; border-radius: 99px; height: 6px; overflow: hidden; }
  .vr-bar-fill { height: 100%; border-radius: 99px; background: #4FD1D9; }
  .vr-suspect-card.top .vr-bar-fill { background: #E2A54A; }
  .vr-suspect-terms { margin-top: .4rem; font-size: .72rem; color: #6d7d7a; }

  .vr-note { font-size: .82rem; color: #96B0AE; background: #101E20; border: 1px dashed #2a3634;
             border-radius: 8px; padding: .6rem .8rem; margin-bottom: .8rem; }
</style>
""")


@st.cache_resource
def load_segmenter():
    from varuna.detect.segment import FineTunedSegmenter
    return FineTunedSegmenter(CHECKPOINT)


def _resize(arr: np.ndarray, size: int) -> np.ndarray:
    from PIL import Image
    mode = "F" if arr.ndim == 2 else None
    if arr.ndim == 2:
        img = Image.fromarray(arr.astype(np.float32), mode="F")
    else:
        img = Image.fromarray((arr * 255).astype(np.uint8))
    img = img.resize((size, size), Image.BILINEAR)
    out = np.asarray(img).astype(np.float32)
    return out if arr.ndim == 2 else out / 255.0


def sar_to_rgba(vv_band: np.ndarray) -> np.ndarray:
    small = _resize(vv_band, OVERLAY_RES)
    lo, hi = np.percentile(small, [2, 98])
    norm = np.clip((small - lo) / (hi - lo + 1e-6), 0, 1)
    rgba = np.zeros((*norm.shape, 4), dtype=np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = norm
    rgba[..., 3] = 1.0
    return rgba


def mask_to_rgba(mask: np.ndarray) -> np.ndarray:
    """Alpha is proportional to local oil density in the downsampled block,
    not a hard threshold -- real slicks are thin and elongated, so averaging
    the binary mask down 2x (2048->1024) then cutting at 0.5 coverage would
    wash out most of a thin feature even when its true area fraction is
    meaningful. Scaling density up before capping keeps faint/thin regions
    visible instead of disappearing.
    """
    density = _resize((mask > 0).astype(np.float32), OVERLAY_RES)
    rgba = np.zeros((*density.shape, 4), dtype=np.float32)
    rgba[..., 0] = 0.87
    rgba[..., 1] = 0.32
    rgba[..., 2] = 0.20
    rgba[..., 3] = np.clip(density * 2.5, 0, 0.85)
    return rgba


# --------------------------------------------------------------- sidebar --
st.sidebar.markdown("### Incident")
mode = st.sidebar.radio("Mode", ["Real SAR scene (Phase 2)", "Synthetic (Phase 1)"], label_visibility="visible")

if "result" not in st.session_state:
    st.session_state.result = None
    st.session_state.scene_path = None
    st.session_state.run_id = 0

if mode.startswith("Real"):
    st.sidebar.caption(
        "Detection runs the actual fine-tuned model (val mIoU 0.565) on a real, "
        "held-out Sentinel-1 scene it never saw during training."
    )
    scenes = list_real_validation_scenes(DATA_ROOT)
    if not scenes:
        st.sidebar.error(f"No validation scenes found under {DATA_ROOT} — check the dataset was extracted.")
        selected_pair = None
    else:
        labels = [p.image_path.name for p in scenes]
        choice = st.sidebar.selectbox("Held-out validation scene", labels)
        selected_pair = scenes[labels.index(choice)]
    run_clicked = st.sidebar.button("Run on real scene", type="primary", disabled=selected_pair is None)
    if run_clicked and selected_pair is not None:
        with st.spinner("Loading model + running preprocess → detect → hindcast → attribute..."):
            segmenter = load_segmenter()
            st.session_state.result = run_real_scene_incident(selected_pair.image_path, segmenter=segmenter)
            st.session_state.scene_path = selected_pair.image_path
            st.session_state.run_id += 1
else:
    st.sidebar.caption(
        "Runs the full pipeline on a synthetically generated scene, forcing "
        "fields, and AIS tracks — proves the plumbing end to end."
    )
    if st.sidebar.button("Run synthetic demo", type="primary"):
        with st.spinner("Running preprocess → detect → hindcast → attribute..."):
            st.session_state.result = run_synthetic_incident()
            st.session_state.scene_path = None
            st.session_state.run_id += 1

result = st.session_state.result
is_real = result is not None and st.session_state.scene_path is not None

# ------------------------------------------------------------- brand bar --
badge = '<span class="vr-badge real">● real SAR · Phase 2</span>' if is_real else \
        '<span class="vr-badge synthetic">● synthetic · Phase 1</span>' if result else ""
st.html(f"""
<div class="vr-brandbar">
  <span class="vr-wordmark">Varuna</span>
  <span class="vr-tagline">Oil spill detection → drift hindcast → vessel attribution</span>
  {badge}
</div>
""")

if is_real:
    st.html(
        f'<div class="vr-note">Scene <b>{st.session_state.scene_path.name}</b> from the Phase 2 validation '
        f'split — never used in training. Map position is illustrative: these Zenodo scenes carry no usable '
        f'embedded geotransform, so both the SAR imagery and the detected mask are projected onto the same '
        f'placeholder coastal footprint used for the origin estimate below.</div>'
    )

col_map, col_evidence = st.columns([2, 1], gap="medium")

with col_map:
    st.markdown("##### Imagery, detection & vessel tracks")
    if result is None:
        m = folium.Map(location=[18.9, 72.8], zoom_start=9, tiles="OpenStreetMap")
        st.caption("Run an incident from the sidebar to populate this from real pipeline output.")
    else:
        min_lon, min_lat, max_lon, max_lat = result.bbox
        bounds = [[min_lat, min_lon], [max_lat, max_lon]]
        center = [(min_lat + max_lat) / 2, (min_lon + max_lon) / 2]
        m = folium.Map(location=center, zoom_start=10, tiles="OpenStreetMap")

        if is_real:
            from varuna.detect.dataset import _read_vv_vh
            vv_vh = _read_vv_vh(Path(st.session_state.scene_path))
            folium.raster_layers.ImageOverlay(
                image=sar_to_rgba(vv_vh[0]), bounds=bounds, opacity=0.9, name="SAR imagery (VV)",
            ).add_to(m)

        folium.raster_layers.ImageOverlay(
            image=mask_to_rgba(result.mask), bounds=bounds, opacity=0.85, name="Detected oil (model output)",
        ).add_to(m)

        folium.Marker(
            [result.origin_lat, result.origin_lon],
            tooltip=f"Estimated origin, {result.origin_time.isoformat()}",
            icon=folium.Icon(color="red", icon="warning-sign"),
        ).add_to(m)

        rank_by_mmsi = {b.mmsi: i for i, b in enumerate(result.suspects)}
        score_by_mmsi = {b.mmsi: b.total for b in result.suspects}
        tracks_fg = folium.FeatureGroup(name="AIS vessel tracks")
        for mmsi, pings in result.tracks.items():
            is_top = rank_by_mmsi.get(mmsi) == 0
            color = "#E2A54A" if is_top else "#4FD1D9"
            path = [[p.lat, p.lon] for p in pings]
            folium.PolyLine(
                path, color=color, weight=4 if is_top else 2, opacity=0.9,
                tooltip=f"{mmsi} — score {score_by_mmsi[mmsi]:.2f}",
            ).add_to(tracks_fg)
            folium.CircleMarker(
                path[len(path) // 2], radius=3, color=color, fill=True, fill_opacity=1,
                tooltip=f"{mmsi} — score {score_by_mmsi[mmsi]:.2f}",
            ).add_to(tracks_fg)
        tracks_fg.add_to(m)
        folium.LayerControl(collapsed=False).add_to(m)

    st_folium(m, width=None, height=560, key=f"map_{st.session_state.run_id}")

with col_evidence:
    st.markdown("##### Ranked suspects")
    if result is None:
        st.info("Run an incident to populate scores.")
    else:
        max_total = max((b.total for b in result.suspects), default=1.0) or 1.0
        for i, b in enumerate(result.suspects):
            top = i == 0
            pct = max(0.0, min(100.0, (b.total / max_total) * 100))
            d = b.as_dict()
            terms = f"proximity {d['proximity']} · AIS-gap {d['ais_gap']} · anomaly {d['behavioral_anomaly']} · tonnage {d['tonnage_plausibility']}"
            st.html(f"""
<div class="vr-suspect-card {'top' if top else ''}">
  <div class="vr-suspect-head">
    <span class="vr-suspect-mmsi">MMSI {b.mmsi} {'· TOP SUSPECT' if top else ''}</span>
    <span class="vr-suspect-score">{b.total:.3f}</span>
  </div>
  <div class="vr-bar-track"><div class="vr-bar-fill" style="width:{pct:.0f}%"></div></div>
  <div class="vr-suspect-terms">{terms}</div>
</div>
""")

    st.markdown("##### Slick characterisation")
    if result is None:
        st.info("Run an incident to populate geometry/age.")
    else:
        m1, m2, m3 = st.columns(3)
        m1.metric("Area", f"{result.geometry.area_m2 / 1e6:,.1f} km²")
        m2.metric("Elongation", f"{result.geometry.elongation:.2f}")
        m3.metric("Est. age", f"{result.age.hours_since_release:.0f}h")

    st.markdown("##### Incident narrative")
    st.info("Agentic narrator output goes here — see agent/narrator.py (Phase 4)")
