"""PyTorch Dataset for the Zenodo Trujillo-Acatitla Sentinel-1 SAR oil-spill
set (Part III used first -- see README Phase 2). Each source image is
2048x2048x2 (VV, VH) with a matching 2048x2048 binary mask; this loader tiles
each into 512x512 patches so a full fine-tune fits comfortably in 8GB VRAM
and multiplies the effective sample count (450 source images -> up to
7,200 patches).

The archive's internal folder names aren't hardcoded here -- discover_pairs()
walks the extracted directory looking for an "image"-like folder next to a
"mask"-like folder and matches files by shared numeric stem, so this survives
whatever exact naming the .7z unpacks to.
"""
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
import torch
from torch.utils.data import Dataset

TILE = 512


@dataclass
class ImageMaskPair:
    image_path: Path
    mask_path: Path
    category: str  # "oil", "lookalike", or "no_oil" -- inferred from the parent folder name


def _stem_key(path: Path) -> str:
    """Extract the shared numeric id from a filename like '0001.tif' or
    'oil_0001_img.tif' so an image and its mask pair up even if their
    filenames aren't byte-identical.
    """
    digits = re.findall(r"\d+", path.stem)
    return digits[-1] if digits else path.stem


def _classify_category(path: Path) -> str:
    lower = str(path).lower()
    if re.search(r"look[\s_-]?alike", lower):
        return "lookalike"
    if re.search(r"no[\s_-]?oil", lower):
        return "no_oil"
    return "oil"


def discover_pairs(root: Path) -> list[ImageMaskPair]:
    """Walk `root` for TIFF files under any folder whose name suggests images
    vs. masks/ground-truth, and pair them up by shared numeric stem WITHIN
    the same category. This matters because this dataset reuses identical
    filenames (0000.tif ... 0149.tif) across all three category folders --
    pairing by stem alone would silently cross-match an Oil image with a
    Lookalike mask whenever both happen to share a filename, which they
    always do here. Keying by (category, stem) instead keeps them separate.
    """
    root = Path(root)
    all_tiffs = list(root.rglob("*.tif")) + list(root.rglob("*.tiff"))

    image_files = [p for p in all_tiffs if not re.search(r"mask|ground.?truth|gt", str(p), re.I)]
    mask_files = [p for p in all_tiffs if re.search(r"mask|ground.?truth|gt", str(p), re.I)]

    mask_by_key: dict[tuple[str, str], Path] = {}
    for m in mask_files:
        mask_by_key[(_classify_category(m), _stem_key(m))] = m

    pairs = []
    for img in image_files:
        category = _classify_category(img)
        mask = mask_by_key.get((category, _stem_key(img)))
        if mask is not None:
            pairs.append(ImageMaskPair(img, mask, category))
    return pairs


@lru_cache(maxsize=16)
def _read_vv_vh(path: Path) -> np.ndarray:
    """Cached per worker process: a 2048x2048x2 source image gets re-read
    into 16 tiles (512px), so without this cache every tile triggers a fresh
    disk read of the same file. 16 cached images ~= 0.5GB per worker.
    """
    with rasterio.open(path) as src:
        arr = src.read()  # shape (bands, H, W); expect 2 bands (VV, VH)
    if arr.shape[0] == 1:
        arr = np.repeat(arr, 2, axis=0)
    return arr[:2].astype(np.float32)


@lru_cache(maxsize=16)
def _read_mask(path: Path) -> np.ndarray:
    with rasterio.open(path) as src:
        arr = src.read(1)
    return (arr > 0).astype(np.float32)


def _normalize_db(vv_vh: np.ndarray, db_min: float = -40.0, db_max: float = 15.0) -> np.ndarray:
    clipped = np.clip(vv_vh, db_min, db_max)
    return (clipped - db_min) / (db_max - db_min)  # -> [0, 1]


class ZenodoOilSpillTiles(Dataset):
    """`pairs` should already be a train or val split at the *image* level
    (see split_pairs) -- tiling happens after the split so no tile from a
    validation image leaks into training.
    """

    def __init__(self, pairs: list[ImageMaskPair], tile: int = TILE, min_fg_fraction: float = 0.0,
                 augment: bool = False):
        self.tile = tile
        self.augment = augment
        self.index: list[tuple[ImageMaskPair, int, int]] = []
        n = 2048 // tile
        for pair in pairs:
            for ty in range(n):
                for tx in range(n):
                    self.index.append((pair, ty * tile, tx * tile))

    def __len__(self):
        return len(self.index)

    def __getitem__(self, idx):
        pair, y0, x0 = self.index[idx]
        vv_vh = _normalize_db(_read_vv_vh(pair.image_path))
        mask = _read_mask(pair.mask_path)

        img_tile = vv_vh[:, y0:y0 + self.tile, x0:x0 + self.tile]
        mask_tile = mask[y0:y0 + self.tile, x0:x0 + self.tile]

        if self.augment:
            if np.random.rand() < 0.5:
                img_tile, mask_tile = img_tile[:, :, ::-1].copy(), mask_tile[:, ::-1].copy()
            if np.random.rand() < 0.5:
                img_tile, mask_tile = img_tile[:, ::-1, :].copy(), mask_tile[::-1, :].copy()

        return torch.from_numpy(img_tile.copy()), torch.from_numpy(mask_tile.copy()).unsqueeze(0)


def split_pairs(pairs: list[ImageMaskPair], val_fraction: float = 0.15, seed: int = 0):
    """Stratified by category so oil/lookalike/no_oil are each represented
    proportionally in both splits -- otherwise a random split of only 450
    images could easily starve the validation set of one category.
    """
    rng = np.random.default_rng(seed)
    by_cat: dict[str, list[ImageMaskPair]] = {}
    for p in pairs:
        by_cat.setdefault(p.category, []).append(p)

    train, val = [], []
    for cat_pairs in by_cat.values():
        idx = rng.permutation(len(cat_pairs))
        n_val = max(1, int(len(cat_pairs) * val_fraction))
        val_idx, train_idx = set(idx[:n_val]), set(idx[n_val:])
        train += [cat_pairs[i] for i in train_idx]
        val += [cat_pairs[i] for i in val_idx]
    return train, val
