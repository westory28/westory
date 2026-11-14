import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd().replaceAll("\\", "/");
const require = createRequire(root + "/package.json");
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const out = path.resolve(
  process.env.WRITTEN_EXAM_CHART_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "written-exam-essay-charts"),
);
await fs.mkdir(out, { recursive: true });
const fixture = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Charts from'./src/pages/teacher/components/WrittenExamEssayCharts';
import{buildWrittenExamEssayAnalysis}from'./src/lib/writtenExamEssayAnalysis';
import'./src/components/common/portalPage.css';
const definitions=[{itemKey:'a',name:'1-(1)',examSection:'essay',maxScore:2},{itemKey:'b',name:'1-(2)',examSection:'essay',maxScore:3}];
function report(kind='normal'){
 const items=kind==='wide'?Array.from({length:24},(_,i)=>({itemKey:'q'+i,name:'긴 논술형 문항 '+(i+1)+'번',examSection:'essay',maxScore:10})):definitions;
 const values=[[0,0],[2,3],[1,null],[null,null],[2,2],[1,2]];
 const rows=values.map((scores,i)=>({uid:'synthetic-'+i,rowKey:String(i),grade:'3',class:i<3?'1':'2',number:String(i%3+1),studentName:'가상학생'+i,items:items.map((item,j)=>{const score=kind==='zero'?0:kind==='missing'?null:kind==='partial'?(j===0?1:null):kind==='wide'?i+j:scores[j];return{...item,score,scoreEntered:score!==null}})}));
 return buildWrittenExamEssayAnalysis(rows,items);
}
function App(){const[data,setData]=useState(()=>report()),[view,setView]=useState(0);window.chartQa={setView,setKind:kind=>setData(report(kind)),refresh:()=>setData(report()),visibleOnly:()=>setData(current=>({...current,students:current.students.slice(0,1)}))};return <main className='ws-page'><h2>논술형 그래프 확인</h2><Charts data={data} view={view}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: fixture, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  outdir: out,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  metafile: true,
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /firebase|writtenExamScoreSource/.test(file),
  ),
  "Charts must have no server/data service dependency",
);
const javascript = bundle.outputFiles.find((file) =>
  file.path.endsWith(".js"),
).text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#1f2937;font-family:Arial,sans-serif}.ws-page{padding:24px;max-width:1536px;margin:auto}h2{font-size:24px}${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js"
      ? "text/javascript"
      : "text/html;charset=utf-8",
  );
  response.end(request.url === "/fixture.js" ? javascript : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const evidence = { checks: [], errors: [], requests: [] };
let page;
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    evidence.requests.push(url);
    return url.startsWith(origin) ? route.continue() : route.abort();
  });
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.locator(".wea-chart-bar").first().waitFor();
    for (const view of [0, 1, 2]) {
      await page.evaluate((view) => window.chartQa.setView(view), view);
      await page
        .getByRole("figure", {
          name: ["논술형 총점 분포", "논술형 문항 평균", "논술형 학급 평균"][
            view
          ],
          exact: true,
        })
        .waitFor();
      const bars = page.locator(".wea-chart-column");
      const values = await bars.evaluateAll((nodes) =>
        nodes.map((node) => Number(node.dataset.value)),
      );
      assert.deepEqual(
        values,
        view === 0 ? [1, 1, 1, 1] : view === 1 ? [1.2, 1.75] : [2.5, 3.5],
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      const heading = await page
        .locator(".wea-chart-heading")
        .evaluate((node) => ({
          background: getComputedStyle(node).backgroundColor,
          shadow: getComputedStyle(node).boxShadow,
        }));
      assert.deepEqual(heading, {
        background: "rgba(0, 0, 0, 0)",
        shadow: "none",
      });
      const mark = page.locator(".wea-chart-bar").first();
      assert.equal(
        await mark.evaluate((node) => getComputedStyle(node).animationName),
        "quiz-chart-rise",
      );
      assert.equal(
        await mark.evaluate((node) => getComputedStyle(node).animationDuration),
        "0.3s",
      );
      assert(await bars.first().getAttribute("title"));
      await bars.first().focus();
      assert(
        await bars.first().evaluate((node) => node === document.activeElement),
      );
      assert.notEqual(
        await bars
          .first()
          .evaluate((node) => getComputedStyle(node).outlineStyle),
        "none",
      );
      await page.screenshot({
        path: path.join(out, `view-${view}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      evidence.checks.push({ width, view, values, heading });
    }
  }
  await page.evaluate(() => {
    window.chartQa.setView(0);
    window.chartQa.setKind("zero");
  });
  await page.waitForFunction(
    () => document.querySelector(".wea-chart-column")?.dataset.value === "6",
  );
  assert.equal(
    await page.locator(".wea-chart-column small").textContent(),
    "0점",
  );
  await page.evaluate(() => window.chartQa.setView(1));
  await page.waitForFunction(
    () => document.querySelector(".wea-chart-column")?.dataset.value === "0",
  );
  assert.equal(
    await page.locator(".wea-chart-bar").count(),
    2,
    "Observed zero retains a chart mark",
  );
  assert.deepEqual(
    await page
      .locator(".wea-chart-bar")
      .evaluateAll((nodes) => nodes.map((node) => node.style.height)),
    ["0%", "0%"],
  );
  await page.evaluate(() => window.chartQa.setKind("partial"));
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".wea-chart-column")[1]?.dataset.value ===
      "missing",
  );
  assert.equal(
    await page.locator(".wea-chart-bar").count(),
    1,
    "Missing data is never drawn as an observed zero",
  );
  assert.match(
    await page.locator(".wea-chart-column").nth(1).getAttribute("aria-label"),
    /입력된 점수 없음/,
  );
  for (const view of [0, 2]) {
    await page.evaluate((view) => window.chartQa.setView(view), view);
    await page.locator(".wea-chart-empty").waitFor();
    assert.equal(
      await page.locator(".wea-chart-bar").count(),
      0,
      "Incomplete totals are excluded from distributions and class means",
    );
  }
  await page.evaluate(() => {
    window.chartQa.setView(1);
    window.chartQa.setKind("missing");
  });
  await page
    .getByText("집계할 입력 점수가 없습니다.", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.chartQa.setKind("normal");
    window.chartQa.setView(0);
  });
  await page.locator(".wea-chart-bar").first().waitFor();
  const aggregate = await page.locator(".wea-chart-column").allTextContents();
  await page.evaluate(() => window.chartQa.visibleOnly());
  assert.deepEqual(
    await page.locator(".wea-chart-column").allTextContents(),
    aggregate,
    "Student display pagination never changes full-report aggregates",
  );
  await page.evaluate(() => window.chartQa.refresh());
  await page.waitForFunction(() =>
    document
      .querySelector(".wea-chart-bar")
      ?.getAnimations()
      .some((animation) => animation.playState === "running"),
  );
  await page
    .getByRole("button", { name: "논술형 총점 분포 기준", exact: true })
    .focus();
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => {
    window.chartQa.setKind("wide");
    window.chartQa.setView(1);
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".wea-chart-column").length === 24,
  );
  const scroll = page.locator(".wea-chart-scroll");
  assert(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth));
  await page.locator(".wea-chart-column").last().focus();
  assert(
    await scroll.evaluate((node) => node.scrollLeft > 0),
    "Keyboard focus reaches the final chart category through internal scrolling",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(out, "wide-keyboard-390.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.chartQa.refresh());
  assert.equal(
    await page
      .locator(".wea-chart-bar")
      .first()
      .evaluate((node) => getComputedStyle(node).animationDuration),
    "0.3s",
    "Existing explicit assessment motion exception is preserved",
  );
  await page.emulateMedia({ media: "print" });
  assert.equal(
    await page
      .locator(".wea-chart-bar")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  await page.evaluate(() => window.chartQa.setView(3));
  await page.locator(".wea-chart").waitFor({ state: "detached" });
  assert.deepEqual(evidence.errors, []);
  assert(
    evidence.requests.every((url) => url.startsWith(origin)),
    "No external network or AI calls",
  );
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.failure = error.stack;
  await page?.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `PASS essay charts: 3 charts × 390/768/1280/1440; zero/missing/partial; full aggregate invariance; keyboard/help; 300ms refresh and print motion; evidence ${out}`,
);
