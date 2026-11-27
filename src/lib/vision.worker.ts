/// <reference lib="webworker" />
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";
import type { Point, TrackingMessage } from "./types";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let face: FaceLandmarker | null = null;
let hands: HandLandmarker | null = null;
let files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let handFailed = false;
let lastHands = 0;
const send = (message: TrackingMessage) => ctx.postMessage(message);
ctx.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  try {
    if (data.type === "init") {
      if (!face) {
        files = await FilesetResolver.forVisionTasks("/vision/wasm");
        face = await FaceLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: "/vision/face_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.65,
          minFacePresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });
      }
      send({ type: "ready" });
    }
    if (data.type === "frame" && face) {
      const start = performance.now();
      const bitmap: ImageBitmap = data.bitmap;
      try {
        const result = face.detectForVideo(bitmap, data.timestamp);
        let handPoints: Point[][] = [];
        if (data.hands && !handFailed && !hands) {
          try {
            hands = await HandLandmarker.createFromOptions(files, {
              baseOptions: {
                modelAssetPath: "/vision/hand_landmarker.task",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.65,
              minTrackingConfidence: 0.65,
            });
            send({ type: "hands", status: "ready" });
          } catch {
            handFailed = true;
            send({ type: "hands", status: "unavailable" });
          }
        }
        if (data.hands && hands && data.timestamp - lastHands > 150) {
          handPoints = hands.detectForVideo(bitmap, data.timestamp).landmarks;
          lastHands = data.timestamp;
        }
        send({
          type: "result",
          face: result.faceLandmarks[0] ?? [],
          hands: handPoints,
          timestamp: data.timestamp,
          elapsed: performance.now() - start,
        });
      } finally {
        bitmap.close();
      }
    }
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Vision tracking could not start.",
    });
  }
};
