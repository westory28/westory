/** Actual teacher components + production CSS; only Auth/Firebase use fixtures. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
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
const evidence = path.join(
  root,
  ".superloopy/sessions/weplay-teacher-20260929/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const baselineOnly = process.argv.includes("--baseline-only");
const headersOnly = process.argv.includes("--headers-only");
const baseline = "cd1d1683a66594e5ea4c2137d229e35ee73b4672";
const m = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const core = require(path.join(root, "functions/weplayCore.js"));
const sourceLessons = [
  {
    unitId: "public-1",
    title: "조선의 문화",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["훈민정음", "집현전", "경국대전"],
  },
  {
    unitId: "public-2",
    title: "삼국의 발전과 통일",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["고구려", "백제", "신라"],
  },
  {
    unitId: "private-1",
    title: "다음 수업 준비 자료",
    isVisibleToStudents: false,
    wordCount: 3,
    words: ["비공개정답", "고려", "발해"],
  },
];
const previewWords = Object.fromEntries(
  ["mild", "medium", "spicy"].map((difficulty) => [
    difficulty,
    Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => index + 1).map((mask) => {
        const selected = sourceLessons.filter(
          (_, index) => mask & (1 << index),
        );
        return [
          selected.map((lesson) => lesson.unitId).join(","),
          core.buildWords(
            selected.flatMap((lesson) =>
              lesson.words.map((text) => ({
                text,
                unitId: lesson.unitId,
                lessonTitle: lesson.title,
                context: "교사가 준비한 수업 문장",
              })),
            ),
            "teacher-qa",
            difficulty,
          ),
        ];
      }),
    ),
  ]),
);
const service = `
const params=new URLSearchParams(location.search);
export const view=params.get("view")||"management";
export const config={year:"2026",semester:"2"};
const readonly=view.includes("readonly");
const denied=view==="denied";
const headerRole=view.startsWith("header-")?view.slice(7):null;
export const userData={uid:"qa-teacher",role:readonly||denied||(headerRole&&headerRole!=="teacher")?"student":"teacher",teacherPortalEnabled:!denied&&headerRole!=="student",staffPermissions:headerRole==="lesson"?["lesson_read"]:headerRole==="points"?["point_read"]:readonly?["point_read","lesson_read"]:[],email:"qa@example.invalid",name:"검증 교사"};
const currentUser={uid:"qa-teacher",email:"qa@example.invalid"};
export const useAuth=()=>({config,currentUser,userData,interfaceConfig:{},refreshInterfaceConfig:async()=>{},logout:async()=>{},menuConfig:null,menuConfigReady:true,loading:false,configReady:true});
const policy=${JSON.stringify(core.DEFAULT_POLICY)};
const originalLessons=${JSON.stringify(sourceLessons)};
const previewWords=${JSON.stringify(previewWords)};
export const qa=window.weplayTeacherQa={calls:[],writes:[],fail:{},hold:{},settings:{enabled:true,sourceMode:"all",unitIds:[],version:0},lessons:structuredClone(originalLessons),policy};
if(view==="empty")qa.lessons=[];
if(view==="load-error")qa.fail.getWeplayManagement=1;
if(view==="loading")qa.hold.getWeplayManagement=true;
if(view==="removed-source")qa.settings={enabled:true,sourceMode:"selected",unitIds:["public-1","deleted-unit"],version:3};
const management=()=>({settings:structuredClone(qa.settings),lessons:structuredClone(qa.lessons),availableWordCount:qa.lessons.filter(lesson=>lesson.isVisibleToStudents&&(qa.settings.sourceMode==="all"||qa.settings.unitIds.includes(lesson.unitId))).reduce((sum,lesson)=>sum+lesson.wordCount,0),previewWordCount:qa.lessons.reduce((sum,lesson)=>sum+lesson.wordCount,0)});
export const getHttpsCallable=async name=>async data=>{
  qa.calls.push({name,data:structuredClone(data)});
  if(qa.hold[name])await new Promise(resolve=>{qa.release=resolve});
  if(qa.fail[name]){qa.fail[name]--;const error=new Error(qa.errorCode==="functions/aborted"?"다른 교사가 설정을 변경했습니다.":"QA 연결 오류");error.code=qa.errorCode||"functions/unavailable";throw error;}
  if(name==="getWeplayManagement")return {data:management()};
  if(name==="saveWeplayGameSettings"){qa.settings={...data.settings,version:qa.settings.version+1};qa.writes.push({name,data:structuredClone(data)});return {data:management()};}
  if(name==="previewWeplayGame"){
    const difficulty=data.difficulty;qa.preview=structuredClone(data);
    qa.session={id:"teacher-preview-"+qa.calls.length,mode:"practice",difficulty,status:"active",startsAtMs:Date.now()+3000,endsAtMs:Date.now()+63000,serverNowMs:Date.now(),words:previewWords[difficulty][originalLessons.filter(lesson=>data.unitIds.includes(lesson.unitId)).map(lesson=>lesson.unitId).join(",")],acceptedWordIds:[],correctCount:0,policy:structuredClone(policy),result:null};
    return {data:structuredClone(qa.session)};
  }
  if(name==="getWeplayPolicy")return {data:{policy:structuredClone(qa.policy),currentRankingPeriod:null}};
  if(name==="saveWeplayPolicy"){qa.policy=structuredClone(data.policy);qa.writes.push({name,data:structuredClone(data)});return {data:{policy:structuredClone(qa.policy),currentRankingPeriod:null}};}
  throw new Error("Unexpected callable in teacher QA: "+name);
};
export const db={};
export const getFirebaseStorage=async()=>({});
`;
const firestore = `
export * from "fixture:real-firestore";
import {qa} from "fixture:service";
export const doc=(_db,...parts)=>({path:parts.join("/")});
export const collection=(_db,...parts)=>({path:parts.join("/")});
export const query=(ref,...clauses)=>({...ref,clauses});
export const where=(...args)=>args;
export const orderBy=(...args)=>args;
export const limit=(...args)=>args;
const snapshot=()=>({exists:()=>false,data:()=>undefined,docs:[],size:0,empty:true,forEach:()=>{}});
export const getDoc=async()=>snapshot();
export const getDocs=async()=>snapshot();
export const onSnapshot=(_ref,fn)=>{fn(snapshot());return ()=>{};};
export const serverTimestamp=()=>({seconds:0});
export const setDoc=async(ref,data)=>{qa.writes.push({name:"setDoc",path:ref.path,data})};
export const deleteDoc=async()=>{throw new Error("Unexpected deletion")};
`;
const priorPoints = execFileSync(
  "git",
  ["show", `${baseline}:src/pages/teacher/ManagePoints.tsx`],
  { cwd: root, encoding: "utf8" },
);
const priorPolicy = execFileSync(
  "git",
  [
    "show",
    `${baseline}:src/pages/teacher/components/points/PointPolicyTab.tsx`,
  ],
  { cwd: root, encoding: "utf8" },
);
let hasManagement = true;
try {
  await fs.access(path.join(root, "src/pages/teacher/ManageWeplay.tsx"));
} catch {
  hasManagement = false;
}
if (!baselineOnly)
  assert(hasManagement, "ManageWeplay.tsx must exist before full QA");
const harness = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import Header from ${m("src/components/common/Header.tsx")};
import {canAccessTeacherPath} from ${m("src/lib/permissions.ts")};
import CurrentPoints from ${m("src/pages/teacher/ManagePoints.tsx")};
import PriorPoints from "fixture:prior-points";
${hasManagement ? `import ManageWeplay from ${m("src/pages/teacher/ManageWeplay.tsx")};` : "const ManageWeplay=()=>null;"}
import {AppToastProvider} from ${m("src/components/common/AppToastProvider.tsx")};
import {AppDialogProvider} from ${m("src/components/common/AppDialogProvider.tsx")};
import ${m("src/assets/index.css")};
import ${m("src/components/layout/teacherLayout.css")};
import ${m("src/pages/teacher/teacherSettings.css")};
import {view,qa,userData} from "fixture:service";
qa.routeAllowed=canAccessTeacherPath("/teacher/weplay",userData,"qa@example.invalid");
const policyView=view.startsWith("policy");
const initialRoute=policyView?"/teacher/points?tab=policy"+(view.includes("deep")?"&section=policy-weplay":""):"/teacher/weplay";
function Fixture(){return <MemoryRouter initialEntries={[initialRoute]}><AppToastProvider><AppDialogProvider><div className="teacher-layout flex min-h-screen flex-col bg-gray-50">{view.startsWith("header-")?<Header teacherLayout/>:<><aside className="teacher-sidebar" aria-label="QA 전체 메뉴"><strong>Westory</strong><span>전체 메뉴 위치 검증</span></aside><div className="qa-account" aria-label="QA 계정 영역">검증 교사</div><main className="min-h-0 w-full flex-1">{view==="policy-before"?<PriorPoints/>:policyView?<CurrentPoints/>:<ManageWeplay/>}</main></>}</div></AppDialogProvider></AppToastProvider></MemoryRouter>}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "weplay-teacher-fixture.js"),
  loader: { ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "teacher-qa-boundary",
      setup(plugin) {
        plugin.onResolve({ filter: /^fixture:real-firestore$/ }, () => ({
          path: require.resolve("firebase/firestore"),
        }));
        plugin.onResolve({ filter: /^fixture:/ }, (args) => ({
          path: args.path.slice(8),
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /components\/points\/PointPolicyTab$/ },
          (args) =>
            args.importer === "prior-points"
              ? { path: "prior-policy", namespace: "fixture" }
              : undefined,
        );
        plugin.onResolve({ filter: /(?:^|\/)contexts\/AuthContext$/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({
          path: "firestore",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "service"
              ? service
              : args.path === "firestore"
                ? firestore
                : args.path === "prior-points"
                  ? priorPoints
                  : priorPolicy,
          loader: "tsx",
          resolveDir:
            args.path === "prior-points"
              ? path.join(root, "src/pages/teacher")
              : args.path === "prior-policy"
                ? path.join(root, "src/pages/teacher/components/points")
                : root,
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const tailwind = await fs
  .readFile(path.join(os.tmpdir(), "westory-qa-tailwind.js"), "utf8")
  .catch(async () => {
    const response = await fetch("https://cdn.tailwindcss.com");
    assert(response.ok);
    return response.text();
  });
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><style>.qa-account{height:var(--teacher-account-height,48px);flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;padding:0 24px}.teacher-sidebar{gap:16px}@media(max-width:1023px){.qa-account{height:88px}}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const name = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Type",
    name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    name === "/qa.js"
      ? js
      : name === "/qa.css"
        ? css
        : name === "/tailwind.js"
          ? tailwind
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  screenshots = [],
  errors = [],
  network = [],
  geometry = [];
let status = "failed",
  failure = null;
async function pageFor(view, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    network.push(route.request().url());
    return route.abort();
  });
  await page.clock.install({ time: new Date("2026-09-29T02:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-29T02:00:10Z"));
  await page.goto(`${origin}/?view=${view}`);
  return page;
}
async function capture(page, name) {
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
  screenshots.push(`${name}.png`);
}
async function measure(page, view, width) {
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      nav: rect(".teacher-sub-navigation"),
      content: rect(".teacher-sub-content"),
      workspace: rect(".teacher-sub-workspace"),
      account: rect(".qa-account"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  geometry.push({ view, width, ...result });
  return result;
}
try {
  if (!baselineOnly) {
    for (const role of ["teacher", "lesson", "student", "points"]) {
      const page = await pageFor(`header-${role}`, 1280);
      await page
        .getByRole("navigation", { name: "교사 주 메뉴", exact: true })
        .waitFor();
      const allowed = role === "teacher" || role === "lesson";
      assert.equal(
        await page.evaluate(() => window.weplayTeacherQa.routeAllowed),
        allowed,
        role,
      );
      const weplay = page.locator('a[href="/teacher/weplay"]');
      assert.equal(
        (await weplay.count()) > 0,
        allowed,
        `${role} actual Header menu`,
      );
      if (allowed) assert.equal(await weplay.first().isVisible(), true);
      if (role === "lesson") await capture(page, "header-lesson-only-1280");
      await page.close();
    }
    checks.push(
      "Actual canAccessTeacherPath and Header/TeacherSidebar agree: teacher and lesson_read staff allowed; ordinary student and point-only staff denied; lesson-only staff see Weplay",
    );
  }
  if (!headersOnly) {
    for (const width of [390, 768, 1280, 1440]) {
      for (const view of [
        "policy-before",
        ...(baselineOnly ? [] : ["policy-current"]),
      ]) {
        const page = await pageFor(view, width);
        await page
          .getByRole("heading", { name: "위스 운영 정책", exact: true })
          .first()
          .waitFor();
        await capture(page, `${view}-${width}`);
        const metrics = await measure(page, view, width);
        assert.equal(metrics.overflow, false, `${view} ${width} overflow`);
        if (view === "policy-current" && width >= 1024) {
          assert.equal(metrics.nav.x, 232);
          assert.equal(metrics.nav.y, 0);
          assert.equal(metrics.nav.width, 256);
        }
        if (view === "policy-current" && width === 768) {
          assert.equal(metrics.nav.x, 0);
          assert.equal(metrics.nav.width, 240);
        }
        await page.close();
      }
    }
    checks.push(
      "Policy sidebar baseline/current geometry captured at 390/768/1280/1440px",
    );
    if (!baselineOnly) {
      for (const width of [390, 768, 1280, 1440]) {
        const page = await pageFor("management", width);
        await page
          .getByRole("heading", { name: "게임 운영", exact: true })
          .waitFor();
        await capture(page, `management-${width}`);
        const metrics = await measure(page, "management", width);
        assert.equal(metrics.overflow, false, `Management ${width} overflow`);
        if (width >= 1024) {
          assert.equal(metrics.nav.x, 232);
          assert.equal(metrics.nav.y, 0);
          assert.equal(metrics.nav.width, 256);
        }
        assert.equal(
          await page
            .getByRole("button", { name: "게임 설정 저장", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await page
            .getByRole("link", { name: "위스 설정", exact: true })
            .getAttribute("href"),
          "/teacher/points?tab=policy&section=policy-weplay",
        );
        if (width === 390) {
          const menu = page.getByRole("button", {
            name: /위플레이 관리 메뉴 펼치기/,
          });
          await menu.click();
          await page
            .getByRole("navigation", {
              name: "위플레이 관리 메뉴",
              exact: true,
            })
            .getByRole("link", { name: "역사가 내려와", exact: true })
            .click();
          assert.equal(await menu.getAttribute("aria-expanded"), "false");
          const heights = await page
            .locator(".teacher-weplay-button,.teacher-settings-menu-toggle")
            .evaluateAll((elements) =>
              elements
                .filter((element) => element.getClientRects().length)
                .map((element) => ({
                  text: element.textContent,
                  height: element.getBoundingClientRect().height,
                })),
            );
          assert(
            heights.every((button) => button.height >= 44),
            JSON.stringify(heights),
          );
        }
        await page.close();
      }
      checks.push(
        "Management real-component responsive screenshots 390/768/1280/1440; no horizontal overflow; mobile menu closes and controls >=44px; correct Wis policy link",
      );

      const manage = await pageFor("management", 390);
      await manage
        .getByRole("heading", { name: "게임 운영", exact: true })
        .waitFor();
      await manage
        .getByRole("radio", { name: "선택한 수업 자료", exact: true })
        .check();
      assert.equal(
        await manage
          .getByRole("button", { name: "체험 시작", exact: true })
          .isDisabled(),
        true,
      );
      await manage
        .getByRole("checkbox", {
          name: "다음 수업 준비 자료 출제 포함",
          exact: true,
        })
        .check();
      assert.match(
        await manage.locator(".teacher-weplay-counts").innerText(),
        /학생 출제 가능\s*0개/,
      );
      assert.match(
        await manage.locator(".teacher-weplay-counts").innerText(),
        /교사 체험\s*3개/,
      );
      await manage
        .getByRole("checkbox", { name: "학생 게임 사용 허용", exact: true })
        .uncheck();
      await manage.evaluate(
        () => (window.weplayTeacherQa.fail.saveWeplayGameSettings = 1),
      );
      await manage
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .click();
      await manage
        .getByRole("alert")
        .filter({ hasText: "연결이 원활하지 않습니다" })
        .waitFor();
      assert.equal(
        await manage
          .getByRole("checkbox", { name: "학생 게임 사용 허용", exact: true })
          .isChecked(),
        false,
      );
      assert.equal(
        await manage
          .getByRole("checkbox", {
            name: "다음 수업 준비 자료 출제 포함",
            exact: true,
          })
          .isChecked(),
        true,
      );
      assert.equal(
        await manage.evaluate(() => window.weplayTeacherQa.writes.length),
        0,
      );
      await capture(manage, "management-save-error-390");
      await manage.evaluate(
        () => (window.weplayTeacherQa.hold.saveWeplayGameSettings = true),
      );
      await manage
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .click();
      await manage
        .getByRole("button", { name: "저장 중…", exact: true })
        .waitFor();
      assert.equal(
        await manage
          .getByRole("checkbox", { name: "학생 게임 사용 허용", exact: true })
          .isDisabled(),
        true,
      );
      await manage.evaluate(() => {
        window.weplayTeacherQa.hold.saveWeplayGameSettings = false;
        window.weplayTeacherQa.release();
      });
      await manage
        .getByRole("status")
        .filter({ hasText: "게임 설정을 저장했습니다" })
        .waitFor();
      const saved = await manage.evaluate(() => window.weplayTeacherQa.writes);
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].data, {
        year: "2026",
        semester: "2",
        gameId: "history-rain",
        settings: {
          enabled: false,
          sourceMode: "selected",
          unitIds: ["private-1"],
          version: 0,
        },
      });
      await manage.close();
      checks.push(
        "Selected/private-only counts, zero-word start guard, student enabled flag, failed save preserves draft, retry persists same scoped settings once and disables inputs while saving",
      );

      const removed = await pageFor("removed-source", 390);
      await removed
        .getByRole("heading", { name: "게임 운영", exact: true })
        .waitFor();
      assert.equal(
        await removed
          .getByRole("button", { name: "게임 설정 저장", exact: true })
          .isEnabled(),
        true,
      );
      await removed
        .getByRole("checkbox", { name: "학생 게임 사용 허용", exact: true })
        .uncheck();
      await removed
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .click();
      await removed
        .getByRole("status")
        .filter({ hasText: "게임 설정을 저장했습니다" })
        .waitFor();
      const removedSave = await removed.evaluate(
        () => window.weplayTeacherQa.writes[0].data.settings,
      );
      assert.deepEqual(removedSave.unitIds, ["public-1"]);
      assert.equal(removedSave.enabled, false);
      await removed
        .getByRole("radio", { name: "전체 수업 자료", exact: true })
        .check();
      await removed.evaluate(() => {
        window.weplayTeacherQa.fail.saveWeplayGameSettings = 1;
        window.weplayTeacherQa.errorCode = "functions/aborted";
      });
      await removed
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .click();
      await removed
        .getByRole("button", { name: "최신 설정 불러오기", exact: true })
        .waitFor();
      assert.equal(
        await removed
          .getByRole("radio", { name: "전체 수업 자료", exact: true })
          .isChecked(),
        true,
      );
      await capture(removed, "management-conflict-390");
      await removed.evaluate(() => {
        window.weplayTeacherQa.settings = {
          enabled: true,
          sourceMode: "selected",
          unitIds: ["public-2"],
          version: 9,
        };
      });
      await removed
        .getByRole("button", { name: "최신 설정 불러오기", exact: true })
        .click();
      await removed
        .getByRole("heading", { name: "게임 운영", exact: true })
        .waitFor();
      assert.equal(
        await removed
          .getByRole("checkbox", {
            name: "삼국의 발전과 통일 출제 포함",
            exact: true,
          })
          .isChecked(),
        true,
      );
      assert.equal(
        await removed
          .getByRole("checkbox", { name: "조선의 문화 출제 포함", exact: true })
          .isChecked(),
        false,
      );
      assert.equal(
        await removed
          .getByRole("button", { name: "게임 설정 저장", exact: true })
          .isDisabled(),
        true,
      );
      await removed
        .getByRole("radio", { name: "전체 수업 자료", exact: true })
        .check();
      await removed
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .click();
      await removed
        .getByRole("status")
        .filter({ hasText: "게임 설정을 저장했습니다" })
        .waitFor();
      assert.deepEqual(
        await removed.evaluate(
          () => window.weplayTeacherQa.writes.at(-1).data.settings.unitIds,
        ),
        [],
      );
      await removed.close();
      checks.push(
        "Deleted source IDs are removed in editable draft and saved with disabled state; version conflict keeps draft, explicit reload recovers current settings; all-source save clears IDs",
      );

      for (const view of [
        "empty",
        "loading",
        "load-error",
        "readonly",
        "denied",
      ]) {
        const page = await pageFor(view, 390);
        if (view === "empty") {
          await page
            .getByText("등록된 수업 자료가 없습니다.", { exact: false })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "체험 시작", exact: true })
              .isDisabled(),
            true,
          );
        } else if (view === "loading") {
          await page
            .getByRole("status")
            .filter({ hasText: "게임 정보를 불러오는 중입니다" })
            .waitFor();
          await capture(page, "management-loading-390");
          await page.evaluate(() => {
            window.weplayTeacherQa.hold.getWeplayManagement = false;
            window.weplayTeacherQa.release();
          });
          await page
            .getByRole("heading", { name: "게임 운영", exact: true })
            .waitFor();
        } else if (view === "load-error") {
          await page
            .getByRole("alert")
            .filter({ hasText: "연결이 원활하지 않습니다" })
            .waitFor();
          await capture(page, "management-load-error-390");
          await page
            .getByRole("button", { name: "다시 불러오기", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "게임 운영", exact: true })
            .waitFor();
        } else if (view === "readonly") {
          await page
            .getByText("읽기 전용입니다. 게임 체험은 이용할 수 있습니다.", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "게임 설정 저장", exact: true })
              .count(),
            0,
          );
          assert.equal(
            await page
              .getByRole("checkbox", {
                name: "학생 게임 사용 허용",
                exact: true,
              })
              .isDisabled(),
            true,
          );
          assert.equal(
            await page
              .getByRole("radio", { name: "선택한 수업 자료", exact: true })
              .isDisabled(),
            true,
          );
          assert.equal(
            await page
              .getByRole("button", { name: "체험 시작", exact: true })
              .isEnabled(),
            true,
          );
        } else {
          await page
            .getByRole("alert")
            .filter({ hasText: "볼 권한이 없습니다" })
            .waitFor();
          assert.deepEqual(
            await page.evaluate(() => window.weplayTeacherQa.calls),
            [],
          );
        }
        await capture(page, `management-${view}-390`);
        assert.equal((await measure(page, view, 390)).overflow, false);
        await page.close();
      }
      checks.push(
        "Management empty/loading/error recovery/read-only/permission denied states; unauthorized view makes no data call",
      );

      for (const [difficulty, label] of [
        ["mild", "착한맛"],
        ["medium", "중간맛"],
        ["spicy", "매운맛"],
      ]) {
        const page = await pageFor(
          "management",
          difficulty === "medium" ? 768 : difficulty === "spicy" ? 1280 : 390,
        );
        await page
          .getByRole("heading", { name: "게임 운영", exact: true })
          .waitFor();
        await page
          .getByRole("radio", { name: "선택한 수업 자료", exact: true })
          .check();
        await page
          .getByRole("checkbox", {
            name: "다음 수업 준비 자료 출제 포함",
            exact: true,
          })
          .check();
        await page
          .getByRole("group", { name: "체험 난이도", exact: true })
          .getByRole("button", { name: label, exact: true })
          .click();
        if (difficulty === "mild") {
          await page.evaluate(
            () => (window.weplayTeacherQa.fail.previewWeplayGame = 1),
          );
          await page
            .getByRole("button", { name: "체험 시작", exact: true })
            .click();
          await page
            .getByRole("alert")
            .filter({ hasText: "연결이 원활하지 않습니다" })
            .waitFor();
        }
        await page
          .getByRole("button", { name: "체험 시작", exact: true })
          .click();
        const answer = page.getByRole("textbox", {
          name: "단어 입력",
          exact: true,
        });
        await answer.waitFor();
        assert.equal(await answer.isDisabled(), true);
        const session = await page.evaluate(
          () => window.weplayTeacherQa.session,
        );
        assert.equal(session.endsAtMs - session.startsAtMs, 60000);
        assert(session.words.every((word) => word.unitId === "private-1"));
        assert.deepEqual(
          [...new Set(session.words.map((word) => word.fallDurationMs))],
          {
            mild: [12000, 10000, 8000],
            medium: [10000, 8000, 6000],
            spicy: [8000, 6000, 4000],
          }[difficulty],
        );
        assert.equal(
          (await page.evaluate(() => window.weplayTeacherQa.preview))
            .difficulty,
          difficulty,
        );
        await page.clock.runFor(3500);
        assert.equal(
          await answer.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
        );
        await answer.fill(session.words[0].text);
        await answer.dispatchEvent("compositionstart", {
          data: session.words[0].text,
        });
        await answer.press("Enter");
        assert.match(
          await page.locator(".weplay-game-meta").innerText(),
          /성공 0 \/ 20/,
        );
        await answer.dispatchEvent("compositionend", {
          data: session.words[0].text,
        });
        await answer.press("Enter");
        await page.getByText("성공 1 / 20", { exact: true }).waitFor();
        await capture(page, `preview-${difficulty}-early`);
        await page.clock.runFor(19500);
        await page
          .getByRole("list", { name: "진행 구간", exact: true })
          .locator('[aria-current="step"]')
          .filter({ hasText: "중반" })
          .waitFor();
        await page.clock.runFor(20000);
        await page
          .getByRole("list", { name: "진행 구간", exact: true })
          .locator('[aria-current="step"]')
          .filter({ hasText: "후반" })
          .waitFor();
        await capture(page, `preview-${difficulty}-late`);
        await page.clock.runFor(20000);
        assert.equal(await answer.isDisabled(), true);
        await page.clock.runFor(1000);
        await page
          .getByRole("heading", { name: `체험 결과 · ${label}`, exact: true })
          .waitFor();
        assert.match(
          await page.locator(".weplay-result").innerText(),
          /1 \/ 20개/,
        );
        await capture(page, `preview-${difficulty}-result`);
        assert.deepEqual(
          await page.evaluate(() => window.weplayTeacherQa.writes),
          [],
        );
        const calls = await page.evaluate(() => window.weplayTeacherQa.calls);
        assert(
          calls.every((call) =>
            ["getWeplayManagement", "previewWeplayGame"].includes(call.name),
          ),
          JSON.stringify(calls),
        );
        await page
          .getByRole("button", { name: "다시 체험", exact: true })
          .click();
        await answer.waitFor();
        await page
          .getByRole("button", { name: "체험 종료", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "게임 운영", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("checkbox", {
              name: "다음 수업 준비 자료 출제 포함",
              exact: true,
            })
            .isChecked(),
          true,
        );
        assert.match(
          await page.getByRole("status").innerText(),
          /저장하지 않은 변경 사항/,
        );
        assert.deepEqual(
          await page.evaluate(() => window.weplayTeacherQa.writes),
          [],
        );
        await page.close();
      }
      checks.push(
        "Private-only unsaved draft previews all 3 difficulties, correct 9 speeds, 3s countdown, Korean IME, local answer, 20/40/60s boundaries, result/replay/exit; no currency/record writes or student game API calls",
      );

      for (const width of [390, 1280]) {
        const page = await pageFor("policy-deep", width);
        const cost = page.getByRole("spinbutton", {
          name: "도전 비용 (위스)",
          exact: true,
        });
        await cost.waitFor();
        await cost.fill("");
        assert.equal(await cost.inputValue(), "");
        await cost.fill("0");
        const nav = page.getByRole("navigation", {
          name: "위스 운영 정책 메뉴",
          exact: true,
        });
        if (width === 390)
          await page
            .getByRole("button", { name: /위스 운영 정책 메뉴 펼치기/ })
            .click();
        await nav
          .getByRole("button", { name: "기본 자동 지급", exact: true })
          .click();
        if (width === 390)
          await page
            .getByRole("button", { name: /위스 운영 정책 메뉴 펼치기/ })
            .click();
        await nav
          .getByRole("button", { name: "위플레이", exact: true })
          .click();
        assert.equal(await cost.inputValue(), "0");
        if (width === 390)
          assert.equal(
            await page
              .getByRole("button", { name: /위스 운영 정책 메뉴 펼치기/ })
              .getAttribute("aria-expanded"),
            "false",
          );
        assert.equal(await page.getByRole("spinbutton").count(), 16);
        await capture(page, `policy-weplay-${width}`);
        await page.close();
      }
      checks.push(
        "Policy deep-link opens Weplay; numeric blank/zero editing and draft survive section changes on mobile/desktop; mobile menu closes",
      );
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  status = "passed";
} catch (error) {
  failure = String(error.stack || error);
  throw error;
} finally {
  await fs.writeFile(
    path.join(
      evidence,
      headersOnly
        ? "header-results.json"
        : baselineOnly
          ? "baseline-results.json"
          : "teacher-results.json",
    ),
    JSON.stringify(
      { status, failure, checks, geometry, screenshots, errors, network },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`PASS teacher Weplay QA. Evidence: ${evidence}`);
