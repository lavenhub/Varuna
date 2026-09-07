"""Per-category validation IoU for a Phase 2 checkpoint -- oil / lookalike /
no_oil broken out separately, since suppressing false positives on
look-alikes (not just detecting real oil) is the metric the whole SOTA
review flagged as the field's actual bottleneck.

    python scripts/evaluate_phase2.py --data-root data/raw/zenodo_part3/extracted --checkpoint models/segmenter_best.pt
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("MKL_THREADING_LAYER", "SEQUENTIAL")

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import segmentation_models_pytorch as smp
import torch
from torch.utils.data import DataLoader

from varuna.detect.dataset import ZenodoOilSpillTiles, discover_pairs, split_pairs
from varuna.detect.train import build_model, batch_stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--checkpoint", default="models/segmenter_best.pt")
    parser.add_argument("--val-fraction", type=float, default=0.15)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(args.checkpoint, map_location=device)
    model = build_model(ckpt.get("encoder", "resnet34"))
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    print(f"Loaded {args.checkpoint} (trained val_mIoU={ckpt.get('val_miou', 'unknown')})")

    pairs = discover_pairs(Path(args.data_root))
    _, val_pairs = split_pairs(pairs, val_fraction=args.val_fraction)

    for category in ("oil", "lookalike", "no_oil"):
        cat_pairs = [p for p in val_pairs if p.category == category]
        if not cat_pairs:
            print(f"{category}: no validation images in this split")
            continue
        ds = ZenodoOilSpillTiles(cat_pairs, augment=False)
        loader = DataLoader(ds, batch_size=args.batch_size, shuffle=False, num_workers=2)

        tps, fps, fns, tns = [], [], [], []
        with torch.no_grad():
            for images, masks in loader:
                images, masks = images.to(device), masks.to(device)
                logits = model(images)
                tp, fp, fn, tn = batch_stats(logits, masks)
                tps.append(tp); fps.append(fp); fns.append(fn); tns.append(tn)
        tp, fp, fn, tn = (torch.cat(x) for x in (tps, fps, fns, tns))

        if category == "oil":
            # IoU is the right metric where real foreground exists to measure recall against.
            iou = smp.metrics.iou_score(tp, fp, fn, tn, reduction="micro").item()
            print(f"{category:>10}: mIoU={iou:.4f}  over {len(cat_pairs)} images / {len(ds)} tiles")
        else:
            # Ground truth here is entirely background (see the SOTA review's own
            # finding: lookalike/no_oil masks carry no positive class), so IoU is
            # undefined (0/0) whenever the model gets it right -- false-positive
            # rate is the metric the literature (e.g. OSDMamba) actually reports
            # for this case, and it's what a hackathon judge would ask about anyway:
            # "how often does the model cry wolf on a look-alike?"
            fp_rate = (fp.sum() / (fp.sum() + tn.sum())).item()
            print(f"{category:>10}: false-positive rate={fp_rate:.4f}  over {len(cat_pairs)} images / {len(ds)} tiles "
                  f"(fraction of background pixels wrongly flagged as oil)")


if __name__ == "__main__":
    main()
