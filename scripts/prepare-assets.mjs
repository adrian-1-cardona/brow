import { cp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
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
const models = JSON.parse(
  await readFile(`${root}public/vision/models.json`, "utf8"),
);
for (const [task, { sha256 }] of Object.entries(models)) {
  const hash = createHash("sha256")
    .update(await readFile(`${root}public/vision/${task}.task`))
    .digest("hex");
  if (hash !== sha256) throw new Error(`Model integrity check failed: ${task}`);
}
console.log("Local vision runtime and pinned v1 models ready.");
