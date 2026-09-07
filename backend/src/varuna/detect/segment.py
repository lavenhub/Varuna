"""Slick segmentation: Phase 1 classical baseline, Phase 2 fine-tuned model.

Both implement the same interface (`segment(scene) -> label_mask`) so
app/streamlit_app.py never needs to know which one is active.
"""
from dataclasses import dataclass

import numpy as np
from skimage.filters import threshold_otsu

# 5-class labels, matching the Krestenitis/M4D convention used across the SOTA review
SEA, OIL, LOOKALIKE, SHIP, LAND = 0, 1, 2, 3, 4


class ClassicalBaseline:
    """Zero-training baseline: adaptive threshold + wind gate. Good enough to
    validate the rest of the pipeline (hindcast, AIS, UI) before Phase 2's
    fine-tuned model exists. Does NOT distinguish oil from look-alikes -- it
    will over-flag; that's expected and fine for Phase 1.
    """

    def segment(self, sigma0_db: np.ndarray, wind_mask: np.ndarray) -> np.ndarray:
        dark_threshold = threshold_otsu(sigma0_db[wind_mask]) if wind_mask.any() else threshold_otsu(sigma0_db)
        mask = np.full(sigma0_db.shape, SEA, dtype=np.uint8)
        candidate = (sigma0_db < dark_threshold) & wind_mask
        mask[candidate] = OIL
        return mask


@dataclass
class SlickGeometry:
    area_m2: float
    elongation: float
    centroid_row: float
    centroid_col: float


def largest_region_bbox(mask: np.ndarray, label: int = OIL) -> tuple[int, int, int, int] | None:
    """Pixel bounding box (row_min, col_min, row_max, col_max) of the largest
    connected region of `label`, or None if no such region exists. Added for
    the web API layer (varuna.app.inference_api), which needs a normalizable
    box to draw over the source image alongside the full mask -- the rest of
    the pipeline only ever needed the geometry (area/elongation/centroid).
    """
    from skimage.measure import label as cc_label, regionprops

    labeled = cc_label(mask == label)
    regions = regionprops(labeled)
    if not regions:
        return None
    biggest = max(regions, key=lambda r: r.area)
    return biggest.bbox  # (min_row, min_col, max_row, max_col)


def largest_polygon_geometry(mask: np.ndarray, label: int = OIL, pixel_area_m2: float = 100.0) -> SlickGeometry | None:
    """Geometric characterisation of the largest connected OIL region --
    area, elongation (major/minor axis ratio, thin & elongated scores higher
    plausibility per the Mamba long-range-context literature), and centroid
    in pixel coordinates (convert to lon/lat via the scene's geotransform at
    the call site). Returns None if no region of `label` exists.
    """
    from skimage.measure import label as cc_label, regionprops

    labeled = cc_label(mask == label)
    regions = regionprops(labeled)
    if not regions:
        return None

    biggest = max(regions, key=lambda r: r.area)
    minor = max(biggest.axis_minor_length, 1e-6)
    elongation = biggest.axis_major_length / minor
    return SlickGeometry(
        area_m2=biggest.area * pixel_area_m2,
        elongation=float(elongation),
        centroid_row=biggest.centroid[0],
        centroid_col=biggest.centroid[1],
    )


class FineTunedSegmenter:
    """Phase 2: DeepLabV3+ fine-tuned on the Zenodo Trujillo-Acatitla set by
    varuna.detect.train (see README Phase 2). Binary output (SEA/OIL) --
    the Zenodo ground truth doesn't carry the full Krestenitis 5-class
    scheme, so LOOKALIKE/SHIP/LAND stay at zero from this model; ClassicalBaseline's
    wind-gate is still worth applying upstream since this model wasn't
    trained with a wind-plausibility signal.

    Runs sliding-window inference over 512x512 tiles (matching the training
    tile size) and stitches the result back to the input scene's shape,
    since a full Sentinel-1 GRD scene is far larger than one training tile.
    """

    TILE = 512

    def __init__(self, checkpoint_path: str, device: str | None = None):
        import segmentation_models_pytorch as smp
        import torch

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        ckpt = torch.load(checkpoint_path, map_location=self.device)
        self.val_miou = ckpt.get("val_miou")
        self.model = smp.DeepLabV3Plus(
            encoder_name=ckpt.get("encoder", "resnet34"), encoder_weights=None,
            in_channels=ckpt.get("in_channels", 2), classes=ckpt.get("classes", 1),
        )
        self.model.load_state_dict(ckpt["model_state"])
        self.model.to(self.device).eval()

    def segment(self, vv_vh_db: np.ndarray, threshold: float = 0.5,
                db_min: float = -40.0, db_max: float = 15.0,
                return_prob: bool = False):
        """vv_vh_db: array shaped (2, H, W) of VV/VH backscatter in dB,
        matching train.py's normalization convention.

        `return_prob=True` additionally returns the raw per-pixel sigmoid
        probability map (float32, same H/W as the input) alongside the
        thresholded mask -- added for varuna.app.inference_api, which reports
        a confidence score to the frontend rather than just a binary mask.
        The pipeline.py call sites use the default (mask only) and are
        unaffected.
        """
        torch = self.torch
        c, h, w = vv_vh_db.shape
        pad_h = (-h) % self.TILE
        pad_w = (-w) % self.TILE
        padded = np.pad(vv_vh_db, ((0, 0), (0, pad_h), (0, pad_w)), mode="reflect")
        normalized = np.clip((padded - db_min) / (db_max - db_min), 0.0, 1.0)

        out = np.zeros(padded.shape[1:], dtype=np.uint8)
        prob_out = np.zeros(padded.shape[1:], dtype=np.float32)
        with torch.no_grad():
            for y0 in range(0, padded.shape[1], self.TILE):
                for x0 in range(0, padded.shape[2], self.TILE):
                    tile = normalized[:, y0:y0 + self.TILE, x0:x0 + self.TILE]
                    tensor = torch.from_numpy(tile).unsqueeze(0).float().to(self.device)
                    logits = self.model(tensor)
                    prob = torch.sigmoid(logits)[0, 0].cpu().numpy()
                    prob_out[y0:y0 + self.TILE, x0:x0 + self.TILE] = prob
                    out[y0:y0 + self.TILE, x0:x0 + self.TILE] = (prob > threshold).astype(np.uint8) * OIL

        mask = out[:h, :w]
        if return_prob:
            return mask, prob_out[:h, :w]
        return mask
