# Brow Studio

A private, camera-first eyebrow guide built with Next.js, React, TypeScript, Canvas and MediaPipe. The supplied sketches and Straight / Soft Arch photographs informed the layout and conservative shape geometry. Reference photographs are not shipped in the application.

## Install and run

Use Node.js 22.20+ (Node 24 recommended) and npm 10+.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000> and enable the camera. Camera permission is requested only after a click. Microphone access is never requested.

The install step copies the vendored Wasm runtime, builds the classic vision worker and checks the included models against their pinned hashes. Icons and models are stored in the repository. No model download or external service is needed. `npm run assets` rebuilds the worker and copies the runtime. Use a normal development dependency install: the asset builder needs esbuild.

## Using the mirror

1. Enable the camera in soft, even light and face it directly with a relaxed expression.
2. Explicitly select Straight (recommended) or Soft Arch. No outline appears before selection; click the selected style again to clear it.
3. Check the thin red, unfilled outline. Everything inside it is protected. Calibrate each brow’s position, length, thickness, angle and arch in Settings. Changes are deliberately bounded.
4. Open **View proposed result** for an automatic, live virtual trim using the selected personal shape. No manual marks are needed. Switch styles while comparing. The label identifies this as an estimate; **no trim detected** means no visible safe change was found. Check every hair yourself before actual grooming.
5. Drag the divider with a mouse or finger. Arrow keys move the focused divider; Home and End move it to the limits. Both sides use exactly the same captured camera frame. Optional extra touch-ups live in Settings: mark an area, inspect it, then choose **I checked these — apply**. Unverified marks add no extra changes.
6. Stop the camera when finished. Switching tabs, backgrounding the browser or leaving the page also releases all camera tracks and terminates the worker. Return and enable the camera again to resume.

Automatic edits stay outside the protected outline and inside the observed eyebrow region. Extra reviewed marks clear on tracking interruption, poor light, unsuitable head angle, stopping the camera, changing style or editing calibration. If the obstruction check detects a dark object beneath the brow, the preview pauses and asks you to clear glasses or hair; it does not attempt to erase the obstruction. No camera image, face landmarks or calibration are persisted or uploaded.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs lint, types, unit tests and the production build. Browser tests start the production server, so build first. The suite covers desktop, iPhone-sized and iPad-sized Chromium views, permission denial, the actual local vision worker, synchronized moving camera frames, pointer and keyboard comparison, and camera-track release.

The real-face integration test is opt-in to avoid committing personal face data. Supply a local, consented portrait:

```sh
BROW_TEST_FACE=/absolute/path/to/portrait.jpg npm run test:e2e
```

That test uses the portrait only in an animated temporary test `MediaStream`, runs the actual landmark model and checks automatic pixel changes without marks, eyebrow-only edit boundaries, protected-area rejection, optional manual approval and lighting-loss recovery. Set `BROW_TEST_OBSTRUCTION=/absolute/path/to/obscured-brows.png` to also run the obstruction integration check. These test fixtures are not part of the application. Unit tests cover geometry, brow movement independent of the eyes, polygon collision and border inclusion, mirrored/cropped coordinate transforms, smoothing, automatic and verified edit boundaries, obstruction pauses, fingertip proximity and assisted-tip confidence/loss.

## Architecture

