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

type SkinDonor = { near: number[]; far: number[]; boundary: number };
type PreviewColumn = { source: number[]; skin: Map<boolean, SkinDonor> };

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
    const columnCache = new Map<number, PreviewColumn>();
    const sampleSkin = (u: number, v: number): number[] | null => {
      const p = fromBrowLocal({ x: u, y: v }, brow);
      const samples: number[][] = [];
      const radius = Math.max(2, Math.round(brow.length * 0.025));
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const x = Math.round(p.x) + dx,
            y = Math.round(p.y) + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const i = (y * width + x) * 4;
          samples.push([original[i], original[i + 1], original[i + 2]]);
        }
      if (samples.length < 5) return null;
      samples.sort((a, b) => luminance(a) - luminance(b));
      const middle = samples.slice(
        Math.floor(samples.length * 0.25),
        Math.ceil(samples.length * 0.75),
      );
      return [0, 1, 2].map(
        (c) => middle.reduce((sum, color) => sum + color[c], 0) / middle.length,
      );
    };
    const firstColumn = Math.floor(
      Math.min(...sourceColumns.map((p) => p.y)) * brow.length,
    );
    const lastColumn = Math.ceil(
      Math.max(...sourceColumns.map((p) => p.y)) * brow.length,
    );
    for (let id = firstColumn; id <= lastColumn; id++) {
      const u = id / brow.length;
      const source = rowSpans(sourceColumns, u);
      if (!source.length) continue;
      const bounds = [...source, ...rowSpans(targetColumns, u)];
      const skin = new Map<boolean, SkinDonor>();
      for (const above of [false, true]) {
        const boundary = above ? Math.max(...bounds) : Math.min(...bounds);
        const sign = above ? 1 : -1;
        const near = sampleSkin(u, boundary + sign * 0.025);
        const far = sampleSkin(u, boundary + sign * 0.065);
        if (near && far) skin.set(above, { near, far, boundary });
      }
      columnCache.set(id, { source, skin });
    }
    // Smooth donors along the brow so shadows vary continuously rather than
    // forming independent vertical strips in the reconstructed skin.
    const smoothed = new Map<number, PreviewColumn>();
    const radius = Math.max(2, Math.round(brow.length * 0.07));
    for (const [id, column] of columnCache) {
      const skin = new Map<boolean, SkinDonor>();
      for (const [above, donor] of column.skin) {
        const near = [0, 0, 0],
          far = [0, 0, 0];
        let weight = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const neighbor = columnCache.get(id + offset)?.skin.get(above);
          if (!neighbor) continue;
          const w = 1 - Math.abs(offset) / (radius + 1);
          for (let c = 0; c < 3; c++) {
            near[c] += neighbor.near[c] * w;
            far[c] += neighbor.far[c] * w;
          }
          weight += w;
        }
        skin.set(above, {
          near: near.map((v) => v / weight),
          far: far.map((v) => v / weight),
          boundary: donor.boundary,
        });
      }
      smoothed.set(id, { ...column, skin });
    }
    const protection = 0.25;
    const feather = Math.max(1.5, brow.length * 0.014);
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
      const protectedRows = brows.map((b) => rowSpans(b.polygon, y));
      const nearby = Math.ceil(protection + feather);
      const nearbyRows = brows.flatMap((b) =>
        [-nearby, nearby].map((offset) => rowSpans(b.polygon, y + offset)),
      );
      for (let span = 0; span < source.length; span += 2) {
        const start = Math.max(0, Math.ceil(source[span])),
          end = Math.min(width - 1, Math.floor(source[span + 1]));
        for (let x = start; x <= end; x++) {
          if (protectedRows.some((row) => inSpans(x, row, protection)))
            continue;
          const local = toBrowLocal({ x, y }, brow);
          const columnId = Math.round(local.x * brow.length);
          const column = smoothed.get(columnId);
          if (!column) continue;
          const sourceColumn = column.source;
          const above =
            local.y >
            (sourceColumn[0] + sourceColumn[sourceColumn.length - 1]) / 2;
          const donor = column.skin.get(above);
          if (!donor) continue;
          // Continue the local skin shading into the removed hair instead of
          // copying a bright strip from farther down the eyelid or forehead.
          const extrapolation = Math.min(
            4,
            (Math.abs(local.y - donor.boundary) + 0.025) / 0.04,
          );
          const skin = donor.near.map(
            (value, c) =>
              value - clamp((donor.far[c] - value) * extrapolation, 0, 18),
          );
          const i = (y * width + x) * 4;
          const darkness =
            luminance(skin) -
            luminance([original[i], original[i + 1], original[i + 2]]);
          const edge = Math.min(
            x - source[span],
            source[span + 1] - x,
            (local.y - sourceColumn[0]) * brow.length,
            (sourceColumn[sourceColumn.length - 1] - local.y) * brow.length,
          );
          if (darkness <= 12) continue;
          const clearance = [...protectedRows, ...nearbyRows].some((row) =>
            inSpans(x, row, nearby),
          )
            ? Math.min(...brows.map((b) => polygonDistance({ x, y }, b.polygon)))
            : protection + feather;
          const blend =
            clamp((darkness - 12) / 26, 0, 1) *
            clamp(edge / Math.max(2, brow.length * 0.065), 0, 1) *
            clamp((clearance - protection) / feather, 0, 1) *
            0.95;
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
