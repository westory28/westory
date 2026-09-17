// Synthetic browser regression only; fixture enforces connect-src none.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createSettingsUiFixture } from "./serve-settings-ui-fixture.mjs";

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  [
    chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((path) => existsSync(path));
const screenshots =
  process.env.SETTINGS_UI_SCREENSHOTS ||
  mkdtempSync(join(tmpdir(), "westory-settings-qa-"));
const fixture = await createSettingsUiFixture();
let browser;
let count = 0;
try {
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) =>
    assert.ok(
      request.url().startsWith(fixture.url) ||
        request.url().startsWith("data:"),
      `Unexpected remote request: ${request.url()}`,
    ),
  );
  const visit = async (scenario = "normal", hash = "/teacher/settings") => {
    await page.goto(`${fixture.url}?scenario=${scenario}#${hash}`);
    await page
      .getByRole("heading", { name: "기본 환경 설정", exact: true })
      .waitFor();
    await page.getByLabel("운영 전환 학년도", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector("#root")?.textContent?.includes("확인 중..."),
    );
  };
  const state = async () =>
    JSON.parse(await page.locator("#fixture-state").textContent());
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await visit();
    assert.equal(
      await page
        .getByRole("navigation", { name: "관리자 설정 메뉴" })
        .getByText("지난 학기 기록")
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("navigation", { name: "관리자 설정 메뉴" })
        .getByText("학생 접속 관리")
        .count(),
      0,
    );
    assert.equal(await page.getByText("학생 메뉴 표시 제어").count(), 0);
    const readiness = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "학기 준비 현황" }) });
    assert.equal(await readiness.getAttribute("open"), null);
    assert.equal(
      await readiness.getByText("학기 기본 정보", { exact: true }).isVisible(),
      false,
    );
    await readiness.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await readiness.getByText("학기 기본 정보", { exact: true }).isVisible(),
      true,
    );
    await page.keyboard.press("Enter");
    await noOverflow();
    const activate = page.getByRole("button", {
      name: "운영 학기 전환",
      exact: true,
    });
    await activate.scrollIntoViewIfNeeded();
    const activationBounds = await activate.boundingBox();
    const memoBounds = await page
      .getByRole("button", { name: "패치 메모 열기", exact: true })
      .boundingBox();
    assert.ok(activationBounds && memoBounds);
    assert.equal(
      activationBounds.x < memoBounds.x + memoBounds.width &&
        activationBounds.x + activationBounds.width > memoBounds.x &&
        activationBounds.y < memoBounds.y + memoBounds.height &&
        activationBounds.y + activationBounds.height > memoBounds.y,
      false,
      "Semester activation overlaps memo",
    );
    await page.screenshot({
      path: join(screenshots, `settings-${width}.png`),
      fullPage: true,
    });
    count++;

    await page
      .getByRole("button", { name: "인터페이스 설정", exact: true })
      .click();
    await page
      .getByRole("button", { name: "사이트맵 메뉴", exact: true })
      .click();
    const save = page.getByRole("button", {
      name: /사이트맵 저장/,
    });
    const memo = page.getByRole("button", {
      name: "패치 메모 열기",
      exact: true,
    });
    await save.waitFor();
    const a = await save.boundingBox(),
      b = await memo.boundingBox();
    assert.ok(a && b);
    assert.equal(
      a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y,
      false,
      "Sitemap save overlaps memo",
    );
    await noOverflow();
    await page.screenshot({
      path: join(screenshots, `sitemap-${width}.png`),
      fullPage: true,
    });
    count++;
  }
  await visit("stale");
  assert.equal(await page.getByText("재확인 필요", { exact: true }).count(), 1);
  assert.equal(
    await page.getByText("일부 비어 있음", { exact: true }).count(),
    0,
  );
  await visit("incomplete");
  assert.equal(
    await page.getByText("필수 항목 확인", { exact: true }).count(),
    1,
  );
  count += 2;

  await visit("normal", "/teacher/settings?tab=student-access");
  assert.equal(new URL(page.url()).hash, "#/teacher/settings");
  await page.goto(`${fixture.url}#/teacher/settings?tab=archive-records`);
  await page
    .getByRole("heading", { name: "학생 명단 관리", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).hash, "#/teacher/students");
  count += 2;

  await visit("teacher");
  assert.equal(
    await page.getByRole("heading", { name: "학생 접속", exact: true }).count(),
    0,
  );
  assert.equal((await state()).accessReads, 0);
  assert.equal((await state()).accessWrites, 0);
  count++;

  await page.goto(`${fixture.url}?scenario=settings-error#/teacher/settings`);
  await page
    .getByText("기본 설정을 불러오지 못했습니다.", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "접속 허용", exact: true }).waitFor();
  assert.equal((await state()).accessWrites, 0);
  count++;

  await visit("lost-response");
  await page.getByRole("button", { name: "접속 허용", exact: true }).click();
  assert.equal(
    (await state()).accessWrites,
    0,
    "Opening confirmation must not write",
  );
  await page.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal((await state()).accessWrites, 0, "Cancel must not write");
  await page.getByRole("button", { name: "접속 허용", exact: true }).click();
  await page
    .getByRole("button", { name: "접속 허용 적용", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "변경 결과를 확인하지 못했습니다" })
    .waitFor();
  await page.waitForFunction(() => {
    const current = JSON.parse(
      document.getElementById("fixture-state").textContent,
    );
    return current.accessWrites === 1 && current.closed === false;
  });
  assert.equal((await state()).closed, false);
  assert.equal(
    await page
      .getByRole("button", { name: "접속 허용 적용", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "학생 접속 상태 새로고침", exact: true })
    .click();
  await page.getByText("허용 중", { exact: true }).waitFor();
  assert.equal(
    (await state()).accessWrites,
    1,
    "Refresh must not replay uncertain change",
  );
  count++;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: count,
      screenshots,
      scenarios:
        "responsive settings/sitemap, collapsed readiness, stale/incomplete, legacy redirects, administrator boundary, isolated error recovery, uncertain write recovery",
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => fixture.server.close(resolve));
}
