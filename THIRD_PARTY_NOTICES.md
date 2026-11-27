# Third-party notices

This application bundles MediaPipe Tasks Vision 0.10.32 from Google, licensed under Apache License 2.0. The upstream license is included at `vendor/tasks-vision/LICENSE`; copyright notices are retained in the bundled source. Source: https://github.com/google-ai-edge/mediapipe. Package files: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/.

The included face_landmarker and hand_landmarker float16 v1 model bundles are distributed by Google at the URLs recorded in `public/vision/models.json`. See the [MediaPipe model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) and [Google’s model repository](https://github.com/google-ai-edge/mediapipe) for model information and applicable upstream terms. The model hashes are pinned during preparation.

Next.js, React, Lucide and the remaining dependencies retain their own licenses in their installed packages. Their exact resolved versions are recorded in `package-lock.json`.
