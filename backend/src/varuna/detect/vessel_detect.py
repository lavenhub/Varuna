"""Vessel detection over the same SAR scene, for cross-referencing against AIS.

Phase 3: use the AllenAI xView3 baseline (github.com/allenai/sar_vessel_detect)
weights directly for inference -- do not fine-tune locally unless Phase 2 is
finished early. Fine-tuning is a real option later (the xView3 authors
themselves flag nearshore/harbour clutter as the main weakness, which is
exactly where Indian coastal waters would need it most).
"""
from dataclasses import dataclass


@dataclass
class VesselDetection:
    lat: float
    lon: float
    length_m: float | None
    confidence: float
    is_fishing: bool | None


def detect_vessels(scene_path: str, checkpoint_path: str) -> list[VesselDetection]:
    """TODO: load the AllenAI sar_vessel_detect checkpoint and run inference.
    Point predictions only (xView3 is not a segmentation task) -- convert to
    lat/lon using the scene's geotransform before returning.
    """
    raise NotImplementedError("wire up allenai/sar_vessel_detect inference here")
