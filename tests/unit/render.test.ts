import { describe, expect, it } from "vitest";
import {
  applyVerifiedPatches,
  applyStylePreview,
  handNearBrows,
  lightLevel,
} from "../../src/lib/render";
import { pointInPolygon, isProtected } from "../../src/lib/geometry";
import { type Brow, type VerifiedPatch } from "../../src/lib/types";
const brow: Brow = {
  side: "left",
  origin: { x: 20, y: 50 },
  axis: { x: 1, y: 0 },
  normal: { x: 0, y: -1 },
  length: 100,
  sourcePolygon: [
    { x: 20, y: 38 },
    { x: 120, y: 38 },
    { x: 120, y: 69 },
    { x: 20, y: 69 },
  ],
  polygon: [
    { x: 20, y: 45 },
    { x: 120, y: 45 },
    { x: 120, y: 55 },
    { x: 20, y: 55 },
  ],
};
function imageFixture() {
  const image = {
    width: 160,
    height: 100,
    data: new Uint8ClampedArray(160 * 100 * 4),
  } as ImageData;
  for (let i = 0; i < image.data.length; i += 4)
    image.data.set([180, 140, 110, 255], i);
  for (let y = 47; y < 67; y++)
    for (let x = 55; x < 65; x++)
      image.data.set([25, 20, 15, 255], (y * 160 + x) * 4);
  return image;
}
const patch: VerifiedPatch = {
  id: "test",
  side: "left",
  u: 0.4,
  v: -0.12,
  radius: 0.045,
  verified: true,
};
describe("automatic virtual trim", () => {
  it("changes live hair pixels without manual marks and preserves protected and non-brow pixels", () => {
    const image = imageFixture(),
      before = new Uint8ClampedArray(image.data);
    const result = applyStylePreview(image, [brow]);
    expect(result.obstructed).toBe(false);
    expect(result.changed).toBeGreaterThan(40);
    let changed = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (before[i] !== image.data[i]) {
          changed++;
          expect(isProtected({ x, y }, [brow], 0.8)).toBe(false);
          expect(pointInPolygon({ x, y }, brow.sourcePolygon)).toBe(true);
          expect(before[i]).toBe(25);
        }
        expect(image.data[i + 3]).toBe(before[i + 3]);
      }
    expect(result.changed).toBe(changed);
  });
  it("uses the current frame and changes the trim when the target outline changes", () => {
    const a = imageFixture(),
      b = imageFixture();
    const thicker = {
      ...brow,
      polygon: brow.polygon.map((p) => ({
        x: p.x,
        y: p.y > 50 ? p.y + 6 : p.y,
      })),
    };
    expect(applyStylePreview(a, [brow]).changed).toBeGreaterThan(
      applyStylePreview(b, [thicker]).changed,
    );
    const fresh = imageFixture();
    for (let i = 0; i < fresh.data.length; i += 4)
      fresh.data.set([110, 90, 75], i);
    const before = new Uint8ClampedArray(fresh.data);
    expect(applyStylePreview(fresh, [brow])).toEqual({
      changed: 0,
      obstructed: false,
    });
    expect(fresh.data).toEqual(before);
  });
  it("uses the shaded skin beneath the brow for lower-edge edits", () => {
    const image = imageFixture();
    for (let y = 69; y < image.height; y++)
      for (let x = 30; x < 130; x++)
        image.data.set([105, 80, 65, 255], (y * image.width + x) * 4);
    expect(applyStylePreview(image, [brow]).obstructed).toBe(false);
    const red = image.data[(65 * image.width + 60) * 4];
    expect(red).toBeGreaterThan(65);
    expect(red).toBeLessThanOrEqual(105);
  });
  it("fades edits at a sloped natural-brow edge instead of ending in a cutout line", () => {
    const image = imageFixture();
    const sloped = {
      ...brow,
      sourcePolygon: [
        { x: 20, y: 38 },
        { x: 120, y: 38 },
        { x: 120, y: 80 },
        { x: 20, y: 64 },
      ],
    };
    for (let y = 56; y < 80; y++)
      for (let x = 30; x < 110; x++)
        if (pointInPolygon({ x, y }, sloped.sourcePolygon))
          image.data.set([25, 20, 15, 255], (y * image.width + x) * 4);
    const before = new Uint8ClampedArray(image.data);
    applyStylePreview(image, [sloped]);
    const change = (y: number) => {
      const i = (y * image.width + 60) * 4;
      return image.data[i] - before[i];
    };
    expect(change(60)).toBeGreaterThan(70);
    expect(change(70)).toBeLessThan(35);
    expect(change(71)).toBe(0);
  });
  it("continues the local skin shadow instead of copying a bright band across dark hair", () => {
    const image = imageFixture();
    for (let y = 69; y < image.height; y++)
      for (let x = 30; x < 130; x++) {
        const red = 110 + (y - 69) * 2;
        image.data.set([red, red - 25, red - 40, 255], (y * image.width + x) * 4);
      }
    applyStylePreview(image, [brow]);
    const red = image.data[(60 * image.width + 60) * 4];
    expect(red).toBeGreaterThan(75);
    expect(red).toBeLessThan(110);
  });
  it("preserves both protected outlines with fractional and rotated borders", () => {
    const image = imageFixture();
    const tilted = {
      ...brow,
      polygon: brow.polygon.map((p) => ({ x: p.x + 0.3, y: p.y + p.x * 0.023 })),
    };
    const other = { ...brow, side: "right" as const,
      polygon: [{ x: 56.1, y: 58.2 }, { x: 61.3, y: 57.8 }, { x: 63.7, y: 64.6 }],
    };
    const before = new Uint8ClampedArray(image.data);
    applyStylePreview(image, [tilted, other]);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (isProtected({ x, y }, [tilted, other])) {
          const i = (y * image.width + x) * 4;
          expect(image.data.slice(i, i + 4)).toEqual(before.slice(i, i + 4));
        }
  });
  it("pauses without changing the frame when a dark obstruction crosses beneath the brow", () => {
    const image = imageFixture();
    for (let y = 69; y < 90; y++)
      for (let x = 0; x < 20; x++)
        image.data.set([20, 18, 15, 255], (y * 160 + x) * 4);
    const before = new Uint8ClampedArray(image.data);
    expect(applyStylePreview(image, [brow])).toEqual({
      changed: 0,
      obstructed: true,
    });
    expect(image.data).toEqual(before);
  });
});

