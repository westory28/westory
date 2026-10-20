/** Exercise the real calculator UI with synthetic Firestore boundaries. */
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
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.SCORE_CALCULATOR_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-score-calculator-")));
await fs.mkdir(evidence, { recursive: true });
const source = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const service = `
const legacyScores=location.search.includes('legacy-decimal')?{'users/score-fixture/academic_records/2026_2':{scores:{korean_0:'81.7',korean_1:'15.4',korean_2:'24.2'}}}:{};
export const qa=window.scoreQa={reads:[],writes:[],saved:legacyScores,hold:false,fail:false,toasts:[]};
export const useAppToast=()=>({showToast:toast=>qa.toasts.push(toast)});
export const config={year:'2026',semester:'2'};
export const useAuth=()=>({config,currentUser:{uid:'score-fixture'},userData:{uid:'score-fixture',grade:'3',scoreWarningAcknowledged:true}});
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=doc,query=ref=>ref,orderBy=()=>({}),serverTimestamp=()=>123;
const plans=[{id:'korean',subject:'국어',targetGrade:'3',items:[{name:'2차 정기시험',maxScore:100,ratio:50,type:'정기'},{name:'문장의 짜임 탐구 및 활용하기(논술형)',maxScore:20,ratio:20,type:'수행'},{name:'청중을 고려하며 자신 있게 말하기(구술형)',maxScore:30,ratio:30,type:'수행'}]},{id:'math',subject:'수학',targetGrade:'3',items:[{name:'1차 정기시험',maxScore:100,ratio:50,type:'정기'},{name:'여러 가지 도형을 활용한 수학적 탐구와 발표 활동',maxScore:20,ratio:50,type:'수행'}]},...['사회','역사','도덕','과학','영어','기술·가정','체육'].map((subject,index)=>({id:'extra-'+index,subject,targetGrade:'3',items:[{name:'2차 정기시험',maxScore:100,ratio:60,type:'정기'},{name:'자료를 분석하고 나의 생각 발표하기',maxScore:40,ratio:40,type:'수행'}]}))];
export const onSnapshot=(ref,next,error)=>{qa.reads.push(ref.path);queueMicrotask(()=>{if(location.search.includes('load-error'))error(new Error('fixture read failure'));else next({docs:(location.search.includes('empty')?[]:plans).map(plan=>({id:plan.id,data:()=>plan}))});});return ()=>{};};
export const getDoc=async ref=>{qa.reads.push(ref.path);return {exists:()=>Boolean(qa.saved[ref.path]),data:()=>qa.saved[ref.path]};};
export const getDocFromServer=getDoc;
export const setDoc=async(ref,data)=>{qa.writes.push({path:ref.path,data:structuredClone(data)});if(qa.hold)await new Promise(resolve=>{qa.release=resolve});if(qa.fail)throw new Error('fixture write failure');qa.saved[ref.path]=structuredClone(data);};
`;
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from ${source("src/pages/student/score/ScoreDashboard.tsx")};import ${source("src/assets/index.css")};import ${source("src/components/layout/studentLayout.css")};createRoot(document.getElementById('root')).render(<div className="student-layout"><Dashboard/></div>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(evidence, "fixture.js"),
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "score-boundaries",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:^|\/)(?:firebase|AuthContext|AppToastProvider)$/,
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
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const asset =
    pathname === "/fixture.js"
      ? ["text/javascript", js]
      : pathname === "/fixture.css"
        ? ["text/css", css]
        : pathname === "/tailwind.js"
          ? ["text/javascript", tailwind]
          : ["text/html", html];
  res.setHeader("Content-Type", asset[0] + ";charset=utf-8");
  res.end(asset[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const results = [];
let activePage;
const subjectNames = [
  "국어",
  "수학",
  "사회",
  "역사",
  "도덕",
  "과학",
  "영어",
  "기술·가정",
  "체육",
];
const subject = (page, name) =>
  page.getByRole("region", { name: `${name} 점수 계산`, exact: true });
const toggle = (page, name) =>
  page.getByRole("button", { name: `${name} 점수 입력`, exact: true });
const chartRow = (page, name) =>
  page
    .getByRole("region", { name: "전체 과목 점수", exact: true })
    .getByRole("button", {
      name: `${name} 점수 입력으로 이동`,
      exact: true,
    });
const waitForTotal = (page, name, expected) =>
  page.waitForFunction(
    ({ name, expected }) =>
      document
        .querySelector(`section[aria-label="${name} 점수 계산"]`)
        ?.querySelector(".score-calculator__total strong")
        ?.textContent.trim() === `${expected}점` &&
      document
        .querySelector(`button[aria-label="${name} 점수 입력으로 이동"]`)
        ?.querySelector(".score-calculator__chart-value")
        ?.textContent.includes(`${expected}점`),
    { name, expected },
  );
const assertAccordion = async (page, expandedSubject) => {
  for (const name of subjectNames) {
    const button = toggle(page, name);
    const expanded = name === expandedSubject;
    assert.equal(await button.count(), 1);
    assert.equal(
      await button.getAttribute("aria-expanded"),
      String(expanded),
      `${name} accordion expanded state`,
    );
    const relation = await button.evaluate((element) => {
      const panelId = element.getAttribute("aria-controls");
      const panel = panelId && document.getElementById(panelId);
      return {
        isHeadingButton: element.closest("h2") !== null,
        hasPanel: Boolean(panel),
        hidden: panel?.hidden,
        display: panel && getComputedStyle(panel).display,
        height: element.getBoundingClientRect().height,
      };
    });
    assert.equal(relation.isHeadingButton, true);
    assert.equal(
      relation.hasPanel,
      true,
      `${name} has an aria-controls target`,
    );
    assert.equal(relation.hidden, !expanded, `${name} uses native hidden`);
    if (!expanded) assert.equal(relation.display, "none");
    assert(relation.height >= 44, `${name} accordion target is at least 44px`);
  }
};
const assertIntegerDisplays = async (page) => {
  const displays = await page
    .locator(
      ".score-calculator__total strong, .score-calculator__weighted, .score-calculator__chart-value, input[type=range]",
    )
    .evaluateAll((elements) =>
      elements.map((element) =>
        element instanceof HTMLInputElement
          ? element.getAttribute("aria-valuetext") || ""
          : element.textContent || "",
      ),
    );
  assert(
    displays.every((text) => !/\d+\.\d+/.test(text)),
    `All score displays use integers: ${JSON.stringify(displays)}`,
  );
};
try {
  for (const width of [320, 390, 768, 1280, 1366, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "점수 계산기", exact: true })
      .waitFor();
    const korean = subject(page, "국어");
    await korean.waitFor();
    assert.equal(await page.locator(".score-calculator__subject").count(), 9);
    assert.equal(await page.locator("input[type=range]").count(), 19);
    await assertAccordion(page, "국어");
    for (const name of subjectNames)
      assert.equal(await chartRow(page, name).isVisible(), true);
    assert.equal(
      await page
        .locator("input[type=range], input[type=number]")
        .evaluateAll((inputs) => inputs.every((input) => input.step === "1")),
      true,
    );
    assert.equal(await korean.getByRole("spinbutton").first().inputValue(), "");
    await korean.getByRole("spinbutton").nth(0).fill("80");
    await korean.getByRole("spinbutton").nth(1).fill("15");
    await korean.getByRole("spinbutton").nth(2).fill("24");
    await korean.getByRole("spinbutton").nth(2).blur();
    await waitForTotal(page, "국어", 79);
    assert.equal(
      await korean.locator(".score-calculator__grade").innerText(),
      "C",
    );
    await korean.getByRole("slider").nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      () => document.querySelector("input[type=number]").value === "81",
    );
    await waitForTotal(page, "국어", 80);
    await assertIntegerDisplays(page);
    assert.equal(await page.evaluate(() => window.scoreQa.writes.length), 0);
    await page
      .getByRole("button", { name: "점수 저장", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(".score-calculator__save-status").textContent ===
        "저장 완료",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.scoreQa.saved["users/score-fixture/academic_records/2026_2"]
            .scores.korean_0,
      ),
      "81",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("scoreDraft:score-fixture:2026:2"),
      ),
      null,
    );
    await korean.getByRole("spinbutton").nth(0).fill("81.7");
    await korean.getByRole("spinbutton").nth(0).blur();
    await page.waitForFunction(
      () => document.querySelector("input[type=number]").value === "82",
    );
    await waitForTotal(page, "국어", 80);
    await korean.getByRole("spinbutton").nth(1).fill("");
    await korean.getByRole("spinbutton").nth(1).blur();
    assert.equal(await korean.locator(".score-calculator__grade").count(), 0);
    await korean.getByRole("spinbutton").nth(1).fill("0");
    await korean.getByRole("spinbutton").nth(1).blur();
    assert.equal(await korean.locator(".score-calculator__grade").count(), 1);
    await waitForTotal(page, "국어", 65);
    await chartRow(page, "수학").click();
    await assertAccordion(page, "수학");
    const math = subject(page, "수학");
    await math.getByRole("spinbutton").nth(0).fill("81");
    await math.getByRole("spinbutton").nth(1).fill("15");
    await math.getByRole("spinbutton").nth(1).blur();
    // 40.5 + 37.5 must total 78; adding rounded contributions would give 79.
    await waitForTotal(page, "수학", 78);
    await assertIntegerDisplays(page);
    await toggle(page, "수학").focus();
    await page.keyboard.press("Enter");
    await assertAccordion(page, null);
    await page.keyboard.press("Space");
    await assertAccordion(page, "수학");
    await chartRow(page, "국어").click();
    await assertAccordion(page, "국어");
    assert.equal(
      await korean.getByRole("spinbutton").nth(0).inputValue(),
      "82",
    );
    assert.equal(await korean.getByRole("spinbutton").nth(1).inputValue(), "0");
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.scrollTo({ top: 0, behavior: "instant" });
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const sizes = await page.evaluate(() => {
      const bounds = (selector) => {
        const { x, y, width, height, right, bottom } = document
          .querySelector(selector)
          .getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return {
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        layout: bounds(".score-calculator__layout"),
        subjects: bounds(".score-calculator__subjects"),
        overview: bounds(".score-calculator__overview"),
        overviewPosition: getComputedStyle(
          document.querySelector(".score-calculator__overview"),
        ).position,
        collapsedHeights: [
          ...document.querySelectorAll(".score-calculator__subject"),
        ]
          .filter((element) =>
            element.querySelector('h2 button[aria-expanded="false"]'),
          )
          .map((element) => element.getBoundingClientRect().height),
        smallControls: [...document.querySelectorAll("input")].filter(
          (element) =>
            element.getClientRects().length > 0 &&
            element.getBoundingClientRect().height < 44,
        ).length,
        fixedStatus: [
          ...document.querySelectorAll(".score-calculator__save-status"),
        ].some((element) => getComputedStyle(element).position === "fixed"),
        colors: Object.fromEntries(
          ["exam", "performance"].map((type) => {
            const color = getComputedStyle(
              document.querySelector(
                `.score-calculator__bar-segment[data-type="${type}"]`,
              ),
            ).backgroundColor;
            // Browsers may serialize color-mix as color(srgb ...), not rgb().
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d");
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [
              type,
              {
                css: color,
                rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3),
              },
            ];
          }),
        ),
      };
    });
    assert(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes));
    assert.equal(sizes.smallControls, 0);
    assert.equal(sizes.fixedStatus, false);
    assert.equal(sizes.collapsedHeights.length, 8);
    assert(
      sizes.collapsedHeights.every((height) => height <= 136),
      `Closed subjects remain compact: ${JSON.stringify(sizes)}`,
    );
    if (sizes.layout.width >= 800) {
      assert(
        sizes.subjects.right <= sizes.overview.x + 1,
        `Inputs are left of the overview: ${JSON.stringify(sizes)}`,
      );
      assert(
        Math.abs(sizes.subjects.y - sizes.overview.y) <= 1,
        `The two columns share their top edge: ${JSON.stringify(sizes)}`,
      );
      assert(sizes.subjects.width >= 399);
      assert(sizes.overview.height <= 720, "Nine graph rows remain compact");
      assert.equal(sizes.overviewPosition, "sticky");
    } else {
      assert(
        sizes.overview.y >= sizes.subjects.bottom - 1,
        `Small containers use a single column: ${JSON.stringify(sizes)}`,
      );
      assert.notEqual(sizes.overviewPosition, "sticky");
    }
    const [examRed, examGreen, examBlue] = sizes.colors.exam.rgb;
    const [performanceRed, performanceGreen, performanceBlue] =
      sizes.colors.performance.rgb;
    assert(examBlue > examRed && examBlue > examGreen, "Exam bars are blue");
    assert(
      performanceRed > performanceGreen && performanceGreen > performanceBlue,
      "Performance bars are orange",
    );
    await page.screenshot({
      path: path.join(evidence, `calculator-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({
      width,
      subjectCount: 9,
      singleAccordion: true,
      integerInputsAndDisplay: true,
      liveOverview: true,
      roundedTotalPreservesContributionPrecision: true,
      sizes,
      status: "passed",
    });
    if (width === 1440) {
      const boundaries = [];
      for (const contentWidth of [799, 800]) {
        const measured = await page.evaluate((contentWidth) => {
          const container = document.querySelector(".score-calculator");
          Object.assign(container.style, {
            width: `${contentWidth}px`,
            maxWidth: "none",
            boxSizing: "content-box",
          });
          const layout = document.querySelector(".score-calculator__layout");
          const input = document.querySelector(".score-calculator__subjects");
          const overview = document.querySelector(
            ".score-calculator__overview",
          );
          const inputBounds = input.getBoundingClientRect();
          const overviewBounds = overview.getBoundingClientRect();
          return {
            width: layout.getBoundingClientRect().width,
            sideBySide: inputBounds.right <= overviewBounds.left + 1,
            oneColumn: overviewBounds.top >= inputBounds.bottom - 1,
          };
        }, contentWidth);
        assert.equal(measured.width, contentWidth);
        assert.equal(measured.sideBySide, contentWidth >= 800);
        assert.equal(measured.oneColumn, contentWidth < 800);
        boundaries.push(measured);
      }
      results.push({ containerQueryBoundary: boundaries });
    }
    await page.close();
  }
  const page = await browser.newPage();
  activePage = page;
  await page.goto(origin);
  await toggle(page, "국어").waitFor();
  const first = page.getByRole("spinbutton").first();
  await first.fill("60");
  await first.blur();
  await page.evaluate(() => {
    window.scoreQa.hold = true;
  });
  await page
    .getByRole("button", { name: "점수 저장", exact: true })
    .first()
    .click();
  await first.fill("70");
  await first.blur();
  await page.evaluate(() => {
    window.scoreQa.release();
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".score-calculator__save-status").textContent ===
      "저장되지 않은 변경",
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("scoreDraft:score-fixture:2026:2"))
          .scores.korean_0,
    ),
    "70",
  );
  await page.evaluate(() => {
    window.scoreQa.hold = false;
    window.scoreQa.fail = true;
  });
  await page
    .getByRole("button", { name: "점수 저장", exact: true })
    .first()
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(await first.inputValue(), "70");
  await page.evaluate(() => {
    window.scoreQa.fail = false;
  });
  await page
    .getByRole("button", { name: "점수 저장", exact: true })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".score-calculator__save-status").textContent ===
      "저장 완료",
  );
  await first.fill("75");
  await first.blur();
  await page.getByLabel("학기", { exact: true }).selectOption("1");
  await toggle(page, "국어").waitFor();
  assert.equal(await page.getByRole("spinbutton").first().inputValue(), "");
  await page.getByLabel("학기", { exact: true }).selectOption("2");
  await page.waitForFunction(
    () => document.querySelector("input[type=number]")?.value === "75",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("input[type=number]")?.value === "75",
  );
  results.push({
    saveRace: true,
    saveFailureRetry: true,
    semesterIsolation: true,
    draftRecovery: true,
  });
  await page.close();
  const legacyPage = await browser.newPage();
  activePage = legacyPage;
  await legacyPage.goto(origin + "/?legacy-decimal");
  const legacyKorean = subject(legacyPage, "국어");
  await legacyKorean.getByRole("spinbutton").first().waitFor();
  assert.deepEqual(
    await legacyKorean
      .getByRole("spinbutton")
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["82", "15", "24"],
  );
  await waitForTotal(legacyPage, "국어", 80);
  await legacyPage.waitForFunction(
    () =>
      document.querySelector(".score-calculator__save-status").textContent ===
      "저장되지 않은 변경",
  );
  assert.equal(
    await legacyPage.evaluate(() => window.scoreQa.writes.length),
    0,
  );
  assert.equal(
    await legacyPage.evaluate(
      () =>
        window.scoreQa.saved["users/score-fixture/academic_records/2026_2"]
          .scores.korean_0,
    ),
    "81.7",
  );
  // The existing lifecycle saves dirty state before leaving the page.
  // Normalization must survive that lifecycle without writing to Firestore.
  await legacyPage.reload();
  await waitForTotal(legacyPage, "국어", 80);
  assert.equal(
    await legacyPage.evaluate(() => window.scoreQa.writes.length),
    0,
  );
  assert.equal(
    await legacyPage.evaluate(
      () =>
        JSON.parse(localStorage.getItem("scoreDraft:score-fixture:2026:2"))
          .scores.korean_0,
    ),
    "82",
  );
  await legacyPage.screenshot({
    path: path.join(evidence, "calculator-legacy-normalized.png"),
    fullPage: true,
  });
  await legacyPage
    .getByRole("button", { name: "점수 저장", exact: true })
    .first()
    .click();
  await legacyPage.waitForFunction(
    () =>
      window.scoreQa.saved["users/score-fixture/academic_records/2026_2"].scores
        .korean_0 === "82",
  );
  await assertIntegerDisplays(legacyPage);
  results.push({ legacyDecimalDraft: true, explicitLegacyDecimalSave: true });
  await legacyPage.goto(origin + "/?empty");
  await legacyPage
    .getByText("해당 학기의 평가 기준 데이터가 없습니다.")
    .waitFor();
  await legacyPage.goto(origin + "/?load-error");
  await legacyPage.getByRole("alert").waitFor();
  results.push({ emptyState: true, loadError: true });
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ evidence, results }, null, 2));
} catch (error) {
  await activePage
    ?.screenshot({
      path: path.join(evidence, "failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  await fs.writeFile(
    path.join(evidence, "failure.json"),
    JSON.stringify(
      { error: String(error), stack: error.stack, results },
      null,
      2,
    ),
  );
  console.error(`Calculator evidence: ${evidence}`);
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
