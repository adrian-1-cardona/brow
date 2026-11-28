import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  makeBrows,
  sourceToDisplay,
  fromBrowLocal,
  polygonDistance,
  isProtected,
} from "../../src/lib/geometry";
import { defaultCalibration, type Point } from "../../src/lib/types";

async function streamFixture(page: Page, face?: string) {
  await page.addInitScript(
    ({ face }) => {
      const state = window as unknown as {
        fixtureTracks: MediaStreamTrack[];
        fixtureFace: Point[];
        fixtureWorkerErrors: string[];
        fixtureDark: boolean;
        fixtureStray: Point | null;
        fixtureHandReady: boolean;
        fixtureWorkerCount: number;
      };
      state.fixtureTracks = [];
      state.fixtureWorkerErrors = [];
      state.fixtureDark = false;
      state.fixtureStray = null;
      state.fixtureHandReady = false;
      state.fixtureWorkerCount = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          state.fixtureWorkerCount++;
          this.addEventListener("message", (event) => {
            if (event.data.type === "result")
              state.fixtureFace = event.data.face;
            if (event.data.type === "error")
              state.fixtureWorkerErrors.push(event.data.message);
            if (event.data.type === "hands" && event.data.status === "ready")
              state.fixtureHandReady = true;
          });
        }
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d")!;
          const image = new Image();
          if (face) {
            image.src = face;
            await image.decode();
          }
          let counter = 0;
          const draw = () => {
            if (face) {
              ctx.fillStyle = "#baad8b";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              const scale = Math.min(
                canvas.width / image.width,
                canvas.height / image.height,
              );
              ctx.drawImage(
                image,
                (canvas.width - image.width * scale) / 2,
                (canvas.height - image.height * scale) / 2,
                image.width * scale,
                image.height * scale,
              );
            } else {
              ctx.fillStyle = "#baad8b";
              ctx.fillRect(0, 0, 640, 480);
            }
            // change the corner so we can check both views stay live.
            ctx.fillStyle = counter++ % 2 ? "#c0a080" : "#8090a0";
            ctx.fillRect(0, 0, 100, 100);
            if (state.fixtureStray) {
              ctx.fillStyle = "#15110e";
              ctx.fillRect(
                Math.round(state.fixtureStray.x) - 1,
                Math.round(state.fixtureStray.y) - 2,
                3,
                5,
              );
            }
            if (state.fixtureDark) {
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, 640, 480);
            }
          };
          draw();
          const timer = setInterval(draw, 100);
          const stream = canvas.captureStream(10);
          const track = stream.getVideoTracks()[0],
            nativeStop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            nativeStop();
          };
          state.fixtureTracks.push(track);
          return stream;
        },
      });
    },
    { face },
  );
}

