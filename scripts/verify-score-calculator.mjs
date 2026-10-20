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
export const qa=window.scoreQa={reads:[],writes:[],saved:{},hold:false,fail:false,toasts:[]};
export const useAppToast=()=>({showToast:toast=>qa.toasts.push(toast)});
export const config={year:'2026',semester:'2'};
export const useAuth=()=>({config,currentUser:{uid:'score-fixture'},userData:{uid:'score-fixture',grade:'3',scoreWarningAcknowledged:true}});
export const db={};
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=doc,query=ref=>ref,orderBy=()=>({}),serverTimestamp=()=>123;
const plans=[{id:'korean',subject:'국어',targetGrade:'3',items:[{name:'2차 정기시험',maxScore:100,ratio:50,type:'정기'},{name:'문장의 짜임 탐구 및 활용하기(논술형)',maxScore:20,ratio:20,type:'수행'},{name:'청중을 고려하며 자신 있게 말하기(구술형)',maxScore:30,ratio:30,type:'수행'}]},{id:'math',subject:'수학',targetGrade:'3',items:[{name:'1차 정기시험',maxScore:100,ratio:50,type:'정기'},{name:'여러 가지 도형을 활용한 수학적 탐구와 발표 활동',maxScore:20,ratio:50,type:'수행'}]}];
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
try {
  for (const width of [320, 390, 768, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "점수 계산기", exact: true })
      .waitFor();
    const korean = page.getByRole("region", { name: "국어 점수 계산" });
    await korean.waitFor();
    assert.equal(await page.locator("input[type=range]").count(), 5);
    assert.equal(await korean.getByRole("spinbutton").first().inputValue(), "");
    await korean.getByRole("spinbutton").nth(0).fill("80");
    await korean.getByRole("spinbutton").nth(1).fill("15");
    await korean.getByRole("spinbutton").nth(2).fill("24");
    await korean.getByRole("spinbutton").nth(2).blur();
    await page.waitForFunction(
      () =>
        document.querySelector(".score-calculator__total strong")
          .textContent === "79점",
    );
    assert.equal(
      await korean.locator(".score-calculator__grade").innerText(),
      "C",
    );
    await korean.getByRole("slider").nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      () => document.querySelector("input[type=number]").value === "80.1",
    );
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
      "80.1",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("scoreDraft:score-fixture:2026:2"),
      ),
      null,
    );
    await korean.getByRole("spinbutton").nth(1).fill("");
    await korean.getByRole("spinbutton").nth(1).blur();
    assert.equal(await korean.locator(".score-calculator__grade").count(), 0);
    await korean.getByRole("spinbutton").nth(1).fill("0");
    await korean.getByRole("spinbutton").nth(1).blur();
    assert.equal(await korean.locator(".score-calculator__grade").count(), 1);
    const sizes = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      smallControls: [...document.querySelectorAll("input")].filter(
        (e) => e.getBoundingClientRect().height < 44,
      ).length,
      fixedStatus: [
        ...document.querySelectorAll(".score-calculator__save-status"),
      ].some((e) => getComputedStyle(e).position === "fixed"),
    }));
    assert(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes));
    assert.equal(sizes.smallControls, 0);
    assert.equal(sizes.fixedStatus, false);
    await page.screenshot({
      path: path.join(evidence, `calculator-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({ width, status: "passed" });
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(origin);
  await page.getByRole("heading", { name: "국어", exact: true }).waitFor();
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
  await page.getByRole("heading", { name: "국어", exact: true }).waitFor();
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
  await page.goto(origin + "/?empty");
  await page.getByText("해당 학기의 평가 기준 데이터가 없습니다.").waitFor();
  await page.goto(origin + "/?load-error");
  await page.getByRole("alert").waitFor();
  results.push({ emptyState: true, loadError: true });
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ evidence, results }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
