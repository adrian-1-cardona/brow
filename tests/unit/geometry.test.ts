import { describe, expect, it } from "vitest";
import {
  EYE_INDICES,
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
  for (const [side, [inner, outer]] of Object.entries(EYE_INDICES)) {
    face[inner] = { x: side === "left" ? 0.57 : 0.43, y: 0.49 };
    face[outer] = { x: side === "left" ? 0.75 : 0.25, y: 0.47 };
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
    expect(a[0].polygon.length).toBeGreaterThan(30);
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

  it.each([
    {
      style: "straight" as const,
      width: 722,
      eyes: {
        left: [
          [412.7, 568.9],
          [510.2, 580.8],
        ],
        right: [
          [291.9, 548.7],
          [193.3, 532.1],
        ],
      },
      bounds: { left: [393, 580, 481, 543], right: [130, 326, 441, 509] },
    },
    {
      style: "soft-arch" as const,
      width: 721,
      eyes: {
        left: [
          [412.7, 568.1],
          [510.2, 580.6],
        ],
        right: [
          [293.4, 548.4],
          [193.7, 532.2],
        ],
      },
      bounds: { left: [393, 579, 477, 543], right: [132, 326, 428, 506] },
    },
  ])(
    "matches the full eyebrow bounds in the $style reference",
    ({ style, width, eyes, bounds }) => {
      const face = faceFixture();
      for (const side of ["left", "right"] as const)
        EYE_INDICES[side].forEach((id, i) => {
          face[id] = {
            x: eyes[side][i][0] / width,
            y: eyes[side][i][1] / 1086,
          };
        });
      const brows = makeBrows(face, style, defaultCalibration(), width, 1086);
      for (const brow of brows) {
        const x = brow.polygon.map((p) => p.x),
          y = brow.polygon.map((p) => p.y);
        const actual = [
          Math.min(...x),
          Math.max(...x),
          Math.min(...y),
          Math.max(...y),
        ];
        actual.forEach((value, i) =>
          expect(Math.abs(value - bounds[brow.side][i])).toBeLessThan(2),
        );
      }
    },
  );

  it("keeps the reference shape aligned when the head rolls", () => {
    const face = faceFixture();
    const rotate = (p: Point) => ({
      x: 400 + (p.x - 400) * Math.cos(0.2) - (p.y - 300) * Math.sin(0.2),
      y: 300 + (p.x - 400) * Math.sin(0.2) + (p.y - 300) * Math.cos(0.2),
    });
    const rolled = face.map((p) => {
      const pixel = rotate({ x: p.x * 800, y: p.y * 600 });
      return { x: pixel.x / 800, y: pixel.y / 600 };
    });
    const before = makeBrows(face, "soft-arch", defaultCalibration(), 800, 600);
    const after = makeBrows(
      rolled,
      "soft-arch",
      defaultCalibration(),
      800,
      600,
    );
    before.forEach((brow, side) =>
      brow.polygon.forEach((point, i) => {
        const expected = rotate(point);
        expect(after[side].polygon[i].x).toBeCloseTo(expected.x);
        expect(after[side].polygon[i].y).toBeCloseTo(expected.y);
      }),
    );
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
