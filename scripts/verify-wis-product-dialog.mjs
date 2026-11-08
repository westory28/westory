/** Exercise the real product editor with the existing offline shop fixture. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-product-dialog-"),
);
const child = spawn(process.execPath, ["scripts/verify-wis-shop-browser.mjs"], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    WIS_SHOP_QA_PORT: "0",
    WIS_SHOP_QA_TAILWIND:
      process.env.WIS_SHOP_QA_TAILWIND ||
      path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let errors = "";
child.stderr.on("data", (chunk) => {
  errors += chunk;
});
const results = [];
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Fixture startup timed out: " + errors)),
      30000,
    );
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error("Fixture exited: " + code + " " + errors));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      for (const line of output.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const info = JSON.parse(line);
          if (info.origin) {
            clearTimeout(timeout);
            resolve(info.origin);
          }
        } catch {}
      }
    });
  });
  const engine = process.env.WIS_PRODUCT_QA_ENGINE || "chromium";
  browser = await playwright[engine].launch(
    engine === "chromium"
      ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
      : {},
  );
  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const external = [],
      pageErrors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        external.push(url.origin);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(origin + "/?view=teacher-products&scenario=normal");
    const create = page.getByRole("button", { name: "상품 등록", exact: true });
    await create.waitFor();
    await create.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      y: scrollY,
      height: document.documentElement.scrollHeight,
    }));
    await create.click();
    const dialog = page.getByRole("dialog", {
      name: "새 상품 등록",
      exact: true,
    });
    await dialog.waitFor();
    const geometry = await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: innerWidth,
        height: innerHeight,
        modal: el.matches(":modal"),
        overflow: el.scrollWidth > el.clientWidth + 1,
        bodyLocked: getComputedStyle(document.body).overflowY === "hidden",
        documentHeight: document.documentElement.scrollHeight,
        scrollY,
      };
    });
    assert(geometry.modal && geometry.bodyLocked);
    assert(
      geometry.x >= 0 &&
        geometry.y >= 0 &&
        geometry.right <= geometry.width &&
        geometry.bottom <= geometry.height,
    );
    assert(!geometry.overflow);
    assert.equal(
      geometry.documentHeight,
      before.height,
      "Opening the editor must not extend the list",
    );
    assert.equal(
      geometry.scrollY,
      before.y,
      "Opening the editor must not jump to the bottom",
    );
    assert(
      await dialog
        .getByLabel("상품명", { exact: true })
        .evaluate((el) => el === document.activeElement),
    );
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, 240, 160);
      context.fillStyle = "#fff";
      context.fillRect(40, 40, 160, 80);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const file = {
      name: "synthetic-product.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageData, "base64"),
    };
    await dialog.getByLabel("상품 사진", { exact: true }).setInputFiles(file);
    const cropStage = dialog.getByRole("group", {
      name: "상품 사진 위치 조절",
    });
    await cropStage.waitFor();
    assert(
      !(await dialog
        .getByRole("button", { name: "상품 저장", exact: true })
        .isEnabled()),
    );
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await cropStage.waitFor({ state: "detached" });
    assert(await dialog.isVisible());
    await dialog.getByLabel("상품 사진", { exact: true }).setInputFiles(file);
    await cropStage.click();
    assert(
      await cropStage.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
      "Crop controls must be above the modal backdrop",
    );
    await dialog
      .getByRole("button", { name: "자르기 적용", exact: true })
      .click();
    await dialog
      .getByRole("img", { name: "선택한 상품 이미지", exact: true })
      .waitFor();
    await dialog
      .getByRole("img", { name: "우측 하단 Westory 워터마크", exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "사진 다시 자르기", exact: true })
      .click();
    await cropStage.focus();
    await page.keyboard.press("Escape");
    await cropStage.waitFor({ state: "detached" });
    assert(
      await dialog.isVisible(),
      "Crop Escape must keep the product editor open",
    );
    await dialog.getByLabel("상품명", { exact: true }).fill("합성 새 상품");
    await dialog
      .getByLabel("상품 설명", { exact: true })
      .fill("모바일에서도 입력을 보존합니다.");
    await dialog.getByLabel("총 입고 (개)", { exact: true }).fill("9");
    await dialog
      .getByRole("button", { name: "상품 저장", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "저장 중…", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert(await dialog.isVisible(), "Saving must keep the editor open");
    await dialog.getByText("상품이 저장되었습니다.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert(await create.evaluate((el) => el === document.activeElement));
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).overflowY),
      "visible",
    );
    const edit = page
      .getByRole("button", { name: "상품·재고 수정", exact: true })
      .first();
    await edit.click();
    const editDialog = page.getByRole("dialog", {
      name: "상품·재고 수정",
      exact: true,
    });
    await editDialog.waitFor();
    assert.equal(
      await editDialog.getByLabel("상품명", { exact: true }).inputValue(),
      "매일 쓰는 노트",
    );
    const visibleStops = await editDialog
      .locator(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled)",
      )
      .all();
    await visibleStops.at(-1).focus();
    await page.keyboard.press("Tab");
    assert(
      await editDialog.evaluate((el) => el.contains(document.activeElement)),
      "Tab must remain in the modal",
    );
    await page.screenshot({
      path: path.join(evidence, `product-editor-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await editDialog.waitFor({ state: "detached" });
    assert(await edit.evaluate((el) => el === document.activeElement));
    await page
      .getByRole("button", { name: "학생 상점 미리보기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "매일 쓰는 노트 상세 보기", exact: true })
      .click();
    const detail = page.getByRole("dialog", {
      name: "매일 쓰는 노트",
      exact: true,
    });
    await detail.waitFor();
    assert.equal(
      await page.locator("dialog:modal").count(),
      0,
      "The editor top layer must be removed before product preview",
    );
    await detail
      .getByRole("button", { name: "상품 상세 닫기", exact: true })
      .click();
    await detail.waitFor({ state: "detached" });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(external, []);
    results.push({ width, status: "passed", geometry });
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + "/?view=teacher-products&scenario=error");
  await page.getByRole("button", { name: "상품 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "새 상품 등록",
    exact: true,
  });
  await dialog.getByLabel("상품명", { exact: true }).fill("보존할 입력");
  await dialog.getByRole("button", { name: "상품 저장", exact: true }).click();
  await dialog
    .getByText(
      "저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await dialog.getByLabel("상품명", { exact: true }).inputValue(),
    "보존할 입력",
  );
  await dialog.getByRole("button", { name: "상품 저장", exact: true }).click();
  await dialog.getByText("상품이 저장되었습니다.", { exact: true }).waitFor();
  await page.goto(origin + "/?view=teacher-products&scenario=readonly");
  assert.equal(
    await page.getByRole("button", { name: "상품 등록", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "상품·재고 수정", exact: true })
      .count(),
    0,
  );
  results.push({ scenario: "save-error-retry-and-readonly", status: "passed" });
  console.log(
    "PASS product editor dialog: 320/390/768/1280, create/edit, no page jump, focus, busy Escape, save retry and read-only",
  );
} finally {
  await browser?.close();
  child.kill();
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ results, productionWrites: 0 }, null, 2),
  );
  console.log("Evidence:", evidence);
}
