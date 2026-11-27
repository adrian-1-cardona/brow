import {
  type Adjustment,
  type Brow,
  type BrowSide,
  type BrowStyle,
  type Calibration,
  type Point,
} from "./types";

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// landmark indices run from the inner brow to the tail.
export const BROW_INDICES = {
  left: {
    top: [336, 296, 334, 293, 300],
    bottom: [285, 295, 282, 283, 276],
  },
  right: {
    top: [107, 66, 105, 63, 70],
    bottom: [55, 65, 52, 53, 46],
  },
} as const;

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (distanceToSegment(p, a, b) < 1e-7) return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = d
    ? clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d, 0, 1)
    : 0;
  return distance(p, { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
}

export function polygonDistance(p: Point, polygon: Point[]): number {
  return pointInPolygon(p, polygon)
    ? 0
    : Math.min(
        ...polygon.map((a, i) =>
          distanceToSegment(p, a, polygon[(i + 1) % polygon.length]),
        ),
      );
}

export const isProtected = (p: Point, brows: Brow[], margin = 0) =>
  brows.some((b) => polygonDistance(p, b.polygon) <= margin);

export function toBrowLocal(p: Point, brow: Brow): Point {
  const x = p.x - brow.origin.x,
    y = p.y - brow.origin.y;
  return {
    x: (x * brow.axis.x + y * brow.axis.y) / brow.length,
    y: (x * brow.normal.x + y * brow.normal.y) / brow.length,
  };
}
export function fromBrowLocal(p: Point, brow: Brow): Point {
  return {
    x: brow.origin.x + brow.length * (p.x * brow.axis.x + p.y * brow.normal.x),
    y: brow.origin.y + brow.length * (p.x * brow.axis.y + p.y * brow.normal.y),
  };
}

function makeBrow(
  landmarks: Point[],
  side: BrowSide,
  style: BrowStyle,
  adjustment: Adjustment,
  width: number,
  height: number,
): Brow | null {
  const indices = BROW_INDICES[side];
  const pixel = (i: number) => ({
    x: landmarks[i].x * width,
    y: landmarks[i].y * height,
  });
  if (
    [...indices.top, ...indices.bottom].some(
      (i) =>
        !landmarks[i] ||
        !Number.isFinite(landmarks[i].x) ||
        !Number.isFinite(landmarks[i].y),
    )
  )
    return null;
  const top = indices.top.map(pixel),
    bottom = indices.bottom.map(pixel);
  const inner = {
    x: (top[0].x + bottom[0].x) / 2,
    y: (top[0].y + bottom[0].y) / 2,
  };
  const tail = {
    x: (top[4].x + bottom[4].x) / 2,
    y: (top[4].y + bottom[4].y) / 2,
  };
  const rawLength = distance(inner, tail);
  if (rawLength < width * 0.025) return null;
  const angle =
    Math.atan2(tail.y - inner.y, tail.x - inner.x) +
    (adjustment.rotation * Math.PI) / 180;
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -axis.y, y: axis.x };
  if (normal.y > 0) {
    normal.x *= -1;
    normal.y *= -1;
  }
  const length = rawLength * clamp(adjustment.width, 0.9, 1.12);
  const brow: Brow = {
    side,
    origin: {
      x: inner.x + rawLength * adjustment.x,
      y: inner.y - rawLength * adjustment.y,
    },
    axis,
    normal,
    length,
    polygon: [],
  };
  const heights = top.map((p, i) => distance(p, bottom[i]));
  const baseThickness =
    clamp(
      heights.reduce((a, b) => a + b, 0) / heights.length / rawLength,
      0.11,
      0.24,
    ) * clamp(adjustment.thickness, 0.85, 1.25);
  // keep the arch subtle like the references.
  const rise =
    (style === "straight" ? 0.022 : 0.078) +
    clamp(adjustment.arch, -0.02, 0.035);
  const upper: Point[] = [],
    lower: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const peak = Math.sin(Math.PI * Math.pow(u, 0.78));
    const taper = lerp(1, 0.18, Math.pow(u, 2.5));
    const center = rise * peak;
    upper.push(
      fromBrowLocal({ x: u, y: center + (baseThickness * taper) / 2 }, brow),
    );
    lower.push(
      fromBrowLocal({ x: u, y: center - (baseThickness * taper) / 2 }, brow),
    );
  }
  brow.polygon = [...upper, ...lower.reverse()];
  return brow;
}

export function makeBrows(
  face: Point[],
  style: BrowStyle | null,
  calibration: Calibration,
  width: number,
  height: number,
): Brow[] {
  if (!style) return [];
  return (["left", "right"] as const)
    .map((side) =>
      makeBrow(face, side, style, calibration[side], width, height),
    )
    .filter((b): b is Brow => b !== null);
}

export function inBrowRegion(p: Point, brow: Brow) {
  const local = toBrowLocal(p, brow);
  return (
    local.x >= -0.08 && local.x <= 1.08 && local.y >= -0.3 && local.y <= 0.32
  );
}

export function coverTransform(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
) {
  const scale = Math.max(
    displayWidth / sourceWidth,
    displayHeight / sourceHeight,
  );
  return {
    scale,
    x: (displayWidth - sourceWidth * scale) / 2,
    y: (displayHeight - sourceHeight * scale) / 2,
  };
}
export function displayToSource(
  p: Point,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  mirror = true,
): Point {
  const t = coverTransform(sw, sh, dw, dh);
  const x = (p.x - t.x) / t.scale;
  return { x: mirror ? sw - x : x, y: (p.y - t.y) / t.scale };
}
export function sourceToDisplay(
  p: Point,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  mirror = true,
): Point {
  const t = coverTransform(sw, sh, dw, dh);
  return {
    x: (mirror ? sw - p.x : p.x) * t.scale + t.x,
    y: p.y * t.scale + t.y,
  };
}

export class LandmarkSmoother {
  private previous: Point[] = [];
  reset() {
    this.previous = [];
  }
  update(points: Point[], stability: number): Point[] {
    if (points.length !== this.previous.length || !points.length) {
      this.previous = points.map((p) => ({ ...p }));
      return this.previous;
    }
    this.previous = points.map((p, i) => {
      const old = this.previous[i];
      const movement = distance(p, old);
      // smooth small jitters without lagging behind bigger moves.
      const alpha = clamp(1 - stability + movement * 16, 0.18, 0.9);
      return { x: lerp(old.x, p.x, alpha), y: lerp(old.y, p.y, alpha) };
    });
    return this.previous;
  }
}