describe("optional verified touch-ups", () => {
  it("leaves the entire frame untouched without manual verification", () => {
    const image = imageFixture(),
      before = new Uint8ClampedArray(image.data);
    applyVerifiedPatches(image, [brow], [{ ...patch, verified: false }]);
    expect(image.data).toEqual(before);
  });
  it("changes verified dark pixels and preserves every pixel inside the outline and outside the reviewed disc", () => {
    const image = imageFixture(),
      before = new Uint8ClampedArray(image.data);
    applyVerifiedPatches(image, [brow], [patch]);
    let changed = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        const differs = before[i] !== image.data[i];
        if (differs) {
          changed++;
          expect(pointInPolygon({ x, y }, brow.polygon)).toBe(false);
          expect(Math.hypot(x - 60, y - 62)).toBeLessThan(4.5);
        }
        expect(image.data[i + 3]).toBe(before[i + 3]);
      }
    expect(changed).toBeGreaterThan(0);
  });
  it("preserves protected pixels even if an approved patch moves across the boundary", () => {
    const image = imageFixture(),
      before = new Uint8ClampedArray(image.data);
    applyVerifiedPatches(image, [brow], [{ ...patch, v: 0, radius: 0.04 }]);
    expect(image.data).toEqual(before);
  });
  it("rejects edits outside the eyebrow envelope", () => {
    const image = imageFixture(),
      before = new Uint8ClampedArray(image.data);
    applyVerifiedPatches(image, [brow], [{ ...patch, v: -0.6 }]);
    expect(image.data).toEqual(before);
  });
  it("detects only nearby hand fingertips", () => {
    const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    hand[8] = { x: 0.4, y: 0.5 };
    expect(handNearBrows([hand], [brow], 160, 100)).toBe(true);
    expect(handNearBrows([hand], [], 160, 100)).toBe(false);
    expect(lightLevel(imageFixture())).toBeGreaterThan(42);
  });
});