test("starts without a style, keeps advanced controls in settings, and fits the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Enable camera" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Straight/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "View proposed result" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/brow-studio-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Length", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: /Straight/ }).click();
  await expect(page.getByRole("button", { name: /Straight/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Soft Arch/ }).click();
  await expect(page.getByRole("button", { name: /Straight/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("provides an installable manifest and reloads the cached shell offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toHaveLength(3);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable camera" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable camera" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("handles permission denial with actionable recovery", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByText(/Camera access was denied/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try camera again" }),
  ).toBeVisible();
});

test("runs the real vision worker, compares synchronized live frames, drags by pointer and releases camera tracks", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await streamFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.locator(".tracking-status")).toHaveText(
    "Looking for your face…",
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: /Straight/ }).click();
  await page.getByRole("button", { name: /Soft Arch/ }).click();
  await page.getByRole("button", { name: /Straight/ }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureWorkerCount: number })
          .fixtureWorkerCount,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "View proposed result" }).click();
  const divider = page.getByRole("slider", {
    name: "Live and proposed comparison divider",
  });
  await expect(divider).toBeVisible();
  const before = await divider.boundingBox();
  await page.mouse.move(
    before!.x + before!.width / 2,
    before!.y + before!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(before!.x + 70, before!.y + 20);
  await page.mouse.up();
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(
    50,
  );
  await divider.focus();
  await page.keyboard.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "8");
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    const handle = await divider.boundingBox(),
      stage = await page.getByTestId("camera-stage").boundingBox();
    const y = handle!.y + handle!.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: handle!.x + handle!.width / 2, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: stage!.x + stage!.width * 0.8, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => Number(await divider.getAttribute("aria-valuenow")))
      .toBeGreaterThan(65);
  }
  // both views should match when there are no guides or edits.
  const synchronized = await page.evaluate(() => {
    const a = document.querySelector<HTMLCanvasElement>(
      '[data-testid="original-canvas"]',
    )!;
    const b = document.querySelector<HTMLCanvasElement>(
      '[data-testid="proposed-canvas"]',
    )!;
    return a.width > 0 && a.toDataURL() === b.toDataURL();
  });
  expect(synchronized).toBe(true);
  await page.getByRole("button", { name: "Finished look", exact: true }).click();
  await expect(divider).not.toBeVisible();
  await expect(page.locator(".proposed-layer")).toHaveCSS("clip-path", "inset(0px)");
  await expect(page.getByText("Finished look · outline stays", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Show comparison" }).click();
  await expect(divider).toBeVisible();
  const first = await page
    .getByTestId("original-canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await expect
    .poll(() =>
      page
        .getByTestId("original-canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    )
    .not.toBe(first);
  await page.getByRole("button", { name: "Stop camera" }).click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { fixtureTracks: MediaStreamTrack[] }
      ).fixtureTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.querySelectorAll("video").length),
  ).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureWorkerErrors: string[] })
          .fixtureWorkerErrors,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("automatically trims an additional camera frame while preserving both protected brows and eye areas", async ({ page }) => {
  test.skip(
    !process.env.BROW_TEST_PREVIEW,
    "Supply BROW_TEST_PREVIEW to replay a local camera frame without portrait-specific manual touch-ups.",
  );
  const data = await readFile(process.env.BROW_TEST_PREVIEW!);
  await streamFixture(page, "data:image/png;base64," + data.toString("base64"));
  await page.goto("/");
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.locator(".tracking-status")).toHaveText("Face tracking active", { timeout: 45000 });
  await page.getByRole("button", { name: /Soft Arch/ }).click();
  await page.getByRole("button", { name: "View proposed result" }).click();
  await expect(page.getByText("Virtual preview · estimate", { exact: true })).toBeVisible();
  await expect(page.locator(".review-instruction")).not.toBeVisible();
  const result = await page.getByTestId("proposed-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const raw = document.createElement("canvas");
    raw.width = canvas.width;
    raw.height = canvas.height;
    const ctx = raw.getContext("2d")!;
    ctx.drawImage(document.querySelector<HTMLVideoElement>(".camera-source")!, 0, 0, raw.width, raw.height);
    const before = ctx.getImageData(0, 0, raw.width, raw.height).data;
    const after = canvas.getContext("2d")!.getImageData(0, 0, raw.width, raw.height).data;
    const changes: Point[] = [];
    for (let y = 100; y < raw.height; y++)
      for (let x = 0; x < raw.width; x++) {
        const i = (y * raw.width + x) * 4;
        if ([0, 1, 2].some(c => before[i + c] !== after[i + c])) changes.push({ x, y });
      }
    return { changes, width: raw.width, height: raw.height,
      face: (window as unknown as { fixtureFace: Point[] }).fixtureFace };
  });
  const brows = makeBrows(result.face, "soft-arch", defaultCalibration(), result.width, result.height);
  const eyes = [[362, 263], [133, 33]].map(ids => {
    const points = ids.map(id => result.face[id]);
    return {
      left: Math.min(...points.map(p => p.x)) * result.width,
      right: Math.max(...points.map(p => p.x)) * result.width,
      top: (Math.min(...points.map(p => p.y)) - 0.025) * result.height,
      bottom: (Math.max(...points.map(p => p.y)) + 0.035) * result.height,
    };
  });
  expect(result.changes.length).toBeGreaterThan(20);
  for (const point of result.changes) {
    expect(isProtected(point, brows)).toBe(false);
    expect(brows.some(brow => polygonDistance(point, brow.sourcePolygon) < 2)).toBe(true);
    expect(eyes.some(eye => point.x >= eye.left && point.x <= eye.right && point.y >= eye.top && point.y <= eye.bottom)).toBe(false);
  }
  await page.screenshot({ path: `/tmp/brow-studio-camera-regression-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Stop camera" }).click();
});

test("automatically previews real eyebrow pixels, protects the outline, supports reviewed touch-ups, and pauses on lighting loss", async ({
  page,
}) => {
  test.skip(
    !process.env.BROW_TEST_FACE,
    "Set BROW_TEST_FACE to a local, consented face image for opt-in real-model verification.",
  );
  const data = await readFile(process.env.BROW_TEST_FACE!);
  await streamFixture(
    page,
    "data:image/jpeg;base64," + data.toString("base64"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(
    page.getByText("Face tracking active", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  // keep the guide hidden until a style is chosen.
  const outlinePixels = () =>
    page
      .getByTestId("original-canvas")
      .evaluate((canvas: HTMLCanvasElement) => {
        const proposed = document.querySelector<HTMLCanvasElement>(
          '[data-testid="proposed-canvas"]',
        )!;
        const data = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        const other = proposed
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] !== other[i] || data[i + 1] !== other[i + 1]) n++;
        return n;
      });
  expect(await outlinePixels()).toBe(0);
  await page.getByRole("button", { name: /Straight/ }).click();
  await expect.poll(outlinePixels).toBeGreaterThan(20);
  await page.screenshot({
    path: `/tmp/brow-studio-live-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Soft Arch/ }).click();
  await expect.poll(outlinePixels).toBeGreaterThan(20);
  await page.screenshot({
    path: `/tmp/brow-studio-soft-arch-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Straight/ }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("switch", { name: /Detect nearby fingertips/ }).check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { fixtureHandReady: boolean }).fixtureHandReady,
      ),
    )
    .toBe(true);
  await page
    .getByRole("switch", { name: /Detect nearby fingertips/ })
    .uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tracking-status")).toHaveText(
    "Face tracking active",
  );
  const face = await page.evaluate(
    () => (window as unknown as { fixtureFace: Point[] }).fixtureFace,
  );
  const dimensions = await page
    .getByTestId("original-canvas")
    .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
  const brows = makeBrows(
    face,
    "straight",
    defaultCalibration(),
    dimensions[0],
    dimensions[1],
  );
  await page.getByRole("button", { name: "View proposed result" }).click();
  await expect(
    page.getByText("Virtual preview · estimate", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".review-instruction")).not.toBeVisible();
  const changes = await page
    .getByTestId("proposed-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const raw = document.createElement("canvas");
      raw.width = canvas.width;
      raw.height = canvas.height;
      const ctx = raw.getContext("2d")!;
      ctx.drawImage(
        document.querySelector<HTMLVideoElement>(".camera-source")!,
        0,
        0,
        raw.width,
        raw.height,
      );
      const before = ctx.getImageData(0, 0, raw.width, raw.height).data;
      const after = canvas
        .getContext("2d")!
        .getImageData(0, 0, raw.width, raw.height).data;
      const points: Point[] = [];
      for (let y = 100; y < raw.height; y++)
        for (let x = 0; x < raw.width; x++) {
          const i = (y * raw.width + x) * 4;
          if (Math.abs(before[i] - after[i]) > 3) points.push({ x, y });
        }
      return points;
    });
  expect(changes.length).toBeGreaterThan(20);
  for (const point of changes) {
    expect(
      brows.some((brow) => polygonDistance(point, brow.sourcePolygon) < 2),
    ).toBe(true);
    expect(isProtected(point, brows)).toBe(false);
  }
  await page.screenshot({
    path: `/tmp/brow-studio-auto-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Finished look", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Live and proposed comparison divider" })).not.toBeVisible();
  await expect.poll(() => page.getByTestId("proposed-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 220 && pixels[i + 1] < 100 && pixels[i + 2] < 120) red++;
    return red;
  })).toBeGreaterThan(30);
  await page.screenshot({ path: `/tmp/brow-studio-finished-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Show comparison" }).click();
  await page.getByRole("button", { name: /Soft Arch/ }).click();
  await expect(
    page.getByRole("button", { name: "Close comparison" }),
  ).toBeVisible();
  await expect(
    page.getByText("Virtual preview · estimate", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Straight/ }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Mark areas on live mirror" }).click();
  const stage = page.getByTestId("camera-stage"),
    rect = await stage.boundingBox();
  const clickLocal = async (u: number, v: number) => {
    const source = fromBrowLocal({ x: u, y: v }, brows[0]);
    const display = sourceToDisplay(
      source,
      dimensions[0],
      dimensions[1],
      rect!.width,
      rect!.height,
    );
    await page.mouse.click(rect!.x + display.x, rect!.y + display.y);
  };
  await clickLocal(0.4, 0.1);
  await expect(
    page.getByText("This area is protected. Stay outside the red outline.", {
      exact: true,
    }),
  ).toBeVisible();
  const stray = fromBrowLocal({ x: 0.4, y: -0.18 }, brows[0]);
  await page.evaluate((point) => {
    (window as unknown as { fixtureStray: Point | null }).fixtureStray = point;
  }, stray);
  const pixel = (panel: "original" | "proposed") =>
    page
      .getByTestId(`${panel}-canvas`)
      .evaluate((canvas: HTMLCanvasElement, point) => {
        const data = canvas
          .getContext("2d")!
          .getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data;
        return (data[0] + data[1] + data[2]) / 3;
      }, stray);
  await expect.poll(() => pixel("original")).toBeLessThan(35);
  await clickLocal(0.4, -0.18);
  await expect(
    page.getByRole("button", { name: "I checked these — apply" }),
  ).toBeVisible();
  expect(await pixel("proposed")).toBeLessThan(35);
  await page.getByRole("button", { name: "I checked these — apply" }).click();
  await expect(
    page.getByText("Virtual preview · estimate", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => pixel("proposed")).toBeGreaterThan(40);
  expect(await pixel("original")).toBeLessThan(35);
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Mark tweezer tip" }).click();
  await clickLocal(0.4, -0.18);
  await expect(
    page.getByText(
      "Tip marked. Assisted tracking can lose small or reflective tools; verify its position yourself.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View proposed result", exact: true })
    .click();
  await page.evaluate(() => {
    (window as unknown as { fixtureDark: boolean }).fixtureDark = true;
  });
  await expect(page.locator(".tracking-status")).toHaveText(
    "More light needed",
  );
  await expect(page.getByText("Preview paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop camera" }).click();
});

test("shows an explicit pause for brows obscured by glasses", async ({
  page,
}) => {
  test.skip(
    !process.env.BROW_TEST_OBSTRUCTION,
    "Supply BROW_TEST_OBSTRUCTION for opt-in obstruction verification.",
  );
  const data = await readFile(process.env.BROW_TEST_OBSTRUCTION!);
  await streamFixture(page, "data:image/png;base64," + data.toString("base64"));
  await page.goto("/");
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.locator(".tracking-status")).toHaveText(
    "Face tracking active",
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: /Straight/ }).click();
  await page.getByRole("button", { name: "View proposed result" }).click();
  await expect(
    page.getByText("Preview paused · brows obscured", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Clear glasses or hair from your brows to preview."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop camera" }).click();
});

test("can restart the actual camera tracker offline after loading local vision assets", async ({
  page,
  context,
}) => {
  await streamFixture(page);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.locator(".tracking-status")).toHaveText(
    "Looking for your face…",
    { timeout: 45000 },
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        return Boolean(await caches.match("/vision/face_landmarker.task"));
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Stop camera" }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.locator(".tracking-status")).toHaveText(
    "Looking for your face…",
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: "Stop camera" }).click();
  await context.setOffline(false);
});
