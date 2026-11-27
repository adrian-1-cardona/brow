import { describe, expect, it } from "vitest";
import {
  BROW_INDICES,
  coverTransform,
  displayToSource,
  fromBrowLocal,
  isProtected,
  LandmarkSmoother,
  makeBrows,
  pointInPolygon,
  polygonDistance,
  sourceToDisplay,
  toBrowLocal,
} from "../../src/lib/geometry";
import { defaultCalibration, type Point } from "../../src/lib/types";

function faceFixture(): Point[] {
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [side, indices] of Object.entries(BROW_INDICES)) {
    indices.top.forEach((idx, i) => {
      face[idx] = {
        x:
          (side === "left" ? 0.57 : 0.43) +
          i * (side === "left" ? 0.045 : -0.045),
        y: 0.35 - Math.sin((i / 4) * Math.PI) * 0.015,
      };
    });
    indices.bottom.forEach((idx, i) => {
      face[idx] = {
        x:
          (side === "left" ? 0.57 : 0.43) +
          i * (side === "left" ? 0.045 : -0.045),
        y: 0.39 - Math.sin((i / 4) * Math.PI) * 0.015,
      };
    });
  }
  return face;
}
describe("face-relative eyebrow geometry", () => {
  it("returns no guidelines until a style is explicitly selected", () =>
    expect(
      makeBrows(faceFixture(), null, defaultCalibration(), 800, 600),
    ).toEqual([]));
  it("rejects missing and degenerate landmarks", () => {
    expect(makeBrows([], "straight", defaultCalibration(), 800, 600)).toEqual(
      [],
    );
    expect(
      makeBrows(
        Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 })),
        "straight",
        defaultCalibration(),
        800,
        600,
      ),
    ).toEqual([]);
  });
  it("makes two unfilled, closed-region polygons with a more lifted soft arch", () => {
    const a = makeBrows(
      faceFixture(),
      "straight",
      defaultCalibration(),
      800,
      600,
    );
    const b = makeBrows(
      faceFixture(),
      "soft-arch",
      defaultCalibration(),
      800,
      600,
    );
    expect(a).toHaveLength(2);
    expect(a[0].polygon).toHaveLength(50);
    const straightPeak = Math.max(
      ...a[0].polygon.map((p) => toBrowLocal(p, a[0]).y),
    );
    const archPeak = Math.max(
      ...b[0].polygon.map((p) => toBrowLocal(p, b[0]).y),
    );
    expect(archPeak).toBeGreaterThan(straightPeak + 0.04);
    expect(
      pointInPolygon(fromBrowLocal({ x: 0.4, y: 0.02 }, a[0]), a[0].polygon),
    ).toBe(true);
  });
  it("moves with translated, scaled and rotated facial landmarks", () => {
    const face = faceFixture(),
      before = makeBrows(face, "straight", defaultCalibration(), 800, 600)[0];
    const moved = face.map((p) => ({ x: p.x + 0.06, y: p.y + 0.1 }));
    const after = makeBrows(
      moved,
      "straight",
      defaultCalibration(),
      800,
      600,
    )[0];
    expect(after.origin.x - before.origin.x).toBeCloseTo(48);
    expect(after.origin.y - before.origin.y).toBeCloseTo(60);
    const larger = makeBrows(
      face,
      "straight",
      defaultCalibration(),
      1600,
      1200,
    )[0];
    expect(larger.length).toBeCloseTo(before.length * 2);
    const local = { x: 0.6, y: -0.17 };
    expect(toBrowLocal(fromBrowLocal(local, before), before).x).toBeCloseTo(
      local.x,
    );
    expect(toBrowLocal(fromBrowLocal(local, before), before).y).toBeCloseTo(
      local.y,
    );
  });
  it("calibrates one brow without changing the other", () => {
    const calibration = defaultCalibration(),
      face = faceFixture();
    const before = makeBrows(face, "straight", calibration, 800, 600);
    calibration.left.y = 0.04;
    calibration.left.rotation = 4;
    const after = makeBrows(face, "straight", calibration, 800, 600);
    expect(after[0].origin.y).toBeLessThan(before[0].origin.y);
    expect(after[1]).toEqual(before[1]);
  });
});

describe("collision detection", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it.each([
    { x: 5, y: 5 },
    { x: 0, y: 5 },
    { x: 10, y: 10 },
  ])("protects interiors and borders: %o", (p) =>
    expect(pointInPolygon(p, polygon)).toBe(true),
  );
  it("measures proximity beyond the polygon and supports a warning margin", () => {
    expect(polygonDistance({ x: 12, y: 5 }, polygon)).toBe(2);
    const brow = makeBrows(
      faceFixture(),
      "straight",
      defaultCalibration(),
      800,
      600,
    )[0];
    const p = fromBrowLocal({ x: 0.4, y: 0 }, brow);
    expect(isProtected(p, [brow], 3)).toBe(true);
    expect(isProtected({ x: 0, y: 0 }, [brow], 3)).toBe(false);
  });
});

describe("camera coordinate transformations", () => {
  it.each([
    [1280, 720, 390, 520],
    [640, 480, 1200, 590],
    [1920, 1080, 768, 1024],
  ])(
    "roundtrips crop, resize and mirroring (%i×%i → %i×%i)",
    (sw, sh, dw, dh) => {
      const p = { x: sw * 0.36, y: sh * 0.57 };
      for (const mirror of [true, false]) {
        const displayed = sourceToDisplay(p, sw, sh, dw, dh, mirror);
        const source = displayToSource(displayed, sw, sh, dw, dh, mirror);
        expect(source.x).toBeCloseTo(p.x);
        expect(source.y).toBeCloseTo(p.y);
      }
    },
  );
  it("uses cover cropping with centered offsets", () =>
    expect(coverTransform(800, 600, 400, 600)).toEqual({
      scale: 1,
      x: -200,
      y: 0,
    }));
});

describe("tracking stabilization", () => {
  it("attenuates jitter and resets immediately after tracking loss", () => {
    const smoother = new LandmarkSmoother();
    smoother.update([{ x: 0.5, y: 0.5 }], 0.8);
    const result = smoother.update([{ x: 0.501, y: 0.5 }], 0.8);
    expect(result[0].x).toBeGreaterThan(0.5);
    expect(result[0].x).toBeLessThan(0.501);
    smoother.update([], 0.8);
    expect(smoother.update([{ x: 0.7, y: 0.2 }], 0.8)[0].x).toBe(0.7);
  });
});
