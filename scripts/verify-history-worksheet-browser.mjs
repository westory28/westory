/**
 * Real component browser regression checks with synthetic, offline worksheet data.
 * No Firebase operation is made. Tailwind's production CDN runtime is served
 * locally because this app uses that runtime rather than a Tailwind build step.
 * PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_BROWSER_CHANNEL override local defaults.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
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
const evidence = path.join(
  root,
  ".superloopy/sessions/history-lesson-worksheets/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const tailwindCache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok, "Tailwind runtime download failed");
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const imp = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Stage from ${imp("src/components/common/LessonWorksheetStage.tsx")};
import HistoryView from ${imp("src/components/common/HistoryClassroomAssignmentView.tsx")};
const pages=[{page:1,imageUrl:'/worksheet.svg',width:1000,height:1400},{page:3,imageUrl:'/worksheet.svg?page=3',width:1000,height:1400}];
const blanks=[{id:'first',page:1,leftRatio:.15,topRatio:.2,widthRatio:.18,heightRatio:.03,answer:'고조선',prompt:'첫 번째 빈칸',source:'ocr'},{id:'tiny',page:1,leftRatio:.4,topRatio:.2,widthRatio:.03,heightRatio:.012,answer:'왕',prompt:'왕',source:'manual'},{id:'third',page:3,leftRatio:.15,topRatio:.2,widthRatio:.18,heightRatio:.03,answer:'삼국 시대',prompt:'다음 페이지 빈칸',source:'manual'}];
const regions=[{label:'고조선',page:1,left:155,top:285,width:150,height:28}];
const params=new URLSearchParams(location.search), mode=params.get('mode')||'student-solve',kind=params.get('kind')||'stage';
if(params.has('lower'))blanks.push({id:'lower',page:1,leftRatio:.65,topRatio:.9,widthRatio:.18,heightRatio:.03,answer:'고려',prompt:'자료 하단 빈칸',source:'manual'});
function Fixture(){const [answers,setAnswers]=useState(params.has('readonly')?{first:'삼국'}:{}),[page,setPage]=useState(1),[selected,setSelected]=useState('');
const assignment={id:'fixture',title:'고대 국가의 형성',description:'',sourceType:kind==='history-lesson'?'lesson':'map',lessonUnitId:'unit-1',lessonTitle:'고조선',lessonUnitPath:['I. 고대','1. 고조선'],mapTitle:'한반도',mapResourceId:'map-1',pdfPageImages:pages,pdfRegions:regions,blanks:blanks.map(b=>({id:b.id,page:b.page,left:b.leftRatio*1000,top:b.topRatio*1400,width:b.widthRatio*1000,height:b.heightRatio*1400,answer:b.answer,prompt:b.prompt,source:b.source})),answerOptions:['고조선','삼국 시대','왕'],passThresholdPercent:80,timeLimitMinutes:params.has('timer')?10:0};
return <main style={{padding:12,maxWidth:1440,margin:'0 auto',minWidth:0}}><h1 className="mb-4 text-lg font-bold">{kind==='stage'?mode:'역사교실 검증'}</h1><output data-testid="selected">{selected}</output>{kind==='stage'?<Stage pageImages={pages} blanks={blanks} textRegions={regions} mode={mode} teacherTool="pan" annotationEnabled={false} studentAnswers={Object.fromEntries(Object.entries(answers).map(([id,value])=>[id,{value}]))} onStudentAnswerChange={(id,value)=>setAnswers(a=>({...a,[id]:value}))} onSelectBlank={setSelected} teacherCurrentPage={page} studentCurrentPage={page} onTeacherCurrentPageChange={setPage} onStudentCurrentPageChange={setPage}/>:<HistoryView assignment={assignment} currentPage={page} onCurrentPageChange={setPage} answers={answers} onAnswerChange={(id,value)=>setAnswers(a=>({...a,[id]:value}))} interactiveViewport={true} onSubmit={()=>setSelected('submitted')} readOnly={params.get('readonly')==='1'} countdownLabel={params.has('timer')?'09:32':null} answerChecks={params.has('readonly')?[{blankId:'first',correct:false,correctAnswer:'고조선'}]:[]} helperItems={[]}/>}<output data-testid="page">{page}</output><output data-testid="answers" className="sr-only">{JSON.stringify(answers)}</output></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const result = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-firebase",
      setup(build) {
        build.onResolve(
          { filter: /lib\/firebase$|^\.\/firebase$/ },
          (args) => ({ path: args.path, namespace: "offline" }),
        );
        build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents:
            "export const getHttpsCallable=()=>{throw new Error('Firebase is disabled in this fixture')};",
          loader: "js",
        }));
      },
    },
  ],
});
const css = (
  await Promise.all(
    ["assets/css/style.css", "src/assets/index.css"].map((file) =>
      fs.readFile(path.join(root, file), "utf8"),
    ),
  )
)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "")
  .replaceAll(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="100" y="120" font-size="40">I. 고대 · 1. 고조선</text><path d="M100 250H900M100 350H900M100 450H900M100 550H900M100 650H900" stroke="#d1d5db"/><text x="150" y="312" font-size="28">고조선</text><text x="400" y="295" font-size="16">왕</text><text x="100" y="410" font-size="28">한반도와 만주 지역에서 성장한 고대 국가</text></svg>`;
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    route === "/fixture.js"
      ? result.outputFiles[0].text
      : route === "/tailwind.js"
        ? tailwind
        : route === "/worksheet.svg"
          ? svg
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const waitLayout = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const measure = async (page, kind) =>
  page.evaluate((kind) => {
    const image = document.querySelector(
      kind === "stage" ? 'img[alt^="학습지"]' : "section img",
    );
    const rect = image.getBoundingClientRect();
    return {
      image: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      blanks: [...document.querySelectorAll('[data-blank-box="true"]')].map(
        (el) => {
          const b = el.getBoundingClientRect();
          return {
            left: (b.x - rect.x) / rect.width,
            top: (b.y - rect.y) / rect.height,
            width: b.width / rect.width,
            height: b.height / rect.height,
          };
        },
      ),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  }, kind);
const approximately = (a, b, message, tolerance = 0.002) =>
  assert(Math.abs(a - b) <= tolerance, `${message}: ${a} versus ${b}`);
const assertOriginalRects = (metrics, label, original) => {
  assert.equal(metrics.blanks.length, 2, `${label}: two original blanks`);
  for (let i = 0; i < 2; i++) {
    const expected =
      original?.[i] ||
      (i === 0
        ? { left: 0.15, top: 0.2, width: 0.18, height: 0.03 }
        : { left: 0.4, top: 0.2, width: 0.03, height: 0.012 });
    for (const key of Object.keys(expected))
      approximately(
        metrics.blanks[i][key],
        expected[key],
        `${label} blank ${i} ${key}`,
      );
  }
};
async function typeAndMeasure(page, selector) {
  const input = page.locator(selector).first();
  await input.tap();
  assert(
    await input.evaluate((el) => el === document.activeElement),
    "touch focuses the blank",
  );
  await input.fill("고조선");
  await waitLayout(page);
  const short = await input.evaluate((el) => ({
    font: getComputedStyle(el).fontSize,
    transform: getComputedStyle(el).transform,
    width: el.getBoundingClientRect().width,
  }));
  const value = "고조선과 삼국 시대의 정치 문화 그리고 생활 모습 123 ABC";
  await input.fill(value);
  await waitLayout(page);
  assert.equal(await input.inputValue(), value);
  const fit = await input.evaluate((el) => {
    const s = getComputedStyle(el),
      ctx = document.createElement("canvas").getContext("2d");
    ctx.font = s.font;
    const matrix = new DOMMatrixReadOnly(s.transform);
    return {
      font: parseFloat(s.fontSize),
      scale: matrix.a,
      text: ctx.measureText(el.value).width,
      available:
        el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
      scroll: el.scrollWidth,
      client: el.clientWidth,
      transform: s.transform,
    };
  });
  assert(
    fit.text <= fit.available + 2,
    `long Korean answer must fit: ${JSON.stringify(fit)}`,
  );
  assert(
    fit.font >= 16,
    "untransformed input font prevents iPad focus auto zoom",
  );
  assert(
    await input.evaluate((el) => el === document.activeElement),
    "answer resizing retains focus",
  );
  await input.dispatchEvent("compositionstart", { data: "" });
  await input.fill("고조선의 발전");
  await input.dispatchEvent("compositionupdate", { data: "발전" });
  await input.dispatchEvent("compositionend", { data: "발전" });
  assert.equal(await input.inputValue(), "고조선의 발전");
  assert(
    await input.evaluate((el) => el === document.activeElement),
    "composition keeps the same input focused",
  );
  return {
    short,
    long: fit,
    composition: "synthetic composition events; native OS IME not emulated",
  };
}
async function pinch(page, kind) {
  const image = page.locator(
    kind === "stage" ? 'img[alt^="학습지"]' : "section img",
  );
  await image.scrollIntoViewIfNeeded();
  const box = await image.boundingBox(),
    viewport = page.viewportSize();
  const x = Math.max(90, Math.min(viewport.width - 90, box.x + box.width / 2));
  const y = Math.max(100, Math.min(viewport.height - 180, box.y + 130));
  const session = await page.context().newCDPSession(page);
  const points = (distance) => [
    { id: 1, x: x - distance, y },
    { id: 2, x: x + distance, y },
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(30),
  });
  for (const distance of [40, 50, 65, 80])
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(distance),
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
  await waitLayout(page);
}
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    for (const kind of ["stage", "history-map", "history-lesson"]) {
      for (const mode of kind === "stage"
        ? ["teacher-edit", "teacher-present", "student-solve"]
        : ["student-solve"]) {
        const page = await browser.newPage({
          viewport,
          hasTouch: true,
          deviceScaleFactor: 1,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) =>
          route
            .request()
            .url()
            .startsWith(`http://127.0.0.1:${server.address().port}`)
            ? route.continue()
            : route.abort(),
        );
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?kind=${kind}&mode=${mode}`,
        );
        await page
          .locator(kind === "stage" ? 'img[alt^="학습지"]' : "section img")
          .waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector("main") &&
            getComputedStyle(document.querySelector("main h1")).fontWeight ===
              "700",
        );
        await waitLayout(page);
        const label = `${kind}-${mode}-${viewport.width}x${viewport.height}`;
        const before = await measure(page, kind);
        const toolbarBefore =
          kind === "stage"
            ? null
            : await page.locator('[data-history-toolbar="true"]').boundingBox();
        if (toolbarBefore)
          assert(
            toolbarBefore.height <= 104,
            `${label}: compact toolbar uses at most two 44px touch rows`,
          );
        assert(!before.overflow, `${label}: no document overflow`);
        if (kind !== "stage") {
          assert.equal(
            await page
              .locator('[data-history-actions="true"]')
              .evaluate((el) => getComputedStyle(el).position),
            "static",
            `${label}: coarse touch actions stay in document flow`,
          );
        }
        // Map OCR and teacher OCR highlighting retain their existing tight masks;
        // student lesson inputs must use the exact teacher-saved rectangles.
        const original =
          kind === "history-map" || mode === "teacher-edit"
            ? before.blanks
            : undefined;
        if (mode === "teacher-present")
          assert.equal(
            before.blanks.length,
            0,
            "presentation keeps answer fields hidden",
          );
        else assertOriginalRects(before, `${label} initial`, original);
        let input;
        if (mode === "student-solve")
          input = await typeAndMeasure(page, 'input[type="text"]');
        if (mode === "teacher-edit") {
          await page
            .getByRole("button", { name: "빈칸 선택", exact: true })
            .first()
            .tap();
          assert.equal(
            await page.getByTestId("selected").textContent(),
            "first",
          );
        }
        if (kind === "stage") {
          const img = page.locator('img[alt^="학습지"]');
          await img.dispatchEvent("wheel", {
            deltaY: -300,
            deltaMode: 0,
            ctrlKey: true,
            clientX: 150,
            clientY: 250,
          });
        } else
          await page
            .getByRole("button", { name: "자료 확대", exact: true })
            .click();
        await waitLayout(page);
        const zoomed = await measure(page, kind);
        if (toolbarBefore) {
          const toolbarZoomed = await page
            .locator('[data-history-toolbar="true"]')
            .boundingBox();
          assert(
            Math.abs(toolbarZoomed.width - toolbarBefore.width) < 1 &&
              Math.abs(toolbarZoomed.height - toolbarBefore.height) < 1,
            `${label}: document zoom does not resize the toolbar`,
          );
        }
        assert(
          zoomed.image.width > before.image.width * 1.05,
          `${label}: zoom increases the page`,
        );
        if (mode !== "teacher-present")
          assertOriginalRects(zoomed, `${label} zoomed`, original);
        if (kind === "stage")
          await page.locator('img[alt^="학습지"]').dispatchEvent("wheel", {
            deltaY: 300,
            deltaMode: 0,
            ctrlKey: true,
            clientX: 150,
            clientY: 250,
          });
        else
          await page
            .getByRole("button", { name: "전체 보기", exact: true })
            .click();
        await waitLayout(page);
        const reset = await measure(page, kind);
        if (mode !== "teacher-present")
          assertOriginalRects(reset, `${label} reset`, original);
        if (viewport.width === 768) {
          await pinch(page, kind);
          const pinched = await measure(page, kind);
          if (toolbarBefore) {
            const toolbarPinched = await page
              .locator('[data-history-toolbar="true"]')
              .boundingBox();
            assert(
              Math.abs(toolbarPinched.width - toolbarBefore.width) < 1 &&
                Math.abs(toolbarPinched.height - toolbarBefore.height) < 1,
              `${label}: pinch only scales the worksheet/map, not its toolbar`,
            );
          }
          assert(
            pinched.image.width > reset.image.width * 1.05,
            `${label}: two-finger touch pinch zooms the document`,
          );
          if (mode !== "teacher-present")
            assertOriginalRects(pinched, `${label} pinched`, original);
          await page.setViewportSize({ width: 1024, height: 768 });
          await waitLayout(page);
          const landscape = await measure(page, kind);
          assert(
            !landscape.overflow,
            `${label}: orientation has no horizontal document overflow`,
          );
          if (mode !== "teacher-present")
            assertOriginalRects(landscape, `${label} rotated`, original);
          await page.setViewportSize(viewport);
          await waitLayout(page);
        }
        await page
          .getByRole("button", {
            name:
              kind === "stage" && mode === "student-solve"
                ? "다음 페이지"
                : "다음",
            exact: true,
          })
          .tap();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="page"]').textContent === "3",
        );
        assert.equal(
          await page.getByTestId("page").textContent(),
          "3",
          `${label}: navigation preserves nonconsecutive source page ids`,
        );
        await page
          .getByRole("button", {
            name:
              kind === "stage" && mode === "student-solve"
                ? "이전 페이지"
                : "이전",
            exact: true,
          })
          .press("Enter");
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="page"]').textContent === "1",
        );
        assert.equal(await page.getByTestId("page").textContent(), "1");
        if (mode === "student-solve")
          assert.equal(
            await page.locator('input[type="text"]').first().inputValue(),
            "고조선의 발전",
            "page navigation retains answers",
          );
        assert.deepEqual(errors, [], `${label}: runtime errors`);
        if (kind !== "stage") {
          assert.equal(
            await page
              .locator('[data-history-actions="true"]')
              .evaluate((el) => getComputedStyle(el).position),
            "static",
            `${label}: touch actions remain in flow after input and page navigation`,
          );
        }
        await page.screenshot({
          path: path.join(evidence, `${label}.png`),
          fullPage: true,
        });
        reports.push({ label, viewport, before, zoomed, reset, input, errors });
        await page.close();
        console.log(`${label}: passed`);
      }
    }
  }
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: true });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?kind=history-lesson&lower=1&timer=1`,
    );
    const lower = page.getByRole("textbox", { name: "자료 하단 빈칸" });
    await lower.waitFor();
    await waitLayout(page);
    assert.equal(
      await page.getByText("09:32", { exact: true }).count(),
      1,
      "tablet countdown appears exactly once",
    );
    await lower.scrollIntoViewIfNeeded();
    const hit = await lower.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const target = document.elementFromPoint(
        b.x + b.width / 2,
        b.y + b.height / 2,
      );
      return {
        hit: target === el,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        covering: target?.outerHTML.slice(0, 150),
      };
    });
    assert(
      hit.hit,
      `lower worksheet blank is touch reachable at ${viewport.width}px: ${JSON.stringify(hit)}`,
    );
    await lower.tap();
    await lower.fill("고려의 발전");
    await waitLayout(page);
    await page.setViewportSize({
      width: viewport.width,
      height: Math.floor(viewport.height * 0.6),
    });
    await waitLayout(page);
    assert(
      await lower.evaluate((el) => el === document.activeElement),
      "viewport height change retains input focus",
    );
    assert.equal(await lower.inputValue(), "고려의 발전");
    await lower.scrollIntoViewIfNeeded();
    const keyboardHit = await lower.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return (
        document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === el
      );
    });
    assert(
      keyboardHit,
      "input can be brought into view above the reduced viewport edge",
    );
    await page.screenshot({
      path: path.join(evidence, `history-lower-keyboard-${viewport.width}.png`),
      fullPage: true,
    });
    await page.setViewportSize(viewport);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?kind=history-lesson&readonly=1`,
    );
    await page.locator('input[type="text"]').first().waitFor();
    assert.equal(
      await page.locator('input[type="text"]').first().getAttribute("readonly"),
      "",
    );
    assert.equal(
      await page.locator('input[type="text"]').first().inputValue(),
      "고조선",
      "review displays the correct answer for an incorrect response",
    );
    assert.match(
      await page.locator('input[type="text"]').first().getAttribute("class"),
      /text-rose-/,
      "incorrect review retains its status color",
    );
    assert.equal(
      await page.getByText("I. 고대 > 1. 고조선", { exact: true }).count(),
      1,
      "teacher curriculum path is shown once",
    );
    reports.push({
      label: `lower-viewport-readonly-${viewport.width}`,
      viewport,
      hit,
      keyboardHit,
      readonly: true,
    });
    await page.close();
    console.log(
      `lower blank / reduced viewport / readonly ${viewport.width}px: passed`,
    );
  }
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    hasTouch: false,
  });
  await desktop.goto(
    `http://127.0.0.1:${server.address().port}/?kind=history-lesson`,
  );
  await desktop.locator('[data-history-actions="true"]').waitFor();
  await waitLayout(desktop);
  assert.equal(
    await desktop
      .locator('[data-history-actions="true"]')
      .evaluate((el) => getComputedStyle(el).position),
    "static",
    "desktop submission stays in the worksheet toolbar without overlay",
  );
  assert.equal(
    await desktop
      .locator('[data-history-toolbar="true"]')
      .evaluate((el) => getComputedStyle(el).position),
    "sticky",
  );
  await desktop
    .getByRole("button", { name: "자료 확대", exact: true })
    .press("Enter");
  await waitLayout(desktop);
  assertOriginalRects(
    await measure(desktop, "history-lesson"),
    "desktop keyboard zoom",
  );
  await desktop.screenshot({
    path: path.join(evidence, "history-desktop-mouse-1440.png"),
    fullPage: true,
  });
  reports.push({ label: "desktop-mouse-keyboard-1440", fixedActions: false });
  await desktop.close();
  const recovery = await browser.newPage({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
  });
  await recovery.route("**/worksheet.svg", (route) =>
    route.abort("internetdisconnected"),
  );
  await recovery.goto(
    `http://127.0.0.1:${server.address().port}/?kind=history-lesson&timer=1`,
  );
  await recovery.getByRole("button", { name: "자료 다시 불러오기" }).waitFor();
  await recovery.unroute("**/worksheet.svg");
  await recovery.getByRole("button", { name: "자료 다시 불러오기" }).click();
  await recovery.waitForFunction(
    () => document.querySelector("section img")?.naturalWidth > 0,
  );
  await recovery
    .getByRole("button", { name: "자료 다시 불러오기" })
    .waitFor({ state: "hidden" });
  const toolbar = recovery.locator('[data-history-toolbar="true"]');
  await toolbar.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await recovery.evaluate(() => window.scrollBy(0, 120));
  const timerBox = await recovery
    .getByRole("timer", { name: "남은 시간" })
    .boundingBox();
  assert(
    timerBox && timerBox.y >= 0 && timerBox.y < 180,
    "countdown stays visible at the worksheet toolbar while solving",
  );
  const retryMetrics = await measure(recovery, "history-lesson");
  assertOriginalRects(retryMetrics, "image retry retains geometry");
  await recovery.screenshot({
    path: path.join(evidence, "history-image-recovery-768.png"),
    fullPage: true,
  });
  reports.push({
    label: "image-failure-retry-and-visible-timer-768",
    timerBox,
  });
  await recovery.close();
} finally {
  await fs.writeFile(
    path.join(evidence, "worksheet-browser-report.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        coverage:
          "actual React components; synthetic content; Edge touch emulation, not physical iPad Safari",
        reports,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Evidence: ${evidence}`);
