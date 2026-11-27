import {
  clamp,
  fromBrowLocal,
  inBrowRegion,
  isProtected,
  pointInPolygon,
} from "./geometry";
import type { Brow, Point, VerifiedPatch } from "./types";

export function outline(
  ctx: CanvasRenderingContext2D,
  brows: Brow[],
  width = 1.25,
) {
  ctx.strokeStyle = "#ff404e";
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  for (const brow of brows) {
    ctx.beginPath();
    brow.polygon.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.closePath();
    ctx.stroke();
  }
}

// Pixel edits are limited to manually verified discs in the eyebrow envelope.
// Dark hair pixels blend toward nearby, same-frame skin texture. Original pixels
// inside (or next to) either protected polygon are always copied unchanged.
export function applyVerifiedPatches(
  image: ImageData,
  brows: Brow[],
  patches: VerifiedPatch[],
  strength = 0.8,
): ImageData {
  const { width, height, data } = image;
  const original = new Uint8ClampedArray(data);
  for (const patch of patches) {
    if (!patch.verified) continue;
    const brow = brows.find((b) => b.side === patch.side);
    if (!brow) continue;
    const center = fromBrowLocal({ x: patch.u, y: patch.v }, brow);
    const radius = clamp(patch.radius * brow.length, 1, brow.length * 0.045);
    for (
      let y = Math.max(0, Math.floor(center.y - radius));
      y <= Math.min(height - 1, Math.ceil(center.y + radius));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(center.x - radius));
        x <= Math.min(width - 1, Math.ceil(center.x + radius));
        x++
      ) {
        const p = { x, y },
          d = Math.hypot(x - center.x, y - center.y) / radius;
        if (d >= 1 || !inBrowRegion(p, brow) || isProtected(p, brows, 2))
          continue;
        // Sample away from the brow along its own normal. Use local texture,
        // with rejection of dark/hair samples and of protected areas.
        const samples: number[][] = [];
        for (const sign of [1, -1])
          for (const offset of [0.19, 0.24, 0.29]) {
            const sx = Math.round(
              x + brow.normal.x * brow.length * offset * sign,
            );
            const sy = Math.round(
              y + brow.normal.y * brow.length * offset * sign,
            );
            if (
              sx < 0 ||
              sy < 0 ||
              sx >= width ||
              sy >= height ||
              isProtected({ x: sx, y: sy }, brows, 3)
            )
              continue;
            const si = (sy * width + sx) * 4;
            samples.push([original[si], original[si + 1], original[si + 2]]);
          }
        samples.sort((a, b) => luminance(a) - luminance(b));
        if (samples.length < 3) continue;
        const sample = samples[Math.floor(samples.length * 0.65)];
        const i = (y * width + x) * 4;
        const darkness =
          luminance(sample) -
          luminance([original[i], original[i + 1], original[i + 2]]);
        // Skin-like pixels remain untouched; avoid blanket blur or filling.
        const blend =
          clamp((darkness - 12) / 42, 0, 1) * (1 - d * d) * strength;
        for (let c = 0; c < 3; c++)
          data[i + c] = original[i + c] * (1 - blend) + sample[c] * blend;
      }
    }
  }
  return image;
}
const luminance = (c: number[]) =>
  c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

export function lightLevel(image: ImageData): number {
  let sum = 0,
    n = 0;
  for (let i = 0; i < image.data.length; i += 64) {
    sum += luminance([image.data[i], image.data[i + 1], image.data[i + 2]]);
    n++;
  }
  return sum / Math.max(1, n);
}

export function drawPatchMarkers(
  ctx: CanvasRenderingContext2D,
  brows: Brow[],
  patches: VerifiedPatch[],
) {
  for (const patch of patches) {
    const brow = brows.find((b) => b.side === patch.side);
    if (!brow) continue;
    const p = fromBrowLocal({ x: patch.u, y: patch.v }, brow);
    if (pointInPolygon(p, brow.polygon)) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, patch.radius * brow.length), 0, Math.PI * 2);
    ctx.strokeStyle = patch.verified ? "#f8deaf" : "#ffffff";
    ctx.lineWidth = 1;
    ctx.setLineDash(patch.verified ? [] : [2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function handNearBrows(
  hands: Point[][],
  brows: Brow[],
  width: number,
  height: number,
): boolean {
  return hands.some((hand) =>
    [4, 8, 12, 16, 20].some(
      (i) =>
        hand[i] &&
        isProtected(
          { x: hand[i].x * width, y: hand[i].y * height },
          brows,
          Math.max(3, width * 0.008),
        ),
    ),
  );
}
