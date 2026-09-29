/** Actual index recovery entry points, using local data and storage only. */
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
  ".superloopy/sessions/history-classroom-followup/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const tailwindCache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const mock = `export const db={};export const config={year:'2026',semester:'2'};export const useAuth=()=>({config,currentUser:{uid:'student-1'},userData:{uid:'student-1',role:'student'}});export const collection=(_db,path)=>({path});export const doc=(_db,...parts)=>({path:parts.join('/')});export const where=(key,op,value)=>({key,op,value});export const query=(ref,...constraints)=>({...ref,constraints});
const rows=path=>path==='history_classrooms'?(window.__data.legacyAssignments||[]):path.endsWith('/history_classrooms')?window.__data.assignments:path.endsWith('/history_classroom_results')?window.__data.results:[];
export const getDocs=async(ref)=>{const docs=rows(ref.path).map(value=>({id:value.id,data:()=>value}));return{docs,empty:!docs.length};};
const listeners=new Map();window.__listeners=listeners;
const snapshot=(path,value)=>({id:path.split('/').at(-1),exists:()=>!!value,data:()=>value});
window.__emit=(path,value)=>listeners.get(path)?.next(snapshot(path,value));window.__deny=path=>listeners.get(path)?.error({code:'permission-denied'});
export const onSnapshot=(ref,next,error)=>{listeners.set(ref.path,{next,error});const index=ref.path.lastIndexOf('/');const value=rows(ref.path.slice(0,index)).find(item=>item.id===ref.path.slice(index+1));queueMicrotask(()=>{if(listeners.has(ref.path))next(snapshot(ref.path,value));});return()=>listeners.delete(ref.path);};
export const getHttpsCallable=()=>{throw new Error('No callable allowed');};`;
const component = JSON.stringify(
  path
    .join(root, "src/pages/student/history-classroom/HistoryClassroomIndex.tsx")
    .replaceAll("\\", "/"),
);
const output = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,useLocation}from'react-router-dom';import Index from ${component};function App(){const location=useLocation();return location.pathname.includes('/run')?<p data-testid="route">{location.pathname+location.search}</p>:<Index/>;}createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/student/history-classroom']}><App/></MemoryRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "mock-boundaries",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:lib\/|^\.\/)(?:firebase)$|contexts\/AuthContext$/,
          },
          () => ({ path: "mock", namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: mock,
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
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/"
      ? "text/html; charset=utf-8"
      : "text/javascript; charset=utf-8",
  );
  res.end(
    req.url === "/fixture.js"
      ? output.outputFiles[0].text
      : req.url === "/tailwind.js"
        ? tailwind
        : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const now = Date.now();
const assignment = {
  id: "assignment-1",
  title: "마감된 과제 복구",
  isPublished: true,
  targetStudentUid: "student-1",
  targetStudentUids: ["student-1"],
  cooldownMinutes: 5,
  dueAt: { seconds: (now - 60000) / 1000 },
  publishedAt: { seconds: (now - 3600000) / 1000 },
  blanks: [
    {
      id: "blank-1",
      answer: "고조선",
      page: 1,
      left: 1,
      top: 1,
      width: 50,
      height: 20,
    },
  ],
};
const draft = {
  year: "2026",
  semester: "2",
  resultId: "result-1",
  savedAt: now,
  answers: { "blank-1": "고조선" },
  pendingSubmission: {
    status: "failed",
    reason: "due-window",
    answers: { "blank-1": "고조선" },
  },
};
const ownResult = {
  id: "result-1",
  uid: "student-1",
  assignmentId: "assignment-1",
  status: "passed",
  passed: true,
  percent: 100,
  createdAt: { seconds: now / 1000 },
};
const reports = [];
const assertBlocked = async (page, message) => {
  assert.equal(
    await page.locator("article").count(),
    1,
    "blocked assignment remains visible",
  );
  assert.equal(
    await page.locator("article button:enabled").count(),
    0,
    message,
  );
};
const scenarios = [
  { name: "closed-pending", recovery: true },
  { name: "cooldown-pending", assignment: { dueAt: null }, recovery: true },
  { name: "closed-no-pending", draft: null },
  {
    name: "wrong-user-key",
    key: "westoryHistoryClassroomAttempt:assignment-1:student-2",
  },
  {
    name: "wrong-assignment-key",
    key: "westoryHistoryClassroomAttempt:assignment-2:student-1",
  },
  { name: "wrong-user-payload", draft: { ...draft, uid: "student-2" } },
  {
    name: "wrong-assignment-payload",
    draft: { ...draft, assignmentId: "assignment-2" },
  },
  { name: "wrong-year", draft: { ...draft, year: "2025" } },
  { name: "wrong-semester", draft: { ...draft, semester: "1" } },
  { name: "unscoped", draft: { ...draft, year: undefined } },
  {
    name: "teacher-reset",
    assignment: {
      retryResetByStudentUid: { "student-1": { seconds: (now + 1000) / 1000 } },
    },
  },
  {
    name: "reset-version-rejects-pagehide-resaved-draft",
    assignment: {
      retryResetByStudentUid: { "student-1": { seconds: (now + 1000) / 1000 } },
    },
    draft: { ...draft, retryResetAtMs: 0, savedAt: now + 2000 },
  },
  {
    name: "current-reset-version-can-recover",
    assignment: {
      retryResetByStudentUid: { "student-1": { seconds: (now + 1000) / 1000 } },
    },
    draft: { ...draft, retryResetAtMs: now + 1000, savedAt: now + 2000 },
    recovery: true,
  },
  {
    name: "current-reset-version-survives-local-clock-change",
    assignment: {
      retryResetByStudentUid: { "student-1": { seconds: (now + 1000) / 1000 } },
    },
    draft: { ...draft, retryResetAtMs: now + 1000, savedAt: now - 1000 },
    recovery: true,
  },
  {
    name: "malformed-reset-version-uses-legacy-saved-at",
    assignment: {
      retryResetByStudentUid: { "student-1": { seconds: (now + 1000) / 1000 } },
    },
    draft: { ...draft, retryResetAtMs: -1 },
  },
  {
    name: "invalid-answers",
    draft: {
      ...draft,
      pendingSubmission: { ...draft.pendingSubmission, answers: [] },
    },
  },
  { name: "invalid-result-id", draft: { ...draft, resultId: "" } },
  {
    name: "already-committed",
    results: [ownResult],
    recovery: true,
    resultLabel: true,
  },
  {
    name: "different-passed-attempt",
    results: [{ ...ownResult, id: "other-result" }],
  },
  {
    name: "matching-result-wrong-user",
    results: [
      { ...ownResult, uid: "student-2", status: "failed", passed: false },
    ],
  },
  {
    name: "matching-result-wrong-assignment",
    results: [
      {
        ...ownResult,
        assignmentId: "assignment-2",
        status: "failed",
        passed: false,
      },
    ],
  },
];
try {
  for (const scenario of scenarios) {
    const widths =
      scenario.name === "closed-pending" ? [390, 768, 1280] : [768];
    for (const width of widths) {
      const page = await browser.newPage({
        viewport: { width, height: 1024 },
        hasTouch: true,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ assignment, draft, scenario, now }) => {
          window.__data = {
            assignments: [{ ...assignment, ...scenario.assignment }],
            results: scenario.results || [],
          };
          const saved = "draft" in scenario ? scenario.draft : draft;
          if (saved)
            localStorage.setItem(
              scenario.key ||
                "westoryHistoryClassroomAttempt:assignment-1:student-1",
              JSON.stringify(saved),
            );
          localStorage.setItem(
            "westoryHistoryClassroomLock:assignment-1:student-1",
            JSON.stringify({ savedAt: now, blockedUntil: now + 300000 }),
          );
        },
        { assignment, draft, scenario, now },
      );
      const url = `http://127.0.0.1:${server.address().port}`;
      await page.route("**/*", (route) =>
        route.request().url().startsWith(url)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(url);
      await page
        .getByRole("heading", { name: assignment.title, exact: true })
        .waitFor();
      const recovery = page.getByRole("button", {
        name: /^(제출 재시도|제출 결과 확인)$/,
      });
      if (scenario.recovery) {
        assert.equal(await recovery.count(), 1);
        assert(await recovery.isEnabled());
        assert.equal(
          await recovery.textContent(),
          scenario.resultLabel ? "제출 결과 확인" : "제출 재시도",
        );
        if (scenario.name === "closed-pending") {
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          await page.screenshot({
            path: path.join(evidence, `student-index-pending-${width}.png`),
            fullPage: true,
          });
        }
        await recovery.click();
        assert.equal(
          await page.getByTestId("route").textContent(),
          "/student/history-classroom/run?id=assignment-1",
        );
      } else {
        assert.equal(
          await recovery.count(),
          0,
          `${scenario.name} must not unlock recovery`,
        );
        await assertBlocked(page, `${scenario.name} stays closed`);
      }
      assert.deepEqual(errors, []);
      reports.push({
        scenario: scenario.name,
        width,
        recovery: !!scenario.recovery,
        passed: true,
      });
      await page.close();
    }
  }
  const liveScenarios = [
    { name: "local-only", results: [] },
    {
      name: "failed",
      results: [{ ...ownResult, status: "failed", passed: false, percent: 0 }],
    },
    {
      name: "cancelled",
      results: [
        { ...ownResult, status: "cancelled", passed: false, percent: 0 },
      ],
    },
    { name: "passed-stays-passed", results: [ownResult], staysBlocked: true },
    {
      name: "earlier-passed-latest-failed",
      results: [
        ownResult,
        {
          ...ownResult,
          id: "later-failed",
          status: "failed",
          passed: false,
          percent: 0,
          createdAt: { seconds: (now + 500) / 1000 },
        },
      ],
      staysBlocked: true,
    },
    {
      name: "past-due-stays-closed",
      results: [],
      dueAt: assignment.dueAt,
      staysBlocked: true,
    },
    { name: "legacy-local-only", results: [], legacy: true },
    {
      name: "reset-does-not-clear-newer-lock",
      results: [],
      savedAt: now + 2000,
      staysBlocked: true,
    },
  ];
  for (const scenario of liveScenarios) {
    const page = await browser.newPage({
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ assignment, scenario, now }) => {
        const entry = { ...assignment, dueAt: scenario.dueAt || null };
        window.__data = {
          assignments: scenario.legacy ? [] : [entry],
          legacyAssignments: scenario.legacy ? [entry] : [],
          results: scenario.results,
        };
        localStorage.setItem(
          "westoryHistoryClassroomLock:assignment-1:student-1",
          JSON.stringify({
            savedAt: scenario.savedAt || now,
            blockedUntil: now + 300000,
          }),
        );
      },
      { assignment, scenario, now },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .getByRole("heading", { name: assignment.title, exact: true })
      .waitFor();
    const path =
      (scenario.legacy
        ? "history_classrooms"
        : "years/2026/semesters/2/history_classrooms") + "/assignment-1";
    assert.deepEqual(
      await page.evaluate(() => [...window.__listeners.keys()]),
      [path],
      "subscribe only at the actual assigned source path",
    );
    await assertBlocked(page, "attempt starts blocked");
    await page.evaluate(
      ({ path, now, legacy }) => {
        const entry = (
          legacy ? window.__data.legacyAssignments : window.__data.assignments
        )[0];
        window.__emit(path, {
          ...entry,
          retryResetByStudentUid: {
            "student-2": { seconds: (now + 1000) / 1000 },
            "student-1": { seconds: (now - 1000) / 1000 },
          },
        });
      },
      { path, now, legacy: scenario.legacy },
    );
    await assertBlocked(
      page,
      "other student or stale reset cannot clear own cooldown",
    );
    await page.evaluate(
      ({ path, now, legacy }) => {
        const entry = (
          legacy ? window.__data.legacyAssignments : window.__data.assignments
        )[0];
        window.__emit(path, {
          ...entry,
          retryResetByStudentUid: {
            "student-1": { seconds: (now + 1000) / 1000 },
          },
        });
      },
      { path, now, legacy: scenario.legacy },
    );
    await page.waitForTimeout(50);
    if (scenario.staysBlocked) await assertBlocked(page, scenario.name);
    else {
      assert(
        await page.locator("article button").first().isEnabled(),
        "teacher reset unlocks the existing list immediately",
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem(
            "westoryHistoryClassroomLock:assignment-1:student-1",
          ),
        ),
        null,
      );
      await page.locator("article button").first().click();
      await page.getByTestId("route").waitFor();
      assert.equal(
        await page.evaluate(() => window.__listeners.size),
        0,
        "navigation releases assignment listeners",
      );
    }
    assert.deepEqual(errors, []);
    reports.push({
      scenario: "live-" + scenario.name,
      width: 768,
      passed: true,
    });
    await page.close();
  }
  for (const mode of ["permission", "unpublished", "deleted"]) {
    const page = await browser.newPage({
      viewport: { width: 768, height: 1024 },
    });
    await page.addInitScript(
      ({ assignment }) => {
        window.__data = {
          assignments: [{ ...assignment, dueAt: null }],
          results: [],
        };
      },
      { assignment },
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .getByRole("heading", { name: assignment.title, exact: true })
      .waitFor();
    await page.evaluate((mode) => {
      const path = "years/2026/semesters/2/history_classrooms/assignment-1";
      if (mode === "permission") window.__deny(path);
      else
        window.__emit(
          path,
          mode === "deleted"
            ? null
            : { ...window.__data.assignments[0], isPublished: false },
        );
    }, mode);
    await page
      .getByRole("heading", { name: assignment.title, exact: true })
      .waitFor({ state: "detached" });
    reports.push({ scenario: "live-" + mode, width: 768, passed: true });
    await page.close();
  }
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({
      viewport: { width, height: 1024 },
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ assignment, draft, now }) => {
        const assignments = [
          "available",
          "retry",
          "cooldown",
          "passed",
          "closed",
          "pending",
        ].map((state) => ({
          ...assignment,
          id: state,
          title: `${state} · 고대 국가의 형성과 발전을 살펴보는 역사교실`,
          dueAt: ["closed", "pending"].includes(state)
            ? assignment.dueAt
            : null,
          passThresholdPercent: 80,
        }));
        window.__data = {
          assignments,
          results: ["retry", "cooldown", "passed"].map((state) => ({
            id: `${state}-result`,
            assignmentId: state,
            uid: "student-1",
            status: state === "passed" ? "passed" : "failed",
            passed: state === "passed",
            score: state === "passed" ? 5 : 2,
            total: 5,
            percent: state === "passed" ? 100 : 40,
            createdAt: {
              seconds: (now - (state === "retry" ? 600000 : 0)) / 1000,
            },
          })),
        };
        localStorage.setItem(
          "westoryHistoryClassroomAttempt:pending:student-1",
          JSON.stringify({
            ...draft,
            assignmentId: "pending",
            resultId: "pending-result",
          }),
        );
      },
      { assignment, draft, now },
    );
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.route("**/*", (route) =>
      route.request().url().startsWith(url) ? route.continue() : route.abort(),
    );
    await page.goto(url);
    const card = (state) =>
      page.locator("article").filter({
        has: page.getByRole("heading", { name: new RegExp(`^${state} ·`) }),
      });
    const expectations = [
      {
        state: "available",
        label: "지금 도전 가능",
        action: "응시하기",
        enabled: true,
      },
      {
        state: "retry",
        label: "다시 도전 가능",
        action: "다시 도전하기",
        enabled: true,
      },
      {
        state: "cooldown",
        label: "재도전 대기",
        action: "대기 중",
        enabled: false,
      },
      { state: "passed", label: "통과 완료", enabled: false },
      { state: "closed", label: "응시 기간 종료", enabled: false },
      { state: "pending", action: "제출 재시도", enabled: true },
    ];
    for (const expected of expectations) {
      const item = card(expected.state);
      await item.waitFor();
      const panel = item.locator('[data-history-status-panel="true"]');
      assert(
        await panel.isVisible(),
        `${expected.state} has a prominent state panel`,
      );
      if (expected.label)
        assert(
          await panel.getByText(expected.label, { exact: true }).isVisible(),
          `${expected.state} exposes its current state`,
        );
      if (expected.action) {
        const action = item.getByRole("button", {
          name: expected.action,
          exact: true,
        });
        assert.equal(
          await action.isEnabled(),
          expected.enabled,
          `${expected.state} action permission is unchanged`,
        );
        const actionBox = await action.boundingBox();
        assert(
          actionBox.height >= 44,
          `${expected.state} action is touch reachable`,
        );
      } else {
        assert.equal(
          await item.locator("button").count(),
          0,
          `${expected.state} has no redundant or startable action`,
        );
      }
      const panelBox = await panel.boundingBox();
      assert(
        panelBox.x >= 0 && panelBox.x + panelBox.width <= width + 1,
        `${expected.state} panel stays inside viewport`,
      );
      if (expected.state === "cooldown") {
        const remaining = panel.getByText(/약 [1-5]분 후 가능/);
        assert(
          await remaining.isVisible(),
          "cooldown prominently explains when another attempt becomes available",
        );
        const size = await remaining.evaluate((el) =>
          parseFloat(getComputedStyle(el).fontSize),
        );
        assert(size >= 20, "remaining wait uses a large visible number");
      }
      if (["retry", "cooldown", "passed"].includes(expected.state)) {
        assert(
          await item
            .getByText(
              expected.state === "passed"
                ? /5\/5문제\s*· 1번째 시도/
                : /최근 2\/5문제\s*· 미통과/,
            )
            .isVisible(),
          "latest score is a secondary count rather than a competing percentage",
        );
      }
      if (expected.state === "pending") {
        assert.equal(
          await panel.getByText("응시 기간 종료", { exact: true }).count(),
          0,
          "pending submission takes precedence over a closed assignment",
        );
      }
      await item.screenshot({
        path: path.join(
          evidence,
          `student-index-state-${expected.state}-${width}.png`,
        ),
      });
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "student status list has no horizontal overflow",
    );
    await page.screenshot({
      path: path.join(evidence, `student-index-states-${width}.png`),
      fullPage: true,
    });
    for (const state of ["available", "retry", "pending"]) {
      if (state !== "available") await page.goto(url);
      const expected = expectations.find((entry) => entry.state === state);
      await card(state)
        .getByRole("button", { name: expected.action, exact: true })
        .click();
      assert.equal(
        await page.getByTestId("route").textContent(),
        `/student/history-classroom/run?id=${state}`,
        `${state} preserves the original runner route`,
      );
    }
    assert.deepEqual(errors, []);
    reports.push({
      scenario: "visible-status-panels",
      width,
      states: expectations.map(({ state }) => state),
      passed: true,
    });
    await page.close();
  }
  console.log(
    `History classroom index recovery: ${reports.length} cases passed.`,
  );
} finally {
  await fs.writeFile(
    path.join(evidence, "student-index-recovery-report.json"),
    JSON.stringify({ reports }, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
