/**
 * Client-side SAR image analysis for the Digital Twin.
 *
 * Extracts a silhouette of the oil-slick blob from an uploaded SAR/aerial scene
 * so the 3D twin's slick mesh can be shaped like the actual uploaded scene
 * instead of a generic circle. This targets the app's primary case — a slick
 * that reads as a spatially coherent, locally darker region against a
 * speckled/textured sea surface (typical of SAR imagery) — via percentile
 * thresholding + connected components + radial silhouette sampling, with a
 * confidence gate that declines rather than guessing on ambiguous imagery.
 * It is a lightweight heuristic, not a segmentation model, and runs entirely
 * in the browser; nothing is uploaded anywhere.
 */

export interface SlickContourResult {
  /** Normalized silhouette points in a roughly [-1, 1] domain, ready to feed a THREE.Shape. */
  points: [number, number][];
  /** Fraction of the analyzed frame covered by the detected blob (0..1). */
  areaFraction: number;
  /** Data URL visualizing the detected region overlaid on the source image, for user confirmation. */
  maskPreviewDataUrl: string;
  /** Whether the darker-than-threshold region was treated as the slick (typical for SAR) or the brighter one. */
  polarity: "dark" | "bright";
}

const GRID = 128;
const ANGLE_SAMPLES = 96;
const BLUR_RADIUS = 2;
// Tried in order for each polarity — smallest (tightest) coherent blob wins.
const PERCENTILES = [0.08, 0.1, 0.13, 0.17, 0.22];
const MIN_AREA_FRACTION = 0.015;
const MAX_AREA_FRACTION = 0.5;
// How concentrated the candidate percentile pixels must be in a single blob
// (component area / total masked pixels) before we trust the region at all.
const MIN_COMPACTNESS = 0.72;

function toGrayscale(data: Uint8ClampedArray, size: number): Float64Array {
  const gray = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/** Box blur to suppress SAR speckle noise before segmenting. */
function boxBlur(gray: Float64Array, size: number, radius: number): Float64Array {
  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= size) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= size) continue;
          sum += gray[ny * size + nx]!;
          count++;
        }
      }
      out[y * size + x] = sum / count;
    }
  }
  return out;
}

