/** Exercise the real private draft; only the authenticated identity and toast sink are synthetic. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
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
const evidence =
  process.env.GONGSINMOONGO_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-gongsinmoongo-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
import {ADMIN_EMAIL} from ${source("src/lib/permissions.ts")};
const role=new URLSearchParams(location.search).get('role')||'admin';
const email=role==='admin'?ADMIN_EMAIL:role+'@fixture.invalid';
const user=role==='signed-out'?null:{uid:'fixture-'+role,email};
export const qa=window.gongsinQa={toasts:[],role};
export const useAuth=()=>({currentUser:user,user,userData:user?{uid:user.uid,email,role:role==='admin'?'teacher':role,teacherPortalEnabled:role==='staff',staffPermissions:role==='staff'?['lesson_read','quiz_read']:[]}:null,config:{year:'2026',semester:'2'},configReady:true,menuConfig:null});
export const useAppToast=()=>({showToast:value=>{qa.toasts.push(value);return 'fixture-toast';},dismissToast:()=>{}});
`;
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Draft from ${source("src/pages/teacher/components/SettingsGongsinmoongo.tsx")};
import ${source("src/assets/index.css")};
const constrained=new URLSearchParams(location.search).has('settings-shell');
createRoot(document.getElementById('root')).render(<MemoryRouter><main style={{containerType:'inline-size',containerName:'teacher-settings',padding:16,...(constrained?{width:'calc(100% - 500px)',marginLeft:500}:{})}}><Draft/></main></MemoryRouter>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: {
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "gongsinmoongo-auth-fixture",
      setup(plugin) {
        plugin.onResolve(
          { filter: /(?:^|\/)(?:contexts\/AuthContext|AppToastProvider)$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /(?:firebase|\/lib\/siteSettings)/i.test(file),
  ),
  "Private draft must not import a persistence or Firebase transport",
);
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = (
  bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || ""
).replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
let tailwind = "";
for (const filename of [
  process.env.PORTAL_DESIGN_TAILWIND_PATH,
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  path.join(os.tmpdir(), "westory-tailwind-fixture.js"),
].filter(Boolean)) {
  try {
    tailwind = await fs.readFile(filename, "utf8");
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
assert(
  tailwind,
  "Set PORTAL_DESIGN_TAILWIND_PATH to the locally cached production Tailwind runtime",
);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const assets = new Map([
  ["/", ["text/html", html]],
  ["/fixture.js", ["text/javascript", js]],
  ["/fixture.css", ["text/css", css]],
  ["/tailwind.js", ["text/javascript", tailwind]],
  ["/favicon.ico", ["image/x-icon", ""]],
]);
const server = http.createServer((request, response) => {
  const asset = assets.get(new URL(request.url, "http://localhost").pathname);
  response.statusCode = asset ? 200 : 404;
  response.setHeader("Content-Type", asset?.[0] || "text/plain");
  response.end(asset?.[1] || "Unknown fixture asset");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  screenshots = [],
  violations = [],
  pageErrors = [],
  storageSamples = [];
const report = {
  checks,
  screenshots,
  violations,
  pageErrors,
  storageSamples,
  actualComponent: "SettingsGongsinmoongo.tsx",
  stubbedModules: ["AuthContext", "AppToastProvider"],
  syntheticDataOnly: true,
};
try {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      assets.has(url.pathname) &&
      route.request().method() === "GET"
    )
      return route.continue();
    violations.push({
      url: route.request().url(),
      method: route.request().method(),
    });
    return route.abort();
  });
  await context.addInitScript(() => {
    window.persistenceQa = [];
    for (const method of ["getItem", "setItem", "removeItem", "clear"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.persistenceQa.push({
          kind: this === localStorage ? "localStorage" : "sessionStorage",
          method,
          key: args[0] || "",
        });
        return original.apply(this, args);
      };
    }
    for (const method of ["open", "deleteDatabase"]) {
      const original = indexedDB[method].bind(indexedDB);
      indexedDB[method] = (...args) => {
        window.persistenceQa.push({ kind: "indexedDB", method, key: args[0] });
        return original(...args);
      };
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const auditPersistence = async (label) => {
    const sample = await page.evaluate(() => ({
      operations: window.persistenceQa,
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    }));
    storageSamples.push({ label, ...sample });
    assert.deepEqual(
      sample,
      { operations: [], local: 0, session: 0, cookies: "" },
      `${label}: draft must not persist data`,
    );
    assert.deepEqual(
      violations,
      [],
      `${label}: draft must not request a backend or remote asset`,
    );
  };
  const noOverflow = async (label) =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      label + ": document overflows horizontally",
    );
  const screenshot = async (name) => {
    const filename = path.join(evidence, name + ".png");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.screenshot({ path: filename, fullPage: true });
    screenshots.push(filename);
  };

  for (const role of ["teacher", "student", "staff", "signed-out"]) {
    await page.goto(`${origin}/?role=${role}`);
    await page.getByRole("status").filter({ hasText: "관리자만" }).waitFor();
    assert.equal(
      await page.locator("[data-gongsin-draft]").count(),
      0,
      `${role}: private draft was accessible`,
    );
    await auditPersistence(`role-${role}`);
  }
  checks.push(
    "Real ADMIN_EMAIL gate rejects ordinary teachers, students, delegated staff, and signed-out visitors",
  );

  const nav = (label) =>
    page
      .getByRole("navigation", { name: "공신문고 초안 보기" })
      .getByRole("button", { name: label, exact: true });
  const studentNav = (label) =>
    page
      .getByRole("navigation", { name: "학생 공신문고 보기" })
      .getByRole("button", { name: label, exact: true });
  const privateOtherQuestion =
    "7번에서 교린 관계를 묻는다는 건 알겠는데, 자료의 어떤 부분을 봐야 하나요?";
  const privateDiagnosticQuestion =
    "교린이라는 말이 낯설어요. 어떤 뜻인지부터 알고 싶어요.";
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await page.locator("[data-gongsin-draft]").waitFor();
    await noOverflow(`inbox-${width}`);
    await screenshot(`inbox-${width}`);
    await nav("학생 화면").click();
    const story = page.getByRole("article", { name: "선정 스토리" });
    await story.waitFor();
    assert(
      !/(예시 학생|preview-student|답안|점수)/.test(await story.innerText()),
      "Selected story must omit original student identity and personal results",
    );
    assert.equal(
      await page.getByText(privateOtherQuestion, { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText(privateDiagnosticQuestion, { exact: true }).count(),
      0,
    );
    await noOverflow(`story-${width}`);
    await screenshot(`story-${width}`);
    const launcher = page.getByRole("button", { name: "학습 도구 미리보기" });
    await launcher.focus();
    await page.keyboard.press("Enter");
    assert.equal(await launcher.getAttribute("aria-expanded"), "true");
    const menu = page.locator("#gongsin-preview-tools");
    const [menuBox, launcherBox] = await Promise.all([
      menu.boundingBox(),
      launcher.boundingBox(),
    ]);
    assert(
      menuBox.y + menuBox.height <= launcherBox.y,
      "Floating choices must unfold above the launcher",
    );
    assert.equal(await menu.getByRole("button").count(), 2);
    assert(
      await menu
        .getByRole("button", { name: "역사 사전", exact: true })
        .evaluate((element) => element === document.activeElement),
      "Opening the launcher must focus its first choice",
    );
    await page.keyboard.press("ArrowDown");
    assert(
      await menu
        .getByRole("button", { name: "공神문고", exact: true })
        .evaluate((element) => element === document.activeElement),
      "Arrow keys must reach the Q&A choice",
    );
    await noOverflow(`launcher-${width}`);
    await screenshot(`tools-${width}`);
    await page.keyboard.press("Escape");
    assert.equal(await launcher.getAttribute("aria-expanded"), "false");
    assert(
      await launcher.evaluate((element) => element === document.activeElement),
      "Escape must restore focus to the launcher",
    );
    await studentNav("내 질문").click();
    assert.equal(
      await page.locator(".gongsin-my-questions article").count(),
      2,
    );
    assert.equal(
      await page.getByText(privateOtherQuestion, { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText(privateDiagnosticQuestion, { exact: true }).count(),
      0,
    );
    await noOverflow(`mine-${width}`);
    await nav("운영·연결").click();
    await page.getByText("중지 · 학생 비공개", { exact: true }).waitFor();
    await noOverflow(`operation-${width}`);
    await screenshot(`operation-${width}`);
    await auditPersistence(`viewport-${width}`);
  }
  checks.push(
    "320, 390, 768, 1280, and 1440 CSS px: inbox, anonymous story, own-only questions, operation controls, upward launcher, screenshots, no page overflow",
  );
  checks.push(
    "Keyboard Enter expands both learning tools; Escape closes and restores focus at every viewport",
  );

  for (const label of [
    "수업자료",
    "모의고사",
    "형성평가",
    "진단평가",
    "역사 사전",
  ]) {
    await page
      .locator(".gongsin-connection-list")
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .click();
    const preview = page.getByRole("region", { name: "학습 연결 미리보기" });
    await preview.waitFor();
    assert(
      await preview.evaluate((element) => element === document.activeElement),
      "Opening a source must focus the preview panel",
    );
    assert.match(await preview.innerText(), /실제 자료·평가를 열지 않습니다/);
    assert.equal(
      await preview.locator("a[href]").count(),
      0,
      "Preview must not start an assessment or open live learning data",
    );
    await page.getByRole("button", { name: "학습 연결 미리보기 닫기" }).click();
  }
  checks.push(
    "All four learning/assessment sources and the dictionary preview locally without opening live content or starting attempts",
  );

  await nav("학생 화면").click();
  await studentNav("질문하기").click();
  const send = page.getByRole("button", {
    name: "질문 보내기 (미리보기)",
    exact: true,
  });
  assert(await send.isDisabled(), "An empty question must not submit");
  await page.getByLabel("질문", { exact: true }).fill("   ");
  assert(await send.isDisabled(), "A whitespace-only question must not submit");
  await page.getByLabel(/^궁금한 자료/).selectOption("diagnostic");
  const longQuestion = "긴한글질문검증".repeat(90);
  await page.getByLabel("질문", { exact: true }).fill(longQuestion);
  await send.click();
  await page.getByText(longQuestion, { exact: true }).waitFor();
  assert.equal(await page.locator(".gongsin-my-questions article").count(), 3);
  await page.setViewportSize({ width: 320, height: 1000 });
  await noOverflow("long-korean-own-question-320");
  await screenshot("long-question-320");
  await auditPersistence("local-question-submit");
  checks.push(
    "Empty and whitespace submissions are blocked; a long Korean question is added to the local student's own list without storage or transport",
  );

  await page.setViewportSize({ width: 1280, height: 1000 });
  await nav("질문함").click();
  const formativeRow = () =>
    page.getByRole("button").filter({
      hasText: "조선 전기의 주변 나라와의 관계를 어떻게 비교하면 좋을까요?",
    });
  await formativeRow().click();
  const privateReply =
    "개별답변전용검증문구: 교과서의 조선 전기 대외 관계 설명을 비교해 보세요.";
  await page.getByLabel(/^개별 답변/).fill(privateReply);
  await page
    .getByRole("button")
    .filter({ hasText: privateDiagnosticQuestion })
    .click();
  await formativeRow().click();
  assert.equal(
    await page.getByLabel(/^개별 답변/).inputValue(),
    privateReply,
    "Switching questions must preserve an unsaved reply in memory",
  );
  await nav("운영·연결").click();
  await nav("질문함").click();
  assert.equal(
    await page.getByLabel(/^개별 답변/).inputValue(),
    privateReply,
    "Switching views must preserve an unsaved reply in memory",
  );
  await page
    .getByRole("button", { name: "답변 저장 (미리보기)", exact: true })
    .click();
  assert(
    await page
      .getByRole("button", { name: "답변 저장 (미리보기)", exact: true })
      .isDisabled(),
    "Unchanged replies must not trigger another save",
  );
  await page
    .getByRole("button", { name: "공개용 문구 편집", exact: true })
    .click();
  const publicQuestion = "조선 전기의 대외 관계를 비교하는 방법은?";
  const publicReply =
    "교류 상대와 교류 방식을 교과서에서 찾아 비교표로 정리해 보세요.";
  await page.getByLabel(/^공개 질문/).fill(publicQuestion);
  await page.getByLabel(/^공개 답변/).fill(publicReply);
  const selectStory = page.getByRole("button", {
    name: "스토리 선정 (미리보기)",
    exact: true,
  });
  const privacy = page.getByRole("checkbox", {
    name: /공개 문구와 연결 자료에 개인정보/,
  });
  assert(
    await selectStory.isDisabled(),
    "Public content must require the privacy check",
  );
  await privacy.check();
  assert(await selectStory.isEnabled());
  await page.getByLabel(/^공개 답변/).fill(publicReply + " ");
  assert.equal(
    await privacy.isChecked(),
    false,
    "Editing after checking privacy must reset confirmation",
  );
  await privacy.check();
  await page.getByRole("checkbox", { name: "형성평가", exact: true }).check();
  assert.equal(
    await privacy.isChecked(),
    false,
    "Changing related content must reset privacy confirmation",
  );
  await privacy.check();
  await selectStory.click();
  await nav("학생 화면").click();
  await studentNav("선정 스토리").click();
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("button", { name: "다음 스토리", exact: true })
      .click();
  await page
    .getByRole("heading", { name: publicQuestion, exact: true })
    .waitFor();
  const publishedText = await page
    .getByRole("article", { name: "선정 스토리" })
    .innerText();
  assert(publishedText.includes(publicReply));
  assert(
    !publishedText.includes(privateReply),
    "A selected story leaked the original private reply",
  );
  assert(
    !publishedText.includes("예시 학생"),
    "A selected story leaked its author identity",
  );
  assert(
    await page
      .getByRole("button", { name: "다음 스토리", exact: true })
      .isDisabled(),
  );
  await screenshot("new-selected-story");
  await nav("질문함").click();
  await page
    .getByRole("button", { name: "공개용 문구 편집", exact: true })
    .click();
  await page.getByRole("button", { name: "선정 해제", exact: true }).click();
  await nav("학생 화면").click();
  assert.equal(
    await page
      .getByRole("heading", { name: publicQuestion, exact: true })
      .count(),
    0,
  );
  await auditPersistence("reply-select-unselect");
  checks.push(
    "Private reply → separate public copy → privacy confirmation → story selection → removal; no private reply or student identity copied into the story",
  );

  await nav("운영·연결").click();
  await page
    .getByRole("checkbox", { name: "질문 접수 미리보기", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "선정 스토리 미리보기", exact: true })
    .uncheck();
  await page.getByText("중지 · 학생 비공개", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "학생 화면 확인", exact: true })
    .click();
  await page
    .getByText("아직 공개된 스토리가 없습니다.", { exact: true })
    .waitFor();
  await studentNav("질문하기").click();
  assert(await page.getByLabel("질문", { exact: true }).isDisabled());
  assert(await send.isDisabled());
  await page
    .getByText("지금은 질문을 받지 않고 있어요.", { exact: true })
    .waitFor();
  await screenshot("closed-student-preview");
  await auditPersistence("operation-preview-toggles");
  checks.push(
    "Reception/story switches affect only the preview; actual operation remains stopped and student-private, including empty/disabled states",
  );

  await page.reload();
  await nav("학생 화면").click();
  await page.getByRole("article", { name: "선정 스토리" }).waitFor();
  await studentNav("내 질문").click();
  assert.equal(await page.getByText(longQuestion, { exact: true }).count(), 0);
  assert.equal(await page.locator(".gongsin-my-questions article").count(), 2);
  await auditPersistence("reload-reset");
  checks.push(
    "Reload discards the local question, reply edits, and preview switches; no persistent state or server writes",
  );

  await nav("질문함").click();
  await page.locator(".gongsin-filter select").selectOption("waiting");
  assert.match(
    await page.getByRole("region", { name: "질문 답변 편집" }).innerText(),
    /조선 전기의 주변 나라와의 관계/,
  );
  assert.equal(
    await page.getByLabel(/^개별 답변/).inputValue(),
    "",
    "Waiting filter must not leave an answered question in the editor",
  );
  await page.locator(".gongsin-filter select").selectOption("selected");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "공개용 문구 편집", exact: true })
      .click();
    await page.getByRole("button", { name: "선정 해제", exact: true }).click();
  }
  await page.getByText("해당하는 질문이 없습니다.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("region", { name: "질문 답변 편집" }).count(),
    0,
    "An empty filter must not retain an unrelated question editor",
  );
  await nav("학생 화면").click();
  await studentNav("선정 스토리").click();
  await page
    .getByText("아직 선정된 스토리가 없습니다.", { exact: true })
    .waitFor();
  await auditPersistence("empty-inbox-and-stories");
  checks.push(
    "Filtered selection matches the visible list; removing all selected stories yields truthful empty list/editor/story states",
  );

  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/?settings-shell`);
    await page.locator("[data-gongsin-draft]").waitFor();
    await noOverflow(`settings-available-width-${width}`);
    const bounds = await page.locator("[data-gongsin-draft]").boundingBox();
    assert(
      bounds.width <= width - 500,
      "Settings fixture must reserve space for both existing navigation columns",
    );
    report.settingsLayout ||= [];
    report.settingsLayout.push({
      width,
      elements: await page
        .locator(
          ".ws-page-header, .gongsin-private, .gongsin-filter, .gongsin-filter > span",
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              className: element.className,
              text: element.textContent,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              overflow: style.overflow,
              lineHeight: style.lineHeight,
              clipPath: style.clipPath,
            };
          }),
        ),
    });
    await screenshot(`settings-shell-inbox-${width}`);
    await nav("학생 화면").click();
    await noOverflow(`settings-available-story-width-${width}`);
    await screenshot(`settings-shell-story-${width}`);
    await auditPersistence(`settings-shell-${width}`);
  }
  checks.push(
    "1280 and 1440 viewport widths also verified with 500 px reserved for existing primary/settings navigation",
  );

  assert.deepEqual(pageErrors, [], "Draft raised a browser exception");
  await auditPersistence("complete");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack || String(error);
  const failedPage = browser.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage.screenshot({
      path: path.join(evidence, "failure.png"),
      fullPage: true,
    });
    report.failureView = await failedPage.locator("body").innerText();
  }
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(
    JSON.stringify(
      { evidence, status: report.status, checks, screenshots },
      null,
      2,
    ),
  );
}
