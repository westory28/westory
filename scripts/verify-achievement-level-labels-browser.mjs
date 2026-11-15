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
  process.env.ACHIEVEMENT_LABEL_EVIDENCE_DIR ||
    "../evidence/achievement-level-labels",
);
await fs.mkdir(out, { recursive: true });
const mocks = {
  analysis: `export const ACHIEVEMENT_LEVELS=['A','B','C','D','E'];export const adaptAchievementAttempts=()=>[];export const buildAchievementAnalysis=()=>window.levelQa.analysis;`,
  service: `export const quizClassAnalysisError=e=>e.message;export const getQuizClassAchievement=async()=>{window.levelQa.calls++;return window.levelQa.data};`,
  updates: `export const useQuizClassUpdates=()=>{};`,
  loading: `export const LoadingOverlay=()=>null;`,
  component: `export default function Component(){return null}`,
};
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Analysis from'./src/pages/teacher/components/QuizAchievementAnalysis';import'./src/components/common/portalPage.css';import'./src/pages/teacher/components/QuizClassAnalysis.css';
const levels=['A','B','C','D','E','unclassified'];
const data={semesterId:'2026-2',grade:'3',complete:true,configuredClasses:[{id:'3-1'}],students:[],questions:[],rawRows:[],mockExamScoreRows:[],treeData:[]};
window.levelQa={calls:0,data,analysis:null};
const make=counts=>({attempts:counts.some(Boolean)?[{}]:[],cumulativeScores:[],standards:[],cells:[],students:[],forms:[],histogram:[],scoredCount:counts.reduce((a,b)=>a+b,0),mean:null,standardDeviation:null,unclassifiedItemCount:0,excludedChronologyCount:0,levelCohorts:levels.map((level,i)=>({level,count:counts[i],percent:counts[i]/(counts.reduce((a,b)=>a+b,0)||1)*100,mean:null,standardDeviation:null}))});
function App(){const[state,setState]=useState({version:0,kind:'regular',counts:[12,13,22,31,22,0]});window.levelQa.set=(kind,counts)=>setState(s=>({kind,counts,version:s.version+1}));window.levelQa.analysis=make(state.counts);return <main className='ws-page'><Analysis key={state.version} scope={{semesterId:'2026-2',grade:'3',unitId:'exam_prep',category:'exam_prep',examRound:'round_3',classIds:[]}} identityKey='synthetic' canEdit={false} reportView={0} suppliedData={state.kind==='regular'?data:undefined}/></main>}createRoot(document.getElementById('root')).render(<App/>);`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  outdir: out,
  entryNames: "app",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  plugins: [
    {
      name: "synthetic-analysis",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path: file }) => {
          const names = [
            [/\/lib\/achievementAnalysis$/, "analysis"],
            [/\/lib\/quizClassAnalysis$/, "service"],
            [/\/useQuizClassUpdates$/, "updates"],
            [/\/LoadingState$/, "loading"],
            [
              /\/(QuizAchievementEstimates|QuizAnalysisQuestionDialog)$/,
              "component",
            ],
          ];
          const name = names.find(([pattern]) => pattern.test(file))?.[1];
          return name ? { path: name, namespace: "qa" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path: name }) => ({
          contents: mocks[name],
          loader: "tsx",
        }));
      },
    },
  ],
});
const server = http.createServer(async (req, res) => {
  const file =
    req.url === "/app.js"
      ? "app.js"
      : req.url === "/app.css"
        ? "app.css"
        : null;
  res.setHeader(
    "Content-Type",
    file?.endsWith("js")
      ? "text/javascript"
      : file
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  res.end(
    file
      ? await fs.readFile(path.join(out, file))
      : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#f7f8fa;font-family:Arial,sans-serif}*{box-sizing:border-box}.ws-page{padding:16px;max-width:1440px;margin:auto}</style><div id="root"></div><script type="module" src="/app.js"></script></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const evidence = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(origin);
    for (const kind of ["regular", "mock"]) {
      await page.evaluate(
        (kind) => window.levelQa.set(kind, [12, 13, 22, 31, 22, 0]),
        kind,
      );
      await page.locator(".qaa-level-stack").waitFor();
      const result = await page.locator(".qaa-level-stack").evaluate((el) => {
        const box = el.getBoundingClientRect();
        const rgb = (color) =>
          color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
        const luminance = (color) =>
          color
            .map((channel) => channel / 255)
            .map((channel) =>
              channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4,
            )
            .reduce(
              (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
              0,
            );
        const under = rgb(getComputedStyle(el).backgroundColor);
        return {
          label: el.getAttribute("aria-label"),
          width: box.width,
          rows: [...el.children].map((node) => {
            const label = node.querySelector("b"),
              text = getComputedStyle(label),
              style = getComputedStyle(node);
            const background = getComputedStyle(node, "::before"),
              alpha = Number(background.opacity);
            const blended = rgb(background.backgroundColor).map(
              (channel, i) => alpha * channel + (1 - alpha) * under[i],
            );
            const luminances = [
              luminance(rgb(text.color)),
              luminance(blended),
            ].sort((a, b) => a - b);
            return {
              text: label.textContent,
              width: node.getBoundingClientRect().width,
              visible: text.visibility,
              opacity: style.opacity,
              title: node.title,
              contrast: (luminances[1] + 0.05) / (luminances[0] + 0.05),
            };
          }),
        };
      });
      assert.deepEqual(
        result.rows.map((row) => row.text),
        ["A", "B", "C", "D", "E"],
      );
      result.rows.forEach((row, i) => {
        assert.equal(row.visible, "visible");
        assert.equal(row.opacity, "1", "Labels must not inherit fading");
        assert(
          row.contrast >= 4.5,
          `${row.text} label contrast ${row.contrast}`,
        );
        assert(
          Math.abs((row.width / result.width) * 100 - [12, 13, 22, 31, 22][i]) <
            0.1,
          "True cohort percentages must be preserved",
        );
        assert.match(row.title, /명 ·/);
      });
      assert.match(result.label, /A 12명.*E 22명.*미분류 0명/);
      const table = page.getByRole("region", { name: "학생 성취수준별 분포" });
      await table.focus();
      assert(await table.evaluate((node) => node === document.activeElement));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(out, `${kind}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      evidence.push({ width, kind, ...result });
    }
    await page.evaluate(() =>
      window.levelQa.set("regular", [1, 0, 0, 0, 998, 1]),
    );
    await page.locator(".qaa-level-stack .qaa-level-unclassified").waitFor();
    const narrow = await page.locator(".qaa-level-stack").evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      segments: [...el.children].map((node) => ({
        text: node.textContent,
        width: node.getBoundingClientRect().width,
        visibility: getComputedStyle(node.querySelector("b")).visibility,
      })),
    }));
    assert.deepEqual(
      narrow.segments.map((row) => row.text),
      ["A", "E", "미분류"],
    );
    assert.equal(narrow.segments[0].visibility, "hidden");
    assert.equal(narrow.segments[2].visibility, "hidden");
    assert(
      Math.abs((narrow.segments[0].width / narrow.width) * 100 - 0.1) < 0.01,
      "Narrow cohort must not be enlarged to fit text",
    );
    await page.evaluate(() =>
      window.levelQa.set("regular", [10, 10, 10, 10, 10, 50]),
    );
    await page.locator(".qaa-level-stack .qaa-level-unclassified b").waitFor();
    assert.equal(
      await page
        .locator(".qaa-level-stack .qaa-level-unclassified b")
        .innerText(),
      "미분류",
    );
    await page.evaluate(() =>
      window.levelQa.set("regular", [0, 0, 0, 0, 0, 0]),
    );
    await page
      .getByText("아직 제출한 학생이 없습니다.", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".qaa-level-stack").count(), 0);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify({ evidence, errors }, null, 2),
  );
  console.log(
    `PASS level bar labels: regular/mock 320/390/768/1280/1440; labels, exact percentages, tiny/zero cohorts, accessible summaries. ${out}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
