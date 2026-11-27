import { cp, mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}public/vision`, { recursive: true });
await cp(
  `${root}node_modules/@mediapipe/tasks-vision/wasm`,
  `${root}public/vision/wasm`,
  { recursive: true },
);
await build({
  entryPoints: [`${root}src/lib/vision.worker.ts`],
  outfile: `${root}public/vision/worker.js`,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "eof",
});
await mkdir(`${root}public/icons`, { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
  ["apple-touch-icon", 180],
]) {
  await sharp(`${root}public/icon.svg`)
    .resize(size, size)
    .png()
    .toFile(`${root}public/icons/${name}.png`);
}
const models = [
  [
    "face_landmarker",
    "face_landmarker",
    "float16",
    "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  ],
  [
    "hand_landmarker",
    "hand_landmarker",
    "float16",
    "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
  ],
];
const manifest = {};
for (const [task, model, precision, expectedHash] of models) {
  const path = `${root}public/vision/${task}.task`;
  const url = `https://storage.googleapis.com/mediapipe-models/${task}/${model}/${precision}/1/${task}.task`;
  const exists = await stat(path).catch(() => null);
  if (!exists || exists.size < 100000) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok)
      throw new Error(`Model download failed: ${response.status} ${url}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  const hash = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (hash !== expectedHash)
    throw new Error(`Model integrity check failed: ${task}`);
  manifest[task] = { source: url, sha256: hash };
}
await writeFile(
  `${root}public/vision/models.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("Local vision runtime and pinned v1 models ready.");
