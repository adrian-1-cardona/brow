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
4. Open Settings → Review stray areas → Mark areas on live mirror. Tap a small area immediately outside the outline. Marks are candidates, not automatic removal decisions. Inspect the visible marks, then check **I checked this area** for each area you want included in the proposed result.
5. Open the proposed result and drag the divider with a mouse or finger. Arrow keys move the focused divider; Home and End move it to the limits. Both sides use exactly the same captured camera frame. With no verified marks the proposed camera image is unchanged.
6. Stop the camera when finished. Switching tabs, backgrounding the browser or leaving the page also releases all camera tracks and terminates the worker. Return and enable the camera again to resume.

Unverified areas never change. Verified areas clear on tracking interruption, poor light, unsuitable head angle, stopping the camera, changing style or editing calibration. No camera image, face landmarks or calibration are persisted or uploaded.

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

That test uses the portrait only in an animated temporary test `MediaStream`, runs the actual landmark model and verifies style gating, protected-area rejection, manual approval and lighting-loss recovery. This test harness is not part of the application. Unit tests cover geometry, polygon collision and border inclusion, mirrored/cropped coordinate transforms, smoothing, verified-pixel edit boundaries, fingertip proximity and assisted-tip confidence/loss.

## Architecture

| Part                             | Responsibility                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/app`                        | Next App Router page, responsive layout, manifest and metadata                                                                 |
| `src/components/brow-studio.tsx` | Minimal mirror controls, settings, manual review and accessible comparison divider                                             |
| `src/hooks/use-brow-camera.ts`   | Single camera lifecycle, frame capture, adaptive inference scheduling, lighting/pose/tracking gates, warning state and cleanup |
| `src/lib/vision.worker.ts`       | One face model in a classic worker; lazily initialized optional hand model; only one frame in flight                           |
| `src/lib/geometry.ts`            | MediaPipe topology indices, face-relative shape construction, calibration, collision, stabilization and coordinate transforms  |
| `src/lib/render.ts`              | Thin red strokes and restrained same-frame texture blending in manually verified eyebrow areas                                 |
| `src/lib/tip-tracker.ts`         | User-seeded normalized template correlation with contrast, ambiguity and timeout rejection                                     |
| `scripts/prepare-assets.mjs`     | Local worker build, runtime copying and model integrity checks                                                                 |
| `public/sw.js`                   | Same-origin app-shell and asset caching for installed/offline use                                                              |

The topology uses actual detected eyebrow landmark positions, never fixed facial coordinates. Shape dimensions and taper are relative proportions of the tracked brow. Straight has a restrained rise; Soft Arch has a modest, smooth apex. A movement-adaptive filter attenuates jitter. MediaPipe itself is configured for one face and conservative presence thresholds. Overlays and edits require four consecutive detections, recent results, adequate light and a forward-facing pose. Delayed results and stale hand detections are rejected.

One invisible, inline-playing video is the source. Each render copies it once to a shared frame canvas, draws the original and proposed canvases from that same frame, then draws the outline on the original only. Both display canvases use identical mirror and cover transforms. Pointer positions invert that same transform before calibration/review interactions. The clipping wrapper stays in display coordinates so mirroring cannot reverse the comparison divider.

For verified areas, the renderer samples nearby skin texture from the current frame and gently reduces only substantially darker pixels inside a small reviewed disc. Every output pixel is checked against both protected outlines, a two-pixel margin and the eyebrow envelope. There is no face-wide smoothing, synthetic eyebrow fill, shape painting or beauty filter. Preview pixels inside either outline remain identical to the source; the guide itself is a separate stroke on the original view.

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
- Face landmarks locate a brow region; they do not segment individual hairs. Every candidate requires the user’s own visual verification. Two-dimensional guides cannot establish safe physical tool depth.
- Fast head motion, hand occlusion, extreme pose, multiple faces, backlighting or camera autofocus can reduce accuracy. Guides/edits pause when reliability gates fail. Global light estimation cannot identify every difficult lighting condition.
- Assisted tip tracking can lose thin or reflective tweezers, follow the wrong detail or fail abruptly. No dedicated tweezer detector or reliable depth estimation is included.
- Calibration and review are session-only. Backgrounding intentionally stops the stream and clears review marks. Camera switching/zoom recording and cloud synchronization are outside this implementation.
- The app intentionally begins with an unchanged live result and requires manual review rather than automatically deleting everything outside a suggested shape.

## Model provenance and third-party code

MediaPipe Tasks Vision 0.10.32 is pinned in `vendor/tasks-vision`. It was retrieved from the package CDN because registry metadata was unavailable in the build environment. Files were checked against the CDN’s SHA-256 manifest; the runtime is bundled locally. See `vendor/tasks-vision/LICENSE`, its upstream README and `THIRD_PARTY_NOTICES.md`. The models are Google’s pinned float16 v1 bundles. `public/vision/models.json` records their official source URLs and SHA-256 hashes.

References: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker), [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation).
