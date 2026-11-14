// Synthetic scores only. Add --browser for responsive component verification.
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";

const definitions = [
  {
    name: "근거 제시",
    shortName: "1-(1)",
    itemKey: "1-(1)",
    examSection: "essay",
    maxScore: 3,
  },
  {
    name: "역사적 설명",
    shortName: "1-(2)",
    itemKey: "1-(2)",
    examSection: "essay",
    maxScore: 5,
  },
  {
    name: "선택형",
    itemKey: "objective-1",
    examSection: "objective",
    maxScore: 9,
  },
];
const student = (number, room, values) => ({
  uid: `synthetic-${room}-${number}`,
  grade: "3",
  class: room,
  number: String(number),
  studentName: number === 1 || number === 2 ? "동명이름" : `합성학생${number}`,
  rowNumber: number,
  enteredScoreCount: 999,
  totalScore: 999,
  totalMaxScore: 999,
  items: definitions.map((item, i) => ({
    ...item,
    score: i === 2 ? 9 : values[i],
    scoreEntered: i === 2 || values[i] !== null,
    feedback: i === 0 && number === 1 ? "답안에 적힌 근거를 확인했습니다." : "",
  })),
  feedback: number === 1 ? "교사가 직접 저장한 피드백입니다." : "",
  matchStatus: "matched",
  matchMessage: "",
});
const rows = [
  student(1, "1", [3, 5]),
  student(2, "1", [0, 0]),
  student(3, "1", [1, null]),
  student(4, "1", [null, null]),
  student(1, "2", [3, 1]),
];
const output = await build({
  entryPoints: ["src/lib/writtenExamEssayAnalysis.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const { buildWrittenExamEssayAnalysis: analyze, summarizeEssayScores } =
  module.exports;
let checks = 0;
const check = (name, run) => {
  run();
  checks++;
};
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
check(
  "total counts are based on actual essay items, excluding unrelated objective scores",
  () => {
    const data = analyze(rows, definitions);
    assert.equal(data.items.length, 2);
    assert.equal(data.studentCount, 5);
    assert.equal(data.completeCount, 3);
    assert.equal(data.partialCount, 1);
    assert.equal(data.missingCount, 1);
    assert.equal(data.totals.count, 3);
    close(data.totals.mean, 4);
    close(data.totals.standardDeviation, Math.sqrt(32 / 3));
    assert.equal(
      data.students.find((value) => value.number === "3").partialSum,
      1,
    );
    assert.equal(
      data.students.find((value) => value.number === "3").total,
      null,
    );
  },
);
check(
  "raw item means use entered items, retain zero, and separate missing",
  () => {
    const data = analyze(rows, definitions);
    close(data.items[0].summary.mean, 1.75);
    close(data.items[0].summary.standardDeviation, Math.sqrt(1.6875));
    assert.equal(data.items[0].missingCount, 1);
    assert.equal(data.items[1].missingCount, 2);
    close(data.items[1].summary.mean, 2);
    close(data.items[1].summary.standardDeviation, Math.sqrt(14 / 3));
    assert.equal(
      data.items[0].summary.distribution.find((value) => value.score === 0)
        .count,
      1,
    );
  },
);
check("class totals use complete students and retain all class rosters", () => {
  const data = analyze(rows, definitions);
  assert.equal(data.classes.length, 2);
  assert.equal(data.classes[0].studentCount, 4);
  close(data.classes[0].totals.mean, 4);
  close(data.classes[0].totals.standardDeviation, 4);
  close(data.classes[1].totals.mean, 4);
  close(data.classes[1].totals.standardDeviation, 0);
});
check("same names remain distinct and saved feedback is preserved", () => {
  const data = analyze(rows, definitions);
  assert.equal(
    data.students.filter((value) => value.name === "동명이름").length,
    3,
  );
  assert.equal(data.students[0].feedback, rows[0].feedback);
  assert.equal(
    data.students[0].itemFeedback[0].feedback,
    rows[0].items[0].feedback,
  );
});
check(
  "false overrides stale numeric score; null is missing even if entered flag is true",
  () => {
    const changed = structuredClone(rows);
    changed[0].items[0].scoreEntered = false;
    changed[0].items[1].score = null;
    changed[0].items[1].scoreEntered = true;
    const data = analyze(changed, definitions);
    assert.equal(data.students[0].status, "missing");
    assert.equal(data.students[0].total, null);
  },
);
check("missing definition item remains visible as partial, not zero", () => {
  const changed = structuredClone(rows);
  changed[0].items.splice(1, 1);
  const result = analyze(changed, definitions).students[0];
  assert.equal(result.enteredCount, 1);
  assert.equal(result.partialSum, 3);
  assert.equal(result.scores[1], null);
});
check("empty / no complete / all zero / singleton / decimal scores", () => {
  assert.equal(analyze([], definitions).totals.mean, null);
  assert.equal(
    analyze([rows[2], rows[3]], definitions).totals.standardDeviation,
    null,
  );
  assert.equal(analyze([rows[1]], definitions).totals.mean, 0);
  assert.equal(summarizeEssayScores([0, 0]).standardDeviation, 0);
  assert.equal(summarizeEssayScores([2.5]).standardDeviation, 0);
  close(summarizeEssayScores([0.5, 1.5]).mean, 1);
});
check(
  "definition maximum does not become a mastery denominator or reject valid raw scores",
  () => {
    const changed = structuredClone(definitions);
    changed[0].maxScore = 1;
    assert.equal(analyze(rows, changed).totals.mean, 4);
  },
);
check("duplicate item, student key, or UID is rejected", () => {
  assert.throws(() => analyze(rows, [...definitions, definitions[0]]), /중복/);
  assert.throws(() => analyze([...rows, rows[0]], definitions), /중복/);
  const changed = structuredClone(rows);
  changed[1].uid = changed[0].uid;
  assert.throws(() => analyze(changed, definitions), /중복/);
});
check(
  "unknown, duplicate, nonfinite, string or negative student item is rejected",
  () => {
    for (const mutate of [
      (row) => {
        row.items[0].itemKey = "unknown";
      },
      (row) => {
        row.items.push(structuredClone(row.items[0]));
      },
      (row) => {
        row.items[0].score = NaN;
      },
      (row) => {
        row.items[0].score = "3";
      },
      (row) => {
        row.items[0].score = -1;
      },
    ]) {
      const changed = structuredClone(rows);
      mutate(changed[0]);
      assert.throws(() => analyze(changed, definitions));
    }
  },
);
check(
  "new props reflect corrected scores and feedback without mutating input",
  () => {
    const before = JSON.stringify(rows);
    const changed = structuredClone(rows);
    changed[0].items[0].score = 1;
    changed[0].feedback = "수정된 교사 피드백";
    assert.equal(analyze(changed, definitions).students[0].total, 6);
    assert.equal(
      analyze(changed, definitions).students[0].feedback,
      "수정된 교사 피드백",
    );
    assert.equal(JSON.stringify(rows), before);
  },
);
console.log(JSON.stringify({ unitChecks: checks, passed: checks }));

if (process.argv.includes("--browser")) {
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
  const evidence = await fs.mkdtemp(
    path.join(os.tmpdir(), "westory-essay-analysis-"),
  );
  const compiled = await build({
    stdin: {
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import View from './src/pages/teacher/components/WrittenExamEssayAnalysis';
      const rows=${JSON.stringify(rows)},items=${JSON.stringify(definitions)};
      function App(){const[view,setView]=useState(0);const[data,setData]=useState(rows);window.essayQA={setView,setData,rows};return <main><nav aria-label="합성 보기 선택">{['전체 결과','문항별 점수','학급별 비교','학생별 결과'].map((label,i)=><button key={i} onClick={()=>setView(i)}>{label}</button>)}</nav><View rows={data} items={items} view={view}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = compiled.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  ).contents;
  const css =
    compiled.outputFiles.find((file) => file.path.endsWith(".css"))?.contents ||
    "";
  const server = http.createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(js);
    } else if (req.url === "/fixture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#111827}main{padding:16px;max-width:1152px;margin:auto}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}button{min-height:44px;font:inherit}header{background:white;min-height:64px;position:sticky;box-shadow:0 2px 5px #999}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin);
      await page.getByRole("heading", { name: "논술형 전체 결과" }).waitFor();
      for (const [index, label] of [
        "전체 결과",
        "문항별 점수",
        "학급별 비교",
        "학생별 결과",
      ].entries()) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await page
          .getByRole("heading", { name: `논술형 ${label}`, exact: true })
          .waitFor();
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          headingBackground: getComputedStyle(
            document.querySelector(".wea-heading"),
          ).backgroundColor,
          headingShadow: getComputedStyle(
            document.querySelector(".wea-heading"),
          ).boxShadow,
          tables: [...document.querySelectorAll(".wea-table-scroll")].map(
            (element) => ({
              width: element.clientWidth,
              scroll: element.scrollWidth,
              overflow: getComputedStyle(element).overflowX,
            }),
          ),
        }));
        assert.equal(layout.overflow, false);
        assert.equal(layout.headingBackground, "rgba(0, 0, 0, 0)");
        assert.equal(layout.headingShadow, "none");
        assert.ok(layout.tables.every((table) => table.overflow === "auto"));
        if (index === 3) {
          assert.equal(await page.locator(".wea-table tbody tr").count(), 5);
          assert.equal(
            await page.getByText("부분합 1", { exact: true }).count(),
            1,
          );
          assert.ok(
            (await page
              .getByText("교사가 직접 저장한 피드백입니다.", { exact: true })
              .count()) > 0,
          );
          await page.screenshot({
            path: path.join(evidence, `students-${width}.png`),
            fullPage: true,
          });
        }
        reports.push({ width, view: label, ...layout });
      }
      await page.getByRole("button", { name: "논술형 통계 기준" }).click();
      await page
        .getByText("표준편차는 현재 선택한 학생 집단을 기준으로 계산합니다.", {
          exact: false,
        })
        .last()
        .waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByRole("region", { name: "논술형 학생별 점수와 교사 피드백" })
        .focus();
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.classList.contains("wea-table-scroll"),
        ),
        true,
      );
    }
    await page.evaluate(() => window.essayQA.setData([]));
    await page.getByText("선택한 학급에 등록된 학생이 없습니다.").waitFor();
    await page.evaluate(() => {
      const rows = structuredClone(window.essayQA.rows);
      rows[0].items[0].score = -1;
      window.essayQA.setData(rows);
    });
    await page.getByRole("alert").waitFor();
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(evidence, "results.json"),
      JSON.stringify({ reports, errors, unitChecks: checks }, null, 2),
    );
    console.log(
      JSON.stringify({
        browserViews: reports.length,
        consoleErrors: errors.length,
        evidence,
      }),
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
