/** Real teacher authoring and paper rendering with synthetic services only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.MOCK_EXAM_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-mock-authoring-")));
await fs.mkdir(evidence, { recursive: true });
const fixture = await fs.readFile(
  "scripts/verify-assessment-teacher-browser.mjs",
  "utf8",
);
let service = fixture.match(/const service = `([\s\S]*?)`;/)[1];
service = service.replace(
  "category:q.category,type:q.type,refBig:",
  "category:q.category,type:q.type,examRound:q.examRound,paperOrder:q.paperOrder,points:q.points,passageSetId:q.passageSet?.id,passageSetInstruction:q.passageSet?.instruction,refBig:",
);
service = service.replace(
  "if(command==='upsertQuizQuestion'){const q=",
  "if(command==='upsertQuizQuestion'){if(fixtureState.failNextSave){fixtureState.failNextSave=false;throw new Error('합성 저장 실패')}const q=",
);
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220"><rect width="640" height="220" fill="#f8fafc"/><path d="M40 180L200 60L320 120L540 40" stroke="#334155" fill="none" stroke-width="8"/><text x="60" y="205" font-size="26">합성 문항 자료</text></svg>',
  );
const common = {
  unitId: "exam_prep",
  category: "exam_prep",
  type: "choice",
  options: [
    "가",
    "나",
    "두 글자",
    "긴 선지입니다",
    "마지막으로 가장 긴 선지입니다",
  ],
  answer: "나",
  points: 4,
  contentRevision: 1,
  hintEnabled: true,
  hint: "기존 모의고사 힌트는 노출하지 않습니다",
  explanation: "자료의 근거를 확인한다.",
  cognitiveProcess: "기존 사고 과정",
  refBig: "big-1",
  refMid: "mid-1",
  refSmall: "lesson-1",
};
const seed = [
  ...Array.from({ length: 24 }, (_, index) => ({
    ...common,
    id: 7001 + index,
    examRound: "round_2",
    paperOrder: index + 1,
    question: `복시 ${index + 1}번 자료를 근거로 옳은 설명을 고르시오.`,
    passage:
      "중앙 집권 체제의 강화와 지방 제도의 정비는 국가 운영 방식에 변화를 가져왔다. 자료의 시기와 정책의 목적을 살펴보자. ".repeat(
        4,
      ),
    image: index % 4 === 0 ? image : null,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    ...common,
    id: 8001 + index,
    examRound: "round_3",
    paperOrder: index + 1,
    question: `전시 ${index + 1}번 옳은 설명을 고르시오.`,
    paperBreakBefore: true,
  })),
];
service += `\nquestions.push(...${JSON.stringify(seed)});`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import QuizEditor from './src/pages/teacher/components/QuizEditor.tsx';import {tree} from 'fixture:service';import './src/assets/index.css';import './src/pages/teacher/teacherSettings.css';const params=new URLSearchParams(location.search);const normal=params.has('normal');createRoot(document.getElementById('root')).render(<QuizEditor node={normal?tree[0].children[0]:{id:'exam_prep',title:'모의고사'}} type={normal?'normal':'special'} treeData={tree} canEdit={!params.has('readonly')} onOpenSettings={()=>{}}/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: "fixture.js",
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:service$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:lib\/)?(firebase|assessmentRelease|assessmentLifecycle|historyDictionarySession)$|^firebase\/firestore$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((f) => f.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, "");
let tailwind;
for (const candidate of [
  process.env.PORTAL_DESIGN_TAILWIND_PATH,
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
].filter(Boolean)) {
  try {
    tailwind = await fs.readFile(candidate, "utf8");
    break;
  } catch {}
}
assert(
  tailwind,
  "Run an existing portal browser check once to cache the official Tailwind runtime.",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[p] || ["text/html", html];
  res.setHeader("Content-Type", type + ";charset=utf-8");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  external = [],
  errors = [],
  alerts = [],
  layouts = [];
const authoredOptions = [
  "긴 선지입니다",
  "나",
  "가",
  "두 글자",
  "마지막으로 가장 긴 선지입니다",
];
async function paperReady(page, view, expectedCount) {
  await view.locator(".mock-exam-sheet").first().waitFor();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[role="dialog"] .mock-exam-sheet article')
        .length === count,
    expectedCount,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(
        document.querySelectorAll('[role="dialog"] .mock-exam-sheet img'),
      ).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }),
      ),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
async function openPaper(page, round, count) {
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  const view = page.getByRole("dialog", {
    name: "시험지 미리보기",
    exact: true,
  });
  await view.waitFor();
  await view
    .getByRole("combobox", { name: "모의고사 회차", exact: true })
    .selectOption(round);
  await paperReady(page, view, count);
  return view;
}
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  let confirmClose = true;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    alerts.push(dialog.message());
    if (dialog.type() === "confirm" && confirmClose) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "문제 등록", exact: true }).waitFor();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const toolbar = await page.locator(".quiz-list-toolbar--mock").evaluate(el => {
      const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return { outer: box(el), controls: [...el.querySelectorAll("select,input,button")].map(box), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(toolbar.controls.length, 3);
    assert(toolbar.controls.every(control => Math.abs(control.top - toolbar.controls[0].top) < 1 && Math.abs(control.bottom - toolbar.controls[0].bottom) < 1), "round, search and refresh stay on one row");
    assert(toolbar.controls.every(control => control.left >= toolbar.outer.left && control.right <= toolbar.outer.right));
    assert.equal(toolbar.overflow, false);
    await page.screenshot({ path: path.join(evidence, `teacher-question-toolbar-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const compose = page.getByRole("dialog", {
    name: "새 문제 등록",
    exact: true,
  });
  for (const name of ["발문", "문항 유형", "회차", "문항 번호", "배점"]) {
    const field = compose.getByLabel(name, { exact: true });
    assert.equal(await field.getAttribute("aria-required"), "true", `${name} exposes requiredness`);
    const marker = await field.evaluate(element => {
      const mark = element.closest("label").querySelector('span[aria-hidden="true"]');
      return { text: mark?.textContent, color: mark && getComputedStyle(mark).color };
    });
    assert.equal(marker.text?.trim(), "*");
    assert.equal(marker.color, "rgb(185, 28, 28)", `${name} has a red required star`);
  }
  assert.equal(await compose.getByRole("textbox", { name: "해설", exact: true }).getAttribute("aria-required"), null);
  assert.equal(await compose.locator(".quiz-composer-section-heading h4").filter({ hasText: "보기와 정답" }).getByText("*", { exact: true }).count(), 1);
  checks.push("Required question fields show red stars and aria-required, while optional explanation stays optional; choice requirements are marked as a group.");
  for (const close of [
    () => compose.getByRole("button", { name: "문제 편집 닫기", exact: true }).click(),
    () => page.keyboard.press("Escape"),
    () => compose.getByRole("button", { name: "취소", exact: true }).click(),
    () => page.locator(".quiz-composer-viewport").click({ position: { x: 1, y: 1 } }),
  ]) {
    const before = alerts.length;
    await close();
    await compose.waitFor({ state: "hidden" });
    assert.equal(alerts.length, before, "untouched new question closes without confirmation, including inferred defaults");
    await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  }
  await compose.getByLabel("발문", { exact: true }).fill("되돌릴 내용");
  await compose.getByLabel("발문", { exact: true }).fill("");
  const revertedPrompts = alerts.length;
  await compose.getByRole("button", { name: "취소", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  assert.equal(alerts.length, revertedPrompts, "reverted new draft closes without confirmation");
  const edit = page.getByRole("dialog", { name: "문제 수정", exact: true });
  const editFirst = () => page.getByRole("button", { name: /^\d+번 문제 수정$/ }).first().click();
  for (const close of [
    () => edit.getByRole("button", { name: "문제 편집 닫기", exact: true }).click(),
    () => page.keyboard.press("Escape"),
    () => edit.getByRole("button", { name: "취소", exact: true }).click(),
  ]) {
    await editFirst();
    const before = alerts.length;
    await close();
    await edit.waitFor({ state: "hidden" });
    assert.equal(alerts.length, before, "existing question opens and closes clean despite normalized legacy defaults");
  }
  await editFirst();
  const originalText = await edit.getByLabel("발문", { exact: true }).inputValue();
  await edit.getByRole("button", { name: "사고 과정 선택", exact: true }).click();
  assert(await edit.getByRole("checkbox", { name: "기존 사고 과정", exact: true }).isChecked());
  await edit.getByRole("checkbox", { name: "기존 사고 과정", exact: true }).uncheck();
  await edit.getByRole("checkbox", { name: "기존 사고 과정", exact: true }).check();
  await page.keyboard.press("Escape");
  await edit.getByLabel("발문", { exact: true }).fill(originalText + " 수정");
  confirmClose = false;
  const changedPrompts = alerts.length;
  await edit.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(alerts.length, changedPrompts + 1);
  assert(await edit.isVisible());
  await edit.getByLabel("발문", { exact: true }).fill(originalText);
  const restoredPrompts = alerts.length;
  await page.keyboard.press("Escape");
  await edit.waitFor({ state: "hidden" });
  assert.equal(alerts.length, restoredPrompts, "restoring text and legacy selection makes the edit clean again");
  confirmClose = true;
  checks.push("New and existing questions dismiss cleanly on X/Escape/cancel/backdrop; automatic unit metadata is clean, changed drafts require confirmation, reverted text and legacy process selections become clean again.");
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  assert.equal(await compose.getByRole("checkbox", { name: "힌트 제공", exact: true }).count(), 0);
  assert.equal(await page.getByText("기존 모의고사 힌트는 노출하지 않습니다", { exact: true }).count(), 0);
  const readsBeforeDraft = await page.evaluate(() => window.assessmentTeacherFixture.reads.length);
  await compose
    .getByLabel("발문", { exact: true })
    .fill("직접 등록한 자료를 보고 옳은 설명을 고르시오.");
  confirmClose = false;
  for (const requestClose of [
    () => compose.getByRole("button", { name: "문제 편집 닫기", exact: true }).click(),
    () => page.locator(".quiz-composer-viewport").click({ position: { x: 1, y: 1 } }),
    () => page.keyboard.press("Escape"),
    () => compose.getByRole("button", { name: "취소", exact: true }).click(),
  ]) {
    const prompts = alerts.length;
    await requestClose();
    assert.equal(alerts.length, prompts + 1, "every dismiss action asks before discarding");
    assert(alerts.at(-1).includes("편집창을 닫을까요"));
    assert(await compose.isVisible());
    assert.equal(await compose.getByLabel("발문", { exact: true }).inputValue(), "직접 등록한 자료를 보고 옳은 설명을 고르시오.");
  }
  confirmClose = true;
  await compose.getByRole("button", { name: "문제 편집 닫기", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.writes.length), 0);
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  assert.equal(await compose.getByLabel("발문", { exact: true }).inputValue(), "");
  await compose.getByLabel("발문", { exact: true }).fill("직접 등록한 자료를 보고 옳은 설명을 고르시오.");
  const live = compose.getByRole("complementary", { name: "학생 화면 미리보기" });
  await live.locator('.mock-exam-stem').filter({hasText:"직접 등록한 자료를 보고 옳은 설명을 고르시오."}).waitFor();
  const passageToolbar = compose.getByRole("toolbar", { name: "읽기 자료 글상자 서식", exact: true });
  const passageEditor = compose.getByRole("textbox", { name: "읽기 자료 글상자", exact: true });
  await passageEditor.fill("서식 예시");
  await passageEditor.press("Control+A");
  await passageToolbar.getByRole("button", { name: "읽기 자료 글상자 밑줄", exact: true }).click();
  assert.equal(await passageEditor.locator('[data-quiz-mark="underline"]').textContent(), "서식 예시", "Toolbar pointer actions retain the editor selection");
  await passageToolbar.getByRole("button", { name: "읽기 자료 글상자 실행 취소", exact: true }).click();
  assert.equal(await passageEditor.locator('[data-quiz-mark="underline"]').count(), 0);
  await passageToolbar.getByRole("button", { name: "읽기 자료 글상자 네모", exact: true }).click();
  assert.equal(await passageEditor.locator('[data-quiz-mark="box"]').textContent(), "서식 예시");
  await passageToolbar.getByRole("button", { name: "읽기 자료 글상자 서식 지우기", exact: true }).click();
  assert.equal(await passageEditor.locator('[data-quiz-mark="box"]').count(), 0);
  for (const width of [320, 390, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await passageToolbar.scrollIntoViewIfNeeded();
    const tools = await passageToolbar.evaluate(el => {
      const outer = el.getBoundingClientRect();
      return {
        outer: { left: outer.left, right: outer.right },
        document: document.documentElement.scrollWidth,
        rowOverflow: el.querySelector('.quiz-visual-format-tools').scrollWidth - el.querySelector('.quiz-visual-format-tools').clientWidth,
        controls: Array.from(el.querySelectorAll('.quiz-visual-format-tools > button')).map(button => {
          const box = button.getBoundingClientRect(), style = getComputedStyle(button);
          return { name: button.getAttribute("aria-label"), width: box.width, height: box.height, top: box.top, left: box.left, right: box.right, fontSize:parseFloat(style.fontSize), border: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle, background: style.backgroundColor };
        }),
        boxSample: getComputedStyle(el.querySelector('[aria-label="읽기 자료 글상자 네모"] span')).borderTopStyle,
        underline: getComputedStyle(el.querySelector('[aria-label="읽기 자료 글상자 밑줄"]')).textDecorationLine,
      };
    });
    assert(tools.document <= width + 1, JSON.stringify(tools));
    assert.equal(tools.controls.length, 10);
    assert(tools.controls.every(button => button.width >= (width >= 1024 ? 28 : 44) && button.height >= (width >= 1024 ? 30 : 44) && button.left >= tools.outer.left && button.right <= tools.outer.right && button.border >= 1 && button.borderStyle === "solid" && button.background !== "rgba(0, 0, 0, 0)"), JSON.stringify(tools));
    if (width >= 1024) {
      assert(tools.controls.every(button => Math.abs(button.top-tools.controls[0].top)<1 && button.fontSize===12 && button.height<=32), JSON.stringify(tools));
      assert(tools.rowOverflow<=1, 'Desktop two-panel editor exposes all formatting controls on one row: '+JSON.stringify(tools));
    }
    assert.equal(tools.boxSample, "solid");
    assert(tools.underline.includes("underline"));
    await page.screenshot({ path: path.join(evidence, `teacher-passage-toolbar-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await passageEditor.fill("");
  checks.push("Passage formatting tools use individual bordered buttons and visible format samples: 30px/12px single row with all controls visible in 1280/1440/1920px desktop split panels, 44px targets at 320/390/768px; mouse formatting preserves selection and undo/clear still work.");
  await compose.getByRole("button", { name: "〈보기〉 추가", exact: true }).click();
  await compose.getByRole("textbox", { name: "보기", exact: true }).fill("ㄱ. 합성 첫 번째 설명\nㄴ. 합성 두 번째 설명");
  await live.locator('.mock-exam-example').filter({hasText:"ㄱ. 합성 첫 번째 설명"}).waitFor();
  await compose.getByRole("button", { name: "새 세트 지문", exact: true }).click();
  await compose.getByRole("textbox", { name: "공통 지문", exact: true }).fill("세트 자료는 두 문항에서 함께 사용합니다.");
  await live.locator('.mock-exam-set-passage').filter({hasText:"세트 자료는 두 문항에서 함께 사용합니다."}).waitFor();
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.writes.length), 0);
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.reads.length), readsBeforeDraft, "local edits and live preview must not read or write the server");
  await compose.getByRole("textbox", { name: "읽기 자료 글상자", exact: true }).fill("긴 자료에서도 작성 영역과 미리보기는 서로 독립적으로 이동합니다.\n".repeat(60));
  for (const {width, height} of [{width:390,height:568},{width:390,height:900},{width:768,height:900},{width:1280,height:900},{width:1366,height:768},{width:1870,height:888}]) {
    await page.setViewportSize({ width, height });
    const layout = await compose.evaluate(async (el) => {
      const form = el.querySelector('.quiz-composer-body'), preview = el.querySelector('.mock-exam-draft-preview');
      const header = el.querySelector('.quiz-composer-header'), footer = el.querySelector('.quiz-composer-footer'), outer = el.parentElement;
      const box = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      form.scrollTop = form.scrollHeight;
      preview.scrollTop = 0;
      const formEnd = form.scrollTop, headerBefore = box(header), footerBefore = box(footer);
      preview.scrollTop = preview.scrollHeight;
      const previewEnd = preview.scrollTop, formAfterPreview = form.scrollTop;
      form.scrollTop = 0;
      const previewAfterForm = preview.scrollTop;
      preview.scrollTop = 0;
      await new Promise(resolve => requestAnimationFrame(resolve));
      return { window:innerWidth, document:document.documentElement.scrollWidth, dialog:box(el), form:box(form), preview:box(preview), innerScroll:getComputedStyle(form).overflowY,
        previewScroll:getComputedStyle(preview).overflowY, formEnd, formAfterPreview, previewEnd, previewAfterForm,
        headerBefore, headerAfter:box(header), footerBefore, footerAfter:box(footer),
        outerScroll:outer.scrollTop, outerOverflow:outer.scrollHeight-outer.clientHeight,
        outerStyle:getComputedStyle(outer).overflowY, dialogOverflow:el.scrollHeight-el.clientHeight,
        overflow:Array.from(el.querySelectorAll('select,textarea,[contenteditable="true"]')).filter(node => node.scrollWidth > node.clientWidth+2).length };
    });
    assert(layout.document <= width+1, JSON.stringify(layout));
    assert(layout.dialog.right <= width+1, JSON.stringify(layout));
    assert(layout.dialog.top >= 0 && layout.dialog.bottom <= height, JSON.stringify(layout));
    assert.equal(layout.innerScroll, 'auto', 'the form owns its scroll');
    assert.equal(layout.previewScroll, 'auto', 'the preview owns its scroll');
    assert(layout.formEnd > 0 && layout.previewEnd > 0, 'long form and preview both scroll');
    assert.equal(layout.formEnd, layout.formAfterPreview, 'preview scrolling does not move the form');
    assert.equal(layout.previewEnd, layout.previewAfterForm, 'form scrolling does not move the preview');
    assert.deepEqual(layout.headerBefore, layout.headerAfter, 'header stays fixed');
    assert.deepEqual(layout.footerBefore, layout.footerAfter, 'save actions stay fixed');
    assert.equal(layout.outerScroll, 0);
    assert(layout.outerOverflow <= 1, JSON.stringify(layout));
    assert(layout.form.bottom <= layout.footerBefore.top && layout.preview.bottom <= layout.footerBefore.top, JSON.stringify(layout));
    assert(layout.form.top >= layout.headerBefore.bottom && layout.preview.top >= layout.headerBefore.bottom, JSON.stringify(layout));
    assert.equal(layout.overflow, 0, JSON.stringify(layout));
    if(width >= 1024){ assert(layout.preview.left >= layout.form.right, JSON.stringify(layout)); assert(layout.dialog.width > 1100); }
    else assert(layout.preview.top >= layout.form.bottom, JSON.stringify(layout));
    await page.screenshot({path:path.join(evidence, `teacher-live-composer-${width}-${height}.png`)});
    layouts.push({scenario:'independent-composer-scroll',width,height,...layout});
  }
  await page.setViewportSize({width:1280,height:900});
  await live.focus();
  await live.press('End');
  await page.waitForFunction(() => document.querySelector('.mock-exam-draft-preview').scrollTop > 0);
  assert.equal(await compose.locator('.quiz-composer-body').evaluate(el => el.scrollTop), 0, 'keyboard preview scrolling leaves the form in place');
  await compose.getByRole("textbox", { name: "읽기 자료 글상자", exact: true }).fill("");
  await compose
    .getByRole("spinbutton", { name: "배점", exact: true })
    .fill("3.5");
  for (let index = 0; index < 5; index++)
    await compose
      .getByLabel(`${index + 1}번 보기`, { exact: true })
      .fill(authoredOptions[index]);
  const choiceField = (index) =>
    compose.getByLabel(`${index + 1}번 보기`, { exact: true });
  assert.match(await live.locator('.mock-exam-answer-controls label').first().textContent(), /^\s*①\s+가/);
  assert.equal(await live.getByRole('button', {name:/문제 풀이 미리보기|돌아가기|답안 지우기/}).count(),0);
  const directAnswer = live.getByRole('radio').first();
  await directAnswer.locator('..').click();
  assert(await directAnswer.isChecked(), 'The authoring side preview accepts answers directly');
  await directAnswer.locator('..').click();
  assert(!(await directAnswer.isChecked()), 'Repeating an answer clears it in the authoring side preview');
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.writes.length), 0, 'Practicing in the side preview never saves the question');
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.reads.length), readsBeforeDraft, 'Practicing in the side preview never fetches another preview');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await choiceField(1).focus();
    await page.keyboard.press("ArrowDown");
    assert(
      await choiceField(2).evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.press("ArrowUp");
    assert(
      await choiceField(1).evaluate((el) => el === document.activeElement),
    );
    await choiceField(0).press("ArrowUp");
    assert(
      await choiceField(0).evaluate((el) => el === document.activeElement),
      "first choice does not leave its list",
    );
    await choiceField(4).press("ArrowDown");
    assert(
      await choiceField(4).evaluate((el) => el === document.activeElement),
      "last choice does not leave its list",
    );
    await choiceField(1).focus();
    for (const flags of [
      { isComposing: true },
      { keyCode: 229 },
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      const result = await choiceField(1).evaluate((el, flags) => {
        const event = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
          ...flags,
        });
        el.dispatchEvent(event);
        return {
          stayed: document.activeElement === el,
          prevented: event.defaultPrevented,
        };
      }, flags);
      assert.deepEqual(
        result,
        { stayed: true, prevented: false },
        `IME and modified arrows keep native editing: ${JSON.stringify(flags)}`,
      );
    }
    for (const property of ["readOnly", "disabled"]) {
      const result = await choiceField(1).evaluate((el, property) => {
        el[property] = true;
        const before = document.activeElement;
        const event = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(event);
        el[property] = false;
        return {
          stayed: document.activeElement === before,
          prevented: event.defaultPrevented,
        };
      }, property);
      assert.deepEqual(
        result,
        { stayed: true, prevented: false },
        `${property} choice does not move focus`,
      );
    }
    for (const property of ["readOnly", "disabled"]) {
      await choiceField(1).focus();
      await choiceField(2).evaluate((el, property) => {
        el[property] = true;
      }, property);
      await page.keyboard.press("ArrowDown");
      assert(
        await choiceField(1).evaluate((el) => el === document.activeElement),
        `does not focus a ${property} destination`,
      );
      await choiceField(2).evaluate((el, property) => {
        el[property] = false;
      }, property);
    }
    for (let index = 0; index < 5; index++)
      assert.equal(
        await choiceField(index).inputValue(),
        authoredOptions[index],
      );
    assert.equal(
      await compose.locator('.quiz-choice-answer[aria-pressed="true"]').count(),
      0,
      "navigation does not select a correct answer",
    );
    await choiceField(1).focus();
    await page.keyboard.press("ArrowDown");
    await page.screenshot({
      path: path.join(evidence, `teacher-choice-arrow-${width}.png`),
    });
  }
  await compose.getByRole("button", { name: "보기 추가", exact: true }).click();
  await choiceField(5).fill("추가한 합성 보기");
  await compose
    .getByRole("button", { name: "3번 보기 삭제", exact: true })
    .click();
  assert.equal(await choiceField(2).inputValue(), authoredOptions[3]);
  await choiceField(3).press("ArrowDown");
  assert(await choiceField(4).evaluate((el) => el === document.activeElement));
  assert.equal(await choiceField(4).inputValue(), "추가한 합성 보기");
  await page.keyboard.press("ArrowUp");
  assert(await choiceField(3).evaluate((el) => el === document.activeElement));
  assert.equal(await choiceField(3).inputValue(), authoredOptions[4]);
  for (let index = 0; index < 5; index++)
    await choiceField(index).fill(authoredOptions[index]);
  await choiceField(1).fill("첫째 줄\n둘째 줄");
  await choiceField(1).evaluate((el) => el.setSelectionRange(2, 2));
  await choiceField(1).press("ArrowDown");
  assert(
    await choiceField(2).evaluate((el) => el === document.activeElement),
    "a plain arrow moves to the adjacent choice even when its text wraps or contains newlines",
  );
  assert.equal(await choiceField(1).inputValue(), "첫째 줄\n둘째 줄");
  await choiceField(1).fill(authoredOptions[1]);
  await choiceField(1).press("Alt+ArrowDown");
  assert(
    await choiceField(2).evaluate((el) => el === document.activeElement),
    "existing Alt+arrow form navigation remains available",
  );
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.reads.length),
    readsBeforeDraft,
  );
  checks.push(
    "Plain up/down arrows move only among adjacent choice fields at 390/768/1440px, preserve values and correct-answer selection, keep endpoints/IME/modifiers/read-only/disabled fields safe, and follow current rows after add/delete. Existing Alt+arrow navigation remains available; no reads or writes occur.",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await compose
    .getByRole("button", { name: "1번 보기 정답 선택", exact: true })
    .click();
  await compose
    .getByRole("textbox", { name: /핵심 개념/ })
    .fill("왕권 강화, 중앙 집권");
  await compose.getByRole("button", { name: "사고 과정 선택", exact: true }).click();
  await compose.getByRole("checkbox", { name: "사료 해석", exact: true }).check();
  await compose.getByRole("checkbox", { name: "인과 관계", exact: true }).check();
  assert.equal(await compose.getByRole("button", { name: "사고 과정 선택", exact: true }).getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert(await compose.isVisible(), "Escape closes only the process choices");
  await compose
    .getByRole("combobox", { name: "다시 볼 수업자료", exact: true })
    .selectOption("lesson-1");
  await compose.getByText("선지별 혼동 지점", { exact: true }).click();
  await compose
    .getByRole("textbox", { name: "3. 가", exact: true })
    .fill("정치 기구와 통치 제도의 혼동");
  for (const control of [
    compose.getByRole("textbox", { name: /핵심 개념/ }),
    compose.getByRole("button", { name: "사고 과정 선택", exact: true }),
    compose.getByRole("combobox", { name: "다시 볼 수업자료", exact: true }),
    compose.getByRole("textbox", { name: "3. 가", exact: true }),
    compose.getByLabel("발문", { exact: true }),
    compose.getByLabel("읽기 자료 글상자", { exact: true }),
    compose.getByRole("spinbutton", { name: "배점", exact: true }),
  ]) {
    await control.focus();
    const focus = await control.evaluate(el => {
      const style = getComputedStyle(el);
      return { width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), style: style.outlineStyle };
    });
    assert(focus.width >= 2 && focus.style === "solid" && focus.offset <= -focus.width, `focus remains visible inside the control: ${JSON.stringify(focus)}`);
  }
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, 0, 120, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await compose.getByLabel("문항 이미지 첨부", { exact: true }).setInputFiles({
    name: "material.png", mimeType: "image/png", buffer: Buffer.from(png, "base64"),
  });
  await compose.getByAltText("문항 첨부 이미지", { exact: true }).waitFor();
  assert(await compose.getByAltText("문항 첨부 이미지", { exact: true }).evaluate(el => !!el.closest(".quiz-visual-frame")), "material image stays inside the passage editor");
  assert(await compose.getByLabel("문항 이미지 첨부", { exact: true }).evaluate(el => !!el.closest('[role="toolbar"]')), "image insertion belongs to the editor tools");
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.writes.length), 0, "image preparation remains local until save");
  await compose.getByLabel("읽기 자료 글상자", { exact: true }).focus();
  await page.screenshot({ path: path.join(evidence, "teacher-material-tools.png") });
  await compose
    .getByLabel("1번 보기 이미지 첨부", { exact: true })
    .setInputFiles({
      name: "choice.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await compose.getByAltText("1번 보기 이미지", { exact: true }).waitFor();
  await compose
    .getByLabel("2번 보기", { exact: true })
    .fill(authoredOptions[2]);
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"]') !== null,
  );
  assert(alerts.some((text) => text.includes("서로 다른 선지 5개")));
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  await compose
    .getByLabel("2번 보기", { exact: true })
    .fill(authoredOptions[1]);
  await compose
    .getByRole("spinbutton", { name: "배점", exact: true })
    .fill("3.333");
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await compose
    .getByRole("alert")
    .filter({ hasText: "소수 둘째 자리" })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  await compose
    .getByRole("spinbutton", { name: "배점", exact: true })
    .fill("3.5");
  await page.evaluate(() => {
    window.assessmentTeacherFixture.failNextSave = true;
  });
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await compose
    .getByRole("alert")
    .filter({ hasText: "합성 저장 실패" })
    .waitFor();
  assert.equal(
    await compose.getByLabel("발문", { exact: true }).inputValue(),
    "직접 등록한 자료를 보고 옳은 설명을 고르시오.",
  );
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  const state = await page.evaluate(() => ({
    saved: window.assessmentTeacherFixture.questions.find(
      (q) => q.category === "exam_prep" && q.examRound === "round_1",
    ),
    writes: window.assessmentTeacherFixture.writes,
  }));
  assert.equal(state.saved.paperOrder, 1);
  assert.equal(state.saved.hintEnabled, false);
  assert.equal(state.saved.hint, "");
  assert.equal(state.saved.examplePassage, "ㄱ. 합성 첫 번째 설명\nㄴ. 합성 두 번째 설명");
  assert.equal(state.saved.passageSet.passage, "세트 자료는 두 문항에서 함께 사용합니다.");
  assert.equal(state.saved.points, 3.5);
  assert(state.saved.image?.startsWith("data:image/"));
  assert.equal(state.saved.answer, "긴 선지입니다");
  assert.deepEqual(state.saved.options, [
    "가",
    "나",
    "두 글자",
    "긴 선지입니다",
    "마지막으로 가장 긴 선지입니다",
  ]);
  assert(state.saved.choiceOptionImages[3]?.startsWith("data:image/"));
  assert.equal(state.saved.choiceOptionImages.filter(Boolean).length, 1);
  assert.deepEqual(state.saved.concepts, ["왕권 강화", "중앙 집권"]);
  assert.equal(state.saved.cognitiveProcess, "사료 해석");
  assert.deepEqual(state.saved.cognitiveProcesses, ["사료 해석", "인과 관계"]);
  assert.equal(state.saved.reviewLessonId, "lesson-1");
  assert.equal(
    state.saved.misconceptionTags["가"],
    "정치 기구와 통치 제도의 혼동",
  );
  assert.equal(state.writes.length, 2);
  assert.equal(
    state.writes[0].payload.questionId,
    state.writes[1].payload.questionId,
    "retry keeps the same question identity",
  );
  checks.push(
    "Direct registration: distinct-five-choice/decimal validation blocks writes, image and selected answer stay paired through sorting, learning metadata persists, failed save retains input and retries the same ID.",
  );
  checks.push("Draft preview updates locally without server reads/writes; 보기 and set passage are saved only on final registration; 390/768/1280/1366/1870 editor fits the viewport with independent form/preview scrolling and fixed header/footer; preview keyboard scrolling is supported.");
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  await compose.getByLabel("발문", { exact: true }).fill("공통 지문에 연결한 두 번째 문항입니다.");
  for(let index=0;index<5;index++) await compose.getByLabel(`${index+1}번 보기`,{exact:true}).fill(authoredOptions[index]);
  await compose.getByRole("button",{name:"1번 보기 정답 선택",exact:true}).click();
  await compose.getByRole("button",{name:"기존 세트 연결",exact:true}).click();
  await compose.getByRole("combobox",{name:"연결할 세트 지문",exact:true}).selectOption(state.saved.passageSet.id);
  assert.equal(await compose.getByRole("textbox",{name:"공통 지문",exact:true}).count(),0,"linked common passage is read-only until separated");
  await live.locator('.mock-exam-set-passage').filter({hasText:"세트 자료는 두 문항에서 함께 사용합니다."}).waitFor();
  assert.equal(await page.evaluate(()=>window.assessmentTeacherFixture.writes.length),2);
  await compose.getByRole("button",{name:"등록",exact:true}).click();
  await compose.waitFor({state:"hidden"});
  const paired=await openPaper(page,"round_1",2);
  assert.equal(await paired.locator('.mock-exam-sheet .mock-exam-set-passage').count(),1,"shared passage is printed once for consecutive set questions");
  await paired.locator('.mock-exam-sheet').getByText('[1~2]',{exact:false}).waitFor();
  await page.keyboard.press('Escape');
  await paired.waitFor({state:'hidden'});
  checks.push("Connect an existing set using cached representative material, persist the second question, and print shared material exactly once with [1~2] range.");
  await page
    .getByRole("searchbox", { name: "검색", exact: true })
    .fill("직접 등록한");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-quiz-question-card]").length === 1,
  );
  const writesBeforePreview = await page.evaluate(
    () => window.assessmentTeacherFixture.writes.length,
  );
  await editFirst();
  await edit.getByRole("button", { name: "사고 과정 선택", exact: true }).click();
  assert(await edit.getByRole("checkbox", { name: "사료 해석", exact: true }).isChecked());
  assert(await edit.getByRole("checkbox", { name: "인과 관계", exact: true }).isChecked());
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const processTrigger = edit.getByRole("button", { name: "사고 과정 선택", exact: true });
    await processTrigger.scrollIntoViewIfNeeded();
    if ((await processTrigger.getAttribute("aria-expanded")) !== "true") await processTrigger.click();
    await edit.getByRole("group", { name: "사고 과정 항목", exact: true }).waitFor();
    const processLayout = await edit.locator(".quiz-cognitive-select").evaluate(node => ({
      right: node.getBoundingClientRect().right, left: node.getBoundingClientRect().left,
      overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...node.querySelectorAll("label:has(input)")].map(label => label.getBoundingClientRect().height),
    }));
    assert(processLayout.left >= 0 && processLayout.right <= width && !processLayout.overflow);
    assert(processLayout.targets.every(height => height >= 44));
    await page.screenshot({ path: path.join(evidence, `teacher-process-multiple-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  const roundtripPrompts = alerts.length;
  await edit.getByRole("button", { name: "취소", exact: true }).click();
  await edit.waitFor({ state: "hidden" });
  assert.equal(alerts.length, roundtripPrompts);
  await page.getByRole("button", { name: /^\d+번 문항으로 파생 문항 만들기$/ }).first().click();
  const derived = page.getByRole("dialog", { name: "파생 문항 만들기", exact: true });
  await derived.getByRole("button", { name: "사고 과정 선택", exact: true }).click();
  assert(await derived.getByRole("checkbox", { name: "사료 해석", exact: true }).isChecked());
  assert(await derived.getByRole("checkbox", { name: "인과 관계", exact: true }).isChecked());
  await page.keyboard.press("Escape");
  await derived.getByRole("button", { name: "취소", exact: true }).click();
  await derived.waitFor({ state: "hidden" });
  checks.push("Multiple cognitive processes persist and reopen in edit/derivation; legacy scalar tags remain selectable, checkbox targets stay 44px and panels fit 320/390/768/1280 without reads/writes.");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const view = await openPaper(page, "round_2", 24);
    assert(
      (await view.locator(".mock-exam-sheet").count()) > 1,
      "long passages and images should paginate automatically",
    );
    const layout = await view.evaluate((element) => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialogWidth: element.getBoundingClientRect().width,
      pages: element.querySelectorAll(".mock-exam-sheet").length,
      questions: Array.from(
        element.querySelectorAll(".mock-exam-sheet article"),
      ).map((article) => {
        const box = article.getBoundingClientRect(),
          sheet = article.closest(".mock-exam-sheet").getBoundingClientRect();
        return {
          text: article.querySelector(".mock-exam-stem").textContent,
          left: box.left,
          right: box.right,
          bottom: box.bottom,
          sheetLeft: sheet.left,
          sheetRight: sheet.right,
          sheetBottom: sheet.bottom,
        };
      }),
      images: Array.from(element.querySelectorAll(".mock-exam-sheet img")).map(
        (img) => ({ complete: img.complete, width: img.naturalWidth }),
      ),
    }));
    assert(layout.documentWidth <= width + 1, JSON.stringify(layout));
    assert(layout.dialogWidth <= width, JSON.stringify(layout));
    assert.equal(layout.questions.length, 24);
    assert.equal(new Set(layout.questions.map((q) => q.text)).size, 24);
    assert(
      layout.questions.every(
        (q) =>
          q.left >= q.sheetLeft - 1 &&
          q.right <= q.sheetRight + 1 &&
          q.bottom <= q.sheetBottom + 1,
      ),
      "every complete question must fit its page",
    );
    assert.equal(layout.images.length, 6);
    assert(layout.images.every((img) => img.complete && img.width > 0));
    await page.screenshot({
      path: path.join(evidence, `teacher-auto-paper-${width}.png`),
      fullPage: false,
    });
    layouts.push({
      width,
      pages: layout.pages,
      questions: layout.questions.length,
    });
    await page.keyboard.press("Escape");
    await view.waitFor({ state: "hidden" });
    assert(
      await page
        .getByRole("button", { name: "미리보기", exact: true })
        .evaluate((el) => el === document.activeElement),
      "Escape returns keyboard focus to preview action",
    );
  }
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    writesBeforePreview,
  );
  const short = await openPaper(page, "round_3", 4);
  assert.equal(
    await short.locator(".mock-exam-sheet").count(),
    1,
    "legacy manual page breaks must not force four pages",
  );
  await page.keyboard.press("Escape");
  await short.waitFor({ state: "hidden" });
  checks.push(
    "Round-wide preview ignores the list search, loads all 24 questions beyond the 20-row list page, automatically paginates complete passages/images at 390/768/1280, and performs no writes. Legacy manual page breaks are ignored.",
  );
  await page.goto(origin + "/?readonly");
  await page.getByRole("button", { name: "미리보기", exact: true }).waitFor();
  const readonly = await openPaper(page, "round_2", 24);
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  await page.keyboard.press("Escape");
  await readonly.waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "문제 등록", exact: true }).count(),
    0,
  );
  checks.push(
    "Read-only teacher can inspect the full paper without a write operation.",
  );
  await page.goto(origin + "/?normal");
  await editFirst();
  const normalEditPrompts = alerts.length;
  await edit.getByRole("button", { name: "문제 편집 닫기", exact: true }).click();
  await edit.waitFor({ state: "hidden" });
  assert.equal(alerts.length, normalEditPrompts, "untouched diagnostic question closes cleanly");
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const normal = page.getByRole("dialog", { name: "새 문제 등록", exact: true });
  await normal.waitFor();
  const normalNewPrompts = alerts.length;
  await page.keyboard.press("Escape");
  await normal.waitFor({ state: "hidden" });
  assert.equal(alerts.length, normalNewPrompts, "new diagnostic question closes cleanly");
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  await normal.getByRole("checkbox", { name: "힌트 제공", exact: true }).check();
  await normal.getByRole("textbox", { name: "힌트", exact: true }).fill("진단·형성평가의 힌트는 유지합니다");
  assert.equal(await normal.getByRole("textbox", { name: "힌트", exact: true }).inputValue(), "진단·형성평가의 힌트는 유지합니다");
  await normal.getByRole("checkbox", { name: "힌트 제공", exact: true }).uncheck();
  assert.equal(await normal.locator(".mock-exam-draft-preview").count(), 0);
  assert.equal(await normal.locator(".quiz-composer-preview").count(), 0);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await normal.evaluate((element) => {
      const body = element.querySelector(".quiz-composer-body");
      const footer = element.querySelector(".quiz-composer-footer");
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      body.scrollTop = 0;
      const footerBefore = box(footer);
      body.scrollTop = body.scrollHeight;
      return {
        scenario: "normal-composer",
        width: innerWidth,
        height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        dialog: box(element),
        body: box(body),
        bodyOverflow: getComputedStyle(body).overflowY,
        bodyScrollTop: body.scrollTop,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        wrapperDisplay: getComputedStyle(element.querySelector(".quiz-composer-layout--legacy")).display,
        viewportOverflow: getComputedStyle(element.parentElement).overflowY,
        footerBefore,
        footerAfter: box(footer),
      };
    });
    assert(layout.documentWidth <= width + 1, JSON.stringify(layout));
    assert(layout.dialog.left >= 0 && layout.dialog.top >= 0 && layout.dialog.right <= width + 1 && layout.dialog.bottom <= layout.height + 1, JSON.stringify(layout));
    assert.equal(layout.wrapperDisplay, "contents", "normal form remains a direct flex participant");
    assert.equal(layout.viewportOverflow, "visible", "normal modal does not gain the mock exam outer scroll viewport");
    assert.equal(layout.bodyOverflow, "auto");
    assert(layout.bodyScrollHeight > layout.bodyClientHeight && layout.bodyScrollTop > 0, JSON.stringify(layout));
    assert(layout.body.bottom <= layout.footerAfter.top + 1, JSON.stringify(layout));
    assert(layout.footerAfter.top >= layout.dialog.top && layout.footerAfter.bottom <= layout.height + 1, JSON.stringify(layout));
    assert.deepEqual(layout.footerBefore, layout.footerAfter, "normal footer stays visible while only the body scrolls");
    await normal.locator(".quiz-composer-body").evaluate((body) => { body.scrollTop = 0; });
    await page.screenshot({ path: path.join(evidence, `teacher-normal-composer-${width}.png`) });
    layouts.push(layout);
  }
  assert.equal(await page.evaluate(() => window.assessmentTeacherFixture.writes.length), 0);
  checks.push("Normal diagnostic question dialog stays within 390/768/1280 viewports; only its body scrolls, the footer remains visible, and no mock exam live preview appears.");
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        ok: true,
        checks,
        layouts,
        externalRequests: external,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ok: true, checks, layouts, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
