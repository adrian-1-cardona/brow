import {
  clamp,
  fromBrowLocal,
  inBrowRegion,
  isProtected,
  pointInPolygon,
  polygonDistance,
  toBrowLocal,
} from "./geometry";
import type { Brow, Point, VerifiedPatch } from "./types";

function rowSpans(polygon: Point[], y: number): number[] {
  const spans: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (a.y > y !== b.y > y)
      spans.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
  }
  return spans.sort((a, b) => a - b);
}

function inSpans(x: number, spans: number[], margin = 0): boolean {
  for (let i = 0; i < spans.length; i += 2)
    if (x >= spans[i] - margin && x <= spans[i + 1] + margin) return true;
  return false;
}

// pause when a dark obstruction extends beneath the inner brow.
function browsObstructed(image: ImageData, brows: Brow[]): boolean {
  const sample = (p: Point) => {
    const x = Math.round(p.x),
      y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const i = (y * image.width + x) * 4;
    return luminance([image.data[i], image.data[i + 1], image.data[i + 2]]);
  };
  return brows.some((brow) => {
    const top = Math.max(
      ...brow.sourcePolygon.map((p) => toBrowLocal(p, brow).y),
    );
    const skin = sample(fromBrowLocal({ x: 0.4, y: top + 0.15 }, brow));
    if (skin === null) return true;
    const head = brow.sourcePolygon[brow.sourcePolygon.length - 1];
    let dark = 0;
    for (const u of [-0.16, -0.1, -0.04])
      for (const v of [0, 0.05, 0.1, 0.15]) {
        const value = sample({
          x: head.x + brow.length * (u * brow.axis.x - v * brow.normal.x),
          y: head.y + brow.length * (u * brow.axis.y - v * brow.normal.y),
        });
        if (value !== null && value < skin * 0.6 && skin - value > 25) dark++;
      }
    return dark >= 7;
  });
}

// borrow skin from this frame and trim only visible hair outside the outline.
export function applyStylePreview(
  image: ImageData,
  brows: Brow[],
): { changed: number; obstructed: boolean } {
  const { width, height, data } = image;
  if (browsObstructed(image, brows)) return { changed: 0, obstructed: true };
  const original = new Uint8ClampedArray(data);
  let changed = 0;
  for (const brow of brows) {
    const columns = (polygon: Point[]) =>
      polygon.map((p) => {
        const local = toBrowLocal(p, brow);
        return { x: local.y, y: local.x };
      });
    const sourceColumns = columns(brow.sourcePolygon),
      targetColumns = columns(brow.polygon);
    const protection = Math.max(0.75, brow.length * 0.008);
    const feather = Math.max(1, brow.length * 0.018);
    const minY = Math.max(
      0,
      Math.ceil(Math.min(...brow.sourcePolygon.map((p) => p.y))),
    );
    const maxY = Math.min(
      height - 1,
      Math.floor(Math.max(...brow.sourcePolygon.map((p) => p.y))),
    );
    for (let y = minY; y <= maxY; y++) {
      const source = rowSpans(brow.sourcePolygon, y);
      const protectedRows = brows.flatMap((b) =>
        [-1, 0, 1].map((offset) => rowSpans(b.polygon, y + offset)),
      );
      for (let span = 0; span < source.length; span += 2) {
        const start = Math.max(0, Math.ceil(source[span])),
          end = Math.min(width - 1, Math.floor(source[span + 1]));
        for (let x = start; x <= end; x++) {
          if (protectedRows.some((row) => inSpans(x, row, protection)))
            continue;
          const local = toBrowLocal({ x, y }, brow);
          const sourceColumn = rowSpans(sourceColumns, local.x);
          if (!sourceColumn.length) continue;
          const bounds = [...sourceColumn, ...rowSpans(targetColumns, local.x)];
          const above =
            local.y >
            (sourceColumn[0] + sourceColumn[sourceColumn.length - 1]) / 2;
          const boundary = above ? Math.max(...bounds) : Math.min(...bounds);
          const samples: number[][] = [];
          for (const offset of [0.045, 0.075, 0.105]) {
            const p = fromBrowLocal(
              {
                x: local.x,
                y:
                  boundary +
                  (above ? offset : -offset) +
                  (local.y - boundary) * 0.2,
              },
              brow,
            );
            const sx = Math.round(p.x),
              sy = Math.round(p.y);
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
            const i = (sy * width + sx) * 4;
            samples.push([original[i], original[i + 1], original[i + 2]]);
          }
          if (samples.length < 3) continue;
          samples.sort((a, b) => luminance(a) - luminance(b));
          const skin = samples[1];
          const i = (y * width + x) * 4;
          const darkness =
            luminance(skin) -
            luminance([original[i], original[i + 1], original[i + 2]]);
          const edge = Math.min(
            x - source[span],
            source[span + 1] - x,
            y - minY,
            maxY - y,
          );
          if (darkness <= 20) continue;
          const clearance = Math.min(
            ...brows.map((b) => polygonDistance({ x, y }, b.polygon)),
          );
          const blend =
            clamp((darkness - 20) / 38, 0, 1) *
            clamp(edge / feather, 0, 1) *
            clamp((clearance - protection) / feather, 0, 1) *
            0.9;
          if (blend <= 0) continue;
          for (let c = 0; c < 3; c++)
            data[i + c] = original[i + c] * (1 - blend) + skin[c] * blend;
          if (
            data[i] !== original[i] ||
            data[i + 1] !== original[i + 1] ||
            data[i + 2] !== original[i + 2]
          )
            changed++;
        }
      }
    }
  }
  return { changed, obstructed: false };
}

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

// only edit verified spots outside the protected outline.
export function applyVerifiedPatches(
  image: ImageData,
  brows: Brow[],
  patches: VerifiedPatch[],
): number {
  const { width, height, data } = image;
  const original = new Uint8ClampedArray(data);
  let changed = 0;
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
        // sample nearby skin without touching the protected area.
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
        // blend dark hairs while leaving skin texture alone.
        const blend = clamp((darkness - 12) / 42, 0, 1) * (1 - d * d) * 0.8;
        for (let c = 0; c < 3; c++)
          data[i + c] = original[i + c] * (1 - blend) + sample[c] * blend;
        if (
          data[i] !== original[i] ||
          data[i + 1] !== original[i + 1] ||
          data[i + 2] !== original[i + 2]
        )
          changed++;
      }
    }
  }
  return changed;
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
