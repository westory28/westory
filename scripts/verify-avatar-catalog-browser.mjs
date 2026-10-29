/** Exercise the actual AvatarStudio against the isolated verify-avatar-ui fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
const origin = process.env.AVATAR_QA_URL || "http://127.0.0.1:4181";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local fixture only");
const evidence =
  process.env.AVATAR_QA_EVIDENCE ||
  path.join(os.tmpdir(), "westory-avatar-catalog-qa");
await fs.mkdir(evidence, { recursive: true });
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const modelRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (/\.glb(?:\?|$)|\/renderer\/engine/.test(request.url()))
    modelRequests.push(request.url());
});
await page.addInitScript(() => {
  window.webglRequests = 0;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...options) {
    if (/^(webgl2?|experimental-webgl)$/.test(type)) window.webglRequests++;
    return getContext.call(this, type, ...options);
  };
});
await page.route("**/*", (route) =>
  route.request().url().startsWith(origin) ||
  /^(data|blob):/.test(route.request().url())
    ? route.continue()
    : route.abort(),
);
const screenshots = [];
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "꾸미기 화면", exact: true }).click();
  await page.getByRole("button", { name: /^여학생 아바타/ }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".avatar-studio-save .avatar-primary")?.disabled,
  );
  await page.getByRole("button", { name: /아이보리 저고리/ }).click();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole("button", { name: `폭 ${width}`, exact: true })
      .click();
    await page
      .locator(".avatar-studio-item")
      .filter({ hasText: "아이보리 저고리" })
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          ".avatar-studio-item .avatar-item-preview img",
        ),
      ]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        })
        .every((image) => image.complete && image.naturalWidth === 256),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Page overflow ${width}`,
    );
    assert.equal(
      await page.locator(".avatar-studio canvas").count(),
      1,
      "Only the selected avatar has a 2D drawing canvas",
    );
    await page.locator(".avatar-studio").scrollIntoViewIfNeeded();
    const file = path.join(evidence, `student-studio-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("button", { name: "헤어", exact: true }).click();
  const hairButtons = page.locator(".avatar-studio-item");
  assert((await hairButtons.count()) >= 5, "Distinct selectable hair catalog");
  await page.getByRole("button", { name: "아바타 저장", exact: true }).click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 1);
  assert.equal(
    await page.evaluate(() => window.avatarQa.saves[0].cornerAlpha),
    0,
    "Saved thumbnail retains transparency",
  );
  await page.getByRole("button", { name: "상의", exact: true }).click();
  await page.getByRole("button", { name: /햇살 재킷/ }).click();
  assert(
    await page
      .getByRole("button", { name: "아바타 저장", exact: true })
      .isDisabled(),
    "Unowned item cannot be saved",
  );
  await page
    .getByRole("button", { name: "180 위스로 구매", exact: true })
    .click();
  await page.getByRole("button", { name: "구매하기", exact: true }).click();
  await page.waitForFunction(() => window.avatarQa.purchases.length === 1);
  const purchasesBeforeTeacher = await page.evaluate(
    () => window.avatarQa.purchases.length,
  );
  await page.getByRole("button", { name: "순위 화면", exact: true }).click();
  assert.equal(
    await page.locator("canvas").count(),
    0,
    "Leaving releases the studio canvas",
  );
  await page.getByRole("button", { name: "교사 문맥", exact: true }).click();
  await page.getByRole("button", { name: "꾸미기 화면", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".avatar-studio-save .avatar-primary")?.disabled,
  );
  assert.equal(
    await page.getByRole("button", { name: "왼쪽으로 돌리기" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "오른쪽으로 돌리기" }).count(),
    0,
  );
  assert.equal(await page.locator(".avatar-studio-wallet").count(), 0);
  // An unchanged saved look must support an explicit refresh of the old image.
  assert.equal(await page.evaluate(() => window.avatarQa.saves.length), 1);
  await page.getByRole("button", { name: "아바타 저장", exact: true }).click();
  await page.waitForFunction(() => window.avatarQa.saves.length === 2);
  assert.equal(
    await page.evaluate(() => window.avatarQa.saves[1].cornerAlpha),
    0,
  );
  assert(
    await page
      .getByRole("button", { name: "아바타 저장", exact: true })
      .isDisabled(),
  );
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole("button", { name: `폭 ${width}`, exact: true })
      .click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const file = path.join(evidence, `teacher-studio-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    screenshots.push(file);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  const catalog = JSON.parse(
    await fs.readFile(
      new URL("../functions/avatarCatalog.json", import.meta.url),
      "utf8",
    ),
  );
  const slotLabels = {
    top: "상의",
    bottom: "하의",
    shoes: "신발",
    accessory: "장식",
    hairStyle: "헤어",
    hairTone: "염색",
    faceShape: "얼굴형",
    expression: "눈매·표정",
    skinTone: "피부색",
    pose: "포즈",
  };
  const coverage = [];
  for (const character of ["girl", "boy"]) {
    await page
      .getByRole("button", {
        name: character === "boy" ? "남성 아바타" : "여성 아바타",
        exact: true,
      })
      .click();
    for (const [slot, label] of Object.entries(slotLabels)) {
      await page.getByRole("button", { name: label, exact: true }).click();
      const candidates = catalog.items.filter(
        (item) => item.slot === slot && item.characters.includes(character),
      );
      const poseImages = new Set();
      for (const item of candidates) {
        await page
          .locator(".avatar-studio-item")
          .filter({
            has: page.locator(".avatar-studio-item-name", {
              hasText: item.label,
            }),
          })
          .click();
        await page.waitForFunction(
          () =>
            document
              .querySelector(".avatar-studio-stage [aria-busy]")
              ?.getAttribute("aria-busy") === "false",
        );
        assert.equal(
          await page.locator(".avatar-studio-stage [role='alert']").count(),
          0,
          `${character}/${item.id} loads`,
        );
        assert.equal(
          await page.locator(".avatar-studio-pending").count(),
          0,
          "Teachers use items without a purchase",
        );
        if (slot === "pose") {
          const pixels = await page
            .locator(".avatar-studio canvas")
            .evaluate((canvas) => canvas.toDataURL());
          poseImages.add(pixels);
          const file = path.join(
            evidence,
            `${character}-pose-${item.value}.png`,
          );
          await page.locator(".avatar-studio-stage").screenshot({ path: file });
          screenshots.push(file);
        }
        coverage.push(`${character}/${item.id}`);
      }
      if (slot === "pose")
        assert.equal(
          poseImages.size,
          candidates.length,
          "Every pose visibly differs",
        );
    }
  }
  assert.equal(
    await page.evaluate(() => window.avatarQa.purchases.length),
    purchasesBeforeTeacher,
  );
  assert.deepEqual(
    modelRequests,
    [],
    "2D studio never requests old models or the 3D runtime",
  );
  assert.equal(
    await page.evaluate(() => window.webglRequests),
    0,
    "2D studio never creates WebGL contexts",
  );
  const result = await page.evaluate(() => ({
    purchases: window.avatarQa.purchases,
    saves: window.avatarQa.saves.map(({ thumbnailBytes, cornerAlpha }) => ({
      thumbnailBytes,
      cornerAlpha,
    })),
    errors: window.avatarQa.errors,
  }));
  assert.equal(result.purchases[0].charge, 180);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        passed: true,
        widths: [320, 390, 768, 1280],
        screenshots,
        coverage,
        modelRequests,
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      evidence,
      screenshots,
      widths: [320, 390, 768, 1280],
      network: "local only",
      purchase: "synthetic only",
    }),
  );
} finally {
  await browser.close();
}
