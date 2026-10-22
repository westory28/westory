import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const baseline = process.env.GLOBE_TOUCH_BASELINE === "1";
const label = process.env.GLOBE_TOUCH_LABEL || "after";
const engine = process.env.GLOBE_TOUCH_ENGINE || "chromium";
assert(
  ["chromium", "webkit"].includes(engine),
  "Supported engines: chromium, webkit",
);
const webkitNativeCases = new Set([
  "place-text-mouse",
  "place-text-touch",
  "place-point-mouse",
  "place-point-touch",
  "place-text-mouse-drag",
  "genuine-label-tap",
  "keyboard-label-selection",
]);
const selectedCases = process.env.GLOBE_TOUCH_CASES?.split(",");
const widths = (process.env.GLOBE_TOUCH_WIDTHS || "390,768,1280")
  .split(",")
  .map(Number);
const out = path.join(root, "output/globe-touch-20261022");
await fs.mkdir(out, { recursive: true });
let fixture;
let origin = process.env.GLOBE_TOUCH_ORIGIN;
if (!origin) {
  fixture = spawn(
    process.execPath,
    ["scripts/verify-history-map-ui.mjs", "--serve"],
    {
      cwd: root,
      env: {
        ...process.env,
        ATLAS_UI_PORT: "0",
        ATLAS_UI_EVIDENCE: path.join(out, "fixture"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  origin = await new Promise((resolve, reject) => {
    let logs = "";
    const timeout = setTimeout(
      () => reject(new Error(`Fixture timeout: ${logs}`)),
      120_000,
    );
    fixture.on("error", reject);
    fixture.on("exit", (code) =>
      reject(new Error(`Fixture exited ${code}: ${logs}`)),
    );
    fixture.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    fixture.stdout.on("data", (chunk) => {
      logs += chunk;
      const match = logs.match(
        /Atlas UI fixture: (http:\/\/127\.0\.0\.1:\d+)/u,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const report = {
  label,
  baseline,
  engine,
  origin,
  input:
    engine === "webkit"
      ? "Native mouse/touchscreen.tap on Windows WebKit; not physical iOS or an installed PWA"
      : "Native mouse/touchscreen.tap and CDP multi-contact touch with browser pointer/click synthesis",
  widths,
  unsupportedCaseNames: [],
  cases: [],
};
let browser;
try {
  browser = await playwright[engine].launch({
    ...(engine === "chromium"
      ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
      : {}),
    headless: true,
  });
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: width === 390 ? 3 : 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__touchEvents = [];
      for (const type of [
        "pointerdown",
        "pointerup",
        "pointercancel",
        "gotpointercapture",
        "lostpointercapture",
        "click",
      ])
        document.addEventListener(
          type,
          (event) => {
            const group = event.target.closest?.(
              "[data-globe-label], [data-globe-country], [data-globe-region]",
            );
            window.__touchEvents.push({
              type,
              id: event.pointerId,
              pointerType: event.pointerType,
              targetTag: event.target.tagName,
              detail: event.detail,
              label:
                group?.getAttribute("data-globe-label") ||
                group?.getAttribute("data-globe-country") ||
                null,
            });
          },
          true,
        );
    });
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    const session =
      engine === "chromium" ? await context.newCDPSession(page) : null;
    const canvas = page.locator(".history-globe canvas");
    const state = () =>
      page.evaluate(() => ({
        zoom: Number(
          document
            .querySelector(".history-globe__zoom")
            ?.textContent.replace("%", ""),
        ),
        pageScale: window.visualViewport?.scale || 1,
        orientation: Array.from(
          document.querySelectorAll(".history-globe__labels g[data-globe-key]"),
        )
          .map(
            (node) =>
              `${node.getAttribute("data-globe-key")}:${node.getAttribute("transform")}`,
          )
          .sort()
          .join("|"),
        selected: document
          .querySelector(".history-globe canvas")
          ?.getAttribute("aria-label")
          .includes("선택한"),
      }));
    const touch = (type, points = []) => {
      assert(
        session,
        "Multi-contact CDP cases require Chromium; WebKit uses native touchscreen.tap cases",
      );
      return session.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point) => ({
          ...point,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        })),
      });
    };
    const settle = () => page.waitForTimeout(350);
    const pickLabel = () =>
      page.evaluate(() => {
        const canvas = document
          .querySelector(".history-globe canvas")
          .getBoundingClientRect();
        return Array.from(
          document.querySelectorAll('.history-globe__labels g[role="button"]'),
        )
          .map((node, index) => {
            const box = node.getBoundingClientRect();
            const x = box.x + box.width / 2,
              y = box.y + box.height / 2;
            const hit = document.elementFromPoint(x, y);
            return {
              x,
              y,
              index,
              visible:
                box.width > 0 &&
                y > 10 &&
                y < innerHeight - 10 &&
                x > 20 &&
                x < innerWidth - 20 &&
                (hit === node || node.contains(hit)),
              named: !!node.dataset.globeCountry,
              distance: Math.hypot(
                x - canvas.x - canvas.width / 2,
                y - canvas.y - canvas.height / 2,
              ),
            };
          })
          .filter((point) => point.visible && point.named)
          .sort((a, b) => a.distance - b.distance)[0];
      });
    const pickCanvas = (away) =>
      canvas.evaluate((target, avoid) => {
        const bounds = target.getBoundingClientRect();
        for (const y of [0.5, 0.7, 0.3, 0.85, 0.15])
          for (const x of [0.25, 0.75, 0.5, 0.15, 0.85]) {
            const point = {
              x: bounds.x + bounds.width * x,
              y: bounds.y + bounds.height * y,
            };
            if (
              point.y < 10 ||
              point.y > innerHeight - 10 ||
              document.elementFromPoint(point.x, point.y) !== target
            )
              continue;
            if (!avoid || Math.hypot(point.x - avoid.x, point.y - avoid.y) > 90)
              return point;
          }
        return null;
      }, away);
    const pickPlaceText = () =>
      page.evaluate(() => {
        const canvas = document.querySelector(".history-globe canvas");
        const bounds = canvas.getBoundingClientRect();
        const context = canvas.getContext("2d");
        const candidates = Array.from(
          document.querySelectorAll(
            ".history-globe__labels g[data-globe-label]",
          ),
        )
          .map((node) => {
            const text = node.querySelector("text");
            const box = text.getBoundingClientRect();
            const name = text.textContent;
            const x = box.left + box.width / 2,
              y = box.top + box.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (
              !box.width ||
              y < 5 ||
              y > innerHeight - 5 ||
              !node.contains(hit)
            )
              return null;
            // Inactive place labels sit ten CSS pixels right of their actual dot.
            // Dokdo may use one of three vertical offsets to avoid collisions.
            const matrix = node.getCTM();
            const dotX = matrix.e - 10;
            let dot;
            for (const dotY of [matrix.f + 18, matrix.f - 32, matrix.f + 32]) {
              if (
                dotY < 0 ||
                dotY >= bounds.height ||
                dotX < 0 ||
                dotX >= bounds.width
              )
                continue;
              const rgb = context.getImageData(
                Math.round((dotX * canvas.width) / bounds.width),
                Math.round((dotY * canvas.height) / bounds.height),
                1,
                1,
              ).data;
              if (
                rgb[2] > rgb[0] + 80 &&
                rgb[2] > rgb[1] + 60 &&
                document.elementFromPoint(bounds.x + dotX, bounds.y + dotY) ===
                  canvas
              ) {
                dot = { x: bounds.x + dotX, y: bounds.y + dotY };
                break;
              }
            }
            return {
              name,
              x,
              y,
              entryId: node.dataset.globeLabel,
              dot,
              priority: ["독도", "강남", "가르강"].indexOf(name),
            };
          })
          .filter((item) => item && item.priority >= 0)
          .sort((a, b) => a.priority - b.priority);
        return candidates[0];
      });
    const selectPlace = async (input, surface) => {
      const target = await pickPlaceText();
      assert(target, "A real Dokdo/Gangnam/Gardon place text is visible");
      const position = surface === "point" ? target.dot : target;
      assert(
        position,
        `${target.name}: the actual painted map point is uncovered`,
      );
      if (input === "touch") await page.touchscreen.tap(position.x, position.y);
      else await page.mouse.click(position.x, position.y);
      await page.waitForFunction(
        (name) =>
          document
            .querySelector(".history-globe__popup")
            ?.getAttribute("aria-label") === `${name} 장소 설명`,
        target.name,
        { timeout: 5000 },
      );
      assert(
        (await canvas.getAttribute("aria-label")).includes(
          `선택한 장소: ${target.name}`,
        ),
        "Point and text select the same place",
      );
      return { place: target.name, entryId: target.entryId, input, surface };
    };
    const point = (position, id) => ({ x: position.x, y: position.y, id });
    const moveOne = async (start, dx, dy, steps = 6, id = 11) => {
      await touch("touchStart", [point(start, id)]);
      for (let step = 1; step <= steps; step++) {
        await touch("touchMove", [
          {
            x: start.x + (dx * step) / steps,
            y: start.y + (dy * step) / steps,
            id,
          },
        ]);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd");
      await settle();
    };
    const rotationOnly = (before, after) => {
      assert.equal(
        after.zoom,
        before.zoom,
        "One finger must preserve globe zoom",
      );
      assert.equal(
        after.pageScale,
        before.pageScale,
        "One finger must preserve browser viewport scale",
      );
      assert.notEqual(
        after.orientation,
        before.orientation,
        "One finger must rotate the globe",
      );
      assert.equal(
        after.selected,
        false,
        "Dragging a label must not select it",
      );
    };
    const cases = [
      ["place-text-mouse", () => selectPlace("mouse", "text")],
      ["place-text-touch", () => selectPlace("touch", "text")],
      ["place-point-mouse", () => selectPlace("mouse", "point")],
      ["place-point-touch", () => selectPlace("touch", "point")],
      [
        "place-text-mouse-drag",
        async () => {
          const before = await state();
          const target = await pickPlaceText();
          assert(target, "A real place text is visible");
          await page.mouse.move(target.x, target.y);
          await page.mouse.down();
          await page.mouse.move(target.x + 55, target.y + 20, { steps: 6 });
          await page.mouse.up();
          await settle();
          rotationOnly(before, await state());
        },
      ],
      [
        "canvas-one-finger",
        async () => {
          const before = await state();
          await moveOne(await pickCanvas(), 55, 20);
          rotationOnly(before, await state());
        },
      ],
      [
        "label-one-finger",
        async () => {
          const before = await state();
          await moveOne(await pickLabel(), 55, 20);
          rotationOnly(before, await state());
        },
      ],
      [
        "label-short-drag",
        async () => {
          const before = await state();
          await moveOne(await pickLabel(), 8, 0, 1);
          rotationOnly(before, await state());
        },
      ],
      [
        "label-canvas-pinch-and-one-finger",
        async () => {
          const before = await state();
          const first = point(await pickLabel(), 21),
            second = point(await pickCanvas(first), 22);
          assert(
            first && second,
            "Pinch starts on one label and one uncovered canvas point",
          );
          await touch("touchStart", [first]);
          await touch("touchStart", [first, second]);
          const delta = {
            x: (second.x - first.x) * 0.12,
            y: (second.y - first.y) * 0.12,
          };
          let a, b;
          for (let step = 1; step <= 5; step++) {
            a = {
              x: first.x - (delta.x * step) / 5,
              y: first.y - (delta.y * step) / 5,
              id: 21,
            };
            b = {
              x: second.x + (delta.x * step) / 5,
              y: second.y + (delta.y * step) / 5,
              id: 22,
            };
            await touch("touchMove", [a, b]);
            await page.waitForTimeout(16);
          }
          await settle();
          const pinched = await state();
          assert(
            pinched.zoom > before.zoom + 5,
            "Two fingers starting on label+canvas must zoom",
          );
          assert.equal(
            pinched.pageScale,
            before.pageScale,
            "Pinch zoom belongs to the globe",
          );
          // CDP lists the contacts being released, not the remaining contacts.
          // Keep the original label finger down and lift only the second one.
          await touch("touchEnd", [b]);
          const remaining = await state();
          for (let step = 1; step <= 5; step++) {
            await touch("touchMove", [
              { x: a.x + step * 7, y: a.y + step * 2, id: 21 },
            ]);
            await page.waitForTimeout(16);
          }
          await touch("touchEnd");
          await settle();
          rotationOnly(remaining, await state());
        },
      ],
      [
        "genuine-label-tap",
        async () => {
          const target = await pickLabel();
          await page.touchscreen.tap(target.x, target.y);
          await page.waitForFunction(() =>
            document
              .querySelector(".history-globe canvas")
              .getAttribute("aria-label")
              .includes("선택한"),
          );
        },
      ],
      [
        "keyboard-label-selection",
        async () => {
          const target = await pickLabel();
          await page
            .locator('.history-globe__labels g[role="button"]')
            .nth(target.index)
            .press("Enter");
          await page.waitForFunction(() =>
            document
              .querySelector(".history-globe canvas")
              .getAttribute("aria-label")
              .includes("선택한"),
          );
        },
      ],
      [
        "pointer-cancel-recovery",
        async () => {
          const target = point(await pickLabel(), 41);
          await touch("touchStart", [target]);
          await touch("touchMove", [{ ...target, x: target.x + 12 }]);
          await touch("touchCancel");
          await settle();
          const before = await state();
          await moveOne(await pickCanvas(), 45, 15, 4, 41);
          rotationOnly(before, await state());
        },
      ],
      [
        "rapid-label-drags",
        async () => {
          const before = await state();
          for (let index = 0; index < 3; index++) {
            const target = point(await pickLabel(), 51);
            await touch("touchStart", [target]);
            await touch("touchMove", [{ ...target, x: target.x + 9 }]);
            await touch("touchEnd");
          }
          await settle();
          rotationOnly(before, await state());
        },
      ],
    ];
    for (const [name, action] of cases) {
      if (selectedCases && !selectedCases.includes(name)) continue;
      if (engine === "webkit" && !webkitNativeCases.has(name)) {
        if (!report.unsupportedCaseNames.includes(name))
          report.unsupportedCaseNames.push(name);
        continue;
      }
      const result = { width, name, passed: false };
      try {
        await page.goto(
          `${origin}/?touchCase=${name}#/teacher/lesson/maps?view=globe`,
        );
        await canvas.waitFor();
        await page.waitForLoadState("networkidle");
        await canvas.scrollIntoViewIfNeeded();
        await page
          .locator(".history-globe__labels g[data-globe-label]")
          .first()
          .waitFor();
        await settle();
        result.selectionProbe = await action();
        assert.deepEqual(errors, [], "No browser runtime errors");
        result.passed = true;
      } catch (error) {
        result.error = error.message;
        console.log(
          `${label} ${width}px ${name}: ${error.message.split("\n")[0]}`,
        );
        await page
          .screenshot({ path: path.join(out, `${label}-${width}-${name}.png`) })
          .catch(() => {});
      } finally {
        result.state = await state().catch(() => null);
        result.events = await page
          .evaluate(() => window.__touchEvents)
          .catch(() => []);
        report.cases.push(result);
        if (session) await touch("touchCancel").catch(() => {});
        await fs.writeFile(
          path.join(out, `${label}.json`),
          JSON.stringify(report, null, 2) + "\n",
        );
      }
    }
    await context.close();
  }
  const failures = report.cases.filter((result) => !result.passed);
  assert(report.cases.length > 0, "At least one supported case was requested");
  console.log(
    `Globe touch: ${report.cases.length - failures.length}/${report.cases.length} passed; ${path.join(out, `${label}.json`)}`,
  );
  if (!baseline)
    assert.equal(failures.length, 0, "Native touch regression cases pass");
} finally {
  await browser?.close();
  fixture?.kill();
}
