import {
  type Adjustment,
  type Brow,
  type BrowSide,
  type BrowStyle,
  type Calibration,
  type Point,
} from "./types";
import { BROW_PROFILES } from "./brow-profiles";

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EYE_INDICES = { left: [362, 263], right: [133, 33] } as const;
export const BROW_INDICES = {
  left: { upper: [336, 296, 334, 293, 300], lower: [285, 295, 282, 283, 276] },
  right: { upper: [107, 66, 105, 63, 70], lower: [55, 65, 52, 53, 46] },
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
  const profile = BROW_PROFILES[style][side];
  const pixel = (i: number) => ({
    x: landmarks[i].x * width,
    y: landmarks[i].y * height,
  });
  if (
    [...indices.upper, ...indices.lower].some(
      (i) =>
        !landmarks[i] ||
        !Number.isFinite(landmarks[i].x) ||
        !Number.isFinite(landmarks[i].y),
    )
  )
    return null;
  const upper = indices.upper.map(pixel),
    lower = indices.lower.map(pixel);
  const midpoint = (a: Point, b: Point) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const inner = midpoint(upper[0], lower[0]),
    outer = midpoint(upper[4], lower[4]);
  const observedLength = distance(inner, outer);
  if (observedLength < width * 0.025) return null;
  const observedAngle = Math.atan2(outer.y - inner.y, outer.x - inner.x);
  const observedAxis = {
    x: Math.cos(observedAngle),
    y: Math.sin(observedAngle),
  };
  const observedNormal = { x: -observedAxis.y, y: observedAxis.x };
  if (observedNormal.y > 0) {
    observedNormal.x *= -1;
    observedNormal.y *= -1;
  }
  const angle = observedAngle + (adjustment.rotation * Math.PI) / 180;
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -axis.y, y: axis.x };
  if (normal.y > 0) {
    normal.x *= -1;
    normal.y *= -1;
  }
  const rawLength = observedLength * profile.length;
  const length = rawLength * clamp(adjustment.width, 0.9, 1.12);
  const brow: Brow = {
    side,
    origin: {
      x:
        inner.x +
        observedLength *
          (profile.offset[0] * observedAxis.x +
            profile.offset[1] * observedNormal.x) +
        rawLength * adjustment.x,
      y:
        inner.y +
        observedLength *
          (profile.offset[0] * observedAxis.y +
            profile.offset[1] * observedNormal.y) -
        rawLength * adjustment.y,
    },
    axis,
    normal,
    length,
    polygon: [],
    sourcePolygon: [
      ...upper.map((p, i) => {
        const edge = i === 0 ? -0.04 : i === 4 ? 0.04 : 0;
        return {
          x:
            p.x +
            observedLength * (observedNormal.x * 0.09 + observedAxis.x * edge),
          y:
            p.y +
            observedLength * (observedNormal.y * 0.09 + observedAxis.y * edge),
        };
      }),
      ...lower
        .reverse()
        .map((p) => ({
          x: p.x - observedNormal.x * observedLength * 0.13,
          y: p.y - observedNormal.y * observedLength * 0.13,
        })),
    ],
  };
  const points = profile.contour;
  // keep the traced outline smooth between points.
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length];
    const b = points[i],
      c = points[(i + 1) % points.length];
    const d = points[(i + 2) % points.length];
    for (let step = 0; step < 4; step++) {
      const t = step / 4;
      const curve = (axis: 0 | 1) =>
        0.5 *
        (2 * b[axis] +
          (-a[axis] + c[axis]) * t +
          (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
          (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t);
      const x = curve(0);
      const y =
        curve(1) * clamp(adjustment.thickness, 0.85, 1.25) +
        Math.sin(Math.PI * clamp(x, 0, 1)) *
          clamp(adjustment.arch, -0.02, 0.035);
      brow.polygon.push(fromBrowLocal({ x, y }, brow));
    }
  }
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
