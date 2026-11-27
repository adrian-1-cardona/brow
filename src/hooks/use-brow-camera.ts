"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  displayToSource,
  inBrowRegion,
  isProtected,
  LandmarkSmoother,
  makeBrows,
  toBrowLocal,
} from "@/lib/geometry";
import {
  applyVerifiedPatches,
  drawPatchMarkers,
  handNearBrows,
  lightLevel,
  outline,
} from "@/lib/render";
import { TipTracker } from "@/lib/tip-tracker";
import {
  type Brow,
  type BrowStyle,
  type Calibration,
  type Point,
  type TrackingMessage,
  type VerifiedPatch,
} from "@/lib/types";

export type CameraOptions = {
  style: BrowStyle | null;
  calibration: Calibration;
  stability: number;
  hands: boolean;
  review: boolean;
  brush: number;
  patches: VerifiedPatch[];
  clearPatches: () => void;
  addPatch: (patch: VerifiedPatch) => void;
};
export type CameraStatus =
  "off" | "starting" | "searching" | "tracking" | "dim" | "pose" | "error";

export function useBrowCamera(options: CameraOptions) {
  const originalRef = useRef<HTMLCanvasElement>(null);
  const proposedRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState(false);
  const [handStatus, setHandStatus] = useState("Off");
  const [tipStatus, setTipStatus] = useState(
    "Unavailable · mark the tip to try",
  );
  const [markTip, setMarkTip] = useState(false);
  const [tipAttempted, setTipAttempted] = useState(false);
  const [fps, setFps] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const browsRef = useRef<Brow[]>([]);
  const currentImage = useRef<ImageData | null>(null);
  const tipTracker = useRef(new TipTracker());
  const faceGood = useRef(false);

  const stop = useCallback((update = true) => {
    generation.current++;
    active.current = false;
    cleanupRef.current?.();
    cleanupRef.current = null;
    browsRef.current = [];
    currentImage.current = null;
    faceGood.current = false;
    tipTracker.current.clear();
    for (const canvas of [originalRef.current, proposedRef.current])
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    optionsRef.current.clearPatches();
    if (update) {
      setStatus("off");
      setWarning(false);
      setMarkTip(false);
      setTipAttempted(false);
      setHandStatus("Off");
      setTipStatus("Unavailable · mark the tip to try");
    }
  }, []);

  const start = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    const token = ++generation.current;
    setStatus("starting");
    setError("");
    let stream: MediaStream | null = null,
      video: HTMLVideoElement | null = null,
      worker: Worker | null = null,
      raf = 0;
    let cancelled = false,
      initTimeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      cancelled = true;
      clearTimeout(initTimeout);
      cancelAnimationFrame(raf);
      worker?.terminate();
      stream?.getTracks().forEach((track) => track.stop());
      if (video) {
        video.pause();
        video.srcObject = null;
        video.remove();
      }
    };
    cleanupRef.current = cleanup;
    const fail = (message: string) => {
      cleanup();
      active.current = false;
      browsRef.current = [];
      faceGood.current = false;
      currentImage.current = null;
      tipTracker.current.clear();
      for (const canvas of [originalRef.current, proposedRef.current])
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      optionsRef.current.clearPatches();
      setWarning(false);
      setStatus("error");
      setError(message);
    };
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS or localhost. Open this app in Safari or Chrome over a secure connection.",
        );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (token !== generation.current) {
        cleanup();
        return;
      }
      video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-hidden", "true");
      video.className = "camera-source";
      document.body.appendChild(video);
      video.srcObject = stream;
      await video.play();
      if (token !== generation.current) {
        cleanup();
        return;
      }
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (!cancelled)
          fail("The camera disconnected. Reconnect it and try again.");
      });
      stream.getVideoTracks()[0].addEventListener("mute", () => {
        if (!cancelled)
          fail(
            "The camera was interrupted. Enable it again when it is available.",
          );
      });
      const maxWidth = window.matchMedia("(max-width: 768px)").matches
        ? 640
        : 960;
      const frame = document.createElement("canvas");
      frame.width = Math.min(video.videoWidth, maxWidth);
      frame.height = Math.round(
        (frame.width * video.videoHeight) / video.videoWidth,
      );
      const context = frame.getContext("2d", { willReadFrequently: true });
      const original = originalRef.current,
        proposed = proposedRef.current;
      if (!context || !original || !proposed)
        throw new Error("This browser could not create the camera preview.");
      for (const canvas of [original, proposed]) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      const originalCtx = original.getContext("2d"),
        proposedCtx = proposed.getContext("2d");
      if (!originalCtx || !proposedCtx)
        throw new Error("Canvas rendering is unavailable.");
      // MediaPipe's Wasm loader uses importScripts; serve a bundled classic worker.
      worker = new Worker("/vision/worker.js");
      const smoother = new LandmarkSmoother();
      let ready = false,
        busy = false,
        face: Point[] = [],
        hands: Point[][] = [],
        faceTime = 0,
        handTime = 0;
      let goodFrames = 0,
        lastSubmit = 0,
        lastVideoTime = -1,
        lastLight = 0,
        light = 100,
        lastUi = 0,
        elapsed = 60,
        lastTip = 0;
      let tip: Point | null = null,
        tipConfidence = 0,
        trackingWasGood = false;
      const base = window.location.origin;
      worker.onmessage = (event: MessageEvent<TrackingMessage>) => {
        if (cancelled) return;
        const message = event.data;
        if (message.type === "ready") {
          clearTimeout(initTimeout);
          ready = true;
          setStatus("searching");
        }
        if (message.type === "hands")
          setHandStatus(
            message.status === "ready"
              ? "Searching for hands"
              : "Unavailable on this browser",
          );
        if (message.type === "error") {
          fail(
            "Face tracking is unavailable. Try a current Safari or Chrome browser, then restart the camera. " +
              message.message,
          );
          return;
        }
        if (message.type === "result") {
          busy = false;
          elapsed = message.elapsed;
          // A result delayed by model initialization cannot authorize overlays or edits.
          if (performance.now() - message.timestamp > 350) {
            face = [];
            goodFrames = 0;
            return;
          }
          face = smoother.update(message.face, optionsRef.current.stability);
          faceTime = message.timestamp;
          goodFrames = face.length ? goodFrames + 1 : 0;
          if (!face.length) smoother.reset();
          if (message.hands.length) {
            hands = message.hands;
            handTime = performance.now();
          }
        }
      };
      worker.onerror = () =>
        fail(
          "Tracking could not load in this browser. Check that the local vision files are installed and try again.",
        );
      worker.postMessage({ type: "init", base });
      initTimeout = setTimeout(() => {
        if (!cancelled && !ready)
          fail(
            "Local face tracking took too long to start. Reload the app online once, then try again.",
          );
      }, 45000);
      const draw = (now: number) => {
        if (cancelled || !video || !worker) return;
        raf = requestAnimationFrame(draw);
        if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        const nextWidth = Math.min(video.videoWidth, maxWidth);
        const nextHeight = Math.round(
          (nextWidth * video.videoHeight) / video.videoWidth,
        );
        if (
          nextWidth &&
          nextHeight &&
          (frame.width !== nextWidth || frame.height !== nextHeight)
        ) {
          frame.width = nextWidth;
          frame.height = nextHeight;
          for (const canvas of [original, proposed]) {
            canvas.width = nextWidth;
            canvas.height = nextHeight;
          }
          face = [];
          goodFrames = 0;
          smoother.reset();
          optionsRef.current.clearPatches();
          tipTracker.current.clear();
          tip = null;
        }
        context.drawImage(video, 0, 0, frame.width, frame.height);
        const settings = optionsRef.current;
        let pixels: ImageData | null = null;
        const getPixels = () =>
          (pixels ??= context.getImageData(0, 0, frame.width, frame.height));
        if (now - lastLight > 700) {
          light = lightLevel(getPixels());
          lastLight = now;
        }
        const fresh =
          ready && face.length > 0 && now - faceTime < 280 && goodFrames >= 4;
        // Large head turns make a two-dimensional brow guide unreliable.
        const leftEye =
          face[362] && face[263] ? Math.abs(face[362].x - face[263].x) : 0;
        const rightEye =
          face[133] && face[33] ? Math.abs(face[133].x - face[33].x) : 0;
        const frontFacing =
          leftEye > 0 &&
          rightEye > 0 &&
          Math.max(leftEye, rightEye) / Math.min(leftEye, rightEye) < 1.85;
        const safe = fresh && light >= 42 && frontFacing;
        faceGood.current = safe;
        if (!safe && trackingWasGood) {
          settings.clearPatches();
          tipTracker.current.clear();
          tip = null;
        }
        trackingWasGood = safe;
        const brows = safe
          ? makeBrows(
              face,
              settings.style,
              settings.calibration,
              frame.width,
              frame.height,
            )
          : [];
        browsRef.current = brows;
        originalCtx.drawImage(frame, 0, 0);
        proposedCtx.drawImage(frame, 0, 0);
        if (safe && settings.patches.some((p) => p.verified)) {
          const image = context.getImageData(0, 0, frame.width, frame.height);
          proposedCtx.putImageData(
            applyVerifiedPatches(image, brows, settings.patches),
            0,
            0,
          );
        }
        if (now - lastTip > 85) currentImage.current = getPixels();
        outline(originalCtx, brows, Math.max(1.25, frame.width / 720));
        if (settings.review)
          drawPatchMarkers(originalCtx, brows, settings.patches);
        if (now - lastTip > 85) {
          const result = tipTracker.current.update(getPixels(), now);
          tip = result.point;
          tipConfidence = result.confidence;
          lastTip = now;
        }
        if (tip && safe) {
          originalCtx.beginPath();
          originalCtx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
          originalCtx.strokeStyle = "#fff";
          originalCtx.lineWidth = 1.5;
          originalCtx.stroke();
        }
        const handFresh = settings.hands && now - handTime < 250;
        const near =
          safe &&
          brows.length > 0 &&
          ((tip !== null && isProtected(tip, brows, frame.width * 0.008)) ||
            (handFresh &&
              handNearBrows(hands, brows, frame.width, frame.height)));
        if (now - lastUi > 220) {
          setWarning(Boolean(near));
          setFps(Math.round(1000 / Math.max(elapsed, 65)));
          setStatus(
            !ready
              ? "starting"
              : light < 42
                ? "dim"
                : fresh && !frontFacing
                  ? "pose"
                  : safe
                    ? "tracking"
                    : "searching",
          );
          if (settings.hands)
            setHandStatus((previous) =>
              previous.includes("Unavailable")
                ? previous
                : handFresh
                  ? "Hand detected · experimental"
                  : "No hand detected · experimental",
            );
          setTipStatus(
            tip
              ? `Assisted tip · ${Math.round(tipConfidence * 100)}% match · experimental`
              : "Unavailable / unreliable · mark the tip again",
          );
          lastUi = now;
        }
        const interval = Math.max(settings.hands ? 95 : 65, elapsed * 1.35);
        if (ready && !busy && now - lastSubmit >= interval) {
          busy = true;
          lastSubmit = now;
          createImageBitmap(frame)
            .then((bitmap) => {
              if (cancelled) {
                bitmap.close();
                return;
              }
              worker?.postMessage(
                {
                  type: "frame",
                  bitmap,
                  timestamp: now,
                  hands: settings.hands,
                  base,
                },
                [bitmap],
              );
            })
            .catch(() => {
              busy = false;
              fail(
                "This browser cannot send camera frames to the local tracker.",
              );
            });
        }
      };
      raf = requestAnimationFrame(draw);
    } catch (err) {
      if (token !== generation.current) {
        cleanup();
        return;
      }
      const name = err instanceof Error ? err.name : "";
      fail(
        name === "NotAllowedError"
          ? "Camera access was denied. Allow camera access in your browser’s site settings, then try again."
          : name === "NotFoundError"
            ? "No camera was found. Connect a camera and try again."
            : name === "NotReadableError"
              ? "The camera is in use by another app. Close that app and try again."
              : err instanceof Error
                ? err.message
                : "The camera could not start.",
      );
    }
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.hidden && active.current) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      stop(false);
    };
  }, [stop]);

  const selectPoint = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const canvas = originalRef.current;
      if (!canvas || !faceGood.current) return "Wait for stable face tracking.";
      const p = displayToSource(
        { x: clientX - rect.left, y: clientY - rect.top },
        canvas.width,
        canvas.height,
        rect.width,
        rect.height,
      );
      if (markTip) {
        setTipAttempted(true);
        setMarkTip(false);
        if (
          !currentImage.current ||
          !tipTracker.current.seed(currentImage.current, p, performance.now())
        )
          return "The tip has too little visual detail. Try brighter light and mark it again.";
        return "Tip marked. Assisted tracking can lose small or reflective tools; verify its position yourself.";
      }
      const settings = optionsRef.current;
      if (!settings.review) return "";
      if (isProtected(p, browsRef.current, 3))
        return "This area is protected. Stay outside the red outline.";
      const brow = browsRef.current.find((b) => inBrowRegion(p, b));
      if (!brow)
        return "Mark only a stray area immediately next to an eyebrow.";
      if (settings.patches.length >= 30)
        return "Review or clear the existing marks first (30 maximum).";
      const local = toBrowLocal(p, brow);
      settings.addPatch({
        id: crypto.randomUUID(),
        side: brow.side,
        u: local.x,
        v: local.y,
        radius: settings.brush,
        verified: false,
      });
      return "Mark added. Inspect it closely, then verify before applying to the live preview.";
    },
    [markTip],
  );

  return {
    originalRef,
    proposedRef,
    status,
    error,
    warning,
    handStatus,
    tipStatus,
    markTip,
    setMarkTip,
    tipAttempted,
    fps,
    start,
    stop,
    selectPoint,
  };
}
