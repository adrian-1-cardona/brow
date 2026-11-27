"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  Eye,
  FlipHorizontal2,
  GripVertical,
  RotateCcw,
  ScanFace,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useBrowCamera } from "@/hooks/use-brow-camera";
import { clamp } from "@/lib/geometry";
import {
  type Adjustment,
  type BrowSide,
  type BrowStyle,
  type Calibration,
  type VerifiedPatch,
  defaultCalibration,
} from "@/lib/types";
import Modal from "./modal";

function BrowGlyph({ arch = false }: { arch?: boolean }) {
  return (
    <svg viewBox="0 0 64 24" fill="none" aria-hidden="true">
      <path
        d={
          arch
            ? "M4 17Q22 1 39 8Q49 11 60 18Q45 12 35 12Q20 9 4 20Z"
            : "M4 12Q28 7 43 10L60 17Q40 13 23 14L4 18Z"
        }
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const statusCopy = {
  off: "Camera is off",
  starting: "Preparing your mirror…",
  searching: "Looking for your face…",
  tracking: "Face tracking active",
  dim: "More light needed",
  pose: "Look straight ahead",
  error: "Camera needs attention",
};

export default function BrowStudio() {
  const [style, setStyle] = useState<BrowStyle | null>(null);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calibration, setCalibration] =
    useState<Calibration>(defaultCalibration);
  const [calibrationSide, setCalibrationSide] = useState<BrowSide | "both">(
    "both",
  );
  const [stability, setStability] = useState(0.65);
  const [hands, setHands] = useState(false);
  const [review, setReview] = useState(false);
  const [brush, setBrush] = useState(0.025);
  const [patches, setPatches] = useState<VerifiedPatch[]>([]);
  const [notice, setNotice] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const clearPatches = useCallback(() => setPatches([]), []);
  const addPatch = useCallback(
    (patch: VerifiedPatch) => setPatches((old) => [...old, patch]),
    [],
  );
  const { originalRef, proposedRef, ...camera } = useBrowCamera({
    style,
    calibration,
    stability,
    hands,
    review,
    brush,
    patches,
    clearPatches,
    addPatch,
  });
  const live = camera.status !== "off" && camera.status !== "error";
  const tracked = camera.status === "tracking";
  const verified = patches.filter((p) => p.verified).length;
  const pending = patches.length - verified;

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const chooseStyle = (next: BrowStyle) => {
    setStyle((current) => (current === next ? null : next));
    setPatches([]);
    setReview(false);
    setCompare(false);
  };
  const adjust = (key: keyof Adjustment, value: number) => {
    setCalibration((old) => {
      const updated = { ...old };
      for (const side of ["left", "right"] as const)
        if (calibrationSide === "both" || calibrationSide === side)
          updated[side] = { ...old[side], [key]: value };
      return updated;
    });
    setPatches([]);
  };
  const selectedAdjustment =
    calibration[calibrationSide === "both" ? "left" : calibrationSide];
  const updateSplit = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect)
      setSplit(clamp(((clientX - rect.left) / rect.width) * 100, 8, 92));
  };
  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!review && !camera.markTip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (compare && ((event.clientX - rect.left) / rect.width) * 100 > split) {
      setNotice(
        "Mark areas on the Live mirror side, or close the comparison for more room.",
      );
      return;
    }
    const message = camera.selectPoint(event.clientX, event.clientY, rect);
    if (message) setNotice(message);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <h1 className="brand">
          <BrowGlyph /> Brow Studio
        </h1>
        <div className="header-actions">
          <div className="tracking-status" role="status">
            <span className={tracked ? "status-dot on" : "status-dot"} />
            {statusCopy[camera.status]}
          </div>
          {live && (
            <button
              className="icon-button"
              aria-label="Stop camera"
              onClick={() => {
                camera.stop();
                setCompare(false);
                setReview(false);
              }}
            >
              <Square size={12} fill="currentColor" />
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <main>
        <section className="studio" aria-label="Live eyebrow studio">
          <div
            ref={stageRef}
            className={`camera-stage ${review || camera.markTip ? "marking" : ""} ${camera.warning ? "warning-active" : ""}`}
            onClick={onStageClick}
            data-testid="camera-stage"
          >
            <canvas
              ref={originalRef}
              className="camera-canvas"
              aria-label="Live mirrored camera with protected eyebrow outlines"
              data-testid="original-canvas"
            />
            <div
              className="proposed-layer"
              style={{
                clipPath: `inset(0 0 0 ${split}%)`,
                visibility: compare ? "visible" : "hidden",
              }}
            >
              <canvas
                ref={proposedRef}
                className="camera-canvas"
                aria-label="Synchronized live proposed result, only verified eyebrow areas modified"
                data-testid="proposed-canvas"
              />
            </div>

            {compare && live && (
              <div className="view-labels">
                <span>Live mirror</span>
                <span>Proposed · {verified} verified</span>
              </div>
            )}
            {!live && (
              <div className="camera-empty">
                {camera.error && <p>{camera.error}</p>}
                <button className="button light" onClick={() => camera.start()}>
                  <Camera size={17} />
                  {camera.status === "error"
                    ? "Try camera again"
                    : "Enable camera"}
                </button>
              </div>
            )}

            {live && camera.status !== "tracking" && (
              <div className="tracking-hint">
                <ScanFace size={22} strokeWidth={1.5} />
                <span>
                  {camera.status === "dim"
                    ? "Move toward soft, even light."
                    : camera.status === "pose"
                      ? "Face the camera for a reliable outline."
                      : camera.status === "starting"
                        ? "Loading on-device face tracking…"
                        : "Center your face and hold still for a moment."}
                </span>
                <small>
                  Guides and preview edits pause until tracking is stable.
                </small>
              </div>
            )}

            {camera.warning && (
              <div className="proximity-warning" role="alert">
                <ShieldCheck size={19} />
                Stay outside the red outline.
              </div>
            )}
            {live && (camera.tipAttempted || hands) && (
              <div className="tool-status" role="status">
                {camera.tipAttempted ? camera.tipStatus : camera.handStatus}
              </div>
            )}
            {live && !style && (
              <div className="stage-prompt">Choose a shape below.</div>
            )}
            {live && style && !review && !camera.markTip && (
              <div className="stage-note">
                <ShieldCheck size={14} /> Everything inside the red outline
                stays.
              </div>
            )}
            {(review || camera.markTip) && live && (
              <div className="review-instruction">
                <span className="live-dot active" />
                {camera.markTip
                  ? "Tap the visible tweezer tip to begin assisted tracking"
                  : "Tap a stray area outside the red outline to mark it for review"}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReview(false);
                    camera.setMarkTip(false);
                  }}
                  aria-label="Exit marking"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {compare && (
              <>
                <div className="split-line" style={{ left: `${split}%` }} />
                <div
                  className="split-handle"
                  style={{ left: `${split}%` }}
                  role="slider"
                  tabIndex={0}
                  aria-label="Live and proposed comparison divider"
                  aria-valuemin={8}
                  aria-valuemax={92}
                  aria-valuenow={Math.round(split)}
                  aria-orientation="horizontal"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateSplit(e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      updateSplit(e.clientX);
                  }}
                  onPointerUp={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      setSplit((old) =>
                        e.key === "Home"
                          ? 8
                          : e.key === "End"
                            ? 92
                            : clamp(
                                old + (e.key === "ArrowLeft" ? -2 : 2),
                                8,
                                92,
                              ),
                      );
                    }
                  }}
                >
                  <GripVertical size={17} />
                </div>
                <button
                  className="close-compare"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCompare(false);
                  }}
                  aria-label="Close proposed result"
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>

          <div className="studio-controls">
            <div
              className="shape-options"
              role="group"
              aria-label="Eyebrow style"
            >
              <button
                className={`shape-option ${style === "straight" ? "selected" : ""}`}
                aria-pressed={style === "straight"}
                onClick={() => chooseStyle("straight")}
              >
                <BrowGlyph />
                <span>
                  Straight <small>Recommended</small>
                </span>
                {style === "straight" && <Check size={15} />}
              </button>
              <button
                className={`shape-option ${style === "soft-arch" ? "selected" : ""}`}
                aria-pressed={style === "soft-arch"}
                onClick={() => chooseStyle("soft-arch")}
              >
                <BrowGlyph arch />
                <span>Soft Arch</span>
                {style === "soft-arch" && <Check size={15} />}
              </button>
            </div>
            <button
              className="button compare-button"
              disabled={!style || !live}
              onClick={() => {
                setCompare(!compare);
                setReview(false);
                camera.setMarkTip(false);
              }}
            >
              <FlipHorizontal2 size={17} />
              {compare ? "Close comparison" : "View proposed result"}
            </button>
          </div>
        </section>
      </main>

      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        drawer
      >
        <div className="settings-section">
          <div className="section-label">
            <ScanFace size={16} />
            <h3>Calibrate your outline</h3>
          </div>
          <p>
            Changes follow your tracked face. They clear reviewed areas so you
            can verify again.
          </p>
          <div
            className="segmented"
            role="group"
            aria-label="Brow to calibrate"
          >
            {(["both", "left", "right"] as const).map((side) => (
              <button
                key={side}
                aria-pressed={calibrationSide === side}
                onClick={() => setCalibrationSide(side)}
              >
                {side === "both"
                  ? "Both brows"
                  : `${side === "left" ? "Left" : "Right"} brow`}
              </button>
            ))}
          </div>
          {(
            [
              ["x", "Horizontal position", -0.08, 0.08, 0.005],
              ["y", "Vertical position", -0.08, 0.08, 0.005],
              ["width", "Length", 0.9, 1.12, 0.01],
              ["thickness", "Thickness", 0.85, 1.25, 0.01],
              ["arch", "Arch lift", -0.02, 0.035, 0.0025],
              ["rotation", "Angle", -8, 8, 0.5],
            ] as [keyof Adjustment, string, number, number, number][]
          ).map(([key, label, min, max, step]) => (
            <label className="range-label" key={key}>
              <span>
                {label}
                <output>
                  {key === "rotation"
                    ? `${selectedAdjustment[key]}°`
                    : `${Math.round(selectedAdjustment[key] * 100)}%`}
                </output>
              </span>
              <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={selectedAdjustment[key]}
                onChange={(e) => adjust(key, Number(e.target.value))}
                disabled={!style}
              />
            </label>
          ))}
          {!style && <small>Choose a style to enable calibration.</small>}
          <button
            className="text-button"
            onClick={() => {
              setCalibration(defaultCalibration());
              setPatches([]);
            }}
          >
            <RotateCcw size={13} />
            Reset calibration
          </button>
        </div>

        <div className="settings-section">
          <div className="section-label">
            <Eye size={16} />
            <h3>Review stray areas</h3>
            <span className="beta-tag">MANUAL</span>
          </div>
          <p>
            Mark a small area outside the outline on the live mirror. Inspect
            each mark, then verify it. The preview gently reduces dark pixels in
            verified areas only.
          </p>
          <label className="range-label">
            <span>
              Review brush size
              <output>{Math.round(brush * 1000) / 10}% of brow</output>
            </span>
            <input
              type="range"
              min={0.012}
              max={0.04}
              step={0.002}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
          </label>
          <button
            className="button dark full"
            disabled={!style || !live}
            onClick={() => {
              setReview(true);
              setCompare(false);
              camera.setMarkTip(false);
              setSettingsOpen(false);
            }}
          >
            <Eye size={16} />
            Mark areas on live mirror
            <ArrowRight size={15} />
          </button>
          {patches.length > 0 && (
            <div className="review-list">
              {patches.map((patch, i) => (
                <div key={patch.id}>
                  <span>
                    {patch.side === "left" ? "Left" : "Right"} brow · area{" "}
                    {i + 1}
                  </span>
                  <label className="verify-box">
                    <input
                      type="checkbox"
                      checked={patch.verified}
                      onChange={(e) =>
                        setPatches((old) =>
                          old.map((p) =>
                            p.id === patch.id
                              ? { ...p, verified: e.target.checked }
                              : p,
                          ),
                        )
                      }
                    />
                    {patch.verified ? "Verified" : "I checked this area"}
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`Remove area ${i + 1}`}
                    onClick={() =>
                      setPatches((old) => old.filter((p) => p.id !== patch.id))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {patches.length > 0 && (
            <div className="review-actions">
              <button
                className="text-button"
                onClick={() => {
                  setReview(true);
                  setCompare(false);
                  setSettingsOpen(false);
                }}
              >
                Inspect marks
              </button>
              <button className="text-button" onClick={clearPatches}>
                Clear all
              </button>
            </div>
          )}
          {verified > 0 && (
            <button
              className="button dark full"
              onClick={() => {
                setCompare(true);
                setReview(false);
                setSettingsOpen(false);
              }}
            >
              View {verified} verified {verified === 1 ? "area" : "areas"}
              <ArrowRight size={15} />
            </button>
          )}
          <small>
            {pending > 0
              ? `${pending} unverified areas remain unchanged. `
              : ""}
            Marks reset after tracking loss, calibration changes, a style
            change, or stopping the camera.
          </small>
        </div>

        <div className="settings-section">
          <div className="section-label">
            <Settings2 size={16} />
            <h3>Tracking & performance</h3>
          </div>
          <label className="range-label">
            <span>
              Outline stabilization
              <output>{Math.round(stability * 100)}%</output>
            </span>
            <input
              type="range"
              min={0.25}
              max={0.82}
              step={0.01}
              value={stability}
              onChange={(e) => setStability(Number(e.target.value))}
            />
          </label>
          <p>
            Higher values reduce jitter, with a little more delay. Keep your
            head still when checking a hair.
          </p>
        </div>

        <div className="settings-section">
          <div className="section-label">
            <ShieldCheck size={16} />
            <h3>Proximity warnings</h3>
            <span className="beta-tag">EXPERIMENTAL</span>
          </div>
          <p>
            Two-dimensional estimates can miss a tool, finger or depth. Always
            verify visually.
          </p>
          <label className="toggle-row">
            <span>
              Detect nearby fingertips
              <small>
                {hands
                  ? camera.handStatus
                  : "Optional · uses additional processing"}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={hands}
              onChange={(e) => setHands(e.target.checked)}
            />
          </label>
          <div className="tip-status">
            <strong>Assisted tweezer tip</strong>
            <span>
              {live ? camera.tipStatus : "Unavailable · camera is off"}
            </span>
            <p>
              No automatic tweezer recognition. Mark the visible tip to try
              short-lived visual tracking; reflective tools and fast motion are
              unreliable.
            </p>
            <button
              className="button full"
              disabled={!style || !live}
              onClick={() => {
                camera.setMarkTip(true);
                setReview(false);
                setCompare(false);
                setSettingsOpen(false);
              }}
            >
              Mark tweezer tip
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