| Part                             | Responsibility                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/app`                        | Next App Router page, responsive layout, manifest and metadata                                                                 |
| `src/components/brow-studio.tsx` | Minimal mirror controls, settings, manual review and accessible comparison divider                                             |
| `src/hooks/use-brow-camera.ts`   | Single camera lifecycle, frame capture, adaptive inference scheduling, lighting/pose/tracking gates, warning state and cleanup |
| `src/lib/vision.worker.ts`       | One face model in a classic worker; lazily initialized optional hand model; only one frame in flight                           |
| `src/lib/geometry.ts`            | MediaPipe topology indices, face-relative shape construction, calibration, collision, stabilization and coordinate transforms  |
| `src/lib/brow-profiles.ts`       | Full contours traced from the two personal references, stored as proportions of the tracked eyebrow frame                      |
| `src/lib/render.ts`              | Thin red strokes, automatic eyebrow-only texture blending, obstruction checks and optional reviewed touch-ups                  |
| `src/lib/tip-tracker.ts`         | User-seeded normalized template correlation with contrast, ambiguity and timeout rejection                                     |
| `scripts/prepare-assets.mjs`     | Local worker build, runtime copying and model integrity checks                                                                 |
| `public/sw.js`                   | Same-origin app-shell and asset caching for installed/offline use                                                              |

Both personal contours are traced from the supplied photographs, including their full thickness, rounded heads and tapered tails. They are stored as proportions and mapped from the detected upper and lower eyebrow landmarks, so the reference shape follows brow height, head movement, scale and roll without fixed screen coordinates. Anchoring to brows rather than eye corners avoids drifting down toward glasses when the brows move independently of the eyes. Straight preserves the flatter lower edge; Soft Arch follows the higher, rounded curve in its reference. A movement-adaptive filter attenuates jitter. MediaPipe is configured for one face and conservative presence thresholds. Overlays and edits require four consecutive detections, recent results, adequate light and a forward-facing pose. Delayed results and stale hand detections are rejected.

One invisible, inline-playing video is the source. Each render copies it once to a shared frame canvas, draws the original and proposed canvases from that same frame, then draws the outline on the original only. Both display canvases use identical mirror and cover transforms. Pointer positions invert that same transform before calibration/review interactions. The clipping wrapper stays in display coordinates so mirroring cannot reverse the comparison divider.

While comparison is open, the renderer finds dark pixels inside a small landmark-derived natural brow region and outside both target outlines. It borrows nearby skin texture from the same live frame above or below each brow column to match the local shading, feathers the blend and preserves a protected edge margin that scales with brow size. Scanline spans skip protected interiors before doing distance checks on candidate pixels. The preview is computed only while visible, with no extra camera stream or model. Optional verified touch-ups use a small reviewed disc in the eyebrow envelope. There is no face-wide smoothing, synthetic eyebrow fill, shape painting or beauty filter. Preview pixels inside either outline remain identical to the source; the guide itself is a separate stroke on the original view.

## Experimental proximity warnings

Warnings are optional and disabled initially. Enable fingertip detection in Settings to load the hand model once per camera session. Fingertip proximity is measured in camera pixel space against both protected polygons. The visible warning text is exactly **“Stay outside the red outline.”**

Automatic tweezer recognition is **not implemented**: the provided models detect faces and hands, not tweezers. The functioning experimental alternative lets the user mark a visible tip, then follows its small image patch using normalized correlation. It rejects low contrast, low or ambiguous matches and expires after 12 seconds. It does not infer that the marked object is a tweezer. The tracking status says when the tip is unavailable or unreliable; re-marking is necessary after loss. Do not rely on either warning to decide whether a hair is safe to remove.

## PWA and deployment

```sh
npm ci
npm run check
npm run start -- --hostname 0.0.0.0
```

Deploy to a Node-compatible Next.js host (for example Vercel) with `npm ci` as the install command and `npm run build` as the build command. Keep `public/vision`, generated `public/vision/wasm`, the worker and icons in the deployment. No environment variables, API keys, database or account are required. Serve over HTTPS. Do not add a restrictive cross-origin isolation policy without testing the Wasm runtime. The application sets camera-only permission policy, content type protection and same-origin referrers.

For physical mobile development, use a trusted HTTPS development certificate or an HTTPS preview deployment. Plain `http://192.168…` is not a secure context and will not provide camera access. Desktop localhost is allowed by browsers.

On iPhone/iPad, use Safari’s Share → Add to Home Screen. On supported desktop/Android browsers, use the browser’s install action. The app caches the shell and same-origin assets after they have loaded; the hand model is cached only after enabling hand tracking. Complete the first online load before expecting offline operation. Browser storage eviction can remove cached assets; offline camera permissions and installed-app behavior remain browser-controlled. The service worker is registered only in production builds. Updates activate when older app windows have closed.

## Devices and performance

Target devices are iPhone 12 or newer and current iPads on iOS/iPadOS 17+, current desktop Chrome/Edge, and Safari 17+. A camera, WebAssembly, Worker, OffscreenCanvas and `createImageBitmap` support are required. Canvas output is capped at 640 pixels wide on smaller screens and 960 on desktop. Face inference is adaptive and capped near 15 Hz; optional hand detection is throttled near 6 Hz. Camera rendering uses new video frames and there is no overlapping inference queue. Stop/background/unmount releases tracks, video resources, models and animation callbacks.

Desktop, iPhone-sized and iPad-sized browser automation do not replace physical iPhone/iPad validation. Actual Apple-device camera orientation, heat, battery use, tracking quality and Safari/PWA performance require hands-on testing before a production release. Firefox and embedded/in-app browsers are not verified. Unsupported devices receive a recoverable error instead of a simulated feed.

## Known limitations

- The preview is a restrained local texture approximation, not generative inpainting or a guaranteed photorealistic prediction. Dense hair, uneven light and reflective skin can leave visible artifacts. It does not add hairs or aggressively reshape a brow.
- Face landmarks locate a brow region; they do not segment individual hairs. The automatic preview is a virtual estimate, not permission to remove hair. Every physical grooming decision requires the user’s own visual verification. Two-dimensional guides cannot establish safe physical tool depth.
- Fast head motion, hand occlusion, extreme pose, multiple faces, backlighting or camera autofocus can reduce accuracy. Guides/edits pause when reliability gates fail. Global light estimation cannot identify every difficult lighting condition.
- Assisted tip tracking can lose thin or reflective tweezers, follow the wrong detail or fail abruptly. No dedicated tweezer detector or reliable depth estimation is included.
- Calibration and review are session-only. Backgrounding intentionally stops the stream and clears review marks. Camera switching/zoom recording and cloud synchronization are outside this implementation.
- The preview cannot guarantee the reference-photo result, add missing hair or relocate a brow. If the natural brow already fits the target, changes can be small. Obstruction checks are heuristic and can miss glasses, hair or hands, or pause for a shadow; use an unobstructed, well-lit view and inspect the guide before grooming.

## Model provenance and third-party code

MediaPipe Tasks Vision 0.10.32 is pinned in `vendor/tasks-vision`. It was retrieved from the package CDN because registry metadata was unavailable in the build environment. Files were checked against the CDN’s SHA-256 manifest; the runtime is bundled locally. See `vendor/tasks-vision/LICENSE`, its upstream README and `THIRD_PARTY_NOTICES.md`. The models are Google’s pinned float16 v1 bundles. `public/vision/models.json` records their official source URLs and SHA-256 hashes.

References: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker), [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation).
