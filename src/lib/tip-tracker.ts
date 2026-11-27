import type { Point } from "./types";

// drop the marked tip when the match becomes unreliable.
export class TipTracker {
  private template: number[] = [];
  private point: Point | null = null;
  private seededAt = 0;
  private readonly half = 5;
  get active() {
    return this.point !== null;
  }
  clear() {
    this.template = [];
    this.point = null;
  }
  seed(image: ImageData, point: Point, now: number): boolean {
    const patch = this.patch(image, point.x, point.y);
    this.clear();
    if (!patch || deviation(patch) < 14) return false;
    this.template = normalize(patch);
    this.point = { ...point };
    this.seededAt = now;
    return true;
  }
  update(
    image: ImageData,
    now: number,
  ): { point: Point | null; confidence: number } {
    if (!this.point || now - this.seededAt > 12000) {
      this.clear();
      return { point: null, confidence: 0 };
    }
    const matches: { point: Point; score: number }[] = [];
    for (let y = -18; y <= 18; y += 2)
      for (let x = -18; x <= 18; x += 2) {
        const p = {
          x: Math.round(this.point.x + x),
          y: Math.round(this.point.y + y),
        };
        const patch = this.patch(image, p.x, p.y);
        if (!patch || deviation(patch) < 10) continue;
        const normalized = normalize(patch);
        const score =
          normalized.reduce((sum, v, i) => sum + v * this.template[i], 0) /
          normalized.length;
        matches.push({ point: p, score });
      }
    matches.sort((a, b) => b.score - a.score);
    const best = matches[0];
    const rival =
      best &&
      matches.find(
        (m) =>
          Math.hypot(m.point.x - best.point.x, m.point.y - best.point.y) > 8,
      );
    if (
      !best ||
      best.score < 0.88 ||
      (rival && best.score - rival.score < 0.035)
    ) {
      this.clear();
      return { point: null, confidence: best?.score ?? 0 };
    }
    this.point = best.point;
    return { point: best.point, confidence: best.score };
  }
  private patch(image: ImageData, x: number, y: number): number[] | null {
    x = Math.round(x);
    y = Math.round(y);
    if (
      x < this.half ||
      y < this.half ||
      x >= image.width - this.half ||
      y >= image.height - this.half
    )
      return null;
    const values = [];
    for (let dy = -this.half; dy <= this.half; dy++)
      for (let dx = -this.half; dx <= this.half; dx++) {
        const i = ((y + dy) * image.width + x + dx) * 4;
        values.push(
          image.data[i] * 0.299 +
            image.data[i + 1] * 0.587 +
            image.data[i + 2] * 0.114,
        );
      }
    return values;
  }
}
const deviation = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length,
  );
};
const normalize = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length,
    sd = deviation(values);
  return values.map((x) => (x - mean) / Math.max(1, sd));
};
