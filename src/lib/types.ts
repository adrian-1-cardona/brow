export type Point = { x: number; y: number };
export type BrowStyle = "straight" | "soft-arch";
export type BrowSide = "left" | "right";
export type Adjustment = {
  x: number;
  y: number;
  width: number;
  thickness: number;
  arch: number;
  rotation: number;
};
export type Calibration = Record<BrowSide, Adjustment>;
const DEFAULT_ADJUSTMENT: Adjustment = {
  x: 0,
  y: 0,
  width: 1,
  thickness: 1,
  arch: 0,
  rotation: 0,
};
export const defaultCalibration = (): Calibration => ({
  left: { ...DEFAULT_ADJUSTMENT },
  right: { ...DEFAULT_ADJUSTMENT },
});
export type Brow = {
  side: BrowSide;
  polygon: Point[];
  origin: Point;
  axis: Point;
  normal: Point;
  length: number;
};
export type VerifiedPatch = {
  id: string;
  side: BrowSide;
  u: number;
  v: number;
  radius: number;
  verified: boolean;
};
export type TrackingMessage =
  | { type: "ready" }
  | { type: "hands"; status: "ready" | "unavailable" }
  | { type: "error"; message: string }
  | {
      type: "result";
      face: Point[];
      hands: Point[][];
      timestamp: number;
      elapsed: number;
    };
