/** Exercise actual draft/footer components inside the production teacher-layout DOM/CSS contract. */
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
export const qa=window.gongsinQa={toasts:[],backendCalls:[],role};
export const useAuth=()=>({currentUser:user,user,userData:user?{uid:user.uid,email,role:role==='admin'?'teacher':role,teacherPortalEnabled:role==='staff',staffPermissions:role==='staff'?['lesson_read','quiz_read']:[]}:null,config:{year:'2026',semester:'2'},configReady:true,menuConfig:null,interfaceConfig:{footerText:'Copyright © Westory. All rights reserved.'}});
export const useAppToast=()=>({showToast:value=>{qa.toasts.push(value);return 'fixture-toast';},dismissToast:()=>{}});
`;
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {PortalWorkspaceFooterProvider,PortalFallbackFooter} from ${source("src/components/common/PortalWorkspace.tsx")};
import Draft from ${source("src/pages/teacher/ManageGongsinmoongo.tsx")};
import ${source("src/assets/index.css")};
import ${source("src/components/layout/teacherLayout.css")};
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/teacher/gongsinmoongo']}><PortalWorkspaceFooterProvider><div className="flex min-h-screen flex-col bg-gray-50 teacher-layout"><aside className="teacher-sidebar" aria-hidden="true"><div className="teacher-sidebar-brand-row">Westory</div></aside><header className="teacher-header teacher-account-header"><div className="header-container"><div className="teacher-header-start">Westory</div><div className="header-right"><span>예시 관리자</span><button className="btn-logout" disabled>로그아웃</button></div><button className="teacher-navigation-toggle" aria-label="교사 메뉴 예시" disabled>☰</button></div></header><main className="min-h-0 w-full flex-1"><Draft/></main><PortalFallbackFooter teacher/></div></PortalWorkspaceFooterProvider></MemoryRouter>);
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
          { filter: /^(firebase\/firestore)$|(?:^|\/)lib\/firebase$/ },
          () => ({ path: "transport", namespace: "fixture-transport" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture-transport" }, () => ({
          contents:
            "const blocked=(name)=>(...args)=>{window.gongsinQa.backendCalls.push(name);throw new Error('Unexpected backend call: '+name)};export const db={};export const doc=blocked('doc');export const getDoc=blocked('getDoc');",
          loader: "js",
        }));
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
  actualComponent:
    "ManageGongsinmoongo.tsx / SettingsGongsinmoongo.tsx / GongsinStudentPreview.tsx",
  stubbedModules: [
    "AuthContext",
    "AppToastProvider",
    "Firebase initialization and Firestore transport",
  ],
  layoutContract:
    "MainLayout teacher-layout/main/provider structure; production account-header CSS and actual Footer; synthetic account/header content avoids session lifecycle side effects",
  deviceCoverage:
    "Desktop browser responsive emulation, not physical-device testing",
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
      backendCalls: window.gongsinQa?.backendCalls || [],
    }));
    storageSamples.push({ label, ...sample });
    assert.deepEqual(
      sample,
      { operations: [], local: 0, session: 0, cookies: "", backendCalls: [] },
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
  const desktopGeometry = async (label, checkStudent = false) => {
    const sample = await page.evaluate(() => {
      const rect = (element) => {
        if (!element) return null;
        const b = element.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          right: b.right,
          bottom: b.bottom,
        };
      };
      const controls = [
        ...document.querySelectorAll(
          "main button,main input,main textarea,main select",
        ),
      ].filter(
        (element) =>
          element.getClientRects().length &&
          !element.closest(".gsp-conversation,[hidden]"),
      );
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentHeight: document.documentElement.scrollHeight,
        bodyHeight: document.body.scrollHeight,
        header: rect(document.querySelector(".teacher-account-header")),
        footer: rect(document.querySelector(".teacher-layout-footer")),
        main: rect(document.querySelector(".teacher-layout > main")),
        content: rect(document.querySelector("[data-gongsin-draft]")),
        contentAvailableWidth: (() => {
          const element = document.querySelector("[data-gongsin-draft]");
          const style = getComputedStyle(element);
          return (
            element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
          );
        })(),
        studentOuterCard: document
          .querySelector(".gongsin-student-stage")
          ?.classList.contains("ws-surface"),
        student: rect(document.querySelector(".gongsin-student-preview")),
        chat: rect(document.querySelector(".gsp-chat-pane")),
        rail: rect(document.querySelector(".gsp-tools-rail")),
        conversation: rect(document.querySelector(".gsp-conversation")),
        clippedControls: controls
          .map((element) => ({
            name:
              element.getAttribute("aria-label") ||
              element.textContent?.trim().slice(0, 80),
            rect: rect(element),
          }))
          .filter(
            (item) =>
              item.rect.y < -1 ||
              item.rect.bottom > innerHeight + 1 ||
              item.rect.x < -1 ||
              item.rect.right > innerWidth + 1,
          ),
      };
    });
    report.desktopGeometry ||= [];
    report.desktopGeometry.push({ label, ...sample });
    assert(
      sample.documentHeight <= sample.viewport.height + 1,
      `${label}: document scroll height ${sample.documentHeight} exceeds ${sample.viewport.height}`,
    );
    assert(
      sample.bodyHeight <= sample.viewport.height + 1,
      `${label}: body scroll height ${sample.bodyHeight} exceeds ${sample.viewport.height}`,
    );
    assert.equal(
      sample.header.height,
      56,
      `${label}: actual desktop account header must include its 8px top space`,
    );
    assert(
      sample.footer &&
        sample.footer.height >= 48 &&
        sample.footer.bottom <= sample.viewport.height + 1,
      `${label}: actual Footer must be visible and counted`,
    );
    assert.deepEqual(
      sample.clippedControls,
      [],
      `${label}: controls are clipped outside the viewport`,
    );
    if (checkStudent) {
      assert(
        sample.student.width > 560,
        `${label}: desktop student frame remains capped at 560px`,
      );
      assert(
        sample.student.width >= sample.contentAvailableWidth - 1,
        `${label}: student preview must use the available content width`,
      );
      assert.equal(
        sample.studentOuterCard,
        false,
        `${label}: student preview must not have a redundant outer surface card`,
      );
      assert(
        sample.rail && sample.chat && sample.rail.x >= sample.chat.right - 1,
        `${label}: learning tools must occupy a separate rail beside the chat`,
      );
      assert(
        sample.conversation.height > 70,
        `${label}: conversation must retain usable internal scrolling space`,
      );
    }
  };
  const screenshot = async (name, target) => {
    const filename = path.join(evidence, name + ".png");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    if (target) await target.screenshot({ path: filename });
    else await page.screenshot({ path: filename, fullPage: true });
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
      .getByRole("button", {
        name: label === "운영·연결" ? "운영 설정" : label,
        exact: true,
      });
  const student = () =>
    page.getByRole("region", { name: "학생 공신문고 미리보기", exact: true });
  const warning = () =>
    page.getByRole("dialog", {
      name: "질문하기 전에 확인해 주세요",
      exact: true,
    });
  const acknowledgeWarning = async () => {
    await student().waitFor();
    if (
      await student()
        .getByRole("button", { name: "질문 안내 확인", exact: true })
        .count()
    ) {
      await student().locator(".gsp-guidelines-dialog").waitFor();
      await student()
        .locator(".gsp-guidelines-dialog")
        .getByRole("button", { name: "확인했어요", exact: true })
        .click();
      await student()
        .getByRole("button", { name: "질문 안내", exact: true })
        .waitFor();
    }
  };
  const studentNav = (label) =>
    student()
      .getByRole("navigation", { name: "공신문고 학생 보기" })
      .getByRole("button", { name: label, exact: true });
  const sidebar = () =>
    page.getByRole("complementary", { name: "질문함", exact: true });
  const row = (text) =>
    sidebar().locator(".gongsin-question-row").filter({ hasText: text });
  const selectQuestionRow = async (text) => {
    const previous = sidebar().getByRole("button", {
      name: "질문 목록 이전 페이지",
      exact: true,
    });
    while (await previous.isEnabled()) await previous.click();
    for (let count = 0; count < 50; count++) {
      if (await row(text).count()) {
        await row(text).click();
        return;
      }
      const next = sidebar().getByRole("button", {
        name: "질문 목록 다음 페이지",
        exact: true,
      });
      if (await next.isDisabled()) break;
      await next.click();
    }
    assert.fail("Question not present in any list page: " + text);
  };
  const settingsNav = (label) =>
    page
      .getByRole("navigation", { name: "공신문고 설정 항목" })
      .getByRole("button", { name: label, exact: true });
  const settingsPanel = () =>
    page.getByRole("region", { name: "초안 설정", exact: true });
  const openSettings = async (label) => {
    await nav("운영·연결").click();
    await settingsNav(label).click();
  };
  const applySettings = () =>
    settingsPanel().getByRole("button", {
      name: "설정 적용 (미리보기)",
      exact: true,
    });
  const teacherBell = () =>
    page.getByRole("button", { name: /^교사 알림 미리보기/ });
  const studentBell = () =>
    student().getByRole("button", { name: /^알림, 읽지 않은 답변/ });
  const save = () =>
    page.getByRole("button", { name: "답변 저장 (미리보기)", exact: true });
  const editor = () =>
    page.getByRole("region", { name: "질문 답변 편집", exact: true });
  const composer = () =>
    student().getByRole("textbox", { name: "선생님께 질문", exact: true });
  const send = () =>
    student().getByRole("button", {
      name: "질문 보내기 (미리보기)",
      exact: true,
    });
  const assertFocused = async (locator, message) => {
    try {
      await page.waitForFunction(
        (element) => element === document.activeElement,
        await locator.elementHandle(),
        { timeout: 2000 },
      );
    } catch (error) {
      throw new Error(message, { cause: error });
    }
  };
  const assertUncovered = async (locator, label) => {
    const sample = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.1, 0.9],
        [0.9, 0.9],
        [0.5, 0.5],
      ].map(([horizontal, vertical]) => {
        const x = rect.x + rect.width * horizontal,
          y = rect.y + rect.height * vertical;
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          uncovered: hit === element || element.contains(hit),
          hit: hit?.tagName + "." + hit?.className,
        };
      });
    });
    report.overlayHitTests ||= [];
    report.overlayHitTests.push({ label, sample });
    assert(
      sample.every((point) => point.uncovered),
      `${label}: another element covers the title or close control: ${JSON.stringify(sample)}`,
    );
  };
  const privateOtherQuestion =
    "7번에서 교린 관계를 묻는다는 건 알겠는데, 자료의 어떤 부분을 봐야 하나요?";
  const privateDiagnosticQuestion =
    "교린이라는 말이 낯설어요. 어떤 뜻인지부터 알고 싶어요.";
  const formativeQuestion =
    "조선 전기의 주변 나라와의 관계를 어떻게 비교하면 좋을까요?";
  const assertStudentPrivacy = async () => {
    for (const question of [privateOtherQuestion, privateDiagnosticQuestion])
      assert.equal(
        await student().getByText(question, { exact: true }).count(),
        0,
        "Another student's private question appeared in student preview",
      );
    assert.equal(
      await student()
        .locator(
          '[data-question-id="example-2"], [data-question-id="example-4"]',
        )
        .count(),
      0,
    );
  };
  const submit = async (text) => {
    await composer().fill(text);
    await send().click();
    await student().getByText(text, { exact: true }).waitFor();
  };
  const openTeacherNotifications = async () => {
    if ((await teacherBell().getAttribute("aria-expanded")) !== "true")
      await teacherBell().click();
    return page.getByRole("region", {
      name: "교사 알림 미리보기",
      exact: true,
    });
  };
  const openStudentNotifications = async () => {
    if ((await studentBell().getAttribute("aria-expanded")) !== "true")
      await studentBell().click();
    return student().locator("#gsp-notifications");
  };

  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin);
    await page.locator("[data-gongsin-draft]").waitFor();
    await noOverflow(`inbox-${width}`);
    if (width >= 768) {
      const [sideBox, detailBox] = await Promise.all([
        sidebar().boundingBox(),
        page.locator(".gongsin-question-detail").boundingBox(),
      ]);
      assert(
        sideBox.x >= (width >= 1024 ? 231 : 0) &&
          sideBox.width >= 240 &&
          sideBox.width <= 340,
        "Primary navigation and a bounded question sidebar must retain their columns",
      );
      assert(
        detailBox.x >= sideBox.x + sideBox.width - 1,
        "Question detail must be separate from the list sidebar",
      );
      report.desktopLayout ||= [];
      report.desktopLayout.push({ width, sidebar: sideBox, detail: detailBox });
    } else {
      const toggle = sidebar().locator(".teacher-settings-menu-toggle");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await selectQuestionRow(formativeQuestion);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await assertFocused(
        toggle,
        "Selecting a mobile question must restore disclosure focus",
      );
      await editor()
        .getByRole("heading", { name: formativeQuestion, exact: true })
        .waitFor();
      await toggle.click();
      await page.keyboard.press("Escape");
      await assertFocused(
        toggle,
        "Escape must restore mobile list disclosure focus",
      );
    }
    await screenshot(`inbox-${width}`);
    assert.equal(
      await warning().count(),
      0,
      "First-use warning must not open while teacher view is active",
    );
    await nav("학생 화면").click();
    await warning().waitFor();
    assert(
      await student().locator(".gsp-send").isDisabled(),
      "First-use acknowledgement must precede question sending",
    );
    await page.keyboard.press("Escape");
    assert.equal(await warning().isVisible(), false);
    assert(
      await student().locator(".gsp-send").isDisabled(),
      "Dismissing guidance must not count as acknowledgement",
    );
    await composer().fill("안내 확인 전 작성한 질문");
    await warning().waitFor();
    assert.equal(await composer().inputValue(), "안내 확인 전 작성한 질문");
    assert(
      await student().locator(".gsp-send").isDisabled(),
      "Non-empty text must remain unsendable before acknowledgement",
    );
    await warning()
      .getByRole("button", { name: "질문 안내 닫기", exact: true })
      .click();
    await student()
      .getByRole("button", { name: "질문 안내 확인", exact: true })
      .click();
    await warning().waitFor();
    assert(
      await warning().evaluate((element) =>
        element.contains(document.activeElement),
      ),
      "First-use warning must receive keyboard focus",
    );
    await screenshot(`first-use-warning-${width}`);
    await assertUncovered(
      warning().getByRole("heading", {
        name: "질문하기 전에 확인해 주세요",
        exact: true,
      }),
      `guidance-title-${width}`,
    );
    await assertUncovered(
      warning().getByRole("button", { name: "질문 안내 닫기", exact: true }),
      `guidance-close-${width}`,
    );
    await acknowledgeWarning();
    assert(
      await send().isEnabled(),
      "Explicit acknowledgement must enable sending existing text",
    );
    await composer().fill("");
    await student().locator(".gsp-conversation").waitFor();
    assert.equal(
      await studentNav("내 질문").getAttribute("aria-pressed"),
      "true",
      "Student preview must open in private conversation",
    );
    assert.equal(await student().locator(".gsp-message-pair").count(), 2);
    await assertStudentPrivacy();
    await noOverflow(`dm-${width}`);
    await screenshot(`dm-${width}`);
    const launcher = student().getByRole("button", {
      name: "학습 도구 미리보기",
      exact: true,
    });
    await launcher.focus();
    await page.keyboard.press("Enter");
    const menu = student().locator("#gsp-learning-tools");
    assert.equal(await launcher.getAttribute("aria-expanded"), "true");
    const [menuBox, launcherBox] = await Promise.all([
      menu.boundingBox(),
      launcher.boundingBox(),
    ]);
    assert(
      menuBox.y + menuBox.height <= launcherBox.y + 1,
      "Learning tools must unfold upward",
    );
    assert.equal(await menu.getByRole("button").count(), 2);
    await assertFocused(
      menu.getByRole("button", { name: "역사 사전", exact: true }),
      "Tools must focus the first item",
    );
    await page.keyboard.press("ArrowDown");
    await assertFocused(
      menu.getByRole("button", { name: "공神문고", exact: true }),
      "ArrowDown must select Q&A",
    );
    await screenshot(`tools-${width}`);
    await page.keyboard.press("Escape");
    await assertFocused(launcher, "Escape must restore launcher focus");
    await studentNav("선정 스토리").click();
    const story = student().getByRole("article", {
      name: "선정 스토리",
      exact: true,
    });
    await story.waitFor();
    assert(
      !/(예시 학생|preview-student|개인 답안|점수)/.test(
        await story.innerText(),
      ),
      "Story leaked private identity or results",
    );
    await assertStudentPrivacy();
    await noOverflow(`story-${width}`);
    await screenshot(`story-${width}`);
    await nav("운영·연결").click();
    await page.getByText("초안 · 학생 비공개", { exact: true }).waitFor();
    await noOverflow(`operation-${width}`);
    await screenshot(`operation-${width}`);
    await auditPersistence(`viewport-${width}`);
  }
  checks.push(
    "First-use warning is shown only in active student view; Escape keeps sending blocked until explicit acknowledgement; keyboard focus stays in the guidance dialog",
    "320/390/768/1280/1440: actual primary 232px + separate question sidebar; mobile disclosure/selection/focus; default own-only DM; stories; upward tools; no horizontal overflow",
  );

  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin);
    await page.locator("[data-gongsin-draft]").waitFor();
    await desktopGeometry(`inbox-${width}x${height}`);
    await screenshot(`desktop-inbox-${width}x${height}`);
    await page
      .getByRole("button", { name: "공개용 문구 편집", exact: true })
      .click();
    await desktopGeometry(`public-editor-${width}x${height}`);
    await nav("학생 화면").click();
    await acknowledgeWarning();
    await desktopGeometry(`dm-${width}x${height}`, true);
    await screenshot(`desktop-dm-${width}x${height}`);
    const conversation = await student()
      .locator(".gsp-conversation")
      .evaluate((element) => ({
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflow: getComputedStyle(element).overflowY,
      }));
    assert(
      /auto|scroll/.test(conversation.overflow),
      "Only the conversation must provide scrolling for long messages",
    );
    for (const tab of ["기본", "알림", "이용안내", "학습연결", "학생제한"]) {
      await openSettings(tab);
      await desktopGeometry(`settings-${tab}-${width}x${height}`);
      await screenshot(`desktop-settings-${tab}-${width}x${height}`);
    }
    await auditPersistence(`desktop-${width}x${height}`);
  }
  checks.push(
    "Desktop browser responsive emulation 1280×720/1366×768/1440×900/1920×1080: production 56px account header and actual Footer fit without body/page scrolling, visible controls stay in bounds, full-width DM has an independent tool rail and conversation scroll",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav("학생 화면").click();
  await acknowledgeWarning();
  await studentNav("내 질문").click();
  for (const [sourceId, label] of [
    ["lesson", "수업자료"],
    ["mock", "모의고사"],
    ["formative", "형성평가"],
    ["diagnostic", "진단평가"],
    ["dictionary", "역사 사전"],
  ]) {
    if (sourceId === "mock") {
      await student()
        .getByRole("button", { name: "오답 노트", exact: true })
        .click();
      await student()
        .getByRole("button", { name: "이 문항 질문하기", exact: true })
        .click();
    } else {
      const remove = student().getByRole("button", {
        name: "모의고사 문항 연결 해제",
        exact: true,
      });
      if (await remove.count()) await remove.click();
      await student()
        .getByRole("combobox", { name: "질문할 자료" })
        .selectOption(sourceId);
    }
    const text =
      "학습 연결 검증: " + label + " 자료에서 근거를 어떻게 찾을까요?";
    await submit(text);
    const trigger = student()
      .locator(".gsp-message-pair")
      .filter({ hasText: text })
      .locator(".gsp-message-source");
    await trigger.click();
    const preview = page.getByRole("region", {
      name: "학습 연결 미리보기",
      exact: true,
    });
    await assertFocused(preview, "Source preview must receive focus");
    assert.match(await preview.innerText(), /실제 자료·평가를 열지 않습니다/);
    assert.equal(await preview.locator("a[href]").count(), 0);
    await page.keyboard.press("Escape");
    await assertFocused(
      trigger,
      "Closing source preview must restore its trigger",
    );
  }
  checks.push(
    "All four learning/assessment categories and dictionary open only local preview panels with correct focus restoration",
  );

  await page.reload();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert(
    await send().isDisabled(),
    "Empty question submission must be blocked",
  );
  await composer().fill("   ");
  assert(
    await send().isDisabled(),
    "Whitespace question submission must be blocked",
  );
  assert.equal(
    await student()
      .getByRole("combobox", { name: "질문할 자료" })
      .locator('option[value="mock"]')
      .count(),
    0,
    "Mock exam must not be a general source option",
  );
  const question =
    "알림왕복검증: 조선 전기 주변 나라와의 교류를 구분하는 기준은 무엇인가요?";
  await student()
    .getByRole("combobox", { name: "질문할 자료" })
    .selectOption("lesson");
  await submit(question);
  assert.equal(
    await teacherBell().getAttribute("aria-label"),
    "교사 알림 미리보기, 새 알림 1개",
  );
  const mine = student()
    .locator(".gsp-message-pair")
    .filter({ hasText: question });
  const questionId = await mine.getAttribute("data-question-id");
  const visibleAfterSubmit = await mine.evaluate((element) => {
    const panel = element.closest(".gsp-conversation");
    const a = element.getBoundingClientRect(),
      b = panel.getBoundingClientRect();
    return a.bottom <= b.bottom + 2 && a.bottom > b.top;
  });
  assert(
    visibleAfterSubmit,
    "Newly sent DM must remain visible within the conversation",
  );
  await screenshot("new-question-teacher-unread");
  let teacherPopup = await openTeacherNotifications();
  assert.equal(await teacherPopup.getByRole("button").count(), 1);
  await teacherPopup.getByRole("button").first().click();
  await editor()
    .getByRole("heading", { name: question, exact: true })
    .waitFor();
  await assertFocused(
    page.locator(".gongsin-question-detail"),
    "Teacher notification must focus the exact question detail",
  );
  assert.equal(await row(question).getAttribute("aria-pressed"), "true");
  assert.equal(
    await teacherBell().getAttribute("aria-label"),
    "교사 알림 미리보기",
  );
  const privateReply =
    "개별답변전용검증: 교과서에서 교류 상대와 교류 방식이 드러나는 근거를 찾아 비교하세요.";
  await page.getByLabel(/^개별 답변/).fill(privateReply);
  await selectQuestionRow(privateDiagnosticQuestion);
  await selectQuestionRow(question);
  assert.equal(
    await page.getByLabel(/^개별 답변/).inputValue(),
    privateReply,
    "Unsaved reply must survive question changes",
  );
  await nav("운영·연결").click();
  await nav("질문함").click();
  assert.equal(
    await page.getByLabel(/^개별 답변/).inputValue(),
    privateReply,
    "Unsaved reply must survive view changes",
  );
  await save().click();
  assert(await save().isDisabled(), "Unchanged reply must be a no-op");
  await page.getByLabel(/^개별 답변/).fill(privateReply + "   ");
  assert(
    await save().isDisabled(),
    "Whitespace-only change must remain a no-op",
  );
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 1개",
  );
  let studentPopup = await openStudentNotifications();
  assert.equal(
    await studentPopup.getByRole("button").count(),
    1,
    "One saved reply must create exactly one local recipient notification",
  );
  await screenshot("student-reply-notification");
  await studentPopup.getByRole("button").first().click();
  await assertFocused(
    student().locator(`[data-question-id="${questionId}"]`),
    "Student notification must focus its own exact question",
  );
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 0개",
  );
  await student().getByText(privateReply, { exact: true }).waitFor();
  const personalReplyLinks = await student()
    .locator(`[data-question-id="${questionId}"] .gsp-reply-links button`)
    .allTextContents();
  studentPopup = await openStudentNotifications();
  assert.match(await studentPopup.innerText(), /읽음/);
  await page.keyboard.press("Escape");
  await assertFocused(
    studentBell(),
    "Student notification Escape restores focus",
  );
  await nav("질문함").click();
  await selectQuestionRow(privateOtherQuestion);
  await page
    .getByLabel(/^개별 답변/)
    .fill("학생B개별답변검증: 자료 속 교류 방식을 먼저 확인해 보세요.");
  await save().click();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 0개",
  );
  studentPopup = await openStudentNotifications();
  assert.equal(
    await studentPopup.getByRole("button").count(),
    1,
    "A reply to student B must not notify student A",
  );
  await page.keyboard.press("Escape");
  await assertStudentPrivacy();
  assert.equal(
    await student()
      .getByText("학생B개별답변검증: 자료 속 교류 방식을 먼저 확인해 보세요.", {
        exact: true,
      })
      .count(),
    0,
  );
  checks.push(
    "Local question → one teacher unread notification → exact selected question; reply → exactly one recipient-only student notification → read/focus target; unchanged/whitespace replies are no-ops",
  );

  await nav("질문함").click();
  await selectQuestionRow(question);
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
  assert(await selectStory.isDisabled());
  await privacy.check();
  await page.getByLabel(/^공개 답변/).fill(publicReply + " ");
  assert.equal(await privacy.isChecked(), false);
  await privacy.check();
  await page.getByRole("checkbox", { name: "형성평가", exact: true }).check();
  assert.equal(await privacy.isChecked(), false);
  await privacy.check();
  await selectStory.click();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.deepEqual(
    await student()
      .locator(`[data-question-id="${questionId}"] .gsp-reply-links button`)
      .allTextContents(),
    personalReplyLinks,
    "Public story link edits must not change the private DM reply links",
  );
  studentPopup = await openStudentNotifications();
  assert.equal(
    await studentPopup.getByRole("button").count(),
    1,
    "Story curation must not create a personal reply notification",
  );
  await page.keyboard.press("Escape");
  await studentNav("선정 스토리").click();
  for (let i = 0; i < 2; i++)
    await student()
      .getByRole("button", { name: "다음 스토리", exact: true })
      .click();
  const story = student().getByRole("article", {
    name: "선정 스토리",
    exact: true,
  });
  await story
    .getByRole("heading", { name: publicQuestion, exact: true })
    .waitFor();
  assert((await story.innerText()).includes(publicReply));
  assert(!(await story.innerText()).includes(privateReply));
  assert(!/예시 학생|preview-student/.test(await story.innerText()));
  await screenshot("curated-story");
  await nav("질문함").click();
  if (
    await page
      .getByRole("button", { name: "공개용 문구 편집", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "공개용 문구 편집", exact: true })
      .click();
  await page.getByRole("button", { name: "선정 해제", exact: true }).click();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.equal(
    await student()
      .getByRole("heading", { name: publicQuestion, exact: true })
      .count(),
    0,
  );
  checks.push(
    "Private reply remains separate from a reviewed public snapshot; text/source edits reset privacy confirmation; selection/removal creates no reply notification",
  );

  await studentNav("내 질문").click();
  await composer().fill("탭전환중미전송질문");
  await nav("운영·연결").click();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.equal(
    await composer().inputValue(),
    "탭전환중미전송질문",
    "Teacher view changes must preserve unsent student preview text",
  );
  await composer().fill("");
  await student()
    .getByRole("button", { name: "오답 노트", exact: true })
    .click();
  const wrongNote = student().getByRole("region", {
    name: "모의고사 오답 노트 미리보기",
    exact: true,
  });
  await wrongNote.waitFor();
  assert.match(await wrongNote.innerText(), /제출 완료/);
  assert.equal(await wrongNote.locator("a[href]").count(), 0);
  await screenshot("wrong-note-entry");
  await wrongNote
    .getByRole("button", { name: "이 문항 질문하기", exact: true })
    .click();
  await assertFocused(
    composer(),
    "Wrong-note question entry must focus the composer",
  );
  await student()
    .getByText("오답 노트 · 모의고사 1회 · 7번", { exact: true })
    .waitFor();
  assert.equal(
    await student().getByRole("combobox", { name: "질문할 자료" }).count(),
    0,
    "Wrong-note attachment must not be spoofable through the general selector",
  );
  const mockQuestion =
    "오답노트경유검증: 7번 자료의 어떤 근거를 다시 살펴보면 좋을까요?";
  await submit(mockQuestion);
  teacherPopup = await openTeacherNotifications();
  await teacherPopup.getByRole("button").first().click();
  await editor()
    .getByRole("heading", { name: mockQuestion, exact: true })
    .waitFor();
  assert.match(await row(mockQuestion).innerText(), /모의고사/);
  assert.equal(
    await page
      .locator('a[href*="/quiz/run"], a[href*="/student/quiz"]')
      .count(),
    0,
    "Private prototype must never start a mock attempt",
  );
  await nav("학생 화면").click();
  await acknowledgeWarning();
  await student()
    .getByRole("button", { name: "모의고사 문항 연결 해제", exact: true })
    .click();
  assert.equal(
    await student().getByRole("combobox", { name: "질문할 자료" }).inputValue(),
    "lesson",
  );
  checks.push(
    "Mock exam is absent from the general source picker; only completed wrong-note preview can attach a mock question; no attempt route or live exam is opened",
  );

  const longQuestion = "긴한글질문검증".repeat(90);
  await submit(longQuestion);
  await page.setViewportSize({ width: 320, height: 1000 });
  await noOverflow("long-korean-dm-320");
  await screenshot("long-korean-dm-320");
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (let i = 0; i < 12; i++)
    await submit(
      `목록스크롤검증 ${i + 1}: 교류 상대를 구분하는 근거를 어떻게 찾을까요?`,
    );
  await nav("질문함").click();
  const previousPage = sidebar().getByRole("button", {
    name: "질문 목록 이전 페이지",
    exact: true,
  });
  while (await previousPage.isEnabled()) await previousPage.click();
  const listedQuestions = new Set();
  let visitedPages = 0;
  do {
    const text = await sidebar()
      .locator(".gongsin-question-row strong")
      .allTextContents();
    assert(text.length <= 6, "Question pagination must bound row count");
    text.forEach((item) => listedQuestions.add(item));
    visitedPages++;
    const next = sidebar().getByRole("button", {
      name: "질문 목록 다음 페이지",
      exact: true,
    });
    if (await next.isDisabled()) break;
    await next.click();
  } while (visitedPages < 30);
  assert.equal(
    listedQuestions.size,
    19,
    "Every submitted question must remain reachable through pagination",
  );
  const listGeometry = await sidebar().evaluate((element) =>
    [
      element,
      ...element.querySelectorAll(
        ".teacher-settings-navigation-inner,.teacher-settings-sections,.gongsin-question-list",
      ),
    ].map((node) => ({
      className: node.className,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    })),
  );
  assert(
    !listGeometry.some(
      (item) =>
        /auto|scroll/.test(item.overflowY) &&
        item.scrollHeight > item.height + 1,
    ),
    "Question lists must paginate rather than scroll",
  );
  report.questionPagination = {
    visitedPages,
    questionCount: listedQuestions.size,
    listGeometry,
  };
  await noOverflow("long-question-sidebar");
  await screenshot("paginated-question-sidebar");
  await auditPersistence("paginated-list-and-dm");
  checks.push(
    "Long Korean DM wraps at 320px; 19 questions stay reachable through bounded pagination without question-list scrolling",
  );

  await openSettings("기본");
  await page
    .getByRole("checkbox", { name: "질문 접수", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "선정 스토리", exact: true })
    .uncheck();
  await page.getByText("초안 · 학생 비공개", { exact: true }).waitFor();
  await applySettings().click();
  await nav("학생 화면").click();
  await studentNav("내 질문").click();
  assert(await composer().isDisabled());
  assert(await send().isDisabled());
  await studentNav("선정 스토리").click();
  await student()
    .getByText("아직 공개된 스토리가 없어요.", { exact: true })
    .waitFor();
  await screenshot("operation-stopped-preview");
  await auditPersistence("operation-toggles");
  await page.reload();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  assert.equal(await student().locator(".gsp-message-pair").count(), 2);
  assert.equal(await student().getByText(question, { exact: true }).count(), 0);
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 0개",
  );
  assert(await composer().isEnabled());
  await auditPersistence("reload-reset");
  checks.push(
    "Operation remains stopped/student-private; preview switches show disabled/empty states, and reload clears all local messages, replies, notifications and switches",
  );

  await nav("질문함").click();
  await sidebar().locator("select").selectOption("waiting");
  const filteredSelection = await sidebar()
    .locator('.gongsin-question-row[aria-pressed="true"] strong')
    .innerText();
  await editor()
    .getByRole("heading", { name: filteredSelection, exact: true })
    .waitFor();
  assert.equal(await page.getByLabel(/^개별 답변/).inputValue(), "");
  await sidebar().locator("select").selectOption("selected");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "공개용 문구 편집", exact: true })
      .click();
    await page.getByRole("button", { name: "선정 해제", exact: true }).click();
  }
  await sidebar()
    .getByText("해당하는 질문이 없습니다.", { exact: true })
    .waitFor();
  assert.equal(await editor().count(), 0);
  await nav("학생 화면").click();
  await acknowledgeWarning();
  await studentNav("선정 스토리").click();
  await student()
    .getByText("아직 공개된 스토리가 없어요.", { exact: true })
    .waitFor();
  await screenshot("empty-selected-sidebar-and-story");
  checks.push(
    "Filtered selection remains valid and empty selected filters remove unrelated editor content; no selected stories shows an honest empty state",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  const settingsQuestion =
    "알림설정검증: 교과서에서 교류 방식의 근거를 어떻게 찾나요?";
  await composer().fill(settingsQuestion);
  await openSettings("알림");
  assert(
    await applySettings().isDisabled(),
    "Unchanged settings must not apply",
  );
  await settingsPanel()
    .getByRole("checkbox", { name: "교사 새 질문 알림", exact: true })
    .uncheck();
  await settingsPanel()
    .getByRole("checkbox", { name: "학생 답변 알림", exact: true })
    .uncheck();
  assert(await applySettings().isEnabled());
  await settingsPanel()
    .getByRole("button", { name: "되돌리기", exact: true })
    .click();
  assert(
    await settingsPanel()
      .getByRole("checkbox", { name: "교사 새 질문 알림", exact: true })
      .isChecked(),
  );
  assert(
    await settingsPanel()
      .getByRole("checkbox", { name: "학생 답변 알림", exact: true })
      .isChecked(),
  );
  assert(await applySettings().isDisabled());
  await settingsPanel()
    .getByRole("checkbox", { name: "교사 새 질문 알림", exact: true })
    .uncheck();
  await settingsPanel()
    .getByRole("checkbox", { name: "학생 답변 알림", exact: true })
    .uncheck();
  await applySettings().click();
  assert(
    await applySettings().isDisabled(),
    "Applying settings must clear the dirty state",
  );
  await nav("학생 화면").click();
  assert.equal(
    await warning().count(),
    0,
    "Notification settings must not revoke guidance acknowledgement",
  );
  assert.equal(await composer().inputValue(), settingsQuestion);
  await send().click();
  await student().getByText(settingsQuestion, { exact: true }).waitFor();
  assert.equal(
    await teacherBell().getAttribute("aria-label"),
    "교사 알림 미리보기",
    "Disabled teacher notifications must suppress only the notification",
  );
  await nav("질문함").click();
  await selectQuestionRow(settingsQuestion);
  const silentReply = "알림이 꺼져 있어도 이 개별 답변은 대화에 저장됩니다.";
  await page.getByLabel(/^개별 답변/).fill(silentReply);
  await save().click();
  await nav("학생 화면").click();
  await student().getByText(silentReply, { exact: true }).waitFor();
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 0개",
  );
  await openSettings("알림");
  await settingsPanel()
    .getByRole("checkbox", { name: "교사 새 질문 알림", exact: true })
    .check();
  await settingsPanel()
    .getByRole("checkbox", { name: "학생 답변 알림", exact: true })
    .check();
  await applySettings().click();
  await nav("학생 화면").click();
  await submit("알림재개검증: 사료의 표현을 비교하려면 무엇을 보나요?");
  assert.equal(
    await teacherBell().getAttribute("aria-label"),
    "교사 알림 미리보기, 새 알림 1개",
  );
  teacherPopup = await openTeacherNotifications();
  await teacherPopup.getByRole("button").first().click();
  await page
    .getByLabel(/^개별 답변/)
    .fill("다시 켠 알림과 함께 전달되는 답변입니다.");
  await save().click();
  await nav("학생 화면").click();
  assert.equal(
    await studentBell().getAttribute("aria-label"),
    "알림, 읽지 않은 답변 1개",
  );
  checks.push(
    "Settings save/cancel/no-op is functional; notification off preserves question/reply storage in the private conversation, and re-enabling notifications resumes both recipients",
  );

  await openSettings("이용안내");
  const customTitle = "학습 질문을 보내기 전에";
  const customBody =
    "교과서와 학습지에서 궁금했던 내용을 적어 주세요.\n다른 사람의 개인정보는 적지 않아요.";
  await settingsPanel()
    .getByLabel("안내 제목", { exact: true })
    .fill(customTitle);
  await settingsPanel()
    .getByLabel(/^안내 내용/)
    .fill(customBody);
  await applySettings().click();
  await nav("학생 화면").click();
  const changedWarning = student().getByRole("dialog", {
    name: customTitle,
    exact: true,
  });
  await changedWarning.waitFor();
  assert(
    (await changedWarning.innerText()).includes(
      "다른 사람의 개인정보는 적지 않아요.",
    ),
  );
  assert(await student().locator(".gsp-send").isDisabled());
  await screenshot("updated-guidance");
  await acknowledgeWarning();
  await openSettings("이용안내");
  await settingsPanel()
    .getByLabel("안내 제목", { exact: true })
    .fill("저장하지 않을 안내 제목");
  await settingsPanel()
    .getByRole("button", { name: "되돌리기", exact: true })
    .click();
  assert.equal(
    await settingsPanel().getByLabel("안내 제목", { exact: true }).inputValue(),
    customTitle,
  );
  assert(await applySettings().isDisabled());
  await settingsPanel()
    .getByRole("checkbox", { name: "첫 사용 안내", exact: true })
    .uncheck();
  await applySettings().click();
  await nav("학생 화면").click();
  assert.equal(await student().getByRole("dialog").count(), 0);
  await openSettings("이용안내");
  await settingsPanel()
    .getByRole("checkbox", { name: "첫 사용 안내", exact: true })
    .check();
  await applySettings().click();
  await nav("학생 화면").click();
  await changedWarning.waitFor();
  await acknowledgeWarning();
  checks.push(
    "Saved guidance text and enabled-state changes issue a new acknowledgement version; unrelated settings preserve acknowledgement; cancel restores text; disabling and re-enabling guidance changes the actual student flow",
  );

  await studentNav("내 질문").click();
  const preservedSourceQuestion =
    "연결설정보존검증: 선택한 수업자료에서 궁금한 내용입니다.";
  await student()
    .getByRole("combobox", { name: "질문할 자료" })
    .selectOption("lesson");
  await composer().fill(preservedSourceQuestion);
  await openSettings("학습연결");
  await settingsPanel()
    .getByRole("checkbox", { name: "수업자료", exact: true })
    .uncheck();
  await applySettings().click();
  await nav("학생 화면").click();
  assert.equal(await composer().inputValue(), preservedSourceQuestion);
  assert(
    await send().isDisabled(),
    "A removed source must not silently attach a different source",
  );
  await student()
    .getByRole("combobox", { name: "질문할 자료" })
    .selectOption("dictionary");
  assert(await send().isEnabled());
  await send().click();
  await student().getByText(preservedSourceQuestion, { exact: true }).waitFor();
  await openSettings("학습연결");
  await settingsPanel()
    .getByRole("checkbox", { name: "모의고사", exact: true })
    .uncheck();
  await applySettings().click();
  await nav("학생 화면").click();
  await student()
    .getByRole("button", { name: "오답 노트", exact: true })
    .click();
  assert(
    await student()
      .getByRole("button", { name: "이 문항 질문하기", exact: true })
      .isDisabled(),
    "Disabling mock source must block wrong-note question entry",
  );
  await student()
    .getByRole("button", { name: "오답 노트 닫기", exact: true })
    .click();
  await openSettings("학습연결");
  for (const label of [
    "수업자료",
    "역사 사전",
    "형성평가",
    "진단평가",
    "모의고사",
  ])
    await settingsPanel()
      .getByRole("checkbox", { name: label, exact: true })
      .uncheck();
  await applySettings().click();
  await nav("학생 화면").click();
  await studentNav("내 질문").click();
  assert(await send().isDisabled());
  await openSettings("학습연결");
  for (const label of [
    "수업자료",
    "역사 사전",
    "형성평가",
    "진단평가",
    "모의고사",
  ])
    await settingsPanel()
      .getByRole("checkbox", { name: label, exact: true })
      .check();
  await applySettings().click();
  await openSettings("기본");
  await settingsPanel()
    .getByLabel(/^기본 제한 기간/)
    .selectOption("10800000");
  await applySettings().click();
  await settingsNav("학생제한").click();
  assert.equal(
    await settingsPanel()
      .getByLabel(/^제한 기간/)
      .inputValue(),
    "10800000",
    "Saved default restriction duration must feed the integrated student control",
  );
  await auditPersistence("saved-settings-behaviour");
  checks.push(
    "Allowed learning sources affect real composition and wrong-note entry, preserve text without silent reassignment, handle no allowed source, and saved default restriction duration feeds integrated student management",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date("2026-11-10T10:00:00+09:00") });
  await page.reload();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  const heldQuestion =
    "제한해제보존검증: 교류 상대를 구분하는 학습 질문을 작성 중입니다.";
  await composer().fill(heldQuestion);
  const restrictionPanel = () => page.locator(".gongsin-settings-restrictions");
  const openRestriction = async () => {
    if ((await nav("질문함").getAttribute("aria-pressed")) === "true")
      await page.getByRole("button", { name: /^질문 제한/ }).click();
    else await openSettings("학생제한");
    await restrictionPanel().waitFor();
  };
  const applyHourRestriction = async (reason) => {
    await openRestriction();
    await restrictionPanel()
      .getByLabel(/^제한 기간/)
      .selectOption("3600000");
    await page.getByLabel("제한 사유", { exact: true }).fill(reason);
    await page
      .getByRole("button", { name: "제한 적용 (미리보기)", exact: true })
      .click();
  };
  await nav("질문함").click();
  await selectQuestionRow(privateOtherQuestion);
  await applyHourRestriction("학생 B 제한 범위 검증");
  await nav("학생 화면").click();
  assert(
    await composer().isEnabled(),
    "Student B restriction must not block student A",
  );
  assert(
    await send().isEnabled(),
    "Another student restriction must not disable A sending",
  );
  assert.equal(await composer().inputValue(), heldQuestion);
  await nav("질문함").click();
  await selectQuestionRow(formativeQuestion);
  await applyHourRestriction("학습과 무관한 대화");
  const sharedStudentDeadline = await restrictionPanel()
    .locator(".gongsin-settings-restriction-state time")
    .getAttribute("datetime");
  await selectQuestionRow("4군 6진의 위치가");
  await openRestriction();
  assert.equal(
    await restrictionPanel()
      .locator(".gongsin-settings-restriction-state time")
      .getAttribute("datetime"),
    sharedStudentDeadline,
    "A restriction applies to the same student across their questions",
  );
  await openRestriction();
  assert.equal(
    await page.getByLabel("제한 사유", { exact: true }).inputValue(),
    "학습과 무관한 대화",
  );
  await nav("학생 화면").click();
  assert(await composer().isDisabled());
  assert(await send().isDisabled());
  assert.equal(
    await composer().inputValue(),
    heldQuestion,
    "Applying a restriction must preserve the in-progress question",
  );
  assert.equal(
    await student().locator(".gsp-message-pair").count(),
    2,
    "Restriction must retain past private conversations",
  );
  await student().getByLabel("질문 이용 제한", { exact: true }).waitFor();
  assert.match(
    await student().getByLabel("질문 이용 제한", { exact: true }).innerText(),
    /학습과 무관한 대화/,
  );
  await page.setViewportSize({ width: 390, height: 1000 });
  await noOverflow("restricted-student-390");
  await screenshot("restricted-student-390");
  await studentNav("선정 스토리").click();
  await student()
    .getByRole("article", { name: "선정 스토리", exact: true })
    .waitFor();
  await student()
    .getByRole("button", { name: "오답 노트", exact: true })
    .click();
  assert(
    await student()
      .getByRole("button", { name: "이 문항 질문하기", exact: true })
      .isDisabled(),
    "Restriction blocks question entry from wrong notes",
  );
  await student()
    .getByRole("button", { name: "오답 노트 닫기", exact: true })
    .click();
  await studentNav("내 질문").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav("질문함").click();
  await openRestriction();
  await page.getByRole("button", { name: "제한 해제", exact: true }).click();
  await nav("학생 화면").click();
  assert(await composer().isEnabled());
  assert(await send().isEnabled());
  assert.equal(await composer().inputValue(), heldQuestion);
  await send().click();
  await student().getByText(heldQuestion, { exact: true }).waitFor();
  checks.push(
    "Restrictions are keyed to one student across their questions: another student remains unaffected, private history/stories/review reading remain available, new questions including wrong-note entry are blocked, and manual release preserves pending text",
  );

  await composer().fill(
    "자동만료보존검증: 제한이 끝난 뒤 이어서 보낼 질문입니다.",
  );
  await nav("질문함").click();
  await selectQuestionRow(formativeQuestion);
  await applyHourRestriction("자동 만료 검증");
  const restrictionEnds = await restrictionPanel()
    .locator(".gongsin-settings-restriction-state time")
    .getAttribute("datetime");
  await page.waitForFunction(
    (element) => element.disabled,
    await page
      .getByRole("button", { name: "제한 적용 (미리보기)", exact: true })
      .elementHandle(),
    { timeout: 2000 },
  );
  await page
    .getByLabel("제한 사유", { exact: true })
    .fill("자동 만료 사유 확인");
  await page
    .getByRole("button", { name: "제한 적용 (미리보기)", exact: true })
    .click();
  assert.equal(
    await restrictionPanel()
      .locator(".gongsin-settings-restriction-state time")
      .getAttribute("datetime"),
    restrictionEnds,
    "Editing only the reason must preserve the original deadline",
  );
  await nav("학생 화면").click();
  assert(await send().isDisabled());
  const remaining =
    Date.parse(restrictionEnds) - (await page.evaluate(() => Date.now()));
  assert(
    remaining > 3590000 && remaining <= 3600000,
    "One-hour restriction must have a one-hour expiration",
  );
  await page.clock.fastForward(remaining - 1000);
  assert(
    await send().isDisabled(),
    "Restriction must remain active immediately before expiration",
  );
  await page.clock.fastForward(1500);
  await page.waitForFunction(
    () => !document.querySelector(".gsp-send").disabled,
  );
  assert(await composer().isEnabled());
  assert.equal(
    await composer().inputValue(),
    "자동만료보존검증: 제한이 끝난 뒤 이어서 보낼 질문입니다.",
  );
  assert.equal(
    await student().getByLabel("질문 이용 제한", { exact: true }).count(),
    0,
    "Expired restriction must be removed automatically",
  );
  await screenshot("restriction-automatically-expired");
  await send().click();
  await student()
    .getByText("자동만료보존검증: 제한이 끝난 뒤 이어서 보낼 질문입니다.", {
      exact: true,
    })
    .waitFor();
  await auditPersistence("timed-restriction-expiry");
  checks.push(
    "Browser clock crosses the real one-hour deadline: blocked just before, automatically enabled after; unsent text is preserved and no server polling or persistent storage occurs",
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await nav("학생 화면").click();
  await acknowledgeWarning();
  await student()
    .locator(".gsp-conversation")
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  assert.equal(await composer().inputValue(), "");
  await screenshot("student-dm", student());
  await student()
    .getByRole("button", { name: "학습 도구 미리보기", exact: true })
    .click();
  await screenshot("student-learning-tools", student());
  await screenshot(
    "student-learning-tools-detail",
    student().locator(".gsp-tools-root"),
  );

  assert.deepEqual(pageErrors, [], "Draft raised a browser exception");
  await auditPersistence("complete");
  report.status = "passed";
  await fs.rm(path.join(evidence, "failure.png"), { force: true });
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
