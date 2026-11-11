/** Real notebook, popup and worksheet; synthetic reads/writes, no production data. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.QUIZ_LESSON_POPUP_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-lesson-popup-")));
await fs.mkdir(evidence, { recursive: true });
const service = `
export const qa=window.popupQa={reads:[],saves:[],toasts:[],config:{year:'2026',semester:'2'},user:{uid:'student-a'},failTree:false};
export const useAuth=()=>({config:qa.config,currentUser:qa.user});
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const useGongsinAvailability=()=>({enabled:false,loading:false,semesterId:'2026-2'});
export const getGongsinQuestionUrl=()=>{throw Error('Q&A is closed in the lesson regression fixture')};
export const db={};export const doc=(_db,...paths)=>({path:paths.join('/')});export const collection=doc;
export const getDoc=async ref=>{qa.reads.push(ref.path);if(qa.failProgress){qa.failProgress=false;throw Error('Progress offline')}return{exists:()=>true,data:()=>({answerRevision:4,answers:{blank:{value:qa.user.uid==='student-a'?'고조선':'조선',status:'correct'}},corePointFinds:['point']})}};
const forbidden=()=>{throw Error('Unexpected bulk read or command')};
export const getDocs=forbidden,getHttpsCallable=forbidden,recordLessonCorePointFind=forbidden,claimLessonCorePointReward=forbidden;
export const getFirebaseStorage=async()=>({});export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>'/worksheet.svg';
export const readStudentVisibleCurriculumTree=async()=>{qa.reads.push('tree');if(qa.failTree){qa.failTree=false;throw Error('Tree offline')}return[{id:'big',title:'대단원',children:[{id:'middle',title:'중단원',children:[{id:'a',title:'첫 번째 학습지'},{id:'b',title:'두 번째 학습지'}]}]}]};
export const readStudentLessonProgressCatalog=forbidden;
export const readStudentLesson=async(_config,unitId)=>{qa.reads.push('lesson:'+unitId);return {unitId,title:unitId==='a'?'첫 번째 학습지':'두 번째 학습지',contentHtml:unitId==='b'?'<p>추가 학습 내용도 같은 영역에서 읽습니다.</p>':'',contentRevision:2,semesterRevision:1,worksheetPageImages:[1,2].map(page=>({page,width:1000,height:1400,imageUrl:'/worksheet.svg'})),worksheetBlanks:[{id:'blank',page:1,leftRatio:.1,topRatio:.1,widthRatio:.3,heightRatio:.05,answer:'고조선',source:'manual'}],worksheetExamHighlights:[{id:'point',page:1,leftRatio:.1,topRatio:.3,widthRatio:.3,heightRatio:.05}],isVisibleToStudents:true}};
export const claimPointActivityReward=async()=>({awarded:false});
export const saveLessonAnswers=async(_config,input)=>{qa.saves.push(input);return {answerRevision:5,answers:Object.fromEntries(Object.entries(input.answers).map(([id,value])=>[id,{value,status:'correct'}])),totalCount:1,correctCount:1}};
`;
const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Review from './src/pages/student/quiz/QuizRelearning';
import './src/pages/student/quiz/QuizLearning.css';
import './src/assets/index.css';
import {qa}from'fixture:service';
const item={id:'q',type:'choice',question:'합성 복습 문항',options:['가','나'],answer:'가',submittedAnswer:'나',concepts:[],explanation:'합성 해설',reviewLessonId:'a'};
function App(){const[tick,setTick]=useState(0);const[open,setOpen]=useState(true);window.changeScope=(uid,semester)=>{qa.user={uid};qa.config={year:'2026',semester};setTick(tick+1)};return open?<Review items={[item]} onClose={()=>setOpen(false)}/>:<span>결과</span>};
createRoot(document.getElementById('root')).render(<App/>);
`;
const adapters = new Set([
  "AuthContext",
  "AppToastProvider",
  "firebase",
  "firebase/firestore",
  "firebase/storage",
  "studentLessonReadCache",
  "points",
  "learningCommands",
  "gongsinmoongo",
]);
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".svg": "dataurl",
    ".webp": "dataurl",
  },
  plugins: [
    {
      name: "offline",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const key = args.path.startsWith("firebase/")
            ? args.path
            : args.path.split("/").at(-1);
          if (args.path === "fixture:service" || adapters.has(key))
            return { path: "service", namespace: "offline" };
        });
        build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: service,
          loader: "js",
        }));
      },
    },
  ],
});
const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = built.outputFiles
  .filter((file) => file.path.endsWith(".css"))
  .map((file) => file.text)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:16px}#root{max-width:1000px;margin:auto}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="#fffcf4"/><rect x="20" y="20" width="960" height="1360" fill="none" stroke="#cbd5e1" stroke-width="3"/><text x="100" y="90" font-size="28">합성 학습지 · 100% 너비 맞춤</text>' +
  [300, 600, 900, 1200]
    .map(
      (y, index) =>
        `<rect x="80" y="${y}" width="840" height="140" rx="12" fill="#dbeafe"/><text x="110" y="${y + 55}" font-size="26">학습 내용 ${index + 1}</text><path d="M110 ${y + 85}h700 M110 ${y + 110}h550" stroke="#94a3b8" stroke-width="6"/>`,
    )
    .join("") +
  "</svg>";
const server = http.createServer((req, res) => {
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
    "/worksheet.svg": ["image/svg+xml", svg],
  }[req.url] || ["text/html", html];
  res.setHeader("content-type", type + ";charset=utf-8");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browserName = process.env.QUIZ_LESSON_POPUP_BROWSER || "chromium";
assert(["chromium", "webkit", "firefox"].includes(browserName));
const browser = await playwright[browserName].launch({
  ...(browserName === "chromium"
    ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
    : {}),
  headless: true,
});
const errors = [],
  external = [];
const layouts = [];
const pageTransitions = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  const open = async () => {
    const trigger = page.getByRole("button", {
      name: "연결된 학습지 열기",
      exact: true,
    });
    // Safari does not focus mouse-clicked buttons; use keyboard activation to test focus restoration.
    await trigger.focus();
    await trigger.press("Enter");
  };
  await open();
  const popup = page.getByRole("dialog", { name: "학습지", exact: true });
  const input = () =>
    popup.locator(
      ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
    );
  const pane = () => popup.locator(".quiz-lesson-popup__body:not([hidden])");
  const scroll = () => pane().locator(".lesson-review-content__scroll");
  const zoom = () =>
    pane().getByRole("button", {
      name: "학습지 배율 100%로 되돌리기",
      exact: true,
    });
  const waitZoom = (percent) =>
    page.waitForFunction(
      (value) =>
        document.querySelector(
          '.quiz-lesson-popup__body:not([hidden]) [aria-label="학습지 배율 100%로 되돌리기"]',
        )?.textContent ===
        value + "%",
      percent,
    );
  const inspectLayout = async (label, requireFit = true) => {
    const state = await popup.evaluate((dialog) => {
      const body = dialog.querySelector(
        ".quiz-lesson-popup__body:not([hidden])",
      );
      const viewport = body.querySelector(".lesson-review-content__scroll");
      const dimensions = (element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        overflowX: getComputedStyle(element).overflowX,
        overflowY: getComputedStyle(element).overflowY,
      });
      const bounds = dialog.getBoundingClientRect();
      const controls = [
        ...dialog.querySelectorAll(".quiz-lesson-popup__header button"),
        ...body.querySelectorAll(
          ".lesson-review-content__toolbar button, .lesson-review-content__actions button",
        ),
      ].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") || button.textContent.trim(),
          visible:
            rect.width >= 44 &&
            rect.height >= 44 &&
            rect.top >= bounds.top - 1 &&
            rect.bottom <= bounds.bottom + 1 &&
            rect.left >= bounds.left - 1 &&
            rect.right <= bounds.right + 1,
        };
      });
      const scrolling = [...body.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          if (
            !element.getClientRects().length ||
            ["INPUT", "TEXTAREA"].includes(element.tagName)
          )
            return false;
          return (
            (/auto|scroll/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1) ||
            (/auto|scroll/.test(style.overflowX) &&
              element.scrollWidth > element.clientWidth + 1)
          );
        })
        .map((element) => element.className);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        dialog: dimensions(dialog),
        body: dimensions(body),
        content: dimensions(viewport),
        controls,
        scrolling,
        withinScreen:
          bounds.left >= -1 &&
          bounds.top >= -1 &&
          bounds.right <= innerWidth + 1 &&
          bounds.bottom <= innerHeight + 1,
        pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
      };
    });
    assert(state.withinScreen, label + ": dialog stays within screen");
    assert.equal(
      state.pageOverflowX,
      false,
      label + ": no document horizontal overflow",
    );
    assert.equal(
      state.bodyOverflowY,
      "hidden",
      label + ": background scroll is locked",
    );
    for (const key of ["body", "dialog"]) {
      assert(
        state[key].scrollHeight <= state[key].height + 1,
        label + ": no " + key + " vertical overflow",
      );
      assert(
        state[key].scrollWidth <= state[key].width + 1,
        label + ": no " + key + " horizontal overflow",
      );
    }
    assert(
      state.content.height > 60,
      label + ": worksheet retains usable height",
    );
    if (requireFit)
      assert(
        state.content.scrollWidth <= state.content.width + 1,
        label + ": initial 100% fits available width",
      );
    assert(
      state.scrolling.every((className) =>
        className.includes("lesson-review-content__scroll"),
      ),
      label + ": only content is scrollable: " + state.scrolling.join(","),
    );
    assert(
      state.controls.length >= 9,
      label + ": fixed header, zoom and answer controls exist",
    );
    assert(
      state.controls.every((control) => control.visible),
      label +
        ": fixed controls stay visible: " +
        JSON.stringify(state.controls),
    );
    layouts.push({ label, ...state });
    return state;
  };
  await input().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".worksheet-blank-input")?.value === "고조선",
  );
  assert.equal(page.url(), origin + "/");
  assert.equal(await page.context().pages().length, 1);
  await waitZoom(100);
  const menu = () =>
    popup.getByRole("button", { name: "목차", exact: true }).click();
  for (const [width, height] of [
    [320, 568],
    [390, 568],
    [390, 900],
    [768, 900],
    [1280, 900],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await zoom().click();
    await waitZoom(100);
    const size = width + "x" + height;
    const initial = await inspectLayout(size + "-100");
    const image = scroll().locator('img[src="/worksheet.svg"]').first();
    await image.evaluate((node) => node.decode());
    const baseWidth = (await image.boundingBox()).width;
    await pane()
      .getByRole("button", { name: "학습지 확대", exact: true })
      .click();
    await waitZoom(110);
    assert(
      Math.abs((await image.boundingBox()).width / baseWidth - 1.1) < 0.02,
      size + ": zoom scales worksheet",
    );
    await inspectLayout(size + "-110", false);
    await pane()
      .getByRole("button", { name: "학습지 축소", exact: true })
      .click();
    await waitZoom(100);
    await pane()
      .getByRole("button", { name: "학습지 축소", exact: true })
      .click();
    await waitZoom(90);
    await zoom().click();
    await waitZoom(100);
    await scroll().evaluate((node) => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    });
    if (initial.content.scrollHeight > initial.content.height + 5) {
      const box = await scroll().boundingBox();
      await page.mouse.move(
        box.x + box.width - 30,
        box.y + Math.min(70, box.height / 2),
      );
      await page.mouse.wheel(0, 250);
      await page.waitForFunction(
        () =>
          document.querySelector(
            ".quiz-lesson-popup__body:not([hidden]) .lesson-review-content__scroll",
          ).scrollTop > 0,
      );
      await waitZoom(100);
      await inspectLayout(size + "-wheel");
    }
    await scroll().evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await inspectLayout(size + "-bottom");
    await page.screenshot({
      path: path.join(evidence, "popup-" + size + "-bottom.png"),
    });
    await scroll().evaluate((node) => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    });
    await page.screenshot({
      path: path.join(evidence, "popup-" + size + ".png"),
    });
    await menu();
    assert.deepEqual(
      await popup
        .getByRole("navigation", { name: "학습지 목차" })
        .getByRole("button")
        .allTextContents(),
      ["첫 번째 학습지", "두 번째 학습지"],
    );
    const bounds = await popup.evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    assert.equal(bounds.overflow, false);
    assert(bounds.right <= bounds.width + 1);
    await page.keyboard.press("Escape");
    assert(await popup.isVisible());
  }
  await scroll().evaluate((node) => {
    node.scrollTop = 0;
  });
  await scroll()
    .locator('img[src="/worksheet.svg"]')
    .first()
    .dispatchEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.quiz-lesson-popup__body:not([hidden]) [aria-label="학습지 배율 100%로 되돌리기"]',
      )?.textContent !== "100%",
  );
  await zoom().click();
  await waitZoom(100);
  await input().fill("내가 채운 내용");
  await pane()
    .getByRole("button", { name: "학습지 확대", exact: true })
    .click();
  await waitZoom(110);
  const scrollToEnd = async () => {
    const position = await scroll().evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.scrollLeft = node.scrollWidth;
      return { top: node.scrollTop, left: node.scrollLeft };
    });
    assert(position.top > 0, "Page-change fixture starts below the top");
    assert(position.left > 0, "Zoomed page-change fixture starts to the right");
    return position;
  };
  const expectPageStart = async (direction, before) => {
    await page.waitForFunction(() => {
      const node = document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .lesson-review-content__scroll",
      );
      return node.scrollTop === 0 && node.scrollLeft === 0;
    });
    await waitZoom(110);
    pageTransitions.push({
      direction,
      before,
      after: { top: 0, left: 0 },
      zoom: 110,
    });
  };
  const firstPageEnd = await scrollToEnd();
  await pane()
    .getByRole("button", { name: "다음 페이지", exact: true })
    .click();
  await expectPageStart("next", firstPageEnd);
  assert(
    (
      await pane().locator(".lesson-review-content__pages").innerText()
    ).includes("페이지 2 / 2"),
  );
  assert.equal(await input().count(), 0);
  const secondPageEnd = await scrollToEnd();
  await pane()
    .getByRole("button", { name: "이전 페이지", exact: true })
    .click();
  await expectPageStart("previous", secondPageEnd);
  assert.equal(await input().inputValue(), "내가 채운 내용");
  await menu();
  await popup
    .getByRole("button", { name: "두 번째 학습지", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "고조선",
  );
  await waitZoom(100);
  const supplemental = pane().getByText(
    "추가 학습 내용도 같은 영역에서 읽습니다.",
    { exact: true },
  );
  await supplemental.scrollIntoViewIfNeeded();
  assert(await supplemental.isVisible());
  assert(
    await supplemental.evaluate(
      (node) => !!node.closest(".lesson-review-content__scroll"),
    ),
  );
  await inspectLayout("mixed-worksheet-and-html");
  await menu();
  await popup
    .getByRole("button", { name: "첫 번째 학습지", exact: true })
    .click();
  await waitZoom(110);
  assert.equal(await input().inputValue(), "내가 채운 내용");
  await popup.getByRole("button", { name: "학습지 닫기", exact: true }).click();
  await open();
  await waitZoom(110);
  assert.equal(await input().inputValue(), "내가 채운 내용");
  const reads = await page.evaluate(() => window.popupQa.reads);
  assert.equal(reads.filter((value) => value === "tree").length, 1);
  assert.equal(reads.filter((value) => value === "lesson:a").length, 1);
  assert.equal(reads.filter((value) => value === "lesson:b").length, 1);
  assert.equal(reads.filter((value) => value.includes("/units/")).length, 2);
  assert.equal(
    reads.length,
    5,
    "Only catalog and selected lesson/progress reads; no reward bulk reads",
  );
  assert.deepEqual(await page.evaluate(() => window.popupQa.saves), []);
  await popup.getByRole("button", { name: "저장 가능", exact: true }).click();
  await page.waitForFunction(() => window.popupQa.saves.length === 1);
  assert.equal(
    (await page.evaluate(() => window.popupQa.saves[0])).answers.blank,
    "내가 채운 내용",
  );
  assert.equal(
    (await page.evaluate(() => window.popupQa.saves[0])).expectedAnswerRevision,
    4,
  );
  await page.evaluate(() => window.changeScope("student-b", "1"));
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "조선",
  );
  assert.equal(
    await popup.locator(".quiz-lesson-popup__body").count(),
    1,
    "Old account/semester cached lesson panes are discarded",
  );
  assert(
    (await page.evaluate(() => window.popupQa.reads)).includes(
      "years/2026/semesters/1/lesson_progress/student-b/units/a",
    ),
  );
  await page.evaluate(() => {
    window.popupQa.failProgress = true;
    window.changeScope("student-c", "2");
  });
  await popup.getByRole("alert").waitFor();
  assert.equal(
    await popup.locator(".worksheet-blank-input:visible").count(),
    0,
    "Failed saved-answer reads never look like empty answers",
  );
  await popup
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".quiz-lesson-popup__body:not([hidden]) .worksheet-blank-input",
      )?.value === "조선",
  );
  await page.keyboard.press("Escape");
  assert.equal(await popup.isVisible(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "연결된 학습지 열기", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    pass: true,
    browser: browserName,
    evidence,
    layouts,
    pageTransitions,
    readsBeforeSave: reads,
    saveCount: await page.evaluate(() => window.popupQa.saves.length),
    errors,
    external,
    checks:
      "320/390/768/1280/1440 and 568/900 heights, one content scroller, first 100%, zoom/reset/Ctrl-wheel, ordinary wheel scroll, fixed accessible controls, worksheet plus HTML, page and lesson changes, reopen draft retention, dropdown order, five bounded reads, no unchanged saves, explicit save revision, account/semester reset, saved-answer retry, Escape/focus",
  };
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, layouts: layouts.length }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