function percentileValue(values: Float64Array, p: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** Largest 4-connected component in a boolean mask. */
function largestComponent(mask: Uint8Array, size: number): { indices: Set<number>; area: number } | null {
  const visited = new Uint8Array(size * size);
  let best: { indices: Set<number>; area: number } | null = null;
  const total = size * size;
  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    const indices = new Set<number>();
    while (stack.length) {
      const idx = stack.pop()!;
      indices.add(idx);
      const x = idx % size;
      const y = (idx / size) | 0;
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < size - 1 ? idx + 1 : -1,
        y > 0 ? idx - size : -1,
        y < size - 1 ? idx + size : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && mask[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (!best || indices.size > best.area) best = { indices, area: indices.size };
  }
  return best;
}

interface Candidate {
  indices: Set<number>;
  area: number;
  compactness: number;
}

/** Try the darkest/brightest `p` fraction of (blurred) pixels and return the largest coherent blob, if any. */
function candidateAt(smooth: Float64Array, size: number, polarity: "dark" | "bright", p: number): Candidate | null {
  const total = size * size;
  const thresh = percentileValue(smooth, polarity === "dark" ? p : 1 - p);
  const mask = new Uint8Array(total);
  let maskCount = 0;
  for (let i = 0; i < total; i++) {
    const hit = polarity === "dark" ? smooth[i]! <= thresh : smooth[i]! >= thresh;
    if (hit) {
      mask[i] = 1;
      maskCount++;
    }
  }
  const comp = largestComponent(mask, size);
  if (!comp || maskCount === 0) return null;
  return { indices: comp.indices, area: comp.area, compactness: comp.area / maskCount };
}

/** Pick the tightest qualifying blob across percentile steps for one polarity, smallest (most confident) first. */
function bestForPolarity(smooth: Float64Array, size: number, polarity: "dark" | "bright"): Candidate | null {
  const total = size * size;
  for (const p of PERCENTILES) {
    const c = candidateAt(smooth, size, polarity, p);
    if (!c) continue;
    const areaFraction = c.area / total;
    if (c.compactness >= MIN_COMPACTNESS && areaFraction >= MIN_AREA_FRACTION && areaFraction <= MAX_AREA_FRACTION) {
      return c;
    }
  }
  return null;
}

function componentCentroid(indices: Set<number>, size: number) {
  let sx = 0;
  let sy = 0;
  for (const idx of indices) {
    sx += idx % size;
    sy += (idx / size) | 0;
  }
  return { cx: sx / indices.size, cy: sy / indices.size };
}

/** Analyze an already-loaded <img> element and extract a slick silhouette, or null if no confident blob is found. */
export function extractSlickContour(img: HTMLImageElement): SlickContourResult | null {
  const canvas = document.createElement("canvas");
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, GRID, GRID);
  const { data } = ctx.getImageData(0, 0, GRID, GRID);

  const gray = toGrayscale(data, GRID);
  const smooth = boxBlur(gray, GRID, BLUR_RADIUS);

  // SAR slicks are almost always the darker, spatially coherent case — try that first,
  // then fall back to a brighter-sheen (optical imagery) hypothesis.
  const dark = bestForPolarity(smooth, GRID, "dark");
  const bright = dark ? null : bestForPolarity(smooth, GRID, "bright");
  const chosen = dark ?? bright;
  const polarity: "dark" | "bright" = dark ? "dark" : "bright";
  if (!chosen) return null;

  const { cx, cy } = componentCentroid(chosen.indices, GRID);
  const maxPossibleR = Math.hypot(GRID, GRID);
  const radii: number[] = new Array(ANGLE_SAMPLES).fill(0);

  for (let a = 0; a < ANGLE_SAMPLES; a++) {
    const theta = (a / ANGLE_SAMPLES) * Math.PI * 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    let r = 0;
    let misses = 0;
    for (let step = 0; step < maxPossibleR; step += 0.75) {
      const x = Math.round(cx + dx * step);
      const y = Math.round(cy + dy * step);
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) break;
      const idx = y * GRID + x;
      if (chosen.indices.has(idx)) {
        r = step;
        misses = 0;
      } else {
        misses++;
        if (misses > 3) break; // tolerate small gaps, then stop
      }
    }
    radii[a] = r;
  }

  // Light smoothing across neighboring angles to reduce single-ray noise.
  const smoothedRadii = radii.map((_, i) => {
    const prev = radii[(i - 1 + ANGLE_SAMPLES) % ANGLE_SAMPLES]!;
    const cur = radii[i]!;
    const next = radii[(i + 1) % ANGLE_SAMPLES]!;
    return (prev + cur * 2 + next) / 4;
  });

  const rMax = Math.max(...smoothedRadii);
  if (!(rMax > 0)) return null;

  const points: [number, number][] = smoothedRadii.map((r, i) => {
    const theta = (i / ANGLE_SAMPLES) * Math.PI * 2;
    const norm = r / rMax;
    return [norm * Math.cos(theta), norm * Math.sin(theta)];
  });

  // Build a preview: source image with the detected region tinted.
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = GRID;
  previewCanvas.height = GRID;
  const pctx = previewCanvas.getContext("2d")!;
  pctx.drawImage(img, 0, 0, GRID, GRID);
  const overlay = pctx.getImageData(0, 0, GRID, GRID);
  for (const idx of chosen.indices) {
    overlay.data[idx * 4] = 255;
    overlay.data[idx * 4 + 1] = Math.round(overlay.data[idx * 4 + 1]! * 0.25);
    overlay.data[idx * 4 + 2] = Math.round(overlay.data[idx * 4 + 2]! * 0.25);
    overlay.data[idx * 4 + 3] = 255;
  }
  pctx.putImageData(overlay, 0, 0);

  return {
    points,
    areaFraction: chosen.area / (GRID * GRID),
    maskPreviewDataUrl: previewCanvas.toDataURL("image/png"),
    polarity,
  };
}
