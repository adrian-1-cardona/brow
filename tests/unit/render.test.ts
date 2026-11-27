import { describe, expect, it } from "vitest";
import {
  applyVerifiedPatches,
  handNearBrows,
  lightLevel,
} from "../../src/lib/render";
import { pointInPolygon } from "../../src/lib/geometry";
import { type Brow, type VerifiedPatch } from "../../src/lib/types";
const brow: Brow = {
  side: "left",
  origin: { x: 20, y: 50 },
  axis: { x: 1, y: 0 },
  normal: { x: 0, y: -1 },
  length: 100,
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
describe("conservative live result rendering", () => {
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
