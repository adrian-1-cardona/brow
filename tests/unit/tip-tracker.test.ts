import { describe, expect, it } from "vitest";
import { TipTracker } from "../../src/lib/tip-tracker";
function texture(dx = 0, dy = 0) {
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 100; x++) {
      const value = (((x - dx) * 73856093) ^ ((y - dy) * 19349663)) % 256;
      data.set(
        [Math.abs(value), Math.abs(value), Math.abs(value), 255],
        (y * 100 + x) * 4,
      );
    }
  return { data, width: 100, height: 100 } as ImageData;
}
describe("experimental assisted tip tracking", () => {
  it("follows a distinct user-selected patch under translation", () => {
    const tracker = new TipTracker();
    expect(tracker.seed(texture(), { x: 50, y: 50 }, 0)).toBe(true);
    const result = tracker.update(texture(4, 2), 100);
    expect(result.point).toEqual({ x: 54, y: 52 });
    expect(result.confidence).toBeGreaterThan(0.95);
  });
  it("rejects flat texture and clears expired or occluded targets", () => {
    const tracker = new TipTracker(),
      flat = {
        data: new Uint8ClampedArray(100 * 100 * 4),
        width: 100,
        height: 100,
      } as ImageData;
    expect(tracker.seed(flat, { x: 50, y: 50 }, 0)).toBe(false);
    tracker.seed(texture(), { x: 50, y: 50 }, 0);
    expect(tracker.update(flat, 100).point).toBeNull();
    tracker.seed(texture(), { x: 50, y: 50 }, 0);
    expect(tracker.update(texture(), 12001).point).toBeNull();
    expect(tracker.seed(texture(), { x: 1, y: 1 }, 0)).toBe(false);
  });
});
