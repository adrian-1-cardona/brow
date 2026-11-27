import { describe, expect, it } from "vitest";
import {
  EYE_INDICES,
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
  for (const [side, [inner, outer]] of Object.entries(EYE_INDICES)) {
    face[inner] = { x: side === "left" ? 0.57 : 0.43, y: 0.49 };
    face[outer] = { x: side === "left" ? 0.75 : 0.25, y: 0.47 };
  }
  for (const side of ["left", "right"] as const) {
    const direction = side === "left" ? 1 : -1;
    BROW_INDICES[side].upper.forEach((id, i) => {
      const t = i / 4;
      const x = 0.5 + direction * (0.055 + t * 0.22);
      const y = 0.37 + 0.02 * t - 0.035 * Math.sin(Math.PI * t);
      face[id] = { x, y };
      face[BROW_INDICES[side].lower[i]] = { x, y: y + 0.03 };
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
  it("follows the brows when their height changes independently of the eyes", () => {
    const face = faceFixture();
    const before = makeBrows(face, "straight", defaultCalibration(), 800, 600);
    for (const indices of Object.values(BROW_INDICES))
      for (const id of [...indices.upper, ...indices.lower]) face[id].y -= 0.06;
    const after = makeBrows(face, "straight", defaultCalibration(), 800, 600);
    after.forEach((brow, i) => {
      expect(brow.origin.y - before[i].origin.y).toBeCloseTo(-36);
      expect(brow.origin.x).toBeCloseTo(before[i].origin.x);
      expect(brow.sourcePolygon[0].y).toBeCloseTo(
        before[i].sourcePolygon[0].y - 36,
      );
    });
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
      brows: {
        left: {
          upper: [
            [419, 489],
            [475, 489],
            [523, 492],
            [558, 510],
            [575, 534],
          ],
          lower: [
            [406, 519],
            [467, 509],
            [512, 511],
            [542, 524],
            [561, 543],
          ],
        },
        right: {
          upper: [
            [310, 474],
            [257, 458],
            [208, 447],
            [169, 453],
            [144, 471],
          ],
          lower: [
            [314, 507],
            [259, 479],
            [215, 468],
            [181, 471],
            [157, 484],
          ],
        },
      },
      bounds: { left: [393, 580, 481, 543], right: [130, 326, 441, 509] },
    },
    {
      style: "soft-arch" as const,
      width: 721,
      brows: {
        left: {
          upper: [
            [420, 486],
            [475, 485],
            [523, 489],
            [558, 507],
            [575, 532],
          ],
          lower: [
            [407, 517],
            [467, 505],
            [512, 508],
            [542, 521],
            [561, 541],
          ],
        },
        right: {
          upper: [
            [310, 470],
            [256, 452],
            [208, 441],
            [169, 447],
            [143, 467],
          ],
          lower: [
            [314, 503],
            [259, 474],
            [214, 463],
            [181, 467],
            [156, 480],
          ],
        },
      },
      bounds: { left: [393, 579, 477, 543], right: [132, 326, 428, 506] },
    },
  ])(
    "matches the full eyebrow bounds in the $style reference",
    ({ style, width, brows: observed, bounds }) => {
      const face = faceFixture();
      for (const side of ["left", "right"] as const)
        for (const edge of ["upper", "lower"] as const)
          BROW_INDICES[side][edge].forEach((id, i) => {
            face[id] = {
              x: observed[side][edge][i][0] / width,
              y: observed[side][edge][i][1] / 1086,
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
    const p = fromBrowLocal({ x: 0.4, y: 0.1 }, brow);
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
