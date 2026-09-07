"""Phase 2 fine-tuning: DeepLabV3+ (ResNet34, ImageNet-pretrained encoder)
on the Zenodo Trujillo-Acatitla Sentinel-1 SAR set, sized for an 8GB-VRAM
GPU. See README Phase 2 for the recipe this implements.

    python -m varuna.detect.train --data-root data/raw/zenodo_part3 --epochs 40

Windows note: see scripts/synthetic_demo.py's docstring -- this must run with
KMP_DUPLICATE_LIB_OK / MKL_THREADING_LAYER set before numpy/scipy/torch import,
which is why this module is normally invoked via scripts/train_phase2.py
rather than directly.
"""
import argparse
import time
from pathlib import Path

import numpy as np
import segmentation_models_pytorch as smp
import torch
from torch.utils.data import DataLoader

from varuna.detect.dataset import ZenodoOilSpillTiles, discover_pairs, split_pairs


def build_model(encoder: str = "resnet34") -> torch.nn.Module:
    return smp.DeepLabV3Plus(
        encoder_name=encoder, encoder_weights="imagenet",
        in_channels=2, classes=1,
    )


def iou_on_batch(logits: torch.Tensor, target: torch.Tensor, threshold: float = 0.5) -> float:
    """Convenience single-batch score -- NOT used for validation aggregation
    (see batch_stats + smp.metrics.iou_score(reduction='micro') in the val
    loop below). Averaging per-batch scores from this function is wrong: a
    batch that's entirely background (common here -- lookalike/no_oil tiles
    have all-zero masks) produces a 0/0 nan that poisons a naive mean.
    """
    tp, fp, fn, tn = batch_stats(logits, target, threshold)
    return smp.metrics.iou_score(tp, fp, fn, tn, reduction="micro").item()


def batch_stats(logits: torch.Tensor, target: torch.Tensor, threshold: float = 0.5):
    prob = torch.sigmoid(logits)
    pred = (prob > threshold).long()
    return smp.metrics.get_stats(pred, target.long(), mode="binary")


def run(data_root: str, epochs: int, batch_size: int, lr: float, encoder: str,
        val_fraction: float, limit_images: int | None, out_path: str, num_workers: int):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    pairs = discover_pairs(Path(data_root))
    if not pairs:
        raise RuntimeError(f"No image/mask pairs found under {data_root} -- check extraction completed")
    print(f"Discovered {len(pairs)} image/mask pairs "
          f"({sum(1 for p in pairs if p.category == 'oil')} oil, "
          f"{sum(1 for p in pairs if p.category == 'lookalike')} lookalike, "
          f"{sum(1 for p in pairs if p.category == 'no_oil')} no_oil)")

    if limit_images:
        # Sample evenly across categories, not the first N in raw discovery
        # order -- discover_pairs' rglob returns one category folder at a
        # time, so a plain slice can (and did, at limit=20) land entirely
        # inside "lookalike", giving an all-zero-mask smoke test that can't
        # produce a meaningful IoU either way.
        by_cat: dict[str, list] = {}
        for p in pairs:
            by_cat.setdefault(p.category, []).append(p)
        per_cat = max(1, limit_images // len(by_cat))
        pairs = [p for cat_pairs in by_cat.values() for p in cat_pairs[:per_cat]]
        print(f"--limit-images set: using {len(pairs)} source images "
              f"({per_cat} per category, smoke test)")

    train_pairs, val_pairs = split_pairs(pairs, val_fraction=val_fraction)
    print(f"Train images: {len(train_pairs)} -> {len(train_pairs) * 16} tiles | "
          f"Val images: {len(val_pairs)} -> {len(val_pairs) * 16} tiles")

    train_ds = ZenodoOilSpillTiles(train_pairs, augment=True)
    val_ds = ZenodoOilSpillTiles(val_pairs, augment=False)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,
                               num_workers=num_workers, persistent_workers=num_workers > 0, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False,
                             num_workers=num_workers, persistent_workers=num_workers > 0, pin_memory=True)

    model = build_model(encoder).to(device)
    focal = smp.losses.FocalLoss(mode="binary", gamma=2.0)
    dice = smp.losses.DiceLoss(mode="binary")

    def criterion(logits, target):
        return focal(logits, target) + dice(logits, target)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    scaler = torch.amp.GradScaler(device) if device == "cuda" else None

    best_iou = -1.0
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(epochs):
        model.train()
        t0 = time.time()
        train_losses = []
        for images, masks in train_loader:
            images, masks = images.to(device, non_blocking=True), masks.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            if scaler is not None:
                with torch.amp.autocast(device):
                    logits = model(images)
                    loss = criterion(logits, masks)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                logits = model(images)
                loss = criterion(logits, masks)
                loss.backward()
                optimizer.step()
            train_losses.append(loss.item())
        scheduler.step()

        model.eval()
        tps, fps, fns, tns = [], [], [], []
        with torch.no_grad():
            for images, masks in val_loader:
                images, masks = images.to(device), masks.to(device)
                logits = model(images)
                tp, fp, fn, tn = batch_stats(logits, masks)
                tps.append(tp); fps.append(fp); fns.append(fn); tns.append(tn)

        if tps:
            tp, fp, fn, tn = (torch.cat(x) for x in (tps, fps, fns, tns))
            mean_iou = smp.metrics.iou_score(tp, fp, fn, tn, reduction="micro").item()
        else:
            mean_iou = float("nan")
        print(f"epoch {epoch + 1}/{epochs}  loss={np.mean(train_losses):.4f}  "
              f"val_mIoU={mean_iou:.4f}  ({time.time() - t0:.1f}s)")

        if mean_iou > best_iou:
            best_iou = mean_iou
            torch.save({"model_state": model.state_dict(), "encoder": encoder,
                        "in_channels": 2, "classes": 1, "val_miou": best_iou},
                       out_path)
            print(f"  -> saved new best checkpoint (val_mIoU={best_iou:.4f}) to {out_path}")

    print(f"\nTraining complete. Best val_mIoU={best_iou:.4f} -> {out_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True, help="extracted Zenodo Part III folder")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--encoder", default="resnet34")
    parser.add_argument("--val-fraction", type=float, default=0.15)
    parser.add_argument("--limit-images", type=int, default=None,
                         help="use only the first N source images -- for a fast smoke test")
    parser.add_argument("--out", default="models/segmenter_best.pt")
    parser.add_argument("--num-workers", type=int, default=4)
    args = parser.parse_args()

    run(args.data_root, args.epochs, args.batch_size, args.lr, args.encoder,
        args.val_fraction, args.limit_images, args.out, args.num_workers)


if __name__ == "__main__":
    main()
